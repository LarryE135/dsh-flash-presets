#!/usr/bin/env node
/**
 * Structural check of the installed presets — dependency-free.
 *
 *   node scripts/verify-presets.mjs
 *   DSH_HOME=/tmp/dsh node scripts/verify-presets.mjs
 *
 * Exit code 0 = every check passed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), '.agent-presets');
const EXPECT = {
  'flash-lean':     { rules: 11, ptc: false },
  'flash-lean-ptc': { rules: 14, ptc: true },
};

let failed = 0;
const check = (cond, msg) => {
  console.log((cond ? '  ✓ ' : '  ✖ ') + msg);
  if (!cond) failed++;
};
const read = p => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);

console.log('预设目录: ' + root);
for (const [name, exp] of Object.entries(EXPECT)) {
  console.log('\n[' + name + ']');
  const dir = path.join(root, name);
  const presetYml = read(path.join(dir, 'preset.yml'));
  const compose = read(path.join(dir, 'agent.cordis.yml'));
  check(presetYml !== null, 'preset.yml 存在');
  check(compose !== null, 'agent.cordis.yml 存在');
  if (presetYml === null || compose === null) continue;
  check(/^name:\s*\S/m.test(presetYml), 'preset.yml 含 name');
  check(presetYml.length > 60, 'preset.yml 含描述');
  check(/thresholdRatio:\s*0\.3\b/.test(compose), '压缩阈值 thresholdRatio: 0.3');
  check(/retainTokens:\s*50000\b/.test(compose), '保留预算 retainTokens: 50000');
  check(/thresholdChars:\s*8192\b/.test(compose) && /headChars:\s*4096\b/.test(compose)
        && /tailChars:\s*1024\b/.test(compose), '裁剪阈值保持默认 8192/4096/1024');
  check(!/\/home\/|\/Users\/|C:\\\\/.test(compose), '不含本机绝对路径');
  const rules = (compose.match(/^\s{6,}\d+\.\s/gm) || []).length;
  check(rules >= exp.rules, 'persona 规则条数 ' + rules + '（期望 ≥ ' + exp.rules + '）');
  check(/Context discipline/.test(compose), '含「Context discipline」规则');
  check(/Transcript sensitivity/.test(compose), '含「Transcript sensitivity」规则');
  const disabled = id => new RegExp('- id: ' + id + '\\n(?:[^\\n]*\\n)*?\\s*disabled: true').test(compose);
  check(disabled('tool-workflow'), 'tool-workflow 已禁用');
  check(disabled('tool-ralph'), 'tool-ralph 已禁用');
  check(/agent-instructions/.test(compose), '保留 agent-instructions（全局指令仍会注入）');
  check(/mode:\s*ptc/.test(compose) === exp.ptc, 'tool-presentation mode=ptc ' + (exp.ptc ? '在本预设' : '不在本预设'));
}

console.log(failed === 0 ? '\n校验通过：两个预设结构完整。' : '\n校验失败：' + failed + ' 项未通过。');
process.exit(failed === 0 ? 0 : 1);
