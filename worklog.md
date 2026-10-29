# 开发记录

## 2026-10-29 · 0.0.1

- 初始化 `main` 仓库；从 ufactory_genesis `4012a34b2af40a51365dbcd2d793a4b2c77971b1` 复制 xArm6 1305 的原始视觉 URDF、七个 Draco GLB 及来源说明。
- 确认本机 Node 24.13.0、`py314` 中 MuJoCo 3.15.0；GitHub CLI 凭据失效。GitHub 应用连接可读取账号，但未提供创建仓库功能。
- 目标：完成静态双语展示、关节/末端控制及独立运动学验证，再配置 Pages Git 集成。
- 完成 Vite/TypeScript/Three.js 页面、七个 Draco GLB 加载、中英切换、关节角度和末端位姿输入、目标平移/旋转手柄、视角与姿态复位，以及 WebGL/资源失败提示。
- FK 使用 URDF Loader；IK 使用闭链求解器 0.0.7 固定提交，锁定基座并对求解结果复核误差和关节限位，失败时回退。
- MuJoCo 3.15.0 生成 7 组独立 FK 基准；10 项单元测试通过，覆盖 6 个可达 IK 目标、近奇异、超出工作空间及非法输入。`typecheck` 与生产构建通过；构建提示主 JS 超过 500 kB。
- 4 项 Chrome 浏览器测试通过：桌面和 iPhone 尺寸模拟均验证目标平移及旋转拖拽，覆盖双语、数值控制、加载及 WebGL 错误。真实手机验收尚未完成。
- 已创建并核实 GitHub 私有仓库 `DanielWang123321/uf_robots`；Cloudflare Pages Git 授权、公开部署及自动部署验证进行中。
- 本地生产预览中，URDF、七个 GLB、Draco WASM 及包装器均返回 HTTP 200。
- 补充桌面鼠标旋转、滚轮缩放、右键平移及视角复位的浏览器测试；修复复位时未消除阻尼余量导致视角漂移。截图复位对比中，仅约 0.04% 像素色差超过 5，测试容许上限为 0.5%；新增测试通过。
- 创建 Cloudflare Pages 项目 `uf-robots`，Git 来源为私有仓库 `DanielWang123321/uf_robots` 的 `main`；生产分支自动部署已启用，构建命令 `npm run build`、输出 `dist`，Node 版本 `24.13.0`。准备通过推送验证实际部署。
- Cloudflare 首次生产部署成功：`https://uf-robots.pages.dev/`，部署提交 `bbd9e35`；继续以本记录的推送验证后续自动部署及线上资源。
