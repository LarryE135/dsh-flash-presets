<#
.SYNOPSIS
  把本仓库推到 GitHub（main + tag + Release）。与 scripts/publish.sh 等价。
.DESCRIPTION
  需要 git；若安装了 GitHub CLI 并 gh auth login 过，可自动建仓库并创建 Release。
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish.ps1
.EXAMPLE
  .\scripts\publish.ps1 -Repo my-presets -Visibility private
#>
[CmdletBinding()]
param(
  [string] $GhUser = $(if ($env:GH_USER) { $env:GH_USER } else { 'LarryE135' }),
  [string] $Repo   = $(if ($env:REPO)    { $env:REPO }    else { 'dsh-flash-presets' }),
  [ValidateSet('public', 'private')]
  [string] $Visibility = 'public',
  [string] $Tag = 'v1.0.0'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo
try {
  $remote = "https://github.com/$GhUser/$Repo.git"
  Write-Host "目标：$GhUser/$Repo（$Visibility），标签 $Tag"

  $existing = git remote get-url origin 2>$null
  if (-not $existing)            { git remote add origin $remote }
  elseif ($existing -ne $remote) { git remote set-url origin $remote }

  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if ($gh) {
    gh repo view "$GhUser/$Repo" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
      gh repo create "$GhUser/$Repo" "--$Visibility" --description 'DSH agent presets tuned for token efficiency (flash-lean / flash-lean-ptc)'
    }
    git push -u origin main
    if ($LASTEXITCODE -ne 0) { throw 'git push main 失败' }
    git push origin $Tag
    if ($LASTEXITCODE -ne 0) { throw "git push $Tag 失败" }

    $zip = "dist\dsh-flash-presets-$Tag.zip"
    if (-not (Test-Path -LiteralPath $zip)) {
      New-Item -ItemType Directory -Force -Path dist | Out-Null
      git archive --format=zip -o $zip HEAD
    }
    gh release create $Tag $zip --title $Tag --notes '见 README 版本历史'
    Write-Host "完成：https://github.com/$GhUser/$Repo"
  }
  else {
    Write-Host ''
    Write-Host '没有可用的 GitHub CLI。二选一：'
    Write-Host '  A) 先在网页创建空仓库（不要勾 README / .gitignore / license）：'
    Write-Host "     https://github.com/new?name=$Repo"
    Write-Host '     然后在仓库目录执行：'
    Write-Host '       git push -u origin main'
    Write-Host "       git push origin $Tag      # 用户名填 $GhUser，密码位填 PAT（Contents: Read and write）"
    Write-Host '  B) 安装 GitHub CLI 后重跑本脚本（可自动建仓库 + 发 Release）：'
    Write-Host '     winget install --id GitHub.cli  然后  gh auth login'
  }
}
finally {
  Pop-Location
}
