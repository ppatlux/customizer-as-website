// Whole-build print file: one 3MF with a separate, named object per piece,
// laid out side by side on the print bed so the slicer shows them as
// individual objects (move / rotate / delete each one). Built entirely in the
// browser from the meshes already in the scene, then sent through the same
// Prusa upload as a single part (see prusa-export.js) — Prusa's import
// endpoint accepts 3MF as well as STL.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// The customizer is Y-up; slicers (and 3MF) are Z-up. +90° about X maps
// (x, y, z) -> (x, -z, y), so a part's top stays its top on the bed.
const Y_UP_TO_Z_UP = new THREE.Matrix4().makeRotationX(Math.PI / 2);

// Layout target: the bed centre of Prusa's MK3/MK4 (250 × 210 mm). Other
// printers still get every piece in one tidy cluster; Arrange (A) in the
// slicer re-centres it for any bed.
const BED_CENTER = { x: 125, y: 105 };
const ROW_WIDTH = 220;
const GAP = 8;
// Welding tolerance in mm — GLB meshes are split at hard normals/UV seams;
// without re-welding every edge would look open to the slicer.
const WELD_TOLERANCE = 1e-3;

const CORE_NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';

// pieces: [{ name, object }] — object is any Object3D from the live scene.
// Resolves to a 'model/3mf' Blob; throws if nothing printable was found.
export async function buildPrint3mf(pieces, { title = 'HP Robot' } = {}) {
  const meshes = pieces
    .map(({ name, object }) => ({ name, ...pieceMesh(object) }))
    .filter((piece) => piece.triangles.length);
  if (!meshes.length) throw new Error('Nothing printable is visible.');

  const placements = layOut(meshes);
  const objectsXml = [];
  const itemsXml = [];
  meshes.forEach((piece, i) => {
    const id = i + 1;
    objectsXml.push(objectXml(id, piece));
    const { x, y } = placements[i];
    itemsXml.push(`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${fmt(x)} ${fmt(y)} 0"/>`);
  });

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NS}">
<metadata name="Title">${escapeXml(title)}</metadata>
<metadata name="Application">HP Robots Customizer</metadata>
<resources>
${objectsXml.join('\n')}
</resources>
<build>
${itemsXml.join('\n')}
</build>
</model>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>');
  zip.file('3D/3dmodel.model', model);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { blob: new Blob([blob], { type: 'model/3mf' }), count: meshes.length };
}

// Flattens every visible mesh under `object` into one welded, Z-up triangle
// mesh with its bounding-box minimum at the origin (sitting on the bed).
function pieceMesh(object) {
  object.updateWorldMatrix(true, true);
  const chunks = [];
  let total = 0;
  const matrix = new THREE.Matrix4();

  object.traverse((node) => {
    // isMesh only: the ghost-highlight outlines are LineSegments children.
    if (!node.isMesh || !node.geometry?.attributes?.position) return;
    if (!isShown(node, object)) return;

    const source = new THREE.BufferGeometry();
    source.setAttribute('position', node.geometry.attributes.position);
    if (node.geometry.index) source.setIndex(node.geometry.index);
    const flat = source.toNonIndexed();
    matrix.multiplyMatrices(Y_UP_TO_Z_UP, node.matrixWorld);
    flat.applyMatrix4(matrix);
    const positions = flat.attributes.position.array;
    // A mirroring transform flips winding — swap two corners back so normals
    // keep pointing outward.
    if (node.matrixWorld.determinant() < 0) {
      for (let i = 0; i < positions.length; i += 9) {
        for (let k = 0; k < 3; k++) {
          const t = positions[i + 3 + k];
          positions[i + 3 + k] = positions[i + 6 + k];
          positions[i + 6 + k] = t;
        }
      }
    }
    chunks.push(positions);
    total += positions.length;
  });

  if (!total) return { vertices: new Float32Array(0), triangles: [], size: { x: 0, y: 0 } };

  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(merged, 3));
  const welded = mergeVertices(geometry, WELD_TOLERANCE);
  welded.computeBoundingBox();
  const { min, max } = welded.boundingBox;
  welded.translate(-min.x, -min.y, -min.z);

  const index = welded.index.array;
  const triangles = [];
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2];
    // Welding can collapse slivers into degenerate triangles; 3MF forbids them.
    if (a !== b && b !== c && a !== c) triangles.push(a, b, c);
  }
  return {
    vertices: welded.attributes.position.array,
    triangles,
    size: { x: max.x - min.x, y: max.y - min.y }
  };
}

// Hidden sub-meshes inside a piece are skipped. The piece root's own flag
// isn't checked — which pieces to print is decided by the caller (partVis).
function isShown(node, root) {
  for (let n = node; n && n !== root; n = n.parent) {
    if (!n.visible) return false;
  }
  return true;
}

// Simple shelf packing, tallest footprint first, then the whole cluster is
// centred on BED_CENTER. Returns the bed position of each piece's corner.
function layOut(pieces) {
  const order = pieces.map((_, i) => i).sort((a, b) => pieces[b].size.y - pieces[a].size.y);
  const raw = new Array(pieces.length);
  let x = 0, y = 0, rowDepth = 0, width = 0;
  for (const i of order) {
    const { size } = pieces[i];
    if (x > 0 && x + size.x > ROW_WIDTH) {
      y += rowDepth + GAP;
      x = 0;
      rowDepth = 0;
    }
    raw[i] = { x, y };
    x += size.x + GAP;
    rowDepth = Math.max(rowDepth, size.y);
    width = Math.max(width, x - GAP);
  }
  const depth = y + rowDepth;
  const dx = BED_CENTER.x - width / 2;
  const dy = BED_CENTER.y - depth / 2;
  return raw.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

function objectXml(id, { name, vertices, triangles }) {
  const out = [`<object id="${id}" type="model" name="${escapeXml(name)}"><mesh><vertices>`];
  for (let i = 0; i < vertices.length; i += 3) {
    out.push(`<vertex x="${fmt(vertices[i])}" y="${fmt(vertices[i + 1])}" z="${fmt(vertices[i + 2])}"/>`);
  }
  out.push('</vertices><triangles>');
  for (let i = 0; i < triangles.length; i += 3) {
    out.push(`<triangle v1="${triangles[i]}" v2="${triangles[i + 1]}" v3="${triangles[i + 2]}"/>`);
  }
  out.push('</triangles></mesh></object>');
  return out.join('');
}

function fmt(value) {
  return String(Math.round(value * 10000) / 10000);
}

function escapeXml(text) {
  return String(text).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}
