#!/usr/bin/env node
// 在没装 pwsh 的机器上对 Windows 安装/发布脚本做静态审查（CI 里三平台都会跑）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const read = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
let failed = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failed++; };

const ps1 = read(path.join(here, 'install.ps1'));
const pub = read(path.join(here, 'publish.ps1'));
check(ps1 !== null, 'scripts/install.ps1 存在');
check(pub !== null, 'scripts/publish.ps1 存在');

// 预设名单必须与 presets/ 实际出货一致
const presetFiles = fs.readdirSync(path.join(repo, 'presets'))
  .filter(f => f.endsWith('.patch.yml')).map(f => f.replace('.patch.yml', '')).sort();
const listMatch = (ps1 || '').match(/\$Presets\s*=\s*@\(([^)]*)\)/);
const listed = listMatch ? listMatch[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).sort() : [];
check(JSON.stringify(listed) === JSON.stringify(presetFiles),
      'install.ps1 预设名单与 presets/ 一致（' + (listed.join(', ') || '未解析到') + '）');

// 自检提示里的 id 必须是最新那个预设
const newest = [...presetFiles].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).pop();
check((ps1 || '').includes('id: preset-' + newest), 'install.ps1 自检 id 指向 ' + newest);

// 旧版目录式：缺失时应跳过而不是抛错
// 注意：不能写成 [^}]*，因为提示文案里的变量占位符自带一个右花括号
check(/-not \(Test-Path \$src\)\)[\s\S]{0,200}?continue/.test(ps1 || ''),
      'install.ps1 的 legacy 分支：缺目录时 continue（不 throw）');

// 卸载 / 重复安装路径仍在
check(/Uninstall-Legacy/.test(ps1 || ''), 'install.ps1 保留 legacy 卸载分支');

// Windows PowerShell 5.1 对无 BOM 的 .ps1 会按系统 ANSI(GBK) 解码 → 中文全乱码
for (const f of ['install.ps1', 'publish.ps1']) {
  const buf = fs.readFileSync(path.join(here, f));
  check(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, f + ' 带 UTF-8 BOM（5.1 中文不乱码）');
}

// 文案：不得再出现已删除的非 PTC 预设名
const stale = ['「Flash 精简（', 'flash-lean.patch.yml', 'flash-lean-ptc.patch.yml'];
const staleHits = stale.filter(x => (ps1 || "").includes(x));
check(staleHits.length === 0, 'install.ps1 未宣传已删除的预设' + (staleHits.length ? '（发现 ' + staleHits.join(', ') + '）' : ''));

// publish.ps1：tag 不得硬编码，且必须有不存在的守卫
const hardcoded = /\$Tag\s*=\s*'v1\./.test(pub || '');
check(!hardcoded, 'publish.ps1 未硬编码 1.x 标签');
check(/当前版本：/.test(pub || ''), 'publish.ps1 从 README 解析版本');
check(/git rev-parse -q --verify/.test(pub || '') && /throw/.test(pub || ''),
      'publish.ps1 对不存在的标签会报错退出');

// 行尾规范：shell/node 走 LF；.ps1 由 .gitattributes 钉成 CRLF 检出（BOM 见上）
const ga = read(path.join(repo, '.gitattributes')) || '';
check(/\*\.sh[^\n]*eol=lf/.test(ga), '.gitattributes 仍把 *.sh 钉为 LF');
check(/\*\.ps1[^\n]*eol=crlf/.test(ga), '.gitattributes 仍把 *.ps1 钉为 CRLF（Windows 检出）');

// 两个安装器的完成文案必须逐字提到同一批预设（防单侧漂移）
const sh = read(path.join(here, 'install.sh')) || '';
const shNames = (sh.match(/Flash 精简·PTC v[0-9]+/g) || []);
const psNames = ((ps1 || '').match(/Flash 精简·PTC v[0-9]+/g) || []);
const uniq = a => [...new Set(a)].sort();
check(uniq(shNames).length > 0 && JSON.stringify(uniq(shNames)) === JSON.stringify(uniq(psNames)),
      '两个安装器的完成文案一致（' + (uniq(shNames).join(', ') || '未解析到') + '）');

console.log('\n' + (failed ? 'check-ps1：' + failed + ' 项未通过。' : 'check-ps1：全部通过（pwsh 侧仅静态审查）'));
process.exit(failed ? 1 : 0);