#!/usr/bin/env bash
# A/B 跑批：同一批题、两臂、逐题交错（同一题的两臂紧邻，减少环境漂移）。
#
# 为什么要有这个脚本：手工跑批踩过两次坑 —— overlay 写成裸行列表被静默忽略、persona 插件
# 挂载报错导致规则从未进 prompt，两次的表现都是"两臂结果一模一样"。所以先做金丝雀：
# 两臂的编号规则条数必须不同、且都能在合成配置里看到，否则立即中止。
#
#   bash scripts/ab-run.sh --treat candidates/x.patch.yml --out /tmp/ab --reps 2
#   （--route 可选：把模型路由指到别处，例如本地 WB Proxy）
#   SCORE_CMD 可选：给每轮交付物打分，模板里用 {deliverables} 占位。
set -uo pipefail
cd "${BASH_SOURCE[0]%/*}/.." || exit 1

TASKS="O01 O02 O03 O04 O05 O06 O07 O08"
REPS=2
BASE="presets/flash-lean-ptc-v3.patch.yml"
TREAT=""
OUT=""
ROUTE=""
PROFILE="headless"
BENCH="benchmarks/office/base-v1"
DSH_BIN="${DSH_BIN:-dsh}"
SCORE_CMD="${SCORE_CMD:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --tasks)   TASKS="${2//,/ }"; shift 2 ;;
    --reps)    REPS="$2"; shift 2 ;;
    --base)    BASE="$2"; shift 2 ;;
    --treat)   TREAT="$2"; shift 2 ;;
    --out)     OUT="$2"; shift 2 ;;
    --route)   ROUTE="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --bench)   BENCH="$2"; shift 2 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

[ -n "$TREAT" ] || { echo "必须给 --treat <候选 patch>" >&2; exit 2; }
[ -n "$OUT" ] || OUT="$(mktemp -d)"
mkdir -p "$OUT/overlays" "$OUT/runs"
: > "$OUT/runs.jsonl"

node scripts/ab-overlay.mjs --from "$BASE"  --out "$OUT/overlays/base.overlay.yml"  || exit 1
node scripts/ab-overlay.mjs --from "$TREAT" --out "$OUT/overlays/treat.overlay.yml" || exit 1

dump_arm() {
  local arm="$1"
  local args=(--profile "$PROFILE")
  [ -n "$ROUTE" ] && args+=(--patch "$ROUTE")
  args+=(--patch "$OUT/overlays/$arm.overlay.yml" --dump-config)
  "$DSH_BIN" "${args[@]}" 2>/dev/null
}

nb=$(dump_arm base  | grep -cE '^\s+[0-9]+\. ' || true)
nt=$(dump_arm treat | grep -cE '^\s+[0-9]+\. ' || true)
echo "金丝雀：base 规则 ${nb} 条，treat 规则 ${nt} 条"
if [ "${nb:-0}" -lt 1 ]; then echo "✖ base 臂没有注入规则，中止" >&2; exit 1; fi
if [ "${nt:-0}" -le "${nb:-0}" ]; then
  echo "✖ treat 臂没有新增规则（${nt} ≤ ${nb}），两臂等价，中止" >&2; exit 1
fi

for rep in $(seq 1 "$REPS"); do
  for task in $TASKS; do
    for arm in base treat; do
      dir="$OUT/runs/$arm/$task/r$rep"
      rm -rf "$dir"; mkdir -p "$dir"
      cp -r "$BENCH/$task/." "$dir/" 2>/dev/null || { echo "✖ 找不到题目 $BENCH/$task" >&2; exit 1; }
      root="$(pwd)"
      (
        cd "$dir" || exit 9
        args=(--profile "$PROFILE")
        [ -n "$ROUTE" ] && args+=(--patch "$ROUTE")
        args+=(--patch "$OUT/overlays/$arm.overlay.yml" --json)
        start=$(date +%s)
        DSH_PERMISSION_MODE=danger-full-access timeout 2400 "$DSH_BIN" "${args[@]}" "$(cat 任务说明.md)" \
          > events.jsonl 2> stderr.txt
        rc=$?
        secs=$(( $(date +%s) - start ))
        read -r tok turns fin <<< "$(node "$root/scripts/ab-usage.mjs" events.jsonl)"
        score=""
        if [ -n "$SCORE_CMD" ] && [ -d deliverables ]; then
          cmd="${SCORE_CMD//\{deliverables\}/$dir/deliverables}"
          cmd="${cmd//\{task\}/$task}"
          score=$(eval "$cmd" 2>/dev/null | tail -1)
        fi
        printf '{"arm":"%s","task":"%s","rep":%s,"exit":%s,"seconds":%s,"tokens":%s,"turns":%s,"final":"%s","score":"%s"}\n' \
          "$arm" "$task" "$rep" "$rc" "$secs" "$tok" "$turns" "$fin" "$score" >> "$OUT/runs.jsonl"
        echo "arm=$arm task=$task rep=$rep exit=$rc ${secs}s tok=$tok turns=$turns score=$score"
      )
    done
  done
done

echo "结果：$OUT/runs.jsonl"
