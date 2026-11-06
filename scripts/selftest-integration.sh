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

# 0.2.7 起安装器说的话必须三件事都成立（第二轮审计 N1-3）：
#   ① 写明「未安装」的到底是哪几项；② 给出按 tag 安装的插件卡命令（不是会装到坏 0.2.5 的裸包名）；
#   ③ 不再出现「运行时调优已就位」这类与 ① 自相矛盾的断言。
grep -q "未安装：计划模式组件" <<<"$out" && ok "安装器列出未安装的三项" || bad "安装器没有如实说明未安装的组件"
grep -q "add github:LarryE135/dsh-flash-presets#v" <<<"$out" && ok "安装器给出的插件卡命令锁了 tag" || bad "安装器推荐的插件卡命令没有锁 tag（可能装到 npm 上的旧版）"
if grep -q "未安装：计划模式组件" <<<"$out" && grep -q "运行时调优已就位" <<<"$out"; then
  bad "安装器自相矛盾：同时说「未安装」和「运行时调优已就位」"
else
  ok "安装器没有自相矛盾的完成提示"
fi
grep -q "二选一" <<<"$out" && ok "安装器提示两条安装路径二选一（含切换前卸载）" || bad "安装器没有说明两条路径的取舍"

if command -v dsh >/dev/null 2>&1; then
  ok "(dsh 可用：跳过本地路径断言)"
else
  grep -q "dsh plugin --profile web add github:LarryE135/dsh-flash-presets#v" <<<"$out" && ok "无 dsh 时仍给出插件卡安装方式" || bad "无 dsh 时未给出插件卡安装方式"
fi

dout=$(DSH_HOME="$TMP" node "$HERE/scripts/doctor.mjs" --profile web --all 2>&1)
drc=$?
[ "$drc" -eq 0 ] && ok "doctor --all 退出码 0" || bad "doctor --all 退出码 $drc"
# 断言按小节标题匹配，不绑定 [n] 编号 —— doctor 加一节（如 [7] 旧会话的预设 id）不该让 CI 变红。
grep -q "计划模式组件" <<<"$dout" && ok "doctor 有计划模式一节" || bad "doctor 缺计划模式一节"
grep -q "dsh --dump-config 是否认得这些预设" <<<"$dout" && ok "doctor --all 触发合成配置检查" || bad "doctor --all 未触发合成配置检查"
if command -v dsh >/dev/null 2>&1; then
  # doctor 现在精确匹配整行：现役两个预设必须认得，历史 id 必须不被认成现役行。
  grep -q "preset-flash-lean-ptc-v3-lite 出现在合成配置里" <<<"$dout" && \
    grep -q "preset-flash-lean-ptc-v3-balance 出现在合成配置里" <<<"$dout" && ok "合成配置认得两个预设" || bad "合成配置不认新预设"
  grep -q "preset-flash-lean-ptc-v3 未出现（历史 id" <<<"$dout" && ok "历史 id 没被误认成现役行" || bad "历史 id 被误认成现役行"
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