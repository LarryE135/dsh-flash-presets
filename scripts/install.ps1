# Install the Flash 精简 presets into a DSH home (Windows PowerShell 5.1+).
#
# DSH 0.1.7-rc.1 changed how presets are declared: the old per-preset directory
# ($DshHome\.agent-presets\<id>\) is no longer read; a preset is now a plugin row
# (`@deepseek-ai/dsh-agent-preset`) inserted into a profile's user patch layer.
# This script writes a managed block into the profile patch file, and falls back
# to the legacy directory install for older DSH versions.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install.ps1
#   ... -Profile headless      # another profile
#   ... -Legacy                # force the 0.1.5 directory layout
#   ... -Uninstall             # remove the managed block
#   ... -DshHome "D:\dsh"      # custom DSH home (default: $env:DSH_HOME or ~\.dsh)
#   ... -Help                  # show this help
#
# Safe to run repeatedly: the managed block is replaced in place and the patch
# file is backed up as cordis.patch.yml.bak-<timestamp> before every write.
[CmdletBinding()]
param(
  [string]   $DshHome,
  [string]   $Profile = 'web',
  [string[]] $Presets = @('flash-lean-ptc-v3', 'flash-lean-ptc-v3-max'),
  [switch]   $Help,
  [switch]   $Legacy,
  [switch]   $Uninstall,
  [switch]   $WithPlanMode,
  [switch]   $AllPresets
)

$ErrorActionPreference = 'Stop'

# 0.2.5 起默认只装 v3；-AllPresets 装 v1/v2/v3 三份（A/B 对照用）
if ($AllPresets) { $Presets = @('flash-lean-ptc-v3', 'flash-lean-ptc-v3-max') }

if ($Help) {
  $self = if ($PSCommandPath) { $PSCommandPath } else { $MyInvocation.MyCommand.Path }
  foreach ($line in Get-Content -LiteralPath $self) {
    if ($line -match '^#') { $line -replace '^# ?', '' } else { break }
  }
  exit 0
}

if (-not $DshHome) {
  if ($env:DSH_HOME)        { $DshHome = $env:DSH_HOME }
  elseif ($HOME)            { $DshHome = Join-Path $HOME '.dsh' }
  elseif ($env:USERPROFILE) { $DshHome = Join-Path $env:USERPROFILE '.dsh' }
  else                      { throw '无法确定 DSH 主目录，请用 -DshHome 指定。' }
}

# profile 只能是单层目录名：挡掉 "a/b"、".." 之类，避免把补丁写到预期目录之外
if ([string]::IsNullOrWhiteSpace($Profile) -or $Profile -in @('.', '..') -or
    $Profile.StartsWith('.') -or $Profile -match '[\\/]') {
  throw "非法 profile 名称：${Profile}（只接受单层目录名，如 web / desktop / headless）"
}

$here = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$patch = Join-Path $DshHome "profiles\$Profile\cordis.patch.yml"
$legacyDir = Join-Path $DshHome '.agent-presets'
$merge = Join-Path $here 'scripts\merge-presets.mjs'
$verifyYaml = Join-Path $here 'scripts\verify-yaml.mjs'

# ── 选机制 ────────────────────────────────────────────────────────────────────
if ($Legacy) {
  $mode = 'legacy'
} elseif (Test-Path $patch) {
  $mode = 'modern'
} elseif (Test-Path $legacyDir) {
  $mode = 'legacy'
  Write-Host "未发现 ${patch}，但存在 $legacyDir → 按旧版（DSH < 0.1.7）目录式安装。"
} else {
  throw "找不到 ${patch}（也没有 ${legacyDir}）。请确认 -DshHome 是否正确（当前：${DshHome}）。"
}

function Invoke-Merge([string[]]$ExtraArgs) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw '需要 Node（DSH 本身就依赖它）来改写补丁文件。'
  }
  $only = ($Presets -join ',')
  $argv = @($merge, '--patch', $patch, '--only', $only) + $ExtraArgs
  & node @argv
  if ($LASTEXITCODE -eq 3) { exit 3 }
  if ($LASTEXITCODE -ne 0) { exit 1 }
}

# ── 旧版：目录式 ──────────────────────────────────────────────────────────────
function Install-Legacy {
  foreach ($p in @('flash-lean-ptc-v1')) {
    $src = Join-Path $here "presets\legacy-0.1.5\$p"
    if (-not (Test-Path $src)) {
      Write-Error '0.2.6 起不再提供旧式目录（presets/legacy-0.1.5 已移除）。旧版机制请装 0.2.5；新版机制用：scripts/install.ps1 -Profile <p>'
      exit 3
    }
    $dst = Join-Path $legacyDir $p
    if (Test-Path $dst) {
      Write-Host "已存在 $dst → 备份为 .bak-$stamp"
      Move-Item $dst "$dst.bak-$stamp"
    }
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    Copy-Item (Join-Path $src 'preset.yml') $dst
    Copy-Item (Join-Path $src 'agent.cordis.yml') $dst
    Write-Host "已安装 ${dst}（旧版目录式）"
  }
  Write-Host ''
  Write-Host '安装完成（旧版机制）。重启 DSH 后在预设列表选择「Flash 精简·PTC v1」。'
}

function Uninstall-Legacy {
  foreach ($p in @('flash-lean-ptc-v1')) {
    $dst = Join-Path $legacyDir $p
    if (Test-Path $dst) {
      Move-Item $dst "$dst.removed-$stamp"
      Write-Host "已移走 $dst → .removed-$stamp"
    }
  }
}

# ── 新版：写 profile 补丁层 ───────────────────────────────────────────────────
function Install-Modern {
  if (-not (Test-Path $patch)) { throw "缺少 $patch" }
  Copy-Item $patch "$patch.bak-$stamp"
  Write-Host "已备份 $patch → cordis.patch.yml.bak-$stamp"
  Invoke-Merge @()
  Write-Host "已写入托管块：$patch"
  & node $verifyYaml $patch | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host 'YAML 校验通过。'
  } elseif ($LASTEXITCODE -eq 2) {
    Write-Host '⚠ YAML 校验已跳过（未安装 js-yaml）。安装后可用：node `"$verifyYaml`" `"$patch`"'
  } else {
    Write-Warning "YAML 校验未通过：回滚到安装前备份后退出（$patch.bak-${stamp}）"
    if (Test-Path "$patch.bak-$stamp") { Copy-Item "$patch.bak-$stamp" $patch -Force }
    throw "YAML 校验未通过，未完成安装。复查：node `"$verifyYaml`" `"$patch`""
  }
  Write-Host ''
  Write-Host '安装完成。web profile 是 live reload：无需重启，刷新 GUI 即可在预设列表看到'
  Write-Host '  已安装：轻量PTC-v3 / 轻量PTC-v3 max（选择器里就这两项）'
  Write-Host '  计划模式是独立包：加 -WithPlanMode（或 dsh plugin add dsh-plan-mode-ui）'
  Write-Host "  自检：dsh --profile $Profile --dump-config | Select-String 'id: preset-flash-lean-ptc-v3-max'"
  Write-Host "  体检：node scripts\doctor.mjs --profile $Profile   （版本/重复行/!!js/解析 一次过）"
  Write-Host "  卸载：powershell -NoProfile -File scripts\install.ps1 -Uninstall -Profile $Profile"
  if ($WithPlanMode) { Install-PlanMode }
}

# 计划模式插件（可选组件）：dist/ 里现成的 tgz → 现打一个 → 目录。没有 dsh 时只打印命令。
function Install-PlanMode {
  # 计划模式插件是独立包：先装包，再落运行时调优。两者失败都不影响预设。
  Write-Host ""
  Write-Host "-- 计划模式插件（独立包 dsh-plan-mode-ui）---------------------"
  $pluginVer = '0.7.0'
  try { $pluginVer = (Get-Content (Join-Path $here 'plugins\plan-mode-ui\package.json') -Raw | ConvertFrom-Json).version } catch {}
  if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) {
    Write-Host "WARN PATH 里没有 dsh 命令，跳过。稍后手动执行："
    Write-Host "  dsh plugin --profile $Profile add dsh-plan-mode-ui"
    Write-Host "  node scripts\tune-runtime.mjs --apply --profile $Profile"
    return
  }
  $installed = $false
  $pluginPkg = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile\node_modules\dsh-plan-mode-ui\package.json"
  if (Test-Path $pluginPkg) {
    $cur = (Get-Content $pluginPkg -Raw | ConvertFrom-Json).version
    if ($cur -eq $pluginVer) { Write-Host "OK 计划模式插件已是 ${cur}，跳过安装"; $installed = $true }
    else { dsh plugin --profile $Profile remove dsh-plan-mode-ui 2>$null | Out-Null }
  }
  if (-not $installed) {
    dsh plugin --profile $Profile add dsh-plan-mode-ui 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "OK 计划模式插件已装（npm：dsh-plan-mode-ui）"; $installed = $true }
  }
  if (-not $installed) {
    $tgz = Join-Path $here ("dist\dsh-plan-mode-ui-{0}.tgz" -f $pluginVer)
    if (Test-Path $tgz) {
      dsh plugin --profile $Profile add ("file:" + $tgz) 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { Write-Host "OK 计划模式插件已装（本地包）"; $installed = $true }
    }
  }
  if (-not $installed) {
    Write-Host "WARN 计划模式插件没装上（npm 尚未发布它时属正常）。稍后手动二选一："
    Write-Host "  dsh plugin --profile $Profile add dsh-plan-mode-ui"
    Write-Host ("  dsh plugin --profile $Profile add file:" + (Join-Path $here ("dist\dsh-plan-mode-ui-{0}.tgz" -f $pluginVer)))
  }
  if (Get-Command node -ErrorAction SilentlyContinue) {
    node (Join-Path $here "scripts\tune-runtime.mjs") --apply --profile $Profile | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "OK 运行时调优已就位（常驻 PTC + glob/grep 并发；改过配置需重启 dsh）" }
    else { Write-Host "WARN 运行时调优未完成，稍后手动跑：node scripts\tune-runtime.mjs --apply --profile $Profile" }
  }
  Write-Host "  体检：node scripts\doctor.mjs --profile $Profile --all"
}

function Uninstall-Modern {
  if (-not (Test-Path $patch)) { Write-Host "缺少 ${patch}（无需卸载）"; return }
  Copy-Item $patch "$patch.bak-$stamp"
  Invoke-Merge @('--remove')
  Write-Host "已移除托管块（备份 cordis.patch.yml.bak-${stamp}）"
}

if ($mode -eq 'modern') {
  if ($Uninstall) { Uninstall-Modern } else { Install-Modern }
} else {
  if ($Uninstall) { Uninstall-Legacy } else { Install-Legacy }
}
