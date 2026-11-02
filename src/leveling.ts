import { MathUtils, Quaternion, Vector3 } from 'three';
import type { URDFRobot } from 'urdf-loader';
import { forward, jointNames, jointValues, limits } from './kinematics';

const TAU = 2 * Math.PI;
const ALREADY_LEVEL_DOT = Math.cos(MathUtils.degToRad(0.1));
// Leave a small margin for floating-point error when applying the returned angles.
const LEVEL_ANGLE = MathUtils.degToRad(0.1) - 1e-8;
const TARGET_DOT = Math.cos(LEVEL_ANGLE);
const DOWN = new Vector3(0, 0, -1);

type Bounds = { min: number; max: number };

/** Values in [min, max] where c + x cos(t) + y sin(t) equals value. */
function trigRoots(c: number, x: number, y: number, value: number, bounds: Bounds): number[] {
  const radius = Math.hypot(x, y);
  if (radius < 1e-14) return [];
  const ratio = (value - c) / radius;
  if (ratio < -1 - 1e-12 || ratio > 1 + 1e-12) return [];
  const phase = Math.atan2(y, x);
  const offset = Math.acos(MathUtils.clamp(ratio, -1, 1));
  const roots: number[] = [];
  for (const base of [phase - offset, phase + offset]) {
    const first = Math.ceil((bounds.min - base) / TAU);
    const last = Math.floor((bounds.max - base) / TAU);
    for (let k = first; k <= last; k++) roots.push(base + k * TAU);
  }
  return roots;
}

/** Components of target dot (rotation about axis by t applied to vector). */
function rotationTerms(axis: Vector3, vector: Vector3, target: Vector3): [number, number, number] {
  const parallel = axis.clone().multiplyScalar(axis.dot(vector));
  return [target.dot(parallel), target.dot(vector.clone().sub(parallel)), target.dot(new Vector3().crossVectors(axis, vector))];
}

/** Nearest value to zero in a periodic set of allowed angle intervals. */
function nearestPeriodicInterval(center: number, halfWidth: number, bounds: Bounds): number | undefined {
  const first = Math.ceil((bounds.min - center - halfWidth) / TAU);
  const last = Math.floor((bounds.max - center + halfWidth) / TAU);
  let nearest: number | undefined;
  for (let k = first; k <= last; k++) {
    const low = Math.max(bounds.min, center + k * TAU - halfWidth);
    const high = Math.min(bounds.max, center + k * TAU + halfWidth);
    if (low > high + 1e-12) continue;
    const value = MathUtils.clamp(0, low, high);
    if (nearest === undefined || Math.abs(value) < Math.abs(nearest)) nearest = value;
  }
  return nearest;
}

/** Nearest second-axis rotation that places the flange direction in the target cone. */
function nearestSecond(axis: Vector3, flange: Vector3, target: Vector3, bounds: Bounds): number | undefined {
  const [c, x, y] = rotationTerms(axis, flange, target);
  const radius = Math.hypot(x, y);
  if (radius < 1e-14) return c >= TARGET_DOT ? MathUtils.clamp(0, bounds.min, bounds.max) : undefined;
  const ratio = (TARGET_DOT - c) / radius;
  if (ratio > 1 + 1e-12) return undefined;
  if (ratio <= -1) return MathUtils.clamp(0, bounds.min, bounds.max);
  return nearestPeriodicInterval(Math.atan2(y, x), Math.acos(MathUtils.clamp(ratio, -1, 1)), bounds);
}

function splitParallel(angle: number, first: Bounds, secondAlongAxis: Bounds, sign: number): [number, number] {
  // Project the equal split onto the interval allowed by both joints.
  const low = Math.max(first.min, angle - secondAlongAxis.max);
  const high = Math.min(first.max, angle - secondAlongAxis.min);
  const a = MathUtils.clamp(angle / 2, low, high);
  return [a, sign * (angle - a)];
}

/** xArm 5's two parallel joints contribute to the same rotation; evaluate all 2π branches for least squared change. */
function solveParallel(
  axis: Vector3, flange: Vector3, first: Bounds, second: Bounds, sign: number,
): [number, number] | undefined {
  const secondAlongAxis = sign > 0 ? second : { min: -second.max, max: -second.min };
  const combined = { min: first.min + secondAlongAxis.min, max: first.max + secondAlongAxis.max };
  const [c, x, y] = rotationTerms(axis, flange, DOWN);
  const radius = Math.hypot(x, y);
  if (radius < 1e-14) {
    return c >= TARGET_DOT ? splitParallel(MathUtils.clamp(0, combined.min, combined.max), first, secondAlongAxis, sign) : undefined;
  }
  const ratio = (TARGET_DOT - c) / radius;
  if (ratio > 1 + 1e-12) return undefined;
  if (ratio <= -1) return splitParallel(MathUtils.clamp(0, combined.min, combined.max), first, secondAlongAxis, sign);

  const center = Math.atan2(y, x);
  const halfWidth = Math.acos(MathUtils.clamp(ratio, -1, 1));
  const firstBranch = Math.ceil((combined.min - center - halfWidth) / TAU);
  const lastBranch = Math.floor((combined.max - center + halfWidth) / TAU);
  let best: [number, number] | undefined;
  let bestCost = Infinity;
  for (let k = firstBranch; k <= lastBranch; k++) {
    const low = Math.max(combined.min, center + k * TAU - halfWidth);
    const high = Math.min(combined.max, center + k * TAU + halfWidth);
    if (low > high + 1e-12) continue;
    const angle = MathUtils.clamp(0, low, high);
    const candidate = splitParallel(angle, first, secondAlongAxis, sign);
    const cost = candidate[0] * candidate[0] + candidate[1] * candidate[1];
    if (cost < bestCost) {
      bestCost = cost;
      best = candidate;
    }
  }
  return best;
}

/** Solve the two wrist angles against a cone, including limit and equivalent-angle boundaries. */
function solveWrist(axisA: Vector3, axisB: Vector3, flange: Vector3, first: Bounds, second: Bounds): [number, number] | undefined {
  const breakpoints = [first.min, first.max];
  // The attainable circle around axisB intersects the target cone only within
  // this interval of target dot axisB. Its boundaries find narrow feasible arcs.
  const inclination = Math.acos(MathUtils.clamp(axisB.dot(flange), -1, 1));
  const lower = Math.cos(Math.min(Math.PI, inclination + LEVEL_ANGLE));
  const upper = Math.cos(Math.max(0, inclination - LEVEL_ANGLE));
  const axisTerms = rotationTerms(axisA, axisB, DOWN);
  breakpoints.push(...trigRoots(...axisTerms, lower, first), ...trigRoots(...axisTerms, upper, first));
  // Splitting at second-joint limits and its current angle isolates changes in
  // feasibility and in the nearest branch, including ±2π equivalents.
  for (const beta of [second.min, second.max, 0]) {
    const direction = flange.clone().applyAxisAngle(axisB, beta);
    breakpoints.push(...trigRoots(...rotationTerms(axisA, direction, DOWN), TARGET_DOT, first));
  }
  const cross = new Vector3().crossVectors(axisB, flange);
  breakpoints.push(...trigRoots(...rotationTerms(axisA, cross, DOWN), 0, first));
  breakpoints.sort((a, b) => a - b);
  const points = breakpoints.filter((value, index) => index === 0 || value - breakpoints[index - 1] > 1e-11);
  let best: [number, number] | undefined;
  let bestCost = Infinity;
  const evaluate = (alpha: number): number => {
    const target = DOWN.clone().applyAxisAngle(axisA, -alpha);
    const beta = nearestSecond(axisB, flange, target, second);
    if (beta === undefined) return Infinity;
    const cost = alpha * alpha + beta * beta;
    if (cost < bestCost) { bestCost = cost; best = [alpha, beta]; }
    return cost;
  };
  points.forEach(evaluate);
  // Each feasible arc is bounded analytically; minimize every part rather than
  // relying on a seed that could miss a narrow arc or a different wrist branch.
  const subdivisions = 12;
  const golden = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i + 1 < points.length; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (!Number.isFinite(evaluate((start + end) / 2))) continue;
    for (let part = 0; part < subdivisions; part++) {
      let left = start + (end - start) * part / subdivisions;
      let right = start + (end - start) * (part + 1) / subdivisions;
      let x1 = right - (right - left) * golden;
      let x2 = left + (right - left) * golden;
      let f1 = evaluate(x1);
      let f2 = evaluate(x2);
      for (let iteration = 0; iteration < 42; iteration++) {
        if (f1 <= f2) {
          right = x2; x2 = x1; f2 = f1;
          x1 = right - (right - left) * golden; f1 = evaluate(x1);
        } else {
          left = x1; x1 = x2; f1 = f2;
          x2 = left + (right - left) * golden; f2 = evaluate(x2);
        }
      }
    }
  }
  return best;
}

/** Return the closest legal wrist target, without modifying the robot. */
export function levelFlange(robot: URDFRobot, eeLink?: string): number[] | undefined {
  const names = jointNames(robot);
  const current = jointValues(robot);
  const bounds = limits(robot);
  if (current.length < 3) return undefined;
  const flange = new Vector3(0, 0, 1).applyQuaternion(forward(robot, eeLink).quaternion).normalize();
  if (flange.dot(DOWN) >= ALREADY_LEVEL_DOT) return [...current];

  const baseInverse = robot.links.link_base.getWorldQuaternion(new Quaternion()).invert();
  const jointAxis = (index: number) => robot.joints[names[index]].axis.clone()
    .applyQuaternion(robot.joints[names[index]].getWorldQuaternion(new Quaternion()))
    .applyQuaternion(baseInverse).normalize();
  const firstIndex = current.length - 3;
  const secondIndex = current.length - 2;
  const axisA = jointAxis(firstIndex);
  const axisB = jointAxis(secondIndex);
  const first = { min: bounds[firstIndex].min - current[firstIndex], max: bounds[firstIndex].max - current[firstIndex] };
  const second = { min: bounds[secondIndex].min - current[secondIndex], max: bounds[secondIndex].max - current[secondIndex] };
  const axisDot = axisA.dot(axisB);
  const solution = Math.abs(axisDot) > 1 - 1e-9
    ? solveParallel(axisA, flange, first, second, Math.sign(axisDot))
    : solveWrist(axisA, axisB, flange, first, second);
  if (!solution) return undefined;
  const target = [...current];
  target[firstIndex] = MathUtils.clamp(current[firstIndex] + solution[0], bounds[firstIndex].min, bounds[firstIndex].max);
  target[secondIndex] = MathUtils.clamp(current[secondIndex] + solution[1], bounds[secondIndex].min, bounds[secondIndex].max);
  return target;
}
