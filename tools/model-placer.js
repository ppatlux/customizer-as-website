import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// These two are generated/edited constantly (the tool itself patches the
// manifest, presets.js changes per mix). A static `import` gets cached hard for
// the tab's lifetime and a plain reload often won't refresh it — which is why
// freshly-saved `mixonly` files kept "not showing up". Cache-bust on every load.
const { ASSET_MANIFEST } = await import(`../scripts/asset-manifest.js?t=${Date.now()}`);
const { PRESETS } = await import(`../scripts/presets.js?t=${Date.now()}`);

// ---------------------------------------------------------------------------
// Constants mirrored from scripts/app.js
// ---------------------------------------------------------------------------
// Every part is added to the live scene at this y position by loadModel(). Each
// part .glb in assets/models/** is therefore authored WITHOUT the offset (its
// geometry sits around a shared build origin) and the app lifts it. We preview
// the same way: reference parts and the part being placed all live under a
// group raised by MODEL_Y_OFFSET, so "author space" (what we bake into the
// exported .glb) is simply the transform relative to that group.
const MODEL_Y_OFFSET = 30;

// Per-part .glb files are authored in millimeters (compat-checker.js measures
// them in raw mm; engrave.html labels the same units "mm"). Only the AR export
// in app.js multiplies by MM_TO_M — a single part .glb stays mm, so we export
// at scale 1.

// occt-import-js (OpenCascade WASM) — loaded lazily the first time a STEP/IGES
// file is dropped so plain STL work doesn't pay for the ~4 MB download.
const OCCT_VERSION = '0.0.23';
const OCCT_BASE = `https://cdn.jsdelivr.net/npm/occt-import-js@${OCCT_VERSION}/dist/`;

// category key -> models sub-folder. Derived from the manifest itself (the
// `wheels` part lives in the `motion` folder, etc.) so it can't drift out of
// sync. `mixonly` is the standalone-models bag (folder `_mixonly`); when its
// array is still empty there's no entry to read the folder from, so name it
// explicitly.
const FOLDER_FOR_PART = Object.fromEntries(
  Object.entries(ASSET_MANIFEST).map(([part, entries]) => [
    part,
    entries[0]?.folder || (part === 'mixonly' ? '_mixonly' : part),
  ])
);
const PART_KEYS = Object.keys(ASSET_MANIFEST);
// Real build slots — everything except the `mixonly` bag. Used for a mix's
// `parts` / `visibility`; `mixonly` refs go into `extras` instead.
const BUILD_SLOTS = PART_KEYS.filter((p) => p !== 'mixonly');

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const host = document.getElementById('viewerHost');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14171c);

// The customizer is Y-up (standard glTF): parts are centred on X/Z and stacked
// along +Y — bottom Y≈-24..0, middle ..32, top ..48, hats 48..78. (Some part
// GLBs ship a wrong cached bounding box in their glTF accessor min/max, so this
// tool always recomputes bounds from real vertices — see bakeToFlatGroup.)
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20000);
camera.position.set(180, 150, 240);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
host.appendChild(renderer.domElement);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, MODEL_Y_OFFSET + 20, 0);
orbit.update();

scene.add(new THREE.AmbientLight(0xffffff, 0.65));
const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(180, 320, 200);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.35);
fill.position.set(-160, -80, -120);
scene.add(fill);

// buildGroup === the shared build origin. Everything the customizer would stack
// lives in here; its only transform is the y lift the app applies in loadModel
// (model.position.y = MODEL_Y_OFFSET). The exported geometry is baked relative
// to this group, so it lands in the app exactly where it sits against the
// reference parts here.
const buildGroup = new THREE.Group();
buildGroup.position.y = MODEL_Y_OFFSET;
scene.add(buildGroup);

// Grid on the X/Z plane (Y = floor) + axes at the build origin.
const grid = new THREE.GridHelper(300, 30, 0x3a4150, 0x2a2f3a);
buildGroup.add(grid);
const axes = new THREE.AxesHelper(40);
buildGroup.add(axes);

const referenceGroup = new THREE.Group();
buildGroup.add(referenceGroup);

// editPivot === the placement the user edits with the gizmo / number fields.
// importRoot (the loaded file) is nested inside it and only moved by the
// "Quick align" normalisation actions.
const editPivot = new THREE.Group();
buildGroup.add(editPivot);
let importRoot = null;
let importInfo = null; // { name, ext, meshCount, hadNormals }

// ---------------------------------------------------------------------------
// Transform gizmo
// ---------------------------------------------------------------------------
const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setSpace('world');
gizmo.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; });
gizmo.addEventListener('objectChange', () => {
  clampUniformScale();
  writeFieldsFromPivot();
  updateDimReadout();
});
scene.add(gizmo.getHelper());

function attachGizmo() {
  if (importRoot) gizmo.attach(editPivot);
  else gizmo.detach();
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------
function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(host);
resize();

function tick() {
  requestAnimationFrame(tick);
  orbit.update();
  renderer.render(scene, camera);
}
tick();

// ---------------------------------------------------------------------------
// Toast + status helpers
// ---------------------------------------------------------------------------
const toastEl = document.getElementById('toast');
let toastTimer = 0;
function toast(msg, kind = '') {
  toastEl.textContent = msg;
  toastEl.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = ''; }, 3200);
}
function setSaveStatus(text) { document.getElementById('saveStatus').textContent = text; }

// ---------------------------------------------------------------------------
// File import
// ---------------------------------------------------------------------------
const gltfLoader = new GLTFLoader();
const stlLoader = new STLLoader();
const objLoader = new OBJLoader();
const mfLoader = new ThreeMFLoader();

let occtPromise = null;
function getOcct() {
  if (!occtPromise) {
    occtPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `${OCCT_BASE}occt-import-js.js`;
      s.onload = () => resolve(window.occtimportjs({ locateFile: (f) => OCCT_BASE + f }));
      s.onerror = () => reject(new Error('Could not load occt-import-js from the CDN'));
      document.head.appendChild(s);
    });
  }
  return occtPromise;
}

// STEP detail slider (0..100) -> occt linear deflection as a ratio of the
// bounding-box size. Smaller ratio = finer tessellation.
function stepDeflection() {
  const q = Number(document.getElementById('stepQuality').value) / 100;
  return 0.01 - q * 0.0092; // 0.01 (coarse) .. 0.0008 (fine)
}

function occtMeshToGeometry(m) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
  if (m.attributes.normal) g.setAttribute('normal', new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
  if (m.index) g.setIndex(new THREE.Uint32BufferAttribute(new Uint32Array(m.index.array), 1));
  if (!m.attributes.normal) g.computeVertexNormals();
  return g;
}

// Collapse any loaded hierarchy (GLTF scene graph, OBJ/3MF groups, nested node
// matrices some exporters bake in) into a flat Group of identity-transform
// meshes whose geometry already carries the file's own placement. This makes
// "load a .glb and it keeps the position it was authored with" literally true,
// and gives every format one consistent representation for the gizmo + export.
function bakeToFlatGroup(object, material) {
  const out = new THREE.Group();
  object.traverse((node) => {
    if (!node.isMesh || !node.geometry?.getAttribute('position')) return;
    // updateWorldMatrix (not updateMatrixWorld) recomputes the full parent
    // chain regardless of any matrixWorldAutoUpdate=false a loader set — some
    // GLTF exporters emit node matrices that would otherwise be skipped.
    node.updateWorldMatrix(true, false);
    const g = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
    g.applyMatrix4(node.matrixWorld); // object is unparented, so matrixWorld == its own local placement
    g.deleteAttribute('uv');
    g.deleteAttribute('uv1');
    g.deleteAttribute('color');
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    // Recompute from real vertices — several project GLBs ship a wrong cached
    // box/sphere in their glTF accessor min/max, which Box3.setFromObject and
    // raycasts would otherwise trust (same fix app.js applies in loadModel).
    g.computeBoundingBox();
    g.computeBoundingSphere();
    out.add(new THREE.Mesh(g, material()));
  });
  return out;
}

const editMaterial = () => new THREE.MeshStandardMaterial({
  color: 0x4da3ff, metalness: 0.05, roughness: 0.75, side: THREE.DoubleSide,
});

async function parseFile(name, buffer) {
  const ext = name.split('.').pop().toLowerCase();

  if (ext === 'stl') {
    const geo = stlLoader.parse(buffer);
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    return { object: new THREE.Mesh(geo, editMaterial()), ext, meshCount: 1, hadNormals: !!geo.getAttribute('normal') };
  }

  if (ext === 'obj') {
    const obj = objLoader.parse(new TextDecoder().decode(buffer));
    let meshCount = 0;
    obj.traverse((n) => { if (n.isMesh) { n.material = editMaterial(); meshCount++; } });
    return { object: obj, ext, meshCount, hadNormals: true };
  }

  if (ext === '3mf') {
    const obj = mfLoader.parse(buffer);
    let meshCount = 0;
    obj.traverse((n) => { if (n.isMesh) { n.material = editMaterial(); meshCount++; } });
    return { object: obj, ext, meshCount, hadNormals: true };
  }

  if (ext === 'glb' || ext === 'gltf') {
    const gltf = await gltfLoader.parseAsync(buffer, '');
    let meshCount = 0;
    gltf.scene.traverse((n) => { if (n.isMesh) { n.material = editMaterial(); meshCount++; } });
    return { object: gltf.scene, ext, meshCount, hadNormals: true };
  }

  if (ext === 'step' || ext === 'stp' || ext === 'iges' || ext === 'igs') {
    toast('Tessellating CAD file…');
    const occt = await getOcct();
    const bytes = new Uint8Array(buffer);
    const params = { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: stepDeflection(), angularDeflection: 0.5 };
    const res = (ext === 'iges' || ext === 'igs') ? occt.ReadIgesFile(bytes, params) : occt.ReadStepFile(bytes, params);
    if (!res || !res.success || !res.meshes.length) throw new Error('occt-import-js could not read this file');
    const group = new THREE.Group();
    res.meshes.forEach((m) => group.add(new THREE.Mesh(occtMeshToGeometry(m), editMaterial())));
    return { object: group, ext, meshCount: res.meshes.length, hadNormals: res.meshes.every((m) => !!m.attributes.normal) };
  }

  throw new Error(`Unsupported file type: .${ext}`);
}

async function loadFile(file) {
  setBusy(true);
  try {
    const buffer = await file.arrayBuffer();
    const parsed = await parseFile(file.name, buffer);

    if (importRoot) editPivot.remove(importRoot);
    // Flatten to identity-transform meshes carrying the file's own placement.
    importRoot = bakeToFlatGroup(parsed.object, editMaterial);

    // A .glb/.gltf already carries a deliberate position/scale (it's usually an
    // existing part being re-adjusted, or one this tool exported) — load it
    // exactly as authored: no unit scaling, no re-centring. CAD/mesh formats
    // (STL/STEP/OBJ/3MF) have no meaningful placement, so those get the unit
    // scale and an automatic X/Y centre.
    const keepAsAuthored = parsed.ext === 'glb' || parsed.ext === 'gltf';
    if (!keepAsAuthored) {
      importRoot.scale.setScalar(Number(document.getElementById('unitSel').value) || 1);
    }
    editPivot.add(importRoot);

    editPivot.position.set(0, 0, 0);
    editPivot.rotation.set(0, 0, 0);
    editPivot.scale.setScalar(1);

    importInfo = { name: file.name, ...parsed };
    document.getElementById('filePill').textContent = `${file.name} · ${parsed.meshCount} mesh${parsed.meshCount === 1 ? '' : 'es'}`;
    document.getElementById('expNormals').checked = !parsed.hadNormals;
    if (!document.getElementById('expName').value) {
      document.getElementById('expName').value = suggestExportName(file.name);
    }
    prefillExportCategory(file.name);
    document.getElementById('unitSel').disabled = keepAsAuthored;

    attachGizmo();
    writeFieldsFromPivot();
    if (!keepAsAuthored) {
      // CAD/mesh import: centre on the X/Z plane so it starts on the build axis.
      centerXZ();
    }
    frameOnEdit();
    updateDimReadout();
    toast(keepAsAuthored ? `Loaded ${file.name} at its authored position` : `Loaded ${file.name}`, 'ok');
  } catch (err) {
    console.error(err);
    toast(err.message || 'Failed to load file', 'bad');
  } finally {
    setBusy(false);
  }
}

function setBusy(on) {
  document.getElementById('filePill').innerHTML = on
    ? '<span class="spin">◠</span> working…'
    : (importInfo ? `${importInfo.name} · ${importInfo.meshCount} mesh${importInfo.meshCount === 1 ? '' : 'es'}` : 'no file loaded');
}

function suggestExportName(srcName) {
  const base = srcName.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_');
  return `${base}.glb`;
}

// ---------------------------------------------------------------------------
// Transform field <-> editPivot sync
// ---------------------------------------------------------------------------
const F = (id) => document.getElementById(id);
const RAD = Math.PI / 180;
let syncingFields = false;

function writeFieldsFromPivot() {
  syncingFields = true;
  F('posX').value = round(editPivot.position.x);
  F('posY').value = round(editPivot.position.y);
  F('posZ').value = round(editPivot.position.z);
  F('rotX').value = round(editPivot.rotation.x / RAD);
  F('rotY').value = round(editPivot.rotation.y / RAD);
  F('rotZ').value = round(editPivot.rotation.z / RAD);
  F('sclX').value = round(editPivot.scale.x, 4);
  F('sclY').value = round(editPivot.scale.y, 4);
  F('sclZ').value = round(editPivot.scale.z, 4);
  syncingFields = false;
}

function readPivotFromFields() {
  if (syncingFields) return;
  editPivot.position.set(num('posX'), num('posY'), num('posZ'));
  editPivot.rotation.set(num('rotX') * RAD, num('rotY') * RAD, num('rotZ') * RAD);
  if (F('lockScale').checked) {
    const s = num('sclX') || 1;
    editPivot.scale.setScalar(s);
    syncingFields = true;
    F('sclY').value = round(s, 4); F('sclZ').value = round(s, 4);
    syncingFields = false;
  } else {
    editPivot.scale.set(num('sclX') || 1, num('sclY') || 1, num('sclZ') || 1);
  }
  editPivot.updateMatrixWorld(true);
  updateDimReadout();
}

function clampUniformScale() {
  if (F('lockScale').checked && importRoot) {
    const s = editPivot.scale.x;
    editPivot.scale.setScalar(s);
  }
}

['posX', 'posY', 'posZ', 'rotX', 'rotY', 'rotZ', 'sclX', 'sclY', 'sclZ'].forEach((id) => {
  F(id).addEventListener('input', readPivotFromFields);
});
F('lockScale').addEventListener('change', () => {
  F('sclY').disabled = F('sclZ').disabled = F('lockScale').checked;
  readPivotFromFields();
});
F('sclY').disabled = F('sclZ').disabled = true;

const num = (id) => Number(F(id).value) || 0;
function round(v, dp = 3) { const m = 10 ** dp; return Math.round(v * m) / m; }

// ---------------------------------------------------------------------------
// Quick-align actions (operate on importRoot inside editPivot, or editPivot)
// ---------------------------------------------------------------------------
function editWorldBox() {
  editPivot.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(importRoot);
}
// Box of importRoot expressed in buildGroup ("author") space.
function editAuthorBox() {
  const box = editWorldBox();
  const inv = new THREE.Matrix4().copy(buildGroup.matrixWorld).invert();
  return box.clone().applyMatrix4(inv);
}

// Parts are centred on the X/Z (horizontal) plane; +Y is up.
function centerXZ() {
  if (!importRoot) return;
  const b = editAuthorBox();
  const c = b.getCenter(new THREE.Vector3());
  editPivot.position.x -= c.x;
  editPivot.position.z -= c.z;
  editPivot.updateMatrixWorld(true);
  writeFieldsFromPivot();
  updateDimReadout();
}

// Sit the part on the build floor (its lowest Y at 0). Use the numeric Y field
// afterwards to raise it onto whatever mount it clicks into (e.g. hats start
// around Y 48, bumpers/faces have their own bands — load a reference part and
// eyeball it).
function dropToFloor() {
  if (!importRoot) return;
  const b = editAuthorBox();
  editPivot.position.y -= b.min.y;
  editPivot.updateMatrixWorld(true);
  writeFieldsFromPivot();
  updateDimReadout();
}

// CAD files (STEP/STL) are usually Z-up; the customizer is Y-up. Swing the part
// so its +Z becomes +Y.
function cadZupToYup() {
  if (!importRoot) return;
  editPivot.rotation.x -= 90 * RAD;
  editPivot.updateMatrixWorld(true);
  writeFieldsFromPivot();
  updateDimReadout();
}

function snapRot90() {
  if (!importRoot) return;
  const snap = (r) => Math.round(r / (90 * RAD)) * (90 * RAD);
  editPivot.rotation.set(snap(editPivot.rotation.x), snap(editPivot.rotation.y), snap(editPivot.rotation.z));
  editPivot.updateMatrixWorld(true);
  writeFieldsFromPivot();
  updateDimReadout();
}

// Re-seat importRoot so its bounding-box centre sits on the editPivot origin
// (the gizmo pivot / rotation centre), compensating on editPivot so nothing
// visibly moves.
function originToBboxMid() {
  if (!importRoot) return;
  editPivot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(importRoot);
  const invPivot = new THREE.Matrix4().copy(editPivot.matrixWorld).invert();
  const c = box.applyMatrix4(invPivot).getCenter(new THREE.Vector3()); // centre in editPivot space
  importRoot.position.sub(c);
  // Same delta, taken up through editPivot's rotation+scale, added back to its
  // position (buildGroup has no rotation/scale so that equals the world delta).
  const rs = new THREE.Matrix4().makeRotationFromEuler(editPivot.rotation).scale(editPivot.scale);
  editPivot.position.add(c.clone().applyMatrix4(rs));
  editPivot.updateMatrixWorld(true);
  writeFieldsFromPivot();
  updateDimReadout();
}

// Reset the placement gizmo (editPivot). For CAD/mesh imports also re-apply the
// unit scale and auto-centre; for .glb/.gltf leave the file's own authored
// transform (inside importRoot) untouched.
function resetTransform() {
  if (!importRoot) return;
  const keepAsAuthored = importInfo && (importInfo.ext === 'glb' || importInfo.ext === 'gltf');
  if (!keepAsAuthored) {
    importRoot.position.set(0, 0, 0);
    importRoot.rotation.set(0, 0, 0);
    importRoot.scale.setScalar(Number(F('unitSel').value) || 1);
  }
  editPivot.position.set(0, 0, 0);
  editPivot.rotation.set(0, 0, 0);
  editPivot.scale.setScalar(1);
  editPivot.updateMatrixWorld(true);
  writeFieldsFromPivot();
  if (!keepAsAuthored) centerXZ();
  updateDimReadout();
}

F('qaCenterXZ').addEventListener('click', centerXZ);
F('qaFloor').addEventListener('click', dropToFloor);
F('qaZup').addEventListener('click', cadZupToYup);
F('qaSnapRot').addEventListener('click', snapRot90);
F('qaOriginCenter').addEventListener('click', originToBboxMid);
F('qaReset').addEventListener('click', resetTransform);

F('unitSel').addEventListener('change', () => {
  if (!importRoot) return;
  importRoot.scale.setScalar(Number(F('unitSel').value) || 1);
  editPivot.updateMatrixWorld(true);
  updateDimReadout();
});

function frameOnEdit() {
  if (!importRoot) return;
  const b = editWorldBox();
  const size = b.getSize(new THREE.Vector3()).length() || 100;
  const c = b.getCenter(new THREE.Vector3());
  orbit.target.copy(c);
  camera.position.copy(c).add(new THREE.Vector3(1, 0.9, 1.4).setLength(size * 1.3));
  orbit.update();
}

// ---------------------------------------------------------------------------
// Dimension readout
// ---------------------------------------------------------------------------
function updateDimReadout() {
  const el = document.getElementById('dimReadout');
  if (!importRoot) { el.textContent = ''; return; }
  const b = editAuthorBox();
  const s = b.getSize(new THREE.Vector3());
  el.innerHTML = `<b>part</b>  ${fmt(s.x)} × ${fmt(s.y)} × ${fmt(s.z)} mm\n`
    + `X ${fmt(b.min.x)} … ${fmt(b.max.x)}\n`
    + `Y ${fmt(b.min.y)} … ${fmt(b.max.y)}  (up)\n`
    + `Z ${fmt(b.min.z)} … ${fmt(b.max.z)}`;
}
const fmt = (v) => v.toFixed(1);

// ---------------------------------------------------------------------------
// Reference parts
// ---------------------------------------------------------------------------
const refLoader = new GLTFLoader();
const loadedRefs = new Map(); // key "part/file" -> { object, part, file }

function refUrl(part, file) {
  // Resolve the real folder from the manifest entry — mix-only variants sit
  // under _mixonly/<sub>/, not the part's own folder.
  const entry = (ASSET_MANIFEST[part] || []).find((e) => e.file === file);
  return `../assets/models/${entry?.folder || FOLDER_FOR_PART[part]}/${file}`;
}

function ghostMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x8ea3bd,
    transparent: true,
    opacity: Number(F('refOpacity').value) / 100,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

async function addReference(part, file) {
  const rkey = `${part}/${file}`;
  if (loadedRefs.has(rkey)) { toast(`${file} already loaded`); return; }
  try {
    const gltf = await refLoader.loadAsync(refUrl(part, file));
    const obj = gltf.scene;
    obj.traverse((n) => { if (n.isMesh) { n.material = ghostMaterial(); n.raycast = () => {}; } });
    referenceGroup.add(obj);
    loadedRefs.set(rkey, { object: obj, part, file });
    renderRefList();
  } catch (err) {
    console.error(err);
    toast(`Missing: ${refUrl(part, file)}`, 'bad');
  }
}

function removeReference(rkey) {
  const entry = loadedRefs.get(rkey);
  if (!entry) return;
  referenceGroup.remove(entry.object);
  loadedRefs.delete(rkey);
  renderRefList();
}

function clearReferences() {
  for (const { object } of loadedRefs.values()) referenceGroup.remove(object);
  loadedRefs.clear();
  renderRefList();
}

async function loadStarterBuild() {
  const starter = PRESETS.starter;
  const jobs = [];
  for (const [part, file] of Object.entries(starter.parts)) {
    if (starter.visibility[part] === false) continue;
    if (!ASSET_MANIFEST[part]?.some((e) => e.file === file)) continue;
    jobs.push(addReference(part, file));
  }
  await Promise.all(jobs);
  toast('Starter build loaded', 'ok');
}

function renderRefList() {
  const ul = document.getElementById('refList');
  if (!loadedRefs.size) {
    ul.innerHTML = '<li class="empty">No reference parts loaded</li>';
    refreshMixPreview();
    return;
  }
  ul.innerHTML = [...loadedRefs.entries()].map(([rkey, { part, file, object }]) => `
    <li data-key="${rkey}">
      <input type="checkbox" ${object.visible !== false ? 'checked' : ''} data-role="vis">
      <span class="name" title="${rkey}">${part} / ${file}</span>
      <button type="button" data-role="remove" class="tiny">×</button>
    </li>`).join('');
  refreshMixPreview();
}

document.getElementById('refList').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-key]');
  if (!li) return;
  if (e.target.dataset.role === 'remove') removeReference(li.dataset.key);
});
document.getElementById('refList').addEventListener('change', (e) => {
  const li = e.target.closest('li[data-key]');
  if (!li || e.target.dataset.role !== 'vis') return;
  const entry = loadedRefs.get(li.dataset.key);
  if (entry) entry.object.visible = e.target.checked;
  refreshMixPreview();
});

F('refOpacity').addEventListener('input', () => {
  const o = Number(F('refOpacity').value) / 100;
  for (const { object } of loadedRefs.values()) {
    object.traverse((n) => { if (n.isMesh && n.material) n.material.opacity = o; });
  }
});

// Category / variant pickers
function populateCategoryPickers() {
  const refCat = F('refCat');
  const expCat = F('expCat');
  refCat.innerHTML = PART_KEYS.map((p) => `<option value="${p}">${p}</option>`).join('');
  expCat.innerHTML = PART_KEYS.map((p) => `<option value="${p}">${p}</option>`).join('');
  refreshVariantPicker();
}
function refreshVariantPicker() {
  const part = F('refCat').value;
  F('refVariant').innerHTML = (ASSET_MANIFEST[part] || [])
    .map((e) => `<option value="${e.file}">${e.file}</option>`).join('');
}
F('refCat').addEventListener('change', refreshVariantPicker);
F('addRefBtn').addEventListener('click', () => {
  const part = F('refCat').value;
  const file = F('refVariant').value;
  if (part && file) addReference(part, file);
});

// Load the selected manifest model as the *editable source* (not a ghost), so a
// basic part can be repositioned for a specific mix and saved as a new mixonly
// asset. Pre-points the export at `mixonly` with a distinct name so a stray
// Save can't overwrite the original part.
F('editAsSourceBtn').addEventListener('click', async () => {
  const part = F('refCat').value;
  const file = F('refVariant').value;
  if (!part || !file) return;
  try {
    setBusy(true);
    const res = await fetch(refUrl(part, file));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    await loadFile(new File([blob], file, { type: 'model/gltf-binary' }));
    F('expCat').value = 'mixonly';
    const stem = file.replace(/\.glb$/i, '');
    F('expName').value = `Mix_${stem}.glb`;
    toast(`Editing ${file} — repositioned copy will save as a new mixonly file`, 'ok');
  } catch (err) {
    console.error(err);
    toast(`Couldn't load ${file}: ${err.message}`, 'bad');
  } finally {
    setBusy(false);
  }
});
F('loadStarterBtn').addEventListener('click', loadStarterBuild);
F('clearRefsBtn').addEventListener('click', clearReferences);

function prefillExportCategory(fileName) {
  const lower = fileName.toLowerCase();
  const hit = PART_KEYS.find((p) => lower.startsWith(p) || lower.startsWith(FOLDER_FOR_PART[p]));
  if (hit) F('expCat').value = hit;
}

// ---------------------------------------------------------------------------
// Bake + export
// ---------------------------------------------------------------------------
// Collect every mesh under editPivot, bake its full transform chain (relative
// to buildGroup === author space) into a cloned geometry. This is exactly the
// geometry the customizer will show once it adds the part at y=MODEL_Y_OFFSET.
function bakedGeometries() {
  buildGroup.updateMatrixWorld(true);
  const invBuild = new THREE.Matrix4().copy(buildGroup.matrixWorld).invert();
  const geoms = [];
  editPivot.traverse((node) => {
    if (!node.isMesh || !node.geometry?.getAttribute('position')) return;
    const g = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
    const bake = new THREE.Matrix4().multiplyMatrices(invBuild, node.matrixWorld);
    g.applyMatrix4(bake);
    // Normalise every geometry to the same attribute set (position + normal,
    // no uvs) so they can be merged without mismatch.
    g.deleteAttribute('uv');
    g.deleteAttribute('uv1');
    g.deleteAttribute('color');
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    geoms.push(g);
  });
  return geoms;
}

async function buildExportScene() {
  if (!importRoot) throw new Error('Load a file first');
  let geoms = bakedGeometries();
  if (!geoms.length) throw new Error('No mesh geometry to export');

  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xcfd4dc, metalness: 0.0, roughness: 0.85 });

  if (F('expMerge').checked && geoms.length > 1) {
    geoms = [mergeGeometries(geoms, false)];
  }
  geoms.forEach((g) => {
    if (F('expNormals').checked) g.computeVertexNormals();
    root.add(new THREE.Mesh(g, mat));
  });
  return root;
}

async function exportGlbBlob() {
  const root = await buildExportScene();
  const exporter = new GLTFExporter();
  const result = await new Promise((resolve, reject) => {
    exporter.parse(root, resolve, reject, { binary: true, onlyVisible: false });
  });
  return new Blob([result], { type: 'model/gltf-binary' });
}

// Same baked geometry as the .glb, as a binary STL — so a mixonly piece has a
// real hosted print file the customizer's "Send to slicer" can hand to a
// slicer:// link (a slicer can't fetch a browser-made blob URL).
async function exportStlBlob() {
  const root = await buildExportScene();
  // Scene is Y-up, STL/slicers are Z-up — turn +90° about X so the piece
  // stands upright on the bed (matches the hosted CAD STLs).
  const upright = new THREE.Group();
  upright.rotation.x = Math.PI / 2;
  upright.add(root);
  upright.updateMatrixWorld(true);
  const result = new STLExporter().parse(upright, { binary: true });
  return new Blob([result], { type: 'model/stl' });
}

function exportFileName() {
  let n = F('expName').value.trim() || (importInfo ? suggestExportName(importInfo.name) : 'part.glb');
  if (!/\.glb$/i.test(n)) n += '.glb';
  return n;
}

F('downloadGlbBtn').addEventListener('click', async () => {
  try {
    setBusy(true);
    const blob = await exportGlbBlob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = exportFileName();
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`Exported ${exportFileName()} (${(blob.size / 1024).toFixed(0)} KB)`, 'ok');
  } catch (err) {
    console.error(err);
    toast(err.message, 'bad');
  } finally { setBusy(false); }
});

// ---------------------------------------------------------------------------
// Repo folder (File System Access API) + manifest patching
// ---------------------------------------------------------------------------
let repoHandle = null;

function idb(store = 'handles') {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('model-placer-db', 1);
    req.onupgradeneeded = () => req.result.createObjectStore(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(k, v) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(v, k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(k) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('handles', 'readonly');
    const r = tx.objectStore('handles').get(k);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
}

async function hasChildDir(handle, name) {
  try { await handle.getDirectoryHandle(name); return true; }
  catch { return false; }
}

// Accepts the repo root, OR any folder inside/around it that still lets us
// reach assets/ + scripts/ — if the picked folder itself isn't the root but
// contains a single obvious project subfolder, drill into that.
async function resolveRepoRoot(handle) {
  if (await hasChildDir(handle, 'assets') && await hasChildDir(handle, 'scripts')) return handle;
  // One level down: e.g. the user picked "Downloads" and the repo is the only
  // folder in it, or picked a wrapper folder around the checkout.
  for await (const child of handle.values()) {
    if (child.kind !== 'directory') continue;
    if (await hasChildDir(child, 'assets') && await hasChildDir(child, 'scripts')) return child;
  }
  return null;
}

async function ensureReadWrite(handle) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

async function pickRepoFolder() {
  if (!window.showDirectoryPicker) {
    toast('This browser has no File System Access API (use Chrome/Edge, or just "Download .glb")', 'bad');
    return;
  }
  let picked;
  try {
    picked = await window.showDirectoryPicker({ id: 'hp-customizer-repo', mode: 'readwrite' });
  } catch (err) {
    if (err?.name === 'AbortError') return; // user cancelled the dialog
    console.error(err);
    toast(`Picker failed: ${err.message || err.name}`, 'bad');
    return;
  }
  try {
    if (!(await ensureReadWrite(picked))) {
      toast('Write permission denied for that folder', 'bad');
      return;
    }
    const root = await resolveRepoRoot(picked);
    if (!root) {
      toast(`"${picked.name}" isn't the repo (no assets/ + scripts/ inside) — pick the customizer folder itself`, 'bad');
      return;
    }
    repoHandle = root;
    try { await idbSet('repo', root); } catch (e) { console.warn('handle not persisted', e); }
    setSaveStatus(`repo: ${root.name}`);
    toast(`Repo connected: ${root.name}`, 'ok');
  } catch (err) {
    console.error(err);
    toast(`Folder error: ${err.message || err.name}`, 'bad');
  }
}

async function reconnectRepo() {
  try {
    const handle = await idbGet('repo');
    if (!handle) return;
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') { repoHandle = handle; setSaveStatus(`repo: ${handle.name}`); }
    else setSaveStatus('click "Connect repo folder" to resume');
  } catch { /* handle stale */ }
}

async function getFileHandleByPath(dirHandle, parts, { create = false } = {}) {
  let dir = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create });
  }
  return dir.getFileHandle(parts[parts.length - 1], { create });
}

async function writeFile(handle, data) {
  const w = await handle.createWritable();
  await w.write(data);
  await w.close();
}

// Append a manifest entry as the LAST item of the part's array — new parts
// should show up at the end of the variant list in the customizer, not the
// front. Adds the trailing comma to the current last entry as needed, and
// handles an empty `part: []` array too.
function patchManifestText(text, part, file, folder) {
  if (new RegExp(`file:\\s*['"]${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(text)) {
    return { text, already: true };
  }
  const entry = `{ file: '${file}', folder: '${folder}', source: '' }`;

  // Empty array: `  hat: []`  ->  `  hat: [\n    <entry>\n  ]`
  const empty = new RegExp(`(\\n([ \\t]*)${part}:\\s*\\[)\\s*\\]`);
  if (empty.test(text)) {
    return { text: text.replace(empty, `$1\n$2  ${entry}\n$2]`), already: false };
  }

  // Populated array: capture from `part: [` through the last entry (non-greedy,
  // up to the line that closes the array), then insert before that close.
  const re = new RegExp(`(\\n([ \\t]*)${part}:\\s*\\[[\\s\\S]*?)(\\n[ \\t]*\\])`);
  if (!re.test(text)) return { text, notFound: true };
  const patched = text.replace(re, (_all, head, indent, close) => {
    const body = head.replace(/\s+$/, '');
    const sep = body.endsWith(',') ? '' : ',';
    return `${body}${sep}\n${indent}  ${entry}${close}`;
  });
  return { text: patched, already: false };
}

async function saveIntoRepo() {
  if (!repoHandle) { toast('Connect the repo folder first', 'bad'); return; }
  if (!importRoot) { toast('Load a file first', 'bad'); return; }
  if (!(await ensureReadWrite(repoHandle))) { toast('Write permission for the repo folder was denied', 'bad'); return; }
  const part = F('expCat').value;
  const folder = FOLDER_FOR_PART[part];
  const segs = folder.split('/');
  const file = exportFileName();
  try {
    setBusy(true);
    const blob = await exportGlbBlob();

    // 1. write the .glb
    const glbHandle = await getFileHandleByPath(repoHandle, ['assets', 'models', ...segs, file], { create: true });
    await writeFile(glbHandle, blob);

    // 2. patch scripts/asset-manifest.js
    const manHandle = await getFileHandleByPath(repoHandle, ['scripts', 'asset-manifest.js']);
    const manText = await (await manHandle.getFile()).text();
    const patched = patchManifestText(manText, part, file, folder);
    let manNote = '';
    if (patched.already) manNote = ' (manifest already had it)';
    else if (patched.notFound) manNote = ` (couldn't find "${part}:" array — add manually)`;
    else { await writeFile(manHandle, patched.text); manNote = ' + manifest entry'; }

    // 3. drop the placement sidecar next to the glb
    const sidecar = await getFileHandleByPath(
      repoHandle, ['assets', 'models', ...segs, file.replace(/\.glb$/i, '.placement.json')], { create: true });
    await writeFile(sidecar, JSON.stringify(placementJson(), null, 2));

    // 3b. mixonly pieces are repo-only (no hprobots.com STEP host), so also
    // write a real .stl next to the .glb — that's what the customizer's
    // "Send to slicer" needs a fetchable URL for.
    let stlNote = '';
    if (part === 'mixonly') {
      try {
        const stlHandle = await getFileHandleByPath(
          repoHandle, ['assets', 'models', ...segs, file.replace(/\.glb$/i, '.stl')], { create: true });
        await writeFile(stlHandle, await exportStlBlob());
        stlNote = ' + .stl';
      } catch (e) {
        console.error('STL export failed', e);
        stlNote = ' (STL export failed)';
      }
    }

    // 4. a mixonly model: make it usable in the mix composer right away — add it
    // to the in-memory manifest and load it as a reference ghost.
    if (part === 'mixonly' && !patched.already) {
      (ASSET_MANIFEST.mixonly ||= []).push({ file, folder, source: '' });
      refreshVariantPicker();
      await addReference(part, file);
    }

    setSaveStatus(`saved ${new Date().toLocaleTimeString()}`);
    toast(`Wrote assets/models/${folder}/${file}${manNote}${stlNote}`, 'ok');
  } catch (err) {
    console.error(err);
    toast(`Save failed: ${err.message}`, 'bad');
  } finally { setBusy(false); }
}

document.getElementById('pickRepoBtn').addEventListener('click', pickRepoFolder);
document.getElementById('saveRepoBtn').addEventListener('click', saveIntoRepo);

// ---------------------------------------------------------------------------
// Ready-made mix authoring — patches the PRESETS object in scripts/presets.js
// ---------------------------------------------------------------------------
// The Reference parts list is the composition surface: `mixonly` refs become
// the mix's `extras`; every other ref is a build slot (one variant per slot,
// last added wins, visible unless its checkbox there is off).
function mixCompositionFromRefs() {
  const slots = {};
  const extras = [];
  for (const { part, file, object } of loadedRefs.values()) {
    if (part === 'mixonly') { if (!extras.includes(file)) extras.push(file); continue; }
    slots[part] = { file, visible: object.visible !== false };
  }
  return { slots, extras };
}

function refreshMixPreview() {
  const el = F('mixPreview');
  if (!el) return;
  const { slots, extras } = mixCompositionFromRefs();
  const slotKeys = BUILD_SLOTS.filter((p) => slots[p]);
  if (!slotKeys.length && !extras.length) {
    el.textContent = 'Add reference parts above to compose a mix.';
    return;
  }
  const lines = slotKeys.map((p) => `${slots[p].visible ? '●' : '○'} ${p}: ${slots[p].file}`);
  for (const f of extras) lines.push(`★ extra: ${f}`);
  if (slotKeys.some((p) => !slots[p].visible)) lines.push('\n○ = slot pinned but hidden in this mix');
  el.textContent = lines.join('\n');
}

function buildMixEntryText(key, label, desc, comp) {
  const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const used = BUILD_SLOTS.filter((p) => comp.slots[p]);
  const partsLines = used.map((p) => `      ${p}: ${q(comp.slots[p].file)}`).join(',\n');
  const partsBlock = used.length ? `    parts: {\n${partsLines}\n    },\n` : '    parts: {},\n';
  const visLine = BUILD_SLOTS.map((p) => `${p}: ${comp.slots[p] ? !!comp.slots[p].visible : false}`).join(', ');
  const extrasLine = comp.extras.length ? `,\n    extras: [${comp.extras.map(q).join(', ')}]` : '';
  return `  ${key}: {\n`
    + `    label: ${q(label)},\n`
    + `    description: ${q(desc)},\n`
    + partsBlock
    + `    visibility: { ${visLine} }`
    + extrasLine + '\n'
    + '  }';
}

// Insert a new entry just before the PRESETS object's closing `\n};` (the first
// one after its declaration — every entry inside closes with `},` or `}`, never
// `};` at line start). Brace-matching would be sturdier but this file's shape is
// stable and the regex stays obvious.
function patchPresetsText(text, key, entryText) {
  if (new RegExp(`\\n {2}${key}:\\s`).test(text)) return { text, already: true };
  const anchor = text.indexOf('export const PRESETS = {');
  if (anchor === -1) return { text, notFound: true };
  const closeRel = text.slice(anchor).search(/\n\};/);
  if (closeRel === -1) return { text, notFound: true };
  const at = anchor + closeRel; // index of the "\n" before "};"
  const head = text.slice(0, at).replace(/\s*$/, '');
  const sep = head.endsWith(',') ? '' : ',';
  return { text: `${head}${sep}\n\n${entryText}\n${text.slice(at + 1)}` };
}

async function saveMixIntoRepo() {
  if (!repoHandle) { toast('Connect the repo folder first', 'bad'); return; }
  if (!(await ensureReadWrite(repoHandle))) { toast('Write permission for the repo folder was denied', 'bad'); return; }
  const key = F('mixKey').value.trim();
  if (!/^[a-z][a-zA-Z0-9]*$/.test(key)) { toast('Mix key must be a lowercase identifier, e.g. "console"', 'bad'); return; }
  const label = F('mixLabel').value.trim();
  if (!label) { toast('Give the mix a label', 'bad'); return; }
  const comp = mixCompositionFromRefs();
  if (!Object.keys(comp.slots).length && !comp.extras.length) { toast('Add reference parts to compose the mix', 'bad'); return; }
  try {
    setBusy(true);
    const handle = await getFileHandleByPath(repoHandle, ['scripts', 'presets.js']);
    const src = await (await handle.getFile()).text();
    const entryText = buildMixEntryText(key, label, F('mixDesc').value.trim(), comp);
    const res = patchPresetsText(src, key, entryText);
    if (res.already) { toast(`presets.js already has a "${key}" mix — pick another key`, 'bad'); return; }
    if (res.notFound) { toast("Couldn't locate the PRESETS object in presets.js — add the mix manually", 'bad'); return; }
    await writeFile(handle, res.text);
    setSaveStatus(`mix "${key}" saved ${new Date().toLocaleTimeString()}`);
    toast(`Added mix "${key}" — ${Object.keys(comp.slots).length} parts, ${comp.extras.length} extras`, 'ok');
  } catch (err) {
    console.error(err);
    toast(`Save mix failed: ${err.message}`, 'bad');
  } finally { setBusy(false); }
}
F('saveMixBtn').addEventListener('click', saveMixIntoRepo);

// ---------------------------------------------------------------------------
// Placement sidecar (re-editable transform)
// ---------------------------------------------------------------------------
function placementJson() {
  return {
    tool: 'model-placer',
    savedAt: new Date().toISOString(),
    source: importInfo ? importInfo.name : null,
    category: F('expCat').value,
    file: exportFileName(),
    sourceUnits: Number(F('unitSel').value),
    modelYOffset: MODEL_Y_OFFSET,
    editPivot: {
      position: editPivot.position.toArray(),
      rotationDeg: [editPivot.rotation.x / RAD, editPivot.rotation.y / RAD, editPivot.rotation.z / RAD],
      scale: editPivot.scale.toArray(),
    },
    importRoot: importRoot ? {
      position: importRoot.position.toArray(),
      rotationDeg: [importRoot.rotation.x / RAD, importRoot.rotation.y / RAD, importRoot.rotation.z / RAD],
      scale: importRoot.scale.toArray(),
    } : null,
  };
}

function applyPlacementJson(j) {
  if (!j || !j.editPivot) { toast('Not a placement file', 'bad'); return; }
  if (j.category) F('expCat').value = j.category;
  if (j.file) F('expName').value = j.file;
  if (j.sourceUnits) F('unitSel').value = String(j.sourceUnits);
  const p = j.editPivot;
  editPivot.position.fromArray(p.position);
  editPivot.rotation.set(p.rotationDeg[0] * RAD, p.rotationDeg[1] * RAD, p.rotationDeg[2] * RAD);
  editPivot.scale.fromArray(p.scale);
  if (j.importRoot && importRoot) {
    importRoot.position.fromArray(j.importRoot.position);
    importRoot.rotation.set(j.importRoot.rotationDeg[0] * RAD, j.importRoot.rotationDeg[1] * RAD, j.importRoot.rotationDeg[2] * RAD);
    importRoot.scale.fromArray(j.importRoot.scale);
  }
  editPivot.updateMatrixWorld(true);
  writeFieldsFromPivot();
  updateDimReadout();
  toast('Placement applied', 'ok');
}

F('savePlacementBtn').addEventListener('click', () => {
  if (!importRoot) { toast('Load a file first', 'bad'); return; }
  const blob = new Blob([JSON.stringify(placementJson(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = exportFileName().replace(/\.glb$/i, '.placement.json');
  a.click();
  URL.revokeObjectURL(a.href);
});
F('loadPlacementBtn').addEventListener('click', () => F('placementInput').click());
F('placementInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try { applyPlacementJson(JSON.parse(await file.text())); }
  catch (err) { toast(`Bad JSON: ${err.message}`, 'bad'); }
  e.target.value = '';
});

// ---------------------------------------------------------------------------
// Gizmo mode / space toggles + keyboard
// ---------------------------------------------------------------------------
document.getElementById('modeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (!b) return;
  setGizmoMode(b.dataset.mode);
});
document.getElementById('spaceSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-space]');
  if (!b) return;
  gizmo.setSpace(b.dataset.space);
  document.querySelectorAll('#spaceSeg button').forEach((x) => x.classList.toggle('active', x === b));
});
function setGizmoMode(mode) {
  gizmo.setMode(mode);
  document.querySelectorAll('#modeSeg button').forEach((x) => x.classList.toggle('active', x.dataset.mode === mode));
}
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === 'w') setGizmoMode('translate');
  else if (e.key === 'e') setGizmoMode('rotate');
  else if (e.key === 'r') setGizmoMode('scale');
  else if (e.key === 'f') frameOnEdit();
});

F('stepQuality').addEventListener('input', () => {
  const q = Number(F('stepQuality').value);
  F('stepQualityVal').textContent = q < 33 ? 'coarse' : q < 66 ? 'med' : 'fine';
});

// ---------------------------------------------------------------------------
// Drag & drop + file picker
// ---------------------------------------------------------------------------
const dropZone = document.getElementById('dropZone');
let dragDepth = 0;
addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; dropZone.classList.add('active'); });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) dropZone.classList.remove('active'); });
addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropZone.classList.remove('active');
  const file = e.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});
document.getElementById('openFileBtn').addEventListener('click', () => F('fileInput').click());
F('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) loadFile(file);
  e.target.value = '';
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
populateCategoryPickers();
setGizmoMode('translate');
reconnectRepo();
refreshMixPreview();
