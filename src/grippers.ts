import { Quaternion, Vector3 } from 'three';
import type { Pose } from './kinematics';
import type { RobotId } from './robots';

export type GripperId = 'gripper-g2' | 'bio-gripper-g2' | 'lite6-gripper' | 'lite6-vacuum-gripper';
export interface GripperSpec {
  id: GripperId;
  name: string;
  opening?:
    | { mode: 'continuous'; min: number; max: number; unit: 'mm' }
    | { mode: 'binary'; min: 0; max: 100 };
  productUrl: string;
}

export const GRIPPERS: readonly GripperSpec[] = [
  { id: 'gripper-g2', name: 'Gripper G2', opening: { mode: 'continuous', min: 0, max: 84, unit: 'mm' }, productUrl: 'https://www.shop.ufactory.cc/products/gripper-g2' },
  { id: 'bio-gripper-g2', name: 'BIO Gripper G2', opening: { mode: 'continuous', min: 71, max: 150, unit: 'mm' }, productUrl: 'https://www.shop.ufactory.cc/products/bio-gripper-g2' },
  { id: 'lite6-gripper', name: 'Gripper Lite', opening: { mode: 'binary', min: 0, max: 100 }, productUrl: 'https://docs.lite6.ufactory.cc/5.End-Effector.html#_5-1-gripper-lite' },
  { id: 'lite6-vacuum-gripper', name: 'Vacuum Gripper Lite', productUrl: 'https://docs.lite6.ufactory.cc/5.End-Effector.html#_5-2-vacuum-gripper-lite' },
];

export function getGripper(id: string | null | undefined): GripperSpec | undefined {
  return GRIPPERS.find(spec => spec.id === id);
}

export function supportsGripper(robotId: RobotId, gripperId: GripperId): boolean {
  const liteGripper = gripperId === 'lite6-gripper' || gripperId === 'lite6-vacuum-gripper';
  return (robotId === 'lite6') === liteGripper;
}

/** Binary grippers accept only their endpoints; continuous grippers use a 0.1 mm grid. */
export function validOpening(spec: GripperSpec, value: number): boolean {
  const opening = spec.opening;
  if (!opening || !Number.isFinite(value)) return false;
  if (opening.mode === 'binary') return value === opening.min || value === opening.max;
  return value >= opening.min && value <= opening.max && Math.abs(value * 10 - Math.round(value * 10)) < 1e-7;
}

// Fixed attachment of BIO base to each arm's flange, from the corresponding combination URDF.
const BIO_MOUNTS: Partial<Record<RobotId, { xyz: [number, number, number]; yaw: number }>> = {
  xarm5: { xyz: [0.026044, -0.000867, -0.000697], yaw: -0.00702875 },
  xarm6: { xyz: [0.027018, -0.000715, -0.000692], yaw: -0.00706128 },
  xarm7: { xyz: [0.026931, -0.000882, -0.000760], yaw: -0.00784664 },
  uf850: { xyz: [0.024657, 0, 0], yaw: 0 },
};

export function gripperMount(robotId: RobotId, id: GripperId): Pose {
  if (!supportsGripper(robotId, id)) throw new Error(`Unsupported gripper on ${robotId}`);
  if (id !== 'bio-gripper-g2') return { position: new Vector3(), quaternion: new Quaternion() };
  const mount = BIO_MOUNTS[robotId]!;
  return { position: new Vector3(...mount.xyz), quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), mount.yaw) };
}

/** Flange-to-TCP transform, independent of the opening and visual corrections. */
export function toolOffset(robotId: RobotId, id?: GripperId): Pose {
  if (!id) return { position: new Vector3(), quaternion: new Quaternion() };
  const mount = gripperMount(robotId, id);
  const localTcp = id === 'gripper-g2' ? new Vector3(0, 0, 0.1735)
    : id === 'bio-gripper-g2' ? new Vector3(0.135, 0, 0.055)
      : new Vector3(0, 0, id === 'lite6-gripper' ? 0.0836 : 0.061);
  return { position: localTcp.applyQuaternion(mount.quaternion).add(mount.position), quaternion: mount.quaternion.clone() };
}

/** Reference G2 parallel linkage calibrated to the inner pad gap in millimetres. */
export function g2Angle(openingMm: number): number {
  const radius = Math.hypot(35.465, 42.039);
  const phase = Math.atan2(42.039, 35.465);
  return Math.acos(Math.max(-1, Math.min(1, (openingMm / 2 - 35 + 26.00320242345333) / radius))) - phase;
}

export function bioFingerTravel(openingMm: number): number { return (openingMm - 71) / 2000; }
