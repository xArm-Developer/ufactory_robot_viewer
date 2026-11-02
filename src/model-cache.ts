import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import type { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import assets from 'virtual:model-assets';

export const MODEL_CACHE_LIMIT = 64 * 1024 * 1024;

// AbortSignal.throwIfAborted is newer than AbortController in some browsers.
export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
}

export interface ModelLease {
  object: THREE.Object3D;
  release(): void;
}

interface Entry {
  object: THREE.Object3D;
  bytes: number;
  references: number;
  cached: boolean;
}

function resourceSets(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  return { geometries, materials, textures };
}

/** Count retained decoded backing buffers once, plus decoded texture pixels. */
export function decodedModelBytes(root: THREE.Object3D): number {
  const { geometries, textures } = resourceSets(root);
  const buffers = new Set<ArrayBufferLike>();
  for (const geometry of geometries) {
    const attributes = [geometry.index, ...Object.values(geometry.attributes), ...Object.values(geometry.morphAttributes).flat()];
    for (const attribute of attributes) {
      if (!attribute) continue;
      const array = 'data' in attribute ? attribute.data.array : attribute.array;
      if (array?.buffer) buffers.add(array.buffer);
    }
  }
  let bytes = [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0);
  for (const texture of textures) {
    const image = texture.image as { width?: number; height?: number; data?: { buffer?: ArrayBufferLike } } | undefined;
    if (image?.data?.buffer) {
      if (!buffers.has(image.data.buffer)) {
        buffers.add(image.data.buffer);
        bytes += image.data.buffer.byteLength;
      }
    } else if (image?.width && image.height) {
      bytes += image.width * image.height * 4;
    }
  }
  return bytes;
}

function disposeModel(root: THREE.Object3D): void {
  const { geometries, materials, textures } = resourceSets(root);
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

/** Scene-local LRU. Instances share immutable resources until their final lease is released. */
export class ModelCache {
  private readonly entries = new Map<string, Entry>();
  private readonly gltf: GLTFLoader;
  private readonly stl = new STLLoader();
  private totalBytes = 0;
  private disposed = false;
  private readonly baseUrl: URL;

  constructor(draco: DRACOLoader, private readonly limit = MODEL_CACHE_LIMIT) {
    this.gltf = new GLTFLoader().setDRACOLoader(draco);
    this.baseUrl = new URL(import.meta.env.BASE_URL, document.baseURI);
  }

  private trim(): void {
    for (const [url, entry] of this.entries) {
      if (this.totalBytes <= this.limit) break;
      if (entry.references) continue;
      this.entries.delete(url);
      entry.cached = false;
      this.totalBytes -= entry.bytes;
      disposeModel(entry.object);
    }
  }

  private lease(url: string, entry: Entry): ModelLease {
    entry.references++;
    if (entry.cached) {
      this.entries.delete(url);
      this.entries.set(url, entry);
    }
    const object = entry.object.clone(true);
    let released = false;
    this.trim();
    return {
      object,
      release: () => {
        if (released) return;
        released = true;
        entry.references--;
        if (!entry.cached && entry.references === 0) disposeModel(entry.object);
        else this.trim();
      },
    };
  }

  async acquire(url: string, signal?: AbortSignal): Promise<ModelLease> {
    checkAbort(signal);
    if (this.disposed) throw new Error('Model cache is disposed');
    const existing = this.entries.get(url);
    if (existing) return this.lease(url, existing);

    const relative = url.startsWith(this.baseUrl.href) ? url.slice(this.baseUrl.href.length) : '';
    const compressed = assets.compressed[relative];
    const useCompressed = Boolean(compressed && typeof DecompressionStream !== 'undefined');
    const requestUrl = useCompressed ? new URL(compressed, this.baseUrl).href : url;
    const response = await fetch(requestUrl, { signal });
    if (!response.ok) throw new Error(`Model HTTP ${response.status} for ${url}`);
    const bytes = useCompressed
      ? await new Response(response.body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
      : await response.arrayBuffer();
    checkAbort(signal);
    const object = url.endsWith('.stl')
      ? new THREE.Mesh(this.stl.parse(bytes), new THREE.MeshStandardMaterial({ color: 0x202324, roughness: 0.72, metalness: 0.08 }))
      : (await this.gltf.parseAsync(bytes, new URL('.', url).href)).scene;
    if (signal?.aborted || this.disposed) {
      disposeModel(object);
      checkAbort(signal);
      throw new Error('Model cache is disposed');
    }
    // Concurrent, superseded requests never block a new selection or replace its cached model.
    const completed = this.entries.get(url);
    if (completed) {
      disposeModel(object);
      return this.lease(url, completed);
    }
    const entry: Entry = { object, bytes: decodedModelBytes(object), references: 0, cached: true };
    this.entries.set(url, entry);
    this.totalBytes += entry.bytes;
    return this.lease(url, entry);
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) {
      entry.cached = false;
      if (!entry.references) disposeModel(entry.object);
    }
    this.entries.clear();
    this.totalBytes = 0;
  }
}
