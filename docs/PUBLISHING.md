# 发布流程（npm + GitHub）

面向维护者。仓库改动 → 自检 → 发 npm → 打标签 → 建 Release → 收尾。每一步都写明了**为什么**和**实测踩过的坑**。

## 0. 前置

- 在 **WSL (Ubuntu)** 里执行，仓库在 `~/Common/dsh-flash-presets`。Windows 侧没有意义：npm 凭据在 `~/.npmrc`，profile 在 `~/.dsh`。
- Node ≥ 20、npm ≥ 10（当前实测 node 24.19 / npm 11.17）。
- 推 GitHub 用系统凭据助手（本机是 Windows GCM，`git config credential.helper` 指向它），**不要把 token 写进仓库或贴在聊天里**。

## 1. 改预设并重新合成

`presets/*.patch.yml` 是源，`cordis.patch.yml` 是合成产物（bundle 实际加载的是后者）。

```bash
npm run build      # 由 presets/* 重新合成 cordis.patch.yml
npm run check      # 断言合成结果与 presets/ 一致（CI 同款）
npm run verify     # verify-yaml + verify-presets --repo-only
bash scripts/selftest.sh
```

四项全绿再往下走。`prepublishOnly` 会把这四项再跑一遍（含 selftest），**任何一项失败都会中止发布**。

另外**人工过一遍文档陈述**：README 与 `docs/` 都在包里，脚本查不出"这句话还与事实相反"。发布前对照实测核一遍安装渠道、版本号、依赖写法、已知限制——0.2.2 → 0.2.3 就是因为 `docs/版本与兼容性.md` 还写着"npm 未发布"才需要重发。

## 2. 升版本号（两处必须一致）

```bash
npm version patch --no-git-tag-version      # package.json
```

同时把 README 顶部那行改掉：

```
> 当前版本：vX.Y.Z（分支 main）
```

**为什么两处**：`selftest.sh` 会从 README 解析版本去校验 `publish.sh` 取到的 tag，`verify-presets.mjs` 也会断言 README 里的版本串。漏改一处就报 `校验器未断言 vX.Y.Z`。

并在 `docs/CHANGELOG.md` 与 README 的「版本历史」各加一段——Release 正文就是从这里摘的。

## 3. 准备发布凭据

npm 现在**强制要求发布时存在 2FA**。三种情况：

| 账号状态 | 做法 |
|---|---|
| 已开 2FA | `npm publish --otp=123456`（验证码 30 秒过期） |
| 未开 2FA | 网页建 **Granular Access Token + Bypass 2FA**，短期用 |

建 token 的要点（<https://www.npmjs.com/settings/~/tokens>）：

- Permissions: **Read and write (publish and stage)**，`stage only` 发不出去。
- Expiration: **7 days**。
- Packages: 首版发布前包还不存在，下拉里选不到 → 只能 **All packages**；发过之后回来改成只限 `dsh-flash-presets`。
- 勾 **Bypass two-factor authentication (2FA)**。

写进本机（**不要提交、不要贴聊天**）：

```bash
npm config set //registry.npmjs.org/:_authToken=<token>
npm whoami          # 应打印你的 npm 用户名
```

## 4. 发布

```bash
npm publish
```

成功标志：`+ dsh-flash-presets@X.Y.Z`。

### 坑 1：网页授权流程我这边走不完

不带 bypass token 时 npm 会打印 `https://www.npmjs.com/auth/cli/...` 让人在浏览器批准，**它需要一个交互式终端**；在非交互 shell 里 npm 直接以 `EOTP` 退出。所以自动化发布必须用 bypass token 或带 `--otp`。

### 坑 2：会多出一个 `0.0.0-stage` 版本

首次用网页授权失败时，registry 上会留下一个 339 字节的空壳版本 `0.0.0-stage`（tarball 解压报 `Invalid checksum for TAR header`）。版本一旦发布删不掉，只能标废弃：

```bash
npm deprecate dsh-flash-presets@0.0.0-stage "staging placeholder; install <latest>"
```

### 坑 3：发布后立刻查不到

- **registry CDN 有缓存**：`npm view dsh-flash-presets version` 可能还显示旧版本，绕缓存查 `https://registry.npmjs.org/dsh-flash-presets/latest` 才是准的。
- **pnpm 元数据缓存**：刚发完就 `dsh plugin add dsh-flash-presets` 可能解析到上一个版本，用 `@X.Y.Z` 明确指定，或 `pnpm store prune` 后再装。
### 坑 4：profile 里会留下 pnpm 的 `minimumReleaseAgeExclude`

安装时 pnpm 11 会在该 profile 的 `pnpm-workspace.yaml` 里追加 `dsh-flash-presets@X.Y.Z`，**`dsh plugin remove` 不会清掉它**。这行由 pnpm 写入、不属于本包，也不影响配置合成——写文档时不要把"卸载无残留"说成绝对。

- 判断"到底发出去没有"最硬的证据：再 `npm publish` 一次，若报 `cannot publish over the previously published versions: X.Y.Z`，说明版本真实存在。

## 5. 打标签 + 推送

```bash
git add -A
git commit -m "feat|fix: ..."
git tag -a vX.Y.Z -m "vX.Y.Z：一句话说明"
git push origin main --follow-tags          # 用一个好的凭据助手推 main + 该 tag
```

远端确认：`git ls-remote --tags origin | grep vX.Y.Z`。

## 6. 建 GitHub Release

标签推上去后，用 API 建（正文取 `docs/CHANGELOG.md` 对应段落）：

```bash
T=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')
curl -s -X POST -H "Authorization: token $T" -H 'Accept: application/vnd.github+json' \
  https://api.github.com/repos/LarryE135/dsh-flash-presets/releases \
  -d '{"tag_name":"vX.Y.Z","name":"vX.Y.Z — 摘要","body":"...","draft":false}'
```

## 7. 收尾：删 token

```bash
npm token list                          # 记下 id
npm token revoke <id>                   # 实测 403：CLI 删不掉
```

**必须去网页删**：<https://www.npmjs.com/settings/larrye/tokens>。bypass 2FA + 全包读写的 token 是长期凭证，发完即删；下次发版再临时建。

删掉后 `npm whoami` 失效是正常的。

## 8. 发布后验证（建议每次都做）

```bash
# a) registry 侧
curl -s https://registry.npmjs.org/dsh-flash-presets/latest | python3 -c "import sys,json;print(json.load(sys.stdin)['version'])"

# b) 真装一遍（临时 profile，用完删）
dsh plugin --profile npmverify add dsh-flash-presets@X.Y.Z
dsh --profile npmverify --dump-config | grep -E 'id: preset-flash-lean-ptc-v[123]'
rm -rf ~/.dsh/profiles/npmverify
```

预期：三行预设 id 齐全。**注意** `verify-presets.mjs` 的第二层（安装层）针对的是 `scripts/install.sh` 写的托管块，不是 npm bundle 形态，别拿它去校验临时 profile。

## 版本语义

- **patch**（0.2.1 → 0.2.2）：修 bug、改文档、发 npm。
- **minor**（0.2 → 0.3）：新增预设或改变预设的默认取值。
- **major**：不兼容的安装形态变更（如再次回到目录式）。
