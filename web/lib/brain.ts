// A brain-shaped cloud of points for the landing page's hero. The shape is built from a few
// rounded solids (two hemispheres, temporal lobes, cerebellum, stem), not from a 3D model file.
import { RADIUS, random } from "./graph";

const clamp = (x: number, low: number, high: number) => Math.min(Math.max(x, low), high);

/** The smaller of two distances, with the crease between the shapes rounded off by `k`. */
function blend(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Approximate distance to an ellipsoid at the origin: negative inside. */
function ellipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number) {
  const k0 = Math.hypot(x / rx, y / ry, z / rz), k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

/** Distance to the surface of a stylised brain about 2 units long. x runs left to right, y up, z back to front. */
function brain(x: number, y: number, z: number) {
  const side = Math.abs(x) * (1 + 0.2 * Math.max(z, 0)); // both halves match, and the front is narrower
  // One hemisphere, flatter underneath. The two overlap in the middle, which leaves the groove along the top.
  let d = ellipsoid(side - 0.3, y - 0.12, z, 0.4, y > 0.12 ? 0.6 : 0.42, 0.98);
  d = blend(d, ellipsoid(side - 0.4, y + 0.24, z - 0.2, 0.24, 0.22, 0.5), 0.1); // temporal lobe
  d = Math.min(d, ellipsoid(side - 0.2, y + 0.47, z + 0.62, 0.34, 0.21, 0.3)); // cerebellum, with a crease above it
  // The stem: a rod that narrows as it runs down and back.
  const along = clamp(((y + 0.3) * -0.68 + (z + 0.3) * -0.16) / (0.68 * 0.68 + 0.16 * 0.16), 0, 1);
  const stem = Math.hypot(x, y + 0.3 + 0.68 * along, z + 0.3 + 0.16 * along) - (0.15 - 0.06 * along);
  return blend(d, stem, 0.06);
}

/**
 * `count` points spread evenly over the brain's surface, with some inside it for depth.
 * Returns x, y, z per point, scaled so the brain is about 2 * RADIUS long.
 */
export function brainPoints(count: number, seed = 3): Float32Array {
  const rand = random(seed);
  const found: number[] = [];
  for (let tries = 0; found.length < count * 12 && tries < count * 40; tries++) {
    let x = (rand() - 0.5) * 1.7, y = rand() * 1.95 - 1.1, z = (rand() - 0.5) * 2.2;
    if (rand() < 0.15) {
      if (brain(x, y, z) < -0.12) found.push(x, y, z);
      continue;
    }
    for (let step = 0; step < 8; step++) { // walk the point onto the surface
      const d = brain(x, y, z), e = 0.002;
      const gx = (brain(x + e, y, z) - brain(x - e, y, z)) / (2 * e);
      const gy = (brain(x, y + e, z) - brain(x, y - e, z)) / (2 * e);
      const gz = (brain(x, y, z + e) - brain(x, y, z - e)) / (2 * e);
      const g = gx * gx + gy * gy + gz * gz || 1;
      x -= (d * gx) / g; y -= (d * gy) / g; z -= (d * gz) / g;
    }
    if (Math.abs(brain(x, y, z)) < 0.004) found.push(x, y, z);
  }

  // Keep the candidates that are farthest from those already kept, which spaces them evenly.
  const candidates = found.length / 3, kept = Math.min(count, candidates);
  const gap = new Float32Array(candidates).fill(Infinity);
  const out = new Float32Array(kept * 3);
  for (let k = 0, next = 0; k < kept; k++) {
    const px = found[next * 3], py = found[next * 3 + 1], pz = found[next * 3 + 2];
    out.set([px * RADIUS, (py + 0.1) * RADIUS, pz * RADIUS], k * 3);
    let farthest = -1;
    for (let j = 0; j < candidates; j++) {
      const dx = found[j * 3] - px, dy = found[j * 3 + 1] - py, dz = found[j * 3 + 2] - pz;
      gap[j] = Math.min(gap[j], dx * dx + dy * dy + dz * dz);
      if (gap[j] > farthest) { farthest = gap[j]; next = j; }
    }
  }
  return out;
}

/** Links from each point to its `k` nearest neighbours: the mesh of a neural net. */
export function nearestLinks(points: Float32Array, k = 3): [number, number][] {
  const n = points.length / 3;
  const links: [number, number][] = [];
  const seen = new Set<number>();
  const near = new Int32Array(k), nearGap = new Float32Array(k);
  for (let i = 0; i < n; i++) {
    nearGap.fill(Infinity);
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dx = points[j * 3] - points[i * 3], dy = points[j * 3 + 1] - points[i * 3 + 1], dz = points[j * 3 + 2] - points[i * 3 + 2];
      let gap = dx * dx + dy * dy + dz * dz, who = j;
      for (let slot = 0; slot < k; slot++) { // keep the k smallest, in order
        if (gap < nearGap[slot]) {
          [gap, nearGap[slot]] = [nearGap[slot], gap];
          [who, near[slot]] = [near[slot], who];
        }
      }
    }
    for (let slot = 0; slot < k; slot++) {
      if (nearGap[slot] === Infinity) continue;
      const a = Math.min(i, near[slot]), b = Math.max(i, near[slot]);
      if (!seen.has(a * n + b)) {
        seen.add(a * n + b);
        links.push([a, b]);
      }
    }
  }
  return links;
}

/** One layer of the loading screen's drawing: the points and links that appear together. */
export type SketchBand = {
  nodes: { x: number; y: number; r: number; kind: 0 | 1 | 2; alpha: number }[];
  links: { x1: number; y1: number; x2: number; y2: number; alpha: number }[];
};

/**
 * A flat drawing of the brain as the hero first shows it, for the loading screen: a few of its
 * points seen from the same side, each linked to its nearest neighbours. The points are grouped
 * into bands outwards from the middle one, so the drawing can appear band by band as if growing.
 * Sizes are in a box 100 wide; `origin` is the middle point, as percentages of the box.
 */
export function brainSketch(count = 72, bandCount = 8) {
  const cloud = brainPoints(count, 5);
  // The hero's starting pose (graph-canvas.tsx turns the brain by these angles), with a little perspective.
  const yaw = -Math.PI / 2 + 0.4, pitch = 0.1, eye = RADIUS * 2.9;
  const flat: { x: number; y: number; near: number }[] = [];
  for (let i = 0; i < cloud.length / 3; i++) {
    const x = cloud[i * 3], y = cloud[i * 3 + 1], z = cloud[i * 3 + 2];
    const x1 = x * Math.cos(yaw) + z * Math.sin(yaw), z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
    const y1 = y * Math.cos(pitch) - z1 * Math.sin(pitch), near = y * Math.sin(pitch) + z1 * Math.cos(pitch);
    const grow = eye / (eye - near);
    flat.push({ x: x1 * grow, y: -y1 * grow, near });
  }
  const span = (pick: (p: { x: number; y: number; near: number }) => number) => {
    const values = flat.map(pick);
    return [Math.min(...values), Math.max(...values)];
  };
  const [left, right] = span((p) => p.x), [top, bottom] = span((p) => p.y), [back, front] = span((p) => p.near);
  const unit = 100 / (right - left), round = (v: number) => Math.round(v * 100) / 100;
  const height = round((bottom - top) * unit);
  const at = flat.map((p) => ({ x: round((p.x - left) * unit), y: round((p.y - top) * unit), near: (p.near - back) / (front - back) }));

  // Bands of equal size, by distance from the point nearest the middle of the drawing.
  const gap = (p: { x: number; y: number }, x: number, y: number) => (p.x - x) ** 2 + (p.y - y) ** 2;
  const seed = at.reduce((best, p) => (gap(p, 50, height / 2) < gap(best, 50, height / 2) ? p : best));
  const order = at.map((_, i) => i).sort((a, b) => gap(at[a], seed.x, seed.y) - gap(at[b], seed.x, seed.y));
  const bandOf = new Array<number>(at.length);
  order.forEach((i, rank) => { bandOf[i] = Math.floor((rank * bandCount) / at.length); });

  const bands: SketchBand[] = Array.from({ length: bandCount }, () => ({ nodes: [], links: [] }));
  // Points nearer the viewer are larger and clearer, which is what gives the flat drawing its depth.
  at.forEach((p, i) => bands[bandOf[i]].nodes.push({ x: p.x, y: p.y, r: round(0.55 + 0.65 * p.near), kind: ([0, 0, 1, 0, 2] as const)[i % 5], alpha: round(0.4 + 0.6 * p.near) }));
  for (const [a, b] of nearestLinks(cloud, 2)) {
    // A link appears with the later of its two ends.
    bands[Math.max(bandOf[a], bandOf[b])].links.push({ x1: at[a].x, y1: at[a].y, x2: at[b].x, y2: at[b].y, alpha: round(0.14 + 0.3 * ((at[a].near + at[b].near) / 2)) });
  }
  return { width: 100, height, origin: { x: seed.x, y: round((seed.y / height) * 100) }, bands };
}
