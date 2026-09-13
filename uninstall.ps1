<#
.SYNOPSIS
    Removes the Winter Memories HDR mod and restores the original NW.js 0.29 runtime.

.DESCRIPTION
    Restores the runtime, www/index.html and www/package.json from
    <GameDir>\_backup_nwjs0.29 and deletes www/js/HDR_Output.js.
    Save files in www/save are left untouched so progress is kept.

.PARAMETER GameDir
    Game install folder (contains Game.exe and www).

.PARAMETER RemoveBackup
    Delete the backup folder after restoring.
#>
[CmdletBinding()]
param(
    [string]$GameDir = 'C:\Program Files (x86)\Steam\steamapps\common\Winter Memories',
    [switch]$RemoveBackup
)

$ErrorActionPreference = 'Stop'

$BackupName = '_backup_nwjs0.29'

function Write-Step([string]$Message) {
    Write-Host "==> $Message" -ForegroundColor Cyan
}

if (-not (Test-Path $GameDir)) { throw "Game folder not found: $GameDir" }
$GameDir = (Resolve-Path $GameDir).Path
$www = Join-Path $GameDir 'www'
$backup = Join-Path $GameDir $BackupName

foreach ($required in @('Game.exe', 'package.json', 'www\index.html')) {
    if (-not (Test-Path (Join-Path $backup $required))) {
        throw "Backup is missing or incomplete (no $required in $backup)"
    }
}

$running = Get-Process -Name Game -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith($GameDir, [StringComparison]::OrdinalIgnoreCase) }
if ($running) { throw 'The game is running. Close it first.' }

Write-Step 'Restoring the original runtime'
Get-ChildItem $GameDir -Force | Where-Object { $_.Name -notin @('www', $BackupName) } |
    Remove-Item -Recurse -Force
Get-ChildItem $backup -Force | Where-Object { $_.Name -ne 'www' } |
    ForEach-Object { Copy-Item $_.FullName -Destination $GameDir -Recurse -Force }

Write-Step 'Restoring www\index.html and www\package.json'
foreach ($file in @('index.html', 'package.json')) {
    $source = Join-Path $backup "www\$file"
    if (Test-Path $source) { Copy-Item $source -Destination (Join-Path $www $file) -Force }
}

$plugin = Join-Path $www 'js\HDR_Output.js'
if (Test-Path $plugin) {
    Write-Step 'Removing www\js\HDR_Output.js'
    Remove-Item $plugin -Force
}

if ($RemoveBackup) {
    Write-Step "Removing backup $backup"
    Remove-Item $backup -Recurse -Force
}

Write-Host ''
Write-Host 'Original game restored. Save files in www\save were not changed.' -ForegroundColor Green
