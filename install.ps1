$ErrorActionPreference = "Stop"

$RawBaseUrl = "https://raw.githubusercontent.com/tavt336-wq/spotifyx/main"
$AddonUrl = "$RawBaseUrl/localFolderPlaylist.js"

Write-Host "=== Installing Spicetify Local Folder Playlist ===" -ForegroundColor Green

function Get-SpicetifyExe {
    $cmd = Get-Command spicetify -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

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
    Write-Host "Spicetify not found. Installing Spicetify CLI..." -ForegroundColor Yellow
    $spicetifyInstaller = Invoke-RestMethod -Uri "https://raw.githubusercontent.com/spicetify/cli/main/install.ps1" -UseBasicParsing
    if ([string]::IsNullOrWhiteSpace($spicetifyInstaller)) {
        throw "Could not download Spicetify installer."
    }
    Invoke-Expression $spicetifyInstaller

    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    $spicetifyExe = Get-SpicetifyExe
}

if (-not $spicetifyExe) {
    throw "Spicetify executable not found after installation. Please restart PowerShell and run again."
}

$userDataPath = (& $spicetifyExe path userdata 2>$null | Out-String).Trim()
if ([string]::IsNullOrWhiteSpace($userDataPath)) {
    $userDataPath = Join-Path $env:LOCALAPPDATA "spicetify"
}

$extDir = Join-Path $userDataPath "Extensions"
if (-not (Test-Path $extDir)) {
    New-Item -ItemType Directory -Path $extDir -Force | Out-Null
}

$addonTarget = Join-Path $extDir "localFolderPlaylist.js"
$localSource = if ($PSScriptRoot) { Join-Path $PSScriptRoot "localFolderPlaylist.js" } else { "" }

if ($localSource -and (Test-Path $localSource)) {
    Copy-Item -Path $localSource -Destination $addonTarget -Force
} else {
    Invoke-WebRequest -Uri $AddonUrl -OutFile $addonTarget -UseBasicParsing
}

Write-Host "Extension installed to: $addonTarget" -ForegroundColor Cyan

& $spicetifyExe config extensions localFolderPlaylist.js
& $spicetifyExe apply

$autoDir = Join-Path $env:LOCALAPPDATA "SpotifyLocalFolderAddon"
if (-not (Test-Path $autoDir)) {
    New-Item -ItemType Directory -Path $autoDir -Force | Out-Null
}

$watcherPath = Join-Path $autoDir "auto-apply.ps1"
$watcherScript = @'
$ErrorActionPreference = "SilentlyContinue"
$wasRunning = $false

while ($true) {
    $spotifyProc = Get-Process -Name "Spotify" -ErrorAction SilentlyContinue
    if ($spotifyProc -and -not $wasRunning) {
        $wasRunning = $true
        $spExe = Join-Path $env:LOCALAPPDATA "spicetify\spicetify.exe"
        if (-not (Test-Path $spExe)) {
            $cmd = Get-Command spicetify -ErrorAction SilentlyContinue
            if ($cmd) { $spExe = $cmd.Source }
        }
        if ($spExe -and (Test-Path $spExe)) {
            $uData = (& $spExe path userdata 2>$null | Out-String).Trim()
            if ([string]::IsNullOrWhiteSpace($uData)) {
                $uData = Join-Path $env:LOCALAPPDATA "spicetify"
            }
            $extPath = Join-Path $uData "Extensions\localFolderPlaylist.js"
            if (Test-Path $extPath) {
                & $spExe config extensions localFolderPlaylist.js | Out-Null
                & $spExe apply --quiet | Out-Null
            }
        }
    } elseif (-not $spotifyProc) {
        $wasRunning = $false
    }
    Start-Sleep -Seconds 3
}
'@
Set-Content -Path $watcherPath -Value $watcherScript -Encoding UTF8

$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$startupCmd = "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watcherPath`""
Set-ItemProperty -Path $runKey -Name "SpotifyLocalFolderAddon" -Value $startupCmd

Start-Process -FilePath "powershell.exe" -ArgumentList "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watcherPath`"" -WindowStyle Hidden

Write-Host "Done! Auto-start enabled when Spotify opens." -ForegroundColor Green
