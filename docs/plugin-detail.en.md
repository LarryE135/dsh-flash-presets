DeepSeek Harness presets tuned for DeepSeek V4.1 Flash: earlier compaction, trimmed tool output, rarely used tools turned off, and calls folded into run_code. It does not raise the model's ceiling; it spends less budget on tasks the model can already do.

### Two presets

| Preset | id | Rules | When |
| --- | --- | --- | --- |
| Lean PTC v3 (lean-v3) | `flash-lean-ptc-v3` | 13 | Default, for most everyday work |
| Lean PTC v3 balance | `flash-lean-ptc-v3-balance` | 3 | Fewer constraints, when the model needs room |

Pick one in the preset selector of a new session. Both share the same compaction / pruning settings (threshold 25%, retain 20k).

### Runtime component (the "Flash lean presets" row)

Five features hang off this single row. Each starts as soon as the host services it needs are present; a missing service only holds back its own feature:

- **run_code speed-up**: read-only concurrency for glob / grep, persistent PTC runtime. Off: `DSH_FLASH_PRESETS_CONCURRENCY=0`.
- **Plan mode**: the plan button and panel next to the input; settings under Settings → Plan mode. Does not start on hosts without the web server.
- **Legacy sessions**: five historical preset ids map to `flash-lean-ptc-v3`, so old sessions still open. In memory only; session files are not rewritten.
- **Delivery gate** (off by default): when the workspace has `verify.sh` / `verify.ps1`, it runs at the end of a turn and hands failures back to the model.
- **flash_sh** (off by default, Windows x64 only): a Bash-compatible shell tool from the optional dependency `dsh-flash-sh`, not installed on other platforms. It is not sandboxed: outside full-access sessions it asks you, once per kind of command per session, and every time for dangerous commands.

To switch one feature, set `enabled` under `config.planMode` / `toolConcurrency` / `alias` / `deliveryGate` / `flashSh` of `id: flash-presets` in the profile patch. Overrides written against the old row ids (`flash-presets-core` / `plan-mode-ui` / `flash-presets-alias` / `delivery-gate`, up to 0.3.2) still apply. Turning the whole row off also turns off legacy-session support.

Switch examples, measurements and the compatibility table: [GitHub](https://github.com/LarryE135/dsh-flash-presets).
