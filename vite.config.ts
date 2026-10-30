import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
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
