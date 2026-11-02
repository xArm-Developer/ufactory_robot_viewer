import { describe, expect, it } from 'vitest';
import { MathUtils, Vector3 } from 'three';
import { fromRPY, stepBasePose, toRPY, type RPY } from '../src/kinematics';

const rad = MathUtils.degToRad;

function expectSameRotation(actual: RPY, expected: RPY, tolerance = 1e-7) {
  expect(fromRPY(...actual).angleTo(fromRPY(...expected))).toBeLessThan(tolerance);
}

describe('continuous fixed-axis RPY', () => {
  it.each([1, -1])('crosses %s90° repeatedly, with nonzero roll and yaw, in both directions', sign => {
    let reference: RPY = [rad(37), rad(sign * 70), rad(-58)];
    const pitches = [80, 89.9, 90, 90.1, 110, 170, 190, 270, 300, 270, 190, 110, 90.1, 90, 89.9, 70];
    for (const degrees of pitches) {
      const expected: RPY = [rad(37), rad(sign * degrees), rad(-58)];
      const actual = toRPY(fromRPY(...expected), reference);
      actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 7));
      expectSameRotation(actual, expected);
      reference = actual;
    }
  });

  it.each([1, -1])('preserves the nearest roll and yaw at the exact %s90° singularity', sign => {
    const pose: RPY = [rad(47), sign * Math.PI / 2, rad(123)];
    const q = fromRPY(...pose);
    const reference: RPY = [pose[0] + 0.4, pose[1] + 2 * Math.PI, pose[2] - sign * 0.2];
    const actual = toRPY(q, reference);
    const invariantCorrection = sign * 0.6;
    expect(actual[0]).toBeCloseTo(reference[0] - sign * invariantCorrection / 2, 10);
    expect(actual[1]).toBeCloseTo(reference[1], 10);
    expect(actual[2]).toBeCloseTo(reference[2] + invariantCorrection / 2, 10);
    expectSameRotation(actual, pose);
    expectSameRotation(toRPY(q), pose);
  });

  it('reconstructs orientations very close to the singularity without zeroing roll', () => {
    for (const sign of [-1, 1]) {
      for (const offset of [-1e-7, 1e-7]) {
        const expected: RPY = [0.75, sign * Math.PI / 2 + offset, -1.3];
        const actual = toRPY(fromRPY(...expected), expected);
        expectSameRotation(actual, expected);
        expect(actual[0]).toBeCloseTo(expected[0], 7);
        expect(actual[2]).toBeCloseTo(expected[2], 7);
      }
    }
  });

  it('unwraps all three axes across full turns and applies short steps on the selected branch', () => {
    const start: RPY = [rad(415), rad(125), rad(-405)];
    const pose = { position: new Vector3(0.1, 0.2, 0.3), quaternion: fromRPY(...start) };
    expect(toRPY(pose.quaternion, start)).toEqual(start.map(value => expect.closeTo(value, 10)));
    for (const axis of ['roll', 'pitch', 'yaw'] as const) {
      const target = stepBasePose(pose, axis, 1, start);
      const expected: RPY = [...start];
      expected[['roll', 'pitch', 'yaw'].indexOf(axis)] += rad(1);
      expectSameRotation(toRPY(target.quaternion, expected), expected);
      expect(target.position.toArray()).toEqual(pose.position.toArray());
    }
  });

  it('prevents 1/cos(pitch) amplification of URDF/IK numerical residuals near ±90° gimbal lock', () => {
    for (const sign of [1, -1] as const) {
      let tcpRpy: RPY = [rad(180), rad(sign * 88.5), 0];
      // Simulate 6 release-and-repress holds of 0.5 deg across ±90°, with a 1e-4 rad transverse IK residual
      for (let hold = 0; hold < 6; hold++) {
        const nextRpy: RPY = [tcpRpy[0], tcpRpy[1] + rad(sign * 0.5), tcpRpy[2]];
        const noisyQuat = fromRPY(nextRpy[0] + 1e-4, nextRpy[1], nextRpy[2] - 1e-4);
        tcpRpy = toRPY(noisyQuat, nextRpy);
        expect(Math.abs(tcpRpy[0] - rad(180))).toBeLessThan(rad(0.05));
        expect(Math.abs(tcpRpy[2])).toBeLessThan(rad(0.05));
      }
      expect(tcpRpy[1]).toBeCloseTo(rad(sign * 91.5), 2);
    }
  });
});
