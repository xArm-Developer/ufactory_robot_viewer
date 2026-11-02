import { defineConfig } from 'vite';
import { modelAssetsPlugin } from './scripts/model-assets';
import { onRequestPost } from './functions/api/subscribe';
import type { Plugin } from 'vite';

function subscribeDevPlugin(): Plugin {
  return {
    name: 'subscribe-dev',
    configureServer(server) {
      server.middlewares.use('/api/subscribe', async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405).end(); return; }
        let body = '';
        for await (const chunk of req) {
          body += String(chunk);
          if (body.length > 2048) { res.writeHead(413).end(); return; }
        }
        const request = new Request(`http://${req.headers.host ?? 'localhost'}/api/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': req.headers['content-type'] ?? '', Origin: req.headers.origin ?? '' },
          body,
        });
        const response = await onRequestPost({ request });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text());
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [modelAssetsPlugin(), subscribeDevPlugin()],
  optimizeDeps: {
    include: [
      'three',
      'three/addons/controls/OrbitControls.js',
      'three/addons/loaders/GLTFLoader.js',
      'three/addons/loaders/DRACOLoader.js',
      'three/addons/loaders/STLLoader.js',
      'urdf-loader',
      'closed-chain-ik/core',
      'closed-chain-ik/three',
    ],
  },
});
