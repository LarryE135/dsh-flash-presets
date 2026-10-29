// 截图 + 量化自检（直接解码 PNG，不依赖页面 readback）。用法: node shot.mjs <index.html> <out.png>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import puppeteer from 'puppeteer-core';

function decodePNG(buf) {
  let pos = 8, w = 0, h = 0, bd = 0, ct = 0, idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bd !== 8 || (ct !== 6 && ct !== 2)) throw new Error('unsupported png: bd=' + bd + ' ct=' + ct);
  const ch = ct === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[p++];
    for (let x = 0; x < stride; x++) {
      const rawV = raw[p++];
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? out[(y - 1) * stride + x - ch] : 0;
      let v;
      if (ft === 0) v = rawV; else if (ft === 1) v = rawV + a; else if (ft === 2) v = rawV + b;
      else if (ft === 3) v = rawV + ((a + b) >> 1);
      else { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v = rawV + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

const html = path.resolve(process.argv[2] || 'index.html');
const out = path.resolve(process.argv[3] || 'shot.png');
const dir = fs.readdirSync(process.env.HOME + '/.cache/puppeteer/chrome')[0];
const exe = path.join(process.env.HOME, '.cache/puppeteer/chrome', dir, 'chrome-linux64', 'chrome');
const browser = await puppeteer.launch({
  executablePath: exe, headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--hide-scrollbars'],
  defaultViewport: { width: 900, height: 560 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
await page.goto('file://' + html, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 4000));
const shot = await page.screenshot({ path: out });
const diag = await page.evaluate(() => {
  const out = {};
  for (const k of Object.keys(window)) {
    if (!/^__/.test(k)) continue;
    const v = window[k];
    if (!v || typeof v !== 'object' || typeof v.then === 'function') continue;
    for (const f of Object.keys(v)) { const q = v[f]; if (typeof q === 'number' && isFinite(q)) out[k + '.' + f] = Math.round(q * 1e3) / 1e3; }
  }
  return out;
});
await browser.close();

const { w, h, ch, data } = decodePNG(Buffer.from(shot));
let n = 0, s = 0, s2 = 0, pink = 0, white = 0;
for (let i = 0; i < data.length; i += ch) {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  s += L; s2 += L * L; n++;
  if (r > 150 && b > 120 && r > g + 30) pink++;
  if (r > 250 && g > 250 && b > 250) white++;
}
const mean = s / n;
console.log(JSON.stringify({
  size: w + 'x' + h,
  pinkPct: +(100 * pink / n).toFixed(2),
  whitePct: +(100 * white / n).toFixed(2),
  meanLum: +mean.toFixed(1),
  rmsContrast: +Math.sqrt(Math.max(0, s2 / n - mean * mean)).toFixed(1),
  consoleErrors: errs.slice(0, 3),
  diag,
}));
process.exit(0);
