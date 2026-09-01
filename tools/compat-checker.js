import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { ASSET_MANIFEST } from '../scripts/asset-manifest.js';

// Mirrors MODEL_Y_OFFSET in scripts/app.js — every part is loaded at this
// same y position by the real app (loadModel).
const MODEL_Y_OFFSET = 30;

// Mirrors SPACER_DROP / SPACER_AFFECTED_PARTS in scripts/app.js. A visible
// Spacer lengthens the mid-section, so these parts drop by SPACER_DROP to stay
// aligned; every spacer variant produces the same fixed drop.
//
// A pair whose two parts straddle this line (one drops, the other doesn't —
// e.g. face × bumper) sits differently with a Spacer in the build than
// without, so it's screened as TWO independent list entries: the plain pair
// and a second "<pair> + spacer" row, each scanned and assigned on its own.
// Pairs where both sides drop together, or neither does, are unaffected and
// stay a single row.
const SPACER_DROP = 16;
const SPACER_AFFECTED_PARTS = new Set(['bottom', 'wheels', 'arms', 'bumper']);
const SPACER_SHIFT = new THREE.Vector3(0, -SPACER_DROP, 0);

// [shiftA, shiftB] (Vector3 | null each) to apply for the "Spacer in build"
// configuration, or null when a Spacer doesn't change this pair's relative
// geometry.
function spacerShifts(partA, partB) {
  const aAffected = SPACER_AFFECTED_PARTS.has(partA);
  const bAffected = SPACER_AFFECTED_PARTS.has(partB);
  if (aAffected === bAffected) return null;
  return [aAffected ? SPACER_SHIFT : null, bAffected ? SPACER_SHIFT : null];
}

// A Spacer in the build changes this pair's relative geometry (exactly one
// side drops). The `spacer` part itself isn't in the affected set, so
// spacer×<affected> reads as sensitive — correct, since that pairing only ever
// exists with a Spacer present.
function isSpacerSensitive(partA, partB) {
  return spacerShifts(partA, partB) !== null;
}

function involvesSpacerPart(a, b) {
  return a.part === 'spacer' || b.part === 'spacer';
}

const COMPAT_JSON_URL = '../assets/compatibility.json';
const DEFAULT_THRESHOLD = 20;
const SAMPLE_RESOLUTION = 18; // samples along the longest axis of the overlap region

// ---------------------------------------------------------------------------
// Manifest -> flat file list + pairs
// ---------------------------------------------------------------------------

function flattenManifest() {
  const files = [];
  for (const [part, entries] of Object.entries(ASSET_MANIFEST)) {
    for (const entry of entries) {
      files.push({
        part,
        file: entry.file,
        url: `../assets/models/${entry.folder}/${entry.file}`
      });
    }
  }
  return files;
}

function fileKey(f) { return `${f.part}|${f.file}`; }

// `spacer` true marks the "Spacer in the build" variant of a pair — a distinct
// list entry with its own key (…::spacer suffix), scan result, and verdict.
function pairKey(a, b, spacer = false) {
  const ka = fileKey(a), kb = fileKey(b);
  const base = ka < kb ? `${ka}<->${kb}` : `${kb}<->${ka}`;
  return spacer ? `${base}::spacer` : base;
}

// Category pairs whose compatibility is already fully determined by hand-coded
// rules in scripts/app.js (enforceArmsBumperExclusion — arms/bumper share a
// mount point, always mutually exclusive; enforceHatRequiresTopHats — any
// hat forces Top to Top_Hats.glb, no other Top is ever compatible with a
// hat) — geometry-scanning or manually reviewing these would just be noise,
// so they never enter the pair list at all.
const CATEGORY_PAIRS_HANDLED_ELSEWHERE = new Set(['arms|bumper', 'hat|top']);

function categoryPairKey(partA, partB) {
  return partA < partB ? `${partA}|${partB}` : `${partB}|${partA}`;
}

let skippedCategoryPairCount = 0;

// Each entry is a screening unit: { a, b, spacer }. Spacer-sensitive pairs
// contribute two units (plain + "+ spacer"); a pairing that involves the
// spacer part itself contributes a single "+ spacer" unit, since it only
// exists with a Spacer in the build; everything else is one plain unit.
function buildAllPairs(files) {
  const pairs = [];
  skippedCategoryPairCount = 0;
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const a = files[i], b = files[j];
      if (a.part === b.part) continue;
      if (CATEGORY_PAIRS_HANDLED_ELSEWHERE.has(categoryPairKey(a.part, b.part))) {
        skippedCategoryPairCount++;
        continue;
      }
      if (involvesSpacerPart(a, b)) {
        pairs.push({ a, b, spacer: true });
      } else {
        pairs.push({ a, b, spacer: false });
        if (isSpacerSensitive(a.part, b.part)) pairs.push({ a, b, spacer: true });
      }
    }
  }
  return pairs;
}

const allFiles = flattenManifest();
const allPairs = buildAllPairs(allFiles);

// ---------------------------------------------------------------------------
// Persisted state (assets/compatibility.json)
// ---------------------------------------------------------------------------

let state = { version: 1, threshold: DEFAULT_THRESHOLD, pairs: {} };
let saveHandle = null;

async function loadInitialState() {
  try {
    const res = await fetch(COMPAT_JSON_URL, { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      if (json && typeof json === 'object' && json.pairs) {
        state = { version: 1, threshold: json.threshold || DEFAULT_THRESHOLD, pairs: json.pairs };
      }
    }
  } catch {
    // No existing file yet — start fresh.
  }
}

function dbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('compat-checker-db', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, val) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readonly');
    const req = tx.objectStore('handles').get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function tryReconnectSavedHandle() {
  if (!window.showSaveFilePicker) return;
  try {
    const handle = await idbGet('compatFile');
    if (!handle) return;
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      saveHandle = handle;
      setSaveStatus('Autosave connected');
    } else {
      setSaveStatus('Click "Connect save file" to resume autosave');
    }
  } catch {
    // Handle may no longer be valid (file moved/deleted) — ignore.
  }
}

async function connectSaveFile() {
  if (!window.showSaveFilePicker) {
    setSaveStatus('File System Access API unavailable — use Download instead');
    return;
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'compatibility.json',
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
    });
    await idbSet('compatFile', handle);
    saveHandle = handle;
    await persistState();
    setSaveStatus('Autosave connected');
  } catch {
    // User cancelled the picker — leave things as they were.
  }
}

async function persistState() {
  state.threshold = currentThreshold;
  if (!saveHandle) return;
  try {
    const writable = await saveHandle.createWritable();
    await writable.write(JSON.stringify(state, null, 2));
    await writable.close();
    setSaveStatus(`Saved ${new Date().toLocaleTimeString()}`);
  } catch (err) {
    console.error('Failed to save compatibility.json', err);
    setSaveStatus('Autosave failed — try Download instead');
  }
}

function downloadState() {
  state.threshold = currentThreshold;
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'compatibility.json';
  a.click();
  URL.revokeObjectURL(url);
}

function setSaveStatus(text) {
  document.getElementById('saveStatus').textContent = text;
}

// ---------------------------------------------------------------------------
// Geometry loading + measurement
// ---------------------------------------------------------------------------

const loader = new GLTFLoader();
const geometryCache = new Map(); // url -> { bbox, volume, bvh, gltfScene }

function extractWorldPositionGeometry(root) {
  root.position.y = MODEL_Y_OFFSET;
  root.updateMatrixWorld(true);
  const worldGeoms = [];
  root.traverse((node) => {
    if (!node.isMesh) return;
    const geom = node.geometry;
    const posAttr = geom.getAttribute('position');
    if (!posAttr) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', posAttr.clone());
    if (geom.index) g.setIndex(geom.index.clone());
    g.applyMatrix4(node.matrixWorld);
    worldGeoms.push(g.index ? g.toNonIndexed() : g);
  });
  if (!worldGeoms.length) return null;
  return worldGeoms.length === 1 ? worldGeoms[0] : mergeGeometries(worldGeoms, false);
}

// Exact volume of a closed triangle mesh via the divergence-theorem
// signed-tetrahedron-sum formula (sum of each triangle's signed volume
// against the origin) — cheap, exact for watertight geometry, and
// translation-invariant so the MODEL_Y_OFFSET baked into the geometry above
// doesn't need special handling.
function computeVolume(geometry) {
  const pos = geometry.getAttribute('position');
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3(), cross = new THREE.Vector3();
  let vol = 0;
  for (let i = 0; i < pos.count; i += 3) {
    pA.fromBufferAttribute(pos, i);
    pB.fromBufferAttribute(pos, i + 1);
    pC.fromBufferAttribute(pos, i + 2);
    cross.crossVectors(pB, pC);
    vol += pA.dot(cross) / 6;
  }
  return Math.abs(vol);
}

async function loadPartData(f) {
  if (geometryCache.has(f.url)) return geometryCache.get(f.url);
  const gltf = await loader.loadAsync(f.url);
  const geometry = extractWorldPositionGeometry(gltf.scene);
  let data;
  if (!geometry) {
    data = { bbox: new THREE.Box3(), volume: 0, bvh: null, gltfUrl: f.url };
  } else {
    geometry.computeBoundingBox();
    const bvh = new MeshBVH(geometry);
    data = { bbox: geometry.boundingBox.clone(), volume: computeVolume(geometry), bvh, gltfUrl: f.url };
  }
  geometryCache.set(f.url, data);
  return data;
}

// Ray-parity "point inside closed mesh" test, accelerated by the part's BVH:
// cast a ray from `point` in a fixed non-axis-aligned direction and count
// intersections — an odd count means the point is inside.
function isInside(bvh, point, direction, ray) {
  ray.origin.copy(point);
  ray.direction.copy(direction);
  const hits = bvh.raycast(ray, THREE.DoubleSide);
  return (hits.length % 2) === 1;
}

const sampleDir = new THREE.Vector3(1, 0.0071, 0.0037).normalize();
const sampleRay = new THREE.Ray();
const samplePoint = new THREE.Vector3();
const shiftedPoint = new THREE.Vector3();

// Estimates the intersection volume of two parts by voxel-sampling the
// overlapping region of their bounding boxes and testing each sample point
// for "inside both meshes" via BVH-accelerated ray casts. `shiftA` / `shiftB`
// (Vector3 | null) translate the respective part before measuring — used to
// screen a pair with a Spacer in the build, where the spacer-affected side
// sits SPACER_DROP lower. Translating a body by d is the same as translating
// the query point by -d against that body's (unmoved) BVH.
function estimateIntersectionVolume(dataA, dataB, shiftA = null, shiftB = null) {
  if (!dataA.bvh || !dataB.bvh) return 0;
  const bboxA = shiftA ? dataA.bbox.clone().translate(shiftA) : dataA.bbox;
  const bboxB = shiftB ? dataB.bbox.clone().translate(shiftB) : dataB.bbox;
  const box = bboxA.clone().intersect(bboxB);
  if (box.isEmpty()) return 0;
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim <= 0) return 0;

  const step = maxDim / SAMPLE_RESOLUTION;
  const nx = Math.max(1, Math.round(size.x / step));
  const ny = Math.max(1, Math.round(size.y / step));
  const nz = Math.max(1, Math.round(size.z / step));

  let insideBoth = 0;
  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let iz = 0; iz < nz; iz++) {
        samplePoint.set(
          box.min.x + (ix + 0.5) / nx * size.x,
          box.min.y + (iy + 0.5) / ny * size.y,
          box.min.z + (iz + 0.5) / nz * size.z
        );
        const inA = shiftA
          ? isInside(dataA.bvh, shiftedPoint.copy(samplePoint).sub(shiftA), sampleDir, sampleRay)
          : isInside(dataA.bvh, samplePoint, sampleDir, sampleRay);
        if (!inA) continue;
        const inB = shiftB
          ? isInside(dataB.bvh, shiftedPoint.copy(samplePoint).sub(shiftB), sampleDir, sampleRay)
          : isInside(dataB.bvh, samplePoint, sampleDir, sampleRay);
        if (inB) insideBoth++;
      }
    }
  }
  const cellVolume = (size.x / nx) * (size.y / ny) * (size.z / nz);
  return insideBoth * cellVolume;
}

function overlapPctFor(dataA, dataB, shiftA, shiftB) {
  const bboxA = shiftA ? dataA.bbox.clone().translate(shiftA) : dataA.bbox;
  const bboxB = shiftB ? dataB.bbox.clone().translate(shiftB) : dataB.bbox;
  if (!bboxA.intersectsBox(bboxB)) return 0;
  const interVol = estimateIntersectionVolume(dataA, dataB, shiftA, shiftB);
  const denom = Math.min(dataA.volume, dataB.volume) || 1;
  return Math.min(100, (interVol / denom) * 100);
}

// Estimated % volume overlap for one screening unit. With `spacer` set, the
// spacer-affected side is dropped SPACER_DROP before measuring.
async function analyzePair(a, b, spacer = false) {
  const [dataA, dataB] = await Promise.all([loadPartData(a), loadPartData(b)]);
  if (!dataA.bvh || !dataB.bvh) return 0;
  const shifts = spacer ? spacerShifts(a.part, b.part) : null;
  return overlapPctFor(dataA, dataB, shifts ? shifts[0] : null, shifts ? shifts[1] : null);
}

// ---------------------------------------------------------------------------
// Scan orchestration
// ---------------------------------------------------------------------------

let currentThreshold = DEFAULT_THRESHOLD;
let scanning = false;

function statusForPct(pct) {
  return pct >= currentThreshold ? 'flagged' : 'auto_pass';
}

function recordResult({ a, b, spacer }, pct, decidedBy = 'auto') {
  const key = pairKey(a, b, spacer);
  // A rescan refreshes the geometry number for every non-fresh unit, but must
  // never silently flip a verdict a human set — keep the manual
  // status/decidedBy, just update the measurement underneath.
  const prev = state.pairs[key];
  const keepManual = prev && prev.decidedBy === 'manual';
  state.pairs[key] = {
    partA: a.part, fileA: a.file,
    partB: b.part, fileB: b.file,
    spacer: !!spacer,
    overlapPct: Number(pct.toFixed(1)),
    status: keepManual ? prev.status : statusForPct(pct),
    decidedBy: keepManual ? 'manual' : decidedBy,
    checkedAt: new Date().toISOString()
  };
  return key;
}

async function runScan(pairsToScan, { onDone } = {}) {
  if (scanning || !pairsToScan.length) return;
  scanning = true;
  setControlsDisabled(true);
  const progressWrap = document.getElementById('progressWrap');
  const progressFill = document.getElementById('progressFill');
  const progressLabel = document.getElementById('progressLabel');
  progressWrap.classList.remove('u-hidden');

  let done = 0;
  let lastRenderAt = 0;
  let lastSaveAt = Date.now();
  for (const unit of pairsToScan) {
    try {
      const pct = await analyzePair(unit.a, unit.b, unit.spacer);
      recordResult(unit, pct, 'auto');
    } catch (err) {
      console.error('Failed to analyze pair', unit, err);
    }
    done++;
    progressFill.style.width = `${(done / pairsToScan.length) * 100}%`;
    progressLabel.textContent = `${done} / ${pairsToScan.length}`;

    // Re-rendering the list on every single pair constantly replaces
    // whatever row is under the pointer, so a click mid-scan never lands —
    // the element gets swapped out from under it. Throttling to a fixed
    // cadence keeps the list glanceable during a long scan without making it
    // impossible to click.
    const now = performance.now();
    if (now - lastRenderAt > 600) {
      renderAll();
      lastRenderAt = now;
    }
    // Long scans (thousands of pairs) can run for minutes — autosave
    // periodically so a closed tab or crash doesn't lose all that work.
    if (Date.now() - lastSaveAt > 15000) {
      await persistState();
      lastSaveAt = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  progressWrap.classList.add('u-hidden');
  scanning = false;
  setControlsDisabled(false);
  renderAll();
  await persistState();
  if (onDone) onDone();
}

function setControlsDisabled(disabled) {
  ['scanNewBtn', 'rescanAutoBtn', 'thresholdInput'].forEach((id) => {
    document.getElementById(id).disabled = disabled;
  });
}

// ---------------------------------------------------------------------------
// UI: stats + list
// ---------------------------------------------------------------------------

let activeFilter = 'flagged';
let selectedKey = null;

function classify() {
  const decided = [], flagged = [], autoPass = [], fresh = [];
  for (const { a, b, spacer } of allPairs) {
    const key = pairKey(a, b, spacer);
    const entry = state.pairs[key];
    if (!entry) { fresh.push([key, a, b, spacer]); continue; }
    if (entry.decidedBy === 'manual') decided.push([key, entry]);
    else if (entry.status === 'flagged') flagged.push([key, entry]);
    else autoPass.push([key, entry]);
  }
  return { decided, flagged, autoPass, fresh };
}

function renderStats(groups) {
  const el = document.getElementById('stats');
  el.innerHTML = `
    <span><b>${allPairs.length}</b> total pairs</span>
    <span><b>${groups.fresh.length}</b> new</span>
    <span><b>${groups.flagged.length}</b> needs review</span>
    <span><b>${groups.autoPass.length}</b> auto-passed</span>
    <span><b>${groups.decided.length}</b> decided</span>
    <span title="arms↔bumper and hat↔top — already handled by hand-coded rules in scripts/app.js"><b>${skippedCategoryPairCount}</b> skipped (handled in app.js)</span>
  `;
}

function partLabel(f) { return `${f.part}: ${f.file}`; }

function renderList(groups) {
  const list = document.getElementById('pairList');
  let rows = [];
  if (activeFilter === 'new') {
    rows = groups.fresh.map(([key, a, b, spacer]) => ({ key, a, b, spacer, entry: null }));
  } else if (activeFilter === 'flagged') {
    rows = groups.flagged.map(([key, entry]) => ({ key, entry }));
  } else if (activeFilter === 'decided') {
    rows = groups.decided.map(([key, entry]) => ({ key, entry }));
  } else {
    rows = groups.autoPass.map(([key, entry]) => ({ key, entry }));
  }

  if (!rows.length) {
    list.innerHTML = `<li class="empty">Nothing here.</li>`;
    return;
  }

  list.innerHTML = rows.map(({ key, entry, a, b, spacer }) => {
    const partA = entry ? entry.partA : a.part, fileA = entry ? entry.fileA : a.file;
    const partB = entry ? entry.partB : b.part, fileB = entry ? entry.fileB : b.file;
    const withSpacer = entry ? !!entry.spacer : !!spacer;
    const pct = entry ? `${entry.overlapPct}%` : '—';
    const status = entry ? entry.status : 'new';
    const selected = key === selectedKey ? ' selected' : '';
    return `<li data-key="${key}" class="row${selected}">
      <div class="names">${partA}/${fileA} <span style="color:var(--text-dim)">×</span> ${partB}/${fileB}${withSpacer ? ' <span class="badge spacer-tag">+ spacer</span>' : ''}</div>
      <div class="meta"><span class="pct">${pct}</span><span class="badge ${status}">${status.replaceAll('_', ' ')}</span></div>
    </li>`;
  }).join('');
}

function renderAll() {
  const groups = classify();
  renderStats(groups);
  renderList(groups);
}

// ---------------------------------------------------------------------------
// UI: 3D viewer
// ---------------------------------------------------------------------------

let viewerScene, viewerCamera, viewerRenderer, viewerControls;
let viewerObjA = null, viewerObjB = null;
let viewerShowsSpacer = false; // whether the unit in the viewer is the "+ spacer" variant

function viewerYFor(part) {
  return (viewerShowsSpacer && SPACER_AFFECTED_PARTS.has(part)) ? MODEL_Y_OFFSET - SPACER_DROP : MODEL_Y_OFFSET;
}

function setupViewer() {
  const host = document.getElementById('viewerHost');
  viewerScene = new THREE.Scene();
  viewerScene.background = new THREE.Color(0x14171c);
  viewerCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
  viewerCamera.position.set(150, 150, 250);

  viewerRenderer = new THREE.WebGLRenderer({ antialias: true });
  host.appendChild(viewerRenderer.domElement);

  viewerControls = new OrbitControls(viewerCamera, viewerRenderer.domElement);
  viewerControls.target.set(0, MODEL_Y_OFFSET, 0);
  viewerControls.update();

  viewerScene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(200, 300, 200);
  viewerScene.add(dir);

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    viewerRenderer.setSize(w, h);
    viewerCamera.aspect = w / h;
    viewerCamera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();

  function tick() {
    requestAnimationFrame(tick);
    viewerControls.update();
    viewerRenderer.render(viewerScene, viewerCamera);
  }
  tick();
}

async function showPairInViewer(a, b, spacer = false) {
  if (viewerObjA) { viewerScene.remove(viewerObjA); viewerObjA = null; }
  if (viewerObjB) { viewerScene.remove(viewerObjB); viewerObjB = null; }
  document.getElementById('pairInfoText').textContent = `Loading ${partLabel(a)} + ${partLabel(b)}…`;

  const [gltfA, gltfB] = await Promise.all([loader.loadAsync(a.url), loader.loadAsync(b.url)]);
  viewerObjA = gltfA.scene;
  viewerObjB = gltfB.scene;
  viewerShowsSpacer = !!spacer;
  viewerObjA.position.y = viewerYFor(a.part);
  viewerObjB.position.y = viewerYFor(b.part);
  tintObject(viewerObjA, 0x4da3ff);
  tintObject(viewerObjB, 0xff8a4d);
  viewerScene.add(viewerObjA, viewerObjB);
}

function tintObject(root, colorHex) {
  root.traverse((node) => {
    if (!node.isMesh) return;
    node.material = new THREE.MeshStandardMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });
  });
}

// ---------------------------------------------------------------------------
// Selection + decisions
// ---------------------------------------------------------------------------

function findFileByKey(part, file) {
  return allFiles.find((f) => f.part === part && f.file === file);
}

async function selectPair(key) {
  selectedKey = key;
  renderAll();

  let a, b, spacer, entry = state.pairs[key];
  if (entry) {
    a = findFileByKey(entry.partA, entry.fileA);
    b = findFileByKey(entry.partB, entry.fileB);
    spacer = !!entry.spacer;
  } else {
    const found = classify().fresh.find(([k]) => k === key);
    if (!found) return;
    [, a, b, spacer] = found;
  }
  if (!a || !b) return;

  await showPairInViewer(a, b, spacer);

  const cfg = spacer
    ? ' <span style="color:var(--accent)">(with a spacer — bumper / arms / bottom / wheels dropped 16)</span>'
    : '';
  const pctText = entry ? `${entry.overlapPct}% estimated volume overlap` : 'not yet scanned';
  document.getElementById('pairInfoText').innerHTML =
    `<b>${partLabel(a)}</b> vs <b>${partLabel(b)}</b>${cfg} — ${pctText}`;

  const decideActions = document.getElementById('decideActions');
  decideActions.classList.remove('u-hidden');
  decideActions.dataset.a = JSON.stringify(a);
  decideActions.dataset.b = JSON.stringify(b);
  decideActions.dataset.spacer = spacer ? '1' : '';
}

function decide(status) {
  const decideActions = document.getElementById('decideActions');
  if (!decideActions.dataset.a) return;
  const a = JSON.parse(decideActions.dataset.a);
  const b = JSON.parse(decideActions.dataset.b);
  const spacer = decideActions.dataset.spacer === '1';
  const key = pairKey(a, b, spacer);
  const prevEntry = state.pairs[key];
  state.pairs[key] = {
    partA: a.part, fileA: a.file,
    partB: b.part, fileB: b.file,
    spacer,
    overlapPct: prevEntry ? prevEntry.overlapPct : 0,
    status,
    decidedBy: 'manual',
    checkedAt: new Date().toISOString()
  };
  renderAll();
  persistState();

  // Jump to the next flagged pair so a review pass can move through the
  // queue without going back to the list each time.
  if (activeFilter === 'flagged') {
    const next = classify().flagged.find(([k]) => k !== key);
    if (next) selectPair(next[0]);
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function wireUI() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      activeFilter = tab.dataset.filter;
      renderAll();
    });
  });

  document.getElementById('pairList').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-key]');
    if (!li) return;
    selectPair(li.dataset.key);
  });

  document.getElementById('thresholdInput').addEventListener('change', (e) => {
    const val = Number(e.target.value);
    if (!Number.isFinite(val) || val <= 0) return;
    currentThreshold = val;
    // Cheap in-memory reclassification of already-computed auto results —
    // no geometry work needed, just re-derive status from the stored pct.
    for (const entry of Object.values(state.pairs)) {
      if (entry.decidedBy !== 'auto') continue;
      entry.status = statusForPct(entry.overlapPct ?? 0);
    }
    renderAll();
    persistState();
  });

  document.getElementById('scanNewBtn').addEventListener('click', () => {
    const fresh = classify().fresh.map(([, a, b, spacer]) => ({ a, b, spacer }));
    runScan(fresh);
  });

  document.getElementById('rescanAutoBtn').addEventListener('click', () => {
    const groups = classify();
    // Decided units are included so a rescan refreshes their overlap number
    // too — recordResult() preserves the human verdict, it only updates the
    // measurement underneath.
    const units = [...groups.flagged, ...groups.autoPass, ...groups.decided]
      .map(([key, entry]) => ({
        a: findFileByKey(entry.partA, entry.fileA),
        b: findFileByKey(entry.partB, entry.fileB),
        spacer: !!entry.spacer
      }))
      .filter((u) => u.a && u.b);
    runScan(units);
  });

  document.getElementById('connectBtn').addEventListener('click', connectSaveFile);
  document.getElementById('downloadBtn').addEventListener('click', downloadState);

  document.getElementById('markCompatibleBtn').addEventListener('click', () => decide('compatible'));
  document.getElementById('markIncompatibleBtn').addEventListener('click', () => decide('incompatible'));
}

async function init() {
  await loadInitialState();
  currentThreshold = state.threshold || DEFAULT_THRESHOLD;
  document.getElementById('thresholdInput').value = currentThreshold;
  setupViewer();
  wireUI();
  await tryReconnectSavedHandle();
  renderAll();
}

init();
