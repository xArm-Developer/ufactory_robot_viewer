import { Euler, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import type { URDFRobot } from 'urdf-loader';
import { Goal, Joint, Link, Solver, SOLVE_STATUS } from 'closed-chain-ik/core';
import { URDFUtils } from 'closed-chain-ik/three';

export const HOME = [0, 0, 0, 0, 0, 0] as const;
export const JOINT_NAMES = HOME.map((_, index) => `joint${index + 1}`);
export type CartesianAxis = 'x' | 'y' | 'z' | 'roll' | 'pitch' | 'yaw';
export type RPY = [number, number, number];
export interface Pose { position: Vector3; quaternion: Quaternion }
export interface SolveResult {
  ok: boolean;
  reason: 'converged' | 'invalid' | 'unreachable' | 'joint_limit';
  positionError?: number;
  rotationError?: number;
  exceededJointId?: number;
  exceededAngleDeg?: number;
}

export function formatJointLimitMessage(jointId: number, angleDeg: number): string {
  const normalized = Math.abs(angleDeg) < 0.005 ? 0 : angleDeg;
  return `C23 Joints Angle Exceed Limit ID [${jointId}], joint angle [${normalized.toFixed(2)}°].`;
}

export function homeJoints(dof: number): number[] {
  return Array.from({ length: dof }, () => 0);
}

export function jointNames(robot: URDFRobot): string[] {
  const names: string[] = [];
  for (let i = 1; `joint${i}` in robot.joints; i++) {
    names.push(`joint${i}`);
  }
  return names;
}

export function resolveEeLink(robot: URDFRobot, eeLink?: string): string {
  if (eeLink) {
    if (!(eeLink in robot.links)) throw new Error(`URDF is missing ${eeLink}`);
    return eeLink;
  }
  if ('link_eef' in robot.links) return 'link_eef';
  const fallback = `link${jointNames(robot).length}`;
  if (!(fallback in robot.links)) throw new Error(`URDF is missing ${fallback}`);
  return fallback;
}

export function jointValues(robot: URDFRobot): number[] {
  return jointNames(robot).map(name => robot.joints[name].angle);
}

export function limits(robot: URDFRobot): { min: number; max: number }[] {
  return jointNames(robot).map(name => ({ min: robot.joints[name].limit.lower, max: robot.joints[name].limit.upper }));
}

export function setJoints(robot: URDFRobot, values: readonly number[]): boolean {
  const names = jointNames(robot);
  const jointLimits = limits(robot);
  if (values.length !== names.length || values.some((value, i) => !Number.isFinite(value) || value < jointLimits[i].min || value > jointLimits[i].max)) {
    return false;
  }
  values.forEach((value, i) => robot.setJointValue(names[i], value));
  robot.updateMatrixWorld(true);
  return true;
}

/** Compose two rigid poses without changing either input. */
export function composePose(parent: Pose, local: Pose): Pose {
  return {
    position: local.position.clone().applyQuaternion(parent.quaternion).add(parent.position),
    quaternion: parent.quaternion.clone().multiply(local.quaternion).normalize(),
  };
}

/** Recover the flange pose from the requested TCP pose and flange-to-TCP offset. */
export function flangeFromTcp(tcp: Pose, offset: Pose): Pose {
  const quaternion = tcp.quaternion.clone().normalize().multiply(offset.quaternion.clone().invert()).normalize();
  return { position: tcp.position.clone().sub(offset.position.clone().applyQuaternion(quaternion)), quaternion };
}

/** Pose of the flange or fixed TCP relative to link_base, independent of the scene transform. */
export function forward(robot: URDFRobot, eeLink?: string, offset?: Pose): Pose {
  robot.updateWorldMatrix(true, true);
  const base = robot.links.link_base;
  const end = robot.links[resolveEeLink(robot, eeLink)];
  const relative = new Matrix4().copy(base.matrixWorld).invert().multiply(end.matrixWorld);
  const position = new Vector3();
  const quaternion = new Quaternion();
  relative.decompose(position, quaternion, new Vector3());
  const flange = { position, quaternion: quaternion.normalize() };
  return offset ? composePose(flange, offset) : flange;
}

/** URDF fixed-axis RPY: Rz(yaw) × Ry(pitch) × Rx(roll). */
export function fromRPY(roll: number, pitch: number, yaw: number): Quaternion {
  return new Quaternion().setFromEuler(new Euler(roll, pitch, yaw, 'ZYX'));
}

/** Extract an equivalent ZYX branch nearest the reference, including at gimbal lock. */
export function toRPY(quaternion: Quaternion, reference?: readonly number[]): RPY {
  const m = new Matrix4().makeRotationFromQuaternion(quaternion.clone().normalize()).elements;
  const cosPitch = Math.hypot(m[0], m[1]);
  const pitch = Math.atan2(-m[2], cosPitch);
  const near = (angle: number, target: number) => angle + 2 * Math.PI * Math.round((target - angle) / (2 * Math.PI));

  if (cosPitch < 1e-12 || (reference && cosPitch < 2e-2)) {
    // At ±90°, yaw − sign(pitch) × roll is fixed; choose the closest pair.
    const sign = pitch >= 0 ? 1 : -1;
    const invariant = Math.atan2(-m[4] + sign * m[9], m[5] + sign * m[8]);
    if (!reference) return [0, pitch, invariant];
    const p0 = near(pitch, reference[1]);
    const p1 = near(Math.PI - pitch, reference[1]);
    const bestPitch = Math.abs(p1 - reference[1]) < Math.abs(p0 - reference[1]) ? p1 : p0;
    const difference = near(invariant, reference[2] - sign * reference[0]) - (reference[2] - sign * reference[0]);
    const candidate: RPY = [reference[0] - sign * difference / 2, bestPitch, reference[2] + difference / 2];
    if (cosPitch < 1e-12 || fromRPY(...candidate).angleTo(quaternion) <= 1e-3) {
      return candidate;
    }
  }

  const standard: RPY = [Math.atan2(m[6], m[10]), pitch, Math.atan2(m[1], m[0])];
  if (!reference) return standard;
  const branches: RPY[] = [standard, [standard[0] + Math.PI, Math.PI - pitch, standard[2] + Math.PI]];
  const candidates = branches.map(branch => branch.map((angle, i) => near(angle, reference[i])) as RPY);
  const distance = (branch: RPY) => branch.reduce((sum, angle, i) => sum + (angle - reference[i]) ** 2, 0);
  return distance(candidates[1]) < distance(candidates[0]) ? candidates[1] : candidates[0];
}

/** Increment pose in link_base frame: linear axes in mm, RPY axes in degrees. */
export function stepBasePose(pose: Pose, axis: CartesianAxis, delta: number, reference?: readonly number[]): Pose {
  const position = pose.position.clone();
  if (axis === 'x' || axis === 'y' || axis === 'z') {
    position[axis] += delta / 1000;
    return { position, quaternion: pose.quaternion.clone() };
  }
  const [roll, pitch, yaw] = toRPY(pose.quaternion, reference);
  const rad = MathUtils.degToRad(delta);
  return {
    position,
    quaternion: fromRPY(
      axis === 'roll' ? roll + rad : roll,
      axis === 'pitch' ? pitch + rad : pitch,
      axis === 'yaw' ? yaw + rad : yaw,
    ),
  };
}

/** Map 1%–100% slider to 2.5–250 mm/s linear and 1–40 °/s angular speed. */
export function jogVelocity(percent: number): { linearMmPerSec: number; angularDegPerSec: number } {
  const clamped = MathUtils.clamp(Math.round(percent), 1, 100);
  return { linearMmPerSec: clamped * 2.5, angularDegPerSec: 1 + (clamped - 1) * 39 / 99 };
}

/** Map 1%–100% linearly to 1–45 degrees per second. */
export function jointVelocity(percent: number): number {
  const clamped = MathUtils.clamp(Math.round(percent), 1, 100);
  return 1 + (clamped - 1) * 44 / 99;
}

export class IKSolver {
  private root: Joint;
  private goal: Goal;
  private solver: Solver;
  private eeLink: string;
  private offset: Pose = { position: new Vector3(), quaternion: new Quaternion() };

  constructor(private robot: URDFRobot, eeLink?: string) {
    this.eeLink = resolveEeLink(robot, eeLink);
    // The library's declaration calls this a Link, but the URDF robot root is a Joint.
    this.root = URDFUtils.urdfRobotToIKRoot(robot, false) as unknown as Joint;
    this.root.clearDoF(); // The robot base must never move during IK.
    const end = this.root.find(frame => frame.name === this.eeLink) as Link;
    if (!end) throw new Error(`URDF is missing ${this.eeLink}`);
    this.goal = new Goal();
    this.goal.makeClosure(end);
    this.solver = new Solver(this.root);
    this.solver.maxIterations = 100;
    this.solver.translationConvergeThreshold = 0.00002;
    this.solver.rotationConvergeThreshold = 0.0002;
    this.solver.stallThreshold = 1e-7;
    this.solver.dampingFactor = 0.01;
  }

  setToolOffset(offset: Pose): void {
    this.offset = { position: offset.position.clone(), quaternion: offset.quaternion.clone().normalize() };
  }

  solve(target: Pose): SolveResult {
    const numbers = [...target.position.toArray(), ...target.quaternion.toArray()];
    if (!numbers.every(Number.isFinite) || target.quaternion.lengthSq() < 1e-12) return { ok: false, reason: 'invalid' };
    const previous = jointValues(this.robot);
    const jointLimits = limits(this.robot);
    const normalizedTargetQuat = target.quaternion.clone().normalize();
    const flangeTarget = flangeFromTcp({ position: target.position, quaternion: normalizedTargetQuat }, this.offset);

    this.robot.updateWorldMatrix(true, true);
    const base = this.robot.links.link_base;
    const parentInverse = this.robot.parent
      ? new Matrix4().copy(this.robot.parent.matrixWorld).invert()
      : new Matrix4();
    const baseInIkSpace = parentInverse.multiply(base.matrixWorld);
    const basePosition = new Vector3();
    const baseQuaternion = new Quaternion();
    baseInIkSpace.decompose(basePosition, baseQuaternion, new Vector3());
    baseQuaternion.normalize();
    const worldPosition = flangeTarget.position.clone().applyQuaternion(baseQuaternion).add(basePosition);
    const worldQuaternion = baseQuaternion.clone().multiply(flangeTarget.quaternion);

    const names = jointNames(this.robot);
    const ikJoints = names.map(name => this.root.find(frame => frame.name === name) as Joint);
    const startPose = forward(this.robot, this.eeLink, this.offset);
    const isIncremental =
      startPose.position.distanceTo(target.position) < 0.02 &&
      startPose.quaternion.angleTo(normalizedTargetQuat) < 0.1;

    const applyJointValues = (values: readonly number[]) => {
      names.forEach((name, i) => this.robot.setJointValue(name, values[i]));
      this.robot.updateMatrixWorld(true);
    };

    const trySolve = (seed: readonly number[]) => {
      applyJointValues(seed);
      URDFUtils.setIKFromUrdf(this.root as unknown as Link, this.robot);
      this.goal.setPosition(worldPosition.x, worldPosition.y, worldPosition.z);
      this.goal.setQuaternion(worldQuaternion.x, worldQuaternion.y, worldQuaternion.z, worldQuaternion.w);
      const status = this.solver.solve();
      URDFUtils.setUrdfFromIK(this.robot, this.root as unknown as Link);
      const actual = forward(this.robot, this.eeLink, this.offset);
      const positionError = actual.position.distanceTo(target.position);
      const rotationError = actual.quaternion.angleTo(normalizedTargetQuat);
      const values = jointValues(this.robot);
      const withinLimits = values.every(
        (value, i) => Number.isFinite(value) && value >= jointLimits[i].min - 1e-6 && value <= jointLimits[i].max + 1e-6,
      );
      const converged =
        status.every(item => item === SOLVE_STATUS.CONVERGED) ||
        (positionError <= 0.00035 && rotationError <= 0.006);
      const poseConverged = converged && positionError <= 0.001 && rotationError <= Math.PI / 180;
      const ok = poseConverged && withinLimits;
      return { ok, poseConverged, values, positionError, rotationError };
    };

    const dof = previous.length;
    const solveWristLocked = () => {
      const w1 = dof - 3;
      const w3 = dof - 1;
      try {
        ikJoints[w1].setMinLimits(previous[w1]);
        ikJoints[w1].setMaxLimits(previous[w1]);
        ikJoints[w3].setMinLimits(previous[w3]);
        ikJoints[w3].setMaxLimits(previous[w3]);
        return trySolve(previous);
      } finally {
        ikJoints[w1].setMinLimits(jointLimits[w1].min);
        ikJoints[w1].setMaxLimits(jointLimits[w1].max);
        ikJoints[w3].setMinLimits(jointLimits[w3].min);
        ikJoints[w3].setMaxLimits(jointLimits[w3].max);
      }
    };

    const primary = trySolve(previous);
    if (
      dof >= 6 &&
      isIncremental &&
      Math.abs(previous[dof - 2]) < 0.25 &&
      (!primary.ok ||
        Math.abs(primary.values[dof - 3] - previous[dof - 3]) > 0.03 ||
        Math.abs(primary.values[dof - 1] - previous[dof - 1]) > 0.03)
    ) {
      const locked = solveWristLocked();
      if (locked.ok) {
        return { ok: true, reason: 'converged', positionError: locked.positionError, rotationError: locked.rotationError };
      }
      if (primary.ok) {
        setJoints(this.robot, primary.values);
        return { ok: true, reason: 'converged', positionError: primary.positionError, rotationError: primary.rotationError };
      }
    } else if (primary.ok) {
      return { ok: true, reason: 'converged', positionError: primary.positionError, rotationError: primary.rotationError };
    }

    // Escape inline spherical-wrist singularity (wrist pitch ≈ 0 on 6/7-DoF arms such as 850 Roll-)
    if (dof >= 6 && Math.abs(previous[dof - 2]) < 1e-2) {
      for (const sign of [1, -1] as const) {
        const seed = [...previous];
        seed[dof - 3] = MathUtils.clamp(previous[dof - 3] + (sign * Math.PI) / 2, jointLimits[dof - 3].min, jointLimits[dof - 3].max);
        seed[dof - 2] = MathUtils.clamp(sign * 0.02, jointLimits[dof - 2].min, jointLimits[dof - 2].max);
        seed[dof - 1] = MathUtils.clamp(previous[dof - 1] - (sign * Math.PI) / 2, jointLimits[dof - 1].min, jointLimits[dof - 1].max);
        const retry = trySolve(seed);
        if (retry.ok) {
          return { ok: true, reason: 'converged', positionError: retry.positionError, rotationError: retry.rotationError };
        }
      }
    }

    if (startPose.position.distanceTo(target.position) < 0.1) {
      let exceededResult: SolveResult | undefined;
      try {
        names.forEach((name, i) => {
          this.robot.joints[name].ignoreLimits = true;
          ikJoints[i].setMinLimits(-4 * Math.PI);
          ikJoints[i].setMaxLimits(4 * Math.PI);
        });
        let unconstrained =
          dof >= 6 && isIncremental && Math.abs(previous[dof - 2]) < 0.25
            ? (() => {
                const w1 = dof - 3;
                const w3 = dof - 1;
                ikJoints[w1].setMinLimits(previous[w1]);
                ikJoints[w1].setMaxLimits(previous[w1]);
                ikJoints[w3].setMinLimits(previous[w3]);
                ikJoints[w3].setMaxLimits(previous[w3]);
                const res = trySolve(previous);
                ikJoints[w1].setMinLimits(-4 * Math.PI);
                ikJoints[w1].setMaxLimits(4 * Math.PI);
                ikJoints[w3].setMinLimits(-4 * Math.PI);
                ikJoints[w3].setMaxLimits(4 * Math.PI);
                return res;
              })()
            : undefined;
        if (!unconstrained?.poseConverged) {
          unconstrained = trySolve(previous);
        }
        if (unconstrained.poseConverged) {
          const exceededIndex = unconstrained.values.findIndex(
            (value, i) => value < jointLimits[i].min - 1e-6 || value > jointLimits[i].max + 1e-6,
          );
          if (exceededIndex !== -1) {
            exceededResult = {
              ok: false,
              reason: 'joint_limit',
              positionError: primary.positionError,
              rotationError: primary.rotationError,
              exceededJointId: exceededIndex + 1,
              exceededAngleDeg: MathUtils.radToDeg(unconstrained.values[exceededIndex]),
            };
          }
        }
      } finally {
        names.forEach((name, i) => {
          this.robot.joints[name].ignoreLimits = false;
          ikJoints[i].setMinLimits(jointLimits[i].min);
          ikJoints[i].setMaxLimits(jointLimits[i].max);
        });
        setJoints(this.robot, previous);
      }
      if (exceededResult) return exceededResult;
    }

    setJoints(this.robot, previous);
    return { ok: false, reason: 'unreachable', positionError: primary.positionError, rotationError: primary.rotationError };
  }
}
