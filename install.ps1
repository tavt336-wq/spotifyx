$ErrorActionPreference = "Stop"

$RawBaseUrl = "https://raw.githubusercontent.com/tavt336-wq/spotifyx/main"
$AddonUrl = "$RawBaseUrl/localFolderPlaylist.js"

Write-Host "=== Installing Spicetify Local Folder Playlist ===" -ForegroundColor Green

if (-not (Get-Command spicetify -ErrorAction SilentlyContinue)) {
    Write-Host "Spicetify not found. Installing Spicetify CLI..." -ForegroundColor Yellow
    iwr -useb https://raw.githubusercontent.com/spicetify/cli/main/install.ps1 | iex
}

$userDataPath = (spicetify path userdata).Trim()
$extDir = Join-Path $userDataPath "Extensions"
if (-not (Test-Path $extDir)) {
    New-Item -ItemType Directory -Path $extDir -Force | Out-Null
}

$addonTarget = Join-Path $extDir "localFolderPlaylist.js"
$localSource = Join-Path $PSScriptRoot "localFolderPlaylist.js"

if (Test-Path $localSource) {
    Copy-Item -Path $localSource -Destination $addonTarget -Force
} else {
    Invoke-WebRequest -Uri $AddonUrl -OutFile $addonTarget -UseBasicParsing
}

Write-Host "Extension installed to: $addonTarget" -ForegroundColor Cyan

spicetify config extensions localFolderPlaylist.js
spicetify apply

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
        $extPath = Join-Path (spicetify path userdata).Trim() "Extensions\localFolderPlaylist.js"
        if (Test-Path $extPath) {
            spicetify config extensions localFolderPlaylist.js | Out-Null
            spicetify apply --quiet | Out-Null
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
