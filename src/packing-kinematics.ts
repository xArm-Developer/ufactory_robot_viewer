import config from './packing-config.json' with { type: 'json' };

/** Closed-form xArm 6 solution for the example's fixed, downward tool orientation.
 * Dimensions are taken from the xArm 6 URDF and the 161.3 mm workpiece-centre site.
 */
export function packingJoints(x: number, y: number, z: number): number[] | undefined {
  const a = 0.0535, b = 0.2845, c = 0.0775, d = 0.3425;
  const first = Math.hypot(a, b), second = Math.hypot(c, d);
  const angle1 = Math.atan2(b, a), angle2 = Math.atan2(-d, c);
  const radius = Math.hypot(x, y) - 0.076;
  const height = z - (0.267 - 0.097 - config.gripper.graspSite);
  const cosine = (radius * radius + height * height - first * first - second * second) / (2 * first * second);
  if (!Number.isFinite(cosine) || cosine < -1 || cosine > 1) return undefined;
  const relative = -Math.acos(cosine);
  const joint3 = angle2 - angle1 - relative;
  const joint2 = angle1 - Math.atan2(height, radius) + Math.atan2(second * Math.sin(relative), first + second * Math.cos(relative));
  const joint1 = Math.atan2(y, x);
  const joint5 = -joint2 - joint3;
  if (joint2 < -2.059 || joint2 > 2.0944 || joint3 < -3.927 || joint3 > .19198 || joint5 < -1.69297 || joint5 > 3.14159) return undefined;
  return [joint1, joint2, joint3, 0, joint5, joint1];
}
