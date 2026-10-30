import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Group, Mesh, MeshStandardMaterial } from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { createGripperModel } from '../src/gripper-model';
import { getGripper } from '../src/grippers';

it('uses the source meshes and moves the two fingers symmetrically between the two endpoints', () => {
  for (const directory of ['lite6-gripper', 'lite6-vacuum-gripper']) {
    const sums = readFileSync(`public/models/${directory}/SHA256SUMS`, 'utf8').trim().split('\n');
    for (const line of sums) {
      const [expected, file] = line.split(/\s+/);
      expect(createHash('sha256').update(readFileSync(`public/models/${directory}/${file}`)).digest('hex')).toBe(expected);
    }
  }
  const loadFinger = (name: string) => {
    const bytes = readFileSync(`public/models/lite6-gripper/${name}.stl`);
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Mesh(new STLLoader().parse(data), new MeshStandardMaterial());
  };
  const finger1 = loadFinger('finger1');
  const finger2 = loadFinger('finger2');
  expect(finger1.geometry.getAttribute('position').count).toBeGreaterThan(0);
  expect(finger2.geometry.getAttribute('position').count).toBeGreaterThan(0);
  const model = createGripperModel(getGripper('lite6-gripper')!, { shell: new Group(), finger1, finger2 });
  for (const opening of [0, 100]) {
    expect(model.setOpening(opening)).toBe(true);
    expect(finger1.position.z).toBeCloseTo(0.0543, 10);
    expect(finger2.position.z).toBeCloseTo(0.0543, 10);
    expect(finger1.position.y).toBeCloseTo(opening === 100 ? 0.0089 : 0, 10);
    expect(finger2.position.y).toBeCloseTo(opening === 100 ? -0.0089 : 0, 10);
  }
  for (const invalid of [0.1, 50, 99.9, 100.1]) expect(model.setOpening(invalid)).toBe(false);
  expect(finger1.position.y).toBeCloseTo(0.0089, 10);
  expect(finger2.position.y).toBeCloseTo(-0.0089, 10);
  const vacuum = createGripperModel(getGripper('lite6-vacuum-gripper')!, { vacuum: new Group() });
  expect(vacuum.setOpening(0)).toBe(false);
});
