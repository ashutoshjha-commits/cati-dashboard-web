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

  function pct(n, d) { return d ? (n / d * 100) : 0; }
  function fmtPct(x) { return x.toFixed(x < 10 ? 1 : 0) + '%'; }

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

  // ---- 100% stacked horizontal bars (crosstab: measure by cut dimension) ----
  function stacked100(container, { rows, segOrder, colorFor, height }) {
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
        if (w > 16) { const t = el('text', { x: x+w/2, y: y+rowH/2+4, 'text-anchor':'middle', class:'seg-pct' }); t.textContent = Math.round(p)+'%'; svg.appendChild(t); }
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
    // Parties share one map across the three vote columns.
    const partyVals = [];
    ALL.forEach(r => { [c.voteNow,c.ae2022,c.ge2024].forEach(col => partyVals.push(r[col])); });
    COLORS.party = buildColorMap(partyVals, 7);
    // Politically-fixed party colors (color follows the entity, not its rank).
    // BJP = saffron. Applied whether BJP landed in a slot or would otherwise
    // share a palette hue. Saffron isn't in the categorical palette, so no clash.
    const SAFFRON = '#F47216';
    ['Bharatiya Janata Party (BJP)','BJP'].forEach(k => {
      if (COLORS.party.map[k] !== undefined) COLORS.party.map[k] = SAFFRON;
    });
    COLORS.gender = buildColorMap(ALL.map(r=>r[c.gender]), 4);
    COLORS.caste = buildColorMap(ALL.map(r=>r[c.caste]), 7);
    COLORS.age = { map: Object.fromEntries(AGE_ORDER.map((b,i)=>[b,seriesColor(i)])), order: AGE_ORDER, hasOther:false,
                   colorFor:(k)=>COLORS.age.map[k]||otherColor(), bucket:(k)=>k };
  }

  // filter state
  const F = { Vendor:'', AC:'', Date:'', Form:'', validOnly:true };

  function applyFilters() {
    const c = CFG.columns;
    return ALL.filter(r => {
      if (F.validOnly && r[c.finalCall] !== CFG.validValue) return false;
      if (F.Vendor && (r[c.vendor]||'').trim() !== F.Vendor) return false;
      if (F.AC && (r[c.ac]||'').trim() !== F.AC) return false;
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
    sel('Constituency','AC', distinct(ALL,c.ac).filter(v=>v.toUpperCase()!=='NO').map(v=>({value:v,text:v})));
    sel('Form Version','Form', distinct(ALL,c.formVersion).map(v=>({value:v,text:v})));
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

    // ---------- cross-tabulation (top) ----------
    section(body,'Cross-Tabulation', 'The "Overall" row is the state-level total; the rest break it down by the dimension you pick — 100% stacked, hover for counts.');
    buildCutBar(body);
    const xCards = document.createElement('div'); xCards.className='cards'; body.appendChild(xCards);
    drawCrosstabs(xCards, rows);

    // ---------- composition (middle) ----------
    section(body,'Sample Composition', 'Who we reached — as % of the sample in scope.');
    const compCards = document.createElement('div'); compCards.className='cards'; body.appendChild(compCards);
    compositionChart(compCards,'Gender', rows, c.gender, null);
    compositionChart(compCards,'Age Band', rows, null, ageBand);
    compositionChart(compCards,'Community / Caste', rows, c.caste, null, 8);
    compositionChart(compCards,'Constituency (AC)', rows, c.ac, null, 10, true);

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
      if (F.AC && (r[c.ac]||'').trim() !== F.AC) return false;
      if (F.Form && (r[c.formVersion]||'').trim() !== F.Form) return false;
      if (F.Date) { const d = parseDMY(r[c.timestamp]); if (!d || isoDate(d) !== F.Date) return false; }
      return true;
    });
  }

  function section(parent, title, sub) {
    const h = document.createElement('div'); h.className='section-head'; h.textContent=title; parent.appendChild(h);
    if (sub){ const p=document.createElement('div'); p.className='section-sub'; p.textContent=sub; parent.appendChild(p); }
    return h;
  }

  // col: column name to count (or null when bandFn derives the key).
  // bandFn: if set, derive key from the Age column via this function.
  function compositionChart(parent, title, rows, col, bandFn, maxSlots, dropNoAC) {
    const cnt = {};
    rows.forEach(r => {
      let k = bandFn ? bandFn(r[CFG.columns.age]) : (r[col]||'').trim();
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
    CUT_DIMS.forEach(d => { const o=document.createElement('option'); o.value=d.key; o.textContent=d.label; s.appendChild(o); });
    s.value = cutBy;
    s.addEventListener('change', () => { cutBy = s.value; const xc=document.getElementById('xtab-cards'); if(xc){ xc.innerHTML=''; drawCrosstabs(xc, applyFilters()); } });
    bar.appendChild(s); parent.appendChild(bar);
  }

  // dimensions you can cut by
  const CUT_DIMS = [
    { key:'Vendor',  label:'Vendor' },
    { key:'Agent',   label:'Agent' },
    { key:'AC',      label:'Constituency (AC)' },
    { key:'Gender',  label:'Gender' },
    { key:'AgeBand', label:'Age Band' },
    { key:'Caste',   label:'Community / Caste' },
    { key:'Form',    label:'Form Version' },
    { key:'Date',    label:'Date' }
  ];

  function cutValue(r) {
    const c = CFG.columns;
    switch (cutBy) {
      case 'Vendor': return (r[c.vendor]||'').trim();
      case 'Agent':  return (r[c.agentId]||'').trim();
      case 'AC':     { const v=(r[c.ac]||'').trim(); return v.toUpperCase()==='NO'?'':v; }
      case 'Gender': return (r[c.gender]||'').trim();
      case 'AgeBand':return ageBand(r[c.age]) || '';
      case 'Caste':  return (r[c.caste]||'').trim();
      case 'Form':   return (r[c.formVersion]||'').trim();
      case 'Date':   { const d=parseDMY(r[c.timestamp]); return d?isoDate(d):''; }
    }
    return '';
  }

  // the measures each cut is crossed against
  function measures() {
    const c = CFG.columns;
    return [
      { title:'Vote Now', col:c.voteNow, colors:COLORS.party },
      { title:'2022 AE',  col:c.ae2022,  colors:COLORS.party },
      { title:'2024 GE',  col:c.ge2024,  colors:COLORS.party },
      { title:'Gender',   col:c.gender,  colors:COLORS.gender },
      { title:'Age Band', band:true,     colors:COLORS.age },
      { title:'Community / Caste', col:c.caste, colors:COLORS.caste }
    ];
  }

  function drawCrosstabs(parent, rows) {
    parent.id = 'xtab-cards';
    const c = CFG.columns;

    // cut categories in scope, ranked by volume, capped for readability
    const cutCnt = {};
    rows.forEach(r => { const k = cutValue(r); if (k) cutCnt[k]=(cutCnt[k]||0)+1; });
    let cats = Object.entries(cutCnt).sort((a,b)=>b[1]-a[1]).map(e=>e[0]);
    const CAP = 12;
    let capped = cats.slice(0, CAP);
    const foldRest = cats.length > CAP;
    // Age band & Date read better in natural order
    if (cutBy === 'AgeBand') capped = AGE_ORDER.filter(b=>cutCnt[b]);
    if (cutBy === 'Date') capped = capped.slice().sort();

    // Tally one measure's segment counts over an arbitrary subset of rows.
    function tally(subset, m) {
      const counts = {}; let total = 0;
      subset.forEach(r => {
        let seg = m.band ? ageBand(r[c.age]) : (r[m.col]||'').trim();
        if (!seg) return;
        seg = m.colors.bucket ? m.colors.bucket(seg) : seg;
        counts[seg] = (counts[seg]||0)+1; total++;
      });
      return { total, counts };
    }

    const capSet = new Set(capped);
    measures().forEach(m => {
      const dataRows = [];

      // state-level overall row (all rows in scope, ignoring the cut)
      const ov = tally(rows, m);
      if (ov.total > 0) dataRows.push({ label: `Overall — ${CFG.name}`, total: ov.total, counts: ov.counts, overall: true });

      // one row per cut category
      capped.forEach(cat => {
        const t = tally(rows.filter(r => cutValue(r) === cat), m);
        if (t.total > 0) dataRows.push({ label: cat, total: t.total, counts: t.counts });
      });

      // remaining cut categories folded into one "Other" row
      if (foldRest) {
        const t = tally(rows.filter(r => { const cv = cutValue(r); return cv && !capSet.has(cv); }), m);
        if (t.total > 0) dataRows.push({ label: `Other (${cats.length-capped.length})`, total: t.total, counts: t.counts });
      }

      const body = card(parent, m.title, `by ${CUT_DIMS.find(d=>d.key===cutBy).label}`);
      const segOrder = m.colors.order.slice();
      legendRow(body, segOrder.map(s=>({name:s,color:m.colors.colorFor(s)})));
      stacked100(body, { rows: dataRows, segOrder, colorFor: (s)=>m.colors.colorFor(s) });
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
