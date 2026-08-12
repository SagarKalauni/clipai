/* ClipAI – Exporter: records canvas+audio for exactly the clip duration */
window.Exporter = class {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.video  = video;
    this._busy  = false;
  }

  isRecording() { return this._busy; }

  async run(start, end, onProg, onDone, onErr) {
    if (this._busy) return;
    const dur = end - start;
    if (dur <= 0) { onErr('Invalid clip range'); return; }
    this._busy = true;

    try {
      const v = this.video;

      // Canvas stream at 30fps
      const stream = this.canvas.captureStream(30);

      // Attach audio if possible
      try {
        if (v.captureStream) {
          const vs = v.captureStream();
          vs.getAudioTracks().forEach(tr => stream.addTrack(tr));
        }
      } catch(e) { /* no audio track — that's ok */ }

      // Best codec — browsers only support WebM for MediaRecorder recording
      // MP4 recording is NOT supported in Chrome/Edge/Firefox via MediaRecorder
      const codecs = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm'
      ];
      const codec = codecs.find(c => MediaRecorder.isTypeSupported(c)) || 'video/webm';
      const ext = 'webm'; // always webm — plays in all modern browsers and VLC

      const rec = new MediaRecorder(stream, { mimeType: codec, videoBitsPerSecond: 6_000_000 });
      const chunks = [];
      rec.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };

      // Seek to start
      v.currentTime = start;
      await new Promise(res => {
        const fn = () => { v.removeEventListener('seeked', fn); res(); };
        v.addEventListener('seeked', fn);
        setTimeout(res, 2000);
      });

      const wasMuted = v.muted;
      v.muted   = false;
      v.volume  = 1;
      await v.play().catch(() => {});

      rec.start(200);

      // Track progress
      const t0 = performance.now();
      await new Promise(res => {
        const tick = () => {
          const el = (performance.now()-t0)/1000;
          onProg(Math.min(1, el/dur));
          if (el < dur) requestAnimationFrame(tick);
          else res();
        };
        requestAnimationFrame(tick);
      });

      rec.stop();
      v.pause();
      v.muted = wasMuted;

      await new Promise(res => { rec.onstop = res; });
      this._busy = false;
      const blob = new Blob(chunks, { type: codec });
      onDone(URL.createObjectURL(blob), dur, ext);

    } catch(err) {
      this._busy = false;
      onErr(err.message || 'Export failed');
    }
  }
};
