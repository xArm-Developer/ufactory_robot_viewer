import * as THREE from 'three';
import type { URDFRobot } from 'urdf-loader';
import type { RobotId } from './robots';

type BodyParts = { white?: readonly string[]; metal?: readonly string[]; cover?: readonly string[] };

// Names refer to meshes within each link's visual GLB, not to the whole link.
// End links are deliberately absent: their flange and connectors have separate finishes.
const BODY_PARTS: Record<RobotId, Record<string, BodyParts>> = {
  xarm5: {
    link_base: { metal: ['part_0', 'part_1'] },
    link1: { white: ['part_0'], metal: ['part_1'] },
    link2: { white: ['part_0'], metal: ['part_1'] },
    link3: { white: ['part_0', 'part_2'], metal: ['part_1', 'part_3'] },
    link4: { white: ['part_0', 'part_2'], metal: ['part_1'] },
  },
  xarm6: {
    link_base: { metal: ['part_0', 'part_1', 'part_2', 'part_3'] },
    link1: { white: ['part_1'], metal: ['part_2'] },
    link2: { white: ['part_0'], metal: ['part_1'] },
    link3: { white: ['part_0'], metal: ['part_1'] },
    link4: { white: ['part_0'], metal: ['part_1'] },
    link5: { white: ['part_0', 'part_1'], metal: ['part_2'] },
  },
  xarm7: {
    link_base: { metal: ['part_0', 'part_1', 'part_2', 'part_3'] },
    link1: { white: ['part_2'], metal: ['part_0'] },
    link2: { white: ['part_0'], metal: ['part_2'] },
    link3: { white: ['part_0'], metal: ['part_1', 'part_2'] },
    link4: { white: ['part_2'], metal: ['part_0', 'part_1'] },
    link5: { white: ['part_0'], metal: ['part_1', 'part_2'] },
    link6: { white: ['part_0', 'part_1'], metal: ['part_2'] },
  },
  uf850: {
    link_base: { metal: ['part_0', 'part_1'] },
    link1: { white: ['part_0'], metal: ['part_1'] },
    link2: { white: ['part_0'], metal: ['part_1'] },
    link3: { white: ['part_0'], metal: ['part_1'] },
    link4: { white: ['part_1', 'part_2'], metal: ['part_0'] },
    link5: { white: ['part_0'] },
  },
  lite6: {
    link_base: { white: ['part_0'], cover: ['part_1'] },
    link1: { white: ['part_0', 'part_1'], cover: ['part_2'] },
    link2: { white: ['part_0'], cover: ['part_1'] },
    link3: { white: ['part_0', 'part_1'] },
    link4: { white: ['part_0', 'part_1'], cover: ['part_2'] },
    link5: { white: ['part_0', 'part_1'] },
  },
};

// The 850 flange shares its mesh with the connector; copy only its base PBR values.
const FLANGE_PARTS: Partial<Record<RobotId, { link: string; part: string }>> = {
  xarm5: { link: 'link5', part: 'part_4' },
  xarm6: { link: 'link6', part: 'part_4' },
  xarm7: { link: 'link7', part: 'part_4' },
  uf850: { link: 'link6', part: 'part_0' },
};

/** Neutral softboxes for arm finishes only; scene lighting and connector reflections stay separate. */
export function createArmEnvironment(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create arm reflection texture');
  const background = context.createLinearGradient(0, 0, 0, canvas.height);
  background.addColorStop(0, '#777777');
  background.addColorStop(0.4, '#484848');
  background.addColorStop(0.75, '#252525');
  background.addColorStop(1, '#181818');
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const [x, width] of [[-20, 115], [155, 120], [330, 115], [492, 115]]) {
    const softbox = context.createLinearGradient(x, 0, x + width, 0);
    softbox.addColorStop(0, 'rgba(255,255,255,0)');
    softbox.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    softbox.addColorStop(0.5, 'rgba(255,255,255,0.95)');
    softbox.addColorStop(0.75, 'rgba(255,255,255,0.45)');
    softbox.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = softbox;
    context.fillRect(x, 12, width, 200);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Clone only mapped body materials: decoded GLB resources can be shared by cached instances. */
export function adjustArmMaterials(robot: URDFRobot, id: RobotId, owned: Set<THREE.Material>, environment: THREE.Texture): void {
  const flangePart = FLANGE_PARTS[id];
  let flangeMaterial: THREE.MeshStandardMaterial | undefined;
  if (flangePart) {
    const link = robot.links[flangePart.link];
    for (const visual of link?.children ?? []) {
      if (!(visual as THREE.Object3D & { isURDFVisual?: boolean }).isURDFVisual) continue;
      visual.traverse(object => {
        if (!(object instanceof THREE.Mesh) || object.name !== flangePart.part) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        flangeMaterial = materials.find(material => material instanceof THREE.MeshStandardMaterial) as THREE.MeshStandardMaterial | undefined;
      });
    }
    if (!flangeMaterial) throw new Error(`Missing flange material for ${id}`);
  }

  for (const [linkName, parts] of Object.entries(BODY_PARTS[id])) {
    const link = robot.links[linkName];
    if (!link) continue;
    for (const visual of link.children) {
      if (!(visual as THREE.Object3D & { isURDFVisual?: boolean }).isURDFVisual) continue;
      visual.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const finish = parts.white?.includes(object.name) ? 'white'
          : parts.metal?.includes(object.name) ? 'metal'
          : parts.cover?.includes(object.name) ? 'cover' : undefined;
        if (!finish) return;
        const copies = (Array.isArray(object.material) ? object.material : [object.material]).map(original => {
          const material = original.clone();
          owned.add(material);
          if (material instanceof THREE.MeshStandardMaterial) {
            if (finish === 'white') {
              material.color.setHex(0xe2e4e5);
              material.roughness = 0.24;
              material.metalness = 0;
              material.envMapIntensity = 0.75;
              material.envMap = environment;
            } else if (finish === 'metal') {
              if (!flangeMaterial) throw new Error(`Missing flange material for ${id}`);
              material.color.copy(flangeMaterial.color);
              material.roughness = flangeMaterial.roughness;
              material.metalness = flangeMaterial.metalness;
              material.envMap = null;
            } else {
              material.color.setHex(0x707276);
              material.roughness = 0.42;
              material.metalness = 0.12;
              material.envMapIntensity = 0.7;
              material.envMap = environment;
            }
          }
          return material;
        });
        object.material = Array.isArray(object.material) ? copies : copies[0];
      });
    }
  }
}
