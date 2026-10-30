import * as THREE from 'three';
import { bioFingerTravel, g2Angle, validOpening, type GripperSpec } from './grippers';

export interface GripperModel {
  root: THREE.Group;
  setOpening(opening: number): boolean;
}

export function gripperPartNames(spec: GripperSpec): string[] {
  switch (spec.id) {
    case 'gripper-g2': return ['base', 'left_outer_knuckle', 'right_outer_knuckle', 'left_inner_knuckle', 'right_inner_knuckle', 'left_finger', 'right_finger'];
    case 'bio-gripper-g2': return ['bio_gripper_g2_base', 'bio_gripper_g2_left_finger', 'bio_gripper_g2_right_finger'];
    case 'lite6-gripper': return ['shell', 'finger1', 'finger2'];
    case 'lite6-vacuum-gripper': return ['vacuum'];
  }
}

/** Assemble link-canonical meshes in the URDF's Z-up frame. */
export function createGripperModel(spec: GripperSpec, parts: Record<string, THREE.Object3D>): GripperModel {
  const root = new THREE.Group();
  root.name = spec.id;
  const part = (name: string) => {
    if (!parts[name]) throw new Error(`Missing gripper mesh: ${name}`);
    parts[name].traverse(object => {
      if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; }
    });
    return parts[name];
  };
  const pivot = (parent: THREE.Object3D, position: [number, number, number]) => {
    const group = new THREE.Group();
    group.position.set(...position);
    parent.add(group);
    return group;
  };

  if (spec.id === 'gripper-g2') {
    // The viewer's model datum was 1.498179 mm below its origin. Shift its
    // entire geometry to the flange, then apply its base-only face correction.
    const geometry = pivot(root, [0, 0, 0.001498179100862778]);
    const base = part('base');
    base.position.z += -0.001498179100862778 + 0.00006;
    geometry.add(base);
    const leftOuter = pivot(geometry, [0, 0.035, 0.059098]);
    const rightOuter = pivot(geometry, [0, -0.035, 0.059098]);
    const leftFinger = pivot(leftOuter, [0, 0.035465, 0.042039]);
    const rightFinger = pivot(rightOuter, [0, -0.035465, 0.042039]);
    const leftInner = pivot(geometry, [0, 0.02, 0.074098]);
    const rightInner = pivot(geometry, [0, -0.02, 0.074098]);
    leftOuter.add(part('left_outer_knuckle'));
    rightOuter.add(part('right_outer_knuckle'));
    leftInner.add(part('left_inner_knuckle'));
    rightInner.add(part('right_inner_knuckle'));
    for (const [name, parent, side] of [
      ['left_finger', leftFinger, 'left'], ['right_finger', rightFinger, 'right'],
    ] as const) {
      const mesh = part(name);
      const bounds = new THREE.Box3().setFromObject(mesh);
      mesh.position.z -= 0.0012700762358030318;
      mesh.position.y += side === 'left' ? -0.02600320242345333 - bounds.min.y : 0.02600320242345333 - bounds.max.y;
      parent.add(mesh);
    }
    const setOpening = (openingMm: number) => {
      if (!validOpening(spec, openingMm)) return false;
      const angle = g2Angle(openingMm);
      leftOuter.rotation.x = leftInner.rotation.x = angle;
      rightOuter.rotation.x = rightInner.rotation.x = -angle;
      leftFinger.rotation.x = -angle;
      rightFinger.rotation.x = angle;
      root.updateMatrixWorld(true);
      return true;
    };
    setOpening(spec.opening!.max);
    return { root, setOpening };
  }

  if (spec.id === 'lite6-vacuum-gripper') {
    root.add(part('vacuum'));
    return { root, setOpening: () => false };
  }

  if (spec.id === 'lite6-gripper') {
    root.add(part('shell'));
    const left = part('finger1');
    const right = part('finger2');
    root.add(left, right);
    const setOpening = (opening: number) => {
      if (!validOpening(spec, opening)) return false;
      const travel = opening === spec.opening!.max ? 0.0089 : 0;
      left.position.set(0, travel, 0.0543);
      right.position.set(0, -travel, 0.0543);
      root.updateMatrixWorld(true);
      return true;
    };
    setOpening(spec.opening!.max);
    return { root, setOpening };
  }

  root.add(part('bio_gripper_g2_base'));
  const left = pivot(root, [0.059, 0, 0.027]);
  const right = pivot(root, [0.059, 0, 0.027]);
  const leftMesh = part('bio_gripper_g2_left_finger');
  const rightMesh = part('bio_gripper_g2_right_finger');
  leftMesh.position.y += 0.00695659220219;
  rightMesh.position.y -= 0.00811730325222;
  left.add(leftMesh);
  right.add(rightMesh);
  const setOpening = (openingMm: number) => {
    if (!validOpening(spec, openingMm)) return false;
    const travel = bioFingerTravel(openingMm);
    left.position.y = -travel;
    right.position.y = travel;
    root.updateMatrixWorld(true);
    return true;
  };
  setOpening(spec.opening!.max);
  return { root, setOpening };
}
