#!/usr/bin/env node
// 包结构与纯函数自检（不需要 DSH、不需要真实 flash-sh 二进制）。
// 在仓库里跑时额外核对与 dsh-flash-presets 的约定；在 npm pack 出来的包里跑时这些项自动跳过。
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pluginDir, "..", "..");
const inRepo = fs.existsSync(path.join(repoRoot, "plugins", "plan-mode-ui", "package.json")) && fs.existsSync(path.join(repoRoot, "lib", "bundle.js"));
let failed = 0;
const ok = (cond, label, extra = "") => {
  if (cond) console.log("  ✓ " + label);
  else {
    failed += 1;
    console.log("  ✖ " + label + (extra ? "  " + String(extra).slice(0, 800) : ""));
  }
};
console.log("unit 自检" + (inRepo ? "（仓库内）" : "（独立包内，跳过与 dsh-flash-presets 的对照项）"));

// ── 包结构 ──────────────────────────────────────────────────────────────
const pkg = JSON.parse(fs.readFileSync(path.join(pluginDir, "package.json"), "utf8"));
ok(pkg.name === "dsh-flash-sh" && /^0\.1\.\d+$/.test(pkg.version), "包名/版本 dsh-flash-sh@0.1.x", pkg.version);
ok(pkg.dsh?.bundle?.patch === "./cordis.patch.yml", "dsh.bundle.patch");
ok(JSON.stringify(pkg.dsh?.bundle?.platforms) === '["win32"]', "dsh.bundle.platforms = [win32]（DSH 启动器按 process.platform 准入）");
ok(JSON.stringify(pkg.os) === '["win32"]' && JSON.stringify(pkg.cpu) === '["x64"]', "npm os/cpu = win32/x64（作为 presets 的可选依赖时，非 Windows x64 上 pnpm/npm 跳过、不下载 exe）");
ok(pkg.dependencies === undefined || Object.keys(pkg.dependencies).length === 0, "无运行时依赖（不依赖 zod）");
ok(pkg.peerDependenciesMeta?.["@deepseek-ai/schemastery"]?.optional === true, "schemastery 是可选 peer");
ok(pkg.scripts?.prepare === undefined && pkg.scripts?.postinstall === undefined && pkg.scripts?.install === undefined, "无 install/prepare 脚本（不触发 pnpm allowBuilds）");
for (const f of ["lib", "vendor", "cordis.patch.yml", "README.md", "LICENSE", "NOTICE", "test", "scripts/check-flash-sh.ps1"]) ok(pkg.files.includes(f) && fs.existsSync(path.join(pluginDir, f)), "files 含且存在：" + f);
// scripts 里引用的每个本地文件都在 files 里（npm pack 之后自洽）
for (const [k, v] of Object.entries(pkg.scripts ?? {})) {
  const refs = [...String(v).matchAll(/(?:^|\s)((?:test|scripts|lib)\/[\w./-]+)/g)].map((m) => m[1]);
  for (const r of refs) ok(fs.existsSync(path.join(pluginDir, r)) && pkg.files.some((f) => r === f || r.startsWith(f.replace(/\/$/, "") + "/")), "scripts." + k + " 引用的 " + r + " 存在且随包发布");
}
const src = fs.readFileSync(path.join(pluginDir, "lib", "index.js"), "utf8");
ok(!/from\s+["']zod["']/.test(src) && !/import\(["']zod["']\)/.test(src), "lib 不 import zod");

// ── 补丁行 ──────────────────────────────────────────────────────────────
const patch = fs.readFileSync(path.join(pluginDir, "cordis.patch.yml"), "utf8");
const row = patch.match(/- insert:\n\s+- id: ([\w-]+)\n\s+name: '([^']+)'\n\s+config:\n\s+enabled: (\w+)/);
ok(row !== null, "补丁有 insert 行");
ok(row && row[1] === "flash-sh-standalone", "实例 id = flash-sh-standalone", row && row[1]);
ok(row && row[2] === pkg.name, "name = 包名");
ok(row && row[3] === "false", "默认 enabled: false");
ok(!/!!js/.test(patch), "补丁不含 !!js");
if (inRepo) {
  const presetsPatch = fs.readFileSync(path.join(repoRoot, "cordis.patch.yml"), "utf8");
  const presetIds = [...presetsPatch.matchAll(/^\s+- id: ([\w-]+)/gm)].map((m) => m[1]);
  ok(!presetIds.includes("flash-sh-standalone") && !presetIds.includes("flash-sh"), "dsh-flash-presets 补丁里没有 flash-sh / flash-sh-standalone 行（flash_sh 是 flash-presets 行下的子功能）");
  ok(/flashSh:\n\s+enabled: false/.test(presetsPatch), "dsh-flash-presets 的 flash-presets 行带 flashSh.enabled: false");
  const presetsPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const range = presetsPkg.optionalDependencies?.["dsh-flash-sh"];
  ok(typeof range === "string", "dsh-flash-presets 把 dsh-flash-sh 声明为 optionalDependencies", range);
  const planPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "plugins", "plan-mode-ui", "package.json"), "utf8"));
  ok(JSON.stringify(pkg.engines) === JSON.stringify(planPkg.engines), "engines 与 plan-mode-ui 一致", JSON.stringify(pkg.engines));
  ok(!fs.existsSync(path.join(repoRoot, "lib", "flash-sh.js")), "dsh-flash-presets 的 lib/ 里没有 flash-sh.js 副本（单一来源）");
  const bundleSrc = fs.readFileSync(path.join(repoRoot, "lib", "bundle.js"), "utf8");
  ok(bundleSrc.includes("Symbol.for('dsh-flash-sh/presets-intent@1')") && src.includes('Symbol.for("dsh-flash-sh/presets-intent@1")'), "presets 的 bundle.js 与本包用同一个意向 Symbol（dsh-flash-sh/presets-intent@1）");
}

// ── vendor exe 与 sha256 ────────────────────────────────────────────────
const exe = path.join(pluginDir, "vendor", "win32-x64", "flash-sh.exe");
const shaLine = fs.readFileSync(exe + ".sha256", "utf8").trim();
const digest = crypto.createHash("sha256").update(fs.readFileSync(exe)).digest("hex");
ok(shaLine === digest + "  flash-sh.exe", "vendor exe 与 .sha256 一致", digest);
ok(fs.readFileSync(exe).subarray(0, 2).toString() === "MZ", "exe 是 PE 文件");
const ps1 = fs.readFileSync(path.join(pluginDir, "scripts", "check-flash-sh.ps1"), "utf8");
ok(ps1.includes("$ExpectedSha256 = '" + digest + "'"), "check-flash-sh.ps1 里的期望 sha256 = vendor exe");

// ── Config ──────────────────────────────────────────────────────────────
process.env.DSH_FLASH_SH_NO_SCHEMASTERY = "1";
const mod = await import(pathToFileURL(path.join(pluginDir, "lib", "index.js")).href + "?fallback");
ok(mod.CONFIG_SCHEMA_SOURCE === "fallback", "DSH_FLASH_SH_NO_SCHEMASTERY=1 → 手写 Standard Schema");
const v = mod.Config["~standard"].validate(undefined);
ok(v.value && v.value.enabled === false && v.value.timeoutMs === 120000 && v.value.approval === "sandboxed" && v.value.approvalMemory === "session", "无 config → 默认值", JSON.stringify(v));
ok(mod.validateConfig({ enabled: "yes" }).issues?.length === 1, "enabled 非布尔 → issue");
ok(mod.validateConfig({ timeoutMs: 0 }).issues?.length === 1, "timeoutMs=0 → issue");
ok(mod.validateConfig({ approval: "always" }).issues?.length === 1, "approval 非法 → issue");
ok(mod.validateConfig({ approvalMemory: "forever" }).issues?.length === 1, "approvalMemory 非法 → issue");
ok(mod.validateConfig({ enabled: true, binPath: "C:\\x\\flash-sh.exe" }).value?.binPath === "C:\\x\\flash-sh.exe", "binPath 透传");
ok(mod.validateConfig({ binPath: "" }).issues === undefined && mod.validateConfig({ binPath: "" }).value.binPath === undefined, "binPath 空字符串 = 未设置（不报错）");
ok(mod.validateConfig({ binPath: "   " }).value?.binPath === undefined, "binPath 全空白 = 未设置");
ok(mod.validateConfig({ binPath: 3 }).issues?.length === 1, "binPath 非字符串 → issue");
delete process.env.DSH_FLASH_SH_NO_SCHEMASTERY;
const mod2 = await import(pathToFileURL(path.join(pluginDir, "lib", "index.js")).href + "?schemastery");
if (mod2.CONFIG_SCHEMA_SOURCE === "schemastery") {
  const a = mod.Config["~standard"].validate({ enabled: true });
  const b = mod2.Config["~standard"].validate({ enabled: true });
  ok(JSON.stringify(a.value) === JSON.stringify(b.value), "schemastery 与手写 schema 默认值一致", JSON.stringify(a.value) + " vs " + JSON.stringify(b.value));
  ok(mod2.Config["~standard"].validate({ enabled: "yes" }).issues?.length >= 1, "schemastery 版同样拒绝非布尔");
  const e = mod2.Config["~standard"].validate({ enabled: true, binPath: "" });
  ok(mod2.resolveConfig(e.value ?? {}, {}).binPath === undefined, "schemastery 版：binPath 空字符串经 resolveConfig 视为未设置");
} else {
  console.log("  - 当前环境解析不到 @deepseek-ai/schemastery，跳过一致性比较");
}

const env = (o) => ({ ...o });
ok(mod.resolveConfig({ enabled: false }, env({ DSH_FLASH_SH: "1" })).enabled === true, "DSH_FLASH_SH=1 ＞ config.enabled=false");
ok(mod.resolveConfig({ enabled: true }, env({ DSH_FLASH_SH: "0" })).enabled === false, "DSH_FLASH_SH=0 ＞ config.enabled=true");
ok(mod.resolveConfig({ enabled: true }, env({})).enabled === true, "无环境变量 → config.enabled");
ok(mod.resolveConfig({}, env({})).enabled === false, "都没有 → false");
ok(mod.resolveConfig({}, env({ DSH_FLASH_SH: "yes" })).enabled === false, "DSH_FLASH_SH 只认 0/1");
{
  const r = mod.resolveConfig({ binPath: "/cfg" }, env({ DSH_FLASH_SH_BIN: "/x" }));
  ok(r.binPath === "/x" && r.binSource === "env", "DSH_FLASH_SH_BIN 覆盖 binPath，并记来源（apply 据此打日志）");
  ok(mod.resolveConfig({ binPath: "" }, env({ DSH_FLASH_SH_BIN: "" })).binPath === undefined && mod.resolveConfig({ binPath: "" }, env({})).binSource === "bundled", "空 binPath / 空 DSH_FLASH_SH_BIN 都 = 用内置 exe");
}
ok(mod.decide(mod.resolveConfig({}, env({}))).register === false, "默认不注册");
ok(mod.decide(mod.resolveConfig({ enabled: true }, env({})), "linux", "x64").register === false, "Linux 开了也不注册");
ok(mod.decide(mod.resolveConfig({ enabled: true }, env({})), "win32", "arm64").register === false, "win32-arm64 不注册");
const winDecision = mod.decide(mod.resolveConfig({ enabled: true, binPath: "" }, env({})), "win32", "x64");
ok(winDecision.register === true && winDecision.bin === mod.DEFAULT_BIN && winDecision.custom === false, "win32-x64 + enabled（binPath 空）→ 用包内 vendor exe，非自定义", JSON.stringify(winDecision));
ok(mod.DEFAULT_BIN === exe, "DEFAULT_BIN 指向 vendor/win32-x64/flash-sh.exe", mod.DEFAULT_BIN);
ok(mod.decide(mod.resolveConfig({ enabled: true, allowNonWindows: true, binPath: "" }, env({})), "linux", "x64").register === false, "非 Windows 测试模式：binPath 空 = 没给");
const custom = mod.decide(mod.resolveConfig({ enabled: true, allowNonWindows: true, binPath: process.execPath }, env({})), "linux", "x64");
ok(custom.register === true && custom.custom === true, "binPath 指向非内置 exe → custom=true（apply 打 warn + sha256）");
ok(/^[0-9a-f]{64}$/.test(mod.sha256File(exe)) && mod.sha256File(exe) === digest, "sha256File");

// ── 子进程环境脱敏 ───────────────────────────────────────────────────────
{
  const e = mod.childEnv({ PATH: "/bin", HOME: "/h", Path: "C:\\x", USERPROFILE: "u", OPENAI_API_KEY: "k", db_password: "p", GITHUB_TOKEN: "t", AWS_SECRET_ACCESS_KEY: "s", MyKeyFile: "f", DSH_FLASH_SH: "1", dsh_home: "d", DSH_LLM_API_KEY: "z", NPM_CONFIG_PASSWD: "w", GIT_CREDENTIALS: "c", LANG: "C.UTF-8", TEMP: "/t", SYSTEMROOT: "C:\\Windows" });
  ok(e.PATH === "/bin" && e.HOME === "/h" && e.Path === "C:\\x" && e.USERPROFILE === "u" && e.LANG === "C.UTF-8" && e.TEMP === "/t" && e.SYSTEMROOT === "C:\\Windows", "childEnv 保留 PATH/HOME/Path/USERPROFILE/LANG/TEMP/SYSTEMROOT");
  const stripped = ["OPENAI_API_KEY", "db_password", "GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY", "MyKeyFile", "DSH_FLASH_SH", "dsh_home", "DSH_LLM_API_KEY", "NPM_CONFIG_PASSWD", "GIT_CREDENTIALS"];
  ok(stripped.every((k) => !(k in e)), "childEnv 去掉 *KEY* / *PASSWORD*（不分大小写，db_password 也算）/ *SECRET* / *TOKEN* / *PASSWD* / *CREDENTIAL* / DSH_*", JSON.stringify(Object.keys(e)));
}

// ── 审批框预览 ───────────────────────────────────────────────────────────
{
  const short = "echo " + "a".repeat(1995);
  ok(short.length === 2000 && mod.commandPreview(short) === short, "2000 字以内原样显示");
  const long = "x".repeat(2500);
  const p = mod.commandPreview(long);
  ok(p.startsWith("x".repeat(2000)) && !p.startsWith("x".repeat(2001)) && /500 more characters not shown; 2500 in total/.test(p), "超出 2000 字截断并写明剩余 500 字", p.slice(2000));
  const emoji = "😀".repeat(2001);
  const pe = mod.commandPreview(emoji);
  ok(pe.startsWith("😀".repeat(2000)) && /1 more characters/.test(pe) && !/\uD83D(?![\uDE00-\uDFFF])/.test(pe), "按码点截断，不切断代理对");
}

// ── 审批判定：失败即关闭 ─────────────────────────────────────────────────
ok(mod.needsApproval("sandboxed", undefined) === true, "sandboxed + 拿不到会话模式 → 要审批（失败即关闭）");
ok(mod.needsApproval("read-only", undefined) === true, "read-only + 拿不到会话模式 → 要审批");
ok(mod.needsApproval("off", undefined) === false, "off → 从不");
ok(mod.needsApproval("sandboxed", "workspace-write") === true && mod.needsApproval("sandboxed", "danger-full-access") === false, "sandboxed：非完全访问要审批");
ok(mod.needsApproval("read-only", "read-only") === true && mod.needsApproval("read-only", "workspace-write") === false, "read-only：只读会话才审批");

// ── 命令分类 ─────────────────────────────────────────────────────────────
{
  const W = { cwd: "/w/proj", workspace: "/w/proj", platform: "linux", tmpdir: "/var/tmp-x" };
  const c = (cmd, ctx = W) => mod.classifyCommand(cmd, ctx);
  ok(c("ls -la").cacheable && c("ls -la").key === "ls", "ls → 可记忆，键 ls");
  ok(c("ls").key !== c("ls | head").key && c("ls | head").key === "head+ls [|]", "加管道是不同的键", c("ls | head").key);
  ok(c("echo hi > out.txt").key === "echo [>]" && c("echo hi>out.txt").key === "echo [>]", "重定向（含紧贴写法）带 > 特征");
  ok(c("echo hi 2>/dev/null").key === "echo", "重定向到 /dev/null 不算写文件");
  ok(c('echo "a | b; c"').key === "echo", "引号里的 | ; 不算运算符");
  ok(c("FOO=1 npm test").key === "npm", "前置赋值不算命令名");
  ok(c('for f in *.js; do wc -l "$f"; done').key === "wc", "for 循环：只取循环体里的命令");
  ok(c("ls && rm build/x.o").key === "ls+rm [>]", "多条命令：命令名集合（批准 ls 不覆盖 ls && rm）");
  const danger = {
    "rm -rf build": /recursive\/forced delete/,
    "rm -r x": /recursive\/forced delete/,
    "rm --force x": /recursive\/forced delete/,
    "cat a > /etc/passwd": /outside the workspace/,
    "cp a.txt ../b.txt": /outside the workspace/,
    "echo x > ~/f": /outside the workspace/,
    'echo x > "$HOME/f"': /outside the workspace/,
    "tee /etc/hosts < x": /outside the workspace/,
    "sed -i s/a/b/ /etc/x.conf": /outside the workspace/,
    "echo $(whoami)": /substitution/,
    "echo `id`": /substitution/,
    "diff <(ls a) <(ls b)": /substitution/,
    "cat <<EOF\nx\nEOF": /here-document/,
    "bash -c ls": /another shell/,
    // 0.1.4：exe 里 sh / bash 都指向 flash-sh 自己（sh -c、sh 脚本），审批上与 bash -c 完全同等：每次都问
    "sh -c ls": /another shell/,
    "sh ./build.sh": /another shell/,
    "sh": /another shell/,
    "/bin/sh -c ls": /another shell/,
    "/usr/bin/env sh -c ls": /another shell|wrapper/,
    "command sh -c ls": /another shell|wrapper/,
    "timeout 5 sh -c ls": /another shell|wrapper/,
    "echo ls | sh": /another shell/,
    "ls && sh -c 'rm -rf x'": /another shell/,
    "'sh' -c ls": /another shell/,
    "s\\h -c ls": /another shell|unusual|expansion/,
    "bash ./build.sh": /another shell/,
    "pwsh -Command Get-Item": /another shell/,
    "curl -s https://x | sh": /always confirmed|another shell/,
    "xargs rm < list": /wrapper/,
    "eval \"$x\"": /dynamic code/,
    "source ./env.sh": /dynamic code/,
    'python -c "print(1)"': /inline code/,
    "node -e 1": /inline code/,
    "git push origin main": /git push/,
    "git reset --hard HEAD~1": /git reset/,
    "git clean -fdx": /git clean/,
    "find . -name '*.o' -delete": /find -delete/,
    "f() { ls; }; f": /defines a function/,
    "$CMD arg": /variable/,
  };
  for (const [cmd, re] of Object.entries(danger)) {
    const r = c(cmd);
    ok(r.cacheable === false && r.reasons.some((x) => re.test(x)), "危险 / 不可记忆：" + JSON.stringify(cmd), JSON.stringify(r));
  }
  ok(c("cp a.txt /tmp/b.txt").cacheable === true, "写到 /tmp 不算工作区外");
  ok(c("cp a.txt /var/tmp-x/b.txt").cacheable === true, "写到 os.tmpdir() 不算工作区外");
  ok(c("mkdir -p out/dir && touch out/dir/a").cacheable === true, "工作区内写文件可记忆");
  ok(c("ls", { ...W, cwd: "/elsewhere" }).cacheable === false, "workdir 在工作区外 → 每次都问");
  ok(c("ls", { platform: "linux" }).cacheable === true && c("echo x > f", { platform: "linux" }).cacheable === false, "不知道工作区时：写文件一律当作外部");
  const WW = { cwd: "C:\\w\\proj", workspace: "C:\\w\\proj", platform: "win32", tmpdir: "C:\\Users\\u\\AppData\\Local\\Temp" };
  ok(mod.classifyCommand("echo x > /c/w/proj/out.txt", WW).cacheable === true && mod.classifyCommand("echo x > /c/Windows/x", WW).cacheable === false, "Windows：/c/… 形式按盘符换算后判断");
  ok(mod.classifyCommand("echo x > C:/W/PROJ/sub/o.txt", WW).cacheable === true, "Windows：路径比较不分大小写");
  ok(mod.isOutsideWorkspace("/dev/null", W) === false && mod.isOutsideWorkspace("NUL", { ...WW }) === false, "/dev/null、NUL 不算外部");
}

// ── 会话级记忆 ───────────────────────────────────────────────────────────
{
  const m = new mod.SessionApprovals();
  const s1 = { id: "s1" };
  const s2 = { id: "s2" };
  ok(!m.has(s1, "ls") && m.add(s1, "ls") && m.has(s1, "ls") && !m.has(s2, "ls"), "按会话隔离");
  ok(m.has({ id: "s1" }, "ls"), "同一会话 id 的不同对象视为同一会话");
  const anon = {};
  m.add(anon, "ls");
  ok(m.has(anon, "ls") && !m.has({}, "ls"), "无 id 的会话按对象区分");
  ok(m.add(undefined, "ls") === false && !m.has(undefined, "ls"), "没有会话 → 不记忆");
}

// ── 审批闸（假宿主）────────────────────────────────────────────────────────
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flash-sh-unit-"));
  let asked = [];
  let answer = "allowed-once";
  let mode = "workspace-write";
  let approvalImpl = async (req) => { asked.push(req); return answer; };
  const agent = (id) => ({
    session: { id },
    ctx: {
      get(n) {
        if (n === "sandboxPolicy") return mode === "missing" ? undefined : { resolve: () => (mode === "throws" ? (() => { throw new Error("x"); })() : { mode }) };
        if (n === "approval") return approvalImpl === null ? undefined : { request: (req) => approvalImpl(req) };
        return undefined;
      },
    },
  });
  const cfg = mod.resolveConfig({ enabled: true }, {});
  const where = { cwd: tmp, workspace: tmp };
  const run = (cmd, a, c = cfg, memory) => mod.gate({}, c, { agent: a, callId: "x", signal: new AbortController().signal }, cmd, where, memory);
  const mem = new mod.SessionApprovals();
  const A = agent("sA");

  let r = await run("ls", A, cfg, mem);
  ok(asked.length === 1 && r.asked === true && r.remembered === "ls", "第一次 ls：弹审批，批准后记住");
  ok(/Approving also allows commands of the same kind \(ls\)/.test(asked[0].reason) && asked[0].toolName === "flash_sh", "审批理由写明会话内记忆的范围", asked[0].reason);
  r = await run("ls -la", A, cfg, mem);
  ok(asked.length === 1 && r.asked === false, "同会话同类命令：不再问");
  r = await run("ls | head", A, cfg, mem);
  ok(asked.length === 2, "加了管道：要再问");
  await run("ls", agent("sB"), cfg, mem);
  ok(asked.length === 3, "另一个会话：要再问");
  await run("rm -rf build", A, cfg, mem);
  await run("rm -rf build", A, cfg, mem);
  ok(asked.length === 5 && /confirmed every time: recursive\/forced delete/.test(asked[4].reason), "危险命令：每次都问，理由里写明原因", asked[4] && asked[4].reason);
  const noMem = mod.resolveConfig({ enabled: true, approvalMemory: "off" }, {});
  const before = asked.length;
  await run("pwd", A, noMem, mem);
  await run("pwd", A, noMem, mem);
  ok(asked.length === before + 2, "approvalMemory=off：每次都问");

  mode = "missing";
  asked = [];
  r = await run("pwd", agent("sC"), cfg, new mod.SessionApprovals());
  ok(asked.length === 1 && /unknown \(could not read the session permission mode\)/.test(asked[0].reason), "拿不到 sandboxPolicy → 仍然请求审批（失败即关闭）");
  mode = "throws";
  await run("pwd", agent("sD"), cfg, new mod.SessionApprovals());
  ok(asked.length === 2, "sandboxPolicy.resolve 抛错 → 仍然请求审批");

  mode = "workspace-write";
  approvalImpl = async () => { throw new Error("ui exploded"); };
  let threw = "";
  try { await run("pwd", agent("sE"), cfg, new mod.SessionApprovals()); } catch (error) { threw = error.message; }
  ok(/approval request failed \(ui exploded\)/.test(threw), "审批调用本身出错 → 拒绝执行", threw);
  for (const outcome of ["rejected", "cancelled", "unavailable", undefined, "allowed-always"]) {
    approvalImpl = async () => outcome;
    threw = "";
    try { await run("pwd", agent("sF"), cfg, new mod.SessionApprovals()); } catch (error) { threw = error.message; }
    ok(/not run — approval/.test(threw), "审批结果 " + String(outcome) + " → 不执行（只有 allowed-once 放行）", threw);
  }
  approvalImpl = null;
  threw = "";
  try { await run("pwd", agent("sG"), cfg, new mod.SessionApprovals()); } catch (error) { threw = error.message; }
  ok(/no approval channel/.test(threw), "没有审批服务 → 拒绝执行", threw);
  threw = "";
  try { await mod.gate({}, cfg, {}, "pwd", where, new mod.SessionApprovals()); } catch (error) { threw = error.message; }
  ok(/no approval channel/.test(threw), "没有 agent（拿不到会话）→ 拒绝执行", threw);
  r = await mod.gate({}, mod.resolveConfig({ enabled: true, approval: "off" }, {}), {}, "pwd", where, new mod.SessionApprovals());
  ok(r.asked === false, "approval=off → 不问也不拦");
  mode = "danger-full-access";
  approvalImpl = async () => { throw new Error("should not be called"); };
  r = await run("rm -rf x", agent("sH"), cfg, new mod.SessionApprovals());
  ok(r.asked === false, "完全访问会话（sandboxed 档）→ 不弹审批");
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── 输出捕获：头尾 + UTF-8 边界 + 溢出到磁盘 ───────────────────────────────
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flash-sh-spilltest-"));
  mod._resetSpill({ dir: root });
  const cap = new mod.Capture(100, "stdout");
  const big = Buffer.from("头".repeat(200) + "尾巴END"); // 3 字节字符
  for (let i = 0; i < big.length; i += 7) cap.push(big.subarray(i, i + 7));
  cap.finish();
  const t = cap.text();
  ok(cap.truncated === true && !t.includes("\uFFFD"), "按 UTF-8 字符边界截断（无替换字符）", JSON.stringify(t.slice(0, 40)));
  ok(t.startsWith("头") && t.endsWith("尾巴END") && /…\[\d+ bytes omitted\]…/.test(t), "保留头和尾，中间写明省略字节数", t);
  const kept = Buffer.byteLength(t.replace(/\n…\[\d+ bytes omitted\]…\n/, ""));
  ok(kept <= 100, "头尾合计不超过 maxOutputBytes（" + kept + "）");
  ok(cap.file && fs.readFileSync(cap.file).equals(big), "溢出文件是完整输出", cap.file);
  if (process.platform !== "win32") ok((fs.statSync(cap.file).mode & 0o777) === 0o600, "溢出文件权限 0600", (fs.statSync(cap.file).mode & 0o777).toString(8));
  ok(path.dirname(cap.file) === root, "溢出文件在 spill 目录里");
  const small = new mod.Capture(100, "stderr");
  small.push(Buffer.from("short"));
  small.finish();
  ok(small.text() === "short" && small.file === undefined, "不超限：原样、不落盘");
  // 总量上限
  mod._resetSpill({ dir: root, used: mod.SPILL_TOTAL_CAP - 50 });
  const capped = new mod.Capture(10, "stdout");
  capped.push(Buffer.alloc(200, 0x61));
  capped.finish();
  ok(capped.spillCapped === true && fs.statSync(capped.file).size < 200 && mod.spillUsage().used <= mod.SPILL_TOTAL_CAP, "进程内 spill 总量 ≤ 64 MB，超出时停写并标注");
  mod._resetSpill({ dir: undefined });
  // 内存有界：推 5 MB，尾部缓存不随之增长
  mod._resetSpill({ dir: root });
  const huge = new mod.Capture(1000, "stdout");
  const chunk = Buffer.alloc(65536, 0x62);
  for (let i = 0; i < 80; i++) huge.push(chunk);
  huge.finish();
  const mem = huge.tail.reduce((n, b) => n + b.length, 0) + huge.pre.reduce((n, b) => n + b.length, 0);
  ok(mem <= 1000 + 65536 + 1000, "5 MB 输出时内存里只留头尾（" + mem + " 字节）");
  ok(fs.statSync(huge.file).size === 80 * 65536, "5 MB 全部写进溢出文件");
  mod._resetSpill({ dir: undefined });
  // 清理过期目录
  const old = fs.mkdtempSync(path.join(root, mod.SPILL_PREFIX));
  const fresh = fs.mkdtempSync(path.join(root, mod.SPILL_PREFIX));
  const other = fs.mkdtempSync(path.join(root, "unrelated-"));
  const past = (Date.now() - 25 * 3600 * 1000) / 1000;
  fs.utimesSync(old, past, past);
  fs.utimesSync(other, past, past);
  const removed = mod.cleanupStaleSpills(root);
  ok(removed.length === 1 && removed[0] === old && !fs.existsSync(old) && fs.existsSync(fresh) && fs.existsSync(other), "只删 24 小时前的 spill 目录，不碰别的", JSON.stringify(removed));
  fs.rmSync(root, { recursive: true, force: true });
  ok(mod.utf8HeadEnd(Buffer.from("a€"), 2) === 1 && mod.utf8TailStart(Buffer.from("€a"), 1) === 3, "UTF-8 边界辅助函数");
}

// ── 0.1.2 实机报告 P3：宿主进程退出时删掉自己的 spill 目录；removeSpillDir 只删「只装着 spill 日志」的目录 ──
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flash-sh-spill3-"));
  const mk = (name, files) => { const d = path.join(root, name); fs.mkdirSync(d); for (const f of files) fs.writeFileSync(path.join(d, f), "x"); return d; };
  const good = mk(mod.SPILL_PREFIX + "aaa", [crypto.randomBytes(16).toString("hex") + ".stdout.log"]);
  const mixed = mk(mod.SPILL_PREFIX + "bbb", [crypto.randomBytes(16).toString("hex") + ".stderr.log", "notes.txt"]);
  const wrong = mk("other-prefix-ccc", [crypto.randomBytes(16).toString("hex") + ".stdout.log"]);
  ok(mod.removeSpillDir(good) === true && !fs.existsSync(good), "removeSpillDir 删掉只装着 spill 日志的目录");
  ok(mod.removeSpillDir(mixed) === false && fs.existsSync(path.join(mixed, "notes.txt")), "removeSpillDir 不删混进别的文件的目录");
  ok(mod.removeSpillDir(wrong) === false && fs.existsSync(wrong), "removeSpillDir 不删别的前缀");
  // 子进程：真的溢出一次（目录建在它自己的 TMPDIR 下），退出后目录应该没了
  const { spawnSync } = await import("node:child_process");
  const childTmp = fs.mkdtempSync(path.join(root, "tmp-"));
  const script = `const m = await import(${JSON.stringify(pathToFileURL(path.join(pluginDir, "lib", "index.js")).href)});
const c = new m.Capture(10, "stdout"); c.push(Buffer.alloc(100, 0x61)); c.finish();
if (!c.file) process.exit(3);
console.log(m.spillUsage().dir);`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TMPDIR: childTmp, TMP: childTmp, TEMP: childTmp }, encoding: "utf8" });
  const dir = (r.stdout || "").trim();
  ok(r.status === 0 && dir.startsWith(childTmp) && !fs.existsSync(dir) && fs.readdirSync(childTmp).length === 0, "宿主进程退出时删掉本进程的 spill 目录（不等 24 小时）", JSON.stringify({ status: r.status, dir, left: fs.existsSync(childTmp) ? fs.readdirSync(childTmp) : null, err: (r.stderr || "").slice(0, 300) }));
  fs.rmSync(root, { recursive: true, force: true });
}

// ── 0.1.2 实机报告 P5：超时按实际毫秒传给 exe（1600 ms → "1.6"，不再取整成 2 s）──
ok(mod.timeoutSeconds(1600) === "1.6" && mod.timeoutSeconds(1200) === "1.2" && mod.timeoutSeconds(120000) === "120" && mod.timeoutSeconds(1) === "0.001", "timeoutMs → --timeout 秒数不取整", [1600, 1200, 120000, 1].map(mod.timeoutSeconds).join(","));

// ── 超时标记：区分真超时与脚本自己 exit 124（用 POSIX 假 exe）─────────────────
if (process.platform !== "win32") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flash-sh-fake-"));
  const fake = path.join(dir, "fake-flash-sh");
  // 参数：--timeout N -c CMD；CMD 里写 "MARK" 时模拟 exe 的超时退出
  fs.writeFileSync(fake, '#!/bin/sh\nshift 2; shift\ncase "$1" in\n  MARK) echo "flash-sh: timed out after 1s, process tree killed" >&2; exit 124;;\n  HANG) exec sleep 30;;\n  ENV) env;;\n  *) eval "$1";;\nesac\n', { mode: 0o755 });
  let r = await mod.runFlashSh(fake, { command: "exit 124", cwd: dir, timeoutMs: 5000, maxOutputBytes: 1000 });
  ok(r.exitCode === 124 && r.timedOut === false, "脚本自己 exit 124 → timedOut=false", JSON.stringify(r));
  r = await mod.runFlashSh(fake, { command: "MARK", cwd: dir, timeoutMs: 5000, maxOutputBytes: 1000 });
  ok(r.exitCode === 124 && r.timedOut === true, "exe 超时标记 + 124 → timedOut=true", JSON.stringify(r));
  const t0 = Date.now();
  r = await mod.runFlashSh(fake, { command: "HANG", cwd: dir, timeoutMs: 1000, maxOutputBytes: 1000, graceMs: 300 });
  ok(r.timedOut === true && /killed by the plugin/.test(r.error ?? "") && Date.now() - t0 < 4000, "exe 没按时退出 → 插件在宽限后硬杀（" + (Date.now() - t0) + "ms）", JSON.stringify(r));
  process.env.SOME_API_KEY = "leak";
  process.env.DSH_SOMETHING = "leak";
  r = await mod.runFlashSh(fake, { command: "ENV", cwd: dir, timeoutMs: 5000, maxOutputBytes: 100000 });
  ok(r.exitCode === 0 && !/SOME_API_KEY|DSH_SOMETHING/.test(r.stdout) && /PATH=/.test(r.stdout), "默认子进程环境经 childEnv 脱敏");
  delete process.env.SOME_API_KEY;
  delete process.env.DSH_SOMETHING;
  fs.rmSync(dir, { recursive: true, force: true });
} else {
  console.log("  - Windows 上跳过 POSIX 假 exe 的超时标记测试（host 自测用真实 exe 覆盖）");
}

// ── 第二轮审计：环境脱敏补充 / spill 命名与清理 / taskkill 参数 / 杀不掉时强行收尾 / workdir 越界 ────────────
{
  const e = mod.childEnv({
    PATH: "/bin", NODE_PATH: "/n", LD_LIBRARY_PATH: "/l", GIT_AUTHOR_NAME: "a", GIT_AUTHOR_EMAIL: "a@x", PWD: "/w", HTTP_PROXY: "http://proxy:8080",
    AWS_REGION: "r", AWS_PROFILE: "p", aws_access_key_id: "k", GITHUB_WORKSPACE: "/g", GITHUB_PAT: "p", GH_ENTERPRISE_TOKEN: "t", NPM_CONFIG_REGISTRY: "https://r", NPM_CONFIG__AUTH: "x",
    "npm_config_//registry.npmjs.org/:_authToken": "t", AZURE_DEVOPS_EXT_PAT: "p", MY_PAT: "p", PAT: "p", DOCKER_AUTH_CONFIG: "{}", X_AUTHORIZATION: "b", SSH_AUTH_SOCK: "/s",
    CI_JOB_JWT: "j", SESSION_COOKIE: "c", DATABASE_URL: "postgres://u:pw@h/db", HTTPS_PROXY: "http://user:pw@proxy:8080",
  });
  const kept = ["PATH", "NODE_PATH", "LD_LIBRARY_PATH", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "PWD", "HTTP_PROXY"];
  ok(kept.every((k) => k in e), "childEnv 保留 *_PATH、GIT_AUTHOR_*、PWD、不带账号密码的代理", JSON.stringify(Object.keys(e)));
  const gone = ["AWS_REGION", "AWS_PROFILE", "aws_access_key_id", "GITHUB_WORKSPACE", "GITHUB_PAT", "GH_ENTERPRISE_TOKEN", "NPM_CONFIG_REGISTRY", "NPM_CONFIG__AUTH", "npm_config_//registry.npmjs.org/:_authToken", "AZURE_DEVOPS_EXT_PAT", "MY_PAT", "PAT", "DOCKER_AUTH_CONFIG", "X_AUTHORIZATION", "SSH_AUTH_SOCK", "CI_JOB_JWT", "SESSION_COOKIE", "DATABASE_URL", "HTTPS_PROXY"];
  ok(gone.every((k) => !(k in e)), "childEnv 去掉 AWS_* / GITHUB_* / GH_* / NPM_CONFIG_*（不分大小写）/ *_PAT / *_AUTH* / JWT / COOKIE / 值里带账号密码的 URL", JSON.stringify(gone.filter((k) => k in e)));
}
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flash-sh-spill2-"));
  mod._resetSpill({ dir: root });
  const names = [];
  for (let i = 0; i < 3; i++) { const c = new mod.Capture(4, "stdout"); c.push(Buffer.from("0123456789")); c.finish(); names.push(path.basename(c.file)); }
  ok(names.every((n) => /^[0-9a-f]{32}\.stdout\.log$/.test(n)) && new Set(names).size === 3, "spill 文件名是 128 位随机数（不含 pid / 时间 / 序号）", names.join(" "));
  mod._resetSpill({ dir: undefined });
  const past = (Date.now() - 25 * 3600 * 1000) / 1000;
  const mine = fs.mkdtempSync(path.join(root, mod.SPILL_PREFIX));
  fs.writeFileSync(path.join(mine, "0".repeat(32) + ".stdout.log"), "x");
  const mixed = fs.mkdtempSync(path.join(root, mod.SPILL_PREFIX));
  fs.writeFileSync(path.join(mixed, "someone-elses.txt"), "keep");
  const nested = fs.mkdtempSync(path.join(root, mod.SPILL_PREFIX));
  fs.mkdirSync(path.join(nested, "sub"));
  const victim = fs.mkdtempSync(path.join(root, "victim-"));
  fs.writeFileSync(path.join(victim, "precious"), "keep");
  let linked = false;
  try { fs.symlinkSync(victim, path.join(root, mod.SPILL_PREFIX + "link"), process.platform === "win32" ? "junction" : "dir"); linked = true; } catch (error) {}
  for (const d of [mine, mixed, nested, victim]) fs.utimesSync(d, past, past);
  const removed = mod.cleanupStaleSpills(root);
  ok(removed.length === 1 && removed[0] === mine && !fs.existsSync(mine), "清理只删「只装着 spill 日志」的过期目录", JSON.stringify(removed));
  ok(fs.existsSync(path.join(mixed, "someone-elses.txt")) && fs.existsSync(path.join(nested, "sub")), "目录里混进别的文件 / 子目录 → 整个跳过，不递归删除");
  ok(fs.existsSync(path.join(victim, "precious")) && (!linked || fs.existsSync(path.join(root, mod.SPILL_PREFIX + "link"))), "名字像 spill 的符号链接 / 联接点不跟进、不删" + (linked ? "" : "（本机建不了链接，只验证了其余部分）"));
  fs.rmSync(root, { recursive: true, force: true });
}
{
  const t = mod.taskkillCommand(4242, { SystemRoot: "C:\\Windows" });
  ok(t.file === "C:\\Windows\\System32\\taskkill.exe" && JSON.stringify(t.args) === '["/PID","4242","/T","/F"]', "taskkill：System32 绝对路径 + /PID <pid> /T /F", JSON.stringify(t));
  ok(mod.taskkillCommand(1, {}).file === "C:\\Windows\\System32\\taskkill.exe" && mod.taskkillCommand(1, { windir: "D:\\Win" }).file === "D:\\Win\\System32\\taskkill.exe", "taskkill：没有 SystemRoot 时用 windir / 默认 C:\\Windows");
}
if (process.platform !== "win32") {
  // 孙进程攥着 stdout 不放：插件杀掉进程组后一定返回，不挂死
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flash-sh-stuck-"));
  const fake = path.join(dir, "fake");
  fs.writeFileSync(fake, '#!/bin/sh\nshift 3\nsleep 30 &\necho started\nwait\n', { mode: 0o755 });
  const t0 = Date.now();
  const r = await mod.runFlashSh(fake, { command: "x", cwd: dir, timeoutMs: 1000, maxOutputBytes: 1000, graceMs: 200, closeDeadlineMs: 500 });
  const ms = Date.now() - t0;
  ok(r.timedOut === true && ms < 4000 && /started/.test(r.stdout), "exe 与它的孙进程都不退：硬杀进程组后 " + ms + " ms 内返回", JSON.stringify(r));
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 300);
  const t1 = Date.now();
  const r2 = await mod.runFlashSh(fake, { command: "x", cwd: dir, timeoutMs: 20000, maxOutputBytes: 1000, signal: ac.signal, closeDeadlineMs: 500 });
  ok(r2.exitCode === 130 || /cancelled/.test(r2.error ?? ""), "取消：杀掉进程组并返回（" + (Date.now() - t1) + " ms）", JSON.stringify(r2));
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const R = (wd, base, ws) => { try { return mod.resolveWorkdir(wd, base, ws, "win32"); } catch (error) { return "ERR:" + error.message; } };
  ok(R("/d/x", "C:\\w", "C:\\w") === "D:\\x", "Windows：workdir /d/x → D:\\x（与 flash-sh、分类器一致）");
  ok(R("sub\\..\\..\\up", "C:\\w\\proj", "C:\\w\\proj") === "C:\\w\\up", "Windows：.. 按词法归一（之后由审批分类器判断在不在工作区）");
  ok(/^ERR:.*network share/.test(R("\\\\evil\\share", "C:\\w", "C:\\w")) && /^ERR:/.test(R("//evil/share/x", "C:\\w", "C:\\w")) && /^ERR:/.test(R("\\\\.\\PhysicalDrive0", "C:\\w", "C:\\w")), "Windows：UNC / \\\\.\\ 设备 workdir 在 stat 之前就拒绝（不触发 SMB 认证）");
  ok(R("\\\\srv\\share\\proj\\sub", "\\\\srv\\share\\proj", "\\\\srv\\share\\proj") === "\\\\srv\\share\\proj\\sub", "工作区本身在网络共享上时，共享内的 workdir 照常");
  ok(mod.resolveWorkdir("../x", "/w/p", "/w/p", "linux") === "/w/x" && mod.resolveWorkdir("", "/w/p", "/w/p", "linux") === "/w/p", "POSIX：相对路径按工作区解析，空 = 工作区");
  const W = { workspace: "C:\\w\\proj", platform: "win32", tmpdir: "C:\\T", followLinks: false };
  ok(mod.classifyCommand("ls", { ...W, cwd: "D:\\w\\proj" }).cacheable === false && mod.classifyCommand("ls", { ...W, cwd: "C:\\w\\proj\\..\\other" }).cacheable === false, "workdir 换盘符 / .. 出工作区 → 每次都问");
  ok(mod.classifyCommand("ls //evil/share", { ...W, cwd: "C:\\w\\proj" }).cacheable === false, "命令参数里有 UNC 路径 → 每次都问（读也会触发 SMB 认证）");
  if (process.platform !== "win32") {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.homedir(), ".flash-sh-wd-"))); // 不放 /tmp：临时目录本身是允许的根
    fs.mkdirSync(path.join(root, "ws"));
    fs.mkdirSync(path.join(root, "out"));
    fs.symlinkSync(path.join(root, "out"), path.join(root, "ws", "esc"));
    const ctx = { workspace: path.join(root, "ws"), platform: process.platform, tmpdir: "/nonexistent" };
    ok(mod.classifyCommand("ls", { ...ctx, cwd: path.join(root, "ws", "esc") }).cacheable === false && mod.classifyCommand("ls", { ...ctx, cwd: path.join(root, "ws") }).cacheable === true, "workdir 是指向工作区外的符号链接 → 每次都问");
    const tmpLinkDir = fs.mkdtempSync(path.join(os.tmpdir(), "flash-sh-tmplink-"));
    fs.symlinkSync(path.join(root, "out"), path.join(tmpLinkDir, "l"));
    ok(mod.classifyCommand("echo x > " + path.join(tmpLinkDir, "l", "f"), { ...ctx, cwd: path.join(root, "ws"), tmpdir: os.tmpdir() }).cacheable === false && mod.classifyCommand("echo x > " + path.join(tmpLinkDir, "f"), { ...ctx, cwd: path.join(root, "ws"), tmpdir: os.tmpdir() }).cacheable === true, "临时目录豁免也按真实路径复核：经 /tmp 里的符号链接写到外面 → 每次都问");
    fs.rmSync(tmpLinkDir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ── 协调器：presets 子功能优先，独立行让位；任一方卸载后另一方接管 ────────────────
{
  const mkRegistry = () => {
    const tools = new Map();
    const listeners = [];
    const reg = {
      tools,
      listeners,
      calls: 0,
      layers: {}, // 与 DSH rc.1/rc.3/rc.5 一致：ToolsService 有实例字段 layers
      get: (n) => tools.get(n),
      register(def) {
        reg.calls += 1;
        if (tools.has(def.name)) throw new Error("duplicate " + def.name);
        tools.set(def.name, def);
        return () => { if (tools.get(def.name) === def) { tools.delete(def.name); for (const l of listeners) l(); } };
      },
    };
    return reg;
  };
  const resetIntent = () => { mod.presetsIntent().state = undefined; mod.presetsIntent().listeners.clear(); };
  const mkCtx = (registry, logs) => {
    const effects = [];
    return {
      effects,
      get: (n) => (n === "tools" ? registry : undefined),
      logger: { info: (_f, l) => logs.push(l), warn: (_f, l) => logs.push(l), error: (_f, l) => logs.push(l) },
      effect(fn) { const d = fn(); effects.push(d); return d; },
      on(ev, fn) { if (ev === "tools/change") registry.listeners.push(fn); },
      dispose() { for (const d of effects.splice(0)) d(); },
    };
  };
  const bin = process.execPath;
  const base = { enabled: true, allowNonWindows: true, binPath: bin };
  const presetsPlugin = mod.createPlugin({ owner: "dsh-flash-presets" });
  const standalonePlugin = mod.default;
  ok(standalonePlugin.name === "dsh-flash-sh" && typeof presetsPlugin.apply === "function" && presetsPlugin.Config === mod.Config, "createPlugin 返回完整插件对象（name / inject / Config / apply）");
  const saved = { ...process.env };
  delete process.env.DSH_FLASH_SH;
  delete process.env.DSH_FLASH_SH_BIN;
  for (const order of ["standalone-first", "presets-first"]) {
    resetIntent();
    const reg = mkRegistry();
    const logs = [];
    const cS = mkCtx(reg, logs);
    const cP = mkCtx(reg, logs);
    if (order === "standalone-first") { standalonePlugin.apply(cS, base); presetsPlugin.apply(cP, base); }
    else { presetsPlugin.apply(cP, base); standalonePlugin.apply(cS, base); }
    const snap = mod.claimsSnapshot().filter((x) => x.active);
    ok(reg.tools.size === 1 && snap.length === 1 && snap[0].owner === "dsh-flash-presets", order + "：只注册一个 flash_sh，归 presets 子功能", JSON.stringify(mod.claimsSnapshot()) + " " + logs.join(" | "));
    ok(logs.some((l) => /provided by dsh-flash-presets.*dsh-flash-sh（flash-sh-standalone 行） skips registering it/.test(l)), order + "：独立行写日志说明让位", logs.join(" | "));
    ok(reg.calls === 1 && !logs.some((l) => /handed over/.test(l)), order + "：启动期间 register 只被调用 1 次（独立行不先注册再交出，没有双注册窗口）", "calls=" + reg.calls + " " + logs.join(" | "));
    cP.dispose();
    const after = mod.claimsSnapshot();
    ok(reg.tools.size === 1 && after.length === 1 && after[0].owner === "dsh-flash-sh" && after[0].active, order + "：presets 那边卸载后独立行接管", JSON.stringify(after));
    cS.dispose();
    ok(reg.tools.size === 0 && mod.claimsSnapshot().length === 0, order + "：都卸载后注册表干净");
  }
  // ── 第二轮审计 T2/T3：入场时机、layers 缺失时的退化、配置矛盾 ──
  {
    // 独立行先到、presets 表态 pending → 独立行一直不注册；presets 子功能到来后只注册它
    resetIntent();
    mod._setDeferTimings({ long: 400, short: 150 });
    const reg = mkRegistry();
    const logs = [];
    mod.setPresetsIntent("pending");
    const cS = mkCtx(reg, logs);
    standalonePlugin.apply(cS, base);
    await new Promise((r) => setTimeout(r, 200));
    ok(reg.calls === 0 && reg.tools.size === 0 && logs.some((l) => /waiting up to 400 ms/.test(l)), "presets 表态 pending：独立行等待（200 ms 内不注册）", logs.join(" | "));
    mod.setPresetsIntent("loading");
    const cP = mkCtx(reg, logs);
    presetsPlugin.apply(cP, { ...base, approval: "off" });
    ok(reg.calls === 1 && mod.claimsSnapshot().find((x) => x.active)?.owner === "dsh-flash-presets", "presets 子功能到来：只注册它一次");
    ok(logs.some((l) => /Its settings differ and are NOT in effect: approval \("sandboxed" here vs "off"\)/.test(l)), "两边配置矛盾：独立行让位时 warn 写明哪些字段不生效", logs.filter((l) => /differ/.test(l)).join(" | "));
    cP.dispose();
    ok(reg.tools.size === 1 && mod.claimsSnapshot().find((x) => x.active)?.owner === "dsh-flash-sh", "presets 卸载后独立行接管");
    cS.dispose();
  }
  {
    // presets 表态 none → 独立行立刻注册
    resetIntent();
    const reg = mkRegistry();
    const logs = [];
    const cS = mkCtx(reg, logs);
    mod.setPresetsIntent("pending");
    standalonePlugin.apply(cS, base);
    ok(reg.calls === 0, "pending 时先不注册");
    mod.setPresetsIntent("none");
    ok(reg.calls === 1 && reg.tools.size === 1, "presets 表态 none → 独立行随即注册");
    cS.dispose();
  }
  {
    // 配置树里看得到同级行、没有 flash-presets → 不等
    resetIntent();
    const reg = mkRegistry();
    const logs = [];
    const cS = mkCtx(reg, logs);
    cS.fiber = { entry: { parent: { data: [{ id: "flash-sh-standalone", name: "dsh-flash-sh" }, { id: "other", name: "x" }] } } };
    standalonePlugin.apply(cS, base);
    ok(reg.calls === 1 && !logs.some((l) => /waiting/.test(l)), "加载器配置里没有 flash-presets 行 → 独立行立即注册");
    cS.dispose();
    const cS2 = mkCtx(reg, logs);
    cS2.fiber = { entry: { parent: { data: [{ id: "flash-presets", name: "dsh-flash-presets", disabled: true }] } } };
    standalonePlugin.apply(cS2, base);
    ok(reg.tools.size === 1, "flash-presets 行被整行关掉（disabled: true）→ 独立行立即注册");
    cS2.dispose();
    ok(mod.presetsRowHint({ fiber: { entry: { parent: { data: [{ id: "flash-presets", name: "dsh-flash-presets" }] } } } }) === "present" && mod.presetsRowHint({}) === "unknown", "presetsRowHint：present / unknown");
  }
  {
    // 什么都不知道：短等后注册；知道 flash-presets 行存在但它一直不表态：长等后注册（warn）
    resetIntent();
    const reg = mkRegistry();
    const logs = [];
    const cS = mkCtx(reg, logs);
    standalonePlugin.apply(cS, base);
    ok(reg.calls === 0, "不知道 presets 在不在：先不注册");
    await new Promise((r) => setTimeout(r, 250));
    ok(reg.calls === 1 && logs.some((l) => /did not report within 150 ms/.test(l)), "短等（150 ms）后独立行注册", logs.join(" | "));
    cS.dispose();
    const cS2 = mkCtx(reg, logs);
    cS2.fiber = { entry: { parent: { data: [{ id: "flash-presets", name: "dsh-flash-presets" }] } } };
    standalonePlugin.apply(cS2, base);
    await new Promise((r) => setTimeout(r, 250));
    ok(reg.tools.size === 0, "flash-presets 行存在：短时限过了仍在等");
    await new Promise((r) => setTimeout(r, 250));
    ok(reg.tools.size === 1, "长时限（400 ms）过了 presets 仍不表态 → 独立行注册");
    cS2.dispose();
    // 等待中被卸载：不注册、定时器清掉
    const cS3 = mkCtx(reg, logs);
    standalonePlugin.apply(cS3, base);
    cS3.dispose();
    await new Promise((r) => setTimeout(r, 250));
    ok(reg.tools.size === 0 && mod.claimsSnapshot().length === 0, "等待中被卸载 → 不注册");
  }
  {
    // ToolsService 没有 layers（DSH 改了内部结构）：两个插件拿到的是不同代理 → 退回进程内共同身份，仍只注册一个、presets 优先
    resetIntent();
    const under = mkRegistry();
    const proxy = () => ({ get: (n) => under.get(n), register: (d) => under.register(d), listeners: under.listeners });
    ok(mod.registryKey(proxy()) === mod.SHARED_REGISTRY_KEY && mod.registryKey(under) === under.layers, "registryKey：有 layers 用 layers；没有就用进程内共同身份（不退回代理本身）");
    const logs = [];
    const cS = mkCtx(proxy(), logs);
    const cP = mkCtx(proxy(), logs);
    mod.setPresetsIntent("none");
    standalonePlugin.apply(cS, base);
    presetsPlugin.apply(cP, base);
    ok(under.tools.size === 1 && mod.claimsSnapshot().filter((x) => x.active).map((x) => x.owner).join() === "dsh-flash-presets" && logs.some((l) => /no 'layers' field/.test(l)), "没有 layers：仍只注册一个，presets 优先，并记日志", JSON.stringify(mod.claimsSnapshot()));
    cP.dispose();
    ok(under.tools.size === 1 && mod.claimsSnapshot()[0]?.owner === "dsh-flash-sh", "没有 layers：presets 卸载后独立行接管");
    cS.dispose();
  }
  mod._setDeferTimings({ long: 15000, short: 3000 });
  resetIntent();
  // 第三方已注册 flash_sh：不抢，等它消失
  {
    const reg = mkRegistry();
    const logs = [];
    const foreignDispose = reg.register({ name: "flash_sh", description: "third-party" });
    const cP = mkCtx(reg, logs);
    presetsPlugin.apply(cP, base);
    ok(reg.tools.get("flash_sh").description === "third-party" && logs.some((l) => /already registered by another plugin/.test(l)), "第三方已有 flash_sh → 不覆盖，记日志");
    foreignDispose();
    ok(reg.tools.get("flash_sh")?.description === mod.DESCRIPTION && logs.some((l) => /took over/.test(l)), "第三方注销后接管");
    cP.dispose();
  }
  // 自定义 exe：warn + sha256；环境变量换 exe：info
  {
    const reg = mkRegistry();
    const logs = [];
    process.env.DSH_FLASH_SH_BIN = bin;
    mod.setPresetsIntent("none");
    const c1 = mkCtx(reg, logs);
    standalonePlugin.apply(c1, { enabled: true, allowNonWindows: true });
    ok(logs.some((l) => /binPath taken from the environment variable DSH_FLASH_SH_BIN/.test(l)), "环境变量换 exe：日志提示");
    ok(logs.some((l) => /non-bundled flash-sh executable: .* sha256=[0-9a-f]{64}/.test(l)), "非内置 exe：warn 并打印 sha256", logs.join(" | "));
    c1.dispose();
    delete process.env.DSH_FLASH_SH_BIN;
  }
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
}

// ── 工具定义 ────────────────────────────────────────────────────────────
const def = mod.toolDefinition({}, mod.resolveConfig({ enabled: true }, env({})), "/nonexistent");
ok(def.name === "flash_sh", "工具名 flash_sh（不占 bash/pwsh/run_code）");
ok(def.parameters.additionalProperties === false && def.parameters.required.includes("command"), "参数 schema：command 必填、无多余字段");
ok(def.timeoutMs === 610000, "宿主侧协作上限 = maxTimeoutMs + 10s");
const types = [];
(function walk(n) {
  if (n && typeof n === "object") {
    if ("type" in n) types.push(n.type);
    for (const x of Object.values(n)) walk(x);
  }
})(mod.OUTPUT_SCHEMA);
ok(types.every((t) => typeof t === "string"), "输出 schema 只用单一 type");
ok(mod.renderResult({ exitCode: 3, stdout: "a\n", stderr: "b\n", timedOut: false, truncated: false }) === "a\n[stderr]\nb\n\n[exit code: 3]", "渲染格式");
ok(/full output: \/x\/o\.log , \/x\/e\.log/.test(mod.renderResult({ exitCode: 0, stdout: "a", stderr: "", timedOut: false, truncated: true, spillPath: "/x/o.log", stderrSpillPath: "/x/e.log" })), "截断时渲染两个溢出文件路径");
ok(mod.DESCRIPTION.length < 1600, "工具描述 " + mod.DESCRIPTION.length + " 字符");

if (failed > 0) {
  console.log("unit 自检：" + failed + " 项失败");
  process.exit(1);
}
console.log("unit 自检：全部通过");
