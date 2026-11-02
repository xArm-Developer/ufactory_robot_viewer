import { Euler, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import type { URDFRobot } from 'urdf-loader';
import { Goal, Joint, Link, Solver, SOLVE_STATUS } from 'closed-chain-ik/core';
import { URDFUtils } from 'closed-chain-ik/three';

export const HOME = [0, 0, 0, 0, 0, 0] as const;
export const JOINT_NAMES = HOME.map((_, index) => `joint${index + 1}`);
export type CartesianAxis = 'x' | 'y' | 'z' | 'roll' | 'pitch' | 'yaw';
export interface Pose { position: Vector3; quaternion: Quaternion }
export interface SolveResult { ok: boolean; reason: 'converged' | 'invalid' | 'unreachable'; positionError?: number; rotationError?: number }

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

export function toRPY(quaternion: Quaternion): [number, number, number] {
  const euler = new Euler().setFromQuaternion(quaternion, 'ZYX');
  return [euler.x, euler.y, euler.z];
}

/** Increment pose in link_base frame: linear axes in mm, RPY axes in degrees. */
export function stepBasePose(pose: Pose, axis: CartesianAxis, delta: number): Pose {
  const position = pose.position.clone();
  if (axis === 'x' || axis === 'y' || axis === 'z') {
    position[axis] += delta / 1000;
    return { position, quaternion: pose.quaternion.clone() };
  }
  const [roll, pitch, yaw] = toRPY(pose.quaternion);
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

    const trySolve = (seed: readonly number[]) => {
      setJoints(this.robot, seed);
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
      const ok = converged && withinLimits && positionError <= 0.001 && rotationError <= Math.PI / 180;
      return { ok, positionError, rotationError };
    };

    const primary = trySolve(previous);
    if (primary.ok) {
      return { ok: true, reason: 'converged', positionError: primary.positionError, rotationError: primary.rotationError };
    }

    // Escape inline spherical-wrist singularity (wrist pitch ≈ 0 on 6/7-DoF arms such as 850 Roll-)
    const dof = previous.length;
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

    setJoints(this.robot, previous);
    return { ok: false, reason: 'unreachable', positionError: primary.positionError, rotationError: primary.rotationError };
  }
}
