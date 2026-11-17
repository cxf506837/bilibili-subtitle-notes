# 找 node.exe：显式路径 → PATH → 常见安装位置 → DSH 自带的运行时。
# 找不到时把找过的位置一起报出来，别只说「找不到」。
function Resolve-NodeExe {
  param([string]$Explicit = "")
  if ($Explicit) {
    if (Test-Path $Explicit) { return (Resolve-Path $Explicit).Path }
    throw ("指定的 node 不存在：" + $Explicit)
  }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $pf86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  # 注意：$env:ProgramFiles / ProgramFiles(x86) 在少数环境里是空的，Join-Path 会直接抛
  # 「无法将参数绑定到参数 Path，因为该参数是空值」——所以先过滤掉空基路径。
  $bases = @($env:ProgramFiles, $pf86, $env:LOCALAPPDATA, $env:USERPROFILE) | Where-Object { $_ }
  $rels = @(
    "nodejs\node.exe",
    "Programs\nodejs\node.exe",
    "Volta\bin\node.exe",
    "scoop\apps\nodejs\current\node.exe"
  )
  $cands = @()
  foreach ($b in $bases) { foreach ($r in $rels) { $cands += (Join-Path $b $r) } }

  foreach ($c in $cands) { if ($c -and (Test-Path $c)) { return $c } }
  # DSH 自带运行时：~/.dsh/dsh-runtimes/<name>/dependencies/node/bin/node.exe（取最新一个）
  $rt = $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE ".dsh\dsh-runtimes" } else { "" })
  if ($rt -and (Test-Path $rt)) {
    $hit = Get-ChildItem $rt -Directory -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      ForEach-Object { Join-Path $_.FullName "dependencies\node\bin\node.exe" } |
      Where-Object { Test-Path $_ } |
      Select-Object -First 1
    if ($hit) { return $hit }
  }
  throw ("找不到 node.exe。装 Node.js 18+ 后重试，或用 -NodePath 指给它。找过：" + (($cands | Where-Object { $_ }) -join "、") + "、%USERPROFILE%\.dsh\dsh-runtimes\*\dependencies\node\bin\node.exe")
}
