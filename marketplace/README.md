# marketplace/ —— 用于投稿 dsh-marketplace

本目录的 `plugin.json` 是 [ydhrdh/dsh-marketplace](https://github.com/ydhrdh/dsh-marketplace)（PR 审核制插件市场）的收录清单。

## 投稿步骤（需你手动执行一次）

```bash
git clone https://github.com/ydhrdh/dsh-marketplace && cd dsh-marketplace
mkdir -p registry/plugins/dsh-flash-presets
cp /path/to/dsh-flash-presets/marketplace/plugin.json registry/plugins/dsh-flash-presets/plugin.json
npm install && npm run validate   # 本地先过
npm run build                     # 重新生成索引
# 然后开 PR（CI 必须绿）
```

## 同时需要的两件事（在 GitHub 仓库上设置）

1. **给仓库打 topic `dsh-plugin`**：仓库页 → ⚙️ About → Topics → 加 `dsh-plugin`。
   这既是 dshbase.com 等目录站的索引依据（<https://github.com/topics/dsh-plugin>），也是社区约定。
2. 仓库已声明组合包（`package.json` 的 `dsh.bundle.patch`），因此 `dsh plugin add` 不会再报 `not-a-bundle`。
