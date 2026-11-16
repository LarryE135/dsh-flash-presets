#!/usr/bin/env node
// 本地「与 CI 同源」的全量校验入口（npm run verify:full）。
// 背景：0.3.2 两次「本地绿、CI 红」——npm run verify 只是 CI 的第一步，
// lint-presets（版本真源）与 selftest.sh（README 必须有当前版本小节等断言）都在 verify 之外。
// 本脚本按 .github/workflows/verify.yml 的 ubuntu 分支顺序串起所有**不依赖 Windows/macOS、
// 不依赖安装 DSH** 的步骤；矩阵/装 DSH/Windows-cli 那几步本地跑不了，不在此列（见文末说明）。
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hasBash = spawnSync("bash", ["-c", "true"]).status === 0;
const results = [];

const run = (label, cmd, args, env) => {
  process.stdout.write("\n\u001b[36m▶ " + label + "\u001b[0m\n");
  const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...(env || {}) } });
  const ok = r.status === 0;
  results.push({ label, ok });
  return ok;
};

// 1) 权威闸门（10 个检查串联：sync-lib / YAML / 结构 / 文本审计 / 版本 / 会话兼容 ...）
run("npm run verify", "npm", ["run", "verify"]);

// 2) 别名表 × 合成配置
run("别名表 × 合成配置", "node", ["tools/probe/alias-vs-config.mjs", "--composed"]);

// 3) 发布面卫生 + 基准复核清单
run("发布面卫生", "node", ["scripts/verify-release-hygiene.mjs"]);
run("基准复核清单", "node", ["scripts/bench-release-checklist.mjs"]);

// 4) 全新 DSH_HOME 装一遍，再跑结构/跨平台校验（CI 用 RUNNER_TEMP）
const home = mkdtempSync(join(tmpdir(), "dsh-verify-"));
try {
  if (hasBash) {
    // 复刻 CI 的「Prepare a DSH home (0.1.7 layout)」：没有 profiles/web/cordis.patch.yml 时，
    // install.sh 会走 legacy 目录分支并直接拒绝（exit 3），后面的结构校验也无从谈起。
    mkdirSync(join(home, "profiles", "web"), { recursive: true });
    writeFileSync(join(home, "profiles", "web", "cordis.patch.yml"), "# verify:full profile patch\n[]\n");
    run("安装（bash，全新 DSH_HOME）", "bash", ["scripts/install.sh"], { DSH_HOME: home });
    run("全新安装后结构校验", "node", ["scripts/verify-presets.mjs"], { DSH_HOME: home });
  } else {
    console.log("\n(跳过 bash 安装步骤：当前环境没有 bash)");
  }
} finally {
  rmSync(home, { recursive: true, force: true });
}

// 5) 历史 preset id 兼容性 / 预设文本审计 / bash 3.2 多字节陷阱 / 组合包同步
run("历史 preset id 兼容性", "node", ["scripts/check-preset-compat.mjs"]);
run("预设文本审计（版本真源、编号、平台路径）", "node", ["scripts/lint-presets.mjs"]);
run("bash 3.2 多字节陷阱", "node", ["scripts/check-bash32-cjk.mjs"]);
run("组合包补丁层与 presets 同步", "node", ["scripts/compose-bundle-patch.mjs", "--check"]);

// 6) 端到端自测（含「README 必须有当前版本小节」这类断言，CI 里挂在 Self-test 步）
if (hasBash) {
  run("Self-test（bash 端到端）", "bash", ["scripts/selftest.sh"]);
  run("整体组合自测", "bash", ["scripts/selftest-integration.sh"]);
} else {
  console.log("\n(跳过 bash 自测：当前环境没有 bash)");
}

// 7) PowerShell 脚本静态检查（不执行，只解析）
run("PowerShell 脚本静态检查", "node", ["scripts/check-ps1.mjs"]);

const failed = results.filter((r) => !r.ok);
console.log("\n" + "=".repeat(64));
for (const r of results) console.log("  " + (r.ok ? "\u2713" : "\u2717") + " " + r.label);
console.log("=".repeat(64));
if (failed.length) {
  console.error("✖ verify:full 失败：" + failed.length + " / " + results.length + " 步未通过");
  console.error("  未通过：" + failed.map((r) => r.label).join("、"));
  process.exit(1);
}
console.log("✓ verify:full 全部通过（" + results.length + " 步）。");
console.log("  未覆盖：Windows/macOS 专属步骤、plugin-tests 矩阵、装 DSH 后的 bundle-install / integration");
console.log("  —— 这些只在 CI 跑，改动涉及它们时请看 Actions 结果。");
