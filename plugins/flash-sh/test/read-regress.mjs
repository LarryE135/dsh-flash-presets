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
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flash-sh-read-"));
let failed = 0;
let passed = 0;
console.log("read 回归（" + bin + "）");
for (const [label, script, want] of CASES) {
  const file = path.join(tmp, "case.sh");
  fs.writeFileSync(file, script + "\n");
  for (const [mode, args] of [["file", [file]], ["-c", ["-c", script]]]) {
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
