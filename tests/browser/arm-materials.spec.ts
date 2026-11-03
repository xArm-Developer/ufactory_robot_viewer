import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { Color } from 'three';

const models = {
  xarm5: {
    shell: ['link1', 'part_0'], ring: ['link1', 'part_1'], base: ['link_base', 'part_0'], end: 'link5', flange: 'part_4',
    metal: { link_base: ['part_0', 'part_1'], link1: ['part_1'], link2: ['part_1'], link3: ['part_1', 'part_3'], link4: ['part_1'] },
  },
  xarm6: {
    shell: ['link1', 'part_1'], ring: ['link1', 'part_2'], base: ['link_base', 'part_0'], end: 'link6', flange: 'part_4',
    metal: { link_base: ['part_0', 'part_1', 'part_2', 'part_3'], link1: ['part_2'], link2: ['part_1'], link3: ['part_1'], link4: ['part_1'], link5: ['part_2'] },
  },
  xarm7: {
    shell: ['link1', 'part_2'], ring: ['link1', 'part_0'], base: ['link_base', 'part_0'], end: 'link7', flange: 'part_4',
    metal: { link_base: ['part_0', 'part_1', 'part_2', 'part_3'], link1: ['part_0'], link2: ['part_2'], link3: ['part_1', 'part_2'], link4: ['part_0', 'part_1'], link5: ['part_1', 'part_2'], link6: ['part_2'] },
  },
  uf850: {
    shell: ['link1', 'part_0'], ring: ['link1', 'part_1'], base: ['link_base', 'part_0'], end: 'link6', flange: 'part_0',
    metal: { link_base: ['part_0', 'part_1'], link1: ['part_1'], link2: ['part_1'], link3: ['part_1'], link4: ['part_0'] },
  },
  lite6: { shell: ['link1', 'part_0'], ring: ['link1', 'part_2'], base: ['link_base', 'part_0'], end: 'link6', flange: 'part_0', metal: {} },
} as const;

type Model = keyof typeof models;
type Finish = { color: number[]; roughness: number; metalness: number };

function sourceFinish(id: Model, link: string, part: string): Finish {
  const dir = id.startsWith('xarm') ? `${id}_1305` : id;
  const bytes = readFileSync(`public/models/${id}/meshes/${dir}/visual_glb/${link}.glb`);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12))) as {
    nodes: { name: string; mesh?: number }[];
    meshes: { primitives: { material: number }[] }[];
    materials: { pbrMetallicRoughness: { baseColorFactor: number[]; roughnessFactor: number; metallicFactor: number } }[];
  };
  const node = json.nodes.find(item => item.name === part)!;
  const pbr = json.materials[json.meshes[node.mesh!].primitives[0].material].pbrMetallicRoughness;
  return { color: pbr.baseColorFactor.slice(0, 3), roughness: pbr.roughnessFactor, metalness: pbr.metallicFactor };
}

test('body materials match each flange and remain isolated through collision and model switches', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async models => {
    const sceneUrl = '/src/scene.ts', robotsUrl = '/src/robots.ts';
    const [{ RobotScene }, { getRobotSpec }] = await Promise.all([
      import(sceneUrl) as Promise<typeof import('../../src/scene')>,
      import(robotsUrl) as Promise<typeof import('../../src/robots')>,
    ]);
    const host = document.createElement('div');
    host.style.cssText = 'width: 400px; height: 400px; position: fixed; left: -9999px';
    document.body.appendChild(host);
    const scene = new RobotScene(host);
    const view = scene as unknown as {
      armEnvironment: import('three').Texture;
      connectorEnvironment: import('three').Texture;
      renderer: import('three').WebGLRenderer;
      scene: import('three').Scene;
      camera: import('three').PerspectiveCamera;
      modelCache: { acquire(url: string): Promise<{ object: import('three').Object3D; release(): void }> };
    };
    const bodyEnvironment = view.armEnvironment;
    let environmentDisposals = 0, materialDisposals = 0, materialCount = 0;
    bodyEnvironment.addEventListener('dispose', () => environmentDisposals++);
    const seenMaterials = new Set<import('three').Material>();
    const finish = (material: import('three').MeshStandardMaterial) => ({
      color: material.color.toArray(), roughness: material.roughness, metalness: material.metalness,
    });
    const output: Record<string, {
      candidates: string[][]; finishes: Finish[]; source: Finish[]; environments: string[]; intensities: number[];
      flange: Finish; flangeEnvironment: string; separate: boolean; endUnaffected: boolean; highlighted: boolean; restored: boolean;
    }[]> = {};
    const textureCounts: number[] = [];
    const ids = Object.keys(models) as Model[];
    try {
      for (const id of [...ids, 'xarm6', 'uf850', 'lite6', 'xarm6'] as Model[]) {
        const robot = (await scene.load(getRobotSpec(id)))!;
        const meshIn = (link: string, part: string) => {
          const visual = robot.links[link].children.find(child => (child as import('three').Object3D & { isURDFVisual?: boolean }).isURDFVisual)!;
          return visual.getObjectByName(part) as import('three').Mesh;
        };
        const metal = Object.entries(models[id].metal).flatMap(([link, parts]) => parts.map((part: string) => [link, part]));
        const candidates: readonly (readonly string[])[] = id === 'lite6'
          ? [models[id].shell, models[id].ring, models[id].base]
          : [models[id].shell, ...metal];
        const meshes = candidates.map(([link, part]) => meshIn(link, part));
        const materials = meshes.map(mesh => mesh.material as import('three').MeshStandardMaterial);
        const flangeMesh = meshIn(models[id].end, models[id].flange);
        const flangeMaterial = flangeMesh.material as import('three').MeshStandardMaterial;
        const environmentName = (material: import('three').MeshStandardMaterial) => material.envMap === bodyEnvironment ? 'arm'
          : material.envMap === view.connectorEnvironment ? 'connector' : material.envMap === null ? 'none' : 'other';
        const source: Finish[] = [];
        let separate = true;
        for (let index = 0; index < candidates.length; index++) {
          const [link, part] = candidates[index];
          const dir = id.startsWith('xarm') ? `${id}_1305` : id;
          const url = new URL(`/models/${id}/meshes/${dir}/visual_glb/${link}.glb`, document.baseURI).href;
          const lease = await view.modelCache.acquire(url);
          const original = (lease.object.getObjectByName(part) as import('three').Mesh).material as import('three').MeshStandardMaterial;
          source.push(finish(original));
          separate &&= materials[index] !== original && original.envMap === null && !seenMaterials.has(materials[index]);
          seenMaterials.add(materials[index]);
          lease.release();
        }
        let endUnaffected = true;
        const endVisual = robot.links[models[id].end].children.find(child => (child as import('three').Object3D & { isURDFVisual?: boolean }).isURDFVisual)!;
        endVisual.traverse(object => {
          if (!(object as import('three').Mesh).isMesh) return;
          const mat = (object as import('three').Mesh).material;
          for (const item of Array.isArray(mat) ? mat : [mat]) {
            if ((item as import('three').MeshStandardMaterial).envMap === bodyEnvironment) endUnaffected = false;
          }
        });
        const allMeshes = [...meshes, flangeMesh];
        const before = allMeshes.map(mesh => mesh.material);
        const links = [...new Set([...candidates.map(([link]) => link), models[id].end])];
        scene.setCollisionHighlight(links.map(link => `arm:${link}` as const));
        const highlighted = allMeshes.every((mesh, index) => mesh.material !== before[index]
          && (mesh.material as import('three').MeshStandardMaterial).color.getHex() === 0xdc2626);
        scene.clearCollisionHighlight();
        const restored = allMeshes.every((mesh, index) => mesh.material === before[index]);
        for (const material of materials) {
          material.addEventListener('dispose', () => materialDisposals++);
          materialCount++;
        }
        view.renderer.render(view.scene, view.camera);
        textureCounts.push(view.renderer.info.memory.textures);
        (output[id] ??= []).push({
          candidates: candidates.map(candidate => [...candidate]), finishes: materials.map(finish), source,
          environments: materials.map(environmentName), intensities: materials.map(material => material.envMapIntensity),
          flange: finish(flangeMaterial), flangeEnvironment: environmentName(flangeMaterial),
          separate: separate && bodyEnvironment !== view.connectorEnvironment && view.scene.environment === null,
          endUnaffected, highlighted, restored,
        });
      }
    } finally {
      scene.destroy();
      host.remove();
    }
    return { output, textureCounts, materialCount, materialDisposals, environmentDisposals };
  }, models);

  for (const id of Object.keys(models) as Model[]) {
    for (const actual of result.output[id]) {
      expect(actual.separate, id).toBe(true);
      expect(actual.endUnaffected, id).toBe(true);
      expect(actual.highlighted, id).toBe(true);
      expect(actual.restored, id).toBe(true);
      expect(actual.flange, `${id} flange`).toEqual(sourceFinish(id, models[id].end, models[id].flange));
      expect(actual.flangeEnvironment, id).toBe(id === 'uf850' ? 'connector' : 'none');
      for (const [index, [link, part]] of actual.candidates.entries()) {
        expect(actual.source[index], `${id}/${link}/${part} cached source`).toEqual(sourceFinish(id, link, part));
      }
      const white = { color: new Color(0xe2e4e5).toArray(), roughness: 0.24, metalness: 0 };
      expect(actual.finishes[0], `${id} shell`).toEqual(white);
      expect(actual.environments[0], `${id} shell`).toBe('arm');
      expect(actual.intensities[0], `${id} shell`).toBe(0.75);
      if (id === 'lite6') {
        expect(actual.finishes[1]).toEqual({ color: new Color(0x707276).toArray(), roughness: 0.42, metalness: 0.12 });
        expect(actual.finishes[2]).toEqual(white);
        expect(actual.environments).toEqual(['arm', 'arm', 'arm']);
        expect(actual.intensities.slice(1)).toEqual([0.7, 0.75]);
      } else {
        for (const [index, [link, part]] of actual.candidates.entries()) {
          if (index === 0) continue;
          expect(actual.finishes[index], `${id}/${link}/${part}`).toEqual(actual.flange);
          expect(actual.environments[index], `${id}/${link}/${part}`).toBe('none');
        }
      }
    }
    for (const reload of result.output[id].slice(1)) {
      expect(reload.finishes, `${id} reload`).toEqual(result.output[id][0].finishes);
    }
  }
  expect(result.materialDisposals).toBe(result.materialCount);
  expect(result.environmentDisposals).toBe(1);
  expect(result.textureCounts[8]).toBe(result.textureCounts[5]);
});

test('body finishes remain visible at two viewing angles with reflections limited to shells and Lite 6 covers', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async models => {
    const sceneUrl = '/src/scene.ts', robotsUrl = '/src/robots.ts', threeUrl = '/node_modules/.vite/deps/three.js';
    const [{ RobotScene }, { getRobotSpec }, THREE] = await Promise.all([
      import(sceneUrl) as Promise<typeof import('../../src/scene')>,
      import(robotsUrl) as Promise<typeof import('../../src/robots')>,
      import(threeUrl) as Promise<typeof import('three')>,
    ]);
    const host = document.createElement('div');
    host.style.cssText = 'width: 500px; height: 500px; position: fixed; left: -9999px';
    document.body.appendChild(host);
    const scene = new RobotScene(host);
    const view = scene as unknown as {
      renderer: import('three').WebGLRenderer; scene: import('three').Scene;
      camera: import('three').PerspectiveCamera; orbit: { target: import('three').Vector3; update(): void };
    };
    const output: Record<string, { category: string; visible: number; reflected: number; dark: number; clipped: number }[]> = {};
    try {
      for (const id of Object.keys(models) as Model[]) {
        const robot = (await scene.load(getRobotSpec(id)))!;
        const all: import('three').Mesh[] = [];
        robot.traverse(object => { if ((object as import('three').Mesh).isMesh) all.push(object as import('three').Mesh); });
        for (const child of view.scene.children) if ((child as import('three').Mesh).isMesh) child.visible = false;
        const samples = [];
        for (const angle of [0, 2]) {
          scene.resetView();
          const offset = view.camera.position.clone().sub(view.orbit.target).applyAxisAngle(new THREE.Vector3(0, 0, 1), angle);
          view.camera.position.copy(view.orbit.target).add(offset);
          view.orbit.update();
          for (const category of ['shell', 'ring'] as const) {
            const [link, part] = models[id][category];
            const visual = robot.links[link].children.find(child => (child as import('three').Object3D & { isURDFVisual?: boolean }).isURDFVisual)!;
            const mesh = visual.getObjectByName(part) as import('three').Mesh;
            for (const item of all) item.visible = item === mesh;
            const material = mesh.material as import('three').MeshStandardMaterial;
            const read = () => {
              view.renderer.render(view.scene, view.camera);
              const gl = view.renderer.getContext();
              const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
              gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
              return pixels;
            };
            const withReflection = read();
            const intensity = material.envMapIntensity;
            material.envMapIntensity = 0;
            const withoutReflection = read();
            material.envMapIntensity = intensity;
            let visible = 0, reflected = 0, dark = 0, clipped = 0;
            for (let index = 0; index < withReflection.length; index += 4) {
              if (withReflection[index + 3] < 250) continue;
              visible++;
              const r = withReflection[index], g = withReflection[index + 1], b = withReflection[index + 2];
              if (r < 30 && g < 30 && b < 30) dark++;
              if (r > 250 && g > 250 && b > 250) clipped++;
              const diff = Math.abs(r - withoutReflection[index]) + Math.abs(g - withoutReflection[index + 1]) + Math.abs(b - withoutReflection[index + 2]);
              if (diff > 6) reflected++;
            }
            samples.push({ category, visible, reflected, dark, clipped });
          }
        }
        output[id] = samples;
      }
      return output;
    } finally {
      scene.destroy();
      host.remove();
    }
  }, models);

  for (const [id, samples] of Object.entries(result)) {
    for (const sample of samples) {
      expect(sample.visible, `${id} ${sample.category}`).toBeGreaterThan(100);
      if (sample.category === 'shell' || id === 'lite6') {
        expect(sample.reflected, `${id} ${sample.category}`).toBeGreaterThan(10);
      } else {
        expect(sample.reflected, `${id} ${sample.category}`).toBe(0);
      }
      expect(sample.dark / sample.visible, `${id} ${sample.category}`).toBeLessThan(0.05);
      expect(sample.clipped / sample.visible, `${id} ${sample.category}`).toBeLessThan(0.25);
    }
  }
});
