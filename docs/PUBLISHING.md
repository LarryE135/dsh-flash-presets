# 发布流程（npm + GitHub）

面向维护者。仓库改动 → 自检 → 发 npm → 打标签 → 建 Release → 收尾。每一步都写明了**为什么**和**实测踩过的坑**。

## 发版前必跑：`npm run verify:full`

`npm run verify` 是第一步（12 个检查串联：sync-lib / 核心行 / 会话兼容 / YAML / 结构 / 文本审计 / 基准防泄漏 / 版本一致 / 兼容闸门 / 基准表 / bash 3.2 / ps1）。CI 还会跑 `selftest.sh`（断言 README 必须有 `### v<当前版本>` 小节）、`selftest-integration.sh`、装完再校验的 `verify-presets`、`alias-vs-config`、`verify-release-hygiene` 等
—— 0.3.2 就因只跑 `verify` 而两次「本地绿、CI 红」。

两步容易混：`lint-presets.mjs` 查的是**预设文本**（规则编号 / 缩进 / 自相矛盾 / 平台路径）加**代码块里的版本引用**与 `marketplace/plugin.json` 的版本；`package.json` / lock / 版本表 / 各文件 git tag 引用这类「版本真源」对账在 `verify-versions.mjs` 里。

**因此发版前（以及任何改版号、README 版本行、install 脚本 tag 引用的提交前）请跑：**

```bash
npm run verify:full
```

它按 `.github/workflows/verify.yml` 的 ubuntu 分支顺序串起 13 步不依赖平台/不依赖装 DSH 的检查（`node scripts/verify-all.mjs` 里 `run()` 的条数）。
Windows/macOS 专属步骤、plugin-tests 矩阵、装 DSH 后的 bundle-install / integration 仍只在 CI 跑。

## 0. 前置

- 仓库在 WSL 的 `~/Common/dsh-flash-presets`；**npm 发布只能在 WSL 做**（凭据在 `~/.npmrc`，profile 在 `~/.dsh`），
  **GitHub 推送 / Release 只能在 Windows 侧做**（凭据在 Windows 钥匙串，见下一条）。两半各在各的地方，别指望一条命令跑完。
- Node ≥ 20、npm ≥ 10（当前实测 node 24.19 / npm 11.17）。
- 推 GitHub / 建 Release 的**凭据只存在于 Windows 侧**：`C:\Users\<你>\.gitconfig` 里写着
  `credential.helper = !'C:\Program Files\GitHub CLI\gh.exe' auth git-credential`，走 Windows 钥匙串。
  **本机实测**：WSL 里没装 `gh`，git 也没有可用凭据 —— 在 WSL 内直接 `git push` 或跑 `scripts/publish.sh` 会卡在认证。
  可行路径是把仓库（**要带 `.git`**）复制到 Windows 临时目录，再用 `git.exe` / `gh.exe`：

  ```bash
  DEST=/mnt/c/Users/<你>/AppData/Local/Temp/dshpush
  rm -rf "$DEST" && mkdir -p "$DEST"
  tar -cf - --exclude=node_modules . | tar -xf - -C "$DEST"
  "/mnt/c/Program Files/Git/cmd/git.exe" -C C:/Users/<你>/AppData/Local/Temp/dshpush push origin HEAD:refs/heads/main
  "/mnt/c/Program Files/Git/cmd/git.exe" -C C:/Users/<你>/AppData/Local/Temp/dshpush push origin refs/tags/vX.Y.Z
  "/mnt/c/Program Files/GitHub CLI/gh.exe" release create vX.Y.Z "C:/.../dsh-flash-presets-vX.Y.Z.zip" \
    --verify-tag --latest --notes-file "C:/.../notes.md"
  ```

  实测（0.2.9）：`main` 推到 `77a3dbe`、tag `v0.2.9` 推送成功、Release 附件 1856659 B 与本地 `sha256` 一致。

  **不要把 token 写进仓库或贴在聊天里**。

## 0.5 历史发布状态（0.3.0 / 0.3.1 / 0.3.2 / 0.3.3）

> **当前（2026-11-17 第四轮审计后）**：正式版是 **0.3.2** —— npm `latest` 指向它（现查 `npm view dsh-flash-presets version`）、tag `v0.3.2` = `ea8c3d8`、GitHub Release 同日发布。
> **0.3.3 是误发版本**：原计划按 0.3.2 发布，`package.json` 被写成 0.3.3 且已 `npm publish`（tag `v0.3.3` = `54fc895`）。处置：0.3.2 追认为正式版（tag 从 `8f4d349` 移到 `ea8c3d8` 后重发，附件重出），0.3.3 用 `npm deprecate dsh-flash-presets@0.3.3 "<原因>"` 标弃用 —— **仍可安装，但包内容比 0.3.2 少第四轮 6 项修复**（`git diff --stat v0.3.2 v0.3.3` 可见 11 个文件差异），所以文档一律要求写死版本号。仓库 `package.json` 的 `version` / `publishedVersion` 现在都是 **0.3.2** **GitHub Release v0.3.3 已于 2026-11-17 晚删除**（正文与附件一并移除，`releases/latest` 仍是 v0.3.2）；tag `v0.3.3` 按冻结规则保留，npm 0.3.3 仍可安装但已 deprecate。
> **残留在 npm 上的一个 dist-tag**：`restore032` → 0.3.2（2026-11-17 追认 0.3.2 时用它绕过「新版本号低于已发布最高版本」的限制）。granular token 删它返回 403（`Granular access tokens that bypass two-factor authentication may not perform this action`），要清理得换 classic automation token 或在网页上删；它不影响任何安装路径（`npm i` / `@latest` 只看 `latest`）。（下一版是 0.3.4 之类的更高号，别再写回 0.3.3 —— 它已 deprecate，registry 会以 E403 拒绝覆盖）。
> **0.3.1（2026-11-12）**：npm 已发（当时的 `latest` = 0.3.1，`gitHead` = `5d02bee`（孤儿提交，与 `04b889e` 同树））、tag `v0.3.1` = `04b889e`、GitHub Release 已发（18:03Z）。上一版正式版。
> 下表是 **0.3.0（2026-11-07）** 当时的记录，原样保留作对照。

| 通道 | 状态 | 证据（可复跑） |
|---|---|---|
| GitHub `main` | 已推 | `gh api repos/LarryE135/dsh-flash-presets/commits/main --jq .sha` |
| GitHub tag | 已推 | `git rev-parse --short v0.3.0` → `5449ecb`。发布后想把它移到带文档订正的提交，被仓库的 tag 规则集拒绝（`push --force` 报 repository rule violations），所以 tag 留在 `5449ecb`，订正在 `main`（`f6ec4d7`）上——**发 npm 时从 tag 检出**，保证 npm == Release == tag |
| GitHub Release | 已发，latest | 附件 `dsh-flash-presets-v0.3.0.zip`，sha256 与 `git archive v0.3.0` 一致 |
| npm | **已发**（2026-11-07） | `npm view dsh-flash-presets version` → 0.3.0；`gitHead` = `5449ecb`（= tag）；39 个文件 / 解包 613 629 B / shasum `c276c00d`（现查：`npm view dsh-flash-presets@0.3.0 dist.*`） |

**npm 认证现状（2026-11-17 复核）**：认证书在 `~/.npmrc` 的 `//registry.npmjs.org/:_authToken=…`（granular token，勾了 Bypass 2FA），`npm whoami` 能正常返回用户名 —— 所以发布前先跑一次 `npm whoami` 确认登录态还在，别凭记忆假设。2026-11-07 那次 `E401 Unauthorized` 是旧 token 失效的现场记录（当时 Windows 侧 `%USERPROFILE%` 下也没有 `.npmrc`），现在不是常态；真报 E401 就说明 token 过期或被删，按 §3 重建 token 写回 `~/.npmrc` 再发。只有走网页授权（账号用 PIN、没有 TOTP）时，非 TTY 里 `npm publish` 才会以 `EOTP` 失败、授权 URL 被脱敏成 `***`，那种情形只能人在真终端做（见坑 1）。

## 0.6 本机的代理与网络（2026-11-07 实测，供发布时排障）

这台机器同时跑着两套代理，互不相干：

| 出口 | 监听 | 说明 |
|---|---|---|
| v2rayN（xray 核心） | `127.0.0.1:10808` | HTTP 与 SOCKS 同一端口都能用；**Windows 系统代理就是它**（`ProxyEnable=1`、`ProxyServer=127.0.0.1:10808`） |
| Clash Verge（verge-mihomo） | `127.0.0.1:7897` | WSL 里这些进程的 `http_proxy` / `https_proxy` 指向它 |

WSL 是 `networkingMode=mirrored` + `autoProxy=true`，所以 WSL 里的 `127.0.0.1` 就是 Windows 的 `127.0.0.1`；
但环境变量里写的是 7897（Clash）而不是 Windows 系统代理的 10808 —— 那是 WSL 启动那一刻的快照，后来系统代理换成 v2rayN 也不会跟着变。

**实测结论**：`api.github.com`、`github.com`、`registry.npmjs.org`、`raw.githubusercontent.com` 在「直连 / 7897 / 10808」三条路上都返回 200，
所以发布流程不需要为了网络去改全局代理；`gh.exe` 偶发的 `TLS handshake timeout` 是代理链路瞬时抖动（重试即可），不是配置错。

**按需桥接（都不动全局配置）**：

```bash
# 单条命令走 v2rayN；其它命令照常（不 export、不写 ~/.bashrc）
HTTPS_PROXY=http://127.0.0.1:10808 HTTP_PROXY=http://127.0.0.1:10808 gh run list

# 单条命令绕开代理（国内镜像、本来就直连的地址）
curl --noproxy '*' https://registry.npmmirror.com/dsh-flash-presets
npm view dsh-flash-presets version --noproxy=registry.npmmirror.com

# 只给 GitHub 这一个 URL 配 git 代理（不要用 git config --global http.proxy）
git config --global http.https://github.com.proxy http://127.0.0.1:10808
git config --global --unset http.https://github.com.proxy   # 用完撤掉
```

**发版脚本已经按这个口径接好**：`scripts/publish.sh` 的 `gh_()` 与 `scripts/publish.ps1` 的 `Invoke-Gh` 默认给 gh 加 `HTTPS_PROXY=http://127.0.0.1:10808`（可用环境变量 `GH_PROXY` 覆盖），并且先探测 10808 —— 端口没人监听就退回继承环境，不会因为 v2rayN 没开把发布弄断。`git push` / `npm` 等其它命令不受影响；`selftest.sh` 有两条断言锁住这个行为（含用假 gh 验证环境前缀随端口切换）。

**不要做的事**：把 `http_proxy` 写进 `~/.bashrc` / `/etc/environment`（会让本来直连的地址也失效）；
改 `.wslconfig` 的 `networkingMode` / `autoProxy`；给 Windows 加 TUN —— 三者都会把「按需」变成「全局」。
**本机状态（已收尾）**：Windows 桌面 profile 的依赖原来是 registry 规格 `0.2.9`，而 `node_modules` 里是手工刷进去的 0.3.0；npm 上出现 0.3.0 之后已把该依赖改成 `0.3.0`，并同步改了 `pnpm-lock.yaml` 的 importers / packages（integrity 取 `npm view dsh-flash-presets@0.3.0 dist.integrity`）/ snapshots 三处（备份为 `package.json.bak-0.3.0-*` / `pnpm-lock.yaml.bak-0.3.0-*`）。现在 `pnpm install` 不会再回退。

剩下两步，按顺序（`--dry-run` 会把 `prepublishOnly` 整条链跑一遍，含 `selftest.sh`）：

```bash
git checkout v0.3.0                          # 让 npm 包的 gitHead 与 Release 完全对齐
npm publish                                  # 本机账号用 passkey / PIN，必须在真终端跑
node scripts/sync-published-version.mjs      # publishedVersion: 0.2.9 -> 0.3.0
git checkout main
```

发完按 §8 复核，再把 CHANGELOG、审计索引、`版本与兼容性.md`、两份 README 里的「npm 待发」改成已发（附 `npm view` 的实测输出）。

## 1. 改预设并重新合成

`presets/*.patch.yml` 是源，`cordis.patch.yml` 是合成产物（bundle 实际加载的是后者）。

```bash
npm run build      # 由 presets/* 重新合成 cordis.patch.yml
npm run check      # 断言合成结果与 presets/ 一致（CI 同款）
npm run verify     # verify-yaml + verify-presets --repo-only
bash scripts/selftest.sh
```

上面几步全绿再往下走。`prepublishOnly` 会把整条链（`package.json` 里串联的 12 步，含 selftest）再跑一遍，**任何一步失败都会中止发布**。

另外**人工过一遍文档陈述**：README 与 `docs/` 都在包里，脚本查不出"这句话还与事实相反"。发布前对照实测核一遍安装渠道、版本号、依赖写法、已知限制——0.2.2 → 0.2.3 就是因为 `docs/版本与兼容性.md` 还写着"npm 未发布"才需要重发。

## 2. 升版本号（**三处**必须一致：`version` / `publishedVersion` / README「当前版本」）

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

**先按 §5 打 tag 并 `git push origin $TAG`** —— `scripts/publish-npm.sh` 会断言「tag 已推到 origin 且等于 HEAD」，否则直接 fail。推荐整条用 `bash scripts/publish-npm.sh`（= 本节 + `verify-published` 复核）。

先跑一次试发布（不改 registry，但会执行 `prepublishOnly` 整条链）：

```bash
npm publish --dry-run        # 期望末行：+ dsh-flash-presets@X.Y.Z；再看 total files 与 shasum
npm publish --otp=<6 位码>    # 真发；token 勾了 Bypass 2FA 时直接 npm publish 即可
```

成功标志：`+ dsh-flash-presets@X.Y.Z`。**发布不可逆**（72 小时内可 unpublish），所以 `--dry-run` 那一步不要跳。
`--dry-run` 打出来的 `total files` / `package size` / `shasum` 就是 `npm view dsh-flash-presets dist.fileCount dist.unpackedSize dist.shasum` 该对上的值。

**发完核对已发布版本号**：正常流程里 `publishedVersion` 在发版提交里就已经改成新号（`publish-npm.sh` 会断言它等于 `version`），所以这一步应为空操作；只有在补发/回滚时才需要它把白名单拉回来：

```bash
node scripts/sync-published-version.mjs   # 把 package.json 的 publishedVersion 写成当前 version
```

### 坑 1：网页授权流程在非交互 shell 里根本走不完（2026-11-06 实测）

账号用 passkey / 电脑 PIN 登录时没有 6 位 TOTP，走的是网页授权：npm 打印 `https://www.npmjs.com/auth/cli/<secret>`，
浏览器里用 PIN 批准后 npm 取回一个短期 token。实测（npm 11.17.0 / node 24.19）在**非 TTY** 的 shell 里：

- `npm publish` 直接以 `npm error code EOTP` 退出，不会去轮询；
- 那条 auth URL 被替换成 `***`，`~/.npm/_logs/` 的 debug 日志里也没有（所以 agent / CI 连“把链接转给人”都做不到）；
- EOTP 之后 registry 没有任何半成品（`npm view dsh-flash-presets version` 仍是上一版）。

两条可行路径：

| 做法 | 谁来做 | 说明 |
|---|---|---|
| 在**真终端**里跑 `npm publish` | 本人 | 有 TTY 才会打印真实 URL，浏览器用 PIN 批准即可 |
| 建 **Bypass 2FA** 的 granular token 写进 `~/.npmrc` | 本人 | 之后 agent/CI 可 `npm publish`；token 不要进聊天、不进仓库 |
| `npm publish --otp=<6 位码>` | 已开 TOTP 的账号 | 本机账号没有 TOTP，不适用 |

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
# main 受分支保护（ruleset「protect main」）：不能直推，改动必须走 PR 并通过
#   verify (ubuntu-24.04) / plugin-tests (24) / integration / pack-doctor 四个检查。
# 发版顺序：先合并 PR → 本地 main 与 origin/main 一致 → 再只推 tag：
git push origin "$TAG"                       # 用一个好的凭据助手推 tag
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

### 插件（`dsh-plan-mode-ui`）不单独建 Release

插件版本号（当前 `1.0.0`）独立演进，但**发布面跟着主版本走**：

- **不打 `plan-mode-ui-*` tag**，也不单独建 Release。一旦打了，Releases 页会多出一条，
  而且按提交时间排序时它常常变成 `Latest`，把主版本顶下去（2026-10-31 实测踩过，已撤销）。
- 需要发插件时，**把 zip 作为主版本 Release 的附件**挂上去：

```bash
gh release upload vX.Y.Z ~/.dsh/artifacts/dsh-plan-mode-ui-vA.B.C.zip
```

  并在正文里写一句「插件 `dsh-plan-mode-ui` vA.B.C 见附件」。
- 插件源码在 `plugins/plan-mode-ui/`（`.gitattributes` 里 `export-ignore`，不进 npm 包），
  重新打包命令见 `plugins/plan-mode-ui/README.md`。
- 有 `scripts/verify-release-hygiene.mjs` 守着这条约定，`npm run verify` 时会检查。

## 7. 收尾：删 token

```bash
npm token list                          # 记下 id
npm token revoke <id>                   # 实测 403：CLI 删不掉
```

**必须去网页删**：<https://www.npmjs.com/settings/~/tokens>。bypass 2FA + 全包读写的 token 是长期凭证，发完即删；下次发版再临时建。

删掉后 `npm whoami` 失效是正常的。

## 7.5 0.2.6 起：插件与本包一起发

发布顺序固定为「先插件、再主包、最后 Release」，因为插件一旦上了 npm，主包 README 就能直接写
`dsh plugin add dsh-plan-mode-ui`（而不只是本地 tgz）：

```bash
# 0) 打包插件 + 自检（11 个文件：lib/ 下 7 个 + cordis.patch.yml、README.md、LICENSE、package.json）
node scripts/pack-plugin.mjs            # → dist/dsh-plan-mode-ui-A.B.C.tgz
npm test --prefix plugins/plan-mode-ui  # 30 个测试文件全跑（test/run.sh 遍历 test/*.mjs）

# 1) 插件先上 npm（需要 OTP；两个包用同一个 OTP 窗口内连发）
npm publish plugins/plan-mode-ui --otp <code> --access public

# 2) 主包
npm publish --otp <code>

# 3) 主版本 Release（正文写「插件 dsh-plan-mode-ui vA.B.C 见附件」）
gh release create vX.Y.Z dist/dsh-flash-presets-vX.Y.Z.zip --title "vX.Y.Z" --notes-file /tmp/notes.md
# 附件是 **zip**（`git archive --format=zip`，见 `scripts/publish.sh` 的 Release 段），不是 tgz

# 4) 插件 zip 作为同一 Release 的附件（不单独建 Release、不打 plan-mode-ui-* tag）
gh release upload vX.Y.Z ~/.dsh/artifacts/dsh-plan-mode-ui-vA.B.C.zip

# 5) 核对：Releases / tags 里都不该出现 plan-mode-ui-*；两个包版本与文档一致
npm run verify:release && npm run verify:versions
```

0.2.6 起计划模式插件已并入主包：安装主包即带宿主与浏览器半边，`--with-plan-mode` 只做旧插件清理与运行时调优；
`dist/dsh-plan-mode-ui-*.tgz` 仍产出，供老用户单独装（升级须先 `dsh plugin remove dsh-plan-mode-ui`，否则同 id 双实例）。

## 8. 发布后验证（建议每次都做）

```bash
# a) registry 侧
curl -s https://registry.npmjs.org/dsh-flash-presets/latest | python3 -c "import sys,json;print(json.load(sys.stdin)['version'])"

# b) 真装一遍（临时 home，用完删）
dsh plugin --profile web add dsh-flash-presets@X.Y.Z
dsh --profile web --dump-config | grep -c 'id: preset-'        # 干净 profile = 6（两张卡 + 4 个内置）
dsh --profile web --dump-config | grep -c 'flash-presets-alias' # 必须是 1，否则旧会话打不开
rm -rf ~/.dsh/profiles/web

# b2) 与试发布时记下的数字对齐（0.2.9 的 dry-run：39 个文件；体积与 shasum 以当次输出为准）
npm view dsh-flash-presets dist.fileCount dist.unpackedSize dist.shasum
node scripts/sync-published-version.mjs      # publishedVersion 忘了跟进，lint 就拦不住旧版本号
```

预期：6 行预设、1 行 `flash-presets-alias`。**注意** `verify-presets.mjs` 的第二层（安装层）针对的是 `scripts/install.sh` 写的托管块，不是 npm bundle 形态，别拿它去校验临时 profile。

```bash
# c) npm 页面内容（README 只在 publish 时刷新，必须单独核对）
curl -s https://registry.npmjs.org/dsh-flash-presets | python3 -c "import sys,json;r=json.load(sys.stdin)["readme"];print(len(r));print(\"含基准节:\" , \"办公基准测试\" in r);print(\"含 bench:office:\", \"bench:office\" in r)"
```

README 是**发布那一刻的快照**：仓库改完不重新发布，npm 页面上就是旧内容（0.2.5 发布后仓库加了整节基准测试，npm 页面直到 0.2.6 才会变）。所以每次发版都要跑上面这条，确认 `含基准节: True`、`含 bench:office: True`，否则说明发布的不是最新 README。

## 版本语义

- **patch**（0.2.1 → 0.2.2）：修 bug、改文档、发 npm。
- **minor**（0.2 → 0.3）：新增预设或改变预设的默认取值。
- **major**：不兼容的安装形态变更（如再次回到目录式）。
