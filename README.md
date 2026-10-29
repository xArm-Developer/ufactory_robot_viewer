# UF Robots · UFACTORY Studio

基于 Three.js 的 UFACTORY 机械臂（`xArm 5`、`xArm 6`、`xArm 7`、`850`、`Lite 6`）交互式展示和运动学演示。支持顶部机型实时切换与 `?model=<id>` 直达链接、中文 / 英文、鼠标 / 触屏视角、5/6/7 轴关节角度调节、笛卡尔点动与连续运动，以及基坐标系 / TCP 坐标系可视化。`xArm 5/6/7` 模型使用 1305 版本；此演示不连接真机，不进行碰撞检测或动力学仿真。

## 本地运行

需要 Node.js **24.13.0** 和 npm。固定依赖记录在 `package-lock.json`。

```sh
npm ci
npm run dev
```

浏览器打开终端输出的地址。手机在同一局域网时，可使用终端输出的网络地址。`npm run build` 输出 `dist/`；`npm run preview` 预览生产构建。

- `npm run typecheck`：TypeScript 类型检查。
- `npm test`：URDF、MuJoCo FK 基准和 IK 测试。
- `npm run test:browser`：Playwright 桌面和手机尺寸测试。首次使用需 `npx playwright install chromium`；也可设置 `CHROME_PATH` 使用本机 Chrome。
- `python scripts/generate-mujoco-fixtures.py`：使用已安装 MuJoCo 的 Python 环境重新生成 FK 基准；当前开发环境为 `/opt/conda_envs/py314/bin/python`。

3D 机械臂舞台初始及复位关节角为全零 `[0, …, 0]`，顶部机型栏可在 `xArm 5`（5 轴）、`xArm 6`（6 轴）、`xArm 7`（7 轴）、`850`（6 轴）与 `Lite 6`（6 轴）之间即时切换。图层右上角实时悬浮显示末端位姿（`X/Y/Z` 与 `Roll/Pitch/Yaw`）及对应轴数关节角（`J1–J5/J6/J7`），右下角可按需开启红（X）/ 绿（Y）/ 蓝（Z）三轴基坐标系（`link_base`）与 TCP 坐标系（末端法兰 `eeLink`）。右侧“运动控制”面板支持收起为竖排控制按钮（移动端为横条按钮），展开后可在“关节控制”与“笛卡尔控制”标签间切换：关节控制实时调节各轴角度；笛卡尔控制提供参考 UFACTORY Studio 的基坐标系方向盘按钮（点按步进默认 `1 mm / 1°`，长按连续运动由 `1%–100%` 速度滑条映射为 `2.5–250 mm/s` 与 `1–100 °/s`；5 轴 `xArm 5` 的 `Roll±` 按几何约束保持灰色禁用）。目标求解失败时保留上一次有效姿态。关节限制读取自 URDF；位姿从 `link_base` 指向末端法兰连杆，界面使用毫米和角度，RPY 为固定轴 `Rz(yaw) × Ry(pitch) × Rx(roll)`。

## 部署

[Cloudflare Pages Git 集成](https://developers.cloudflare.com/pages/get-started/git-integration/)支持私有 GitHub 仓库和生产分支自动部署。项目参数：

- 仓库：`DanielWang123321/uf_robots`，生产分支：`main`。
- Pages 项目：`uf-robots`，地址：`https://uf-robots.pages.dev`。
- 构建命令：`npm run build`；构建输出：`dist`；根目录：仓库根目录。
- Node 版本：`24.13.0`，可通过 Pages 环境变量 `NODE_VERSION` 固定；仓库也提供 `.nvmrc`。

在 Pages 的 **Create application → Pages → Connect to Git** 中授权并选择仓库，填入上述参数，再执行首次部署。之后推送 `main` 会触发自动构建。公开网址、首次上线和后续推送的部署状态须在 Pages 验证，不能仅凭本地构建视为完成。

## 资料与许可

- [运动学研究与验证](docs/kinematics.md)。
- 模型与资产来源、版本和许可证见 `public/models/{xarm5,xarm6,xarm7,uf850,lite6}/SOURCE.md` 及同目录 `NOTICE`。
- 展示参数参考 UFACTORY 官方用户手册（[xArm 系列](https://www.ufactory.cc/wp-content/uploads/2024/02/xArm-User-Manual-V2.3.0.pdf)、[850](https://www.ufactory.cc/wp-content/uploads/2023/07/UFactory-850-User-Manual-V2.1.0.pdf)、[Lite 6](https://www.ufactory.cc/wp-content/uploads/2023/04/Lite-6-Developer-Manual-V1.11.0.pdf)）；这些是真机规格，不代表此演示的求解精度或运动范围保证。
