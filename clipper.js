/* ClipAI – Clip Generator
 * Uses real subtitle words when available (passed in from server)
 * Falls back to topic-matched AI word bank otherwise
 */
window.Clipper = {
  banks: {
    generic:    ['THIS','IS','ABSOLUTELY','INSANE','YOU','WONT','BELIEVE','WHAT','HAPPENS','NEXT','THE','MOMENT','EVERYTHING','CHANGED','NOBODY','TALKS','ABOUT','THIS','WAIT','TILL','THE','END','TRUST','ME','ON','THIS'],
    motivation: ['DISCIPLINE','BEATS','MOTIVATION','EVERY','SINGLE','TIME','WAKE','UP','BEFORE','EVERYONE','DOMINATE','STOP','WAITING','FOR','THE','RIGHT','MOMENT','START','NOW','YOUR','FUTURE','SELF','WILL','THANK','YOU'],
    tech:       ['THIS','AI','WILL','REPLACE','MILLIONS','OF','JOBS','THE','FUTURE','OF','TECH','IS','ALREADY','HERE','NOBODY','IS','TALKING','ABOUT','THIS','BREAKTHROUGH','IT','CHANGES','EVERYTHING','WE','KNEW'],
    business:   ['THE','REAL','REASON','MOST','STARTUPS','FAIL','IS','THIS','HOW','TO','MAKE','MONEY','WITH','ZERO','EXPERIENCE','STOP','WORKING','FOR','OTHERS','BUILD','YOUR','OWN','EMPIRE','THIS','ONE','SKILL'],
  },
  titles: {
    generic:    ['🔥 You Won\'t Believe This','⚡ This Is Mind-Blowing','😱 Wait Till The End','🎯 Nobody Talks About This'],
    motivation: ['💪 Discipline Over Everything','🔥 Stop Making Excuses','⚡ Your Future Starts Now','🎯 The Winning Mindset'],
    tech:       ['🤖 AI Changes Everything','💻 The Tech Shift Nobody Sees','🚀 The Future Is Here','⚡ This Breaks The Internet'],
    business:   ['💰 Build Wealth Fast','🏆 Real Startup Secrets','📈 The Growth Formula','💡 From Zero to Million'],
  },

  topic(title) {
    const t = (title||'').toLowerCase();
    if (/motivat|disciplin|mindset|success|hustle|grind|focus/.test(t)) return 'motivation';
    if (/ai|tech|software|code|startup|robot|gpt|app/.test(t))          return 'tech';
    if (/business|money|wealth|invest|entrepreneur|million/.test(t))     return 'business';
    return 'generic';
  },

  /** Fake words spaced evenly across [s, e] — used as fallback only */
  fakeWords(bank, s, e) {
    return bank.map((w, i) => ({
      word:  w,
      start: parseFloat((s + i * (e - s) / bank.length).toFixed(3)),
      end:   parseFloat((s + (i + 1) * (e - s) / bank.length - 0.04).toFixed(3))
    }));
  },

  /** Get real subtitle words for a time range [s, e].
   *  Falls back to fake if not enough real words. */
  realWords(allWords, s, e) {
    if (!allWords || allWords.length === 0) return null;
    const clip = allWords.filter(w => w.start >= s - 1.0 && w.start < e + 0.5);
    return clip.length >= 2 ? clip : null;
  },

  /**
   * Generate clips.
   * @param {number} dur          – video duration in seconds
   * @param {string} title        – video title (for topic detection)
   * @param {Array}  subtitleWords – real words from server [{word,start,end}], or []
   */
  generate(dur, title, subtitleWords = []) {
    const tp   = this.topic(title);
    const bk   = this.banks[tp];
    const tt   = this.titles[tp];
    const safe = (t, len) => Math.max(0, Math.min(t, dur - len - 0.5));
    const hasReal = subtitleWords && subtitleWords.length > 10;

    const makeClip = (id, dur_, start, virality, titleIdx) => {
      const end = start + dur_;
      const real = hasReal ? this.realWords(subtitleWords, start, end) : null;
      return {
        id, dur: dur_, start, end, virality,
        title: tt[titleIdx] || tt[0],
        words: real || [],
        _transcribed: !!real,
      };
    };

    const clips = [];

    // 15s clips
    if (dur >= 15) {
      clips.push(makeClip('c0', 15, safe(0,           15), 98, 0));
      if (dur > 40) clips.push(makeClip('c1', 15, safe(dur*0.4, 15), 91, 1));
    }
    // 30s clips
    if (dur >= 30) {
      clips.push(makeClip('c2', 30, safe(dur*0.1, 30), 95, 2));
      if (dur > 80) clips.push(makeClip('c3', 30, safe(dur*0.55,30), 87, 3));
    }
    // 60s clips
    if (dur >= 60) {
      clips.push(makeClip('c4', 60, safe(dur*0.05,60), 93, 0));
    }

    return clips.map(c => ({
      ...c,
      end: Math.min(c.end, dur - 0.1),
      scoreClass: c.virality >= 90 ? 'sc-hi' : 'sc-md'
    }));
  }
};
