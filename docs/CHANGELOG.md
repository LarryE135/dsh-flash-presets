# 变更日志

## 0.2.6 — 未发布

- 计划把 plan mode 插件 `dsh-plan-mode-ui`（当前 0.5.2）的 zip **作为本版本 Release 的附件**发布，
  不再为插件单独建 Release / 打 tag（`plan-mode-ui-v0.5.2` 已于 2026-10-31 撤销）。
- 新增 `npm run verify:release`：断言 Releases 与远端 tags 里都没有 `plan-mode-ui-*`，
  且 `docs/PUBLISHING.md` 仍保留该约定（接进 `prepublishOnly`）。

## 0.2.5 — 2026-10-30

本轮同时是本包在 npm 的首次发布；默认只装一个预设（v3）。

- **bundle 只发 v3**：`scripts/compose-bundle-patch.mjs` 默认只合成 `presets/flash-lean-ptc-v3.patch.yml`，加 `--all` 才合成三份。`cordis.patch.yml` 由 36.6 KB 降到 12.3 KB，安装后预设列表只多一项。

起因：用户报告"装完预设后不能选工作区"。排查后确认预设补丁不碰工作区/目录选择器/终端插件（全仓库 grep 0 命中），但过程中暴露出两个真实缺陷，加上一个缺失的诊断入口，一并补上。

**安装器**
- `merge-presets.mjs`：新增"认领历史残留"。旧安装方式写的裸行（`- id: preset-flash-lean-ptc-vN` 不在托管块内）以前不会被清理，重装即产生第二份同名预设。现在整条摘掉并入托管块；只摘"直接子行全部是本仓库预设 id"的条目，别人的行不动。
- `merge-presets.mjs`：写盘前调用 `lib/platform-tags.mjs` 解析 `!!js`，profile 补丁里只留 true/false。未知的 `!!js` 表达式直接报错，避免把非标准 YAML 写进用户配置。

**新增**
- `scripts/doctor.mjs`：体检 DSH 版本、托管块数量、块外残留、`!!js` 行号、标准 YAML 解析（报错带行号）；`--fix` 就地解析标签并备份，`--dump` 额外跑 `dsh --dump-config` 确认预设被合成进去。
- `lib/platform-tags.mjs`：平台标签解析的唯一实现，安装器与医生共用。

**修复（issue #5）**
- v1 / v2 的 persona suffix 以 `Your working directory is {{cwd}}.` 开头，而 DSH 的提示词插值是严格模式，只注册了 `provider` 与 `model`；选中这两个预设后**任意一轮对话都会抛 `unknown prompt variable "{{cwd}}"` 并中止**，等于 v1/v2 完全不可用。工作目录本来就由 runtime context 注入，占位符是 Claude Code 沿用的写法，已两处删除（v1、v2 源文件；`cordis.patch.yml` 重新合成）。
- `verify-presets.mjs`：新增"未注册提示词变量"断言——扫描三个预设源文件与合成产物里的 `{{var}}`，只允许 `provider`/`model`，出现别的直接判失败。此前这类错误只会在用户选中预设时才炸。

**验证**
- 合成"用户行 + 老式残留"的补丁：安装后 v3 只出现 1 次、`!!js` 为 0、js-yaml 直接解析通过、用户自己的行保持原样。
- 连跑两次安装：字节级幂等。
- 真实 profile（`zz-duptest`）：`dsh --profile zz-duptest --dump-config` 正常，linux 下 `tool-pwsh` 落成 `disabled: true`。
- `bash scripts/selftest.sh`：30 项通过。

响应 issue #4（Gold-Ballon）。四条缺陷已复核，全部属实，已逐条修复。

**校验器**
- `verify-yaml.mjs`：`EXPECT` 补入 v3（order 27 / 13 条规则 / 0.25 / 20000）；默认分支新增对合成产物 `cordis.patch.yml` 的解析断言；安装器分支由「含 v1/v2」改为「含 v1/v2/v3」。此前 v3 的 YAML 损坏可完整绕过 `npm run verify`。
- `verify-yaml.mjs`：未找到 js-yaml 时退出码由 0 改为 2（原为 fail-open）；`install.sh` / `install.ps1` 区分「通过 / 跳过 / 失败」三态，不再把跳过打印成通过。
- `verify-presets.mjs`：安装层行尾断言由字面 `\n` 改为 `\r?\n`，CRLF profile 下不再误报。

**文档与产物**
- v2/v3 的压缩参数注释对齐实际值（0.25 / 保留 20000，原注释残留 v1 的 300k/50k）。
- `docs/版本与兼容性.md` 版本表补到当前版本；`marketplace/plugin.json` 版本同步（改版本时两处一起动）。
- `candidates/flash-lean-ptc-v4-plan-accept.patch.yml` 改为 `- insert:` 形态：扁平 `- id:` 行在预设包里会被静默忽略，此前该候选实际不生效。

**变异测试**（新增防线均实测通过）
- 破坏 v3 缩进 → `verify-yaml` exit 1（js-yaml 报 bad indentation）
- CRLF profile → 安装层校验 exit 0（原会 3 项误报）
- 移除 js-yaml → exit 2 且打印「跳过，不等于通过」

- **安装器**：`install.sh` 的 `PRESETS` 默认只有 `flash-lean-ptc-v3`，新增 `--all-presets`；`install.ps1` 对应 `-AllPresets`。legacy 目录式安装固定走 v1（旧式目录本就只提供 v1）。
- **校验链**：`verify-yaml` 反向断言合成产物不得混入 v1/v2；`check-ps1` 的名单断言改为"presets/ 的子集且含最新"，不再要求与源文件列表全等。
- **文档**：README 中英、版本与兼容性表、本文件同步为"默认只装 v3"。
- **npm**：本包首次发布到 npm（此前 npm 上最新只有 0.2.4）。plan mode 插件仍不在 npm 发布范围内。

## 0.2.4 — 2026-10-24

**修复**
- npm 包缺 `presets/legacy-0.1.5/`：DSH 0.1.7 以前的目录式回退只有 v1 提供，此前只存在于仓库、没进 tarball，从 npm 安装的用户拿不到。
- npm 包缺 `.gitattributes`：包内自带的 `scripts/verify-presets.mjs` 依赖它判断行尾，导致在解包目录里跑自检直接 3 项失败。

**验证**：`npm pack` 后解包、在包内跑 `node scripts/verify-presets.mjs --repo-only` 应全绿（已实测）。

## 0.2.3 — 2026-10-24

**预设**
- v3 规则 5/6 的 shell 工具表述改为「不用 shell 浏览文件，但命令自身输出可管道给 head」，消除自相矛盾（PR #3）。
- v3 规则 6 的临时目录写法改为 PowerShell / cmd / POSIX 三态（`$env:TEMP`、`%TEMP%`、`/tmp`），此前 `$TEMP` 在 cmd 下不成立。
- v3 规则 13 缩进对齐，块标量里不再视觉脱离列表。

**文档**
- 删除「未发布（计划 0.2.3）」幽灵版本章节；npm 渠道版本引用统一到 0.2.3。
- tarball 文件数更正为 28（原写 22），README 仓库结构补上 `plugins/`、`candidates/`、`marketplace/`。

**工具与 CI**
- 新增 `scripts/lint-presets.mjs`：规则编号、缩进、自相矛盾（双向）、平台路径、版本引用漂移。
- 新增 `scripts/verify-runtime.mjs`：核对 `dsh --dump-config` 里的 order / 阈值 / 规则条数 / PTC。
- `verify-presets.mjs` 补仓库层取值断言（此前 `--repo-only` 会跳过全部取值检查）、行尾与文档链接检查。
- CI 增加最小权限 `permissions: contents: read` 与两步新校验；`.gitattributes` 的 `*.ps1` 改为 LF（原先声明 CRLF 但实际是 LF）。

**新增文档**：`CONTRIBUTING.md`、PR 模板、三份审计报告（结构 / 深挖 / 运行时）。
## 0.2.2 — 2026-10-21

**新增**
- 发布到 npm（`dsh-flash-presets`）：`dsh plugin --profile web add dsh-flash-presets` 即可安装。README 增加 npm 徽章、npm 安装段与 GitHub 直装段。
- `verify-presets.mjs` 新增开关：`--repo-only`（只跑仓库层，供发布前守卫与 CI 用）、`--all`（要求三个预设都已安装）。
- `package.json` 增加 `prepublishOnly`：合成一致性 + YAML 校验 + 仓库层结构校验，任一失败即中止发布。

**修复**
- `verify-presets.mjs` 安装层误报：未安装的预设此前仍逐项断言，导致只装 v3（常态）时报 25 项失败 → 改为跳过未安装项，仅 `--all` 时要求齐全。
- `verify-presets.mjs` 切片范围：此前只在托管块内找预设行，而 `dsh plugin` 合并后的预设行可能落在块外（实测两者并存）→ 改为在整份补丁内定位；PTC 与绝对路径检查同步改为只看已装预设。

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
