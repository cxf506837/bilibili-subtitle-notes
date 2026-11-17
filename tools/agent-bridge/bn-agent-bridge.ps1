# bn-agent-bridge：盯着下载目录里新出现的学习包（bn-study-*.json），
# 一出现就把 DeepSeek Harness 窗口拉到前面。不点击、不输入、不发送。
# 用户的动作只有两步：Ctrl+V（提示词已经在剪贴板里）→ Enter。
[CmdletBinding()]
param(
  [string]$DownloadsDir = (Join-Path $env:USERPROFILE "Downloads"),
  [string]$Pattern = "bn-study-*.json",
  [string]$ProcessLike = "*DeepSeek*",
  [int]$DebounceMs = 1200,
  [int]$CooldownSec = 8,
  [switch]$RunOnce
)

$ErrorActionPreference = "Stop"
Add-Type -Namespace BnWin -Name Api -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);
'@ -ErrorAction Stop

$stateDir = Join-Path $env:LOCALAPPDATA "bn-agent-bridge"
if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
$logPath = Join-Path $stateDir "bridge.log"

function Write-Log([string]$msg) {
  $line = (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "  " + $msg
  try {
    if ((Test-Path $logPath) -and ((Get-Item $logPath).Length -gt 200KB)) {
      Move-Item $logPath ($logPath + ".1") -Force
    }
    Add-Content -Path $logPath -Value $line -Encoding UTF8
  } catch { }
  if ($RunOnce) { Write-Output $line }
}

function Get-TargetWindow {
  param([string]$Like)
  @(Get-Process | Where-Object {
    $_.MainWindowHandle -ne 0 -and (
      ($_.ProcessName -like $Like) -or ($_.MainWindowTitle -like $Like)
    )
  } | Sort-Object -Property StartTime -Descending)
}

function Show-TargetWindow {
  param($p)
  $h = $p.MainWindowHandle
  if ([BnWin.Api]::IsIconic($h)) {
    [void][BnWin.Api]::ShowWindow($h, 9)
    Start-Sleep -Milliseconds 150
  }
  $done = ([BnWin.Api]::GetForegroundWindow() -eq $h)
  if (-not $done) {
    [BnWin.Api]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    [BnWin.Api]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [void][BnWin.Api]::SetForegroundWindow($h)
    Start-Sleep -Milliseconds 200
    $done = ([BnWin.Api]::GetForegroundWindow() -eq $h)
  }
  if (-not $done) {
    try {
      $sh = New-Object -ComObject WScript.Shell
      [void]$sh.AppActivate($p.Id)
      Start-Sleep -Milliseconds 300
      $done = ([BnWin.Api]::GetForegroundWindow() -eq $h)
    } catch { }
  }
  return $done
}

$lastFocus = [datetime]::MinValue

function Invoke-BringFront([string]$why) {
  $now = Get-Date
  if (($now - $lastFocus).TotalSeconds -lt $CooldownSec) { return }
  $targets = Get-TargetWindow -Like $ProcessLike
  if (-not $targets -or $targets.Count -eq 0) { Write-Log ("没找到窗口（" + $why + "）：agent 没开？"); return }
  $w = $targets[0]
  $ok = Show-TargetWindow -p $w
  $script:lastFocus = Get-Date
  $head = if ($ok) { "已拉到前面" } else { "拉前面失败" }
  Write-Log ($head + "（" + $why + "）· " + $w.ProcessName)
}

Write-Log ("启动 · 监听 " + (Join-Path $DownloadsDir $Pattern) + " · 进程匹配 " + $ProcessLike)

if (-not (Test-Path $DownloadsDir)) {
  Write-Log ("下载目录不存在：" + $DownloadsDir)
  exit 2
}

if ($RunOnce) {
  Invoke-BringFront "手动测试"
  exit 0
}

$fsw = New-Object System.IO.FileSystemWatcher
$fsw.Path = $DownloadsDir
$fsw.Filter = $Pattern
$fsw.NotifyFilter = [System.IO.NotifyFilters]"FileName, LastWrite, CreationTime"
$fsw.IncludeSubdirectories = $false
$fsw.EnableRaisingEvents = $true

while ($true) {
  try {
    $r = $fsw.WaitForChanged([System.IO.WatcherChangeTypes]::All, 60000)
    if ($r.TimedOut) { continue }
    $name = [string]$r.Name
    Start-Sleep -Milliseconds $DebounceMs
    Invoke-BringFront ("新文件 " + $name)
  } catch {
    Write-Log ("监听出错：" + $_.Exception.Message)
    Start-Sleep -Seconds 5
    try { $fsw.EnableRaisingEvents = $true } catch { }
  }
}
