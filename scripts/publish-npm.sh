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
PUB_VER="$(node -p 'require("./package.json").publishedVersion || ""')"
[ "$PKG_VER" = "$VER" ] || fail "package.json 版本（${PKG_VER}）与 README 版本（${VER}）不一致" "改完再发"
# 只改 version 不够：verify-versions 允许引用属于 {version, publishedVersion}，publishedVersion 落后时
# 一串旧版本引用会被放行 —— 0.3.1 的包就是这样教用户装 0.3.0 的（第二轮审计 P1-1）。
[ "$PUB_VER" = "$VER" ] || fail "package.json.publishedVersion（${PUB_VER}）≠ 要发的 $VER" "发版提交里必须同时改它"
# 分支保护后 main 只能 squash 合并：在本地分支头打的 tag 不在 main 上，
# npm 的 gitHead 会指向一个别人拉不到的提交（0.3.1 的 5d02bee 就是这么来的）。
git fetch -q origin main >/dev/null 2>&1 || true
git merge-base --is-ancestor "$TAG^{commit}" origin/main 2>/dev/null || fail "标签 ${TAG} 指向的提交不在 origin/main 上" \
  "PR squash 合并后本地 SHA ≠ main 上的提交：先 git switch main && git reset --hard origin/main，再在 main 头打 tag"
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
grep -qF "dsh-flash-presets@${VER}" README.md || fail "README 里没有 dsh-flash-presets${VER} 的安装命令" "npm 页面照抄会装到别的版本"
STALE="$(grep -oE 'dsh-flash-presets@[0-9]+\.[0-9]+\.[0-9]+' README.md | sort -u | grep -v "@${VER}" || true)"
[ -z "$STALE" ] || fail "README 里还留着旧版本安装命令：${STALE}" "只允许出现 @${VER}"

# 安装器与市场清单同理（第二轮审计 P1-1）：命令里的包号/tag 必须就是本次版本，
# 否则用户照抄 install.sh 的输出会装回上一个版本。
BADCMD="$(grep -hoE 'dsh-flash-presets[@#](v)?[0-9]+[.][0-9]+[.][0-9]+' scripts/install.sh scripts/install.ps1 marketplace/plugin.json | sort -u | grep -vE "^dsh-flash-presets[@#](v)?$VER$" || true)"
[ -z "$BADCMD" ] || fail "安装器/市场清单里还留着旧版本引用：$BADCMD" "只允许 @$VER 与 #v$VER"

# CI 守卫（第二轮审计 P2-1；第四轮审计 P1 补齐）：0.3.1 的 npm 发布早于 CI 结果，
# 最后是绿的属于侥幸。以前这段只在「装了 gh」时才检查，没装就整段跳过、且不打印任何提示 ——
# 与 publish.sh 的 fail-closed 语义相反，等于唯一的守卫在自己没装的机器上根本不存在。
if command -v gh >/dev/null 2>&1; then
  RUNS="$(gh run list --commit "$(git rev-parse HEAD)" --limit 30 --json conclusion 2>/dev/null || true)"
  if [ -n "$RUNS" ]; then
    if printf '%s' "$RUNS" | grep -qE '"conclusion":"(failure|cancelled)"'; then
      fail "本次提交的 CI 有失败/取消的 run" "等 CI 全绿再发"
    fi
    echo "CI 侧未见失败 run"
  else
    [ "${ALLOW_UNKNOWN_CI:-0}" = "1" ] || fail "gh 拿不到本次提交的 run 列表" "先在 Actions 里确认，或 ALLOW_UNKNOWN_CI=1 自担风险跳过"
    echo "⚠ gh 没有返回 run 列表：已按 ALLOW_UNKNOWN_CI=1 跳过"
  fi
elif [ "${ALLOW_UNKNOWN_CI:-0}" = "1" ]; then
  echo "⚠ 没装 gh：已按 ALLOW_UNKNOWN_CI=1 跳过 CI 核对（发出去之前请自己在 Actions 里确认）"
else
  fail "没装 gh，无法核对本次提交的 CI 是否全绿" "装 gh（gh auth login）后重跑；或 ALLOW_UNKNOWN_CI=1 自担风险跳过（与 publish.sh 同一口径）"
fi

echo "发布 $PKG_VER 到 npm…"
npm publish
echo "复核 registry…"
node scripts/verify-published.mjs --version "$VER"
echo
echo "完成。下一步（顺序要紧，npm 已在才发 Release）："
echo "  bash scripts/publish.sh     # 推 main + tag + 建 GitHub Release"
