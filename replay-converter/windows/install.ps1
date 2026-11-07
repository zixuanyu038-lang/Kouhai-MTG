param(
  [string]$Payload,
  [string]$Target = (Join-Path $env:LOCALAPPDATA 'Programs\EndstepReplayLab'),
  [switch]$Uninstall,
  [switch]$NoShortcuts,
  [switch]$DesktopShortcut
)
$ErrorActionPreference = 'Stop'
$progressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$name = '口嗨万智牌'
$previousName = '战报重演'
$programs = [Environment]::GetFolderPath('Programs')
$shortcut = Join-Path $programs "$name.lnk"
$previousShortcut = Join-Path $programs "$previousName.lnk"
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$desktopLink = if ($desktop) { Join-Path $desktop "$name.lnk" }
$previousDesktopLink = if ($desktop) { Join-Path $desktop "$previousName.lnk" }
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\EndstepReplayLab'
$registeredTarget = (Get-ItemProperty -LiteralPath $uninstallKey -Name InstallLocation -ErrorAction SilentlyContinue).InstallLocation
$Target = [IO.Path]::GetFullPath($Target)
if ($Target -notmatch '^[A-Za-z]:\\' -or $Target -eq [IO.Path]::GetPathRoot($Target) -or (Split-Path $Target -Leaf) -notmatch '^EndstepReplayLab([.-][\w.-]+)?$') {
  throw '应用目录必须以 EndstepReplayLab 命名。'
}
$launcher = Join-Path $Target 'ReplayLab.exe'
$registeredLauncher = if ($registeredTarget) { Join-Path $registeredTarget 'ReplayLab.exe' }
$running = Get-Process ReplayLab -ErrorAction SilentlyContinue | Where-Object {
  $_.Path -eq $launcher -or (-not $NoShortcuts -and $registeredLauncher -and $_.Path -eq $registeredLauncher)
}
if ($running) { throw '请先从任务栏托盘退出正在运行的应用，再继续安装或卸载。' }
if (Test-Path -LiteralPath $Target) {
  $existing = Get-Item -LiteralPath $Target -Force
  if (-not $existing.PSIsContainer -or ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw '目标位置是文件或目录链接，请换一个安装位置。'
  }
  $contents = @(Get-ChildItem -LiteralPath $Target -Force)
  if ($contents.Count) {
    $ownedNames = @('ReplayLab.exe','node.exe','endstep-reader','replay-converter','runtime')
    $identity = Get-Item -LiteralPath $launcher -ErrorAction SilentlyContinue
    if ($identity.VersionInfo.ProductName -notin @($name,$previousName) -or -not (Test-Path -LiteralPath (Join-Path $Target 'replay-converter\server.js') -PathType Leaf) -or
      @($contents | Where-Object { $_.Name -notin $ownedNames -or ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) }).Count) {
      throw '目标目录已有其他文件。请选择空目录，或该应用原有的安装目录。'
    }
  }
}
function Remove-AppShortcut([string]$Link, [string[]]$AppPaths) {
  if ($Link -and (Test-Path -LiteralPath $Link -PathType Leaf)) {
    $shell = New-Object -ComObject WScript.Shell
    $linkTarget = $shell.CreateShortcut($Link).TargetPath
    if ($linkTarget -and $linkTarget -in $AppPaths) { Remove-Item -LiteralPath $Link -Force }
  }
}
if ($Uninstall) {
  if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force }
  Remove-AppShortcut $shortcut $launcher
  Remove-AppShortcut $desktopLink $launcher
  Remove-AppShortcut $previousShortcut $launcher
  Remove-AppShortcut $previousDesktopLink $launcher
  if ($registeredTarget -eq $Target) { Remove-Item -LiteralPath $uninstallKey -Force }
  exit
}
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -notmatch 'AMD64') { throw '此安装包适用于 Windows x64。' }
$stage = $Target + '.stage-' + [Guid]::NewGuid().ToString('N')
$backup = $Target + '.previous-' + [Guid]::NewGuid().ToString('N')
$replaced = $false
try {
  Write-Output '正在解包应用和内置运行环境…'
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($Payload, $stage)
  Write-Output '正在检查内置运行环境…'
  foreach ($file in @(
    'node.exe', 'runtime\jdk\jdk-17.0.20.1+1\bin\java.exe',
    'runtime\jdk\jdk-17.0.20.1+1\bin\javac.exe',
    'runtime\forge\forge-gui-desktop-2.0.15-jar-with-dependencies.jar',
    'replay-converter\windows\Update-Forge.cmd', 'endstep-reader\forge\update-runtime.cjs'
  )) {
    if (-not (Test-Path -LiteralPath (Join-Path $stage $file) -PathType Leaf)) { throw "安装包缺少文件 $file，请重新获取完整安装包。" }
  }
  if (Test-Path -LiteralPath $Target) { Move-Item -LiteralPath $Target -Destination $backup }
  try { Move-Item -LiteralPath $stage -Destination $Target; $replaced = $true }
  catch {
    if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $Target }
    throw
  }
  if (-not $NoShortcuts) {
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($shortcut)
    $link.TargetPath = $launcher
    $link.WorkingDirectory = $Target
    $link.Description = $name
    $link.IconLocation = (Join-Path $Target 'replay-converter\windows\ReplayLab.ico') + ',0'
    $link.Save()
    if ($DesktopShortcut -and $desktopLink) {
      $link = $shell.CreateShortcut($desktopLink)
      $link.TargetPath = $launcher
      $link.WorkingDirectory = $Target
      $link.Description = $name
      $link.IconLocation = (Join-Path $Target 'replay-converter\windows\ReplayLab.ico') + ',0'
      $link.Save()
    } else {
      Remove-AppShortcut $desktopLink @($launcher,$registeredLauncher)
    }
    New-Item -Path $uninstallKey -Force | Out-Null
    $uninstaller = Join-Path $Target 'replay-converter\windows\install.ps1'
    $command = ('"{0}\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{1}" -Uninstall -Target "{2}"' -f $env:WINDIR, $uninstaller, $Target)
    @{DisplayName=$name;DisplayVersion='1.2.6';InstallLocation=$Target;DisplayIcon=$launcher;UninstallString=$command;NoModify=1;NoRepair=1}.GetEnumerator() | ForEach-Object {
      Set-ItemProperty -Path $uninstallKey -Name $_.Key -Value $_.Value
    }
    Remove-AppShortcut $previousShortcut @($launcher,$registeredLauncher)
    Remove-AppShortcut $previousDesktopLink @($launcher,$registeredLauncher)
  }
  Write-Output "安装位置 $Target"
  Write-Output '安装完成。'
} finally {
  $cleanup = if ($replaced) { @($stage,$backup) } else { @($stage) }
  foreach ($folder in $cleanup) {
    $item = Get-Item -LiteralPath $folder -Force -ErrorAction SilentlyContinue
    if ($item -and $item.FullName -eq $folder -and $item.Parent.FullName -eq (Split-Path $Target) -and
      -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      Remove-Item -LiteralPath $item.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}
