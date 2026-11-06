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

echo "目标：${GH_USER}/${REPO}（${VISIBILITY}），标签 ${TAG}"
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
