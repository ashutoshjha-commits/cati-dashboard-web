/**
 * Manipur Assembly Survey — Sample vs Actual.
 *
 * Benchmarks the LIVE survey sample (published Google-Sheet CSV) against cached
 * GROUND TRUTH (reference.json = 2022 AE result + census demographics per AC,
 * from the MATData API). Join key = AC number.
 *
 * Survey-side figures use VALID samples only (Auto-QC "Valid", internal-QC
 * rejections removed).
 *
 * Two views:
 *   1. Sample vs Actual  — per AC (or whole state) side-by-side charts for
 *                          2022 Vote / 2022 Candidate / Gender / Age, plus a
 *                          formal deviation summary.
 *   2. Field Operations  — collection progress vs target, valid rate, vendor split.
 *
 * The 2022 party "universe" is data-driven per AC: whatever the API lists as
 * having polled votes there is shown; a minor party the API doesn't list folds
 * into "Other" (expandable), never dropped silently.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------------ config
  const CFG = {
    csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRFpNeye0PdwJQOwosiouaSFIKzLxlTs060I8dc1sseKPUNmwvukVd8meKXhuNJpydI_9vDKqd8Fa9r/pub?gid=1360204096&single=true&output=csv',
    referenceUrl: 'reference.json',
    col: {
      vendor:'Vendor', ac:'AC', acName:'AC Name', timestamp:'Timestamp', agentId:'Agent ID',
      gender:'Gender', age:'Age', voteNow:'Vote Now', ae2022:'2022 AE',
      mlaCandidate:'MLA Candidate', incCandidate:'INC Candidate', caste:'Caste',
      finalCall:'Final Call', imVerdict:'IM Final Call (Internal QC Verdict)'
    },
    validValue:'Valid', internalReject:'Invalid',
    target:18000, perAcTarget:200, startDate:'2026-07-04', deadline:'2026-07-20',
    minBase:30,          // survey valid-n below this: shown, but interpret with caution
    partyMinShare:10     // parties judged in the deviation summary polled >= this % in 2022
  };

  // ------------------------------------------------------------- party mapping
  const NONVOTE = /(did\s*n'?t\s*vote|did\s*not\s*vote|didnt\s*vote|call\s*disconnect|no\s*voter|won'?t\s*vote|not\s*decided|\bundecided\b|\bdon'?t?\s*know\b|\bnot\s*sure\b|\bcan'?t\s*say\b|\bright\s*time\b|\bno\s*answer\b|\brefus|^no$|^0$|^na$)/i;
  function normParty(raw) {
    let s = String(raw == null ? '' : raw).trim();
    if (!s) return { code:null, nonvote:true };
    if (NONVOTE.test(s)) return { code:null, nonvote:true };
    const u = s.toUpperCase();
    // NCP MUST be tested before the CONGRESS/INC rule: "Nationalist Congress
    // Party (NCP)" contains the word CONGRESS and was being counted as INC.
    if (/\bNCP\b/.test(u) || u.includes('NATIONALIST CONGRESS')) return { code:'NCP' };
    if (u.includes('CONGRESS') || /\bINC\b/.test(u)) return { code:'INC' };
    if (/\bBJP\b/.test(u) || u.startsWith('BJP')) return { code:'BJP' };
    if (/\bNOTA\b/.test(u) || u.includes('NONE OF THE ABOVE')) return { code:'NOTA' };
    if (/\bKPA\b/.test(u) || /KUKI\s*PEOPLE.?S\s*ALLIANCE/.test(u)) return { code:'KPA' };
    if (/\bNPEP\b/.test(u) || /\bNPP\b/.test(u) || u.includes("PEOPLE'S PARTY") || u.includes('PEOPLES PARTY')) {
      if (u.includes('MANIPUR')) return { code:'OTHER' };   // MPP != NPP
      return { code:'NPP' };
    }
    if (/\bJD ?\(?U\)?\b/.test(u) || u.startsWith('JDU')) return { code:'JD(U)' };
    if (/\bNPF\b/.test(u)) return { code:'NPF' };
    if (/\bRPI\b/.test(u)) return { code:'RPI(A)' };
    if (/\bCPI\b/.test(u)) return { code:'CPI' };
    if (/\bSHS\b/.test(u) || u.includes('SHIV SENA')) return { code:'SHS' };
    if (/\bLJP\b/.test(u) || u.includes('LOK JANSHAKTI') || u.includes('JANSHAKTI')) return { code:'LJP(RV)' };
    if (/\bIND\b/.test(u) || u.startsWith('INDEPENDENT')) return { code:'IND' };
    return { code:'OTHER' };
  }
  const PARTY_COLOR = { INC:'#2a78d6', BJP:'#F47216', NOTA:'#7a7f87', 'JD(U)':'#17a398',
    NPP:'#d7b500', NPF:'#8250c4', 'RPI(A)':'#c0448f', NCP:'#3fa34d', CPI:'#d64550',
    SHS:'#e07b39', 'LJP(RV)':'#5b8def', KPA:'#7a5c3e', IND:'#9aa0a6', OTHER:'#b9bcc2' };
  function partyColor(code){ return PARTY_COLOR[code] || '#b9bcc2'; }
  // candidate name = text in the LAST bracket group, so party codes written with
  // brackets ("JD(U) (Elangbam Dwijamani)", "RPI(A) (…)") don't get mis-parsed.
  function candOf(raw){ const s=String(raw||''); const i=s.lastIndexOf('('),j=s.lastIndexOf(')'); return (i>=0&&j>i)?s.slice(i+1,j).trim():''; }

  // ------------------------------------------------------------- age grouping
  const AGE_ORDER = ['18-24','25-34','35-44','45-59','60+'];
  function ageGroup(n){ n=parseInt(String(n).trim(),10); if(isNaN(n)||n<=0) return null;
    if(n<=24) return '18-24'; if(n<=34) return '25-34'; if(n<=44) return '35-44'; if(n<=59) return '45-59'; return '60+'; }
  function apiBandToGroup(lbl){ const m=String(lbl).match(/^(\d+)/); return m?ageGroup(m[1]):null; }

  // ------------------------------------------------------------------- caste
  // `Caste` is a free-text-ish live column (118 distinct values and growing), so
  // this normalises DEFENSIVELY rather than from a fixed list:
  //   - case / whitespace / trailing-punctuation / curly-quote folding, so new
  //     spellings of a known label ("KABUI" vs "Kabui") merge on their own;
  //   - a non-answer PATTERN (not a list) drops "don't know" / disconnected etc;
  //   - CASTE_ALIAS folds only TYPO/CASE VARIANTS OF THE SAME LABEL. Distinct
  //     tribes stay distinct — no ethnographic roll-up (decision: 2026-07-17).
  //   - anything unrecognised becomes its OWN category, never dropped, and is
  //     reported to the console so new live values get noticed.
  // NOTE: SC/Loi, Meitei SC and bare SC are deliberately kept SEPARATE.
  const CASTE_NONANSWER = /^\s*$|call\s*disconn|^disconn|don'?t\s*know|don,t\s*know|not\s*known|no\s*answer|not\s*telling|(don'?t|dont)\s*want|refus|^incomplete$|^no\s*caste$|^none(\s*of\s*the\s*above)?$|^no$|^na$|^n\/a$|^0$|can'?t\s*say|can'?t\s*identif|cant\s*identif|know\s*her\s*caste/i;
  const CASTE_ALIAS = {
    'pangal':'Pangal', 'meitei pangal':'Pangal',
    'meitei sc':'Meitei SC', 'meitei (sc)':'Meitei SC', 'meitai sc':'Meitei SC',
    'sc':'SC', 's c':'SC', 'schedule cast':'SC', 'scheduled cast':'SC', 'schedule caste':'SC',
    'sc/loi':'SC/Loi', 'sc / loi':'SC/Loi', 'loi':'SC/Loi',
    'kabui':'Kabui', 'kabui (naga)':'Kabui',
    'maring':'Maring Naga', 'maring naga':'Maring Naga', 'naga maring':'Maring Naga',
    'anal':'Naga/Anal', 'anal (naga)':'Naga/Anal', 'naga/anal':'Naga/Anal', 'naga / anal':'Naga/Anal',
    'chiru':'Chiru', 'chiru naga':'Chiru', 'chiru (naga)':'Chiru',
    'maram':'Maram', 'maram naga':'Maram',
    'aimol':'Aimol', 'aimol (naga)':'Aimol',
    'lamkang':'Lamkang', 'lamkang naga':'Lamkang', 'lamkand naga':'Lamkang',
    'kharam':'Kharam', 'kharm (naga)':'Kharam', 'kharam naga':'Kharam',
    'monsang':'Monsang', 'mongsang (naga)':'Monsang', 'naga monsang':'Monsang',
    'moyon':'Moyon', 'naga moyon':'Moyon',
    'thadou':'Thadou', 'thadou kuki':'Thadou',
    'mate':'Mate', 'kuki mothe':'Mate',
    'mizo':'Mizo', 'mazo':'Mizo',
    'muslim':'Muslim (unspecified)', 'manipuri muslim':'Muslim (unspecified)', 'monipuri muslim':'Muslim (unspecified)',
    'hindu':'Hindu (unspecified)', 'manipuri hindu':'Hindu (unspecified)', 'hindu singh':'Hindu (unspecified)', 'bihari hindu':'Hindu (unspecified)',
    'gorkha/nepali':'Gorkha/Nepali', 'gorkha / nepali':'Gorkha/Nepali', 'nepali':'Gorkha/Nepali', 'gorkha':'Gorkha/Nepali',
    'meitei':'Meitei (unspecified)', 'just meitei don know obc or gen':'Meitei (unspecified)',
    'bengali':'Bengali (unspecified)', 'bengali general':'Bengali (unspecified)',
    'assamese':'Assamese', 'kalita (assamese)':'Assamese',
    'adivasis':'Adivasi', 'adivasi':'Adivasi', 'adivasi karmakar':'Adivasi',
    'khasi':'Khasi', 'khasia (meghalaya)':'Khasi',
    'st':'ST (unspecified)', 'meitei st':'ST (unspecified)',
    'general':'General (unspecified)',
    'meitei gen':'Meitei Gen', 'meitei general':'Meitei Gen',
    'meitei obc':'Meitei OBC',
    'kuki-zo':'Kuki-Zo', 'kuki zo':'Kuki-Zo', 'kukizo':'Kuki-Zo'
  };
  const CASTE_UNMAPPED = {};   // reported to console for maintenance
  function titleCase(s){ return s.replace(/\w[^\s\/\-()]*/g, w => w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()); }
  function casteClean(raw){
    return String(raw == null ? '' : raw)
      .replace(/[‘’‛ʼ`]/g, "'")   // curly/back apostrophes
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, ' ')
      .replace(/\s*\(\s*/g, ' (').replace(/\s*\)\s*/g, ') ')   // "Chiru(naga)" -> "Chiru (naga)"
      .replace(/[.,;:]+$/, '')
      .trim();
  }
  function casteOf(row){
    const s = casteClean(row[CFG.col.caste]);
    if (!s || CASTE_NONANSWER.test(s)) return null;
    const k = s.toLowerCase().replace(/\)\s*$/, ')').trim();
    if (CASTE_ALIAS[k]) return CASTE_ALIAS[k];
    CASTE_UNMAPPED[s] = (CASTE_UNMAPPED[s] || 0) + 1;
    return titleCase(s);          // own category — never dropped
  }
  function reportUnmapped(){
    const list = Object.entries(CASTE_UNMAPPED).sort((a,b)=>b[1]-a[1]);
    if (list.length && window.console && console.info) {
      console.info('[caste] %d value(s) not in CASTE_ALIAS (kept as own category):', list.length);
      console.table(list.map(([value,n])=>({ value, n })));
    }
  }

  // ------------------------------------------------------------- date helpers
  function parseDMY(s){ const m=String(s||'').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m?new Date(+m[3],+m[2]-1,+m[1]):null; }
  function isoDay(d){ return d? d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0') : null; }
  function parseISO(s){ const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
  function daysBetween(a,b){ return Math.round((b.setHours(0,0,0,0)-a.setHours(0,0,0,0))/864e5); }

  function pct(n,d){ return d? n/d*100 : 0; }
  function fmtPct(x){ return (x<10?x.toFixed(1):Math.round(x))+'%'; }
  function fmtDelta(x){ return (x>=0?'+':'')+ (Math.abs(x)<10?x.toFixed(1):Math.round(x)) +'pp'; }
  function el(t,c){ const e=document.createElement(t); if(c) e.className=c; return e; }

  // ------------------------------------------------------------------ state
  let REF = {}, ROWS = [], SAMPLED = [], ACNAME = {};
  let curTab = 'summary';
  let curAC = 'ALL';
  let curMeasure = 'VoteNow';   // Cuts tab: what is measured
  let curCut = 'Caste';         // Cuts tab: what it is broken down by
  const SUMMARY_MIN = 10;   // deviations (pp) at/above this appear in the Summary table

  // ------------------------------------------------------------------ boot
  function boot(){
    const app=document.getElementById('app');
    Promise.all([
      fetch(CFG.referenceUrl).then(r=>r.json()),
      new Promise((res,rej)=>Papa.parse(CFG.csvUrl,{download:true,header:true,skipEmptyLines:true,complete:r=>res(r.data),error:rej}))
    ]).then(([ref,rows])=>{
      REF=ref; ROWS=rows;
      const inRef=new Set(Object.keys(REF)), present=new Set();
      ROWS.forEach(r=>{ const a=String(r[CFG.col.ac]||'').trim(); if(a) present.add(a); });
      SAMPLED=Array.from(present).filter(a=>inRef.has(a)).sort((a,b)=>+a-+b);
      Object.keys(REF).forEach(k=>ACNAME[k]=REF[k].name);
      render();
      reportUnmapped();   // surface any caste value not in CASTE_ALIAS
    }).catch(e=>{ app.innerHTML=`<div class="error-box">Could not load data: ${e&&e.message||e}</div>`; });
  }

  // -------------------------------------------------- data selection (VALID only)
  function validRows(acNo){
    return ROWS.filter(r=> String(r[CFG.col.ac]||'').trim()===acNo
      && r[CFG.col.finalCall]===CFG.validValue
      && (r[CFG.col.imVerdict]||'').trim()!==CFG.internalReject);
  }
  function acList(acKey){ return acKey==='ALL'? SAMPLED : [acKey]; }
  function validRowsMany(list){ return list.reduce((a,x)=>a.concat(validRows(x)),[]); }

  // ---- survey distributions (valid only) ----
  function surveyPartyCol(rows,col){ const cnt={}; let base=0,nonvote=0;
    rows.forEach(r=>{ const p=normParty(r[col]); if(p.nonvote){nonvote++;return;} cnt[p.code]=(cnt[p.code]||0)+1; base++; });
    return { cnt, base, nonvote }; }
  function surveyParty(rows){ return surveyPartyCol(rows,CFG.col.ae2022); }
  function surveyGender(rows){ let f=0,m=0; rows.forEach(r=>{ const g=(r[CFG.col.gender]||'').trim().toLowerCase();
    if(g.startsWith('f')) f++; else if(g.startsWith('m')) m++; }); return { f,m, base:f+m }; }
  function surveyAge(rows){ const cnt={}; let base=0; rows.forEach(r=>{ const g=ageGroup(r[CFG.col.age]); if(!g) return; cnt[g]=(cnt[g]||0)+1; base++; }); return { cnt, base }; }
  // caste: survey-only (no census/2022 benchmark exists for it)
  function surveyCaste(rows){ const cnt={}; let base=0, noAnswer=0;
    rows.forEach(r=>{ const c=casteOf(r); if(!c){ noAnswer++; return; } cnt[c]=(cnt[c]||0)+1; base++; });
    return { cnt, base, noAnswer }; }
  function surveyCand(rows){ const cnt={}; let base=0; rows.forEach(r=>{ const c=candOf(r[CFG.col.ae2022]); const p=normParty(r[CFG.col.ae2022]);
    if(p.nonvote||!c) return; cnt[c]=cnt[c]||{n:0,party:p.code}; cnt[c].n++; base++; }); return { cnt, base }; }

  // free-text candidate-preference columns (MLA Candidate / INC Candidate): a
  // non-answer (undecided / none / dropped call / party-only) is skipped.
  const GENERIC = /^\s*$|call\s*disconnect|no\s*one|any\s*one|anyone|not\s*decided|undecided|don'?t\s*know|no\s*idea|refus|^nota$|^none$|^no$|^na$|will\s*vote|my\s*choice|not\s*sure|can'?t\s*say|no\s*answer|will\s*decide|right\s*time/i;
  function choiceDist(rows, col, topN){ const cnt={}; let base=0;
    rows.forEach(r=>{ const v=String(r[col]||'').trim(); if(GENERIC.test(v)) return; cnt[v]=(cnt[v]||0)+1; base++; });
    return Object.entries(cnt).map(([k,n])=>({key:k,label:k,share:pct(n,base),n})).sort((a,b)=>b.share-a.share)
      .slice(0,topN||10).map((r,i)=>({ ...r, color:seriesVar(i) })); }

  // ---- actual distributions (reference) ----
  function actualParty(list){ const cnt={}; let total=0;
    list.forEach(a=>{ (REF[a].results2022||[]).forEach(c=>{ const code=normParty(c.party).code||'OTHER';
      cnt[code]=(cnt[code]||0)+(c.votes||0); total+=(c.votes||0); }); }); return { cnt, total }; }
  function actualGender(list){ let f=0,m=0; list.forEach(a=>{ const s=REF[a].demog.sex||{}; f+=(s.f||0); m+=(s.m||0); }); return { f,m, base:f+m }; }
  // census ageProp values are ALREADY percentages; pop-weight across ACs, no extra ×100.
  function actualAge(list){ const acc={}; let w=0;
    list.forEach(a=>{ const d=REF[a].demog, pop=d.totalPop||1, labs=d.ageLabels||[], props=d.ageProp||[];
      labs.forEach((lb,i)=>{ const g=apiBandToGroup(lb); if(!g) return; acc[g]=(acc[g]||0)+(props[i]||0)*pop; }); w+=pop; });
    const share={}; AGE_ORDER.forEach(g=>{ share[g]= w? (acc[g]||0)/w : 0; });   // already a percentage
    return { share }; }
  // NOTA is a ballot option, not a candidate — exclude it from the candidate chart.
  function actualCand(list){ const rows=[]; list.forEach(a=>{ (REF[a].results2022||[]).forEach(c=>{ const code=normParty(c.party).code||'OTHER';
    if(code==='NOTA') return; rows.push({name:c.name,party:code,votes:c.votes||0}); }); });
    const total=rows.reduce((s,c)=>s+c.votes,0); return { rows:rows.sort((a,b)=>b.votes-a.votes), total }; }

  // ------------------------------------------------------------- CUT MODEL
  // One declarative model so any MEASURE can be crossed by any DIMENSION.
  // Every cell is built from the same valid-sample base used everywhere else
  // (Auto-QC Valid, internal-QC rejects removed), so numbers reconcile with the
  // other tabs. `seg` returns null to EXCLUDE a row from that measure's base
  // (e.g. "don't know" answers) — never counted as a category.
  const MEASURES = [
    { key:'VoteNow',  label:'Vote Now (current intention)',
      seg:r=>{ const p=normParty(r[CFG.col.voteNow]); return p.nonvote?null:p.code; }, color:partyColor, party:true },
    { key:'AE2022',   label:'2022 Vote (recall)',
      seg:r=>{ const p=normParty(r[CFG.col.ae2022]); return p.nonvote?null:p.code; }, color:partyColor, party:true },
    { key:'Caste',    label:'Community / Caste', seg:r=>casteOf(r) },
    { key:'Gender',   label:'Gender',
      seg:r=>{ const g=(r[CFG.col.gender]||'').trim().toLowerCase();
               return g.startsWith('f')?'Female':(g.startsWith('m')?'Male':null); },
      order:['Female','Male'], color:s=>s==='Female'?'#c0448f':'#2a78d6' },
    { key:'AgeBand',  label:'Age band', seg:r=>ageGroup(r[CFG.col.age]), order:AGE_ORDER }
  ];
  const DIMS = [
    { key:'Caste',   label:'Community / Caste', val:r=>casteOf(r) },
    { key:'Gender',  label:'Gender', val:r=>{ const g=(r[CFG.col.gender]||'').trim().toLowerCase();
               return g.startsWith('f')?'Female':(g.startsWith('m')?'Male':null); }, order:['Female','Male'] },
    { key:'AgeBand', label:'Age band', val:r=>ageGroup(r[CFG.col.age]), order:AGE_ORDER },
    { key:'AC',      label:'Constituency (AC)', val:r=>{ const a=String(r[CFG.col.ac]||'').trim(); return a?a:null; },
      sort:(a,b)=>(+a)-(+b), labelOf:a=>`${a} ${ACNAME[a]||''}`.trim(), cap:60 },
    { key:'Vendor',  label:'Vendor', val:r=>{ const v=(r[CFG.col.vendor]||'').trim(); return v?v:null; } }
  ];
  const CUT_CAP = 12;          // categories shown before folding into "Other"
  const CUT_MIN_BASE = 30;     // rows below this are flagged as a low base

  function measureBy(key){ return MEASURES.find(m=>m.key===key); }
  function dimBy(key){ return DIMS.find(d=>d.key===key); }

  // counts of one measure over an arbitrary subset -> {counts:{seg:n}, total}
  function tally(subset, m){
    const counts={}; let total=0;
    subset.forEach(r=>{ const s=m.seg(r); if(s==null||s==='') return; counts[s]=(counts[s]||0)+1; total++; });
    return { counts, total };
  }
  // segment order: fixed if the measure declares one, else by overall volume
  function segOrderFor(m, rows){
    if (m.order) { const t=tally(rows,m); return m.order.filter(s=>t.counts[s]); }
    const t=tally(rows,m);
    return Object.entries(t.counts).sort((a,b)=>b[1]-a[1]).map(e=>e[0]);
  }
  // build the crosstab rows for measure m cut by dimension d
  function crosstab(rows, m, d){
    const groups=new Map();
    rows.forEach(r=>{ const k=d.val(r); if(k==null||k==='') return;
      if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(r); });
    let keys=Array.from(groups.keys());
    // rank by group size, then apply the dimension's own ordering if it has one
    keys.sort((a,b)=>groups.get(b).length-groups.get(a).length);
    const cap=d.cap||CUT_CAP;
    let shown=keys.slice(0,cap); const rest=keys.slice(cap);
    if (d.order) shown=d.order.filter(k=>groups.has(k));
    else if (d.sort) shown=shown.slice().sort(d.sort);
    const out=shown.map(k=>{ const sub=groups.get(k); const t=tally(sub,m);
      return { key:k, label:d.labelOf?d.labelOf(k):k, total:t.total, counts:t.counts, n:sub.length }; });
    if (!d.order && rest.length){
      const sub=rest.reduce((a,k)=>a.concat(groups.get(k)),[]); const t=tally(sub,m);
      out.push({ key:'__OTHER__', label:`Other (${rest.length} groups)`, total:t.total, counts:t.counts, n:sub.length, isOther:true });
    }
    return out;
  }

  // ------------------------------------------------- deviation summary (neutral)
  function deviations(acKey){
    const list=acList(acKey), rows=validRowsMany(list), n=rows.length;
    const out={ n, lowBase:n<CFG.minBase, rows:[] };
    if(n===0) return out;
    // gender (female share)
    const sg=surveyGender(rows), ag=actualGender(list);
    const sF=pct(sg.f,sg.base), aF=pct(ag.f,ag.base);
    out.rows.push({ measure:'Female share', sample:sF, actual:aF, delta:sF-aF });
    // age bands
    const sa=surveyAge(rows), aa=actualAge(list);
    AGE_ORDER.forEach(g=>{ const s=pct(sa.cnt[g]||0,sa.base), a=aa.share[g]||0;
      out.rows.push({ measure:'Age '+g, sample:s, actual:a, delta:s-a, minor:true }); });
    // major parties (2022 recall vs actual, base = named-party respondents)
    const sp=surveyParty(rows), ap=actualParty(list);
    out.recallBase=sp.base;
    Object.keys(ap.cnt).map(code=>({code,aShare:pct(ap.cnt[code],ap.total)}))
      .filter(x=>x.aShare>=CFG.partyMinShare && x.code!=='NOTA')
      .sort((x,y)=>y.aShare-x.aShare)
      .forEach(x=>{ const s=pct(sp.cnt[x.code]||0, sp.base);
        out.rows.push({ measure:x.code+' (2022 vote)', sample:s, actual:x.aShare, delta:s-x.aShare, party:true }); });
    return out;
  }

  // ------------------------------------------------------------------ render
  function render(){
    const app=document.getElementById('app'); app.innerHTML='';
    app.appendChild(tabBar());
    if(curTab!=='summary') app.appendChild(scopeBar());
    const body=el('div'); body.id='tab-body'; app.appendChild(body);
    if(curTab==='summary') drawSummary(body);
    else if(curTab==='repr') drawRepr(body);
    else if(curTab==='cuts') drawCuts(body);
    else drawOps(body);
    app.appendChild(footer());
  }

  function tabBar(){
    const bar=el('div','tabs');
    [['summary','Summary'],['repr','Sample vs Actual'],['cuts','Cross-Tabulation'],['ops','Field Operations']].forEach(([k,label])=>{
      const b=el('button','tab'+(curTab===k?' active':'')); b.textContent=label;
      b.onclick=()=>{ curTab=k; render(); }; bar.appendChild(b); });
    return bar;
  }

  // -------------------------------------------------------------------- SUMMARY
  // Consolidated statewide view: every notable deviation (major party 2022 recall
  // + female share) across all sampled ACs, largest first — presented formally.
  function allDeviations(){
    const out=[];
    SAMPLED.forEach(a=>{ const d=deviations(a); if(d.n===0||d.lowBase) return;
      d.rows.forEach(r=>{ if(r.minor) return;                 // skip age bands here
        if(Math.abs(r.delta)>=SUMMARY_MIN) out.push({ ac:a, name:ACNAME[a], ...r }); }); });
    return out.sort((x,y)=>Math.abs(y.delta)-Math.abs(x.delta));
  }
  function drawSummary(body){
    const devs=allDeviations();
    const scored=SAMPLED.filter(a=>{ const d=deviations(a); return d.n>0 && !d.lowBase; });
    const withDev=new Set(devs.map(d=>d.ac));
    const totalValid=validRowsMany(SAMPLED).length;

    const tiles=el('div','tiles'); body.appendChild(tiles);
    tile(tiles,'Constituencies',String(SAMPLED.length),'sampled & benchmarked');
    tile(tiles,'Valid samples',totalValid.toLocaleString(),'survey analysis base');
    tile(tiles,'Close to benchmark',String(scored.length-withDev.size)+' / '+scored.length, `within ±${SUMMARY_MIN}pp on all measures`,'good');
    tile(tiles,'Notable deviations',String(devs.length), `≥ ${SUMMARY_MIN}pp from 2022 / census`, devs.length?'warning':'good');

    section(body,'Statewide deviation overview',
      `Where the survey diverges most from the actual 2022 result or census, by percentage points. Major parties (≥${CFG.partyMinShare}% of the 2022 vote) and female share; constituencies with fewer than ${CFG.minBase} valid samples are excluded. Select "view" to open that constituency.`);
    if(!devs.length){ const p=el('p','empty-note'); p.textContent=`Every sampled constituency is within ±${SUMMARY_MIN}pp on all measures.`; body.appendChild(p); return; }
    const wrap=el('div','cards'); const cardEl=el('div','card'); cardEl.style.gridColumn='1 / -1';
    const tbl=el('table','data-table');
    tbl.innerHTML='<thead><tr><th>Constituency</th><th>Measure</th><th class="num">Survey</th><th class="num">Actual</th><th class="num">Deviation</th><th></th></tr></thead>';
    const tb=el('tbody');
    devs.forEach(r=>{
      const big=Math.abs(r.delta)>=15;
      const tr=el('tr');
      tr.innerHTML=`<td>AC ${r.ac} · ${r.name}</td><td>${r.measure}</td>`+
        `<td class="num">${fmtPct(r.sample)}</td><td class="num">${fmtPct(r.actual)}</td>`+
        `<td class="num ${big?'dev-big':''}">${fmtDelta(r.delta)}</td>`+
        `<td><span class="link-btn" data-ac="${r.ac}">view →</span></td>`;
      tb.appendChild(tr);
    });
    tbl.appendChild(tb); cardEl.appendChild(tbl); wrap.appendChild(cardEl); body.appendChild(wrap);
    tb.querySelectorAll('.link-btn').forEach(s=>s.onclick=()=>{ curTab='repr'; curAC=s.getAttribute('data-ac'); render(); });
  }
  function scopeBar(){
    const bar=el('div','scopebar'), field=el('div','field');
    const lab=el('label'); lab.textContent='Constituency'; field.appendChild(lab);
    const sel=el('select');
    const optAll=el('option'); optAll.value='ALL'; optAll.textContent='Whole State (all 29 sampled ACs)'; sel.appendChild(optAll);
    SAMPLED.forEach(a=>{ const o=el('option'); o.value=a; o.textContent=`AC ${a} — ${ACNAME[a]}`; sel.appendChild(o); });
    sel.value=curAC; sel.onchange=()=>{ curAC=sel.value; render(); };
    field.appendChild(sel); bar.appendChild(field);
    const hint=el('div','hint'); hint.textContent = curAC==='ALL'
      ? 'State view aggregates all sampled constituencies. Select a constituency to drill in.'
      : `Survey figures use valid samples only.`;
    bar.appendChild(hint);
    return bar;
  }

  // --------------------------------------------------------- SAMPLE vs ACTUAL
  function drawRepr(body){
    const list=acList(curAC), dev=deviations(curAC);

    const tiles=el('div','tiles'); body.appendChild(tiles);
    tile(tiles,'Valid sample (n)', dev.n.toLocaleString(), dev.lowBase?`low base (<${CFG.minBase})`:'survey analysis base', dev.lowBase?'warning':undefined);
    if(curAC!=='ALL'){
      const w=(REF[curAC].results2022||[])[0];
      tile(tiles,'2022 winner', w?normParty(w.party).code:'—', w?w.name:'');
      tile(tiles,'2022 valid votes',(REF[curAC].totalVotes2022||0).toLocaleString(),'this constituency');
    } else {
      tile(tiles,'Constituencies',String(SAMPLED.length),'sampled & benchmarked');
      const tot=list.reduce((s,a)=>s+(REF[a].totalVotes2022||0),0);
      tile(tiles,'2022 valid votes', tot.toLocaleString(),'across sampled ACs');
    }

    // deviation summary table (formal, neutral)
    section(body,'Deviation summary',
      'Survey figure vs actual 2022 result / census, in percentage points. Party rows compare 2022 vote recall (base: respondents who named a party) to the actual 2022 vote share.');
    const wrap=el('div','cards'); const cardEl=el('div','card'); cardEl.style.gridColumn='1 / -1';
    const tbl=el('table','data-table');
    tbl.innerHTML='<thead><tr><th>Measure</th><th class="num">Survey</th><th class="num">Actual</th><th class="num">Deviation</th></tr></thead>';
    const tb=el('tbody');
    dev.rows.forEach(r=>{
      const big=Math.abs(r.delta)>=15;
      const tr=el('tr');
      tr.innerHTML=`<td>${r.measure}</td><td class="num">${fmtPct(r.sample)}</td>`+
        `<td class="num">${fmtPct(r.actual)}</td>`+
        `<td class="num ${big?'dev-big':''}">${fmtDelta(r.delta)}</td>`;
      tb.appendChild(tr);
    });
    tbl.appendChild(tb); cardEl.appendChild(tbl);
    if(dev.lowBase){ const p=el('p','card-sub'); p.textContent=`Note: only ${dev.n} valid samples in scope — deviations are indicative, not conclusive.`; cardEl.appendChild(p); }
    wrap.appendChild(cardEl); body.appendChild(wrap);

    // Vote Now (current intention) vs 2022 result — the swing
    section(body,'Vote Now — current intention vs 2022 result',
      'Left: current vote intention in the survey (base: respondents who named a party). Right: the actual 2022 result — read together, the two show the swing since 2022.');
    comparePair(body,
      { title:'Survey — Vote Now', dist: partyDist(surveyPartyCol(validRowsMany(list),CFG.col.voteNow)) },
      { title:'Actual 2022 result', dist: partyDist(actualParty(list)) });

    // 2022 Vote recall vs actual result
    section(body,'2022 Vote — survey recall vs actual result',
      'Left: sample recall of 2022 vote (base: respondents who named a party). Right: actual 2022 result. Party set is what the record shows for this constituency.');
    comparePair(body,
      { title:'Survey recall', dist: partyDist(surveyParty(validRowsMany(list))) },
      { title:'Actual 2022 result', dist: partyDist(actualParty(list)) });

    // 2022 Candidate
    section(body,'2022 Candidate — survey recall vs actual',
      'Candidate level. Shows whether the sample reflects each constituency’s actual candidate contest.');
    comparePair(body,
      { title:'Survey recall', dist: candDist(surveyCand(validRowsMany(list))) },
      { title:'Actual 2022 result', dist: candActualDist(list) });

    // Candidate Choice (current preferred MLA) — survey only, no 2022 benchmark
    section(body,'Candidate Choice — preferred MLA (current)',
      'Who respondents name as their preferred MLA candidate now (valid samples; undecided/none excluded). A current preference, so there is no 2022 benchmark — read per constituency.');
    singleCard(body, choiceDist(validRowsMany(list), CFG.col.mlaCandidate, 10));

    // Preferred INC candidate — survey only
    section(body,'Preferred INC Candidate (current)',
      'Preferred candidate from INC named in the survey (valid samples; undecided/none excluded).');
    singleCard(body, choiceDist(validRowsMany(list), CFG.col.incCandidate, 10));

    // Gender
    section(body,'Gender — survey vs census','');
    comparePair(body,
      { title:'Survey', dist: genderDist(surveyGender(validRowsMany(list))) },
      { title:'Actual (census)', dist: genderDistA(actualGender(list)) });

    // Age
    section(body,'Age — survey vs census','');
    comparePair(body,
      { title:'Survey', dist: ageDist(surveyAge(validRowsMany(list))) },
      { title:'Actual (census)', dist: ageDistA(actualAge(list)) }, AGE_ORDER);

    // Community / Caste — survey only. The census benchmark carries age, sex and
    // region but no caste, so this is presented on its own, without comparison.
    const sc=surveyCaste(validRowsMany(list));
    section(body,'Community / Caste — sample composition',
      `How the valid sample breaks down by community (base: ${sc.base.toLocaleString()} respondents who stated one${sc.noAnswer?`; ${sc.noAnswer} did not`:''}). Survey-only — there is no census or 2022 benchmark for caste, so no comparison is shown. Spelling variants of the same answer are merged; distinct communities are not rolled up.`);
    singleCard(body, casteDist(sc), 10);
  }

  // distribution builders -> [{key,label,share,n,color}]
  function partyDist(o){ const total=o.base!=null?o.base:o.total;
    return Object.entries(o.cnt).map(([k,v])=>({key:k,label:k,share:pct(v,total),n:Math.round(v),color:partyColor(k)})).sort((a,b)=>b.share-a.share); }
  function genderDist(sg){ return [{key:'Female',label:'Female',share:pct(sg.f,sg.base),n:sg.f,color:'#c0448f'},{key:'Male',label:'Male',share:pct(sg.m,sg.base),n:sg.m,color:'#2a78d6'}]; }
  function genderDistA(ag){ return [{key:'Female',label:'Female',share:pct(ag.f,ag.base),n:ag.f,color:'#c0448f'},{key:'Male',label:'Male',share:pct(ag.m,ag.base),n:ag.m,color:'#2a78d6'}]; }
  function ageDist(sa){ return AGE_ORDER.map((g,i)=>({key:g,label:g,share:pct(sa.cnt[g]||0,sa.base),n:sa.cnt[g]||0,color:seriesVar(i)})); }
  function ageDistA(aa){ return AGE_ORDER.map((g,i)=>({key:g,label:g,share:aa.share[g]||0,n:null,color:seriesVar(i)})); }
  function candDist(sc){ return Object.entries(sc.cnt).map(([name,o])=>({key:name,label:name,share:pct(o.n,sc.base),n:o.n,color:partyColor(o.party)})).sort((a,b)=>b.share-a.share).slice(0,8); }
  // full caste list, ranked; sideChart/singleCard folds the tail into "Other".
  function casteDist(sc){ return Object.entries(sc.cnt).map(([k,n],i)=>({key:k,label:k,share:pct(n,sc.base),n}))
    .sort((a,b)=>b.share-a.share).map((r,i)=>({ ...r, color:seriesVar(i) })); }
  function candActualDist(list){ const a=actualCand(list); return a.rows.slice(0,8).map(c=>({key:c.name,label:c.name,share:pct(c.votes,a.total),n:c.votes,color:partyColor(c.party)})); }
  function seriesVar(i){ return `var(--series-${(i%8)+1})`; }

  // single full-width chart card (same card style as the side-by-side ones) —
  // for survey-only measures that have no actual benchmark.
  function singleCard(body, dist, foldAfter){
    const wrap=el('div','cards'); const cardEl=el('div','card'); cardEl.style.gridColumn='1 / -1';
    if(!dist.length){ const p=el('p','empty-note'); p.textContent='No named preference in scope.'; cardEl.appendChild(p); }
    else {
      let rows=dist;
      if(foldAfter && dist.length>foldAfter+1){
        const top=dist.slice(0,foldAfter), rest=dist.slice(foldAfter);
        rows=top.concat([{ key:'__OTHER__', label:`Other (${rest.length})`,
          share:rest.reduce((s,r)=>s+r.share,0), n:rest.reduce((s,r)=>s+(r.n||0),0), color:'#b9bcc2' }]);
        const head=el('div','cmp-head'); const h=el('h4'); h.textContent=''; head.appendChild(h);
        const btn=el('button','link-btn'); let open=false; btn.textContent=`expand Other (${rest.length})`;
        btn.onclick=()=>{ open=!open; btn.textContent=open?'collapse':`expand Other (${rest.length})`; hbars(plot, open?dist:rows); };
        head.appendChild(btn); cardEl.appendChild(head);
      }
      var plot=el('div'); cardEl.appendChild(plot); hbars(plot, rows);
    }
    wrap.appendChild(cardEl); body.appendChild(wrap);
  }

  // side-by-side pair, "Other" expandable
  function comparePair(body,left,right,fixedOrder){
    const cardEl=el('div','card'); cardEl.style.gridColumn='1 / -1';
    const grid=el('div','cmp-grid');
    grid.appendChild(sideChart(left,fixedOrder));
    grid.appendChild(sideChart(right,fixedOrder));
    cardEl.appendChild(grid);
    const wrap=el('div','cards'); wrap.appendChild(cardEl); body.appendChild(wrap);
  }
  function sideChart(side,fixedOrder){
    const box=el('div','cmp-side '+(side.title.toLowerCase().includes('survey')?'survey':'actual'));
    const head=el('div','cmp-head'); const h=el('h4'); h.textContent=side.title; head.appendChild(h); box.appendChild(head);
    let rows=side.dist.slice();
    if(!fixedOrder && rows.length>7){
      const top=rows.slice(0,6), rest=rows.slice(6);
      const oShare=rest.reduce((s,r)=>s+r.share,0), oN=rest.reduce((s,r)=>s+(r.n||0),0);
      top.push({key:'__OTHER__',label:`Other (${rest.length})`,share:oShare,n:oN,color:'#b9bcc2'});
      rows=top;
      const btn=el('button','link-btn'); let open=false; btn.textContent='expand Other';
      btn.onclick=()=>{ open=!open; btn.textContent=open?'collapse':'expand Other'; hbars(plot, open?side.dist.slice():rows, fixedOrder); };
      head.appendChild(btn);
    }
    const plot=el('div'); box.appendChild(plot); hbars(plot,rows,fixedOrder);
    return box;
  }

  // ------------------------------------------------------------ CROSS-TABULATION
  // "How is <measure> distributed within each <dimension>?" — e.g. Vote Now by
  // Caste, by Gender, by Age. Each row is that group's own 100% distribution, so
  // rows are comparable regardless of group size; the group's base (n) is printed
  // at the right, because a 100% bar over n=12 means very little.
  function drawCuts(body){
    // measure and cut must differ (cutting Caste by Caste is degenerate)
    if(curCut===curMeasure) curCut=DIMS.find(x=>x.key!==curMeasure).key;
    const list=acList(curAC), rows=validRowsMany(list);
    const m=measureBy(curMeasure), d=dimBy(curCut);

    body.appendChild(cutBar());

    const segs=segOrderFor(m, rows);
    const overall=tally(rows, m);
    const ct=crosstab(rows, m, d);

    const tiles=el('div','tiles'); body.appendChild(tiles);
    tile(tiles,'Valid sample (n)', rows.length.toLocaleString(), 'analysis base in scope');
    tile(tiles,`${m.label} — base`, overall.total.toLocaleString(),
      rows.length-overall.total ? `${(rows.length-overall.total).toLocaleString()} gave no usable answer` : 'all respondents answered');
    tile(tiles,`${d.label} — groups`, String(ct.filter(r=>!r.isOther).length), 'shown separately');
    const thin=ct.filter(r=>!r.isOther && r.total<CUT_MIN_BASE).length;
    tile(tiles,'Low-base groups', String(thin), `fewer than ${CUT_MIN_BASE} answers`, thin?'warning':'good');

    section(body, `${m.label} — by ${d.label}`,
      `Each bar is the distribution of ${m.label.toLowerCase()} WITHIN that ${d.label.toLowerCase()} group, so every bar totals 100%. "n" at the right is the number of respondents behind the bar — read groups with small n with caution. Base excludes respondents who gave no usable answer for ${m.label.toLowerCase()}.`);

    if(!ct.length || !segs.length){
      const p=el('p','empty-note'); p.textContent='No data for this combination in the current scope.'; body.appendChild(p);
      return;
    }

    const wrap=el('div','cards'); const cardEl=el('div','card'); cardEl.style.gridColumn='1 / -1';
    legendRow(cardEl, segs.map((s,i)=>({ name:s, color:(m.color?m.color(s):seriesVar(i)) })));
    const plot=el('div'); cardEl.appendChild(plot);
    const allRows=[{ key:'__ALL__', label:(curAC==='ALL'?'All sampled ACs':`AC ${curAC}`), total:overall.total, counts:overall.counts, overall:true }].concat(ct);
    stacked100(plot, allRows, segs, m);
    wrap.appendChild(cardEl); body.appendChild(wrap);

    // the same numbers as a table — so figures can be read/copied exactly
    section(body,'Underlying numbers','Counts behind each bar. Percentages are of the row base.');
    const twrap=el('div','cards'); const tcard=el('div','card'); tcard.style.gridColumn='1 / -1';
    const tbl=el('table','data-table');
    tbl.innerHTML='<thead><tr><th>'+d.label+'</th><th class="num">Base (n)</th>'+
      segs.map(s=>`<th class="num">${s}</th>`).join('')+'</tr></thead>';
    const tb=el('tbody');
    allRows.forEach(r=>{
      const tr=el('tr');
      if(r.overall) tr.style.fontWeight='700';
      tr.innerHTML=`<td>${r.label}</td><td class="num">${r.total.toLocaleString()}</td>`+
        segs.map(s=>{ const n=r.counts[s]||0; return `<td class="num">${n?`${fmtPct(pct(n,r.total))} <span style="color:var(--text-muted)">(${n})</span>`:'—'}</td>`; }).join('');
      tb.appendChild(tr);
    });
    tbl.appendChild(tb); tcard.appendChild(tbl); twrap.appendChild(tcard); body.appendChild(twrap);
  }

  function cutBar(){
    const bar=el('div','cutby-bar');
    const mk=(labelText, opts, cur, onPick)=>{
      const lab=el('label'); lab.textContent=labelText; bar.appendChild(lab);
      const sel=el('select');
      opts.forEach(o=>{ const op=el('option'); op.value=o.key; op.textContent=o.label; sel.appendChild(op); });
      sel.value=cur; sel.onchange=()=>{ onPick(sel.value); render(); }; bar.appendChild(sel);
    };
    mk('Measure', MEASURES, curMeasure, v=>curMeasure=v);
    mk('Cut by', DIMS.filter(d=>d.key!==curMeasure), curCut, v=>curCut=v);
    return bar;
  }

  function legendRow(parent, items){
    const lg=el('div','legend');
    items.forEach(it=>{ const i=el('span','item');
      const sw=el('span','swatch'); sw.style.background=it.color;
      const nm=el('span'); nm.textContent=it.name;
      i.appendChild(sw); i.appendChild(nm); lg.appendChild(i); });
    parent.appendChild(lg);
  }

  // 100% stacked bars — same visual grammar as the other dashboards' crosstabs.
  function stacked100(container, rows, segs, m){
    const VBW=520, rowH=32, marginL=150, marginR=52;
    const plotW=VBW-marginL-marginR, h=rows.length*rowH+6;
    const NS='http://www.w3.org/2000/svg';
    const svg=document.createElementNS(NS,'svg');
    svg.setAttribute('class','chart-svg'); svg.setAttribute('width','100%'); svg.setAttribute('height',h);
    svg.setAttribute('viewBox',`0 0 ${VBW} ${h}`); svg.setAttribute('preserveAspectRatio','xMinYMin meet');
    function mk(t,at){ const e=document.createElementNS(NS,t); for(const k in at) e.setAttribute(k,at[k]); return e; }
    rows.forEach((r,i)=>{
      const y=i*rowH;
      const lbl=mk('text',{x:marginL-8,y:y+rowH/2+4,'text-anchor':'end',
        class:r.overall?'row-label overall-label':'row-label'});
      lbl.textContent=(r.label.length>22?r.label.slice(0,21)+'…':r.label);
      const ttl=document.createElementNS(NS,'title'); ttl.textContent=r.label; lbl.appendChild(ttl);
      svg.appendChild(lbl);
      if(r.overall) svg.appendChild(mk('line',{x1:0,x2:VBW,y1:y+rowH-1,y2:y+rowH-1,class:'gridline'}));
      let x=marginL;
      if(r.total>0){
        segs.forEach((s,si)=>{
          const n=r.counts[s]||0; if(n<=0) return;
          const p=pct(n,r.total), w=p/100*plotW;
          const rect=mk('rect',{x,y:y+6,width:Math.max(w-1,0),height:rowH-14,rx:2,
            fill:(m.color?m.color(s):seriesVar(si)),class:'bar'});
          const t=document.createElementNS(NS,'title');
          t.textContent=`${r.label} — ${s}: ${fmtPct(p)} (${n} of ${r.total})`; rect.appendChild(t);
          svg.appendChild(rect);
          if(w>26){ const tx=mk('text',{x:x+w/2,y:y+rowH/2+4,'text-anchor':'middle',class:'seg-pct'});
            tx.textContent=Math.round(p)+'%'; svg.appendChild(tx); }
          x+=w;
        });
      }
      const tot=mk('text',{x:VBW-marginR+8,y:y+rowH/2+4,class:'seg-total'});
      tot.textContent=r.total<CUT_MIN_BASE && !r.overall ? `n=${r.total} ⚠` : `n=${r.total}`;
      svg.appendChild(tot);
    });
    container.innerHTML=''; container.appendChild(svg);
  }

  // ------------------------------------------------------------ FIELD OPERATIONS
  function drawOps(body){
    const scope = curAC==='ALL' ? ROWS : ROWS.filter(r=>String(r[CFG.col.ac]||'').trim()===curAC);
    const total=scope.length;
    const valid=scope.filter(r=>r[CFG.col.finalCall]===CFG.validValue).length;
    const invalid=total-valid;
    const daysLeft=Math.max(0,daysBetween(new Date(),parseISO(CFG.deadline)));

    const tiles=el('div','tiles'); body.appendChild(tiles);
    tile(tiles, curAC==='ALL'?'Total done (state)':'Done (constituency)', total.toLocaleString(), curAC==='ALL'?`target ${CFG.target.toLocaleString()}`:`target ${CFG.perAcTarget}`);
    tile(tiles,'Valid',valid.toLocaleString(),`${fmtPct(pct(valid,total))} valid rate`, pct(valid,total)<50?'warning':'good');
    tile(tiles,'Invalid',invalid.toLocaleString(),`${fmtPct(pct(invalid,total))} of done`);
    tile(tiles,'Days to deadline',String(daysLeft),CFG.deadline, daysLeft<=2?'warning':undefined);

    section(body,'By constituency — collection progress',
      `Valid samples against a target of ${CFG.perAcTarget} per constituency. "Last data" is the most recent response date received.`);
    const wrap=el('div','cards'); const cardEl=el('div','card'); cardEl.style.gridColumn='1 / -1';
    const tbl=el('table','data-table');
    tbl.innerHTML='<thead><tr><th>Constituency</th><th class="num">Done</th><th class="num">Valid</th><th class="num">Valid %</th><th class="num">Target</th><th class="num">Progress</th><th>Last data</th></tr></thead>';
    const tb=el('tbody');
    const good=cssVar('--status-good'), warn=cssVar('--status-warning'), muted=cssVar('--text-muted');
    SAMPLED.forEach(a=>{
      const rowsA=ROWS.filter(r=>String(r[CFG.col.ac]||'').trim()===a);
      const done=rowsA.length, v=rowsA.filter(r=>r[CFG.col.finalCall]===CFG.validValue).length;
      const prog=pct(v,CFG.perAcTarget);
      let last=0; rowsA.forEach(r=>{ const d=parseDMY(r[CFG.col.timestamp]); if(d) last=Math.max(last,d.getTime()); });
      const progColor = v>=CFG.perAcTarget?good : (v>=0.9*CFG.perAcTarget?warn:muted);
      const tr=el('tr');
      tr.innerHTML=`<td>${a} ${ACNAME[a]}</td><td class="num">${done}</td><td class="num">${v}</td>`+
        `<td class="num">${fmtPct(pct(v,done))}</td><td class="num">${CFG.perAcTarget}</td>`+
        `<td class="num" style="color:${progColor};font-weight:600">${Math.round(prog)}%</td>`+
        `<td>${last?isoDay(new Date(last)):'—'}</td>`;
      tb.appendChild(tr);
    });
    tbl.appendChild(tb); cardEl.appendChild(tbl); wrap.appendChild(cardEl); body.appendChild(wrap);

    section(body,'Vendor split (in scope)','');
    const vc={}; scope.forEach(r=>{ const v=(r[CFG.col.vendor]||'?').trim(); vc[v]=(vc[v]||0)+1; });
    const vwrap=el('div','cards'); const vcard=el('div','card');
    hbars(vcard, Object.entries(vc).map(([k,n],i)=>({key:k,label:k,share:pct(n,total),n,color:seriesVar(i)})).sort((a,b)=>b.share-a.share));
    vwrap.appendChild(vcard); body.appendChild(vwrap);
  }

  // ------------------------------------------------------------- chart helper
  function hbars(container, rows, fixedOrder){
    const VBW=520, rowH=28, marginL=150, labelCol=68, gap=8, marginR=labelCol+gap;
    const plotW=VBW-marginL-marginR, maxShare=Math.max(1,...rows.map(r=>r.share)), h=rows.length*rowH+6;
    const NS='http://www.w3.org/2000/svg';
    const svg=document.createElementNS(NS,'svg');
    svg.setAttribute('class','chart-svg'); svg.setAttribute('width','100%'); svg.setAttribute('height',h);
    svg.setAttribute('viewBox',`0 0 ${VBW} ${h}`); svg.setAttribute('preserveAspectRatio','xMinYMin meet');
    function mk(t,at){ const e=document.createElementNS(NS,t); for(const k in at) e.setAttribute(k,at[k]); return e; }
    rows.forEach((r,i)=>{ const y=i*rowH, w=Math.max(r.share/maxShare*plotW,2);
      const lbl=mk('text',{x:marginL-8,y:y+rowH/2+4,'text-anchor':'end',class:'row-label'});
      lbl.textContent=(r.label.length>20?r.label.slice(0,19)+'…':r.label); svg.appendChild(lbl);
      svg.appendChild(mk('rect',{x:marginL,y:y+4,width:w,height:rowH-11,rx:3,fill:r.color,class:'bar'}));
      const vl=mk('text',{x:VBW,y:y+rowH/2+4,'text-anchor':'end',class:'direct-label'});
      vl.textContent = r.n!=null ? `${fmtPct(r.share)} (${r.n})` : fmtPct(r.share); svg.appendChild(vl);
    });
    container.innerHTML=''; container.appendChild(svg);
  }

  // --------------------------------------------------------------- ui atoms
  function cssVar(n){ return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function tile(parent,label,value,sub,status){ const t=el('div','tile');
    const l=el('div','label'); l.textContent=label; const v=el('div','value'); v.textContent=value;
    t.appendChild(l); t.appendChild(v); if(sub){ const s=el('div','sub'+(status?' '+status:'')); s.textContent=sub; t.appendChild(s);} parent.appendChild(t); }
  function section(parent,title,sub){ const h=el('div','section-head'); h.textContent=title; parent.appendChild(h);
    if(sub){ const p=el('div','section-sub'); p.textContent=sub; parent.appendChild(p);} }
  function footer(){ const f=el('p','footer-note'); f.textContent=`Live survey sample (valid only) vs 2022 result & census benchmark · loaded ${new Date().toLocaleString()}`; return f; }

  boot();
})();
