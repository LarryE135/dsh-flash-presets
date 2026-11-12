#!/usr/bin/env bash
# 发布 npm，并在发布后复核 registry 是否真的生效。
# 为什么单独成脚本：npm 报成功不等于上线（2026-11-12 实测 0.3.1 就卡在这里），
# 而 scripts/publish.sh 只管 git（main + tag + Release），两条路必须串起来走。
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

TAG="$(sed -n 's/.*当前版本：\(v[0-9][0-9.]*\).*/\1/p' README.md | head -1)"
[ -n "$TAG" ] || { echo "✖ README 里没有「当前版本：vX.Y.Z」" >&2; exit 1; }
VER="${TAG#v}"
PKG_VER="$(node -p 'require("./package.json").version')"

fail() { echo "✖ $1" >&2; shift; for l in "$@"; do echo "  $l" >&2; done; exit 1; }

[ -z "$(git status --porcelain)" ] || fail "工作区有未提交的改动" "发布物必须与仓库一致：先 commit 或 stash"
[ "$PKG_VER" = "$VER" ] || fail "package.json 版本（\${PKG_VER}）与 README 版本（\${VER}）不一致" "改完再发"
[ "$(git rev-parse HEAD)" = "$(git rev-parse "$TAG^{commit}")" ] || fail "标签 $TAG 不在 HEAD 上" \
  "publish.sh 有同样的守卫：tag 必须正好指在当前提交；不要移动已发布的 tag，宁可升版本号"
if command -v gh >/dev/null 2>&1 && git remote get-url origin >/dev/null 2>&1; then
  if ! git ls-remote --tags origin "refs/tags/$TAG" 2>/dev/null | grep -q .; then
    fail "远端没有标签 $TAG" "npm 的 gitHead 会指向一个别人拉不到的提交：先 git push origin $TAG"
  fi
fi

# README 口径守卫（第二轮审计 P1-1）：npm 包页面直接显示 README，里面的「当前版本」行与安装命令
# 必须就是本次要发的版本；0.3.1 就在这里吃过亏 —— 包里的 README 还在叫用户装 0.3.0，且已发出、改不了。
README_VER="$(sed -n 's/.*当前版本：v\([0-9][0-9.]*\).*/\1/p' README.md | head -1)"
[ "$README_VER" = "$VER" ] || fail "README 的「当前版本」是 ${README_VER}，与要发的 ${VER} 不一致" "先改 README 顶部再发"
grep -q "dsh-flash-presets${VER}" README.md || fail "README 里没有 dsh-flash-presets${VER} 的安装命令" "npm 页面照抄会装到别的版本"
STALE="$(grep -oE 'dsh-flash-presets@[0-9]+\.[0-9]+\.[0-9]+' README.md | sort -u | grep -v "@${VER}" || true)"
[ -z "$STALE" ] || fail "README 里还留着旧版本安装命令：${STALE}" "只允许出现 @${VER}"

# CI 守卫（第二轮审计 P2-1）：0.3.1 的 npm 发布早于 CI 结果，最后是绿的属于侥幸。
if command -v gh >/dev/null 2>&1; then
  RUNS="$(gh run list --commit "$(git rev-parse HEAD)" --limit 30 --json conclusion 2>/dev/null || true)"
  if [ -n "$RUNS" ]; then
    if printf '%s' "$RUNS" | grep -qE '"conclusion":"(failure|cancelled)"'; then
      fail "本次提交的 CI 有失败/取消的 run" "等 CI 全绿再发"
    fi
    echo "CI 侧未见失败 run"
  fi
fi

echo "发布 $PKG_VER 到 npm…"
npm publish
echo "复核 registry…"
node scripts/verify-published.mjs --version "$VER"
echo
echo "完成。下一步（顺序要紧，npm 已在才发 Release）："
echo "  bash scripts/publish.sh     # 推 main + tag + 建 GitHub Release"
