/**
 * AutoShorts AI – Video Exporter
 * Records ONLY the selected short clip (15s/30s/60s) from the canvas + audio.
 * Produces a real downloadable .webm video file.
 */

window.VideoExporter = class VideoExporter {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.video = video;
  }

  async export(clipStart, clipEnd, onProgress, onDone, onError) {
    const v = this.video;
    const canvas = this.canvas;
    const duration = clipEnd - clipStart;

    try {
      // Capture canvas stream at 30fps
      const canvasStream = canvas.captureStream(30);

      // Add audio from the video element if available
      let audioTrack = null;
      if (v && v.captureStream) {
        const vStream = v.captureStream();
        const at = vStream.getAudioTracks();
        if (at.length) { audioTrack = at[0]; canvasStream.addTrack(audioTrack); }
      }

      // Pick best supported codec
      const codecs = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=h264,opus',
        'video/webm'
      ];
      const mimeType = codecs.find(c => MediaRecorder.isTypeSupported(c)) || 'video/webm';

      const recorder = new MediaRecorder(canvasStream, {
        mimeType,
        videoBitsPerSecond: 8_000_000
      });

      const chunks = [];
      recorder.ondataavailable = e => { if (e.data.size>0) chunks.push(e.data); };

      recorder.onstop = () => {
        const blob = new Blob(chunks, {type: mimeType});
        const url = URL.createObjectURL(blob);
        if (audioTrack) audioTrack.stop();
        onDone(url, duration);
      };

      recorder.onerror = e => {
        if (audioTrack) audioTrack.stop();
        onError('Recording error: ' + e.message);
      };

      // Seek video to clip start and play from there
      v.currentTime = clipStart;
      await this._waitSeeked(v);
      v.play();

      recorder.start(100);

      // Animate progress until duration is up
      const started = performance.now();
      const tick = () => {
        const elapsed = (performance.now()-started)/1000;
        const prog = Math.min(1, elapsed/duration);
        onProgress(prog);

        if (elapsed < duration) {
          requestAnimationFrame(tick);
        } else {
          recorder.stop();
          v.pause();
        }
      };
      requestAnimationFrame(tick);

    } catch (err) {
      onError(err.message || 'Export failed. Please try again.');
    }
  }

  _waitSeeked(v) {
    return new Promise(r => {
      if (v.seeking) {
        v.onseeked = () => { v.onseeked=null; r(); };
      } else r();
    });
  }
};
