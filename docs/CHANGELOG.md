# 变更日志

## 0.2.1 — 2026-10-20

**新增**
- `presets/flash-lean-ptc-v3.patch.yml`：lean-v3，order 27，13 条行为规则，压缩 0.25 / 20k，PTC 展示层。
- 文档重写为可审计形态：README + 实测证据 + 版本与兼容性。

**修复**
- `merge-presets.mjs` 的托管块只拼前两个预设（`bodies[0] + bodies[1]` 硬编码）→ 改为 `bodies.join()`。
- `compose-bundle-patch.mjs`、`install.sh`、`install.ps1`、`selftest.sh` 中硬编码的 v1+v2 列表 → 支持三预设。
- `verify-presets.mjs` 对整块做宽松匹配（v2 的 0.3/50000 会被 v1 满足）→ 改为**逐预设切片断言**，各自核对 order / 规则条数 / 压缩阈值 / 保留预算 / 裁剪阈值 / PTC / tool-workflow。
- 安装器提示文案由"v1 与 v2"更新为"v1 / v2 / v3，v3 为主版本"。

**验证**
- 模拟安装回归（临时 `DSH_HOME`）：安装 → `--dump-config` 三预设 → 重复安装幂等 → 卸载干净。
- `compose-bundle-patch.mjs --check` 一致；`verify-yaml.mjs` 通过；`npm pack` 含三预设（7 个文件）。

## 0.2.0 — 2026-09-30

- 声明为 DSH 组合包（`dsh.bundle.patch` → 单文件 `cordis.patch.yml`）。
- 新增 `v2`：步数预算、少想多试、一次合并验证、先交最小可行产物。
- CI 增加 bundle-install 任务（真实 `dsh plugin add` + `--dump-config` 断言）。

## 0.1.0 — 2026-09-23 ~ 09-24

- 首个发布：`v1`（压缩 0.3 / 50k、14 条约束、PTC 展示层），含三平台安装器与旧版目录式回退。
