
import json, glob, sys, os

def txt(b):
    if isinstance(b, str): return b
    if isinstance(b, list): return "".join(x.get("text","") if isinstance(x, dict) else str(x) for x in b)
    if isinstance(b, dict): return b.get("text","")
    return str(b)

def summarize(path):
    d = json.load(open(path))
    b = d["body"]
    sysblocks = b.get("system") or []
    if isinstance(sysblocks, str): sysblocks = [{"text": sysblocks}]
    print("==", os.path.basename(path), "| stream=", b.get("stream"), "| model=", b.get("model"))
    tot = 0
    print("   system blocks: %d" % len(sysblocks))
    for i, s in enumerate(sysblocks):
        t = txt(s)
        cc = "cache" if isinstance(s, dict) and s.get("cache_control") else "     "
        tot += len(t)
        print("   [%02d] %s %6d chars | %s" % (i, cc, len(t), t[:90].replace(chr(10), " ")))
    print("   system total: %d chars (~%d tok)" % (tot, tot//3))
    tools = b.get("tools") or []
    tj = json.dumps(tools, ensure_ascii=False)
    print("   tools: %d 个, %d chars (~%d tok)" % (len(tools), len(tj), len(tj)//3))
    if tools:
        names = [t.get("name") for t in tools]
        print("     names:", ", ".join(names[:24]), ("..." if len(names) > 24 else ""))
    msgs = b.get("messages") or []
    print("   messages: %d" % len(msgs))
    for m in msgs:
        c = m.get("content")
        n = len(json.dumps(c, ensure_ascii=False))
        print("     - %-9s %6d chars | %s" % (m.get("role"), n, json.dumps(c, ensure_ascii=False)[:80].replace(chr(10), " ")))
    extra = {k: (len(json.dumps(v, ensure_ascii=False)) if not isinstance(v, (int,float,bool)) else v) for k, v in b.items() if k not in ("system","messages","tools","model","stream","max_tokens")}
    print("   extra fields:", extra)
    print()

for p in sorted(glob.glob("/tmp/mockllm/*.json")):
    summarize(p)
