import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { JSDOM } from 'jsdom';
import type { Plugin } from 'vite';
import { ROBOTS } from '../src/robots';

const virtualId = 'virtual:model-assets';
const resolvedId = `\0${virtualId}`;
const root = path.resolve('public');
const minBytes = 128 * 1024;

interface GeneratedAssets {
  visuals: Record<string, string[]>;
  compressed: Record<string, string>;
  files: Map<string, Buffer>;
}

function modelFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? modelFiles(file) : entry.isFile() && file.endsWith('.glb') ? [file] : [];
  }).sort();
}

export function generateModelAssets(): GeneratedAssets {
  const visuals: Record<string, string[]> = {};
  for (const spec of ROBOTS) {
    const directory = path.resolve(root, spec.modelDir);
    const xml = readFileSync(path.join(directory, spec.urdfFile), 'utf8');
    const doc = new JSDOM(xml, { contentType: 'application/xml' }).window.document;
    const visualNodes = [...doc.querySelectorAll('visual')];
    if (visualNodes.some(visual => visual.querySelectorAll('geometry > mesh').length !== 1)) {
      throw new Error(`Expected one mesh per visual in ${spec.id}`);
    }
    const meshes = [...doc.querySelectorAll('visual geometry mesh')].map(mesh => {
      const filename = mesh.getAttribute('filename');
      if (!filename || !filename.endsWith('.glb') || filename.startsWith('/') || filename.includes('..') || filename.includes('://')) {
        throw new Error(`Unsupported visual mesh in ${spec.id}: ${filename}`);
      }
      readFileSync(path.join(directory, filename));
      return filename;
    });
    if (meshes.length !== spec.visualMeshCount || new Set(meshes).size !== meshes.length) {
      throw new Error(`Invalid visual mesh manifest for ${spec.id}: expected ${spec.visualMeshCount}, found ${meshes.length}`);
    }
    visuals[spec.id] = meshes;
  }

  const compressed: Record<string, string> = {};
  const files = new Map<string, Buffer>();
  for (const file of modelFiles(root)) {
    const bytes = readFileSync(file);
    if (bytes.length <= minBytes) continue;
    const gzip = gzipSync(bytes, { level: 9 });
    if (gzip.length > bytes.length * 0.8) continue;
    const relative = path.relative(root, file).split(path.sep).join('/');
    const hash = createHash('sha256').update(bytes).digest('hex');
    // A final .bin avoids static servers treating the gzip payload as HTTP Content-Encoding.
    const target = `optimized-models/${relative.slice(0, -4)}.${hash}.glb.gz.bin`;
    compressed[relative] = target;
    files.set(target, gzip);
  }
  return { visuals, compressed, files };
}

/** Generate the same manifest for Vite dev and build; originals remain untouched. */
export function modelAssetsPlugin(): Plugin {
  let assets: GeneratedAssets;
  return {
    name: 'model-assets',
    buildStart() { assets = generateModelAssets(); },
    resolveId(id) { if (id === virtualId) return resolvedId; },
    load(id) {
      if (id === resolvedId) return `export default ${JSON.stringify({ visuals: assets.visuals, compressed: assets.compressed })};`;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestPath = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, '');
        const file = assets?.files.get(requestPath);
        if (!file) return next();
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Content-Length', file.length);
        res.end(file);
      });
    },
    generateBundle() {
      for (const [fileName, source] of assets.files) this.emitFile({ type: 'asset', fileName, source });
      this.emitFile({ type: 'asset', fileName: '_headers', source:
        '/optimized-models/*\n  Content-Type: application/octet-stream\n  Cache-Control: public, max-age=31536000, immutable\n' });
    },
  };
}
