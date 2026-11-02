import { RAIL_SPEC, SENSOR_SPEC, supportsLinearRail, supportsSensor, validRailPosition } from './accessories';
import { getGripper, supportsGripper, validOpening, type GripperId } from './grippers';
import { ROBOTS, type RobotId } from './robots';
import type { RPY } from './kinematics';

export const SCENE_STORAGE_KEY = 'uf-robots:scene';
export const SCENE_VERSION = 1;
const SAVE_INTERVAL_MS = 200;

/** Joint angles and TCP RPY are radians; rail travel and gripper opening are millimetres. */
export interface SceneSnapshot {
  version: typeof SCENE_VERSION;
  robot: RobotId;
  joints: number[];
  rail: typeof RAIL_SPEC.id | null;
  railMm: number;
  sensor: typeof SENSOR_SPEC.id | null;
  gripper: GripperId | null;
  opening: number | null;
  tcpRpy?: RPY;
}

/** Validate the self-contained parts of a record before loading any assets. */
export function parseSceneSnapshot(raw: string): SceneSnapshot | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const data = value as Record<string, unknown>;
    const robot = ROBOTS.find(item => item.id === data.robot);
    if (data.version !== SCENE_VERSION || !robot || !Array.isArray(data.joints) || data.joints.length !== robot.dof ||
        !data.joints.every(angle => typeof angle === 'number' && Number.isFinite(angle))) return null;
    if (data.rail !== null && (data.rail !== RAIL_SPEC.id || !supportsLinearRail(robot.id))) return null;
    if (typeof data.railMm !== 'number' || !validRailPosition(data.railMm) || (data.rail === null && data.railMm !== 0)) return null;
    if (data.sensor !== null && (data.sensor !== SENSOR_SPEC.id || !supportsSensor(robot.id))) return null;
    if (data.gripper !== null && typeof data.gripper !== 'string') return null;
    const gripper = getGripper(data.gripper as string | null);
    if (data.gripper !== null && (!gripper || !supportsGripper(robot.id, gripper.id))) return null;
    if (gripper?.opening) {
      if (typeof data.opening !== 'number' || !validOpening(gripper, data.opening)) return null;
    } else if (data.opening !== null) return null;
    const tcpRpy = Array.isArray(data.tcpRpy) && data.tcpRpy.length === 3 &&
      data.tcpRpy.every(angle => typeof angle === 'number' && Number.isFinite(angle))
      ? [...data.tcpRpy] as RPY : undefined;
    return {
      version: SCENE_VERSION,
      robot: robot.id,
      joints: [...data.joints] as number[],
      rail: data.rail as SceneSnapshot['rail'],
      railMm: data.railMm,
      sensor: data.sensor as SceneSnapshot['sensor'],
      gripper: gripper?.id ?? null,
      opening: data.opening as number | null,
      ...(tcpRpy ? { tcpRpy } : {}),
    };
  } catch {
    return null;
  }
}

export type SceneReadResult =
  | { kind: 'empty' | 'invalid' | 'unavailable' }
  | { kind: 'valid'; snapshot: SceneSnapshot };

/** Keep only complete snapshots. A pending write never reads mutable scene state. */
export class SceneStorage {
  private pending: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastAttempt = -Infinity;
  private notified = false;

  constructor(private storage: () => Storage, private onUnavailable: () => void) {}

  read(): SceneReadResult {
    try {
      const raw = this.storage().getItem(SCENE_STORAGE_KEY);
      if (raw === null) return { kind: 'empty' };
      const snapshot = parseSceneSnapshot(raw);
      return snapshot ? { kind: 'valid', snapshot } : { kind: 'invalid' };
    } catch {
      this.notifyUnavailable();
      return { kind: 'unavailable' };
    }
  }

  queue(snapshot: SceneSnapshot): void {
    this.pending = JSON.stringify(snapshot);
    const remaining = SAVE_INTERVAL_MS - (performance.now() - this.lastAttempt);
    if (remaining <= 0) this.flush();
    else if (this.timer === undefined) this.timer = setTimeout(() => this.flush(), remaining);
  }

  /** On stop/hide, flush only a changed snapshot; an idle tab must not overwrite another tab. */
  flush(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending === undefined) return;
    const data = this.pending;
    this.lastAttempt = performance.now();
    try {
      this.storage().setItem(SCENE_STORAGE_KEY, data);
      if (this.pending === data) this.pending = undefined;
    } catch {
      this.notifyUnavailable();
    }
  }

  private notifyUnavailable(): void {
    if (this.notified) return;
    this.notified = true;
    this.onUnavailable();
  }
}
