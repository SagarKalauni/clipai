/**
 * AutoShorts AI – Subtitle Editor
 * Manages the word-level subtitle timeline in the right panel.
 */
window.SubtitleEditor = class SubtitleEditor {
  constructor(container) {
    this.container = container;
    this.words = [];
    this.onChange = null;
  }

  setWords(words) {
    this.words = words.map(w=>({...w}));
    this.render();
  }

  getWords() { return this.words; }

  render() {
    this.container.innerHTML = '';
    this.words.forEach((w,i) => {
      const row = document.createElement('div');
      row.className = 'word-row';
      row.innerHTML = `
        <input type="number" value="${w.start.toFixed(2)}" step="0.1" min="0" data-i="${i}" data-field="start" title="Start sec">
        <input type="number" value="${w.end.toFixed(2)}" step="0.1" min="0" data-i="${i}" data-field="end" title="End sec">
        <input type="text" value="${w.word}" data-i="${i}" data-field="word">
        <button class="btn-del" data-i="${i}" title="Delete"><i class="fa-solid fa-xmark"></i></button>
      `;
      this.container.appendChild(row);
    });

    this.container.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('change', e => {
        const i = +e.target.dataset.i, f = e.target.dataset.field;
        this.words[i][f] = f==='word' ? e.target.value : +e.target.value;
        this.onChange && this.onChange(this.words);
      });
    });

    this.container.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', e => {
        const i = +btn.dataset.i;
        this.words.splice(i,1);
        this.render();
        this.onChange && this.onChange(this.words);
      });
    });
  }

  addWord(after=-1) {
    const t = after>=0 ? this.words[after].end : 0;
    const w = {word:'NEW',start:t,end:t+1};
    if (after>=0) this.words.splice(after+1,0,w); else this.words.push(w);
    this.render();
    this.onChange && this.onChange(this.words);
  }

  exportSRT() {
    const fmt = (s) => {
      const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=Math.floor(s%60), ms=Math.round((s%1)*1000);
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
    };
    return this.words.map((w,i) => `${i+1}\n${fmt(w.start)} --> ${fmt(w.end)}\n${w.word}\n`).join('\n');
  }
};
