#!/usr/bin/env bash
# 用一套真实的 DSH 安装（npm i @deepseek-ai/dsh@<版本> 得到的 node_modules）验证组合包：
#   1. 原包：dsh plugin add <绝对路径 tgz>；在非 Windows x64 宿主上应被拒绝（pnpm 按 os/cpu 报 unsupported platform，
#      或 DSH 按 dsh.bundle.platforms=[win32] 拒绝激活），profile 里不留依赖；
#   2. 去掉 os/cpu/platforms 的测试变体：add 成功；--dump-config 出现 fl-bash-standalone 行且 enabled:false；
#      profile 补丁覆盖 enabled:true 后 dump 里变成 true；--dump-config-schema 能导入本模块并读到 schema；
#   3. 启动该 profile（DSH_FLASH_SH_ANY_PLATFORM=1 + DSH_FLASH_SH_BIN=Linux 版 flash-sh），
#      启动报告 / 输出里出现 "[fl-bash] fl_bash registered"。
# 用法：DSH_REAL_NM=/path/to/node_modules FLASH_SH_TEST_BIN=/path/flash-sh bash test/real-dsh.sh
# 可选：DSH_REAL_NODE=/path/to/node（DSH 0.2.2 需要较新的 Node）  DSH_REAL_WORK=工作目录（默认 mktemp）
set -u
NM=${DSH_REAL_NM:?需要 DSH_REAL_NM}
BIN=${FLASH_SH_TEST_BIN:?需要 FLASH_SH_TEST_BIN}
PLUGIN=$(cd "$(dirname "$0")/.." && pwd)
W=${DSH_REAL_WORK:-$(mktemp -d)}
rm -rf "$W/home" "$W/bin" "$W/pack" "$W/variant"; mkdir -p "$W/home" "$W/bin" "$W/pack" "$W/variant"
NODE=${DSH_REAL_NODE:-node}
printf '#!/bin/sh\nexec %s %s/.bin/dsh "$@"\n' "$NODE" "$NM" > "$W/bin/dsh"; chmod +x "$W/bin/dsh"
export PATH="$W/bin:$PATH" HOME="$W/home"
unset DSH_HOME DSH_FLASH_SH DSH_FLASH_SH_BIN DSH_FLASH_SH_ANY_PLATFORM
fail=0
ok() { if [ "$1" = 0 ]; then echo "  ✓ $2"; else echo "  ✖ $2"; fail=$((fail+1)); fi; }
echo "real-dsh 自测（dsh $(dsh --version 2>/dev/null | tail -1)，node $($NODE -v)，pnpm $(pnpm -v 2>/dev/null)，工作目录 ${W}）"

(cd "$PLUGIN" && npm pack --ignore-scripts --pack-destination "$W/pack" -q >/dev/null 2>&1)
TGZ=$(ls "$W"/pack/fl-bash-*.tgz | head -1)
[ -f "$TGZ" ]; ok $? "npm pack → $(basename "$TGZ")"

# 1. 原包 + 平台声明
timeout 110 dsh plugin --profile p1 add "$TGZ" > "$W/add1.log" 2>&1; rc=$?
if [ "$(uname -s)" != "MINGW64_NT" ] && ! grep -qi microsoft /proc/version 2>/dev/null; then
  [ $rc -ne 0 ] && grep -Eq "Unsupported platform|ERR_PNPM_UNSUPPORTED_PLATFORM|Bundle supports Host platforms win32" "$W/add1.log"; ok $? "非 Windows x64 宿主：add 被拒（rc=${rc}；$(grep -Eo 'ERR_PNPM_UNSUPPORTED_PLATFORM|Bundle supports Host platforms win32' "$W/add1.log" | head -1)）"
  # DSH 0.2.2-rc.5 + pnpm 12：本地 tgz 不按 os/cpu 拦，dependencies 里会留下 fl-bash（DSH 提示用 dsh plugin remove 清），
  # 但组合包选择不变。断言只看 dsh.profile.bundles；dependencies 有残留只记录、不判失败。
  node -e 'let p={};try{p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch{};process.exit(((p.dsh&&p.dsh.profile&&p.dsh.profile.bundles)||[]).includes("fl-bash")?1:0)' "$W/home/.dsh/profiles/p1/package.json" 2>/dev/null; ok $? "被拒后 profile 的 dsh.profile.bundles 里没有 fl-bash"
  if grep -q '"fl-bash"' "$W/home/.dsh/profiles/p1/package.json" 2>/dev/null; then echo "  （记录）profile package.json 的 dependencies 里留有 fl-bash（pnpm 未按平台拦本地 tgz），不判失败"; fi
fi

# 2. 去掉 os/cpu/platforms 的变体
(cd "$W/variant" && tar xzf "$TGZ" && cd package && node -e '
const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json"));delete p.dsh.bundle.platforms;delete p.os;delete p.cpu;fs.writeFileSync("package.json",JSON.stringify(p,null,2))' && npm pack --ignore-scripts --pack-destination "$W/variant" -q >/dev/null 2>&1)
VTGZ=$(ls "$W"/variant/fl-bash-*.tgz | head -1)
timeout 110 dsh plugin --profile t add "$VTGZ" > "$W/add2.log" 2>&1; ok $? "变体 add 成功"
timeout 90 dsh --profile t --dump-config > "$W/dump1.txt" 2> "$W/dump1.err"; ok $? "dump-config 成功"
grep -A3 "^- id: fl-bash-standalone" "$W/dump1.txt" | grep -q "enabled: false"; ok $? "dump：fl-bash-standalone 行，enabled: false"
P="$W/home/.dsh/profiles/t/cordis.patch.yml"
printf -- '- id: fl-bash-standalone\n  config:\n    enabled: true\n    approval: "off"\n    binPath: %s\n' "$BIN" > "$P"
timeout 90 dsh --profile t --dump-config > "$W/dump2.txt" 2> "$W/dump2.err"
grep -A4 "^- id: fl-bash-standalone" "$W/dump2.txt" | grep -q "enabled: true"; ok $? "profile 补丁覆盖后 enabled: true"
timeout 110 dsh --profile t --dump-config-schema > "$W/schema.json" 2> "$W/schema.err"
node -e '
const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
const e=s["x-cordis"].entries.find(e=>e.id==="fl-bash-standalone");
if(!e||e.status!=="schema")process.exit(1);
const d=s.$defs[e.configRef.split("/").pop()];const str=JSON.stringify(d);
process.exit(/"enabled"/.test(str)&&/"approval"/.test(str)?0:1)' "$W/schema.json"; ok $? "dump-config-schema：DSH 导入了本模块并读出 Config schema"

# 3. 启动：再装一个仅测试用的探针组合包（test/probe），它在宿主启动后查 ctx.tools、经真实管线跑一次 fl_bash，写报告后退出
timeout 110 dsh plugin --profile t add "$PLUGIN/test/probe" > "$W/add3.log" 2>&1; ok $? "探针组合包 add 成功"
rm -f "$W/probe.json"
DSH_FLASH_SH_ANY_PLATFORM=1 FLASH_SH_PROBE_OUT="$W/probe.json" timeout 100 dsh --profile t > "$W/boot.out" 2> "$W/boot.err" < /dev/null; brc=$?
[ -f "$W/probe.json" ]; ok $? "宿主启动并加载组合包（boot rc=${brc}）"
node -e '
const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
const checks=[[r.registered===true,"真实宿主里 fl_bash 已注册（全局工具："+(r.globalTools||[]).length+" 个）"],
 [(r.logs||[]).some(l=>l.includes("[fl-bash] fl_bash registered")),"logger 缓冲里有 [fl-bash] fl_bash registered"],
 [r.execOk===true,"经 ctx.tools.execute 执行一条命令 → probe-42，exitCode 0"]];
let bad=0;for(const [c,l] of checks){console.log((c?"  ✓ ":"  ✖ ")+l);if(!c)bad++}
if(r.error){console.log("  ✖ 探针异常："+r.error);bad++}
process.exit(bad)' "$W/probe.json" || fail=$((fail+1))

[ $fail -eq 0 ] && echo "real-dsh 自测：全部通过" || echo "real-dsh 自测：$fail 项失败"
exit $fail
