# 把 bn-agent-bridge 装进「启动」目录：登录后自动跑，不弹窗。
# 只写当前用户的 Startup 文件夹，不需要管理员权限。
[CmdletBinding()]
param([switch]$Uninstall, [switch]$Hook, [int]$Port = 8791)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridge = Join-Path $here "bn-agent-bridge.ps1"
$startup = [Environment]::GetFolderPath("Startup")
$lnk = Join-Path $startup "bn-agent-bridge.lnk"
$hookPs1 = Join-Path $here "start-hook.ps1"
$hookLnk = Join-Path $startup "bn-agent-hook.lnk"
$hookArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " + $Q + $hookPs1 + $Q + " -Port " + $Port
$psExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$Q = [char]34

function Stop-Hook {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*bn-agent-hook.mjs*" } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      Write-Output ("已停掉收件端进程 " + $_.ProcessId)
    }
}

function Stop-Bridge {
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*bn-agent-bridge.ps1*" -and $_.CommandLine -notlike "*-Command*" } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      Write-Output ("已停掉进程 " + $_.ProcessId)
    }
}

if ($Uninstall) {
  if (Test-Path $lnk) { Remove-Item $lnk -Force; Write-Output ("已删除开机启动 " + $lnk) }
  else { Write-Output "没有装过" }
  if (Test-Path $hookLnk) { Remove-Item $hookLnk -Force; Write-Output ("已删除开机启动 " + $hookLnk) }
  Stop-Bridge
  Stop-Hook
  Write-Output "卸载完成。日志还在 %LOCALAPPDATA%\bn-agent-bridge\bridge.log"
  exit 0
}

if (-not (Test-Path $bridge)) { throw ("找不到 " + $bridge) }

# -Hook：只装「学习包收件端」（扩展设置里打开自动投递才用得上），不装下载目录监听。
if ($Hook) {
  if (-not (Test-Path $hookPs1)) { throw ("找不到 " + $hookPs1) }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "找不到 node.exe。装 Node.js 18+ 后重试。" }
  $sh0 = New-Object -ComObject WScript.Shell
  $s0 = $sh0.CreateShortcut($hookLnk)
  $s0.TargetPath = $psExe
  $s0.Arguments = $hookArgs
  $s0.WorkingDirectory = $here
  $s0.WindowStyle = 7
  $s0.Description = "bili-notes 学习包收件端：127.0.0.1:" + $Port + "/bn-pack"
  $s0.Save()
  Write-Output ("已装到开机启动 " + $hookLnk)
  Stop-Hook
  Start-Sleep -Milliseconds 400
  $cli0 = $Q + $psExe + $Q + " -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " + $Q + $hookPs1 + $Q + " -Port " + $Port
  $proc0 = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cli0 }
  if ($proc0.ReturnValue -ne 0) { throw ("启动收件端失败，WMI 返回 " + $proc0.ReturnValue) }
  Write-Output ("已在后台启动收件端，PID " + $proc0.ProcessId)
  Write-Output ("自测：Invoke-RestMethod http://127.0.0.1:" + $Port + "/bn-ping")
  exit 0
}

$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = $psExe
$s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " + $Q + $bridge + $Q
$s.WorkingDirectory = $here
$s.WindowStyle = 7
$s.Description = "bili-notes 学习包：新文件出现时把 agent 窗口拉到前面"
$s.Save()
Write-Output ("已装到开机启动 " + $lnk)

Stop-Bridge
Start-Sleep -Milliseconds 400
# 用 WMI Create 启动：脱离当前 pwsh 的生命周期（Start-Process 的子进程会跟着父进程的 job 一起没）
$cli = $Q + $psExe + $Q + " -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " + $Q + $bridge + $Q
$proc = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cli }
if ($proc.ReturnValue -ne 0) { throw ("启动监听失败，WMI 返回 " + $proc.ReturnValue) }
Write-Output ("已在后台启动监听（不弹窗），PID " + $proc.ProcessId)
Write-Output "日志：%LOCALAPPDATA%\bn-agent-bridge\bridge.log"
