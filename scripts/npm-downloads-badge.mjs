#!/usr/bin/env node
// 生成 badges/downloads.json —— 给 shields.io 的 endpoint badge 用。
//
// 为什么不用 shields 的 npm/dm：npm 的「相对时间窗口」端点（last-day/week/month）
// 会整段返回陈旧区间（实测 2026-10 时返回 2026-06-02…07-01），于是刚发布的包永远显示 0/月。
// 这里改查「显式日期区间」，那个接口是准的。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const DAY = 24 * 60 * 60 * 1000;
// 统计窗口：以「昨天」为终点往前 7 个完整自然日（今天的数据还在滚动，不计入）
const end = new Date(Date.now() - DAY);
const start = new Date(end.getTime() - 6 * DAY);
const fmt = (d) => d.toISOString().slice(0, 10);
const url = `https://api.npmjs.org/downloads/point/${fmt(start)}:${fmt(end)}/${encodeURIComponent(pkg.name)}`;

const res = await fetch(url, { headers: { "user-agent": "dsh-flash-presets-badge" } });
if (!res.ok) {
  console.error(`npm downloads API ${res.status} for ${url}`);
  process.exit(1);
}
const data = await res.json();
if (typeof data.downloads !== "number") {
  console.error("unexpected payload:", JSON.stringify(data).slice(0, 200));
  process.exit(1);
}

const n = data.downloads;
const human = n >= 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n);
const badge = {
  schemaVersion: 1,
  label: "downloads",
  message: `${human}/week`,
  color: "cb3837",
  cacheSeconds: 3600,
};

mkdirSync(join(root, "badges"), { recursive: true });
writeFileSync(join(root, "badges", "downloads.json"), JSON.stringify(badge, null, 2) + "\n");
console.log(`${pkg.name}: ${n} downloads in ${fmt(start)}..${fmt(end)} -> ${badge.message}`);
