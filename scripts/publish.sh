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
TAG="${TAG:-$(git describe --tags --abbrev=0 2>/dev/null || echo v1.0.0)}"
REMOTE="${REMOTE:-https://github.com/$GH_USER/$REPO.git}"

echo "目标：$GH_USER/$REPO（$VISIBILITY），标签 $TAG"
git remote get-url origin >/dev/null 2>&1 || git remote add origin "$REMOTE"

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh repo view "$GH_USER/$REPO" >/dev/null 2>&1 || \
    gh repo create "$GH_USER/$REPO" --"$VISIBILITY" --description "DSH agent presets tuned for token efficiency (flash-lean / flash-lean-ptc)"
  git push -u origin main
  git push origin "$TAG"
  mkdir -p dist
  [ -f "dist/dsh-flash-presets-$TAG.zip" ] || git archive --format=zip -o "dist/dsh-flash-presets-$TAG.zip" HEAD
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
     用户名填 $GH_USER，密码填 Personal Access Token（Settings → Developer settings → Fine-grained tokens，需 Contents: Read and write）

B) 装上 GitHub CLI 后重跑本脚本（可自动建仓库 + 发布 Release）
       bash scripts/publish.sh
MSG
fi
