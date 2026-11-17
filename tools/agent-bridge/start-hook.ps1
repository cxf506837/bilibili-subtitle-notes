# 起本地学习包收件端：只绑 127.0.0.1，不外发。
# 单独跑：powershell -NoProfile -ExecutionPolicy Bypass -File start-hook.ps1
param(
  [int]$Port = 8791,
  [string]$Inbox = ""
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $here "bn-agent-hook.mjs"
if (-not (Test-Path $script)) { throw ("找不到 " + $script) }

# node 不在 PATH 时按常见位置找一遍；找不到就明确报错，别静默起不来。
$node = $null
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd) { $node = $cmd.Source }
if (-not $node) {
  $pf86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  $cands = @(
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    (Join-Path $pf86 "nodejs\node.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
  )
  foreach ($c in $cands) { if ($c -and (Test-Path $c)) { $node = $c; break } }
}
if (-not $node) { throw "找不到 node.exe。装 Node.js 18+ 后重试，或把 node 加进 PATH。" }

$a = @($script, "--port", "$Port")
if ($Inbox) { $a += @("--inbox", $Inbox) }
Write-Output ("node: " + $node)
Write-Output ("收件端: http://127.0.0.1:" + $Port + "/bn-pack")
& $node @a
