# shotkit — 画面自测量工具

给「实现者」用的一条命令自检：截图 + 量化指标 + 导出页面诊断字段。

## 为什么需要它

实测结论：只给代码层面的断言时，实现者会用 Node DOM/WebGL 桩自测，**从头到尾看不到画面**；
于是方向、单位、投影全对，画面却发灰（rmsContrast 30，评分 2/5）。装上这个工具后同一份清单：

| | 无工具（impl3） | 有工具（impl4） | 有工具 + 打光配方（impl5） |
|---|---|---|---|
| 质量分 | 1.55 | 3.93 | **4.00** |
| rmsContrast | 27.9 | 30.0 | **49.6** |
| token | 250k | 255k | **173.6k** |

## 安装

```bash
cd tools/shotkit && npm install        # 只装 puppeteer-core
```

需要本机已有 Chromium：路径为 `~/.cache/puppeteer/chrome/<版本>/chrome-linux64/chrome`。
没有时先 `npx puppeteer browsers install chrome`。

## 用法

```bash
node shot.mjs index.html shot.png
```

输出一行 JSON：

```json
{"size":"900x560","pinkPct":2.39,"whitePct":0.03,"meanLum":207.8,"rmsContrast":32,
 "consoleErrors":[],"diag":{"__SAKURA__.theta":0.62,"__SAKURA__.fov":42,"__SAKURA__.flowerCount":6558}}
```

字段：

| 字段 | 含义 | 典型目标 |
|---|---|---|
| pinkPct | 主色（粉）像素占比 | 8–12 |
| whitePct | 纯白像素占比（防泛白） | ≤ 0.5 |
| meanLum | 平均明度 | 150–190 |
| rmsContrast | RMS 对比度 | ≥ 45 |
| diag | 页面所有 `window.__*` 下的数值字段 | 用于判方向/单位/投影 |

## 注意

- 本工具解码 PNG 自行统计，不依赖页面 `readback`（WebGL 未开 `preserveDrawingBuffer` 时 `drawImage` 会得到空图）。
- 方向不要用像素质心判断：实测会把正确的 −1.000 rad 误判成 −12.4 px。方向一律读 `diag`。
- 本目录不在 npm 发布范围内（`package.json` 的 `files` 未包含 `tools/`）。
