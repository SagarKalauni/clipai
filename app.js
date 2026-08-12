'use strict';
/**
 * ClipAI – App Controller v4
 * Real captions via Whisper (server-side) when video is available
 * YouTube embed mode falls back to AI-generated word bank
 */

const $  = id => document.getElementById(id);
const $$ = s  => document.querySelectorAll(s);
const fmt = s => { s=+s||0; return `${Math.floor(s/60)}:${(Math.floor(s%60)+'').padStart(2,'0')}`; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── State ────────────────────────────────────────────────────
let SRC='', TITLE='', DUR=0, CLIPS=[], ACTIVE=null, FILTER=0, PLAYING=false, YT_SUBS=[];
let YTID=null, EMBED_MODE=false, YT_PLAYER=null;

const VID = $('srcVid');
const CVS = $('studioCanvas');
const R   = new Renderer(CVS, VID);
const E   = new Exporter(CVS, VID);

// ── Screens ──────────────────────────────────────────────────
function show(id) { $$('.screen').forEach(s => s.classList.remove('show')); $(id).classList.add('show'); }

// ── Tabs ─────────────────────────────────────────────────────
$$('.ict').forEach(t => t.addEventListener('click', () => {
  $$('.ict').forEach(x => x.classList.remove('on'));
  $$('.ic-panel').forEach(x => x.classList.remove('on'));
  t.classList.add('on'); $(t.dataset.tab).classList.add('on');
}));

// ── Input handlers ───────────────────────────────────────────
$('btnGo').addEventListener('click', go);
$('urlIn').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
$$('[data-sample]').forEach(b => b.addEventListener('click', () => {
  $('urlIn').value = b.dataset.sample;
  document.querySelector('.ict[data-tab="tYT"]').click();
  go();
}));

async function go() {
  const url = $('urlIn').value.trim();
  if (!url) { shake($('urlIn')); toast('Paste a YouTube link first!', 'warn'); return; }

  const isDirect = /\.(mp4|webm|mov|mkv)(\?.*)?$/i.test(url);
  if (isDirect) { await loadFile(url, nameFromURL(url)); return; }

  show('sProcess'); stepUI(1, 'Fetching video info…'); prog(15);

  try {
    const r = await fetch('/api/youtube?url=' + encodeURIComponent(url), { signal: AbortSignal.timeout(240000) });
    if (!r.ok) throw new Error('Server error ' + r.status);
    const d = await r.json();
    if (d.error && !d.ytId) throw new Error(d.error);

    YTID = d.ytId || null;
    YT_SUBS = d.subtitleWords || [];

    if (!d.embedMode && (d.streamUrl || d.proxyUrl)) {
      stepUI(2, 'Video ready — finding viral moments…'); prog(55);
      const src = d.proxyUrl
        ? (window.location.origin + d.proxyUrl)
        : (d.streamUrl.startsWith('http') ? d.streamUrl : window.location.origin + d.streamUrl);
      await loadFile(src, d.title || 'YouTube Short', d.duration);
    } else {
      stepUI(2, 'Finding viral moments…'); prog(55);
      await loadEmbed(d.ytId, d.title || 'YouTube Short', d.duration || 300);
    }
  } catch(err) {
    const ytId = extractYTId(url);
    if (ytId) {
      stepUI(2, 'Finding viral moments…'); prog(55);
      await loadEmbed(ytId, 'YouTube Video', 300);
    } else {
      show('sHome');
      toast('❌ ' + (err.message || 'Failed'), 'err');
    }
  }
}

function extractYTId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
  return m ? m[1] : null;
}

// File upload / drop zone
$('fileIn').addEventListener('change', () => {
  const f = $('fileIn').files[0]; if (!f) return;
  YT_SUBS = [];
  loadFile(URL.createObjectURL(f), f.name.replace(/\.[^.]+$/, ''));
});
const DZ = $('dropZone');
['dragenter','dragover'].forEach(e => DZ.addEventListener(e, ev => { ev.preventDefault(); DZ.classList.add('over'); }));
['dragleave','drop'].forEach(e => DZ.addEventListener(e, ev => { ev.preventDefault(); DZ.classList.remove('over'); }));
DZ.addEventListener('drop', ev => {
  const f = ev.dataTransfer.files[0];
  if (f && f.type.startsWith('video/')) {
    YT_SUBS = [];
    loadFile(URL.createObjectURL(f), f.name.replace(/\.[^.]+$/, ''));
  }
});
DZ.addEventListener('click', () => $('fileIn').click());
$('btnCancelProc').addEventListener('click', () => show('sHome'));
$('btnNewVid').addEventListener('click', () => { R.stop(); VID.pause(); VID.src = ''; YT_SUBS = []; EMBED_MODE = false; YTID = null; show('sHome'); });

// ── Load: file mode ──────────────────────────────────────────
async function loadFile(src, title, knownDur) {
  YT_SUBS = [];
  show('sProcess'); stepUI(1, 'Loading video…'); prog(30);
  EMBED_MODE = false; SRC = src; TITLE = title || 'My Video';
  VID.src = src; VID.load();
  let ok = false;
  await new Promise(res => {
    const fn1 = () => { VID.removeEventListener('loadedmetadata', fn1); VID.removeEventListener('error', fn2); ok = true; res(); };
    const fn2 = () => { VID.removeEventListener('loadedmetadata', fn1); VID.removeEventListener('error', fn2); res(); };
    VID.addEventListener('loadedmetadata', fn1);
    VID.addEventListener('error', fn2);
    setTimeout(res, 60000);
  });
  if (!ok && !(isFinite(VID.duration) && VID.duration > 0)) {
    show('sHome'); toast('❌ Could not load video. Try uploading the file directly.', 'err'); return;
  }
  DUR = (isFinite(VID.duration) && VID.duration > 0) ? VID.duration : (knownDur || 60);
  await finishLoad();
}

// ── Load: embed mode ─────────────────────────────────────────
async function loadEmbed(ytId, title, duration) {
  EMBED_MODE = true; YTID = ytId; SRC = ''; TITLE = title; DUR = duration;
  VID.src = '';
  await finishLoad();
}

async function finishLoad() {
  stepUI(2, 'Detecting viral moments…'); prog(60); await sleep(300);
  stepUI(3, 'Generating captions…');      prog(80); await sleep(300);
  CLIPS = Clipper.generate(DUR, TITLE, YT_SUBS);
  stepUI(4, 'Done!'); prog(100); await sleep(250);
  $('viName').textContent = TITLE;
  $('viMeta').textContent = `${CLIPS.length} clips · ${fmt(DUR)}`;
  renderGrid();
  show('sClips');
}

// ── Process steps ─────────────────────────────────────────────
const STEP_LBL = ['Connected','Getting video info','Detecting viral moments','Generating captions','Done!'];
function stepUI(i, label) {
  for (let j = 0; j < 5; j++) {
    const el = $('st' + j); if (!el) continue;
    if (j < i)        el.className='step done',   el.innerHTML=`<i class="fa-solid fa-check-circle"></i> ${STEP_LBL[j]}`;
    else if (j === i) el.className='step active', el.innerHTML=`<i class="fa-solid fa-circle-notch"></i> ${label||STEP_LBL[j]}`;
    else              el.className='step',        el.innerHTML=`<i class="fa-regular fa-circle"></i> ${STEP_LBL[j]}`;
  }
  $('procSub').textContent = label || STEP_LBL[i];
}
function prog(p) { $('progFill').style.width = p + '%'; }

// ── Clips grid ───────────────────────────────────────────────
function renderGrid() {
  const g = $('clipsGrid'); g.innerHTML = '';
  const list = FILTER === 0 ? CLIPS : CLIPS.filter(c => c.dur === FILTER);
  if (!list.length) { g.innerHTML = '<p style="color:var(--muted);grid-column:1/-1;padding:32px;text-align:center">No clips for this duration.</p>'; return; }
  list.forEach(c => g.appendChild(makeCard(c)));
}
$$('.dp').forEach(b => b.addEventListener('click', () => { $$('.dp').forEach(x => x.classList.remove('on')); b.classList.add('on'); FILTER = +b.dataset.d; renderGrid(); }));

function makeCard(clip) {
  const d = document.createElement('div'); d.className = 'clip-card';
  const cap = clip.words.slice(0, 4).map(w => w.word).join(' ');

  if (EMBED_MODE && YTID) {
    d.innerHTML = `
      <div class="card-video" style="position:relative;overflow:hidden">
        <img src="https://img.youtube.com/vi/${YTID}/mqdefault.jpg" style="width:100%;height:100%;object-fit:cover">
        <div class="card-badges">
          <span class="score-badge ${clip.scoreClass}">${clip.virality>=90?'🔥':'⚡'} ${clip.virality}%</span>
          <span class="dur-badge">${clip.dur}s</span>
        </div>
        <div class="cap-strip">${cap}</div>
        <div class="card-ov"><button class="play-circle"><i class="fa-solid fa-play"></i></button></div>
      </div>
      <div class="card-info">
        <div class="card-title">${clip.title}</div>
        <div style="font-size:.7rem;color:var(--muted);margin:2px 0 8px">⏱ ${fmt(clip.start)} – ${fmt(clip.end)}</div>
        <div class="card-btns">
          <button class="cbtn cbtn-edit"><i class="fa-solid fa-sliders"></i> Edit</button>
          <button class="cbtn cbtn-dl"><i class="fa-solid fa-download"></i> Export</button>
        </div>
      </div>`;
    d.querySelector('.cbtn-edit').onclick = e => { e.stopPropagation(); openStudio(clip); };
    d.querySelector('.card-ov').onclick   = e => { e.stopPropagation(); openStudio(clip); };
    d.querySelector('.cbtn-dl').onclick   = e => { e.stopPropagation(); openStudio(clip, true); };
  } else {
    const v = document.createElement('video');
    v.src = SRC; v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'metadata';
    v.currentTime = clip.start + 0.5;
    d.addEventListener('mouseenter', () => { v.currentTime = clip.start; v.play().catch(() => {}); });
    d.addEventListener('mouseleave', () => { v.pause(); v.currentTime = clip.start + 0.5; });
    d.innerHTML = `
      <div class="card-video">
        <div class="card-badges">
          <span class="score-badge ${clip.scoreClass}">${clip.virality>=90?'🔥':'⚡'} ${clip.virality}%</span>
          <span class="dur-badge">${clip.dur}s</span>
        </div>
        <div class="cap-strip">${cap}</div>
        <div class="card-ov"><button class="play-circle"><i class="fa-solid fa-play"></i></button></div>
      </div>
      <div class="card-info">
        <div class="card-title">${clip.title}</div>
        <div style="font-size:.7rem;color:var(--muted);margin:2px 0 8px">⏱ ${fmt(clip.start)} – ${fmt(clip.end)}</div>
        <div class="card-btns">
          <button class="cbtn cbtn-edit"><i class="fa-solid fa-sliders"></i> Edit</button>
          <button class="cbtn cbtn-dl"><i class="fa-solid fa-download"></i> Export</button>
        </div>
      </div>`;
    d.querySelector('.card-video').insertBefore(v, d.querySelector('.card-badges'));
    d.querySelector('.cbtn-edit').onclick = e => { e.stopPropagation(); openStudio(clip); };
    d.querySelector('.card-ov').onclick   = e => { e.stopPropagation(); openStudio(clip); };
    d.querySelector('.cbtn-dl').onclick   = e => { e.stopPropagation(); openStudio(clip, true); };
  }
  return d;
}

// ── Studio Modal ─────────────────────────────────────────────
async function openStudio(clip, autoExport = false) {
  ACTIVE = clip; PLAYING = false;
  $('modalBg').classList.remove('hide');
  $('modalTitle').textContent = clip.title;
  $('trimS').value = clip.start.toFixed(1);
  $('trimE').value = clip.end.toFixed(1);
  $('tcEnd').textContent = fmt(clip.end - clip.start);
  $('tcNow').textContent = '0:00';
  $('seekBar').value = 0;
  resetExport();
  applyPreset('hormozi');
  $('hookText').value = R.style.hookText || 'WAIT TILL THE END 😱';
  $('fontSize').value = R.style.fontSize || 70;
  $('fontSizeVal').textContent = (R.style.fontSize || 70) + 'px';

  $('studioCanvas').style.display = 'block';
  $('btnDownload').style.display = 'flex';
  setCanvasSize('9:16');
  // Reset ratio buttons
  $$('.rb').forEach(x => x.classList.remove('on'));
  const rbDefault = document.querySelector('.rb[data-r="9:16"]'); if (rbDefault) rbDefault.classList.add('on');
  // Reset bg-style buttons to blur (default)
  R.style.bgStyle = 'blur';
  $$('.bg-btn').forEach(x => x.classList.remove('on'));
  const bgDefault = document.querySelector('.bg-btn[data-bg="blur"]'); if (bgDefault) bgDefault.classList.add('on');
  // Reset toggles
  R.style.showHook = true; R.style.showBar = true; R.style.showWm = true;
  const togHook = $('togHook'); if (togHook) togHook.checked = true;
  const togBar  = $('togBar');  if (togBar)  togBar.checked  = true;
  const togWM   = $('togWM');   if (togWM)   togWM.checked   = true;
  R.setRatio('9:16'); R.setClip(clip); R.start();
  VID.currentTime = clip.start;
  updatePlayBtn();

  // In embed mode: show YouTube iframe behind canvas for preview
  const existingIframe = $('ytEmbedFrame');
  if (existingIframe) existingIframe.remove();
  if (EMBED_MODE && YTID) {
    const startSec = Math.floor(clip.start);
    const iframe = document.createElement('iframe');
    iframe.id = 'ytEmbedFrame';
    iframe.src = `https://www.youtube.com/embed/${YTID}?start=${startSec}&autoplay=1&mute=1&controls=1&enablejsapi=0`;
    iframe.allow = 'autoplay; encrypted-media';
    iframe.allowFullscreen = true;
    iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:none;border-radius:10px;z-index:1;';
    const cvs = $('studioCanvas');
    cvs.style.zIndex = '2';
    cvs.style.position = 'relative';
    cvs.style.pointerEvents = 'none';
    cvs.parentElement.style.position = 'relative';
    cvs.parentElement.insertBefore(iframe, cvs);
  }


  // Transcribe real speech if not already done
  if (!clip._transcribed && SRC) {
    setTxStatus('<i class="fa-solid fa-circle-notch fa-spin"></i> Transcribing speech…', 'loading');
    try {
      const words = await Transcriber.transcribe(SRC, clip.start, clip.end,
        msg => setTxStatus(`<i class="fa-solid fa-circle-notch fa-spin"></i> ${msg}`, 'loading')
      );
      if (words && words.length >= 3) {
        clip.words = words;
        clip._transcribed = true;
        R.setClip(clip);
        setTxStatus(`<i class="fa-solid fa-check-circle"></i> Real captions: ${words.length} words`, 'ok');
      } else {
        setTxStatus('<i class="fa-solid fa-triangle-exclamation"></i> Using AI captions', 'warn');
      }
    } catch(e) {
      setTxStatus('<i class="fa-solid fa-triangle-exclamation"></i> Using AI captions', 'warn');
    }
  } else if (clip._transcribed) {
    setTxStatus(`<i class="fa-solid fa-check-circle"></i> Real captions: ${clip.words.length} words`, 'ok');
  }

  if (autoExport) setTimeout(doExport, 120);
}

// Transcript status bar
function setTxStatus(html, type) {
  const el = $('txStatus');
  if (!el) return;
  const colors = { loading:'#a5b4fc', ok:'#6ee7b7', warn:'#fbbf24' };
  el.style.color = colors[type] || '#94a3b8';
  el.innerHTML = html;
  el.style.display = 'flex';
}

function closeStudio() {
  $('modalBg').classList.add('hide');
  R.stop(); VID.pause(); PLAYING = false;
  const iframe = $('ytEmbedFrame');
  if (iframe) iframe.remove();
}
$('btnCloseModal').addEventListener('click', closeStudio);
$('modalBg').addEventListener('click', e => { if (e.target === $('modalBg')) closeStudio(); });

// ── Playback controls ─────────────────────────────────────────
function togglePlay() {
  if (!ACTIVE) return;
  if (VID.paused) { 
    if (VID.currentTime >= ACTIVE.end - 0.1) VID.currentTime = ACTIVE.start; 
    VID.play().catch(() => {}); 
    PLAYING = true; 
  } else { 
    VID.pause(); 
    PLAYING = false; 
  }
  updatePlayBtn();
}
function updatePlayBtn() { $('btnPlay').innerHTML = PLAYING ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>'; }
$('btnPlay').addEventListener('click', togglePlay);

VID.addEventListener('timeupdate', () => {
  if (!ACTIVE) return;
  const t = VID.currentTime;
  if (t >= ACTIVE.end) { VID.pause(); VID.currentTime = ACTIVE.start; PLAYING = false; updatePlayBtn(); return; }
  const p = (t - ACTIVE.start) / (ACTIVE.end - ACTIVE.start || 1);
  $('seekBar').value = Math.max(0, Math.min(100, p * 100));
  $('tcNow').textContent = fmt(t - ACTIVE.start);
});

$('seekBar').addEventListener('input', () => {
  if (!ACTIVE) return;
  const t = ACTIVE.start + (+$('seekBar').value / 100) * (ACTIVE.end - ACTIVE.start);
  VID.currentTime = t;
});

$('btnMute').addEventListener('click', () => {
  VID.muted = !VID.muted;
  $('btnMute').innerHTML = VID.muted ? '<i class="fa-solid fa-volume-xmark"></i>' : '<i class="fa-solid fa-volume-high"></i>';
});

// ── Ratio ─────────────────────────────────────────────────────
$$('.rb').forEach(b => b.addEventListener('click', () => {
  $$('.rb').forEach(x => x.classList.remove('on')); b.classList.add('on');
  R.setRatio(b.dataset.r); setCanvasSize(b.dataset.r);
}));
function setCanvasSize(r) {
  if (r==='9:16') CVS.style.cssText='width:210px;height:373px;border-radius:10px;display:block';
  else if (r==='1:1') CVS.style.cssText='width:340px;height:340px;border-radius:10px;display:block';
  else CVS.style.cssText='width:460px;height:259px;border-radius:10px;display:block';
}

// ── Caption presets ───────────────────────────────────────────
const PRESETS = {
  hormozi: { fontActive:'#FFE600', fontNormal:'#FFFFFF', shadow:'#000000' },
  tiktok:  { fontActive:'#FF0059', fontNormal:'#FFFFFF', shadow:'#000000' },
  minimal: { fontActive:'#FFFFFF', fontNormal:'rgba(255,255,255,.6)', shadow:'#000000' },
  neon:    { fontActive:'#00FFFF', fontNormal:'#FFFFFF', shadow:'#0000AA' },
  fire:    { fontActive:'#FF6A00', fontNormal:'#FFD700', shadow:'#000000' },
};
function applyPreset(pr) {
  $$('.cap-opt').forEach(x => x.classList.remove('on'));
  const el = document.querySelector(`.cap-opt[data-p="${pr}"]`);
  if (el) el.classList.add('on');
  const p = PRESETS[pr] || PRESETS.hormozi;
  R.style.preset = pr; R.style.fontActive = p.fontActive; R.style.fontNormal = p.fontNormal; R.style.shadow = p.shadow;
  $('cAct').value   = p.fontActive;
  $('cNorm').value  = p.fontNormal.startsWith('rgba') ? '#ffffff' : p.fontNormal;
  $('cShadow').value = p.shadow;
}
$$('.cap-opt').forEach(p => p.addEventListener('click', () => applyPreset(p.dataset.p)));
$('cAct').addEventListener('input',    e => R.style.fontActive = e.target.value);
$('cNorm').addEventListener('input',   e => R.style.fontNormal = e.target.value);
$('cShadow').addEventListener('input', e => R.style.shadow     = e.target.value);
$('hookText').addEventListener('input', e => R.style.hookText  = e.target.value);
$('fontSize').addEventListener('input', e => { R.style.fontSize = +e.target.value; $('fontSizeVal').textContent = e.target.value + 'px'; });
$$('.pos-btn').forEach(b => b.addEventListener('click', () => { $$('.pos-btn').forEach(x => x.classList.remove('on')); b.classList.add('on'); R.style.captionPos = b.dataset.pos; }));
$('togHook').addEventListener('change', e => R.style.showHook = e.target.checked);
$('togBar').addEventListener('change',  e => R.style.showBar  = e.target.checked);
$('togWM').addEventListener('change',   e => R.style.showWm   = e.target.checked);
$$('.bg-btn').forEach(b => b.addEventListener('click', () => { $$('.bg-btn').forEach(x => x.classList.remove('on')); b.classList.add('on'); R.style.bgStyle = b.dataset.bg; }));
$('trimS').addEventListener('change', () => { if (!ACTIVE) return; ACTIVE.start = +$('trimS').value; R.setClip(ACTIVE); $('tcEnd').textContent = fmt(ACTIVE.end - ACTIVE.start); });
$('trimE').addEventListener('change', () => { if (!ACTIVE) return; ACTIVE.end   = +$('trimE').value; R.setClip(ACTIVE); $('tcEnd').textContent = fmt(ACTIVE.end - ACTIVE.start); });

// ── Export ────────────────────────────────────────────────────
$('btnDownload').addEventListener('click', doExport);
function resetExport() {
  $('expProg').classList.add('hide');
  $('btnDownload').disabled = false;
  $('btnDownload').innerHTML = '<i class="fa-solid fa-download"></i> Download Short Clip';
}
function doExport() {
  if (!ACTIVE || E.isRecording()) return;
  const clip = ACTIVE, btn = $('btnDownload');
  btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Recording…';
  $('expProg').classList.remove('hide');
  $('epFill').style.width = '0%'; $('epPct').textContent = '0%';
  E.run(clip.start, clip.end,
    p => {
      const pct = Math.round(p * 100);
      $('epFill').style.width = pct + '%'; $('epPct').textContent = pct + '%';
      btn.innerHTML = pct < 40 ? '<i class="fa-solid fa-circle-notch fa-spin"></i> Capturing…'
                    : pct < 80 ? '<i class="fa-solid fa-circle-notch fa-spin"></i> Encoding…'
                    : '<i class="fa-solid fa-circle-notch fa-spin"></i> Finishing…';
    },
    (url, dur, ext) => {
      $('epFill').style.width = '100%'; $('epPct').textContent = '✅ Done!';
      const a = $('dlA'); a.href = url; a.download = (TITLE||'clip').slice(0,25) + '_' + Math.round(dur) + 's.' + (ext || 'webm');
      a.removeAttribute('hidden'); a.click();
      btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Downloaded!';
      toast('✅ Short clip saved!', 'ok');
      setTimeout(resetExport, 4000);
    },
    err => { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Failed – Retry'; $('epPct').textContent = '❌ ' + err; }
  );
}

// ── Utils ─────────────────────────────────────────────────────
let _tt;
function toast(msg, type = 'info') {
  const el = $('toast');
  const c = { info:['#1e1b4b','#a5b4fc','rgba(124,58,237,.4)'], warn:['#451a03','#fbbf24','rgba(251,191,36,.4)'], err:['#450a0a','#f87171','rgba(248,113,113,.4)'], ok:['#052e16','#6ee7b7','rgba(16,185,129,.4)'] };
  const [bg, col, bor] = c[type] || c.info;
  Object.assign(el.style, { background: bg, color: col, borderColor: bor, opacity: '1' });
  el.textContent = msg; clearTimeout(_tt); _tt = setTimeout(() => el.style.opacity = '0', 5000);
}
function shake(el) { el.style.outline = '2px solid rgba(244,63,94,.7)'; setTimeout(() => el.style.outline = '', 1500); }
function nameFromURL(u) { try { return new URL(u).pathname.split('/').pop().replace(/\.[^.]+$/, '') || 'Video'; } catch { return 'Video'; } }
