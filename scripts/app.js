import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSET_MANIFEST } from './asset-manifest.js';
import { SLICER_LABELS, getPreferredSlicer, setPreferredSlicer } from './slicer-preference.js';

const COLOR_OPTIONS = ['#231F20', '#549EF7', '#00D072', '#FFBD3B', '#A89EFA', '#CE4A4A', '#E6E6E6', '#FFFFFF'];
const PART_META = [
  { key: 'top', label: 'Top', panel: 'essential' },
  { key: 'hat', label: 'Hat', panel: 'essential' },
  { key: 'middle', label: 'Middle', panel: 'advanced' },
  { key: 'face', label: 'Face', panel: 'essential' },
  { key: 'spacer', label: 'Spacer', panel: 'advanced' },
  { key: 'arms', label: 'Arms', panel: 'advanced' },
  { key: 'bumper', label: 'Bumper', panel: 'essential' },
  { key: 'bottom', label: 'Bottom', panel: 'essential' },
  { key: 'wheels', label: 'Motion', panel: 'advanced' },
  { key: 'tail', label: 'Tail', panel: 'advanced', hidden: true }
];

const MODEL_Y_OFFSET = 30;
const STATE_KEY = 'hp_robot_customizer_state';
const TOUR_VERSION = 'standalone-v1';
const TOUR_STATE_KEY = 'hp_robot_tour_state';
const ADVANCED_DEFAULTS = new Set(['hat', 'arms', 'bumper', 'tail']);
const MODEL_VIEWER_SRC = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js';
const MODEL_VIEWER_INTEGRITY = 'sha384-Ftcjj/GNLxPvzNDftO/oryXB9aGxsGZY9JGqsXG0uUKgQDl9RfDgsx9NJ/4IVNPe';
const QRCODE_LIB_SRC = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
const QRCODE_LIB_INTEGRITY = 'sha384-3zSEDfvllQohrq0PHL1fOXJuC/jSOO34H46t6UQfobFOmxE5BpjjaIJY5F2/bMnU';
const MM_TO_M = 0.001;
// Small per-part lightness offsets always applied to the AR export (see
// exportVisiblePartsAsGlb) so adjacent parts never end up looking flat and
// indistinguishable under native AR's real-world lighting, regardless of
// what colors are actually in use.
const AR_TINT_OFFSETS = {
  top: 0.08, middle: -0.08, face: 0.14, bottom: -0.14, wheels: 0.20,
  hat: -0.20, arms: 0.11, bumper: -0.11, spacer: 0.17, tail: -0.17
};

const localModelSets = Object.fromEntries(
  Object.entries(ASSET_MANIFEST).map(([part, files]) => [
    part,
    files.map((entry) => `./assets/models/${entry.folder}/${entry.file}`)
  ])
);

const remoteModelSets = Object.fromEntries(
  Object.entries(ASSET_MANIFEST).map(([part, files]) => [
    part,
    files.map((entry) => entry.source)
  ])
);

const modelSets = localModelSets;

const stepSets = Object.fromEntries(
  Object.entries(localModelSets).map(([part, files]) => [part, files.map((file) => file.replace(/\.glb$/i, '.step'))])
);

const remoteStepSets = Object.fromEntries(
  Object.entries(remoteModelSets).map(([part, files]) => [part, files.map((file) => file.replace(/\.glb$/i, '.step'))])
);

// No STL is hosted yet for most current variants (checked: same file-naming
// scheme as .step/.glb, just not present). These candidate URLs exist so that
// the moment matching .stl files DO get uploaded alongside the .step/.glb ones,
// print/download start using them automatically — see firstExistingUrl(), which
// probes before falling back to STEP (print) or a client-side STLExporter
// export of the already-loaded model (download).
const stlSets = Object.fromEntries(
  Object.entries(localModelSets).map(([part, files]) => [part, files.map((file) => file.replace(/\.glb$/i, '.stl'))])
);

const remoteStlSets = Object.fromEntries(
  Object.entries(remoteModelSets).map(([part, files]) => [part, files.map((file) => file.replace(/\.glb$/i, '.stl'))])
);

const presets = {
  starter: {
    label: 'Basic',
    description: 'from Starter kit',
    parts: { top: 0, middle: 0, face: 0, bottom: 0, wheels: 0, hat: 0, arms: 1, bumper: 0, tail: 0, spacer: 0 },
    visibility: { top: true, middle: true, face: true, bottom: true, wheels: true, hat: false, arms: false, bumper: false, tail: false, spacer: false }
  },
  invent: {
    label: 'Walk & Roll',
    description: 'from Invent expansion',
    parts: { top: 14, middle: 7, face: 4, bottom: 0, wheels: 1, hat: 6, arms: 0, bumper: 0, tail: 0, spacer: 0 },
    visibility: { top: true, middle: true, face: true, bottom: true, wheels: true, hat: true, arms: true, bumper: false, tail: false, spacer: false }
  },
  sensor: {
    label: 'Formula 1',
    description: 'Vroom vroooom',
    parts: { top: 13, middle: 6, face: 9, bottom: 11, wheels: 1, hat: 4, arms: 0, bumper: 0, tail: 0, spacer: 0 },
    visibility: { top: true, middle: true, face: true, bottom: true, wheels: false, hat: true, arms: false, bumper: false, tail: false, spacer: false }
  },
  showtime: {
    label: 'Duck',
    description: 'Quack!',
    parts: { top: 2, middle: 1, face: 6, bottom: 2, wheels: 0, hat: 11, arms: 1, bumper: 0, tail: 0, spacer: 0 },
    visibility: { top: true, middle: true, face: true, bottom: true, wheels: true, hat: true, arms: true, bumper: false, tail: false, spacer: false }
  }
};

// The #part-map mini viewport's reference build — every visually-distinct part
// at once, so it doubles as a "here's everything you can customize" index even
// for parts hidden by default (hat/arms). Reuses "sensor" since it's the only
// preset with both hat and arms visible; swap the key for a different look.
const PART_MAP_PRESET_KEY = 'Walk & Roll';
const PART_MAP_PARTS = ['top', 'middle', 'face', 'bottom', 'wheels', 'hat', 'arms'];

// Per-part tint for the reference build, pulled from the customizer's own
// COLOR_OPTIONS ('#549EF7' blue, '#00D072' green, '#E6E6E6' silver) so the
// map's colors always match what's actually pickable.
const PART_MAP_TINTS = {
  hat: '#00D072',
  top: '#E6E6E6',
  middle: '#549EF7',
  face: '#549EF7',
  bottom: '#E6E6E6',
  wheels: '#549EF7',
  arms: '#549EF7'
};
// Blended toward the neutral base gray so the map reads as one cohesive
// object with a hint of color rather than a full-saturation preview.
const PART_MAP_TINT_STRENGTH = 0.35;

renderPanels();

const container = document.getElementById('viewer-container');
const toastStack = document.getElementById('toastStack');
const skeleton = document.getElementById('skeleton');
const appLoader = document.getElementById('app-loader');
const infoBtn = document.getElementById('infoBtn');
const infoTip = document.getElementById('info-tooltip');
const presetMenu = document.getElementById('preset-menu');
const presetToggle = document.getElementById('preset-toggle');
const presetButtons = Array.from(document.querySelectorAll('.preset-option[data-preset]'));
const presetLabelEl = document.getElementById('preset-active-label');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const resetBtn = document.getElementById('resetBtn');
const factoryResetBtn = document.getElementById('factoryResetBtn');
const randomizeBtn = document.getElementById('randomizeBtn');
const shareBtn = document.getElementById('shareBtn');
const arBtn = document.getElementById('arBtn');
const arOverlay = document.getElementById('ar-overlay');
const arClose = document.getElementById('ar-close');
const arTitle = document.getElementById('ar-title');
const arDesc = document.getElementById('ar-desc');
const arQrPanel = document.getElementById('ar-qr-panel');
const arQrHolder = document.getElementById('ar-qr-holder');
const arModelPanel = document.getElementById('ar-model-panel');
const arModelHost = document.getElementById('ar-model-host');
const variantGridPanel = document.getElementById('variant-grid-panel');
const variantGridClose = document.getElementById('variant-grid-close');
const variantGridTitle = document.getElementById('variant-grid-title');
const variantGridBody = document.getElementById('variant-grid-body');
const exitMaxBtn = document.getElementById('exit-maximize');
const dlMenu = document.getElementById('download-menu');
const dlPrimary = document.getElementById('download-primary');
const dlToggle = document.getElementById('download-toggle');
const dlGlbBtn = document.getElementById('downloadGlbBtn');
const dlStepBtn = document.getElementById('downloadStepBtn');
const moreToggle = document.getElementById('more-toggle');
const moreMenu = document.getElementById('more-menu');
const moreFactoryResetBtn = document.getElementById('moreFactoryResetBtn');
const moreDownloadStlBtn = document.getElementById('moreDownloadStlBtn');
const moreDownloadGlbBtn = document.getElementById('moreDownloadGlbBtn');
const moreDownloadStepBtn = document.getElementById('moreDownloadStepBtn');
const slicerToggle = document.getElementById('slicer-toggle');
const slicerMenu = document.getElementById('slicer-menu');
const slicerBadgeCurrent = document.getElementById('slicer-badge-current');
const essBtn = document.getElementById('show-essential');
const advBtn = document.getElementById('show-advanced');
const essPanel = document.getElementById('panel-essential');
const consentOverlay = document.getElementById('consent-overlay');
const consentCheckbox = document.getElementById('consent-checkbox');
const consentConfirm = document.getElementById('consent-confirm');
const consentCancel = document.getElementById('consent-cancel');

const loader = new GLTFLoader();
loader.setCrossOrigin('anonymous');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xecf4f9);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setClearColor(0xecf4f9);
renderer.shadowMap.enabled = true;
container.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
camera.position.set(-90, 100, 120);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.update();
controls.saveState();

if (isTouchLikeDevice()) {
  // PerspectiveCamera's fov is vertical, so at a fixed distance a narrow
  // (portrait) aspect ratio sees much less width than a wide (landscape) one
  // — the same tight distance that nicely fills a short landscape-phone
  // frame crops the model edge-to-edge on a narrow portrait one. Only
  // zoom in for landscape; portrait already has enough room at roughly the
  // desktop framing since the sheet there doesn't eat much vertical space.
  const initialAspect = (window.innerWidth || 1) / (window.innerHeight || 1);
  if (initialAspect >= 1) {
    // Landscape: desktop framing leaves the robot small and low in the frame
    // on a short viewport, made worse by the bottom sheet covering part of
    // it — zoom in and lift the look-at point into the body of the model.
    camera.position.set(-61, 68, 82);
    camera.lookAt(0, 15, 0);
    controls.target.set(0, 15, 0);
  } else {
    // Portrait: plenty of vertical room already: keep the desktop distance,
    // just lift the look-at point the same way for a better-centered frame.
    camera.position.set(-90, 100, 120);
    camera.lookAt(0, 15, 0);
    controls.target.set(0, 15, 0);
  }
  controls.update();
  controls.saveState();
}

const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyLight.position.set(100, 200, 100);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
fillLight.position.set(-100, -50, -100);
scene.add(fillLight);

const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
backLight.position.set(0, 150, -200);
scene.add(backLight);

scene.add(new THREE.AmbientLight(0xffffff, 0.45));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(500, 500),
  new THREE.ShadowMaterial({ opacity: 0.1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const currentIdx = {};
const loadedMods = {};
const loadGeneration = {};
const modelCols = {};
const partVis = {};
const activePops = new Map();
const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const occludedParts = new Set(['middle', 'bumper', 'tail', 'bottom', 'wheels']);

// Populated by loadCompatibilityMap() from assets/compatibility.json (built by
// tools/compat-checker.html). Stays null until that fetch resolves — every
// reader below treats null as "no rules yet" and fails open rather than
// blocking anything, since the file may not exist for a fresh checkout.
let compatibilityMap = null;

// part -> translucent red preview clone currently sitting in the scene (see
// toggleConflictGhost/refreshConflictBadges below). Declared up here rather
// than next to those functions because bootstrap() — called near the top of
// this module — synchronously reaches code that reads it (via the initial
// restore/preset pass calling refreshConflictBadges): a `const` declared
// further down would still be in its temporal dead zone at that point.
const activeGhosts = {};

let activePresetKey = 'starter';
let isApplyingPreset = false;
let restoredFromLocal = false;
let openPalette = null;
let openPaletteOriginalParent = null;
let __isMaximized = false;
let __scrollYBeforeMax = 0;
let consentResolve = null;
let consentReject = null;
let tourRunning = false;
let pendingInitialLoads = 0;
let appLoaderHidden = false;
let mobileLayoutActive = false;
let mobileSheetEl = null;
let mobileSheetHandleEl = null;
let renderingPaused = false;
let openVariantGridPart = null;
let thumbRenderer3D = null;
// Set by setupPartMap() once it's running — lets adjustControlsWidth() (which
// knows nothing about the part-map) notify it that the side panel's width may
// have changed, so the map's minimum size can follow. Stays null on touch
// devices, where the part-map never gets set up at all.
let partMapWidthSync = null;
const variantThumbCache = {};
const variantThumbPromises = {};
const pickerHSV = {};

for (const part of Object.keys(modelSets)) {
  currentIdx[part] = 0;
  modelCols[part] = new THREE.Color('#d9d9d9');
  partVis[part] = !ADVANCED_DEFAULTS.has(part);
}
partVis.spacer = false;

bootstrap();

function renderPanels() {
  const essential = document.getElementById('panel-essential');
  essential.innerHTML = PART_META.map(renderPartSection).join('');
}

function renderPartSection(part) {
  const swatches = COLOR_OPTIONS.map((color) => {
    const whiteClass = color === '#FFFFFF' ? ' white' : '';
    return `<div class="color-swatch${whiteClass}" data-role="swatch" data-part="${part.key}" data-color="${color}" title="${color}"></div>`;
  }).join('');

  const palette = `
    <div class="color-swatch-grid">${swatches}</div>
    <div class="color-picker-advanced">
      <div class="color-picker-sv" data-role="picker-sv" data-part="${part.key}">
        <div class="color-picker-sv-thumb" data-role="picker-sv-thumb"></div>
      </div>
      <div class="color-picker-hue" data-role="picker-hue" data-part="${part.key}">
        <div class="color-picker-hue-thumb" data-role="picker-hue-thumb"></div>
      </div>
      <div class="color-picker-hex-row">
        <span class="color-picker-preview" data-role="picker-preview"></span>
        <span class="color-picker-hash">#</span>
        <input type="text" class="color-picker-hex" data-role="picker-hex" data-part="${part.key}" maxlength="6" spellcheck="false" autocomplete="off" aria-label="Hex color for ${part.label}">
      </div>
    </div>
  `;

  return `
    <div class="model-section" id="${part.key}-controls" data-panel="${part.panel}"${part.hidden ? ' style="display:none"' : ''}>
      <div class="model-controls-row">
        <button class="btn btn--sm btn--ghost" data-role="prev" data-part="${part.key}" aria-label="Previous ${part.label}">
          <span class="material-icons">chevron_left</span>
        </button>
        <button type="button" class="model-label" data-role="variant-grid" data-part="${part.key}" aria-haspopup="grid" aria-label="Browse all ${part.label} variants">
          ${part.label}
          <span class="conflict-indicator u-hidden" id="${part.key}-conflict" data-role="conflict-badge" data-part="${part.key}" aria-label="${part.label} conflict">
            <span class="material-icons">warning</span>
          </span>
          <span class="variant-counter" id="${part.key}-counter" aria-live="polite">-/ -</span>
        </button>
        <button class="btn btn--sm btn--ghost" data-role="next" data-part="${part.key}" aria-label="Next ${part.label}">
          <span class="material-icons">chevron_right</span>
        </button>
      </div>
      <div class="pill-container">
        <div class="color-pill" id="${part.key}-pill" data-role="color-pill" data-part="${part.key}" title="Pick color for ${part.label}"></div>
        <button class="btn btn--sm btn--ghost" id="${part.key}-visibility" data-role="visibility" data-part="${part.key}" aria-label="Toggle visibility for ${part.label}">
          <span class="material-icons">visibility</span>
        </button>
        <button class="btn btn--sm btn--ghost" data-role="print" data-part="${part.key}" title="Print part" aria-label="Open ${part.label} in OrcaSlicer">
          <span class="material-icons">print</span>
        </button>
        <button class="btn btn--sm btn--ghost" data-role="download-part" data-part="${part.key}" title="Download STL" aria-label="Download ${part.label} STL file">
          <span class="material-icons">file_download</span>
        </button>
      </div>
      ${part.key === 'top' ? `
      <button class="top-engrave-btn" data-role="engrave" data-part="${part.key}" aria-label="Open engraving tool for ${part.label}">
        <span class="material-icons">draw</span>
        <span>Engrave Blank Top</span>
      </button>
      ` : ''}
      <div class="color-palette" id="${part.key}-palette" role="menu" aria-label="Color palette for ${part.label}">
        ${palette}
      </div>
    </div>
  `;
}

function bootstrap() {
  if (location.protocol === 'file:') {
    toast('Use a local web server for the best results. Some browsers block local file loading.', 'warn', 5000);
  }

  loadCompatibilityMap();

  // Safety net: never leave a user staring at the splash forever if a model
  // request hangs (flaky connection, blocked CDN, etc.) instead of erroring.
  setTimeout(hideAppLoader, 12000);

  setupResize();
  setupConsentPopup();
  setupInfo();
  setupFullscreen();
  setupPresetMenu();
  setupPanels();
  setupDownloadMenu();
  setupMoreMenu();
  setupSlicerMenu();
  setupPaletteWiring();
  setupColorPickerDrag();
  setupColorPickerHexInput();
  setupVariantGrid();
  // Hidden by CSS on touch devices (see #part-map's pointer:coarse rule) — skip
  // loading its extra GLBs and starting its render loop there entirely.
  if (!isTouchLikeDevice()) setupPartMap();
  setupKeyboardNav();
  setupGlobalClickHandler();
  setupArPreview();
  if (isTouchLikeDevice()) setupMobileSheet();
  populatePresetMenu();

  const restoredFromShareLink = tryRestoreFromUrl();
  if (!restoredFromShareLink) tryRestoreFromLocal();

  if (restoredFromLocal) {
    // applySavedState() (called by the two restore attempts above) only sets
    // currentIdx/partVis/modelCols — it doesn't load anything itself, so the
    // restored indices still need an explicit load pass here.
    for (const part of Object.keys(modelSets)) {
      if (part === 'spacer' && !partVis.spacer) continue;
      loadModel(part);
    }
    setPresetLabel('Custom mix');
    syncPresetButtons('');
    updateAllCounters();
    updateComboChip();
    saveStateToLocal();
    if (restoredFromShareLink) toast('Loaded shared build', 'ok', 1800);
  } else {
    // No saved/shared state: applyPreset() already loads every part it
    // touches, so this is the only load pass a fresh visit needs. (A prior
    // version also ran the loop above unconditionally first, which meant
    // every part's model was fetched twice on first paint — once here at
    // its default index, once more milliseconds later from applyPreset,
    // since loadedMods was still empty when applyPreset's own "already
    // loaded?" check ran. Harmless on a fast connection, but on a slow or
    // flaky one it doubled the odds that one of a part's two identical
    // in-flight requests failed — and since only the later-dispatched
    // request's response is kept, that could discard the copy that
    // actually succeeded and leave the part missing.)
    applyPreset('starter', false);
  }

  initPillsAndButtons();
  adjustControlsWidth();
  animate();
  maybeAutostartTour();
  saveStateToLocal();
}

function setupResize() {
  function onResize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    adjustControlsWidth();
    reallyClosePalette();
  }

  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('orientationchange', onResize, { passive: true });
  setTimeout(onResize, 50);
}

function setupConsentPopup() {
  if (consentCheckbox && consentConfirm) {
    consentCheckbox.addEventListener('change', (event) => {
      consentConfirm.disabled = !event.target.checked;
    });
  }

  consentConfirm?.addEventListener('click', () => {
    const resolve = consentResolve;
    hideConsentPopup();
    if (resolve) resolve();
  });

  consentCancel?.addEventListener('click', () => {
    const reject = consentReject;
    hideConsentPopup();
    if (reject) reject(new Error('User cancelled'));
  });

  consentOverlay?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const reject = consentReject;
      hideConsentPopup();
      if (reject) reject(new Error('User cancelled'));
    }
  });
}

function showConsentPopup() {
  return new Promise((resolve, reject) => {
    consentResolve = resolve;
    consentReject = reject;
    if (consentCheckbox) consentCheckbox.checked = false;
    if (consentConfirm) consentConfirm.disabled = true;
    reallyClosePalette();
    closeDlMenu();
    closeMoreMenu();
    closePresetMenu();
    consentOverlay.classList.add('show');
    consentOverlay.focus();
  });
}

function hideConsentPopup() {
  consentOverlay.classList.remove('show');
  consentResolve = null;
  consentReject = null;
}

function setupInfo() {
  let tipTimeout = null;

  function showInfoTip() {
    mountFloatingPopup(infoTip);
    infoTip.style.display = 'block';
    positionFloatingPopup(infoTip, infoBtn.getBoundingClientRect(), 'left');
    infoBtn.setAttribute('aria-expanded', 'true');
  }

  function hideInfoTip() {
    infoTip.style.display = 'none';
    infoBtn.setAttribute('aria-expanded', 'false');
  }

  infoBtn.addEventListener('mouseenter', () => {
    clearTimeout(tipTimeout);
    showInfoTip();
  });
  infoBtn.addEventListener('mouseleave', () => {
    tipTimeout = setTimeout(hideInfoTip, 180);
  });
  infoTip.addEventListener('mouseenter', () => clearTimeout(tipTimeout));
  infoTip.addEventListener('mouseleave', hideInfoTip);

  // Touch devices have no hover, so tapping the info button toggles the tip directly.
  infoBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    clearTimeout(tipTimeout);
    if (infoTip.style.display === 'block') hideInfoTip();
    else showInfoTip();
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest('#info-container')) return;
    // Reparented to the top-level host while open (see mountFloatingPopup),
    // so it's no longer a descendant of #info-container — needs its own check.
    if (event.target.closest('#info-tooltip')) return;
    hideInfoTip();
  });

  document.getElementById('startTourLink')?.addEventListener('click', (event) => {
    event.preventDefault();
    startTour(true);
  });
}

function setupFullscreen() {
  function inNativeFullscreen() {
    return Boolean(document.fullscreenElement);
  }

  function supportsNativeFullscreen() {
    return Boolean(container.requestFullscreen) && document.fullscreenEnabled !== false;
  }

  async function enterNativeFullscreen() {
    try {
      await container.requestFullscreen();
    } catch {
      enterMaximize();
      toast('Fullscreen not available here, using maximize mode.', 'warn', 1800);
    }
  }

  function exitNativeFullscreen() {
    try { document.exitFullscreen?.(); } catch {}
  }

  function updateFullscreenUI() {
    const active = inNativeFullscreen() || __isMaximized;
    fullscreenBtn.innerHTML = `<span class="material-icons">${active ? 'fullscreen_exit' : 'fullscreen'}</span>`;
    fullscreenBtn.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
    fullscreenBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  function enterMaximize() {
    if (__isMaximized) return;
    reallyClosePalette();
    closeDlMenu();
    closeMoreMenu();
    closePresetMenu();
    __scrollYBeforeMax = window.scrollY || 0;
    document.body.classList.add('hp-lock-scroll');
    container.classList.add('is-maximized');
    __isMaximized = true;
    updateFullscreenUI();
  }

  function exitMaximize() {
    if (!__isMaximized) return;
    container.classList.remove('is-maximized');
    document.body.classList.remove('hp-lock-scroll');
    window.scrollTo({ top: __scrollYBeforeMax, left: 0 });
    __isMaximized = false;
    updateFullscreenUI();
  }

  fullscreenBtn.addEventListener('click', () => {
    if (__isMaximized) {
      exitMaximize();
      return;
    }
    if (inNativeFullscreen()) {
      exitNativeFullscreen();
      return;
    }
    if (supportsNativeFullscreen()) {
      enterNativeFullscreen();
      return;
    }
    enterMaximize();
  });

  exitMaxBtn?.addEventListener('click', exitMaximize);
  document.addEventListener('fullscreenchange', () => {
    reallyClosePalette();
    closeDlMenu();
    closeMoreMenu();
    closePresetMenu();
    updateFullscreenUI();
  });

  updateFullscreenUI();
}

function setupPresetMenu() {
  presetToggle?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (presetMenu.classList.contains('open')) closePresetMenu();
    else openPresetMenu();
  });

  presetButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const key = button.dataset.preset;
      if (key) applyPreset(key);
      closePresetMenu();
    });
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('#preset-menu')) return;
    closePresetMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePresetMenu();
  });
}

function setupPanels() {
  essBtn.addEventListener('click', showEssentialPanel);
  advBtn.addEventListener('click', showAdvancedPanel);
}

function showEssentialPanel() {
  essPanel.classList.add('hide-advanced');
  essPanel.setAttribute('aria-labelledby', 'show-essential');
  essBtn.classList.add('active');
  advBtn.classList.remove('active');
  essBtn.setAttribute('aria-selected', 'true');
  advBtn.setAttribute('aria-selected', 'false');
  reallyClosePalette();
  if (mobileLayoutActive) setMobileSheetState('expanded');
}

// "Advanced" shows every part, essential ones included, in the same single
// list — see the single #panel-essential container (renderPanels) and the
// .hide-advanced modifier toggled here instead of swapping between two
// separate panels.
function showAdvancedPanel() {
  essPanel.classList.remove('hide-advanced');
  essPanel.setAttribute('aria-labelledby', 'show-advanced');
  advBtn.classList.add('active');
  essBtn.classList.remove('active');
  advBtn.setAttribute('aria-selected', 'true');
  essBtn.setAttribute('aria-selected', 'false');
  reallyClosePalette();
  if (mobileLayoutActive) setMobileSheetState('expanded');
}

// Picking an advanced-only part (Hat/Arms/Spacer/Bumper) while still on the
// Essential tab is confusing otherwise — the build changes but the essential-
// only list never shows that row. Jump to Advanced, which shows every part
// (see showAdvancedPanel), so it's visible either way. The reverse switch
// isn't needed: Advanced already includes every essential part too, so
// picking one while on Advanced has nothing to jump to.
function switchToPartPanel(part) {
  const panel = PART_META.find((meta) => meta.key === part)?.panel;
  if (panel === 'advanced' && !advBtn.classList.contains('active')) showAdvancedPanel();
}

// focusPart: which part's row peek should land on. Omit for "top of list"
// (e.g. opening the sheet fresh); pass a part key after interacting with it
// (variant/color change) so peek keeps showing that same part instead of
// always jumping back to the first one.
function setMobileSheetState(state, focusPart) {
  if (!mobileSheetEl) return;
  const listHost = document.getElementById('mobile-sheet-list');
  const row = focusPart ? document.getElementById(`${focusPart}-controls`) : null;

  if (row && listHost) {
    // Without this, the list keeps whatever scroll offset it had before —
    // collapsing back to peek without a focus part could show a random
    // mid-scroll slice of some part's card with its label and prev/next
    // arrows scrolled out of view above it, looking like a rendering bug.
    //
    // .mobile-sheet has `transition:height`, so simply flipping data-state
    // and then reading geometry measures a layout that's still mid-animation
    // toward its target height, not the final one — computing a scroll
    // offset against the wrong reference frame. Suspend the transition,
    // force a synchronous reflow so the *final* target layout is what gets
    // measured, then restore animation for the next (manual) toggle.
    mobileSheetEl.style.transition = 'none';
    mobileSheetEl.dataset.state = state;
    mobileSheetHandleEl?.setAttribute('aria-expanded', String(state === 'expanded'));
    void mobileSheetEl.offsetHeight; // force reflow at the new, final height
    const rowRect = row.getBoundingClientRect();
    const listRect = listHost.getBoundingClientRect();
    listHost.scrollTop += rowRect.top - listRect.top;
    requestAnimationFrame(() => { mobileSheetEl.style.transition = ''; });
    return;
  }

  mobileSheetEl.dataset.state = state;
  mobileSheetHandleEl?.setAttribute('aria-expanded', String(state === 'expanded'));
  if (listHost) listHost.scrollTop = 0;
}

function toggleMobileSheet() {
  if (!mobileSheetEl) return;
  setMobileSheetState(mobileSheetEl.dataset.state === 'expanded' ? 'peek' : 'expanded');
}

// Moves the real #info-container and the #panel-essential .model-controls
// panel into the mobile bottom sheet instead of rendering separate copies —
// every existing control (color pills, palettes, counters, the more/download
// menus...) keeps working with zero duplicated logic, it just lives in a new
// DOM location.
function setupMobileSheet() {
  mobileSheetEl = document.getElementById('mobile-sheet');
  mobileSheetHandleEl = document.getElementById('mobile-sheet-handle');
  const listHost = document.getElementById('mobile-sheet-list');
  const actionsHost = document.getElementById('mobile-sheet-actions');
  const infoContainerEl = document.getElementById('info-container');

  if (!mobileSheetEl || !mobileSheetHandleEl || !listHost || !actionsHost || !infoContainerEl) return;

  mobileLayoutActive = true;
  listHost.appendChild(essPanel);
  actionsHost.appendChild(infoContainerEl);

  let dragStartY = null;
  let dragMoved = false;

  mobileSheetHandleEl.addEventListener('click', () => {
    if (dragMoved) {
      dragMoved = false;
      return;
    }
    toggleMobileSheet();
  });

  mobileSheetHandleEl.addEventListener('touchstart', (event) => {
    dragStartY = event.touches[0].clientY;
    dragMoved = false;
  }, { passive: true });

  mobileSheetHandleEl.addEventListener('touchmove', (event) => {
    if (dragStartY === null) return;
    if (Math.abs(event.touches[0].clientY - dragStartY) > 10) dragMoved = true;
  }, { passive: true });

  mobileSheetHandleEl.addEventListener('touchend', (event) => {
    if (dragStartY === null) return;
    const endY = event.changedTouches[0]?.clientY ?? dragStartY;
    const deltaY = endY - dragStartY;
    dragStartY = null;
    if (deltaY < -30) setMobileSheetState('expanded');
    else if (deltaY > 30) setMobileSheetState('peek');
    // small movement or none: the click listener above handles it as a tap
  });

  // Tapping the 3D viewer itself (not the sheet) collapses an expanded sheet,
  // handing the view back to the model without needing the handle.
  container.addEventListener('pointerdown', (event) => {
    if (mobileSheetEl.dataset.state !== 'expanded') return;
    if (event.target.closest('#mobile-sheet')) return;
    // A color palette (and other floating popups — variant grid, info tip,
    // more menu) is deliberately reparented OUT of #mobile-sheet into
    // `container`/`document.body` while open (mountPaletteToBody,
    // mountVariantGridPanel, mountFloatingPopup), so it doesn't get clipped
    // by the sheet's overflow/stacking context — but that means a tap inside
    // one of these looks identical to a tap on the bare 3D viewer here.
    // Without this check, tapping a swatch or a variant thumbnail collapses
    // the sheet (mutating its height via CSS transition) on pointerdown,
    // i.e. while the finger is still down — and mutating layout mid-touch is
    // a common trigger for mobile browsers to cancel the gesture
    // (touchcancel instead of touchend) instead of completing it, silently
    // dropping the tap.
    if (event.target.closest('.color-palette, .variant-grid-panel, #info-tooltip, #more-menu')) return;
    setMobileSheetState('peek');
  });

  setMobileSheetState('peek');
}

function setupDownloadMenu() {
  dlPrimary.addEventListener('click', (event) => {
    event.preventDefault();
    downloadSelectionStl();
  });

  dlToggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (dlMenu.style.display === 'block') closeDlMenu();
    else openDlMenu();
  });

  dlGlbBtn.addEventListener('click', (event) => {
    event.preventDefault();
    downloadSelection('glb');
    closeDlMenu();
  });

  dlStepBtn.addEventListener('click', (event) => {
    event.preventDefault();
    downloadSelection('step');
    closeDlMenu();
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('#download-group')) return;
    closeDlMenu();
  });
}

// Mobile-only overflow menu standing in for factoryResetBtn + #download-group,
// which are hidden on touch devices (see .action-desktop-cluster in app.css).
// Reuses the exact same underlying actions, just behind one combined button.
function setupMoreMenu() {
  if (!moreToggle) return;

  moreToggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (moreMenu.classList.contains('open')) closeMoreMenu();
    else openMoreMenu();
  });

  moreFactoryResetBtn.addEventListener('click', () => {
    closeMoreMenu();
    resetToFactory();
  });
  moreDownloadStlBtn.addEventListener('click', () => {
    closeMoreMenu();
    downloadSelectionStl();
  });
  moreDownloadGlbBtn.addEventListener('click', () => {
    closeMoreMenu();
    downloadSelection('glb');
  });
  moreDownloadStepBtn.addEventListener('click', () => {
    closeMoreMenu();
    downloadSelection('step');
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('#more-group')) return;
    // Reparented to the top-level host while open (see mountFloatingPopup),
    // so it's no longer a descendant of #more-group — needs its own check.
    if (event.target.closest('#more-menu')) return;
    closeMoreMenu();
  });
}

function openMoreMenu() {
  mountFloatingPopup(moreMenu);
  moreMenu.classList.add('open');
  positionFloatingPopup(moreMenu, moreToggle.getBoundingClientRect(), 'right');
  moreToggle.setAttribute('aria-expanded', 'true');
}

function closeMoreMenu() {
  if (!moreMenu) return;
  moreMenu.classList.remove('open');
  moreToggle.setAttribute('aria-expanded', 'false');
}

function setupSlicerMenu() {
  updateSlicerUi();

  slicerToggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (slicerMenu.style.display === 'block') closeSlicerMenu();
    else openSlicerMenu();
  });

  slicerMenu.querySelectorAll('.slicer-menu-item').forEach((item) => {
    item.addEventListener('click', (event) => {
      event.preventDefault();
      setPreferredSlicer(item.dataset.slicer);
      updateSlicerUi();
      closeSlicerMenu();
    });
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('#slicer-group')) return;
    closeSlicerMenu();
  });
}

function openSlicerMenu() {
  slicerMenu.style.display = 'block';
  slicerToggle.setAttribute('aria-expanded', 'true');
}

function closeSlicerMenu() {
  slicerMenu.style.display = 'none';
  slicerToggle.setAttribute('aria-expanded', 'false');
}

function updateSlicerUi() {
  const slicer = getPreferredSlicer();
  const label = SLICER_LABELS[slicer];
  slicerBadgeCurrent.textContent = slicer === 'prusa' ? 'P' : 'O';
  slicerBadgeCurrent.dataset.slicer = slicer;
  slicerToggle.title = `Preferred slicer: ${label}`;
  slicerToggle.setAttribute('aria-label', `Preferred slicer: ${label}`);

  slicerMenu.querySelectorAll('.slicer-menu-item').forEach((item) => {
    item.setAttribute('aria-checked', String(item.dataset.slicer === slicer));
  });
}

function setupPaletteWiring() {
  document.querySelectorAll('[data-role="color-pill"]').forEach((pill) => {
    pill.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      const part = pill.getAttribute('data-part');
      const palette = document.getElementById(`${part}-palette`);
      if (!palette) return;

      if (openPalette === palette && palette.classList.contains('open')) {
        reallyClosePalette();
        return;
      }

      reallyClosePalette();
      if (openVariantGridPart) closeVariantGrid();
      mountPaletteToBody(palette);
      positionPalette(palette, pill.getBoundingClientRect());
      openPalette = palette;
      syncColorPickerUI(part);
    });
  });

  document.addEventListener('pointerup', (event) => {
    const swatch = event.target.closest('.color-palette [data-role="swatch"]');
    if (!swatch) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const part = swatch.dataset.part;
    const hex = swatch.dataset.color;
    applyLiveColor(part, hex);
    markCustomPreset();
    reallyClosePalette();
    // Same as changing a variant — collapse back to the model with this part
    // still front and center in peek instead of leaving the sheet expanded.
    if (mobileLayoutActive) setMobileSheetState('peek', part);
  }, { passive: false });

  document.addEventListener('click', (event) => {
    if (event.target.closest('.color-palette')) return;
    if (event.target.closest('[data-role="color-pill"]')) return;
    reallyClosePalette();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') reallyClosePalette();
  });

  window.addEventListener('scroll', () => reallyClosePalette(), { passive: true, capture: true });
}

// Applies a color to the model, pill, and preview immediately (cheap — used both
// for the final pick and for every intermediate tick while dragging the hue/SV
// picker). Does NOT mark the preset as custom or persist to localStorage — that
// only happens once, on drag release / swatch pick / committed hex entry, so a
// fast drag doesn't hammer localStorage.setItem on every pointermove.
function applyLiveColor(part, hex) {
  if (!partVis[part]) enablePart(part, false);
  modelCols[part].set(hex);
  applyColor(part);

  const pill = document.getElementById(`${part}-pill`);
  if (pill) {
    pill.style.backgroundColor = hex;
    pill.style.border = hex.toLowerCase() === '#ffffff' ? '1px solid #000' : '1px solid var(--stroke)';
  }
}

function hsvToHex(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

// THREE.Color's own .r/.g/.b are in linear working space (color management
// converts sRGB hex -> linear on .set()), not the sRGB values rgbToHsv/hsvToHex
// work in — reading them directly silently reinterprets the color, drifting it
// every time the picker re-syncs (e.g. on reopen). getHexString() already does
// the correct linear -> sRGB conversion, so route through that instead.
function colorToHsv(color) {
  const hex = color.getHexString();
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  return rgbToHsv(r, g, b);
}

// Re-derives the picker's h/s/v from the part's current color — called whenever
// the palette opens, so the picker always reflects reality even if the color was
// last changed some other way (preset, randomize, share-link restore, a swatch).
function syncColorPickerUI(part) {
  const color = modelCols[part];
  if (!color) return;
  pickerHSV[part] = colorToHsv(color);
  renderColorPickerUI(part);
}

function renderColorPickerUI(part) {
  const palette = document.getElementById(`${part}-palette`);
  if (!palette) return;
  const { h, s, v } = pickerHSV[part] || { h: 0, s: 0, v: 1 };
  const hueHex = hsvToHex(h, 1, 1);

  const sv = palette.querySelector('[data-role="picker-sv"]');
  const svThumb = palette.querySelector('[data-role="picker-sv-thumb"]');
  const hueThumb = palette.querySelector('[data-role="picker-hue-thumb"]');
  const hexInput = palette.querySelector('[data-role="picker-hex"]');
  const preview = palette.querySelector('[data-role="picker-preview"]');

  if (sv) sv.style.setProperty('--picker-hue', hueHex);
  if (svThumb) {
    svThumb.style.left = `${s * 100}%`;
    svThumb.style.top = `${(1 - v) * 100}%`;
  }
  if (hueThumb) {
    hueThumb.style.left = `${(h / 360) * 100}%`;
    hueThumb.style.background = hueHex;
  }

  const currentHex = hsvToHex(h, s, v).slice(1).toUpperCase();
  // Never stomp the input while the user is actively typing in it.
  if (hexInput && document.activeElement !== hexInput) hexInput.value = currentHex;
  if (preview) preview.style.background = `#${currentHex}`;
}

function setupColorPickerDrag() {
  document.addEventListener('pointerdown', (event) => {
    const track = event.target.closest('[data-role="picker-sv"], [data-role="picker-hue"]');
    if (!track) return;
    const isSv = track.matches('[data-role="picker-sv"]');
    const part = track.dataset.part;
    if (!part) return;

    event.preventDefault();
    track.setPointerCapture(event.pointerId);
    if (!partVis[part]) enablePart(part, false);
    if (!pickerHSV[part]) pickerHSV[part] = colorToHsv(modelCols[part]);
    const state = pickerHSV[part];

    const update = (clientX, clientY) => {
      const rect = track.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      if (isSv) {
        const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
        state.s = x;
        state.v = 1 - y;
      } else {
        state.h = x * 360;
      }
      renderColorPickerUI(part);
      applyLiveColor(part, hsvToHex(state.h, state.s, state.v));
    };

    update(event.clientX, event.clientY);

    const onMove = (moveEvent) => update(moveEvent.clientX, moveEvent.clientY);
    const onUp = () => {
      track.removeEventListener('pointermove', onMove);
      track.removeEventListener('pointerup', onUp);
      track.removeEventListener('pointercancel', onUp);
      markCustomPreset();
    };
    track.addEventListener('pointermove', onMove);
    track.addEventListener('pointerup', onUp);
    track.addEventListener('pointercancel', onUp);
  });
}

function setupColorPickerHexInput() {
  document.addEventListener('input', (event) => {
    const input = event.target.closest('[data-role="picker-hex"]');
    if (!input) return;
    const part = input.dataset.part;
    const raw = input.value.trim().replace(/^#/, '');
    if (!/^[0-9a-fA-F]{6}$/.test(raw)) return; // wait for a full, valid hex before applying

    const hex = `#${raw}`;
    applyLiveColor(part, hex);
    pickerHSV[part] = colorToHsv(modelCols[part]);
    renderColorPickerUI(part);
    markCustomPreset();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const input = event.target.closest('[data-role="picker-hex"]');
    if (!input) return;
    input.blur();
  });
}

// Cleans up a filename like "TopUSmatrix.glb" or "Bumper_motor_ramp.glb" into a
// human label ("US matrix", "Motor Ramp") by dropping the part-key/label prefix
// and splitting camelCase/underscore/dash boundaries. File naming isn't fully
// consistent across the asset set, so this is a best-effort heuristic, not a
// guaranteed clean result — it's a secondary label under a real thumbnail.
function prettyVariantLabel(part, filename) {
  let name = filename.replace(/\.[^.]+$/, '');
  const partLabel = PART_META.find((meta) => meta.key === part)?.label;
  [part, partLabel].filter(Boolean).forEach((prefix) => {
    name = name.replace(new RegExp(`^${prefix}[-_ ]?`, 'i'), '');
  });
  name = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) name = filename.replace(/\.[^.]+$/, '');
  return name
    .split(' ')
    .map((word) => (word === word.toUpperCase() ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

// Lazily creates a small offscreen scene/camera/renderer used only to snapshot
// variant thumbnails — kept separate from the main scene/camera/renderer so it
// never competes with or disturbs the live viewer.
function getThumbRenderer() {
  if (thumbRenderer3D) return thumbRenderer3D;

  const size = 320;
  const rScene = new THREE.Scene();
  const rCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
  const rRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  rRenderer.setSize(size, size);
  rRenderer.setPixelRatio(1);
  rRenderer.setClearColor(0x000000, 0);

  rScene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const key = new THREE.DirectionalLight(0xffffff, 1.3);
  key.position.set(100, 200, 150);
  rScene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.55);
  fill.position.set(-120, -40, -80);
  rScene.add(fill);

  thumbRenderer3D = { scene: rScene, camera: rCamera, renderer: rRenderer };
  return thumbRenderer3D;
}

function disposeThumbObject(object) {
  object.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry?.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      if (!material) return;
      Object.values(material).forEach((value) => {
        if (value?.isTexture) value.dispose();
      });
      material.dispose();
    });
  });
}

// Renders one variant's GLB to a small PNG data URL for the picker grid, caching
// by URL (both the finished image and the in-flight promise, so opening the same
// part's grid twice — or fast repeated clicks — never re-renders or re-fetches).
function renderVariantThumbnail(url) {
  if (variantThumbCache[url]) return Promise.resolve(variantThumbCache[url]);
  if (variantThumbPromises[url]) return variantThumbPromises[url];

  const promise = loader.loadAsync(url).then((gltf) => {
    const { scene: rScene, camera: rCamera, renderer: rRenderer } = getThumbRenderer();
    const model = gltf.scene;

    // precise=true forces a fresh bounding box from actual vertex positions.
    // The default (imprecise) mode trusts each mesh's cached geometry.boundingBox,
    // which for some of these assets doesn't match the real vertex data (axes
    // swapped) — that stale cache is what was producing thumbnails aimed at the
    // wrong point in space (cropped/off-center/tiny-in-a-corner renders).
    const box = new THREE.Box3().setFromObject(model, true);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    model.position.sub(sphere.center);

    const radius = Math.max(sphere.radius, 0.001);
    const fovRad = (rCamera.fov * Math.PI) / 180;
    const dist = (radius / Math.sin(fovRad / 2)) * 1.35;
    const direction = new THREE.Vector3(0.62, 0.56, 0.62).normalize();
    rCamera.position.copy(direction.multiplyScalar(dist));
    rCamera.near = Math.max(dist / 100, 0.01);
    rCamera.far = dist * 10;
    rCamera.lookAt(0, 0, 0);
    rCamera.updateProjectionMatrix();

    rScene.add(model);
    rRenderer.render(rScene, rCamera);
    const dataUrl = rRenderer.domElement.toDataURL('image/png');
    rScene.remove(model);
    disposeThumbObject(model);

    variantThumbCache[url] = dataUrl;
    delete variantThumbPromises[url];
    return dataUrl;
  }).catch((error) => {
    console.error('Thumbnail render failed', url, error);
    delete variantThumbPromises[url];
    return null;
  });

  variantThumbPromises[url] = promise;
  return promise;
}

function mountVariantGridPanel() {
  const host = document.fullscreenElement || container || document.body;
  if (variantGridPanel.parentElement !== host) host.appendChild(variantGridPanel);
}

// Same anchored-below/flip-above/clamp-to-viewport placement as positionPalette,
// just sized for the bigger grid panel instead of the color swatches.
function positionVariantGrid(anchorRect) {
  const pad = 8;
  variantGridPanel.style.display = 'flex';
  variantGridPanel.classList.add('open');

  const w = variantGridPanel.offsetWidth || 300;
  const h = variantGridPanel.offsetHeight || 300;
  const centerX = anchorRect.left + (anchorRect.width / 2);
  const belowY = anchorRect.bottom + pad;
  const aboveY = anchorRect.top - h - pad;
  const openUp = (window.innerHeight - anchorRect.bottom) < (h + 16) && anchorRect.top > (h + 16);

  variantGridPanel.style.position = 'fixed';
  variantGridPanel.style.left = `${Math.max(8, Math.min(centerX - (w / 2), window.innerWidth - w - 8))}px`;
  variantGridPanel.style.top = `${openUp ? Math.max(8, aboveY) : Math.min(belowY, window.innerHeight - h - 8)}px`;
  variantGridPanel.style.zIndex = '2147483647';
}

// Arms and Bumper occupy the same slot and are mutually exclusive (see
// enforceArmsBumperExclusion) — opening either one's picker shows both
// categories together instead of just the one that was clicked, so you can
// switch straight from an arm variant to a bumper variant (or back) in one
// place instead of needing to know they live on separate rows.
const EXCLUSIVE_VARIANT_GROUPS = {
  arms: ['arms', 'bumper'],
  bumper: ['arms', 'bumper']
};

let variantGridSession = 0;

function openVariantGrid(part, anchorEl) {
  const groupParts = (EXCLUSIVE_VARIANT_GROUPS[part] || [part]).filter((p) => (modelSets[p] || []).length);
  if (!groupParts.length) return;

  reallyClosePalette();
  openVariantGridPart = part;
  const mySession = ++variantGridSession;

  const groupLabels = groupParts.map((p) => PART_META.find((entry) => entry.key === p)?.label || p);
  variantGridTitle.textContent = groupLabels.join(' & ');

  variantGridBody.innerHTML = groupParts.map((p) => {
    const list = modelSets[p] || [];
    const label = PART_META.find((entry) => entry.key === p)?.label || p;
    const sectionLabel = groupParts.length > 1
      ? `<div class="variant-grid-section-label">${label}</div>`
      : '';
    const items = list.map((url, idx) => {
      const name = prettyVariantLabel(p, url.split('/').pop());
      const isActive = partVis[p] && idx === currentIdx[p];
      return `
        <button type="button" class="variant-grid-item${isActive ? ' active' : ''}" data-part="${p}" data-idx="${idx}" aria-label="${name}">
          <span class="variant-thumb" data-part="${p}" data-idx="${idx}"><span class="variant-thumb-spinner" aria-hidden="true"></span></span>
          <span class="variant-name">${name}</span>
          ${isActive ? '<span class="material-icons variant-check" aria-hidden="true">check_circle</span>' : ''}
        </button>
      `;
    }).join('');
    return sectionLabel + items;
  }).join('');

  mountVariantGridPanel();
  positionVariantGrid(anchorEl.getBoundingClientRect());

  groupParts.forEach((p) => {
    (modelSets[p] || []).forEach((url, idx) => {
      renderVariantThumbnail(url).then((dataUrl) => {
        if (variantGridSession !== mySession) return; // grid closed or reopened for something else
        const slot = variantGridBody.querySelector(`.variant-thumb[data-part="${p}"][data-idx="${idx}"]`);
        if (!slot) return;
        slot.innerHTML = dataUrl
          ? `<img src="${dataUrl}" alt="">`
          : '<span class="material-icons variant-thumb-fallback" aria-hidden="true">view_in_ar</span>';
      });
    });
  });
}

function closeVariantGrid() {
  variantGridPanel.classList.remove('open');
  variantGridPanel.style.display = 'none';
  variantGridPanel.style.position = '';
  variantGridPanel.style.left = '';
  variantGridPanel.style.top = '';
  openVariantGridPart = null;
}

function setupVariantGrid() {
  variantGridClose.addEventListener('click', closeVariantGrid);

  document.addEventListener('click', (event) => {
    if (!openVariantGridPart) return;
    if (event.target.closest('.variant-grid-panel')) return;
    if (event.target.closest('[data-role="variant-grid"]')) return;
    if (event.target.closest('#part-map')) return;
    closeVariantGrid();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && openVariantGridPart) closeVariantGrid();
  });

  // Capture-phase scroll listener sees scroll events from any scrollable
  // descendant, not just the page — the grid body itself scrolls internally
  // (13 variants doesn't fit the panel), so without this guard scrolling the
  // grid closed it. Only close when something outside the panel scrolled.
  window.addEventListener('scroll', (event) => {
    if (!openVariantGridPart) return;
    if (event.target instanceof Element && event.target.closest('.variant-grid-panel')) return;
    closeVariantGrid();
  }, { passive: true, capture: true });

  variantGridBody.addEventListener('click', (event) => {
    const item = event.target.closest('.variant-grid-item');
    if (!item) return;

    const part = item.dataset.part || openVariantGridPart;
    const idx = Number(item.dataset.idx);
    if (!part || Number.isNaN(idx)) return;

    const wasHidden = !partVis[part];
    if (wasHidden) enablePart(part, false);
    currentIdx[part] = idx;
    loadModel(part, true);
    // Always enforced (not just when newly enabled) — picking from a combined
    // Arms/Bumper grid must win over whichever of the two was already showing.
    enforceArmsBumperExclusion(part);
    enforceBottomMotionExclusion();
    enforceHatRequiresTopHats();
    refreshConflictBadges();
    markCustomPreset();
    closeVariantGrid();
    switchToPartPanel(part);
    if (mobileLayoutActive) setMobileSheetState('peek', part);
  });
}

function tintModelFlatGray(model, hex = '#d9d9d9') {
  const color = new THREE.Color('#d9d9d9').lerp(new THREE.Color(hex), PART_MAP_TINT_STRENGTH);
  model.traverse((node) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      if (material?.color) material.color.copy(color);
    });
  });
}

// Builds the #part-map mini viewport: its own scene/camera/renderer showing the
// PART_MAP_PARTS reference build, slowly auto-rotating, with click/hover raycasting
// against the real meshes (each tagged with userData.partMapKey during load) so
// picking a part is pixel-accurate from any angle — then opens that part's variant
// grid exactly like clicking its row's name would. Runs once at startup; the mini
// scene is independent of the main viewer and of the user's actual part visibility.
async function setupPartMap() {
  const mapEl = document.getElementById('part-map');
  const canvas = document.getElementById('part-map-canvas');
  const mapLabel = document.getElementById('part-map-label');
  if (!mapEl || !canvas) return;
  const defaultMapLabelText = mapLabel?.textContent || 'Tap a part';

  const size = 280; // starting size; kept in sync with the side panel's own width below (syncMinMapSizeToPanel)
  const pScene = new THREE.Scene();
  const pCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
  const pRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  pRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  pRenderer.setSize(size, size, false);
  pRenderer.setClearColor(0x000000, 0);

  pScene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
  keyLight.position.set(100, 200, 150);
  pScene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
  fillLight.position.set(-120, -40, -80);
  pScene.add(fillLight);

  const root = new THREE.Group();
  pScene.add(root);

  const preset = presets[PART_MAP_PRESET_KEY];
  await Promise.all(PART_MAP_PARTS.map(async (part) => {
    const idx = preset?.parts?.[part] ?? 0;
    const urls = getAssetCandidates(part, idx, 'glb');
    if (!urls.length) return;

    try {
      const gltf = await loader.loadAsync(urls[0]);
      const model = gltf.scene;
      model.position.y = MODEL_Y_OFFSET;
      tintModelFlatGray(model, PART_MAP_TINTS[part]);
      model.traverse((node) => {
        if (!node.isMesh) return;
        // Mesh.raycast() rejects using geometry.boundingSphere as a fast
        // pre-check BEFORE testing real triangles — same stale-cache bug as
        // the thumbnail renderer's Box3 issue, just hitting a different
        // three.js code path this time. Force a fresh compute from the
        // actual vertex data so that pre-check doesn't reject valid hits.
        node.geometry.computeBoundingSphere();
        node.geometry.computeBoundingBox();
        node.userData.partMapKey = part;
      });
      root.add(model);
    } catch (error) {
      console.warn('Part map: failed to load', part, error);
    }
  }));

  if (!root.children.length) return;

  const box = new THREE.Box3().setFromObject(root, true);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  root.position.sub(sphere.center);

  // Static top-down 3/4 view: exactly 45° elevation, 45° azimuth — no
  // auto-rotation, just one fixed, deliberate angle.
  const fovRad = (pCamera.fov * Math.PI) / 180;
  const elevation = THREE.MathUtils.degToRad(45);
  const azimuth = THREE.MathUtils.degToRad(45);
  const direction = new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation)
  ).normalize();

  // A bounding-SPHERE fit has to leave room for every possible viewing angle,
  // which left the model tiny in a sea of margin (and every part's already-small
  // clickable area smaller still). The camera angle here is fixed, so fit
  // tightly to what THIS one direction actually needs: project every corner of
  // the assembly's box onto the camera's own right/up axes and solve for the
  // closest distance that still keeps all of them inside the frustum.
  const tanHalfFov = Math.tan(fovRad / 2);
  const worldUp = new THREE.Vector3(0, 1, 0);
  const camRight = new THREE.Vector3().crossVectors(worldUp, direction).normalize();
  const camUp = new THREE.Vector3().crossVectors(direction, camRight).normalize();

  const corners = [
    [box.min.x, box.min.y, box.min.z], [box.min.x, box.min.y, box.max.z],
    [box.min.x, box.max.y, box.min.z], [box.min.x, box.max.y, box.max.z],
    [box.max.x, box.min.y, box.min.z], [box.max.x, box.min.y, box.max.z],
    [box.max.x, box.max.y, box.min.z], [box.max.x, box.max.y, box.max.z]
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z).sub(sphere.center));

  let dist = 0.001;
  for (const corner of corners) {
    const alongBack = corner.dot(direction);
    const alongUp = Math.abs(corner.dot(camUp));
    const alongRight = Math.abs(corner.dot(camRight));
    dist = Math.max(dist, alongUp / tanHalfFov + alongBack, alongRight / tanHalfFov + alongBack);
  }
  dist *= 1.18;

  pCamera.position.copy(direction).multiplyScalar(dist);
  pCamera.near = Math.max(dist / 100, 0.01);
  pCamera.far = dist * 10;
  pCamera.lookAt(0, 0, 0);
  pCamera.updateProjectionMatrix();

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let hoveredMaterials = [];
  let dirty = true;

  function setHoverTint(materials, on) {
    materials.forEach((material) => {
      if (!material?.emissive) return;
      material.emissive.setHex(on ? 0x3d7fff : 0x000000);
    });
  }

  function castAt(ndcX, ndcY) {
    pointerNdc.set(ndcX, ndcY);
    raycaster.setFromCamera(pointerNdc, pCamera);
    const hits = raycaster.intersectObjects(root.children, true);
    return hits.find((h) => h.object.userData?.partMapKey) || null;
  }

  // Small/thin parts (face, hat) are easy to miss by a few pixels at this
  // size, especially with the auto-rotation gone (users now have to line up
  // the click themselves). Try the exact point, then successively wider rings
  // of offset points, using the first ring that lands on something.
  const HITBOX_RINGS = [
    { radius: 8, points: 8 },
    { radius: 16, points: 10 },
    { radius: 24, points: 12 }
  ];

  function pickPartAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const toNdc = (x, y) => [((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1];

    const [x0, y0] = toNdc(clientX, clientY);
    let hit = castAt(x0, y0);
    if (hit) return hit.object;

    for (const { radius, points } of HITBOX_RINGS) {
      for (let i = 0; i < points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const [x, y] = toNdc(clientX + Math.cos(angle) * radius, clientY + Math.sin(angle) * radius);
        hit = castAt(x, y);
        if (hit) return hit.object;
      }
    }
    return null;
  }

  function applyHover(clientX, clientY) {
    const hitObj = pickPartAt(clientX, clientY);
    if (hoveredMaterials.length) {
      setHoverTint(hoveredMaterials, false);
      hoveredMaterials = [];
      dirty = true;
    }
    if (hitObj) {
      const mats = Array.isArray(hitObj.material) ? hitObj.material : [hitObj.material];
      setHoverTint(mats, true);
      hoveredMaterials = mats;
      canvas.style.cursor = 'pointer';
      dirty = true;
      if (mapLabel) {
        const part = hitObj.userData.partMapKey;
        mapLabel.textContent = PART_META.find((entry) => entry.key === part)?.label || defaultMapLabelText;
      }
    } else {
      canvas.style.cursor = '';
      if (mapLabel) mapLabel.textContent = defaultMapLabelText;
    }
  }

  // Scene is static now (no auto-rotation), so there's no need to raycast on
  // every raw pointermove — batch to at most once per rendered frame.
  let pendingHoverEvent = null;
  canvas.addEventListener('pointermove', (event) => {
    pendingHoverEvent = event;
  });

  canvas.addEventListener('pointerleave', () => {
    pendingHoverEvent = null;
    if (hoveredMaterials.length) {
      setHoverTint(hoveredMaterials, false);
      hoveredMaterials = [];
      dirty = true;
    }
    canvas.style.cursor = '';
    if (mapLabel) mapLabel.textContent = defaultMapLabelText;
  });

  canvas.addEventListener('click', (event) => {
    const hitObj = pickPartAt(event.clientX, event.clientY);
    if (!hitObj) return;
    const part = hitObj.userData.partMapKey;
    if (openVariantGridPart === part) {
      closeVariantGrid();
    } else {
      openVariantGrid(part, mapEl);
    }
  });

  // Drag the top-right grip to resize — the box is anchored bottom-left (see
  // #part-map's CSS), so growing it means dragging up/right. The floor tracks
  // the side panel's own (dynamic — see adjustControlsWidth) rendered width,
  // just as a reasonable default starting size, not for any edge-alignment
  // reason (the map and that panel don't share a screen corner). Persists
  // across sessions once the user has actually grown it past that floor.
  let MIN_MAP_SIZE = Math.round(essPanel.getBoundingClientRect().width || size);
  const MAX_MAP_SIZE = 480;
  const MAP_SIZE_KEY = 'hp_robot_partmap_size';
  let currentMapSize = MIN_MAP_SIZE;

  // Growing up/right from the bottom-left anchor means #preset-menu (top-left)
  // is the thing the box can grow into — cap available growth against its
  // bottom edge instead of the fixed MAX_MAP_SIZE once the viewport is short
  // enough that the two would otherwise overlap. mapEl's own bottom edge is
  // fixed (anchored via `bottom`, not `top`), so it stays put as height grows
  // and is safe to read regardless of the box's current size.
  function getMaxMapSize() {
    const presetEl = document.getElementById('preset-menu');
    if (!presetEl) return MAX_MAP_SIZE;
    const gap = 12;
    const available = mapEl.getBoundingClientRect().bottom - presetEl.getBoundingClientRect().bottom - gap;
    return Math.min(MAX_MAP_SIZE, available);
  }

  function applyMapSize(next) {
    currentMapSize = Math.round(Math.max(MIN_MAP_SIZE, Math.min(getMaxMapSize(), next)));
    mapEl.style.width = `${currentMapSize}px`;
    mapEl.style.height = `${currentMapSize}px`;
    pRenderer.setSize(currentMapSize, currentMapSize, false);
    dirty = true;
  }

  // Re-reads the panel's current width and, if the box hasn't been manually
  // grown past the floor, follows it — so resizing the browser (which can
  // change the panel's width) keeps the floor current instead of only
  // matching once at startup.
  function syncMinMapSizeToPanel() {
    const panelWidth = Math.round(essPanel.getBoundingClientRect().width || 0);
    if (!panelWidth || panelWidth === MIN_MAP_SIZE) return;
    const wasAtFloor = currentMapSize <= MIN_MAP_SIZE + 1;
    MIN_MAP_SIZE = panelWidth;
    if (wasAtFloor) applyMapSize(MIN_MAP_SIZE);
  }
  partMapWidthSync = syncMinMapSizeToPanel;

  let restoredSize = MIN_MAP_SIZE;
  try {
    const savedSize = Number(localStorage.getItem(MAP_SIZE_KEY));
    if (savedSize) restoredSize = savedSize;
  } catch {}
  // Always runs, even at the default size — a short viewport can need the
  // box clamped even before anyone drags the resize handle.
  applyMapSize(restoredSize);

  // The map's size is fixed in px while the viewport isn't — a browser resize
  // (or rotation) can change whether the panel has room, or how much vertical
  // space is left before #preset-menu, even without the map's own size
  // changing.
  window.addEventListener('resize', () => {
    syncMinMapSizeToPanel();
    applyMapSize(currentMapSize);
  });

  // Double-click-to-reset is handled here rather than via a separate
  // 'dblclick' listener: preventDefault() on pointerdown (needed below, so
  // dragging doesn't also fire a click on whatever's underneath) suppresses
  // the browser's synthesized click/dblclick events for that same
  // interaction entirely, so a real 'dblclick' listener would never fire.
  const resizeHandle = document.getElementById('part-map-resize');
  let lastResizePointerDown = 0;
  resizeHandle?.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();

    const now = performance.now();
    const isDoubleClick = now - lastResizePointerDown < 350;
    lastResizePointerDown = now;
    if (isDoubleClick) {
      applyMapSize(MIN_MAP_SIZE);
      try { localStorage.setItem(MAP_SIZE_KEY, String(currentMapSize)); } catch {}
      return;
    }

    resizeHandle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = currentMapSize;

    const onMove = (moveEvent) => {
      const grownBy = Math.max(moveEvent.clientX - startX, startY - moveEvent.clientY);
      applyMapSize(startSize + grownBy);
    };
    const onUp = () => {
      resizeHandle.removeEventListener('pointermove', onMove);
      resizeHandle.removeEventListener('pointerup', onUp);
      resizeHandle.removeEventListener('pointercancel', onUp);
      try { localStorage.setItem(MAP_SIZE_KEY, String(currentMapSize)); } catch {}
    };
    resizeHandle.addEventListener('pointermove', onMove);
    resizeHandle.addEventListener('pointerup', onUp);
    resizeHandle.addEventListener('pointercancel', onUp);
  });

  // Static scene: only re-render when something actually changes (a hover
  // tint toggling) instead of looping forever.
  function tick() {
    requestAnimationFrame(tick);
    if (document.hidden) return;
    if (pendingHoverEvent) {
      applyHover(pendingHoverEvent.clientX, pendingHoverEvent.clientY);
      pendingHoverEvent = null;
    }
    if (dirty) {
      pRenderer.render(pScene, pCamera);
      dirty = false;
    }
  }
  requestAnimationFrame(tick);
}

function setupKeyboardNav() {
  container.addEventListener('keydown', (event) => {
    const section = event.target.closest('.model-section');
    if (!section) return;
    const part = section.id.replace('-controls', '');
    if (!part || !modelSets[part]) return;

    if (event.key === 'ArrowLeft') {
      if (!partVis[part]) enablePart(part, false);
      currentIdx[part] = wrapIndex(part, currentIdx[part] - 1);
      loadModel(part, true);
      enforceBottomMotionExclusion();
      enforceHatRequiresTopHats();
      refreshConflictBadges();
      markCustomPreset();
      event.preventDefault();
    } else if (event.key === 'ArrowRight') {
      if (!partVis[part]) enablePart(part, false);
      currentIdx[part] = wrapIndex(part, currentIdx[part] + 1);
      loadModel(part, true);
      enforceBottomMotionExclusion();
      enforceHatRequiresTopHats();
      refreshConflictBadges();
      markCustomPreset();
      event.preventDefault();
    }
  });
}

function setupGlobalClickHandler() {
  container.addEventListener('click', async (event) => {
    const el = event.target.closest('[data-role]');
    if (!el) return;
    const role = el.getAttribute('data-role');
    const part = el.getAttribute('data-part');
    if (!part) return;

    if (role === 'variant-grid') {
      if (openVariantGridPart === part) {
        closeVariantGrid();
      } else {
        openVariantGrid(part, el);
      }
      return;
    }

    if (role === 'conflict-badge') {
      const conflict = findConflictFor(part);
      // Only the hidden (structural-rule) case is click-driven — there's
      // nothing on screen to reveal, so a click summons a ghost stand-in.
      // A geometry conflict is already solid-highlighted automatically by
      // refreshConflictBadges the instant it exists; nothing to toggle here.
      if (conflict && conflict.hidden) toggleConflictGhost(part);
      return;
    }

    let touched = false;

    if (role === 'prev') {
      const wasHidden = !partVis[part];
      if (wasHidden) enablePart(part, false);
      currentIdx[part] = wrapIndex(part, currentIdx[part] - 1);
      loadModel(part, true);
      if (wasHidden) enforceArmsBumperExclusion(part);
      enforceBottomMotionExclusion();
      enforceHatRequiresTopHats();
      refreshConflictBadges();
      // Collapse back to the model instead of leaving the sheet expanded —
      // the point of changing a variant is to immediately see the result.
      // Land peek on this same part so it's right there to keep adjusting.
      if (mobileLayoutActive) setMobileSheetState('peek', part);
      touched = true;
    }

    if (role === 'next') {
      const wasHidden = !partVis[part];
      if (wasHidden) enablePart(part, false);
      currentIdx[part] = wrapIndex(part, currentIdx[part] + 1);
      loadModel(part, true);
      if (wasHidden) enforceArmsBumperExclusion(part);
      enforceBottomMotionExclusion();
      enforceHatRequiresTopHats();
      refreshConflictBadges();
      if (mobileLayoutActive) setMobileSheetState('peek', part);
      touched = true;
    }

    if (role === 'visibility') {
      partVis[part] = !partVis[part];
      el.innerHTML = `<span class="material-icons">${partVis[part] ? 'visibility' : 'visibility_off'}</span>`;

      if (part === 'spacer') {
        if (partVis.spacer) {
          loadModel('spacer');
        } else if (loadedMods.spacer) {
          scene.remove(loadedMods.spacer);
          loadedMods.spacer = null;
        }
        loadModel('bottom');
        loadModel('wheels');
      } else if (loadedMods[part]) {
        loadedMods[part].visible = partVis[part];
        // bootstrap() preloads every part up front, including ones that start
        // hidden (hat/arms/bumper/tail) — but a part that started hidden was
        // never added to the scene in the first place (loadModel only calls
        // scene.add() when partVis is already true), so loadedMods[part]
        // exists yet is a detached, parent-less Object3D. Flipping .visible
        // on an object outside the scene graph does nothing renderable; it
        // has to be (re-)added. Mirrors enablePart()'s equivalent check.
        if (partVis[part] && !loadedMods[part].parent) scene.add(loadedMods[part]);
      } else if (partVis[part]) {
        // Model has genuinely never loaded at all (e.g. a load error earlier).
        loadModel(part, true);
      }

      if (partVis[part]) enforceArmsBumperExclusion(part);
      enforceBottomMotionExclusion();
      enforceHatRequiresTopHats();
      refreshConflictBadges();
      updateComboChip();
      touched = true;
    }

    if (role === 'engrave') {
      if (part !== 'top') {
        toast('Engraving is currently available only for the top part.', 'warn', 2000);
        return;
      }

      const url = new URL('./engrave.html', window.location.href);
      url.searchParams.set('part', 'top');
      url.searchParams.set('file', 'Toplights_NOlogo.glb');
      navigateWithFade(url.href);
      return;
    }

    if (role === 'print') {
      try {
        await showConsentPopup();
      } catch {
        return;
      }

      // STL is preferred (see stlSets), but none is hosted yet for most
      // variants — this probes for one and falls back to STEP so nothing
      // breaks today, while automatically switching over the moment matching
      // .stl files exist at the same path as the .step/.glb ones.
      let url = await firstExistingUrl(getAssetCandidates(part, currentIdx[part], 'stl'));
      if (!url) {
        const stepUrls = getAssetCandidates(part, currentIdx[part], 'step');
        if (!stepUrls.length) {
          toast(`No STL or STEP file available for ${part}.`, 'warn', 1800);
          return;
        }
        url = stepUrls[0];
      }

      // OrcaSlicer only, for now: its orcaslicer://open handler fetches the URL itself and
      // has no partner-site allowlist, so this direct link works with zero local setup.
      // PrusaSlicer's own prusaslicer://open handler only accepts download URLs from a
      // short reviewed allowlist (printables.com, thingiverse.com, cults3d.com), so a link
      // to a file hosted here is always rejected until hprobots.com gets added to it — the
      // slicer picker (#slicer-group) is hidden until then; re-enable it and branch on
      // getPreferredSlicer() again once that happens.
      const fullUrl = new URL(url, window.location.href).href;
      const link = document.createElement('a');
      link.href = `orcaslicer://open?file=${encodeURIComponent(fullUrl)}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }

    if (role === 'download-part') {
      try {
        await showConsentPopup();
      } catch {
        return;
      }

      try {
        // Prefer a hosted STL if one exists at the expected path; otherwise export
        // one on the fly from the model already loaded in the viewer — always
        // available, no dependency on what's been uploaded remotely.
        const hostedUrl = await firstExistingUrl(getAssetCandidates(part, currentIdx[part], 'stl'));
        const blob = hostedUrl
          ? await (await fetch(hostedUrl)).blob()
          : await exportPartAsStlBlob(part);
        downloadBlob(blob, `${part}.stl`);
        toast(`${part} STL downloaded.`, 'ok', 1600);
      } catch (error) {
        console.error(error);
        toast(`Failed to download ${part}.`, 'err', 2200);
      }
    }

    if (touched) {
      markCustomPreset();
    }
  });
}

function initPillsAndButtons() {
  for (const part of Object.keys(modelSets)) {
    const pill = document.getElementById(`${part}-pill`);
    const hex = `#${modelCols[part].getHexString()}`;
    if (pill) {
      pill.style.backgroundColor = hex;
      pill.style.border = hex.toLowerCase() === '#ffffff' ? '1px solid #000' : '1px solid var(--stroke)';
    }

    const visBtn = document.getElementById(`${part}-visibility`);
    if (visBtn) {
      visBtn.innerHTML = `<span class="material-icons">${partVis[part] ? 'visibility' : 'visibility_off'}</span>`;
    }
  }
}

function navigateWithFade(url) {
  if ('startViewTransition' in document) {
    window.location.assign(url);
    return;
  }
  document.documentElement.classList.add('vt-leaving');
  window.setTimeout(() => window.location.assign(url), 180);
}

function toast(message, type = 'ok', ms = 2000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="material-icons">${type === 'ok' ? 'check_circle' : type === 'warn' ? 'warning' : 'error'}</span><div>${message}</div>`;
  toastStack.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-4px)';
  }, ms);
  setTimeout(() => el.remove(), ms + 300);
}

function adjustControlsWidth() {
  if (mobileLayoutActive) return; // sheet content is full-width via CSS instead
  const toggle = document.getElementById('controls-toggle');
  if (!toggle) return;
  const width = toggle.getBoundingClientRect().width;
  const nextWidth = Math.min(Math.max(260, width), (container.clientWidth || window.innerWidth) - 24);
  essPanel.style.width = `${nextWidth}px`;
  partMapWidthSync?.();
}

function setPresetLabel(label) {
  presetLabelEl.textContent = label;
  presetToggle.setAttribute('aria-label', `Active preset: ${label}`);
}

function syncPresetButtons(key) {
  presetButtons.forEach((button) => {
    const isActive = button.dataset.preset === key;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function populatePresetMenu() {
  presetButtons.forEach((button) => {
    const preset = presets[button.dataset.preset];
    if (!preset) return;
    const title = button.querySelector('.option-title');
    const desc = button.querySelector('.option-desc');
    if (title) title.textContent = preset.label;
    if (desc) desc.textContent = preset.description;
  });
}

function openPresetMenu() {
  presetMenu.classList.add('open');
  presetToggle.setAttribute('aria-expanded', 'true');
}

function closePresetMenu() {
  presetMenu.classList.remove('open');
  presetToggle.setAttribute('aria-expanded', 'false');
}

function openDlMenu() {
  dlMenu.style.display = 'block';
  dlToggle.setAttribute('aria-expanded', 'true');
}

function closeDlMenu() {
  dlMenu.style.display = 'none';
  dlToggle.setAttribute('aria-expanded', 'false');
}

function markCustomPreset() {
  if (isApplyingPreset) return;
  activePresetKey = 'custom';
  setPresetLabel('Custom mix');
  syncPresetButtons('');
  saveStateToLocal();
}

function clampPresetIndex(part, idx) {
  const list = modelSets[part] || [];
  if (!list.length) return 0;
  return Math.min(Math.max(Number(idx) || 0, 0), list.length - 1);
}

function wrapIndex(part, idx) {
  const list = modelSets[part] || [];
  if (!list.length) return 0;
  return (idx + list.length) % list.length;
}

function uniqueUrls(urls) {
  return [...new Set(urls.filter(Boolean))];
}

function getAssetCandidates(part, idx, format = 'glb') {
  const localSets = format === 'step' ? stepSets : format === 'stl' ? stlSets : localModelSets;
  const remoteSets = format === 'step' ? remoteStepSets : format === 'stl' ? remoteStlSets : remoteModelSets;

  return uniqueUrls([
    localSets[part]?.[idx],
    remoteSets[part]?.[idx]
  ]);
}

async function fetchFirstAvailable(urls) {
  let lastError = null;

  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status} for ${url}`);
        continue;
      }
      return { response, url };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('No asset URL available');
}

// Lightweight existence probe (HEAD, no body fetched) used to check for a
// hosted file before falling back to something else — unlike
// getAssetCandidates(), which only tells you a URL COULD be constructed by
// pattern, not that anything actually lives there.
async function firstExistingUrl(urls) {
  for (const url of urls) {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (response.ok) return url;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

// Exports the currently-loaded, currently-colored model for a part straight
// out of the live 3D scene — no hosted .stl file needed, so this always works
// regardless of what's actually been uploaded for this variant.
async function exportPartAsStlBlob(part) {
  const model = loadedMods[part];
  if (!model) throw new Error(`${part} is not loaded`);
  const { STLExporter } = await import('three/addons/exporters/STLExporter.js');
  const exporter = new STLExporter();
  const result = exporter.parse(model, { binary: true });
  return new Blob([result], { type: 'model/stl' });
}

function saveStateToLocal() {
  const state = {
    currentIdx,
    partVis,
    modelCols: Object.fromEntries(Object.entries(modelCols).map(([part, color]) => [part, `#${color.getHexString()}`])),
    presetKey: activePresetKey
  };

  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {}
}

function applySavedState(saved) {
  if (saved.currentIdx) {
    for (const part of Object.keys(saved.currentIdx)) {
      if (modelSets[part]) currentIdx[part] = clampPresetIndex(part, saved.currentIdx[part]);
    }
  }

  if (saved.partVis) {
    for (const part of Object.keys(saved.partVis)) {
      if (typeof saved.partVis[part] === 'boolean') partVis[part] = saved.partVis[part];
    }
  }

  if (saved.modelCols) {
    for (const part of Object.keys(saved.modelCols)) {
      if (!modelCols[part]) modelCols[part] = new THREE.Color('#d9d9d9');
      modelCols[part].set(saved.modelCols[part] || '#d9d9d9');
    }
  }

  // Safety net for state saved/shared before this rule existed.
  enforceBottomMotionExclusion();
  enforceHatRequiresTopHats();
  refreshConflictBadges();
}

function tryRestoreFromLocal() {
  let raw = null;
  try {
    raw = localStorage.getItem(STATE_KEY);
  } catch {}
  if (!raw) return false;

  try {
    const saved = JSON.parse(raw);
    applySavedState(saved);
    activePresetKey = saved.presetKey || 'custom';
    restoredFromLocal = true;
    return true;
  } catch {
    return false;
  }
}

// Compact, URL-safe base64 of the same shape saveStateToLocal() persists, so a
// shared link and a locally-saved session decode through the same path.
function encodeShareState() {
  const state = {
    currentIdx,
    partVis,
    modelCols: Object.fromEntries(Object.entries(modelCols).map(([part, color]) => [part, `#${color.getHexString()}`]))
  };
  const json = JSON.stringify(state);
  const bytes = new TextEncoder().encode(json);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeShareState(param) {
  let base64 = param.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json);
}

function getShareUrl() {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('c', encodeShareState());
  return url.href;
}

function tryRestoreFromUrl() {
  const param = new URLSearchParams(window.location.search).get('c');
  if (!param) return false;

  try {
    applySavedState(decodeShareState(param));
    activePresetKey = 'custom';
    restoredFromLocal = true;

    // Strip the config param once loaded so it doesn't keep overriding
    // localStorage on every refresh of a bookmarked shared link.
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('c');
    window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
    return true;
  } catch (error) {
    console.error('Failed to parse shared config', error);
    return false;
  }
}

async function copyShareLink() {
  const url = getShareUrl();

  // On a phone the native share sheet (Messages/WhatsApp/email/...) is the
  // expected action for a share tap, not a silent clipboard copy.
  if (isTouchLikeDevice() && navigator.share) {
    try {
      await navigator.share({ title: 'HP Robot Customizer', text: 'Check out my robot build', url });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return; // user dismissed the share sheet, not a failure
      // otherwise fall through to the clipboard/prompt fallback below
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    toast('Share link copied to clipboard!', 'ok', 1800);
    return;
  } catch {}

  try {
    const textarea = document.createElement('textarea');
    textarea.value = url;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    toast('Share link copied to clipboard!', 'ok', 1800);
  } catch {
    window.prompt('Copy this link to share your build:', url);
  }
}

// max-width caps this to phone-sized viewports — pointer:coarse alone also
// matches touchscreen 2-in-1 laptops (HP Omnibook X Flip, Surface, Spectre
// x360...) at full desktop width, since their coarse primary pointer just
// reflects a touch digitizer being present, not actual device size or usage.
// Kept in sync with the (pointer: coarse) and (max-width: 1024px) queries in app.css.
function isTouchLikeDevice() {
  try { return window.matchMedia('(pointer: coarse) and (max-width: 1024px)').matches; } catch { return false; }
}

let modelViewerLoadPromise = null;
function ensureModelViewerLoaded() {
  if (customElements.get('model-viewer')) return Promise.resolve();
  if (!modelViewerLoadPromise) {
    modelViewerLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = MODEL_VIEWER_SRC;
      script.integrity = MODEL_VIEWER_INTEGRITY;
      script.crossOrigin = 'anonymous';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load the AR viewer library'));
      document.head.appendChild(script);
    });
  }
  return modelViewerLoadPromise;
}

let qrLibLoadPromise = null;
function ensureQrLibLoaded() {
  if (window.QRCode) return Promise.resolve();
  if (!qrLibLoadPromise) {
    qrLibLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = QRCODE_LIB_SRC;
      script.integrity = QRCODE_LIB_INTEGRITY;
      script.crossOrigin = 'anonymous';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load the QR code library'));
      document.head.appendChild(script);
    });
  }
  return qrLibLoadPromise;
}

// Casts hemisphere-sampled rays from every triangle against a combined BVH of
// all visible parts and darkens nearby geometry where it's blocked — a real,
// ray-traced contact shadow (hat-into-head, arm-into-body seams, etc.) baked
// directly into the file. This is the only thing that actually fixes "AR has
// no shadows": native AR viewers (Android Scene Viewer, iOS Quick Look)
// render with real-world camera-estimated lighting and ignore every in-page
// environment/shadow-intensity setting we can set on <model-viewer> — those
// only ever affected the in-browser preview. Must run before exportRoot gets
// its mm→m export scale (see exportVisiblePartsAsGlb) so distances below are
// plain millimeters.
//
// This bakes AO as flat per-bucket materials, NOT vertex colors, even though
// vertex colors are simpler and were the first approach tried. Reason: our AR
// exports never set `ios-src`, so when a user taps AR on iPhone, model-viewer
// auto-converts the GLB to USDZ client-side with its own bundled exporter —
// and that exporter writes vertex colors only as inert mesh-level
// `primvars:displayColor` metadata, never wired into the material's actual
// `inputs:diffuseColor` shader input. A flat, texture-less `material.color`
// DOES get wired correctly on that same code path (traced directly in
// model-viewer's bundled source). Since SAMPLES below already quantizes AO
// into SAMPLES+1 discrete levels, each part's triangles are split into one
// mesh per level it actually uses, each with its own flat-tinted material —
// that's what survives the iOS USDZ conversion and shows up as real shading
// on a real device, where vertex colors silently rendered as nothing.
async function bakeContactShadows(exportRoot) {
  const { MeshBVH } = await import('three-mesh-bvh');
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');

  exportRoot.updateMatrixWorld(true);

  const meshes = [];
  exportRoot.traverse((node) => { if (node.isMesh) meshes.push(node); });
  if (!meshes.length) return;

  // Tracks each mesh's own triangle range [start, end) within the merged BVH
  // geometry below, in the same order mergeGeometries concatenates them —
  // needed to exclude self-hits during raycasting (see MAX_DIST/rayHitsOtherPart) —
  // and each mesh's world-space bounding box, used by isNearOtherPart below.
  const meshTriRanges = [];
  const meshBBoxes = [];
  let triRangeOffset = 0;
  const worldPositionGeoms = [];
  meshes.forEach((mesh) => {
    const positions = mesh.geometry.getAttribute('position');
    if (!positions) {
      meshTriRanges.push(null);
      meshBBoxes.push(null);
      return;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', positions.clone());
    if (mesh.geometry.index) geom.setIndex(mesh.geometry.index.clone());
    geom.applyMatrix4(mesh.matrixWorld);
    const nonIndexed = geom.index ? geom.toNonIndexed() : geom;
    const triCount = nonIndexed.getAttribute('position').count / 3;
    meshTriRanges.push({ start: triRangeOffset, end: triRangeOffset + triCount });
    triRangeOffset += triCount;
    worldPositionGeoms.push(nonIndexed);
    nonIndexed.computeBoundingBox();
    meshBBoxes.push(nonIndexed.boundingBox.clone());
  });
  if (!worldPositionGeoms.length) return;

  // A closestPointToPoint-based pre-filter (per-part BVHs, testing real
  // geometry instead of loose bounding boxes) was tried here to skip
  // surface vertices with nothing nearby, but it came back wrong — its
  // minThreshold argument is only an internal search-pruning hint, not an
  // exclusion filter, and in testing it silently produced zero occlusion
  // across an entire mesh instead of just being conservative.
  const combinedBvh = new MeshBVH(mergeGeometries(worldPositionGeoms, false));

  const SAMPLES = 6;
  const MAX_DIST = 6; // mm — tight contact-shadow range, not whole-model AO (also keeps BVH traversal cheap per ray)
  const STRENGTH = 0.6;
  const BIAS = 0.05; // mm lift off the surface so a ray doesn't immediately re-hit its own face
  const YIELD_EVERY_TRIS = 500; // triangles between UI-thread breathers, so the page never fully locks up
  const AO_LEVELS = 12; // flat buckets the per-triangle hit field gets quantized into (decoupled from SAMPLES)

  // Cheap pre-filter: is `point` (a triangle centroid on mesh `selfIndex`)
  // even within MAX_DIST of some OTHER part's bounding box at all? This
  // bake only cares about contact shadows BETWEEN parts (hat-into-head,
  // arm-into-body seams) — and the vast majority of a part's own surface
  // isn't anywhere near a different part, so for most triangles this single
  // cheap box-distance check (not a BVH traversal) proves up front that no
  // cross-part occlusion is even possible, letting them skip raycasting
  // entirely. This is also what keeps mounting holes cheap AND correct: a
  // hole through a panel is self-occlusion, not part-to-part contact, so it
  // now gets skipped rather than raycast (and possibly misjudged) at all.
  function isNearOtherPart(point, selfIndex) {
    for (let i = 0; i < meshBBoxes.length; i++) {
      if (i === selfIndex) continue;
      const box = meshBBoxes[i];
      if (box && box.distanceToPoint(point) <= MAX_DIST) return true;
    }
    return false;
  }

  // Whether `ray` hits anything OTHER than the current part's own geometry
  // within [0, MAX_DIST]. Only called once isNearOtherPart has already
  // established that some other part is close enough to matter — plain
  // raycastFirst() was hitting the opposite wall of the current part's own
  // small mounting holes otherwise, a real, geometrically correct hit, but
  // not the "contact between parts" seam this bake is meant to shade. With
  // only SAMPLES rays per triangle, whether a given hole-rim triangle's
  // sample directions happen to cross that narrow gap is highly sensitive
  // to its exact normal, so neighboring triangles (near-identical normals)
  // ended up in different AO buckets — a jagged self-shadow seam baked
  // right through the hole.
  function rayHitsOtherPart(selfRange) {
    const firstHit = combinedBvh.raycastFirst(ray, THREE.DoubleSide, 0, MAX_DIST);
    if (!firstHit) return false;
    if (!selfRange || firstHit.faceIndex < selfRange.start || firstHit.faceIndex >= selfRange.end) return true;
    const intersections = combinedBvh.raycast(ray, THREE.DoubleSide, 0, MAX_DIST);
    for (let i = 0; i < intersections.length; i++) {
      const hit = intersections[i];
      if (hit.faceIndex < selfRange.start || hit.faceIndex >= selfRange.end) return true;
    }
    return false;
  }

  const ray = new THREE.Ray();
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const pC = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const bitangent = new THREE.Vector3();
  const sampleDir = new THREE.Vector3();

  for (let meshIndex = 0; meshIndex < meshes.length; meshIndex++) {
    const mesh = meshes[meshIndex];

    // Sampling stays per-triangle (flat shading, not per-vertex smoothly
    // interpolated) for the same reason as before: this robot is
    // hard-surface/mechanical geometry with flat faces and sharp edges, and
    // smooth interpolation across a shared edge between a shadowed and a lit
    // face reads as the face being subtly curved — the whole model looking
    // inflated/bloated, not shadowed. Flat shading per triangle needs each
    // triangle to own independent vertices, hence the conversion to
    // non-indexed first (an indexed mesh shares vertices between adjacent
    // triangles, which would force the same smooth interpolation right back).
    if (mesh.geometry.index) {
      mesh.geometry = mesh.geometry.toNonIndexed();
    }
    const geom = mesh.geometry;
    const posAttr = geom.getAttribute('position');
    const normalAttr = geom.getAttribute('normal');
    const uvAttr = geom.getAttribute('uv');
    const triCount = Math.floor(posAttr.count / 3);
    const selfRange = meshTriRanges[meshIndex];

    // Raw hit count per triangle (0..SAMPLES). Defaults to 0 (fully lit) so
    // degenerate triangles that skip raycasting below need no special-casing.
    const rawHits = new Float32Array(triCount);

    for (let t = 0; t < triCount; t++) {
      if (t % YIELD_EVERY_TRIS === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const i0 = t * 3;
      const i1 = i0 + 1;
      const i2 = i0 + 2;
      pA.fromBufferAttribute(posAttr, i0).applyMatrix4(mesh.matrixWorld);
      pB.fromBufferAttribute(posAttr, i1).applyMatrix4(mesh.matrixWorld);
      pC.fromBufferAttribute(posAttr, i2).applyMatrix4(mesh.matrixWorld);

      centroid.copy(pA).add(pB).add(pC).multiplyScalar(1 / 3);

      // No other part is even within range — nothing can occlude this
      // triangle, so there's no point raycasting it at all. rawHits[t]
      // stays 0 (fully lit), same as the degenerate-triangle case below.
      if (!isNearOtherPart(centroid, meshIndex)) continue;

      edge1.subVectors(pB, pA);
      edge2.subVectors(pC, pA);
      faceNormal.crossVectors(edge1, edge2);

      // Degenerate/zero-area triangle. A zero-length normal downstream would
      // carry NaN/zero components into every ray — which turned into a
      // catastrophic BVH traversal (NaN comparisons are always false in JS,
      // defeating the tree's branch-and-bound pruning) rather than a clean
      // per-ray failure, and was actually behind the 40+ second hangs and
      // outright page crashes seen while developing this. Treat it as fully
      // lit (bucket 0) rather than spending rays on a face with no normal.
      // rawHits[t] is already 0 by default — nothing further to do.
      if (faceNormal.lengthSq() < 1e-10) continue;
      faceNormal.normalize();

      // Tangent basis around the face normal, for hemisphere sampling. Uses
      // the branchless ONB construction (Duff et al. 2017, "Building an
      // Orthonormal Basis, Revisited") instead of the more common
      // pick-an-axis-then-cross approach, which has a hard discontinuity
      // exactly where |normal·referenceAxis| crosses its switchover
      // threshold — harmless for an isolated triangle, but on a curved
      // surface built from many small triangles (a bevelled hole rim) that
      // flip rotates the whole sample pattern between two neighboring
      // triangles with near-identical normals, for no physical reason.
      const nx = faceNormal.x;
      const ny = faceNormal.y;
      const nz = faceNormal.z;
      const sign = nz >= 0 ? 1 : -1;
      const aTerm = -1 / (sign + nz);
      const bTerm = nx * ny * aTerm;
      tangent.set(1 + sign * nx * nx * aTerm, sign * bTerm, -sign * nx);
      bitangent.set(bTerm, sign + ny * ny * aTerm, -ny);

      ray.origin.copy(centroid).addScaledVector(faceNormal, BIAS);

      let hits = 0;
      for (let s = 0; s < SAMPLES; s++) {
        // Cosine-weighted stratified hemisphere sample.
        const u1 = (s + 0.5) / SAMPLES;
        const u2 = ((s * 7 + 3) % SAMPLES + 0.5) / SAMPLES;
        const r = Math.sqrt(u1);
        const theta = 2 * Math.PI * u2;
        const z = Math.sqrt(Math.max(0, 1 - u1));

        sampleDir.set(0, 0, 0)
          .addScaledVector(tangent, r * Math.cos(theta))
          .addScaledVector(bitangent, r * Math.sin(theta))
          .addScaledVector(faceNormal, z)
          .normalize();

        ray.direction.copy(sampleDir);
        if (rayHitsOtherPart(selfRange)) hits++;
      }

      rawHits[t] = hits;
    }

    // Bucket triangles by their quantized AO level instead of writing a
    // per-vertex color. Every triangle in the same bucket ends up sharing
    // one flat material a moment from now. Quantizing into a fixed AO_LEVELS
    // (rather than one bucket per raw hit count) keeps mesh-building cost
    // flat regardless of SAMPLES — building a BufferGeometry+Mesh per bucket
    // is real overhead, and letting bucket count scale with SAMPLES was what
    // made raising SAMPLES blow up bake time, not the extra raycasting.
    const buckets = Array.from({ length: AO_LEVELS }, () => []);
    for (let t = 0; t < triCount; t++) {
      const normalized = Math.min(1, Math.max(0, rawHits[t] / SAMPLES));
      const level = Math.round(normalized * (AO_LEVELS - 1));
      buckets[level].push(t);
    }

    // Rebuild this part as one mesh per non-empty bucket, each a world-space
    // copy of that bucket's triangles from the original geometry (baking in
    // mesh.matrixWorld rather than keeping it local + copying this mesh's
    // own transform onto the bucket mesh). That matters because some parts'
    // source files nest a detail mesh as a CHILD of another mesh instead of
    // as a sibling — if the parent mesh is processed first in this same
    // loop and removed from ITS OWN parent, a child mesh processed right
    // after would have re-parented its bucket meshes onto that now-orphaned
    // parent, silently dropping them from the export (they'd still exist as
    // objects, just unreachable from exportRoot, so GLTFExporter — and any
    // AR viewer — would never see them: real geometry that quietly
    // vanished). Baking world transforms and adding straight to exportRoot
    // sidesteps the whole "is this mesh's ancestor still attached" question.
    // The material is a clone of the part's already-tinted material (see
    // AR_TINT_OFFSETS/exportVisiblePartsAsGlb, which runs before this),
    // darkened further by that bucket's AO factor — so part-level tint and
    // per-triangle contact AO compose correctly.
    const baseMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const worldPos = new THREE.Vector3();
    const worldNormal = new THREE.Vector3();
    const bucketMeshes = [];

    for (let level = 0; level < AO_LEVELS; level++) {
      const tris = buckets[level];
      if (!tris.length) continue;

      const bucketPositions = new Float32Array(tris.length * 9);
      const bucketNormals = normalAttr ? new Float32Array(tris.length * 9) : null;
      const bucketUvs = uvAttr ? new Float32Array(tris.length * 6) : null;

      tris.forEach((t, bucketIdx) => {
        const srcStart = t * 3;
        for (let v = 0; v < 3; v++) {
          const srcIdx = srcStart + v;
          const dstIdx = bucketIdx * 3 + v;
          worldPos.fromBufferAttribute(posAttr, srcIdx).applyMatrix4(mesh.matrixWorld);
          bucketPositions[dstIdx * 3] = worldPos.x;
          bucketPositions[dstIdx * 3 + 1] = worldPos.y;
          bucketPositions[dstIdx * 3 + 2] = worldPos.z;
          if (bucketNormals) {
            worldNormal.fromBufferAttribute(normalAttr, srcIdx).applyMatrix3(normalMatrix).normalize();
            bucketNormals[dstIdx * 3] = worldNormal.x;
            bucketNormals[dstIdx * 3 + 1] = worldNormal.y;
            bucketNormals[dstIdx * 3 + 2] = worldNormal.z;
          }
          if (bucketUvs) {
            bucketUvs[dstIdx * 2] = uvAttr.getX(srcIdx);
            bucketUvs[dstIdx * 2 + 1] = uvAttr.getY(srcIdx);
          }
        }
      });

      const bucketGeom = new THREE.BufferGeometry();
      bucketGeom.setAttribute('position', new THREE.BufferAttribute(bucketPositions, 3));
      if (bucketNormals) {
        bucketGeom.setAttribute('normal', new THREE.BufferAttribute(bucketNormals, 3));
      } else {
        bucketGeom.computeVertexNormals();
      }
      if (bucketUvs) bucketGeom.setAttribute('uv', new THREE.BufferAttribute(bucketUvs, 2));

      const ao = 1 - (level / (AO_LEVELS - 1)) * STRENGTH;
      const bucketMaterial = baseMaterial.clone();
      bucketMaterial.color?.multiplyScalar(ao);

      const bucketMesh = new THREE.Mesh(bucketGeom, bucketMaterial);
      bucketMesh.name = `${mesh.name || 'part'}_ao${level}`;
      bucketMeshes.push(bucketMesh);
    }

    bucketMeshes.forEach((bucketMesh) => exportRoot.add(bucketMesh));
    if (mesh.parent) mesh.parent.remove(mesh);
  }
}

// Bakes only the currently visible parts (with their applied colors) into a single
// binary glTF so a mobile AR viewer has one self-contained file to place, instead of
// the app's per-part GLBs it normally juggles.
async function exportVisiblePartsAsGlb() {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const visibleParts = Object.keys(modelSets).filter((part) => partVis[part] && loadedMods[part]);

  if (!visibleParts.length) throw new Error('No visible parts to export');

  const exportRoot = new THREE.Group();

  // Native AR viewers (Android Scene Viewer / iOS Quick Look) light the scene
  // with real-world camera-estimated lighting, not this page's in-browser
  // environment/shadow settings — so parts that are the same or even just
  // similar shades of gray can end up completely indistinguishable, no matter
  // how the in-page preview looks. Always nudge each part's lightness apart by
  // a small, fixed amount in this exported copy (never the live scene) —
  // conditionally skipping this whenever 2+ colors were already "different"
  // turned out fragile: adding a part like Hat/Arms from a non-Starter preset
  // was enough to flip that check off and leave the whole build flat again.
  // The offset is small enough that a deliberately-chosen color still reads
  // as that color, just with guaranteed separation from its neighbors.
  visibleParts.forEach((part) => {
    const clone = loadedMods[part].clone(true);
    const offset = AR_TINT_OFFSETS[part] ?? 0;
    clone.traverse((node) => {
      if (!node.isMesh) return;
      // Object3D.clone() copies materials by reference, so clone (not mutate)
      // before tinting or this would recolor the live customizer scene too.
      const wasArray = Array.isArray(node.material);
      const materials = wasArray ? node.material : [node.material];
      const tinted = materials.map((material) => {
        const tintedMaterial = material.clone();
        tintedMaterial.color?.offsetHSL(0, 0, offset);
        return tintedMaterial;
      });
      node.material = wasArray ? tinted : tinted[0];
    });
    exportRoot.add(clone);
  });

  try {
    await bakeContactShadows(exportRoot);
  } catch (error) {
    console.error('Contact-shadow bake failed, exporting without it', error);
  }

  // The app's model space is millimeters (see MODEL_Y_OFFSET, and engrave.html's
  // sliders which label these same raw units as "mm"), but glTF - and every AR
  // viewer that consumes it - assumes 1 unit = 1 meter. Exporting the raw roots
  // makes AR place a robot ~1000x too large. Applied last (after the contact-
  // shadow bake above, which needs plain millimeter distances) so the exported
  // file carries its real-world size.
  exportRoot.scale.setScalar(MM_TO_M);

  const exporter = new GLTFExporter();
  const result = await new Promise((resolve, reject) => {
    exporter.parse(exportRoot, resolve, reject, { binary: true, onlyVisible: true });
  });

  return new Blob([result], { type: 'model/gltf-binary' });
}

let arModelViewerEl = null;
let arBlobUrl = null;

function closeArOverlay() {
  arOverlay.classList.remove('show');
  renderingPaused = false;
  if (arModelViewerEl) {
    arModelViewerEl.remove();
    arModelViewerEl = null;
  }
  if (arBlobUrl) {
    URL.revokeObjectURL(arBlobUrl);
    arBlobUrl = null;
  }
  arModelHost.innerHTML = '';
}

function hasAnyVisiblePart() {
  return Object.keys(modelSets).some((part) => partVis[part] && loadedMods[part]);
}

async function openArQrFlow() {
  arTitle.textContent = 'View on Your Phone';
  arDesc.textContent = 'Scan this with your phone’s camera to open your exact build, then tap the AR icon there to place it in your space.';
  arQrPanel.hidden = false;
  arModelPanel.hidden = true;
  arQrHolder.innerHTML = '';
  arOverlay.classList.add('show');
  arClose.focus();

  const shareUrl = getShareUrl();
  try {
    await ensureQrLibLoaded();
    new window.QRCode(arQrHolder, {
      text: shareUrl,
      width: 180,
      height: 180,
      correctLevel: window.QRCode.CorrectLevel.M
    });
  } catch (error) {
    console.error(error);
    arQrHolder.innerHTML = '';
    const fallback = document.createElement('p');
    fallback.className = 'engrave-note';
    fallback.textContent = 'Could not generate a QR code. Copy this link instead:';
    const code = document.createElement('code');
    code.textContent = shareUrl;
    arQrHolder.appendChild(fallback);
    arQrHolder.appendChild(code);
  }
}

async function openArModelFlow() {
  arTitle.textContent = 'View in AR';
  arDesc.textContent = 'Preparing your build…';
  arQrPanel.hidden = true;
  arModelPanel.hidden = false;
  arModelHost.innerHTML = '<div class="ar-model-loading">Preparing preview…</div>';
  arOverlay.classList.add('show');
  arClose.focus();

  // The customizer's own 3D view is fully covered by this modal and can't be
  // seen anyway — stop its continuous render loop so it isn't competing for
  // CPU with the contact-shadow ray sampling below (exportVisiblePartsAsGlb),
  // which is the difference between the export finishing in ~1s and it
  // stalling badly (or crashing the tab under software/CPU rendering).
  renderingPaused = true;

  try {
    const [blob] = await Promise.all([exportVisiblePartsAsGlb(), ensureModelViewerLoaded()]);
    arBlobUrl = URL.createObjectURL(blob);

    arModelHost.innerHTML = '';
    const mv = document.createElement('model-viewer');
    mv.setAttribute('src', arBlobUrl);
    mv.setAttribute('ar', '');
    mv.setAttribute('ar-modes', 'webxr scene-viewer quick-look');
    mv.setAttribute('camera-controls', '');
    mv.setAttribute('auto-rotate', '');
    // model-viewer's default "neutral" studio lighting is very flat/even, which
    // on a build made of same-colored parts (the common case before someone
    // picks colors) makes part boundaries nearly invisible. "legacy" has a
    // stronger directional key light, and a tighter, more intense contact
    // shadow reads as real depth between stacked/adjacent parts.
    mv.setAttribute('environment-image', 'legacy');
    mv.setAttribute('exposure', '1.1');
    mv.setAttribute('shadow-intensity', '1.4');
    mv.setAttribute('shadow-softness', '0.6');
    arModelHost.appendChild(mv);
    arModelViewerEl = mv;
    arDesc.textContent = 'Rotate to preview, then tap the AR icon (bottom right) to place it in your space.';
  } catch (error) {
    console.error(error);
    arDesc.textContent = 'Could not prepare the AR preview. Please try again.';
    arModelHost.innerHTML = '<div class="ar-model-loading">Something went wrong.</div>';
    // Without this, a failed export leaves the customizer's own render loop
    // paused forever (see the renderingPaused = true above) — every later
    // color/variant change would still update the model's data but never
    // actually redraw, looking exactly like "nothing happens" until a full
    // page reload.
    renderingPaused = false;
  }
}

function setupArPreview() {
  arBtn.addEventListener('click', () => {
    if (!hasAnyVisiblePart()) {
      toast('No visible parts to preview.', 'warn', 1800);
      return;
    }
    if (isTouchLikeDevice()) {
      openArModelFlow();
    } else {
      openArQrFlow();
    }
  });

  arClose.addEventListener('click', closeArOverlay);
  arOverlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeArOverlay();
  });
}

function applyColor(part) {
  const model = loadedMods[part];
  if (!model) return;
  model.traverse((child) => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (!material?.color) return;
      material.color.set(modelCols[part]);
      material.needsUpdate = true;
    });
  });
}

function getPartDisplayName(part) {
  return PART_META.find((meta) => meta.key === part)?.label || part;
}

function updateVariantCounter(part) {
  const el = document.getElementById(`${part}-counter`);
  const list = modelSets[part] || [];
  if (!el) return;
  const idx = (currentIdx[part] ?? 0) + 1;
  el.textContent = `${Math.max(1, idx)}/${list.length || 0}`;
}

function updateAllCounters() {
  Object.keys(modelSets).forEach(updateVariantCounter);
}

function updateComboChip() {
  const chip = document.getElementById('comboChip');
  if (!chip) return;
  const combos = Object.keys(modelSets)
    .filter((part) => partVis[part] && (modelSets[part]?.length || 0) > 0)
    .map((part) => modelSets[part].length)
    .reduce((total, count) => total * count, 1);
  chip.textContent = `Combos: ${combos.toLocaleString()}`;
}

function getOtherConflictingPart(part) {
  if (part === 'arms') return 'bumper';
  if (part === 'bumper') return 'arms';
  return null;
}

function enforceArmsBumperExclusion(partJustEnabled) {
  const other = getOtherConflictingPart(partJustEnabled);
  if (!other || !partVis[other]) return;
  partVis[other] = false;
  const otherBtn = document.getElementById(`${other}-visibility`);
  if (otherBtn) otherBtn.innerHTML = '<span class="material-icons">visibility_off</span>';
  if (loadedMods[other]) loadedMods[other].visible = false;
}

// Every Hat variant was designed against Top_Hats.glb's mount specifically —
// no other Top fits underneath a hat — so unlike the exclusions above, this
// isn't "hide whichever loses": Top must always be coerced to Top_Hats
// rather than hidden, and it always wins regardless of which of Hat/Top was
// touched last. Only steers Top when Top itself is already visible — never
// force-shows a part the user turned off. Cheap and idempotent like
// enforceBottomMotionExclusion, so it's called unconditionally after any
// change that could touch Hat's visibility or Top's variant/visibility.
const HAT_REQUIRED_TOP_FILE = 'Top_Hats.glb';

function enforceHatRequiresTopHats() {
  if (!partVis.hat || !partVis.top) return;
  const requiredIdx = modelSets.top.findIndex((url) => url.endsWith(`/${HAT_REQUIRED_TOP_FILE}`));
  if (requiredIdx === -1 || currentIdx.top === requiredIdx) return;

  currentIdx.top = requiredIdx;
  loadModel('top', true);
  updateVariantCounter('top');
  toast('Top switched to "Hats" — the only top compatible with a hat.', 'warn', 2400);
}

// The `part|file` identity for whatever variant of `part` is currently
// selected, in the same "manifest key + filename" shape tools/compat-checker.js
// uses as its pair keys — the two never need to agree on anything more than
// that shared string format.
function partFileKey(part) {
  const url = modelSets[part]?.[currentIdx[part] ?? 0];
  if (!url) return null;
  return `${part}|${url.split('/').pop()}`;
}

// Loads assets/compatibility.json (written by tools/compat-checker.html) into
// a bidirectional adjacency map of `part|file` -> Set of incompatible
// `part|file` keys, keeping only entries a human has actually confirmed
// ("incompatible" — auto-flagged-but-undecided pairs are not enforced). Fails
// open on any error: the file may not exist yet for a fresh checkout, and a
// missing compatibility map should never block a combination.
async function loadCompatibilityMap() {
  const map = new Map();
  try {
    const res = await fetch('./assets/compatibility.json', { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      Object.values(json.pairs || {}).forEach((entry) => {
        if (entry.status !== 'incompatible') return;
        const a = `${entry.partA}|${entry.fileA}`;
        const b = `${entry.partB}|${entry.fileB}`;
        if (!map.has(a)) map.set(a, new Set());
        if (!map.has(b)) map.set(b, new Set());
        map.get(a).add(b);
        map.get(b).add(a);
      });
    }
  } catch {
    // No compatibility data available — leave the map empty.
  }
  compatibilityMap = map;
  refreshConflictBadges();
}

// Answers "does `part` currently conflict with some other part?" across
// every rule source. Two different shapes on purpose:
//  - The structural rules (arms/bumper, F1-bottom/wheels) are the ones that
//    still auto-hide (see enforceArmsBumperExclusion/enforceBottomMotionExclusion
//    above/below) — a mount-point fact, not a soft overlap, so only the part
//    that lost and is now hidden gets a { hidden: true } conflict to explain why.
//  - The geometry-driven compatibilityMap rules (tools/compat-checker.html)
//    used to auto-hide the same way but that turned out user-hostile —
//    picking one part silently vanishing another, with no direct action
//    taken against it. Those never change visibility at all now: both parts
//    stay exactly as configured, flagged with a { hidden: false } conflict on
//    BOTH sides (the map is symmetric) so the badge reads as "these two
//    clash" rather than "you did something wrong."
// Purely a lookup for the conflict badge UI; never changes visibility itself.
// Uses currentIdx (not the loaded model) so it still answers correctly for a
// part that's been hidden all along and never had loadModel touch it since.
function findConflictFor(part) {
  if (!partVis[part]) {
    if (part === 'arms' || part === 'bumper') {
      const other = getOtherConflictingPart(part);
      if (other && partVis[other]) return { otherPart: other, hidden: true };
    }
    if (part === 'wheels' && partVis.bottom && bottomIsF1Variant()) {
      return { otherPart: 'bottom', hidden: true };
    }
  }
  if (compatibilityMap) {
    const key = partFileKey(part);
    const incompatibleWith = key && compatibilityMap.get(key);
    if (incompatibleWith) {
      for (const other of Object.keys(modelSets)) {
        if (other === part || !partVis[other]) continue;
        const otherKey = partFileKey(other);
        if (otherKey && incompatibleWith.has(otherKey)) return { otherPart: other, hidden: false };
      }
    }
  }
  return null;
}

function removeConflictGhost(part) {
  const ghost = activeGhosts[part];
  if (!ghost) return;
  scene.remove(ghost);
  delete activeGhosts[part];
  const btn = document.getElementById(`${part}-conflict`);
  if (btn) btn.classList.remove('is-previewing');
}

// Clones the part's already-loaded model (bootstrap() preloads every part,
// visible or not — see loadModel) into a translucent red glowing x-ray
// overlay at its real in-scene position, standing in for a part that's
// actually hidden (the structural rules above/below) so there's something to
// see at all. Toggle on/off by clicking the badge again. Only used for that
// hidden case — a geometry conflict uses setConflictHighlight below instead,
// since both parts are already visible and get their highlight shown automatically.
function toggleConflictGhost(part) {
  if (activeGhosts[part]) {
    removeConflictGhost(part);
    return;
  }
  const source = loadedMods[part];
  if (!source) return;

  const ghost = source.clone(true);
  ghost.traverse((node) => {
    if (!node.isMesh) return;
    node.material = new THREE.MeshBasicMaterial({
      color: 0xf6231e, // var(--err)
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    node.castShadow = false;
    node.receiveShadow = false;
  });
  ghost.visible = true;
  scene.add(ghost);
  activeGhosts[part] = ghost;

  const btn = document.getElementById(`${part}-conflict`);
  if (btn) btn.classList.add('is-previewing');
}

// Swaps (or restores) `part`'s own real mesh materials for a translucent
// red one — a direct edit, not a duplicate clone layered on top. A clone
// only shows up wherever it happens to poke past the real, opaque mesh's
// silhouette (a thin rim), because the opaque surface in front hides the
// translucent one behind it everywhere else; editing the real material is
// the only way the part itself actually reads as "red and see-through".
function setConflictHighlight(part, highlighted) {
  const obj = loadedMods[part];
  if (!obj) return;
  obj.traverse((node) => {
    if (!node.isMesh) return;
    if (highlighted) {
      if (!node.userData.preConflictMaterial) node.userData.preConflictMaterial = node.material;
      node.material = new THREE.MeshBasicMaterial({
        color: 0xe2554c, // softer than --err (0xf6231e)
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        side: THREE.DoubleSide
      });
    } else if (node.userData.preConflictMaterial) {
      node.material = node.userData.preConflictMaterial;
      delete node.userData.preConflictMaterial;
    }
  });
}

// Shows/hides each part's conflict badge, keeps the automatic red/transparent
// clash highlight in sync, and retires any hidden-part ghost preview that no
// longer applies. Cheap and idempotent like the enforce* functions above, so
// it's called unconditionally everywhere a part's visibility or variant
// could have changed.
function refreshConflictBadges() {
  for (const part of Object.keys(modelSets)) {
    const btn = document.getElementById(`${part}-conflict`);
    const conflict = findConflictFor(part);
    const isVisibleClash = !!conflict && !conflict.hidden;

    setConflictHighlight(part, isVisibleClash);
    if (!conflict && activeGhosts[part]) removeConflictGhost(part);

    if (!btn) continue;
    btn.classList.toggle('u-hidden', !conflict);
    if (conflict) {
      const label = getPartDisplayName(conflict.otherPart);
      const partLabel = getPartDisplayName(part);
      if (conflict.hidden) {
        btn.title = `Hidden — not compatible with the selected ${label}. Click to preview.`;
        btn.setAttribute('aria-label', `${partLabel} is hidden — not compatible with ${label}. Click to preview.`);
      } else {
        btn.title = `Not compatible with the selected ${label}.`;
        btn.setAttribute('aria-label', `${partLabel} is not compatible with ${label}.`);
      }
    }
  }
}

function bottomIsF1Variant() {
  const url = modelSets.bottom?.[currentIdx.bottom] || '';
  return /bottom_f1/i.test(url);
}

// The F1 bottom's mount doesn't fit any Motion/wheel variant. Unlike
// arms/bumper (either one can knock out the other, whichever was touched
// last), this conflict is one-directional and variant-conditional: Bottom
// always wins, Motion is the one that gets hidden — so call this after ANY
// change that could touch bottom's variant/visibility OR wheels' visibility
// (it's a cheap, idempotent check; harmless to call when nothing changed).
function enforceBottomMotionExclusion() {
  if (!partVis.bottom || !bottomIsF1Variant() || !partVis.wheels) return;

  partVis.wheels = false;
  const wheelsBtn = document.getElementById('wheels-visibility');
  if (wheelsBtn) wheelsBtn.innerHTML = '<span class="material-icons">visibility_off</span>';
  if (loadedMods.wheels) loadedMods.wheels.visible = false;
  updateComboChip();
  toast('Motion hidden — not compatible with the F1 bottom.', 'warn', 2200);
}

function enablePart(part, withToast = true) {
  if (partVis[part]) return;
  partVis[part] = true;
  const visBtn = document.getElementById(`${part}-visibility`);
  if (visBtn) visBtn.innerHTML = '<span class="material-icons">visibility</span>';

  if (loadedMods[part]) {
    loadedMods[part].visible = true;
    if (!loadedMods[part].parent) scene.add(loadedMods[part]);
  } else {
    loadModel(part);
  }

  if (part === 'spacer') {
    loadModel('bottom');
    loadModel('wheels');
  }

  updateComboChip();
  if (withToast) toast(`${getPartDisplayName(part)} enabled`, 'ok', 900);
  markCustomPreset();
}

function hideAppLoader() {
  if (appLoaderHidden || !appLoader) return;
  appLoaderHidden = true;
  appLoader.classList.add('hide');
  appLoader.setAttribute('aria-busy', 'false');
  setTimeout(() => appLoader.remove(), 450);
}

// Elastic overshoot easing — grows past 1.0 then settles back, reads as a
// "pop" rather than a plain fade/grow-in.
function popEase(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function triggerPartPop(part, model) {
  if (prefersReducedMotion) {
    model.scale.setScalar(1);
    return;
  }
  const startScale = 0.7;
  model.scale.setScalar(startScale);
  activePops.set(part, { model, start: performance.now(), duration: 220, startScale });
}

function updatePartPops(now) {
  if (!activePops.size) return;
  for (const [part, pop] of activePops) {
    const t = Math.min(1, (now - pop.start) / pop.duration);
    const scale = pop.startScale + (1 - pop.startScale) * popEase(t);
    pop.model.scale.setScalar(scale);
    if (t >= 1) {
      pop.model.scale.setScalar(1);
      activePops.delete(part);
    }
  }
}

function loadModel(part, animatePop = false) {
  if (part === 'spacer' && !partVis.spacer) return;
  const urls = getAssetCandidates(part, currentIdx[part], 'glb');
  if (!urls.length) {
    updateVariantCounter(part);
    return;
  }

  skeleton.classList.remove('u-hidden');

  // Tags this call as the latest request for `part`. Picking a color for a
  // part that isn't loaded yet (enablePart -> loadModel, async) and then
  // immediately switching its variant before that first load finishes fires
  // a second loadModel() for the same part while the first is still in
  // flight — without this guard, whichever network response happens to
  // arrive LAST wins regardless of which was requested last, so the first
  // (now-stale) response could overwrite the model the user actually asked
  // for a moment later. Only the response matching the most recent call
  // gets applied; earlier ones are silently discarded.
  const myGeneration = (loadGeneration[part] = (loadGeneration[part] || 0) + 1);

  // Counts every in-flight loadModel() call so the first-paint splash can stay
  // up until the initial build has actually finished loading, not just until
  // the page's JS has started running.
  pendingInitialLoads += 1;
  let settled = false;
  const settleInitialLoad = () => {
    if (settled) return;
    settled = true;
    pendingInitialLoads = Math.max(0, pendingInitialLoads - 1);
    if (pendingInitialLoads === 0) hideAppLoader();
  };

  const tryLoad = (index) => {
    loader.load(
      urls[index],
      (gltf) => {
        skeleton.classList.add('u-hidden');
        settleInitialLoad();
        if (loadGeneration[part] !== myGeneration) return; // superseded by a newer request for this part

        if (loadedMods[part]) scene.remove(loadedMods[part]);
        const model = gltf.scene;
        let yOffset = MODEL_Y_OFFSET;
        if (partVis.spacer && ['bottom', 'wheels', 'arms', 'bumper'].includes(part)) {
          yOffset -= 16;
        }
        model.position.y = yOffset;
        model.visible = partVis[part];
        model.traverse((node) => {
          if (node.isMesh) node.castShadow = true;
        });
        loadedMods[part] = model;
        if (partVis[part]) scene.add(model);
        applyColor(part);
        updateVariantCounter(part);
        updateComboChip();
        if (animatePop && partVis[part]) {
          activePops.delete(part);
          triggerPartPop(part, model);
        }
      },
      undefined,
      (error) => {
        if (index < urls.length - 1) {
          tryLoad(index + 1);
          return;
        }
        console.error('Load error', error);
        skeleton.classList.add('u-hidden');
        settleInitialLoad();
        if (loadGeneration[part] !== myGeneration) return;
        toast(`Failed to load ${part} variant.`, 'err', 2400);
      }
    );
  };

  tryLoad(0);
}

function applyPreset(key, showToast = true) {
  const preset = presets[key];
  if (!preset) return;
  isApplyingPreset = true;

  try {
    const toLoad = new Set();

    for (const [part, idx] of Object.entries(preset.parts || {})) {
      if (!modelSets[part]) continue;
      const clamped = clampPresetIndex(part, idx);
      if (currentIdx[part] !== clamped || !loadedMods[part]) {
        currentIdx[part] = clamped;
        toLoad.add(part);
      }
    }

    for (const [part, visible] of Object.entries(preset.visibility || {})) {
      if (typeof visible !== 'boolean') continue;
      partVis[part] = visible;
      const btn = document.getElementById(`${part}-visibility`);
      if (btn) btn.innerHTML = `<span class="material-icons">${visible ? 'visibility' : 'visibility_off'}</span>`;
      if (loadedMods[part]) loadedMods[part].visible = visible;
    }

    if (partVis.arms && partVis.bumper) {
      partVis.bumper = false;
      const bumperBtn = document.getElementById('bumper-visibility');
      if (bumperBtn) bumperBtn.innerHTML = '<span class="material-icons">visibility_off</span>';
      if (loadedMods.bumper) loadedMods.bumper.visible = false;
    }

    toLoad.forEach((part) => loadModel(part, true));
    enforceBottomMotionExclusion();
    enforceHatRequiresTopHats();
    refreshConflictBadges();
    updateAllCounters();
    updateComboChip();
    activePresetKey = key;
    setPresetLabel(preset.label);
    syncPresetButtons(key);
    if (showToast) toast(`${preset.label} preset loaded`, 'ok', 1200);
    saveStateToLocal();
  } finally {
    isApplyingPreset = false;
  }
}

function resetToFactory() {
  applyPreset('starter', false);
  partVis.spacer = false;
  const spacerBtn = document.getElementById('spacer-visibility');
  if (spacerBtn) spacerBtn.innerHTML = '<span class="material-icons">visibility_off</span>';
  if (loadedMods.spacer) {
    scene.remove(loadedMods.spacer);
    loadedMods.spacer = null;
  }

  loadModel('bottom');
  loadModel('wheels');

  for (const part of Object.keys(modelSets)) {
    modelCols[part].set('#d9d9d9');
    applyColor(part);
    const pill = document.getElementById(`${part}-pill`);
    if (pill) {
      pill.style.backgroundColor = '#d9d9d9';
      pill.style.border = '1px solid var(--stroke)';
    }
  }

  updateAllCounters();
  updateComboChip();
  controls.reset();
  activePresetKey = 'starter';
  setPresetLabel(presets.starter.label);
  syncPresetButtons('starter');
  saveStateToLocal();
  toast('Back to default build', 'ok', 1200);
}

async function downloadSelection(format) {
  try {
    await showConsentPopup();
  } catch {
    return;
  }

  const sets = format === 'step' ? stepSets : format === 'glb' ? modelSets : null;
  if (!sets) return;

  const hasVisible = Object.keys(sets).some((part) => partVis[part] && sets[part]?.length);
  if (!hasVisible) {
    toast('No visible parts to download.', 'warn', 1800);
    return;
  }

  toast(`Preparing ${format.toUpperCase()}...`, 'ok', 1200);

  try {
    const zip = new JSZip().folder('models');
    for (const [part, urls] of Object.entries(sets)) {
      if (!partVis[part]) continue;
      const candidates = getAssetCandidates(part, currentIdx[part], format);
      if (!candidates.length) continue;

      let resolved;
      try {
        resolved = await fetchFirstAvailable(candidates);
      } catch (error) {
        console.warn('Fetch failed for', part, error);
        continue;
      }

      const { response, url } = resolved;
      const blob = await response.blob();
      const base = url.split('/').pop() || `${part}.${format}`;
      zip.file(`${part}__${base}`, blob);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, `models_selection_${format.toUpperCase()}.zip`);
    toast(`${format.toUpperCase()} zipped.`, 'ok', 1600);
  } catch (error) {
    console.error(error);
    toast('Download failed. Please try again.', 'err', 2400);
  }
}

// Same zip-of-visible-parts UX as downloadSelection(), but for STL: prefers a
// hosted .stl for each part (see stlSets) and falls back to exporting straight
// from the already-loaded, already-colored model when none is hosted — so this
// always produces a full set even though most variants have no hosted STL yet.
async function downloadSelectionStl() {
  try {
    await showConsentPopup();
  } catch {
    return;
  }

  const visibleParts = Object.keys(modelSets).filter((part) => partVis[part] && loadedMods[part]);
  if (!visibleParts.length) {
    toast('No visible parts to download.', 'warn', 1800);
    return;
  }

  toast('Preparing STL...', 'ok', 1200);

  try {
    const zip = new JSZip().folder('models');
    for (const part of visibleParts) {
      try {
        const hostedUrl = await firstExistingUrl(getAssetCandidates(part, currentIdx[part], 'stl'));
        const blob = hostedUrl
          ? await (await fetch(hostedUrl)).blob()
          : await exportPartAsStlBlob(part);
        zip.file(`${part}.stl`, blob);
      } catch (error) {
        console.warn('STL export failed for', part, error);
      }
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, 'models_selection_STL.zip');
    toast('STL zipped.', 'ok', 1600);
  } catch (error) {
    console.error(error);
    toast('Download failed. Please try again.', 'err', 2400);
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function mountPaletteToBody(palette) {
  const host = document.fullscreenElement || container || document.body;
  if (palette.parentElement !== host) {
    openPaletteOriginalParent = palette.parentElement;
    host.appendChild(palette);
  }
}

function restorePalette(palette) {
  if (openPaletteOriginalParent && openPalette) {
    openPaletteOriginalParent.appendChild(palette);
  }
  openPaletteOriginalParent = null;
}

// #info-tooltip and #more-menu are simple CSS-anchored popovers (position:absolute
// relative to their trigger) that work fine on desktop, but on mobile their trigger
// (#info-container) lives inside .mobile-sheet, which needs overflow:hidden for its
// own rounded-corner/scroll containment — clipping the popover invisible regardless
// of z-index. Reparenting to the top-level host and switching to fixed, JS-computed
// coordinates escapes that clip entirely, same fix as mountPaletteToBody/positionPalette.
function mountFloatingPopup(el) {
  const host = document.fullscreenElement || container || document.body;
  if (el.parentElement !== host) host.appendChild(el);
}

function positionFloatingPopup(el, anchorRect, align = 'left') {
  const pad = 8;
  el.style.position = 'fixed';
  el.style.visibility = 'hidden';
  el.style.left = '0px';
  el.style.top = '0px';
  // Both elements' stylesheet rules position them with `bottom` (and #more-menu
  // also with `right`) instead of top/left. Leaving those active alongside our
  // own top/left constrains BOTH edges on an element with no explicit height,
  // so the browser computes height from the gap between them — collapsing it
  // to a couple of px — instead of sizing to fit the content.
  el.style.bottom = 'auto';
  el.style.right = 'auto';
  el.style.zIndex = '2147483647';

  requestAnimationFrame(() => {
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const rawLeft = align === 'right' ? anchorRect.right - w : anchorRect.left;
    const left = Math.max(8, Math.min(rawLeft, window.innerWidth - w - 8));
    const aboveTop = anchorRect.top - h - pad;
    const top = aboveTop < 8 ? Math.min(window.innerHeight - h - 8, anchorRect.bottom + pad) : aboveTop;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = 'visible';
  });
}

function positionPalette(palette, anchorRect) {
  const pad = 8;
  palette.style.display = 'block';
  palette.classList.add('open');
  palette.querySelectorAll('[data-role="swatch"]').forEach((swatch) => {
    swatch.style.background = swatch.dataset.color;
  });

  const w = palette.offsetWidth || 120;
  const h = palette.offsetHeight || 120;
  const centerX = anchorRect.left + (anchorRect.width / 2);
  const belowY = anchorRect.bottom + pad;
  const aboveY = anchorRect.top - h - pad;
  const openUp = (window.innerHeight - anchorRect.bottom) < (h + 16) && anchorRect.top > (h + 16);

  palette.style.position = 'fixed';
  palette.style.left = `${Math.max(8, Math.min(centerX - (w / 2), window.innerWidth - w - 8))}px`;
  palette.style.top = `${openUp ? Math.max(8, aboveY) : Math.min(belowY, window.innerHeight - h - 8)}px`;
  palette.style.transform = 'none';
  palette.style.zIndex = '2147483647';
}

function reallyClosePalette() {
  if (!openPalette) return;
  openPalette.classList.remove('open');
  openPalette.style.display = 'none';
  openPalette.style.position = '';
  openPalette.style.left = '';
  openPalette.style.top = '';
  openPalette.style.transform = '';
  openPalette.style.zIndex = '';
  restorePalette(openPalette);
  openPalette = null;
}

function shouldAutoStartTour() {
  if (isTouchLikeDevice()) return false; // its step-by-step tooltip layout doesn't fit the mobile sheet well
  try {
    const state = JSON.parse(localStorage.getItem(TOUR_STATE_KEY) || '{}');
    if (state.never === true) return false;
    if (state.doneVersion === TOUR_VERSION) return false;
    if (state.remindAt && Date.now() < state.remindAt) return false;
  } catch {}
  return true;
}

function writeTourState(state) {
  localStorage.setItem(TOUR_STATE_KEY, JSON.stringify(state));
}

function maybeAutostartTour() {
  setTimeout(() => {
    if (shouldAutoStartTour()) startTour(false);
  }, 700);
}

function startTour(force = false) {
  if (tourRunning) return;
  if (isTouchLikeDevice()) return; // never on mobile, even via the manual "Quick tour" link
  if (!force && !shouldAutoStartTour()) return;
  tourRunning = true;

  const steps = [
    { target: '#preset-toggle', title: 'Presets', body: 'Start from a ready-made configuration. Click to open and pick one.' },
    { target: '#controls-toggle', title: 'Panels', body: 'Switch between Essential parts and Advanced add-ons.' },
    { target: '#part-map', title: 'Quick Part Picker', body: 'Click any part on this mini model to jump straight to customizing it — including Hat and Arms, which start hidden in the list.' },
    { target: '#top-pill', title: 'Colors', body: 'Click the color pill for quick presets, or drag in the full picker for any shade you want.' },
    { target: '#top-controls [data-role="next"]', title: 'Variants', body: 'Use the arrows to browse different designs of a part, or click its name to pick from a grid of all of them.' },
    { target: '#top-visibility', title: 'Visibility', body: 'Temporarily hide or show a part to see how it affects the build.' },
    { target: '#top-controls [data-role="print"]', title: 'Direct 3D Print', body: 'Open the current part directly in your slicer using the orcaslicer:// link.' },
    { target: '#download-group', title: 'Export', body: 'Download STL instantly, or open the menu for GLB and STEP.' }
  ];

  const tip = document.createElement('div');
  tip.className = 'tour-tip';
  tip.innerHTML = `
    <button class="tour-close" aria-label="Close tour" title="Close">×</button>
    <h5></h5>
    <div class="tour-body"></div>
    <div class="tour-actions">
      <div class="tour-row">
        <div class="tour-spacer"></div>
        <button class="tour-btn" data-act="prev" aria-label="Previous step">Back</button>
        <button class="tour-btn primary" data-act="next" aria-label="Next step">Next</button>
      </div>
      <div class="tour-meta">
        <button class="tour-link" data-act="snooze" aria-label="Remind me later">Remind me later</button>
        <span class="tour-dot" aria-hidden="true">·</span>
        <button class="tour-link" data-act="skip" aria-label="Never show again">Don’t show again</button>
      </div>
    </div>
  `;

  const host = document.fullscreenElement || container || document.body;
  host.appendChild(tip);

  const title = tip.querySelector('h5');
  const body = tip.querySelector('.tour-body');
  const btnPrev = tip.querySelector('[data-act="prev"]');
  const btnNext = tip.querySelector('[data-act="next"]');
  const btnSkip = tip.querySelector('[data-act="skip"]');
  const btnSnooze = tip.querySelector('[data-act="snooze"]');
  const btnClose = tip.querySelector('.tour-close');

  let index = 0;
  let highlighted = null;

  function readTourState() {
    try { return JSON.parse(localStorage.getItem(TOUR_STATE_KEY) || '{}'); } catch { return {}; }
  }

  function highlight(target) {
    if (highlighted) highlighted.classList.remove('tour-highlight');
    highlighted = target;
    if (highlighted) highlighted.classList.add('tour-highlight');
  }

  function placeTipNear(target) {
    const rect = target.getBoundingClientRect();
    tip.style.visibility = 'hidden';
    tip.style.left = '0px';
    tip.style.top = '0px';
    requestAnimationFrame(() => {
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      let top = rect.bottom + 10;
      const left = Math.min(Math.max(rect.left, 8), window.innerWidth - tw - 8);
      if (top + th > window.innerHeight - 8) top = rect.top - th - 10;
      if (top < 8) top = Math.min(window.innerHeight - th - 8, Math.max(8, rect.bottom + 10));
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
      tip.style.visibility = 'visible';
    });
  }

  function show() {
    // Colors/Variants/Visibility/Print steps all target #top-* controls, which
    // only exist in the DOM (and are only reachable) while Essential is showing.
    if (index >= 3 && index <= 6) showEssentialPanel();
    const step = steps[index];
    const target = document.querySelector(step.target);
    if (!target) {
      if (index < steps.length - 1) {
        index += 1;
        show();
      }
      return;
    }

    title.textContent = step.title;
    body.textContent = step.body;
    highlight(target);
    placeTipNear(target);
    btnPrev.disabled = index === 0;
    btnNext.textContent = index === steps.length - 1 ? 'Finish' : 'Next';
  }

  function end({ saveDone = false, never = false, snoozeDays = 0 } = {}) {
    if (highlighted) highlighted.classList.remove('tour-highlight');
    tip.remove();
    tourRunning = false;

    const state = readTourState();
    if (never) {
      state.never = true;
    } else if (snoozeDays > 0) {
      state.remindAt = Date.now() + (snoozeDays * 24 * 60 * 60 * 1000);
    } else if (saveDone) {
      state.doneVersion = TOUR_VERSION;
      state.remindAt = 0;
    }
    writeTourState(state);
  }

  btnNext.addEventListener('click', () => {
    if (index < steps.length - 1) {
      index += 1;
      show();
    } else {
      end({ saveDone: true });
      toast('You can reopen the tour from the Info button.', 'ok', 1800);
    }
  });
  btnPrev.addEventListener('click', () => {
    if (index > 0) {
      index -= 1;
      show();
    }
  });
  btnSnooze.addEventListener('click', () => end({ snoozeDays: 30 }));
  btnSkip.addEventListener('click', () => end({ never: true }));
  btnClose.addEventListener('click', () => end({ saveDone: true }));

  show();
}

function animate() {
  requestAnimationFrame(animate);
  if (renderingPaused) return;
  controls.update();
  updatePartPops(performance.now());
  renderer.render(scene, camera);
}

resetBtn.addEventListener('click', () => {
  controls.reset();
  toast('View reset', 'ok', 900);
});

factoryResetBtn.addEventListener('click', () => {
  resetToFactory();
});

randomizeBtn.addEventListener('click', () => {
  for (const part of Object.keys(modelSets)) {
    if (!modelSets[part].length) continue;
    currentIdx[part] = Math.floor(Math.random() * modelSets[part].length);
    loadModel(part, true);
  }
  enforceBottomMotionExclusion();
  enforceHatRequiresTopHats();
  refreshConflictBadges();
  markCustomPreset();
  toast('Randomized!', 'ok', 900);

  // Playful tumble on the dice icon — restart the animation even on rapid
  // repeat clicks by removing the class first (a class already present
  // doesn't retrigger its animation just by re-adding it).
  randomizeBtn.classList.remove('is-rolling');
  void randomizeBtn.offsetWidth; // force reflow so the removal actually takes effect first
  randomizeBtn.classList.add('is-rolling');
});
randomizeBtn.addEventListener('animationend', () => randomizeBtn.classList.remove('is-rolling'));

shareBtn.addEventListener('click', () => {
  copyShareLink();
});
