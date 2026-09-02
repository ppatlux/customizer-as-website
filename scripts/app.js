import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSET_MANIFEST } from './asset-manifest.js';
import { PRESETS as presets, normalizeMixPartColor } from './presets.js';
import { SLICER_LABELS, getPreferredSlicer, setPreferredSlicer, PRUSA_SLICER_LIVE } from './slicer-preference.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// Accelerated raycasting for every Mesh. The paint-bucket / hover hit-test
// (getPaintHit) casts up to ~30 rays per pointer sample against every visible
// part; without a BVH each of those is O(triangles) once the ray enters a
// mesh's bounding box, which on the heavier multi-megabyte GLBs made simply
// moving the cursor over the model drop frames. A per-geometry BVH (built once
// in loadModel) turns each ray into a ~log(triangles) tree descent instead.
// acceleratedRaycast falls back to the stock path for any geometry without a
// boundsTree, so this is safe even before/if one is missing.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// Used by syncPrintButtonBranding() — declared up here (not next to that
// function) because bootstrap() calls into it synchronously at module-eval
// time via setupSettingsMenu(), before the rest of the file below this point
// has run; a const declared further down would still be in its temporal
// dead zone at that point and throw.
const SLICER_LOGO_SRC = {
  prusa: './assets/icons/prusaslicer-logo.png',
  orca: './assets/icons/orcaslicer-logo.png'
};

// Preferred format for the primary Download button (bottom toolbar) — set
// from the Downloads switch in the Settings modal. Same TDZ reasoning as
// SLICER_LOGO_SRC above for why this lives up here.
const DOWNLOAD_FORMAT_STORAGE_KEY = 'hprobot:preferredDownloadFormat';
const DOWNLOAD_FORMAT_LABELS = { stl: 'STL', glb: 'GLB', step: 'STEP' };

function getPreferredDownloadFormat() {
  const stored = window.localStorage.getItem(DOWNLOAD_FORMAT_STORAGE_KEY);
  return DOWNLOAD_FORMAT_LABELS[stored] ? stored : 'stl';
}

function setPreferredDownloadFormat(format) {
  if (!DOWNLOAD_FORMAT_LABELS[format]) return;
  window.localStorage.setItem(DOWNLOAD_FORMAT_STORAGE_KEY, format);
}

const COLOR_OPTIONS = ['#231F20', '#549EF7', '#00D072', '#FFBD3B', '#A89EFA', '#CE4A4A', '#E6E6E6', '#FFFFFF'];
// Default part color — must stay one of COLOR_OPTIONS' own swatches so a
// freshly loaded/reset part visually matches a selectable palette entry.
const DEFAULT_PART_COLOR = '#E6E6E6';
// Pseudo part-key for the global "paint any piece" tool (#globalPaintBtn) —
// not a real entry in modelSets/loadedMods. Bucket mode keys off this the
// same way it keys off a real part string; see getPaintHit/setBucketMode for
// the one place that actually branches on it.
const GLOBAL_PAINT_KEY = '__all__';
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

// Per-variant display-name overrides, keyed `part|filename`. prettyVariantLabel
// derives a label from the filename by default; entries here win over that for
// cases where the file name and the name we want to show diverge (e.g. the
// "Spoiler_F1" hat is shown simply as "Spoiler", the "Bottom_F1" bottom as
// "Racing"). Only affects the label — the file, the compatibility key, and the
// preset reference all still use the real filename.
const VARIANT_LABEL_OVERRIDES = {
  'hat|Spoiler_F1.glb': 'Spoiler',
  'bottom|Bottom_F1.glb': 'Racing'
};

const MODEL_Y_OFFSET = 30;
// A visible Spacer lengthens the mid-section, so the parts that hang off the
// lower body drop by this much to stay aligned in the frame. This is the ONE
// place the amount / affected-parts list lives — see spacerYOffset() and
// refreshSpacerOffsets().
const SPACER_DROP = 16;
const SPACER_AFFECTED_PARTS = ['bottom', 'wheels', 'arms', 'bumper'];
const STATE_KEY = 'hp_robot_customizer_state';
const COLOR_HISTORY_KEY = 'hp_robot_color_history';
const COLOR_HISTORY_MAX = 10;
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

// `mixonly` is NOT a part — it's a bag of standalone models that only appear
// while a ready-made mix listing them in `extras` is active (see presets.js).
// Keep it out of every part-keyed map so it never shows as a category, variant,
// swatch, combo-count factor, etc. Its models are looked up by filename below.
const PART_MANIFEST = Object.fromEntries(
  Object.entries(ASSET_MANIFEST).filter(([part]) => part !== 'mixonly')
);

const localModelSets = Object.fromEntries(
  Object.entries(PART_MANIFEST).map(([part, files]) => [
    part,
    files.map((entry) => `./assets/models/${entry.folder}/${entry.file}`)
  ])
);

const remoteModelSets = Object.fromEntries(
  Object.entries(PART_MANIFEST).map(([part, files]) => [
    part,
    files.map((entry) => entry.source)
  ])
);

const modelSets = localModelSets;

// filename -> local URL for the `mixonly` models. A preset's `extras: [...]`
// array names files from here; setMixExtras() loads them into mixExtrasGroup
// when that mix is applied and drops them when another mix is picked. They are
// shown as authored (own materials, no paint swatch, no visibility row).
const mixExtraUrls = new Map(
  (ASSET_MANIFEST.mixonly || []).map((entry) => [entry.file, `./assets/models/${entry.folder}/${entry.file}`])
);

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

// `presets` (the ready-made mixes) is imported from ./presets.js so the
// standalone colour tool (tools/mix-colorizer.html) can share the exact same
// definitions. See that file for the filename-not-index rationale.

// Per-mix, per-part colours authored by tools/mix-colorizer.html and written
// to assets/mix-colors.json. Shape: { [presetKey]: { [part]: '#hex' } }. Only
// used to tint the Mixes-tab preview thumbnails — applying a mix still loads
// every part in DEFAULT_PART_COLOR, same as before. Fails open: the file may
// not exist (fresh checkout, nothing authored yet), in which case every
// thumbnail just falls back to DEFAULT_PART_COLOR and looks like the live app.
let mixColors = {};
const mixColorsReady = (async () => {
  try {
    const res = await fetch('./assets/mix-colors.json', { cache: 'no-store' });
    if (res.ok) mixColors = (await res.json()) || {};
  } catch {
    // No mix-colors.json — thumbnails fall back to the default part colour.
  }
  return mixColors;
})();

renderPanels();

const container = document.getElementById('viewer-container');
const toastStack = document.getElementById('toastStack');
const skeleton = document.getElementById('skeleton');
const appLoader = document.getElementById('app-loader');
const presetMenu = document.getElementById('preset-menu');
const presetToggle = document.getElementById('preset-toggle');
const presetButtons = Array.from(document.querySelectorAll('.preset-option[data-preset]'));
const presetLabelEl = document.getElementById('preset-active-label');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const visibilityModeBtn = document.getElementById('visibilityModeBtn');
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
const dlPrimary = document.getElementById('download-primary');
const moreToggle = document.getElementById('more-toggle');
const moreMenu = document.getElementById('more-menu');
const moreFactoryResetBtn = document.getElementById('moreFactoryResetBtn');
const moreDownloadStlBtn = document.getElementById('moreDownloadStlBtn');
const moreDownloadGlbBtn = document.getElementById('moreDownloadGlbBtn');
const moreDownloadStepBtn = document.getElementById('moreDownloadStepBtn');
const settingsToggle = document.getElementById('settingsToggle');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsClose = document.getElementById('settings-close');
const startTourBtn = document.getElementById('startTourBtn');
const essBtn = document.getElementById('show-essential');
const advBtn = document.getElementById('show-advanced');
const essPanel = document.getElementById('panel-essential');
const consentOverlay = document.getElementById('consent-overlay');
const consentCheckbox = document.getElementById('consent-checkbox');
const consentConfirm = document.getElementById('consent-confirm');
const consentCancel = document.getElementById('consent-cancel');

const loader = new GLTFLoader();
loader.setCrossOrigin('anonymous');

// No scene.background / opaque clear color -- the canvas renders transparent
// so the page's own background (the dot-grid pattern on body, see app.css)
// shows through behind the robot instead of being hidden under a flat fill.
// The ground plane is a ShadowMaterial (near-fully transparent itself, only
// darkening where a shadow actually falls), so this doesn't lose anything.
const scene = new THREE.Scene();

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
// Cap at 2: above that the fragment count (this scene is fill-rate bound — big
// translucent parts, a full-frame shadow pass) climbs faster than the visible
// sharpness gain, and some of the heavier GLBs already push frame time.
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0xffffff, 0);
renderer.shadowMap.enabled = true;
container.appendChild(renderer.domElement);

const perspectiveCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
// Placeholder frustum -- real bounds come from updateCameraProjection() once
// there's a real container size, and again from toggleProjection() (matched
// to whatever the perspective camera was showing) the first time it's used.
const orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
let camera = perspectiveCamera;
// Orthographic camera's vertical half-extent at zoom=1 -- kept independent of
// aspect ratio (see updateCameraProjection) so a window resize alone never
// changes the apparent zoom level while in orthographic mode.
let orthoViewSize = 60;

camera.position.set(-91, 54, 111);
camera.lookAt(9, 23, -3);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(9, 23, -3);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
// Without a floor, scrolling to zoom in (perspective mode) dollies the
// camera arbitrarily close to -- or inside -- the model, at which point
// camera.near (0.1) starts slicing through nearby geometry: a hard, flat,
// angle-dependent cut ("a plane cutting the hidden 3D models") that's most
// obvious on hidden-part ghost previews, since their translucency makes the
// jagged near-plane edge visible instead of just hidden behind an opaque
// surface. 20 keeps the camera safely outside the robot's own bounds (it's
// roughly 100-150 units across) while still allowing a close-up look.
controls.minDistance = 20;
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

// Orthographic is the default projection -- switches the active camera right
// after its initial framing is set above, reusing toggleProjection's own
// perspective->ortho math so the default view matches whatever framing was
// just computed (desktop vs. touch) instead of duplicating it here.
toggleProjection(true);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyLight.position.set(100, 200, 100);
keyLight.castShadow = true;
// 1024 rather than 2048: shadowMap.autoUpdate is on, so the full shadow pass
// (every high-poly caster, re-rendered) runs every frame even while just
// orbiting. Halving the map's dimensions quarters that pass's cost for a
// barely-perceptible softness change on a single soft ground shadow.
keyLight.shadow.mapSize.set(1024, 1024);
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
  // depthWrite:false — it's a transparent shadow-catcher, it should never
  // occlude anything via the depth buffer. Left on, this 500x500 plane at
  // y=0 slices a hard horizontal line through every V-mode ghost preview
  // that dips below the floor ("a plane cutting the hidden models").
  // Shadows are rendered in a separate pass and are unaffected.
  new THREE.ShadowMaterial({ opacity: 0.1, depthWrite: false })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const currentIdx = {};
const loadedMods = {};
const loadGeneration = {};
const modelCols = {};

// Holds the standalone `mixonly` models for whichever ready-made mix (if any)
// is active — see setMixExtras() and presets.js `extras`. Lifted by
// MODEL_Y_OFFSET like every part; children keep their authored transform.
const mixExtrasGroup = new THREE.Group();
mixExtrasGroup.position.y = MODEL_Y_OFFSET;
scene.add(mixExtrasGroup);
let activeMixExtras = []; // filenames currently in mixExtrasGroup
let mixExtrasToken = 0;   // guards against out-of-order async loads

// Per-mix code panel state (see renderMixCodePanel, far below). Declared here
// because syncShowcaseMode() -> renderMixCodePanel() runs during bootstrap(),
// well before those functions' own spot in the file is evaluated.
let mixCodeEl = null;
const mixCodeCache = new Map(); // codeId -> { code, ok }
// Per-object paint overrides for parts built from multiple meshes (see the
// "paint pieces" bucket tool). Shape: { [part]: { [variantIndex]: { [meshIndex]: hex } } }.
// Keyed by variant index (not just part) because mesh layout/order differs
// between variants of the same part — an override that made sense for one
// variant's mesh #3 would be meaningless (or wrong) applied to another's.
const modelMeshCols = {};
const partVis = {};
// True only while Motion is hidden *by enforceBottomMotionExclusion itself*
// (an F1/Boat bottom), as opposed to the user having turned it off on
// purpose. Lets that function restore Motion automatically once the
// conflicting bottom is swapped away (randomize, prev/next, presets) instead
// of leaving it stuck hidden forever — see enforceBottomMotionExclusion.
let wheelsAutoHiddenByBottom = false;
const activePops = new Map();
const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const occludedParts = new Set(['middle', 'bumper', 'tail', 'bottom', 'wheels']);

// Populated by loadCompatibilityMap() from assets/compatibility.json (built by
// tools/compat-checker.html). Stays null until that fetch resolves — every
// reader below treats null as "no rules yet" and fails open rather than
// blocking anything, since the file may not exist for a fresh checkout.
//
// Two edge sets: `compatibilityMap` is the no-spacer verdicts;
// `compatibilityMapSpacer` is the same graph but with each spacer-sensitive
// pair's "+ spacer" verdict applied instead (the Spacer drops bumper / arms /
// bottom / wheels 16, which clears or creates clashes against face / middle /
// etc). activeCompatMap() picks the one that matches the current build.
let compatibilityMap = null;
let compatibilityMapSpacer = null;

function activeCompatMap() {
  return partVis.spacer ? compatibilityMapSpacer : compatibilityMap;
}

// Both used by countValidBuilds()/updateComboChip(), which bootstrap() calls
// synchronously (via applyPreset) at module-eval time -- so, like
// SLICER_LOGO_SRC and friends at the top of this file, they must be declared
// up here rather than next to that code further down, or they'd still be in
// their temporal dead zone when bootstrap runs and throw. countValidBuilds()
// memo, keyed by visible-part set; cleared when the compatibility map loads.
let comboCountCache = new Map();
// Every Hat variant is modelled against Top_Hats.glb's mount, so a visible Hat
// pins Top to that file (see enforceHatRequiresTopHats).
const HAT_REQUIRED_TOP_FILE = 'Top_Hats.glb';

// part -> translucent red preview clone currently sitting in the scene (see
// toggleConflictGhost/refreshConflictBadges below). Declared up here rather
// than next to those functions because bootstrap() — called near the top of
// this module — synchronously reaches code that reads it (via the initial
// restore/preset pass calling refreshConflictBadges): a `const` declared
// further down would still be in its temporal dead zone at that point.
const activeGhosts = {};

// True while the Tinkercad-style "press V" visibility-edit mode is active
// (see setupVisibilityEditMode below): every hidden part is rendered as a
// translucent blue-outlined ghost and clicking any part in the viewport
// toggles it, until V exits and hidden parts go back to actually invisible.
let visibilityEditMode = false;

const GHOST_FILL_OPACITY = 0.3;
const GHOST_EDGE_BASE_OPACITY = 0.7;
const GHOST_EDGE_PULSE_AMPLITUDE = 0.22;
const GHOST_FADE_MS = 260;
const GHOST_PULSE_PERIOD_MS = 1800;
// Plain opacity pulsing on a 1px-ish outline barely registers -- WebGL line
// rendering leans on antialiasing/sub-pixel coverage more than true alpha
// blending, so an opacity swing that reads clearly on a filled triangle is
// nearly invisible on a thin line. Pulsing the line's color/brightness too
// (crossfading toward a lighter blue at the peak) is what actually makes the
// "breathing" edge glow visible, matching Tinkercad's hidden-shape highlight.
const GHOST_EDGE_COLOR_BASE = new THREE.Color(0x3d7fff);
const GHOST_EDGE_COLOR_PEAK = new THREE.Color(0xbcdcff);

// Meshes currently animating as a V-mode ghost -- fading in, pulsing at
// steady state, or fading out -- tracked independently of visibilityEditMode
// itself so a fade-out kicked off right as the user exits the mode (or
// clicks a ghost to reveal it) still gets to finish smoothly instead of
// being cut off the instant the mode flag flips. See updateGhostAnimation.
// Declared up here (not next to updateGhostAnimation itself), same reason as
// activeGhosts above: bootstrap()'s first animate() call reaches this
// synchronously, before a `const` declared further down the file would have
// left its temporal dead zone.
const ghostAnimNodes = new Set();

// EdgesGeometry(node.geometry, 30) is a real computation -- it walks every
// triangle to find and dedupe sharp edges -- and re-running it from scratch
// on every single V-mode entry (previously: fresh THREE.EdgesGeometry each
// time, disposed again on every exit) was the actual cause of "V feels slow":
// with several hidden parts each carrying multiple meshes, that's the same
// expensive computation redone synchronously on every press. Caching per
// source geometry means it's only ever computed once per mesh for as long as
// that geometry object exists (a variant swap loads new geometry, a fresh
// cache miss, which is correct) -- every V-press after the first for a given
// part is then just cheap traversal + object creation, no geometry math.
//
// Computed lazily, only the first time a given part is actually ghosted. An
// earlier version also warmed this cache eagerly for every part right after
// loadModel() finished (scheduleGhostEdgesPreload), but once the model assets
// grew to multi-megabyte, multi-mesh GLBs that turned into a multi-hundred-ms
// synchronous EdgesGeometry pass on every single part switch -- for parts the
// user might never ghost -- which pinned the main thread and made switching
// parts lag badly. Lazy means that cost is paid once, on demand, by the one
// action that needs it (entering V-mode with that part hidden).
const ghostEdgesGeometryCache = new WeakMap();
function getGhostEdgesGeometry(geometry) {
  let edges = ghostEdgesGeometryCache.get(geometry);
  if (!edges) {
    edges = new THREE.EdgesGeometry(geometry, 30);
    ghostEdgesGeometryCache.set(geometry, edges);
  }
  return edges;
}

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
// Work that must not compete with the initial build for the main thread /
// network / GPU — chiefly the 8 preset-mix thumbnails, each of which loads
// ~6 GLBs and does an offscreen WebGL render. On desktop that overlap is
// invisible; on a tablet it's what kept the loading screen up for ages. These
// run once hideAppLoader() fires (or the 12s splash-timeout does).
let firstBuildDone = false;
const afterFirstBuildQueue = [];
function runAfterFirstBuild(fn) {
  if (firstBuildDone) { setTimeout(fn, 0); return; }
  afterFirstBuildQueue.push(fn);
}
let mobileLayoutActive = false;
let mobileSheetEl = null;
let mobileSheetHandleEl = null;
let renderingPaused = false;
let openVariantGridPart = null;
let thumbRenderer3D = null;
// Part currently in "paint pieces" bucket mode, or null. While set, clicking a
// mesh belonging to loadedMods[bucketModePart] in the main viewer paints just
// that mesh with the palette's current brush color instead of recoloring the
// whole part. See setupBucketTool().
let bucketModePart = null;
let paintHoverMesh = null;
// Set by setupBucketTool() — called once per rendered frame from animate() to
// process the latest queued pointermove for bucket-paint hover, batching the
// (potentially expensive) raycast instead of running it on every raw event.
let paintHoverFlush = null;
const variantThumbCache = {};
const variantThumbPromises = {};
const presetThumbCache = {};
const presetThumbPromises = {};
// Guards renderPresetCarousel against rebuilding its cards on every open —
// set true once, checked/read as early as bootstrap() itself (called below,
// synchronously, from setupRightDockTabs), so it has to live up here with
// the rest of this early state rather than next to the function that uses it.
let presetCarouselBuilt = false;
const pickerHSV = {};
// Most-recently-used brush colors across any bucket-paint action (global or
// per-part), most recent first — see recordColorHistory. Persisted across
// sessions in localStorage; only #globalPaintBtn's panel displays it today
// (renderColorHistorySwatches), but every paint action feeds it regardless
// of which palette it came from.
let colorHistory = [];

for (const part of Object.keys(modelSets)) {
  currentIdx[part] = 0;
  modelCols[part] = new THREE.Color(DEFAULT_PART_COLOR);
  partVis[part] = !ADVANCED_DEFAULTS.has(part);
}
partVis.spacer = false;

bootstrap();

function renderPanels() {
  const essential = document.getElementById('panel-essential');
  essential.innerHTML = PART_META.map(renderPartSection).join('');
  renderColorSidebar();
  renderGlobalPaintPalette();
}

// Secondary, collapsed-by-default panel listing every part's color in one
// place, for anyone who wants to target one specific part rather than paint
// freehand — see #color-sidebar-toggle. The primary way to change color is
// #globalPaintBtn (renderGlobalPaintPalette below), which paints straight on
// the model without picking a part first. Reuses the exact same color-palette
// popover and data-role="color-pill" wiring the old per-part pill used;
// only the trigger's location and size change. Excludes part.hidden entries
// (tail has no assets yet, so there's nothing for its pill to control).
function renderColorSidebar() {
  const host = document.getElementById('color-sidebar');
  if (!host) return;
  host.innerHTML = PART_META.filter((part) => !part.hidden).map((part) => `
    <div class="color-sidebar-row">
      <span class="color-sidebar-label">${part.label}</span>
      <div class="color-pill color-pill--lg" id="${part.key}-pill" data-role="color-pill" data-part="${part.key}" title="Pick color for ${part.label}"></div>
    </div>
  `).join('');
}

// The color picker for #globalPaintBtn (see #global-paint-picker in
// index.html) — the same swatch-grid/hue-picker markup every per-part
// palette uses, just not tied to any one part, and always visible rather
// than something you have to open first. Everything here uses the
// pseudo-part key GLOBAL_PAINT_KEY, which the rest of the paint-bucket code
// (setBrushColor, the swatch/hex/drag handlers, etc.) already treats
// generically — see the `part === GLOBAL_PAINT_KEY` checks added alongside
// their normal `bucketModePart === part` ones, needed because this picker
// stays interactive even while paint mode itself is off. Only click-to-paint
// itself (getPaintTargetGroups) special-cases GLOBAL_PAINT_KEY to search
// every visible part instead of one fixed model.
function renderGlobalPaintPalette() {
  const host = document.getElementById('global-paint-picker');
  if (!host) return;
  const swatches = COLOR_OPTIONS.map((color) => {
    const whiteClass = color === '#FFFFFF' ? ' white' : '';
    return `<div class="color-swatch${whiteClass}" data-role="swatch" data-part="${GLOBAL_PAINT_KEY}" data-color="${color}" style="background:${color}" title="${color}"></div>`;
  }).join('');

  host.innerHTML = `
    <div id="${GLOBAL_PAINT_KEY}-palette" class="color-palette-inline">
      <div class="color-swatch-grid">${swatches}</div>
      <div class="color-history-row u-hidden" data-role="color-history-row">
        <span class="color-history-label">Recent</span>
        <div class="color-history-swatches" data-role="color-history"></div>
      </div>
      <div class="color-picker-advanced">
        <div class="color-picker-sv" data-role="picker-sv" data-part="${GLOBAL_PAINT_KEY}">
          <div class="color-picker-sv-thumb" data-role="picker-sv-thumb"></div>
        </div>
        <div class="color-picker-hue" data-role="picker-hue" data-part="${GLOBAL_PAINT_KEY}">
          <div class="color-picker-hue-thumb" data-role="picker-hue-thumb"></div>
        </div>
        <div class="color-picker-hex-row">
          <span class="color-picker-preview" data-role="picker-preview"></span>
          <span class="color-picker-hash">#</span>
          <input type="text" class="color-picker-hex" data-role="picker-hex" data-part="${GLOBAL_PAINT_KEY}" maxlength="6" spellcheck="false" autocomplete="off" aria-label="Brush color">
        </div>
      </div>
      <button type="button" class="bucket-reset-btn u-hidden" data-role="global-reset" title="Reset all custom piece colors">
        <span class="material-icons">restart_alt</span>
        <span data-role="global-reset-label">Reset all</span>
      </button>
      <p class="bucket-hint">${isTouchCapable() ? 'Tap' : 'Click'} any piece on the model to paint it. ${isTouchCapable() ? 'Long-press' : 'Right-click'} a painted piece to reset just that one.</p>
    </div>
  `;
  // colorHistory itself isn't loaded yet at this point (see the pickerHSV
  // comment below — same module-init-order reason); renderColorHistorySwatches()
  // runs again once setupGlobalPaintTool() has actually loaded it.
  // Not seeded here: this runs from renderPanels(), called at module init
  // before pickerHSV exists yet (it's declared further down, alongside the
  // rest of the UI-interaction state). setupGlobalPaintTool() seeds it once
  // bootstrap() actually starts, which is early enough that it's already
  // showing a real color before the first paint of the page.
}

function renderPartSection(part) {
  const swatches = COLOR_OPTIONS.map((color) => {
    const whiteClass = color === '#FFFFFF' ? ' white' : '';
    return `<div class="color-swatch${whiteClass}" data-role="swatch" data-part="${part.key}" data-color="${color}" style="background:${color}" title="${color}"></div>`;
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
    <div class="bucket-row">
      <button type="button" class="bucket-toggle-btn" data-role="bucket-toggle" data-part="${part.key}" aria-pressed="false" title="Paint individual pieces of this part with the color above">
        <span class="material-icons">format_color_fill</span>
        <span data-role="bucket-toggle-label">Paint pieces</span>
      </button>
      <button type="button" class="bucket-reset-btn u-hidden" data-role="bucket-reset" data-part="${part.key}" title="Reset custom piece colors" aria-label="Reset custom piece colors for ${part.label}">
        <span class="material-icons">restart_alt</span>
        <span data-role="bucket-reset-label">Reset</span>
      </button>
    </div>
    <p class="bucket-hint u-hidden" data-role="bucket-hint" data-part="${part.key}">
      ${isTouchCapable() ? 'Tap' : 'Click'} a piece to paint it. ${isTouchCapable() ? 'Long-press' : 'Right-click'} a painted piece to reset just that one.
    </p>
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
        <!-- Desktop hides this in favor of #color-sidebar's bigger version of the
             same trigger (see renderColorSidebar) — kept here, not removed, so
             touch devices (no room for a persistent left sidebar) still have a
             color entry point right on the part's own row. -->
        <div class="color-pill color-pill--inline" id="${part.key}-pill-inline" data-role="color-pill" data-part="${part.key}" title="Pick color for ${part.label}"></div>
        <button class="btn btn--sm btn--ghost" id="${part.key}-visibility" data-role="visibility" data-part="${part.key}" aria-label="Toggle visibility for ${part.label}">
          <span class="material-icons">visibility</span>
        </button>
        <!-- title/aria-label/icon are placeholders — syncPrintButtonBranding() overwrites
             all three to match the preferred slicer on load. -->
        <button class="btn btn--sm btn--ghost" data-role="print" data-part="${part.key}" title="Send to PrusaSlicer" aria-label="Send ${part.label} to PrusaSlicer">
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
  setupFullscreen();
  setupPresetMenu();
  setupPanels();
  setupDownloadMenu();
  setupMoreMenu();
  setupSettingsMenu();
  setupPaletteWiring();
  setupColorPickerDrag();
  setupColorPickerHexInput();
  setupBucketTool();
  setupGlobalPaintTool();
  setupColorSidebarToggle();
  setupRightDockTabs();
  setupModelHoverPopup();
  setupVariantGrid();
  setupKeyboardNav();
  setupVisibilityShortcut();
  setupCameraDebugReadout();
  setupGlobalClickHandler();
  setupArPreview();
  if (isTouchLikeDevice()) setupMobileSheet();
  populatePresetMenu();

  const restoredFromShareLink = tryRestoreFromUrl();
  if (!restoredFromShareLink) tryRestoreFromLocal();

  if (restoredFromLocal) {
    // applySavedState() (called by the two restore attempts above) only sets
    // currentIdx/partVis/modelCols/modelMeshCols — it doesn't load anything
    // itself, so the restored indices still need an explicit load pass here.
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
  animate();
  maybeAutostartTour();
  saveStateToLocal();
}

// Re-fits whichever camera (perspective or orthographic) is currently active
// to the container's current aspect ratio. Perspective just needs .aspect;
// orthographic needs its left/right/top/bottom recomputed from orthoViewSize
// (its zoom-independent vertical half-extent) times the aspect ratio, so a
// resize alone reflows the frame without changing the apparent zoom level.
function updateCameraProjection() {
  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;
  if (!w || !h) return;
  const aspect = w / h;
  if (camera.isPerspectiveCamera) {
    camera.aspect = aspect;
  } else {
    camera.left = -orthoViewSize * aspect;
    camera.right = orthoViewSize * aspect;
    camera.top = orthoViewSize;
    camera.bottom = -orthoViewSize;
  }
  camera.updateProjectionMatrix();
}

function setupResize() {
  function onResize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    updateCameraProjection();
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
    closeSettingsMenu();
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
    closeSettingsMenu();
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
    closeSettingsMenu();
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
  // Phones show every part on the Parts tab all the time — nothing to switch to.
  if (mobileLayoutActive) return;
  const panel = PART_META.find((meta) => meta.key === part)?.panel;
  if (panel === 'advanced' && !advBtn.classList.contains('active')) showAdvancedPanel();
}

// Switches the mobile sheet between its two pages (mixes carousel / part list),
// mirroring the desktop right-dock tabs. Kept as its own function so the
// "follow the last interaction" callers (applyPreset -> mixes, any part change
// -> parts) can drive it without duplicating the aria/class bookkeeping.
function setMobileSheetTab(tab) {
  if (!mobileSheetEl || mobileSheetEl.dataset.tab === tab) return;
  mobileSheetEl.dataset.tab = tab;
  const mixesTab = document.getElementById('mobile-tab-mixes');
  const partsTab = document.getElementById('mobile-tab-parts');
  mixesTab?.classList.toggle('active', tab === 'mixes');
  partsTab?.classList.toggle('active', tab === 'parts');
  mixesTab?.setAttribute('aria-selected', String(tab === 'mixes'));
  partsTab?.setAttribute('aria-selected', String(tab === 'parts'));
}

// focusPart: which part's row peek should land on. Omit for "top of list"
// (e.g. opening the sheet fresh); pass a part key after interacting with it
// (variant/color change) so peek keeps showing that same part instead of
// always jumping back to the first one.
function setMobileSheetState(state, focusPart) {
  if (!mobileSheetEl) return;
  // A part interaction (variant/color/visibility) always passes focusPart —
  // make sure the Parts page is the one showing so the change is visible.
  if (focusPart) setMobileSheetTab('parts');
  // Expanding the sheet brings up the full part list — the docked on-model
  // stepper would just float over it, so dismiss it (same idea as a contextual
  // bar closing when you open the full panel it's a shortcut into).
  if (state === 'expanded') hideModelHoverPopupNow();
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
  const mixesHost = document.getElementById('mobile-sheet-mixes');
  const infoContainerEl = document.getElementById('info-container');
  const presetCarousel = document.getElementById('preset-carousel');

  if (!mobileSheetEl || !mobileSheetHandleEl || !listHost || !actionsHost || !mixesHost || !infoContainerEl) return;

  mobileLayoutActive = true;
  // Parts tab shows every part, always — no Essential/Advanced split on phones
  // (#controls-toggle is CSS-hidden here). The list is short enough to scroll.
  essPanel.classList.remove('hide-advanced');
  listHost.appendChild(essPanel);
  // Mixes tab: the same carousel the desktop dock builds, just reparented and
  // restyled as a horizontal swipe strip (see the coarse CSS block).
  if (presetCarousel) mixesHost.appendChild(presetCarousel);
  actionsHost.appendChild(infoContainerEl);

  // The two GLOBAL model modes live in the desktop #left-tools column, which is
  // hidden on touch — reparent their controls into the phone top bar. Both
  // already work by tap on the model (see the canvas click handler: bucketMode
  // paints any piece, visibilityEditMode toggles any part); this just surfaces
  // the entry points. #global-paint-panel brings its own colour picker with it.
  const mobileTools = document.getElementById('mobile-tools');
  const globalPaintPanel = document.getElementById('global-paint-panel');
  const visModeBtn = document.getElementById('visibilityModeBtn');
  if (mobileTools) {
    if (visModeBtn) mobileTools.appendChild(visModeBtn);
    if (globalPaintPanel) mobileTools.appendChild(globalPaintPanel);
  }

  // Same builder the desktop dock uses. Cards render immediately (grey thumb
  // box + title); the 3D thumbnails fill in async and are cached after the
  // first pass, same as on desktop.
  renderPresetCarousel();

  document.getElementById('mobile-tab-mixes')?.addEventListener('click', () => setMobileSheetTab('mixes'));
  document.getElementById('mobile-tab-parts')?.addEventListener('click', () => setMobileSheetTab('parts'));

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
    if (event.target.closest('.color-palette, .variant-grid-panel, #more-menu, #model-hover-popup')) return;
    setMobileSheetState('peek');
  });

  setMobileSheetState('peek');
}

// GLB/STEP downloads are wired in setupSettingsMenu() now — they moved into
// the Settings modal alongside the rest of the Downloads section.
function setupDownloadMenu() {
  dlPrimary.addEventListener('click', (event) => {
    event.preventDefault();
    downloadSelectionStl();
  });
}

// Mobile-only overflow menu standing in for factoryResetBtn + #download-primary,
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

// A proper modal (not an anchored dropdown) since it now holds several
// unrelated groups of controls — Preferred Slicer, Camera, Downloads, Help —
// see .settings-section in app.css for how to add more groups here later
// without growing the toolbar itself. Same open/close pattern as #ar-overlay.
function setupSettingsMenu() {
  if (!settingsToggle || !settingsOverlay) return;

  updateSlicerUi();
  updateProjectionUi();
  updateDownloadFormatUi();

  settingsToggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openSettingsMenu();
  });

  settingsClose?.addEventListener('click', closeSettingsMenu);
  settingsOverlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSettingsMenu();
  });
  // Click on the dimmed backdrop itself (not the card, not anything inside
  // it) closes the modal, same as clicking outside any other popover here.
  settingsOverlay.addEventListener('click', (event) => {
    if (event.target === settingsOverlay) closeSettingsMenu();
  });

  settingsOverlay.querySelectorAll('.settings-switch-option[data-slicer]').forEach((item) => {
    item.addEventListener('click', (event) => {
      event.preventDefault();
      if (item.getAttribute('aria-disabled') === 'true') return;
      setPreferredSlicer(item.dataset.slicer);
      updateSlicerUi();
    });
  });

  settingsOverlay.querySelectorAll('.settings-switch-option[data-projection]').forEach((item) => {
    item.addEventListener('click', (event) => {
      event.preventDefault();
      setProjection(item.dataset.projection);
    });
  });

  settingsOverlay.querySelectorAll('.settings-switch-option[data-format]').forEach((item) => {
    item.addEventListener('click', (event) => {
      event.preventDefault();
      setPreferredDownloadFormat(item.dataset.format);
      updateDownloadFormatUi();
    });
  });

  startTourBtn?.addEventListener('click', () => {
    closeSettingsMenu();
    startTour(true);
  });
}

function openSettingsMenu() {
  settingsOverlay.classList.add('show');
  settingsToggle.setAttribute('aria-expanded', 'true');
  settingsClose?.focus();
}

function closeSettingsMenu() {
  if (!settingsOverlay) return;
  settingsOverlay.classList.remove('show');
  settingsToggle?.setAttribute('aria-expanded', 'false');
}

function updateSlicerUi() {
  const slicer = getPreferredSlicer();
  const label = SLICER_LABELS[slicer];

  document.querySelectorAll('.settings-switch-option[data-slicer]').forEach((item) => {
    item.setAttribute('aria-checked', String(item.dataset.slicer === slicer));

    // PrusaSlicer previews as a disabled "coming soon" option until
    // PRUSA_SLICER_LIVE flips on (see slicer-preference.js) — everything
    // else about this menu is already fully live.
    const isLockedPrusa = item.dataset.slicer === 'prusa' && !PRUSA_SLICER_LIVE;
    if (isLockedPrusa) {
      item.setAttribute('aria-disabled', 'true');
      item.title = 'Coming soon — waiting on a PrusaSlicer update';
    } else {
      item.removeAttribute('aria-disabled');
      item.removeAttribute('title');
    }
    const note = item.querySelector('[data-role="slicer-note"]');
    if (note) note.textContent = isLockedPrusa ? 'Soon' : '';
  });

  if (settingsToggle) {
    settingsToggle.title = `Settings — preferred slicer: ${label}`;
    settingsToggle.setAttribute('aria-label', `Settings — preferred slicer: ${label}`);
  }

  syncPrintButtonBranding(slicer, label);
}

function updateProjectionUi() {
  const mode = camera.isPerspectiveCamera ? 'perspective' : 'orthographic';
  document.querySelectorAll('.settings-switch-option[data-projection]').forEach((item) => {
    item.setAttribute('aria-checked', String(item.dataset.projection === mode));
  });
}

// Sets which format the primary Download button (bottom toolbar) uses — a
// preference, same idea as Preferred Slicer, not an action. Mobile's
// #more-menu keeps its own separate explicit STL/GLB/STEP buttons regardless
// of this, since there's no single "primary" download button there to be
// smart about.
function updateDownloadFormatUi() {
  const format = getPreferredDownloadFormat();
  const label = DOWNLOAD_FORMAT_LABELS[format];

  document.querySelectorAll('.settings-switch-option[data-format]').forEach((item) => {
    item.setAttribute('aria-checked', String(item.dataset.format === format));
  });

  if (dlPrimary) {
    dlPrimary.title = `Download ${label}`;
    dlPrimary.setAttribute('aria-label', `Download ${label}`);
  }
}

// Every [data-role="print"] button (each part's row, plus the on-model hover
// popup) shows the currently preferred slicer's real logo instead of a
// generic print icon, so "Send to X" stays correct wherever the button
// appears — called once at bootstrap and again any time the preference
// changes. Logo assets: assets/icons/{prusaslicer,orcaslicer}-logo.png (see
// SLICER_LOGO_SRC near the top of the file).
function syncPrintButtonBranding(slicer = getPreferredSlicer(), label = SLICER_LABELS[slicer]) {
  const icon = `<img class="slicer-logo-img" src="${SLICER_LOGO_SRC[slicer]}" alt="" aria-hidden="true">`;

  document.querySelectorAll('[data-role="print"]').forEach((btn) => {
    const part = btn.dataset.part;
    btn.innerHTML = icon;
    btn.title = `Send to ${label}`;
    btn.setAttribute('aria-label', part ? `Send ${getPartDisplayName(part)} to ${label}` : `Send to ${label}`);
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
      updateBucketResetVisibility(part);
    });
  });

  document.addEventListener('pointerup', (event) => {
    const swatch = event.target.closest('.color-palette [data-role="swatch"], .color-palette-inline [data-role="swatch"]');
    if (!swatch) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const part = swatch.dataset.part;
    const hex = swatch.dataset.color;
    // GLOBAL_PAINT_KEY's picker is always visible, not gated behind its own
    // palette being "open" the way a per-part one is — so it's always brush-
    // only, whether or not paint mode currently happens to be switched on.
    if (bucketModePart === part || part === GLOBAL_PAINT_KEY) {
      setBrushColor(part, hex);
      return;
    }
    applyLiveColor(part, hex);
    markCustomPreset();
    reallyClosePalette();
    // Same as changing a variant — collapse back to the model with this part
    // still front and center in peek instead of leaving the sheet expanded.
    if (mobileLayoutActive) setMobileSheetState('peek', part);
  }, { passive: false });

  document.addEventListener('click', (event) => {
    if (event.target.closest('.color-palette')) return;
    // The global paint picker is always part of the page (.color-palette-inline,
    // not .color-palette) — a click inside it isn't "outside" any palette,
    // it just isn't itself the trigger for closing whatever per-part one
    // (if any) happens to also be open.
    if (event.target.closest('.color-palette-inline')) return;
    if (event.target.closest('[data-role="color-pill"]')) return;
    // A click that just painted a mesh via the bucket tool (see
    // setupBucketTool) — the canvas isn't part of the palette DOM-wise, so
    // without this it would read as "click outside" and close the palette
    // the user still needs open to keep picking brush colors.
    if (bucketModePart && event.target === renderer.domElement) return;
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
  syncPillColor(part);
}

// Every distinct color currently in play for `part`: its base color plus
// whatever per-piece paint overrides exist for its current variant. Not
// proportional to how many meshes use each one — just "what colors are on
// this part right now", for syncPillColor to represent honestly.
function getPartColorList(part) {
  const baseHex = `#${modelCols[part].getHexString()}`.toUpperCase();
  const overrides = getMeshOverrides(part);
  const colors = new Set([baseHex]);
  if (overrides) {
    for (const hex of Object.values(overrides)) colors.add(hex.toUpperCase());
  }
  return Array.from(colors);
}

// Hard-edged stripe (not a blurred blend) so multiple colors read as
// "several distinct pieces", not as one muddy averaged color. Returns null
// for a single color — callers fall back to a plain background-color then,
// which layers underneath .color-pill's own CSS sheen overlay instead of
// replacing it (see syncPillColor).
function buildSwatchStripBackgroundImage(hexes) {
  if (hexes.length <= 1) return null;
  const step = 100 / hexes.length;
  const stops = hexes.map((hex, i) => `${hex} ${(i * step).toFixed(3)}%, ${hex} ${((i + 1) * step).toFixed(3)}%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

// Two pill elements exist per part — the big one in #color-sidebar (desktop)
// and the small inline one on the part's own row (touch devices, see
// .color-pill--inline) — only one is visible at a time, but both need to
// stay in sync so neither shows a stale color if the viewport crosses the
// desktop/touch breakpoint.
//
// Reads the part's CURRENT actual appearance (see getPartColorList) rather
// than taking a color as an argument — painting a piece with the bucket
// tool never touches modelCols, so a pill that only ever showed
// modelCols[part] directly went stale the moment "Paint any piece" touched
// any part of it. With more than one color in play this renders as a strip
// of swatches instead of picking one arbitrarily, so the pill never lies
// about what's actually on the model.
//
// Sets backgroundColor/backgroundImage as separate longhands rather than the
// `background` shorthand deliberately: .color-pill's own CSS already paints
// a subtle glossy sheen via its own background-image layer, and an inline
// shorthand would silently wipe that out for every pill, not just striped
// ones. Setting backgroundImage alone leaves that CSS layer alone when
// there's nothing to override it with (single color).
function syncPillColor(part) {
  const hexes = getPartColorList(part);
  const stripImage = buildSwatchStripBackgroundImage(hexes);
  const borderColor = hexes.length === 1 && hexes[0].toLowerCase() === '#ffffff' ? '#000' : 'var(--stroke)';
  document.querySelectorAll(`[data-role="color-pill"][data-part="${part}"]`).forEach((pill) => {
    pill.style.backgroundColor = hexes[0];
    pill.style.backgroundImage = stripImage || '';
    pill.style.border = `1px solid ${borderColor}`;
  });
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

  // Rings the swatch matching the current color (part color normally, brush
  // color in bucket mode) so it's clear at a glance which preset — if any —
  // is currently selected, instead of only the hex field reflecting it.
  palette.querySelectorAll('[data-role="swatch"]').forEach((swatch) => {
    swatch.classList.toggle('selected', swatch.dataset.color.toUpperCase() === `#${currentHex}`);
  });
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
    if (part !== GLOBAL_PAINT_KEY) {
      if (!partVis[part]) enablePart(part, false);
      if (!pickerHSV[part]) pickerHSV[part] = colorToHsv(modelCols[part]);
    }
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
      // In bucket mode this picker is choosing the brush color for the next
      // click on the model, not recoloring the part itself — always true for
      // GLOBAL_PAINT_KEY's picker, which isn't tied to any one part's mode.
      if (bucketModePart === part || part === GLOBAL_PAINT_KEY) {
        maybeAutoStartGlobalPaint(part);
        return;
      }
      applyLiveColor(part, hsvToHex(state.h, state.s, state.v));
    };

    update(event.clientX, event.clientY);

    const onMove = (moveEvent) => update(moveEvent.clientX, moveEvent.clientY);
    const onUp = () => {
      track.removeEventListener('pointermove', onMove);
      track.removeEventListener('pointerup', onUp);
      track.removeEventListener('pointercancel', onUp);
      if (bucketModePart !== part && part !== GLOBAL_PAINT_KEY) markCustomPreset();
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
    if (bucketModePart === part || part === GLOBAL_PAINT_KEY) {
      setBrushColor(part, hex);
      return;
    }
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

// Updates the palette's picker/preview to a new "brush" color without
// touching the model — used while bucketModePart is set, where the picker
// is choosing the color for the *next* click on the model rather than
// recoloring the whole part immediately (that's what applyLiveColor is for).
function setBrushColor(part, hex) {
  pickerHSV[part] = colorToHsv(new THREE.Color(hex));
  renderColorPickerUI(part);
  maybeAutoStartGlobalPaint(part);
}

// Choosing a colour in the global "paint any piece" picker is a clear intent
// to paint — turn the mode on automatically rather than also requiring a press
// of the button. (A per-part brush already implies that part's paint mode is
// on, so this only fires for GLOBAL_PAINT_KEY.)
function maybeAutoStartGlobalPaint(part) {
  if (part === GLOBAL_PAINT_KEY && bucketModePart !== GLOBAL_PAINT_KEY) {
    setBucketMode(GLOBAL_PAINT_KEY);
  }
}

function getBrushHex(part) {
  const hsv = pickerHSV[part];
  if (hsv) return hsvToHex(hsv.h, hsv.s, hsv.v);
  return `#${modelCols[part].getHexString()}`;
}

function loadColorHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(COLOR_HISTORY_KEY) || '[]');
    if (Array.isArray(raw)) {
      colorHistory = raw
        .filter((hex) => typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex))
        .map((hex) => hex.toUpperCase())
        .slice(0, COLOR_HISTORY_MAX);
    }
  } catch {}
}

// Called every time a piece actually gets painted (any part, global or
// per-part mode) — not on every brush-preview tick, so dragging the hue
// picker doesn't flood history with intermediate colors nobody chose.
function recordColorHistory(hex) {
  hex = hex.toUpperCase();
  const existing = colorHistory.indexOf(hex);
  if (existing !== -1) colorHistory.splice(existing, 1);
  colorHistory.unshift(hex);
  if (colorHistory.length > COLOR_HISTORY_MAX) colorHistory.length = COLOR_HISTORY_MAX;
  try { localStorage.setItem(COLOR_HISTORY_KEY, JSON.stringify(colorHistory)); } catch {}
  renderColorHistorySwatches();
}

// Only #globalPaintBtn's panel shows this today, but it's written generically
// (data-role="swatch" markup, same as the preset grid) so the exact same
// swatch pointerup handler in setupPaletteWiring picks a history color up
// with zero extra wiring — no per-swatch click listener needed here.
function renderColorHistorySwatches() {
  const row = document.querySelector('[data-role="color-history-row"]');
  const host = document.querySelector('[data-role="color-history"]');
  if (!row || !host) return;
  row.classList.toggle('u-hidden', colorHistory.length === 0);
  host.innerHTML = colorHistory.map((hex) => {
    const whiteClass = hex === '#FFFFFF' ? ' white' : '';
    return `<div class="color-swatch${whiteClass}" data-role="swatch" data-part="${GLOBAL_PAINT_KEY}" data-color="${hex}" style="background:${hex}" title="${hex}"></div>`;
  }).join('');
}

// Whenever a part's piece overrides change (painted, right-click reset, or
// the reset-all button), both the reset button's count AND the color-sidebar
// pill need to reflect that — bundled into one function so every call site
// that changes overrides automatically keeps the pill honest too, instead of
// relying on each one to separately remember to call syncPillColor.
function updateBucketResetVisibility(part) {
  syncPillColor(part);
  const btn = document.querySelector(`[data-role="bucket-reset"][data-part="${part}"]`);
  if (!btn) return;
  const overrides = getMeshOverrides(part);
  const count = overrides ? Object.keys(overrides).length : 0;
  btn.classList.toggle('u-hidden', count === 0);
  const label = btn.querySelector('[data-role="bucket-reset-label"]');
  if (label) label.textContent = count > 1 ? `Reset (${count})` : 'Reset';
  btn.title = count ? `Reset ${count} custom piece color${count === 1 ? '' : 's'}` : 'Reset custom piece colors';
}

// Aggregate version of updateBucketResetVisibility for #globalPaintBtn's
// popover — counts painted pieces across every real part at once, since a
// global-mode session can paint pieces belonging to several different parts.
function updateGlobalResetVisibility() {
  const btn = document.querySelector('[data-role="global-reset"]');
  if (!btn) return;
  let count = 0;
  for (const part of Object.keys(modelSets)) {
    const overrides = getMeshOverrides(part);
    if (overrides) count += Object.keys(overrides).length;
  }
  btn.classList.toggle('u-hidden', count === 0);
  const label = btn.querySelector('[data-role="global-reset-label"]');
  if (label) label.textContent = count > 1 ? `Reset all (${count})` : 'Reset all';
  btn.title = count ? `Reset ${count} custom piece color${count === 1 ? '' : 's'}` : 'Reset all custom piece colors';
}

// Clears every part's piece overrides at once (the global popover's "Reset
// all") — leaves each part's own base color (modelCols) untouched, same as
// the per-part reset button does.
function resetAllPaintedPieces() {
  let touched = false;
  for (const part of Object.keys(modelSets)) {
    const overrides = getMeshOverrides(part);
    if (!overrides || !Object.keys(overrides).length) continue;
    for (const key of Object.keys(overrides)) delete overrides[key];
    applyColor(part);
    updateBucketResetVisibility(part);
    touched = true;
  }
  updateGlobalResetVisibility();
  if (touched) markCustomPreset();
}

function clearPaintHover() {
  if (!paintHoverMesh) return;
  toMaterialArray(paintHoverMesh.material).forEach((material) => {
    if (material?.emissive) material.emissive.setHex(0x000000);
  });
  paintHoverMesh = null;
}

// Minimal contextual control (#model-hover-popup) shown on the model itself —
// prev/next variant, browse-all, print, download for the hovered/tapped part.
// Reuses setupGlobalClickHandler's existing role handling verbatim (see the
// data-role attributes in index.html); this only sets which part each button
// targets and where the popup sits on screen.
//
// Uses a "hover intent" delay rather than hiding the instant the pointer
// leaves the model, since the pointer has to cross open space to reach the
// popup's own buttons — hiding immediately would make it impossible to
// actually click anything in it. showModelHoverPopup (called on every model
// hover) and the popup's own pointerenter (see setupModelHoverPopup) both
// cancel a pending hide; only actually leaving both dismisses it.
let hoverPopupPart = null;
let hoverPopupHideTimer = null;

function showModelHoverPopup(part, clientX, clientY) {
  const popup = document.getElementById('model-hover-popup');
  if (!popup) return;
  if (hoverPopupHideTimer) {
    clearTimeout(hoverPopupHideTimer);
    hoverPopupHideTimer = null;
  }
  // Only reposition when the hovered part actually changes — repositioning
  // on every pointermove made the popup slide around following the cursor
  // while it was still sitting over the SAME part, which both looked wrong
  // and made its own buttons a moving target (the mouse would still be
  // mid-transit toward wherever the popup used to be by the time it got
  // there). Once shown, it stays put until hover moves to a different part
  // or off the model entirely.
  if (hoverPopupPart === part) return;
  hoverPopupPart = part;
  // A mix `extras` piece has no variants — hide the stepper + "all variants",
  // keep only name / print / download.
  const isExtra = mixExtraUrls.has(part);
  popup.querySelectorAll('[data-role="prev"], [data-role="next"], [data-role="browse"], .model-hover-popup-divider')
    .forEach((el) => el.classList.toggle('u-hidden', isExtra));
  popup.querySelectorAll('[data-role="prev"], [data-role="next"], [data-role="print"], [data-role="download-part"]').forEach((btn) => {
    btn.dataset.part = part;
  });
  const nameEl = popup.querySelector('[data-role="hover-popup-name"]');
  if (nameEl) nameEl.textContent = getPartDisplayName(part);
  if (isTouchLikeDevice()) {
    // Phone: the popup docks at a fixed spot above the sheet via CSS — clear
    // any inline left/top a prior desktop-style call may have left behind so
    // the stylesheet wins.
    popup.style.left = '';
    popup.style.top = '';
  } else {
    positionModelHoverPopup(clientX, clientY);
  }
  popup.classList.add('open');
}

function positionModelHoverPopup(clientX, clientY) {
  const popup = document.getElementById('model-hover-popup');
  if (!popup) return;
  const pad = 16;
  const w = popup.offsetWidth || 220;
  const h = popup.offsetHeight || 38;
  let left = clientX + pad;
  let top = clientY - h - pad;
  if (left + w > window.innerWidth - 8) left = clientX - w - pad;
  if (top < 8) top = clientY + pad;
  popup.style.left = `${Math.max(8, Math.min(left, window.innerWidth - w - 8))}px`;
  popup.style.top = `${Math.max(8, top)}px`;
}

function scheduleHideModelHoverPopup() {
  if (hoverPopupHideTimer) return;
  hoverPopupHideTimer = setTimeout(() => {
    hoverPopupHideTimer = null;
    hoverPopupPart = null;
    document.getElementById('model-hover-popup')?.classList.remove('open');
  }, 220);
}

function hideModelHoverPopupNow() {
  if (hoverPopupHideTimer) {
    clearTimeout(hoverPopupHideTimer);
    hoverPopupHideTimer = null;
  }
  hoverPopupPart = null;
  document.getElementById('model-hover-popup')?.classList.remove('open');
}

function setupModelHoverPopup() {
  const popup = document.getElementById('model-hover-popup');
  if (!popup) return;
  // The hover-intent bridge (pointer crossing open space to reach the popup's
  // buttons without it vanishing) is a mouse concern only — wired always, since
  // a touch-capable 2-in-1 still gets used with a mouse, but the leave-to-hide
  // is gated to real mouse/pen leaves. On touch the popup is summoned by a tap
  // and stays pinned until explicitly dismissed (close button / empty-canvas
  // tap — see setupBucketTool).
  popup.addEventListener('pointerenter', () => {
    if (hoverPopupHideTimer) {
      clearTimeout(hoverPopupHideTimer);
      hoverPopupHideTimer = null;
    }
  });
  popup.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'touch') return;
    scheduleHideModelHoverPopup();
  });

  // Touch-only controls: hover devices reach the full variant grid by clicking
  // the piece itself, but on touch that tap summons this popup instead, so it
  // carries its own "all variants" and "close" affordances (see index.html).
  popup.querySelector('[data-role="browse"]')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const part = hoverPopupPart;
    if (!part) return;
    // Snapshot the rect now — hideModelHoverPopupNow() sets display:none, after
    // which getBoundingClientRect() would be all zeros and the grid would
    // anchor to the top-left corner.
    const rect = popup.getBoundingClientRect();
    hideModelHoverPopupNow();
    if (openVariantGridPart === part) closeVariantGrid();
    else openVariantGrid(part, { getBoundingClientRect: () => rect });
  });
  popup.querySelector('[data-role="hover-popup-close"]')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    hideModelHoverPopupNow();
  });
}

// Toggles "paint pieces" mode on/off for `part` (pass null to turn it off).
// Only one part can be in bucket mode at a time — tied to its palette being
// open (see reallyClosePalette) since the palette is where the brush color
// comes from.
function setBucketMode(part) {
  if (bucketModePart === part) return;
  // Mutually exclusive with the V-key hide/show mode -- entering one always
  // exits the other (enterVisibilityEditMode already does the reverse), so
  // their two vignettes (blue vs. yellow, see below) never show at once.
  if (part && visibilityEditMode) exitVisibilityEditMode();
  clearPaintHover();
  if (part) hideModelHoverPopupNow();
  bucketModePart = part;
  document.getElementById('paint-mode-vignette')?.classList.toggle('visible', !!part);

  document.querySelectorAll('[data-role="bucket-toggle"]').forEach((btn) => {
    const active = btn.dataset.part === part;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
    const label = btn.querySelector('[data-role="bucket-toggle-label"]');
    if (label) label.textContent = active ? 'Stop' : 'Paint pieces';
  });
  // Inline hint instead of a toast — it needs to stay up the whole time
  // bucket mode is active, not just for a few seconds, since "right-click to
  // reset a single piece" is otherwise easy to forget or never see at all.
  document.querySelectorAll('[data-role="bucket-hint"]').forEach((hint) => {
    hint.classList.toggle('u-hidden', hint.dataset.part !== part);
  });
  renderer.domElement.classList.toggle('bucket-cursor', !!part);
  // Clear any inline cursor the "click to browse variants" hover left behind
  // (see paintHoverFlush) — an inline style would otherwise outrank
  // .bucket-cursor's crosshair until the next hover event happens to update it.
  if (part) renderer.domElement.style.cursor = '';

  if (part && part !== GLOBAL_PAINT_KEY && !partVis[part]) enablePart(part, false);
}

function setupBucketTool() {
  document.querySelectorAll('[data-role="bucket-toggle"]').forEach((btn) => {
    // #globalPaintBtn also has to open/position its popover, not just flip
    // the mode — setupGlobalPaintTool() wires it separately.
    if (btn.dataset.part === GLOBAL_PAINT_KEY) return;
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const part = btn.dataset.part;
      setBucketMode(bucketModePart === part ? null : part);
    });
  });

  document.querySelectorAll('[data-role="bucket-reset"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const part = btn.dataset.part;
      const overrides = getMeshOverrides(part);
      if (!overrides || !Object.keys(overrides).length) return;
      for (const key of Object.keys(overrides)) delete overrides[key];
      applyColor(part);
      updateBucketResetVisibility(part);
      markCustomPreset();
    });
  });

  const paintRaycaster = new THREE.Raycaster();
  const paintPointer = new THREE.Vector2();

  // Which part-groups a click can land on: just bucketModePart's own model in
  // the normal (per-part) case, or every currently visible loaded part either
  // when painting via #globalPaintBtn (GLOBAL_PAINT_KEY) or when NOT painting
  // at all — that second case is what the "click a piece to open its variant
  // grid" feature below uses instead, so it can land on any visible part.
  function getPaintTargetGroups() {
    // Visibility-edit mode (see setupVisibilityShortcut) needs hidden parts'
    // ghost previews to be clickable too, not just the currently-shown ones.
    if (visibilityEditMode) {
      return Object.keys(loadedMods)
        .filter((part) => loadedMods[part])
        .map((part) => ({ part, model: loadedMods[part] }));
    }
    if (bucketModePart === GLOBAL_PAINT_KEY || !bucketModePart) {
      return Object.keys(loadedMods)
        .filter((part) => loadedMods[part] && partVis[part])
        .map((part) => ({ part, model: loadedMods[part] }));
    }
    const model = loadedMods[bucketModePart];
    return model ? [{ part: bucketModePart, model }] : [];
  }

  // Returns { part, mesh } for whichever target group's closest hit wins —
  // when several parts overlap on screen, that's whatever's actually nearest
  // the camera at this pixel, matching what's visually in front.
  function castPaintAt(ndcX, ndcY) {
    paintPointer.set(ndcX, ndcY);
    paintRaycaster.setFromCamera(paintPointer, camera);
    let best = null;
    for (const { part, model } of getPaintTargetGroups()) {
      const hits = paintRaycaster.intersectObject(model, true);
      if (hits.length && (!best || hits[0].distance < best.distance)) {
        best = { part, mesh: hits[0].object, distance: hits[0].distance };
      }
    }
    return best;
  }

  // A single pixel-exact raycast routinely misses thin or steeply-angled
  // sub-meshes (a wheel rim viewed edge-on, a thin decorative panel) even
  // when the cursor looks like it's squarely on the piece, since the visible
  // 2D silhouette is wider than the actual 3D surface the ray has to thread
  // through — so try the exact point, then successively wider rings of
  // offset points, using the first ring that lands on something.
  const PAINT_HITBOX_RINGS = [
    { radius: 8, points: 8 },
    { radius: 16, points: 10 },
    { radius: 26, points: 12 }
  ];

  // Not gated on bucketModePart being set — with it null, getPaintTargetGroups
  // above searches every visible part instead of a paint target, so this
  // doubles as the hit-test for "click a piece to open its variant grid"
  // (see the click handler below) as well as for actually painting.
  function getPaintHit(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    const toNdc = (x, y) => [((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1];

    const [x0, y0] = toNdc(clientX, clientY);
    let hit = castPaintAt(x0, y0);
    if (hit) return hit;

    for (const { radius, points } of PAINT_HITBOX_RINGS) {
      for (let i = 0; i < points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const [x, y] = toNdc(clientX + Math.cos(angle) * radius, clientY + Math.sin(angle) * radius);
        hit = castPaintAt(x, y);
        if (hit) return hit;
      }
    }
    return null;
  }

  // Each getPaintHit() call can cast up to ~30 rays (see PAINT_HITBOX_RINGS)
  // when it misses, so raycasting on every raw pointermove (which can fire
  // far faster than the render loop) risks visible jank on a higher-poly
  // part. Batch to at most once per rendered frame instead; see the
  // animate() call to flushPaintHover.
  // Runs regardless of bucketModePart now — hovering always previews
  // *something* clickable, whether that click will paint or open a variant
  // grid (see the click handler below).
  let pendingPaintHoverEvent = null;
  renderer.domElement.addEventListener('pointermove', (event) => {
    // A move with a button held is an orbit/pan drag, not a hover — the user
    // isn't aiming at anything to pick. Skipping the (raycast-heavy) hover
    // hit-test here is what keeps dragging *over* the model smooth; dragging
    // over empty canvas was already fine because every ray missed cheaply.
    // Touch moves are never a hover either (there's no resting pointer) — the
    // on-model popup is tap-summoned and pinned on touch, so a stray move
    // must not drive its show/hide. Mouse/pen on the same device still hover.
    if (event.buttons !== 0 || event.pointerType === 'touch') { pendingPaintHoverEvent = null; return; }
    pendingPaintHoverEvent = event;
  });

  paintHoverFlush = () => {
    if (!pendingPaintHoverEvent) return;
    const event = pendingPaintHoverEvent;
    pendingPaintHoverEvent = null;
    const hit = getPaintHit(event.clientX, event.clientY);
    const mesh = hit ? hit.mesh : null;
    if (mesh !== paintHoverMesh) {
      clearPaintHover();
      if (mesh) {
        paintHoverMesh = mesh;
        toMaterialArray(mesh.material).forEach((material) => {
          if (material?.emissive) material.emissive.setHex(0x3d7fff);
        });
      }
    }
    // Paint mode already gets a permanent crosshair (see .bucket-cursor in
    // setBucketMode) regardless of exact hover target, since the hitbox
    // rings mean a near-miss usually still lands — only the plain "click to
    // browse" case needs the cursor to reflect whether this exact spot has
    // anything to click.
    if (visibilityEditMode) {
      // No variant-browse popup here -- in this mode a click toggles
      // visibility instead, so a popup with its own prev/next buttons would
      // just be a second, contradictory way to act on the same hover.
      renderer.domElement.style.cursor = hit ? 'pointer' : '';
    } else if (!bucketModePart) {
      renderer.domElement.style.cursor = hit ? 'pointer' : '';
      // Only reached for mouse/pen now (touch moves bail in the listener
      // above), so this stays the plain hover-driven show/hide.
      if (hit) showModelHoverPopup(hit.part, event.clientX, event.clientY);
      else scheduleHideModelHoverPopup();
    }
  };

  renderer.domElement.addEventListener('pointerleave', (event) => {
    pendingPaintHoverEvent = null;
    clearPaintHover();
    // pointerleave fires on every touchend — on touch that would dismiss a
    // popup the user just tapped to open. Touch dismissal is the popup's close
    // button or a tap on empty canvas (see the click listener below).
    if (event.pointerType === 'touch') return;
    if (!bucketModePart) {
      renderer.domElement.style.cursor = '';
      scheduleHideModelHoverPopup();
    }
  });

  // --- Tap vs. orbit-drag discrimination + long-press (touch's right-click) ---
  // A one-finger drag orbits the camera; browsers only suppress the synthetic
  // click after a generous move, so without this a sloppy tap mid-orbit could
  // paint a piece or open a grid. The same tracking arms a long-press that
  // stands in for the right-click piece-reset on touch.
  const TAP_MOVE_TOL = 16; // px of travel still counted as a tap, not a drag (touch-forgiving)
  const LONG_PRESS_MS = 500;
  let pointerDownPt = null;
  let pointerDidDrag = false;
  let longPressHandled = false;
  let longPressTimer = null;
  // pointerType of the interaction that produced the pending click. The tap-
  // first flow (popup before grid) and long-press reset are chosen off what
  // was ACTUALLY used, not just what the device could do — a mouse on a
  // touch-capable 2-in-1 keeps the direct click-to-grid and hover popup.
  let lastPointerType = '';
  const clearLongPress = () => {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  };
  renderer.domElement.addEventListener('pointerdown', (event) => {
    pointerDownPt = { x: event.clientX, y: event.clientY };
    pointerDidDrag = false;
    longPressHandled = false;
    lastPointerType = event.pointerType;
    clearLongPress();
    // Mouse keeps the real contextmenu handler further down; only arm the
    // long-press fallback for non-mouse pointers.
    if (bucketModePart && event.pointerType !== 'mouse') {
      const at = pointerDownPt;
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        if (pointerDidDrag) return;
        // Once the press is long enough to read as "reset", consume the
        // click either way — a near-miss onto an unpainted piece shouldn't
        // fall through and paint it. Nothing to reset just means "no-op,
        // tap again".
        longPressHandled = true;
        if (resetPieceAt(at.x, at.y)) toast('Piece color reset', 'ok', 1400);
      }, LONG_PRESS_MS);
    }
  });
  renderer.domElement.addEventListener('pointermove', (event) => {
    if (!pointerDownPt) return;
    if (Math.hypot(event.clientX - pointerDownPt.x, event.clientY - pointerDownPt.y) > TAP_MOVE_TOL) {
      pointerDidDrag = true;
      clearLongPress();
    }
  });
  renderer.domElement.addEventListener('pointerup', clearLongPress);
  renderer.domElement.addEventListener('pointercancel', () => {
    clearLongPress();
    pointerDownPt = null;
    pointerDidDrag = false;
  });

  // Shared by the mouse contextmenu handler and the touch long-press above:
  // clears the per-piece paint override under the given screen point, if any.
  // Returns whether it actually reset something.
  function resetPieceAt(clientX, clientY) {
    if (!bucketModePart) return false;
    const hit = getPaintHit(clientX, clientY);
    if (!hit || hit.mesh.userData.meshIndex == null) return false;
    const overrides = getMeshOverrides(hit.part);
    if (!overrides || !(hit.mesh.userData.meshIndex in overrides)) return false;
    delete overrides[hit.mesh.userData.meshIndex];
    applyColor(hit.part);
    updateBucketResetVisibility(hit.part);
    updateGlobalResetVisibility();
    markCustomPreset();
    return true;
  }

  renderer.domElement.addEventListener('click', (event) => {
    // A drag that orbited/panned the camera isn't a pick. Long-press already
    // consumed this one as a piece reset.
    if (pointerDidDrag || longPressHandled) return;
    // True when this click came from a finger/pen. Both layouts now show the
    // on-model quick-control popup on a tap (first tap = popup / variant
    // stepper, tap again or its "all variants" button = the full grid) — on
    // the desktop layout it floats by the part, on phones it docks above the
    // sheet (see .model-hover-popup.open in the coarse CSS block).
    const tapInput = lastPointerType === 'touch' || lastPointerType === 'pen';
    const hit = getPaintHit(event.clientX, event.clientY);

    // Visibility-edit mode takes over the click entirely -- toggle whatever
    // was hit (shown -> ghost, ghost -> shown) and skip painting/variant
    // browsing until the user presses V (or Escape) to leave the mode.
    if (visibilityEditMode) {
      if (hit) toggleVisibilityEditPart(hit.part);
      return;
    }

    if (!hit) {
      // A miss while painting is a no-op, same as always. A miss while just
      // browsing still closes whatever variant grid is currently open —
      // the generic "click outside closes it" handler (setupVariantGrid)
      // deliberately excludes clicks on this canvas entirely, since it can't
      // tell a miss from the exact click that just opened one; closing on a
      // miss is this handler's job instead.
      if (!bucketModePart) {
        // On touch a tap on empty canvas is also how the pinned quick-control
        // popup gets dismissed (no pointer to leave the model).
        if (tapInput) hideModelHoverPopupNow();
        if (openVariantGridPart) closeVariantGrid();
      }
      return;
    }

    if (bucketModePart) {
      if (hit.mesh.userData.meshIndex == null) return;
      const brushHex = getBrushHex(bucketModePart);
      const overrides = getMeshOverrides(hit.part, true);
      overrides[hit.mesh.userData.meshIndex] = brushHex;
      applyColor(hit.part);
      updateBucketResetVisibility(hit.part);
      updateGlobalResetVisibility();
      recordColorHistory(brushHex);
      markCustomPreset();
      return;
    }

    const anchorRect = { left: event.clientX, right: event.clientX, top: event.clientY, bottom: event.clientY, width: 0 };

    // A mix `extras` piece has no variant grid — a click just leaves its
    // quick-control popup up (print / download). On touch, summon that popup.
    if (mixExtraUrls.has(hit.part)) {
      if (tapInput) {
        if (openVariantGridPart) closeVariantGrid();
        showModelHoverPopup(hit.part, event.clientX, event.clientY);
      }
      return;
    }

    // Touch has no hover, so the quick prev/next stepper (the on-model popup)
    // would never have surfaced — a bare tap summons it instead of jumping
    // straight to the full grid. First tap on a piece shows the popup; a
    // second tap on that same piece (or the popup's own "all variants"
    // button) opens the grid. Mouse keeps the original one-click-to-grid.
    if (tapInput) {
      if (hoverPopupPart === hit.part) {
        hideModelHoverPopupNow();
        openVariantGrid(hit.part, { getBoundingClientRect: () => anchorRect });
        return;
      }
      if (openVariantGridPart) closeVariantGrid();
      showModelHoverPopup(hit.part, event.clientX, event.clientY);
      return;
    }

    // Not painting — clicking a piece browses its variants instead, exactly
    // like clicking its row's name does. Anchored to the click point itself
    // rather than any specific DOM element, since there isn't one here.
    if (openVariantGridPart === hit.part) {
      closeVariantGrid();
      return;
    }
    hideModelHoverPopupNow();
    openVariantGrid(hit.part, { getBoundingClientRect: () => anchorRect });
  });

  // Mouse right-click resets one painted piece; the touch equivalent is the
  // long-press wired in the pointerdown handler above (both call resetPieceAt).
  // While in paint mode the browser context menu is always suppressed over the
  // canvas — right-click is repurposed here, and on touch platforms that fire
  // contextmenu on long-press (Chrome Android) this also stops the OS menu from
  // popping up alongside the long-press reset the timer already performed.
  renderer.domElement.addEventListener('contextmenu', (event) => {
    if (!bucketModePart) return;
    event.preventDefault();
    resetPieceAt(event.clientX, event.clientY);
    // Swallow the click some touch browsers still synthesise after a long-press
    // — without this it would re-paint the piece the reset just cleared.
    longPressHandled = true;
  });
}

// #globalPaintBtn — unlike a part's own color pill, its picker (see
// renderGlobalPaintPalette) is always visible in the left column, not a
// popover you open first. So there's nothing to mount/position here: the
// button just flips bucket mode on/off for GLOBAL_PAINT_KEY, and the model
// becomes paintable (or stops being) immediately.
function setupGlobalPaintTool() {
  const btn = document.getElementById('globalPaintBtn');
  const palette = document.getElementById(`${GLOBAL_PAINT_KEY}-palette`);
  if (!btn || !palette) return;

  // Deferred from renderGlobalPaintPalette() — see the comment there — now
  // that pickerHSV exists, seed it and paint the picker's actual starting
  // state instead of leaving it at whatever the raw HTML defaults to.
  if (!pickerHSV[GLOBAL_PAINT_KEY]) pickerHSV[GLOBAL_PAINT_KEY] = colorToHsv(new THREE.Color(COLOR_OPTIONS[0]));
  renderColorPickerUI(GLOBAL_PAINT_KEY);
  updateGlobalResetVisibility();
  loadColorHistory();
  renderColorHistorySwatches();

  btn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setBucketMode(bucketModePart === GLOBAL_PAINT_KEY ? null : GLOBAL_PAINT_KEY);
  });

  // "P" mirrors the button itself -- toggles the global paint tool on/off,
  // same as "V" does for visibility-edit mode (see setupVisibilityShortcut).
  // Escape also leaves paint mode (any variant of it, per-part included), the
  // same way it leaves visibility-edit mode.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (bucketModePart) setBucketMode(null);
      return;
    }
    if (event.key !== 'p' && event.key !== 'P') return;
    if (event.target.matches('input, textarea, [contenteditable]')) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    setBucketMode(bucketModePart === GLOBAL_PAINT_KEY ? null : GLOBAL_PAINT_KEY);
  });

  palette.querySelector('[data-role="global-reset"]')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    resetAllPaintedPieces();
  });
}

// Collapsed-by-default per-part color list (see #color-sidebar-toggle in
// index.html) — same open/close pattern as the color palettes themselves
// (outside click, Escape, scroll all close it), but it isn't a color-palette
// popover itself, just the panel that hosts each part's own pill/palette.
function setupColorSidebarToggle() {
  const toggle = document.getElementById('color-sidebar-toggle');
  const sidebar = document.getElementById('color-sidebar');
  if (!toggle || !sidebar) return;

  function closeSidebar() {
    sidebar.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const open = sidebar.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  document.addEventListener('click', (event) => {
    if (!sidebar.classList.contains('open')) return;
    if (event.target.closest('#color-sidebar, #color-sidebar-toggle, .color-palette')) return;
    closeSidebar();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSidebar();
  });
}

// One always-visible dock on the right (see .right-dock in index.html) with
// two tabbed pages — mixes carousel and part controls — instead of two
// independently collapsible panels. Exactly one page is ever showing:
// there's no "both closed" state to fall into, switching tabs is the only
// interaction, and Mixes is both the default and the higher-priority tab
// (variant browsing, print, and download all moved onto the model itself —
// click-to-select + the hover popup — so Parts' remaining job is just
// toggling visibility for parts hidden by default and picking a base part).
// Skipped entirely on touch: the dock is CSS-hidden there, mixes are still
// picked from the old top-left dropdown, and #panel-essential + the
// Essential/Advanced switch get reparented into the mobile sheet instead
// (see setupMobileSheet) rather than living in this dock.
function setupRightDockTabs() {
  if (isTouchLikeDevice()) return;
  const mixesTab = document.getElementById('dock-tab-mixes');
  const partsTab = document.getElementById('dock-tab-parts');
  const mixesPage = document.getElementById('preset-panel');
  const partsPage = document.getElementById('parts-page');
  const controlsToggle = document.getElementById('controls-toggle');
  if (!mixesTab || !partsTab || !mixesPage || !partsPage) return;

  // Nest the Essential/Advanced switch into the Parts page, right above the
  // part list it controls, instead of leaving it floating independently —
  // touch leaves it exactly where it started (see the (pointer:coarse) CSS).
  if (controlsToggle) partsPage.insertBefore(controlsToggle, partsPage.firstChild);

  function showMixes() {
    mixesTab.classList.add('active');
    mixesTab.setAttribute('aria-selected', 'true');
    partsTab.classList.remove('active');
    partsTab.setAttribute('aria-selected', 'false');
    mixesPage.classList.add('active');
    partsPage.classList.remove('active');
    renderPresetCarousel();
  }
  function showParts() {
    partsTab.classList.add('active');
    partsTab.setAttribute('aria-selected', 'true');
    mixesTab.classList.remove('active');
    mixesTab.setAttribute('aria-selected', 'false');
    partsPage.classList.add('active');
    mixesPage.classList.remove('active');
  }

  mixesTab.addEventListener('click', showMixes);
  partsTab.addEventListener('click', showParts);

  // Mixes starts .active in the markup itself (see index.html) so it's
  // visible on first paint with no flash of an empty dock — just needs its
  // cards built and thumbnails kicked off to match.
  renderPresetCarousel();
}

function renderPresetCarousel() {
  const host = document.getElementById('preset-carousel');
  if (!host || presetCarouselBuilt) return;
  presetCarouselBuilt = true;

  Object.entries(presets).forEach(([key, preset]) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'preset-card';
    card.dataset.preset = key;
    card.setAttribute('aria-selected', key === activePresetKey ? 'true' : 'false');
    card.innerHTML = `
      <img class="preset-card-thumb" alt="${preset.label} preview">
      <span class="preset-card-title">${preset.label}</span>
      <span class="preset-card-desc">${preset.description}</span>
      <span class="preset-card-copy" data-role="copy-mix-colors" role="button" tabindex="0"
        title="Paint the loaded model in this mix's colors">
        <span class="material-icons" aria-hidden="true">palette</span>Copy colors
      </span>
    `;
    card.addEventListener('click', () => applyPreset(key));
    host.appendChild(card);

    // Secondary action on the card — nested inside the <button>, so its own
    // handlers must swallow the event before the card's applyPreset click sees
    // it. Only visible on the currently-applied card (see .preset-card.active
    // .preset-card-copy in app.css).
    const copyControl = card.querySelector('[data-role="copy-mix-colors"]');
    const doCopyColors = (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyMixColors(key);
    };
    copyControl.addEventListener('click', doCopyColors);
    copyControl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') doCopyColors(event);
    });

    // Cards show immediately (grey thumb box + label); the actual 3D thumbnail
    // render is deferred until the initial build is done — see runAfterFirstBuild.
    runAfterFirstBuild(() => {
      renderPresetThumbnail(key).then((dataUrl) => {
        if (dataUrl) card.querySelector('.preset-card-thumb').src = dataUrl;
      });
    });

    // Hide the "Copy colors" control entirely for a mix with nothing authored
    // in assets/mix-colors.json (mixColors loads async — see mixColorsReady).
    mixColorsReady.then(() => {
      const has = !!mixColors[key] && Object.keys(mixColors[key]).length > 0;
      card.classList.toggle('has-mix-colors', has);
    });
  });

  syncPresetButtons(activePresetKey === 'custom' ? '' : activePresetKey);
}

// Cleans up a filename like "TopUSmatrix.glb" or "Bumper_motor_ramp.glb" into a
// human label ("US matrix", "Motor Ramp") by dropping the part-key/label prefix
// and splitting camelCase/underscore/dash boundaries. File naming isn't fully
// consistent across the asset set, so this is a best-effort heuristic, not a
// guaranteed clean result — it's a secondary label under a real thumbnail.
function prettyVariantLabel(part, filename) {
  const override = VARIANT_LABEL_OVERRIDES[`${part}|${filename}`];
  if (override) return override;
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

// Frames the shared thumbnail camera on one object (a single variant's scene,
// or a whole Group of parts assembled for a preset preview) and snapshots it
// to a PNG data URL. Shared by renderVariantThumbnail and
// renderPresetThumbnail so the "axes swapped" precise-bounding-box fix and
// the camera-framing math only exist in one place.
function snapshotThumbnail(object) {
  const { scene: rScene, camera: rCamera, renderer: rRenderer } = getThumbRenderer();

  // precise=true forces a fresh bounding box from actual vertex positions.
  // The default (imprecise) mode trusts each mesh's cached geometry.boundingBox,
  // which for some of these assets doesn't match the real vertex data (axes
  // swapped) — that stale cache is what was producing thumbnails aimed at the
  // wrong point in space (cropped/off-center/tiny-in-a-corner renders).
  const box = new THREE.Box3().setFromObject(object, true);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  object.position.sub(sphere.center);

  const radius = Math.max(sphere.radius, 0.001);
  const fovRad = (rCamera.fov * Math.PI) / 180;
  const dist = (radius / Math.sin(fovRad / 2)) * 1.35;
  const direction = new THREE.Vector3(0.62, 0.56, 0.62).normalize();
  rCamera.position.copy(direction.multiplyScalar(dist));
  rCamera.near = Math.max(dist / 100, 0.01);
  rCamera.far = dist * 10;
  rCamera.lookAt(0, 0, 0);
  rCamera.updateProjectionMatrix();

  rScene.add(object);
  rRenderer.render(rScene, rCamera);
  const dataUrl = rRenderer.domElement.toDataURL('image/png');
  rScene.remove(object);
  disposeThumbObject(object);
  return dataUrl;
}

// Renders one variant's GLB to a small PNG data URL for the picker grid, caching
// by URL (both the finished image and the in-flight promise, so opening the same
// part's grid twice — or fast repeated clicks — never re-renders or re-fetches).
function renderVariantThumbnail(url) {
  if (variantThumbCache[url]) return Promise.resolve(variantThumbCache[url]);
  if (variantThumbPromises[url]) return variantThumbPromises[url];

  const promise = loader.loadAsync(url).then((gltf) => {
    const dataUrl = snapshotThumbnail(gltf.scene);
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

// Renders a whole preset's visible parts assembled together (each part's own
// GLB already carries its correct world-space offset, same as the live scene
// — see exportVisiblePartsAsGlb — so no extra positioning is needed here) to
// one preview image, caching by preset key.
//
// Each mesh is repainted to its authored mix colour (assets/mix-colors.json,
// see mixColors) — a per-part colour and/or per-piece overrides keyed by the
// mesh's position in gltf.scene.traverse() order, the same counter loadModel()
// assigns as userData.meshIndex — or, with nothing authored, to
// DEFAULT_PART_COLOR. Never the raw baked-in export colours, which vary wildly
// per asset and made the cards look garish and unlike what applying the mix
// actually produces (the live app paints every part DEFAULT_PART_COLOR on load).
function renderPresetThumbnail(key) {
  if (presetThumbCache[key]) return Promise.resolve(presetThumbCache[key]);
  if (presetThumbPromises[key]) return presetThumbPromises[key];

  const promise = mixColorsReady.then(() => {
    const preset = presets[key];
    const parts = Object.entries(preset?.parts || {})
      .filter(([part]) => preset.visibility?.[part] && modelSets[part]?.length)
      .map(([part, ref]) => ({ part, url: modelSets[part][resolvePresetIndex(part, ref)] }))
      .filter((entry) => entry.url);

    const partLoads = parts.map(({ part, url }) => loader.loadAsync(url).then((gltf) => {
      const { color, meshes } = normalizeMixPartColor(mixColors[key]?.[part]);
      let meshIndex = 0;
      gltf.scene.traverse((node) => {
        if (!node.isMesh) return;
        const hex = meshes[meshIndex] || color || DEFAULT_PART_COLOR;
        meshIndex += 1;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => {
          if (!material?.color) return;
          material.color.set(hex);
          material.needsUpdate = true;
        });
      });
      return gltf.scene;
    }));

    // Standalone `extras` models get the same mix-colour treatment as parts,
    // keyed by filename in assets/mix-colors.json (see tools/mix-colorizer.js).
    const extraLoads = (preset.extras || [])
      .filter((f) => mixExtraUrls.has(f))
      .map((f) => loader.loadAsync(mixExtraUrls.get(f)).then((gltf) => {
        const { color, meshes } = normalizeMixPartColor(mixColors[key]?.[f]);
        let meshIndex = 0;
        gltf.scene.traverse((node) => {
          if (!node.isMesh) return;
          const hex = meshes[meshIndex] || color || DEFAULT_PART_COLOR;
          meshIndex += 1;
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          materials.forEach((material) => {
            if (!material?.color) return;
            material.color.set(hex);
            material.needsUpdate = true;
          });
        });
        return gltf.scene;
      }));

    return Promise.all([...partLoads, ...extraLoads]);
  }).then((models) => {
    const group = new THREE.Group();
    models.forEach((model) => group.add(model));
    const dataUrl = snapshotThumbnail(group);
    presetThumbCache[key] = dataUrl;
    delete presetThumbPromises[key];
    return dataUrl;
  }).catch((error) => {
    console.error('Preset thumbnail render failed', key, error);
    delete presetThumbPromises[key];
    return null;
  });

  presetThumbPromises[key] = promise;
  return promise;
}

// "Copy colors" on an already-applied mix card (see renderPresetCarousel).
// Applying a mix only pins parts / variants / visibility — never colour — so
// the model loads in the default grey. This repaints the currently-loaded
// model to match that mix's Mixes-tab thumbnail exactly: every part the preset
// shows gets its authored base colour from assets/mix-colors.json (or
// DEFAULT_PART_COLOR when nothing is authored for it), plus any authored
// per-piece overrides for the variant the mix pins — the same resolution
// renderPresetThumbnail() uses. Parts the preset doesn't show are left alone.
function applyMixColors(key) {
  const preset = presets[key];
  if (!preset) return;

  mixColorsReady.then(() => {
    const authored = mixColors[key];
    if (!authored || !Object.keys(authored).length) {
      toast('No colors saved for this mix.', 'warn', 1600);
      return;
    }

    let painted = 0;
    for (const part of Object.keys(preset.parts || {})) {
      if (!preset.visibility?.[part] || !loadedMods[part]) continue;

      const { color, meshes } = normalizeMixPartColor(authored[part]);
      if (!modelCols[part]) modelCols[part] = new THREE.Color(DEFAULT_PART_COLOR);
      modelCols[part].set(color || DEFAULT_PART_COLOR);

      // Rebuild this variant's per-piece overrides from the mix alone, so the
      // result is the mix's look and not a layer on top of whatever the user
      // had painted. Only touch the override map if there's something to write
      // or clear — matches getMeshOverrides' "don't leave empty entries" note.
      const meshEntries = Object.entries(meshes);
      if (meshEntries.length || getMeshOverrides(part)) {
        const overrides = getMeshOverrides(part, true);
        Object.keys(overrides).forEach((meshIdx) => delete overrides[meshIdx]);
        for (const [meshIdx, hex] of meshEntries) overrides[meshIdx] = hex;
      }

      applyColor(part);
      syncPillColor(part);
      syncColorPickerUI(part);
      updateBucketResetVisibility(part);
      painted += 1;
    }

    // Standalone `extras` — same treatment as a part, keyed by filename
    // (they're registered in loadedMods/modelCols/modelMeshCols by setMixExtras).
    for (const file of preset.extras || []) {
      if (!authored[file] || !loadedMods[file]) continue;
      const { color, meshes } = normalizeMixPartColor(authored[file]);
      if (!modelCols[file]) modelCols[file] = new THREE.Color(DEFAULT_PART_COLOR);
      modelCols[file].set(color || DEFAULT_PART_COLOR);
      const meshEntries = Object.entries(meshes);
      if (meshEntries.length || getMeshOverrides(file)) {
        const overrides = getMeshOverrides(file, true);
        Object.keys(overrides).forEach((meshIdx) => delete overrides[meshIdx]);
        for (const [meshIdx, hex] of meshEntries) overrides[meshIdx] = hex;
      }
      applyColor(file);
      painted += 1;
    }

    if (!painted) {
      toast('Load this mix first, then copy its colors.', 'warn', 1800);
      return;
    }

    updateGlobalResetVisibility();
    saveStateToLocal();
    toast(`${preset.label} colors applied`, 'ok', 1200);
  });
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
    // The main viewport's own "click a piece to browse its variants" (see
    // setupBucketTool) can itself be the click that just opened this grid —
    // without this it'd bubble up here and close again immediately.
    if (event.target === renderer.domElement) return;
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


function setupKeyboardNav() {
  // Listens on document, not container -- hovering a part (the hoverPopupPart
  // fallback below) never moves keyboard focus, so the focused element at
  // that point is still whatever it was before (often document.body, which
  // is an ancestor of container, not a descendant) and a container-scoped
  // listener would never see the event bubble through it.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    // Don't hijack cursor movement while typing in a hex field or similar —
    // only relevant when hoverPopupPart is the fallback (below), since focus
    // inside an editable element is never inside a .model-section anyway.
    if (event.target.matches('input, textarea, [contenteditable]')) return;
    const section = event.target.closest('.model-section');
    // No focused row? Fall back to whichever part is currently hovered
    // directly on the model (see showModelHoverPopup) — lets the arrow keys
    // cycle variants just by hovering, without also needing to click into
    // the hover popup's own prev/next buttons.
    const part = section ? section.id.replace('-controls', '') : hoverPopupPart;
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

// Tinkercad-style visibility-edit mode: press "V" to enter a mode where
// every currently-hidden part shows up as a translucent blue-outlined ghost
// (see setGhostHighlight/enterVisibilityEditMode below) and clicking ANY
// part in the viewport -- shown or ghosted -- toggles it, exactly like
// Tinkercad's own "V" tool. Press V (or Escape) again to exit; whatever's
// still hidden at that point goes back to being actually invisible.
function setupVisibilityShortcut() {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (visibilityEditMode) exitVisibilityEditMode();
      return;
    }
    if (event.key !== 'v' && event.key !== 'V') return;
    if (event.target.matches('input, textarea, [contenteditable]')) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (visibilityEditMode) exitVisibilityEditMode();
    else enterVisibilityEditMode();
    event.preventDefault();
  });

  // The keyboard shortcut alone has no way to be discovered the first time --
  // this button (under "Part colors" in the left tools column) is the visible
  // entry point that teaches people the feature exists at all.
  visibilityModeBtn.addEventListener('click', () => {
    if (visibilityEditMode) exitVisibilityEditMode();
    else enterVisibilityEditMode();
  });
}

function enterVisibilityEditMode() {
  if (visibilityEditMode) return;
  // A pure showcase mix has no parts to show/hide — the V tool is disabled.
  if (isShowcaseMix()) return;
  // Mutually exclusive with the other click-driven viewport modes -- a
  // click while in this mode always means "toggle visibility", so paint
  // mode and any open variant grid need to get out of the way first.
  if (bucketModePart) setBucketMode(null);
  if (openVariantGridPart) closeVariantGrid();
  visibilityEditMode = true;
  hideModelHoverPopupNow();
  for (const part of Object.keys(modelSets)) {
    if (partVis[part] || !loadedMods[part]) continue;
    if (!loadedMods[part].parent) scene.add(loadedMods[part]);
    loadedMods[part].visible = true;
    setGhostHighlight(part, true);
  }
  document.getElementById('visibility-edit-banner')?.classList.remove('u-hidden');
  document.getElementById('visibility-edit-vignette')?.classList.add('visible');
  toastStack.classList.add('has-visibility-banner');
  visibilityModeBtn.classList.add('active');
  visibilityModeBtn.setAttribute('aria-pressed', 'true');
  visibilityModeBtn.querySelector('.material-icons').textContent = 'visibility_off';
}

function exitVisibilityEditMode() {
  if (!visibilityEditMode) return;
  visibilityEditMode = false;
  for (const part of Object.keys(modelSets)) {
    if (partVis[part] || !loadedMods[part]) continue;
    // Just starts the fade-out -- updateGhostAnimation restores the real
    // material and sets .visible = false itself once it finishes, so the
    // part doesn't just vanish the instant the mode is exited.
    setGhostHighlight(part, false);
  }
  renderer.domElement.style.cursor = '';
  document.getElementById('visibility-edit-banner')?.classList.add('u-hidden');
  document.getElementById('visibility-edit-vignette')?.classList.remove('visible');
  toastStack.classList.remove('has-visibility-banner');
  visibilityModeBtn.classList.remove('active');
  visibilityModeBtn.setAttribute('aria-pressed', 'false');
  visibilityModeBtn.querySelector('.material-icons').textContent = 'visibility';
}

// Flips `part`'s real show/hide state (partVis) from inside the
// visibility-edit mode -- same underlying toggle as clicking the eye icon
// in the part's row (see the role === 'visibility' branch below), just
// triggered by clicking the part itself in the 3D view instead. Keeps every
// part rendered (real material if shown, ghost if hidden) for as long as
// the mode stays open, so the enforce* calls below -- which can flip OTHER
// parts' partVis too (e.g. enabling arms auto-hides bumper) -- read back
// correctly rather than snapping a part invisible mid-preview.
function toggleVisibilityEditPart(part) {
  if (!modelSets[part]) return;
  partVis[part] = !partVis[part];

  const visBtn = document.getElementById(`${part}-visibility`);
  if (visBtn) visBtn.innerHTML = `<span class="material-icons">${partVis[part] ? 'visibility' : 'visibility_off'}</span>`;

  if (part === 'spacer') {
    if (partVis.spacer) loadModel('spacer');
    // Reposition the already-loaded lower parts in place — no need to refetch
    // and re-parse their GLBs just to shift them 16 units (which also skipped
    // arms/bumper before).
    refreshSpacerOffsets();
  } else if (loadedMods[part]) {
    if (!loadedMods[part].parent) scene.add(loadedMods[part]);
  } else if (partVis[part]) {
    loadModel(part, true);
  }

  if (partVis[part]) enforceArmsBumperExclusion(part);
  enforceBottomMotionExclusion();
  enforceHatRequiresTopHats();
  refreshConflictBadges();
  updateComboChip();
  markCustomPreset();

  // Resync every part's on-screen state to match its current partVis --
  // not just the one that was clicked, since the enforce* calls above may
  // have silently hidden/shown others too.
  for (const p of Object.keys(modelSets)) {
    if (!loadedMods[p]) continue;
    if (!loadedMods[p].parent) scene.add(loadedMods[p]);
    loadedMods[p].visible = true;
    setGhostHighlight(p, !partVis[p]);
  }
}

// TEMPORARY dev helper for picking the default camera angle -- rotate/zoom
// the model by hand, press "C", and read the exact position/target off the
// toast instead of guessing coordinates from a screenshot. Remove once the
// final angle is locked in.
function setupCameraDebugReadout() {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'c' && event.key !== 'C') return;
    if (event.target.matches('input, textarea, [contenteditable]')) return;
    const p = camera.position;
    const t = controls.target;
    const msg = `pos(${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}) target(${t.x.toFixed(0)}, ${t.y.toFixed(0)}, ${t.z.toFixed(0)})`;
    console.log('CAMERA:', msg);
    toast(msg, 'ok', 6000);
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
      // The user just made an explicit visibility call on Motion themselves --
      // enforceBottomMotionExclusion() below will immediately re-hide it if
      // the bottom still conflicts (bottom always wins), but that's a fresh
      // auto-hide, not a leftover one; clear the stale flag either way so it
      // doesn't get restored later based on a decision that's no longer current.
      if (part === 'wheels') wheelsAutoHiddenByBottom = false;

      if (part === 'spacer') {
        if (partVis.spacer) {
          loadModel('spacer');
        } else if (loadedMods.spacer) {
          scene.remove(loadedMods.spacer);
          loadedMods.spacer = null;
        }
        refreshSpacerOffsets();
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
      url.searchParams.set('file', 'Top_lights_NOlogo.glb');
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
      const pIdx = currentIdx[part] ?? 0;
      const isExtra = mixExtraUrls.has(part);
      let url = await firstExistingUrl(getAssetCandidates(part, pIdx, 'stl'));
      if (!url) {
        const stepUrls = getAssetCandidates(part, pIdx, 'step');
        // A mix `extras` piece is repo-only — verify the STEP actually exists
        // (model-placer writes a sibling .stl on save; older pieces may have
        // neither, in which case there's no URL to give a slicer://).
        url = isExtra ? await firstExistingUrl(stepUrls) : stepUrls[0];
        if (!url) {
          try {
            downloadBlob(await exportPartAsStlBlob(part), `${getPartFileBase(part)}.stl`);
            toast('No hosted print file yet — STL downloaded. Re-save this piece in Model Placer to send it straight to a slicer.', 'warn', 3200);
          } catch {
            toast(`No printable file for ${getPartDisplayName(part)}.`, 'warn', 1800);
          }
          return;
        }
      }

      // getPreferredSlicer() can only return 'prusa' once PRUSA_SLICER_LIVE is
      // true (see slicer-preference.js) — until then this always resolves to
      // 'orca', so this branch is safe to ship in any build. PrusaSlicer's
      // prusaslicer://open handler only accepts download URLs from a short
      // reviewed allowlist; hprobots.com has been approved for addition, but
      // it only takes effect once Prusa actually ships the release containing
      // it. OrcaSlicer's orcaslicer://open has no such allowlist and always
      // works regardless.
      const preferredSlicer = getPreferredSlicer();
      const scheme = preferredSlicer === 'prusa' ? 'prusaslicer' : 'orcaslicer';
      const fullUrl = new URL(url, window.location.href).href;
      const link = document.createElement('a');
      link.href = `${scheme}://open?file=${encodeURIComponent(fullUrl)}`;
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
        // Prefer a hosted .stl (model-placer writes one for mixonly pieces);
        // otherwise export from the loaded mesh.
        const hostedUrl = await firstExistingUrl(getAssetCandidates(part, currentIdx[part] ?? 0, 'stl'));
        const blob = hostedUrl
          ? await (await fetch(hostedUrl)).blob()
          : await exportPartAsStlBlob(part);
        downloadBlob(blob, `${getPartFileBase(part)}.stl`);
        toast(`${getPartDisplayName(part)} STL downloaded.`, 'ok', 1600);
      } catch (error) {
        console.error(error);
        toast(`Failed to download ${getPartDisplayName(part)}.`, 'err', 2200);
      }
    }

    if (touched) {
      markCustomPreset();
    }
  });
}

function initPillsAndButtons() {
  for (const part of Object.keys(modelSets)) {
    syncPillColor(part);

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

// Caps how many toasts can be stacked up on screen at once -- rapid repeat
// clicks on something like the randomize button used to queue one toast per
// click with nothing capping the pile-up, so a burst of clicks left a wall
// of them stacked on screen long after the clicking stopped. Dropping the
// oldest as a new one arrives keeps the stack readable no matter how fast
// they come in, without changing timing/behavior for the normal case.
const TOAST_MAX_VISIBLE = 3;

function toast(message, type = 'ok', ms = 2000) {
  while (toastStack.children.length >= TOAST_MAX_VISIBLE) {
    toastStack.firstElementChild.remove();
  }
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

function setPresetLabel(label) {
  presetLabelEl.textContent = label;
  presetToggle.setAttribute('aria-label', `Active preset: ${label}`);
  const presetPanelCurrent = document.getElementById('preset-panel-current');
  if (presetPanelCurrent) presetPanelCurrent.textContent = label;
}

// Queries live rather than using a cached list — the desktop .preset-card
// elements (see renderPresetCarousel) don't exist yet at script-parse time,
// only once the mixes panel first builds them, so a snapshot array taken up
// front would never see them.
function syncPresetButtons(key) {
  document.querySelectorAll('.preset-option[data-preset], .preset-card[data-preset]').forEach((button) => {
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


function markCustomPreset() {
  if (isApplyingPreset) return;
  activePresetKey = 'custom';
  setPresetLabel('Custom mix');
  syncPresetButtons('');
  syncShowcaseMode(); // re-evaluate the part-UI lock for the new (custom) state
  saveStateToLocal();
}

function clampPresetIndex(part, idx) {
  const list = modelSets[part] || [];
  if (!list.length) return 0;
  return Math.min(Math.max(Number(idx) || 0, 0), list.length - 1);
}

// Resolves a preset's part reference to a current index in modelSets. Presets
// pin variants by filename (see the presets object); this finds where that
// file currently sits. A plain number is tolerated as a legacy fallback. An
// unknown/removed filename resolves to the first variant with a warning, so a
// renamed asset degrades visibly-but-safely instead of loading the wrong part.
function resolvePresetIndex(part, ref) {
  if (typeof ref === 'number') return clampPresetIndex(part, ref);
  const list = modelSets[part] || [];
  const idx = list.findIndex((url) => url.split('/').pop() === ref);
  if (idx === -1) {
    console.warn(`Preset references unknown ${part} variant "${ref}" — falling back to the first.`);
    return 0;
  }
  return idx;
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
  // A mix `extras` piece: its only home is assets/models/_mixonly/<file>.glb;
  // a sibling .step / .stl may or may not have been uploaded next to it.
  if (mixExtraUrls.has(part)) {
    const ext = format === 'step' ? '.step' : format === 'stl' ? '.stl' : '.glb';
    return uniqueUrls([mixExtraUrls.get(part).replace(/\.glb$/i, ext)]);
  }

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
    modelMeshCols,
    mixExtras: activeMixExtras,
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
      if (!modelCols[part]) modelCols[part] = new THREE.Color(DEFAULT_PART_COLOR);
      modelCols[part].set(saved.modelCols[part] || DEFAULT_PART_COLOR);
    }
  }

  // Per-mesh paint overrides, keyed by part -> variant index -> mesh index
  // (see modelMeshCols above applyColor). Restored wholesale — applyColor
  // looks entries up by the current variant index at repaint time, so a
  // variant this build isn't currently showing just sits unused until (if
  // ever) the user navigates back to it.
  if (saved.modelMeshCols && typeof saved.modelMeshCols === 'object') {
    for (const part of Object.keys(saved.modelMeshCols)) {
      if (modelSets[part] || mixExtraUrls.has(part)) modelMeshCols[part] = saved.modelMeshCols[part];
    }
  }

  // Standalone mix models. Absent key (older state) -> leave whatever's loaded.
  // Runs after modelCols/modelMeshCols above, so setMixExtras' applyColor()
  // repaints each piece with the restored paint.
  if (Array.isArray(saved.mixExtras)) setMixExtras(saved.mixExtras);

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
    syncShowcaseMode();
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
    modelCols: Object.fromEntries(Object.entries(modelCols).map(([part, color]) => [part, `#${color.getHexString()}`])),
    modelMeshCols,
    mixExtras: activeMixExtras
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
    syncShowcaseMode();
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

  // On any touch device the native share sheet (Messages/WhatsApp/email/...)
  // is the expected action for a share tap, not a silent clipboard copy —
  // tablets in the desktop layout included, not just phones.
  if (isTouchCapable() && navigator.share) {
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

// Broader than isTouchLikeDevice(): true for ANY device without a fine pointer,
// regardless of screen size — so it also covers tablets in landscape that keep
// the desktop layout (>1024px) but still can't hover, right-click or type. Used
// for the touch fallbacks of otherwise desktop-only interactions (the on-model
// quick-control popup, right-click piece reset, keyboard hints). The
// `touch-capable` class on <html> is the CSS-side mirror, set early in
// index.html's head; this keeps it live if the primary pointer changes (a 2-in-1
// being docked/undocked). Mirrors the (any-pointer: coarse) query in app.css.
function isTouchCapable() {
  try {
    // matchMedia alone under-reports on some tablets / in-app browsers (and in
    // emulated modes), so OR in the two direct touch signals. Kept in sync with
    // the same three-way check in index.html's head script.
    return window.matchMedia('(any-pointer: coarse)').matches
      || (navigator.maxTouchPoints || 0) > 0
      || 'ontouchstart' in window;
  } catch { return false; }
}
function syncTouchCapableClass() {
  document.documentElement.classList.toggle('touch-capable', isTouchCapable());
}
syncTouchCapableClass();
try {
  window.matchMedia('(any-pointer: coarse)').addEventListener('change', syncTouchCapableClass);
} catch {}
// Last-resort: the first genuine touch proves the device is touch-capable even
// if every static signal above missed it.
window.addEventListener('touchstart', () => {
  document.documentElement.classList.add('touch-capable');
}, { once: true, passive: true, capture: true });

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

  if (!visibleParts.length && !mixExtrasGroup.children.length) throw new Error('No visible parts to export');

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

  // Standalone mix models (presets.js `extras`) — shown as authored, no tint.
  // mixExtrasGroup carries the MODEL_Y_OFFSET lift the part clones bake into
  // their own position, so fold it into each child clone.
  mixExtrasGroup.children.forEach((child) => {
    const clone = child.clone(true);
    clone.position.y += mixExtrasGroup.position.y;
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
  return mixExtrasGroup.children.length > 0
    || Object.keys(modelSets).some((part) => partVis[part] && loadedMods[part]);
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
  const overrides = getMeshOverrides(part);
  model.traverse((child) => {
    if (!child.isMesh) return;
    const overrideHex = overrides && overrides[child.userData.meshIndex];
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (!material?.color) return;
      if (overrideHex) material.color.set(overrideHex);
      else material.color.set(modelCols[part]);
      material.needsUpdate = true;
    });
  });
}

// Returns this part's per-mesh paint overrides for its *currently loaded
// variant* (see modelMeshCols above). `create` lazily allocates the nested
// objects so callers that only want to read (e.g. applyColor, on every
// repaint) don't leave empty {} entries behind for every part/variant ever
// visited.
function getMeshOverrides(part, create = false) {
  const variantIdx = currentIdx[part] ?? 0;
  if (!modelMeshCols[part]) {
    if (!create) return null;
    modelMeshCols[part] = {};
  }
  if (!modelMeshCols[part][variantIdx]) {
    if (!create) return null;
    modelMeshCols[part][variantIdx] = {};
  }
  return modelMeshCols[part][variantIdx];
}

function toMaterialArray(material) {
  return Array.isArray(material) ? material : [material];
}

function getPartDisplayName(part) {
  const meta = PART_META.find((meta) => meta.key === part);
  if (meta) return meta.label;
  // A mix `extras` piece — key is its filename; show it human-ish.
  return part.replace(/\.glb$/i, '').replace(/[_-]+/g, ' ').trim() || part;
}

// Base name for a downloaded/printed file. Parts use the part key; a mix
// `extras` piece uses its filename minus the .glb.
function getPartFileBase(part) {
  return mixExtraUrls.has(part) ? part.replace(/\.glb$/i, '') : part;
}

// True when the current build is a pure showcase: standalone `extras` are
// loaded and no part is visible. Its part panels / colour sidebar are then
// locked — nothing there to act on; you paint/print the pieces on the model.
// Live-state based (not just the preset def) so it survives the mix becoming a
// "custom mix" the moment you paint one of its pieces.
function isShowcaseMix() {
  if (!mixExtrasGroup.children.length) return false;
  return !Object.keys(modelSets).some((part) => partVis[part] && loadedMods[part]);
}

function syncShowcaseMode() {
  const on = isShowcaseMix();
  const page = document.getElementById('parts-page');
  document.getElementById('panel-essential')?.classList.toggle('showcase-locked', on);
  document.getElementById('color-sidebar')?.classList.toggle('showcase-locked', on);
  document.getElementById('color-sidebar-toggle')?.classList.toggle('showcase-locked', on);
  // The "show/hide individual parts" (V) tool is meaningless with no parts.
  visibilityModeBtn?.classList.toggle('showcase-locked', on);
  if (on && visibilityEditMode) exitVisibilityEditMode();
  if (page) {
    let note = document.getElementById('showcase-note');
    if (on && !note) {
      note = document.createElement('p');
      note.id = 'showcase-note';
      note.className = 'showcase-note';
      note.textContent = 'Fixed mix — click a piece on the model to paint, print or download it.';
      page.prepend(note);
    }
    if (note) note.hidden = !on;
  }
  renderMixCodePanel(on);
}

// ---------------------------------------------------------------------------
// Per-mix code panel (showcase mixes only)
//
// A special mix can ship code for the HP Otto app. A "Python" disclosure
// button under the mix carousel reveals assets/mix-code/<codeId>.py with a
// Copy button; the preset opts in with `codeId: '<name>'` (see presets.js).
// State (mixCodeEl / mixCodeCache) is declared up near the mixExtras state —
// this runs during bootstrap().
// ---------------------------------------------------------------------------
// Desktop: the "Python" button sits in the right-dock tab row (left of
// Mixes/Parts) and the code drops open just below the tab row, over whichever
// page is showing. Mobile has no dock, so it falls back to a panel in the
// mixes sheet.
function mixCodeOnDock() {
  return !mobileLayoutActive && !!document.querySelector('.right-dock-tabs');
}

// highlight.js (+ line-numbers plugin) — lazily injected the first time the
// user opens a code block, so it never touches first paint. Highlighting is
// best-effort: on any load failure the code just shows as plain monospace text.
let hljsReady = null;
function ensureHljs() {
  if (hljsReady) return hljsReady;
  const CDN = 'https://cdnjs.cloudflare.com/ajax/libs';
  const add = (el, attrs) => { Object.assign(el, attrs); el.crossOrigin = 'anonymous'; document.head.appendChild(el); return el; };
  add(document.createElement('link'), {
    rel: 'stylesheet',
    href: `${CDN}/highlight.js/11.11.1/styles/github.min.css`,
    integrity: 'sha384-eFTL69TLRZTkNfYZOLM+G04821K1qZao/4QLJbet1pP4tcF+fdXq/9CdqAbWRl/L',
  });
  hljsReady = new Promise((resolve) => {
    const core = document.createElement('script');
    add(core, {
      src: `${CDN}/highlight.js/11.11.1/highlight.min.js`,
      integrity: 'sha384-RH2xi4eIQ/gjtbs9fUXM68sLSi99C7ZWBRX1vDrVv6GQXRibxXLbwO2NGZB74MbU',
      onerror: () => resolve(null),
      onload: () => {
        const ln = document.createElement('script');
        add(ln, {
          src: `${CDN}/highlightjs-line-numbers.js/2.8.0/highlightjs-line-numbers.min.js`,
          integrity: 'sha384-+ch8x/dgaV//v6Sa8m4v5+7KScnpCuxHqilN8njQ013CEKg3Fbd8Q3oN9tfpouLh',
          onload: () => resolve(window.hljs || null),
          onerror: () => resolve(window.hljs || null), // line numbers optional
        });
      },
    });
  });
  return hljsReady;
}

function destroyMixCodePanel() {
  if (!mixCodeEl) return;
  mixCodeEl.wrap?.remove();
  mixCodeEl.toggle?.remove();
  mixCodeEl.body?.remove();
  mixCodeEl = null;
}

function buildMixCodePanel() {
  const onDock = mixCodeOnDock();

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'mix-code-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  // starts hidden via the .u-hidden / .mix-code-panel.u-hidden class set below

  const body = document.createElement('div');
  body.id = 'mix-code-body';
  body.className = 'mix-code-body';
  body.hidden = true;
  body.innerHTML = `
    <div class="mix-code-bar">
      <span class="mix-code-file" data-role="mix-code-file">code.py</span>
      <button type="button" class="mix-code-copy" data-role="mix-code-copy"><span class="material-icons">content_copy</span>Copy</button>
    </div>
    <pre class="mix-code-pre"><code class="language-python"></code></pre>
    <p class="mix-code-hint">Paste this into the HP Otto app.</p>
  `;

  let wrap = null;
  if (onDock) {
    // A standalone floating icon button, sitting just OUTSIDE the dock to the
    // left of the Mixes tab. positionMixCodeDock() places both it and the
    // dropdown relative to the live tab rect (see the resize listener).
    toggle.className = 'mix-code-tab u-hidden';
    toggle.title = 'Python code for this mix';
    toggle.setAttribute('aria-label', 'Python code for this mix');
    toggle.innerHTML = `<span class="material-icons" aria-hidden="true">code</span><span>Python code</span>`;
    body.classList.add('mix-code-body--float');
    document.body.append(toggle, body);
  } else {
    const host = document.getElementById('mobile-sheet-mixes') || document.getElementById('preset-panel');
    if (!host) return null;
    toggle.className = 'mix-code-toggle';
    toggle.innerHTML = `<span class="material-icons mix-code-lead" aria-hidden="true">code</span>Python<span class="material-icons mix-code-caret" aria-hidden="true">expand_more</span>`;
    wrap = document.createElement('div');
    wrap.id = 'mix-code-panel';
    wrap.className = 'mix-code-panel u-hidden';
    wrap.append(toggle, body);
    host.appendChild(wrap);
  }

  mixCodeEl = {
    onDock, wrap, toggle, body,
    pre: body.querySelector('.mix-code-pre'),
    file: body.querySelector('[data-role="mix-code-file"]'),
    copyBtn: body.querySelector('[data-role="mix-code-copy"]'),
    expanded: false,
    rendered: false,
  };
  toggle.addEventListener('click', toggleMixCode);
  mixCodeEl.copyBtn.addEventListener('click', copyMixCode);
  return mixCodeEl;
}

function setMixCodeVisible(show) {
  const el = mixCodeEl;
  if (!el) return;
  // .u-hidden ({display:none!important}) — the dock chip needs it because a
  // bare [hidden] loses to any element that sets its own `display`.
  el.toggle.classList.toggle('u-hidden', !show);
  el.wrap?.classList.toggle('u-hidden', !show);
  if (!show) setMixCodeExpanded(false);
  else if (el.onDock) positionMixCodeDock();
}

function setMixCodeExpanded(open) {
  const el = mixCodeEl;
  if (!el) return;
  el.expanded = open;
  el.toggle.classList.toggle('is-open', open);
  el.body.classList.toggle('is-open', open);
  el.wrap?.classList.toggle('is-open', open);
  el.body.hidden = !open;
  el.toggle.setAttribute('aria-expanded', String(open));
  if (open && el.onDock) positionMixCodeDock();
}

// Places the floating chip just left of the Mixes tab, and the dropdown just
// below it — both anchored to the live tab rect so they track the dock.
function positionMixCodeDock() {
  const el = mixCodeEl;
  if (!el?.onDock || el.toggle.classList.contains('u-hidden')) return;
  const anchor = document.getElementById('dock-tab-mixes');
  const dock = document.getElementById('right-dock');
  if (!anchor || !dock) return;
  const a = anchor.getBoundingClientRect();
  const d = dock.getBoundingClientRect();
  const gap = 8;
  const w = el.toggle.offsetWidth || 120;
  const h = el.toggle.offsetHeight || 34;
  // Just OUTSIDE the dock box on the left; vertically centred on the Mixes tab
  // so it lines up with the tab-row divider.
  el.toggle.style.left = `${Math.max(8, d.left - w - gap)}px`;
  el.toggle.style.top = `${Math.round(a.top + (a.height - h) / 2)}px`;
  // Dropdown: right edge just clear of the dock, growing leftward.
  el.body.style.top = `${a.bottom + gap}px`;
  el.body.style.right = `${Math.max(8, window.innerWidth - d.left + gap)}px`;
}
window.addEventListener('resize', positionMixCodeDock);

function toggleMixCode() {
  const el = mixCodeEl;
  if (!el) return;
  const open = !el.expanded;
  setMixCodeExpanded(open);
  if (open && !el.rendered && el.raw != null) {
    el.rendered = true;
    // Fresh <code> so the line-numbers plugin's table can't stack up.
    el.pre.innerHTML = '<code class="language-python"></code>';
    const code = el.pre.firstChild;
    code.textContent = el.raw;
    ensureHljs().then((hljs) => {
      if (!hljs || !code.isConnected) return;
      try {
        hljs.highlightElement(code);
        hljs.lineNumbersBlock?.(code);
      } catch { /* leave plain text */ }
    });
  }
}

async function loadMixCode(codeId) {
  if (mixCodeCache.has(codeId)) return mixCodeCache.get(codeId);
  let entry = { code: null, ok: false };
  try {
    const res = await fetch(`./assets/mix-code/${codeId}.py`, { cache: 'no-store' });
    if (res.ok) entry = { code: await res.text(), ok: true };
  } catch { /* no code file for this mix */ }
  mixCodeCache.set(codeId, entry);
  return entry;
}

function copyMixCode() {
  const text = mixCodeEl?.raw || '';
  if (!text) return;
  const ok = () => {
    toast('Code copied', 'ok', 1400);
    const btn = mixCodeEl.copyBtn;
    btn.classList.add('is-copied');
    setTimeout(() => btn.classList.remove('is-copied'), 1400);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(ok).catch(fallbackCopy);
  } else {
    fallbackCopy();
  }
  function fallbackCopy() {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); ok(); } catch {}
    ta.remove();
  }
}

let mixCodeRenderToken = 0;
function renderMixCodePanel(on) {
  const codeId = on ? presets[activePresetKey]?.codeId : null;
  if (!codeId) {
    setMixCodeVisible(false);
    return;
  }
  // Rebuild if a desktop<->mobile layout swap changed where it belongs.
  if (mixCodeEl && mixCodeEl.onDock !== mixCodeOnDock()) destroyMixCodePanel();
  const el = mixCodeEl || buildMixCodePanel();
  if (!el) return;

  const token = ++mixCodeRenderToken;
  loadMixCode(codeId).then((entry) => {
    if (token !== mixCodeRenderToken) return;           // a newer mix took over
    if (!isShowcaseMix() || presets[activePresetKey]?.codeId !== codeId) return;
    if (!entry.ok) { setMixCodeVisible(false); return; }
    // Only the "Python" button shows until clicked — the code + highlighter
    // load on first open (see toggleMixCode).
    el.raw = entry.code;
    el.rendered = false;
    el.file.textContent = `${codeId}.py`;
    setMixCodeExpanded(false);
    setMixCodeVisible(true);
  });
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

// ---------------------------------------------------------------------------
// Combo counting
//
// The chip shows how many *distinct, buildable* robots the currently visible
// parts can make. The old answer was just the product of each visible part's
// variant count, which badly overcounts: assets/compatibility.json (built by
// tools/compat-checker.html) flags 140+ specific variant *pairs* as physically
// incompatible, and two structural rules knock out whole slices of the space
// (a visible Hat pins Top to Top_Hats.glb; an F1/Boat Bottom rules out every
// Motion variant). countValidBuilds() returns the exact number of variant
// assignments -- one per visible part -- that break none of those rules.
//
// That's an exact model count of a binary constraint problem. Brute force is
// out (the raw product runs to ~10^8), but the constraint graph is sparse and
// this robot is a physical stack, so its treewidth is tiny. Variable
// elimination -- repeatedly sum out the cheapest part, replacing every factor
// that mentions it with one factor over its neighbours -- gets the exact count
// with every intermediate table staying a few thousand rows at worst. The
// result is memoized on the visible-part set; nothing about the count depends
// on which variant is currently selected.
// ---------------------------------------------------------------------------
// (comboCountCache is declared up near compatibilityMap -- bootstrap() reaches
// this code before a declaration here would be initialized.)

// Bottom variants whose mount fits no Motion/wheel variant at all --
// enforceBottomMotionExclusion hides Motion outright for these, so builds
// pairing them with a visible Motion are unreachable and must not be counted.
// compatibility.json only lists a subset of these pairs; this is the
// authoritative test, matched the same way that function checks the live
// selection (bottomIsF1Variant / bottomIsBoatVariant).
function bottomFileExcludesWheels(file) {
  return /bottom_f1/i.test(file) || /bottom_boat/i.test(file);
}

// Exact count of valid full builds (one variant per currently visible part,
// no incompatible pair) via variable elimination over the constraint graph.
function countValidBuilds() {
  const parts = Object.keys(modelSets).filter(
    (part) => partVis[part] && (modelSets[part]?.length || 0) > 0
  );
  if (!parts.length) return 0;

  const cacheKey = `${compatibilityMap ? 'map' : 'nomap'}:${partVis.spacer ? 'sp' : 'nosp'}:${parts.slice().sort().join(',')}`;
  if (comboCountCache.has(cacheKey)) return comboCountCache.get(cacheKey);

  // Domain of each part = its variant indices. A visible Hat pins Top to
  // Top_Hats.glb (enforceHatRequiresTopHats), collapsing Top's domain to one.
  const domains = {};
  for (const part of parts) domains[part] = modelSets[part].map((_, i) => i);
  if (domains.hat && domains.top) {
    const hatsIdx = modelSets.top.findIndex((url) => url.endsWith(`/${HAT_REQUIRED_TOP_FILE}`));
    if (hatsIdx !== -1) domains.top = [hatsIdx];
  }

  // filename -> variant index, per visible part, to resolve compatibility keys.
  const idxOfFile = {};
  for (const part of parts) {
    const m = new Map();
    modelSets[part].forEach((url, i) => m.set(url.split('/').pop(), i));
    idxOfFile[part] = m;
  }

  // Forbidden index pairs, keyed by unordered part pair "pA::pB" (part
  // names sorted) -> Set("iA,iB"). Sources: the compatibility map, plus the
  // Bottom/Motion structural rule.
  const forbidden = new Map();
  const banPair = (pa, ia, pb, ib) => {
    const [p1, i1, p2, i2] = pa < pb ? [pa, ia, pb, ib] : [pb, ib, pa, ia];
    const key = `${p1}::${p2}`;
    let set = forbidden.get(key);
    if (!set) forbidden.set(key, (set = new Set()));
    set.add(`${i1},${i2}`);
  };

  const compatMap = activeCompatMap();
  if (compatMap) {
    for (const [keyA, incompatible] of compatMap) {
      const [partA, fileA] = keyA.split('|');
      if (!domains[partA]) continue;
      const ia = idxOfFile[partA].get(fileA);
      if (ia === undefined || !domains[partA].includes(ia)) continue;
      for (const keyB of incompatible) {
        const [partB, fileB] = keyB.split('|');
        if (partB === partA || !domains[partB]) continue;
        const ib = idxOfFile[partB].get(fileB);
        if (ib === undefined || !domains[partB].includes(ib)) continue;
        banPair(partA, ia, partB, ib);
      }
    }
  }

  if (domains.bottom && domains.wheels) {
    for (const ib of domains.bottom) {
      if (bottomFileExcludesWheels(modelSets.bottom[ib].split('/').pop())) {
        for (const iw of domains.wheels) banPair('bottom', ib, 'wheels', iw);
      }
    }
  }

  // --- Variable elimination ---
  // Factor := { vars: [partName...], rows: Map("i,i,..." -> count) }, indices
  // in `vars` order. Multiplying joins on shared vars; summing a var out drops
  // its column and folds duplicate rows together.
  const multiply = (f1, f2) => {
    const vars = f1.vars.concat(f2.vars.filter((v) => !f1.vars.includes(v)));
    const shared = f1.vars.filter((v) => f2.vars.includes(v));
    const f1SharedPos = shared.map((v) => f1.vars.indexOf(v));
    const f2SharedPos = shared.map((v) => f2.vars.indexOf(v));
    const f2RestPos = f2.vars.map((_, i) => i).filter((i) => !f1.vars.includes(f2.vars[i]));

    const f2ByShared = new Map();
    for (const [k, val] of f2.rows) {
      const a = k.split(',');
      const sig = f2SharedPos.map((p) => a[p]).join(',');
      let arr = f2ByShared.get(sig);
      if (!arr) f2ByShared.set(sig, (arr = []));
      arr.push([a, val]);
    }

    const rows = new Map();
    for (const [k1, v1] of f1.rows) {
      const a1 = k1.split(',');
      const sig = f1SharedPos.map((p) => a1[p]).join(',');
      const matches = f2ByShared.get(sig);
      if (!matches) continue;
      for (const [a2, v2] of matches) {
        const ck = a1.concat(f2RestPos.map((p) => a2[p])).join(',');
        rows.set(ck, (rows.get(ck) || 0) + v1 * v2);
      }
    }
    return { vars, rows };
  };

  const sumOut = (f, v) => {
    const pos = f.vars.indexOf(v);
    const vars = f.vars.filter((x) => x !== v);
    const rows = new Map();
    for (const [k, val] of f.rows) {
      const a = k.split(',');
      a.splice(pos, 1);
      const nk = a.join(',');
      rows.set(nk, (rows.get(nk) || 0) + val);
    }
    return { vars, rows };
  };

  let pool = [];
  // Unary factor per part (every allowed variant counts once).
  for (const part of parts) {
    const rows = new Map();
    for (const i of domains[part]) rows.set(String(i), 1);
    pool.push({ vars: [part], rows });
  }
  // Binary factor per constrained pair: exactly the allowed index pairs.
  for (const [key, banned] of forbidden) {
    const [pa, pb] = key.split('::');
    const rows = new Map();
    for (const ia of domains[pa]) {
      for (const ib of domains[pb]) {
        if (!banned.has(`${ia},${ib}`)) rows.set(`${ia},${ib}`, 1);
      }
    }
    pool.push({ vars: [pa, pb], rows });
  }

  const remaining = new Set(parts);
  while (remaining.size) {
    // Sum out whichever part has the smallest combined factor scope
    // (min-degree ordering -- keeps the intermediate tables small).
    let pick = null;
    let pickScope = Infinity;
    for (const v of remaining) {
      const scope = new Set();
      for (const f of pool) {
        if (f.vars.includes(v)) f.vars.forEach((x) => scope.add(x));
      }
      if (scope.size < pickScope) {
        pickScope = scope.size;
        pick = v;
      }
    }
    const involved = pool.filter((f) => f.vars.includes(pick));
    pool = pool.filter((f) => !f.vars.includes(pick));
    let acc = involved[0];
    for (let i = 1; i < involved.length; i++) acc = multiply(acc, involved[i]);
    pool.push(sumOut(acc, pick));
    remaining.delete(pick);
  }

  // Every factor left is a scalar (vars: []). Their product is the answer.
  let total = 1;
  for (const f of pool) {
    let s = 0;
    for (const val of f.rows.values()) s += val;
    total *= s;
  }
  total = Math.round(total);
  comboCountCache.set(cacheKey, total);
  return total;
}

function updateComboChip() {
  const chip = document.getElementById('comboChip');
  if (!chip) return;
  // A mix built purely from standalone `extras` (all parts hidden) has no
  // variant space to count — it's one fixed showcase, not "0 combos".
  const combos = countValidBuilds() || (mixExtrasGroup.children.length ? 1 : 0);
  chip.textContent = `Combos: ${combos.toLocaleString()}`;
  chip.title = 'Distinct buildable robots from the visible parts, after removing '
    + 'variant pairs flagged incompatible in the compatibility check.';
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
// (HAT_REQUIRED_TOP_FILE is declared up near compatibilityMap -- bootstrap()
// reaches countValidBuilds(), which also reads it, before a declaration here
// would be initialized.)

function enforceHatRequiresTopHats(silent = false) {
  if (!partVis.hat || !partVis.top) return;
  const requiredIdx = modelSets.top.findIndex((url) => url.endsWith(`/${HAT_REQUIRED_TOP_FILE}`));
  if (requiredIdx === -1 || currentIdx.top === requiredIdx) return;

  currentIdx.top = requiredIdx;
  loadModel('top', true);
  updateVariantCounter('top');
  if (!silent) toast('Top switched to "Hats" — the only top compatible with a hat.', 'warn', 2400);
}

// The `part|file` identity for a variant of `part`, in the same "manifest
// key + filename" shape tools/compat-checker.js uses as its pair keys — the
// two never need to agree on anything more than that shared string format.
// Defaults to whatever's currently selected, but randomizeBuild also calls
// this with a candidate index it hasn't committed to yet, to test a pick
// against the compatibility map before accepting it.
function partFileKey(part, idx = currentIdx[part] ?? 0) {
  const url = modelSets[part]?.[idx];
  if (!url) return null;
  return `${part}|${url.split('/').pop()}`;
}

// Loads assets/compatibility.json (written by tools/compat-checker.html) into
// two bidirectional adjacency maps of `part|file` -> Set of incompatible
// `part|file` keys, keeping only entries a human has actually confirmed
// ("incompatible" — auto-flagged-but-undecided pairs are not enforced). Fails
// open on any error: the file may not exist yet for a fresh checkout, and a
// missing compatibility map should never block a combination.
//
// The checker screens spacer-sensitive pairs twice — a plain row and a
// "<pair> + spacer" row (key suffixed `::spacer`, or `entry.spacer === true`)
// — each with its own verdict. `noSpacer` takes only the plain verdicts;
// `withSpacer` starts as a copy of them, then every "+ spacer" verdict
// overrides its pair there: added if that config is incompatible, removed if
// the Spacer makes the pair fit.
async function loadCompatibilityMap() {
  const noSpacer = new Map();
  const withSpacer = new Map();
  const addEdge = (map, a, b) => {
    if (!map.has(a)) map.set(a, new Set());
    if (!map.has(b)) map.set(b, new Set());
    map.get(a).add(b);
    map.get(b).add(a);
  };
  const removeEdge = (map, a, b) => {
    map.get(a)?.delete(b);
    map.get(b)?.delete(a);
  };
  const isSpacerRow = (key, entry) => entry.spacer === true || key.endsWith('::spacer');
  try {
    const res = await fetch('./assets/compatibility.json', { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      const entries = Object.entries(json.pairs || {});
      for (const [key, entry] of entries) {
        if (isSpacerRow(key, entry) || entry.status !== 'incompatible') continue;
        const a = `${entry.partA}|${entry.fileA}`;
        const b = `${entry.partB}|${entry.fileB}`;
        addEdge(noSpacer, a, b);
        addEdge(withSpacer, a, b);
      }
      for (const [key, entry] of entries) {
        if (!isSpacerRow(key, entry)) continue;
        const a = `${entry.partA}|${entry.fileA}`;
        const b = `${entry.partB}|${entry.fileB}`;
        if (entry.status === 'incompatible') addEdge(withSpacer, a, b);
        else removeEdge(withSpacer, a, b);
      }
    }
  } catch {
    // No compatibility data available — leave the maps empty.
  }
  compatibilityMap = noSpacer;
  compatibilityMapSpacer = withSpacer;
  comboCountCache.clear();
  refreshConflictBadges();
  updateComboChip();
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
    if (part === 'wheels' && partVis.bottom && (bottomIsF1Variant() || bottomIsBoatVariant())) {
      return { otherPart: 'bottom', hidden: true };
    }
  }
  // A geometry clash only exists once both sides are actually on screen
  // together — a part that's manually turned off isn't clashing with
  // anything regardless of what variant it's parked on, so this branch
  // requires `part` itself to be visible too, not just the other side.
  const compatMap = activeCompatMap();
  if (compatMap && partVis[part]) {
    const key = partFileKey(part);
    const incompatibleWith = key && compatMap.get(key);
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

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Starts (or reverses) `part`'s ghost animation -- doesn't set final
// opacity/visibility directly, just the one-time setup (material swap,
// zero-opacity edge outline, phase = 'in') or flips phase to 'out'; the
// actual fade math and end-of-fade cleanup both live in updateGhostAnimation
// below, driven every frame from animate(). Reversing mid-fade (ghosted
// requested again before a fade-out finished, or vice versa) reuses the
// still-live material/edges rather than recreating them, so rapid toggling
// can't leak or double up geometry.
function setGhostHighlight(part, ghosted) {
  const obj = loadedMods[part];
  if (!obj) return;
  const now = performance.now();
  obj.traverse((node) => {
    if (!node.isMesh) return;
    const phase = node.userData.ghostPhase;
    if (ghosted) {
      if (phase === 'in' || phase === 'steady') return;
      if (phase !== 'out') {
        node.userData.preGhostMaterial = node.material;
        node.userData.ghostPart = part;
        node.material = new THREE.MeshBasicMaterial({
          color: 0x8ab4e8,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          // depthTest off on the FILL only: the soft translucent volume reads
          // straight through whatever opaque geometry is in front of it (outer
          // shell, another part) instead of getting a hard silhouette cut
          // where that surface's edge crosses it. The crisp edge outline
          // below keeps depthTest ON so it stays occluded by visible parts --
          // so a hidden part shows as a faint glow through the shell without
          // its bright pulsing wireframe bleeding over the top of everything.
          depthTest: false,
          side: THREE.DoubleSide,
          // Some hidden parts (e.g. Bumper's mounting plate) sit almost flush
          // against another part's own surface -- two transparent triangles
          // that close together sort unstably frame-to-frame as the camera
          // orbits, which reads as flickering/"glitching". Nudging the ghost
          // slightly toward the camera in depth (without moving it in space)
          // gives the sort a consistent winner instead.
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4
        });
        const edges = new THREE.LineSegments(
          getGhostEdgesGeometry(node.geometry),
          new THREE.LineBasicMaterial({ color: GHOST_EDGE_COLOR_BASE.getHex(), transparent: true, opacity: 0 })
        );
        node.add(edges);
        node.userData.ghostEdges = edges;
      }
      node.userData.ghostPhase = 'in';
      node.userData.ghostFadeStart = now;
      ghostAnimNodes.add(node);
    } else {
      if (phase !== 'in' && phase !== 'steady') return;
      node.userData.ghostPhase = 'out';
      node.userData.ghostFadeStart = now;
      ghostAnimNodes.add(node);
    }
  });
}

// Drives every in-flight ghost animation: eases fill+edge opacity in from 0
// on 'in', gives the edge outline a slow color/opacity "breathing" pulse on
// 'steady', and eases both back down to 0 on 'out' -- restoring the real
// material and (only if the part is still actually supposed to be hidden;
// it might instead have just been revealed by a click mid-fade) hiding the
// part once the fade-out finishes. Runs every frame from animate(); empty-
// Set iteration is cheap, so no need to gate it on visibilityEditMode.
function updateGhostAnimation(now) {
  if (!ghostAnimNodes.size) return;
  for (const node of ghostAnimNodes) {
    const edges = node.userData.ghostEdges;
    if (!edges) {
      ghostAnimNodes.delete(node);
      continue;
    }
    const phase = node.userData.ghostPhase;
    const t = Math.min(1, (now - node.userData.ghostFadeStart) / GHOST_FADE_MS);

    if (phase === 'in') {
      const eased = easeOutCubic(t);
      node.material.opacity = eased * GHOST_FILL_OPACITY;
      edges.material.opacity = eased * GHOST_EDGE_BASE_OPACITY;
      edges.material.color.copy(GHOST_EDGE_COLOR_BASE);
      if (t >= 1) {
        node.userData.ghostPhase = 'steady';
        // Restart the phase clock here so the pulse's sine wave begins at
        // its zero-crossing (opacity = GHOST_EDGE_BASE_OPACITY) exactly
        // where the fade-in left off, instead of jumping to wherever a
        // clock that had already been running since fade-in started
        // happens to land.
        node.userData.ghostFadeStart = now;
      }
    } else if (phase === 'steady') {
      const pulse01 = (Math.sin(((now - node.userData.ghostFadeStart) / GHOST_PULSE_PERIOD_MS) * Math.PI * 2) + 1) / 2;
      edges.material.color.lerpColors(GHOST_EDGE_COLOR_BASE, GHOST_EDGE_COLOR_PEAK, pulse01);
      edges.material.opacity = GHOST_EDGE_BASE_OPACITY - GHOST_EDGE_PULSE_AMPLITUDE + pulse01 * GHOST_EDGE_PULSE_AMPLITUDE * 2;
      node.material.opacity = GHOST_FILL_OPACITY;
    } else {
      const remaining = 1 - easeOutCubic(t);
      node.material.opacity = remaining * GHOST_FILL_OPACITY;
      edges.material.opacity = remaining * GHOST_EDGE_BASE_OPACITY;
      if (t >= 1) {
        if (node.userData.preGhostMaterial) {
          node.material = node.userData.preGhostMaterial;
          delete node.userData.preGhostMaterial;
        }
        node.remove(edges);
        // Not edges.geometry.dispose() -- that geometry is cached in
        // ghostEdgesGeometryCache and reused the next time this mesh ghosts
        // (see getGhostEdgesGeometry), so disposing it here would just force
        // the expensive EdgesGeometry computation to redo itself on the very
        // next V-press. Only the cheap per-instance material actually dies.
        edges.material.dispose();
        delete node.userData.ghostEdges;
        delete node.userData.ghostPhase;
        delete node.userData.ghostFadeStart;
        ghostAnimNodes.delete(node);
        const part = node.userData.ghostPart;
        delete node.userData.ghostPart;
        // Only actually hide the part if it's still meant to be hidden --
        // this same fade-out path also runs when a ghost gets clicked to
        // reveal it, in which case partVis is already true and the part
        // should stay visible with its now-restored real material.
        if (part && loadedMods[part] && !partVis[part]) {
          loadedMods[part].visible = false;
        }
      }
    }
  }
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

function bottomIsBoatVariant() {
  const url = modelSets.bottom?.[currentIdx.bottom] || '';
  return /bottom_boat/i.test(url);
}

// The F1 and Boat bottoms' mounts don't fit any Motion/wheel variant. Unlike
// arms/bumper (either one can knock out the other, whichever was touched
// last), this conflict is one-directional and variant-conditional: Bottom
// always wins, Motion is the one that gets hidden — so call this after ANY
// change that could touch bottom's variant/visibility OR wheels' visibility
// (it's a cheap, idempotent check; harmless to call when nothing changed).
function enforceBottomMotionExclusion() {
  const isF1 = bottomIsF1Variant();
  const isBoat = !isF1 && bottomIsBoatVariant();
  const hasConflict = partVis.bottom && (isF1 || isBoat);

  if (hasConflict && partVis.wheels) {
    partVis.wheels = false;
    wheelsAutoHiddenByBottom = true;
    const wheelsBtn = document.getElementById('wheels-visibility');
    if (wheelsBtn) wheelsBtn.innerHTML = '<span class="material-icons">visibility_off</span>';
    if (loadedMods.wheels) loadedMods.wheels.visible = false;
    updateComboChip();
    toast(`Motion hidden — not compatible with the ${isF1 ? 'F1' : 'Boat'} bottom.`, 'warn', 2200);
    return;
  }

  // Conflict cleared (bottom swapped to something compatible) and Motion is
  // still hidden only because we hid it, not because the user chose to hide
  // it themselves -- bring it back rather than leaving it stuck off.
  if (!hasConflict && wheelsAutoHiddenByBottom) {
    wheelsAutoHiddenByBottom = false;
    partVis.wheels = true;
    const wheelsBtn = document.getElementById('wheels-visibility');
    if (wheelsBtn) wheelsBtn.innerHTML = '<span class="material-icons">visibility</span>';
    if (loadedMods.wheels) {
      loadedMods.wheels.visible = true;
      if (!loadedMods.wheels.parent) scene.add(loadedMods.wheels);
    } else {
      loadModel('wheels', true);
    }
    updateComboChip();
  }
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
    refreshSpacerOffsets();
  }

  updateComboChip();
  if (withToast) toast(`${getPartDisplayName(part)} enabled`, 'ok', 900);
  markCustomPreset();
}

function hideAppLoader() {
  if (appLoaderHidden) return;
  appLoaderHidden = true;
  if (appLoader) {
    appLoader.classList.add('hide');
    appLoader.setAttribute('aria-busy', 'false');
    setTimeout(() => appLoader.remove(), 450);
  }
  // Initial build is on screen — now let the deferred heavy work (preset
  // thumbnails) run. Staggered one per idle slot so 8 offscreen renders don't
  // land in a single frame and jank the freshly-shown viewer.
  firstBuildDone = true;
  const drainNext = () => {
    const fn = afterFirstBuildQueue.shift();
    if (!fn) return;
    try { fn(); } catch (e) { console.warn(e); }
    if (afterFirstBuildQueue.length) requestIdle(drainNext, { timeout: 4000 });
  };
  if (afterFirstBuildQueue.length) requestIdle(drainNext, { timeout: 4000 });
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

// BVH construction (computeBoundsTree) is CPU-heavy and only needed for the
// hover / paint-bucket raycasts, which never happen in the first moments after
// a load. Building it inline in the load callback stalled the main thread hard
// on a tablet when several parts landed at once (part of the "loading screen
// stays up forever" report). Queue the geometries and build them on idle time
// instead — acceleratedRaycast falls back to the plain raycast path for any
// geometry whose tree isn't built yet, so nothing breaks in the gap.
const bvhBuildQueue = [];
let bvhDraining = false;
const requestIdle = window.requestIdleCallback
  ? window.requestIdleCallback.bind(window)
  : (cb) => setTimeout(() => cb({ timeRemaining: () => 8, didTimeout: false }), 1);
function drainBvhQueue(deadline) {
  bvhDraining = true;
  // One geometry per idle slot while the first build is still loading (don't
  // let a didTimeout burst chew a frame); catch up faster once it's on screen.
  const maxPerSlot = firstBuildDone ? Infinity : 1;
  let built = 0;
  while (bvhBuildQueue.length && built < maxPerSlot && (deadline.didTimeout || deadline.timeRemaining() > 4)) {
    const geometry = bvhBuildQueue.shift();
    try {
      if (geometry && !geometry.boundsTree && geometry.attributes?.position) {
        geometry.computeBoundsTree();
      }
    } catch (e) { /* a malformed geometry just keeps the slow raycast path */ }
    built += 1;
  }
  if (bvhBuildQueue.length) requestIdle(drainBvhQueue, { timeout: firstBuildDone ? 2000 : 6000 });
  else bvhDraining = false;
}
function queueBvhBuild(geometry) {
  bvhBuildQueue.push(geometry);
  if (!bvhDraining) requestIdle(drainBvhQueue, { timeout: firstBuildDone ? 2000 : 6000 });
}

// Where `part`'s model should sit vertically right now, accounting for whether
// a Spacer is currently in the build.
function spacerYOffset(part) {
  const dropped = partVis.spacer && SPACER_AFFECTED_PARTS.includes(part);
  return MODEL_Y_OFFSET - (dropped ? SPACER_DROP : 0);
}

// Re-derive the vertical position of every spacer-affected part that's already
// loaded. loadModel() only sets position.y at load time, so a part that isn't
// being reloaded (switching between two mixes that share the same bottom, one
// with a Spacer and one without) would otherwise keep the stale offset — which
// is why leaving a Spacer mix used to leave the lower parts sitting too low.
function refreshSpacerOffsets() {
  for (const part of SPACER_AFFECTED_PARTS) {
    if (loadedMods[part]) loadedMods[part].position.y = spacerYOffset(part);
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

  // Counts in-flight loadModel() calls so the first-paint splash stays up until
  // the initial build has actually loaded. Only VISIBLE parts count: the
  // starter preset also loads hidden advanced parts (hat/arms/bumper) up front,
  // and making the splash wait for those — including their GLB parse + BVH
  // build, which is CPU-heavy on a tablet — kept the loading screen up long
  // after the robot the user can actually see was ready. Hidden parts still
  // load in the background; they just don't hold the splash.
  const holdsSplash = !!partVis[part];
  if (holdsSplash) pendingInitialLoads += 1;
  let settled = false;
  const settleInitialLoad = () => {
    if (settled || !holdsSplash) return;
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

        if (loadedMods[part]) {
          scene.remove(loadedMods[part]);
          loadedMods[part].traverse((node) => {
            if (node.isMesh) node.geometry?.disposeBoundsTree?.();
          });
        }
        const model = gltf.scene;
        model.position.y = spacerYOffset(part);
        model.visible = partVis[part];
        // meshIndex is assigned in traversal order, deterministic for a given
        // glb — it's how paint overrides (modelMeshCols) target a specific
        // sub-object within a multi-mesh part. See getMeshOverrides/applyColor.
        let meshIndex = 0;
        model.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.userData.meshIndex = meshIndex++;
            // Same "axes swapped" cached-bounds issue noted in getThumbRenderer
            // (search for "precise=true" above) — some of these assets carry a
            // stale/wrong geometry.boundingSphere from the exporter's declared
            // accessor min/max. Mesh.raycast() uses that cached sphere for its
            // early-out check, so a bad one makes the paint bucket's raycast
            // silently miss real, visible geometry (e.g. Face_Eyebrows.glb's
            // eyebrow meshes) no matter how carefully the click lands. Forcing
            // a fresh computation from the actual current vertex data fixes it
            // at the source, for every consumer (bucket paint, click-to-browse
            // hover), not just the thumbnail renderer that first hit this.
            node.geometry.computeBoundingSphere();
            node.geometry.computeBoundingBox();
            // BVH for fast hover/paint raycasts (see the prototype patch near
            // the top of the file). Built on idle time rather than here — see
            // queueBvhBuild — so a burst of loads doesn't stall first paint.
            // Disposed when this part's model is replaced by the next loadModel.
            queueBvhBuild(node.geometry);
          }
        });
        loadedMods[part] = model;
        if (partVis[part]) scene.add(model);
        applyColor(part);
        updateVariantCounter(part);
        updateComboChip();
        // setConflictHighlight tints the actual loaded mesh, so a conflict
        // computed earlier (e.g. right after randomize fired loadModel for
        // several parts at once) couldn't have been applied to THIS mesh yet
        // -- it didn't exist. Re-check now that it's actually the one in the
        // scene, or a real clash silently renders as if everything's fine
        // until something else happens to call refreshConflictBadges again.
        refreshConflictBadges();
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

// Loads exactly the `mixonly` models named in `files` into mixExtrasGroup,
// dropping any that are no longer wanted. Called by applyPreset with the mix's
// `extras` (or [] for a normal mix / reset). Async; a token guards against a
// slow load from a superseded mix landing after a newer one.
async function setMixExtras(files) {
  const want = Array.isArray(files) ? files.filter((f) => mixExtraUrls.has(f)) : [];
  activeMixExtras = want.slice();
  const myToken = ++mixExtrasToken;

  for (const child of [...mixExtrasGroup.children]) {
    if (!want.includes(child.userData.mixExtraFile)) {
      mixExtrasGroup.remove(child);
      delete loadedMods[child.userData.mixExtraFile];
      child.traverse((n) => { if (n.isMesh) n.geometry?.dispose?.(); });
      // modelCols / modelMeshCols for the file are kept, so re-selecting the
      // mix restores whatever the user painted onto it.
    }
  }

  const toFetch = want.filter((f) => !mixExtrasGroup.children.some((c) => c.userData.mixExtraFile === f));

  // On a showcase mix (all parts hidden) NO part load holds the splash — so
  // without this the loader would sit until the 12s safety timeout. Hold it
  // here for the extras' loads instead, exactly like loadModel does for a part.
  const holdsSplash = !firstBuildDone && toFetch.length > 0;
  if (holdsSplash) pendingInitialLoads += 1;

  // Fetch in parallel, not one-await-at-a-time.
  await Promise.all(toFetch.map(async (file) => {
    try {
      const gltf = await loader.loadAsync(mixExtraUrls.get(file));
      if (mixExtrasToken !== myToken) return; // a newer mix took over mid-load
      const obj = gltf.scene;
      obj.userData.mixExtraFile = file;
      // Tag meshes so the paint bucket / per-piece overrides can target them,
      // exactly like loadModel does for a part.
      let meshIndex = 0;
      obj.traverse((n) => {
        if (!n.isMesh) return;
        n.castShadow = true;
        n.userData.meshIndex = meshIndex++;
        n.geometry.computeBoundingSphere();
        n.geometry.computeBoundingBox();
      });
      // Register the piece as a first-class, paintable/printable target keyed
      // by its filename — the same key tools/mix-colorizer.js and
      // assets/mix-colors.json use. It is NOT in modelSets/PART_META, so it
      // never becomes a category, variant, panel row, or combo-count factor.
      loadedMods[file] = obj;
      partVis[file] = true;
      if (!modelCols[file]) modelCols[file] = new THREE.Color(DEFAULT_PART_COLOR);
      mixExtrasGroup.add(obj);
      applyColor(file); // grey canvas, or restores retained per-piece paint
    } catch (err) {
      console.error(`Mix extra "${file}" failed to load`, err);
    }
  }));

  if (holdsSplash) {
    pendingInitialLoads = Math.max(0, pendingInitialLoads - 1);
    if (pendingInitialLoads === 0) hideAppLoader();
  }
  updateComboChip();
  syncShowcaseMode();
}

function applyPreset(key, showToast = true) {
  const preset = presets[key];
  if (!preset) return;
  isApplyingPreset = true;

  try {
    const toLoad = new Set();

    for (const [part, ref] of Object.entries(preset.parts || {})) {
      if (!modelSets[part]) continue;
      const resolved = resolvePresetIndex(part, ref);
      if (currentIdx[part] !== resolved || !loadedMods[part]) {
        currentIdx[part] = resolved;
        toLoad.add(part);
      }
    }

    for (const [part, visible] of Object.entries(preset.visibility || {})) {
      if (typeof visible !== 'boolean') continue;
      partVis[part] = visible;
      const btn = document.getElementById(`${part}-visibility`);
      if (btn) btn.innerHTML = `<span class="material-icons">${visible ? 'visibility' : 'visibility_off'}</span>`;
      if (loadedMods[part]) {
        loadedMods[part].visible = visible;
        // A part the previous preset preloaded-but-hidden (starter loads
        // bumper/arms hidden and never scene.add()s them) is already loaded at
        // the right variant, so it's not in `toLoad` — but it's absent from the
        // scene graph, and flipping .visible alone won't show it. Attach it now,
        // the same way enablePart does for a manual toggle. (refreshSpacerOffsets
        // below re-settles position.y; set it here too to avoid a one-frame jump.)
        if (visible && !loadedMods[part].parent) {
          loadedMods[part].position.y = spacerYOffset(part);
          scene.add(loadedMods[part]);
          applyColor(part);
        }
      }
    }

    if (partVis.arms && partVis.bumper) {
      partVis.bumper = false;
      const bumperBtn = document.getElementById('bumper-visibility');
      if (bumperBtn) bumperBtn.innerHTML = '<span class="material-icons">visibility_off</span>';
      if (loadedMods.bumper) loadedMods.bumper.visible = false;
    }

    toLoad.forEach((part) => loadModel(part, true));
    // Standalone mix models (consoles, robot arms…) for this mix — or clear the
    // previous mix's set when this one has none.
    setMixExtras(preset.extras || []);
    // Parts NOT in toLoad (same variant, already loaded) won't run loadModel's
    // position pass, so fix their offset here to match this preset's Spacer
    // state — otherwise a mix without a Spacer inherits the previous mix's
    // dropped lower body.
    refreshSpacerOffsets();
    enforceBottomMotionExclusion();
    enforceHatRequiresTopHats();
    refreshConflictBadges();
    updateAllCounters();
    updateComboChip();
    activePresetKey = key;
    setPresetLabel(preset.label);
    syncPresetButtons(key);
    syncShowcaseMode();
    if (showToast) toast(`${preset.label} preset loaded`, 'ok', 1200);
    saveStateToLocal();
    // Last interaction was picking a mix — keep the sheet on the Mixes page and
    // collapsed so the result is front and centre.
    if (mobileLayoutActive) {
      setMobileSheetTab('mixes');
      setMobileSheetState('peek');
    }
  } finally {
    isApplyingPreset = false;
  }
}

function resetToFactory() {
  setBucketMode(null);
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
    modelCols[part].set(DEFAULT_PART_COLOR);
    delete modelMeshCols[part];
    applyColor(part);
    updateBucketResetVisibility(part);
    syncPillColor(part);
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

// #more-menu is a simple CSS-anchored popover (position:absolute relative to
// its trigger) that works fine on desktop, but on mobile its trigger
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
  // Bucket mode only makes sense while its palette (the brush color source) is
  // open, so closing the palette any other way (outside click, Escape, scroll,
  // picking a plain swatch) always exits it too.
  setBucketMode(null);
}

function shouldAutoStartTour() {
  // Never auto-nag on touch: the phone layout can't fit the step tooltips, and
  // on a tablet the tour's wording ("hover a part", keyboard shortcuts) doesn't
  // match how you actually drive it. The manual "Quick Guide" button still runs
  // it on tablets for anyone who wants it (see startTour).
  if (isTouchCapable()) return false;
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

  // Each step's `dock` ('mixes' | 'parts') switches the right-dock tab to
  // wherever its target actually lives -- both #preset-carousel and
  // #top-pill etc. sit behind one of the two dock-tab-* tabs (see
  // setupRightDockTabs) and are display:none while their tab isn't active,
  // so a step that doesn't switch to the right one first would highlight
  // nothing at all. `colorSidebar: true` similarly opens the collapsed
  // #color-sidebar before targeting a pill inside it.
  const steps = [
    { target: '#preset-carousel', dock: 'mixes', title: 'Ready-made mixes', body: 'Pick a full preset combo to start from, or switch to the Parts tab to build your own from scratch.' },
    { target: '#controls-toggle', dock: 'parts', title: 'Panels', body: 'Switch between Essential parts and Advanced add-ons.' },
    { target: '#globalPaintBtn', title: 'Paint & Browse', body: 'Click any piece right on the model to jump to its variants. Click here first to paint pieces any color instead, straight on the model.' },
    { target: '#top-pill', dock: 'parts', essential: true, colorSidebar: true, title: 'Colors', body: 'Click the color pill for quick presets, or drag in the full picker for any shade you want.' },
    { target: '#top-controls [data-role="next"]', dock: 'parts', essential: true, title: 'Variants', body: 'Use the arrows to browse different designs of a part, or click its name to pick from a grid of all of them.' },
    { target: '#top-visibility', dock: 'parts', essential: true, title: 'Visibility', body: 'Temporarily hide or show a single part to see how it affects the build.' },
    { target: '#visibilityModeBtn', dock: 'parts', title: 'Hide / show parts', body: 'Preview several hidden parts at once -- they turn into clickable blue ghosts you can tap to toggle. Press V anytime to jump straight into this mode.' },
    { target: '#top-controls [data-role="print"]', dock: 'parts', essential: true, title: 'Direct 3D Print', body: 'Open the current part directly in your preferred slicer — pick PrusaSlicer or OrcaSlicer in Settings.' },
    { target: '#download-primary', title: 'Export', body: 'Download STL instantly, or open Settings for GLB and STEP.' },
    { target: '#settingsToggle', title: 'Settings', body: 'Preferred slicer, camera projection, GLB/STEP downloads, and this guide all live here.' }
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

  // Clicks the real tab buttons rather than duplicating setupRightDockTabs'
  // own switching logic -- a no-op if the requested tab is already active.
  function switchRightDockTab(which) {
    const btn = document.getElementById(which === 'mixes' ? 'dock-tab-mixes' : 'dock-tab-parts');
    if (btn && !btn.classList.contains('active')) btn.click();
  }

  function openColorSidebar() {
    const sidebar = document.getElementById('color-sidebar');
    const toggle = document.getElementById('color-sidebar-toggle');
    if (sidebar && toggle && !sidebar.classList.contains('open')) toggle.click();
  }

  function show() {
    const step = steps[index];
    if (step.dock) switchRightDockTab(step.dock);
    // Colors/Variants/Visibility/Print steps all target #top-* controls, which
    // only exist in the DOM (and are only reachable) while Essential is showing.
    if (step.essential) showEssentialPanel();
    if (step.colorSidebar) openColorSidebar();
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

  btnNext.addEventListener('click', (event) => {
    // show() can now open the color sidebar / switch dock tabs on the
    // viewer's behalf (see switchRightDockTab/openColorSidebar above) by
    // dispatching a synthetic click on THEIR toggle buttons -- that nested
    // click bubbles and resolves fine, but this OUTER click (on Next itself)
    // then keeps bubbling too once this handler returns, reaching e.g. the
    // color sidebar's own "click outside closes it" document listener with
    // event.target = the Next button, which isn't inside the sidebar, so it
    // would immediately close what show() just opened. Stopping it here
    // keeps this button's click from being mistaken for a click "outside".
    event.stopPropagation();
    if (index < steps.length - 1) {
      index += 1;
      show();
    } else {
      end({ saveDone: true });
      toast('You can reopen the tour from the Info button.', 'ok', 1800);
    }
  });
  btnPrev.addEventListener('click', (event) => {
    event.stopPropagation();
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
  updateGhostAnimation(performance.now());
  paintHoverFlush?.();
  renderer.render(scene, camera);
}

// Swaps the active camera between perspective and orthographic, matching
// the new camera's apparent zoom/framing to the old one's so the switch
// reads as a projection change, not a jump-cut to a different shot.
function toggleProjection(silent = false) {
  const switchingToOrtho = camera.isPerspectiveCamera;
  const next = switchingToOrtho ? orthographicCamera : perspectiveCamera;
  const dir = camera.position.clone().sub(controls.target).normalize();

  if (switchingToOrtho) {
    const distance = camera.position.distanceTo(controls.target);
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    orthoViewSize = (Math.tan(fovRad / 2) * distance) / camera.zoom;
    next.zoom = 1;
    next.position.copy(camera.position);
  } else {
    // Reverse: place the perspective camera at whatever distance reproduces
    // the ortho camera's current apparent size (orthoViewSize / its zoom).
    const fovRad = THREE.MathUtils.degToRad(next.fov);
    const halfHeight = orthoViewSize / camera.zoom;
    const distance = halfHeight / Math.tan(fovRad / 2);
    next.position.copy(controls.target).addScaledVector(dir, distance);
  }
  next.quaternion.copy(camera.quaternion);

  camera = next;
  controls.object = camera;
  updateCameraProjection();
  controls.update();
  controls.saveState();

  const nowPerspective = camera.isPerspectiveCamera;
  updateProjectionUi();
  if (!silent) toast(nowPerspective ? 'Perspective view' : 'Orthographic view', 'ok', 900);
}

// Only flips the camera if `mode` differs from what's active — called from
// the Camera radio items in the Settings modal (see setupSettingsMenu).
function setProjection(mode) {
  const nowMode = camera.isPerspectiveCamera ? 'perspective' : 'orthographic';
  if (mode === nowMode) return;
  toggleProjection();
}

factoryResetBtn.addEventListener('click', () => {
  resetToFactory();
});

// How many times to re-roll a single part's index during the initial greedy
// pass before giving up and accepting whatever it landed on. The
// compatibility map is sparse (a few hundred flagged pairs out of many
// thousands of possible ones), so a handful of retries clears most clashes
// immediately; the repair pass below (see randomizeBtn's click handler)
// mops up whatever this ordering-blind pass couldn't see coming.
const RANDOMIZE_RETRY_LIMIT = 40;

// Does candidate index `idx` of `part` clash with any *other* currently
// chosen, visible part in `chosenIdx`? Shared by both the initial greedy
// pass and the repair pass below.
function candidateClashes(part, idx, parts, chosenIdx) {
  // Mirrors findConflictFor: a clash only exists once BOTH sides are
  // visible -- a hidden part's variant is never actually a live conflict,
  // no matter what it's parked on.
  if (!partVis[part]) return false;
  const compatMap = activeCompatMap();
  const key = partFileKey(part, idx);
  const incompatibleWith = key && compatMap && compatMap.get(key);
  if (!incompatibleWith) return false;
  return parts.some((other) => {
    if (other === part || !partVis[other] || chosenIdx[other] == null) return false;
    const otherKey = partFileKey(other, chosenIdx[other]);
    return otherKey && incompatibleWith.has(otherKey);
  });
}

randomizeBtn.addEventListener('click', () => {
  const parts = Object.keys(modelSets).filter((part) => modelSets[part].length);
  const chosenIdx = {};

  // Pass 1: greedily pick each part's variant left-to-right so it doesn't
  // land on a pairing the compatibility map (tools/compat-checker.html)
  // already flagged as incompatible with another part chosen so far -- the
  // point is to not hand back a combo that's just going to show up red,
  // rather than rolling one and then explaining why it's wrong.
  for (const part of parts) {
    const count = modelSets[part].length;
    let idx = Math.floor(Math.random() * count);
    if (compatibilityMap) {
      for (let attempt = 0; attempt < RANDOMIZE_RETRY_LIMIT && candidateClashes(part, idx, parts, chosenIdx); attempt++) {
        idx = Math.floor(Math.random() * count);
      }
    }
    chosenIdx[part] = idx;
  }

  // Pass 2: repair whatever pass 1 couldn't see coming -- it only ever
  // checks a part against picks made *before* it, so a part processed early
  // (e.g. "middle") can still end up on a variant that blocks every single
  // option of a part processed later (e.g. one middle variant that clashes
  // with all 13 face variants), and no amount of re-rolling the later part
  // alone would ever fix that. This repeatedly finds a still-conflicting
  // pair and re-rolls a random side of it against an exhaustive shuffle of
  // its own options (part variant counts are small, so this is cheap),
  // which can also fix the earlier part instead when that's the one at fault.
  if (compatibilityMap) {
    for (let iter = 0; iter < 80; iter++) {
      let conflictA = null;
      let conflictB = null;
      outer: for (let i = 0; i < parts.length && !conflictA; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          if (candidateClashes(parts[i], chosenIdx[parts[i]], [parts[j]], chosenIdx)) {
            conflictA = parts[i];
            conflictB = parts[j];
            break outer;
          }
        }
      }
      if (!conflictA) break; // nothing left to repair

      const sideToFix = Math.random() < 0.5 ? conflictA : conflictB;
      const count = modelSets[sideToFix].length;
      const order = Array.from({ length: count }, (_, i) => i).sort(() => Math.random() - 0.5);
      const fixed = order.find((candidateIdx) => !candidateClashes(sideToFix, candidateIdx, parts, chosenIdx));
      if (fixed !== undefined) chosenIdx[sideToFix] = fixed;
      // If nothing resolves it, leave both as-is and let the next iteration
      // try a different pair (or the same one, the other side) -- a handful
      // of genuinely irreconcilable options run out this loop harmlessly,
      // same as before: the badge shows the honest, still-real conflict.
    }
  }

  for (const part of parts) {
    currentIdx[part] = chosenIdx[part];
    loadModel(part, true);
  }
  // Bottom-vs-Motion and Hat-requires-Top-Hats are hard business rules, not
  // geometry-map entries (see their own comments) -- the greedy pass above
  // can't see them, so they still get enforced/coerced as a fallback here,
  // same as every other path that changes parts. Hat-requires-Top-Hats stays
  // silent here specifically: with Hat already on, rolling a Top other than
  // "Hats" is the expected, common case on almost every randomize, not a
  // surprise worth a toast every single time -- unlike the same coercion
  // firing from a deliberate, one-off manual action elsewhere.
  enforceBottomMotionExclusion();
  enforceHatRequiresTopHats(true);
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
