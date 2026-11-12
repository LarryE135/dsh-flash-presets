#!/usr/bin/env node
// 发布后复核：npm publish 报成功不等于 registry 已生效。
// 写成这个脚本的直接原因（2026-11-12 审计）：0.3.1 发布后，我用两种"看起来没问题"的取法
// 都读到"没有这个版本"，差点得出"发布没落地"的错误结论。三处陷阱都记在这里，别再踩：
//   1) 直接 fetch registry.npmjs.org 会拿到边缘缓存的旧 packument（time.modified 停在上一版），
//      必须走 npm CLI（它带正确的 cache/etag 处理）；
//   2) npm view <pkg>@<ver> version --json —— 如果把 "version" 拼进同一个 argv 元素，
//      npm 会把整份 packument 打出来，脚本拿对象跟字符串比就恒不相等。字段必须单独一个 argv；
//   3) （第二轮审计 P2-2）Windows 上 npm 是 npm.cmd、也没有 sleep 这个可执行文件，
//      所以调用要走 shell 包装，等待用 Atomics.wait 而不是 fork 一个 sleep。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const IS_WIN = process.platform === "win32";
const NPM = IS_WIN ? "npm.cmd" : "npm";
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const want = opt("--version", pkg.version);
const budget = Number(opt("--timeout", process.env.PUBLISH_VERIFY_TIMEOUT || 120));
const quiet = argv.includes("--quiet");

const view = (spec, field) => {
  try {
    const out = execFileSync(NPM, ["view", spec, field, "--json"], {
      encoding: "utf8",
      shell: IS_WIN,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return JSON.parse(out);
  } catch {
    return null; // 404 / 网络抖动一律当作"还没生效"
  }
};

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const say = (...a) => { if (!quiet) console.log(...a); };
const started = Date.now();
let last = null;

while (true) {
  last = view(pkg.name + "@" + want, "version");
  if (last === want) {
    const latest = view(pkg.name, "dist-tags.latest");
    if (want === pkg.version && latest !== want) {
      say("✖ registry 上有 " + want + "，但 dist-tags.latest = " + String(latest) + "（安装默认拿到旧版）");
      say("  修法：npm dist-tag add " + pkg.name + "@" + want + " latest");
      process.exit(1);
    }
    say("✓ registry 已生效：" + pkg.name + "@" + want + "（latest = " + String(latest) + "）");
    process.exit(0);
  }
  if (Date.now() - started >= budget * 1000) {
    say("✖ 已等 " + budget + " 秒，registry 上仍查不到 " + pkg.name + "@" + want);
    say("  当前 npm view 返回：" + JSON.stringify(last));
    say("  若确认发布没落地：重试 npm publish（版本已存在会明确报 E403 cannot publish over）");
    process.exit(1);
  }
  say("… 等待 registry 生效（" + Math.round((Date.now() - started) / 1000) + "s / " + budget + "s）");
  sleep(10000);
}
