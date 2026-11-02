import * as THREE from 'three';
import type { URDFRobot } from 'urdf-loader';
import type { CollisionBodyId } from './collision';
import { GRIPPERS, type GripperSpec } from './grippers';

const STOP_NAMES = new Set<string>([
  'base_coordinate_frame',
  'tcp_coordinate_frame',
  'sensor_flange_mount',
  'robot_mount',
  ...GRIPPERS.map(g => g.id),
]);

export const COLLISION_HIGHLIGHT_COLOR = 0xdc2626;
export const COLLISION_HIGHLIGHT_EMISSIVE = 0x7f1d1d;
export const COLLISION_HIGHLIGHT_EMISSIVE_INTENSITY = 0.45;

function collectIsolatedMeshes(
  root: THREE.Object3D,
  shouldStop: (node: THREE.Object3D) => boolean,
  out: THREE.Mesh[] = [],
): THREE.Mesh[] {
  const visit = (node: THREE.Object3D) => {
    if (node !== root && shouldStop(node)) return;
    if (node instanceof THREE.Mesh) {
      out.push(node);
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);
  return out;
}

export class CollisionHighlighter {
  private readonly bodyMeshes = new Map<CollisionBodyId, THREE.Mesh[]>();
  private readonly originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private readonly clonedMaterials = new Map<THREE.Material, THREE.Material>();
  private readonly highlightedBodies = new Set<CollisionBodyId>();

  registerBodyMeshes(id: CollisionBodyId, meshes: readonly THREE.Mesh[]): void {
    if (meshes.length === 0) return;
    const existing = this.bodyMeshes.get(id) ?? [];
    for (const mesh of meshes) {
      if (!this.originalMaterials.has(mesh)) {
        this.originalMaterials.set(mesh, mesh.material);
      }
      existing.push(mesh);
    }
    this.bodyMeshes.set(id, existing);
  }

  registerArm(robot: URDFRobot, dof: number): void {
    const linkNames = ['link_base', ...Array.from({ length: dof }, (_, i) => `link${i + 1}`)];
    for (const linkName of linkNames) {
      const link = robot.links[linkName];
      if (!link) continue;
      const meshes = collectIsolatedMeshes(link, node => {
        const tagged = node as THREE.Object3D & { isURDFJoint?: boolean; isURDFCollider?: boolean };
        return Boolean(tagged.isURDFJoint || tagged.isURDFCollider || STOP_NAMES.has(node.name));
      });
      this.registerBodyMeshes(`arm:${linkName}`, meshes);
    }
  }

  registerSensor(sensorMount: THREE.Object3D): void {
    const meshes = collectIsolatedMeshes(sensorMount, node => STOP_NAMES.has(node.name));
    this.registerBodyMeshes('sensor:ai1500', meshes);
  }

  registerGripper(spec: GripperSpec, parts: Record<string, THREE.Object3D | undefined>): void {
    const addPart = (id: CollisionBodyId, partName: string) => {
      const obj = parts[partName];
      if (!obj) return;
      this.registerBodyMeshes(id, collectIsolatedMeshes(obj, () => false));
    };

    switch (spec.id) {
      case 'gripper-g2':
        addPart('gripper:base', 'base');
        addPart('gripper:left', 'left_outer_knuckle');
        addPart('gripper:left', 'left_inner_knuckle');
        addPart('gripper:left', 'left_finger');
        addPart('gripper:right', 'right_outer_knuckle');
        addPart('gripper:right', 'right_inner_knuckle');
        addPart('gripper:right', 'right_finger');
        break;
      case 'bio-gripper-g2':
        addPart('gripper:base', 'bio_gripper_g2_base');
        addPart('gripper:left', 'bio_gripper_g2_left_finger');
        addPart('gripper:right', 'bio_gripper_g2_right_finger');
        break;
      case 'lite6-gripper':
        addPart('gripper:base', 'shell');
        addPart('gripper:left', 'finger1');
        addPart('gripper:right', 'finger2');
        break;
      case 'lite6-vacuum-gripper':
        addPart('gripper:base', 'vacuum');
        break;
    }
  }

  registerRail(fixedRail: THREE.Object3D, carriage: THREE.Object3D, robotMount: THREE.Object3D): void {
    const dragChainObj = fixedRail.getObjectByName('part_35');
    if (dragChainObj) {
      this.registerBodyMeshes('rail:drag_chain', collectIsolatedMeshes(dragChainObj, () => false));
    }
    const fixedMeshes = collectIsolatedMeshes(
      fixedRail,
      node => node === dragChainObj || node.name === 'part_35',
    );
    this.registerBodyMeshes('rail:fixed', fixedMeshes);

    const carriageMeshes = collectIsolatedMeshes(
      carriage,
      node => node === robotMount || node.name === 'robot_mount',
    );
    this.registerBodyMeshes('rail:carriage', carriageMeshes);
  }

  private getHighlightMaterial(original: THREE.Material): THREE.Material {
    let clone = this.clonedMaterials.get(original);
    if (!clone) {
      clone = original.clone();
      const std = clone as THREE.Material & {
        color?: THREE.Color;
        emissive?: THREE.Color;
        emissiveIntensity?: number;
      };
      if (std.color instanceof THREE.Color) {
        std.color.setHex(COLLISION_HIGHLIGHT_COLOR);
      }
      if (std.emissive instanceof THREE.Color) {
        std.emissive.setHex(COLLISION_HIGHLIGHT_EMISSIVE);
        std.emissiveIntensity = COLLISION_HIGHLIGHT_EMISSIVE_INTENSITY;
      }
      this.clonedMaterials.set(original, clone);
    }
    return clone;
  }

  private applyMeshHighlight(mesh: THREE.Mesh, highlighted: boolean): void {
    const original = this.originalMaterials.get(mesh);
    if (!original) return;
    if (!highlighted) {
      mesh.material = original;
      return;
    }
    mesh.material = Array.isArray(original)
      ? original.map(mat => this.getHighlightMaterial(mat))
      : this.getHighlightMaterial(original);
  }

  setHighlighted(bodyIds: Iterable<CollisionBodyId>): boolean {
    const next = new Set<CollisionBodyId>();
    for (const id of bodyIds) {
      if (this.bodyMeshes.has(id)) next.add(id);
    }

    let changed = next.size !== this.highlightedBodies.size;
    if (!changed) {
      for (const id of next) {
        if (!this.highlightedBodies.has(id)) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) return false;

    for (const prevId of this.highlightedBodies) {
      if (!next.has(prevId)) {
        for (const mesh of this.bodyMeshes.get(prevId) ?? []) {
          this.applyMeshHighlight(mesh, false);
        }
      }
    }

    for (const nextId of next) {
      if (!this.highlightedBodies.has(nextId)) {
        for (const mesh of this.bodyMeshes.get(nextId) ?? []) {
          this.applyMeshHighlight(mesh, true);
        }
      }
    }

    this.highlightedBodies.clear();
    for (const id of next) this.highlightedBodies.add(id);
    return true;
  }

  clearHighlight(): boolean {
    return this.setHighlighted([]);
  }

  getHighlightedBodies(): CollisionBodyId[] {
    return [...this.highlightedBodies];
  }

  private pruneUnusedClones(): void {
    const activeOriginals = new Set<THREE.Material>();
    for (const orig of this.originalMaterials.values()) {
      if (Array.isArray(orig)) {
        for (const m of orig) activeOriginals.add(m);
      } else {
        activeOriginals.add(orig);
      }
    }
    for (const [orig, clone] of [...this.clonedMaterials.entries()]) {
      if (!activeOriginals.has(orig)) {
        clone.dispose();
        this.clonedMaterials.delete(orig);
      }
    }
  }

  clearAccessories(): void {
    for (const [id, meshes] of [...this.bodyMeshes.entries()]) {
      if (id.startsWith('arm:')) continue;
      for (const mesh of meshes) {
        this.applyMeshHighlight(mesh, false);
        this.originalMaterials.delete(mesh);
      }
      this.highlightedBodies.delete(id);
      this.bodyMeshes.delete(id);
    }
    this.pruneUnusedClones();
  }

  dispose(): void {
    for (const meshes of this.bodyMeshes.values()) {
      for (const mesh of meshes) {
        this.applyMeshHighlight(mesh, false);
      }
    }
    for (const clone of this.clonedMaterials.values()) {
      clone.dispose();
    }
    this.clonedMaterials.clear();
    this.originalMaterials.clear();
    this.bodyMeshes.clear();
    this.highlightedBodies.clear();
  }
}
