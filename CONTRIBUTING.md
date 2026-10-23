# 贡献指南

本仓库是**纯补丁层**（`dsh.bundle`）：没有运行时代码，产物就是几个 YAML 预设。因此评审重点不是"能不能跑"，而是**规则文本是否一致、可移植、可复现**。

## 提交前必须本地跑通

```console
npm run verify     # YAML 解析 + 结构/跨平台检查 + 预设文本审计
npm run check      # 断言 cordis.patch.yml 与 presets/* 的合成结果一致
```

改过 `presets/*.patch.yml` 就必须重新合成 `cordis.patch.yml`：

```console
npm run build
```

## 预设文本审计会拦什么

`scripts/lint-presets.mjs` 检查四类历史踩过的坑：

| 检查 | 典型的错法 |
|---|---|
| 规则编号连续 | 删规则不重编号，出现 1,2,4 |
| 规则缩进一致 | 某条规则多缩进几格，块标量里视觉脱离列表 |
| 规则自相矛盾 | 前一条禁用 `head`，后一条又要求 `\| head -40` |
| 平台相关路径 | 只写 `/tmp/out.log`，Windows 用户照抄失败 |
| 版本引用漂移 | 文档写着 `@0.2.3`，但该版本从未发布 |

已确认但暂不改动的历史缺陷登记在 `scripts/lint-allowlist.json`，修好后请把对应条目删掉。

## 范围纪律

- **一个 PR 一件事**。改规则文本的 PR 不要顺手删版本历史、改 README 措辞——这类夹带改动最容易在评审里漏掉。
- 若确实需要附带改动，请在 PR 描述里**逐条列出**，不要只写主改动。
- 冻结版本（v1、v2 与现行 v3）改动前请先开 issue 说明动机：这些文本直接决定已有实验的可复现性。

## 版本号

- 发布前把 `package.json` 的 `version` 改成将要发布的版本号；
- 文档里出现的 `dsh-flash-presets@x.y.z` 必须与该版本号一致（审计脚本会查）；
- 放弃发布的版本要在 README/CHANGELOG 里删干净，不要留"未发布（计划 x.y.z）"章节。
