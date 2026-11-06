#!/usr/bin/env bash
# 整体组合自测：预设 + 计划模式插件装进一个临时 DSH_HOME，再断言两者都到位。
# 有 dsh 命令时走真实安装（CI 的 bundle-install job）；没有时断言降级提示正确。
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/profiles/web"
printf "# canary\n[]\n" > "$TMP/profiles/web/cordis.patch.yml"

pass=0; fail=0
ok() { printf "  ok   %s\n" "$1"; pass=$((pass+1)); }
bad() { printf "  FAIL %s\n" "$1"; fail=$((fail+1)); }

out=$(DSH_HOME="$TMP" bash "$HERE/scripts/install.sh" --profile web --with-plan-mode 2>&1)
rc=$?
[ "$rc" -eq 0 ] && ok "install.sh --with-plan-mode 退出码 0" || bad "install.sh --with-plan-mode 退出码 $rc"

patch="$TMP/profiles/web/cordis.patch.yml"
blocks=$(grep -c "dsh-flash-presets: managed block (0.1.7" "$patch" || true)
[ "$blocks" -eq 1 ] && ok "托管块恰好 1 个" || bad "托管块数量 = ${blocks}（期望 1）"
grep -q "id: preset-flash-lean-ptc-v3" "$patch" && ok "v3 预设行已写入" || bad "v3 预设行缺失"

# 0.2.6 起安装器如实说明：计划模式组件只有 dsh plugin add 才装，本脚本只写预设行。
grep -q "计划模式" <<<"$out" && grep -q "dsh plugin add dsh-flash-presets" <<<"$out" && ok "安装器说明计划模式组件只在 dsh plugin add 时装" || bad "安装器未说明计划模式组件的安装方式"

if command -v dsh >/dev/null 2>&1; then
  ok "(dsh 可用：跳过本地路径断言)"
else
  grep -q "装成插件卡" <<<"$out" && ok "无 dsh 时给出插件卡安装方式" || bad "无 dsh 时未给出插件卡安装方式"
fi

dout=$(DSH_HOME="$TMP" node "$HERE/scripts/doctor.mjs" --profile web --all 2>&1)
drc=$?
[ "$drc" -eq 0 ] && ok "doctor --all 退出码 0" || bad "doctor --all 退出码 $drc"
# 断言按小节标题匹配，不绑定 [n] 编号 —— doctor 加一节（如 [7] 旧会话的预设 id）不该让 CI 变红。
grep -q "计划模式组件" <<<"$dout" && ok "doctor 有计划模式一节" || bad "doctor 缺计划模式一节"
grep -q "dsh --dump-config 是否认得这些预设" <<<"$dout" && ok "doctor --all 触发合成配置检查" || bad "doctor --all 未触发合成配置检查"
if command -v dsh >/dev/null 2>&1; then
  grep -q "preset-flash-lean-ptc-v3 出现在合成配置里" <<<"$dout" && ok "合成配置认得 v3" || bad "合成配置不认 v3"
fi
if command -v dsh >/dev/null 2>&1; then
  cons=$(sed -n "/结论：/p" <<<"$dout")
  grep -q "干净的" <<<"$cons" && ok "doctor 结论为干净" || bad "doctor 结论异常：$cons"
else
  # 没有 dsh 时 doctor 必然报「dsh 不在 PATH / dump 失败」，这里只要求它没把插件算成失败
  grep -q "本包未安装" <<<"$dout" && ok "无 dsh 时只报本包未安装" || bad "无 dsh 时提示不对"
fi

echo "通过 ${pass}，失败 ${fail}"
[ "$fail" -eq 0 ] || exit 1