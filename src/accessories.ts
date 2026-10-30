import { Matrix4, Quaternion, Vector3 } from 'three';
import { composePose, type Pose } from './kinematics';
import type { RobotId } from './robots';
import { gripperMount, toolOffset, type GripperId } from './grippers';

export type SensorId = 'ai1500';
export type RailId = 'al0700';

export const SENSOR_SPEC = {
  id: 'ai1500' as const,
  name: { zh: '六维力矩传感器', en: '6-Axis F/T Sensor' },
  productUrl: 'https://www.shop.ufactory.cc/products/6-axis-ft-sensor',
} as const;

export const RAIL_SPEC = {
  id: 'al0700' as const,
  name: { zh: '直线滑轨', en: 'Direct-Drive Linear Motor' },
  minMm: 0,
  maxMm: 700,
  productUrl: 'https://www.shop.ufactory.cc/products/direct-drive-linear-motor',
  cameraPosition: [2.05, -2.15, 1.65] as [number, number, number],
  cameraTarget: [0.35, 0, 0.42] as [number, number, number],
} as const;

// The STEP has CAD X across the rail, Y up, and Z along the rail. World +X increases away from zero.
export const RAIL_CAD_TO_WORLD = new Quaternion().setFromRotationMatrix(new Matrix4().set(
  0, 0, -1, 0,
  -1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 0, 1,
));
export const RAIL_ORIGIN_WORLD = new Vector3(0.3435, -0.03824, 0.042);
export const ROBOT_BASE_CAD = new Vector3(-0.03824, 0.065, 0.3435);
// Rail travel is world +X; a -90° yaw makes the robot base +Y point along it.
export const ROBOT_BASE_WORLD_ROTATION = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2);
export const ROBOT_MOUNT_CAD_ROTATION = RAIL_CAD_TO_WORLD.clone().invert().multiply(ROBOT_BASE_WORLD_ROTATION);

// Candidate flange mating center and UFACTORY Studio default +58.6 mm axial TCP offset.
export const SENSOR_FLANGE_CAD = new Vector3(-0.00424, 0.00668, 0.0657);
export const SENSOR_TCP: Pose = { position: new Vector3(0, 0, 0.0586), quaternion: new Quaternion() };

export function supportsSensor(robotId: RobotId): boolean {
  return robotId !== 'lite6';
}

export function supportsLinearRail(robotId: RobotId): boolean {
  return robotId === 'xarm5' || robotId === 'xarm6' || robotId === 'xarm7';
}

/** Only accept finite, in-range values on the 0.1 mm control grid. */
export function validRailPosition(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= RAIL_SPEC.minMm &&
    value <= RAIL_SPEC.maxMm &&
    Math.abs(value * 10 - Math.round(value * 10)) < 1e-7
  );
}

/** Flange-to-gripper-base transform, shifted by +58.6 mm along flange +Z when the F/T sensor is mounted. */
export function assemblyGripperMount(robotId: RobotId, gripperId: GripperId, withSensor = false): Pose {
  if (withSensor && !supportsSensor(robotId)) throw new Error(`Unsupported sensor on ${robotId}`);
  const baseMount = gripperMount(robotId, gripperId);
  return withSensor ? composePose(SENSOR_TCP, baseMount) : baseMount;
}

/** Combined flange-to-TCP transform for optional F/T sensor and optional single gripper. */
export function assemblyToolOffset(robotId: RobotId, options: { sensor?: boolean; gripperId?: GripperId } = {}): Pose {
  const hasSensor = Boolean(options.sensor);
  if (hasSensor && !supportsSensor(robotId)) throw new Error(`Unsupported sensor on ${robotId}`);
  if (!options.gripperId) {
    return hasSensor
      ? { position: SENSOR_TCP.position.clone(), quaternion: SENSOR_TCP.quaternion.clone() }
      : { position: new Vector3(), quaternion: new Quaternion() };
  }
  const gripperTcp = toolOffset(robotId, options.gripperId);
  return hasSensor ? composePose(SENSOR_TCP, gripperTcp) : gripperTcp;
}
