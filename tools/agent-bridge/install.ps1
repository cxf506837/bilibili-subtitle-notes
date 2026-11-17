# 把 bn-agent-bridge 装进「启动」目录：登录后自动跑，不弹窗。
# 只写当前用户的 Startup 文件夹，不需要管理员权限。
[CmdletBinding()]
param([switch]$Uninstall)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridge = Join-Path $here "bn-agent-bridge.ps1"
$startup = [Environment]::GetFolderPath("Startup")
$lnk = Join-Path $startup "bn-agent-bridge.lnk"
$psExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$Q = [char]34

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
  Stop-Bridge
  Write-Output "卸载完成。日志还在 %LOCALAPPDATA%\bn-agent-bridge\bridge.log"
  exit 0
}

if (-not (Test-Path $bridge)) { throw ("找不到 " + $bridge) }

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
