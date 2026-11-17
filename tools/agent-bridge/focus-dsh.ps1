# 把 DeepSeek Harness 窗口拉到前面（只拉窗口，不点击、不发消息）。
# 单独用：
#   powershell -NoProfile -ExecutionPolicy Bypass -File focus-dsh.ps1 -Test
# 说明：SetForegroundWindow 会被 Windows 的前台锁挡住（返回 False、只闪任务栏），
# 先按一下 ALT 拿到前台权限才稳；再不行退回 WScript.Shell.AppActivate。
[CmdletBinding()]
param(
  [string]$ProcessLike = "*DeepSeek*",
  [switch]$Test
)

Add-Type -Namespace BnWin -Name Api -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);
'@ -ErrorAction Stop

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
    [void][BnWin.Api]::ShowWindow($h, 9)      # SW_RESTORE
    Start-Sleep -Milliseconds 150
  }
  $done = ([BnWin.Api]::GetForegroundWindow() -eq $h)
  if (-not $done) {
    # 前台锁：先敲一下 ALT（VK_MENU=0x12），SetForegroundWindow 才不被拒
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

$targets = Get-TargetWindow -Like $ProcessLike
if (-not $targets -or $targets.Count -eq 0) {
  if ($Test) { Write-Output "no-window"; exit 3 }
  exit 3
}
$w = $targets[0]
$ok = Show-TargetWindow -p $w
if ($Test) {
  Write-Output ("process=" + $w.ProcessName + " hwnd=" + $w.MainWindowHandle + " front=" + $ok)
  exit 0
}
if ($ok) { exit 0 } else { exit 4 }
