/**
 * AutoShorts AI – Canvas Renderer
 * Draws REAL MOVING VIDEO FRAMES at 60fps + animated Hormozi captions + overlays.
 */

// Polyfill roundRect
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r=0) {
    const rv = typeof r==='number'?r:r[0]||0;
    this.beginPath();
    this.moveTo(x+rv,y);
    this.lineTo(x+w-rv,y); this.quadraticCurveTo(x+w,y,x+w,y+rv);
    this.lineTo(x+w,y+h-rv); this.quadraticCurveTo(x+w,y+h,x+w-rv,y+h);
    this.lineTo(x+rv,y+h); this.quadraticCurveTo(x,y+h,x,y+h-rv);
    this.lineTo(x,y+rv); this.quadraticCurveTo(x,y,x+rv,y);
    this.closePath(); return this;
  };
}

window.CanvasRenderer = class CanvasRenderer {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.video = video;

    this.W = 1080; this.H = 1920;
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.ratio = '9:16';
    this.frameMode = 'blur';

    this.style = {
      preset: 'hormozi',
      font: 'Bebas Neue',
      size: 68,
      pos: 'bottom',
      active: '#FFE600',
      text: '#FFFFFF',
      shadow: '#000000',
      bounce: true,
      upper: true,
      maxWords: 3
    };

    this.overlay = {
      hookOn: true,
      hookText: 'WAIT TILL THE END 😱',
      hookBg: '#E11D48',
      hookFg: '#FFFFFF',
      barOn: true,
      barColor: '#8B5CF6',
      watermark: '@autoshorts.ai'
    };

    this.words = [];
    this.clipStart = 0;
    this.clipEnd = 15;
    this._raf = null;
  }

  setRatio(ratio) {
    this.ratio = ratio;
    if (ratio === '9:16') { this.W=1080; this.H=1920; }
    else if (ratio === '1:1') { this.W=1080; this.H=1080; }
    else { this.W=1920; this.H=1080; }
    this.canvas.width = this.W;
    this.canvas.height = this.H;
  }

  setWords(words) { this.words = words||[]; }
  setClip(start, end) { this.clipStart=start; this.clipEnd=end; }

  start() {
    if (this._raf) return;
    const loop = () => { this._draw(); this._raf = requestAnimationFrame(loop); };
    loop();
  }

  stop() { cancelAnimationFrame(this._raf); this._raf=null; }

  _draw() {
    const {ctx,W,H} = this;
    ctx.clearRect(0,0,W,H);

    // ── 1. Video Layer ──
    const v = this.video;
    const hasVideo = v && v.readyState >= 2 && v.videoWidth > 0 && !v.error;

    if (hasVideo) {
      this._drawVideo(v);
    } else {
      this._drawPlaceholder();
    }

    // ── 2. Overlays ──
    if (this.overlay.hookOn) this._drawHook();
    this._drawCaptions(v ? v.currentTime : 0);
    if (this.overlay.barOn) this._drawBar(v ? v.currentTime : 0);
    this._drawWatermark();
  }

  _drawVideo(v) {
    const {ctx,W,H} = this;
    const vw = v.videoWidth, vh = v.videoHeight;
    const mode = this.frameMode;

    if (mode === 'blur') {
      // Blurred background fill
      ctx.save();
      const s = Math.max(W/vw, H/vh) * 1.2;
      const bw=vw*s, bh=vh*s;
      ctx.filter='blur(30px) brightness(0.45)';
      ctx.drawImage(v, (W-bw)/2, (H-bh)/2, bw, bh);
      ctx.restore();

      // Centered foreground
      const fs = Math.min(W/vw, (H*0.72)/vh);
      const fw=vw*fs, fh=vh*fs;
      ctx.drawImage(v, (W-fw)/2, (H-fh)/2, fw, fh);

    } else if (mode === 'crop') {
      const s = Math.max(W/vw, H/vh);
      ctx.drawImage(v, (W-vw*s)/2, (H-vh*s)/2, vw*s, vh*s);

    } else {
      // fit
      const s = Math.min(W/vw, H/vh);
      ctx.fillStyle='#000';
      ctx.fillRect(0,0,W,H);
      ctx.drawImage(v, (W-vw*s)/2, (H-vh*s)/2, vw*s, vh*s);
    }
  }

  _drawPlaceholder() {
    const {ctx,W,H} = this;
    const t = Date.now()*0.001;

    const g = ctx.createLinearGradient(0,0,W,H);
    g.addColorStop(0,'#1e1b4b'); g.addColorStop(0.5,'#0f172a'); g.addColorStop(1,'#311042');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);

    // Pulsing ring
    ctx.save();
    for (let i=0;i<3;i++) {
      const r = 160+i*60 + Math.sin(t*3+i)*20;
      ctx.beginPath(); ctx.arc(W/2,H/2-80,r,0,Math.PI*2);
      ctx.strokeStyle=`rgba(139,92,246,${0.2-i*0.05})`; ctx.lineWidth=2; ctx.stroke();
    }
    // Center circle
    ctx.beginPath(); ctx.arc(W/2,H/2-80,90,0,Math.PI*2);
    ctx.fillStyle='#8b5cf6'; ctx.fill();
    ctx.fillStyle='#fff'; ctx.font='bold 80px Inter';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('▶', W/2, H/2-80);

    // Waveform
    const bars=20, bw=18, gap=10, totalW=bars*(bw+gap);
    let bx=(W-totalW)/2, by=H/2+120;
    for(let i=0;i<bars;i++) {
      const bh=24+Math.abs(Math.sin(t*5+i*0.6))*100;
      ctx.fillStyle=i%2===0?'#8b5cf6':'#06b6d4';
      ctx.beginPath(); ctx.roundRect(bx,by-bh/2,bw,bh,6); ctx.fill();
      bx+=bw+gap;
    }
    ctx.restore();
  }

  _drawHook() {
    const {ctx,W,overlay,style} = this;
    const text = overlay.hookText.toUpperCase();
    ctx.save();
    ctx.font = `900 52px "${style.font}", sans-serif`;
    const tw = ctx.measureText(text).width;
    const bw = Math.min(W*0.9, tw+80), bh=90;
    const bx=(W-bw)/2, by=110;
    ctx.fillStyle=overlay.hookBg;
    ctx.beginPath(); ctx.roundRect(bx,by,bw,bh,45); ctx.fill();
    ctx.fillStyle=overlay.hookFg;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.shadowColor='rgba(0,0,0,0.4)'; ctx.shadowBlur=10; ctx.shadowOffsetY=4;
    ctx.fillText(text, W/2, by+bh/2+2);
    ctx.restore();
  }

  _drawCaptions(t) {
    const {words,style,W,H} = this;
    if (!words.length) return;

    // Find current word index
    let idx = words.findIndex(w => t>=w.start && t<=w.end);
    if (idx === -1) {
      idx = words.findIndex(w => w.start > t);
      if (idx > 0) idx--;
      else if (idx === -1) idx = words.length-1;
    }

    const maxW = style.maxWords||3;
    const grpStart = Math.floor(idx/maxW)*maxW;
    const grp = words.slice(grpStart, grpStart+maxW);
    if (!grp.length) return;

    let posY = style.pos==='middle' ? H*0.5 : style.pos==='top' ? H*0.25 : H*0.78;

    const ctx = this.ctx;
    ctx.save();
    ctx.font = `900 ${style.size}px "${style.font}", sans-serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle';

    let totalW=0;
    const measures = grp.map(w => {
      const s=style.upper ? w.word.toUpperCase() : w.word;
      const ww=ctx.measureText(s).width;
      totalW+=ww+24;
      return {s,ww,w};
    });
    totalW-=24;

    // Draw pill background for tiktok/podcast
    if (style.preset!=='hormozi') {
      const px=40, py=style.size*1.5;
      ctx.fillStyle = style.preset==='tiktok' ? 'rgba(0,0,0,0.8)' : '#FFE600';
      ctx.beginPath();
      ctx.roundRect((W-totalW)/2-px, posY-py/2, totalW+px*2, py, 16);
      ctx.fill();
    }

    let sx=(W-totalW)/2;
    for (const {s,ww,w} of measures) {
      const isActive = t>=w.start && t<=w.end+0.1;
      ctx.save();
      ctx.translate(sx+ww/2, posY);
      if (isActive && style.bounce) {
        const p=Math.min(1,(t-w.start)/0.12);
        const sc=1+Math.sin(p*Math.PI)*0.2;
        ctx.scale(sc,sc);
      }
      // Shadow/outline
      ctx.strokeStyle=style.shadow; ctx.lineWidth=10; ctx.lineJoin='round';
      ctx.strokeText(s,0,0);
      // Fill
      if (isActive) {
        ctx.fillStyle = style.preset==='podcast' ? '#000' : style.active;
        if (style.preset==='hormozi') { ctx.shadowColor=style.active; ctx.shadowBlur=28; }
      } else {
        ctx.fillStyle = style.preset==='podcast' ? '#333' : style.text;
      }
      ctx.fillText(s,0,0);
      ctx.restore();
      sx+=ww+24;
    }
    ctx.restore();
  }

  _drawBar(t) {
    const {ctx,W,H,overlay,clipStart,clipEnd} = this;
    const len = clipEnd-clipStart||1;
    const prog = Math.min(1,Math.max(0,(t-clipStart)/len));
    const bh=10, by=H-bh-16;
    ctx.save();
    ctx.fillStyle='rgba(255,255,255,0.2)'; ctx.fillRect(40,by,W-80,bh);
    ctx.fillStyle=overlay.barColor; ctx.fillRect(40,by,(W-80)*prog,bh);
    ctx.restore();
  }

  _drawWatermark() {
    const {ctx,W,H,overlay} = this;
    ctx.save();
    ctx.font='600 28px Inter';
    ctx.fillStyle='rgba(255,255,255,0.7)';
    ctx.textAlign='right'; ctx.textBaseline='bottom';
    ctx.fillText(overlay.watermark, W-36, H-36);
    ctx.restore();
  }
};
