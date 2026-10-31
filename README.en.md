<p align="center"><strong>dsh-flash-presets</strong></p>

<p align="center"><a href="README.md">中文</a> | <strong>English</strong></p>

<p align="center">
  <a href="https://github.com/LarryE135/dsh-flash-presets/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/LarryE135/dsh-flash-presets?style=flat-square&color=eab308"></a>
  <a href="https://www.npmjs.com/package/dsh-flash-presets"><img alt="npm" src="https://img.shields.io/npm/v/dsh-flash-presets?style=flat-square&color=cb3837"></a>
  <a href="https://www.npmjs.com/package/dsh-flash-presets"><img alt="npm downloads" src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FLarryE135%2Fdsh-flash-presets%2Fmain%2Fbadges%2Fdownloads.json&style=flat-square"></a>
</p>

# dsh-flash-presets

Flash-tier agent presets for the DeepSeek V4.1 Flash route in DSH, shipped as a DSH bundle (`dsh.bundle`). After installation, the bundle inserts several `@deepseek-ai/dsh-agent-preset` rows into a profile. It does not modify host code or the shared tool registry.

The presets control three things: the budget and round limit (counted by rounds, not steps), tool-output folding and trimming, and the criteria used to decide when a task is complete. They do not increase model capability; they determine how many rounds a session uses, when it stops, and how it closes out a task.

> [!IMPORTANT]
> Current version: v0.2.5, the same version on both the GitHub release and npm. The plan-mode plugin is still not published to npm. `v3` (internal name: `lean-v3`) is the current main preset and targets DSH 0.2.1-rc.2 with the v41flash 1017 snapshot.
> 
> Verified: installer regression on three platforms; simulated installation with a temporary `DSH_HOME` (installing through `dsh 0.2.1 --dump-config`, confirming all three presets, idempotent re-installation, and clean removal of dependencies, bundle selection, and patch layers); and bundle composition consistency.
> 
> Not verified: macOS hardware and same-scale comparisons in native mode.
>
> See [measured evidence](docs/实测证据.md) and [Known limitations](#known-limitations) for numbers and failure cases.

## Presets

| Preset | id | order | Rules | Compaction | Intended use |
|---|---|---:|---:|---|---|
| v1 | `flash-lean-ptc-v1` | 21 | 14 | 0.3 / 50k | More context headroom for longer tasks (reference version, not installed by default) |
| v2 | `flash-lean-ptc-v2` | 22 | 12 | 0.25 / 20k | A more conservative, lower-cost preset from the same generation (reference version, not installed by default) |
| v3 | `flash-lean-ptc-v3` | 27 | 13 | 0.25 / 20k | **Installed by default**; currently supported preset |

**Only v3 is installed by default**: neither the npm package nor the installers insert v1/v2 rows any more, so the preset list grows by exactly one entry. For A/B comparisons install all three explicitly with `bash scripts/install.sh --all-presets` or `pwsh scripts/install.ps1 -AllPresets` (the v1/v2 sources still ship with the package). Because model and framework behavior changes over time, v3 is generally the recommended choice; see the release notes for compatibility details.

Compared with v2, v3 mainly changes the verification phase: once the acceptance gate passes, it delivers instead of adding random tests or load-test rounds. This responds to an observed shift in failure modes from wrong answers toward timeouts and single-task overrun.

## Install, update, and uninstall

### npm (recommended)

```console
npm install -g dsh-flash-presets          # Keep one global copy for any profile
dsh plugin --profile web add dsh-flash-presets
```

In the GUI, open **Plugins → Add plugin** and enter `dsh-flash-presets` to get the same result.

> After installation the preset list shows **v3** (`flash-lean-ptc-v3`) only; v1/v2 are reference versions and are not inserted by default.

<img width="413" height="283" alt="Screenshot 2026-10-29 103513" src="https://github.com/user-attachments/assets/3b824c59-7334-4d1f-a8c1-64c0a3a5bb0b" />

Package page: <https://www.npmjs.com/package/dsh-flash-presets>. `dsh plugin add` writes this package into the selected profile's dependencies and loads `cordis.patch.yml`; the preceding `npm install` is only needed when you want an offline copy or want several profiles to share one global installation.

Version strategy: without a version, the manager writes a caret range such as `^0.2.2`, so a later pnpm operation may move it to the newest 0.2.x release. Because presets directly affect agent behavior, pin the version when reproducibility matters:

```console
dsh plugin --profile web add dsh-flash-presets@0.2.5   # Pin a published release
```

### Direct installation from GitHub

```console
dsh plugin --profile web add github:LarryE135/dsh-flash-presets
```

This is useful for an unpublished branch or local changes. The same GitHub spec can be entered through **Plugins → Add plugin**.

`--profile` accepts `web`, `desktop`, `headless`, or `acp`. The manager records this package in the profile's `dsh.profile.bundles` and applies the three insert entries from `cordis.patch.yml` (v1, v2, and v3). The `web` profile uses live reload; the other profiles require a restart.

To update, repeat the same `add` command, or remove and add the package again. To uninstall, remove the package from `dsh.profile.bundles` and the dependency list, then reinstall dependencies. Use `scripts/install.sh --uninstall` to remove the managed block written by the installer.

#### Scripts

```bash
git clone https://github.com/LarryE135/dsh-flash-presets.git
cd dsh-flash-presets
```

Linux / macOS / WSL / Git Bash:

```bash
bash scripts/install.sh                         # DSH 0.1.7+ writes the profile patch; older versions fall back to the directory layout
bash scripts/install.sh --profile desktop       # default is web
bash scripts/install.sh --uninstall
DSH_HOME=/path/to/.dsh bash scripts/install.sh
```

Windows (PowerShell 5.1+ or 7):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install.ps1
.\scripts\install.ps1 -Profile desktop
.\scripts\install.ps1 -Uninstall
.\scripts\install.ps1 -DshHome D:\tmp\.dsh
```

Both installers share `scripts/merge-presets.mjs`: back up `cordis.patch.yml.bak-<timestamp>`, replace the managed block in place, safe to re-run.

## Verification

```console
node scripts/verify-presets.mjs                  # Structure and value assertions
node scripts/verify-yaml.mjs                     # YAML and cross-platform tag checks
node scripts/compose-bundle-patch.mjs --check    # Assert cordis.patch.yml matches presets/*
dsh --profile web --dump-config | grep -A3 'id: preset-flash-lean-ptc-v3'
```

Set `DSH_HOME` or `DSH_PROFILE` to point these checks at a simulated installation.

## Configuration

- `compaction-basic`: v1 uses `thresholdRatio 0.3` and `retainTokens 50000`; v2 and v3 use `0.25` and `20000`. `compactionRetries` is 2 for v1 and 1 for v2/v3.
- `compaction-tool-result-pruner`: `thresholdChars 8192`, `headChars 4096`, and `tailChars 1024`.
- `tool-presentation`: `mode: ptc` with the single `run_code` entry point.
- `tool-workflow`: disabled. Newer DSH releases disable it by default; this package pins it explicitly so an upstream default change cannot silently re-enable it.
- Platform branch: the patch uses `!!js process.platform === 'win32'` to switch between bash and PowerShell. This tag is interpreted by the DSH loader; third-party YAML parsers report it as an unknown tag.

## Behavioral constraints

The v3 persona suffix contains 13 numbered rules in five groups:

1. **Budget (rule 1):** count rounds rather than steps; if a run exceeds roughly 60 rounds, stop and re-plan instead of repeating the same loop.
2. **Start order (rules 2–3):** make one short judgment and run one inexpensive probe before expanding the design; for answer-producing work, create a minimum viable artifact early.
3. **Verification (rule 4):** deliver as soon as the acceptance gate passes; add rounds only for a failed check.
4. **Tools and output (rules 5–9):** use read/glob/grep instead of shell browsing for files; batch independent calls; fold context as needed; control context size; edit incrementally.
5. **Delivery and scope (rules 10–13):** answer in the user's language, stay within scope, never put secrets into the session, change approach after two failures, and adapt strategy to the route and model.

## Measured results

The following results came from batch runs in DSH headless and PTC modes during October 2026, with two to three samples per group.

On P15654 (19 official samples, four-second limit), v3 scored full marks once and failed twice on the original prompt because the runs reached 4.00 s and 4.01 s. When the prompt required a reproducible `verify.log` and a fully passing result, all three runs scored full marks. Total billed usage was 17.5M, below the original prompt's 26.8M; two runs corrected 16/19 and 15/19 in their second round. The standard preset scored full marks in both runs in the Luogu measurement.

On P2099 (submission-answer task with continuous scoring), the standard preset produced ratios of 0.99, 1.09, 1.04, and 1.05. With legality-only judging, v3 produced 1.05 to 1.15, below the standard preset; after changing the criterion to “legal and no more than 1.05” and feeding failed items back into the run, the ratios were 1.05, 1.03, and 0.98, with two corrected in the second round.

See [measured evidence](docs/实测证据.md) for the complete P15114 and controlled-reproduction numbers.

The only cross-scenario conclusion supported by these measurements is that much of the score difference came from whether the acceptance criteria were made explicit; it should not be interpreted as a general increase in model capability.

## Known deviations (vs the official `preset-ptc`)

All three lean presets are trimmed-down versions of the official PTC preset. What we leave out:

| Official has, we do not | Impact | Why |
|---|---|---|
| `time-context` | no date or time in the prompt | saves tokens; tasks that need dates must supply them |
| `tool-schedule` | no scheduled or periodic tools | not needed in the lean surface |
| `tool-plugin-market` | cannot install plugins from chat | use `dsh plugin` instead |

We ship three extras the official preset does not: `tool-subagent-codex`, `tool-subagent-claude-code`, `tool-ralph`.

This is not a defect, but you should know it: if a task depends on the current date or on installing plugins from chat, the official preset is a better fit.

## Compatibility

This repository has been regression-tested against DSH 0.2.1-rc.5 (rc.2 was also tested) using a simulated installation: a temporary `DSH_HOME`, installation, `--dump-config` checks for v1/v2/v3, idempotent re-installation, and clean removal of dependencies, bundle selection, and patch layers. DSH 0.1.7 through 0.2.0 use the same plugin-row mechanism, so the installer logic is unchanged. Before 0.1.7, only v1 has the directory-style fallback under `presets/legacy-0.1.5/`; v2 and v3 are unsupported there. The web profile uses live reload; desktop, headless, and acp require a restart because the provider patch layer is read at startup.

The installer runs in Windows PowerShell, Ubuntu, and macOS CI (see the matrix in `.github/workflows/verify.yml`). macOS hardware has not been tested. The scripts are written for bash 3.2 compatibility; variables followed by non-ASCII text use `${var}`. The `!!js` tag in the patch is interpreted by the DSH loader and is rejected by generic YAML parsers.

## Known limitations

The workflow “ask the model to assess difficulty first, then ask the user” did not help in testing. In the 2026-10-20 comparison, a run with only an acceptance-contract block had a median ratio of 1.05, while a run with the contract plus questions and answers had 1.06; both were worse than the direct-start ratio of 1.02. External grading and feeding failed items back into the next round were effective, so the presets do not include self-assessed difficulty or mandatory pre-start questions.

For measurement convenience, development and testing focused on public Luogu tasks and evaluated token usage, completion time, step count, runtime memory, and elapsed time. Those measurements do not cover every production workload; additional domains may require different presets.

## Troubleshooting: something looks off after installing

Start with one command instead of guessing:

```bash
node scripts/doctor.mjs --profile web      # add --dump to also run dsh --dump-config
```

It answers four things: is the DSH version new enough (plugin-row presets need 0.1.7+), is there exactly one managed block, are there stray legacy rows outside it, and does a standard YAML parser accept the file.

| Symptom | Cause | Fix |
|---|---|---|
| Two or three presets share the same name | legacy bare rows coexist with the new managed block | `node scripts/merge-presets.mjs --patch <path>` claims them automatically |
| `js-yaml` reports `unknown tag tag:yaml.org,2002:js` | `!!js` is still in the file | `node scripts/doctor.mjs --fix` (backs up first) |
| Presets never show up | DSH older than 0.1.7, or the wrong profile | upgrade DSH, or point `--profile` at the right one |

Note: the preset patch only defines the agent-side plugin set (persona + tools + folding chain). It does not touch the workspace picker, the directory selector, or the terminal plugins.

## Notes for people and AI systems

1. Set the output limit to at least 120K when using this package; if available, use 384K to avoid truncation during long reasoning sessions.
2. This package is intended for DeepSeek V4.1 Flash. Other models are not guaranteed to behave the same way.
3. Give the session a clear goal or acceptance criterion. When the boundary is unclear, plan mode or goal mode can help.
4. Desktop and Windows users should consider installing MSI PowerShell 7 or Git Bash. This was itself associated with a noticeable improvement in testing. Ask the maintainer if you need installation help.
5. This package installs preset rows only. It does not ship tools; if the profile lacks the corresponding plugin, these rows have no effect, and the installer does not add missing dependencies.

## Repository layout

```text
presets/
  flash-lean-ptc-v1.patch.yml
  flash-lean-ptc-v2.patch.yml
  flash-lean-ptc-v3.patch.yml     Current main preset (lean-v3)
  legacy-0.1.5/                   Directory-style fallback for DSH before 0.1.7; v1 only
cordis.patch.yml                  Generated from presets/*; do not edit manually
scripts/
  install.sh / install.ps1        Installers, sharing merge-presets.mjs
  merge-presets.mjs               Managed-block insertion and removal
  compose-bundle-patch.mjs        Bundle patch composition
  verify-presets.mjs              Structure and value assertions per preset
  verify-yaml.mjs                 YAML and platform-tag checks
  check-ps1.mjs                   Static PowerShell checks
  check-bash32-cjk.mjs            bash 3.2 multibyte-variable guard
  selftest.sh                     End-to-end self-test
  publish.sh / publish.ps1        Push and create a release; version comes from README
docs/PUBLISHING.md                Maintainer release process (npm, tag, and release cleanup)
docs/                             Documentation and historical README files
plugins/plan-rounds/              Experimental session-level plan-round controller; not published with the npm package
candidates/                       Candidate presets not merged into the main version
marketplace/                      Plugin marketplace submission material
.github/workflows/verify.yml      Three-platform installation matrix and bundle assertions
```

## Version history

### v0.2.5 (2026-10-30)

- **Only v3 is installed by default**: the bundle now composes `presets/flash-lean-ptc-v3.patch.yml` alone, so the preset list grows by exactly one entry; v1/v2 become reference versions installed explicitly with `--all` / `--all-presets` / `-AllPresets`
- Installers: `install.sh` defaults to `PRESETS=(flash-lean-ptc-v3)`; `install.ps1` mirrors it and gains `-AllPresets`; legacy directory installs always use v1
- Verification: `verify-yaml` now asserts the composed bundle contains v3 and no reference versions; `check-ps1` checks the installer list is a subset of `presets/` that includes the newest
- **First npm release**: this package is now published to npm; the plan-mode plugin is still outside the npm release scope

- Installer claims historical leftovers: bare `- id: preset-flash-lean-ptc-vN` rows outside the managed block are removed and folded back in, so reinstalling never duplicates a preset.
- Platform tags are resolved before writing, so no non-standard `!!js` tag lands in the profile; unknown expressions fail loudly instead of being guessed.
- New `scripts/doctor.mjs`: one command checks the DSH version, managed-block count, stray rows, `!!js`, and standard YAML parsing; `--fix` repairs in place (with backup).
- Hardened the verifier (issue #4): v3 now participates in YAML assertions; the generated `cordis.patch.yml` is verified too; installer branches cover v1/v2/v3; missing `js-yaml` exits with code 2 instead of failing open; CRLF profiles no longer produce false installation-layer failures.
- Aligned documentation: v2/v3 compaction comments now match the actual 0.25 / 20000 values; the version table includes 0.2.2–0.2.5; `marketplace/plugin.json` matches the package version.
- Changed `candidates/flash-lean-ptc-v4-plan-accept.patch.yml` to the `- insert:` form. Flat `- id:` entries are silently ignored inside the preset package.
- Added plan mode.

### v0.2.4 (2026-10-24)

- Fixed npm package contents: `presets/legacy-0.1.5/` and `.gitattributes` were previously omitted, so npm installations could not access the old fallback and the bundled `verify-presets.mjs` reported three false failures.

### v0.2.3 (2026-10-24)

- Removed the contradiction between v3 rules 5 and 6, which disabled `head` while requiring `| head -40`; temporary-directory handling now covers PowerShell, cmd, and POSIX shells.
- Added preset-text auditing and runtime composition assertions; CI now includes minimum-permission checks.
- Fixed stale 0.2.3 references, tarball file counts, and repository-structure documentation.

### v0.2.2 (2026-10-21)

- Published `dsh-flash-presets` to npm.
- Fixed two installation-layer false positives in `verify-presets.mjs`: installing only v3 no longer fails because v1/v2 are absent, and preset rows outside the managed block are recognized correctly.
- Added `--repo-only` and `--all` verification modes.
- Added a `prepublishOnly` guard that checks composition, YAML, and repository structure before publishing.

### v0.2.1 (2026-10-20)

- Made v3 (`lean-v3`) the main preset: order 27, 13 rules, compaction 0.25 / 20k.
- Extended installers, composers, and verifiers to support all three presets.
- Reworked `verify-presets.mjs` to verify each preset slice independently.
- Completed simulated-install regression testing against DSH 0.2.1-rc.5 (rc.2 was also tested).

### v0.2.0 (2026-09-30)

- Declared the package as a DSH bundle with a single `cordis.patch.yml`, a composition script, and real CI installation checks.
- Added v2 with step budgeting, fewer exploratory rounds, one combined verification pass, and an early minimum viable artifact.

### v0.1.0 (2026-09-23 to 2026-09-24)

- First release: v1 with compaction 0.3 / 50k, 14 constraints, and the PTC presentation layer.
- Earlier v1.0.0, v1.0.1, and v1.1.0 tags belong to the same generation and are folded into this version. Those tags were removed when the 0.2.5 tags were rewritten; the remote now only carries `v0.1.0` and `v0.2.0`-`v0.2.5`.

## Documentation

[Measured evidence](docs/实测证据.md), [version and compatibility](docs/版本与兼容性.md), [the 0.2.0 historical README](docs/README-0.2.0.md), and the [changelog](docs/CHANGELOG.md).

Implementation notes: [technical reference](docs/技术文档-精简预设实现.md) and [the four token-saving mechanisms](docs/技术文档-省token四机制.md).

Audit records: [full audit](docs/审计-0.2.5-全量.md), [re-check](docs/审计-0.2.5-复检.md), and [earlier audit](docs/审计-0.2.5.md).

## License

[MIT](LICENSE).

## Maintainer

<table>
  <tbody>
    <tr>
      <td align="center" width="150"><a href="https://github.com/LarryE135"><img src="https://github.com/LarryE135.png?size=160" width="96" height="96" alt="LarryE135"></a><br><a href="https://github.com/LarryE135"><b>LarryE135</b></a></td>
    </tr>
  </tbody>
</table>
