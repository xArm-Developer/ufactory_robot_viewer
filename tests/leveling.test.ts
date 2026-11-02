// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Group, MathUtils, Vector3 } from 'three';
import URDFLoader, { type URDFRobot } from 'urdf-loader';
import { ROBOT_BASE_WORLD_ROTATION } from '../src/accessories';
import { CollisionDetector, type CollisionAssetManifest } from '../src/collision';
import { forward, homeJoints, jointNames, jointValues, limits, setJoints } from '../src/kinematics';
import { levelFlange } from '../src/leveling';
import { getRobotSpec, ROBOTS, type RobotId, type RobotSpec } from '../src/robots';

const DOWN = new Vector3(0, 0, -1);

function loadRobotModel(spec: RobotSpec): URDFRobot {
  const loader = new URDFLoader();
  loader.parseVisual = false;
  const model = loader.parse(readFileSync(`public/${spec.modelDir}${spec.urdfFile}`, 'utf8'));
  expect(setJoints(model, homeJoints(spec.dof))).toBe(true);
  return model;
}

function flangeTiltDeg(robot: URDFRobot, eeLink?: string): number {
  const pose = forward(robot, eeLink);
  const flangeZ = new Vector3(0, 0, 1).applyQuaternion(pose.quaternion).normalize();
  return MathUtils.radToDeg(Math.acos(MathUtils.clamp(flangeZ.dot(DOWN), -1, 1)));
}

function squaredChange(a: readonly number[], b: readonly number[]): number {
  return a.reduce((sum, value, i) => sum + (b[i] - value) ** 2, 0);
}

/** Deterministic PRNG for reproducible workspace coverage. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Coarse-to-fine brute-force search over the active two wrist joints (keeping
 * prefix joints and final flange-roll joint fixed) to verify global optimality.
 */
function bruteForceBestCost(robot: URDFRobot, eeLink: string, origin: readonly number[], grid = 140): number {
  const probe = robot.clone(true) as URDFRobot;
  const bounds = limits(probe);
  const iA = origin.length - 3;
  const iB = origin.length - 2;
  let bestCost = Infinity;
  let bestPair: [number, number] | undefined;

  const sampleWindow = (minA: number, maxA: number, minB: number, maxB: number, steps: number) => {
    const candidate = [...origin];
    for (let a = 0; a <= steps; a++) {
      candidate[iA] = minA + ((maxA - minA) * a) / steps;
      for (let b = 0; b <= steps; b++) {
        candidate[iB] = minB + ((maxB - minB) * b) / steps;
        const cost = (candidate[iA] - origin[iA]) ** 2 + (candidate[iB] - origin[iB]) ** 2;
        if (cost >= bestCost) continue;
        setJoints(probe, candidate);
        if (flangeTiltDeg(probe, eeLink) <= 0.1) {
          bestCost = cost;
          bestPair = [candidate[iA], candidate[iB]];
        }
      }
    }
  };

  sampleWindow(bounds[iA].min, bounds[iA].max, bounds[iB].min, bounds[iB].max, grid);
  if (bestPair) {
    const spanA = (bounds[iA].max - bounds[iA].min) / grid;
    const spanB = (bounds[iB].max - bounds[iB].min) / grid;
    sampleWindow(
      Math.max(bounds[iA].min, bestPair[0] - 2 * spanA),
      Math.min(bounds[iA].max, bestPair[0] + 2 * spanA),
      Math.max(bounds[iB].min, bestPair[1] - 2 * spanB),
      Math.min(bounds[iB].max, bestPair[1] + 2 * spanB),
      60,
    );
  }
  return bestCost;
}

const SAMPLE_POSES: Record<RobotId, number[][]> = {
  xarm5: [
    [0.5, -0.65, -0.4, 0.9, -1.2],
    [-1.4, 0.85, -1.5, 1.2, 2.5],
    [2.1, -1.3, 0.15, -0.8, 0.4],
    // Near J3 upper limit where the -2π periodic branch has lower squared cost than k=0.
    [0, -2.05, 0.19198, -1.25, 0.7],
    // Near J4 upper limit forcing asymmetric split onto J3.
    [-0.7, 1.2, -0.2, 3.05, -0.9],
  ],
  xarm6: [
    [0.6, -0.5, -0.8, 0.9, 0.7, -1.5],
    [-1.2, 0.7, -1.3, -2.6, 1.4, 2.2],
    // J4 near +2π where the +2π equivalent branch is much closer than 0.
    [0.4, -0.45, -0.65, 5.9, 0.6, -0.8],
    // J4 near -2π and J5 near upper limit.
    [-0.9, -0.8, -1.1, -5.8, 2.9, 1.1],
    // J5 near negative limit (-1.69297) requiring wrist flip if direct branch exceeds limit.
    [0.3, 0.95, -0.1, 0.2, -1.6, 0.5],
  ],
  xarm7: [
    [0.5, -0.55, 0.8, 0.9, -1.1, 0.85, -1.4],
    [-1.1, 0.6, -2.1, 1.5, 5.75, 1.1, 2.4],
    [1.8, -0.9, 3.4, 2.1, -5.9, -1.4, -0.6],
    [-0.4, 0.75, -0.9, 0.6, 0.15, 2.95, 0.3],
    [0.2, -0.3, 4.9, 1.2, 2.8, -1.55, -2.7],
  ],
  uf850: [
    [0.45, -0.55, -0.9, 0.8, 0.7, -1.1],
    [-1.3, -0.8, -1.4, 5.85, -0.9, 1.9],
    [0.9, 0.35, -1.2, -5.7, 1.4, -0.5],
    [-0.6, -0.25, -0.7, 2.9, -2.05, 0.8],
  ],
  lite6: [
    [0.5, 0.4, 0.8, 0.9, 0.65, -1.2],
    [-1.2, 0.65, 1.3, 5.8, -0.95, 2.1],
    [1.4, -0.35, 0.6, -5.85, 1.35, -0.7],
    [-0.5, 0.25, 0.95, -2.7, 2.05, 0.4],
  ],
};

describe('flange leveling & initial home targets across all 5 arms', () => {
  for (const spec of ROBOTS) {
    describe(`${spec.name} (${spec.id})`, () => {
      it('returns all joints to 0° at home with flange +Z aligned to base -Z within 0.1°', () => {
        const robot = loadRobotModel(spec);
        expect(setJoints(robot, SAMPLE_POSES[spec.id][0])).toBe(true);
        const home = homeJoints(spec.dof);
        expect(home).toEqual(Array.from({ length: spec.dof }, () => 0));
        expect(setJoints(robot, home)).toBe(true);
        expect(jointValues(robot)).toEqual(home);
        expect(flangeTiltDeg(robot, spec.eeLink)).toBeLessThanOrEqual(0.1);
      });

      it('preserves exact joint angles when flange is already level within <= 0.1°', () => {
        const robot = loadRobotModel(spec);
        const home = homeJoints(spec.dof);
        expect(levelFlange(robot, spec.eeLink)).toEqual(home);

        // Rotate one of the wrist pitch joints by 0.08° (<= 0.1°) and spin the last joint arbitrarily.
        const slightlyTilted = [...home];
        slightlyTilted[spec.dof - 2] = MathUtils.degToRad(0.08);
        slightlyTilted[spec.dof - 1] = 1.75;
        expect(setJoints(robot, slightlyTilted)).toBe(true);
        expect(flangeTiltDeg(robot, spec.eeLink)).toBeLessThanOrEqual(0.1);

        const unchanged = levelFlange(robot, spec.eeLink);
        expect(unchanged).toEqual(slightlyTilted);
        expect(jointValues(robot)).toEqual(slightlyTilted);

        // Tilting beyond 0.1° (e.g. 0.18°) triggers leveling back within 0.1°.
        const unlevel = [...home];
        unlevel[spec.dof - 2] = MathUtils.degToRad(0.18);
        unlevel[spec.dof - 1] = 1.75;
        expect(setJoints(robot, unlevel)).toBe(true);
        expect(flangeTiltDeg(robot, spec.eeLink)).toBeGreaterThan(0.1);
        const leveled = levelFlange(robot, spec.eeLink);
        expect(leveled).toBeDefined();
        expect(jointValues(robot)).toEqual(unlevel);
        expect(setJoints(robot, leveled!)).toBe(true);
        expect(flangeTiltDeg(robot, spec.eeLink)).toBeLessThanOrEqual(0.1);
      });

      it('adjusts only the last three joints without mutating the robot and minimizes squared joint delta', () => {
        const robot = loadRobotModel(spec);
        const jointBounds = limits(robot);

        for (const origin of SAMPLE_POSES[spec.id]) {
          expect(setJoints(robot, origin)).toBe(true);
          const beforePose = forward(robot, spec.eeLink);

          const target = levelFlange(robot, spec.eeLink);
          expect(target).toBeDefined();

          // Pure solver: robot state is untouched during/after solving.
          expect(jointValues(robot)).toEqual(origin);
          const afterSolvePose = forward(robot, spec.eeLink);
          expect(afterSolvePose.position.distanceTo(beforePose.position)).toBeLessThan(1e-12);
          expect(afterSolvePose.quaternion.angleTo(beforePose.quaternion)).toBeLessThan(1e-12);

          // Prefix joints (0 .. dof - 4) and final flange-spin joint (dof - 1) remain untouched.
          for (let i = 0; i < spec.dof - 3; i++) {
            expect(target![i]).toBe(origin[i]);
          }
          expect(target![spec.dof - 1]).toBe(origin[spec.dof - 1]);

          // All joints are within URDF limits and achieve <= 0.1° flange tilt.
          target!.forEach((angle, i) => {
            expect(angle).toBeGreaterThanOrEqual(jointBounds[i].min - 1e-12);
            expect(angle).toBeLessThanOrEqual(jointBounds[i].max + 1e-12);
          });
          expect(setJoints(robot, target!)).toBe(true);
          expect(flangeTiltDeg(robot, spec.eeLink)).toBeLessThanOrEqual(0.1);

          // Matches or beats dense brute-force search on sum of squared joint angle changes.
          const solverCost = squaredChange(origin, target!);
          const gridBest = bruteForceBestCost(robot, spec.eeLink, origin);
          expect(solverCost).toBeLessThanOrEqual(gridBest + 1e-3);
        }
      });

      it('finds optimal solutions across randomized legal configurations', () => {
        const robot = loadRobotModel(spec);
        const jointBounds = limits(robot);
        const rand = mulberry32(spec.id.split('').reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 7));

        for (let trial = 0; trial < 12; trial++) {
          const origin = jointBounds.map(({ min, max }) => min + (max - min) * (0.05 + 0.9 * rand()));
          expect(setJoints(robot, origin)).toBe(true);
          const target = levelFlange(robot, spec.eeLink);
          expect(jointValues(robot)).toEqual(origin);

          const gridBest = bruteForceBestCost(robot, spec.eeLink, origin, 100);
          if (!target) {
            expect(gridBest).toBe(Infinity);
            continue;
          }
          for (let i = 0; i < spec.dof - 3; i++) {
            expect(target[i]).toBe(origin[i]);
          }
          expect(target[spec.dof - 1]).toBe(origin[spec.dof - 1]);
          expect(setJoints(robot, target)).toBe(true);
          expect(flangeTiltDeg(robot, spec.eeLink)).toBeLessThanOrEqual(0.1);
          expect(squaredChange(origin, target)).toBeLessThanOrEqual(gridBest + 2e-3);
        }
      });
    });
  }

  it('beats the k=0 branch on xArm 5 parallel joints when an adjacent ±2π branch has smaller squared delta', () => {
    const spec = getRobotSpec('xarm5');
    const robot = loadRobotModel(spec);
    const origin = [0, -2.05, 0.19198, -1.25, 0.4];
    expect(setJoints(robot, origin)).toBe(true);

    const target = levelFlange(robot, spec.eeLink);
    expect(target).toBeDefined();
    expect(jointValues(robot)).toEqual(origin);
    // k = 0 requires Δ(q3+q4) ≈ +3.11 rad, where J3 is already at its upper limit 0.19198,
    // forcing all +3.11 rad onto J4 (cost ≈ 9.66). The -2π branch splits Δ ≈ -3.17 rad across J3 and J4 (cost ≈ 7.66).
    expect(squaredChange(origin, target!)).toBeLessThan(8.0);
    expect(setJoints(robot, target!)).toBe(true);
    expect(flangeTiltDeg(robot, spec.eeLink)).toBeLessThanOrEqual(0.1);
  });

  it('returns undefined without altering the robot when leveling is unreachable within joint limits', () => {
    // Lite 6 and 850 have ±124° (±2.1642 rad) J5 limits, so steep upward forearm pitches cannot level.
    const naturalUnreachable: Array<[RobotId, number[]]> = [
      ['lite6', [0.2, 0, MathUtils.degToRad(150), 0.3, 0.4, -0.2]],
      ['uf850', [-0.3, 1.0, -3.1, 0.4, -0.5, 0.25]],
    ];
    for (const [id, pose] of naturalUnreachable) {
      const spec = getRobotSpec(id);
      const robot = loadRobotModel(spec);
      expect(setJoints(robot, pose)).toBe(true);
      expect(bruteForceBestCost(robot, spec.eeLink, pose, 140)).toBe(Infinity);
      expect(levelFlange(robot, spec.eeLink)).toBeUndefined();
      expect(jointValues(robot)).toEqual(pose);
    }

    // Also verify unreachable limit handling on xArm 5, xArm 6, and xArm 7 with tightened wrist limits.
    const constrainedUnreachable: Array<[RobotId, number[], string, number, number]> = [
      ['xarm5', [0.3, 1.4, -0.3, -0.2, 0.1], 'joint3', -0.4, 0.1],
      ['xarm6', [0.2, 1.35, -0.1, 0.2, 0.1, -0.3], 'joint5', -0.3, 0.3],
      ['xarm7', [-0.2, 1.35, 0.1, 0.2, 0.3, 0.1, 0.4], 'joint6', -0.3, 0.3],
    ];
    for (const [id, pose, restrictedJoint, lower, upper] of constrainedUnreachable) {
      const spec = getRobotSpec(id);
      const robot = loadRobotModel(spec);
      if (id === 'xarm5') {
        robot.joints.joint4.limit.lower = -0.3;
        robot.joints.joint4.limit.upper = 0.1;
      }
      robot.joints[restrictedJoint].limit.lower = lower;
      robot.joints[restrictedJoint].limit.upper = upper;
      expect(setJoints(robot, pose)).toBe(true);
      expect(levelFlange(robot, spec.eeLink)).toBeUndefined();
      expect(jointValues(robot)).toEqual(pose);
    }
  });

  it('produces identical target angles when mounted on the rotated linear rail carriage', () => {
    for (const id of ['xarm5', 'xarm6', 'xarm7'] as const) {
      const spec = getRobotSpec(id);
      const standalone = loadRobotModel(spec);
      const mounted = loadRobotModel(spec);
      const carriage = new Group();
      carriage.position.set(0.35, -0.12, 0.09);
      carriage.quaternion.copy(ROBOT_BASE_WORLD_ROTATION);
      carriage.add(mounted);
      carriage.updateMatrixWorld(true);

      const pose = SAMPLE_POSES[id][0];
      expect(setJoints(standalone, pose)).toBe(true);
      expect(setJoints(mounted, pose)).toBe(true);
      carriage.updateMatrixWorld(true);

      const expected = levelFlange(standalone, spec.eeLink);
      const actual = levelFlange(mounted, spec.eeLink);
      expect(actual).toBeDefined();
      actual!.forEach((angle, index) => {
        expect(angle).toBeCloseTo(expected![index], 7);
      });
    }

    // Degenerate robot with fewer than 3 joints returns undefined safely.
    const shortRobot = loadRobotModel(getRobotSpec('xarm5'));
    for (const name of jointNames(shortRobot).slice(2)) {
      delete shortRobot.joints[name];
    }
    expect(levelFlange(shortRobot, 'link5')).toBeUndefined();
  });

  it('converges to the exact same optimal target under repeated 1° single-step clicks on all 5 arms', () => {
    const oneDeg = MathUtils.degToRad(1);
    for (const spec of ROBOTS) {
      const robot = loadRobotModel(spec);
      const start = SAMPLE_POSES[spec.id][0];
      expect(setJoints(robot, start)).toBe(true);
      const directTarget = levelFlange(robot, spec.eeLink)!;
      expect(directTarget).toBeDefined();

      let steps = 0;
      while (steps < 400) {
        const cur = jointValues(robot);
        const stepTarget = levelFlange(robot, spec.eeLink)!;
        expect(stepTarget).toBeDefined();
        stepTarget.forEach((angle, i) => expect(angle).toBeCloseTo(directTarget[i], 6));
        const deltas = stepTarget.map((goal, i) => goal - cur[i]);
        const maxDelta = Math.max(0, ...deltas.map(Math.abs));
        if (maxDelta <= 1e-9) break;
        const ratio = Math.min(1, oneDeg / maxDelta);
        expect(setJoints(robot, cur.map((angle, i) => angle + deltas[i] * ratio))).toBe(true);
        steps++;
      }
      expect(steps).toBeGreaterThan(1);
      expect(flangeTiltDeg(robot, spec.eeLink)).toBeLessThanOrEqual(0.1);
      jointValues(robot).forEach((angle, i) => expect(angle).toBeCloseTo(directTarget[i], 6));
    }
  });

  it('intercepts mid-trajectory collisions within 1° steps for both home and level motions', () => {
    const spec = getRobotSpec('xarm6');
    const arm = loadRobotModel(spec);
    const armMan = JSON.parse(readFileSync('public/models/xarm6/collision.json', 'utf8')) as CollisionAssetManifest;

    const detector = new CollisionDetector();
    detector.registerArmManifest(armMan, arm.links, 6);
    detector.setExclusionOptions({ armDof: 6, hasSensor: false });

    const hitsAt = (deg: readonly number[]) => {
      expect(setJoints(arm, deg.map(MathUtils.degToRad))).toBe(true);
      arm.updateMatrixWorld(true);
      return detector.detect();
    };

    const jogSequence = (steps: ReadonlyArray<readonly [number, number]>) => {
      const cur = [0, 0, 0, 0, 0, 0];
      for (const [idx, goal] of steps) {
        const dir = goal >= cur[idx] ? 1 : -1;
        while (cur[idx] !== goal) {
          cur[idx] += dir;
          if (hitsAt(cur).length > 0) {
            throw new Error(`Jog blocked at J${idx + 1}=${cur[idx]}° (${JSON.stringify(cur)})`);
          }
        }
      }
      return cur;
    };

    // 1. Home mid-trajectory self-collision:
    // At J4 = 360° (≡ 0°), J5 = -95° swings outward safely; linear interpolation back to [0..0]
    // passes through J4 = 180°, J5 ≈ -48° which folds the wrist inward into the arm/base!
    // Combine with J2 = 25°, J3 = -25° so link6 sweeps directly into link_base/link2 at J4 = 180°:
    const homeStart = jogSequence([[1, 25], [2, -25], [3, 355], [4, -95]]);
    let homeBlockedAt: number[] | undefined;
    const homeSteps = Math.ceil(Math.max(...homeStart.map(Math.abs)));
    for (let s = 1; s <= homeSteps; s++) {
      const next = homeStart.map(v => v * (1 - s / homeSteps));
      if (hitsAt(next).length > 0) {
        homeBlockedAt = homeStart.map(v => v * (1 - (s - 1) / homeSteps));
        break;
      }
    }
    expect(homeBlockedAt).toBeDefined();
    expect(hitsAt(homeBlockedAt!)).toEqual([]);

    // 2. Level mid-trajectory self-collision:
    // Open J3 = -25° so J4 can rotate to 120° with J5 = -60° tilted clear of link2, then return J3 = 0°;
    // leveling keeps J4 = 120° (ΔJ4 = 0 minimizes squared delta!) and drives J5 toward 0° straight into link2!
    const levelStart = jogSequence([[2, -25], [3, 120], [4, -60], [2, -3]]);
    const levelGoal = levelFlange(arm, spec.eeLink)!.map(MathUtils.radToDeg);
    let levelBlockedAt: number[] | undefined;
    const levelSteps = Math.ceil(Math.max(...levelGoal.map((g, i) => Math.abs(g - levelStart[i]))));
    for (let s = 1; s <= levelSteps; s++) {
      const next = levelStart.map((v, i) => v + ((levelGoal[i] - v) * s) / levelSteps);
      if (hitsAt(next).length > 0) {
        levelBlockedAt = levelStart.map((v, i) => v + ((levelGoal[i] - v) * (s - 1)) / levelSteps);
        break;
      }
    }
    expect(levelBlockedAt).toBeDefined();
    expect(hitsAt(levelBlockedAt!)).toEqual([]);
  });
});
