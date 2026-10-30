# plan-mode-ui（源码存放，**不随发布物出货**）

这个目录是计划模式插件 `dsh-plan-mode-ui` 的源码副本，用于随仓库一起做版本管理。

它**不是**本预设包的一部分，两条出货路径都已排除：

| 路径 | 排除方式 |
|---|---|
| npm 包（`npm pack`） | `package.json` 的 `files` 是白名单，未列 `plugins/` |
| GitHub Release（`git archive HEAD` → `dist/dsh-flash-presets-<tag>.zip`） | `.gitattributes` 里 `plugins/plan-mode-ui export-ignore` |

原因：插件尚未稳定，作者在稳定前不发布。

## 目录内容

- `lib/`：宿主半（`index.js`）+ 客户端半（`client.js`）
- `test/run.sh`：64 项自测（`bash test/run.sh`）
- `cordis.patch.yml`：插件自身的 profile 补丁层
- `兼容性-rc5.md`：DSH 0.2.1-rc.5 的兼容性实测记录

## 后续

- 稳定后要发布时，先补 `files` 白名单条目、去掉 `export-ignore`，再走 npm / Release。
- 实验目录（`exp/`、`promo/`）与打包产物（`*.tgz`）刻意没有拷进来，避免把数据带进仓库。
