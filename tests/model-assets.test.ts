import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { generateModelAssets } from '../scripts/model-assets';
import { ROBOTS } from '../src/robots';

function publicGlbs(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? publicGlbs(file) : entry.isFile() && file.endsWith('.glb') ? [file] : [];
  });
}

describe('generated model assets', () => {
  it('uses URDF visuals and emits only lossless, worthwhile fingerprinted gzip copies', () => {
    const generated = generateModelAssets();
    for (const robot of ROBOTS) expect(generated.visuals[robot.id]).toHaveLength(robot.visualMeshCount);
    expect(generated.files.size).toBeGreaterThan(0);
    const eligible = publicGlbs('public').filter(file => {
      const bytes = readFileSync(file);
      return bytes.length > 128 * 1024 && gzipSync(bytes, { level: 9 }).length <= bytes.length * 0.8;
    }).map(file => path.relative('public', file).split(path.sep).join('/'));
    expect(Object.keys(generated.compressed).sort()).toEqual(eligible.sort());
    for (const [original, target] of Object.entries(generated.compressed)) {
      const bytes = readFileSync(`public/${original}`);
      const compressed = generated.files.get(target)!;
      expect(bytes.length).toBeGreaterThan(128 * 1024);
      expect(compressed.length).toBeLessThanOrEqual(bytes.length * 0.8);
      expect(gunzipSync(compressed).equals(bytes)).toBe(true);
      expect(target).toContain(createHash('sha256').update(bytes).digest('hex'));
      expect(target.endsWith('.glb.gz.bin')).toBe(true);
    }
    const rail = generated.files.get(generated.compressed['models/al0700/model.glb'])!;
    expect(rail.length / readFileSync('public/models/al0700/model.glb').length).toBeLessThanOrEqual(0.4);
  }, 30_000);
});
