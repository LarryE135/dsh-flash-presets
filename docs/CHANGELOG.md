# 变更日志

## 0.2.1 — 2026-10-20

**新增**
- `presets/flash-lean-ptc-v3.patch.yml`：lean-v3，order 27，13 条行为规则，压缩 0.25 / 20k，PTC 展示层。
- 文档重写为可审计形态：README + 实测证据 + 版本与兼容性。

**修复**
- `merge-presets.mjs` 的托管块只拼前两个预设（`bodies[0] + bodies[1]` 硬编码）→ 改为 `bodies.join()`。
- `compose-bundle-patch.mjs`、`install.sh`、`install.ps1`、`selftest.sh` 中硬编码的 v1+v2 列表 → 支持三预设。
- `verify-presets.mjs` 对整块做宽松匹配（v2 的 0.3/50000 会被 v1 满足）→ 改为**逐预设切片断言**，各自核对 order / 规则条数 / 压缩阈值 / 保留预算 / 裁剪阈值 / PTC / tool-workflow。
- 安装器提示文案统一为"v1 / v2 / v3，v3 为主版本"，sh 与 ps1 两侧同步；`check-ps1.mjs` 改为先解析整段预设列表再比对，避免只匹配到第一个 `vN` 时误判通过。

**验证**
- 模拟安装回归（临时 `DSH_HOME`）：安装 → `--dump-config` 三预设 → 重复安装幂等 → 卸载干净。
- `compose-bundle-patch.mjs --check` 一致；`verify-yaml.mjs` 通过；`npm pack` 含三预设（发布时 7 个文件，补齐 `scripts/`、`docs/` 后为 22 个）。

**发布后修正（2026-10-21）**

标签 `v0.2.1` 已移到包含这些修正的最新提交。

- 恢复 README 的「当前版本：v0.2.1」锚点。`selftest.sh`、`publish.sh`、`publish.ps1` 都靠它取版本，改写文风时丢了，导致自测与发布脚本同时失效。
- `install.ps1` 的完成文案补上 v3；`check-ps1.mjs` 改为先解析整段预设列表再比对。
- README 删除重复段落；`compactionRetries` 按预设注明（v1=2，v2 与 v3=1）。
- CI 的组合包断言补上 v3；`files` 补 `scripts/` 与 `docs/`；`compose --check` 分别打印字符数与字节数。
- `merge-presets.mjs`：托管块缺结束标记时拒绝改动（此前会静默删掉块后的内容）；写入时沿用文件原有换行符，Windows 的 CRLF 配置现在能逐字节还原；接受 `[ ]` 这种空数组写法。
- `install.sh`：`--profile` 缺参数时给出明确提示并以 2 退出。
- 旧式目录回退的 `preset.yml`：order 由 22 对齐为 21，名称补上 v1，描述不再引用已删除的非 PTC 预设。
- README：行为约束按五类重写（此前漏掉工具与输出那组）；版本历史补上 `v1.0.0`、`v1.0.1`、`v1.1.0` 三个旧标签的归属。
- `check-ps1.mjs`、`selftest.sh` 补文件末尾换行。
- CI 的 `actions/checkout` 与 `actions/setup-node` 由 `@v4` 改为钉提交 SHA（v4.2.2 / v4.1.0），避免上游标签被移动带来的供应链风险。
- `install.ps1` 补 `-Help`，与 `install.sh --help` 对齐；`check-ps1.mjs` 增加「两个安装器都有帮助入口」的断言。
- LICENSE 署名由 `dsh-flash-presets contributors` 改为 `LarryE135`。

## 0.2.0 — 2026-09-30

- 声明为 DSH 组合包（`dsh.bundle.patch` → 单文件 `cordis.patch.yml`）。
- 新增 `v2`：步数预算、少想多试、一次合并验证、先交最小可行产物。
- CI 增加 bundle-install 任务（真实 `dsh plugin add` + `--dump-config` 断言）。

## 0.1.0 — 2026-09-23 ~ 09-24

- 首个发布：`v1`（压缩 0.3 / 50k、14 条约束、PTC 展示层），含三平台安装器与旧版目录式回退。
