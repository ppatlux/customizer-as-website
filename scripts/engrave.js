import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { ASSET_MANIFEST } from './asset-manifest.js';
import { SLICER_LABELS, getPreferredSlicer, setPreferredSlicer } from './slicer-preference.js';

const SUPPORTED_PART = 'top';
const DEFAULT_MODEL_FILE = 'Toplights_NOlogo.glb';
const MODEL_Y_OFFSET = 30;
const SVG_SURFACE_LIFT = 0.05;
const DEFAULT_Z_OFFSET = 12.6;
const MIN_SHAPE_AREA = 0.05;
const SLICER_BRIDGE_URL = 'http://127.0.0.1:32123/open-model';
const CUSTOMIZER_STATE_KEY = 'hp_robot_customizer_state';
const DEFAULT_PART_COLOR = '#d9d9d9';

// Reads the color the user picked for the top part in the main customizer
// (same localStorage key it saves to), so the part shown here matches
// instead of reverting to a generic default.
function getSavedTopColor() {
  try {
    const raw = localStorage.getItem(CUSTOMIZER_STATE_KEY);
    if (!raw) return DEFAULT_PART_COLOR;
    const saved = JSON.parse(raw);
    return saved?.modelCols?.top || DEFAULT_PART_COLOR;
  } catch {
    return DEFAULT_PART_COLOR;
  }
}

const search = new URLSearchParams(window.location.search);
const requestedPart = search.get('part') || SUPPORTED_PART;
const requestedFile = search.get('file') || DEFAULT_MODEL_FILE;

const viewer = document.getElementById('viewer');
const progressOverlay = document.getElementById('progressOverlay');
const progressTitle = document.getElementById('progressTitle');
const progressDetail = document.getElementById('progressDetail');
const backCustomizerBtn = document.getElementById('backCustomizerBtn');
const uploadSvgBtn = document.getElementById('uploadSvgBtn');
const removeSvgBtn = document.getElementById('removeSvgBtn');
const svgFileInput = document.getElementById('svgFileInput');
const svgLayerList = document.getElementById('svgLayerList');
const svgName = document.getElementById('svgName');
const moveModeBtn = document.getElementById('moveModeBtn');
const rotateModeBtn = document.getElementById('rotateModeBtn');
const centerLogoBtn = document.getElementById('centerLogoBtn');
const scaleRange = document.getElementById('scaleRange');
const scaleValue = document.getElementById('scaleValue');
const posXRange = document.getElementById('posXRange');
const posXValue = document.getElementById('posXValue');
const posZRange = document.getElementById('posZRange');
const posZValue = document.getElementById('posZValue');
const posYRange = document.getElementById('posYRange');
const posYValue = document.getElementById('posYValue');
const depthRange = document.getElementById('depthRange');
const depthValue = document.getElementById('depthValue');
const previewCutBtn = document.getElementById('previewCutBtn');
const backToEditBtn = document.getElementById('backToEditBtn');
const downloadStlBtn = document.getElementById('downloadStlBtn');
const sendToSlicerBtn = document.getElementById('sendToSlicerBtn');
const sendToSlicerLabel = document.getElementById('sendToSlicerLabel');
const slicerBadge = document.getElementById('slicerBadge');
const slicerMenuToggle = document.getElementById('slicerMenuToggle');
const slicerMenu = document.getElementById('slicerMenu');
const statusMessage = document.getElementById('statusMessage');
const partBadge = document.getElementById('partBadge');

const loader = new GLTFLoader();
loader.setCrossOrigin('anonymous');

const svgLoader = new SVGLoader();
const exporter = new STLExporter();
const evaluator = new Evaluator();
evaluator.useGroups = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xecf4f9);

const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
camera.position.set(-90, 100, 120);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setClearColor(0xecf4f9);
renderer.shadowMap.enabled = true;
viewer.appendChild(renderer.domElement);

renderer.domElement.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  console.warn('WebGL context lost. Will redraw once it is restored.');
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  render();
});

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, MODEL_Y_OFFSET, 0);

const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setSize(0.8);
transformControls.visible = false;
transformControls.addEventListener('dragging-changed', (event) => {
  controls.enabled = !event.value;
});
transformControls.addEventListener('objectChange', () => {
  if (!logoRoot) return;
  clampLogoPosition();
  syncPositionInputsFromLogo();
  markPreviewDirty();
});
let transformHelper = null;

scene.add(new THREE.AmbientLight(0xffffff, 0.45));

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

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(500, 500),
  new THREE.ShadowMaterial({ opacity: 0.1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const previewMaterial = new THREE.MeshStandardMaterial({
  color: 0x3d7ffd,
  transparent: true,
  opacity: 0.72,
  metalness: 0.05,
  roughness: 0.42
});

const modelMaterial = new THREE.MeshStandardMaterial({
  color: getSavedTopColor(),
  metalness: 0.08,
  roughness: 0.82
});

let partEntry = null;
let modelRoot = null;
let baseGeometry = null;
let baseBox = null;
let surfaceY = MODEL_Y_OFFSET;
let svgLayers = [];
let activeLayerId = null;
let nextLayerId = 1;
let svgText = '';
let svgFilename = '';
let logoRoot = null;
let logoArtwork = null;
let defaultLogoScale = 1;
let resultMesh = null;
let previewDirty = true;
let viewMode = 'edit';
let transformMode = 'translate';
let positionLimits = { x: 20, z: 20, yMin: -5.0, yMax: 5.0 };
let isProcessing = false;

setupUi();
setupResize();
loadSupportedModel();
animate();

function setupUi() {
  partEntry = ASSET_MANIFEST[requestedPart]?.find((entry) => entry.file === requestedFile) || { file: requestedFile, source: null };
  const supportsEngraving = requestedPart === SUPPORTED_PART;

  if (supportsEngraving) {
    partBadge.textContent = requestedFile.replace(/\.glb$/i, '');
  } else {
    partBadge.textContent = 'Top part required';
    setStatus('warn', 'This tool currently supports only the top part.');
    disableEditorActions(true);
  }

  scaleValue.textContent = `${scaleRange.value}%`;
  posXValue.textContent = '0.0 mm';
  posZValue.textContent = '0.0 mm';
  posYValue.textContent = `${DEFAULT_Z_OFFSET.toFixed(1)} mm`;
  depthValue.textContent = `${Number(depthRange.value).toFixed(1)} mm`;

  backCustomizerBtn.addEventListener('click', () => {
    navigateWithFade('./index.html');
  });
  uploadSvgBtn.addEventListener('click', () => svgFileInput.click());
  removeSvgBtn.addEventListener('click', removeActiveSvgLayer);
  svgFileInput.addEventListener('change', handleSvgUpload);
  moveModeBtn.addEventListener('click', () => setTransformMode('translate'));
  rotateModeBtn.addEventListener('click', () => setTransformMode('rotate'));
  centerLogoBtn.addEventListener('click', centerLogo);
  scaleRange.addEventListener('input', applyLogoScale);
  posXRange.addEventListener('input', applyLogoPositionFromInputs);
  posZRange.addEventListener('input', applyLogoPositionFromInputs);
  posYRange.addEventListener('input', applyLogoPositionFromInputs);
  depthRange.addEventListener('input', async () => {
    depthValue.textContent = `${Number(depthRange.value).toFixed(1)} mm`;
    try {
      await rebuildLogoFromCurrentSvg();
    } catch (error) {
      console.error(error);
      setStatus('err', 'Could not rebuild one of the SVG layers at that depth.');
    }
  });
  previewCutBtn.addEventListener('click', handlePreviewCut);
  backToEditBtn.addEventListener('click', backToEdit);
  downloadStlBtn.addEventListener('click', handleDownloadStl);
  sendToSlicerBtn.addEventListener('click', handleSendToSlicer);
  setupSlicerMenu();
  renderSvgLayerList();
  updateSvgSummary();
  updateActionButtonsState();
}

function setupSlicerMenu() {
  updateSlicerButtonUi();

  slicerMenuToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = !slicerMenu.hidden;
    if (isOpen) {
      closeSlicerMenu();
    } else {
      openSlicerMenu();
    }
  });

  slicerMenu.querySelectorAll('.slicer-menu-item').forEach((item) => {
    item.addEventListener('click', () => {
      setPreferredSlicer(item.dataset.slicer);
      updateSlicerButtonUi();
      closeSlicerMenu();
    });
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('#slicerSendGroup')) return;
    closeSlicerMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSlicerMenu();
  });
}

function openSlicerMenu() {
  slicerMenu.hidden = false;
  slicerMenuToggle.setAttribute('aria-expanded', 'true');
}

function closeSlicerMenu() {
  slicerMenu.hidden = true;
  slicerMenuToggle.setAttribute('aria-expanded', 'false');
}

function updateSlicerButtonUi() {
  const slicer = getPreferredSlicer();
  const label = SLICER_LABELS[slicer];
  slicerBadge.textContent = slicer === 'prusa' ? 'P' : 'O';
  slicerBadge.dataset.slicer = slicer;
  sendToSlicerLabel.textContent = `Send to ${label}`;
  sendToSlicerBtn.setAttribute('aria-label', `Send to ${label}`);

  slicerMenu.querySelectorAll('.slicer-menu-item').forEach((item) => {
    item.setAttribute('aria-selected', String(item.dataset.slicer === slicer));
  });
}

function setupResize() {
  const resize = () => {
    const width = viewer.clientWidth || window.innerWidth;
    const height = viewer.clientHeight || window.innerHeight;
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    render();
  };

  window.addEventListener('resize', resize);
  resize();
}

function disableEditorActions(disabled) {
  uploadSvgBtn.disabled = disabled;
  removeSvgBtn.disabled = disabled || !svgLayers.length;
  moveModeBtn.disabled = disabled;
  rotateModeBtn.disabled = disabled;
  centerLogoBtn.disabled = disabled;
  scaleRange.disabled = disabled;
  depthRange.disabled = disabled;
  previewCutBtn.disabled = disabled;
  downloadStlBtn.disabled = disabled;
  sendToSlicerBtn.disabled = disabled;
}

async function loadSupportedModel() {
  if (requestedPart !== SUPPORTED_PART) {
    return;
  }

  setStatus('ok', `Loading ${partEntry.file}...`);

  try {
    const urls = getModelCandidates(partEntry);
    const gltf = await loadFirstAvailableModel(urls);
    mountModel(gltf.scene);
    setStatus('ok', 'Ready! Add a logo to get started.');
  } catch (error) {
    console.error(error);
    setStatus('err', `Failed to load ${partEntry.file}.`);
    disableEditorActions(true);
  }
}

function getModelCandidates(entry) {
  return [...new Set([
    `./assets/models/${entry.file}`,
    entry.source
  ].filter(Boolean))];
}

async function loadFirstAvailableModel(urls) {
  let lastError = null;

  for (const url of urls) {
    try {
      return await loader.loadAsync(url);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('No model URL available.');
}

function mountModel(sceneObject) {
  if (modelRoot) scene.remove(modelRoot);
  if (resultMesh) {
    scene.remove(resultMesh);
    resultMesh = null;
  }

  modelRoot = sceneObject;
  modelRoot.position.set(0, MODEL_Y_OFFSET, 0);
  const partColor = getSavedTopColor();
  modelMaterial.color.set(partColor);
  modelRoot.traverse((child) => {
    if (!child.isMesh) return;
    child.material = cloneMaterial(child.material);
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (!material?.color) return;
      material.color.set(partColor);
      material.needsUpdate = true;
    });
    child.castShadow = true;
    child.receiveShadow = true;
  });
  scene.add(modelRoot);
  modelRoot.updateMatrixWorld(true);

  baseGeometry = collectMergedGeometry(modelRoot);
  baseBox = new THREE.Box3().setFromObject(modelRoot);
  const partSize = new THREE.Vector3();
  baseBox.getSize(partSize);
  positionLimits = {
    x: Math.max(18, partSize.x * 0.42),
    z: Math.max(18, partSize.z * 0.42),
    yMin: -Math.max(5, partSize.y * 0.35),
    yMax: Math.max(DEFAULT_Z_OFFSET, partSize.y * 0.35)
  };
  configurePositionInputs();
  surfaceY = baseBox.max.y;
  ground.position.y = baseBox.min.y - 0.01;

  fitCameraToObject(baseBox);
  render();
  updateActionButtonsState();
}

function getActiveLayer() {
  return svgLayers.find((layer) => layer.id === activeLayerId) || null;
}

function syncActiveLayerGlobals() {
  const layer = getActiveLayer();
  svgText = layer?.text || '';
  svgFilename = layer?.filename || '';
  logoRoot = layer?.root || null;
  logoArtwork = layer?.artwork || null;
  defaultLogoScale = layer?.defaultScale || 1;
}

function updateSvgSummary() {
  if (!svgLayers.length) {
    svgName.textContent = 'No logo added yet.';
    updateActionButtonsState();
    return;
  }

  const activeIndex = svgLayers.findIndex((layer) => layer.id === activeLayerId);
  const label = activeIndex >= 0 ? `Logo ${activeIndex + 1} selected` : 'No logo selected';
  svgName.textContent = `${svgLayers.length} logo${svgLayers.length === 1 ? '' : 's'} added. ${label}.`;
  updateActionButtonsState();
}

function updateRemoveSvgButton() {
  const activeLayer = getActiveLayer();
  removeSvgBtn.disabled = !activeLayer;
  removeSvgBtn.title = activeLayer ? `Delete selected layer: ${activeLayer.filename}` : 'Select an SVG layer to delete';
}

function renderSvgLayerList() {
  svgLayerList.replaceChildren();

  if (!svgLayers.length) {
    const emptyState = document.createElement('div');
    emptyState.className = 'engrave-layer-empty';
    emptyState.textContent = 'Add a logo above, then tap it here to move it.';
    svgLayerList.appendChild(emptyState);
    removeSvgBtn.disabled = true;
    return;
  }

  for (let index = 0; index < svgLayers.length; index += 1) {
    const layer = svgLayers[index];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `engrave-layer-btn${layer.id === activeLayerId ? ' active' : ''}`;
    button.dataset.layerId = layer.id;
    button.setAttribute('aria-pressed', layer.id === activeLayerId ? 'true' : 'false');

    const title = document.createElement('strong');
    title.textContent = `Logo ${index + 1}`;
    const meta = document.createElement('span');
    meta.textContent = layer.filename;

    button.append(title, meta);
    button.addEventListener('click', () => setActiveSvgLayer(layer.id));
    svgLayerList.appendChild(button);
  }

  updateRemoveSvgButton();
}

function updateControlsFromActiveLayer() {
  syncActiveLayerGlobals();

  if (!logoRoot) {
    scaleRange.value = '100';
    scaleValue.textContent = '100%';
    posXRange.value = '0';
    posZRange.value = '0';
    posYRange.value = DEFAULT_Z_OFFSET.toFixed(1);
    posXValue.textContent = '0.0 mm';
    posZValue.textContent = '0.0 mm';
    posYValue.textContent = `${DEFAULT_Z_OFFSET.toFixed(1)} mm`;
    transformControls.detach();
    setTransformVisible(false);
    renderSvgLayerList();
    updateRemoveSvgButton();
    updateSvgSummary();
    render();
    return;
  }

  scaleRange.value = String(getActiveLayer()?.scalePercent ?? 100);
  scaleValue.textContent = `${scaleRange.value}%`;
  syncPositionInputsFromLogo();

  if (viewMode === 'edit') {
    transformControls.attach(logoRoot);
    ensureTransformHelper();
    setTransformVisible(true);
    setTransformMode(transformMode);
  }

  renderSvgLayerList();
  updateRemoveSvgButton();
  updateSvgSummary();
  render();
}

function setActiveSvgLayer(layerId) {
  activeLayerId = layerId;
  updateControlsFromActiveLayer();
}

function addSvgLayer(layer) {
  svgLayers.push(layer);
  scene.add(layer.root);
  activeLayerId = layer.id;
  markPreviewDirty();
  updateControlsFromActiveLayer();
}

function disposeObjectTree(root) {
  if (!root) return;
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material?.dispose?.());
      return;
    }
    child.material?.dispose?.();
  });
}

function removeActiveSvgLayer() {
  const activeLayer = getActiveLayer();
  if (!activeLayer) return;
  const removedFilename = activeLayer.filename;

  transformControls.detach();
  scene.remove(activeLayer.root);
  disposeObjectTree(activeLayer.root);
  svgLayers = svgLayers.filter((layer) => layer.id !== activeLayer.id);
  activeLayerId = svgLayers[svgLayers.length - 1]?.id ?? null;
  markPreviewDirty();
  updateControlsFromActiveLayer();
  setStatus('ok', svgLayers.length
    ? `Removed ${removedFilename}.`
    : `Removed ${removedFilename}. No logos remain.`);
}

async function handleSvgUpload(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  backToEdit();

  let addedCount = 0;
  let failedCount = 0;

  try {
    for (const file of files) {
      try {
        const text = await file.text();
        const layer = await buildLogoFromSvg(text, file.name);
        addSvgLayer(layer);
        addedCount += 1;
      } catch (error) {
        console.error(error);
        failedCount += 1;
      }
    }

    if (addedCount > 0 && failedCount === 0) {
      setStatus('ok', `${addedCount} logo${addedCount === 1 ? '' : 's'} added! Drag it on the model, or resize it below.`);
    } else if (addedCount > 0) {
      setStatus('warn', `${addedCount} logo${addedCount === 1 ? '' : 's'} added, ${failedCount} couldn't be used. Try a simpler picture file.`);
    } else {
      setStatus('err', "Couldn't use that file. Try a different SVG picture.");
    }
  } finally {
    svgFileInput.value = '';
  }
}

async function rebuildLogoFromCurrentSvg() {
  if (!svgLayers.length) {
    depthValue.textContent = `${Number(depthRange.value).toFixed(1)} mm`;
    return;
  }

  backToEdit();

  const rebuiltLayers = [];
  for (const layer of svgLayers) {
    const savedTransform = captureLogoTransform(layer);
    const rebuiltLayer = await buildLogoFromSvg(layer.text, layer.filename, savedTransform);
    rebuiltLayer.id = layer.id;
    rebuiltLayers.push(rebuiltLayer);
  }

  svgLayers.forEach((layer) => {
    scene.remove(layer.root);
    disposeObjectTree(layer.root);
  });

  svgLayers = rebuiltLayers;
  svgLayers.forEach((layer) => scene.add(layer.root));
  activeLayerId = svgLayers.find((layer) => layer.id === activeLayerId)?.id || svgLayers[0]?.id || null;
  markPreviewDirty();
  updateControlsFromActiveLayer();
}

async function buildLogoFromSvg(text, filename, savedTransform = null) {
  if (!modelRoot || !baseBox) {
    setStatus('warn', 'The blank top is still loading.');
    throw new Error('Base model is not ready.');
  }

  const depth = Number(depthRange.value);
  const artwork = buildSvgArtwork(text, depth);
  const logoBounds = new THREE.Box3().setFromObject(artwork);
  const logoSize = new THREE.Vector3();
  logoBounds.getSize(logoSize);

  const partSize = new THREE.Vector3();
  baseBox.getSize(partSize);
  const computedDefaultScale = (Math.min(partSize.x, partSize.z) * 0.72) / Math.max(logoSize.x, logoSize.z, 1);
  const root = new THREE.Group();
  root.add(artwork);
  root.position.set(0, surfaceY + SVG_SURFACE_LIFT + DEFAULT_Z_OFFSET, 0);

  const layer = {
    id: `svg-layer-${nextLayerId}`,
    text,
    filename,
    root,
    artwork,
    defaultScale: computedDefaultScale,
    scalePercent: 100
  };
  nextLayerId += 1;

  if (savedTransform) {
    root.position.copy(savedTransform.position);
    root.rotation.copy(savedTransform.rotation);
    layer.scalePercent = savedTransform.scalePercent;
  }

  applyScaleToLayer(layer, layer.scalePercent);
  clampLogoPosition(root);
  return layer;
}

function buildSvgArtwork(text, depth) {
  const data = svgLoader.parse(text);
  const group = new THREE.Group();
  let acceptedShapes = 0;

  for (const path of data.paths) {
    const shapes = SVGLoader.createShapes(path);
    for (const shape of shapes) {
      if (estimateShapeArea(shape) < MIN_SHAPE_AREA) continue;
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth,
        steps: 1,
        bevelEnabled: false,
        curveSegments: 12
      });
      const mesh = new THREE.Mesh(geometry, previewMaterial.clone());
      group.add(mesh);
      acceptedShapes += 1;
    }
  }

  if (!group.children.length || acceptedShapes === 0) {
    throw new Error('SVG did not contain usable filled shapes.');
  }

  const bounds = new THREE.Box3().setFromObject(group);
  const centerX = (bounds.min.x + bounds.max.x) * 0.5;
  const centerY = (bounds.min.y + bounds.max.y) * 0.5;
  const minZ = bounds.min.z;

  group.children.forEach((child) => {
    child.geometry.translate(-centerX, -centerY, -minZ);
    child.geometry.rotateX(Math.PI / 2);
    child.geometry.computeVertexNormals();
    child.castShadow = true;
    child.receiveShadow = false;
  });

  return group;
}

function estimateShapeArea(shape) {
  const points = shape.getPoints(24);
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area * 0.5);
}

function captureLogoTransform(layer = getActiveLayer()) {
  if (!layer?.root || !layer?.artwork) return null;
  return {
    position: layer.root.position.clone(),
    rotation: layer.root.rotation.clone(),
    scalePercent: layer.scalePercent ?? 100
  };
}

function setTransformVisible(visible) {
  transformControls.visible = visible;
  if (transformHelper) transformHelper.visible = visible;
}

function ensureTransformHelper() {
  if (transformHelper) return;
  const helper = transformControls.getHelper?.();
  if (!helper || !helper.isObject3D) return;
  transformHelper = helper;
  transformHelper.visible = false;
  scene.add(transformHelper);
}

function configurePositionInputs() {
  posXRange.min = (-positionLimits.x).toFixed(1);
  posXRange.max = positionLimits.x.toFixed(1);
  posXRange.step = '0.1';
  posZRange.min = (-positionLimits.z).toFixed(1);
  posZRange.max = positionLimits.z.toFixed(1);
  posZRange.step = '0.1';
  posYRange.min = positionLimits.yMin.toFixed(1);
  posYRange.max = positionLimits.yMax.toFixed(1);
  posYRange.step = '0.1';
  posXRange.value = '0';
  posZRange.value = '0';
  posYRange.value = DEFAULT_Z_OFFSET.toFixed(1);
  posXValue.textContent = '0.0 mm';
  posZValue.textContent = '0.0 mm';
  posYValue.textContent = `${DEFAULT_Z_OFFSET.toFixed(1)} mm`;
}

function applyLogoPositionFromInputs() {
  if (!logoRoot) return;
  logoRoot.position.x = Number(posXRange.value);
  logoRoot.position.z = Number(posZRange.value);
  logoRoot.position.y = surfaceY + SVG_SURFACE_LIFT + Number(posYRange.value);
  clampLogoPosition(logoRoot);
  syncPositionInputsFromLogo();
  markPreviewDirty();
  render();
}

function syncPositionInputsFromLogo() {
  if (!logoRoot) return;
  posXRange.value = String(logoRoot.position.x.toFixed(1));
  posZRange.value = String(logoRoot.position.z.toFixed(1));
  posYRange.value = String((logoRoot.position.y - surfaceY - SVG_SURFACE_LIFT).toFixed(1));
  posXValue.textContent = `${logoRoot.position.x.toFixed(1)} mm`;
  posZValue.textContent = `${logoRoot.position.z.toFixed(1)} mm`;
  posYValue.textContent = `${(logoRoot.position.y - surfaceY - SVG_SURFACE_LIFT).toFixed(1)} mm`;
}

function clampLogoPosition(targetRoot = logoRoot) {
  if (!targetRoot) return;
  targetRoot.position.x = THREE.MathUtils.clamp(targetRoot.position.x, -positionLimits.x, positionLimits.x);
  targetRoot.position.z = THREE.MathUtils.clamp(targetRoot.position.z, -positionLimits.z, positionLimits.z);
  targetRoot.position.y = THREE.MathUtils.clamp(
    targetRoot.position.y,
    surfaceY + SVG_SURFACE_LIFT + positionLimits.yMin,
    surfaceY + SVG_SURFACE_LIFT + positionLimits.yMax
  );
}

function applyScaleToLayer(layer, scalePercent) {
  if (!layer?.artwork) return;
  layer.scalePercent = Number(scalePercent);
  const footprintScale = layer.defaultScale * (layer.scalePercent / 100);
  layer.artwork.scale.set(footprintScale, 1, footprintScale);
}

function applyLogoScale() {
  scaleValue.textContent = `${scaleRange.value}%`;
  const activeLayer = getActiveLayer();
  if (!activeLayer || !logoArtwork) return;

  applyScaleToLayer(activeLayer, scaleRange.value);
  markPreviewDirty();
  render();
}

function centerLogo() {
  if (!logoRoot) return;
  logoRoot.position.set(0, surfaceY + SVG_SURFACE_LIFT + DEFAULT_Z_OFFSET, 0);
  logoRoot.rotation.set(0, 0, 0);
  syncPositionInputsFromLogo();
  markPreviewDirty();
  render();
}

function setTransformMode(mode) {
  transformMode = mode;
  moveModeBtn.classList.toggle('active', mode === 'translate');
  rotateModeBtn.classList.toggle('active', mode === 'rotate');

  transformControls.setMode(mode);

  if (mode === 'translate') {
    transformControls.showX = true;
    transformControls.showY = true;
    transformControls.showZ = true;
  } else {
    transformControls.showX = false;
    transformControls.showY = true;
    transformControls.showZ = false;
  }

  if (logoRoot && viewMode === 'edit') {
    transformControls.attach(logoRoot);
    ensureTransformHelper();
    setTransformVisible(true);
  }

  render();
}

function markPreviewDirty() {
  previewDirty = true;
  if (resultMesh) resultMesh.visible = false;
  if (viewMode === 'preview') {
    viewMode = 'edit';
    if (modelRoot) modelRoot.visible = true;
    svgLayers.forEach((layer) => {
      layer.root.visible = true;
    });
    backToEditBtn.disabled = true;
    if (logoRoot) {
      transformControls.attach(logoRoot);
      ensureTransformHelper();
      setTransformVisible(true);
    }
  }
}

async function handlePreviewCut() {
  if (isProcessing) return;
  if (!svgLayers.length) {
    setStatus('warn', 'Upload at least one SVG logo first.');
    return;
  }

  try {
    isProcessing = true;
    updateActionButtonsState();
    await updateProgress('Preparing preview...', 'Collecting all SVG layers for the cut.');
    setStatus('ok', 'Generating engraved preview...');
    const mesh = await buildEngravedMesh(async ({ title, detail }) => {
      await updateProgress(title, detail);
    });
    if (resultMesh) scene.remove(resultMesh);
    resultMesh = mesh;
    scene.add(resultMesh);
    if (modelRoot) modelRoot.visible = false;
    svgLayers.forEach((layer) => {
      layer.root.visible = false;
    });
    transformControls.detach();
    setTransformVisible(false);
    viewMode = 'preview';
    backToEditBtn.disabled = false;
    await updateProgress('Preview ready', 'Switching to the engraved result.');
    setStatus('ok', 'Preview generated. Download STL or go back to edit.');
    render();
  } catch (error) {
    console.error(error);
    setStatus('err', 'Boolean engraving failed. Try a simpler SVG or a shallower cut.');
  } finally {
    isProcessing = false;
    hideProgress();
    updateActionButtonsState();
  }
}

function captureViewState() {
  return {
    viewMode,
    modelVisible: modelRoot ? modelRoot.visible : null,
    resultVisible: resultMesh ? resultMesh.visible : null,
    layerVisibility: svgLayers.map((layer) => layer.root.visible)
  };
}

function restoreViewState(state) {
  if (!state) return;
  viewMode = state.viewMode;
  if (modelRoot && state.modelVisible !== null) modelRoot.visible = state.modelVisible;
  if (resultMesh && state.resultVisible !== null) resultMesh.visible = state.resultVisible;
  svgLayers.forEach((layer, index) => {
    if (state.layerVisibility[index] !== undefined) layer.root.visible = state.layerVisibility[index];
  });
  render();
}

function canExportStl() {
  return Boolean(baseGeometry) && svgLayers.length > 0 && !isProcessing;
}

function updateActionButtonsState() {
  const disabled = !canExportStl();
  downloadStlBtn.disabled = disabled;
  sendToSlicerBtn.disabled = disabled;
}

function backToEdit() {
  viewMode = 'edit';
  if (modelRoot) modelRoot.visible = true;
  svgLayers.forEach((layer) => {
    layer.root.visible = true;
  });
  if (resultMesh) resultMesh.visible = false;
  if (logoRoot) {
    transformControls.attach(logoRoot);
    ensureTransformHelper();
    setTransformVisible(true);
  } else {
    transformControls.detach();
    setTransformVisible(false);
  }
  backToEditBtn.disabled = true;
  render();
}

async function handleDownloadStl() {
  if (!canExportStl()) return;

  const viewState = captureViewState();
  try {
    isProcessing = true;
    updateActionButtonsState();
    await updateProgress('Preparing STL export...', 'Collecting all SVG layers for the cut.');
    setStatus('ok', 'Generating engraved STL...');
    const mesh = await buildEngravedMesh(async ({ title, detail }) => {
      await updateProgress(title, detail);
    });
    await updateProgress('Serializing STL...', 'Cleaning the engraved mesh and converting it into a downloadable STL file.');
    const exportMesh = createExportMesh(mesh);
    const stlData = exporter.parse(exportMesh, { binary: true });
    const blob = new Blob([stlData], { type: 'model/stl' });
    downloadBlob(blob, getEngravedFilename());
    await updateProgress('Download ready', 'Your STL file is being saved.');
    setStatus('ok', 'Engraved STL downloaded.');
  } catch (error) {
    console.error(error);
    setStatus('err', 'Failed to export STL. Try a smaller or simpler SVG.');
  } finally {
    isProcessing = false;
    hideProgress();
    restoreViewState(viewState);
    updateActionButtonsState();
  }
}

async function handleSendToSlicer() {
  if (!canExportStl()) return;

  const slicer = getPreferredSlicer();
  const slicerLabel = SLICER_LABELS[slicer];
  const viewState = captureViewState();
  try {
    isProcessing = true;
    updateActionButtonsState();
    await updateProgress(`Preparing ${slicerLabel} import...`, `Generating the engraved STL for the local ${slicerLabel} helper.`);
    setStatus('ok', `Preparing the engraved STL for ${slicerLabel}...`);
    const mesh = await buildEngravedMesh(async ({ title, detail }) => {
      await updateProgress(title, detail);
    });
    await updateProgress('Packaging STL...', 'Cleaning the engraved mesh and converting it into a transferable STL file.');
    const exportMesh = createExportMesh(mesh);
    const stlData = exporter.parse(exportMesh, { binary: true });
    const filename = getEngravedFilename();
    const payload = {
      slicer,
      filename,
      content_base64: bytesToBase64(stlData)
    };

    await updateProgress(`Opening ${slicerLabel}...`, `Saving the STL and opening ${slicerLabel}.`);
    const response = await fetch(SLICER_BRIDGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      let bridgeMessage = errorText;
      try {
        const parsed = JSON.parse(errorText);
        bridgeMessage = parsed?.error || parsed?.message || errorText;
      } catch {
      }
      throw new Error(bridgeMessage || `Bridge returned HTTP ${response.status}.`);
    }

    const result = await response.json();
    const savedName = result?.filename || filename;
    setStatus('ok', `Sent ${savedName} to ${slicerLabel}.`);
  } catch (error) {
    console.error(error);
    const errorMessage = String(error?.message || error);
    const message = /Failed to fetch|NetworkError/i.test(errorMessage)
      ? `Could not reach ${slicerLabel}. Make sure the slicer helper is running on this computer, then try again.`
      : errorMessage || `Failed to send the STL to ${slicerLabel}.`;
    setStatus('err', message);
  } finally {
    isProcessing = false;
    hideProgress();
    restoreViewState(viewState);
    updateActionButtonsState();
  }
}

async function buildEngravedMesh(onProgress = null) {
  if (!baseGeometry || !svgLayers.length) {
    throw new Error('Missing base model or logo.');
  }

  if (!previewDirty && resultMesh) {
    if (onProgress) {
      await onProgress({
        title: 'Using cached result...',
        detail: 'No changes were made since the last preview, so the existing mesh can be reused.'
      });
    }
    return resultMesh.clone();
  }

  if (onProgress) {
    await onProgress({
      title: 'Building cutter geometry...',
      detail: 'Merging all selected SVG layers into one engraving cutter.'
    });
  }
  const cutterGeometry = collectCombinedLogoGeometry(svgLayers.map((layer) => layer.root));
  if (!cutterGeometry) throw new Error('No cutter geometry available.');

  if (onProgress) {
    await onProgress({
      title: 'Preparing meshes...',
      detail: 'Normalizing the base part and cutter for the boolean operation.'
    });
  }
  const baseBrush = new Brush(normalizeCsgGeometry(baseGeometry), modelMaterial);
  const cutterBrush = new Brush(normalizeCsgGeometry(cutterGeometry), previewMaterial);
  baseBrush.updateMatrixWorld(true);
  cutterBrush.updateMatrixWorld(true);

  if (onProgress) {
    await onProgress({
      title: 'Cutting the model...',
      detail: 'Applying the boolean subtraction. This is the slowest step on complex designs.'
    });
  }
  const engraved = evaluator.evaluate(baseBrush, cutterBrush, SUBTRACTION);
  engraved.material = modelMaterial.clone();
  engraved.castShadow = true;
  engraved.receiveShadow = true;

  if (onProgress) {
    await onProgress({
      title: 'Finalizing geometry...',
      detail: 'Cleaning the engraved mesh and calculating normals for preview.'
    });
  }
  engraved.geometry.computeVertexNormals();

  previewDirty = false;
  return engraved;
}

function collectCombinedLogoGeometry(roots) {
  const geometries = roots
    .map((root) => collectMergedGeometry(root))
    .filter(Boolean)
    .map((geometry) => {
      const clone = geometry.clone();
      return clone.index ? clone.toNonIndexed() : clone;
    });

  if (!geometries.length) {
    return null;
  }

  const merged = mergeGeometries(geometries, false);
  if (!merged) return null;
  const indexed = mergeVertices(merged, 1e-4);
  return normalizeCsgGeometry(indexed);
}

function collectMergedGeometry(root) {
  root.updateMatrixWorld(true);
  const geometries = [];

  root.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    const cloned = child.geometry.clone();
    const geometry = cloned.index ? cloned.toNonIndexed() : cloned;
    geometry.applyMatrix4(child.matrixWorld);
    delete geometry.attributes.color;
    if (geometry.attributes.normal == null) {
      geometry.computeVertexNormals();
    }
    geometry.clearGroups();
    geometries.push(geometry);
  });

  if (!geometries.length) {
    return null;
  }

  const merged = mergeGeometries(geometries, false);
  if (!merged) return null;
  const indexed = mergeVertices(merged, 1e-4);
  return normalizeCsgGeometry(indexed);
}

// Same relative viewing angle as the main customizer's default camera
// (position (-90, 100, 120) looking at the origin), so switching between
// the customizer and the engraving tool keeps the same sense of orientation.
const DEFAULT_VIEW_DIRECTION = new THREE.Vector3(-90, 100, 120).normalize();

function fitCameraToObject(box) {
  const size = new THREE.Vector3();
  box.getSize(size);

  // Look at the part's mount point (same X/Z/Y anchor the main customizer
  // uses for every part), not the mesh's own bounding-box center -- some
  // top variants aren't perfectly centered on their own origin, which
  // previously made the part appear to sit in a different spot on screen
  // than it does in the main customizer.
  const target = new THREE.Vector3(0, MODEL_Y_OFFSET, 0);
  const maxSize = Math.max(size.x, size.y, size.z);
  const distance = maxSize * 2.2;

  camera.position.copy(DEFAULT_VIEW_DIRECTION).multiplyScalar(distance).add(target);
  controls.target.copy(target);
  controls.update();
}

function cloneMaterial(material) {
  if (Array.isArray(material)) {
    return material.map((entry) => (entry?.clone ? entry.clone() : entry));
  }
  return material?.clone ? material.clone() : modelMaterial.clone();
}

function normalizeCsgGeometry(geometry) {
  const normalized = geometry.index ? geometry.clone() : mergeVertices(geometry.clone(), 1e-4);
  const position = normalized.attributes.position;
  if (!position) return normalized;

  if (normalized.attributes.normal == null) {
    normalized.computeVertexNormals();
  }

  if (normalized.attributes.uv == null) {
    normalized.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(position.count * 2), 2));
  }

  normalized.clearGroups();
  normalized.computeBoundingBox();
  normalized.computeBoundingSphere();
  return normalized;
}

function navigateWithFade(url) {
  if ('startViewTransition' in document) {
    window.location.assign(url);
    return;
  }
  document.documentElement.classList.add('vt-leaving');
  window.setTimeout(() => window.location.assign(url), 180);
}

function setStatus(type, message) {
  statusMessage.className = `combo-chip ${type}`;
  statusMessage.textContent = message;
}

function showProgress(title, detail) {
  progressTitle.textContent = title;
  progressDetail.textContent = detail;
  progressOverlay.hidden = false;
  progressOverlay.setAttribute('aria-hidden', 'false');
}

function hideProgress() {
  progressOverlay.hidden = true;
  progressOverlay.setAttribute('aria-hidden', 'true');
}

async function updateProgress(title, detail) {
  showProgress(title, detail);
  render();
  await waitForUiPaint();
}

function waitForUiPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
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

function getEngravedFilename() {
  const svgBase = svgLayers.length === 1
    ? (svgLayers[0].filename || 'logo').replace(/\.svg$/i, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '')
    : `multi-logo-${svgLayers.length}`;
  const partBase = requestedFile.replace(/\.glb$/i, '');
  return `${partBase}_${svgBase || 'engraved'}.stl`;
}

function createExportMesh(sourceMesh) {
  const geometry = sanitizeExportGeometry(sourceMesh.geometry);
  const exportMesh = new THREE.Mesh(geometry, sourceMesh.material);
  exportMesh.position.copy(sourceMesh.position);
  exportMesh.quaternion.copy(sourceMesh.quaternion);
  exportMesh.scale.copy(sourceMesh.scale);
  exportMesh.updateMatrixWorld(true);
  return exportMesh;
}

function sanitizeExportGeometry(geometry) {
  const working = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const position = working.getAttribute('position');
  if (!position) {
    throw new Error('Missing export geometry positions.');
  }

  const source = position.array;
  const cleaned = [];
  const epsilon = 1e-8;

  for (let index = 0; index < source.length; index += 9) {
    const ax = source[index];
    const ay = source[index + 1];
    const az = source[index + 2];
    const bx = source[index + 3];
    const by = source[index + 4];
    const bz = source[index + 5];
    const cx = source[index + 6];
    const cy = source[index + 7];
    const cz = source[index + 8];

    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;

    const crossX = aby * acz - abz * acy;
    const crossY = abz * acx - abx * acz;
    const crossZ = abx * acy - aby * acx;
    const areaSquared = (crossX * crossX) + (crossY * crossY) + (crossZ * crossZ);

    if (areaSquared <= epsilon) {
      continue;
    }

    cleaned.push(
      ax, ay, az,
      bx, by, bz,
      cx, cy, cz
    );
  }

  if (!cleaned.length) {
    throw new Error('No valid triangles remained after sanitizing the export mesh.');
  }

  const sanitized = new THREE.BufferGeometry();
  sanitized.setAttribute('position', new THREE.Float32BufferAttribute(cleaned, 3));
  const welded = mergeVertices(sanitized, 1e-5);
  welded.deleteAttribute('normal');
  welded.deleteAttribute('uv');
  welded.deleteAttribute('color');
  welded.computeVertexNormals();
  welded.computeBoundingBox();
  welded.computeBoundingSphere();
  return welded;
}

function bytesToBase64(data) {
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new TextEncoder().encode(String(data));

  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

function render() {
  renderer.render(scene, camera);
}
