<#
.SYNOPSIS
  把本仓库的预设安装到 DSH 主目录（Windows PowerShell 5.1+ / PowerShell 7+）。
.DESCRIPTION
  与 scripts/install.sh 等价：复制 presets\<name>\{preset.yml,agent.cordis.yml} 到
  <DSH_HOME>\.agent-presets\<name>\；若目标已存在，先备份为 <name>.bak-<时间戳>，可重复执行。
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install.ps1
.EXAMPLE
  .\scripts\install.ps1 -DshHome D:\tmp\.dsh
#>
[CmdletBinding()]
param(
  [string]   $DshHome,
  [string[]] $Presets = @('flash-lean', 'flash-lean-ptc')
)

$ErrorActionPreference = 'Stop'

if (-not $DshHome) {
  if ($env:DSH_HOME)        { $DshHome = $env:DSH_HOME }
  elseif ($HOME)            { $DshHome = Join-Path $HOME '.dsh' }
  elseif ($env:USERPROFILE) { $DshHome = Join-Path $env:USERPROFILE '.dsh' }
  else                      { throw '无法确定 DSH 主目录，请用 -DshHome 指定。' }
}

$repo  = Split-Path -Parent $PSScriptRoot
$dest  = Join-Path $DshHome '.agent-presets'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (-not (Test-Path -LiteralPath (Join-Path $repo 'presets'))) {
  throw "找不到 presets 目录：$repo\presets（请在仓库副本内运行本脚本）"
}

foreach ($name in $Presets) {
  $src = Join-Path (Join-Path $repo 'presets') $name
  if (-not (Test-Path -LiteralPath $src)) { throw "缺少目录: $src" }

  $target = Join-Path $dest $name
  if (Test-Path -LiteralPath $target) {
    $backup = "$target.bak-$stamp"
    Write-Host "已存在 $target → 备份为 $backup"
    Move-Item -LiteralPath $target -Destination $backup
  }
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  Copy-Item -LiteralPath (Join-Path $src 'preset.yml')       -Destination $target -Force
  Copy-Item -LiteralPath (Join-Path $src 'agent.cordis.yml') -Destination $target -Force
  Write-Host "已安装 $target"
}

Write-Host ''
Write-Host '安装完成。'
Write-Host "  校验：`$env:DSH_HOME = '$DshHome'; node `"$repo\scripts\verify-presets.mjs`""
Write-Host '  随后重启 DSH（或刷新 GUI），在预设列表选择「Flash 精简」/「Flash 精简·PTC」。'
