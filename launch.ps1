# ClipAI Background Service Launcher
# Runs local server.ps1 & Cloudflare tunnel indefinitely

$root     = Split-Path -Parent $MyInvocation.MyCommand.Path
$server   = Join-Path $root "server.ps1"
$cfared   = Join-Path $root "cloudflared.exe"
$urlFile  = Join-Path $root "live_url.txt"
$desktop  = [System.Environment]::GetFolderPath('Desktop')
$linkFile = Join-Path $desktop "ClipAI Live Website.url"
$logFile  = Join-Path $root "tunnel.log"

# Ensure server.ps1 is listening on port 8000
$conn = netstat -ano 2>$null | Select-String ":8000 " | Select-String "LISTENING"
if (-not $conn) {
    Start-Process powershell.exe -ArgumentList "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$server`"" -WindowStyle Minimized
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep -Seconds 1
        $conn = netstat -ano 2>$null | Select-String ":8000 " | Select-String "LISTENING"
        if ($conn) { break }
    }
}

# Kill old cloudflared
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
if (Test-Path $logFile) { Remove-Item $logFile -Force -ErrorAction SilentlyContinue }

# Start cloudflared background tunnel with host header override
$cfProcess = Start-Process $cfared -ArgumentList "tunnel --url http://127.0.0.1:8000 --http-host-header `"localhost:8000`" --logfile `"$logFile`"" -WindowStyle Hidden -PassThru

# Monitor log for generated URL
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $logFile) {
        $content = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
        if ($content -match 'https://[a-z0-9\-]+\.trycloudflare\.com') {
            $publicUrl = $Matches[0]
            Set-Content -Path $urlFile -Value $publicUrl
            $shortcutContent = "[InternetShortcut]`r`nURL=$publicUrl`r`n"
            Set-Content -Path $linkFile -Value $shortcutContent
            break
        }
    }
}

# Keep this script process active indefinitely so child processes stay alive
while ($true) {
    Start-Sleep -Seconds 3600
}
