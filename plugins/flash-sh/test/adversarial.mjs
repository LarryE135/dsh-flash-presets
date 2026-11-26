#!/usr/bin/env node
// 审批白名单对抗用例（2026-11-24 第二轮审计）：每条都必须「每次都问」(cacheable=false)，
// 或者至少归不到已经批准过的那一类（key 不在 APPROVED 里）。外加一组良性写法，防止误伤到会话记忆形同虚设。
// 用法：node test/adversarial.mjs [lib/index.js 的路径，默认本包]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.DSH_FLASH_SH_NO_SCHEMASTERY = "1";
const target = process.argv[2] ? path.resolve(process.argv[2]) : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "index.js");
const mod = await import(pathToFileURL(target).href);
// 放在家目录下而不是 /tmp：/tmp 与 os.tmpdir() 是允许写的临时目录，放在那里会让「写到工作区外」的用例失去意义
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.homedir(), ".flash-sh-adv-")));
const ws = path.join(root, "ws");
fs.mkdirSync(path.join(ws, "sub"), { recursive: true });
fs.mkdirSync(path.join(root, "outside"));
let linkOk = true;
try { fs.symlinkSync(path.join(root, "outside"), path.join(ws, "link"), process.platform === "win32" ? "junction" : "dir"); } catch (error) { linkOk = false; }
// tmpdir 指向不存在的目录：本测试的临时目录本身在 os.tmpdir() 下，不能让「临时目录豁免」把它们都放过
const L = { cwd: ws, workspace: ws, platform: process.platform === "win32" ? "win32" : "linux", tmpdir: path.join(root, "no-such-tmp") };
const W = { cwd: "C:\\w\\proj", workspace: "C:\\w\\proj", platform: "win32", tmpdir: "C:\\Users\\u\\AppData\\Local\\Temp", followLinks: false };
// 用户此前用无害写法批准过的类
const APPROVED = new Set(["ls", "echo", "cat", "rm [>]", "cp [>]", "mv [>]", "git", "python3", "python", "perl", "ruby", "node", "awk", "sed", "cd+ls", "chmod [>]", "ln [>]", "tar [>]", "sort", "uniq", "touch [>]", "echo [>]", "ls [>]", "npm", "make", "find", "tee [>]", "head+ls [|]", "cat+python [|]", "echo+python [|]", "cd+echo [>]", "cd+touch [>]", "zip [>]", "unzip [>]"]);
const cases = [
  // 0.1.4：exe 内 sh / bash 都是 flash-sh 自己。sh 的各种写法与 bash -c 同等：每次都问
  ["sh -c 'rm -rf ~'", L, "sh -c"],
  ["s''h -c 'rm -rf ~'", L, "空引号拆开 sh"],
  ["\\sh -c ls", L, "反斜杠转义 sh"],
  ["\"sh\" ./x.sh", L, "引号包 sh 跑脚本"],
  ["exec sh -c ls", L, "exec sh"],
  ["builtin command sh -c ls", L, "builtin command sh"],
  ["printf 'rm -rf ~' | sh", L, "管道喂给 sh"],
  ["sh < evil.sh", L, "sh 从重定向读脚本"],
  ["S=sh; $S -c ls", L, "变量里的 sh"],
  ["ls; sh -s < x", L, "sh -s"],
  // 换一种写法混过去
  ["alias ls='rm -rf ~'; ls", L, "别名"],
  ["r\\m -rf build", L, "反斜杠拆命令名"],
  ["'rm' -rf build", L, "引号包命令名"],
  ["r''m -rf build", L, "空引号拆开"],
  ["command rm -rf build", L, "command rm"],
  ["builtin echo x; rm -rf /", L, "builtin + 拼接"],
  ["env rm -rf build", L, "env rm"],
  ["exec rm -rf build", L, "exec"],
  ["rm${IFS}-rf${IFS}build", L, "$IFS"],
  ["c=rm; $c -rf build", L, "变量藏命令"],
  ["ls() { rm -rf ~; }; ls", L, "函数覆盖"],
  ["function ls { rm -rf ~; }; ls", L, "function 关键字覆盖"],
  ["ls; rm -rf ~", L, "; 拼接"],
  ["ls && rm -rf ~", L, "&& 拼接"],
  ["ls\nrm -rf ~", L, "换行拼接"],
  ["(rm -rf ~)", L, "子 shell"],
  ["{ rm -rf ~; }", L, "{ } 分组"],
  ["{rm,-rf,build}", L, "花括号展开拼出命令"],
  ["PATH=/tmp/evil ls", L, "前置 PATH 劫持"],
  ["PATH=/tmp/evil; ls", L, "单独赋值 PATH 再调用"],
  ["export PATH=/tmp/evil:$PATH; ls", L, "export PATH"],
  ["LD_PRELOAD=/tmp/x.so ls", L, "LD_PRELOAD"],
  ["coproc rm -rf build", L, "coproc"],
  ["$'\\x72\\x6d' -rf build", L, "ANSI-C 引号"],
  // 重定向的变体
  ["echo x >| /etc/passwd", L, ">|"],
  ["echo x >> /etc/passwd", L, ">>"],
  ["echo x 1> /etc/passwd", L, "1>"],
  ["echo x &> /etc/passwd", L, "&>"],
  ["echo x >& important.txt", L, ">& 文件（不能归进纯 echo 这一类）", "echo"],
  ["ls | tee /etc/passwd", L, "tee 到外面"],
  ["dd if=/dev/zero of=/etc/x", L, "dd of="],
  ["echo x > /c/Windows/win.ini", W, "写到 /c/"],
  ["echo x > 'C:\\Windows\\win.ini'", W, "写到 C:\\"],
  ["echo x > D:/data/x", W, "写到别的盘"],
  ["echo x > //evil/share/x", W, "写到 UNC"],
  ["echo x > COM1", W, "写到设备名"],
  ["echo x > ../x", L, ".."],
  ["echo x > ~/.bashrc", L, "~"],
  ...(linkOk ? [["echo x > link/f", L, "经工作区里的符号链接写到外面"]] : []),
  ["cd .. && echo x > f", L, "先 cd 出去再写相对路径"],
  ["cd /etc && touch f", L, "cd 到绝对路径再写"],
  ["cp a .*/x", L, "glob 可能匹配 .."],
  ["cp a {/etc/x,b}", L, "花括号展开写目标"],
  // 绝对路径和大小写
  ["/usr/bin/rm -rf build", L, "绝对路径 rm"],
  ["RM.exe -rf build", W, "大小写 + .exe"],
  ["'C:\\Windows\\System32\\cmd.exe' /c del x", W, "cmd.exe 全路径"],
  ["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -c x", W, "未加引号的 Windows 全路径 powershell"],
  // 内联代码
  ["perl -e 'unlink q(/etc/x)'", L, "perl -e"],
  ["perl -pe 's/a/b/' f", L, "perl -pe（组合短选项）"],
  ["perl -M'POSIX;system(q(id))' x.pl", L, "perl -M 注入"],
  ["ruby -e 'File.delete(\"x\")'", L, "ruby -e"],
  ["node -pe 'require(\"fs\").rmSync(\"/\",{recursive:true})'", L, "node -pe"],
  ["powershell -c Remove-Item -Recurse C:\\", W, "powershell -c"],
  ["cmd /c rd /s /q C:\\", W, "cmd /c"],
  ["echo 'import os; os.system(\"rm -rf ~\")' | python3", L, "代码从管道喂给解释器"],
  ["awk 'BEGIN{system(\"rm -rf ~\")}'", L, "awk system()"],
  ["awk '{print > \"/etc/x\"}' f", L, "awk 写文件"],
  ["sed 's/x/y/e' f", L, "sed e 标志"],
  ["sed -n 'w /etc/x' f", L, "sed w 命令"],
  // 文件操作
  ["git -C x clean -fdx", L, "git -C x clean"],
  ["git -c core.pager='rm -rf ~' log", L, "git -c 注入"],
  ["git -C /etc init", L, "git -C 到外面"],
  ["git config alias.st '!rm -rf ~'", L, "git config 写别名"],
  ["git checkout .", L, "git checkout . 丢改动"],
  ["mv a /etc/passwd", L, "mv 覆盖到外面"],
  ["mv /etc/passwd ./p", L, "mv 把外面的文件搬走（源也是写）"],
  ["cp a /etc/passwd", L, "cp 覆盖到外面"],
  ["cp --target-directory=/etc a", L, "cp --target-directory="],
  ["chmod 777 f", L, "chmod"],
  ["chmod -R 777 .", L, "chmod -R"],
  ["ln -s /etc ./etc2", L, "ln -s"],
  ["tar xf a.tar -C /", L, "tar -C 解到外面"],
  ["sort -o /etc/x f", L, "sort -o"],
  ["uniq f /etc/x", L, "uniq 第二个参数是输出"],
  ["find . -fprint /etc/x", L, "find -fprint"],
  ["npx rimraf /", L, "npx 下载并运行"],
  ["make -C /etc", L, "make -C 到外面"],
];
let bad = 0;
for (const [cmd, ctx, label, onlyNot] of cases) {
  const r = mod.classifyCommand(cmd, ctx);
  const pass = !r.cacheable || (onlyNot !== undefined ? r.key !== onlyNot : !APPROVED.has(r.key));
  if (!pass) bad += 1;
  console.log((pass ? "  ✓ " : "  ✖ ") + label + "  " + JSON.stringify(cmd).slice(0, 70) + "  → " + (r.cacheable ? "可记忆 key=" + r.key : "每次都问：" + r.reasons[0]));
}
const benign = [["ls -la", "ls"], ["cat a | head", "cat+head [|]"], ["git status", "git"], ["python3 manage.py test", "python3"], ["npm test", "npm"], ["echo hi > out.txt", "echo [>]"], ["mkdir -p out && touch out/a", "mkdir+touch [>]"], ["cd sub && ls", "cd+ls"], ["[ -f x ] && echo y", "[+echo"], ["grep -rn foo src", "grep"], ["awk '{print $1}' f", "awk"], ["sed 's/a/b/g' f", "sed"], ["cp a.txt b.txt", "cp [>]"], ["git add -u", "git"], ["sort f | uniq -c", "sort+uniq [|]"]];
let fp = 0;
for (const [cmd, key] of benign) {
  const r = mod.classifyCommand(cmd, L);
  const pass = r.cacheable && r.key === key;
  if (!pass) fp += 1;
  console.log((pass ? "  ✓ " : "  ✖ ") + "良性 " + JSON.stringify(cmd) + "  → " + (r.cacheable ? "key=" + r.key : "每次都问：" + r.reasons.join("; ")));
}
fs.rmSync(root, { recursive: true, force: true });
console.log("对抗用例 " + cases.length + " 条：" + (cases.length - bad) + " 通过 / " + bad + " 失败；良性 " + benign.length + " 条：" + (benign.length - fp) + " 通过 / " + fp + " 误伤" + (linkOk ? "" : "（本机建不了符号链接，跳过 1 条）"));
process.exit(bad + fp ? 1 : 0);
