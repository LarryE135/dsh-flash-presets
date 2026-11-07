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
hash_file() { node -e "const c=require('crypto'),f=require('fs');process.stdout.write(c.createHash('md5').update(f.readFileSync(process.argv[1])).digest('hex'))" "$1"; }
EXPECT="${1:-$(sed -n 's/.*当前版本：\(v[0-9][0-9.]*\).*/\1/p' README.md | head -1)}"

step "版本口径"
[ -n "$EXPECT" ] && ok "README 当前版本 = $EXPECT" || bad "README 里没有「当前版本：vX.Y.Z」"
grep -q "### $EXPECT" README.md && ok "版本历史里有 $EXPECT 条目" || bad "版本历史缺少 $EXPECT"
grep -q "package.json" scripts/verify-presets.mjs && ok "校验器按 package.json 判定版本" || bad "校验器没读 package.json 版本"

step "仓库层校验"
# 干净机器（CI / 新用户）上没有 ~/.dsh，先在一个临时 home 里装一遍再校验；
# 否则 verify-presets 会报「未检测到安装」，把环境问题当成仓库问题。
PRE="$TMP/pre"; mkdir -p "$PRE/profiles/web"; printf '# selftest pre\n[]\n' > "$PRE/profiles/web/cordis.patch.yml"
DSH_HOME="$PRE" bash scripts/install.sh --profile web >"$TMP/pre.install.log" 2>&1 \
  && ok "预安装（临时 DSH_HOME）" || { bad "预安装失败"; tail -4 "$TMP/pre.install.log"; }
DSH_HOME="$PRE" node scripts/verify-presets.mjs >"$TMP/vp.log" 2>&1 && ok "verify-presets 通过" || { bad "verify-presets 失败"; tail -5 "$TMP/vp.log"; }
_vyrc=0; node scripts/verify-yaml.mjs >"$TMP/vy.log" 2>&1 || _vyrc=$?
case "$_vyrc" in
  0) ok "verify-yaml 通过" ;;
  2) ok "verify-yaml 跳过（未装 js-yaml，退出码 2）" ;;
  *) bad "verify-yaml 失败"; tail -5 "$TMP/vy.log" ;;
esac
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
  local h1; h1="$(hash_file "$home/profiles/web/cordis.patch.yml")"
  DSH_HOME="$home" bash scripts/install.sh --profile web >/dev/null 2>&1
  local h2; h2="$(hash_file "$home/profiles/web/cordis.patch.yml")"
  [ "$h1" = "$h2" ] && ok "${name}：重复安装幂等" || bad "${name}：重复安装不幂等"
  DSH_HOME="$home" node scripts/verify-presets.mjs >"$TMP/$1.verify.log" 2>&1 \
    && ok "${name}：安装后校验通过" || { bad "${name}：安装后校验失败"; tail -4 "$TMP/$1.verify.log"; }
  DSH_HOME="$home" bash scripts/install.sh --uninstall --profile web >/dev/null 2>&1
  cmp -s "$TMP/$1.orig" "$home/profiles/web/cordis.patch.yml" && ok "${name}：卸载后逐字节还原" || bad "${name}：卸载后与原始不一致"
}

# --with-runtime → --uninstall 往返（第三轮审计 R1-2）：撤块时不能把末行 `[]` 一起带走，
# 否则标准 profile 卸载后只剩注释，DSH 报 must be a top-level YAML array，整个 profile 起不来。
runtime_roundtrip() { # $1=名字 $2=初始内容
  local name="$1" home="$TMP/rt-$1"
  mkdir -p "$home/profiles/web"; printf '%b' "$2" > "$home/profiles/web/cordis.patch.yml"
  DSH_HOME="$home" bash scripts/install.sh --profile web --with-runtime >"$TMP/rt-$1.install.log" 2>&1 \
    || { bad "${name}：--with-runtime 安装退出码非 0"; return; }
  grep -q 'persistent-in-memory' "$home/profiles/web/cordis.patch.yml" \
    && ok "${name}：--with-runtime 写入了常驻运行时" || bad "${name}：--with-runtime 没写入"
  DSH_HOME="$home" bash scripts/install.sh --profile web --uninstall >"$TMP/rt-$1.uninstall.log" 2>&1 \
    || { bad "${name}：卸载退出码非 0"; return; }
  grep -q 'tune-runtime' "$home/profiles/web/cordis.patch.yml" \
    && bad "${name}：卸载后仍残留 tune-runtime 块" || ok "${name}：卸载撤掉了运行时覆盖"
  node -e '
    const fs = require("fs");
    const t = fs.readFileSync(process.argv[1], "utf8");
    const body = t.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).join("\n").trim();
    if (!(body === "[]" || /^-\s/m.test(body))) { console.error("不是顶层数组：" + JSON.stringify(body)); process.exit(1); }
  ' "$home/profiles/web/cordis.patch.yml" >/dev/null 2>&1 \
    && ok "${name}：卸载后仍是合法顶层数组" || bad "${name}：卸载后不是合法数组（profile 会起不来）"
  if command -v dsh >/dev/null 2>&1; then
    DSH_HOME="$home" dsh --profile web --dump-config >/dev/null 2>&1 \
      && ok "${name}：卸载后 --dump-config 正常" || bad "${name}：卸载后 --dump-config 失败"
  fi
}

step "--with-runtime 往返（标准补丁 / 空数组 / 只有注释）"
runtime_roundtrip standard '# 注释头\n[]\n'
runtime_roundtrip emptyarr '[]\n'
runtime_roundtrip comments '# 只有注释\n'

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

step "边界：CRLF 配置 / 托管块残缺 / 流式空数组"
CRLF="$TMP/crlf"; mkdir -p "$CRLF/profiles/web"
printf -- "- id: keep\r\n  name: '@keep/me'\r\n" > "$CRLF/profiles/web/cordis.patch.yml"
cp "$CRLF/profiles/web/cordis.patch.yml" "$TMP/crlf.orig"
DSH_HOME="$CRLF" bash scripts/install.sh --profile web >/dev/null 2>&1
DSH_HOME="$CRLF" bash scripts/install.sh --profile web --uninstall >/dev/null 2>&1
cmp -s "$TMP/crlf.orig" "$CRLF/profiles/web/cordis.patch.yml" \
  && ok "CRLF 配置：卸载后逐字节还原" || bad "CRLF 配置：卸载后与原始不一致"

BROKEN="$TMP/broken"; mkdir -p "$BROKEN/profiles/web"
printf -- "- id: keep\r\n# >>> dsh-flash-presets: managed block (0.1.7+ plugin-row presets) >>>\r\n- insert:\r\n    - id: preset-x\r\n" > "$BROKEN/profiles/web/cordis.patch.yml"
cp "$BROKEN/profiles/web/cordis.patch.yml" "$TMP/broken.orig"
if DSH_HOME="$BROKEN" bash scripts/install.sh --profile web --uninstall >"$TMP/broken.log" 2>&1; then
  bad "托管块缺结束标记时仍然执行（应拒绝）"
else
  cmp -s "$TMP/broken.orig" "$BROKEN/profiles/web/cordis.patch.yml" \
    && ok "托管块缺结束标记：拒绝改动且文件未变" || bad "托管块缺结束标记：文件被改写"
fi

FLOW="$TMP/flow"; mkdir -p "$FLOW/profiles/web"
printf '[ ]\n' > "$FLOW/profiles/web/cordis.patch.yml"
DSH_HOME="$FLOW" bash scripts/install.sh --profile web >/dev/null 2>&1 \
  && grep -q 'preset-flash-lean-ptc-v3' "$FLOW/profiles/web/cordis.patch.yml" \
  && ok "流式空数组 [ ]：安装成功" || bad "流式空数组 [ ]：安装失败"

step "旧版入口（< 0.1.7 目录式，0.2.6 起不再提供）"
LEG="$TMP/legacy"; mkdir -p "$LEG/.agent-presets"
DSH_HOME="$LEG" bash scripts/install.sh --legacy >"$TMP/legacy.log" 2>&1
lrc=$?
[ "$lrc" -eq 3 ] && ok "legacy 明确报错（exit 3）" || { bad "legacy 退出码应为 3，实际 ${lrc}"; tail -4 "$TMP/legacy.log"; }
[ ! -d "$LEG/.agent-presets/flash-lean-ptc-v1" ] && ok "legacy 不再写目录" || bad "legacy 不应写入"

step "安装器容错（js-yaml 缺失不得中止）"
SHIM="$TMP/shim"; mkdir -p "$SHIM"
REAL_NODE="$(command -v node)"
cat > "$SHIM/node" <<'SHIMEOF'
#!/usr/bin/env bash
case "$*" in
  *verify-yaml*) exit 2 ;;
esac
exec "$REAL_NODE" "$@"
SHIMEOF
chmod +x "$SHIM/node"
NS="$TMP/ns"; mkdir -p "$NS/profiles/web"; printf '# ns\n[]\n' > "$NS/profiles/web/cordis.patch.yml"
if PATH="$SHIM:$PATH" REAL_NODE="$REAL_NODE" DSH_HOME="$NS" bash scripts/install.sh --profile web >"$TMP/ns.log" 2>&1; then
  ok "verify-yaml 退出 2 时安装器不中止（set -e 下）"
else
  bad "verify-yaml 退出 2 时安装器中止了"; tail -4 "$TMP/ns.log"
fi
grep -q '校验已跳过' "$TMP/ns.log" && ok "安装器如实提示「跳过」" || bad "安装器未提示跳过"
grep -c 'dsh-flash-presets: managed block' "$NS/profiles/web/cordis.patch.yml" | grep -qx 2 \
  && ok "跳过校验后托管块仍完整写入" || bad "跳过校验后托管块不完整"

step "安装器失败即失败（P1-1）"
SHIM2="$TMP/shim1"; mkdir -p "$SHIM2"
cat > "$SHIM2/node" <<'SHIM2EOF'
#!/usr/bin/env bash
case "$*" in
  *verify-yaml*) exit 1 ;;
esac
exec "$REAL_NODE" "$@"
SHIM2EOF
chmod +x "$SHIM2/node"
NF="$TMP/nf"; mkdir -p "$NF/profiles/web"; printf '# original\n[]\n' > "$NF/profiles/web/cordis.patch.yml"
BEFORE="$(hash_file "$NF/profiles/web/cordis.patch.yml")"
if PATH="$SHIM2:$PATH" REAL_NODE="$REAL_NODE" DSH_HOME="$NF" bash scripts/install.sh --profile web >"$TMP/nf.log" 2>&1; then
  bad "verify-yaml 返回 1 时安装器竟然报成功"
else
  ok "verify-yaml 返回 1 时安装器失败退出"
fi
AFTER="$(hash_file "$NF/profiles/web/cordis.patch.yml")"
[ "$BEFORE" = "$AFTER" ] && ok "失败时 profile 已回滚到安装前" || bad "失败后 profile 未回滚（内容被改动）"

step "升级路径：旧 -lite 会话 / 使用者自加行"
# (a) 插件卡安装的 profile 补丁里只有使用者自加的行 —— verify-yaml 不能判失败
#     （以前这里要求「路径里带 profiles 就必须含 v3」，于是 bundle 装法与任何自加行都被判失败）
UP1="$TMP/up1"; mkdir -p "$UP1/profiles/web"
printf -- "- insert:\n    - id: preset-flash-lean-ptc-v3b\n      name: '@deepseek-ai/dsh-agent-preset'\n      config:\n        id: flash-lean-ptc-v3b\n" > "$UP1/profiles/web/cordis.patch.yml"
if node scripts/verify-yaml.mjs "$UP1/profiles/web/cordis.patch.yml" >"$TMP/up1.log" 2>&1; then
  ok "只有自加行的 profile 补丁通过 verify-yaml"
else
  bad "只有自加行的 profile 补丁被 verify-yaml 判失败"; tail -4 "$TMP/up1.log"
fi

# (b) 旧托管块 / 旧裸行里有 -lite → 脚本安装要多写一行兼容行，且校验通过（T0-1）
UP2="$TMP/up2"; mkdir -p "$UP2/profiles/web"
printf -- "- insert:\n    - id: preset-flash-lean-ptc-v3-lite\n      name: '@deepseek-ai/dsh-agent-preset'\n      config:\n        id: flash-lean-ptc-v3-lite\n" > "$UP2/profiles/web/cordis.patch.yml"
DSH_HOME="$UP2" bash scripts/install.sh --profile web >"$TMP/up2.log" 2>&1
ROWS2="$(grep -c 'id: preset-' "$UP2/profiles/web/cordis.patch.yml" 2>/dev/null || echo 0)"
[ "$ROWS2" = "3" ] && ok "旧 -lite 补丁升级后写入 3 行（含兼容行）" || bad "旧 -lite 补丁升级后是 $ROWS2 行（期望 3）"
grep -q "id: flash-lean-ptc-v3-lite" "$UP2/profiles/web/cordis.patch.yml" \
  && ok "兼容行 id 就是 flash-lean-ptc-v3-lite（旧会话才解析得到）" || bad "兼容行 id 不对"
grep -q "order: 99" "$UP2/profiles/web/cordis.patch.yml" \
  && ok "兼容行 order=99（排在两张卡后面，不影响默认选择）" || bad "兼容行 order 不是 99"
node scripts/verify-yaml.mjs "$UP2/profiles/web/cordis.patch.yml" >"$TMP/up2v.log" 2>&1 \
  && ok "升级后补丁通过 verify-yaml（兼容行不被当成外来行）" || bad "升级后补丁未通过 verify-yaml"

# (c) 全新安装不该多出兼容行
UP3="$TMP/up3"; mkdir -p "$UP3/profiles/web"; printf '[]\n' > "$UP3/profiles/web/cordis.patch.yml"
DSH_HOME="$UP3" bash scripts/install.sh --profile web >/dev/null 2>&1
ROWS3="$(grep -c 'id: preset-' "$UP3/profiles/web/cordis.patch.yml" 2>/dev/null || echo 0)"
[ "$ROWS3" = "2" ] && ok "全新安装只有 2 行（不带兼容行）" || bad "全新安装写出了 $ROWS3 行（期望 2）"

# (d) 该 profile 已用插件卡装了本包时，脚本必须拒绝叠加（exit 4），--force 才放行
UP4="$TMP/up4"; mkdir -p "$UP4/profiles/web"; printf '[]\n' > "$UP4/profiles/web/cordis.patch.yml"
printf '{"dsh":{"profile":{"bundles":["dsh-flash-presets"]}}}\n' > "$UP4/profiles/web/package.json"
if DSH_HOME="$UP4" bash scripts/install.sh --profile web >"$TMP/up4.log" 2>&1; then
  bad "插件卡已装时脚本仍然安装了（应 exit 4）"
else
  rc=$?; [ "$rc" = "4" ] && ok "插件卡已装时脚本拒绝叠加（exit 4）" || bad "拒绝叠加的退出码是 ${rc}（期望 4）"
fi
DSH_HOME="$UP4" bash scripts/install.sh --profile web --force >/dev/null 2>&1 \
  && ok "--force 可以显式叠加" || bad "--force 也没能叠加"
# (e) 使用者照 README 自己加回的 v1 行不能被安装器吞掉（第六轮 U1-2）
UP5="$TMP/up5"; mkdir -p "$UP5/profiles/web"
printf -- "- insert:\n    - id: preset-flash-lean-ptc-v1\n      name: '@deepseek-ai/dsh-agent-preset'\n      config:\n        id: flash-lean-ptc-v1\n        name: my-v1\n        order: 22\n" > "$UP5/profiles/web/cordis.patch.yml"
DSH_HOME="$UP5" bash scripts/install.sh --profile web >"$TMP/up5.log" 2>&1
grep -q "id: flash-lean-ptc-v1" "$UP5/profiles/web/cordis.patch.yml" \
  && ok "使用者自加的 v1 行被保留（U1-2）" \
  || bad "使用者自加的 v1 行被安装器删掉了（U1-2 回归）"
grep -q "id: preset-flash-lean-ptc-v3$" "$UP5/profiles/web/cordis.patch.yml" \
  && ok "保留 v1 行的同时照常装上 v3 卡" || bad "保留 v1 行时没装上 v3 卡"

step "发布路径守卫"
if TAG=v9.9.9-test bash scripts/publish.sh >"$TMP/pub.log" 2>&1; then
  bad "publish.sh 对不存在的 tag 竟然放行"; tail -3 "$TMP/pub.log"
else
  ok "publish.sh 对不存在的 tag 拒绝发布（exit != 0）"
fi
grep -q 'sed -n' scripts/publish.sh && ok "publish.sh 从 README 解析版本" || bad "publish.sh 未从 README 解析版本"

printf '\n自测结果：%d 项通过，%d 项失败（版本口径 %s）\n' "$PASS" "$FAIL" "$EXPECT"
[ "$FAIL" -eq 0 ] || exit 1
