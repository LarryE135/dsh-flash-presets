#!/usr/bin/env python3
"""可选补丁：把 dsh-compaction-tool-result-pruner 的"中段裁切"改成"中段落盘 + marker 带路径"。

默认**不启用、不改任何东西**（只打印状态）。因为还没验证它对既有行为零影响，
它只是"想用的人显式打开"的可选项，不属于 lean-v3 的默认组成。

  python3 scripts/apply-pruner-spill.py              # 只看状态（默认，安全）
  python3 scripts/apply-pruner-spill.py --enable     # 启用（复制 profile 副本并打补丁）
  python3 scripts/apply-pruner-spill.py --revert     # 回滚（删掉 profile 副本，回落到全局原版）
  python3 scripts/apply-pruner-spill.py --profile web  # 只处理某个 profile

原理：不动 /usr/lib/node_modules 里的全局安装（root 所有），只在
~/.dsh/profiles/<profile>/node_modules 放一份打过补丁的副本；Node 解析优先用 profile 副本。
回滚 = 删掉那份副本，重启进程即回到原版行为。
已知触发面很窄：read 返回结构化块（按 0 字符计）、bash 已被自身 8 KB 上限先截，
实际只在 web_fetch / 子代理长文本这类纯文本结果上生效。
"""
import argparse, pathlib, shutil

PKG = "dsh-compaction-tool-result-pruner"
GLOBAL = pathlib.Path("/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai") / PKG

IMPORT_OLD = 'import { Service } from "@deepseek-ai/cordis";'
IMPORT_NEW = '''import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Service } from "@deepseek-ai/cordis";'''

MARKER_OLD = 'const PRUNE_MARKER = "\\n\\n[... tool result middle pruned ...]\\n\\n";'
HELPER = MARKER_OLD + '''
/** 本地补丁：把被裁掉的中段落盘，marker 里给出路径。
 *  没这一步，模型只能靠"重跑命令/重新读取"把中段找回来，每次都是一个完整 step。
 *  落盘失败时退回原 marker（补丁绝不把工具结果搞坏）。 */
function spillPrunedMiddle(text) {
	try {
		if (typeof text !== "string" || text.length === 0) return null;
		const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== ""
			? process.env.DSH_HOME : path.join(os.homedir(), ".dsh");
		const dir = path.join(home, "spill", "pruned");
		fs.mkdirSync(dir, { recursive: true });
		const name = new Date().toISOString().replace(/[:.]/g, "-") + "-" + Math.random().toString(36).slice(2, 8) + ".txt";
		const file = path.join(dir, name);
		fs.writeFileSync(file, text, "utf8");
		return file;
	} catch { return null; }
}'''

BODY_OLD = """		const removedStart = this.config.headChars;
		const removedEnd = totalChars - this.config.tailChars;
		const pruned = [];
		let consumed = 0;
		let markerInserted = false;"""
BODY_NEW = """		const removedStart = this.config.headChars;
		const removedEnd = totalChars - this.config.tailChars;
		// 先拼出"将被裁掉的中段"，落盘后再决定 marker 文案（路径写进 marker）
		let removedText = "";
		{
			let cursor = 0;
			for (const block of blocks) {
				if (block.type !== "text") continue;
				const points = Array.from(block.text);
				const blockStart = cursor;
				const blockEnd = blockStart + points.length;
				const headEnd = Math.min(points.length, Math.max(0, removedStart - blockStart));
				const tailStart = Math.min(points.length, Math.max(0, removedEnd - blockStart));
				if (blockStart < removedEnd && blockEnd > removedStart) {
					removedText += points.slice(headEnd, Math.max(headEnd, tailStart)).join("");
				}
				cursor = blockEnd;
			}
		}
		const spillPath = spillPrunedMiddle(removedText);
		const markerText = spillPath === null || codePointLength(removedText) <= 0
			? PRUNE_MARKER
			: `\\n\\n[... ${codePointLength(removedText)} chars pruned; full output: ${spillPath} ]\\n\\n`;
		const effectiveMarker = codePointLength(markerText) >= codePointLength(removedText) ? PRUNE_MARKER : markerText;
		const pruned = [];
		let consumed = 0;
		let markerInserted = false;"""

MARKER_USE_OLD = 'blockEnd > removedStart && !markerInserted ? PRUNE_MARKER : "";'
MARKER_USE_NEW = 'blockEnd > removedStart && !markerInserted ? effectiveMarker : "";'

def target(profile: str) -> pathlib.Path:
    return pathlib.Path.home() / ".dsh" / "profiles" / profile / "node_modules" / "@deepseek-ai" / PKG


def status(profile: str) -> bool:
    f = target(profile) / "lib" / "index.js"
    if not f.exists():
        print(f"· {profile}: 未启用（解析到全局原版）")
        return False
    patched = "spillPrunedMiddle" in f.read_text(encoding="utf-8")
    print(f"{'✓' if patched else '!'} {profile}: profile 副本存在，{'已打补丁' if patched else '但没打上补丁'}")
    return patched


def enable(profile: str) -> None:
    dst = target(profile)
    if not dst.exists():
        if not GLOBAL.exists():
            print(f"✖ {profile}: 全局原版不存在，跳过")
            return
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(GLOBAL, dst)
        print(f"· {profile}: 已从全局复制副本")
    f = dst / "lib" / "index.js"
    s = f.read_text(encoding="utf-8")
    if "spillPrunedMiddle" in s:
        print(f"✓ {profile}: 已启用（补丁已存在）")
        return
    for old, new in ((IMPORT_OLD, IMPORT_NEW), (MARKER_OLD, HELPER), (BODY_OLD, BODY_NEW), (MARKER_USE_OLD, MARKER_USE_NEW)):
        if old not in s:
            raise SystemExit(f"✖ {profile}: 锚点不匹配，未改动：{old[:60]!r}")
        s = s.replace(old, new, 1)
    f.write_text(s, encoding="utf-8")
    print(f"✓ {profile}: 已启用（补丁已应用，重启进程生效）")


def revert(profile: str) -> None:
    dst = target(profile)
    if not dst.exists():
        print(f"· {profile}: 本来就没启用")
        return
    shutil.rmtree(dst)
    print(f"✓ {profile}: 已回滚（profile 副本已删除，重启进程后回到原版行为）")


ap = argparse.ArgumentParser(add_help=True)
ap.add_argument("--enable", action="store_true")
ap.add_argument("--revert", action="store_true")
ap.add_argument("--profile", action="append", default=None)
a = ap.parse_args()
profiles = a.profile or ["web", "headless"]
if a.enable and a.revert:
    raise SystemExit("--enable 与 --revert 不能同时使用")
for p in profiles:
    if a.enable:
        enable(p)
    elif a.revert:
        revert(p)
    else:
        status(p)
