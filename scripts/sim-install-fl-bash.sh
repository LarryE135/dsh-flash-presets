#!/usr/bin/env bash
# 模拟安装：用一套真实的 DSH（npm i @deepseek-ai/dsh@<版本> 得到的 node_modules），按用户在插件页上的装法
# `dsh plugin add` 装上本仓库打出来的 dsh-flash-presets，看 Bash 工具 fl-bash 在插件页（pluginInventory）上
# 是不是**单独的一个组件**，以及工具 fl_bash 只注册一次。
#
#   A. 真实的非 Windows 宿主，原样装 npm pack 出来的 presets：包里自带 fl-bash 实现与 flash-sh.exe（不另装包）；
#      插件页上有单独的 fl-bash 一行（标题 fl-bash，正常运行，不是红行），默认关，工具不注册。
#   B. 同一个包，profile 补丁打开 id: fl-bash，模拟 Windows（DSH_FL_BASH_ANY_PLATFORM=1 + DSH_FL_BASH_BIN=Linux 版解释器）
#      → fl_bash 注册 1 次、经真实管线执行；--dump-config-schema 里这一行带设置项。
#   C. 在 B 的 profile 里再单独装一份 fl-bash（去掉 os/cpu/platforms 的测试变体）并打开它的 fl-bash-standalone 行
#      → 插件页两行 fl-bash，fl_bash 仍只有 1 个，归 presets 那一行。
#
# presets 包与用户从 npm 拿到的内容相同（npm pack，含 prepack 同步）；只有 C 里的独立包是测试变体。
#
# 用法：DSH_REAL_NM=/path/to/node_modules FLASH_SH_TEST_BIN=/path/flash-sh(Linux 构建) bash scripts/sim-install-fl-bash.sh
# 可选：DSH_REAL_NODE=/path/to/node  SIM_WORK=工作目录（默认 mktemp）
set -u
NM=${DSH_REAL_NM:?需要 DSH_REAL_NM}
BIN=${FLASH_SH_TEST_BIN:?需要 FLASH_SH_TEST_BIN}
REPO=$(cd "$(dirname "$0")/.." && pwd)
PLUG="$REPO/plugins/flash-sh"
W=${SIM_WORK:-$(mktemp -d)}
rm -rf "$W"/{home,bin,pack,var,pre}; mkdir -p "$W"/{home,bin,pack,var,pre}
NODE=${DSH_REAL_NODE:-node}
printf '#!/bin/sh\nexec %s %s/.bin/dsh "$@"\n' "$NODE" "$NM" > "$W/bin/dsh"; chmod +x "$W/bin/dsh"
export PATH="$W/bin:$PATH" HOME="$W/home"
export FL_BASH_PROBE_INVENTORY_MODULE="file://$(cd "$NM/@deepseek-ai/dsh-host-plugin-inventory" && pwd)/lib/index.js"
unset DSH_HOME DSH_FL_BASH DSH_FL_BASH_BIN DSH_FL_BASH_ANY_PLATFORM DSH_FLASH_SH DSH_FLASH_SH_BIN DSH_FLASH_SH_ANY_PLATFORM
fail=0
ok() { if [ "$1" = 0 ]; then echo "  ✓ $2"; else echo "  ✖ $2"; fail=$((fail+1)); fi; }
echo "模拟安装（dsh $(dsh --version 2>/dev/null | tail -1)，node $($NODE -v)，工作目录 ${W}）"

# ── 打包 ──
(cd "$PLUG" && npm pack --ignore-scripts --pack-destination "$W/pack" -q >/dev/null 2>&1)
FTGZ=$(ls "$W"/pack/fl-bash-*.tgz | head -1); [ -f "$FTGZ" ]; ok $? "npm pack fl-bash → $(basename "$FTGZ")"
(cd "$W/var" && tar xzf "$FTGZ" && cd package && node -e '
const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json"));delete p.dsh.bundle.platforms;delete p.os;delete p.cpu;fs.writeFileSync("package.json",JSON.stringify(p,null,2))' && npm pack --ignore-scripts --pack-destination "$W/var" -q >/dev/null 2>&1)
VTGZ=$(ls "$W"/var/fl-bash-*.tgz | head -1); [ -f "$VTGZ" ]; ok $? "fl-bash 测试变体（去掉 os/cpu/platforms）"
(cd "$REPO" && npm pack --pack-destination "$W/pack" -q >/dev/null 2>"$W/pack-presets.err")
PTGZ=$(ls "$W"/pack/dsh-flash-presets-*.tgz | head -1); [ -f "$PTGZ" ]; ok $? "npm pack dsh-flash-presets → $(basename "$PTGZ")"
tar tzf "$PTGZ" | grep -qx "package/vendor/win32-x64/flash-sh.exe" && tar tzf "$PTGZ" | grep -qx "package/lib/fl-bash.js"; ok $? "presets 包里自带 lib/fl-bash.js 与 vendor/win32-x64/flash-sh.exe"
tar xzOf "$PTGZ" package/package.json | node -e 'const p=JSON.parse(require("fs").readFileSync(0,"utf8"));process.exit(!p.optionalDependencies&&!p.os&&!p.cpu?0:1)'; ok $? "presets 不依赖单独的 fl-bash 包、不限平台"
echo "    presets 包大小：$(stat -c %s "$PTGZ") 字节（gzip）"
tar xzOf "$PTGZ" package/cordis.patch.yml | grep -A3 '^    - id: fl-bash$' | grep -q "name: 'dsh-flash-presets/fl-bash'"; ok $? "包内组合补丁有单独的 fl-bash 组件行"

summ() { # $1 probe.json
  node -e '
const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
for(const e of r.inventory||[]) if(/flash-presets|fl-bash|flash-sh/.test(e.moduleName)) console.log("    插件页行  "+e.moduleName.padEnd(30)+" 标题="+JSON.stringify(e.title)+"  enabled="+e.enabled+"  phase="+e.fiberPhase+(e.diagnostic?"  诊断="+e.diagnostic:""));
console.log("    fl_bash 个数="+r.flBashCount+"  旧名 flash_sh 存在="+r.legacyToolPresent+(r.execOk!==undefined?"  执行="+r.execOk:"")+(r.inventoryError?"  inventoryError="+r.inventoryError:"")+(r.error?"  error="+r.error.split("\n")[0]:""));
for(const l of (r.logs||[])) console.log("    日志  "+l.slice(0,220));' "$1"
}
row() { # $1 probe.json  $2 moduleName  → 打印该行 JSON
  node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const e=(r.inventory||[]).filter(e=>e.moduleName===process.argv[2]);console.log(JSON.stringify(e))' "$1" "$2"
}
boot() { # $1 profile  $2 输出
  rm -f "$2"
  FLASH_SH_PROBE_OUT="$2" FLASH_SH_PROBE_DELAY_MS=5000 timeout 100 dsh --profile "$1" > "$W/boot-$1.out" 2> "$W/boot-$1.err" < /dev/null
  [ -f "$2" ]
}

# ── A. 真实非 Windows 宿主 ──
echo "A. 真实 $(uname -s)-$(uname -m) 宿主，原样安装 presets（默认关）"
timeout 115 dsh plugin --profile a add "$PTGZ" > "$W/addA.log" 2>&1; ok $? "dsh plugin add dsh-flash-presets"
PDIR=$(node -e 'console.log(require("fs").realpathSync(process.argv[1]))' "$W/home/.dsh/profiles/a/node_modules/dsh-flash-presets")
[ -f "$PDIR/vendor/win32-x64/flash-sh.exe" ] && [ -f "$PDIR/lib/fl-bash.js" ]; ok $? "装好的 presets 里有 flash-sh.exe 与 lib/fl-bash.js"
[ -z "$(find "$W/home/.dsh/profiles/a/node_modules" -path "*/fl-bash/package.json" 2>/dev/null | head -1)" ]; ok $? "profile 里没有另装 fl-bash 包"
timeout 110 dsh plugin --profile a add "$PLUG/test/probe" > "$W/addA2.log" 2>&1; ok $? "探针组合包 add"
timeout 90 dsh --profile a --dump-config > "$W/dumpA.txt" 2> "$W/dumpA.err"; ok $? "dump-config"
grep -q "^- id: fl-bash$" "$W/dumpA.txt" && grep -q "^- id: flash-presets$" "$W/dumpA.txt"; ok $? "dump：flash-presets 与 fl-bash 是两行"
! grep -q "flashSh" "$W/dumpA.txt"; ok $? "dump：flash-presets 行下没有 flashSh"
boot a "$W/probeA.json"; ok $? "宿主启动"
summ "$W/probeA.json"
row "$W/probeA.json" dsh-flash-presets/fl-bash | grep -q '"enabled":true,"fiberPhase":"active","title":{"en":"fl-bash","zh":"fl-bash"}'; ok $? "插件页：fl-bash 单独一行，标题 fl-bash，运行中（非红行）"
row "$W/probeA.json" dsh-flash-presets | grep -q '"zh":"Flash 精简预设"'; ok $? "插件页：flash-presets 行标题不变"
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1]));process.exit(r.flBashCount===0&&!r.legacyToolPresent?0:1)' "$W/probeA.json"; ok $? "默认关：fl_bash 不注册，也没有旧名 flash_sh"

# ── B. 模拟 Windows（变体 + 开发模式） ──
echo "B. 同一个包，profile 补丁打开 id: fl-bash，模拟 Windows"
timeout 115 dsh plugin --profile b add "$PTGZ" > "$W/addB.log" 2>&1; ok $? "dsh plugin add dsh-flash-presets"
timeout 110 dsh plugin --profile b add "$PLUG/test/probe" > "$W/addB2.log" 2>&1; ok $? "探针组合包 add"
printf -- '- id: fl-bash\n  config:\n    enabled: true\n    approval: "off"\n' > "$W/home/.dsh/profiles/b/cordis.patch.yml"
DSH_FL_BASH_ANY_PLATFORM=1 DSH_FL_BASH_BIN="$BIN" boot b "$W/probeB.json"; ok $? "宿主启动"
summ "$W/probeB.json"
row "$W/probeB.json" dsh-flash-presets/fl-bash | grep -q '"zh":"fl-bash"'; ok $? "插件页：fl-bash 单独一行"
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1]));process.exit(r.flBashCount===1&&r.execOk===true&&!r.legacyToolPresent?0:1)' "$W/probeB.json"; ok $? "fl_bash 注册 1 次，经真实管线执行 → probe-42"

timeout 110 dsh --profile b --dump-config-schema > "$W/schemaB.json" 2> "$W/schemaB.err"
node -e '
const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
const e=s["x-cordis"].entries.find(e=>e.id==="fl-bash");
if(!e||e.status!=="schema")process.exit(1);
const str=JSON.stringify(s.$defs[e.configRef.split("/").pop()]);
process.exit(/"approval"/.test(str)&&/"timeoutMs"/.test(str)?0:1)' "$W/schemaB.json"; ok $? "插件页设置项：fl-bash 行带 Config schema（approval / timeoutMs 等，来自 fl-bash 包）"

# ── C. 再单独装一份 fl-bash ──
echo "C. 同一 profile 再单独装 fl-bash（变体）并打开 fl-bash-standalone"
timeout 115 dsh plugin --profile b add "$VTGZ" > "$W/addC.log" 2>&1; ok $? "dsh plugin add fl-bash"
printf -- '- id: fl-bash\n  config:\n    enabled: true\n    approval: "off"\n- id: fl-bash-standalone\n  config:\n    enabled: true\n    approval: "off"\n' > "$W/home/.dsh/profiles/b/cordis.patch.yml"
DSH_FL_BASH_ANY_PLATFORM=1 DSH_FL_BASH_BIN="$BIN" boot b "$W/probeC.json"; ok $? "宿主启动"
summ "$W/probeC.json"
row "$W/probeC.json" fl-bash | grep -q '"zh":"fl-bash"'; ok $? "插件页：单独安装的那一行也叫 fl-bash（来自包自己的 locale）"
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1]));const n=(r.inventory||[]).filter(e=>/^(fl-bash|dsh-flash-presets\/fl-bash)$/.test(e.moduleName)).length;process.exit(n===2&&r.flBashCount===1&&r.execOk===true&&(r.logs||[]).some(l=>/provided by dsh-flash-presets/.test(l))?0:1)' "$W/probeC.json"; ok $? "两行都在，fl_bash 仍只有 1 个，归 presets 那一行（独立行写日志让位）"

[ $fail -eq 0 ] && echo "模拟安装：全部通过" || echo "模拟安装：$fail 项失败"
exit $fail
