import { BufferAttribute, DynamicDrawUsage, Mesh, type BufferGeometry, type Object3D } from 'three';

// Coordinates are in the untransformed AL0700 CAD frame, in metres.
const BEND_END_Z = 0.12437742;
const STRAIGHT_END_Z = 0.290;
const BEND_CENTER_Y = 0.0104962;
const ZERO_EXTENSION = 0.220;

/** Deform the single U-shaped CAD mesh while its two ends follow the rail and carriage. */
export class RailDragChain {
  private readonly geometry: BufferGeometry;
  private readonly positions: BufferAttribute;
  private readonly original: Float32Array;

  constructor(fixedRail: Object3D) {
    const mesh = fixedRail.getObjectByName('part_35');
    if (!(mesh instanceof Mesh)) throw new Error('Rail model is missing the drag chain mesh');
    const positions = mesh.geometry.getAttribute('position');
    if (!(positions instanceof BufferAttribute) || positions.itemSize !== 3) {
      throw new Error('Rail drag chain has an unsupported position attribute');
    }

    this.geometry = mesh.geometry;
    this.positions = positions;
    this.original = new Float32Array(positions.array);
    this.positions.setUsage(DynamicDrawUsage);
  }

  setPosition(railMm: number): void {
    const travel = railMm / 1000;
    const bendOffset = -ZERO_EXTENSION - travel / 2;

    for (let i = 0; i < this.positions.count; i++) {
      const y = this.original[i * 3 + 1];
      const z = this.original[i * 3 + 2];
      const weight = Math.max(0, Math.min(1, (z - BEND_END_Z) / (STRAIGHT_END_Z - BEND_END_Z)));
      const endOffset = y > BEND_CENTER_Y ? -travel : 0;
      this.positions.setZ(i, z + (1 - weight) * bendOffset + weight * endOffset);
    }

    // Only straight, axis-aligned faces stretch; the bend and detailed ends translate rigidly.
    // Their original CAD normals therefore remain valid, including at hard edges.
    this.positions.needsUpdate = true;
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
  }
}
