import { defineConfig } from 'vite';
import { modelAssetsPlugin } from './scripts/model-assets';

export default defineConfig({
  base: './',
  plugins: [modelAssetsPlugin()],
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
