#!/usr/bin/env node
// 0.1.2 实机报告 P2：flash-sh --version 必须与 package.json 的版本一致（exe 的版本取自 Cargo.toml，发版时两边同步）。
// 另核对 vendor 里 exe 的 sha256 与 .sha256 文件、check-flash-sh.ps1 里的期望值三者一致（不需要能运行 exe）。
//   node test/version.mjs [flash-sh 可执行文件]      （默认 FLASH_SH_TEST_BIN，再默认 vendor/win32-x64/flash-sh.exe）
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.join(here, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const vendor = path.join(pkgDir, "vendor", "win32-x64", "flash-sh.exe");
const bin = process.argv[2] || process.env.FLASH_SH_TEST_BIN || vendor;
let bad = 0;
const ok = (cond, label, extra = "") => {
  console.log((cond ? "  ✓ " : "  ✖ ") + label + (cond || !extra ? "" : "  " + extra));
  if (!cond) bad += 1;
};
console.log("版本一致性（package.json " + pkg.version + "）");
if (fs.existsSync(vendor)) {
  const sha = crypto.createHash("sha256").update(fs.readFileSync(vendor)).digest("hex");
  const shaFile = fs.readFileSync(vendor + ".sha256", "utf8").trim().split(/\s+/)[0].toLowerCase();
  ok(sha === shaFile, "vendor exe 的 sha256 与 flash-sh.exe.sha256 一致", sha + " / " + shaFile);
  const ps1 = fs.readFileSync(path.join(pkgDir, "scripts", "check-flash-sh.ps1"), "utf8");
  const m = ps1.match(/\$ExpectedSha256 = '([0-9a-f]{64})'/);
  ok(m && m[1] === sha, "check-flash-sh.ps1 的 $ExpectedSha256 与 vendor exe 一致", m ? m[1] : "(没找到)");
  const vers = [...ps1.matchAll(/(?:fl-bash|dsh-flash-sh) (\d+\.\d+\.\d+) 发布的 exe|与 (\d+\.\d+\.\d+) 发布的 exe/g)].map((x) => x[1] || x[2]);
  ok(vers.length > 0 && vers.every((v) => v === pkg.version), "check-flash-sh.ps1 提示里的版本号 = " + pkg.version, vers.join(","));
}
const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 30000 });
if (r.error || r.status !== 0) {
  console.log("  - 跑不了 " + bin + "（" + (r.error ? r.error.code || r.error.message : "rc=" + r.status) + "）：--version 核对跳过");
  if (process.env.FLASH_SH_REQUIRE_BIN === "1") bad += 1;
} else {
  const line = (r.stdout || "").trim();
  ok(line.startsWith("flash-sh " + pkg.version + " "), "flash-sh --version = " + pkg.version, JSON.stringify(line));
}
console.log(bad ? "版本一致性：有 " + bad + " 项不一致" : "版本一致性：全部一致");
process.exit(bad ? 1 : 0);
