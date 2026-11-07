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
  [string] $Tag = '',
  # 远端地址与目标不一致时默认报错；确实要改写 origin 才加 -Force
  [switch] $Force
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo
try {
  $remote = "https://github.com/$GhUser/$Repo.git"
  if (-not $Tag) {
    $m = Select-String -Path (Join-Path $repo 'README.md') -Pattern '当前版本：(v[0-9.]+)' | Select-Object -First 1
    if ($m) { $Tag = $m.Matches[0].Groups[1].Value }
  }
  if (-not $Tag) { throw '无法从 README 解析当前版本，请显式传 -Tag' }
  if (-not (git rev-parse -q --verify "refs/tags/$Tag")) {
    throw "本地没有标签 $Tag —— 请先提交并打标签：git tag -a $Tag -m '…'"
  }

  # 与 publish.sh 对齐：远端已有的同名 tag 不得移动（fail-closed，查不到就拒绝）
  $remoteTags = git ls-remote --tags origin "refs/tags/$Tag" 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "无法查询远端标签 $Tag（网络或权限问题）—— 查不到就不敢发"
  }
  if ($remoteTags) {
    throw "远端已存在标签 $Tag —— 版本号一经发布不得复用。请升版本号后重新打标签"
  }
  Write-Host "目标：$GhUser/$Repo（$Visibility），标签 $Tag"

  $existing = git remote get-url origin 2>$null
  if (-not $existing) {
    git remote add origin $remote
  } elseif ($existing -ne $remote) {
    # 与 publish.sh 对齐：默认不改用户的远端配置，只在显式 -Force 时改写
    if (-not $Force) {
      throw "origin 指向 $existing，与目标 $remote 不一致。确认要改写请加 -Force，或先手工 git remote set-url。"
    }
    Write-Host "origin 由 $existing 改写为 $remote（-Force）"
    git remote set-url origin $remote
  }

  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if ($gh) {
  # 本机 GitHub 访问统一走 v2rayN 的 10808：只影响本进程环境，不改系统设置；
  # 10808 没人监听时照旧继承环境（v2rayN 没开也不会把 gh 弄断）。
  function Invoke-Gh {
    $probe = New-Object System.Net.Sockets.TcpClient
    $reachable = $false
    try { $reachable = $probe.ConnectAsync('127.0.0.1', 10808).Wait(300) } catch { $reachable = $false }
    finally { $probe.Dispose() }
    if ($reachable) {
      $oldHttps = $env:HTTPS_PROXY; $oldHttp = $env:HTTP_PROXY
      $env:HTTPS_PROXY = 'http://127.0.0.1:10808'; $env:HTTP_PROXY = 'http://127.0.0.1:10808'
      try { & gh @args } finally { $env:HTTPS_PROXY = $oldHttps; $env:HTTP_PROXY = $oldHttp }
    } else { & gh @args }
  }

    Invoke-Gh repo view "$GhUser/$Repo" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Invoke-Gh repo create "$GhUser/$Repo" "--$Visibility" --description 'DSH agent presets tuned for token efficiency (精简·PTC v3 十三条 / v3 balance 三条)'
    }
    git push -u origin main
    if ($LASTEXITCODE -ne 0) { throw 'git push main 失败' }
    git push origin $Tag
    if ($LASTEXITCODE -ne 0) { throw "git push $Tag 失败" }

    $zip = "dist\dsh-flash-presets-$Tag.zip"
    if (-not (Test-Path -LiteralPath $zip)) {
      New-Item -ItemType Directory -Force -Path dist | Out-Null
      # 打 tag 而不是 HEAD：两者不一致时附件会对不上（第三轮审计 R1-1 之⑤）
      git archive --format=zip -o $zip $Tag
    }
    Invoke-Gh release create $Tag $zip --title $Tag --notes '见 README 版本历史'
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
