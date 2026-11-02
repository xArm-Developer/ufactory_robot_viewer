import { assemblyToolOffset } from './accessories';
import type { GripperId } from './grippers';
import type { RobotSpec } from './robots';
import data from './reach-data.json';

type ReachCombination = {
  sensor: boolean;
  gripperId: string | null;
  radiusM: number;
  tcp: { position: number[]; quaternion: number[] };
};
type ReachRobot = { eeLink: string; dof: number; combinations: ReachCombination[] };

/** Return a radius only for an exact, still-current model and TCP configuration. */
export function reachRadius(spec: RobotSpec, sensor: boolean, gripperId?: GripperId): number | undefined {
  const robot = (data.robots as Partial<Record<string, ReachRobot>>)[spec.id];
  if (!robot || robot.eeLink !== spec.eeLink || robot.dof !== spec.dof || !Array.isArray(robot.combinations)) return undefined;
  const matches = robot.combinations.filter(item => item.sensor === sensor && item.gripperId === (gripperId ?? null));
  if (matches.length !== 1) return undefined;
  const result = matches[0];
  if (!Number.isFinite(result.radiusM) || result.radiusM <= 0) return undefined;
  try {
    const tcp = assemblyToolOffset(spec.id, { sensor, gripperId });
    const matchesVector = (actual: number[], saved: number[]) =>
      actual.length === saved.length && actual.every((value, i) => Number.isFinite(saved[i]) && Math.abs(value - saved[i]) < 1e-10);
    if (!matchesVector(tcp.position.toArray(), result.tcp.position) || !matchesVector(tcp.quaternion.toArray(), result.tcp.quaternion)) return undefined;
  } catch {
    return undefined;
  }
  return result.radiusM;
}
