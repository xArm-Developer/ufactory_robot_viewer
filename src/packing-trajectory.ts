import config from './packing-config.json' with { type: 'json' };
import { packingJoints } from './packing-kinematics';

export type Vec3 = [number, number, number];
export interface MotionState { position: Vec3; velocity: Vec3; acceleration: Vec3 }
export const stationary = (position: Vec3): MotionState => ({ position, velocity: [0, 0, 0], acceleration: [0, 0, 0] });

/** Quintic Hermite segment. Position, velocity and acceleration are continuous at shared states. */
export class PackingSegment {
  private coefficients: number[][];
  constructor(readonly start: MotionState, readonly end: MotionState, readonly duration: number) {
    const t = duration;
    this.coefficients = start.position.map((p, i) => {
      const v = start.velocity[i], a = start.acceleration[i], dp = end.position[i] - p;
      const w = end.velocity[i], b = end.acceleration[i];
      return [p, v, a / 2, (20 * dp - (8 * w + 12 * v) * t - (3 * a - b) * t ** 2) / (2 * t ** 3),
        (-30 * dp + (14 * w + 16 * v) * t + (3 * a - 2 * b) * t ** 2) / (2 * t ** 4),
        (12 * dp - (6 * w + 6 * v) * t - (a - b) * t ** 2) / (2 * t ** 5)];
    });
  }

  sample(time: number): MotionState & { jerk: Vec3 } {
    const t = Math.max(0, Math.min(time, this.duration));
    const position: number[] = [], velocity: number[] = [], acceleration: number[] = [], jerk: number[] = [];
    for (const [a, b, c, d, e, f] of this.coefficients) {
      position.push(a + t * (b + t * (c + t * (d + t * (e + t * f)))));
      velocity.push(b + t * (2 * c + t * (3 * d + t * (4 * e + t * 5 * f))));
      acceleration.push(2 * c + t * (6 * d + t * (12 * e + t * 20 * f)));
      jerk.push(6 * d + t * (24 * e + t * 60 * f));
    }
    return { position: position as Vec3, velocity: velocity as Vec3, acceleration: acceleration as Vec3, jerk: jerk as Vec3 };
  }
}

/** Sample Cartesian and joint limits with the same IK used by the controller. */
export function packingSegmentRatios(segment: PackingSegment): number[] {
  const limits = config.limits, duration = segment.duration;
  const count = Math.max(8, Math.ceil(duration / .006));
  const dt = duration / count;
  const ratios = [0, 0, 0, 0, 0, 0];
  const joints: number[][] = [];
  for (let i = 0; i <= count; i++) {
    const state = segment.sample(i * dt);
    const q = packingJoints(...state.position);
    if (!q) throw new Error('Packing trajectory leaves the reachable workspace');
    joints.push(q);
    ratios[0] = Math.max(ratios[0], Math.hypot(...state.velocity) / limits.linearSpeed);
    ratios[1] = Math.max(ratios[1], Math.hypot(...state.acceleration) / limits.linearAcceleration);
    ratios[2] = Math.max(ratios[2], Math.hypot(...state.jerk) / limits.linearJerk);
  }
  for (let i = 1; i <= count; i++) for (let j = 0; j < 6; j++) {
    ratios[3] = Math.max(ratios[3], Math.abs((joints[i][j] - joints[i - 1][j]) / dt) / limits.jointSpeed);
    if (i >= 2) ratios[4] = Math.max(ratios[4], Math.abs((joints[i][j] - 2 * joints[i - 1][j] + joints[i - 2][j]) / dt ** 2) / limits.jointAcceleration);
    if (i >= 3) ratios[5] = Math.max(ratios[5], Math.abs((joints[i][j] - 3 * joints[i - 1][j] + 3 * joints[i - 2][j] - joints[i - 3][j]) / dt ** 3) / limits.jointJerk);
  }
  return ratios;
}

/** Find the shortest sampled duration with headroom for interpolation between samples. */
export function planPackingSegment(start: MotionState, end: MotionState, minimumDuration: number): PackingSegment {
  let lower = Math.max(minimumDuration, .02), upper = lower;
  const valid = (duration: number) => Math.max(...packingSegmentRatios(new PackingSegment(start, end, duration))) <= .97;
  if (valid(upper)) {
    upper = Math.ceil(upper / config.step) * config.step;
    while (!valid(upper)) upper += config.step;
    return new PackingSegment(start, end, upper);
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    lower = upper; upper *= 1.2;
    if (valid(upper)) {
      for (let iteration = 0; iteration < 12; iteration++) {
        const middle = (lower + upper) / 2;
        if (valid(middle)) upper = middle; else lower = middle;
      }
      upper = Math.ceil(upper / config.step) * config.step;
      while (!valid(upper)) upper += config.step;
      return new PackingSegment(start, end, upper);
    }
  }
  throw new Error('Unable to satisfy packing trajectory limits');
}
