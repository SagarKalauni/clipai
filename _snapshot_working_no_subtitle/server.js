/**
 * ClipAI - Node.js Server v3
 * YouTube: tries to get direct stream URL via proxy (iOS client bypass)
 * Falls back to embed mode if blocked
 * File mode: full video serving with range support
 */

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const https      = require('https');
const http       = require('http');
const { spawn, execSync } = require('child_process');
const crypto     = require('crypto');
const multer     = require('multer');

const app    = express();
const PORT   = process.env.PORT || 8000;
const ROOT   = __dirname;
const TMPDIR = path.join(ROOT, 'tmp_videos');

if (!fs.existsSync(TMPDIR)) fs.mkdirSync(TMPDIR, { recursive: true });

// ── Find yt-dlp ───────────────────────────────────────────────
function findYtDlp() {
  const candidates = [
    path.join(ROOT, 'yt-dlp'),
    path.join(ROOT, 'yt-dlp.exe'),
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    'yt-dlp',
  ];
  for (const c of candidates) {
    try {
      if (c.includes('/') || c.includes('\\')) {
        if (fs.existsSync(c)) { console.log('yt-dlp:', c); return { cmd: c, args: [] }; }
      } else {
        execSync(`${c} --version`, { stdio: 'ignore', timeout: 5000 });
        return { cmd: c, args: [] };
      }
    } catch(e) {}
  }
  try { execSync('python3 -m yt_dlp --version', { stdio: 'ignore', timeout: 5000 }); return { cmd: 'python3', args: ['-m', 'yt_dlp'] }; } catch(e) {}
  return null;
}
const YTDLP = findYtDlp();

// ── CORS ──────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Find Whisper ─────────────────────────────────────────────
function findWhisper() {
  const candidates = ['whisper', '/usr/local/bin/whisper', '/usr/bin/whisper'];
  for (const c of candidates) {
    try { execSync(`${c} --help`, { stdio: 'ignore', timeout: 8000 }); return c; } catch(e) {}
  }
  // Try python -m whisper
  try { execSync('python3 -m whisper --help', { stdio: 'ignore', timeout: 8000 }); return '__python3__'; } catch(e) {}
  try { execSync('python -m whisper --help',  { stdio: 'ignore', timeout: 8000 }); return '__python__';  } catch(e) {}
  return null;
}
const WHISPER = findWhisper();
console.log('Whisper:', WHISPER || 'NOT FOUND (captions will be AI-generated)');

// ── Multer (audio upload for transcription) ───────────────────
const upload = multer({ dest: path.join(TMPDIR, 'audio_tmp/'), limits: { fileSize: 50 * 1024 * 1024 } });
const AUDIOTMP = path.join(TMPDIR, 'audio_tmp');
if (!fs.existsSync(AUDIOTMP)) fs.mkdirSync(AUDIOTMP, { recursive: true });

// ── Static files ──────────────────────────────────────────────
app.use(express.static(ROOT, { index: 'index.html' }));

// ── Serve local video files (range support) ───────────────────
app.get('/tmp_videos/:file', (req, res) => {
  const fp = path.join(TMPDIR, req.params.file);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  streamFile(req, res, fp);
});

// ── Transcribe audio → real word timestamps via Whisper ───────
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  const audioFile = req.file;
  if (!audioFile) return res.json({ ok: false, error: 'No audio', words: [] });

  const audioPath = audioFile.path;
  const startOffset = parseFloat(req.body.start || '0');
  const jsonOut = audioPath + '.json';

  try {
    if (!WHISPER) throw new Error('Whisper not installed on server');

    const whisperArgs = [
      audioPath,
      '--word_timestamps', 'True',
      '--output_format', 'json',
      '--model', 'tiny',
      '--output_dir', AUDIOTMP,
      '--language', 'auto',
      '--no_speech_threshold', '0.4',
      '--fp16', 'False'
    ];

    let cmd, args;
    if (WHISPER === '__python3__') { cmd = 'python3'; args = ['-m', 'whisper', ...whisperArgs]; }
    else if (WHISPER === '__python__') { cmd = 'python'; args = ['-m', 'whisper', ...whisperArgs]; }
    else { cmd = WHISPER; args = whisperArgs; }

    await runCmd(cmd, args, 180000);

    // Whisper outputs to {outputDir}/{baseName}.json
    const baseName = path.basename(audioPath);
    const outJson = path.join(AUDIOTMP, baseName + '.json');
    if (!fs.existsSync(outJson)) throw new Error('Whisper produced no output');

    const data = JSON.parse(fs.readFileSync(outJson, 'utf8'));
    fs.unlinkSync(outJson);

    // Extract word-level timestamps and offset by clip start time
    const words = [];
    for (const seg of (data.segments || [])) {
      for (const w of (seg.words || [])) {
        const text = (w.word || '').trim().toUpperCase().replace(/[^A-Z0-9''!?]/g, '');
        if (text.length > 0) {
          words.push({ word: text, start: startOffset + w.start, end: startOffset + w.end });
        }
      }
    }

    console.log(`Transcribed ${words.length} words (offset: ${startOffset}s)`);
    return res.json({ ok: true, words });

  } catch(err) {
    console.error('Transcription error:', err.message);
    return res.json({ ok: false, error: err.message, words: [] });
  } finally {
    // Cleanup uploaded audio
    try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch(e) {}
  }
});


// ── Proxy YouTube CDN stream ──────────────────────────────────
// Only proxies *.googlevideo.com (YouTube CDN) URLs for security
app.get('/proxy', (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).end('Missing url');
  let targetUrl;
  try { targetUrl = decodeURIComponent(raw); } catch(e) { return res.status(400).end('Bad url'); }
  if (!targetUrl.includes('googlevideo.com') && !targetUrl.includes('rr') ) {
    return res.status(403).end('Only YouTube CDN URLs allowed');
  }
  const parsed = new URL(targetUrl);
  const proto  = parsed.protocol === 'https:' ? https : http;
  const headers = {
    'User-Agent': 'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iPhone OS 17_5_1 like Mac OS X;)',
    'Referer': 'https://www.youtube.com/',
  };
  if (req.headers.range) headers['Range'] = req.headers.range;
  const proxyReq = proto.get(targetUrl, { headers }, upstream => {
    const status = upstream.statusCode || 200;
    const fwd = {};
    if (upstream.headers['content-type'])   fwd['Content-Type']   = upstream.headers['content-type'];
    if (upstream.headers['content-length']) fwd['Content-Length'] = upstream.headers['content-length'];
    if (upstream.headers['content-range'])  fwd['Content-Range']  = upstream.headers['content-range'];
    fwd['Accept-Ranges'] = 'bytes';
    fwd['Access-Control-Allow-Origin'] = '*';
    res.writeHead(status, fwd);
    upstream.pipe(res);
  });
  proxyReq.on('error', e => { console.error('Proxy error:', e.message); if (!res.headersSent) res.status(502).end(); });
  req.on('close', () => proxyReq.destroy());
});

// ── YouTube info + stream URL endpoint ───────────────────────
app.get('/api/youtube', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) return res.json({ error: 'Missing url' });

  // Extract YouTube ID
  const m = videoUrl.match(/(?:youtu\.be\/|watch\?v=|shorts\/)([A-Za-z0-9_-]{11})/);
  if (!m) return res.json({ error: 'Not a valid YouTube URL' });
  const ytId = m[1];

  console.log('YouTube:', ytId);

  // Get title via oEmbed (always works, no auth)
  let title = 'YouTube Video';
  let duration = 300;
  try {
    const oe = await httpGet(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`);
    const d  = JSON.parse(oe);
    if (d.title) title = d.title.slice(0, 80);
  } catch(e) { console.log('oEmbed failed:', e.message); }

  const subtitleWords = await getYouTubeSubtitles(videoUrl, ytId);

  // Try to get direct stream URL using iOS player client (bypasses bot detection in many cases)
  if (YTDLP) {
    // First try: get stream URL only (no download) with iOS client
    try {
      console.log('Trying iOS player client for stream URL...');
      const urlOut = await runCmd(YTDLP.cmd, [
        ...YTDLP.args,
        '--get-url',
        '--no-playlist',
        '-f', '18/best[ext=mp4][height<=480][vcodec!*=av01]/best[ext=mp4]/best',
        '--extractor-args', 'youtube:player_client=ios,android_vr',
        '--user-agent', 'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iPhone OS 17_5_1 like Mac OS X;)',
        videoUrl
      ], 45000);

      const streamUrl = urlOut.trim().split('\n').find(l => l.startsWith('http'));
      if (streamUrl && streamUrl.includes('googlevideo.com')) {
        console.log('Stream URL obtained! Using proxy mode.');
        // Get duration too
        try {
          const durOut = await runCmd(YTDLP.cmd, [...YTDLP.args, '--print', '%(duration)s', '--skip-download', '--no-playlist', videoUrl], 20000);
          const d = parseInt(durOut.trim(), 10);
          if (!isNaN(d) && d > 0) duration = d;
        } catch(e) {}

        const proxyUrl = '/proxy?url=' + encodeURIComponent(streamUrl);
        const safeTitle = title.replace(/["/\\:<>|?*]/g, ' ');
        return res.json({ title: safeTitle, ytId, duration, proxyUrl, subtitleWords, embedMode: false });
      }
    } catch(e) {
      console.log('iOS client stream URL failed:', e.message.slice(0, 120));
    }

    // Second try: actually download the file with iOS client
    const hash    = crypto.createHash('md5').update(videoUrl).digest('hex').slice(0, 12);
    const vidId   = `yt_${hash}`;
    const cached  = fs.readdirSync(TMPDIR).find(f => f.startsWith(vidId));
    if (cached) {
      console.log('Cache hit:', cached);
      duration = await getDuration(YTDLP, videoUrl) || duration;
      const safeTitle = title.replace(/["/\\:<>|?*]/g, ' ');
      return res.json({ title: safeTitle, ytId, duration, streamUrl: `/tmp_videos/${cached}`, subtitleWords, embedMode: false });
    }

    try {
      console.log('Trying full download with iOS client...');
      const outTpl = path.join(TMPDIR, `${vidId}.%(ext)s`);
      await runCmd(YTDLP.cmd, [
        ...YTDLP.args,
        '--no-playlist',
        '-f', '18/best[ext=mp4][height<=480]/best[ext=mp4]/best',
        '--extractor-args', 'youtube:player_client=ios,android_vr',
        '--user-agent', 'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iPhone OS 17_5_1 like Mac OS X;)',
        '--output', outTpl,
        '--no-part',
        videoUrl
      ], 180000);

      const file = fs.readdirSync(TMPDIR).find(f => f.startsWith(vidId));
      if (file) {
        const mb = (fs.statSync(path.join(TMPDIR, file)).size / 1e6).toFixed(1);
        console.log(`Downloaded: ${file} (${mb} MB)`);
        duration = await getDuration(YTDLP, videoUrl) || duration;
        const safeTitle = title.replace(/["/\\:<>|?*]/g, ' ');
        return res.json({ title: safeTitle, ytId, duration, streamUrl: `/tmp_videos/${file}`, subtitleWords, embedMode: false });
      }
    } catch(e) {
      console.log('Full download failed:', e.message.slice(0, 120));
    }
  }

  // All attempts failed — use embed mode (preview only)
  console.log('Using YouTube embed mode (no download available).');
  const safeTitle = title.replace(/["/\\:<>|?*]/g, ' ');
  return res.json({ title: safeTitle, ytId, duration, embedMode: true, streamUrl: null, subtitleWords });
});

// ── Helpers ───────────────────────────────────────────────────
async function getDuration(ytdlp, url) {
  try {
    const o = await runCmd(ytdlp.cmd, [...ytdlp.args, '--print', '%(duration)s', '--skip-download', '--no-playlist', url], 20000);
    const d = parseInt(o.trim(), 10);
    return isNaN(d) ? null : d;
  } catch(e) { return null; }
}

function parseVtt(vttContent) {
  const words = [];
  const blocks = vttContent.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const timeLine = lines.find(l => l.includes('-->'));
    if (timeLine) {
      const timeMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/);
      if (timeMatch) {
        const startSec = parseInt(timeMatch[1], 10) * 3600 + parseInt(timeMatch[2], 10) * 60 + parseInt(timeMatch[3], 10) + parseInt(timeMatch[4], 10) / 1000;
        const endSec = parseInt(timeMatch[5], 10) * 3600 + parseInt(timeMatch[6], 10) * 60 + parseInt(timeMatch[7], 10) + parseInt(timeMatch[8], 10) / 1000;
        
        const textIdx = lines.indexOf(timeLine) + 1;
        if (textIdx < lines.length) {
          const cleanText = lines.slice(textIdx).join(' ').replace(/<[^>]+>/g, '').trim();
          const splitWords = cleanText.split(/\s+/);
          const duration = endSec - startSec;
          const wordDur = duration / (splitWords.length || 1);
          splitWords.forEach((word, wIdx) => {
            const wordClean = word.toUpperCase().replace(/[^A-Z0-9''!?]/g, '');
            if (wordClean) {
              words.push({
                word: wordClean,
                start: parseFloat((startSec + wIdx * wordDur).toFixed(3)),
                end: parseFloat((startSec + (wIdx + 1) * wordDur - 0.02).toFixed(3))
              });
            }
          });
        }
      }
    }
  }
  return words;
}

async function getYouTubeSubtitles(videoUrl, ytId) {
  if (!YTDLP) return [];
  try {
    console.log('Fetching YouTube subtitles...');
    const subPrefix = path.join(TMPDIR, `sub_${ytId}`);
    
    // Command to download auto-subtitles in vtt format
    await runCmd(YTDLP.cmd, [
      ...YTDLP.args,
      '--write-auto-subs',
      '--sub-langs', 'en',
      '--skip-download',
      '--output', subPrefix,
      videoUrl
    ], 35000);

    const expectedFile = path.join(TMPDIR, `sub_${ytId}.en.vtt`);
    if (fs.existsSync(expectedFile)) {
      const vttContent = fs.readFileSync(expectedFile, 'utf8');
      fs.unlinkSync(expectedFile); // Clean up immediately
      return parseVtt(vttContent);
    }
  } catch (e) {
    console.log('Failed to fetch YouTube subtitles:', e.message);
  }
  return [];
}


function streamFile(req, res, fp) {
  try {
    const ext   = path.extname(fp).toLowerCase();
    const ct    = ext === '.webm' ? 'video/webm' : 'video/mp4';
    const total = fs.statSync(fp).size;
    const range = req.headers.range;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', ct);
    if (range) {
      const [s, e] = range.replace(/bytes=/, '').split('-');
      const start  = parseInt(s, 10);
      const end    = e ? parseInt(e, 10) : total - 1;
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(fp, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': total });
      fs.createReadStream(fp).pipe(res);
    }
  } catch(e) { if (!res.headersSent) res.status(500).end(); }
}

function runCmd(cmd, args, timeout = 60000) {
  return new Promise((resolve, reject) => {
    let out = '', err = '';
    const proc  = spawn(cmd, args, { shell: false });
    const timer = setTimeout(() => { proc.kill(); reject(new Error('Timeout')); }, timeout);
    proc.stdout.on('data', d => { out += d; process.stdout.write(d); });
    proc.stderr.on('data', d => { err += d; process.stderr.write(d); });
    proc.on('close', code => { clearTimeout(timer); (code === 0 || out.trim()) ? resolve(out) : reject(new Error(err.slice(0, 300))); });
    proc.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(d)); }).on('error', reject);
  });
}

// Cleanup (keep last 8 files)
setInterval(() => {
  try {
    const files = fs.readdirSync(TMPDIR).map(f => ({ f, t: fs.statSync(path.join(TMPDIR, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    files.slice(8).forEach(({ f }) => fs.unlinkSync(path.join(TMPDIR, f)));
  } catch(e) {}
}, 3600000);

app.get('*', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.listen(PORT, () => console.log(`ClipAI v3 running at http://localhost:${PORT}`));
