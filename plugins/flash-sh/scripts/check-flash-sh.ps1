<#
.SYNOPSIS
  fl-bash 插件（底层解释器 flash-sh.exe）在 Windows 上的只读自检。不修改任何文件、注册表或环境变量。

.DESCRIPTION
  检查：
    1. 系统是不是 Windows x64（ARM64 会单独提示）；
    2. 插件包是否在 profile 里、flash-sh.exe 是否存在、sha256 是否与包内 .sha256 / 发布值一致；
    3. flash-sh.exe 能否执行 -c "echo ok"；
    4. profile 补丁（以及 DSH home 级补丁）里 fl-bash-standalone 的 enabled 最终是什么；
    5. 环境变量 DSH_FLASH_SH（当前进程 / 用户 / 系统）以及 .env 里有没有误写；
    6. 是否装了 dsh-flash-presets（0.3.4 起自带 fl-bash，插件页上是单独的 fl-bash 组件行）
       以及两边是否同时启用（同一时刻只注册一个，presets 优先）；
    7. DSH 日志里最近的 [fl-bash] 行（若能找到；0.1.x 是 [flash-sh]）。
  三种装法都认：插件页 / dsh plugin add 装的独立组合包；手动放进 node_modules + 补丁里手写 insert 行；
  随 dsh-flash-presets 安装（0.3.4 起 presets 自带实现与 exe，插件页上是单独的 fl-bash 组件行）。
  兼容 Windows PowerShell 5.1 与 PowerShell 7。

.PARAMETER Profile
  DSH profile 名，默认 desktop。

.PARAMETER DshHome
  DSH home，默认 $env:DSH_HOME，否则 %USERPROFILE%\.dsh。

.PARAMETER BinPath
  直接指定要检查的 flash-sh.exe（默认取 profile 里插件包内的 vendor\win32-x64\flash-sh.exe）。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\check-flash-sh.ps1
  powershell -ExecutionPolicy Bypass -File .\check-flash-sh.ps1 -Profile web
#>
[CmdletBinding()]
param(
  [string]$Profile = 'desktop',
  [string]$DshHome = '',
  [string]$BinPath = ''
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$ExpectedSha256 = '04c44cee9ad5ebbf8726fc11269f70c9b7f6bcf5d5f55ecb6ba09cac13a60cd1'
$RowId = 'fl-bash-standalone'
$PackageName = 'fl-bash'

$script:Fails = 0
$script:Warns = 0
function Write-Ok([string]$msg)   { Write-Host ('  [OK]   ' + $msg) -ForegroundColor Green }
function Write-Bad([string]$msg)  { $script:Fails++; Write-Host ('  [FAIL] ' + $msg) -ForegroundColor Red }
function Write-Warn2([string]$msg){ $script:Warns++; Write-Host ('  [WARN] ' + $msg) -ForegroundColor Yellow }
function Write-Info([string]$msg) { Write-Host ('  [INFO] ' + $msg) }
function Write-Section([string]$msg) { Write-Host ''; Write-Host ('== ' + $msg) -ForegroundColor Cyan }

function Read-TextFile([string]$path) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
  try { return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8) } catch { return $null }
}

# 在一份 cordis.patch.yml 里找某个 id 的所有块，返回每块的 kind（insert / override）、HasConfig 与 enabled 值（true/false/$null）
function Find-PatchRows([string]$text, [string]$id) {
  $result = @()
  if ($null -eq $text) { return ,$result }
  $lines = $text -split "`r?`n"
  $pattern = '^(\s*)-\s+id:\s*[''"]?' + [regex]::Escape($id) + '[''"]?\s*(#.*)?$'
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $m = [regex]::Match($lines[$i], $pattern)
    if (-not $m.Success) { continue }
    $indent = $m.Groups[1].Value.Length
    $propIndent = -1
    $hasConfig = $false
    $configIndent = -1
    $enabled = $null
    $disabled = $null
    $name = $null
    for ($j = $i + 1; $j -lt $lines.Count; $j++) {
      $line = $lines[$j]
      if ($line -match '^\s*(#.*)?$') { continue }
      $lead = ([regex]::Match($line, '^\s*')).Value.Length
      if ($lead -le $indent) { break }
      if ($propIndent -lt 0) { $propIndent = $lead }
      if ($configIndent -ge 0 -and $lead -le $configIndent) { $configIndent = -1 }
      if ($lead -eq $propIndent) {
        $cm = [regex]::Match($line, '^\s*config:\s*(\{.*\})?\s*(#.*)?$')
        if ($cm.Success) {
          $hasConfig = $true
          $configIndent = $lead
          $inl = [regex]::Match($line, '\benabled:\s*(true|false)\b')
          if ($inl.Success) { $enabled = $inl.Groups[1].Value }
          continue
        }
        $dm = [regex]::Match($line, '^\s*disabled:\s*(true|false)\b')
        if ($dm.Success) { $disabled = $dm.Groups[1].Value }
        $nm = [regex]::Match($line, '^\s*name:\s*[''"]?([^''"#\s]+)')
        if ($nm.Success) { $name = $nm.Groups[1].Value }
      } elseif ($configIndent -ge 0) {
        $em = [regex]::Match($line, '^\s*enabled:\s*(true|false)\b')
        if ($em.Success) { $enabled = $em.Groups[1].Value }
      }
    }
    # 判断它是否在某个 "- insert:" 之下：向上找缩进更小的最近一行
    $kind = 'override'
    for ($k = $i - 1; $k -ge 0; $k--) {
      $up = $lines[$k]
      if ($up -match '^\s*(#.*)?$') { continue }
      $lead2 = ([regex]::Match($up, '^\s*')).Value.Length
      if ($lead2 -lt $indent) {
        if ($up -match '^\s*-?\s*insert:\s*(#.*)?$') { $kind = 'insert' }
        break
      }
    }
    $result += New-Object PSObject -Property @{ Kind = $kind; HasConfig = $hasConfig; Enabled = $enabled; Disabled = $disabled; Name = $name; Line = ($i + 1) }
  }
  return ,$result
}

# 在某个 id 的块里找 <section>: 下面的 enabled（例如 flash-presets 行的 config.flashSh.enabled）。
# 返回每块一个对象：Kind（insert / override）、Enabled（true/false/$null）、HasSection、Line。
function Find-SectionEnabled([string]$text, [string]$id, [string]$section) {
  $result = @()
  if ($null -eq $text) { return ,$result }
  $lines = $text -split "`r?`n"
  $pattern = '^(\s*)-\s+id:\s*[''"]?' + [regex]::Escape($id) + '[''"]?\s*(#.*)?$'
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $m = [regex]::Match($lines[$i], $pattern)
    if (-not $m.Success) { continue }
    $indent = $m.Groups[1].Value.Length
    $enabled = $null
    $hasSection = $false
    $secIndent = -1
    for ($j = $i + 1; $j -lt $lines.Count; $j++) {
      $line = $lines[$j]
      if ($line -match '^\s*(#.*)?$') { continue }
      $lead = ([regex]::Match($line, '^\s*')).Value.Length
      if ($lead -le $indent) { break }
      if ($secIndent -ge 0 -and $lead -le $secIndent) { $secIndent = -1 }
      $sm = [regex]::Match($line, '^\s*' + [regex]::Escape($section) + ':\s*(\{.*\})?\s*(#.*)?$')
      if ($sm.Success) {
        $hasSection = $true
        $secIndent = $lead
        $inline = [regex]::Match($line, 'enabled:\s*(true|false)\b')
        if ($inline.Success) { $enabled = $inline.Groups[1].Value }
        continue
      }
      if ($secIndent -ge 0) {
        $em = [regex]::Match($line, '^\s*enabled:\s*(true|false)\b')
        if ($em.Success) { $enabled = $em.Groups[1].Value }
      }
    }
    $kind = 'override'
    for ($k = $i - 1; $k -ge 0; $k--) {
      $up = $lines[$k]
      if ($up -match '^\s*(#.*)?$') { continue }
      $lead2 = ([regex]::Match($up, '^\s*')).Value.Length
      if ($lead2 -lt $indent) {
        if ($up -match '^\s*-?\s*insert:\s*(#.*)?$') { $kind = 'insert' }
        break
      }
    }
    $result += New-Object PSObject -Property @{ Kind = $kind; Enabled = $enabled; HasSection = $hasSection; Line = ($i + 1) }
  }
  return ,$result
}

Write-Host 'flash-sh 自检（只读）' -ForegroundColor Cyan

# ── 1. 平台 ─────────────────────────────────────────────────────────────────
Write-Section '1. 平台'
$onWindows = ($env:OS -eq 'Windows_NT')
if (-not $onWindows) {
  Write-Bad '不是 Windows：fl_bash 只在 Windows x64 上注册'
} else {
  $osArch = $null
  try { $osArch = [string][System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture } catch { }
  $procArch = $env:PROCESSOR_ARCHITECTURE
  $wow = $env:PROCESSOR_ARCHITEW6432
  Write-Info ('OSArchitecture=' + $osArch + '  PROCESSOR_ARCHITECTURE=' + $procArch + $(if ($wow) { '  PROCESSOR_ARCHITEW6432=' + $wow } else { '' }))
  $isArm = ($osArch -eq 'Arm64') -or ($procArch -eq 'ARM64') -or ($wow -eq 'ARM64')
  if ($isArm) {
    Write-Warn2 'ARM64 Windows：插件只在 DSH 进程的 process.arch 为 x64 时注册。DSH 若以 x64 版（模拟）运行则 arch=x64，会注册；若以原生 ARM64 版运行则 arch=arm64，不注册。'
  } elseif (($procArch -eq 'AMD64') -or ($wow -eq 'AMD64')) {
    Write-Ok 'Windows x64'
  } else {
    Write-Bad ('不是 x64 Windows（' + $procArch + '）：fl_bash 不会注册')
  }
}

# ── 2. 路径与插件包 ─────────────────────────────────────────────────────────
Write-Section '2. 插件包与 flash-sh.exe'
if ([string]::IsNullOrEmpty($DshHome)) {
  if ($env:DSH_HOME) { $DshHome = $env:DSH_HOME } else { $DshHome = Join-Path $env:USERPROFILE '.dsh' }
}
$profileDir = Join-Path (Join-Path $DshHome 'profiles') $Profile
Write-Info ('DSH home: ' + $DshHome)
Write-Info ('profile:  ' + $profileDir)
if (-not (Test-Path -LiteralPath $profileDir -PathType Container)) {
  Write-Bad ('profile 目录不存在：' + $profileDir + '（桌面端至少要启动过一次）')
}

$pkgDir = Join-Path (Join-Path $profileDir 'node_modules') $PackageName
$pkgJson = Read-TextFile (Join-Path $pkgDir 'package.json')
$presetsDir = Join-Path (Join-Path $profileDir 'node_modules') 'dsh-flash-presets'
$presetsInstalled = Test-Path -LiteralPath $presetsDir -PathType Container
# dsh-flash-presets（0.3.4 起）自带 fl-bash：lib/fl-bash.js + vendor\win32-x64\flash-sh.exe，不再依赖单独的 fl-bash 包
$presetsBundled = $presetsInstalled -and (Test-Path -LiteralPath (Join-Path (Join-Path $presetsDir 'lib') 'fl-bash.js') -PathType Leaf)
$viaManager = $false     # profile package.json 直接依赖（插件页 / dsh plugin add）
$bundleActive = $false   # 被选为组合包（dsh.profile.bundles）—— 只有这时本包 cordis.patch.yml 的 insert 行才生效
$presetsBundle = $false
$profilePkgText = Read-TextFile (Join-Path $profileDir 'package.json')
if ($null -ne $profilePkgText) {
  try {
    $profilePkg = $profilePkgText | ConvertFrom-Json
    $deps = $profilePkg.dependencies
    if ($null -ne $deps -and ($deps.PSObject.Properties.Name -contains $PackageName)) {
      $viaManager = $true
      Write-Info ('profile package.json 依赖：' + $PackageName + ' = ' + $deps.$PackageName)
    }
    $bundles = @()
    if ($profilePkg.PSObject.Properties.Name -contains 'dsh' -and $null -ne $profilePkg.dsh -and $profilePkg.dsh.PSObject.Properties.Name -contains 'profile' -and $null -ne $profilePkg.dsh.profile) { $bundles = @($profilePkg.dsh.profile.bundles) }
    $bundleActive = ($bundles -contains $PackageName)
    $presetsBundle = ($bundles -contains 'dsh-flash-presets')
    if ($bundleActive) { Write-Ok '已作为组合包启用（dsh.profile.bundles 含 fl-bash）' }
    elseif ($viaManager) { Write-Warn2 '已安装但没有被选为组合包（插件页里把 fl-bash 打开）' }
  } catch { Write-Warn2 ('无法解析 ' + (Join-Path $profileDir 'package.json')) }
}
# 装法：bundle（插件管理器）/ manual（手动放置 + 手写 insert 行）；随 dsh-flash-presets 自带时见 $presetsBundled
$installMode = 'none'
if ($null -ne $pkgJson) {
  if ($viaManager) { $installMode = 'bundle' }
  elseif ($presetsInstalled) { $installMode = 'presets-or-manual' }
  else { $installMode = 'manual' }
  $how = switch ($installMode) { 'bundle' { '（插件管理器安装）' } 'manual' { '（手动放置，pnpm 未登记）' } default { '（不是直接依赖：手动放置）' } }
  try { $v = ($pkgJson | ConvertFrom-Json).version; Write-Ok ('插件包在 profile 里：' + $PackageName + '@' + $v + $how) } catch { Write-Ok ('插件包目录存在：' + $pkgDir) }
} elseif ($presetsBundled) {
  Write-Ok 'fl-bash 随 dsh-flash-presets 安装（包内自带实现与 flash-sh.exe，不需要单独的 fl-bash 包）'
} elseif ($presetsInstalled) {
  Write-Bad '装的 dsh-flash-presets 版本不带 fl-bash（0.3.4 起才有）：升级 dsh-flash-presets，或单独安装 fl-bash'
} else {
  Write-Bad ('profile 里没有插件包：' + $pkgDir)
}

if ([string]::IsNullOrEmpty($BinPath)) {
  if ($env:DSH_FL_BASH_BIN) { $BinPath = $env:DSH_FL_BASH_BIN; Write-Info ('使用 DSH_FL_BASH_BIN：' + $BinPath) }
  elseif ($env:DSH_FLASH_SH_BIN) { $BinPath = $env:DSH_FLASH_SH_BIN; Write-Info ('使用 DSH_FLASH_SH_BIN（旧名）：' + $BinPath) }
  elseif (($null -eq $pkgJson) -and $presetsBundled) { $BinPath = Join-Path $presetsDir 'vendor\win32-x64\flash-sh.exe' }
  else { $BinPath = Join-Path $pkgDir 'vendor\win32-x64\flash-sh.exe' }
}
if (Test-Path -LiteralPath $BinPath -PathType Leaf) {
  $size = (Get-Item -LiteralPath $BinPath).Length
  Write-Ok ('flash-sh.exe 存在：' + $BinPath + '（' + $size + ' 字节）')
  $hash = $null
  try { $hash = (Get-FileHash -LiteralPath $BinPath -Algorithm SHA256).Hash.ToLowerInvariant() } catch { Write-Bad ('无法计算 sha256：' + $_.Exception.Message) }
  if ($null -ne $hash) {
    $shaFile = Read-TextFile ($BinPath + '.sha256')
    if ($null -ne $shaFile) {
      $want = (($shaFile.Trim() -split '\s+')[0]).ToLowerInvariant()
      if ($hash -eq $want) { Write-Ok ('sha256 与 flash-sh.exe.sha256 一致：' + $hash) } else { Write-Bad ('sha256 不一致：文件 ' + $hash + ' / .sha256 ' + $want) }
    } else {
      Write-Warn2 '没找到 flash-sh.exe.sha256'
    }
    if ($hash -eq $ExpectedSha256) { Write-Ok '与 fl-bash 0.1.9 发布的 exe 相同' } else { Write-Warn2 ('与 0.1.9 发布的 exe（' + $ExpectedSha256.Substring(0, 12) + '…）不同；自定义 binPath 时可忽略') }
  }

  # ── 3. 执行 ────────────────────────────────────────────────────────────────
  Write-Section '3. 执行 flash-sh -c "echo ok"'
  try {
    # 不给 $LASTEXITCODE 赋值：在脚本作用域里赋值会建一个同名局部变量，遮住自动变量——PowerShell 7 的原生命令
    # 只写全局的 $LASTEXITCODE，于是读到的永远是这里赋的值（0.1.2 实机报告 P1）。先清掉全局值，再读全局值。
    $global:LASTEXITCODE = $null
    $out = & $BinPath --timeout 10 -c 'echo ok' 2>&1
    $runCode = $global:LASTEXITCODE
    if ($null -eq $runCode) { $runCode = -1 }
    $code = $runCode
    $text = ($out | Out-String).Trim()
    if ($code -eq 0 -and $text -eq 'ok') { Write-Ok 'flash-sh 可执行，输出 ok' }
    else { Write-Bad ('执行异常：退出码 ' + $code + '，输出：' + $text) }
  } catch {
    Write-Bad ('无法执行：' + $_.Exception.Message + '（杀毒软件拦截？文件被锁定？）')
  }
} else {
  Write-Bad ('flash-sh.exe 不存在：' + $BinPath)
}

# ── 4. 补丁里的开关 ───────────────────────────────────────────────────────────
Write-Section '4. 补丁层里的 enabled'
$enabledFinal = $null
$insertCount = 0
# 组合包自己的默认值（bundle 层，最先应用）
# 只有被选为组合包时，包里 cordis.patch.yml 的 insert 行才会被 DSH 应用；手动安装 / 作为可选依赖时它不生效，不能计数
$bundlePatch = Read-TextFile (Join-Path $pkgDir 'cordis.patch.yml')
if ($bundleActive) {
  foreach ($r in (Find-PatchRows $bundlePatch $RowId)) {
    if ($r.Kind -eq 'insert') { $insertCount++ }
    if ($null -ne $r.Enabled) { $enabledFinal = $r.Enabled }
    Write-Info ('组合包补丁：' + $r.Kind + ' 行，enabled=' + $r.Enabled)
  }
} elseif ($null -ne $bundlePatch) {
  Write-Info '本包不是已选中的组合包：包内 cordis.patch.yml 不生效（手动安装靠 profile 补丁里手写的 insert 行；随 dsh-flash-presets 安装时用的是 presets 的 fl-bash 行）'
}
$layers = @(
  @{ Label = 'profile 补丁'; Path = (Join-Path $profileDir 'cordis.patch.yml') },
  @{ Label = 'home 级补丁'; Path = (Join-Path $DshHome 'cordis.patch.yml') }
)
$rowDisabled = $false
foreach ($layer in $layers) {
  $text = Read-TextFile $layer.Path
  if ($null -eq $text) { Write-Info ($layer.Label + '：不存在（' + $layer.Path + '）'); continue }
  $rows = Find-PatchRows $text $RowId
  if ($rows.Count -eq 0) { Write-Info ($layer.Label + '：没有 ' + $RowId + ' 行（' + $layer.Path + '）'); continue }
  foreach ($r in $rows) {
    if ($r.Kind -eq 'insert') { $insertCount++ }
    if ($r.Disabled -eq 'true') { $rowDisabled = $true } elseif ($r.Disabled -eq 'false') { $rowDisabled = $false }
    # 覆盖行带 config 时会替换整个 config：没写 enabled 等于回到 schema 默认 false；不带 config（如仅改 disabled）保留原 enabled
    if ($r.Kind -eq 'override' -and $r.HasConfig -and $null -eq $r.Enabled) { $enabledFinal = 'false(覆盖行未写 enabled，config 被整体替换)' }
    elseif ($null -ne $r.Enabled) { $enabledFinal = $r.Enabled }
    Write-Info ($layer.Label + ' 第 ' + $r.Line + ' 行：' + $r.Kind + '，enabled=' + $r.Enabled + $(if ($null -ne $r.Disabled) { '，disabled=' + $r.Disabled } else { '' }))
  }
}
$standaloneRow = ($insertCount -ge 1)
if ($insertCount -gt 1) { Write-Bad ('出现 ' + $insertCount + ' 处 insert ' + $RowId + '：插件管理器安装与手动 insert 行重复，删掉手动那行') }
if ($insertCount -eq 0) {
  if ($presetsInstalled -and -not $viaManager) { Write-Info ('没有 ' + $RowId + ' 行：按 dsh-flash-presets 的 fl-bash 组件检查（见第 6 节）') }
  elseif ($viaManager -and -not $bundleActive) { Write-Bad ('没有 ' + $RowId + ' 行：fl-bash 已安装但没有被选为组合包') }
  else { Write-Bad ('没有任何层插入 ' + $RowId + ' 行（插件未安装 / 未选中，或手动安装漏了 insert 行）') }
}
if ($rowDisabled) { Write-Bad '该行被 disabled: true 关掉了（插件页里打开它）' }
if ($standaloneRow) {
  if ($enabledFinal -eq 'true') { Write-Ok '补丁层最终 enabled: true' } else { Write-Warn2 ('补丁层最终 enabled: ' + $enabledFinal + '（除非环境变量 DSH_FL_BASH=1，否则不会注册）') }
}

# ── 5. 环境变量 ───────────────────────────────────────────────────────────────
Write-Section '5. 环境变量 DSH_FL_BASH（旧名 DSH_FLASH_SH 仍认）'
$envName = 'DSH_FL_BASH'
$envProc = $env:DSH_FL_BASH
$envUser = [Environment]::GetEnvironmentVariable('DSH_FL_BASH', 'User')
$envMachine = [Environment]::GetEnvironmentVariable('DSH_FL_BASH', 'Machine')
if ([string]::IsNullOrEmpty($envProc) -and [string]::IsNullOrEmpty($envUser) -and [string]::IsNullOrEmpty($envMachine)) {
  $envName = 'DSH_FLASH_SH'
  $envProc = $env:DSH_FLASH_SH
  $envUser = [Environment]::GetEnvironmentVariable('DSH_FLASH_SH', 'User')
  $envMachine = [Environment]::GetEnvironmentVariable('DSH_FLASH_SH', 'Machine')
}
Write-Info ($envName + '：当前进程=' + $envProc + '  用户=' + $envUser + '  系统=' + $envMachine)
$envEffective = $envProc
if ([string]::IsNullOrEmpty($envEffective)) { if ($envUser) { $envEffective = $envUser } else { $envEffective = $envMachine } }
if ($envEffective -eq '1') { Write-Ok ($envName + '=1：强制打开（重新从开始菜单启动的 DSH 才能看到新值）') }
elseif ($envEffective -eq '0') { Write-Warn2 ($envName + '=0：强制关闭，补丁里的 enabled 不起作用') }
elseif (-not [string]::IsNullOrEmpty($envEffective)) { Write-Warn2 ($envName + '=' + $envEffective + '：只认 0 / 1，此值被忽略') }
else { Write-Info '未设置（由补丁里的 enabled 决定）' }
foreach ($envFile in @((Join-Path $DshHome '.env'))) {
  $t = Read-TextFile $envFile
  if ($null -ne $t -and $t -match '(?m)^\s*(export\s+)?DSH_(FL_BASH|FLASH_SH)') { Write-Bad ($envFile + ' 里写了 DSH_FL_BASH / DSH_FLASH_SH：DSH 拒绝 .env 里出现 DSH_* 变量（会启动失败），请删掉，改用 setx 或补丁') }
}
if ($null -ne $envProc -and $null -ne $envUser -and $envProc -ne $envUser) { Write-Warn2 '当前窗口与用户级的值不同：setx 只影响之后新启动的程序' }
if ($env:DSH_FL_BASH_ANY_PLATFORM -or $env:DSH_FL_BASH_BIN -or $env:DSH_FLASH_SH_ANY_PLATFORM -or $env:DSH_FLASH_SH_BIN) { Write-Info ('开发变量：DSH_FL_BASH_ANY_PLATFORM=' + $env:DSH_FL_BASH_ANY_PLATFORM + '  DSH_FL_BASH_BIN=' + $env:DSH_FL_BASH_BIN + '  DSH_FLASH_SH_ANY_PLATFORM=' + $env:DSH_FLASH_SH_ANY_PLATFORM + '  DSH_FLASH_SH_BIN=' + $env:DSH_FLASH_SH_BIN) }

$standaloneOn = $standaloneRow -and (-not $rowDisabled) -and (($envEffective -eq '1') -or (($envEffective -ne '0') -and ($enabledFinal -eq 'true')))
if ($standaloneRow) {
  if ($standaloneOn) { Write-Ok '综合：fl-bash-standalone 这一行会尝试注册 fl_bash（还需 Windows x64 与 exe 正常）' }
  else { Write-Warn2 '综合：fl-bash-standalone 这一行不会注册 fl_bash' }
}

# ── 6. dsh-flash-presets 里的 fl-bash 组件行 ────────────────────────────────
Write-Section '6. dsh-flash-presets 里的 fl-bash 组件（行 id fl-bash）'
$presetsOn = $false
if ($presetsInstalled) {
  $presetsPatch = Read-TextFile (Join-Path $presetsDir 'cordis.patch.yml')
  $bundleRows = Find-PatchRows $presetsPatch 'fl-bash'
  $hasRow = $false
  $pEnabled = 'false'
  foreach ($r in $bundleRows) { if ($r.Kind -eq 'insert') { $hasRow = $true; if ($null -ne $r.Enabled) { $pEnabled = $r.Enabled } } }
  if (-not $hasRow) {
    Write-Info 'dsh-flash-presets 已安装，但这个版本没有 fl-bash 组件行（合并后的 0.3.4 起才有）'
  } else {
    $pDisabledRow = $false
    $ownOverride = $false
    $legacyEnabled = $null
    foreach ($layer in $layers) {
      $lt = Read-TextFile $layer.Path
      foreach ($r in (Find-PatchRows $lt 'fl-bash')) {
        if ($r.Kind -ne 'override') { continue }
        if ($r.Disabled -eq 'true') { $pDisabledRow = $true }
        if ($null -ne $r.Enabled) { $pEnabled = $r.Enabled; $ownOverride = $true; Write-Info ($layer.Label + ' 第 ' + $r.Line + ' 行：fl-bash.config.enabled=' + $r.Enabled) }
      }
      # 旧写法：flash-presets 行的 config.flashSh、预览版行 id flash-sh；启动时由 fl-bash 组件行读回（id: fl-bash 上的写法优先）
      foreach ($r in (Find-SectionEnabled $lt 'flash-presets' 'flashSh')) {
        if ($r.Kind -eq 'override' -and $null -ne $r.Enabled) { $legacyEnabled = $r.Enabled; Write-Warn2 ($layer.Label + ' 第 ' + $r.Line + ' 行：旧写法 flash-presets.config.flashSh.enabled=' + $r.Enabled + '（仍会生效，建议改写到 id: fl-bash 的 config.enabled）') }
      }
      foreach ($r in (Find-PatchRows $lt 'flash-sh')) {
        if ($r.Kind -eq 'override' -and $null -ne $r.Enabled) { $legacyEnabled = $r.Enabled; Write-Warn2 ($layer.Label + ' 第 ' + $r.Line + ' 行：旧行 id flash-sh 的 enabled=' + $r.Enabled + '（仍会生效，建议改写到 id: fl-bash）') }
      }
    }
    if ((-not $ownOverride) -and ($null -ne $legacyEnabled)) { $pEnabled = $legacyEnabled }
    if (-not $presetsBundle) { Write-Warn2 'dsh-flash-presets 已安装但没有被选为组合包' }
    if ($pDisabledRow) { Write-Warn2 'fl-bash 整行被 disabled: true 关掉了' }
    $presetsOn = $presetsBundle -and (-not $pDisabledRow) -and (($envEffective -eq '1') -or (($envEffective -ne '0') -and ($pEnabled -eq 'true')))
    Write-Info ('fl-bash 组件 enabled=' + $pEnabled + $(if ($envEffective -eq '1') { '（环境变量为 1 也会打开它）' } else { '' }))
    if ($presetsOn) {
      if ($presetsBundled) { Write-Ok '综合：fl-bash 组件会注册 fl_bash（用 dsh-flash-presets 自带的 flash-sh.exe；还需 Windows x64）' }
      else { Write-Bad '综合：fl-bash 组件已启用，但 dsh-flash-presets 包里没有 lib/fl-bash.js（安装不完整？重装 dsh-flash-presets）' }
    } else {
      Write-Info '综合：fl-bash 组件未启用'
    }
  }
  if ($presetsOn -and $standaloneOn) {
    Write-Warn2 '两边都打开了：同一时刻只注册一个 fl_bash（dsh-flash-presets 的 fl-bash 组件优先，fl-bash-standalone 记一条日志跳过），功能不受影响；建议只保留一处启用'
  } elseif (-not $presetsOn -and -not $standaloneOn) {
    Write-Warn2 '两处都没有启用 fl_bash'
  } else {
    Write-Ok '没有重复启用'
  }
} else {
  Write-Ok '未安装 dsh-flash-presets，无重复'
  if (-not $standaloneOn) { Write-Warn2 'fl_bash 没有启用' }
}

# ── 7. 日志 ───────────────────────────────────────────────────────────────────
Write-Section '7. 日志里的 [fl-bash]（提示性）'
$logDir = Join-Path $DshHome 'logs'
$found = $false
if (Test-Path -LiteralPath $logDir -PathType Container) {
  $files = Get-ChildItem -LiteralPath $logDir -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 20
  foreach ($f in $files) {
    $hits = Select-String -LiteralPath $f.FullName -Pattern '\[(fl-bash|flash-sh)\]' -SimpleMatch:$false -ErrorAction SilentlyContinue | Select-Object -Last 3
    if ($hits) { $found = $true; foreach ($h in $hits) { Write-Info ($f.Name + ': ' + $h.Line.Trim()) } ; break }
  }
}
if (-not $found) { Write-Info ('在 ' + $logDir + ' 里没找到 [fl-bash] 行（桌面端日志可能不写在这里）；以对话里的测试提示词为准') }

Write-Host ''
if ($script:Fails -gt 0) { Write-Host ('结果：' + $script:Fails + ' 项失败，' + $script:Warns + ' 项提示') -ForegroundColor Red; exit 1 }
Write-Host ('结果：无失败项，' + $script:Warns + ' 项提示') -ForegroundColor Green
exit 0
