$ErrorActionPreference = "Stop"

$RawBaseUrl = "https://raw.githubusercontent.com/tavt336-wq/spotifyx/main"
$AddonUrl = "$RawBaseUrl/localFolderPlaylist.js"

Write-Host "=== Installing Local Folder Playlist Addon ===" -ForegroundColor Green

function Get-SpicetifyExe {
    $cmd = Get-Command spicetify -ErrorAction SilentlyContinue
    if ($cmd -and (Test-Path $cmd.Source)) { return $cmd.Source }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "spicetify\spicetify.exe"),
        (Join-Path $env:ProgramFiles "spicetify\spicetify.exe")
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    return $null
}

$spicetifyExe = Get-SpicetifyExe

if (-not $spicetifyExe) {
    Write-Host "Installing Spicetify CLI..." -ForegroundColor Yellow
    $workDir = Join-Path $env:TEMP "SpotifyLocalFolderSetup"
    New-Item -ItemType Directory -Path $workDir -Force | Out-Null
    $officialInstaller = Join-Path $workDir "spicetify-install.ps1"
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/spicetify/cli/main/install.ps1" -OutFile $officialInstaller -UseBasicParsing
    & $officialInstaller

    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    $spicetifyExe = Get-SpicetifyExe
}

if (-not $spicetifyExe) {
    throw "Spicetify executable not found. Open a new PowerShell window and run again."
}

$userDataPath = (& $spicetifyExe path userdata 2>$null | Out-String).Trim()
if ([string]::IsNullOrWhiteSpace($userDataPath)) {
    $userDataPath = Join-Path $env:APPDATA "spicetify"
}

$extDir = Join-Path $userDataPath "Extensions"
if (-not (Test-Path $extDir)) {
    New-Item -ItemType Directory -Path $extDir -Force | Out-Null
}

$addonTarget = Join-Path $extDir "localFolderPlaylist.js"
Invoke-WebRequest -Uri $AddonUrl -OutFile $addonTarget -UseBasicParsing
Write-Host "Extension saved to: $addonTarget" -ForegroundColor Cyan

& $spicetifyExe backup apply
& $spicetifyExe config extensions localFolderPlaylist.js
& $spicetifyExe apply

Write-Host "Done! Restart Spotify if needed." -ForegroundColor Green
