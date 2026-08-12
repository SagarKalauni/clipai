/**
 * AutoShorts AI – AI Clipper
 * Fetches YouTube metadata, generates topic-specific clips with animated captions.
 */
window.AIClipper = {

  // YouTube oEmbed via our server-side proxy
  async fetchYouTubeInfo(url) {
    const id = this._ytId(url);
    if (!id) return null;

    // Try server-side proxy (bypasses CORS)
    try {
      const r = await fetch(`/api/youtube?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`);
      if (r.ok) {
        const d = await r.json();
        return {
          id,
          title: d.title || 'YouTube Video',
          author: d.author_name ? '@' + d.author_name.replace(/\s+/g,'').toLowerCase() : '@youtube',
          thumb: `https://img.youtube.com/vi/${id}/hqdefault.jpg`
        };
      }
    } catch(e) {}

    // Fallback: return at least the ID so clips still generate
    return {
      id,
      title: 'YouTube Short Highlight',
      author: '@youtube',
      thumb: `https://img.youtube.com/vi/${id}/hqdefault.jpg`
    };
  },

  _ytId(url) {
    const m = url.match(/(?:youtu\.be\/|watch\?v=|shorts\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  },

  // Sample demo datasets
  demos: {
    tech: {
      title: 'How Great Founders Build $100M Products',
      subs: [
        'THE','BIGGEST','MISTAKE','IN','STARTUPS','IS','BUILDING',
        'FEATURES','NOBODY','ASKED','FOR','FOCUS','ON',
        'RAPID','USER','FEEDBACK','AND','DAILY','EXECUTION'
      ]
    },
    motivation: {
      title: 'Unstoppable Discipline & Daily Focus',
      subs: [
        'MOTIVATION','IS','TEMPORARY','BUT','DAILY','DISCIPLINE',
        'IS','PERMANENT','PUSH','THROUGH','WHEN','YOU',
        'DO','NOT','FEEL','LIKE','DOING','THE','WORK'
      ]
    },
    gaming: {
      title: 'Epic 1v5 Clutch Tournament Moment',
      subs: [
        'LOOK','AT','THIS','IMPOSSIBLE','1V5','CLUTCH',
        'HE','ELIMINATED','ALL','FIVE','PLAYERS','IN',
        'UNDER','TEN','SECONDS','ABSOLUTELY','INSANE'
      ]
    }
  },

  // Generate topic-specific clips with unique subtitles
  generateClips(duration, title = '') {
    const t = title.toLowerCase();
    let subs, topic;

    if (t.includes('ai') || t.includes('tech') || t.includes('startup') || t.includes('code') || t.includes('software')) {
      topic = 'tech'; subs = this.demos.tech.subs;
    } else if (t.includes('motivat') || t.includes('disciplin') || t.includes('mindset') || t.includes('focus')) {
      topic = 'motivation'; subs = this.demos.motivation.subs;
    } else if (t.includes('game') || t.includes('gaming') || t.includes('clutch')) {
      topic = 'gaming'; subs = this.demos.gaming.subs;
    } else {
      // Generic: derive from title words
      const words = title.replace(/[^a-zA-Z ]/g,'').toUpperCase().split(/\s+/).filter(Boolean);
      subs = words.length >= 6 ? words : ['WATCH','THIS','VIRAL','CLIP','UNTIL','THE','END','MINDBLOWING'];
    }

    const safe = (t) => Math.min(t, duration - 0.5);

    return [
      {
        id: 'c15', title: this._hookTitle(title, 15), hookQuote: this._hookQuote(subs, 0),
        start: 0, end: safe(15), dur: 15,
        virality: 98, badgeClass: 'vbadge-high',
        words: this.makeWords(subs.slice(0, 10), 0, safe(15))
      },
      {
        id: 'c30', title: this._hookTitle(title, 30), hookQuote: this._hookQuote(subs, 1),
        start: safe(2), end: safe(32), dur: 30,
        virality: 93, badgeClass: 'vbadge-high',
        words: this.makeWords(subs.slice(3, 16), safe(2), safe(32))
      },
      {
        id: 'c60', title: this._hookTitle(title, 60), hookQuote: this._hookQuote(subs, 2),
        start: safe(5), end: safe(65), dur: 60,
        virality: 87, badgeClass: 'vbadge-med',
        words: this.makeWords(subs, safe(5), safe(65))
      }
    ];
  },

  _hookTitle(title, dur) {
    const t = title.replace(/\.(mp4|mov|webm|mkv)$/i,'');
    const labels = {15:'🔥 15s REEL', 30:'⚡ 30s TIKTOK', 60:'🎥 60s SHORT'};
    if (!t || t.length < 3) return labels[dur];
    return labels[dur] + ': ' + t.toUpperCase().slice(0,28);
  },

  _hookQuote(subs, offset) {
    const start = offset * 4;
    return '"' + subs.slice(start, start + 7).join(' ').toLowerCase() + '…"';
  },

  makeWords(wordArr, startTime, endTime) {
    const n = wordArr.length;
    const step = (endTime - startTime) / (n || 1);
    return wordArr.map((w, i) => ({
      word: w,
      start: parseFloat((startTime + i * step).toFixed(2)),
      end: parseFloat((startTime + (i + 1) * step - 0.05).toFixed(2))
    }));
  }
};
