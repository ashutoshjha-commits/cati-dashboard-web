/**
 * CATI Dashboard shared engine.
 * Each project page loads this + its own config.js, then calls CATIEngine.render(config).
 * Nothing project-specific lives here — column names, target, dates, csvUrl all
 * come from the project's config object. Adding a new project = new config +
 * index.html; this file never changes for that.
 *
 * Design: a banner-table dashboard.
 *   - Global filter bar narrows the sample (Vendor / AC / Date / Form Version + Valid-only).
 *   - Sample-composition section: % of the valid sample by Gender / Age band / Caste / AC.
 *   - Cross-tabulation: a "Cut by X" selector crosses every measure
 *     (Vote Now, 2022 AE, 2024 GE, Gender, Age band, Caste) by the chosen
 *     dimension, as 100%-stacked % bars. Switching the selector = "cut by
 *     vendor / agent / AC / ... and so on".
 */
(function () {
  const SERIES = ['--series-1','--series-2','--series-3','--series-4',
                   '--series-5','--series-6','--series-7','--series-8'];
  const svgNS = 'http://www.w3.org/2000/svg';

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function seriesColor(i) { return cssVar(SERIES[i % SERIES.length]); }
  function otherColor() { return cssVar('--text-muted'); }

  // ---- date parsing: never Date.parse on locale strings (day/month swap risk) ----
  function parseDMY(str) {
    if (!str) return null;
    const m = String(str).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  }
  function isoDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function parseISO(str) { const [y,m,d] = str.split('-').map(Number); return new Date(y, m-1, d); }
  function daysBetween(a, b) { return Math.round((b.setHours(0,0,0,0) - a.setHours(0,0,0,0)) / 86400000); }

  function ageBand(raw) {
    const n = parseInt(String(raw).trim(), 10);
    if (isNaN(n) || n <= 0) return null;
    if (n <= 25) return '18–25';
    if (n <= 35) return '26–35';
    if (n <= 45) return '36–45';
    if (n <= 60) return '46–60';
    return '60+';
  }
  const AGE_ORDER = ['18–25','26–35','36–45','46–60','60+'];

  // Income → band. Non-numeric answers (NA / no answer / blank) return null (skipped).
  function incomeBand(raw) {
    const s = String(raw == null ? '' : raw).replace(/[,\s₹]/g, '').trim();
    if (!/^\d/.test(s)) return null;
    const n = parseInt(s, 10);
    if (isNaN(n)) return null;
    if (n <= 5000) return '≤5k';
    if (n <= 15000) return '5k–15k';
    if (n <= 30000) return '15k–30k';
    return '30k+';
  }
  const INCOME_ORDER = ['≤5k','5k–15k','15k–30k','30k+'];

  // Leading integer of an AC label like "11.Panaji" / "10 Aldona" / "2 Pernem (SC)".
  function acNumber(label) {
    const m = String(label).trim().match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : Infinity;
  }
  // A "real" constituency = starts with a number (excludes Others / Call Disconnected / blank).
  function isRealAC(label) { return /^\d/.test(String(label).trim()); }

  // Canonicalize an AC label so the same constituency always groups under one
  // key, regardless of how it was typed in the sheet: "1 Mandrem", "1.Mandrem",
  // "31  Margao" (double space), and "2.(Pernem (SC)" (stray leading paren typo)
  // all collapse to the same key. Without this, per-AC counts/targets silently
  // split across near-duplicate labels. Values with no leading number (Manipur's
  // plain "12", or "No"/"Others"/"Call Disconnected") pass through unchanged.
  function acKey(raw) {
    const s = String(raw || '').trim();
    const m = s.match(/^(\d+)\s*[.\s]*\s*(.*)$/);
    if (!m) return s;
    const name = m[2].replace(/^\(+/, '').replace(/\s{2,}/g, ' ').trim();
    return name ? `${m[1]}.${name}` : m[1];
  }

  function el(tag, attrs) {
    const e = document.createElementNS(svgNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  // ---- tooltip ----
  function tooltipEl() {
    let el = document.getElementById('cati-tooltip');
    if (!el) { el = document.createElement('div'); el.id = 'cati-tooltip'; el.className = 'tooltip'; document.body.appendChild(el); }
    return el;
  }
  function showTooltip(evt, title, rows) {
    const el = tooltipEl();
    el.innerHTML = '<div class="t-title"></div>';
    el.querySelector('.t-title').textContent = title;
    rows.forEach(r => {
      const row = document.createElement('div'); row.className = 't-row';
      const l = document.createElement('span'); l.textContent = r[0];
      const v = document.createElement('span'); v.textContent = r[1];
      row.appendChild(l); row.appendChild(v); el.appendChild(row);
    });
    el.style.display = 'block'; moveTooltip(evt);
  }
  function moveTooltip(evt) {
    const el = tooltipEl(); const pad = 14;
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + 240 > window.innerWidth) x = evt.clientX - 240 - pad;
    if (y + 120 > window.innerHeight) y = evt.clientY - 120 - pad;
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }
  function hideTooltip() { tooltipEl().style.display = 'none'; }

  // ---- color maps: color follows the entity, fixed order, never cycled ----
  // Build once from a value list; top (maxSlots) distinct values by frequency
  // get fixed slots, the rest fold into "Other". Shared maps (e.g. all three
  // vote columns) keep a party the same color everywhere.
  function buildColorMap(values, maxSlots) {
    maxSlots = maxSlots || 7;
    const cnt = {};
    values.forEach(v => { const k = (v || '').trim(); if (k) cnt[k] = (cnt[k]||0)+1; });
    const ordered = Object.keys(cnt).sort((a,b) => cnt[b]-cnt[a]);
    const top = ordered.slice(0, maxSlots);
    const map = {};
    top.forEach((k,i) => { map[k] = seriesColor(i); });
    const order = top.slice();
    const hasOther = ordered.length > maxSlots;
    if (hasOther) order.push('Other');
    return { map, order, hasOther, colorFor: (k) => map[k] || otherColor(), bucket: (k) => (map[k] ? k : 'Other') };
  }

  // Party color map with politically-fixed colors: INC = blue, BJP = saffron
  // (pinned whenever they appear). Other parties get distinct hues that avoid
  // blue and orange so nothing is confused with INC/BJP. Same map is shared
  // across Vote Now / 2022 AE / 2024 GE so a party keeps one color everywhere.
  // Pinned by party CODE (the last "(...)" in the name) so it matches regardless
  // of the full spelling — "Indian National Congress (INC)" and "Congress (INC)"
  // both pin to blue.
  const PARTY_PIN_CODES = { 'INC': '#2a78d6', 'BJP': '#F47216' };
  // Resolve a fixed party colour from a value in EITHER format:
  //   "Full Name (CODE)"  → code via last parenthesis (Vote Now / Goa columns)
  //   "CODE (Candidate)"  → leading code, or a plain party label like "BJP" /
  //                         "CONGRESS / INC" (Manipur 2022 AE grouped by party).
  function partyPin(name) {
    const code = lastTopLevelParen(name);
    if (code && PARTY_PIN_CODES[code]) return PARTY_PIN_CODES[code];
    const n = String(name || '').toUpperCase();
    if (/\bBJP\b/.test(n)) return PARTY_PIN_CODES['BJP'];
    if (/\bINC\b/.test(n) || n.includes('CONGRESS')) return PARTY_PIN_CODES['INC'];
    return null;
  }
  // Leading party label of a "CODE (Candidate)" string → "BJP (Karam Shyam)"
  // becomes "BJP"; "CONGRESS / INC (…)" becomes "CONGRESS / INC". Values with
  // no " (" (NOTA / Didn't Vote / Other Parties) pass through unchanged.
  function partyPrefix(s) {
    s = String(s || '').trim();
    if (!s) return '';
    const i = s.indexOf(' (');
    return i > 0 ? s.slice(0, i).trim() : s;
  }
  // Text inside the outer parentheses of "CODE (Candidate Name)".
  function parenInner(s) {
    s = String(s || '');
    const i = s.indexOf('('), j = s.lastIndexOf(')');
    return (i >= 0 && j > i) ? s.slice(i+1, j).trim() : '';
  }
  // A non-candidate answer (undecided / party-only / dropped call / none).
  const GENERIC_ANSWER_RE = /(will vote|my choice|call disconnect|won'?t vote|no one|any\s*one|anyone|nota|don'?t know|not decided|not known|no idea|undecided|refuse|didn'?t vote|other partie|none|^no$|^0$)/i;
  function isGenericAnswer(s) { s = String(s||'').trim(); return !s || GENERIC_ANSWER_RE.test(s); }
  function buildPartyColorMap(values) {
    const cnt = {};
    values.forEach(v => { const k=(v||'').trim(); if (k) cnt[k]=(cnt[k]||0)+1; });
    const ordered = Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a]);
    // slots 2,3,4,5,6,7 = aqua,yellow,green,violet,red,magenta (skip blue & orange)
    const palette = [1,2,3,4,5,6].map(i => seriesColor(i));
    const map = {}, order = []; let pi = 0;
    for (const party of ordered) {
      const pin = partyPin(party);
      if (pin) { if (map[party]===undefined){ map[party]=pin; order.push(party); } continue; }
      if (pi < palette.length) { map[party]=palette[pi++]; order.push(party); }
    }
    const hasOther = ordered.some(p => map[p]===undefined);
    if (hasOther) order.push('Other');
    return { map, order, hasOther, colorFor:(k)=>map[k]||otherColor(), bucket:(k)=>(map[k]?k:'Other') };
  }

  function pct(n, d) { return d ? (n / d * 100) : 0; }
  function fmtPct(x) { return x.toFixed(x < 10 ? 1 : 0) + '%'; }

  // Short party code from a full name: last TOP-LEVEL "(...)" group, so nested
  // cases like "Janata Dal (United) (JD(U))" yield "JD(U)" not "U".
  function lastTopLevelParen(s) {
    let depth = 0, start = -1, last = null;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') { if (depth === 0) start = i + 1; depth++; }
      else if (s[i] === ')') { depth--; if (depth === 0 && start !== -1) { last = s.slice(start, i); start = -1; } }
    }
    return last;
  }
  function shortPartyLabel(name) {
    if (name === 'Other') return 'Other';
    const code = lastTopLevelParen(name);
    // only treat the parenthetical as a code if it's an uppercase abbreviation
    // (INC, BJP, JD(U), RPI(A)) — not lowercase notes like "(Don't prompt)".
    if (code && /^[A-Z0-9()&.\/-]{2,8}$/.test(code)) return code;
    return name.length > 14 ? name.slice(0,13)+'…' : name;
  }

  // ---- stat tile ----
  function statTile(container, { label, value, sub, status }) {
    const tile = document.createElement('div'); tile.className = 'tile';
    const l = document.createElement('div'); l.className = 'label'; l.textContent = label;
    const v = document.createElement('div'); v.className = 'value'; v.textContent = value;
    tile.appendChild(l); tile.appendChild(v);
    if (sub) { const s = document.createElement('div'); s.className = 'sub' + (status?' '+status:''); s.textContent = sub; tile.appendChild(s); }
    container.appendChild(tile);
  }

  function card(parent, title, sub) {
    const c = document.createElement('div'); c.className = 'card';
    const h = document.createElement('h2'); h.textContent = title; c.appendChild(h);
    if (sub) { const p = document.createElement('p'); p.className = 'card-sub'; p.textContent = sub; c.appendChild(p); }
    const body = document.createElement('div'); c.appendChild(body);
    parent.appendChild(c); return body;
  }

  function legendRow(container, items) {
    const legend = document.createElement('div'); legend.className = 'legend';
    items.forEach(it => {
      const span = document.createElement('span'); span.className = 'item';
      span.innerHTML = `<span class="swatch" style="background:${it.color}"></span>${it.name}`;
      legend.appendChild(span);
    });
    container.appendChild(legend);
  }

  // ---- horizontal % bars (single distribution: composition of valid sample) ----
  // Fixed logical width for the SVG viewBox; the SVG is width:100% so it scales
  // to its card. Not reading clientWidth avoids label clipping when the grid
  // hasn't laid out yet at first paint.
  const VBW = 560;

  function pctBars(container, { rows, color }) {
    // rows: [{label, count, total}]. Bars scale to the max share for readability;
    // the value label sits in a fixed right-hand column so it never clips even
    // when the top bar reaches full width.
    const rowH = 30, width = VBW;
    const marginL = 120, labelCol = 92, gap = 8, marginR = labelCol + gap;
    const plotW = width - marginL - marginR;
    const maxPct = Math.max(1, ...rows.map(r => pct(r.count, r.total)));
    const height = rows.length * rowH + 6;
    const svg = el('svg', { class:'chart-svg', width:'100%', height, viewBox:`0 0 ${width} ${height}`, preserveAspectRatio:'xMinYMin meet' });
    rows.forEach((r, i) => {
      const y = i * rowH; const p = pct(r.count, r.total);
      const w = (p / maxPct) * plotW;
      const lbl = el('text', { x: marginL-10, y: y+rowH/2+4, 'text-anchor':'end', class:'row-label' });
      lbl.textContent = r.label; svg.appendChild(lbl);
      const rect = el('rect', { x: marginL, y: y+5, width: Math.max(w,2), height: rowH-12, fill: color, rx:3, class:'bar' });
      rect.addEventListener('mousemove', e => showTooltip(e, r.label, [['Share', fmtPct(p)], ['Count', r.count]]));
      rect.addEventListener('mouseleave', hideTooltip);
      svg.appendChild(rect);
      const vl = el('text', { x: width, y: y+rowH/2+4, 'text-anchor':'end', class:'direct-label' });
      vl.textContent = `${fmtPct(p)} (${r.count})`; svg.appendChild(vl);
    });
    container.innerHTML = ''; container.appendChild(svg);
  }

  // ---- AC target tracker: progress bars vs a per-AC target ----
  function acTracker(container, { rows, target }) {
    const rowH = 26, width = VBW;
    const marginL = 150, marginR = 104;
    const plotW = width - marginL - marginR;
    const height = rows.length * rowH + 6;
    const svg = el('svg', { class:'chart-svg', width:'100%', height, viewBox:`0 0 ${width} ${height}`, preserveAspectRatio:'xMinYMin meet' });
    const good = cssVar('--status-good'), warn = cssVar('--status-warning'), norm = cssVar('--series-1'), track = cssVar('--gridline');
    rows.forEach((r, i) => {
      const y = i * rowH;
      const p = target ? (r.done / target * 100) : 0;
      const reached = r.done >= target, almost = !reached && r.done >= 0.9 * target;
      const color = reached ? good : almost ? warn : norm;
      const lbl = el('text', { x: marginL-10, y: y+rowH/2+4, 'text-anchor':'end', class:'row-label' });
      lbl.textContent = truncate(r.ac, 24); svg.appendChild(lbl);
      svg.appendChild(el('rect', { x: marginL, y: y+5, width: plotW, height: rowH-12, fill: track, rx:3 }));
      const w = Math.max(Math.min(p,100)/100 * plotW, 2);
      const rect = el('rect', { x: marginL, y: y+5, width: w, height: rowH-12, fill: color, rx:3, class:'bar' });
      rect.addEventListener('mousemove', e => showTooltip(e, r.ac, [['Done', r.done], ['Target', target], ['Progress', fmtPct(p)], ['Remaining', Math.max(0, target-r.done)]]));
      rect.addEventListener('mouseleave', hideTooltip);
      svg.appendChild(rect);
      const vl = el('text', { x: width, y: y+rowH/2+4, 'text-anchor':'end', class:'direct-label' });
      vl.textContent = `${r.done}/${target} · ${Math.round(p)}%`; svg.appendChild(vl);
    });
    container.innerHTML = ''; container.appendChild(svg);
  }

  // ---- 100% stacked horizontal bars (crosstab: measure by cut dimension) ----
  // segLabelFn (optional): short label per segment shown on wide bars (e.g. party code).
  function stacked100(container, { rows, segOrder, colorFor, height, segLabelFn }) {
    // rows: [{label, total, counts:{seg:n}}]
    const rowH = 34, width = VBW;
    const marginL = 130, marginR = 44;
    const plotW = width - marginL - marginR;
    const h = height || (rows.length * rowH + 6);
    const svg = el('svg', { class:'chart-svg', width:'100%', height:h, viewBox:`0 0 ${width} ${h}`, preserveAspectRatio:'xMinYMin meet' });
    rows.forEach((r, i) => {
      const y = i * rowH;
      const lbl = el('text', { x: marginL-10, y: y+rowH/2+4, 'text-anchor':'end', class: r.overall ? 'row-label overall-label' : 'row-label' });
      lbl.textContent = truncate(r.label, 20); svg.appendChild(lbl);
      if (r.overall) { // separator under the state-level total row
        svg.appendChild(el('line', { x1: 0, x2: width, y1: y+rowH-1, y2: y+rowH-1, class:'gridline' }));
      }
      let x = marginL;
      segOrder.forEach(seg => {
        const n = r.counts[seg] || 0; if (n <= 0) return;
        const p = pct(n, r.total);
        const w = (p / 100) * plotW;
        const rect = el('rect', { x, y: y+6, width: Math.max(w-2,0), height: rowH-14, fill: colorFor(seg), rx:2, class:'bar' });
        rect.addEventListener('mousemove', e => showTooltip(e, `${r.label} — ${seg}`, [['Share', fmtPct(p)], ['Count', n], ['Row total', r.total]]));
        rect.addEventListener('mouseleave', hideTooltip);
        svg.appendChild(rect);
        if (w > 16) {
          const short = segLabelFn ? segLabelFn(seg) : '';
          const txt = (short && w > 62) ? `${short} ${Math.round(p)}%` : Math.round(p)+'%';
          const t = el('text', { x: x+w/2, y: y+rowH/2+4, 'text-anchor':'middle', class:'seg-pct' }); t.textContent = txt; svg.appendChild(t);
        }
        x += w;
      });
      const tot = el('text', { x: width-marginR+6, y: y+rowH/2+4, class:'seg-total' });
      tot.textContent = 'n=' + r.total; svg.appendChild(tot);
    });
    container.innerHTML = ''; container.appendChild(svg);
  }

  // ---- per-row 100% stacked bars, each row coloured by ITS OWN top segments ----
  // For candidate questions where every constituency has a different candidate
  // set: each row ranks its own answers, top `maxSeg` get palette colours by
  // rank, the rest fold to "Other". Names are written on wide bars; the tooltip
  // always carries the full name. No shared legend (colours are per-row).
  function stackedLocal(container, { rows, maxSeg, colorOf }) {
    maxSeg = maxSeg || 6;
    const rowH = 34, width = VBW, marginL = 150, marginR = 44;
    const plotW = width - marginL - marginR;
    const h = rows.length * rowH + 6;
    const svg = el('svg', { class:'chart-svg', width:'100%', height:h, viewBox:`0 0 ${width} ${h}`, preserveAspectRatio:'xMinYMin meet' });
    const muted = otherColor();
    rows.forEach((r, i) => {
      const y = i * rowH;
      const lbl = el('text', { x: marginL-10, y: y+rowH/2+4, 'text-anchor':'end', class:'row-label' });
      lbl.textContent = truncate(r.label, 22); svg.appendChild(lbl);
      // colorOf mode (party colouring): keep every candidate in the given order,
      // coloured by party — same-colour candidates form one contiguous block.
      // Otherwise: top `maxSeg` by rank get palette colours, the rest fold to Other.
      let segs;
      if (colorOf) {
        segs = r.items.map(it => ({ name: it.name, count: it.count, color: colorOf(it.name) }));
      } else {
        const top = r.items.slice(0, maxSeg);
        const otherN = r.items.slice(maxSeg).reduce((s,e)=>s+e.count, 0);
        segs = top.map((it, idx) => ({ name: it.name, count: it.count, color: seriesColor(idx) }));
        if (otherN > 0) segs.push({ name: 'Other', count: otherN, color: muted });
      }
      let x = marginL;
      segs.forEach(sg => {
        const p = pct(sg.count, r.total); const w = (p/100) * plotW;
        const rect = el('rect', { x, y: y+6, width: Math.max(w-2,0), height: rowH-14, fill: sg.color, rx:2, class:'bar' });
        rect.addEventListener('mousemove', e => showTooltip(e, `${r.label} — ${sg.name}`, [['Share', fmtPct(p)], ['Count', sg.count], ['Row total', r.total]]));
        rect.addEventListener('mouseleave', hideTooltip);
        svg.appendChild(rect);
        if (w > 30) {
          const txt = (w > 78) ? `${truncate(sg.name, Math.max(4, Math.floor(w/7)))} ${Math.round(p)}%` : Math.round(p)+'%';
          const t = el('text', { x: x+w/2, y: y+rowH/2+4, 'text-anchor':'middle', class:'seg-pct' }); t.textContent = txt; svg.appendChild(t);
        }
        x += w;
      });
      const tot = el('text', { x: width-marginR+6, y: y+rowH/2+4, class:'seg-total' });
      tot.textContent = 'n=' + r.total; svg.appendChild(tot);
    });
    container.innerHTML = ''; container.appendChild(svg);
  }

  // ---- vertical stacked/grouped bars (operational: daily volume, vendor) ----
  function truncate(s, max) { max = max||14; return s.length>max ? s.slice(0,max-1)+'…' : s; }
  function vbars(container, { categories, series, mode }) {
    const height = 240, width = VBW;
    const marginL = 40, marginT = 10, marginB = 28, marginR = 10;
    const plotW = width-marginL-marginR, plotH = height-marginT-marginB;
    const maxVal = mode==='stack'
      ? Math.max(1, ...categories.map((_,ci)=>series.reduce((s,ser)=>s+(ser.values[ci]||0),0)))
      : Math.max(1, ...series.flatMap(s=>s.values));
    const svg = el('svg', { class:'chart-svg', width:'100%', height, viewBox:`0 0 ${width} ${height}`, preserveAspectRatio:'xMinYMin meet' });
    const ticks = 4;
    for (let t=0;t<=ticks;t++){ const y=marginT+plotH-(plotH*t/ticks);
      svg.appendChild(el('line',{x1:marginL,x2:width-marginR,y1:y,y2:y,class:t===0?'baseline':'gridline'}));
      const lb=el('text',{x:marginL-8,y:y+4,'text-anchor':'end',class:'axis-label'}); lb.textContent=Math.round(maxVal*t/ticks); svg.appendChild(lb);
    }
    const catW = plotW/categories.length, groupGap = catW*0.28, barGap = 2;
    categories.forEach((cat,ci)=>{
      const xBase = marginL+ci*catW;
      const lb=el('text',{x:xBase+catW/2,y:height-8,'text-anchor':'middle',class:'axis-label'}); lb.textContent=truncate(cat,Math.max(6,Math.floor(catW/7))); svg.appendChild(lb);
      if (mode==='stack'){ let yc=marginT+plotH;
        series.forEach(ser=>{ const v=ser.values[ci]||0, hh=(v/maxVal)*plotH; if(hh<=0)return; const y=yc-hh;
          const rect=el('rect',{x:xBase+groupGap/2,y,width:catW-groupGap,height:Math.max(hh-barGap,0),fill:ser.color,rx:3,class:'bar'});
          rect.addEventListener('mousemove',e=>showTooltip(e,cat,series.map(s=>[s.name,(s.values[ci]||0)])));
          rect.addEventListener('mouseleave',hideTooltip); svg.appendChild(rect); yc-=hh; });
      } else { const n=series.length, bw=(catW-groupGap)/n;
        series.forEach((ser,si)=>{ const v=ser.values[ci]||0, hh=(v/maxVal)*plotH, x=xBase+groupGap/2+si*bw, y=marginT+plotH-hh;
          const rect=el('rect',{x:x+barGap/2,y,width:Math.max(bw-barGap,1),height:hh,fill:ser.color,rx:3,class:'bar'});
          rect.addEventListener('mousemove',e=>showTooltip(e,cat,[[ser.name,v]]));
          rect.addEventListener('mouseleave',hideTooltip); svg.appendChild(rect); });
      }
    });
    container.innerHTML='';
    if (series.length>1) legendRow(container, series.map(s=>({name:s.name,color:s.color})));
    container.appendChild(svg);
  }

  // ================= main =================
  let ALL = [];      // parsed rows
  let CFG = null;
  let COLORS = {};   // per-measure color maps
  let cutBy = 'Vendor';

  function distinct(rows, key) {
    const s = new Set();
    rows.forEach(r => { const v = (r[key]||'').trim(); if (v) s.add(v); });
    return Array.from(s).sort();
  }

  function render(cfg) {
    CFG = cfg;
    cutBy = cfg.defaultCut || 'Vendor';
    const root = document.getElementById('cati-root');
    root.innerHTML = '<p class="footer-note">Loading data…</p>';
    Papa.parse(cfg.csvUrl, {
      download:true, header:true, skipEmptyLines:true,
      complete: (res) => { ALL = res.data; buildColorMaps(); boot(); },
      error: (err) => { root.innerHTML = `<div class="error-box">Could not load data: ${err.message}</div>`; }
    });
  }

  function buildColorMaps() {
    const c = CFG.columns;
    // Party map for the "Name (CODE)" vote columns (Vote Now, and 2024 GE when
    // present). 2022 AE is handled separately below when grouped by party.
    const partyVals = [];
    ALL.forEach(r => { partyVals.push(r[c.voteNow]); if (c.ge2024) partyVals.push(r[c.ge2024]); if (!CFG.ae2022GroupByParty) partyVals.push(r[c.ae2022]); });
    COLORS.party = buildPartyColorMap(partyVals);
    // Manipur candidate survey: 2022 AE is "CODE (Candidate)" → group by party.
    COLORS.ae22 = buildPartyColorMap(ALL.map(r => partyPrefix(r[c.ae2022])));
    // Set of Congress (INC) candidate names, so the MLA-candidate chart can be
    // coloured by party (INC = blue, anyone else named = saffron). Sourced from
    // the "preferred MLA from INC" column plus the CONGRESS/INC entries in 2022 AE.
    const congress = new Set();
    const addName = n => { n = String(n||'').trim(); if (n && !isGenericAnswer(n)) congress.add(n); };
    if (c.incCandidate) ALL.forEach(r => addName(r[c.incCandidate]));
    ALL.forEach(r => { const ae=(r[c.ae2022]||'').trim(); const p=partyPrefix(ae).toUpperCase(); if (p.includes('INC')||p.includes('CONGRESS')) addName(parenInner(ae)); });
    COLORS.congress = congress;
    COLORS.gender = buildColorMap(ALL.map(r=>r[c.gender]), 4);
    COLORS.caste = buildColorMap(ALL.map(r=>r[c.caste]), 7);
    COLORS.age = { map: Object.fromEntries(AGE_ORDER.map((b,i)=>[b,seriesColor(i)])), order: AGE_ORDER, hasOther:false,
                   colorFor:(k)=>COLORS.age.map[k]||otherColor(), bucket:(k)=>k };
    COLORS.income = { map: Object.fromEntries(INCOME_ORDER.map((b,i)=>[b,seriesColor(i)])), order: INCOME_ORDER, hasOther:false,
                   colorFor:(k)=>COLORS.income.map[k]||otherColor(), bucket:(k)=>k };
  }

  // Candidate → party colour: INC (blue) if a known Congress candidate, grey for
  // non-answers, saffron for any other named candidate. Class order for sorting:
  // 0 = Congress, 1 = other named, 2 = generic (drawn last).
  function candidateColor(name) {
    const n = String(name||'').trim();
    if (isGenericAnswer(n)) return otherColor();
    return (COLORS.congress && COLORS.congress.has(n)) ? PARTY_PIN_CODES['INC'] : PARTY_PIN_CODES['BJP'];
  }
  function candidateClass(name) {
    const n = String(name||'').trim();
    if (isGenericAnswer(n)) return 2;
    return (COLORS.congress && COLORS.congress.has(n)) ? 0 : 1;
  }

  // filter state
  const F = { Vendor:'', AC:'', Date:'', Form:'', validOnly:true };

  function applyFilters() {
    const c = CFG.columns;
    return ALL.filter(r => {
      if (F.validOnly && r[c.finalCall] !== CFG.validValue) return false;
      if (F.Vendor && (r[c.vendor]||'').trim() !== F.Vendor) return false;
      if (F.AC && acKey(r[c.ac]) !== F.AC) return false;
      if (F.Form && (r[c.formVersion]||'').trim() !== F.Form) return false;
      if (F.Date) { const d = parseDMY(r[c.timestamp]); if (!d || isoDate(d) !== F.Date) return false; }
      return true;
    });
  }

  function boot() {
    const root = document.getElementById('cati-root');
    root.innerHTML = '';
    buildFilterBar(root);
    const body = document.createElement('div'); body.id = 'cati-body';
    root.appendChild(body);
    draw();
  }

  function buildFilterBar(root) {
    const c = CFG.columns;
    const bar = document.createElement('div'); bar.className = 'filterbar';

    function sel(labelText, key, options) {
      const field = document.createElement('div'); field.className = 'field';
      const lab = document.createElement('label'); lab.textContent = labelText; field.appendChild(lab);
      const s = document.createElement('select');
      const optAll = document.createElement('option'); optAll.value=''; optAll.textContent='All'; s.appendChild(optAll);
      options.forEach(o => { const opt=document.createElement('option'); opt.value=o.value; opt.textContent=o.text; s.appendChild(opt); });
      s.value = F[key];
      s.addEventListener('change', () => { F[key] = s.value; draw(); });
      field.appendChild(s); bar.appendChild(field);
    }

    sel('Vendor','Vendor', distinct(ALL,c.vendor).map(v=>({value:v,text:v})));
    sel('Constituency','AC', Array.from(new Set(ALL.map(r=>acKey(r[c.ac])).filter(v=>v && v.toUpperCase()!=='NO')))
        .sort((a,b)=>acNumber(a)-acNumber(b)).map(v=>({value:v,text:v})));
    if (c.formVersion) sel('Form Version','Form', distinct(ALL,c.formVersion).map(v=>({value:v,text:v})));
    const dates = Array.from(new Set(ALL.map(r=>{const d=parseDMY(r[c.timestamp]);return d?isoDate(d):null;}).filter(Boolean))).sort();
    sel('Date','Date', dates.map(d=>({value:d,text:d})));

    const tog = document.createElement('label'); tog.className='toggle';
    const cb = document.createElement('input'); cb.type='checkbox'; cb.checked=F.validOnly;
    cb.addEventListener('change',()=>{F.validOnly=cb.checked;draw();});
    tog.appendChild(cb); tog.appendChild(document.createTextNode('Valid samples only'));
    bar.appendChild(tog);

    const reset = document.createElement('button'); reset.className='reset'; reset.textContent='Reset';
    reset.addEventListener('click',()=>{ F.Vendor=F.AC=F.Date=F.Form=''; F.validOnly=true; boot(); });
    bar.appendChild(reset);

    root.appendChild(bar);
  }

  function draw() {
    const c = CFG.columns;
    const rows = applyFilters();
    const body = document.getElementById('cati-body');
    body.innerHTML = '';

    // ---------- KPIs ----------
    const allInScope = F.validOnly ? applyFiltersRaw() : rows; // denominator for rates = filtered incl. invalid
    const total = allInScope.length;
    const valid = allInScope.filter(r=>r[c.finalCall]===CFG.validValue).length;
    const invalid = total - valid;
    const start = parseISO(CFG.startDate), deadline = parseISO(CFG.deadline), today = new Date();
    const daysLeft = Math.max(0, daysBetween(new Date(today), new Date(deadline)));
    const samplesLeft = Math.max(0, CFG.target - valid);
    const reqPerDay = daysLeft===0 ? samplesLeft : Math.ceil(samplesLeft/daysLeft);
    const vendorQC = allInScope.filter(r=>(r[c.qcMemberVendor]||'').trim()!=='').length;
    const internalQC = allInScope.filter(r=>(r[c.qcMemberInternal]||'').trim()!=='').length;

    const tiles = document.createElement('div'); tiles.className='tiles'; body.appendChild(tiles);
    statTile(tiles,{label:'Total Done',value:total.toLocaleString(),sub:`Target ${CFG.target.toLocaleString()}`});
    statTile(tiles,{label:'Valid Rate',value:fmtPct(pct(valid,total)),sub:`${valid} valid / ${invalid} invalid`});
    statTile(tiles,{label:'Samples Left',value:samplesLeft.toLocaleString(),sub:`${daysLeft} day(s) left`,status:(daysLeft===0&&samplesLeft>0)?'critical':undefined});
    statTile(tiles,{label:'Required / Day',value:reqPerDay.toLocaleString(),sub:`Deadline ${CFG.deadline}`});
    statTile(tiles,{label:'Vendor QC Done',value:fmtPct(pct(vendorQC,total)),sub:`${vendorQC} of ${total}`,status:pct(vendorQC,total)<50?'warning':'good'});
    statTile(tiles,{label:'Internal QC Done',value:fmtPct(pct(internalQC,total)),sub:`${internalQC} of ${total}`,status:internalQC===0?'critical':(pct(internalQC,total)<50?'warning':'good')});

    if (rows.length === 0) { const n=document.createElement('p'); n.className='empty-note'; n.textContent='No rows match the current filters.'; body.appendChild(n); addFooter(body); return; }

    // analysis base: Auto-QC-valid minus internal-QC rejections
    const aRows = analysisSet();

    // ---------- ANALYSIS (top): cross-tabulation ----------
    section(body,'Cross-Tabulation',
      'The "Overall" row is the state-level total; the rest break it down by the dimension you pick — 100% stacked, hover for counts.'
      + (CFG.internalRejectValue ? ' Built on Auto-QC-valid samples with internal-QC rejections removed.' : ''));
    buildCutBar(body);
    const xCards = document.createElement('div'); xCards.className='cards'; body.appendChild(xCards);
    drawCrosstabs(xCards, aRows);

    // ---------- ANALYSIS: composition ----------
    section(body,'Sample Composition', 'Who we reached — as % of the analysis sample'
      + (CFG.internalRejectValue ? ' (post internal-QC).' : '.'));
    const compCards = document.createElement('div'); compCards.className='cards'; body.appendChild(compCards);
    compositionChart(compCards,'Gender', aRows, c.gender, null);
    compositionChart(compCards,'Age Band', aRows, null, ageBand);
    compositionChart(compCards,'Community / Caste', aRows, c.caste, null, 8);
    compositionChart(compCards,'Constituency (AC)', aRows, c.ac, null, 16, true);

    // ---------- AC target tracker (only when a per-AC target is configured) ----------
    if (CFG.perAcTarget) {
      const tgt = CFG.perAcTarget;
      // valid samples per real constituency, respecting Vendor/AC/Date filters but always counting VALID toward target
      const validRaw = applyFiltersRaw().filter(r => r[c.finalCall] === CFG.validValue);
      const acCnt = {};
      validRaw.forEach(r => { const a=acKey(r[c.ac]); if (isRealAC(a)) acCnt[a]=(acCnt[a]||0)+1; });
      const trackerRows = Object.entries(acCnt).map(([ac,done])=>({ac,done}))
        .sort((a,b)=> (b.done/tgt)-(a.done/tgt) || acNumber(a.ac)-acNumber(b.ac));
      const reached = trackerRows.filter(r=>r.done>=tgt).length;
      const almost  = trackerRows.filter(r=>r.done<tgt && r.done>=0.9*tgt).length;

      section(body,'AC Target Tracker',
        `Valid samples vs target of ${tgt} per constituency — closest to target first. ${reached} reached · ${almost} almost · ${trackerRows.length} ACs live.`);
      const acWrap = document.createElement('div'); acWrap.className='cards'; body.appendChild(acWrap);
      const acCard = document.createElement('div'); acCard.className='card'; acCard.style.gridColumn='1 / -1';
      const h=document.createElement('h2'); h.textContent='Constituency progress'; acCard.appendChild(h);
      legendRow(acCard, [
        {name:`Reached (≥${tgt}) — stop`, color:cssVar('--status-good')},
        {name:'Almost (≥90%)', color:cssVar('--status-warning')},
        {name:'In progress', color:cssVar('--series-1')}
      ]);
      const acBody=document.createElement('div'); acCard.appendChild(acBody); acWrap.appendChild(acCard);
      if (trackerRows.length) acTracker(acBody, { rows: trackerRows, target: tgt });
      else { const n=document.createElement('p'); n.className='empty-note'; n.textContent='No constituency data in scope.'; acBody.appendChild(n); }
    }

    // ---------- AC-wise QC: internal rejection (only when a close threshold is configured) ----------
    if (CFG.closeThreshold) acQCSection(body);

    // ---------- operational (bottom) ----------
    section(body,'Operational', F.validOnly?'Valid samples only (toggle above to include invalid).':'All samples in current filter.');
    const opCards = document.createElement('div'); opCards.className='cards'; body.appendChild(opCards);

    // daily volume: always show valid vs invalid regardless of validOnly, using raw filtered set
    const raw = applyFiltersRaw();
    const byDate = {};
    raw.forEach(r=>{const d=parseDMY(r[c.timestamp]);const k=d?isoDate(d):'Unknown';byDate[k]=byDate[k]||{v:0,i:0};(r[c.finalCall]===CFG.validValue)?byDate[k].v++:byDate[k].i++;});
    const dk = Object.keys(byDate).sort();
    vbars(card(opCards,'Daily Volume','Valid vs invalid per day'),{categories:dk,mode:'stack',
      series:[{name:'Valid',color:seriesColor(0),values:dk.map(k=>byDate[k].v)},{name:'Invalid',color:seriesColor(5),values:dk.map(k=>byDate[k].i)}]});

    // top agents by volume in scope
    const agentCnt = {}; rows.forEach(r=>{const a=(r[c.agentId]||'?').trim();agentCnt[a]=(agentCnt[a]||0)+1;});
    const topAgents = Object.entries(agentCnt).sort((a,b)=>b[1]-a[1]).slice(0,10);
    pctBars(card(opCards,'Top 10 Agents','Share of sample in scope'),{color:seriesColor(1),
      rows: topAgents.map(([a,n])=>({label:a,count:n,total:rows.length}))});

    addFooter(body);
  }

  // raw = filtered but ignoring the validOnly flag (for rate denominators & daily split)
  function applyFiltersRaw() {
    const c = CFG.columns;
    return ALL.filter(r => {
      if (F.Vendor && (r[c.vendor]||'').trim() !== F.Vendor) return false;
      if (F.AC && acKey(r[c.ac]) !== F.AC) return false;
      if (F.Form && (r[c.formVersion]||'').trim() !== F.Form) return false;
      if (F.Date) { const d = parseDMY(r[c.timestamp]); if (!d || isoDate(d) !== F.Date) return false; }
      return true;
    });
  }

  // A sample the internal-QC team overturned (verdict = internalRejectValue).
  function isInternallyRejected(r) {
    const col = CFG.columns.internalQCDone, rv = CFG.internalRejectValue;
    return !!(col && rv && (r[col]||'').trim() === rv);
  }
  // Base set for the ANALYSIS charts: Auto-QC-valid samples with internal-QC
  // rejections removed, respecting the Vendor/AC/Date filters. Independent of
  // the "valid only" toggle (analysis is always on the clean set).
  function analysisSet() {
    return applyFiltersRaw().filter(r =>
      r[CFG.columns.finalCall] === CFG.validValue && !isInternallyRejected(r));
  }

  function section(parent, title, sub) {
    const h = document.createElement('div'); h.className='section-head'; h.textContent=title; parent.appendChild(h);
    if (sub){ const p=document.createElement('div'); p.className='section-sub'; p.textContent=sub; parent.appendChild(p); }
    return h;
  }

  // ---- AC-wise QC: internal rejection --------------------------------------
  // Config-gated (needs CFG.closeThreshold). Per real constituency, over the
  // Auto-QC-valid samples (respecting Vendor/AC/Date filters): how many the
  // internal-QC team has reviewed, how many they rejected (verdict =
  // internalRejectValue), the rejection rate (rejected ÷ reviewed), and the
  // samples left after removing those rejections (valid − rejected). An AC is
  // flagged "Closed" at > closeThreshold valid.
  function acQCSection(body) {
    const c = CFG.columns;
    const threshold = CFG.closeThreshold;
    const vcol = c.internalQCDone || c.qcMemberInternal;
    const rejectVal = CFG.internalRejectValue || 'Invalid';
    const nameCol = CFG.acNameColumn;

    const validRaw = applyFiltersRaw().filter(r => r[c.finalCall] === CFG.validValue);
    // distinct vendors in scope → one count column each; latest data date → "active"
    const vendors = Array.from(new Set(validRaw.map(r => (r[c.vendor]||'').trim()).filter(Boolean))).sort();
    let maxDay = 0;
    validRaw.forEach(r => { const d = parseDMY(r[c.timestamp]); if (d) maxDay = Math.max(maxDay, d.getTime()); });

    const acc = {};
    validRaw.forEach(r => {
      const a = acKey(r[c.ac]);
      if (!isRealAC(a)) return;
      if (!acc[a]) acc[a] = { valid:0, checked:0, rejected:0, vend:{}, last:0, name: nameCol ? (r[nameCol]||'').trim() : '' };
      acc[a].valid++;
      const v = vcol ? (r[vcol]||'').trim() : '';
      if (v) acc[a].checked++;
      if (v === rejectVal) acc[a].rejected++;
      const vd = (r[c.vendor]||'').trim(); if (vd) acc[a].vend[vd] = (acc[a].vend[vd]||0)+1;
      const dt = parseDMY(r[c.timestamp]); if (dt) acc[a].last = Math.max(acc[a].last, dt.getTime());
    });

    const rows = Object.entries(acc).map(([ac,d]) => ({
      ac, name:d.name, valid:d.valid, checked:d.checked, rejected:d.rejected, vend:d.vend,
      left: d.valid - d.rejected,
      rate: d.checked ? d.rejected/d.checked : 0,
      closed: d.valid > threshold,
      active: maxDay > 0 && d.last === maxDay
    })).sort((a,b) => (b.closed-a.closed) || (b.valid-a.valid) || acNumber(a.ac)-acNumber(b.ac));

    const closedN  = rows.filter(r=>r.closed).length;
    const activeN  = rows.filter(r=>r.active).length;
    const totValid = rows.reduce((s,r)=>s+r.valid,0);
    const totChk   = rows.reduce((s,r)=>s+r.checked,0);
    const totRej   = rows.reduce((s,r)=>s+r.rejected,0);
    const totLeft  = totValid - totRej;
    const lastLabel = maxDay ? new Date(maxDay).toLocaleDateString() : '—';

    section(body, 'AC-wise QC — Internal Rejection',
      `Over Auto-QC-valid samples: internal QC reviews them and rejects some (verdict "${rejectVal}"). Rejection rate = rejected ÷ reviewed; samples left = valid − rejected. Closed at >${threshold} valid. "Active" = received samples on the latest data date (${lastLabel}); the sheet re-reads every load.`);

    const tiles = document.createElement('div'); tiles.className='tiles'; body.appendChild(tiles);
    statTile(tiles, { label:'ACs Closed', value:String(closedN), sub:`of ${rows.length} live · >${threshold} valid` });
    statTile(tiles, { label:'Active ACs', value:String(activeN), sub:`data on ${lastLabel}`, status: activeN ? 'good' : undefined });
    statTile(tiles, { label:'Internally Reviewed', value:totChk.toLocaleString(), sub:`of ${totValid.toLocaleString()} valid` });
    statTile(tiles, { label:'Rejected (internal)', value:totRej.toLocaleString(), sub:`${fmtPct(totChk?totRej/totChk*100:0)} of reviewed`, status: totRej ? 'warning' : 'good' });
    statTile(tiles, { label:'Net Valid After QC', value:totLeft.toLocaleString(), sub:'valid − rejected' });

    if (!rows.length) return;

    const wrap = document.createElement('div'); wrap.className='cards'; body.appendChild(wrap);
    const cardEl = document.createElement('div'); cardEl.className='card'; cardEl.style.gridColumn='1 / -1';
    const h = document.createElement('h2'); h.textContent='By constituency'; cardEl.appendChild(h);
    const sub = document.createElement('p'); sub.className='card-sub';
    sub.textContent = 'Valid = samples passing Auto QC (Final Call = Valid), split by vendor. Closed ACs listed first.';
    cardEl.appendChild(sub);

    const good = cssVar('--status-good'), warn = cssVar('--status-warning'), crit = cssVar('--status-critical'), muted = cssVar('--text-muted');
    const tbl = document.createElement('table'); tbl.className='data-table';
    const thead = document.createElement('thead');
    let head = '<tr><th>Constituency</th><th>Valid (post Auto-QC)</th>';
    vendors.forEach(v => head += `<th>${v}</th>`);
    head += '<th>Closed?</th><th>Active?</th><th>Reviewed</th><th>Rejected</th><th>Rejection Rate</th><th>Samples Left</th></tr>';
    thead.innerHTML = head; tbl.appendChild(thead);
    const tb = document.createElement('tbody');
    rows.forEach(r => {
      const tr = document.createElement('tr');
      const label = r.name ? `${r.ac} ${r.name}` : r.ac;
      const closedCell = r.closed
        ? `<span style="color:${good};font-weight:600">Closed</span>`
        : `<span style="color:${muted}">Open</span>`;
      const activeCell = r.active
        ? `<span style="color:${good};font-weight:600">● Active</span>`
        : `<span style="color:${muted}">—</span>`;
      const rejCol = r.checked === 0 ? muted : (r.rate >= 0.2 ? crit : (r.rate > 0 ? warn : good));
      const rateCell = r.checked === 0
        ? `<span style="color:${muted}">—</span>`
        : `<span style="color:${rejCol};font-weight:600">${fmtPct(r.rate*100)}</span>`;
      let cells = `<td>${label}</td><td>${r.valid}</td>`;
      vendors.forEach(v => cells += `<td>${r.vend[v]||0}</td>`);
      cells += `<td>${closedCell}</td><td>${activeCell}</td><td>${r.checked}</td>`
        + `<td>${r.rejected}</td><td>${rateCell}</td><td style="font-weight:600">${r.left}</td>`;
      tr.innerHTML = cells;
      tb.appendChild(tr);
    });
    tbl.appendChild(tb); cardEl.appendChild(tbl); wrap.appendChild(cardEl);
  }

  // col: column name to count (or null when bandFn derives the key).
  // bandFn: if set, derive key from the Age column via this function.
  function compositionChart(parent, title, rows, col, bandFn, maxSlots, dropNoAC) {
    const cnt = {};
    rows.forEach(r => {
      let k = bandFn ? bandFn(r[CFG.columns.age]) : (col===CFG.columns.ac ? acKey(r[col]) : (r[col]||'').trim());
      if (!k) return;
      if (dropNoAC && String(k).toUpperCase()==='NO') return;
      cnt[k] = (cnt[k]||0)+1;
    });
    let entries = Object.entries(cnt);
    if (bandFn) entries.sort((a,b)=>AGE_ORDER.indexOf(a[0])-AGE_ORDER.indexOf(b[0]));
    else entries.sort((a,b)=>b[1]-a[1]);
    if (maxSlots && entries.length > maxSlots) {
      const top = entries.slice(0,maxSlots);
      const otherN = entries.slice(maxSlots).reduce((s,e)=>s+e[1],0);
      entries = top; if (otherN>0) entries.push(['Other',otherN]);
    }
    // denominator = rows that actually have a value for this variable
    const total = entries.reduce((s,e)=>s+e[1],0);
    const body = card(parent, title, null);
    pctBars(body, { color: seriesColor(0), rows: entries.map(([label,count])=>({label,count,total})) });
  }

  function buildCutBar(parent) {
    const bar = document.createElement('div'); bar.className='cutby-bar';
    const lab = document.createElement('label'); lab.textContent='Cut by:'; bar.appendChild(lab);
    const s = document.createElement('select');
    cutDims().forEach(d => { const o=document.createElement('option'); o.value=d.key; o.textContent=d.label; s.appendChild(o); });
    s.value = cutBy;
    s.addEventListener('change', () => { cutBy = s.value; const xc=document.getElementById('xtab-cards'); if(xc){ xc.innerHTML=''; drawCrosstabs(xc, analysisSet()); } });
    bar.appendChild(s); parent.appendChild(bar);
  }

  // dimensions you can cut by — built from whatever columns the config declares,
  // so a sheet without Form Version (Goa) or with Income adapts automatically.
  function cutDims() {
    const c = CFG.columns;
    const dims = [
      { key:'Vendor',  label:'Vendor' },
      { key:'Agent',   label:'Agent' },
      { key:'AC',      label:'Constituency (AC)' },
      { key:'Gender',  label:'Gender' },
      { key:'AgeBand', label:'Age Band' },
      { key:'Caste',   label:'Community / Caste' }
    ];
    if (c.income) dims.push({ key:'IncomeBand', label:'Income Band' });
    if (c.formVersion) dims.push({ key:'Form', label:'Form Version' });
    dims.push({ key:'Date', label:'Date' });
    return dims;
  }

  function cutValue(r) {
    const c = CFG.columns;
    switch (cutBy) {
      case 'Vendor': return (r[c.vendor]||'').trim();
      case 'Agent':  return (r[c.agentId]||'').trim();
      case 'AC':     { const v=acKey(r[c.ac]); return v.toUpperCase()==='NO'?'':v; }
      case 'Gender': return (r[c.gender]||'').trim();
      case 'AgeBand':return ageBand(r[c.age]) || '';
      case 'Caste':  return (r[c.caste]||'').trim();
      case 'IncomeBand': return incomeBand(r[c.income]) || '';
      case 'Form':   return c.formVersion ? (r[c.formVersion]||'').trim() : '';
      case 'Date':   { const d=parseDMY(r[c.timestamp]); return d?isoDate(d):''; }
    }
    return '';
  }

  // the measures each cut is crossed against — Income added only if configured.
  function measures() {
    const c = CFG.columns;
    const list = [ { title:'Vote Now', col:c.voteNow, colors:COLORS.party } ];
    // 2022 AE: grouped by party (Manipur "CODE (Candidate)") or as-is (Goa).
    list.push(CFG.ae2022GroupByParty
      ? { title:'2022 AE (by party)', derive:(r)=>partyPrefix(r[c.ae2022]), colors:COLORS.ae22 }
      : { title:'2022 AE', col:c.ae2022, colors:COLORS.party });
    if (c.ge2024) list.push({ title:'2024 GE', col:c.ge2024, colors:COLORS.party });
    // Candidate-survey measures: shown at candidate-name level, colours built
    // per-draw from whatever's in scope (filter to one AC to read cleanly).
    if (c.mlaCandidate) list.push({ title:'MLA Candidate (preferred) — by party', col:c.mlaCandidate, dynamic:true, congressColor:true });
    if (c.incCandidate) list.push({ title:'INC Candidate (preferred MLA from INC)', col:c.incCandidate, dynamic:true, maxSlots:9 });
    list.push(
      { title:'Gender',   col:c.gender,  colors:COLORS.gender },
      { title:'Age Band', derive:(r)=>ageBand(r[c.age]), colors:COLORS.age },
      { title:'Community / Caste', col:c.caste, colors:COLORS.caste }
    );
    if (c.income) list.push({ title:'Income Band', derive:(r)=>incomeBand(r[c.income]), colors:COLORS.income });
    return list;
  }

  function drawCrosstabs(parent, rows) {
    parent.id = 'xtab-cards';
    const c = CFG.columns;

    // cut categories in scope, ranked by volume, capped for readability
    const cutCnt = {};
    rows.forEach(r => { const k = cutValue(r); if (k) cutCnt[k]=(cutCnt[k]||0)+1; });
    let cats = Object.entries(cutCnt).sort((a,b)=>b[1]-a[1]).map(e=>e[0]);
    // show every constituency when cutting by AC (small count, each is meaningful)
    const CAP = (cutBy === 'AC') ? 40 : 12;
    let capped = cats.slice(0, CAP);
    const foldRest = cats.length > CAP;
    // Age/Income bands & Date read better in natural order; AC by its number
    if (cutBy === 'AgeBand') capped = AGE_ORDER.filter(b=>cutCnt[b]);
    if (cutBy === 'IncomeBand') capped = INCOME_ORDER.filter(b=>cutCnt[b]);
    if (cutBy === 'Date') capped = capped.slice().sort();
    if (cutBy === 'AC') capped = capped.slice().sort((a,b)=>acNumber(a)-acNumber(b));

    // Tally one measure's segment counts over an arbitrary subset of rows.
    function tally(subset, m, colors) {
      const counts = {}; let total = 0;
      subset.forEach(r => {
        let seg = m.derive ? m.derive(r) : (r[m.col]||'').trim();
        if (!seg) return;
        seg = colors.bucket ? colors.bucket(seg) : seg;
        counts[seg] = (counts[seg]||0)+1; total++;
      });
      return { total, counts };
    }

    const capSet = new Set(capped);
    const cutLabel = cutDims().find(d=>d.key===cutBy).label;

    // Candidate answers over a subset, ranked — each row keeps its OWN set.
    function candItems(subset, m) {
      const cnt = {}; let total = 0;
      subset.forEach(r => { const k=(r[m.col]||'').trim(); if(!k) return; cnt[k]=(cnt[k]||0)+1; total++; });
      const items = Object.entries(cnt).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count);
      return { items, total };
    }

    measures().forEach(m => {
      // Candidate measures: every cut category has a different candidate set, so
      // colour each row by its own top candidates (no shared palette / legend).
      if (m.dynamic) {
        const body = card(parent, m.title, `by ${cutLabel}`);
        if (m.congressColor) {
          legendRow(body, [
            { name:'Congress (INC) candidate', color:PARTY_PIN_CODES['INC'] },
            { name:'Non-Congress candidate', color:PARTY_PIN_CODES['BJP'] },
            { name:'Undecided / no candidate', color:otherColor() }
          ]);
        } else {
          const note = document.createElement('div'); note.className='legend';
          note.innerHTML = `<span class="item" style="color:var(--text-muted)">Each row is coloured by that ${cutLabel.toLowerCase()}’s own top candidates — hover a bar for the name &amp; count.</span>`;
          body.appendChild(note);
        }
        const order = (items) => m.congressColor
          ? items.slice().sort((a,b)=> candidateClass(a.name)-candidateClass(b.name) || b.count-a.count)
          : items;
        const dRows = [];
        capped.forEach(cat => { const t = candItems(rows.filter(r=>cutValue(r)===cat), m); if (t.total>0) dRows.push({ label:cat, items:order(t.items), total:t.total }); });
        if (foldRest) { const t = candItems(rows.filter(r=>{const cv=cutValue(r);return cv&&!capSet.has(cv);}), m); if (t.total>0) dRows.push({ label:`Other (${cats.length-capped.length})`, items:order(t.items), total:t.total }); }
        const chartDiv = document.createElement('div'); body.appendChild(chartDiv);
        if (dRows.length) stackedLocal(chartDiv, { rows: dRows, maxSeg: 6, colorOf: m.congressColor ? candidateColor : null });
        else { const n=document.createElement('p'); n.className='empty-note'; n.textContent='No data in scope.'; chartDiv.appendChild(n); }
        return;
      }

      const colors = m.colors;
      const dataRows = [];

      // state-level overall row (all rows in scope, ignoring the cut)
      const ov = tally(rows, m, colors);
      if (ov.total > 0) dataRows.push({ label: `Overall — ${CFG.name}`, total: ov.total, counts: ov.counts, overall: true });

      // one row per cut category
      capped.forEach(cat => {
        const t = tally(rows.filter(r => cutValue(r) === cat), m, colors);
        if (t.total > 0) dataRows.push({ label: cat, total: t.total, counts: t.counts });
      });

      // remaining cut categories folded into one "Other" row
      if (foldRest) {
        const t = tally(rows.filter(r => { const cv = cutValue(r); return cv && !capSet.has(cv); }), m, colors);
        if (t.total > 0) dataRows.push({ label: `Other (${cats.length-capped.length})`, total: t.total, counts: t.counts });
      }

      const body = card(parent, m.title, `by ${cutLabel}`);
      const segOrder = colors.order.slice();
      const isParty = (colors === COLORS.party || colors === COLORS.ae22);
      const nameFor = isParty ? shortPartyLabel : (s)=>s;
      legendRow(body, segOrder.map(s=>({name:nameFor(s),color:colors.colorFor(s)})));
      const chartDiv = document.createElement('div'); body.appendChild(chartDiv); // own container so legend isn't wiped
      stacked100(chartDiv, { rows: dataRows, segOrder, colorFor: (s)=>colors.colorFor(s),
                             segLabelFn: isParty ? shortPartyLabel : null });
    });
  }

  function addFooter(body) {
    const f = document.createElement('p'); f.className='footer-note';
    f.textContent = `Data source: live Google Sheet (published CSV) · Refreshed ${new Date().toLocaleString()}`;
    body.appendChild(f);
    document.addEventListener('mousemove', moveTooltip);
  }

  window.CATIEngine = { render };
})();
