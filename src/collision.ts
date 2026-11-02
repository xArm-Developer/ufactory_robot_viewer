import { Matrix4, Object3D, Vector3 } from 'three';

export type CollisionBodyId =
  | `arm:${string}`
  | 'sensor:ai1500'
  | 'gripper:base'
  | 'gripper:left'
  | 'gripper:right'
  | 'rail:fixed'
  | 'rail:carriage'
  | 'rail:drag_chain';

export interface CollisionHullEntry {
  bodyKey: string;
  partKey?: string;
  kind: 'polytope' | 'box';
  vertices?: number[];
  center?: [number, number, number];
  halfExtents?: [number, number, number];
}

export interface CollisionAssetManifest {
  schemaVersion: 1;
  assetId: string;
  hulls: CollisionHullEntry[];
}

export interface CollisionPair {
  first: CollisionBodyId;
  second: CollisionBodyId;
}

export interface ExclusionOptions {
  armDof: number;
  hasSensor: boolean;
}

/** Default penetration depth threshold (0.2 mm) to filter numerical grazing. */
export const DEFAULT_PENETRATION_TOLERANCE_M = 0.0002;

// AL0700 drag chain constants in untransformed CAD metres (matching src/rail-drag-chain.ts).
const DRAG_CHAIN_MIN_X = -0.16124;
const DRAG_CHAIN_MAX_X = -0.12124;
const DRAG_CHAIN_MIN_Y = -0.027;
const DRAG_CHAIN_MAX_Y = 0.048;
const DRAG_CHAIN_BEND_CENTER_Y = 0.0104962;
const DRAG_CHAIN_BEND_END_Z = 0.12437742;
const DRAG_CHAIN_END_Z = 0.32142;
const DRAG_CHAIN_ZERO_EXTENSION = 0.220;

export interface ConvexShape {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  readonly worldCenter: Vector3;
  updateWorldTransform(matrixWorld: Matrix4): void;
  support(worldDir: Vector3, out: Vector3): Vector3;
}

export class BoxShape implements ConvexShape {
  minX = 0;
  minY = 0;
  minZ = 0;
  maxX = 0;
  maxY = 0;
  maxZ = 0;
  readonly worldCenter = new Vector3();
  private readonly matrix = new Matrix4();
  private cx: number;
  private cy: number;
  private cz: number;
  private hx: number;
  private hy: number;
  private hz: number;

  constructor(center: readonly [number, number, number], halfExtents: readonly [number, number, number]) {
    [this.cx, this.cy, this.cz] = center;
    [this.hx, this.hy, this.hz] = halfExtents;
  }

  setLocalBox(
    cx: number,
    cy: number,
    cz: number,
    hx: number,
    hy: number,
    hz: number,
  ): void {
    this.cx = cx;
    this.cy = cy;
    this.cz = cz;
    this.hx = Math.max(0, hx);
    this.hy = Math.max(0, hy);
    this.hz = Math.max(0, hz);
  }

  updateWorldTransform(matrixWorld: Matrix4): void {
    this.matrix.copy(matrixWorld);
    const e = this.matrix.elements;
    const wcx = e[0] * this.cx + e[4] * this.cy + e[8] * this.cz + e[12];
    const wcy = e[1] * this.cx + e[5] * this.cy + e[9] * this.cz + e[13];
    const wcz = e[2] * this.cx + e[6] * this.cy + e[10] * this.cz + e[14];
    this.worldCenter.set(wcx, wcy, wcz);

    const whx = Math.abs(e[0]) * this.hx + Math.abs(e[4]) * this.hy + Math.abs(e[8]) * this.hz;
    const why = Math.abs(e[1]) * this.hx + Math.abs(e[5]) * this.hy + Math.abs(e[9]) * this.hz;
    const whz = Math.abs(e[2]) * this.hx + Math.abs(e[6]) * this.hy + Math.abs(e[10]) * this.hz;

    this.minX = wcx - whx;
    this.maxX = wcx + whx;
    this.minY = wcy - why;
    this.maxY = wcy + why;
    this.minZ = wcz - whz;
    this.maxZ = wcz + whz;
  }

  support(worldDir: Vector3, out: Vector3): Vector3 {
    const e = this.matrix.elements;
    const dlx = e[0] * worldDir.x + e[1] * worldDir.y + e[2] * worldDir.z;
    const dly = e[4] * worldDir.x + e[5] * worldDir.y + e[6] * worldDir.z;
    const dlz = e[8] * worldDir.x + e[9] * worldDir.y + e[10] * worldDir.z;

    const px = this.cx + (dlx >= 0 ? this.hx : -this.hx);
    const py = this.cy + (dly >= 0 ? this.hy : -this.hy);
    const pz = this.cz + (dlz >= 0 ? this.hz : -this.hz);

    return out.set(
      e[0] * px + e[4] * py + e[8] * pz + e[12],
      e[1] * px + e[5] * py + e[9] * pz + e[13],
      e[2] * px + e[6] * py + e[10] * pz + e[14],
    );
  }
}

export class PolytopeShape implements ConvexShape {
  minX = 0;
  minY = 0;
  minZ = 0;
  maxX = 0;
  maxY = 0;
  maxZ = 0;
  readonly worldCenter = new Vector3();
  readonly vertices: Float32Array;
  private readonly matrix = new Matrix4();
  private readonly lcx: number;
  private readonly lcy: number;
  private readonly lcz: number;
  private readonly lhx: number;
  private readonly lhy: number;
  private readonly lhz: number;
  private ox = 0;
  private oy = 0;
  private oz = 0;

  constructor(coords: ArrayLike<number>) {
    if (coords.length < 12 || coords.length % 3 !== 0) {
      throw new Error(`Invalid polytope vertex buffer length: ${coords.length}`);
    }
    this.vertices = coords instanceof Float32Array ? coords : Float32Array.from(coords);
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < this.vertices.length; i += 3) {
      const x = this.vertices[i];
      const y = this.vertices[i + 1];
      const z = this.vertices[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new Error('Polytope contains non-finite vertex coordinate');
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    this.lcx = 0.5 * (minX + maxX);
    this.lcy = 0.5 * (minY + maxY);
    this.lcz = 0.5 * (minZ + maxZ);
    this.lhx = 0.5 * (maxX - minX);
    this.lhy = 0.5 * (maxY - minY);
    this.lhz = 0.5 * (maxZ - minZ);
  }

  setLocalOffset(ox: number, oy: number, oz: number): void {
    this.ox = ox;
    this.oy = oy;
    this.oz = oz;
  }

  updateWorldTransform(matrixWorld: Matrix4): void {
    this.matrix.copy(matrixWorld);
    const e = this.matrix.elements;
    const cx = this.lcx + this.ox;
    const cy = this.lcy + this.oy;
    const cz = this.lcz + this.oz;
    const wcx = e[0] * cx + e[4] * cy + e[8] * cz + e[12];
    const wcy = e[1] * cx + e[5] * cy + e[9] * cz + e[13];
    const wcz = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
    this.worldCenter.set(wcx, wcy, wcz);

    const whx = Math.abs(e[0]) * this.lhx + Math.abs(e[4]) * this.lhy + Math.abs(e[8]) * this.lhz;
    const why = Math.abs(e[1]) * this.lhx + Math.abs(e[5]) * this.lhy + Math.abs(e[9]) * this.lhz;
    const whz = Math.abs(e[2]) * this.lhx + Math.abs(e[6]) * this.lhy + Math.abs(e[10]) * this.lhz;

    this.minX = wcx - whx;
    this.maxX = wcx + whx;
    this.minY = wcy - why;
    this.maxY = wcy + why;
    this.minZ = wcz - whz;
    this.maxZ = wcz + whz;
  }

  support(worldDir: Vector3, out: Vector3): Vector3 {
    const e = this.matrix.elements;
    const dlx = e[0] * worldDir.x + e[1] * worldDir.y + e[2] * worldDir.z;
    const dly = e[4] * worldDir.x + e[5] * worldDir.y + e[6] * worldDir.z;
    const dlz = e[8] * worldDir.x + e[9] * worldDir.y + e[10] * worldDir.z;

    const verts = this.vertices;
    let bestIdx = 0;
    let bestDot = verts[0] * dlx + verts[1] * dly + verts[2] * dlz;
    for (let i = 3; i < verts.length; i += 3) {
      const dot = verts[i] * dlx + verts[i + 1] * dly + verts[i + 2] * dlz;
      if (dot > bestDot) {
        bestDot = dot;
        bestIdx = i;
      }
    }

    const px = verts[bestIdx] + this.ox;
    const py = verts[bestIdx + 1] + this.oy;
    const pz = verts[bestIdx + 2] + this.oz;

    return out.set(
      e[0] * px + e[4] * py + e[8] * pz + e[12],
      e[1] * px + e[5] * py + e[9] * pz + e[13],
      e[2] * px + e[6] * py + e[10] * pz + e[14],
    );
  }
}

export function createShapeFromEntry(entry: CollisionHullEntry): ConvexShape {
  if (entry.kind === 'box') {
    if (!entry.center || !entry.halfExtents) {
      throw new Error(`Box hull entry "${entry.bodyKey}" is missing center or halfExtents`);
    }
    return new BoxShape(entry.center, entry.halfExtents);
  }
  if (!entry.vertices) {
    throw new Error(`Polytope hull entry "${entry.bodyKey}" is missing vertices`);
  }
  return new PolytopeShape(entry.vertices);
}

export function aabbOverlaps(a: ConvexShape, b: ConvexShape, pad = 0): boolean {
  return (
    a.minX - pad <= b.maxX &&
    a.maxX + pad >= b.minX &&
    a.minY - pad <= b.maxY &&
    a.maxY + pad >= b.minY &&
    a.minZ - pad <= b.maxZ &&
    a.maxZ + pad >= b.minZ
  );
}

const _supA = new Vector3();
const _supB = new Vector3();
const _negDir = new Vector3();

function minkowskiSupport(a: ConvexShape, b: ConvexShape, dir: Vector3, out: Vector3): Vector3 {
  a.support(dir, _supA);
  _negDir.set(-dir.x, -dir.y, -dir.z);
  b.support(_negDir, _supB);
  return out.subVectors(_supA, _supB);
}

interface TriangleClosest {
  point: Vector3;
  mask: number; // bitmask of active vertices among (0 -> 1, 1 -> 2, 2 -> 4)
}

function closestOriginToSegment(a: Vector3, b: Vector3, out: Vector3): { point: Vector3; mask: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const denom = abx * abx + aby * aby + abz * abz;
  if (denom <= 1e-16) {
    return { point: out.copy(a), mask: 1 };
  }
  const t = -(a.x * abx + a.y * aby + a.z * abz) / denom;
  if (t <= 0) return { point: out.copy(a), mask: 1 };
  if (t >= 1) return { point: out.copy(b), mask: 2 };
  return {
    point: out.set(a.x + t * abx, a.y + t * aby, a.z + t * abz),
    mask: 3,
  };
}

/** Exact Voronoi closest point on triangle ABC to the origin (Ericson RTCD 5.1.5). */
function closestOriginToTriangle(a: Vector3, b: Vector3, c: Vector3, out: Vector3): TriangleClosest {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const acz = c.z - a.z;

  // Vertex region outside A
  const d1 = -(abx * a.x + aby * a.y + abz * a.z);
  const d2 = -(acx * a.x + acy * a.y + acz * a.z);
  if (d1 <= 0 && d2 <= 0) {
    return { point: out.copy(a), mask: 1 };
  }

  // Vertex region outside B
  const d3 = -(abx * b.x + aby * b.y + abz * b.z);
  const d4 = -(acx * b.x + acy * b.y + acz * b.z);
  if (d3 >= 0 && d4 <= d3) {
    return { point: out.copy(b), mask: 2 };
  }

  // Edge region AB
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return { point: out.set(a.x + v * abx, a.y + v * aby, a.z + v * abz), mask: 3 };
  }

  // Vertex region outside C
  const d5 = -(abx * c.x + aby * c.y + abz * c.z);
  const d6 = -(acx * c.x + acy * c.y + acz * c.z);
  if (d6 >= 0 && d5 <= d6) {
    return { point: out.copy(c), mask: 4 };
  }

  // Edge region AC
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return { point: out.set(a.x + w * acx, a.y + w * acy, a.z + w * acz), mask: 5 };
  }

  // Edge region BC
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return {
      point: out.set(b.x + w * (c.x - b.x), b.y + w * (c.y - b.y), b.z + w * (c.z - b.z)),
      mask: 6,
    };
  }

  // Degenerate collinear triangle fallback
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  if (nx * nx + ny * ny + nz * nz <= 1e-20) {
    const abRes = closestOriginToSegment(a, b, new Vector3());
    const acRes = closestOriginToSegment(a, c, new Vector3());
    if (abRes.point.lengthSq() <= acRes.point.lengthSq()) {
      return { point: out.copy(abRes.point), mask: abRes.mask };
    }
    return { point: out.copy(acRes.point), mask: (acRes.mask & 1) | ((acRes.mask & 2) << 1) };
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return {
    point: out.set(a.x + abx * v + acx * w, a.y + aby * v + acy * w, a.z + abz * v + acz * w),
    mask: 7,
  };
}

function reduceSimplex(simplex: Vector3[], outClosest: Vector3): boolean {
  const n = simplex.length;
  if (n === 1) {
    outClosest.copy(simplex[0]);
    return outClosest.lengthSq() <= 1e-16;
  }
  if (n === 2) {
    const res = closestOriginToSegment(simplex[0], simplex[1], outClosest);
    if (res.mask === 1) simplex.splice(1, 1);
    else if (res.mask === 2) {
      simplex[0].copy(simplex[1]);
      simplex.splice(1, 1);
    }
    return outClosest.lengthSq() <= 1e-16;
  }
  if (n === 3) {
    const [a, b, c] = simplex;
    const res = closestOriginToTriangle(a, b, c, outClosest);
    const kept: Vector3[] = [];
    if (res.mask & 1) kept.push(a.clone());
    if (res.mask & 2) kept.push(b.clone());
    if (res.mask & 4) kept.push(c.clone());
    simplex.length = 0;
    simplex.push(...kept);
    return outClosest.lengthSq() <= 1e-16;
  }

  // n === 4: tetrahedron ABCD
  const [a, b, c, d] = simplex;
  const faces: [number, number, number, number][] = [
    [0, 1, 2, 3],
    [0, 2, 3, 1],
    [0, 3, 1, 2],
    [1, 3, 2, 0],
  ];
  const pts = [a, b, c, d];
  let bestDistSq = Infinity;
  let bestPoint: Vector3 | null = null;
  let bestKeep: Vector3[] | null = null;
  let outsideAny = false;

  const ab = new Vector3();
  const ac = new Vector3();
  const normal = new Vector3();
  const toOpp = new Vector3();
  const candidate = new Vector3();

  for (const [i0, i1, i2, iOpp] of faces) {
    const p0 = pts[i0];
    const p1 = pts[i1];
    const p2 = pts[i2];
    const pOpp = pts[iOpp];
    ab.subVectors(p1, p0);
    ac.subVectors(p2, p0);
    normal.crossVectors(ab, ac);
    if (normal.lengthSq() <= 1e-20) {
      outsideAny = true;
    } else {
      toOpp.subVectors(pOpp, p0);
      const oppSide = normal.dot(toOpp);
      const originSide = -normal.dot(p0);
      // Origin is on or outside this face only when originSide and oppSide do not share the same strict sign.
      if (
        (originSide <= 0 && oppSide > 0) ||
        (originSide >= 0 && oppSide < 0) ||
        Math.abs(oppSide) <= 1e-30
      ) {
        outsideAny = true;
      } else {
        continue;
      }
    }
    const tri = closestOriginToTriangle(p0, p1, p2, candidate);
    const distSq = tri.point.lengthSq();
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestPoint = tri.point.clone();
      const keep: Vector3[] = [];
      if (tri.mask & 1) keep.push(p0.clone());
      if (tri.mask & 2) keep.push(p1.clone());
      if (tri.mask & 4) keep.push(p2.clone());
      bestKeep = keep;
    }
  }

  if (!outsideAny || !bestPoint || !bestKeep) {
    outClosest.set(0, 0, 0);
    return true;
  }

  simplex.length = 0;
  simplex.push(...bestKeep);
  outClosest.copy(bestPoint);
  return bestDistSq <= 1e-16;
}

const CANONICAL_AXES: readonly Vector3[] = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
  new Vector3(0.57735027, 0.57735027, 0.57735027),
  new Vector3(-0.57735027, 0.57735027, -0.57735027),
  new Vector3(0.57735027, -0.57735027, -0.57735027),
  new Vector3(-0.57735027, -0.57735027, 0.57735027),
];

interface EpaFace {
  a: number;
  b: number;
  c: number;
  normal: Vector3;
  distance: number;
}

function makeEpaFace(verts: Vector3[], a: number, b: number, c: number, interior: Vector3): EpaFace | null {
  const pa = verts[a];
  const pb = verts[b];
  const pc = verts[c];
  const ab = new Vector3().subVectors(pb, pa);
  const ac = new Vector3().subVectors(pc, pa);
  const normal = new Vector3().crossVectors(ab, ac);
  const len = normal.length();
  if (len <= 1e-16) return null;
  normal.multiplyScalar(1 / len);
  // Ensure normal points outward from the polytope interior
  if (normal.dot(pa) - normal.dot(interior) < 0) {
    normal.negate();
    const tmp = b;
    b = c;
    c = tmp;
  }
  const distance = normal.dot(pa);
  return { a, b, c, normal, distance };
}

function originInsideTet(t: readonly [Vector3, Vector3, Vector3, Vector3]): boolean {
  const faces: [number, number, number, number][] = [
    [0, 1, 2, 3],
    [0, 2, 3, 1],
    [0, 3, 1, 2],
    [1, 3, 2, 0],
  ];
  const ab = new Vector3();
  const ac = new Vector3();
  const n = new Vector3();
  const opp = new Vector3();
  for (const [i0, i1, i2, iOpp] of faces) {
    ab.subVectors(t[i1], t[i0]);
    ac.subVectors(t[i2], t[i0]);
    n.crossVectors(ab, ac);
    opp.subVectors(t[iOpp], t[i0]);
    const oppSide = n.dot(opp);
    const origSide = -n.dot(t[i0]);
    if (Math.abs(oppSide) <= 1e-24) return false;
    if ((origSide < -1e-18 && oppSide > 0) || (origSide > 1e-18 && oppSide < 0)) {
      return false;
    }
  }
  return true;
}

/**
 * Verify whether an intersecting pair penetrates deeper than `penetrationTolerance` (in metres).
 * Uses early-exit upper bounds h_M(u) >= delta(A, B) before and during EPA expansion.
 */
function penetratesBeyondTolerance(
  shapeA: ConvexShape,
  shapeB: ConvexShape,
  initialSimplex: Vector3[],
  penetrationTolerance: number,
): boolean {
  if (penetrationTolerance <= 0) return true;

  // Quick directional upper-bound probes: for any unit vector u, delta(A,B) <= h_{A-B}(u).
  const probePoint = new Vector3();
  const seeds: Vector3[] = initialSimplex.map(p => p.clone());

  for (const axis of CANONICAL_AXES) {
    minkowskiSupport(shapeA, shapeB, axis, probePoint);
    if (probePoint.dot(axis) <= penetrationTolerance) {
      return false;
    }
    if (seeds.length < 14 && !seeds.some(s => s.distanceToSquared(probePoint) <= 1e-16)) {
      seeds.push(probePoint.clone());
    }
  }

  // Prefer an origin-enclosing non-coplanar tetrahedron from seeds (starting with initialSimplex).
  let tet: [Vector3, Vector3, Vector3, Vector3] | null = null;
  let fallbackTet: [Vector3, Vector3, Vector3, Vector3] | null = null;
  const u = new Vector3();
  const v = new Vector3();
  const w = new Vector3();
  const cross = new Vector3();
  outer: for (let i = 0; i < seeds.length; i++) {
    for (let j = i + 1; j < seeds.length; j++) {
      u.subVectors(seeds[j], seeds[i]);
      if (u.lengthSq() <= 1e-16) continue;
      for (let k = j + 1; k < seeds.length; k++) {
        v.subVectors(seeds[k], seeds[i]);
        cross.crossVectors(u, v);
        if (cross.lengthSq() <= 1e-20) continue;
        for (let m = k + 1; m < seeds.length; m++) {
          w.subVectors(seeds[m], seeds[i]);
          if (Math.abs(cross.dot(w)) > 1e-18) {
            const cand: [Vector3, Vector3, Vector3, Vector3] = [
              seeds[i].clone(),
              seeds[j].clone(),
              seeds[k].clone(),
              seeds[m].clone(),
            ];
            if (!fallbackTet) fallbackTet = cand;
            if (originInsideTet(cand)) {
              tet = cand;
              break outer;
            }
          }
        }
      }
    }
  }

  if (!tet) {
    tet = fallbackTet;
  }
  if (!tet) {
    return false;
  }

  // Check if origin lies inside `tet`; if not, run GJK refinement from `tet` or conservatively expand.
  const verts: Vector3[] = [...tet];
  const interior = new Vector3()
    .add(verts[0])
    .add(verts[1])
    .add(verts[2])
    .add(verts[3])
    .multiplyScalar(0.25);

  const faces: EpaFace[] = [];
  const rawTris: [number, number, number][] = [
    [0, 1, 2],
    [0, 2, 3],
    [0, 3, 1],
    [1, 3, 2],
  ];
  for (const [ia, ib, ic] of rawTris) {
    const f = makeEpaFace(verts, ia, ib, ic, interior);
    if (f) faces.push(f);
  }
  if (faces.length < 4) return false;

  const MAX_EPA_ITERS = 48;
  for (let iter = 0; iter < MAX_EPA_ITERS; iter++) {
    let bestIdx = 0;
    let bestDist = faces[0].distance;
    for (let i = 1; i < faces.length; i++) {
      if (faces[i].distance < bestDist) {
        bestDist = faces[i].distance;
        bestIdx = i;
      }
    }
    const closestFace = faces[bestIdx];
    const sup = minkowskiSupport(shapeA, shapeB, closestFace.normal, new Vector3());
    const supportDist = sup.dot(closestFace.normal);

    // Exact mathematical upper bound: true penetration depth <= supportDist!
    if (supportDist <= penetrationTolerance) {
      return false;
    }

    // Converged to the closest Minkowski boundary face
    if (supportDist - closestFace.distance <= 1e-5) {
      return Math.min(supportDist, closestFace.distance) > penetrationTolerance;
    }

    if (verts.some(existing => existing.distanceToSquared(sup) <= 1e-12)) {
      return Math.min(supportDist, closestFace.distance) > penetrationTolerance;
    }

    const newIdx = verts.length;
    verts.push(sup);

    // Remove all faces visible from `sup` and stitch horizon edges
    const edgeCounts = new Map<string, [number, number, number]>();
    const addHorizonEdge = (uIdx: number, vIdx: number) => {
      const revKey = `${vIdx}:${uIdx}`;
      if (edgeCounts.has(revKey)) {
        edgeCounts.delete(revKey);
      } else {
        edgeCounts.set(`${uIdx}:${vIdx}`, [uIdx, vIdx, 1]);
      }
    };

    const remaining: EpaFace[] = [];
    for (const face of faces) {
      if (face.normal.dot(sup) - face.normal.dot(verts[face.a]) > 1e-9) {
        addHorizonEdge(face.a, face.b);
        addHorizonEdge(face.b, face.c);
        addHorizonEdge(face.c, face.a);
      } else {
        remaining.push(face);
      }
    }

    faces.length = 0;
    faces.push(...remaining);
    for (const [ea, eb] of edgeCounts.values()) {
      const nf = makeEpaFace(verts, ea, eb, newIdx, interior);
      if (nf) faces.push(nf);
    }
    if (faces.length === 0) {
      return supportDist > penetrationTolerance;
    }
  }

  let minFaceDist = Infinity;
  for (const face of faces) {
    if (face.distance < minFaceDist) minFaceDist = face.distance;
  }
  return minFaceDist > penetrationTolerance;
}

/**
 * 3D GJK + early-exit EPA intersection test.
 * Returns true iff `shapeA` and `shapeB` penetrate deeper than `penetrationTolerance` (default 0.2 mm).
 */
export function intersectsGJK(
  shapeA: ConvexShape,
  shapeB: ConvexShape,
  penetrationTolerance = DEFAULT_PENETRATION_TOLERANCE_M,
): boolean {
  const dir = new Vector3().subVectors(shapeB.worldCenter, shapeA.worldCenter);
  if (dir.lengthSq() <= 1e-14) {
    dir.set(1, 0, 0);
  }

  const first = minkowskiSupport(shapeA, shapeB, dir, new Vector3());
  if (first.dot(dir) <= 0) {
    return false;
  }

  const simplex: Vector3[] = [first];
  const closest = new Vector3().copy(first);
  dir.copy(first).negate();

  const MAX_GJK_ITERS = 64;
  for (let iter = 0; iter < MAX_GJK_ITERS; iter++) {
    const dirLenSq = dir.lengthSq();
    if (dirLenSq <= 1e-16) {
      return penetratesBeyondTolerance(shapeA, shapeB, simplex, penetrationTolerance);
    }

    const candidate = minkowskiSupport(shapeA, shapeB, dir, new Vector3());
    const dirLen = Math.sqrt(dirLenSq);
    // Separating plane check: even reaching the origin requires support >= 0;
    // penetrating > penetrationTolerance requires support > penetrationTolerance * ||dir||!
    if (candidate.dot(dir) <= penetrationTolerance * dirLen) {
      return false;
    }

    if (simplex.some(pt => pt.distanceToSquared(candidate) <= 1e-14)) {
      return false;
    }

    simplex.unshift(candidate);
    const containsOrigin = reduceSimplex(simplex, closest);
    if (containsOrigin) {
      return penetratesBeyondTolerance(shapeA, shapeB, simplex, penetrationTolerance);
    }
    dir.copy(closest).negate();
  }

  return false;
}

/** Three-part O(1) parametric collider for the deforming AL0700 drag chain (`part_35`). */
export class DragChainCollider {
  readonly lowerStraight: BoxShape;
  readonly upperStraight: BoxShape;
  readonly bend: ConvexShape;
  readonly shapes: readonly ConvexShape[];

  constructor(bendShape?: ConvexShape) {
    const cx = 0.5 * (DRAG_CHAIN_MIN_X + DRAG_CHAIN_MAX_X);
    const hx = 0.5 * (DRAG_CHAIN_MAX_X - DRAG_CHAIN_MIN_X);
    const lowerCy = 0.5 * (DRAG_CHAIN_MIN_Y + DRAG_CHAIN_BEND_CENTER_Y);
    const lowerHy = 0.5 * (DRAG_CHAIN_BEND_CENTER_Y - DRAG_CHAIN_MIN_Y);
    const upperCy = 0.5 * (DRAG_CHAIN_BEND_CENTER_Y + DRAG_CHAIN_MAX_Y);
    const upperHy = 0.5 * (DRAG_CHAIN_MAX_Y - DRAG_CHAIN_BEND_CENTER_Y);

    this.lowerStraight = new BoxShape([cx, lowerCy, 0.11], [hx, lowerHy, 0.21]);
    this.upperStraight = new BoxShape([cx, upperCy, 0.11], [hx, upperHy, 0.21]);
    this.bend =
      bendShape ??
      new BoxShape(
        [cx, 0.5 * (DRAG_CHAIN_MIN_Y + DRAG_CHAIN_MAX_Y), 0.5 * (0.08688 + DRAG_CHAIN_BEND_END_Z)],
        [hx, 0.5 * (DRAG_CHAIN_MAX_Y - DRAG_CHAIN_MIN_Y), 0.5 * (DRAG_CHAIN_BEND_END_Z - 0.08688)],
      );
    this.shapes = [this.lowerStraight, this.upperStraight, this.bend];
    this.setPosition(0);
  }

  setPosition(railMm: number): void {
    const travel = railMm / 1000;
    const bendOffset = -DRAG_CHAIN_ZERO_EXTENSION - 0.5 * travel;
    const bendJoinZ = DRAG_CHAIN_BEND_END_Z + bendOffset;

    const cx = 0.5 * (DRAG_CHAIN_MIN_X + DRAG_CHAIN_MAX_X);
    const hx = 0.5 * (DRAG_CHAIN_MAX_X - DRAG_CHAIN_MIN_X);

    const lowerCy = 0.5 * (DRAG_CHAIN_MIN_Y + DRAG_CHAIN_BEND_CENTER_Y);
    const lowerHy = 0.5 * (DRAG_CHAIN_BEND_CENTER_Y - DRAG_CHAIN_MIN_Y);
    const lowerMaxZ = DRAG_CHAIN_END_Z;
    this.lowerStraight.setLocalBox(
      cx,
      lowerCy,
      0.5 * (bendJoinZ + lowerMaxZ),
      hx,
      lowerHy,
      0.5 * (lowerMaxZ - bendJoinZ),
    );

    const upperCy = 0.5 * (DRAG_CHAIN_BEND_CENTER_Y + DRAG_CHAIN_MAX_Y);
    const upperHy = 0.5 * (DRAG_CHAIN_MAX_Y - DRAG_CHAIN_BEND_CENTER_Y);
    const upperMaxZ = DRAG_CHAIN_END_Z - travel;
    this.upperStraight.setLocalBox(
      cx,
      upperCy,
      0.5 * (bendJoinZ + upperMaxZ),
      hx,
      upperHy,
      0.5 * (upperMaxZ - bendJoinZ),
    );

    if (this.bend instanceof PolytopeShape) {
      this.bend.setLocalOffset(0, 0, bendOffset);
    } else if (this.bend instanceof BoxShape) {
      const origMinZ = 0.08688;
      const origMaxZ = DRAG_CHAIN_BEND_END_Z;
      this.bend.setLocalBox(
        cx,
        0.5 * (DRAG_CHAIN_MIN_Y + DRAG_CHAIN_MAX_Y),
        0.5 * (origMinZ + origMaxZ) + bendOffset,
        hx,
        0.5 * (DRAG_CHAIN_MAX_Y - DRAG_CHAIN_MIN_Y),
        0.5 * (origMaxZ - origMinZ),
      );
    }
  }
}

export function shouldExcludeCollisionPair(
  a: CollisionBodyId,
  b: CollisionBodyId,
  options: ExclusionOptions,
): boolean {
  if (a === b) return true;
  if (a.startsWith('gripper:') && b.startsWith('gripper:')) return true;
  if (a.startsWith('rail:') && b.startsWith('rail:')) return true;

  const pairMatches = (x: CollisionBodyId, y: CollisionBodyId) => (a === x && b === y) || (a === y && b === x);

  if (pairMatches('rail:carriage', 'arm:link_base')) return true;
  if (pairMatches('arm:link_base', 'arm:link1')) return true;

  for (let k = 1; k < options.armDof; k++) {
    if (pairMatches(`arm:link${k}`, `arm:link${k + 1}`)) return true;
  }

  const flangeLink: CollisionBodyId = `arm:link${options.armDof}`;
  if (options.hasSensor) {
    if (pairMatches(flangeLink, 'sensor:ai1500')) return true;
    if (pairMatches('sensor:ai1500', 'gripper:base')) return true;
  } else if (pairMatches(flangeLink, 'gripper:base')) {
    return true;
  }

  return false;
}

interface HostedShape {
  host: Object3D;
  shape: ConvexShape;
}

interface BodyRecord {
  id: CollisionBodyId;
  order: number;
  items: HostedShape[];
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export class CollisionDetector {
  private readonly bodies = new Map<CollisionBodyId, BodyRecord>();
  private activePairs: [BodyRecord, BodyRecord][] = [];
  private options: ExclusionOptions = { armDof: 6, hasSensor: false };
  private nextOrder = 0;
  private dragChain?: DragChainCollider;
  private penetrationTolerance: number;

  constructor(penetrationTolerance = DEFAULT_PENETRATION_TOLERANCE_M) {
    this.penetrationTolerance = penetrationTolerance;
  }

  setExclusionOptions(options: ExclusionOptions): void {
    this.options = { ...options };
    this.rebuildPairs();
  }

  clearAll(): void {
    this.bodies.clear();
    this.activePairs = [];
    this.nextOrder = 0;
    this.dragChain = undefined;
  }

  clearAccessories(): void {
    for (const id of [...this.bodies.keys()]) {
      if (!id.startsWith('arm:')) {
        this.bodies.delete(id);
      }
    }
    this.dragChain = undefined;
    this.rebuildPairs();
  }

  registerBodyShape(id: CollisionBodyId, host: Object3D, shape: ConvexShape): void {
    let rec = this.bodies.get(id);
    if (!rec) {
      rec = {
        id,
        order: this.nextOrder++,
        items: [],
        minX: 0,
        minY: 0,
        minZ: 0,
        maxX: 0,
        maxY: 0,
        maxZ: 0,
      };
      this.bodies.set(id, rec);
    }
    rec.items.push({ host, shape });
  }

  registerArmManifest(manifest: CollisionAssetManifest, links: Record<string, Object3D | undefined>, armDof: number): void {
    for (const entry of manifest.hulls) {
      const host = links[entry.bodyKey];
      if (!host) continue;
      this.registerBodyShape(`arm:${entry.bodyKey}`, host, createShapeFromEntry(entry));
    }
    this.options.armDof = armDof;
    this.rebuildPairs();
  }

  registerSensorManifest(manifest: CollisionAssetManifest, sensorMount: Object3D): void {
    for (const entry of manifest.hulls) {
      this.registerBodyShape('sensor:ai1500', sensorMount, createShapeFromEntry(entry));
    }
  }

  registerGripperManifest(manifest: CollisionAssetManifest, parts: Record<string, Object3D | undefined>): void {
    for (const entry of manifest.hulls) {
      const partName = entry.partKey ?? entry.bodyKey;
      const host = parts[partName];
      if (!host) continue;
      const bodyId: CollisionBodyId =
        entry.bodyKey === 'left'
          ? 'gripper:left'
          : entry.bodyKey === 'right'
            ? 'gripper:right'
            : 'gripper:base';
      this.registerBodyShape(bodyId, host, createShapeFromEntry(entry));
    }
  }

  registerRailManifest(
    manifest: CollisionAssetManifest,
    fixedRail: Object3D,
    carriage: Object3D,
    railMm: number,
  ): DragChainCollider {
    let bendShape: ConvexShape | undefined;
    for (const entry of manifest.hulls) {
      if (entry.bodyKey === 'fixed') {
        this.registerBodyShape('rail:fixed', fixedRail, createShapeFromEntry(entry));
      } else if (entry.bodyKey === 'carriage') {
        this.registerBodyShape('rail:carriage', carriage, createShapeFromEntry(entry));
      } else if (entry.bodyKey === 'drag_chain_bend') {
        bendShape = createShapeFromEntry(entry);
      }
    }
    const chain = new DragChainCollider(bendShape);
    chain.setPosition(railMm);
    for (const shape of chain.shapes) {
      this.registerBodyShape('rail:drag_chain', fixedRail, shape);
    }
    this.dragChain = chain;
    return chain;
  }

  setRailPosition(railMm: number): void {
    this.dragChain?.setPosition(railMm);
  }

  hasBody(id: CollisionBodyId): boolean {
    return this.bodies.has(id);
  }

  rebuildPairs(): void {
    const list = [...this.bodies.values()].sort((a, b) => a.order - b.order);
    const pairs: [BodyRecord, BodyRecord][] = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (!shouldExcludeCollisionPair(list[i].id, list[j].id, this.options)) {
          pairs.push([list[i], list[j]]);
        }
      }
    }
    this.activePairs = pairs;
  }

  detect(): CollisionPair[] {
    if (this.activePairs.length === 0) return [];

    // Refresh world transforms & per-body aggregate AABB for fast two-level broad-phase culling
    const seenHosts = new Set<Object3D>();
    for (const body of this.bodies.values()) {
      for (const item of body.items) {
        if (!seenHosts.has(item.host)) {
          item.host.updateWorldMatrix(true, false);
          seenHosts.add(item.host);
        }
      }
    }

    for (const body of this.bodies.values()) {
      let minX = Infinity;
      let minY = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let maxZ = -Infinity;
      for (const { host, shape } of body.items) {
        shape.updateWorldTransform(host.matrixWorld);
        if (shape.minX < minX) minX = shape.minX;
        if (shape.minY < minY) minY = shape.minY;
        if (shape.minZ < minZ) minZ = shape.minZ;
        if (shape.maxX > maxX) maxX = shape.maxX;
        if (shape.maxY > maxY) maxY = shape.maxY;
        if (shape.maxZ > maxZ) maxZ = shape.maxZ;
      }
      body.minX = minX;
      body.minY = minY;
      body.minZ = minZ;
      body.maxX = maxX;
      body.maxY = maxY;
      body.maxZ = maxZ;
    }

    const collisions: CollisionPair[] = [];
    for (const [bodyA, bodyB] of this.activePairs) {
      if (
        bodyA.minX > bodyB.maxX ||
        bodyA.maxX < bodyB.minX ||
        bodyA.minY > bodyB.maxY ||
        bodyA.maxY < bodyB.minY ||
        bodyA.minZ > bodyB.maxZ ||
        bodyA.maxZ < bodyB.minZ
      ) {
        continue;
      }

      let hit = false;
      for (let i = 0; i < bodyA.items.length && !hit; i++) {
        const shapeA = bodyA.items[i].shape;
        for (let j = 0; j < bodyB.items.length; j++) {
          const shapeB = bodyB.items[j].shape;
          if (!aabbOverlaps(shapeA, shapeB)) continue;
          if (intersectsGJK(shapeA, shapeB, this.penetrationTolerance)) {
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        collisions.push({ first: bodyA.id, second: bodyB.id });
      }
    }

    return collisions;
  }
}
