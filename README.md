# UFACTORY Robot Viewer

English | [简体中文](./README_zh.md)

An interactive 3D viewer and in-browser physics simulation showcase for UFACTORY robotic arms and accessories, built with Three.js and MuJoCo WebAssembly.

## Design Documentation

See [docs/design.md](./docs/design.md) ([中文](./docs/design_zh.md)) for supported robots & accessories, TCP offsets, motion control, collision detection, the packing physics simulation, and offline asset pipelines.

## Quick Start

Requires Node.js (24.x recommended) and npm.

```sh
npm ci
npm run dev          # Start local dev server
npm run build        # Build production bundle into dist/
npm run preview      # Preview production build locally
npm test             # Run unit tests
npm run test:browser # Run Playwright browser E2E tests
```

## License & References

- Code license: [BSD-3-Clause](./LICENSE); 3D model and brand asset provenance/licenses are documented in [`public/models/`](./public/models/) and [`public/branding/SOURCE.md`](./public/branding/SOURCE.md).
- Official manuals: [xArm Series](https://www.ufactory.cc/wp-content/uploads/2024/02/xArm-User-Manual-V2.3.0.pdf) · [850](https://www.ufactory.cc/wp-content/uploads/2023/07/UFactory-850-User-Manual-V2.1.0.pdf) · [Lite 6](https://www.ufactory.cc/wp-content/uploads/2023/04/Lite-6-Developer-Manual-V1.11.0.pdf).
