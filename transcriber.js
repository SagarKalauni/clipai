/**
 * ClipAI – Transcriber
 * Extracts audio from a video element's source URL,
 * sends it to the server's /api/transcribe (Whisper),
 * and returns real word-level timestamps.
 *
 * Falls back gracefully if Whisper is unavailable.
 */

window.Transcriber = {

  /**
   * Transcribe a clip segment from a video URL.
   * @param {string} videoSrc  - URL of the video file (same-origin or blob)
   * @param {number} start     - clip start in seconds
   * @param {number} end       - clip end in seconds
   * @param {function} onStatus - callback(msg) for UI status updates
   * @returns {Promise<Array>} - array of {word, start, end} or []
   */
  async transcribe(videoSrc, start, end, onStatus = () => {}) {
    if (!videoSrc || videoSrc.startsWith('https://www.youtube.com')) {
      return []; // Can't transcribe YouTube embed — no audio access
    }

    try {
      onStatus('Extracting audio…');
      const wavBlob = await this._extractAudio(videoSrc, start, end);

      onStatus('Transcribing speech… (Whisper AI)');
      const words = await this._sendToServer(wavBlob, start);

      if (words && words.length > 0) {
        onStatus(`Got ${words.length} words ✓`);
        return words;
      }
      onStatus('No speech detected — using AI captions');
      return [];

    } catch(err) {
      console.warn('Transcription failed:', err.message);
      onStatus('Using AI captions (transcription unavailable)');
      return [];
    }
  },

  /**
   * Extract a clip's audio from the video URL using Web Audio API.
   * Returns a WAV Blob at 16kHz mono (Whisper's expected format).
   */
  async _extractAudio(videoSrc, start, end) {
    const dur = end - start;
    if (dur <= 0) throw new Error('Invalid range');
    if (dur > 120) { start = start; end = start + 120; } // cap at 2 min

    // Fetch the video file
    const resp = await fetch(videoSrc, { signal: AbortSignal.timeout(60000) });
    if (!resp.ok) throw new Error('Could not fetch video');
    const arrayBuf = await resp.arrayBuffer();

    // Decode audio at native sample rate
    const nativeCtx = new (window.AudioContext || window.webkitAudioContext)();
    let decoded;
    try {
      decoded = await nativeCtx.decodeAudioData(arrayBuf.slice(0));
    } finally {
      nativeCtx.close().catch(() => {});
    }

    const nativeSR    = decoded.sampleRate;
    const targetSR    = 16000;
    const startSample = Math.floor(start * nativeSR);
    const nativeLen   = Math.ceil((end - start) * nativeSR);
    const targetLen   = Math.ceil((end - start) * targetSR);

    // Resample to 16kHz using OfflineAudioContext
    const offCtx = new OfflineAudioContext(1, targetLen, targetSR);
    const segBuf  = offCtx.createBuffer(1, nativeLen, nativeSR);
    const segData = segBuf.getChannelData(0);
    const srcData = decoded.getChannelData(0);

    for (let i = 0; i < nativeLen; i++) {
      segData[i] = srcData[Math.min(startSample + i, srcData.length - 1)] || 0;
    }

    const srcNode = offCtx.createBufferSource();
    srcNode.buffer = segBuf;
    srcNode.connect(offCtx.destination);
    srcNode.start();

    const rendered = await offCtx.startRendering();
    return this._encodeWAV(rendered);
  },

  /**
   * POST the WAV blob to /api/transcribe and return word timestamps.
   */
  async _sendToServer(wavBlob, startOffset) {
    const form = new FormData();
    form.append('audio', wavBlob, 'clip.wav');
    form.append('start', String(startOffset));

    const resp = await fetch('/api/transcribe', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(180000)
    });
    if (!resp.ok) throw new Error('Server error ' + resp.status);

    const data = await resp.json();
    if (!data.ok || !data.words || data.words.length === 0) {
      if (data.error) console.warn('Whisper error:', data.error);
      return [];
    }
    return data.words;
  },

  /**
   * Encode an AudioBuffer to a WAV Blob (PCM 16-bit mono).
   */
  _encodeWAV(buffer) {
    const sampleRate  = buffer.sampleRate;
    const numSamples  = buffer.length;
    const numChannels = 1;
    const bitsPerSamp = 16;
    const bytePerSamp = bitsPerSamp / 8;
    const byteRate    = sampleRate * numChannels * bytePerSamp;
    const blockAlign  = numChannels * bytePerSamp;
    const dataSize    = numSamples * numChannels * bytePerSamp;
    const headerSize  = 44;

    const buf  = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(buf);

    const write = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
    write(0,  'RIFF');
    view.setUint32(4,  36 + dataSize, true);
    write(8,  'WAVE');
    write(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);           // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSamp, true);
    write(36, 'data');
    view.setUint32(40, dataSize, true);

    const samples = buffer.getChannelData(0);
    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }

    return new Blob([buf], { type: 'audio/wav' });
  }
};
