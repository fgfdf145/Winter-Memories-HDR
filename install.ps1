<#
.SYNOPSIS
    Installs the Winter Memories HDR mod.

.DESCRIPTION
    1. Backs up the original runtime, www/index.html, www/package.json, www/js and
       www/save into <GameDir>\_backup_nwjs0.29 (skipped if a backup already exists).
    2. Replaces the NW.js 0.29 runtime with a modern NW.js build (SHA-256 verified).
    3. Copies HDR_Output.js into www/js and loads it from www/index.html.
    4. Patches package.json (non-empty app name, audio autoplay flag).

.PARAMETER GameDir
    Game install folder (contains Game.exe and www).

.PARAMETER NwjsVersion
    NW.js release to install.

.PARAMETER NwjsZip
    Use an already downloaded nwjs-<version>-win-x64.zip instead of downloading it.

.PARAMETER UpdateRuntime
    Replace the runtime even if a modern NW.js is already installed.
#>
[CmdletBinding()]
param(
    [string]$GameDir = 'C:\Program Files (x86)\Steam\steamapps\common\Winter Memories',
    [string]$NwjsVersion = 'v0.115.0',
    [string]$NwjsZip,
    [switch]$UpdateRuntime
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$BackupName = '_backup_nwjs0.29'
$PluginSource = Join-Path $PSScriptRoot 'src\HDR_Output.js'
$ScriptTag = '<script type="text/javascript" src="js/HDR_Output.js"></script>'
$AutoplayArg = '--autoplay-policy=no-user-gesture-required'

function Write-Step([string]$Message) {
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Read-TextFile([string]$Path) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
    $text = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
    $newline = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
    return @{ Text = $text; Bom = $hasBom; Newline = $newline }
}

function Write-TextFile([string]$Path, [string]$Text, [bool]$Bom) {
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding $Bom))
}

function Test-ModernRuntime {
    (Test-Path (Join-Path $GameDir 'v8_context_snapshot.bin')) -and
        -not (Test-Path (Join-Path $GameDir 'natives_blob.bin'))
}

#------------------------------------------------------------------------------
# Checks
#------------------------------------------------------------------------------
if (-not (Test-Path $GameDir)) { throw "Game folder not found: $GameDir" }
$GameDir = (Resolve-Path $GameDir).Path
$www = Join-Path $GameDir 'www'

foreach ($required in @('package.json', 'www\index.html', 'www\js\rpg_core.js')) {
    if (-not (Test-Path (Join-Path $GameDir $required))) {
        throw "Not an RPG Maker MV game folder (missing $required): $GameDir"
    }
}
if (-not (Test-Path $PluginSource)) { throw "Missing $PluginSource" }

$running = Get-Process -Name Game -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith($GameDir, [StringComparison]::OrdinalIgnoreCase) }
if ($running) { throw 'The game is running. Close it first.' }

#------------------------------------------------------------------------------
# Backup
#------------------------------------------------------------------------------
$backup = Join-Path $GameDir $BackupName
if (Test-Path $backup) {
    Write-Step "Backup already exists, keeping it: $backup"
} else {
    Write-Step "Backing up original files to $backup"
    New-Item -ItemType Directory -Path $backup | Out-Null
    Get-ChildItem $GameDir -Force | Where-Object { $_.Name -notin @('www', $BackupName) } |
        ForEach-Object { Copy-Item $_.FullName -Destination $backup -Recurse -Force }

    $backupWww = Join-Path $backup 'www'
    New-Item -ItemType Directory -Path $backupWww | Out-Null
    foreach ($item in @('index.html', 'package.json', 'js', 'save')) {
        $source = Join-Path $www $item
        if (Test-Path $source) { Copy-Item $source -Destination $backupWww -Recurse -Force }
    }
}

#------------------------------------------------------------------------------
# NW.js runtime
#------------------------------------------------------------------------------
if ((Test-ModernRuntime) -and -not $UpdateRuntime) {
    Write-Step 'Modern NW.js runtime already installed (use -UpdateRuntime to replace it)'
} else {
    $work = Join-Path ([IO.Path]::GetTempPath()) "winter-memories-hdr-$NwjsVersion"
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    $zipName = "nwjs-$NwjsVersion-win-x64.zip"
    $baseUrl = "https://dl.nwjs.io/$NwjsVersion"

    if (-not $NwjsZip) {
        $NwjsZip = Join-Path $work $zipName
        if (-not (Test-Path $NwjsZip)) {
            Write-Step "Downloading $zipName (about 200 MB)"
            $partial = "$NwjsZip.part"
            if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
                & curl.exe -L --fail --progress-bar -o $partial "$baseUrl/$zipName"
                if ($LASTEXITCODE -ne 0) { throw "Download failed: $baseUrl/$zipName" }
            } else {
                Invoke-WebRequest -Uri "$baseUrl/$zipName" -OutFile $partial -UseBasicParsing
            }
            Move-Item $partial $NwjsZip -Force
        }
    }

    Write-Step 'Verifying SHA-256'
    $sums = (Invoke-WebRequest -Uri "$baseUrl/SHASUMS256.txt" -UseBasicParsing).Content
    if ($sums -is [byte[]]) { $sums = [Text.Encoding]::ASCII.GetString($sums) }
    $line = ($sums -split "`n") | Where-Object { $_ -match ('\s' + [regex]::Escape($zipName) + '\s*$') } |
        Select-Object -First 1
    if (-not $line) { throw "No checksum listed for $zipName" }
    $expected = ($line.Trim() -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash $NwjsZip -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expected -ne $actual) {
        throw "Checksum mismatch for ${NwjsZip}: expected $expected, got $actual"
    }

    Write-Step 'Extracting'
    $extractDir = Join-Path $work 'extract'
    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
    New-Item -ItemType Directory -Path $extractDir | Out-Null
    & tar.exe -xf $NwjsZip -C $extractDir
    if ($LASTEXITCODE -ne 0) { throw "Could not extract $NwjsZip" }
    $runtime = Get-ChildItem $extractDir -Directory | Select-Object -First 1
    if (-not $runtime -or -not (Test-Path (Join-Path $runtime.FullName 'nw.exe'))) {
        throw 'nw.exe not found in the archive'
    }

    Write-Step "Replacing the runtime with NW.js $NwjsVersion"
    $keep = @('www', $BackupName, 'package.json', 'Script.vdf')
    Get-ChildItem $GameDir -Force | Where-Object { $_.Name -notin $keep } | Remove-Item -Recurse -Force
    Copy-Item (Join-Path $runtime.FullName '*') -Destination $GameDir -Recurse -Force
    Move-Item (Join-Path $GameDir 'nw.exe') (Join-Path $GameDir 'Game.exe') -Force
    Remove-Item $extractDir -Recurse -Force
}

#------------------------------------------------------------------------------
# HDR plugin
#------------------------------------------------------------------------------
Write-Step 'Installing www\js\HDR_Output.js'
Copy-Item $PluginSource -Destination (Join-Path $www 'js\HDR_Output.js') -Force

$indexPath = Join-Path $www 'index.html'
$index = Read-TextFile $indexPath
if ($index.Text -match 'js/HDR_Output\.js') {
    Write-Step 'index.html already loads HDR_Output.js'
} else {
    $match = [regex]::Match($index.Text, '(?m)^([ \t]*)<script[^>]*src="js/main\.js"')
    if (-not $match.Success) { throw 'Could not find the js/main.js script tag in index.html' }
    $indent = $match.Groups[1].Value
    $text = $index.Text.Insert($match.Index, $indent + $ScriptTag + $index.Newline)
    Write-TextFile $indexPath $text $index.Bom
    Write-Step 'Added HDR_Output.js to index.html'
}

#------------------------------------------------------------------------------
# package.json
#------------------------------------------------------------------------------
$packagePath = Join-Path $GameDir 'package.json'
$package = Read-TextFile $packagePath
$text = $package.Text
if ($text -match '"name"\s*:\s*""') {
    $text = $text -replace '"name"\s*:\s*""', '"name": "winter-memories"'
}
if ($text -notmatch '"chromium-args"') {
    $match = [regex]::Match($text, '(?m)^([ \t]*)"main"\s*:\s*"[^"]*"\s*,')
    if ($match.Success) {
        $insert = $package.Newline + $match.Groups[1].Value + '"chromium-args": "' + $AutoplayArg + '",'
        $text = $text.Insert($match.Index + $match.Length, $insert)
    } else {
        Write-Warning "Could not add chromium-args to package.json; add `"chromium-args`": `"$AutoplayArg`" manually if audio does not start."
    }
}
if ($text -ne $package.Text) {
    Write-TextFile $packagePath $text $package.Bom
    Write-Step 'Patched package.json'
}

Write-Host ''
Write-Host 'HDR mod installed.' -ForegroundColor Green
Write-Host 'Turn on "Use HDR" in Windows display settings, then start the game.'
Write-Host 'Hotkeys: Ctrl+H toggles HDR, Ctrl+] / Ctrl+[ raise / lower the highlight peak.'
Write-Host "Backup of the original files: $backup"
