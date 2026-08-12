/* ClipAI – Canvas Renderer v3
 * Handles: hookText, fontSize, captionPos (top/mid/bot), bgStyle (blur/crop/bars), 5 presets
 */
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r){
    r=r||0; this.beginPath();
    this.moveTo(x+r,y);this.lineTo(x+w-r,y);this.quadraticCurveTo(x+w,y,x+w,y+r);
    this.lineTo(x+w,y+h-r);this.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    this.lineTo(x+r,y+h);this.quadraticCurveTo(x,y+h,x,y+h-r);
    this.lineTo(x,y+r);this.quadraticCurveTo(x,y,x+r,y);
    this.closePath(); return this;
  };
}

window.Renderer = class {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.video  = video;
    this.W = 1080; this.H = 1920;
    canvas.width = this.W; canvas.height = this.H;
    this._raf = null;
    this.clip  = { start:0, end:15, words:[] };
    this.style = {
      preset:     'hormozi',
      fontActive: '#FFE600',
      fontNormal: '#FFFFFF',
      shadow:     '#000000',
      hookText:   'WAIT TILL THE END \uD83D\uDE31',
      fontSize:   70,
      captionPos: 'bot',  // top / mid / bot
      bgStyle:    'blur', // blur / crop / bars
      showHook:   true,
      showBar:    true,
      showWm:     true,
    };
  }

  setRatio(r) {
    if (r==='9:16')     { this.W=1080; this.H=1920; }
    else if (r==='1:1') { this.W=1080; this.H=1080; }
    else                { this.W=1920; this.H=1080; }
    this.canvas.width=this.W; this.canvas.height=this.H;
  }

  setClip(clip) { this.clip = clip; }

  start() {
    if (this._raf) return;
    const draw = () => { try { this._frame(); } catch(e) {} this._raf = requestAnimationFrame(draw); };
    draw();
  }

  stop() { cancelAnimationFrame(this._raf); this._raf = null; }

  _frame() {
    const {ctx,W,H,video,clip,style} = this;
    const hasVid = video && video.readyState >= 2 && video.videoWidth > 0;
    const t = hasVid ? video.currentTime : clip.start;
    ctx.clearRect(0,0,W,H);
    hasVid ? this._drawVideo(video) : this._placeholder();
    if (style.showHook) this._hook();
    this._captions(t);
    if (style.showBar) this._bar(t);
    if (style.showWm)  this._wm();
  }

  _drawVideo(v) {
    const {ctx,W,H,style} = this;
    const vw=v.videoWidth, vh=v.videoHeight;
    const bg = style.bgStyle || 'blur';

    if (bg === 'blur') {
      // Blurred background fill + crisp center
      ctx.save();
      const bs = Math.max(W/vw, H/vh) * 1.35;
      ctx.filter = 'blur(28px) brightness(0.38)';
      ctx.drawImage(v,(W-vw*bs)/2,(H-vh*bs)/2,vw*bs,vh*bs);
      ctx.restore();
      ctx.filter = 'none';
      const fs = Math.min(W/vw, H*0.78/vh);
      ctx.drawImage(v,(W-vw*fs)/2,(H-vh*fs)/2,vw*fs,vh*fs);

    } else if (bg === 'crop') {
      // Center-crop to fill entire frame
      const sc = Math.max(W/vw, H/vh);
      ctx.drawImage(v,(W-vw*sc)/2,(H-vh*sc)/2,vw*sc,vh*sc);

    } else {
      // Black bars (letterbox/pillarbox)
      ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
      const fs = Math.min(W/vw, H/vh);
      ctx.drawImage(v,(W-vw*fs)/2,(H-vh*fs)/2,vw*fs,vh*fs);
    }
  }

  _placeholder() {
    const {ctx,W,H} = this;
    const t = Date.now()/1000;
    const g = ctx.createLinearGradient(0,0,W,H);
    g.addColorStop(0,'#0f0c29'); g.addColorStop(1,'#24243e');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    const pulse = 1+Math.sin(t*2)*0.07;
    for(let i=3;i>=0;i--){ ctx.beginPath(); ctx.arc(W/2,H*0.42,(140+i*55)*pulse,0,Math.PI*2); ctx.fillStyle=`rgba(124,58,237,${0.07-i*0.01})`; ctx.fill(); }
    ctx.fillStyle='rgba(124,58,237,.85)'; ctx.beginPath(); ctx.arc(W/2,H*0.42,100,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#fff'; ctx.font='bold 88px Inter'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('▶',W/2,H*0.42);
  }

  _hook() {
    const {ctx,W,style} = this;
    const text = style.hookText || 'WAIT TILL THE END \uD83D\uDE31';
    ctx.save();
    ctx.font='900 50px "Bebas Neue",sans-serif';
    const tw=ctx.measureText(text).width;
    const bw=Math.min(W*0.9,tw+80),bh=86,bx=(W-bw)/2,by=88;
    ctx.fillStyle='#E11D48';
    ctx.beginPath(); ctx.roundRect(bx,by,bw,bh,43); ctx.fill();
    ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.shadowColor='rgba(0,0,0,.4)'; ctx.shadowBlur=10;
    ctx.fillText(text,W/2,by+bh/2+2);
    ctx.restore();
  }

  _captions(t) {
    const {clip,style,ctx,W,H} = this;
    const words = clip.words||[];
    if (!words.length) return;

    let idx = words.findIndex(w=>t>=w.start&&t<=w.end);
    if (idx<0) { const nx=words.findIndex(w=>w.start>t); idx=nx>0?nx-1:nx<0?words.length-1:0; }
    const G=3, gi=Math.floor(idx/G)*G;
    const grp=words.slice(gi,gi+G);
    if (!grp.length) return;

    // Caption Y position
    const posY = style.captionPos==='top'  ? H*0.20
               : style.captionPos==='mid'  ? H*0.50
               :                             H*0.80;

    const fsz = Math.max(36, Math.min(120, +(style.fontSize)||70));
    const font = style.preset==='minimal' ? 'Inter' : 'Bebas Neue';

    ctx.save();
    ctx.font=`900 ${fsz}px "${font}",sans-serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle';

    const measures = grp.map(w=>({ w, wid:ctx.measureText(w.word).width }));
    const totalW   = measures.reduce((s,m)=>s+m.wid,0)+(grp.length-1)*22;

    // TikTok pill background
    if (style.preset==='tiktok') {
      ctx.fillStyle='rgba(0,0,0,.85)';
      ctx.beginPath(); ctx.roundRect((W-totalW)/2-36,posY-fsz*0.95,totalW+72,fsz*1.9,14); ctx.fill();
    }

    let sx=(W-totalW)/2;
    for(const {w,wid} of measures) {
      const active = t>=w.start&&t<=w.end+0.08;
      ctx.save();
      ctx.translate(sx+wid/2, posY);
      if (active && style.preset!=='minimal') {
        const p=Math.min(1,(t-w.start)/0.1);
        const sc=1+Math.sin(p*Math.PI)*0.18;
        ctx.scale(sc,sc);
      }
      ctx.strokeStyle=style.shadow||'#000'; ctx.lineWidth=10; ctx.lineJoin='round';
      ctx.strokeText(w.word,0,0);
      if (active) {
        ctx.fillStyle = style.fontActive;
        if (style.preset==='hormozi') { ctx.shadowColor=style.fontActive; ctx.shadowBlur=32; }
        if (style.preset==='neon')    { ctx.shadowColor=style.fontActive; ctx.shadowBlur=24; }
      } else {
        ctx.fillStyle = style.fontNormal;
        if (style.preset==='hormozi') ctx.globalAlpha=0.65;
      }
      ctx.fillText(w.word,0,0);
      ctx.restore();
      sx+=wid+22;
    }
    ctx.restore();
  }

  _bar(t) {
    const {ctx,W,H,clip}=this;
    const p=Math.max(0,Math.min(1,(t-clip.start)/(clip.end-clip.start||1)));
    ctx.save();
    ctx.fillStyle='rgba(255,255,255,.18)'; ctx.fillRect(40,H-16,W-80,8);
    ctx.fillStyle=this.style.fontActive||'#7c3aed'; ctx.fillRect(40,H-16,(W-80)*p,8);
    ctx.restore();
  }

  _wm() {
    const {ctx,W,H}=this;
    ctx.save();
    ctx.font='600 28px Inter'; ctx.fillStyle='rgba(255,255,255,.5)';
    ctx.textAlign='right'; ctx.textBaseline='bottom';
    ctx.fillText('@clipai',W-38,H-38);
    ctx.restore();
  }
};
