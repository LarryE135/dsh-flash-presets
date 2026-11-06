<p align="center"><strong>dsh-flash-presets</strong></p>

<p align="center"><a href="README.md">中文</a> | <strong>English</strong></p>

<p align="center">
  <a href="https://github.com/LarryE135/dsh-flash-presets/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/LarryE135/dsh-flash-presets?style=flat-square&color=eab308"></a>
  <a href="https://www.npmjs.com/package/dsh-flash-presets"><img alt="npm" src="https://img.shields.io/npm/v/dsh-flash-presets?style=flat-square&color=cb3837"></a>
  <a href="https://www.npmjs.com/package/dsh-flash-presets"><img alt="npm downloads" src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FLarryE135%2Fdsh-flash-presets%2Fmain%2Fbadges%2Fdownloads.json&style=flat-square"></a>
</p>

# dsh-flash-presets

Agent presets for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH), tuned for DeepSeek V4.1 Flash.

The idea is simple: compact the context earlier, keep only the head and tail of oversized tool output, leave unused tools out of the system prompt, and fold scattered tool calls into a single `run_code` program. None of this makes the model smarter. It changes how much a session reads, how much it wanders, and when it stops.

Everything ships as a DSH bundle (`dsh.bundle`). It inserts preset rows into a profile and touches neither the host code nor the shared tool registry.

> Current version: 0.2.6 (2026-11-06) · presets v3 lite / v3 balance · plan mode plan-mode v1 (1.0.0) · requires DSH `>=0.2.1-rc.5 <0.2.3-0` (hard `engines` gate — the install is refused otherwise), tested on 0.2.1-rc.5 and 0.2.2-rc.1
>
> npm still serves 0.2.5, which cannot start a session on DSH 0.2.2-rc.1. Until 0.2.6 lands there, install from GitHub or from the release archive (see [Install](#install)).

## Who it's for, and who it isn't

**A good fit for**

- Tasks with a clear goal and a way to check the result: changing code, running scripts, cleaning data, producing a file in a fixed format.
- Long sessions. DSH compacts at 80% of the context window by default, which most sessions never reach. These presets compact at 25%, so long sessions stay within bounds.
- Anyone who watches their token bill and would rather not repeat the same instructions in every message.

**Not a good fit for**

- Problems clearly beyond the model, such as competition-level tasks where the goal is partial credit. Standard mode holds up better there; see [Unfavorable results](#unfavorable-results).
- Workflows that rely on the current date, installing plugins from inside a conversation, or scheduled tasks. Those capabilities are trimmed out (see [Differences from the official PTC preset](#differences-from-the-official-ptc-preset)).
- Models other than DeepSeek V4.1 Flash. The rules may still help, but nobody has checked.
- DSH 0.2.0 and earlier. Use the matching older release instead (see [versions and compatibility](docs/版本与兼容性.md), in Chinese). The directory-style presets for DSH before 0.1.7 are no longer shipped as of 0.2.6.

## What it does

Four mechanisms, each acting at a different point in a session:

| Mechanism | When it acts | Setting | Effect |
|---|---|---|---|
| Turn compaction | When the stored context grows too large | `thresholdRatio: 0.25`, `retainTokens: 20000` (DSH default: 0.8) | History is replaced by a summary; only long sessions trigger it |
| Tool-output trimming | When a tool result enters the context | first 4096 / last 1024 characters | Oversized output keeps only its two ends |
| Disabled plugins | When the system prompt is assembled | 6 plugins set to `disabled: true` | Their tool schemas never reach the prompt — a fixed saving |
| Behavioral rules | At every step the model takes | persona rules (13 in lite, 3 in balance) | Nudges the model to read less, batch calls, and edit incrementally |

Two more things come with the bundle:

- Tools are presented through PTC (`tool-presentation: ptc`), and the PTC runtime stays resident for the whole session (`ptc-runtime: persistent-in-memory`). Measured: the fixed startup cost per program dropped from 108 ms to 0, and nested tool calls from 44 ms to 15 ms ([benchmark notes](https://github.com/LarryE135/dsh-flash-presets/blob/main/docs/压测-run_code开销.md), in Chinese). The gain grows linearly with the number of calls inside a program; a short task that runs a single command will barely notice.
- The plugin marks `glob` and `grep` as safe to run concurrently, so several searches in the same turn can execute in parallel (web and desktop profiles only; see [Known limitations](#known-limitations)).

For the reasoning behind each setting, with source line references, see the [four mechanisms write-up](docs/技术文档-省token四机制.md) (Chinese).

## The two presets

| Preset | id | Rules | Compaction | Use it when |
|---|---|---:|---|---|
| 轻量PTC-v3 lite | `flash-lean-ptc-v3-lite` | 13 | 0.25 / 20k | Default. Covers most day-to-day work |
| 轻量PTC-v3 balance | `flash-lean-ptc-v3-balance` | 3 | 0.25 / 20k | Fewer rules, more room for the model to work its own way |

Both share the same compaction, trimming, plugin set, and PTC setup. Only the persona rules differ.

Lite's 13 rules fall into five groups: budget (count turns, not steps; aim for 20 or fewer, and stop to re-plan past roughly 60), sequencing (think briefly, run one cheap probe, and for submission tasks ship the smallest working artifact first), verification (one consolidated acceptance pass, then deliver — no extra random or stress rounds), tools and output (read files with read/glob/grep, batch calls, edit incrementally), and scope (answer in the user's language, stay in scope, keep secrets out of the session, switch approach after two failures).

Balance keeps only the three rules the harness can't enforce on its own: respect the user's language and scope, never put secrets into the session, and after two failed attempts change approach and report the exact command and output.

Does the number of rules matter? We tested 0, 3, 7, and 13 rules on three task sets (n = 5–15) and found no measurable difference in either quality or tokens ([measured evidence](docs/实测证据.md), "三床 × 四臂"). At that sample size, differences smaller than about 2× are undetectable, so the honest reading is "no difference observed", not "no difference". The savings come mainly from the first three mechanisms above and from PTC, not from the wording of the rules.

> A naming note for the evidence files: in the 2026-11-04 experiments, "v3" means the 13-rule preset (today's lite) and "lite" means the 3-rule preset (today's balance). The rename happened in 0.2.6.

## Measurements

Every number below comes with its conditions and sample size. The experiments use different setups, so don't compare across tables.

### Office benchmark

Two synthetic suites of everyday office data-processing tasks: [Office benchmark v1](https://github.com/LarryE135/dsh-flash-presets/tree/main/benchmarks/office/base-v1) (8 tasks) and [Office addendum v1](https://github.com/LarryE135/dsh-flash-presets/tree/main/benchmarks/office/addendum-v1) (5 tasks). The table shows the mean tokens per configuration, including cache reads, in millions. OPS refers to [dsh-ops](https://github.com/T-Auto/dsh-ops).

<!-- bench-table:begin（本块由 scripts/render-bench-table.mjs 生成，勿手改）-->
| Setup | Office benchmark v1 | vs standard | Office addendum v1 | vs standard |
|---|---:|---:|---:|---:|
| Standard mode | 5.380 M(n=5) | — | 2.827 M(n=5) | — |
| OPS + standard | 4.693 M(n=5) | −12.8% | 2.141 M(n=5) | −24.3% |
| PTC mode | 3.553 M(n=5) | −34.0% | 1.560 M(n=5) | −44.8% |
| OPS + PTC | 3.499 M(n=4) | −35.0% | 1.404 M(n=5) | −50.3% |
| lean-v3 | 1.437 M(n=5) | −73.3% | 0.481 M(n=5) | −83.0% |
<!-- bench-table:end -->

![Average token consumption on the office benchmark and addendum suites (including cache reads)](https://raw.githubusercontent.com/LarryE135/dsh-flash-presets/main/docs/images/bench-office-token.png)

How to read it:

- `lean-v3` is the 13-rule preset as it stood in 0.2.5; its rules are identical to today's lite.
- "vs standard" also includes the gain from switching to PTC tools. To isolate the preset, compare against PTC mode instead: roughly −59.6% and −69.2% on the two suites (computed from the table).
- Tokens only. Every run of every configuration was fully correct, so accuracy isn't broken out. Tasks were written and graded by the same model (`GPT-6.1-Sol`), but the answering stage had no access to the ground truth or the grader.
- `OPS + PTC` has only 4 valid runs on Office benchmark v1. The two suites contain different tasks and are not pooled into one ranking.
- Scoring rules are public in [`benchmarks/office/grading/`](https://github.com/LarryE135/dsh-flash-presets/tree/main/benchmarks/office/grading); ground truth and graders live in a private repository.

### A controlled algorithm run

Luogu P15114 (32 MB memory limit), DSH headless + PTC, n = 2:

| Preset | Billed (M) | Steps | Wall clock (s) | Correct |
|---|---:|---:|---:|---|
| Standard | 7.03 | 66.5 | 719 | 2/2 |
| v3 (today's lite) | 4.64 | 39.5 | 759 | 2/2 |

With every run correct, v3 billed about 66% of standard, at a slightly longer wall-clock time. Two runs per arm show a direction, not a statistically significant result.

### Unfavorable results

These are as much a part of the presets as the savings — they mark where not to use them.

- **Vague acceptance criteria hurt.** On P15654 with the original problem statement, v3 scored full marks in only one of three runs; both failures hit the 4 s time limit (4.00 s and 4.01 s). Standard mode scored full marks in both of its runs. Once the statement required a re-runnable verification log that must pass in full, v3 went three for three.
- **On problems beyond the model, standard mode is the better deal.** USACO 2026 Platinum, two rounds combined: standard mode scored 51.5/80 on 51.4M tokens; the lean PTC preset scored 47.5/80 on 48.0M — about 7% cheaper and about 8% lower. These numbers come from the 0.2.0-era preset (before v3), are recorded in the [0.2.0 README](https://github.com/LarryE135/dsh-flash-presets/blob/main/docs/README-0.2.0.md), and have not been re-run with v3.
- **More rules don't fix correctness.** Two candidates, v4 (an acceptance gate) and v4-b (a budget brake), left quality unchanged item for item across four experiments. v4 used 117% more tokens; v4-b's apparent savings vanished in a 3 × 8-task re-run. Both were rejected.
- **Asking the model to assess difficulty and question the user first didn't help.** In a controlled comparison, that path scored a median ratio of 1.05–1.06 against 1.02 for simply starting (lower is better). The presets therefore contain no self-assessment step and don't ask questions before starting.

Full data, withdrawn claims, and reproduction commands are in [measured evidence](docs/实测证据.md) (Chinese).

## How it relates to dsh-ops

They work at different layers and can be installed side by side.

- [dsh-ops](https://github.com/T-Auto/dsh-ops) works at the **tool layer**: it adds a set of ops tools and replaces or hides some official ones, so each call returns less.
- dsh-flash-presets works at the **preset layer**: compaction thresholds, output trimming, which plugins load, and the rules the model follows.

The office benchmark includes `OPS + standard` and `OPS + PTC`, but OPS combined with these presets hasn't been measured yet, so we make no claim about stacking them.

## Install

### With the plugin manager (recommended)

The plugin manager installs the whole plugin card: both presets, the plan-mode component, the resident PTC runtime, and the legacy-id compatibility layer.

```console
# 0.2.6 from GitHub, pinned to the tag (use this until npm catches up)
dsh plugin --profile web add github:LarryE135/dsh-flash-presets#v0.2.6
```

> The 0.2.5 build on npm cannot start a new session on DSH 0.2.2-rc.1 (#19), so please don't install it. Once 0.2.6 is on npm, this line becomes `dsh-flash-presets@0.2.6`.

`--profile` is normally `web` or `desktop` (presets do not activate under `headless` / `acp` — see [Known deviations](#known-deviations)). Entering the package name or GitHub address under Plugins → Add plugin in the GUI does the same thing.

Presets directly shape agent behavior, so pin a version when you need reproducible results. Without one, the manager records a caret range, and any later pnpm operation may move you to the newest 0.2.x.

### Offline, or with the install script

Download and unpack the archive from [Releases](https://github.com/LarryE135/dsh-flash-presets/releases), or clone the tag:

```bash
git clone --depth 1 -b v0.2.6 https://github.com/LarryE135/dsh-flash-presets.git
cd dsh-flash-presets
bash scripts/install.sh --profile web                  # Windows: scripts\install.ps1 -Profile web
```

The script writes a single managed block containing the two preset rows into the profile patch. It backs up the file first, and re-running it never creates a second block. The plan-mode component, the legacy-id layer, and the composition self-check are part of the plugin itself and only load when installed through the plugin manager. With `--with-plan-mode` (`-WithPlanMode` in PowerShell), the script also writes the resident PTC runtime setting into the profile.

### Restart after installing

Presets and runtime settings are read once, at process start.

- `web` profile: reload the page.
- `desktop`, `headless`, `acp`: quit the host completely and start it again. The classic symptom of skipping this is "the plugin is installed, but the `run_code` speedup isn't there".

### Check the installation

```bash
dsh --profile web --dump-config | grep -c 'id: preset-'             # 6 (4 built-in + 2 from this package, with no other preset packages)
dsh --profile web --dump-config | grep -c 'persistent-in-memory'    # 1
dsh --profile web --dump-config | grep -c 'plan-mode-ui'            # 1
node scripts/doctor.mjs --profile web                                # version, duplicate rows, !!js, YAML parsing in one pass
```

### Update and uninstall

To update, run the same `add` again, or `remove` and then `add`.

To uninstall:

```console
dsh plugin --profile web remove dsh-flash-presets     # if installed with the plugin manager
bash scripts/install.sh --uninstall --profile web     # if installed with the script (Windows: scripts\install.ps1 -Uninstall)
```

pnpm leaves one line for this package in the profile's `pnpm-workspace.yaml`, and `remove` doesn't clear it. It has no effect on the composed configuration.

### Upgrading from 0.2.5

- Preset ids changed: the 13-rule preset moved from `flash-lean-ptc-v3` to `flash-lean-ptc-v3-lite`, and the former 3-rule `flash-lean-ptc-v3-lite` is now `flash-lean-ptc-v3-balance`.
- Old sessions still open. A runtime compatibility layer resolves 12 historical ids (including `flash-lean-ptc-v3` and `-v2`) to lite. It steps in only when resolution fails and never rewrites a session file. The mapping is in [`presets/legacy-preset-map.json`](presets/legacy-preset-map.json); the design is described in [preset id contract and upgrades](docs/预设-id-契约与升级.md) (Chinese).
- If you installed the standalone `dsh-plan-mode-ui` package, run `dsh plugin remove dsh-plan-mode-ui` first, or plan mode will be injected twice.
- If the profile's `selectedDefault` still points at an old id, new sessions fail with `Unknown agent preset`. Set it to `flash-lean-ptc-v3-lite`.

## Plan mode (optional component)

The same plugin card carries a plan-mode component, plan-mode v1 (1.0.0). Within a single turn, the agent writes a plan, waits for your approval, then executes it, and writes the measured acceptance results back to the card at the end. The two halves divide the work cleanly: the presets govern how each turn spends its budget; plan mode makes the turn think before it acts.

- The control sits to the left of the input box, with off / light / full levels independent of the preset.
- Light is the recommended default. In a comparison with n = 3 and 7 acceptance checks, both levels passed 3/3; full used about 26% more tokens and about 33% more time ([changelog](docs/CHANGELOG.md), Chinese).
- If you don't want it, switch the component off on the card. The presets behave exactly the same without it.

## Getting the most out of it

- **State the goal and how success is checked.** The sharper the criteria, the better the result; when the boundaries are fuzzy, pair it with plan or goal mode. The P15654 example above shows how large the difference can be.
- **Raise the output limit.** 120K or more is recommended, 384K if you can, so long reasoning isn't cut off.
- **On Windows**, install PowerShell 7 (the MSI build) or Git Bash first.
- **Give long-thinking models one problem per session.** Handed several at once, a model may lay out every plan in a single response and get cut off upstream before it ever acts ([measured evidence](docs/实测证据.md), "跨模型").

## Troubleshooting

Run the checkup before guessing:

```bash
node scripts/doctor.mjs --profile web          # add --dump to also run dsh --dump-config
node scripts/diag-preset-load.mjs --profile desktop   # when a preset card in the GUI shows "failed to load"
```

| Symptom | Cause | Fix |
|---|---|---|
| A preset card shows "failed to load" | A plugin the preset references can't be resolved. Most often a hand-edited preset still lists `.../dsh-tool-subagent-control/list-agents`, a subpath DSH 0.2.2-rc.1 removed | Locate it with `diag-preset-load.mjs` and delete that row |
| The compact / plan / goal slash commands disappear, and the next message fails with `tool executor is unavailable` | A plugin hot reload released the preset composition of an open session and didn't remount it | Restart DSH. The plugin checks every 2 minutes and logs the remedy; set `DSH_FLASH_PRESETS_SELFCHECK_HEAL=1` to remount automatically |
| Two or three presets with the same name | Bare rows from an old install sit next to the new managed block | Re-run the install script; it adopts and merges the old rows |
| `js-yaml` reports `unknown tag` | The file still contains `!!js` tags | `node scripts/doctor.mjs --fix` (back up first) |
| The presets don't appear at all | DSH is older than 0.1.7, or the wrong profile was targeted | Upgrade DSH, or point `--profile` at the right one |

The preset patch only defines the agent-side plugin set. It doesn't touch GUI pieces such as the workspace picker, the directory picker, or the terminal. If something unrelated to presets breaks after installing, please open an [issue](https://github.com/LarryE135/dsh-flash-presets/issues) with the doctor output and the browser console errors.

## Differences from the official PTC preset

| In the official preset, not here | What it means |
|---|---|
| `time-context` | The prompt carries no current date or time; state it yourself when a task needs it |
| `tool-schedule` | No tool for scheduled or recurring tasks |
| `tool-plugin-market` | No installing plugins from inside a conversation; use `dsh plugin` |

The presets also declare `tool-subagent-codex`, `tool-subagent-claude-code`, `workflow-ptc`, `tool-workflow`, `tool-ralph`, and the plugin-manager tools, all disabled. If you need any of these, the official preset is the easier choice.

## Known limitations

- Under the headless profile on DSH 0.2.2-rc.1, both presets and plan mode stay pending and never take effect (each run reports `3 entries did not activate`). Use the web or desktop profile.
- macOS hasn't been verified on real hardware. The install script is written for bash 3.2 and runs in CI on all three platforms.
- The patch contains `!!js` tags that the DSH loader resolves; third-party YAML parsers report an unknown tag. The install script resolves them to plain values before writing to the profile.
- Development and testing centered on the public Luogu problem set and the office benchmark above. Other kinds of work have little data behind them.

## Development and checks

```console
npm run verify          # composition, YAML, preset structure, text lint, version consistency, benchmark leak guard, and more
npm run bench:office    # structure and integrity checks for the office benchmark (repo only; the npm package excludes benchmarks/)
bash scripts/selftest.sh
```

`cordis.patch.yml` is composed from `presets/*.patch.yml`; don't edit it by hand — CI asserts the two match. The measurement table in this README is generated from `docs/bench-office-results.json`. See [CONTRIBUTING](https://github.com/LarryE135/dsh-flash-presets/blob/main/CONTRIBUTING.md) for how to contribute.

## Version history

### v0.2.6 (2026-11-06)

- Two presets remain: lite (13 rules, default) and balance (3 rules). v1, v2, and the experimental variants are no longer shipped.
- Plan mode moved back into the main package as the third component on the same card (plan-mode v1).
- New runtime compatibility layer: 12 historical preset ids resolve to lite without rewriting session files.
- New composition self-check, a four-layer alignment audit (`npm run audit:align`), and read-only concurrency marks for `glob` / `grep`.
- Fixed: preset cards showed "failed to load" after DSH 0.2.2-rc.1 removed the `list-agents` subpath.

Earlier releases: 0.2.5 installed only v3 by default; 0.2.2 made the package installable from npm; 0.2.1 made v3 the main preset; 0.2.0 introduced the bundle format; 0.1.0 was the first release. Details are in the [changelog](docs/CHANGELOG.md) (Chinese) and on the [Releases](https://github.com/LarryE135/dsh-flash-presets/releases) page.

## Documentation (Chinese)

- [Measured evidence](docs/实测证据.md): every experiment, including the conclusions that didn't hold
- [Versions and compatibility](docs/版本与兼容性.md): version mapping and install regression
- [Preset id contract and upgrades](docs/预设-id-契约与升级.md)
- [The four token-saving mechanisms](docs/技术文档-省token四机制.md), [How the presets are implemented](docs/技术文档-精简预设实现.md)
- [Changelog](docs/CHANGELOG.md)

## License

[MIT](LICENSE)

## Maintainer

<table>
  <tbody>
    <tr>
      <td align="center" width="150"><a href="https://github.com/LarryE135"><img src="https://github.com/LarryE135.png?size=160" width="96" height="96" alt="LarryE135"></a><br><a href="https://github.com/LarryE135"><b>LarryE135</b></a></td>
    </tr>
  </tbody>
</table>
