import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Box3, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createGripperModel, gripperPartNames } from '../src/gripper-model';
import { getGripper } from '../src/grippers';

it('moves G2 actual GLB pad faces and parallel links at closed, middle and full opening', async () => {
  const spec = getGripper('gripper-g2')!;
  const loader = new GLTFLoader();
  const parts = Object.fromEntries(await Promise.all(gripperPartNames(spec).map(async name => {
    const bytes = readFileSync(`public/models/gripper-g2/${name}.glb`);
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return [name, (await loader.parseAsync(data, '')).scene] as const;
  })));
  const model = createGripperModel(spec, parts);
  for (const [opening, expectedLength] of [[0, 175.865270], [42, 175.280335], [84, 165.603791]]) {
    expect(model.setOpening(opening)).toBe(true);
    model.root.updateMatrixWorld(true);
    const left = new Box3().setFromObject(parts.left_finger);
    const right = new Box3().setFromObject(parts.right_finger);
    expect((left.min.y - right.max.y) * 1000).toBeCloseTo(opening, 2);
    expect(parts.left_finger.getWorldQuaternion(new Quaternion()).angleTo(parts.right_finger.getWorldQuaternion(new Quaternion()))).toBeLessThan(1e-7);
    expect(left.max.z).toBeCloseTo(right.max.z, 6);
    expect(left.max.z * 1000).toBeCloseTo(expectedLength, 2);
    expect(parts.left_inner_knuckle.parent!.rotation.x).toBeCloseTo(parts.left_outer_knuckle.parent!.rotation.x, 12);
    expect(parts.right_inner_knuckle.parent!.rotation.x).toBeCloseTo(parts.right_outer_knuckle.parent!.rotation.x, 12);
  }
  // Verify base flange X/Y centering (75.000 x 109.559 mm) and anodized aluminum flange material.
  const baseBounds = new Box3().setFromObject(parts.base);
  expect(baseBounds.min.x).toBeCloseTo(-0.0375, 5);
  expect(baseBounds.max.x).toBeCloseTo(0.0375, 5);
  expect(baseBounds.min.y).toBeCloseTo(-0.0547795, 5);
  expect(baseBounds.max.y).toBeCloseTo(0.0547795, 5);

  // Locate an actual mounting-face vertex; the locating boss itself extends below the flange.
  let faceVertex = false;
  let hasAnodizedFlange = false;
  let hasWhiteHousing = false;
  parts.base.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const mat = object.material as MeshStandardMaterial;
    if (Math.abs(mat.metalness - 0.8) < 1e-3 && Math.abs(mat.roughness - 0.640131) < 1e-3) {
      hasAnodizedFlange = true;
    } else if (mat.metalness === 0 && mat.roughness === 0.5) {
      hasWhiteHousing = true;
    }
    const vertices = object.geometry.getAttribute('position');
    const point = new Vector3();
    for (let i = 0; i < vertices.count; i++) {
      point.fromBufferAttribute(vertices, i).applyMatrix4(object.matrixWorld);
      if (Math.abs(point.z) < 0.00002 && point.x > 0.01 && point.y < -0.01) faceVertex = true;
    }
  });
  expect(faceVertex).toBe(true);
  expect(hasAnodizedFlange).toBe(true);
  expect(hasWhiteHousing).toBe(true);
  expect(model.setOpening(-0.1)).toBe(false);
  const before = new Box3().setFromObject(parts.left_finger).min.y;
  expect(model.setOpening(NaN)).toBe(false);
  expect(new Box3().setFromObject(parts.left_finger).min.y).toBe(before);
});
