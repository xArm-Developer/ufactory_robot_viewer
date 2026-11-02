// Export the application's actual robot registry and flange-to-TCP transforms for the offline optimizer.
import { createServer } from 'vite';

const server = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true } });
try {
  const [{ ROBOTS }, { GRIPPERS, supportsGripper }, { assemblyToolOffset, supportsSensor }] = await Promise.all([
    server.ssrLoadModule('/src/robots.ts'),
    server.ssrLoadModule('/src/grippers.ts'),
    server.ssrLoadModule('/src/accessories.ts'),
  ]);
  const robots = ROBOTS.map(spec => ({
    id: spec.id,
    dof: spec.dof,
    eeLink: spec.eeLink,
    urdf: `public/${spec.modelDir}${spec.urdfFile}`,
    combinations: [false, ...(supportsSensor(spec.id) ? [true] : [])].flatMap(sensor =>
      [undefined, ...GRIPPERS.filter(gripper => supportsGripper(spec.id, gripper.id)).map(gripper => gripper.id)].map(gripperId => {
        const offset = assemblyToolOffset(spec.id, { sensor, gripperId });
        return {
          sensor,
          gripperId: gripperId ?? null,
          tcp: { position: offset.position.toArray(), quaternion: offset.quaternion.toArray() },
        };
      }),
    ),
  }));
  process.stdout.write(JSON.stringify(robots));
} finally {
  await server.close();
}
