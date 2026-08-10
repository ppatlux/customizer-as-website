import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSET_MANIFEST } from './asset-manifest.js';
import { SLICER_LABELS, getPreferredSlicer, setPreferredSlicer } from './slicer-preference.js';

const COLOR_OPTIONS = ['#231F20', '#549EF7', '#00D072', '#FFBD3B', '#A89EFA', '#CE4A4A', '#E6E6E6', '#FFFFFF'];
const PART_META = [
  { key: 'top', label: 'Top', panel: 'essential' },
  { key: 'middle', label: 'Middle', panel: 'essential' },
  { key: 'face', label: 'Face', panel: 'essential' },
  { key: 'bottom', label: 'Bottom', panel: 'essential' },
  { key: 'wheels', label: 'Motion', panel: 'essential' },
  { key: 'hat', label: 'Hat', panel: 'advanced' },
  { key: 'arms', label: 'Arms', panel: 'advanced' },
  { key: 'spacer', label: 'Spacer', panel: 'advanced' },
  { key: 'bumper', label: 'Bumper', panel: 'advanced' },
  { key: 'tail', label: 'Tail', panel: 'advanced', hidden: true }
];

const MODEL_Y_OFFSET = 30;
const STATE_KEY = 'hp_robot_customizer_state';
const TOUR_VERSION = 'standalone-v1';
const TOUR_STATE_KEY = 'hp_robot_tour_state';
const ADVANCED_DEFAULTS = new Set(['hat', 'arms', 'bumper', 'tail']);
const MODEL_VIEWER_SRC = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js';
const QRCODE_LIB_SRC = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
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

const mf3Sets = Object.fromEntries(
  Object.entries(localModelSets).map(([part, files]) => [part, files.map((file) => file.replace(/\.glb$/i, '.3mf'))])
);

const remoteMf3Sets = Object.fromEntries(
  Object.entries(remoteModelSets).map(([part, files]) => [part, files.map((file) => file.replace(/\.glb$/i, '.3mf'))])
);

const presets = {
  starter: {
    label: 'Starter Kit',
    description: 'Essentials, advanced hidden',
    parts: { top: 0, middle: 0, face: 0, bottom: 0, wheels: 0, hat: 0, arms: 1, bumper: 0, tail: 0, spacer: 0 },
    visibility: { top: true, middle: true, face: true, bottom: true, wheels: true, hat: false, arms: false, bumper: false, tail: false, spacer: false }
  },
  invent: {
    label: 'Walk and Roll',
    description: 'Invent expansion kit',
    parts: { top: 0, middle: 0, face: 0, bottom: 0, wheels: 1, hat: 0, arms: 1, bumper: 0, tail: 0, spacer: 0 },
    visibility: { top: true, middle: true, face: true, bottom: true, wheels: true, hat: false, arms: false, bumper: false, tail: false, spacer: false }
  },
  sensor: {
    label: 'Sensor Scout',
    description: 'Dual sensors with RGB face',
    parts: { top: 2, middle: 0, face: 1, bottom: 0, wheels: 1, hat: 1, arms: 0, bumper: 0, tail: 0, spacer: 0 },
    visibility: { top: true, middle: true, face: true, bottom: true, wheels: true, hat: true, arms: true, bumper: false, tail: false, spacer: false }
  },
  showtime: {
    label: 'Showtime Parade',
    description: 'MP3 top, matrix face and hat',
    parts: { top: 1, middle: 0, face: 2, bottom: 0, wheels: 1, hat: 2, arms: 1, bumper: 0, tail: 0, spacer: 0 },
    visibility: { top: true, middle: true, face: true, bottom: true, wheels: true, hat: true, arms: true, bumper: false, tail: false, spacer: false }
  }
};

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
const exitMaxBtn = document.getElementById('exit-maximize');
const dlMenu = document.getElementById('download-menu');
const dlPrimary = document.getElementById('download-primary');
const dlToggle = document.getElementById('download-toggle');
const dlGlbBtn = document.getElementById('downloadGlbBtn');
const dl3mfBtn = document.getElementById('download3mfBtn');
const moreToggle = document.getElementById('more-toggle');
const moreMenu = document.getElementById('more-menu');
const moreFactoryResetBtn = document.getElementById('moreFactoryResetBtn');
const moreDownloadStepBtn = document.getElementById('moreDownloadStepBtn');
const moreDownloadGlbBtn = document.getElementById('moreDownloadGlbBtn');
const moreDownload3mfBtn = document.getElementById('moreDownload3mfBtn');
const slicerToggle = document.getElementById('slicer-toggle');
const slicerMenu = document.getElementById('slicer-menu');
const slicerBadgeCurrent = document.getElementById('slicer-badge-current');
const essBtn = document.getElementById('show-essential');
const advBtn = document.getElementById('show-advanced');
const essPanel = document.getElementById('panel-essential');
const advPanel = document.getElementById('panel-advanced');
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
const modelCols = {};
const partVis = {};
const occludedParts = new Set(['middle', 'bumper', 'tail', 'bottom', 'wheels']);

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

for (const part of Object.keys(modelSets)) {
  currentIdx[part] = 0;
  modelCols[part] = new THREE.Color('#d9d9d9');
  partVis[part] = !ADVANCED_DEFAULTS.has(part);
}
partVis.spacer = false;

bootstrap();

function renderPanels() {
  const essential = document.getElementById('panel-essential');
  const advanced = document.getElementById('panel-advanced');
  essential.innerHTML = PART_META.filter((part) => part.panel === 'essential').map(renderPartSection).join('');
  advanced.innerHTML = PART_META.filter((part) => part.panel === 'advanced').map(renderPartSection).join('');
}

function renderPartSection(part) {
  const palette = COLOR_OPTIONS.map((color) => {
    const whiteClass = color === '#FFFFFF' ? ' white' : '';
    return `<div class="color-swatch${whiteClass}" data-role="swatch" data-part="${part.key}" data-color="${color}" title="${color}"></div>`;
  }).join('');

  return `
    <div class="model-section" id="${part.key}-controls"${part.hidden ? ' style="display:none"' : ''}>
      <div class="model-controls-row">
        <button class="btn btn--sm btn--ghost" data-role="prev" data-part="${part.key}" aria-label="Previous ${part.label}">
          <span class="material-icons">chevron_left</span>
        </button>
        <span class="model-label">
          ${part.label}
          <span class="variant-counter" id="${part.key}-counter" aria-live="polite">-/ -</span>
        </span>
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
        <button class="btn btn--sm btn--ghost" data-role="download-part" data-part="${part.key}" title="Download STEP" aria-label="Download ${part.label} STEP file">
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
  setupKeyboardNav();
  setupGlobalClickHandler();
  setupArPreview();
  if (isTouchLikeDevice()) setupMobileSheet();
  populatePresetMenu();

  const restoredFromShareLink = tryRestoreFromUrl();
  if (!restoredFromShareLink) tryRestoreFromLocal();

  for (const part of Object.keys(modelSets)) {
    if (part === 'spacer' && !partVis.spacer) continue;
    loadModel(part);
  }

  if (!restoredFromLocal) {
    applyPreset('starter', false);
  } else {
    setPresetLabel('Custom mix');
    syncPresetButtons('');
    updateAllCounters();
    updateComboChip();
    saveStateToLocal();
    if (restoredFromShareLink) toast('Loaded shared build', 'ok', 1800);
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

  infoBtn.addEventListener('mouseenter', () => {
    clearTimeout(tipTimeout);
    infoTip.style.display = 'block';
    infoBtn.setAttribute('aria-expanded', 'true');
  });
  infoBtn.addEventListener('mouseleave', () => {
    tipTimeout = setTimeout(() => {
      infoTip.style.display = 'none';
      infoBtn.setAttribute('aria-expanded', 'false');
    }, 180);
  });
  infoTip.addEventListener('mouseenter', () => clearTimeout(tipTimeout));
  infoTip.addEventListener('mouseleave', () => {
    infoTip.style.display = 'none';
    infoBtn.setAttribute('aria-expanded', 'false');
  });

  // Touch devices have no hover, so tapping the info button toggles the tip directly.
  infoBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    clearTimeout(tipTimeout);
    const isOpen = infoTip.style.display === 'block';
    infoTip.style.display = isOpen ? 'none' : 'block';
    infoBtn.setAttribute('aria-expanded', String(!isOpen));
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest('#info-container')) return;
    infoTip.style.display = 'none';
    infoBtn.setAttribute('aria-expanded', 'false');
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
  essPanel.style.display = 'flex';
  advPanel.style.display = 'none';
  essBtn.classList.add('active');
  advBtn.classList.remove('active');
  essBtn.setAttribute('aria-selected', 'true');
  advBtn.setAttribute('aria-selected', 'false');
  reallyClosePalette();
  if (mobileLayoutActive) setMobileSheetState('expanded');
}

function showAdvancedPanel() {
  essPanel.style.display = 'none';
  advPanel.style.display = 'flex';
  advBtn.classList.add('active');
  essBtn.classList.remove('active');
  advBtn.setAttribute('aria-selected', 'true');
  essBtn.setAttribute('aria-selected', 'false');
  reallyClosePalette();
  if (mobileLayoutActive) setMobileSheetState('expanded');
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

// Moves the real #info-container and both .model-controls panels into the
// mobile bottom sheet instead of rendering separate copies — every existing
// control (color pills, palettes, counters, the more/download menus...) keeps
// working with zero duplicated logic, it just lives in a new DOM location.
function setupMobileSheet() {
  mobileSheetEl = document.getElementById('mobile-sheet');
  mobileSheetHandleEl = document.getElementById('mobile-sheet-handle');
  const listHost = document.getElementById('mobile-sheet-list');
  const actionsHost = document.getElementById('mobile-sheet-actions');
  const infoContainerEl = document.getElementById('info-container');

  if (!mobileSheetEl || !mobileSheetHandleEl || !listHost || !actionsHost || !infoContainerEl) return;

  mobileLayoutActive = true;
  listHost.appendChild(essPanel);
  listHost.appendChild(advPanel);
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
    setMobileSheetState('peek');
  });

  setMobileSheetState('peek');
}

function setupDownloadMenu() {
  dlPrimary.addEventListener('click', (event) => {
    event.preventDefault();
    downloadSelection('step');
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

  dl3mfBtn.addEventListener('click', (event) => {
    event.preventDefault();
    downloadSelection('3mf');
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
  moreDownloadStepBtn.addEventListener('click', () => {
    closeMoreMenu();
    downloadSelection('step');
  });
  moreDownloadGlbBtn.addEventListener('click', () => {
    closeMoreMenu();
    downloadSelection('glb');
  });
  moreDownload3mfBtn.addEventListener('click', () => {
    closeMoreMenu();
    downloadSelection('3mf');
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('#more-group')) return;
    closeMoreMenu();
  });
}

function openMoreMenu() {
  moreMenu.classList.add('open');
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

  document.querySelectorAll('[data-role="print"]').forEach((btn) => {
    const part = btn.getAttribute('data-part');
    const partLabel = PART_META.find((entry) => entry.key === part)?.label || part;
    btn.title = `Open in ${label}`;
    btn.setAttribute('aria-label', `Open ${partLabel} in ${label}`);
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
      mountPaletteToBody(palette);
      positionPalette(palette, pill.getBoundingClientRect());
      openPalette = palette;
    });
  });

  document.addEventListener('pointerup', (event) => {
    const swatch = event.target.closest('.color-palette [data-role="swatch"]');
    if (!swatch) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const part = swatch.dataset.part;
    const hex = swatch.dataset.color;
    if (!partVis[part]) enablePart(part, false);
    modelCols[part].set(hex);
    applyColor(part);

    const pill = document.getElementById(`${part}-pill`);
    if (pill) {
      pill.style.backgroundColor = hex;
      pill.style.border = hex.toLowerCase() === '#ffffff' ? '1px solid #000' : '1px solid var(--stroke)';
    }

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

function setupKeyboardNav() {
  container.addEventListener('keydown', (event) => {
    const section = event.target.closest('.model-section');
    if (!section) return;
    const part = section.id.replace('-controls', '');
    if (!part || !modelSets[part]) return;

    if (event.key === 'ArrowLeft') {
      if (!partVis[part]) enablePart(part, false);
      currentIdx[part] = wrapIndex(part, currentIdx[part] - 1);
      loadModel(part);
      markCustomPreset();
      event.preventDefault();
    } else if (event.key === 'ArrowRight') {
      if (!partVis[part]) enablePart(part, false);
      currentIdx[part] = wrapIndex(part, currentIdx[part] + 1);
      loadModel(part);
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

    let touched = false;

    if (role === 'prev') {
      const wasHidden = !partVis[part];
      if (wasHidden) enablePart(part, false);
      currentIdx[part] = wrapIndex(part, currentIdx[part] - 1);
      loadModel(part);
      if (wasHidden) enforceArmsBumperExclusion(part);
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
      loadModel(part);
      if (wasHidden) enforceArmsBumperExclusion(part);
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
      }

      if (partVis[part]) enforceArmsBumperExclusion(part);
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
      const url = getPreferredPublicAssetUrl(part, currentIdx[part], 'step');
      if (!url) {
        toast(`No STEP file available for ${part}.`, 'warn', 1800);
        return;
      }
      const slicer = getPreferredSlicer();
      const protocol = slicer === 'prusa' ? 'prusaslicer' : 'orcaslicer';
      const link = document.createElement('a');
      link.href = `${protocol}://open?file=${encodeURIComponent(new URL(url, window.location.href).href)}`;
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

      const urls = getAssetCandidates(part, currentIdx[part], 'step');
      if (!urls.length) {
        toast(`No STEP file available for ${part}.`, 'warn', 1800);
        return;
      }

      try {
        const { response } = await fetchFirstAvailable(urls);
        const blob = await response.blob();
        downloadBlob(blob, `${part}.step`);
        toast(`${part} STEP downloaded.`, 'ok', 1600);
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
  [essPanel, advPanel].forEach((panel) => {
    panel.style.width = `${nextWidth}px`;
  });
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
  const localSets = format === 'step' ? stepSets : format === '3mf' ? mf3Sets : localModelSets;
  const remoteSets = format === 'step' ? remoteStepSets : format === '3mf' ? remoteMf3Sets : remoteModelSets;

  return uniqueUrls([
    localSets[part]?.[idx],
    remoteSets[part]?.[idx]
  ]);
}

function getPreferredPublicAssetUrl(part, idx, format = 'glb') {
  const remoteSets = format === 'step' ? remoteStepSets : format === '3mf' ? remoteMf3Sets : remoteModelSets;
  const localSets = format === 'step' ? stepSets : format === '3mf' ? mf3Sets : localModelSets;
  return remoteSets[part]?.[idx] || localSets[part]?.[idx] || null;
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

function isTouchLikeDevice() {
  try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; }
}

let modelViewerLoadPromise = null;
function ensureModelViewerLoaded() {
  if (customElements.get('model-viewer')) return Promise.resolve();
  if (!modelViewerLoadPromise) {
    modelViewerLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = MODEL_VIEWER_SRC;
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
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load the QR code library'));
      document.head.appendChild(script);
    });
  }
  return qrLibLoadPromise;
}

// Casts hemisphere-sampled rays from every vertex against a combined BVH of
// all visible parts and darkens vertex colors where nearby geometry blocks
// them — a real, ray-traced contact shadow (hat-into-head, arm-into-body
// seams, etc.) baked directly into the file. This is the only thing that
// actually fixes "AR has no shadows": native AR viewers (Android Scene
// Viewer, iOS Quick Look) render with real-world camera-estimated lighting
// and ignore every in-page environment/shadow-intensity setting we can set
// on <model-viewer> — those only ever affected the in-browser preview. What
// they DO respect is vertex color data baked into the glTF itself, since
// that's just per-vertex multiplication against the material, not a
// lighting effect. Must run before exportRoot gets its mm→m export scale
// (see exportVisiblePartsAsGlb) so distances below are plain millimeters.
async function bakeContactShadows(exportRoot) {
  const { MeshBVH } = await import('three-mesh-bvh');
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');

  exportRoot.updateMatrixWorld(true);

  const meshes = [];
  exportRoot.traverse((node) => { if (node.isMesh) meshes.push(node); });
  if (!meshes.length) return;

  const worldPositionGeoms = meshes
    .map((mesh) => {
      const positions = mesh.geometry.getAttribute('position');
      if (!positions) return null;
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', positions.clone());
      if (mesh.geometry.index) geom.setIndex(mesh.geometry.index.clone());
      geom.applyMatrix4(mesh.matrixWorld);
      return geom.index ? geom.toNonIndexed() : geom;
    })
    .filter(Boolean);
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

    // One AO sample per triangle, applied uniformly to all 3 of its
    // vertices (flat shading) instead of one sample per vertex smoothly
    // interpolated across faces. That distinction matters a lot here: this
    // robot is hard-surface/mechanical geometry with flat faces and sharp
    // edges, and per-vertex AO interpolates smoothly across a shared edge
    // between a shadowed and a lit face — which reads as the face being
    // subtly curved, i.e. the whole model looking inflated/bloated, not as
    // a shadow. Flat-shading per triangle needs each triangle to own
    // independent vertices, hence the conversion to non-indexed first (an
    // indexed mesh shares vertices between adjacent triangles, which would
    // force the same smooth interpolation right back).
    if (mesh.geometry.index) {
      mesh.geometry = mesh.geometry.toNonIndexed();
    }
    const geom = mesh.geometry;
    const posAttr = geom.getAttribute('position');
    const triCount = Math.floor(posAttr.count / 3);
    const colors = new Float32Array(posAttr.count * 3).fill(1); // default: fully lit, no occluder nearby

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
      edge1.subVectors(pB, pA);
      edge2.subVectors(pC, pA);
      faceNormal.crossVectors(edge1, edge2);

      // Degenerate/zero-area triangle. A zero-length normal downstream would
      // carry NaN/zero components into every ray — which turned into a
      // catastrophic BVH traversal (NaN comparisons are always false in JS,
      // defeating the tree's branch-and-bound pruning) rather than a clean
      // per-ray failure, and was actually behind the 40+ second hangs and
      // outright page crashes seen while developing this.
      if (faceNormal.lengthSq() < 1e-10) continue;
      faceNormal.normalize();

      // Arbitrary tangent basis around the face normal, for hemisphere sampling.
      tangent.set(1, 0, 0);
      if (Math.abs(faceNormal.dot(tangent)) > 0.9) tangent.set(0, 1, 0);
      tangent.crossVectors(faceNormal, tangent).normalize();
      bitangent.crossVectors(faceNormal, tangent);

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
        if (combinedBvh.raycastFirst(ray, THREE.DoubleSide, 0, MAX_DIST)) hits++;
      }

      const ao = 1 - (hits / SAMPLES) * STRENGTH;
      for (const idx of [i0, i1, i2]) {
        colors[idx * 3] = ao;
        colors[idx * 3 + 1] = ao;
        colors[idx * 3 + 2] = ao;
      }
    }

    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      material.vertexColors = true;
      material.needsUpdate = true;
    });
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

function loadModel(part) {
  if (part === 'spacer' && !partVis.spacer) return;
  const urls = getAssetCandidates(part, currentIdx[part], 'glb');
  if (!urls.length) {
    updateVariantCounter(part);
    return;
  }

  skeleton.classList.remove('u-hidden');

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
        skeleton.classList.add('u-hidden');
        settleInitialLoad();
      },
      undefined,
      (error) => {
        if (index < urls.length - 1) {
          tryLoad(index + 1);
          return;
        }
        console.error('Load error', error);
        toast(`Failed to load ${part} variant.`, 'err', 2400);
        skeleton.classList.add('u-hidden');
        settleInitialLoad();
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

    toLoad.forEach((part) => loadModel(part));
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

  const sets = format === 'step' ? stepSets : format === 'glb' ? modelSets : format === '3mf' ? mf3Sets : null;
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
  if (!force && !shouldAutoStartTour()) return;
  tourRunning = true;

  const steps = [
    { target: '#preset-toggle', title: 'Presets', body: 'Start from a ready-made configuration. Click to open and pick one.' },
    { target: '#controls-toggle', title: 'Panels', body: 'Switch between Essential parts and Advanced add-ons.' },
    { target: '#top-pill', title: 'Colors', body: 'Click the color pill to pick a color for the Top.' },
    { target: '#top-controls [data-role="next"]', title: 'Variants', body: 'Use the arrows to browse different designs of a part.' },
    { target: '#top-visibility', title: 'Visibility', body: 'Temporarily hide or show a part to see how it affects the build.' },
    { target: '#top-controls [data-role="print"]', title: 'Direct 3D Print', body: 'Open the current part directly in OrcaSlicer using the orcaslicer:// link.' },
    { target: '#download-group', title: 'Export', body: 'Download STEP instantly, or open the menu for GLB and 3MF.' }
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
    if (index >= 2 && index <= 5) showEssentialPanel();
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
    loadModel(part);
  }
  markCustomPreset();
  toast('Randomized!', 'ok', 900);
});

shareBtn.addEventListener('click', () => {
  copyShareLink();
});
