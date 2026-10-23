# marketplace/ —— 用于投稿 dsh-marketplace

本目录的 `plugin.json` 是 [ydhrdh/dsh-marketplace](https://github.com/ydhrdh/dsh-marketplace)（PR 审核制插件市场）的收录清单。

**安装方式（0.2.2 起）**：`target: npm`、`spec: dsh-flash-presets`、命令不带版本号（跟随 `latest`）。
清单里的 `version` 只用于展示，没有任何自动同步——**改 `package.json` 的版本或安装方式时，这里要手动跟着改**。

## 什么时候需要更新清单

| 改动 | 是否要动市场 |
|---|---|
| 只发新版，安装方式不变 | 可攒着改（`version` 字段过时不影响安装） |
| 安装方式变（git ↔ npm） | **必须改**：`install.target` / `spec` / `command` |
| 描述 / 分类 / tag / 兼容范围变 | **必须改** |

另有一条**自动目录**不需要任何操作：市场会定期抓所有打了 `dsh-plugin` topic 的仓库生成 `github-plugins.json`（安装 spec 固定为 `github:owner/repo`）。本仓库的 topic 已设置。

## 投稿 / 更新步骤

```bash
git clone https://github.com/ydhrdh/dsh-marketplace && cd dsh-marketplace
mkdir -p registry/plugins/dsh-flash-presets
cp /path/to/dsh-flash-presets/marketplace/plugin.json registry/plugins/dsh-flash-presets/plugin.json
npm install && npm run validate   # 本地先过（实测输出 [ok] dsh-flash-presets）
npm run build                     # 重新生成索引
# 然后开 PR（CI 必须绿）
```

## 同时需要的两件事（在 GitHub 仓库上设置）

1. **给仓库打 topic `dsh-plugin`**：仓库页 → ⚙️ About → Topics → 加 `dsh-plugin`。
   这既是 dshbase.com 等目录站的索引依据（<https://github.com/topics/dsh-plugin>），也是社区约定。
2. 仓库已声明组合包（`package.json` 的 `dsh.bundle.patch`），因此 `dsh plugin add` 不会再报 `not-a-bundle`。
