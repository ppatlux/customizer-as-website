// Print files for slicers and STL downloads. Many customizer models combine
// several separately printed bodies in one file (both wheels, left + right
// arm, a light top + its diffuser, a hat + its brim…) because that's how they
// look assembled. For printing, every body is split out, laid flat if it
// stands on an edge, and placed apart on the bed:
//   buildPrint3mf  → one 3MF, each body its own named object (slicer upload),
//                    carrying the customizer colours as filament slots
//   buildPrintStl  → one STL with the bodies spread out (downloads)
// Sources are Z-up triangle soups (positions, 9 floats per triangle) — from a
// hosted STL or the scene mesh, see getPartPrintSource() in app.js — with an
// optional colour per triangle.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// The customizer is Y-up; slicers (and 3MF/STL) are Z-up. +90° about X maps
// (x, y, z) -> (x, -z, y), so a part's top stays its top on the bed.
const Y_UP_TO_Z_UP = new THREE.Matrix4().makeRotationX(Math.PI / 2);

// Layout target: the bed of Prusa's MK3/MK4 (250 × 210 mm; CORE One is a bit
// bigger). Pieces that end up off the bed are skipped by command-line /
// server-side slicing, so the packing tries hard to fit. Other printers still
// get one tidy cluster; Arrange (A) in the slicer re-packs it for any bed.
export const BED = { x: 250, y: 210 };
const GAP = 5;
// Welding tolerance in mm — GLB meshes are split at hard normals/UV seams;
// without re-welding every edge would look open to the slicer (and every
// triangle would count as its own body).
const WELD_TOLERANCE = 1e-3;
// Body rules (volumes in mm³): a closed shell above MIN_CLOSED, or any shell
// above MIN_SOLID even with holes in its surface, prints on its own. An
// inside-out shell sitting inside a much bigger body is a modelled cavity
// (e.g. a magnet hole) and stays with it; anything else inside-out is just
// wound backwards and gets flipped.
const MIN_CLOSED = 1;
const MIN_SOLID = 100;
const CAVITY_RATIO = 0.05;
const TOUCH = 0.05;
// Lay a body flat when it is standing on an edge: its height is this many
// times its thinnest side (an upright wheel, an arm, a face plate).
const STANDING_RATIO = 1.5;

const CORE_NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const SLIC3R_NS = 'http://schemas.slic3r.org/3mf/2017/06';
// Multi-material printers most people have (MMU3, XL, CORE One INDX…) hold
// up to five filaments; more colours still get slots, the caller warns.
export const COMMON_SLOT_LIMIT = 5;

// pieces: [{ name, positions, colors?, color? }] — `colors` is one hex per
// triangle, `color` a single hex for the whole piece. Colours become filament
// slots, most-used first, written two ways:
//  - PrusaSlicer / EasyPrint: each object's extruder in
//    Metadata/Slic3r_PE_model.config, plus per-triangle MMU painting
//    (slic3rpe:mmu_segmentation) where a body has more than one colour;
//  - Bambu Studio / OrcaSlicer: the same in Metadata/model_settings.config
//    and paint_color, with the slot colours in project_settings.config.
// PrusaSlicer 2.9 honours the first (checked by slicing), ignores the second,
// and a single-filament printer simply ignores both.
// Resolves to { blob: 'model/3mf', count, slots: [{ slot, hex, name }], fitsBed }.
export async function buildPrint3mf(pieces, { title = 'HP Robots', colorNames = {} } = {}) {
  const bodies = splitPieces(pieces);
  const slots = assignSlots(bodies, colorNames);
  const slotOf = new Map(slots.map((s) => [s.hex, s.slot]));
  const placements = layOut(bodies);
  const objectsXml = [];
  const itemsXml = [];
  const prusaConfig = [];
  const bambuConfig = [];
  bodies.forEach((body, i) => {
    const id = i + 1;
    body.slot = slotOf.get(body.mainColor) || 1;
    const colorName = body.mainColor ? slots[body.slot - 1]?.name : null;
    const name = colorName ? `${body.name} – ${colorName}` : body.name;
    objectsXml.push(objectXml(id, name, body, slotOf));
    const { x, y } = placements[i];
    itemsXml.push(`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${fmt(x)} ${fmt(y)} 0"/>`);
    const lastTri = body.triangles.length / 3 - 1;
    prusaConfig.push(` <object id="${id}" instances_count="1">
  <metadata type="object" key="name" value="${escapeXml(name)}"/>
  <metadata type="object" key="extruder" value="${body.slot}"/>
  <volume firstid="0" lastid="${lastTri}">
   <metadata type="volume" key="name" value="${escapeXml(name)}"/>
  </volume>
 </object>`);
    bambuConfig.push(`  <object id="${id}">
    <metadata key="name" value="${escapeXml(name)}"/>
    <metadata key="extruder" value="${body.slot}"/>
    <part id="1" subtype="normal_part">
      <metadata key="name" value="${escapeXml(name)}"/>
      <metadata key="extruder" value="${body.slot}"/>
    </part>
  </object>`);
  });

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NS}" xmlns:slic3rpe="${SLIC3R_NS}">
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
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/plain"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>');
  zip.file('3D/3dmodel.model', model);
  if (slots.length) {
    zip.file('Metadata/Slic3r_PE_model.config', `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${prusaConfig.join('\n')}\n</config>\n`);
    zip.file('Metadata/model_settings.config', `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${bambuConfig.join('\n')}\n</config>\n`);
    zip.file('Metadata/project_settings.config', JSON.stringify({ filament_colour: slots.map((s) => s.hex) }, null, 2));
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { blob: new Blob([blob], { type: 'model/3mf' }), count: bodies.length, slots, fitsBed: placements.fitsBed };
}

// Every colour in the print becomes a filament slot (1-based), ordered by how
// much surface it covers. Each body's main colour (most area) decides its
// object slot; other colours on it are painted per triangle.
function assignSlots(bodies, colorNames) {
  const totals = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e = new THREE.Vector3();
  for (const body of bodies) {
    const own = new Map();
    const v = body.vertices, t = body.triangles;
    for (let k = 0; k < t.length; k += 3) {
      const hex = body.colors[k / 3];
      if (!hex) continue;
      a.fromArray(v, t[k] * 3); b.fromArray(v, t[k + 1] * 3); c.fromArray(v, t[k + 2] * 3);
      const area = b.sub(a).cross(e.subVectors(c, a)).length() / 2;
      own.set(hex, (own.get(hex) || 0) + area);
    }
    let best = null;
    for (const [hex, area] of own) {
      totals.set(hex, (totals.get(hex) || 0) + area);
      if (!best || area > own.get(best)) best = hex;
    }
    body.mainColor = best;
  }
  return [...totals.entries()]
    .sort((p, q) => q[1] - p[1])
    .map(([hex], i) => ({ slot: i + 1, hex, name: colorNames[hex] || hex }));
}

// PrusaSlicer's per-triangle paint code for "whole triangle = filament slot
// n" (TriangleSelector serialisation, unsplit leaf): 1 → "4", 2 → "8",
// 3+ → hex(n-3) + "C". Verified with PrusaSlicer 2.9 for slots 1-5.
function paintCode(slot) {
  if (slot === 1) return '4';
  if (slot === 2) return '8';
  return `${(slot - 3).toString(16).toUpperCase()}C`;
}

// Same split + layout as buildPrint3mf, as one binary STL (an STL has no
// notion of objects; the bodies are simply spread out, and a slicer's
// "Split to objects" separates them). Resolves to { blob, count }.
export function buildPrintStl(positions) {
  const bodies = splitPieces([{ name: 'part', positions }]);
  const placements = layOut(bodies);
  const triCount = bodies.reduce((n, b) => n + b.triangles.length / 3, 0);
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triCount, true);
  let o = 84;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  bodies.forEach((body, i) => {
    const { x, y } = placements[i];
    const v = body.vertices, t = body.triangles;
    for (let k = 0; k < t.length; k += 3) {
      a.fromArray(v, t[k] * 3); b.fromArray(v, t[k + 1] * 3); c.fromArray(v, t[k + 2] * 3);
      n.subVectors(b, a).cross(e.subVectors(c, a)).normalize();
      for (const val of [n.x, n.y, n.z]) { view.setFloat32(o, val, true); o += 4; }
      for (const p of [a, b, c]) {
        view.setFloat32(o, p.x + x, true); view.setFloat32(o + 4, p.y + y, true); view.setFloat32(o + 8, p.z, true);
        o += 12;
      }
      o += 2;
    }
  });
  return { blob: new Blob([buffer], { type: 'model/stl' }), count: bodies.length };
}

// Visible meshes under a scene object, as one Z-up triangle soup. With
// `colorOf(mesh) -> hex`, also returns that colour for each triangle.
export function positionsFromObject(object, colorOf = null) {
  // Measure at full size even if the part's swap-in "pop" animation is still
  // scaling its root up from small.
  const liveScale = object.scale.clone();
  object.scale.setScalar(1);
  object.updateWorldMatrix(true, true);
  const chunks = [];
  const colors = [];
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
    const p = flat.attributes.position.array;
    // A mirroring transform flips winding — swap two corners back.
    if (node.matrixWorld.determinant() < 0) {
      for (let i = 0; i < p.length; i += 9) {
        for (let k = 0; k < 3; k++) {
          const tmp = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = tmp;
        }
      }
    }
    chunks.push(p);
    if (colorOf) {
      const hex = colorOf(node);
      for (let i = 0; i < p.length / 9; i++) colors.push(hex);
    }
  });
  object.scale.copy(liveScale);
  object.updateWorldMatrix(true, true);
  return { positions: concat(chunks), colors: colorOf ? colors : null };
}

// Hosted STL (binary or ASCII) → Z-up triangle soup. CAD STLs are already Z-up.
export async function positionsFromStl(buffer) {
  const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
  const geometry = new STLLoader().parse(buffer);
  return (geometry.index ? geometry.toNonIndexed() : geometry).attributes.position.array;
}

function concat(chunks) {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

// Hidden sub-meshes inside a piece are skipped. The piece root's own flag
// isn't checked — which pieces to print is decided by the caller (partVis).
function isShown(node, root) {
  for (let n = node; n && n !== root; n = n.parent) {
    if (!n.visible) return false;
  }
  return true;
}

// ---- splitting ------------------------------------------------------------

function splitPieces(pieces) {
  const bodies = [];
  for (const { name, positions, colors, color } of pieces) {
    const parts = splitBodies(positions, colors ? (i) => colors[i] : () => color || null);
    parts.forEach((body, i) => {
      body.name = parts.length > 1 ? `${name} (${i + 1}/${parts.length})` : name;
      bodies.push(body);
    });
  }
  if (!bodies.length) throw new Error('Nothing printable is visible.');
  return bodies;
}

// Triangle soup → separate printable bodies, each laid flat and grounded.
// colorAt(i) gives source triangle i's colour; it rides along with every
// kept triangle (body.colors, one per triangle).
function splitBodies(positions, colorAt = () => null) {
  if (!positions?.length) return [];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const welded = mergeVertices(geometry, WELD_TOLERANCE);
  const verts = welded.attributes.position.array;
  const index = welded.index.array;
  const vertexCount = verts.length / 3;

  // Union-find over vertices; triangles sharing a vertex share a shell.
  const parent = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parent[i] = i;
  const find = (x) => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  const tris = [];
  const triColors = [];
  // Some source files carry the same surface several times over (e.g. a body
  // exported 2-4x on top of itself); keep one copy of each triangle. Only
  // same-facing copies count — two bodies touching face to face share
  // triangles that face opposite ways, and both are needed.
  const seenTris = new Set();
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2];
    // Welding can collapse slivers into degenerate triangles; 3MF forbids them.
    if (a === b || b === c || a === c) continue;
    // Rotate the triple to start at its smallest index: keeps the winding.
    const key = a < b && a < c ? `${a},${b},${c}` : b < c ? `${b},${c},${a}` : `${c},${a},${b}`;
    if (seenTris.has(key)) continue;
    seenTris.add(key);
    tris.push(a, b, c);
    triColors.push(colorAt(i / 3));
    const ra = find(a);
    parent[find(b)] = ra;
    parent[find(c)] = ra;
  }

  const shellsByRoot = new Map();
  for (let i = 0; i < tris.length; i += 3) {
    const root = find(tris[i]);
    let shell = shellsByRoot.get(root);
    if (!shell) shellsByRoot.set(root, shell = { tris: [], cols: [] });
    shell.tris.push(tris[i], tris[i + 1], tris[i + 2]);
    shell.cols.push(triColors[i / 3]);
  }
  const shells = [...shellsByRoot.values()].map((s) => measure(orient(s, vertexCount), verts, vertexCount));

  // Classify: real bodies first (largest first), then cavities and fragments
  // attach to the body that contains / touches them.
  shells.sort((p, q) => Math.abs(q.volume) - Math.abs(p.volume));
  const bodies = [];
  const leftovers = [];
  for (const s of shells) {
    const size = Math.abs(s.volume);
    const isBody = (s.open === 0 && size > MIN_CLOSED) || size >= MIN_SOLID;
    if (isBody && s.volume < 0) {
      const container = bodies.find((b) => contains(b, s) && size < CAVITY_RATIO * b.volume);
      if (container) { container.shells.push(s); continue; }
      flip(s);
    }
    if (isBody) bodies.push({ volume: size, min: s.min.slice(), max: s.max.slice(), shells: [s] });
    else leftovers.push(s);
  }
  for (const s of leftovers) {
    if (!bodies.length) { bodies.push({ volume: 0, min: s.min.slice(), max: s.max.slice(), shells: [s] }); continue; }
    const touching = bodies.filter((b) => touches(b, s));
    const host = (touching.length ? touching : bodies).reduce((best, b) =>
      (touching.length ? b.volume > best.volume : boxDistance(b, s) < boxDistance(best, s)) ? b : best);
    host.shells.push(s);
  }

  return bodies.map((b) => layFlat(compact(b, verts)));
}

// Make a shell's winding consistent: walk across shared edges and flip any
// neighbour that runs the edge the same way (a correctly wound neighbour runs
// it backwards). Some source STLs mix both windings, which leaves the volume
// sign meaningless. The direction most triangles already had wins, so a
// deliberately inverted cavity shell stays inverted. Non-manifold edges
// (3+ triangles) are skipped.
function orient(shell, vertexCount) {
  const t = shell.tris;
  const triCount = t.length / 3;
  const byEdge = new Map();
  for (let i = 0; i < triCount; i++) {
    for (let k = 0; k < 3; k++) {
      const p = t[i * 3 + k], q = t[i * 3 + (k + 1) % 3];
      const key = p < q ? p * vertexCount + q : q * vertexCount + p;
      let list = byEdge.get(key);
      if (!list) byEdge.set(key, list = []);
      list.push(i);
    }
  }
  const runsForward = (tri, p, q) => {
    for (let k = 0; k < 3; k++) if (t[tri * 3 + k] === p && t[tri * 3 + (k + 1) % 3] === q) return true;
    return false;
  };
  const seen = new Uint8Array(triCount);
  const flipped = new Uint8Array(triCount);
  let flips = 0;
  for (let start = 0; start < triCount; start++) {
    if (seen[start]) continue;
    seen[start] = 1;
    const queue = [start];
    while (queue.length) {
      const i = queue.pop();
      for (let k = 0; k < 3; k++) {
        const p = t[i * 3 + k], q = t[i * 3 + (k + 1) % 3];
        const list = byEdge.get(p < q ? p * vertexCount + q : q * vertexCount + p);
        if (list.length !== 2) continue;
        const j = list[0] === i ? list[1] : list[0];
        if (seen[j]) continue;
        seen[j] = 1;
        // i (already final) runs p->q; a consistent j must run q->p.
        if (runsForward(j, p, q)) {
          const tmp = t[j * 3 + 1]; t[j * 3 + 1] = t[j * 3 + 2]; t[j * 3 + 2] = tmp;
          flipped[j] = 1;
          flips++;
        }
        queue.push(j);
      }
    }
  }
  // Keep whichever orientation the majority of triangles came in with.
  if (flips * 2 > triCount) {
    for (let i = 0; i < triCount; i++) {
      const tmp = t[i * 3 + 1]; t[i * 3 + 1] = t[i * 3 + 2]; t[i * 3 + 2] = tmp;
    }
  }
  return shell;
}

function measure(shell, verts, vertexCount) {
  const t = shell.tris;
  let volume = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const edges = new Map();
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    volume += (verts[a] * (verts[b + 1] * verts[c + 2] - verts[c + 1] * verts[b + 2])
      - verts[b] * (verts[a + 1] * verts[c + 2] - verts[c + 1] * verts[a + 2])
      + verts[c] * (verts[a + 1] * verts[b + 2] - verts[b + 1] * verts[a + 2])) / 6;
    for (const v of [a, b, c]) {
      for (let k = 0; k < 3; k++) {
        if (verts[v + k] < min[k]) min[k] = verts[v + k];
        if (verts[v + k] > max[k]) max[k] = verts[v + k];
      }
    }
    for (const [p, q] of [[t[i], t[i + 1]], [t[i + 1], t[i + 2]], [t[i + 2], t[i]]]) {
      const key = p < q ? p * vertexCount + q : q * vertexCount + p;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  let open = 0;
  for (const count of edges.values()) if (count === 1) open++;
  return { tris: t, cols: shell.cols, volume, min, max, open };
}

function flip(shell) {
  const t = shell.tris;
  for (let i = 0; i < t.length; i += 3) { const tmp = t[i + 1]; t[i + 1] = t[i + 2]; t[i + 2] = tmp; }
  shell.volume = -shell.volume;
}

function contains(outer, inner) {
  for (let k = 0; k < 3; k++) if (inner.min[k] < outer.min[k] - TOUCH || inner.max[k] > outer.max[k] + TOUCH) return false;
  return true;
}

function touches(p, q) {
  for (let k = 0; k < 3; k++) if (p.min[k] - TOUCH > q.max[k] || q.min[k] - TOUCH > p.max[k]) return false;
  return true;
}

function boxDistance(p, q) {
  let d = 0;
  for (let k = 0; k < 3; k++) d += Math.max(0, p.min[k] - q.max[k], q.min[k] - p.max[k]) ** 2;
  return d;
}

// A body's shells → its own compact vertex/triangle arrays.
function compact(body, verts) {
  const remap = new Map();
  const vertices = [];
  const triangles = [];
  const colors = [];
  for (const s of body.shells) {
    for (const col of s.cols) colors.push(col);
    for (const v of s.tris) {
      let id = remap.get(v);
      if (id === undefined) {
        id = vertices.length / 3;
        remap.set(v, id);
        vertices.push(verts[v * 3], verts[v * 3 + 1], verts[v * 3 + 2]);
      }
      triangles.push(id);
    }
  }
  return { vertices: new Float32Array(vertices), triangles, colors };
}

// Stand an upright body (wheel on its edge, arm, face plate) on its flattest
// big side, then ground it with its bounding-box corner at the origin.
function layFlat(body) {
  const v = body.vertices;
  const { min, max } = bounds(v);
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const thin = size[0] <= size[1] ? 0 : 1;
  if (size[2] > STANDING_RATIO * size[thin]) {
    // Which side of the thin axis is flatter? Compare the area of triangles
    // lying in the min plane (facing −axis) vs the max plane (facing +axis).
    const lowArea = planeArea(body, thin, min[thin], -1);
    const highArea = planeArea(body, thin, max[thin], 1);
    const downIsLow = lowArea >= highArea;
    for (let i = 0; i < v.length; i += 3) {
      const z = v[i + 2], s = v[i + thin];
      // Rotate 90° about the other horizontal axis so the chosen side ends
      // up facing −Z (exact sign of the in-plane axis doesn't matter here).
      v[i + 2] = downIsLow ? s : -s;
      v[i + thin] = downIsLow ? -z : z;
    }
    // Swapping two axes with one negation is a proper rotation (det +1),
    // so the winding — and outward normals — stay correct.
  }
  // Long side along X: shelf packing below fills rows far better that way.
  // (x, y) -> (y, -x) is a proper 90° turn about Z, winding unchanged.
  let b = bounds(v);
  if (b.max[1] - b.min[1] > b.max[0] - b.min[0]) {
    for (let i = 0; i < v.length; i += 3) {
      const x = v[i];
      v[i] = v[i + 1];
      v[i + 1] = -x;
    }
    b = bounds(v);
  }
  for (let i = 0; i < v.length; i += 3) {
    v[i] -= b.min[0]; v[i + 1] -= b.min[1]; v[i + 2] -= b.min[2];
  }
  return { ...body, size: { x: b.max[0] - b.min[0], y: b.max[1] - b.min[1] } };
}

function planeArea(body, axis, plane, sign) {
  const v = body.vertices, t = body.triangles;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  let area = 0;
  for (let i = 0; i < t.length; i += 3) {
    a.fromArray(v, t[i] * 3); b.fromArray(v, t[i + 1] * 3); c.fromArray(v, t[i + 2] * 3);
    if (Math.abs(a.getComponent(axis) - plane) > 0.3 || Math.abs(b.getComponent(axis) - plane) > 0.3 || Math.abs(c.getComponent(axis) - plane) > 0.3) continue;
    n.subVectors(b, a).cross(e.subVectors(c, a));
    const len = n.length();
    if (len && n.getComponent(axis) * sign / len > 0.98) area += len / 2;
  }
  return area;
}

function bounds(v) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (v[i + k] < min[k]) min[k] = v[i + k];
      if (v[i + k] > max[k]) max[k] = v[i + k];
    }
  }
  return { min, max };
}

// ---- layout + output ------------------------------------------------------

// Skyline packing across the bed width: biggest footprint first, each body
// goes where its far edge ends up nearest the front (then leftmost), trying
// it both ways round — a body placed turned is rotated 90° about Z for real.
// The cluster is then centred on the bed. Returns each body's corner position
// plus whether everything fits on BED (when it doesn't, the slicer's Arrange
// or printing in batches is the way out; the dialog says so).
function layOut(bodies) {
  const W = BED.x;
  const order = bodies.map((_, i) => i).sort((a, b) =>
    bodies[b].size.x * bodies[b].size.y - bodies[a].size.x * bodies[a].size.y);
  // Skyline: sorted, contiguous segments covering [0, W) with their height.
  let sky = [{ x: 0, w: W, y: 0 }];
  const raw = new Array(bodies.length);
  const turned = new Array(bodies.length).fill(false);

  const restingY = (x, w) => {
    let y = 0;
    for (const seg of sky) {
      if (seg.x >= x + w) break;
      if (seg.x + seg.w > x) y = Math.max(y, seg.y);
    }
    return y;
  };

  for (const i of order) {
    const { size } = bodies[i];
    let best = null;
    for (const turn of [false, true]) {
      const w = (turn ? size.y : size.x) + GAP;
      const h = (turn ? size.x : size.y) + GAP;
      // Candidate x positions: every segment start (and flush right).
      const xs = sky.map((seg) => seg.x).concat([W - w]);
      for (const x of xs) {
        if (x < 0 || x + w > W + 1e-6) continue;
        const y = restingY(x, w);
        const cand = { x, y, w, h, turn, top: y + h };
        if (!best || cand.top < best.top - 1e-6 || (Math.abs(cand.top - best.top) < 1e-6 && cand.x < best.x)) best = cand;
      }
    }
    if (!best) {
      // Wider than the bed either way: park it past the right edge.
      const y = 0;
      best = { x: W + GAP, y, w: size.x + GAP, h: size.y + GAP, turn: false, top: size.y + GAP, outside: true };
    }
    raw[i] = { x: best.x, y: best.y };
    turned[i] = best.turn;
    if (!best.outside) {
      // Raise the skyline under the placed body.
      const next = [];
      for (const seg of sky) {
        const end = seg.x + seg.w;
        if (end <= best.x || seg.x >= best.x + best.w) { next.push(seg); continue; }
        if (seg.x < best.x) next.push({ x: seg.x, w: best.x - seg.x, y: seg.y });
        if (end > best.x + best.w) next.push({ x: best.x + best.w, w: end - best.x - best.w, y: seg.y });
      }
      next.push({ x: best.x, w: best.w, y: best.y + best.h });
      next.sort((p, q) => p.x - q.x);
      // Merge neighbours at the same height.
      sky = next.reduce((acc, seg) => {
        const last = acc[acc.length - 1];
        if (last && Math.abs(last.y - seg.y) < 1e-6 && Math.abs(last.x + last.w - seg.x) < 1e-6) last.w += seg.w;
        else acc.push({ ...seg });
        return acc;
      }, []);
    }
  }

  // Apply the turns: (x, y) -> (y, -x) about Z, then re-ground the corner.
  bodies.forEach((body, i) => {
    if (!turned[i]) return;
    const v = body.vertices;
    for (let k = 0; k < v.length; k += 3) {
      const x = v[k];
      v[k] = v[k + 1];
      v[k + 1] = -x;
    }
    const { min } = bounds(v);
    for (let k = 0; k < v.length; k += 3) { v[k] -= min[0]; v[k + 1] -= min[1]; }
    body.size = { x: body.size.y, y: body.size.x };
  });

  const depth = Math.max(0, ...bodies.map((body, i) => raw[i].y + body.size.y));
  const width = Math.max(0, ...bodies.map((body, i) => raw[i].x + body.size.x));
  const dx = Math.max(0, (BED.x - width) / 2);
  const dy = (BED.y - depth) / 2;
  const placements = raw.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  placements.fitsBed = width <= BED.x + 1e-6 && depth <= BED.y + 1e-6;
  return placements;
}

function objectXml(id, name, { vertices, triangles, colors, slot }, slotOf) {
  const out = [`<object id="${id}" type="model" name="${escapeXml(name)}"><mesh><vertices>`];
  for (let i = 0; i < vertices.length; i += 3) {
    out.push(`<vertex x="${fmt(vertices[i])}" y="${fmt(vertices[i + 1])}" z="${fmt(vertices[i + 2])}"/>`);
  }
  out.push('</vertices><triangles>');
  for (let i = 0; i < triangles.length; i += 3) {
    // Only triangles that differ from the object's own slot need paint.
    const triSlot = slotOf.get(colors[i / 3]);
    const paint = triSlot && triSlot !== slot
      ? ` slic3rpe:mmu_segmentation="${paintCode(triSlot)}" paint_color="${paintCode(triSlot)}"`
      : '';
    out.push(`<triangle v1="${triangles[i]}" v2="${triangles[i + 1]}" v3="${triangles[i + 2]}"${paint}/>`);
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
