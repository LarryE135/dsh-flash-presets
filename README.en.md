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
> Current version: v0.2.5 on the `main` branch, **not yet published**. The latest npm release is 0.2.4, published together with plan mode. `v3` (internal name: `lean-v3`) is the current main preset and targets DSH 0.2.1-rc.2 with the v41flash 1017 snapshot.
> 
> Verified: installer regression on three platforms; simulated installation with a temporary `DSH_HOME` (installing through `dsh 0.2.1 --dump-config`, confirming all three presets, idempotent re-installation, and clean removal of dependencies, bundle selection, and patch layers); and bundle composition consistency.
> 
> Not verified: macOS hardware and same-scale comparisons in native mode.
>
> See [measured evidence](docs/实测证据.md) and [Known limitations](#known-limitations) for numbers and failure cases.

## Presets

| Preset | id | order | Rules | Compaction | Intended use |
|---|---|---:|---:|---|---|
| v1 | `flash-lean-ptc-v1` | 21 | 14 | 0.3 / 50k | More context headroom for longer tasks |
| v2 | `flash-lean-ptc-v2` | 22 | 12 | 0.25 / 20k | A more conservative, lower-cost preset from the same generation |
| v3 | `flash-lean-ptc-v3` | 27 | 13 | 0.25 / 20k | Default and currently supported preset |

All three can be installed at the same time and selected from the preset list. Because model and framework behavior changes over time, v3 is generally the recommended choice; see the release notes for compatibility details.

Compared with v2, v3 mainly changes the verification phase: once the acceptance gate passes, it delivers instead of adding random tests or load-test rounds. This responds to an observed shift in failure modes from wrong answers toward timeouts and single-task overrun.

## Install, update, and uninstall

### npm (recommended)

```console
npm install -g dsh-flash-presets          # Keep one global copy for any profile
dsh plugin --profile web add dsh-flash-presets
```

In the GUI, open **Plugins → Add plugin** and enter `dsh-flash-presets` to get the same result.

<img width="413" height="283" alt="Screenshot 2026-10-29 103513" src="https://github.com/user-attachments/assets/3b824c59-7334-4d1f-a8c1-64c0a3a5bb0b" />

Package page: <https://www.npmjs.com/package/dsh-flash-presets>. `dsh plugin add` writes this package into the selected profile's dependencies and loads `cordis.patch.yml`; the preceding `npm install` is only needed when you want an offline copy or want several profiles to share one global installation.

Version strategy: without a version, the manager writes a caret range such as `^0.2.2`, so a later pnpm operation may move it to the newest 0.2.x release. Because presets directly affect agent behavior, pin the version when reproducibility matters:

```console
dsh plugin --profile web add dsh-flash-presets@0.2.4   # Pin a published release
```

### Direct installation from GitHub

```console
dsh plugin --profile web add github:LarryE135/dsh-flash-presets
```

This is useful for an unpublished branch or local changes. The same GitHub spec can be entered through **Plugins → Add plugin**.

`--profile` accepts `web`, `desktop`, `headless`, or `acp`. The manager records this package in the profile's `dsh.profile.bundles` and applies the three insert entries from `cordis.patch.yml` (v1, v2, and v3). The `web` profile uses live reload; the other profiles require a restart.

To update, repeat the same `add` command, or remove and add the package again. To uninstall, remove the package from `dsh.profile.bundles` and the dependency list, then reinstall dependencies. Use `scripts/install.sh --uninstall` to remove the managed block written by the installer.

### Verification

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

## Compatibility

This repository has been regression-tested against DSH 0.2.1-rc.2 using a simulated installation: a temporary `DSH_HOME`, installation, `--dump-config` checks for v1/v2/v3, idempotent re-installation, and clean removal of dependencies, bundle selection, and patch layers. DSH 0.1.7 through 0.2.0 use the same plugin-row mechanism, so the installer logic is unchanged. Before 0.1.7, only v1 has the directory-style fallback under `presets/legacy-0.1.5/`; v2 and v3 are unsupported there. The web profile uses live reload; desktop, headless, and acp require a restart because the provider patch layer is read at startup.

The installer runs in Windows PowerShell, Ubuntu, and macOS CI (see the matrix in `.github/workflows/verify.yml`). macOS hardware has not been tested. The scripts are written for bash 3.2 compatibility; variables followed by non-ASCII text use `${var}`. The `!!js` tag in the patch is interpreted by the DSH loader and is rejected by generic YAML parsers.

## Known limitations

The workflow “ask the model to assess difficulty first, then ask the user” did not help in testing. In the 2026-10-20 comparison, a run with only an acceptance-contract block had a median ratio of 1.05, while a run with the contract plus questions and answers had 1.06; both were worse than the direct-start ratio of 1.02. External grading and feeding failed items back into the next round were effective, so the presets do not include self-assessed difficulty or mandatory pre-start questions.

For measurement convenience, development and testing focused on public Luogu tasks and evaluated token usage, completion time, step count, runtime memory, and elapsed time. Those measurements do not cover every production workload; additional domains may require different presets.

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

### v0.2.5 (release preview)

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
- Completed simulated-install regression testing against DSH 0.2.1-rc.2.

### v0.2.0 (2026-09-30)

- Declared the package as a DSH bundle with a single `cordis.patch.yml`, a composition script, and real CI installation checks.
- Added v2 with step budgeting, fewer exploratory rounds, one combined verification pass, and an early minimum viable artifact.

### v0.1.0 (2026-09-23 to 2026-09-24)

- First release: v1 with compaction 0.3 / 50k, 14 constraints, and the PTC presentation layer.
- Earlier v1.0.0, v1.0.1, and v1.1.0 tags belong to the same generation and are folded into this version; the tags remain available.

## Documentation

[Measured evidence](docs/实测证据.md), [version and compatibility](docs/版本与兼容性.md), [the 0.2.0 historical README](docs/README-0.2.0.md), and the [changelog](docs/CHANGELOG.md).

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
