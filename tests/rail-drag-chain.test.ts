// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { BufferAttribute, DynamicDrawUsage, Group, Matrix4, Mesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { RailDragChain } from '../src/rail-drag-chain';

async function loadChain() {
  const bytes = new Uint8Array(readFileSync('public/models/al0700/model.glb'));
  const { scene } = await new GLTFLoader().parseAsync(bytes.buffer, '');
  const fixedRail = scene.getObjectByName('rail_fixed')!;
  const mesh = fixedRail.getObjectByName('part_35') as Mesh;
  const positions = mesh.geometry.getAttribute('position') as BufferAttribute;
  const original = new Float32Array(positions.array);
  return { mesh, positions, original, chain: new RailDragChain(fixedRail) };
}

function findVertex(original: Float32Array, predicate: (y: number, z: number) => boolean): number {
  for (let i = 0; i < original.length / 3; i++) {
    if (predicate(original[i * 3 + 1], original[i * 3 + 2])) return i;
  }
  throw new Error('Expected CAD landmark not found');
}

function zAt(array: ArrayLike<number>, i: number): number {
  return array[i * 3 + 2];
}

describe('AL0700 drag chain', () => {
  it('keeps both ends attached and the bend and estimated centreline length unchanged', async () => {
    const { mesh, positions, original, chain } = await loadChain();
    const bend = findVertex(original, (_y, z) => z < 0.09);
    const fixedEnd = findVertex(original, (y, z) => y < 0 && z > 0.32);
    const movingEnd = findVertex(original, (y, z) => y > 0.03 && z > 0.32);
    const normals = mesh.geometry.getAttribute('normal') as BufferAttribute;
    const originalNormal = new Float32Array(normals.array);
    const originalBendZ = zAt(original, bend);
    const originalFixedZ = zAt(original, fixedEnd);
    const originalMovingZ = zAt(original, movingEnd);
    const originalStraightSum = originalFixedZ + originalMovingZ - 2 * 0.12437742;
    const originalRadius = 0.0275;
    const originalLength = originalStraightSum + Math.PI * originalRadius;
    const normalVersion = normals.version;
    const versionBefore = positions.version;

    mesh.updateWorldMatrix(true, false);
    expect(mesh.matrixWorld.equals(new Matrix4())).toBe(true);
    expect(positions.usage).toBe(DynamicDrawUsage);
    expect(originalLength).toBeCloseTo(0.48, 2);
    for (const mm of [0, 0.1, 350, 699.9, 700, 0, 350]) {
      chain.setPosition(mm);
      const values = positions.array;
      const bendOffset = -0.22 - mm / 2000;
      expect(zAt(values, bend) - originalBendZ).toBeCloseTo(bendOffset, 6);
      expect(zAt(values, fixedEnd)).toBeCloseTo(originalFixedZ, 6);
      expect(zAt(values, movingEnd) - originalMovingZ).toBeCloseTo(-mm / 1000, 6);

      const bendStart = 0.12437742 + bendOffset;
      const fixedStraight = zAt(values, fixedEnd) - bendStart;
      const movingStraight = zAt(values, movingEnd) - bendStart;
      const extendedLength = fixedStraight + movingStraight + Math.PI * originalRadius;
      expect(fixedStraight).toBeGreaterThan(0);
      expect(movingStraight).toBeGreaterThan(0);
      expect(extendedLength).toBeCloseTo(originalLength + 0.44, 6);
      expect(extendedLength).toBeCloseTo(0.92, 2);

      for (let i = 0; i < positions.count; i++) {
        expect(positions.getX(i)).toBe(original[i * 3]);
        expect(positions.getY(i)).toBe(original[i * 3 + 1]);
        // All bend vertices undergo the same translation, preserving the original radius.
        if (zAt(original, i) < 0.1243774) {
          expect(positions.getZ(i) - zAt(original, i)).toBeCloseTo(bendOffset, 6);
        } else if (zAt(original, i) >= 0.29) {
          const endOffset = original[i * 3 + 1] > 0.0104962 ? -mm / 1000 : 0;
          expect(positions.getZ(i) - zAt(original, i)).toBeCloseTo(endOffset, 6);
        }
        const point = new Vector3().fromBufferAttribute(positions, i);
        expect(mesh.geometry.boundingBox!.containsPoint(point)).toBe(true);
        expect(point.distanceTo(mesh.geometry.boundingSphere!.center)).toBeLessThanOrEqual(mesh.geometry.boundingSphere!.radius + 1e-8);
      }
    }
    expect(positions.version).toBeGreaterThan(versionBefore);
    expect(normals.version).toBe(normalVersion);
    expect(normals.array).toEqual(originalNormal);
  });

  it('keeps all real mesh triangles nondegenerate and correctly oriented at each millimetre of travel', async () => {
    const { mesh, positions, original, chain } = await loadChain();
    const indices = mesh.geometry.getIndex()!;
    expect(indices.count / 3).toBe(964);

    function normal(array: ArrayLike<number>, a: number, b: number, c: number): [number, number, number] {
      const abx = array[b * 3] - array[a * 3];
      const aby = array[b * 3 + 1] - array[a * 3 + 1];
      const abz = array[b * 3 + 2] - array[a * 3 + 2];
      const acx = array[c * 3] - array[a * 3];
      const acy = array[c * 3 + 1] - array[a * 3 + 1];
      const acz = array[c * 3 + 2] - array[a * 3 + 2];
      return [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx];
    }

    const faces = Array.from({ length: indices.count / 3 }, (_, i) => {
      const a = indices.getX(i * 3);
      const b = indices.getX(i * 3 + 1);
      const c = indices.getX(i * 3 + 2);
      return { a, b, c, original: normal(original, a, b, c) };
    });
    for (let mm = 0; mm <= 700; mm++) {
      chain.setPosition(mm);
      for (const face of faces) {
        const transformed = normal(positions.array, face.a, face.b, face.c);
        const dot = transformed[0] * face.original[0] + transformed[1] * face.original[1] + transformed[2] * face.original[2];
        if (!(dot > 0)) throw new Error(`Degenerate or flipped face at ${mm} mm`);
        const alignment = dot / (Math.hypot(...transformed) * Math.hypot(...face.original));
        if (alignment < 0.9999) throw new Error(`Face normal changed at ${mm} mm`);
      }
    }
  });

  it('rejects an asset without the expected drag chain mesh', () => {
    expect(() => new RailDragChain(new Group())).toThrow('missing the drag chain mesh');
  });
});
