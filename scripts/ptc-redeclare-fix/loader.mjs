import { appendFileSync } from 'node:fs';

const TARGET = 'dsh-ptc-runtime-node/lib/process.js';
const LOG = '/tmp/ptc-patch.log';
const A_NEEDLE = 'const program = code.trimStart().startsWith("{") ? `;${code}` : code;';
const B_NEEDLE = 'repl.eval(`${program}\\n`, repl.context, "ptc-repl", (error, value) => {';
const B_CLOSE = '\n\t\t\t\t});';

const A_REPLACE = A_NEEDLE + '\n\t\t\t\tconst __ptcWrap = `;{\n${code}\n}`;';

const B_REPLACE = [
  'const __ptcRun = (prog, retried) => repl.eval(`${prog}\\n`, repl.context, "ptc-repl", (error, value) => {',
  '\t\t\t\t\tif (error && !retried && /already been declared/.test(String(error.message))) {',
  '\t\t\t\t\t\ttry { process.getBuiltinModule("node:fs").appendFileSync("/tmp/ptc-redeclare.log", new Date().toISOString() + " retry\\n"); } catch {}',
  '\t\t\t\t\t\t__ptcRun(__ptcWrap, true);',
  '\t\t\t\t\t\treturn;',
  '\t\t\t\t\t}',
  '\t\t\t\t\tfinish(error ? {',
  '\t\t\t\t\t\tok: false,',
  '\t\t\t\t\t\terror',
  '\t\t\t\t\t} : {',
  '\t\t\t\t\t\tok: true,',
  '\t\t\t\t\t\tvalue',
  '\t\t\t\t\t});',
  '\t\t\t\t});',
  '\t\t\t\t__ptcRun(program, false);',
].join('\n');

export async function load(url, context, next) {
  const result = await next(url, context);
  if (!url.includes(TARGET)) return result;
  const src = String(result.source ?? '');
  if (src.includes('__ptcRun')) return result;
  const a = src.indexOf(A_NEEDLE);
  const bStart = src.indexOf(B_NEEDLE);
  const bEnd = bStart < 0 ? -1 : src.indexOf(B_CLOSE, bStart);
  if (a < 0 || bStart < 0 || bEnd < 0) {
    try { appendFileSync(LOG, `MISS a=${a} b=${bStart} url=${url}\n`); } catch {}
    return result;
  }
  const cut = bEnd + B_CLOSE.length;
  const patched = src.slice(0, a) + A_REPLACE + src.slice(a + A_NEEDLE.length, bStart) + B_REPLACE + src.slice(cut);
  try { appendFileSync(LOG, `PATCHED ${patched.length} ${url}\n`); } catch {}
  return { ...result, source: patched };
}