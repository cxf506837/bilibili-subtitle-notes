# 起本地学习包收件端：只绑 127.0.0.1，不外发。
# 单独跑：powershell -NoProfile -ExecutionPolicy Bypass -File start-hook.ps1
param(
  [int]$Port = 8791,
  [string]$Inbox = "",
  [string]$NodePath = ""
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $here "bn-agent-hook.mjs"
if (-not (Test-Path $script)) { throw ("找不到 " + $script) }

. (Join-Path $here "resolve-node.ps1")
$node = Resolve-NodeExe -Explicit $NodePath

$a = @($script, "--port", "$Port")
if ($Inbox) { $a += @("--inbox", $Inbox) }
Write-Output ("node: " + $node)
Write-Output ("收件端: http://127.0.0.1:" + $Port + "/bn-pack")
& $node @a
