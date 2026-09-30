#!/usr/bin/env bash
# 仓库自带端到端自测：不依赖 ~/.dsh，不联网，不改动仓库（只在临时目录里折腾）。
# 用法：bash scripts/selftest.sh [期望版本，默认从 README 解析]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
step() { printf '\n[%s]\n' "$1"; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
EXPECT="${1:-$(sed -n 's/.*当前版本：\(v[0-9][0-9.]*\).*/\1/p' README.md | head -1)}"

step "版本口径"
[ -n "$EXPECT" ] && ok "README 当前版本 = $EXPECT" || bad "README 里没有「当前版本：vX.Y.Z」"
grep -q "### $EXPECT" README.md && ok "版本历史里有 $EXPECT 条目" || bad "版本历史缺少 $EXPECT"
grep -q "$EXPECT" scripts/verify-presets.mjs && ok "校验器断言 $EXPECT" || bad "校验器未断言 $EXPECT"

step "仓库层校验"
node scripts/verify-presets.mjs >"$TMP/vp.log" 2>&1 && ok "verify-presets 通过" || { bad "verify-presets 失败"; tail -5 "$TMP/vp.log"; }
node scripts/verify-yaml.mjs   >"$TMP/vy.log" 2>&1 && ok "verify-yaml 通过"   || { bad "verify-yaml 失败";   tail -5 "$TMP/vy.log"; }
node scripts/check-ps1.mjs     >"$TMP/cp.log" 2>&1 && ok "check-ps1 通过"     || { bad "check-ps1 失败";     tail -5 "$TMP/cp.log"; }
node scripts/check-bash32-cjk.mjs >"$TMP/cb.log" 2>&1 && ok "bash 3.2 多字节守卫通过" || { bad "bash 3.2 多字节守卫失败"; tail -5 "$TMP/cb.log"; }

# 三种 profile 形态：文件不存在 / 注释+空数组 / 注释+其他条目
shape() { # $1=名字 $2=文件内容（空串=不建文件）
  local name="$1" content="$2" home="$TMP/$1"
  mkdir -p "$home/profiles/web"
  [ -n "$content" ] && printf '%b' "$content" > "$home/profiles/web/cordis.patch.yml"
  [ -n "$content" ] && cp "$home/profiles/web/cordis.patch.yml" "$TMP/$1.orig" || : > "$TMP/$1.orig.absent"
}
roundtrip() { # $1=名字
  local name="$1" home="$TMP/$1"
  DSH_HOME="$home" bash scripts/install.sh --profile web >"$TMP/$1.install.log" 2>&1 \
    || { bad "${name}：安装退出码非 0"; return; }
  local h1; h1="$(md5sum "$home/profiles/web/cordis.patch.yml" | cut -d' ' -f1)"
  DSH_HOME="$home" bash scripts/install.sh --profile web >/dev/null 2>&1
  local h2; h2="$(md5sum "$home/profiles/web/cordis.patch.yml" | cut -d' ' -f1)"
  [ "$h1" = "$h2" ] && ok "${name}：重复安装幂等" || bad "${name}：重复安装不幂等"
  DSH_HOME="$home" node scripts/verify-presets.mjs >"$TMP/$1.verify.log" 2>&1 \
    && ok "${name}：安装后校验通过" || { bad "${name}：安装后校验失败"; tail -4 "$TMP/$1.verify.log"; }
  DSH_HOME="$home" bash scripts/install.sh --uninstall --profile web >/dev/null 2>&1
  cmp -s "$TMP/$1.orig" "$home/profiles/web/cordis.patch.yml" && ok "${name}：卸载后逐字节还原" || bad "${name}：卸载后与原始不一致"
}

step "缺 profile 补丁层时的行为（按设计应当明确报错）"
mkdir -p "$TMP/absent/profiles/web"
if DSH_HOME="$TMP/absent" bash scripts/install.sh --profile web >"$TMP/absent.log" 2>&1; then
  bad "无 patch 层时竟然安装成功（应报错）"
else
  grep -q '找不到' "$TMP/absent.log" && ok "无 patch 层：报错并给出指引" || bad "无 patch 层：报错信息不清晰"
fi

step "现代安装（0.1.7+ 插件行）两种 profile 形态"
shape empty "# ci profile patch\n[]\n"
shape multi "# ci profile patch\n- insert:\n    - id: keep-me\n      name: '@keep/me'\n"
for s in empty multi; do roundtrip "$s"; done

step "旧版安装（< 0.1.7 目录式）"
LEG="$TMP/legacy"; mkdir -p "$LEG/.agent-presets"
DSH_HOME="$LEG" bash scripts/install.sh --legacy >"$TMP/legacy.log" 2>&1 \
  && ok "legacy 安装退出码 0" || { bad "legacy 安装失败"; tail -4 "$TMP/legacy.log"; }
[ -f "$LEG/.agent-presets/flash-lean-ptc-v1/agent.cordis.yml" ] && ok "legacy 安装出 v1" || bad "legacy 缺 v1"
[ ! -d "$LEG/.agent-presets/flash-lean-ptc-v2" ] && ok "legacy 跳过 v2（不作失败）" || bad "legacy 不应装 v2"
DSH_HOME="$LEG" node scripts/verify-presets.mjs >"$TMP/legacy.verify.log" 2>&1 \
  && ok "legacy 场景校验通过（CI 同款断言）" || { bad "legacy 场景校验失败"; tail -4 "$TMP/legacy.verify.log"; }

step "发布路径守卫"
if TAG=v9.9.9-test bash scripts/publish.sh >"$TMP/pub.log" 2>&1; then
  bad "publish.sh 对不存在的 tag 竟然放行"; tail -3 "$TMP/pub.log"
else
  ok "publish.sh 对不存在的 tag 拒绝发布（exit != 0）"
fi
grep -q 'sed -n' scripts/publish.sh && ok "publish.sh 从 README 解析版本" || bad "publish.sh 未从 README 解析版本"

printf '\n自测结果：%d 项通过，%d 项失败（版本口径 %s）\n' "$PASS" "$FAIL" "$EXPECT"
[ "$FAIL" -eq 0 ] || exit 1