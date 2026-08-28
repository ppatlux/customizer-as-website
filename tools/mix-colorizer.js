import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSET_MANIFEST } from '../scripts/asset-manifest.js';
import { PRESETS, normalizeMixPartColor } from '../scripts/presets.js';

// Mirrors COLOR_OPTIONS / DEFAULT_PART_COLOR in scripts/app.js — keep in sync.
const COLOR_OPTIONS = ['#231F20', '#549EF7', '#00D072', '#FFBD3B', '#A89EFA', '#CE4A4A', '#E6E6E6', '#FFFFFF'];
const DEFAULT_PART_COLOR = '#E6E6E6';

const MIX_COLORS_URL = '../assets/mix-colors.json';

// ---------------------------------------------------------------------------
// Manifest resolution (mirrors resolvePresetIndex in scripts/app.js)
// ---------------------------------------------------------------------------

function partEntry(part, filename) {
  const list = ASSET_MANIFEST[part] || [];
  return list.find((e) => e.file === filename) || list[0] || null;
}

function modelUrl(part, filename) {
  const entry = partEntry(part, filename);
  if (!entry) return null;
  if (entry.file !== filename) {
    console.warn(`Mix references unknown ${part} variant "${filename}" — using "${entry.file}".`);
  }
  return `../assets/models/${entry.folder}/${entry.file}`;
}

// Visible parts of a preset, in a stable order, as { part, url }.
function presetParts(key) {
  const preset = PRESETS[key];
  return Object.entries(preset.parts)
    .filter(([part]) => preset.visibility?.[part] && (ASSET_MANIFEST[part] || []).length)
    .map(([part, filename]) => ({ part, url: modelUrl(part, filename) }))
    .filter((p) => p.url);
}

// ---------------------------------------------------------------------------
// Colour model
// ---------------------------------------------------------------------------
// In memory, every authored part is { color: hex|null, meshes: { [idx]: hex } }.
// Loaded JSON is normalised into this shape; it's collapsed back to the compact
// form (bare string when only a whole-part colour) on save.

// { [presetKey]: { [part]: { color, meshes } } }
let mixColors = {};

function normalizeLoaded(raw) {
  const out = {};
  for (const [key, parts] of Object.entries(raw || {})) {
    out[key] = {};
    for (const [part, entry] of Object.entries(parts || {})) {
      out[key][part] = normalizeMixPartColor(entry);
    }
  }
  return out;
}

function collapseForSave() {
  const out = {};
  for (const [key, parts] of Object.entries(mixColors)) {
    const kobj = {};
    for (const [part, cfg] of Object.entries(parts)) {
      const base = cfg.color && cfg.color.toUpperCase() !== DEFAULT_PART_COLOR ? cfg.color.toUpperCase() : null;
      const meshKeys = Object.keys(cfg.meshes || {});
      if (!meshKeys.length) {
        if (base) kobj[part] = base;
      } else {
        const o = { meshes: {} };
        meshKeys.sort((a, b) => a - b).forEach((k) => { o.meshes[k] = cfg.meshes[k].toUpperCase(); });
        if (base) o.color = base;
        kobj[part] = o;
      }
    }
    if (Object.keys(kobj).length) out[key] = kobj;
  }
  return out;
}

function serialize() {
  return JSON.stringify(collapseForSave(), null, 2) + '\n';
}

function cfgFor(part) {
  if (!mixColors[currentKey]) mixColors[currentKey] = {};
  if (!mixColors[currentKey][part]) mixColors[currentKey][part] = { color: null, meshes: {} };
  return mixColors[currentKey][part];
}

function baseColor(part) {
  return mixColors[currentKey]?.[part]?.color || DEFAULT_PART_COLOR;
}

function meshColor(part, idx) {
  const cfg = mixColors[currentKey]?.[part];
  if (!cfg) return DEFAULT_PART_COLOR;
  return cfg.meshes?.[idx] || cfg.color || DEFAULT_PART_COLOR;
}

function paintedPieceCount(part) {
  return Object.keys(mixColors[currentKey]?.[part]?.meshes || {}).length;
}

function pruneMix() {
  for (const key of Object.keys(mixColors)) {
    for (const part of Object.keys(mixColors[key])) {
      const cfg = mixColors[key][part];
      if (!cfg.color && !Object.keys(cfg.meshes).length) delete mixColors[key][part];
    }
    if (!Object.keys(mixColors[key]).length) delete mixColors[key];
  }
}

function afterEdit(part) {
  pruneMix();
  if (part) retintPart(part);
  renderMixList();
  renderInspector();
  persist();
}

function setBase(part, hex) {
  const cfg = cfgFor(part);
  const H = hex.toUpperCase();
  cfg.color = H === DEFAULT_PART_COLOR ? null : H;
  // Drop per-piece overrides that now match the base — they'd be redundant.
  const base = cfg.color || DEFAULT_PART_COLOR;
  for (const k of Object.keys(cfg.meshes)) if (cfg.meshes[k] === base) delete cfg.meshes[k];
  afterEdit(part);
}

function setMesh(part, idx, hex) {
  const cfg = cfgFor(part);
  const H = hex.toUpperCase();
  const base = cfg.color || DEFAULT_PART_COLOR;
  if (H === base) delete cfg.meshes[idx];
  else cfg.meshes[idx] = H;
  afterEdit(part);
}

function resetPiece(part, idx) {
  const cfg = mixColors[currentKey]?.[part];
  if (cfg) delete cfg.meshes[idx];
  afterEdit(part);
}

function resetPart(part) {
  if (mixColors[currentKey]) delete mixColors[currentKey][part];
  afterEdit(part);
}

function resetMix() {
  delete mixColors[currentKey];
  for (const { part } of presetParts(currentKey)) retintPart(part);
  renderMixList();
  renderInspector();
  persist();
}

// ---------------------------------------------------------------------------
// Saved-file handle persistence (mirrors tools/compat-checker.js)
// ---------------------------------------------------------------------------

function dbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('mix-colorizer', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(k, v) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(v, k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(k) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readonly');
    const req = tx.objectStore('handles').get(k);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

let saveHandle = null;

async function tryReconnectSavedHandle() {
  if (!window.showSaveFilePicker) {
    setSaveStatus('File System Access API unavailable — use Download');
    return;
  }
  try {
    const handle = await idbGet('mixColorsFile');
    if (!handle) return;
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      saveHandle = handle;
      setSaveStatus('Autosave connected');
    } else {
      setSaveStatus('Click "Connect save file" to resume autosave');
    }
  } catch {
    // Handle no longer valid — ignore.
  }
}

async function connectSaveFile() {
  if (!window.showSaveFilePicker) {
    setSaveStatus('File System Access API unavailable — use Download');
    return;
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'mix-colors.json',
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
    });
    await idbSet('mixColorsFile', handle);
    saveHandle = handle;
    await persist();
    setSaveStatus('Autosave connected');
  } catch {
    // User cancelled — leave as-is.
  }
}

async function persist() {
  if (!saveHandle) return;
  try {
    const writable = await saveHandle.createWritable();
    await writable.write(serialize());
    await writable.close();
    setSaveStatus(`Saved ${new Date().toLocaleTimeString()}`);
  } catch (err) {
    console.error('Autosave failed', err);
    setSaveStatus('Autosave failed — use Download');
  }
}

function downloadJson() {
  const blob = new Blob([serialize()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mix-colors.json';
  a.click();
  URL.revokeObjectURL(url);
}

function setSaveStatus(text) {
  document.getElementById('saveStatus').textContent = text;
}

// ---------------------------------------------------------------------------
// Three.js viewer
// ---------------------------------------------------------------------------

let currentKey = null;
let selectedPart = null;
let selectedMesh = null; // active paint target: meshIndex within selectedPart, or null = whole part
let hoverMesh = null;    // meshIndex hovered in the piece list — temporarily boxed in 3D

// part -> { root: Object3D, meshes: Mesh[] } (meshes[i] has userData.meshIndex === i)
const loadedParts = new Map();

const host = document.getElementById('viewerHost');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
host.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyLight.position.set(100, 200, 100);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
fillLight.position.set(-100, -50, -100);
scene.add(fillLight);
const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
backLight.position.set(0, 150, -200);
scene.add(backLight);

let selectionBox = null;
const loader = new GLTFLoader();

function resize() {
  const w = host.clientWidth || 1;
  const h = host.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(host);

function selectionTarget() {
  if (!selectedPart || !loadedParts.has(selectedPart)) return null;
  const entry = loadedParts.get(selectedPart);
  const idx = hoverMesh != null ? hoverMesh : selectedMesh;
  if (idx == null) return entry.root;
  return entry.meshes[idx] || entry.root;
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  const target = selectionTarget();
  if (selectionBox && target) {
    selectionBox.visible = true;
    selectionBox.setFromObject(target);
  } else if (selectionBox) {
    selectionBox.visible = false;
  }
  renderer.render(scene, camera);
}
animate();

function frameScene() {
  const box = new THREE.Box3();
  let has = false;
  for (const { root } of loadedParts.values()) { box.expandByObject(root); has = true; }
  if (!has) return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const dist = (sphere.radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.4;
  const dir = new THREE.Vector3(0.7, 0.5, 1).normalize();
  camera.position.copy(sphere.center).addScaledVector(dir, dist);
  camera.near = Math.max(dist / 200, 0.5);
  camera.far = dist * 12;
  camera.updateProjectionMatrix();
  controls.target.copy(sphere.center);
  controls.minDistance = sphere.radius * 0.5;
  controls.maxDistance = dist * 4;
  controls.update();
}

function clearLoadedParts() {
  for (const { root } of loadedParts.values()) {
    scene.remove(root);
    root.traverse((n) => {
      if (!n.isMesh) return;
      n.geometry?.dispose();
      (Array.isArray(n.material) ? n.material : [n.material]).forEach((m) => m?.dispose());
    });
  }
  loadedParts.clear();
  if (selectionBox) {
    scene.remove(selectionBox);
    selectionBox.geometry.dispose();
    selectionBox.material.dispose();
    selectionBox = null;
  }
}

function retintPart(part) {
  const entry = loadedParts.get(part);
  if (!entry) return;
  entry.meshes.forEach((mesh, idx) => {
    const hex = meshColor(part, idx);
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => {
      if (m?.color) { m.color.set(hex); m.needsUpdate = true; }
    });
  });
}

async function selectMix(mixKey) {
  currentKey = mixKey;
  selectedPart = null;
  selectedMesh = null;
  hoverMesh = null;
  clearLoadedParts();
  renderMixList();
  renderInspector();
  document.getElementById('viewerHint').textContent = 'Loading…';

  const parts = presetParts(mixKey);
  const results = await Promise.allSettled(parts.map(({ url }) => loader.loadAsync(url)));
  if (currentKey !== mixKey) return; // superseded

  results.forEach((res, i) => {
    if (res.status !== 'fulfilled') {
      console.error('Failed to load', parts[i].url, res.reason);
      return;
    }
    const part = parts[i].part;
    const root = res.value.scene;
    root.userData.part = part;
    const meshes = [];
    root.traverse((n) => {
      if (!n.isMesh) return;
      n.userData.part = part;
      n.userData.meshIndex = meshes.length;
      meshes.push(n);
    });
    loadedParts.set(part, { root, meshes });
    scene.add(root);
    retintPart(part);
  });

  selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0x3d7fff);
  selectionBox.visible = false;
  scene.add(selectionBox);

  frameScene();
  document.getElementById('viewerHint').textContent = loadedParts.size ? '' : 'Nothing loaded';
  renderInspector();
}

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downXY = null;

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button === 0) downXY = [e.clientX, e.clientY];
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !downXY) return;
  const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]);
  downXY = null;
  if (moved > 4) return; // was an orbit drag, not a click

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const meshes = [];
  for (const { meshes: m } of loadedParts.values()) meshes.push(...m);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  if (!hit) return;

  selectedPart = hit.object.userData.part;
  selectedMesh = hit.object.userData.meshIndex; // clicking a piece in 3D selects it
  renderInspector();
});

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function renderMixList() {
  const nav = document.getElementById('mixList');
  nav.innerHTML = '';
  for (const [mixKey, preset] of Object.entries(PRESETS)) {
    const authored = mixColors[mixKey] ? Object.keys(mixColors[mixKey]).length : 0;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = mixKey === currentKey ? 'active' : '';
    btn.innerHTML = `${preset.label}${authored ? ' •' : ''}<span class="mix-desc">${preset.description}</span>`;
    btn.addEventListener('click', () => selectMix(mixKey));
    nav.appendChild(btn);
  }
}

function applyToSelection(hex) {
  if (!selectedPart) return;
  if (selectedMesh == null) setBase(selectedPart, hex);
  else setMesh(selectedPart, selectedMesh, hex);
}

function meshLabel(mesh, idx) {
  const name = (mesh.name || '').trim();
  return name ? name : `Piece ${idx}`;
}

// The "Whole part" row plus one clickable row per mesh of the selected part.
function renderTargetList() {
  const ul = document.getElementById('targetList');
  ul.innerHTML = '';
  const entry = selectedPart ? loadedParts.get(selectedPart) : null;
  if (!entry) return;

  const addRow = (label, hex, active, onClick, meshIdx) => {
    const li = document.createElement('li');
    if (active) li.className = 'active';
    li.innerHTML =
      `<span class="chip" style="background:${hex}"></span>` +
      `<span class="lbl">${label}</span>` +
      `<span class="val">${hex === DEFAULT_PART_COLOR ? 'default' : hex}</span>`;
    li.addEventListener('click', onClick);
    if (meshIdx !== undefined) {
      li.addEventListener('mouseenter', () => { hoverMesh = meshIdx; });
      li.addEventListener('mouseleave', () => { if (hoverMesh === meshIdx) hoverMesh = null; });
    }
    ul.appendChild(li);
  };

  addRow('Whole part', baseColor(selectedPart), selectedMesh == null, () => {
    selectedMesh = null;
    renderInspector();
  });

  entry.meshes.forEach((mesh, idx) => {
    const overridden = !!mixColors[currentKey]?.[selectedPart]?.meshes?.[idx];
    addRow(
      `${meshLabel(mesh, idx)}${overridden ? ' •' : ''}`,
      meshColor(selectedPart, idx),
      selectedMesh === idx,
      () => { selectedMesh = idx; renderInspector(); },
      idx
    );
  });
}

function renderInspector() {
  const info = document.getElementById('selectedInfo');
  const resetBtn = document.getElementById('resetTargetBtn');
  const entry = selectedPart ? loadedParts.get(selectedPart) : null;

  if (selectedPart && entry) {
    const pieces = entry.meshes.length;
    const painted = paintedPieceCount(selectedPart);
    info.classList.remove('muted');
    info.innerHTML =
      `<b style="text-transform:capitalize">${selectedPart}</b> — ${pieces} piece${pieces === 1 ? '' : 's'}` +
      `${painted ? `, ${painted} painted` : ''}`;

    if (selectedMesh == null) {
      resetBtn.textContent = 'Reset whole part';
      resetBtn.disabled = !mixColors[currentKey]?.[selectedPart];
    } else {
      resetBtn.textContent = `Reset "${meshLabel(entry.meshes[selectedMesh], selectedMesh)}"`;
      resetBtn.disabled = !mixColors[currentKey]?.[selectedPart]?.meshes?.[selectedMesh];
    }
  } else {
    info.classList.add('muted');
    info.textContent = 'Click a part in the view';
    resetBtn.textContent = 'Reset';
    resetBtn.disabled = true;
  }

  renderTargetList();

  const activeHex = selectedPart
    ? (selectedMesh == null ? baseColor(selectedPart) : meshColor(selectedPart, selectedMesh))
    : DEFAULT_PART_COLOR;
  document.getElementById('customColor').value = activeHex.toLowerCase();
  document.querySelectorAll('#swatches .swatch').forEach((sw) => {
    sw.disabled = !selectedPart;
    sw.classList.toggle('is-current', selectedPart && sw.dataset.hex === activeHex);
  });

  const list = document.getElementById('partColorList');
  list.innerHTML = '';
  if (!currentKey) return;
  for (const { part } of presetParts(currentKey)) {
    const hex = baseColor(part);
    const painted = paintedPieceCount(part);
    const li = document.createElement('li');
    if (hex === DEFAULT_PART_COLOR && !painted) li.className = 'is-default';
    if (part === selectedPart) li.classList.add('current-part');
    li.innerHTML =
      `<span class="chip" style="background:${hex}"></span>` +
      `<span style="text-transform:capitalize">${part}</span>` +
      `<span class="val">${hex === DEFAULT_PART_COLOR ? (painted ? '' : 'default') : hex}${painted ? ` +${painted}` : ''}</span>`;
    li.addEventListener('click', () => { selectedPart = part; selectedMesh = null; hoverMesh = null; renderInspector(); });
    list.appendChild(li);
  }
}

function buildSwatches() {
  const wrap = document.getElementById('swatches');
  for (const hex of COLOR_OPTIONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.hex = hex;
    b.style.background = hex;
    b.title = hex;
    b.disabled = true;
    b.addEventListener('click', () => applyToSelection(hex));
    wrap.appendChild(b);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function loadExisting() {
  try {
    const res = await fetch(MIX_COLORS_URL, { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      if (json && typeof json === 'object') mixColors = normalizeLoaded(json);
    }
  } catch {
    // No file yet — start empty.
  }
}

document.getElementById('customColor').addEventListener('input', (e) => applyToSelection(e.target.value));
document.getElementById('resetTargetBtn').addEventListener('click', () => {
  if (!selectedPart) return;
  if (selectedMesh == null) resetPart(selectedPart);
  else resetPiece(selectedPart, selectedMesh);
});
document.getElementById('resetMixBtn').addEventListener('click', resetMix);
document.getElementById('connectBtn').addEventListener('click', connectSaveFile);
document.getElementById('downloadBtn').addEventListener('click', downloadJson);

(async function boot() {
  buildSwatches();
  resize();
  await loadExisting();
  await tryReconnectSavedHandle();
  renderMixList();
  renderInspector();
  selectMix(Object.keys(PRESETS)[0]);
})();
