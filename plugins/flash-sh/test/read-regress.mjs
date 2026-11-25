#!/usr/bin/env node
// read 逐行读取回归（0.1.0 在 Windows 上的 P1：管道 / here-string / heredoc 里 read 只读到第一行）。
// 直接跑一个 flash-sh 可执行文件，每条用例分别以「脚本文件」和「-c 字符串」两种方式执行，逐字比对 stdout 与退出码。
// 期望输出取自 bash 5.2。CI 的 windows-latest job 用它直接跑 vendor 里的 flash-sh.exe。
//   node test/read-regress.mjs [flash-sh 可执行文件]      （默认 FLASH_SH_TEST_BIN，再默认 vendor/win32-x64/flash-sh.exe）
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = process.argv[2] || process.env.FLASH_SH_TEST_BIN || path.join(here, "..", "vendor", "win32-x64", "flash-sh.exe");
if (!fs.existsSync(bin)) {
  console.log("read 回归：跳过（找不到 " + bin + "）");
  process.exit(process.env.FLASH_SH_REQUIRE_BIN === "1" ? 1 : 0);
}

const CASES = [
  ["管道 | while read", `printf 'a\\nb\\n' | while read -r l; do echo "<$l>"; done; echo rc=$?`, "<a>\n<b>\nrc=0\n"],
  ["here-string <<< 循环", `while read -r l; do echo "$l"; done <<< $'x\\ny'; echo rc=$?`, "x\ny\nrc=0\n"],
  ["heredoc <<EOF 循环", `while read -r l; do echo "$l"; done <<EOF\nl1\nl2\nEOF\necho rc=$?`, "l1\nl2\nrc=0\n"],
  ["管道里连续 read 三次", `printf '1\\n2\\n3\\n' | { read -r a; read -r b; read -r c; echo "$a$b$c"; }`, "123\n"],
  ["seq | while read", `seq 1 5 | while read -r n; do echo $((n*2)); done`, "2\n4\n6\n8\n10\n"],
  ["awk 读 here-string", `awk '{print}' <<< $'x\\ny'`, "x\ny\n"],
  ["find | while read", `d=$(mktemp -d) && cd "$d" && touch f1 f2 f3 && find . -type f | sort | while read -r f; do echo "F:$f"; done; cd / && rm -rf "$d"`, "F:./f1\nF:./f2\nF:./f3\n"],
  ["管道：read 后 cat 读剩余", `printf 'h\\nb1\\nb2\\n' | { read -r hdr; echo "hdr=$hdr"; cat; }`, "hdr=h\nb1\nb2\n"],
  ["heredoc：read 后 cat 读剩余", `{ read -r a; echo "a=$a"; cat; } <<EOF\none\ntwo\nthree\nEOF`, "a=one\ntwo\nthree\n"],
  ["磁盘文件：两次 read 后 cat", `d=$(mktemp -d) && printf 'r1\\nr2\\nr3\\n' > "$d/t" && { read -r a; read -r b; echo "$a$b"; cat; } < "$d/t"; exec 3< "$d/t"; read -r x <&3; read -r y <&3; echo "$x/$y"; cat <&3; exec 3<&-; rm -rf "$d"`, "r1r2\nr3\nr1/r2\nr3\n"],
  ["管道：read -n / -d / 普通", `printf 'abcdef:ghi\\n' | { read -r -n 3 a; read -r -d : b; read -r c; echo "$a|$b|$c"; }`, "abc|def|ghi\n"],
  ["管道：read -t", `printf 'p\\nq\\n' | { read -r -t 5 a; read -r -t 5 b; echo "$a$b rc=$?"; }`, "pq rc=0\n"],
  ["管道：最后一行无换行", `printf 'a\\nlast' | { while read -r l; do echo "L:$l"; done; echo "tail:$l"; }`, "L:a\ntail:last\n"],
  ["管道：readarray", `printf 'x\\ny\\nz\\n' | { readarray -t arr; echo "\${#arr[@]}:\${arr[*]}"; }`, "3:x y z\n"],
  ["管道：3000 行", `seq 1 3000 | { n=0; s=0; while read -r v; do n=$((n+1)); s=$((s+v)); done; echo "$n $s"; }`, "3000 4501500\n"],
  // 0.1.2：下游第三轮报告 §6.2 的 4 条，加管道 peek 改造相关的边界
  ["子 shell 内管道读", `( printf 'a\\nb\\n' | while read -r l; do echo "<$l>"; done )`, "<a>\n<b>\n"],
  ["函数从管道读", `f(){ while read -r l; do echo "{$l}"; done; }; printf 'a\\nb\\n' | f`, "{a}\n{b}\n"],
  ["嵌套管道", `printf '1\\n2\\n' | while read -r a; do printf 'x\\ny\\n' | while read -r b; do echo -n "$a$b "; done; done; echo`, "1x 1y 2x 2y \n"],
  ["1 MB 单行：文件", `d=$(mktemp -d) && awk 'BEGIN{s="x"; while (length(s) < 1000000) s = s s; print substr(s, 1, 1000000)}' > "$d/big" && { read -r l; echo \${#l}; } < "$d/big"; rm -rf "$d"`, "1000000\n"],
  ["1 MB 单行：管道", `awk 'BEGIN{s="x"; while (length(s) < 1000000) s = s s; print substr(s, 1, 1000000)}' | { read -r l; echo \${#l}; }`, "1000000\n"],
  ["管道：read 后 head -n 1 读剩余", `printf 'a\\nb\\nc\\n' | { read -r x; head -n 1; echo "x=$x"; }`, "b\nx=a\n"],
  ["here-string：read 后 awk 读剩余", `{ read -r x; awk '{print "awk:" $0}'; echo "x=$x"; } <<< $'h1\\nh2\\nh3'`, "awk:h2\nawk:h3\nx=h1\n"],
  ["管道：read、cat、再 read", `printf '1\\n2\\n3\\n4\\n' | { read -r a; read -r b; cat; read -r c; echo "a=$a b=$b c=$c rc=$?"; }`, "3\n4\na=1 b=2 c= rc=1\n"],
  ["管道：同一管道两个 fd 交替读", `printf '1\\n2\\n3\\n4\\n' | { exec 3<&0; read -r a; read -r -u 3 b; read -r c; read -r -u 3 d; echo "$a$b$c$d"; }`, "1234\n"],
  ["管道：read 后 mapfile", `printf 'h\\n1\\n2\\n' | { read -r h; mapfile -t rest; echo "$h \${#rest[@]} \${rest[*]}"; }`, "h 2 1 2\n"],
  // 0.1.3：自建管道/文件延迟交还（read 不再每行向系统取）。以下确认交还时机：break 后别的命令读剩余、命令替换 / 流水线段 /
  // 子 shell / 函数 / eval 读同一 stdin、两个 fd 交替、mapfile、文件重定向后 applet 子进程接着读、大量行计数、lastpipe
  ["延迟交还：break 后 wc 读剩余", `seq 1 20000 | { while read -r l; do [ "$l" = 12345 ] && break; done; echo "l=$l"; wc -l | tr -d ' '; }`, "l=12345\n7655\n"],
  ["延迟交还：命令替换里 head 读 stdin", `seq 1 5 | { read -r a; x=$(head -n 2); read -r b; echo "$a|$x|$b"; }`, "1|2\n3|\n"],
  ["延迟交还：流水线段读父 stdin", `seq 1 6 | { read -r a; read -r b | cat; read -r c; { read -r d; echo "d=$d"; } | cat; read -r e; echo "$a$c$e"; }`, "d=4\n135\n"],
  ["延迟交还：子 shell / 函数 / eval / cat", `f(){ read -r fv; }; seq 1 9 | { read -r a; (read -r b; echo "sub=$b"); f; eval 'read -r e'; read -r g; echo "$a $fv $e $g"; cat; }`, "sub=2\n1 3 4 5\n6\n7\n8\n9\n"],
  ["延迟交还：管道与 heredoc 两个 fd 交替", `seq 1 6 | { while read -r a && read -r -u 3 b; do echo "$a:$b"; done 3<<EOF\nx\ny\nz\nEOF\ncat; }`, "1:x\n2:y\n3:z\n5\n6\n"],
  ["延迟交还：break 后 mapfile", `seq 1 10 | { while read -r l; do [ $l = 4 ] && break; done; mapfile -t r; echo "\${#r[@]} \${r[0]}"; }`, "6 5\n"],
  ["延迟交还：break 后 awk", `seq 1 10 | { while read -r l; do [ $l = 6 ] && break; done; awk '{s+=$1} END{print s}'; }`, "34\n"],
  ["延迟交还：文件 break 后 head 再 read", `d=$(mktemp -d) && seq 1 30000 > "$d/f" && { while read -r l; do [ "$l" = 23456 ] && break; done; head -n 1; read -r x; echo "x=$x"; } < "$d/f"; rm -rf "$d"`, "23457\nx=23458\n"],
  ["延迟交还：管道 20 万行计数", `seq 1 200000 | { n=0; s=0; while read -r v; do n=$((n+1)); s=$((s+v)); done; echo "$n $s"; }`, "200000 20000100000\n"],
  ["延迟交还：lastpipe", `shopt -s lastpipe; seq 1 5 | { read -r a; read -r b; }; echo "$a$b"`, "12\n"],
  ["延迟交还：read -t 不把已用的行当成新输入", `{ printf '1\\n'; sleep 1; printf '2\\n'; } | { read -r a; read -r -t 0.3 b; echo "rc=$? b=[$b]"; read -r c; echo "c=$c"; }`, "rc=142 b=[]\nc=2\n"],
  ["延迟交还：read -t 0 不把已用的行当成新输入", `{ printf '1\\n'; sleep 1; printf '2\\n'; } | { read -r a; read -t 0 && echo avail || echo none; read -r c; echo "c=$c"; }`, "none\nc=2\n"],
  ["read -t 超时精度（0.3 s，管道无数据）", `s=$(date +%s%N); sleep 2 | { read -r -t 0.3 x; echo "rc=$?"; e=$(date +%s%N); d=$(( (e - s) / 1000000 )); (( d >= 250 && d < 1500 )) && echo ok || echo "elapsed=$d"; }`, "rc=142\nok\n"],
];

// 脚本文件方式要把临时文件路径交给被测程序：Windows exe 在非 Windows 宿主上（WSL interop、跨平台 CI）
// 读不到 os.tmpdir() 给的 Linux 路径，会整排假红（下游第三轮报告 §6.3）。只有被测程序与宿主同平台时才跑这种方式。
function isWindowsExe(p) {
  try {
    const fd = fs.openSync(p, "r");
    const b = Buffer.alloc(2);
    fs.readSync(fd, b, 0, 2, 0);
    fs.closeSync(fd);
    return b.toString("latin1") === "MZ";
  } catch {
    return /\.exe$/i.test(p);
  }
}
const fileModeOk = isWindowsExe(bin) === (process.platform === "win32");
if (!fileModeOk) console.log("（被测程序与宿主平台不同：只跑 -c 方式，脚本文件方式跳过）");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flash-sh-read-"));
let failed = 0;
let passed = 0;
console.log("read 回归（" + bin + "）");
for (const [label, script, want] of CASES) {
  const file = path.join(tmp, "case.sh");
  fs.writeFileSync(file, script + "\n");
  const modes = fileModeOk ? [["file", [file]], ["-c", ["-c", script]]] : [["-c", ["-c", script]]];
  for (const [mode, args] of modes) {
    const r = spawnSync(bin, args, { encoding: "utf8", timeout: 30000, cwd: tmp });
    const out = (r.stdout ?? "").replace(/\r\n/g, "\n");
    const good = r.status === 0 && out === want;
    if (good) {
      passed += 1;
      console.log("  ✓ " + label + "（" + mode + "）");
    } else {
      failed += 1;
      console.log("  ✖ " + label + "（" + mode + "）rc=" + r.status + (r.error ? " " + r.error.message : ""));
      console.log("      期望 " + JSON.stringify(want));
      console.log("      实际 " + JSON.stringify(out) + (r.stderr ? "  stderr " + JSON.stringify(r.stderr.slice(0, 300)) : ""));
    }
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log("read 回归：" + passed + "/" + (passed + failed) + " 通过");
process.exit(failed ? 1 : 0);
