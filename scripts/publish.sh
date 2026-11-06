#!/usr/bin/env bash
# 把本仓库推到 GitHub（main + tag + release）。
#   最简单：先 `gh auth login`，再执行  bash scripts/publish.sh
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

# ③ 标签必须指在当前分支上（否则推上去的是孤儿提交）
git merge-base --is-ancestor "$TAG" HEAD || fail "标签 $TAG 不在当前分支（$(git rev-parse --abbrev-ref HEAD)）的历史上" "重新打标签：git tag -d $TAG && git tag $TAG HEAD"

# ④ 远端 main 不能有本地没有的提交（否则 Release 与用户拉到的 main 不一致）
if git remote get-url origin >/dev/null 2>&1; then
  git fetch -q origin main 2>/dev/null || true
  if git rev-parse -q --verify origin/main >/dev/null 2>&1; then
    git merge-base --is-ancestor origin/main HEAD || fail "远端 main 有本地没有的提交" "先 git pull --rebase origin main（解决冲突）再重试；没对齐就不要发版"
  fi
fi
echo "前置守卫通过（版本 ${PKG_VERSION}，标签在 HEAD 历史上）"
if [ "$DRY_RUN" = "1" ]; then echo "DRY_RUN=1：只做检查，不推送。"; exit 0; fi
git remote get-url origin >/dev/null 2>&1 || git remote add origin "$REMOTE"

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
  echo "✖ 远端已存在标签 $TAG —— 版本号一经发布不得复用。" >&2
  echo "  升版本号（package.json / README / CHANGELOG）后重新打标签再跑本脚本。" >&2
  echo "  真的需要同号补一处修正：在 GitHub 上临时放宽 tag 规则集 → 手工 git tag -f + git push -f →" >&2
  echo "  在 CHANGELOG 与 Release 里如实记录移动路径 → 立刻恢复规则集。本脚本不提供这个入口。" >&2
  exit 1
fi

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh repo view "$GH_USER/$REPO" >/dev/null 2>&1 || \
    gh repo create "$GH_USER/$REPO" --"$VISIBILITY" --description "DSH agent presets tuned for token efficiency (lite 13 rules / balance 3 rules)"
  git push -u origin main
  git push origin "$TAG"
  mkdir -p dist
  # 打 tag 而不是 HEAD：HEAD 与 tag 不一致时附件就对不上（第三轮审计 R1-1 之⑤）。
  [ -f "dist/dsh-flash-presets-$TAG.zip" ] || git archive --format=zip -o "dist/dsh-flash-presets-$TAG.zip" "$TAG"
  gh release create "$TAG" "dist/dsh-flash-presets-$TAG.zip" --title "$TAG" --notes "见 README 版本历史"
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
