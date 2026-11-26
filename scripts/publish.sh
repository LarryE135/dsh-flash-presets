#!/usr/bin/env bash
# 把本仓库推到 GitHub（main + tag + release）。
#   最简单：先 `gh auth login`，再执行  bash scripts/publish.sh
#   Release 正文：RELEASE_NOTES=说明.md bash scripts/publish.sh（或把文件作第一个参数）；标题可用 RELEASE_TITLE 覆盖
#   或先改好下面的 GH_USER / REPO / VISIBILITY，或直接用环境变量覆盖它们。
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

GH_USER="${GH_USER:-LarryE135}"
REPO="${REPO:-dsh-flash-presets}"
VISIBILITY="${VISIBILITY:-public}"          # public | private
TAG="${TAG:-$(sed -n 's/.*当前版本：\(v[0-9][0-9.]*\).*/\1/p' README.md | head -1)}"
if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "✖ 本地没有标签 $TAG —— 请先提交并打标签" >&2
  exit 1
fi
REMOTE="${REMOTE:-https://github.com/$GH_USER/$REPO.git}"
DRY_RUN="${DRY_RUN:-0}"

# ── 发布前置守卫（第五轮审计 T1-4）──────────────────────────────────────────────
# 事故形态：标签打在一个不在 main 上的提交（0.2.9 就是这样：tag → 536959e，而 main 早已往前走），
# 于是 `git push origin $TAG` 把一条孤儿提交推上去，GitHub Release 的压缩包与用户装的 main 完全不同。
# 这四条是 fail-closed 的：任一不满足就退出，不做任何推送。
echo "目标：${GH_USER}/${REPO}（${VISIBILITY}），标签 ${TAG}"

fail() { echo "✖ $1" >&2; shift; for line in "$@"; do echo "  $line" >&2; done; exit 1; }

# ① 工作区必须干净：发布出去的东西必须就是仓库里的东西
[ -z "$(git status --porcelain)" ] || fail "工作区有未提交的改动（发布物必须与仓库一致）" "先 git commit 或 git stash 再跑本脚本"

# ② package.json 的版本必须与标签一致
PKG_VERSION="$(node -p 'require("./package.json").version' 2>/dev/null || echo '')"
[ "$PKG_VERSION" = "${TAG#v}" ] || fail "package.json 版本（$PKG_VERSION）与标签（$TAG）不一致" "改 package.json / README / CHANGELOG 后重新打标签"

# ③ 标签必须正好指在 HEAD 上（不是「祖先」）：0.2.9 就是从 tag 之后的提交发的 npm（第六轮 U2-1）。
if [ "$(git rev-parse HEAD)" != "$(git rev-parse "$TAG^{commit}")" ]; then
  fail "标签 ${TAG}（$(git rev-parse --short "$TAG^{commit}")）不是当前 HEAD（$(git rev-parse --short HEAD)）" \
    "要在新提交上发版：升版本号 + 重新打标签（git tag -a ${TAG}）；不要移动已发布的 tag" \
    "已经发过 npm 的版本，包内容不可改 —— 出问题就升版本号"
fi

# ③b 标签那次 CI 必须是绿的（0.2.9 的 tag run 是红的，npm 仍在 1 分钟后发出去了）。
# 本轮修正：原来是「有 gh 就查、查不到就跳过、conclusion 为空也放行」——这三条都会在
# 真正需要拦的时候放行（gh 没登录、run 还在跑、run 列表为空）。现在改成 fail-closed：
# 证明不了绿就不发，确要跳过必须显式 ALLOW_UNKNOWN_CI=1。
GH_PROXY="${GH_PROXY:-http://127.0.0.1:10808}"
gh_() {
  if (exec 3<>/dev/tcp/127.0.0.1/10808) 2>/dev/null; then
    HTTPS_PROXY="$GH_PROXY" HTTP_PROXY="$GH_PROXY" gh "$@"
  else
    gh "$@"
  fi
}

if command -v gh >/dev/null 2>&1; then
  RUNS_JSON="$(mktemp)"
  if gh_ run list --commit "$(git rev-parse "$TAG^{commit}")" --limit 30 --json conclusion,status,event >"$RUNS_JSON" 2>/dev/null; then
    if grep -qE '"conclusion":"(failure|cancelled|timed_out|action_required|startup_failure)"' "$RUNS_JSON"; then
      rm -f "$RUNS_JSON"
      fail "标签提交的 CI 有失败/取消/超时的 run" "等 main 的 CI 绿了再打标签；红灯下发版正是 0.2.9 犯过的错"
    fi
    COMPLETED="$(grep -c '"status":"completed"' "$RUNS_JSON" 2>/dev/null || true)"
    if [ "${COMPLETED:-0}" = "0" ]; then
      rm -f "$RUNS_JSON"
      fail "标签提交上找不到任何已完成的 CI run（无法证明它是绿的）" \
        "等这个 tag 的 verify / pack 跑完再发；确要跳过：ALLOW_UNKNOWN_CI=1 bash scripts/publish.sh"
    fi
    if grep -qE '"status":"(queued|in_progress|pending|waiting|requested)"' "$RUNS_JSON"; then
      rm -f "$RUNS_JSON"
      if [ "${ALLOW_UNKNOWN_CI:-0}" = "1" ]; then
        echo "⚠ 标签提交的 CI 还有未完成的 run，已按 ALLOW_UNKNOWN_CI=1 跳过"
      else
        fail "标签提交的 CI 还有未完成的 run（现在发版等于赌它绿）" \
          "等跑完再发；确要跳过：ALLOW_UNKNOWN_CI=1 bash scripts/publish.sh"
      fi
    else
      echo "标签提交的 CI：${COMPLETED} 个 run 已完成，无失败/取消"
    fi
  else
    rm -f "$RUNS_JSON"
    if [ "${ALLOW_UNKNOWN_CI:-0}" = "1" ]; then
      echo "⚠ 查询标签提交的 CI 失败，已按 ALLOW_UNKNOWN_CI=1 跳过"
    else
      fail "查询标签提交的 CI 状态失败（gh run list 出错）" \
        "确认 gh 已登录、代理可用后重试；确要跳过：ALLOW_UNKNOWN_CI=1 bash scripts/publish.sh"
    fi
  fi
  rm -f "$RUNS_JSON"
elif [ "${ALLOW_UNKNOWN_CI:-0}" = "1" ]; then
  echo "⚠ 没装 gh，无法核对标签 CI，已按 ALLOW_UNKNOWN_CI=1 跳过"
else
  fail "没装 gh，无法核对标签提交的 CI 是否绿" \
    "装 gh 并登录（gh auth login）后重试；确要跳过：ALLOW_UNKNOWN_CI=1 bash scripts/publish.sh"
fi


# ④ 远端 main 不能有本地没有的提交（否则 Release 与用户拉到的 main 不一致）
if git remote get-url origin >/dev/null 2>&1; then
  git fetch -q origin main 2>/dev/null || true
  if git rev-parse -q --verify origin/main >/dev/null 2>&1; then
    git merge-base --is-ancestor origin/main HEAD || fail "远端 main 有本地没有的提交" "先 git pull --rebase origin main（解决冲突）再重试；没对齐就不要发版"
  fi
fi

git remote get-url origin >/dev/null 2>&1 || git remote add origin "$REMOTE" 2>/dev/null || true

# 硬规则：远端已有的同名 tag 不得移动。
# 第二轮审计 N1-1：v0.2.6 一晚被移过 5 次，同一个版本号对应了 6 个提交，按 tag 安装的用户
# 锁文件各不相同，却都叫 0.2.6。要重发请升版本号，不要 force-push 标签。
# 第三轮审计 R1-1：原来的 ALLOW_TAG_MOVE 逃生阀没有任何约束力（脚本的 push 不带 -f，开了阀也推不上去），
# 真正能拦住移动的是 GitHub 的 tag 规则集。这里改成 fail-closed：查不到远端就拒绝执行。
if ! remote_tags="$(git ls-remote --tags origin "refs/tags/$TAG" 2>/dev/null)"; then
  echo "✖ 无法查询远端标签 ${TAG}（网络或权限问题）—— 查不到就不敢发，避免覆盖已发布的版本。" >&2
  exit 1
fi
if [ -n "$remote_tags" ]; then
  # 两个发布脚本的分工：publish-npm.sh 先推 tag 再发 npm，publish.sh 随后建 Release。
  # 所以「远端已有同名 tag」本身不是错误 —— 只有它指向别的提交（想移动已发布的版本）才是。
  remote_sha="$(printf '%s\n' "$remote_tags" | awk '{print $1}' | head -1)"
  local_sha="$(git rev-parse "$TAG" 2>/dev/null || true)"
  if [ -n "$local_sha" ] && [ "$remote_sha" = "$local_sha" ]; then
    echo "✓ 远端标签 $TAG 已存在且指向本地同一提交（publish-npm.sh 推的），继续建 Release。"
  else
    echo "✖ 远端标签 $TAG 指向别的提交（$remote_sha ≠ ${local_sha}）—— 已发布的版本号不得复用。" >&2
    echo "  升版本号（package.json / README / CHANGELOG）后重新打标签再跑。" >&2
    exit 1
  fi
fi
echo "前置守卫通过（版本 ${PKG_VERSION}，标签在 HEAD 历史上，远端标签未被移动）"
if [ -n "${RELEASE_NOTES:-${1:-}}" ] && [ ! -s "${RELEASE_NOTES:-${1:-}}" ]; then
  fail "Release 说明文件不存在或为空：${RELEASE_NOTES:-${1:-}}" "推送前就检查，免得 tag 推上去了 Release 却建不出来"
fi
if [ "$DRY_RUN" = "1" ]; then echo "DRY_RUN=1：只做检查（含远端标签检查），不推送、不发 npm、不建 Release。"; exit 0; fi

if command -v gh >/dev/null 2>&1 && gh_ auth status >/dev/null 2>&1; then
  gh_ repo view "$GH_USER/$REPO" >/dev/null 2>&1 || \
    gh_ repo create "$GH_USER/$REPO" --"$VISIBILITY" --description "DSH agent presets tuned for token efficiency (lite 13 rules / balance 3 rules)"
  # main 开了分支保护（ruleset「protect main」：禁止删除 / 禁止非快进 / 四个必过检查，无绕过）：
  # 带新提交直推 main 会被 GitHub 拒绝。发版前确认这些提交已经通过 PR 合进 main，这里只做幂等推送。
  if git remote get-url origin >/dev/null 2>&1 && git rev-parse -q --verify origin/main >/dev/null 2>&1; then
    AHEAD="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
    if [ "${AHEAD:-0}" != "0" ]; then
      fail "本地有 $AHEAD 个提交不在 origin/main 上（main 受分支保护，直推会被拒）" \
        "改走 PR：git switch -c <branch> && git push -u origin <branch>，等四个必过检查绿了再合进 main，然后重跑本脚本"
    fi
  fi
  # 不再 `git push -u origin main`（推的是本地 main 分支而不是 HEAD：本地 main 落后时被当成非快进拒绝，
  # 脚本在推 tag / 建 Release 之前中止）。main 只经 PR 合入；这里只核对「tag 指向的提交已在远端 main 上」。
  git fetch -q origin main 2>/dev/null || fail "取不到远端 main（git fetch origin main 失败）" "检查网络 / 凭据后重试；核对不了就不发"
  git merge-base --is-ancestor "$(git rev-parse "$TAG^{commit}")" origin/main || \
    fail "标签 ${TAG}（$(git rev-parse --short "$TAG^{commit}")）指向的提交不在远端 main 上" \
      "先经 PR 合进 main，再在 main 的那个提交上打 tag；不要发孤儿提交"
  git push origin "$TAG"

  # ⑤ npm 必须先发（2026-11-12 审计 D2）：Release 早于 npm，会让正文里的安装命令指向一个装不到的版本。
  # 判定一律走 node scripts/verify-published.mjs（内部用 npm view）：直连 registry 会命中边缘缓存，别自写探测。
  if [ "${ALLOW_MISSING_NPM:-0}" != "1" ] && command -v node >/dev/null 2>&1; then
    if ! node scripts/verify-published.mjs --version "$PKG_VERSION" --timeout 8 --quiet >/dev/null 2>&1; then
      fail "npm 上查不到 ${PKG_VERSION}（Release 会给出装不到的版本）" \
        "先跑 bash scripts/publish-npm.sh（发布 + 复核），再回来建 Release" \
        "确实只发 git、不发 npm：ALLOW_MISSING_NPM=1 bash scripts/publish.sh"
    fi
    echo "npm 侧已确认 ${PKG_VERSION} 生效"
  fi
  mkdir -p dist
  # 打 tag 而不是 HEAD：HEAD 与 tag 不一致时附件就对不上（第三轮审计 R1-1 之⑤）。
  # 每次重打：复用 dist/ 里的旧附件会让 Release 内容与 tag 悄悄不一致（第六轮审计 U3-7）。
rm -f dist/dsh-flash-presets-*.zip   # dist/ 只放本次附件，免得旧包混进 Release
  git archive --format=zip -o "dist/dsh-flash-presets-$TAG.zip" "$TAG"
  # Release 正文：RELEASE_NOTES=<文件> 或第一个参数给出说明文件（建议写 pnpm 24 小时冷却、行为变化、已知遗留）；
  # 不给时退回固定一句。标题可用 RELEASE_TITLE 覆盖（默认就是 tag 名）。
  NOTES_FILE="${RELEASE_NOTES:-${1:-}}"
  TITLE="${RELEASE_TITLE:-$TAG}"
  if [ -n "$NOTES_FILE" ]; then
    [ -s "$NOTES_FILE" ] || fail "Release 说明文件不存在或为空：$NOTES_FILE" "RELEASE_NOTES=<非空的 markdown 文件> bash scripts/publish.sh"
    gh_ release create "$TAG" "dist/dsh-flash-presets-$TAG.zip" --title "$TITLE" --notes-file "$NOTES_FILE"
  else
    echo "⚠ 没给 RELEASE_NOTES，Release 正文只写「见 README 版本历史」；发版后可在网页上补"
    gh_ release create "$TAG" "dist/dsh-flash-presets-$TAG.zip" --title "$TITLE" --notes "见 README 版本历史"
  fi
  echo "完成：https://github.com/$GH_USER/$REPO"
else
  cat <<MSG
没有可用的 GitHub 凭据（未安装 gh 或未登录）。二选一：

A) 网页创建仓库后推送（无需装东西）
   1. 打开 https://github.com/new?name=$REPO （不要勾选 README/LICENSE）
   2. 然后在仓库目录执行：
        git push -u origin main
        git push origin $TAG
     用户名填 ${GH_USER}，密码填 Personal Access Token（Settings → Developer settings → Fine-grained tokens，需 Contents: Read and write）

B) 装上 GitHub CLI 后重跑本脚本（可自动建仓库 + 发布 Release）
       bash scripts/publish.sh
MSG
fi
