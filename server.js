/**
 * ClipAI Node.js Server - Full parity with server.ps1
 * Strategy: Use yt-dlp to extract CDN URL, then download file directly via Node.js HTTPS
 * This reliably works from datacenter IPs because the CDN URL is IP-signed.
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
  const files = [
    path.join(ROOT, 'yt-dlp'),
    path.join(ROOT, 'yt-dlp.exe'),
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    'yt-dlp',
  ];
  for (const f of files) {
    try {
      if (f.includes('/') || f.includes('\\')) {
        if (fs.existsSync(f)) {
          try { execSync(`chmod +x "${f}"`, { stdio: 'ignore', timeout: 3000 }); } catch(e) {}
          console.log('yt-dlp:', f);
          return { cmd: f, args: [] };
        }
      } else {
        execSync(`${f} --version`, { stdio: 'ignore', timeout: 5000 });
        return { cmd: f, args: [] };
      }
    } catch(e) {}
  }
  try { execSync('python3 -m yt_dlp --version', { stdio: 'ignore', timeout: 5000 }); return { cmd: 'python3', args: ['-m', 'yt_dlp'] }; } catch(e) {}
  return null;
}
const YTDLP = findYtDlp();
console.log('YTDLP:', YTDLP ? `${YTDLP.cmd} ${YTDLP.args.join(' ')}` : 'NOT FOUND');

// ── Cookies (optional, helps with cloud IP bypass) ───────────
const COOKIES_FILE = path.join(ROOT, 'cookies.txt');
const hasCookies   = fs.existsSync(COOKIES_FILE);
if (hasCookies) console.log('cookies.txt found');

function baseArgs() {
  const a = [...(YTDLP ? YTDLP.args : [])];
  if (hasCookies) a.push('--cookies', COOKIES_FILE);
  return a;
}

// ── CORS ──────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Multer ────────────────────────────────────────────────────
const AUDIOTMP = path.join(TMPDIR, 'audio_tmp');
if (!fs.existsSync(AUDIOTMP)) fs.mkdirSync(AUDIOTMP, { recursive: true });
const upload = multer({ dest: AUDIOTMP + '/', limits: { fileSize: 50 * 1024 * 1024 } });

// ── Static Files ──────────────────────────────────────────────
app.use(express.static(ROOT, { index: 'index.html' }));

// ── Serve Downloaded Videos ───────────────────────────────────
app.get('/tmp_videos/:file', (req, res) => {
  const fp = path.join(TMPDIR, req.params.file);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });
  streamFile(req, res, fp);
});

// ── Proxy YouTube CDN (fallback) ──────────────────────────────
app.get('/proxy', (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).end('Missing url');
  let targetUrl;
  try { targetUrl = decodeURIComponent(raw); } catch(e) { return res.status(400).end('Bad url'); }
  if (!targetUrl.includes('googlevideo.com')) return res.status(403).end('Forbidden');

  // Detect client from URL (c= param) and use matching User-Agent
  const clientMatch = targetUrl.match(/[?&]c=([A-Z_]+)/);
  const ytClient    = clientMatch ? clientMatch[1] : 'ANDROID_VR';
  const userAgent   = ytClient.includes('IOS')
    ? 'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iPhone OS 17_5_1 like Mac OS X;)'
    : 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip';

  const parsed = new URL(targetUrl);
  const proto  = parsed.protocol === 'https:' ? https : http;
  const headers = {
    'User-Agent': userAgent,
    'Referer': 'https://www.youtube.com/',
    'Origin': 'https://www.youtube.com',
  };
  if (req.headers.range) headers['Range'] = req.headers.range;

  const pr = proto.get(targetUrl, { headers }, up => {
    console.log('Proxy CDN status:', up.statusCode, 'for client:', ytClient);
    const fwd = {};
    ['content-type', 'content-length', 'content-range'].forEach(h => { if (up.headers[h]) fwd[h] = up.headers[h]; });
    fwd['Accept-Ranges'] = 'bytes';
    fwd['Access-Control-Allow-Origin'] = '*';
    res.writeHead(up.statusCode || 200, fwd);
    up.pipe(res);
  });
  pr.on('error', e => { console.error('Proxy error:', e.message); if (!res.headersSent) res.status(502).end(); });
  req.on('close', () => pr.destroy());
});

// ── YouTube API ───────────────────────────────────────────────
app.get('/api/youtube', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) return res.json({ error: 'Missing url' });

  const m = videoUrl.match(/(?:youtu\.be\/|watch\?v=|shorts\/)([A-Za-z0-9_-]{11})/);
  if (!m) return res.json({ error: 'Not a valid YouTube URL' });
  const ytId = m[1];
  console.log('YouTube:', ytId);

  // Title
  let title = 'YouTube Video', duration = 300;
  try {
    const oe = await httpGet(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`);
    const d  = JSON.parse(oe);
    if (d.title) title = d.title.slice(0, 80);
  } catch(e) {}

  if (!YTDLP) {
    return res.json({ title, ytId, duration, embedMode: true, streamUrl: null, subtitleWords: [] });
  }

  // Cache check
  const hash   = crypto.createHash('md5').update(videoUrl).digest('hex').slice(0, 12);
  const vidId  = `yt_${hash}`;
  const cached = fs.readdirSync(TMPDIR).find(f => f.startsWith(vidId));
  if (cached) {
    console.log('Cache hit:', cached);
    duration = await getDuration(videoUrl) || duration;
    const subtitleWords = await getYouTubeSubtitles(videoUrl, ytId);
    return res.json({ title, ytId, duration, streamUrl: `/tmp_videos/${cached}`, subtitleWords, embedMode: false });
  }

  // Subtitles (non-blocking)
  const subtitleWords = await getYouTubeSubtitles(videoUrl, ytId);

  // === STEP 1: Extract CDN stream URL ===
  const clients = ['ios,android_vr', 'android_creator', 'android', 'mweb'];
  let cdnUrl = null, usedClient = null;

  for (const client of clients) {
    try {
      console.log('Extracting stream URL, client:', client);
      const out = await runCmd(YTDLP.cmd, [
        ...baseArgs(),
        '--get-url', '--no-playlist', '--no-check-certificates',
        '-f', '18/best[ext=mp4][height<=480]/best[ext=mp4]/best',
        '--extractor-args', `youtube:player_client=${client}`,
        videoUrl
      ], 25000);

      const url = out.trim().split('\n').find(l => l.startsWith('http') && l.includes('googlevideo.com'));
      if (url) { cdnUrl = url; usedClient = client; console.log('Got CDN URL via', client); break; }
    } catch(e) {
      console.log('Stream URL via', client, 'failed:', e.message.slice(0, 80));
    }
  }

  if (!cdnUrl) {
    console.log('All clients failed — embed mode');
    return res.json({ title, ytId, duration, embedMode: true, streamUrl: null, subtitleWords });
  }

  // Get duration
  try {
    const dur = await runCmd(YTDLP.cmd, [
      ...baseArgs(), '--print', '%(duration)s', '--skip-download',
      '--no-playlist', '--extractor-args', `youtube:player_client=${usedClient}`, videoUrl
    ], 15000);
    const d = parseInt(dur.trim(), 10);
    if (!isNaN(d) && d > 0) duration = d;
  } catch(e) {}

  // === STEP 2: Download file using the CDN URL directly via Node.js HTTPS ===
  // This is reliable because the CDN URL is signed for this server's IP,
  // so the CDN accepts downloads from this same IP.
  const outFile = path.join(TMPDIR, `${vidId}.mp4`);
  try {
    console.log('Downloading video from CDN URL...');
    await downloadUrl(cdnUrl, outFile, usedClient);
    const mb = (fs.statSync(outFile).size / 1e6).toFixed(1);
    console.log(`Downloaded: ${vidId}.mp4 (${mb} MB)`);
    return res.json({ title, ytId, duration, streamUrl: `/tmp_videos/${vidId}.mp4`, subtitleWords, embedMode: false });
  } catch(e) {
    console.log('CDN download failed:', e.message.slice(0, 120));
    // Clean up partial file
    try { if (fs.existsSync(outFile)) fs.unlinkSync(outFile); } catch(ex) {}
  }

  // === STEP 3: Proxy stream as last resort ===
  console.log('Falling back to proxy stream');
  const proxyUrl = '/proxy?url=' + encodeURIComponent(cdnUrl);
  return res.json({ title, ytId, duration, proxyUrl, subtitleWords, embedMode: false });
});

// ── Download a URL directly to a file using Node.js HTTPS ────
function downloadUrl(url, destFile, client = 'ANDROID_VR') {
  return new Promise((resolve, reject) => {
    const clientParam = (client || '').toUpperCase();
    const userAgent = clientParam.includes('IOS')
      ? 'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iPhone OS 17_5_1 like Mac OS X;)'
      : 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip';

    const parsed = new URL(url);
    const proto  = parsed.protocol === 'https:' ? https : http;

    const file = fs.createWriteStream(destFile);
    const timer = setTimeout(() => { file.destroy(); reject(new Error('Download timeout (120s)')); }, 120000);

    proto.get(url, {
      headers: {
        'User-Agent': userAgent,
        'Referer': 'https://www.youtube.com/',
        'Origin': 'https://www.youtube.com',
      }
    }, res => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        // Follow redirect
        clearTimeout(timer);
        file.destroy();
        downloadUrl(res.headers.location, destFile, client).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        clearTimeout(timer);
        file.destroy();
        reject(new Error(`CDN responded with HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { clearTimeout(timer); file.close(resolve); });
      file.on('error', e => { clearTimeout(timer); fs.unlink(destFile, () => {}); reject(e); });
    }).on('error', e => { clearTimeout(timer); file.destroy(); reject(e); });
  });
}

// ── VTT Subtitle Parsing ──────────────────────────────────────
function parseVtt(vttContent) {
  const words = [], blocks = vttContent.split(/\r?\n\r?\n/);
  let lastEnd = -1;
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const tl = lines.find(l => l.includes('-->'));
    if (!tl) continue;
    const mo = tl.match(/(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})/);
    if (!mo) continue;
    const s = +mo[1]*3600 + +mo[2]*60 + +mo[3] + +mo[4]/1000;
    const e = +mo[5]*3600 + +mo[6]*60 + +mo[7] + +mo[8]/1000;
    if (s < lastEnd - 0.05) continue;
    lastEnd = e;
    const txt = lines.slice(lines.indexOf(tl)+1).filter(l => l.trim() && !l.startsWith('NOTE')).join(' ').replace(/<[^>]+>/g,'').trim();
    const ws = txt.split(/\s+/).filter(Boolean);
    if (!ws.length) continue;
    const wd = (e - s) / ws.length;
    ws.forEach((w, i) => {
      const c = w.toUpperCase().replace(/[^A-Z0-9''!?]/g,'');
      if (c) words.push({ word: c, start: parseFloat((s+i*wd).toFixed(3)), end: parseFloat((s+(i+1)*wd-0.02).toFixed(3)) });
    });
  }
  const deduped = [];
  for (const w of words) {
    const p = deduped[deduped.length-1];
    if (p && p.word===w.word && Math.abs(p.start-w.start)<0.1) continue;
    deduped.push(w);
  }
  return deduped;
}

async function getYouTubeSubtitles(videoUrl, ytId) {
  if (!YTDLP) return [];
  try {
    const subPrefix = path.join(TMPDIR, `sub_${ytId}`);
    await runCmd(YTDLP.cmd, [
      ...baseArgs(),
      '--write-auto-subs', '--sub-langs', 'en.*,en',
      '--skip-download', '--no-playlist', '--no-check-certificates',
      '--output', subPrefix, videoUrl
    ], 30000).catch(() => {});
    const vttFiles = fs.readdirSync(TMPDIR).filter(f => f.startsWith(`sub_${ytId}`) && f.endsWith('.vtt'));
    if (vttFiles.length > 0) {
      const content = fs.readFileSync(path.join(TMPDIR, vttFiles[0]), 'utf8');
      vttFiles.forEach(f => { try { fs.unlinkSync(path.join(TMPDIR, f)); } catch(ex){} });
      const parsed = parseVtt(content);
      console.log(`Subtitles: ${parsed.length} words`);
      return parsed;
    }
  } catch(e) {}
  return [];
}

async function getDuration(url) {
  try {
    const o = await runCmd(YTDLP.cmd, [...baseArgs(), '--print', '%(duration)s', '--skip-download', '--no-playlist', url], 15000);
    const d = parseInt(o.trim(), 10);
    return isNaN(d) ? null : d;
  } catch(e) { return null; }
}

// ── Helpers ───────────────────────────────────────────────────
function streamFile(req, res, fp) {
  try {
    const ct    = fp.endsWith('.webm') ? 'video/webm' : 'video/mp4';
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
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    proc.on('close', code => {
      clearTimeout(timer);
      (code === 0 || out.trim()) ? resolve(out) : reject(new Error(err.slice(0, 500)));
    });
    proc.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(d)); }).on('error', reject);
  });
}

// Cleanup old temp files
setInterval(() => {
  try {
    const files = fs.readdirSync(TMPDIR)
      .filter(f => !fs.statSync(path.join(TMPDIR, f)).isDirectory())
      .map(f => ({ f, t: fs.statSync(path.join(TMPDIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    files.slice(8).forEach(({ f }) => { try { fs.unlinkSync(path.join(TMPDIR, f)); } catch(e){} });
  } catch(e) {}
}, 3600000);

app.get('*', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.listen(PORT, () => console.log(`ClipAI running on port ${PORT}`));
