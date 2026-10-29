import { Euler, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import type { URDFRobot } from 'urdf-loader';
import { Goal, Joint, Link, Solver, SOLVE_STATUS } from 'closed-chain-ik/core';
import { URDFUtils } from 'closed-chain-ik/three';

export const HOME = [0, -0.5, 0, 0, 0.5, 0] as const;
export const JOINT_NAMES = HOME.map((_, index) => `joint${index + 1}`);
export type CartesianAxis = 'x' | 'y' | 'z' | 'roll' | 'pitch' | 'yaw';
export interface Pose { position: Vector3; quaternion: Quaternion }
export interface SolveResult { ok: boolean; reason: 'converged' | 'invalid' | 'unreachable'; positionError?: number; rotationError?: number }

export function jointValues(robot: URDFRobot): number[] {
  return JOINT_NAMES.map(name => robot.joints[name].angle);
}

export function limits(robot: URDFRobot): { min: number; max: number }[] {
  return JOINT_NAMES.map(name => ({ min: robot.joints[name].limit.lower, max: robot.joints[name].limit.upper }));
}

export function setJoints(robot: URDFRobot, values: readonly number[]): boolean {
  if (values.length !== 6 || values.some((value, i) => !Number.isFinite(value) || value < limits(robot)[i].min || value > limits(robot)[i].max)) return false;
  values.forEach((value, i) => robot.setJointValue(JOINT_NAMES[i], value));
  robot.updateMatrixWorld(true);
  return true;
}

/** Pose of link_eef relative to link_base, independent of the scene transform. */
export function forward(robot: URDFRobot): Pose {
  robot.updateMatrixWorld(true);
  const base = robot.links.link_base;
  const end = robot.links.link_eef;
  const relative = new Matrix4().copy(base.matrixWorld).invert().multiply(end.matrixWorld);
  const position = new Vector3();
  const quaternion = new Quaternion();
  relative.decompose(position, quaternion, new Vector3());
  return { position, quaternion: quaternion.normalize() };
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

/** Map 1%–100% slider to 2.5–250 mm/s linear and 1–100 °/s angular speed. */
export function jogVelocity(percent: number): { linearMmPerSec: number; angularDegPerSec: number } {
  const clamped = MathUtils.clamp(Math.round(percent), 1, 100);
  return { linearMmPerSec: clamped * 2.5, angularDegPerSec: clamped };
}

export class IKSolver {
  private root: Joint;
  private goal: Goal;
  private solver: Solver;
  constructor(private robot: URDFRobot) {
    // The library's declaration calls this a Link, but the URDF robot root is a Joint.
    this.root = URDFUtils.urdfRobotToIKRoot(robot, false) as unknown as Joint;
    this.root.clearDoF(); // The robot base must never move during IK.
    const end = this.root.find(frame => frame.name === 'link_eef') as Link;
    if (!end) throw new Error('URDF is missing link_eef');
    this.goal = new Goal();
    this.goal.makeClosure(end);
    this.solver = new Solver(this.root);
    this.solver.maxIterations = 100;
    this.solver.translationConvergeThreshold = 0.00002;
    this.solver.rotationConvergeThreshold = 0.0002;
    this.solver.stallThreshold = 1e-7;
    this.solver.dampingFactor = 0.01;
  }

  solve(target: Pose): SolveResult {
    const numbers = [...target.position.toArray(), ...target.quaternion.toArray()];
    if (!numbers.every(Number.isFinite) || target.quaternion.lengthSq() < 1e-12) return { ok: false, reason: 'invalid' };
    const previous = jointValues(this.robot);
    URDFUtils.setIKFromUrdf(this.root as unknown as Link, this.robot);
    this.robot.updateMatrixWorld(true);
    const base = this.robot.links.link_base;
    const basePosition = base.getWorldPosition(new Vector3());
    const baseQuaternion = base.getWorldQuaternion(new Quaternion());
    const worldPosition = target.position.clone().applyQuaternion(baseQuaternion).add(basePosition);
    const worldQuaternion = baseQuaternion.multiply(target.quaternion.clone().normalize());
    this.goal.setPosition(worldPosition.x, worldPosition.y, worldPosition.z);
    this.goal.setQuaternion(worldQuaternion.x, worldQuaternion.y, worldQuaternion.z, worldQuaternion.w);
    const status = this.solver.solve();
    URDFUtils.setUrdfFromIK(this.robot, this.root as unknown as Link);
    const actual = forward(this.robot);
    const positionError = actual.position.distanceTo(target.position);
    const rotationError = actual.quaternion.angleTo(target.quaternion.clone().normalize());
    const values = jointValues(this.robot);
    const withinLimits = values.every((value, i) => Number.isFinite(value) && value >= limits(this.robot)[i].min - 1e-6 && value <= limits(this.robot)[i].max + 1e-6);
    const converged = status.every(item => item === SOLVE_STATUS.CONVERGED) || (positionError <= 0.00035 && rotationError <= 0.006);
    if (converged && withinLimits && positionError <= 0.001 && rotationError <= Math.PI / 180) {
      return { ok: true, reason: 'converged', positionError, rotationError };
    }
    setJoints(this.robot, previous);
    return { ok: false, reason: 'unreachable', positionError, rotationError };
  }
}
