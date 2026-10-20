// Print files for slicers and STL downloads. Many customizer models combine
// several separately printed bodies in one file (both wheels, left + right
// arm, a light top + its diffuser, a hat + its brim…) because that's how they
// look assembled. For printing, every body is split out, laid flat if it
// stands on an edge, and placed apart on the bed:
//   buildPrint3mf  → one 3MF, each body its own named object (slicer upload)
//   buildPrintStl  → one STL with the bodies spread out (downloads)
// Sources are Z-up triangle soups (positions, 9 floats per triangle) — from a
// hosted STL or the scene mesh, see getPartPrintPositions() in app.js.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// The customizer is Y-up; slicers (and 3MF/STL) are Z-up. +90° about X maps
// (x, y, z) -> (x, -z, y), so a part's top stays its top on the bed.
const Y_UP_TO_Z_UP = new THREE.Matrix4().makeRotationX(Math.PI / 2);

// Layout target: the bed centre of Prusa's MK3/MK4 (250 × 210 mm). Other
// printers still get every body in one tidy cluster; Arrange (A) in the
// slicer re-centres it for any bed.
const BED_CENTER = { x: 125, y: 105 };
const ROW_WIDTH = 220;
const GAP = 6;
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

// pieces: [{ name, positions }]. Resolves to { blob: 'model/3mf', count }.
export async function buildPrint3mf(pieces, { title = 'HP Robot' } = {}) {
  const bodies = splitPieces(pieces);
  const placements = layOut(bodies);
  const objectsXml = [];
  const itemsXml = [];
  bodies.forEach((body, i) => {
    const id = i + 1;
    objectsXml.push(objectXml(id, body));
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
  return { blob: new Blob([blob], { type: 'model/3mf' }), count: bodies.length };
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

// Visible meshes under a scene object, as one Z-up triangle soup.
export function positionsFromObject(object) {
  // Measure at full size even if the part's swap-in "pop" animation is still
  // scaling its root up from small.
  const liveScale = object.scale.clone();
  object.scale.setScalar(1);
  object.updateWorldMatrix(true, true);
  const chunks = [];
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
  });
  object.scale.copy(liveScale);
  object.updateWorldMatrix(true, true);
  return concat(chunks);
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
  for (const { name, positions } of pieces) {
    const parts = splitBodies(positions);
    parts.forEach((body, i) => {
      body.name = parts.length > 1 ? `${name} (${i + 1}/${parts.length})` : name;
      bodies.push(body);
    });
  }
  if (!bodies.length) throw new Error('Nothing printable is visible.');
  return bodies;
}

// Triangle soup → separate printable bodies, each laid flat and grounded.
function splitBodies(positions) {
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
    const ra = find(a);
    parent[find(b)] = ra;
    parent[find(c)] = ra;
  }

  const shellsByRoot = new Map();
  for (let i = 0; i < tris.length; i += 3) {
    const root = find(tris[i]);
    let shell = shellsByRoot.get(root);
    if (!shell) shellsByRoot.set(root, shell = { tris: [] });
    shell.tris.push(tris[i], tris[i + 1], tris[i + 2]);
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
  return { tris: t, volume, min, max, open };
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
  for (const s of body.shells) {
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
  return { vertices: new Float32Array(vertices), triangles };
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
  const b = bounds(v);
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

// Simple shelf packing, deepest footprint first, then the whole cluster is
// centred on BED_CENTER. Returns the bed position of each body's corner.
function layOut(bodies) {
  const order = bodies.map((_, i) => i).sort((a, b) => bodies[b].size.y - bodies[a].size.y);
  const raw = new Array(bodies.length);
  let x = 0, y = 0, rowDepth = 0, width = 0;
  for (const i of order) {
    const { size } = bodies[i];
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
