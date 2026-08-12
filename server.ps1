# ClipAI Server - HTTP server with yt-dlp YouTube download support
# Usage: powershell -ExecutionPolicy Bypass -File server.ps1

$port   = 8000
$root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ytdlp  = Join-Path $root "yt-dlp.exe"
$tmpDir = Join-Path $root "tmp_videos"

if (-not (Test-Path $tmpDir)) {
    New-Item -ItemType Directory -Path $tmpDir | Out-Null
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
try { $listener.Prefixes.Add("http://127.0.0.1:$port/") } catch {}
$listener.Start()

Write-Host "ClipAI server running at http://localhost:$port" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray

$mimeMap = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.mp4'  = 'video/mp4'
    '.webm' = 'video/webm'
    '.mkv'  = 'video/webm'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.ico'  = 'image/x-icon'
}

function SendJson {
    param($ctx, $json)
    try {
        $ctx.Response.StatusCode = 200
        $ctx.Response.ContentType = 'application/json; charset=utf-8'
        $ctx.Response.Headers.Add('Access-Control-Allow-Origin', '*')
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $ctx.Response.OutputStream.Close()
    } catch {}
}

function Get-YouTubeSubtitles {
    param ($videoUrl, $vidId)
    $subPrefix = Join-Path $tmpDir "sub_$vidId"
    
    # Run yt-dlp to download auto subs — try en.* first then en
    & $ytdlp --write-auto-subs --sub-langs "en.*" --skip-download --no-playlist --output $subPrefix $videoUrl 2>&1 | Out-Null
    
    # Find any VTT file matching this video ID (handles en, en-US, en-GB, etc.)
    $vttFiles = Get-ChildItem $tmpDir -Filter "sub_$($vidId)*.vtt" -ErrorAction SilentlyContinue
    if (-not $vttFiles) {
        # Fallback: try just 'en'
        & $ytdlp --write-auto-subs --sub-langs en --skip-download --no-playlist --output $subPrefix $videoUrl 2>&1 | Out-Null
        $vttFiles = Get-ChildItem $tmpDir -Filter "sub_$($vidId)*.vtt" -ErrorAction SilentlyContinue
    }
    
    $words = @()
    $lastEnd = -1.0
    
    if ($vttFiles) {
        $vttFile = $vttFiles | Select-Object -First 1
        $content = Get-Content $vttFile.FullName -Raw
        Remove-Item $vttFile.FullName -ErrorAction SilentlyContinue
        
        # Parse VTT content split by double newlines
        $blocks = $content -split "(?:\r?\n){2,}"
        foreach ($block in $blocks) {
            $lines = $block -split "\r?\n"
            $timeLine = $lines | Where-Object { $_ -like "*-->*" } | Select-Object -First 1
            if ($timeLine) {
                if ($timeLine -match "(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})") {
                    $startSec = [double]$Matches[1] * 3600 + [double]$Matches[2] * 60 + [double]$Matches[3] + [double]$Matches[4] / 1000.0
                    $endSec   = [double]$Matches[5] * 3600 + [double]$Matches[6] * 60 + [double]$Matches[7] + [double]$Matches[8] / 1000.0
                    
                    # Skip rolling-window duplicate cues
                    if ($startSec -lt ($lastEnd - 0.05)) { continue }
                    $lastEnd = $endSec
                    
                    $textLines = @()
                    $idx = [Array]::IndexOf($lines, $timeLine) + 1
                    while ($idx -lt $lines.Length) {
                        $textLines += $lines[$idx]
                        $idx++
                    }
                    $cleanText = ($textLines -join " " -replace "<[^>]+>", "").Trim()
                    $splitWords = ($cleanText -split "\s+") | Where-Object { $_.Length -gt 0 }
                    if ($splitWords.Count -eq 0) { continue }
                    $duration = $endSec - $startSec
                    $wordDur = $duration / [Math]::Max(1, $splitWords.Count)
                    
                    for ($wIdx = 0; $wIdx -lt $splitWords.Count; $wIdx++) {
                        $wordClean = ($splitWords[$wIdx] -replace "[^A-Za-z0-9''!?]", "").ToUpper()
                        if ($wordClean.Length -gt 0) {
                            $words += @{
                                word  = $wordClean
                                start = [Math]::Round(($startSec + $wIdx * $wordDur), 3)
                                end   = [Math]::Round(($startSec + ($wIdx + 1) * $wordDur - 0.02), 3)
                            }
                        }
                    }
                }
            }
        }
        Write-Host "  Subtitle words parsed: $($words.Count)" -ForegroundColor Cyan
    } else {
        Write-Host "  No VTT subtitle file found for $vidId" -ForegroundColor DarkGray
    }
    return $words
}

function SendFile {
    param($ctx, $filePath)
    try {
        $ext  = [System.IO.Path]::GetExtension($filePath).ToLower()
        $ct   = if ($mimeMap.ContainsKey($ext)) { $mimeMap[$ext] } else { 'application/octet-stream' }
        $data = [System.IO.File]::ReadAllBytes($filePath)
        $ctx.Response.StatusCode = 200
        $ctx.Response.ContentType = $ct
        $ctx.Response.Headers.Add('Access-Control-Allow-Origin', '*')
        $ctx.Response.ContentLength64 = $data.Length
        $ctx.Response.OutputStream.Write($data, 0, $data.Length)
        $ctx.Response.OutputStream.Close()
    } catch {}
}

function SendVideoStream {
    param($ctx, $filePath)
    try {
        $ext     = [System.IO.Path]::GetExtension($filePath).ToLower()
        $ct      = if ($mimeMap.ContainsKey($ext)) { $mimeMap[$ext] } else { 'video/mp4' }
        $fileLen = (Get-Item $filePath).Length
        $range   = $ctx.Request.Headers['Range']

        $ctx.Response.ContentType = $ct
        $ctx.Response.Headers.Add('Access-Control-Allow-Origin', '*')
        $ctx.Response.Headers.Add('Accept-Ranges', 'bytes')

        $fs = [System.IO.File]::OpenRead($filePath)
        try {
            if ($range -and $range -match 'bytes=(\d*)-(\d*)') {
                $from = if ($Matches[1] -ne '') { [long]$Matches[1] } else { 0 }
                $to   = if ($Matches[2] -ne '') { [long]$Matches[2] } else { $fileLen - 1 }
                if ($to -ge $fileLen) { $to = $fileLen - 1 }
                $len  = $to - $from + 1
                $ctx.Response.StatusCode = 206
                $ctx.Response.Headers.Add('Content-Range', "bytes $from-$to/$fileLen")
                $ctx.Response.ContentLength64 = $len
                $fs.Seek($from, [System.IO.SeekOrigin]::Begin) | Out-Null
                $buf = New-Object byte[] 65536
                $rem = $len
                while ($rem -gt 0) {
                    $rd = $fs.Read($buf, 0, [Math]::Min($buf.Length, $rem))
                    if ($rd -le 0) { break }
                    $ctx.Response.OutputStream.Write($buf, 0, $rd)
                    $rem -= $rd
                }
            } else {
                $ctx.Response.StatusCode = 200
                $ctx.Response.ContentLength64 = $fileLen
                $buf = New-Object byte[] 65536
                $rd  = 0
                while (($rd = $fs.Read($buf, 0, $buf.Length)) -gt 0) {
                    $ctx.Response.OutputStream.Write($buf, 0, $rd)
                }
            }
        } finally {
            $fs.Close()
            $ctx.Response.OutputStream.Close()
        }
    } catch {}
}

while ($listener.IsListening) {
    try {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $url = $req.Url.AbsolutePath

        # Handle OPTIONS preflight
        if ($req.HttpMethod -eq 'OPTIONS') {
            $ctx.Response.StatusCode = 200
            $ctx.Response.Headers.Add('Access-Control-Allow-Origin', '*')
            $ctx.Response.Headers.Add('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            $ctx.Response.Headers.Add('Access-Control-Allow-Headers', '*')
            $ctx.Response.OutputStream.Close()
            continue
        }

        Write-Host "$($req.HttpMethod) $url" -ForegroundColor DarkGray

        # YouTube API endpoint
        if ($url -eq '/api/youtube') {
            $videoUrl = $req.QueryString['url']
            if (-not $videoUrl) {
                SendJson $ctx '{"error":"Missing url parameter"}'
                continue
            }

            Write-Host "  Fetching: $videoUrl" -ForegroundColor Yellow

            # Generate unique file ID
            $hash  = [Math]::Abs($videoUrl.GetHashCode()).ToString()
            $vidId = "yt_$hash"

            # Extract YouTube ID
            $ytId = $null
            if ($videoUrl -match '(?:youtu\.be\/|watch\?v=|shorts\/)([A-Za-z0-9_-]{11})') {
                $ytId = $Matches[1]
            } else {
                $ytId = $vidId
            }

            # Check cache first
            $cached = Get-ChildItem $tmpDir -Filter "$vidId.*" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($cached) {
                Write-Host "  Cached: $($cached.Name)" -ForegroundColor Green
                $relPath = "/tmp_videos/$($cached.Name)"
                $subs = Get-YouTubeSubtitles $videoUrl $ytId
                $respObj = @{ title = "YouTube Video"; streamUrl = $relPath; ytId = $ytId; subtitleWords = $subs; embedMode = $false }
                SendJson $ctx ($respObj | ConvertTo-Json -Depth 5)
                continue
            }

            # Get video title
            $title = 'YouTube Video'
            try {
                $titleOut = & $ytdlp --get-title --no-playlist $videoUrl 2>$null
                if ($titleOut) {
                    $title = ($titleOut -join '').Trim()
                    if ($title.Length -gt 80) { $title = $title.Substring(0, 80) }
                }
            } catch {}
            Write-Host "  Title: $title" -ForegroundColor Cyan

            # Fetch subtitles
            $subs = Get-YouTubeSubtitles $videoUrl $ytId

            # Download video (format 18 = 360p mp4, no ffmpeg needed)
            $outTemplate = Join-Path $tmpDir "$vidId.%(ext)s"
            Write-Host "  Downloading..." -ForegroundColor Yellow

            $dlOutput = & $ytdlp `
                --no-playlist `
                -f "18/best[ext=mp4][height<=480]/best[ext=mp4]/best" `
                --output $outTemplate `
                --no-part `
                $videoUrl 2>&1

            $file = Get-ChildItem $tmpDir -Filter "$vidId.*" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($file) {
                $sizeMB   = [Math]::Round($file.Length / 1MB, 1)
                $safeTitle = $title -replace '["\\/:<>|?*]', ' '
                Write-Host "  Done: $($file.Name) ($sizeMB MB)" -ForegroundColor Green
                $relPath = "/tmp_videos/$($file.Name)"
                $respObj = @{ title = $safeTitle; streamUrl = $relPath; ytId = $ytId; subtitleWords = $subs; embedMode = $false }
                SendJson $ctx ($respObj | ConvertTo-Json -Depth 5)
            } else {
                Write-Host "  Download FAILED" -ForegroundColor Red
                Write-Host ($dlOutput -join "`n") -ForegroundColor DarkGray
                # Fallback to embed mode with subtitles
                $respObj = @{ error = "Download failed. Using YouTube embed."; streamUrl = $null; ytId = $ytId; subtitleWords = $subs; embedMode = $true }
                SendJson $ctx ($respObj | ConvertTo-Json -Depth 5)
            }
            continue
        }

        # Serve downloaded video files with range support
        if ($url -match '^/tmp_videos/(.+)$') {
            $fname = $Matches[1]
            $fpath = Join-Path $tmpDir $fname
            if (Test-Path $fpath -PathType Leaf) {
                Write-Host "  Streaming: $fname" -ForegroundColor DarkGray
                SendVideoStream $ctx $fpath
            } else {
                SendJson $ctx '{"error":"File not found"}'
            }
            continue
        }

        # Transcription endpoint — POST /api/transcribe
        if ($url -eq '/api/transcribe' -and $req.HttpMethod -eq 'POST') {
            try {
                # Read multipart body
                $body     = $ctx.Request.InputStream
                $bodyBytes = New-Object byte[] $ctx.Request.ContentLength64
                $read = 0
                while ($read -lt $bodyBytes.Length) {
                    $chunk = $body.Read($bodyBytes, $read, $bodyBytes.Length - $read)
                    if ($chunk -eq 0) { break }
                    $read += $chunk
                }

                # Save raw body to temp file, then extract WAV
                $boundary  = ($ctx.Request.ContentType -split 'boundary=')[1].Trim()
                $tempRaw   = Join-Path $tmpDir "raw_$(Get-Random).bin"
                $tempWav   = Join-Path $tmpDir "audio_$(Get-Random).wav"
                [System.IO.File]::WriteAllBytes($tempRaw, $bodyBytes)

                # Extract WAV from multipart using string search
                $bodyStr = [System.Text.Encoding]::Latin1.GetString($bodyBytes)
                $wavHeader  = [System.Text.Encoding]::Latin1.GetString([byte[]]@(82,73,70,70)) # "RIFF"
                $wavStart   = $bodyStr.IndexOf("RIFF")
                if ($wavStart -lt 0) {
                    # Try to find after Content-Type header
                    $ctIdx = $bodyStr.IndexOf("audio/wav")
                    if ($ctIdx -ge 0) { $wavStart = $bodyStr.IndexOf("`r`n`r`n", $ctIdx) + 4 }
                }

                if ($wavStart -ge 0) {
                    $wavBytes = $bodyBytes[$wavStart..($bodyBytes.Length - 1)]
                    [System.IO.File]::WriteAllBytes($tempWav, $wavBytes)
                } else {
                    # No header boundary — treat whole body as WAV
                    [System.IO.File]::WriteAllBytes($tempWav, $bodyBytes)
                }
                Remove-Item $tempRaw -ErrorAction SilentlyContinue

                # Find whisper
                $whisperCmd = $null
                $testWh = Get-Command whisper -ErrorAction SilentlyContinue
                if ($testWh) { $whisperCmd = 'whisper' }
                else {
                    $testPy = Get-Command python -ErrorAction SilentlyContinue
                    if ($testPy) {
                        $pyTest = & python -c "import whisper; print('ok')" 2>$null
                        if ($pyTest -eq 'ok') { $whisperCmd = 'python_whisper' }
                    }
                }

                if (-not $whisperCmd) {
                    Remove-Item $tempWav -ErrorAction SilentlyContinue
                    SendJson $ctx '{"ok":false,"error":"Whisper not installed. Run: pip install openai-whisper","words":[]}'
                    continue
                }

                # Run whisper
                $whisperOut = Join-Path $tmpDir "whisper_out"
                if (-not (Test-Path $whisperOut)) { New-Item -ItemType Directory -Path $whisperOut | Out-Null }
                $whisperArgs = @($tempWav, '--word_timestamps', 'True', '--output_format', 'json', '--model', 'tiny', '--output_dir', $whisperOut, '--language', 'auto', '--fp16', 'False')

                if ($whisperCmd -eq 'python_whisper') {
                    $wOut = & python -m whisper @whisperArgs 2>&1
                } else {
                    $wOut = & whisper @whisperArgs 2>&1
                }

                $baseName  = [System.IO.Path]::GetFileNameWithoutExtension($tempWav)
                $jsonPath  = Join-Path $whisperOut "$baseName.json"
                Remove-Item $tempWav -ErrorAction SilentlyContinue

                if (-not (Test-Path $jsonPath)) {
                    SendJson $ctx '{"ok":false,"error":"Whisper produced no output","words":[]}'
                    continue
                }

                $whisperData = Get-Content $jsonPath -Raw | ConvertFrom-Json
                Remove-Item $jsonPath -ErrorAction SilentlyContinue

                $words = @()
                foreach ($seg in $whisperData.segments) {
                    foreach ($w in $seg.words) {
                        $text = ($w.word -replace '[^A-Za-z0-9''!?]', '').ToUpper().Trim()
                        if ($text.Length -gt 0) {
                            $words += @{ word = $text; start = [double]$w.start; end = [double]$w.end }
                        }
                    }
                }

                $jsonOut = @{ ok = $true; words = $words } | ConvertTo-Json -Depth 5
                SendJson $ctx $jsonOut
            } catch {
                SendJson $ctx "{`"ok`":false,`"error`":`"$($_.Exception.Message)`",`"words`":[]}"
            }
            continue
        }


        # Serve static files
        $relPath  = $url.TrimStart('/')
        if ($relPath -eq '') { $relPath = 'index.html' }
        $fullPath = Join-Path $root $relPath

        if (Test-Path $fullPath -PathType Leaf) {
            SendFile $ctx $fullPath
        } else {
            SendFile $ctx (Join-Path $root 'index.html')
        }

    } catch {
        $msg = $_.Exception.Message
        if ($msg -notmatch 'canceled|abort|thread') {
            Write-Host ('  Server error: ' + $msg) -ForegroundColor Red
        }
    }
}
