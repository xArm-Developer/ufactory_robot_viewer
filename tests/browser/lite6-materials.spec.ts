import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

type Finish = { color: number[]; roughness: number; metalness: number };

function assetFinishes(path: string): Record<string, Finish> {
  const glb = readFileSync(path);
  const json = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12))) as {
    nodes: { name: string; mesh?: number }[];
    meshes: { primitives: { material: number }[] }[];
    materials: { pbrMetallicRoughness: { baseColorFactor: number[]; roughnessFactor: number; metallicFactor: number } }[];
  };
  return Object.fromEntries(json.nodes.filter(node => node.mesh !== undefined).map(node => {
    const pbr = json.materials[json.meshes[node.mesh!].primitives[0].material].pbrMetallicRoughness;
    return [node.name, { color: pbr.baseColorFactor.slice(0, 3), roughness: pbr.roughnessFactor, metalness: pbr.metallicFactor }];
  }));
}

test('Lite 6 finishes survive collision highlights and model switches without changing other assets', async ({ page }) => {
  await page.goto('/?model=lite6');
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });

  const result = await page.evaluate(async () => {
    const sceneUrl = '/src/scene.ts';
    const robotsUrl = '/src/robots.ts';
    const grippersUrl = '/src/grippers.ts';
    const [{ RobotScene }, { getRobotSpec }, { getGripper }] = await Promise.all([
      import(sceneUrl) as Promise<typeof import('../../src/scene')>,
      import(robotsUrl) as Promise<typeof import('../../src/robots')>,
      import(grippersUrl) as Promise<typeof import('../../src/grippers')>,
    ]);
    const host = document.createElement('div');
    host.style.cssText = 'width: 320px; height: 320px; position: fixed; left: -9999px';
    document.body.appendChild(host);
    const scene = new RobotScene(host);
    const liteSpec = getRobotSpec('lite6');

    try {
      const robot = (await scene.load(liteSpec))!;
      const linkNames = ['link_base', 'link1', 'link2', 'link3', 'link4', 'link5', 'link6'];
      const linkMeshes = (model: typeof robot, linkName: string) => {
        const meshes: import('three').Mesh[] = [];
        for (const child of model.links[linkName].children) {
          if (!(child as import('three').Object3D & { isURDFVisual?: boolean }).isURDFVisual) continue;
          child.traverse(object => {
            if ((object as import('three').Mesh).isMesh) meshes.push(object as import('three').Mesh);
          });
        }
        return meshes;
      };
      const finish = (mesh: import('three').Mesh) => {
        if (Array.isArray(mesh.material)) throw new Error('Unexpected multi-material mesh');
        const material = mesh.material as import('three').MeshStandardMaterial;
        return { color: material.color.toArray(), roughness: material.roughness, metalness: material.metalness };
      };
      const finishes = (model: typeof robot, linkName: string) => Object.fromEntries(
        linkMeshes(model, linkName).map(mesh => [mesh.name, finish(mesh)]),
      );
      const initial = Object.fromEntries(linkNames.map(name => [name, finishes(robot, name)]));
      const meshes = linkNames.flatMap(name => linkMeshes(robot, name));
      const originals = meshes.map(mesh => mesh.material);
      scene.setCollisionHighlight(linkNames.map(name => `arm:${name}` as const));
      const highlighted = meshes.every((mesh, index) => mesh.material !== originals[index]
        && !Array.isArray(mesh.material)
        && (mesh.material as import('three').MeshStandardMaterial).color.getHex() === 0xdc2626);
      scene.clearCollisionHighlight();
      const restored = meshes.every((mesh, index) => mesh.material === originals[index]);
      const afterHighlight = Object.fromEntries(linkNames.map(name => [name, finishes(robot, name)]));

      await scene.setAssemblyAccessories({ rail: false, railMm: 0, sensor: false, gripper: getGripper('lite6-gripper'), opening: 100 }, liteSpec);
      const shell = robot.links.link6.getObjectByName('lite6-gripper')!.getObjectByName('part_0') as import('three').Mesh;
      const gripper = finish(shell);

      const xarm = (await scene.load(getRobotSpec('xarm6')))!;
      const otherRobot = finishes(xarm, 'link_base');
      const reloaded = (await scene.load(liteSpec))!;
      const afterSwitch = Object.fromEntries(linkNames.map(name => [name, finishes(reloaded, name)]));
      return { initial, highlighted, restored, afterHighlight, gripper, otherRobot, afterSwitch };
    } finally {
      scene.destroy();
      host.remove();
    }
  });

  const covers: Record<string, string> = { link_base: 'part_1', link1: 'part_2', link2: 'part_1', link4: 'part_2' };
  for (const [link, actual] of Object.entries(result.initial)) {
    const original = assetFinishes(`public/models/lite6/meshes/lite6/visual_glb/${link}.glb`);
    expect(Object.keys(actual).sort()).toEqual(Object.keys(original).sort());
    for (const [part, asset] of Object.entries(original)) {
      const expected = { ...asset };
      if (covers[link] === part) expected.color = [0.55, 0.55, 0.55];
      else if (link !== 'link6' && asset.color.every(channel => channel === 1)) expected.roughness = 0.3;
      expect(actual[part], `${link}/${part}`).toEqual(expected);
    }
  }
  expect(result.highlighted).toBe(true);
  expect(result.restored).toBe(true);
  expect(result.afterHighlight).toEqual(result.initial);
  expect(result.afterSwitch).toEqual(result.initial);
  expect(result.gripper).toEqual(assetFinishes('public/models/lite6-gripper/shell.glb').part_0);
  expect(result.otherRobot).toEqual(assetFinishes('public/models/xarm6/meshes/xarm6_1305/visual_glb/link_base.glb'));
});
