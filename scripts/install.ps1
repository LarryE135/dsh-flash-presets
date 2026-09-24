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
#
# Safe to run repeatedly: the managed block is replaced in place and the patch
# file is backed up as cordis.patch.yml.bak-<timestamp> before every write.
[CmdletBinding()]
param(
  [string]   $DshHome,
  [string]   $Profile = 'web',
  [string[]] $Presets = @('flash-lean', 'flash-lean-ptc'),
  [switch]   $Legacy,
  [switch]   $Uninstall
)

$ErrorActionPreference = 'Stop'

if (-not $DshHome) {
  if ($env:DSH_HOME)        { $DshHome = $env:DSH_HOME }
  elseif ($HOME)            { $DshHome = Join-Path $HOME '.dsh' }
  elseif ($env:USERPROFILE) { $DshHome = Join-Path $env:USERPROFILE '.dsh' }
  else                      { throw '无法确定 DSH 主目录，请用 -DshHome 指定。' }
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
  Write-Host "未发现 $patch，但存在 $legacyDir → 按旧版（DSH < 0.1.7）目录式安装。"
} else {
  throw "找不到 $patch（也没有 $legacyDir）。请确认 -DshHome 是否正确（当前：$DshHome）。"
}

function Invoke-Merge([string[]]$ExtraArgs) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw '需要 Node（DSH 本身就依赖它）来改写补丁文件。'
  }
  $argv = @($merge, '--patch', $patch) + $ExtraArgs
  & node @argv
  if ($LASTEXITCODE -eq 3) { exit 3 }
  if ($LASTEXITCODE -ne 0) { exit 1 }
}

# ── 旧版：目录式 ──────────────────────────────────────────────────────────────
function Install-Legacy {
  foreach ($p in $Presets) {
    $src = Join-Path $here "presets\legacy-0.1.5\$p"
    if (-not (Test-Path $src)) { throw "缺少目录: $src" }
    $dst = Join-Path $legacyDir $p
    if (Test-Path $dst) {
      Write-Host "已存在 $dst → 备份为 .bak-$stamp"
      Move-Item $dst "$dst.bak-$stamp"
    }
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    Copy-Item (Join-Path $src 'preset.yml') $dst
    Copy-Item (Join-Path $src 'agent.cordis.yml') $dst
    Write-Host "已安装 $dst（旧版目录式）"
  }
  Write-Host ''
  Write-Host '安装完成（旧版机制）。重启 DSH 后在预设列表选择「Flash 精简」/「Flash 精简·PTC」。'
}

function Uninstall-Legacy {
  foreach ($p in $Presets) {
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
  } else {
    Write-Warning "YAML 校验未通过，请运行：node `"$verifyYaml`" `"$patch`""
  }
  Write-Host ''
  Write-Host '安装完成。web profile 是 live reload：无需重启，刷新 GUI 即可在预设列表看到'
  Write-Host '「Flash 精简（v4.1-flash）」与「Flash 精简·PTC（v4.1-flash）」。'
  Write-Host "  自检：dsh --profile $Profile --dump-config | Select-String 'id: preset-flash-lean'"
  Write-Host "  卸载：powershell -NoProfile -File scripts\install.ps1 -Uninstall -Profile $Profile"
}

function Uninstall-Modern {
  if (-not (Test-Path $patch)) { Write-Host "缺少 $patch（无需卸载）"; return }
  Copy-Item $patch "$patch.bak-$stamp"
  Invoke-Merge @('--remove')
  Write-Host "已移除托管块（备份 cordis.patch.yml.bak-$stamp）"
}

if ($mode -eq 'modern') {
  if ($Uninstall) { Uninstall-Modern } else { Install-Modern }
} else {
  if ($Uninstall) { Uninstall-Legacy } else { Install-Legacy }
}
