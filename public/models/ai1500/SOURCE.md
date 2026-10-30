# 六维力矩传感器（AI1500）资产来源

- 来源：[UFACTORY 官方下载中心](https://www.ufactory.cc/downloads) 3D 文件压缩包 `91NFE95ZAV15.zip`（SHA-256：`ece61e236dbc39aa20d9a015b5b704eba25ee338d58fad61d418fa04929a25ff`），内含 `6 Axis Force Torque Sensor(AI1500)_20260413.STEP`（SHA-256：`496bdf9e315e47c4cc8ceb3d73aa4bbb58cd621522f583af7f5847c1b6e255e3`）。
- 使用 `occt-import-js@0.0.23`（`linearUnit: "meter"`，`linearDeflectionType: "bounding_box_ratio"`，`linearDeflection: 0.001`，`angularDeflection: 0.5`）三角化并由 Three.js `GLTFExporter` 导出二进制 `model.glb`（15 个米制网格），校验值记录于 `SHA256SUMS`。
- 按圆形轮廓中心与 `58.6 mm` 轴向跨度，以 CAD `(-0.00424, 0.00668, 0.0657) m` 对齐机械臂末端法兰原点，`CAD +Z` 与法兰 `+Z` 同向。
- 传感器末端工具安装面与固定 TCP 偏移采用 UFACTORY Studio 默认值 `(0, 0, 58.6 mm, 0, 0, 0)`；串联夹爪时在该安装面上继续叠加对应夹爪变换。
