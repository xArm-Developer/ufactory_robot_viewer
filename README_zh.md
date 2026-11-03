# UFACTORY Robot Viewer

[English](./README.md) | 简体中文

基于 Three.js 与 MuJoCo WebAssembly 的 UFACTORY 机械臂及配件三维交互查看器与浏览器端物理仿真示例。

## 设计文档

机型与配件兼容关系、TCP 偏移、运动控制、碰撞检测、装箱物理仿真及离线管线详见 [docs/design_zh.md](./docs/design_zh.md)（[English](./docs/design.md)）。

## 本地运行

环境要求：Node.js（推荐 24.x）与 npm。

```sh
npm ci
npm run dev      # 启动本地开发服务
npm run build    # 构建生产包至 dist/
npm run preview  # 预览生产构建
npm test         # 运行单元测试
npm run test:browser # 运行 Playwright 浏览器端到端测试
```

## 资料与许可

- 代码开源协议：[BSD-3-Clause](./LICENSE)；三维模型与品牌资产许可详见 [`public/models/`](./public/models/) 及 [`public/branding/SOURCE.md`](./public/branding/SOURCE.md)。
- 官方手册：[xArm 系列](https://www.ufactory.cc/wp-content/uploads/2024/02/xArm-User-Manual-V2.3.0.pdf) · [850](https://www.ufactory.cc/wp-content/uploads/2023/07/UFactory-850-User-Manual-V2.1.0.pdf) · [Lite 6](https://www.ufactory.cc/wp-content/uploads/2023/04/Lite-6-Developer-Manual-V1.11.0.pdf)。
