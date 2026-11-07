param(
  [string]$OutDir,
  [string]$RuntimeSource = (Join-Path $env:LOCALAPPDATA 'EndstepForgeProbe'),
  [Parameter(Mandatory)][string]$NodeExe,
  [Parameter(Mandatory)][string]$NodeLicense
)
$ErrorActionPreference = 'Stop'
$converter = Split-Path $PSScriptRoot
$root = Split-Path $converter
if (-not $OutDir) { $OutDir = Join-Path $root 'output' }
$OutDir = [IO.Path]::GetFullPath($OutDir)
New-Item -Path $OutDir -ItemType Directory -Force | Out-Null
$stage = Join-Path ([IO.Path]::GetTempPath()) ('endstep-build-' + [Guid]::NewGuid().ToString('N'))
$app = Join-Path $stage 'app'
$shared = Join-Path $app 'endstep-reader'
$dist = Join-Path $app 'replay-converter'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$source = Join-Path $PSScriptRoot 'Launcher.cs'
$icon = Join-Path $PSScriptRoot 'ReplayLab.ico'
$jdkArchive = Join-Path $RuntimeSource 'jdk.zip'
$forgeArchive = Join-Path $RuntimeSource 'forge-2.0.15.tar.bz2'
$jdkName = 'jdk-17.0.20.1+1'
function Confirm-Archive([string]$File, [string]$ExpectedHash) {
  if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ne $ExpectedHash) {
    throw "Unexpected SHA-256 for $File"
  }
}
try {
  Confirm-Archive $NodeExe 'D702DAA815EABBFF763C7D3808E235CF031CF2CA70211B56847BC72F51E240E5'
  Confirm-Archive $jdkArchive 'E53A79C3C3D86865BD7E787903884331068E71321714FFD44F145785AFFC7CB0'
  Confirm-Archive $forgeArchive '4468F182B60F6CA62D89697BAA208981085AF744F116781AF751C611826DB600'
  foreach ($folder in @($shared, "$shared\forge", "$shared\data", "$dist\windows")) { New-Item -Path $folder -ItemType Directory -Force | Out-Null }
  $runtime = Join-Path $app 'runtime'
  $forge = Join-Path $runtime 'forge'
  New-Item -Path $forge,(Join-Path $runtime 'jdk') -ItemType Directory -Force | Out-Null
  Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $app 'node.exe')
  Copy-Item -LiteralPath $NodeLicense -Destination (Join-Path $runtime 'Node.js-LICENSE.txt')
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'THIRD-PARTY.txt') -Destination $runtime
  Copy-Item -LiteralPath (Join-Path $root 'LICENSE') -Destination (Join-Path $runtime 'Kouhai-MTG-LICENSE.txt')
  Copy-Item -LiteralPath (Join-Path $root 'endstep-reader\data\LICENSE-MODOMETA.md') -Destination $runtime
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $jdkStage = Join-Path $stage 'jdk-source'
  [IO.Compression.ZipFile]::ExtractToDirectory($jdkArchive, $jdkStage)
  $jdk = Join-Path $jdkStage $jdkName
  # EngineWorker still compiles locally, so keep javac and the desktop Java modules.
  & (Join-Path $jdk 'bin\jlink.exe') --module-path (Join-Path $jdk 'jmods') `
    --add-modules java.se,jdk.compiler,jdk.unsupported,jdk.zipfs,jdk.crypto.ec,jdk.localedata,jdk.charsets `
    --no-header-files --no-man-pages --compress=2 --output (Join-Path $runtime "jdk\$jdkName")
  if ($LASTEXITCODE -ne 0) { throw 'Java runtime build failed' }
  & tar.exe -xf $forgeArchive -C $forge --exclude 'res/adventure' --exclude 'res/music' `
    res forge-gui-desktop-2.0.15-jar-with-dependencies.jar LICENSE.txt
  if ($LASTEXITCODE -ne 0) { throw 'Forge runtime extraction failed' }
  $sharedFiles = @(
    'package.json', 'replay.js', 'scenario.js', 'search-source.js', 'search-branch.js', 'search-review.js',
    'search-protocol.js', 'search-schema.js', 'studio-protocol.js', 'studio-schema.js', 'match-decks.js',
    'hidden-worlds.js', 'forge-client.js', 'forge-replay.js', 'tree-search.js', 'winning-lines.js',
    'deck-service.js', 'deck-catalog.js', 'codex-client.js'
  )
  foreach ($file in $sharedFiles) { Copy-Item -LiteralPath (Join-Path $root "endstep-reader\$file") -Destination $shared }
  Copy-Item -LiteralPath (Join-Path $root 'endstep-reader\forge\EngineWorker.java') -Destination "$shared\forge"
  Copy-Item -LiteralPath (Join-Path $root 'endstep-reader\data\deck-catalog.json') -Destination "$shared\data"
  foreach ($file in @('app.js','index.html','style.css','server.js','model-api.js','description-setup.js','timeline.js','mark.svg','table.svg')) { Copy-Item -LiteralPath (Join-Path $converter $file) -Destination $dist }
  Copy-Item -LiteralPath $icon -Destination "$dist\windows"
  $installScript = Join-Path $dist 'windows\install.ps1'
  Get-Content -LiteralPath (Join-Path $PSScriptRoot 'install.ps1') -Raw -Encoding UTF8 | Set-Content -LiteralPath $installScript -Encoding UTF8
  # PowerShell 5 requires a BOM to display UTF-8 source correctly.
  $installContents = [IO.File]::ReadAllText($installScript)
  [IO.File]::WriteAllText($installScript, $installContents, (New-Object Text.UTF8Encoding($true)))
  $refs = @('/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll')
  & $csc /nologo /optimize+ /target:winexe /platform:x64 /codepage:65001 "/win32icon:$icon" "/out:$app\ReplayLab.exe" @refs $source
  if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed' }
  $payload = Join-Path $stage 'app.zip'
  [IO.Compression.ZipFile]::CreateFromDirectory($app, $payload)
  $installer = Join-Path $OutDir 'Kouhai-MTG-Setup-x64.exe'
  & $csc /nologo /optimize+ /target:winexe /platform:x64 /codepage:65001 /define:INSTALLER "/win32icon:$icon" "/out:$installer" "/resource:$payload,app.zip" "/resource:$installScript,install.ps1" @refs $source
  if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed' }
  Get-Item -LiteralPath $installer | Select-Object FullName,Length
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
