/* brotools/js/tools/plan-tracer/index.js */
/* =============================================================================
   Plan Tracer — BroTools module
   -----------------------------------------------------------------------------
   Contract (match this to the PDF Toolkit module):
     import { mount, unmount } from './js/tools/plan-tracer/index.js';
     mount(container)  -> builds the tool inside `container`
     unmount()         -> tears it down, removing all window/document listeners
   The tool renders NO header of its own; it fills its container, which the hub
   places below the fixed site header. Styles are scoped to .tool-plan-tracer and
   loaded from ./plan-tracer.css (relative to this file). Libraries load from
   ./libraries/ via manifest.json, also relative to this file.
   ============================================================================= */

/* ---- module-scope symbol registry (persists across mounts) ---------------- */
const LIB = {};                               // { CategoryName: { key: {name,svg,...} } }
window.PlanTracer = window.PlanTracer || {};
window.PlanTracer.registerLibrary = function(def){
  if(!def || !def.name || !def.symbols) return;
  LIB[def.name] = def.symbols;                 // later registration overrides same-named
};

// minimal fallback so the app works even if libraries/ can't be fetched
window.PlanTracer.registerLibrary({ id:'basic', name:'Basic', symbols:{
  downlight:{name:'Downlight', svg:`<circle cx="0" cy="0" r="10"/><path d="M-7-7 7 7M-7 7 7-7"/>`},
  door:{name:'Door', cut:16, svg:`<path d="M-8 0v-15"/><path d="M-8-15A15 15 0 0 1 7 0" stroke-dasharray="2.5 2.5"/><path d="M-11 0h3M8 0h3"/>`},
  valve:{name:'Valve', symmetric:true, svg:`<path d="M-10-7 0 0-10 7zM10-7 0 0 10 7z" fill="currentColor" fill-opacity=".2"/><path d="M0 0v-9M-5-9h10"/>`}
}});

/* ---- library loading, relative to THIS module via import.meta.url --------- */
const LIB_BASE = new URL('./libraries/', import.meta.url);
let _libsLoaded = false;
function loadScriptOnce(src){
  const abs = (typeof src === 'string') ? src : src.href;
  if([...document.scripts].some(s => s.src === abs)) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = abs; s.onload = res; s.onerror = () => rej(new Error(abs));
    document.head.appendChild(s);
  });
}
async function ensureLibraries(){
  if(_libsLoaded) return;
  const res = await fetch(new URL('manifest.json', LIB_BASE), {cache:'no-store'});
  if(!res.ok) throw new Error('manifest ' + res.status);
  const { libraries = [] } = await res.json();
  for(const name of libraries){
    try{ await loadScriptOnce(new URL(name + '.js', LIB_BASE)); }catch{ /* skip one bad file */ }
  }
  _libsLoaded = true;
}

/* ---- active-instance bookkeeping ------------------------------------------ */
let _active = null;
let _cssLink = null;
let _toastHandle = null;

export function mount(container){
  if(_active) unmount();                        // one instance at a time
  container.innerHTML = TEMPLATE;

  const $  = s => container.querySelector(s);
  const $$ = s => container.querySelectorAll(s);

  const _listeners = [];
  const _on = (target, ev, fn, opt) => { target.addEventListener(ev, fn, opt); _listeners.push([target, ev, fn, opt]); };

  if(!_cssLink){
    _cssLink = document.createElement('link');
    _cssLink.rel = 'stylesheet';
    _cssLink.href = new URL('./plan-tracer.css', import.meta.url).href;
    document.head.appendChild(_cssLink);
  }

  // canvas overlay colours, read live from the themed tokens so selection,
  // snap and guide marks are Ops orange and follow light/dark.
  let C = {};
  function refreshColors(){
    const cs = getComputedStyle(container);
    const g = (n,f) => { const v = cs.getPropertyValue(n).trim(); return v || f; };
    C = { a:   g('--accent',        '#ea580c'),
          a2:  g('--accent-light',  '#fb923c'),
          err: g('--error',         '#dc2626') };
  }
  refreshColors();
  // re-read colours and repaint if the hub toggles light/dark while mounted
  const _themeObs = new MutationObserver(() => { refreshColors(); if (typeof render === 'function') render(); });
  _themeObs.observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });


  /* =========================================================================
     SYMBOL LIBRARIES
     -------------------------------------------------------------------------
     Libraries are no longer hardcoded here. Each lives in its own file under
     libraries/ and registers itself through the small API below. At startup
     the app reads libraries/manifest.json and loads every file it lists, so a
     new library is: write libraries/<name>.js, add "<name>" to the manifest.
     Nothing in this HTML needs to change.

     Two safety nets, because opening the file straight off disk (file://)
     blocks fetch() in some browsers:
       - a tiny built-in fallback set so the tool is never empty;
       - if the manifest can't be read, that fallback is used and a note shown.
     ========================================================================= */


  /* =========================================================================
     STATE
     ========================================================================= */
  let PAPER_W = 1600, PAPER_H = 1100;           // mutable: the Canvas tool changes these
  const S = {
    tool:'line', color:'#12161C', weight:2, sym:'downlight', cat:'Lighting',
    snapA:true, snapG:false, grid:false, ortho:false, guides:true, labels:true, gridSize:20,
    rad:20, dash:'solid', symScale:1,
    guideL:[],
    els:[], bg:null, bgHidden:false, hideDrawing:false,
    textSize:16, textFont:'sans', textAlign:'start', textBold:false, textItalic:false,
    draft:null, sel:[], snapHit:null, snapKind:null, joinA:null, dirty:false,
    viewLock:false, marquee:null, segSel:null,
    paperX:0, paperY:0,
    view:{x:0,y:0,w:PAPER_W,h:PAPER_H}, undo:[], redo:[]
  };
  // the sheet rectangle in world coords (origin can move — the crop box drags it)
  const paperRect = () => ({ x:S.paperX||0, y:S.paperY||0, w:PAPER_W, h:PAPER_H });
  // selection is always an array; most panels only make sense for exactly one item
  const sel1 = () => S.sel.length===1 ? S.sel[0] : null;
  const DASH = {solid:'', dashed:'11 7', dotted:'1 5', dashdot:'13 5 2 5'};

  /* ---- groups ------------------------------------------------------------
     Lines are independent until you group them. Grouping is what welds them:
     members select together, move together, and shared points behave as one
     joint. Ungrouped, a line is just a line — click it, delete it, done.
     ------------------------------------------------------------------------ */
  const vkey = p => `${Math.round(p.x*50)},${Math.round(p.y*50)}`;
  const groupOf = el => el.grp ? S.els.filter(x=>x.grp===el.grp) : [el];
  function jointAt(p,grp){                      // vertex objects on this spot, within one group
    const k=vkey(p), out=[];
    for(const el of S.els){
      if(!el.pts) continue;
      if(grp ? el.grp!==grp : true) continue;
      for(const q of el.pts) if(vkey(q)===k) out.push(q);
    }
    return out;
  }
  // the actual point object (not a copy) nearest to p — needed by Join
  function vertexRef(p,R){
    let best=null;
    for(const el of S.els){
      if(!el.pts) continue;
      for(const q of el.pts){
        const d=Math.hypot(q.x-p.x,q.y-p.y);
        if(d<R && (!best||d<best.d)) best={d,q,el};
      }
    }
    return best;
  }
  /* ---- tangent arcs ------------------------------------------------------
     An arc leaving a line tangentially is fixed by three things: where it
     starts, the direction it must leave in, and where it ends. The
     tangent-chord angle is half the arc's central angle, which gives the
     sagitta straight out as (L/2)·tan(a/2). No radius to type in — it falls
     out of where you put the far end.
     ------------------------------------------------------------------------ */
  function tangentSag(P,Q,t){
    const dx=Q.x-P.x, dy=Q.y-P.y, L=Math.hypot(dx,dy);
    if(L<0.5) return 0;
    const ux=dx/L, uy=dy/L;
    let a=Math.atan2(ux*t.y-uy*t.x, ux*t.x+uy*t.y);   // signed angle from chord to tangent
    const lim=Math.PI*0.9;
    a=Math.max(-lim,Math.min(lim,a));
    return (L/2)*Math.tan(a/2);
  }
  function arcCentre(el){
    const [a,b]=el.pts, s=el.sag||0;
    const L=Math.hypot(b.x-a.x,b.y-a.y);
    if(!L||Math.abs(s)<0.2) return null;
    const R=(L*L/4+s*s)/(2*Math.abs(s));
    const nx=-(b.y-a.y)/L, ny=(b.x-a.x)/L;
    const h=(R-Math.abs(s))*Math.sign(s);
    return {x:(a.x+b.x)/2-nx*h, y:(a.y+b.y)/2-ny*h, R};
  }
  // a free end of a line or arc, plus the direction it points away in
  function endpointNear(p,R){
    let best=null;
    const take=(v,tx,ty,d)=>{
      const l=Math.hypot(tx,ty)||1;
      if(!best||d<best.d) best={d,p:{x:v.x,y:v.y},t:{x:tx/l,y:ty/l}};
    };
    for(const el of S.els){
      if(!el.pts) continue;
      if(el.type==='poly'){
        const n=el.pts.length;
        for(const [i,j] of [[0,1],[n-1,n-2]]){
          if(j<0||j>=n||i===j) continue;
          const v=el.pts[i], w=el.pts[j], d=Math.hypot(v.x-p.x,v.y-p.y);
          if(d<R) take(v, v.x-w.x, v.y-w.y, d);
        }
      } else if(el.type==='arc'){
        const c=arcCentre(el);
        const [a,b]=el.pts;
        if(!c){                                   // effectively straight
          for(const [v,w] of [[a,b],[b,a]]){
            const d=Math.hypot(v.x-p.x,v.y-p.y);
            if(d<R) take(v, v.x-w.x, v.y-w.y, d);
          }
          continue;
        }
        for(const [v,other] of [[a,b],[b,a]]){
          const d=Math.hypot(v.x-p.x,v.y-p.y);
          if(d>=R) continue;
          let tx=-(v.y-c.y), ty=(v.x-c.x);        // perpendicular to the radius
          if((other.x-v.x)*tx+(other.y-v.y)*ty > 0){ tx=-tx; ty=-ty; }  // point away
          take(v, tx, ty, d);
        }
      }
    }
    return best;
  }
  const COLORS = ['#12161C','#E8452F','#1E7ACC','#178A5B','#FFB020','#8B5CF6'];
  const WEIGHTS = [1,2,3,5,8];


  const stage=$('#stage'), content=$('#content'), overlay=$('#overlay'),
        bgEl=$('#bg'), gridEl=$('#grid'), paperEl=$('#paper');
  const uid = () => Math.random().toString(36).slice(2,9);
  const esc = s => String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const fontStack = f => f==='mono'  ? "'JetBrains Mono', monospace"
                       : f==='serif' ? "Georgia, 'Times New Roman', serif"
                       :               "'Outfit', sans-serif";

  /* =========================================================================
     TOOLBAR
     ========================================================================= */
  const TOOLS = [
    ['select','Select',`<path d="M3 2l8 12 2-5 5-2z"/>`],
    ['node','Edit',`<path d="M3 13 8 4l5 9" opacity=".5"/><rect x="1.5" y="11.5" width="3" height="3"/><rect x="6.5" y="2.5" width="3" height="3"/><rect x="11.5" y="11.5" width="3" height="3"/>`],
    ['line','Line',`<path d="M2.5 13 13.5 3"/><circle cx="2.5" cy="13" r="1.6"/><circle cx="13.5" cy="3" r="1.6"/>`],
    ['arc','Arc',`<path d="M2 13A11 11 0 0 1 13 2"/><circle cx="2.5" cy="13" r="1.6"/><circle cx="13" cy="2.5" r="1.6"/>`],
    ['arctan','Tangent',`<path d="M1 14h6"/><path d="M7 14a7 7 0 0 0 7-7V2"/><circle cx="7" cy="14" r="1.6"/>`],
    ['rect','Rect',`<rect x="2" y="3" width="12" height="10"/>`],
    ['circle','Circle',`<circle cx="8" cy="8" r="6"/>`],
    ['fillet','Fillet',`<path d="M3 14V8a5 5 0 0 1 5-5h6"/><path d="M3 3h5M3 3v5" opacity=".35"/>`],
    ['chamfer','Chamfer',`<path d="M3 14V9l6-6h5"/><path d="M3 3h6M3 3v6" opacity=".35"/>`],
    ['join','Join',`<path d="M2 8h4M10 8h4"/><circle cx="6" cy="8" r="2"/><circle cx="10" cy="8" r="2"/><path d="M8 3v2M8 11v2" opacity=".4"/>`],
    ['symbol','Symbol',`<circle cx="8" cy="8" r="6"/><path d="M4 4l8 8M4 12l8-8"/>`],
    ['text','Text',`<path d="M3 4h10M8 4v9"/>`]
  ];
  $('#tools').innerHTML = TOOLS.map(([id,label,ic])=>
    `<button class="tool" data-tool="${id}" title="${label}"><svg viewBox="0 0 16 16">${ic}</svg>${label}</button>`).join('');
  $$('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));

  function setTool(t){
    if(S.draft) finishDraft();
    S.joinA=null; S.segSel=null;
    S.tool=t; if(t!=='select'&&t!=='marquee'&&t!=='node'&&t!=='zoombox') S.sel=[];
    $$('[data-tool]').forEach(b=>b.classList.toggle('on',b.dataset.tool===t));
    stage.classList.toggle('pan',t==='pan'||t==='marquee'||t==='zoombox');
    buildCtx();
    const H={select:'Click a shape to select it · drag to move · drag empty space to box-select · Alt+click for one piece inside a group',
      node:'Click a line to edit it · drag a square node to move it · click a segment then Delete to remove just that side',
      marquee:'Drag a box over the objects to select them',
      zoombox:'Drag a box over the area you want to zoom into',
      crop:'Drag a sheet edge or corner to resize · drag inside to move the sheet over your drawing',
      line:'Click each corner · landing on existing work ends the run · Esc to finish',
      arc:'Click the two ends, then move to set the bulge and click again',
      arctan:'Click the free end of a line or arc, then click where the curve should finish',
      rect:'Drag to draw a rectangle', circle:'Drag from the centre outwards',
      fillet:'Click a corner to round it off · set the radius above',
      chamfer:'Click a corner to cut it off · set the setback above',
      join:'Click the point to keep, then the point to bring onto it',
      symbol:'Click on the plan to place the selected symbol',
      text:'Click to place a text label', pan:'Drag to pan · scroll to zoom'};
    $('#hint').textContent=H[t]||''; render(); props();
  }

  /* ---- tool settings: rendered inline under the tool icons --------------
     Fillet/chamfer show their size; the symbol tool shows the size the next
     symbol will drop at, as a number you can read and repeat.
     ---------------------------------------------------------------------- */
  function buildCtx(){
    const box=$('#toolSettings'); let h='';
    if(S.tool==='fillet'||S.tool==='chamfer'){
      h=`<span class="cap" style="align-self:center">${S.tool==='chamfer'?'Setback':'Radius'}</span>
         <input class="num" id="rad" type="number" min="0" max="500" step="1" value="${S.rad}" title="0 removes it">`;
    } else if(S.tool==='symbol'){
      const d=findSym(S.sym)||{svg:'',name:''};
      h=`<svg viewBox="-18 -18 36 36" width="22" height="22" fill="none" stroke="${C.a}"
            stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="align-self:center">${d.svg}</svg>
         <span class="cap" style="align-self:center">Size %</span>
         <input class="num" id="symScale" type="number" min="20" max="600" step="5"
           value="${Math.round(S.symScale*100)}" title="The next symbol drops at this size">`;
    }
    box.innerHTML=h;
    box.style.display = h?'':'none';
    if($('#rad')) $('#rad').oninput=e=>{
      S.rad=Math.max(0,+e.target.value||0);
    };
    if($('#symScale')) $('#symScale').oninput=e=>{
      S.symScale=Math.max(0.2,Math.min(6,(+e.target.value||100)/100));
    };
  }

  $('#wts').innerHTML = WEIGHTS.map(w=>`<button class="wt" data-w="${w}" title="${w} px"><i style="height:${w}px"></i></button>`).join('');
  $$('.wt').forEach(b=>b.onclick=()=>{
    S.weight=+b.dataset.w;
    $$('.wt').forEach(x=>x.classList.toggle('on',x===b));
    if(S.sel.length){ push(); S.sel.forEach(el=>{ if(el.weight!==undefined) el.weight=S.weight; }); render(); }
  });
  $('#swatches').innerHTML = COLORS.map(c=>`<button class="sw" data-c="${c}" style="background:${c}"></button>`).join('');
  $$('.sw').forEach(b=>b.onclick=()=>{
    S.color=b.dataset.c;
    $$('.sw').forEach(x=>x.classList.toggle('on',x===b));
    if(S.sel.length){ push(); S.sel.forEach(el=>el.color=S.color); render(); }
  });
  $('#dash').onchange=e=>{
    S.dash=e.target.value;
    if(S.sel.length){ push(); S.sel.forEach(el=>{ if(el.weight!==undefined) el.dash=S.dash; }); render(); }
  };

  /* ---- mode toggles: snap / ortho / grid ---- */
  const MODES = [
    ['snapA','Snap','Snap new points onto existing anchor points (A)',
      `<circle cx="8" cy="8" r="2.4" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="5.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/>`],
    ['ortho','Ortho','Lock lines to horizontal / vertical only (O)',
      `<path d="M2 12h7v-8"/><path d="M2 2v12h12" opacity=".35"/>`],
    ['guides','Guides','Line up with existing points — hold Alt to ignore (Y)',
      `<path d="M8 1v14" stroke-dasharray="2 2"/><circle cx="8" cy="11" r="2" fill="currentColor" stroke="none"/><circle cx="8" cy="3" r="1.6"/>`],
    ['grid','Grid','Show the grid (G)',
      `<path d="M2 6h12M2 10h12M6 2v12M10 2v12"/>`],
    ['snapG','Snap grid','Snap new points onto grid intersections (Shift+G)',
      `<path d="M3 8h10M8 3v10"/><circle cx="8" cy="8" r="2" fill="currentColor" stroke="none"/>`],
    ['labels','Labels','Show symbol names on the plan (Shift+L)',
      `<path d="M2 4h9l3 4-3 4H2z"/><path d="M5 8h4"/>`]
  ];
  $('#modes').innerHTML = MODES.map(([k,label,tip,ic])=>
    `<button class="tool" data-mode="${k}" title="${tip}"><svg viewBox="0 0 16 16">${ic}</svg>${label}</button>`).join('');
  $$('[data-mode]').forEach(b=>b.onclick=()=>toggle(b.dataset.mode));
  function toggle(k){
    S[k]=!S[k];
    if(k==='snapG'&&S.snapG) S.grid=true;      // grid snapping is useless unseen
    syncModes(); render();
  }
  function syncModes(){
    $$('[data-mode]').forEach(b=>b.classList.toggle('on',!!S[b.dataset.mode]));
  }

  /* ---- grid spacing ---- */
  function setGrid(v){
    S.gridSize = Math.min(500, Math.max(1, Math.round(v)||1));
    $('#gSize').value = S.gridSize;
    $('#gPre').value  = String(S.gridSize);
    if(!S.grid) S.grid = true;                    // changing spacing implies you want to see it
    syncModes(); render();
  }
  $('#gSize').oninput = e => { const v=+e.target.value; if(v>=1) setGrid(v); };
  $('#gPre').onchange = e => setGrid(+e.target.value);
  $('#gUp').onclick   = () => setGrid(S.gridSize*2);
  $('#gDn').onclick   = () => setGrid(S.gridSize/2);

  /* ---- symbol library ---- */
  function refreshCategories(){
    const cats=Object.keys(LIB);
    if(!cats.includes(S.cat)) S.cat=cats[0]||'';
    $('#cat').innerHTML = cats.map(c=>`<option${c===S.cat?' selected':''}>${c}</option>`).join('');
    symGrid();
  }
  $('#cat').onchange = e => { S.cat=e.target.value; symGrid(); };
  function symGrid(){
    const group=LIB[S.cat]||{};
    $('#symgrid').innerHTML = Object.entries(group).map(([k,v])=>
      `<button class="symbtn" data-s="${k}" title="${v.name}">
        <svg viewBox="-18 -18 36 36" fill="none" stroke="currentColor" stroke-width="1.5"
          stroke-linecap="round" stroke-linejoin="round">${v.svg}</svg></button>`).join('');
    $$('.symbtn').forEach(b=>b.onclick=()=>{
      S.sym=b.dataset.s; setTool('symbol');
      $$('.symbtn').forEach(x=>x.classList.toggle('on',x===b));
    });
  }
  function findSym(k){ for(const c in LIB) if(LIB[c][k]) return LIB[c][k]; return null; }

  /* =========================================================================
     VIEW
     ========================================================================= */
  function applyView(){
    const r=stage.getBoundingClientRect();
    S.view.h = S.view.w / (r.width/r.height);
    const {x,y,w,h}=S.view;
    stage.setAttribute('viewBox',`${x} ${y} ${w} ${h}`);
    $('#hud').textContent = `${Math.round(w)}×${Math.round(h)} · ${Math.round(PAPER_W/w*100)}% · grid ${S.gridSize}`;
  }
  function fit(){
    const b = S.bg ? {x:S.bg.x,y:S.bg.y,w:S.bg.w,h:S.bg.h} : paperRect();
    const pad=Math.max(b.w,b.h)*0.06;
    S.view={x:b.x-pad,y:b.y-pad,w:b.w+pad*2,h:0}; applyView();
  }
  function pt(e){
    const p=stage.createSVGPoint(); p.x=e.clientX; p.y=e.clientY;
    return p.matrixTransform(stage.getScreenCTM().inverse());
  }
  const scale = () => S.view.w / stage.getBoundingClientRect().width;

  stage.addEventListener('wheel',e=>{
    if(S.viewLock) return;
    e.preventDefault();
    const p=pt(e), f=e.deltaY>0?1.12:1/1.12;
    S.view.x=p.x-(p.x-S.view.x)*f; S.view.y=p.y-(p.y-S.view.y)*f;
    S.view.w*=f; applyView(); render();
  },{passive:false});
  _on(window, 'resize',()=>{applyView();render()});
  $('#btnFit2').onclick=()=>{fit();render()};
  function setPaper(w,h){
    PAPER_W=Math.max(100,Math.min(20000,Math.round(w)||PAPER_W));
    PAPER_H=Math.max(100,Math.min(20000,Math.round(h)||PAPER_H));
    S.dirty=true; fitPaper(); render();
    toast(`Canvas set to ${PAPER_W} × ${PAPER_H}.`);
  }
  function fitPaper(){ const b=paperRect(); const pad=Math.max(b.w,b.h)*0.08;
    S.view={x:b.x-pad,y:b.y-pad,w:b.w+pad*2,h:0}; applyView(); }
  $('#btnFitSheet').onclick=()=>{ fitPaper(); render(); };
  $('#cvPre2').onchange=e=>{
    const v=e.target.value; e.target.value='';
    if(!v) return;
    if(v==='custom'){
      $('#cvW').value=PAPER_W; $('#cvH').value=PAPER_H; $('#cvPre').value=`${PAPER_W},${PAPER_H}`;
      $('#canvasBg').classList.add('show'); return;
    }
    const [w,h]=v.split(','); setPaper(+w,+h);
  };
  $('#cvPre').onchange=e=>{ if(e.target.value){ const [w,h]=e.target.value.split(',');$('#cvW').value=w;$('#cvH').value=h; } };
  $('#cvCancel').onclick=()=>$('#canvasBg').classList.remove('show');
  $('#cvApply').onclick=()=>{
    $('#canvasBg').classList.remove('show');
    setPaper(+$('#cvW').value, +$('#cvH').value);
  };
  $('#btnLock').onclick=()=>{
    S.viewLock=!S.viewLock;
    $('#btnLock').classList.toggle('locked',S.viewLock);
    toast(S.viewLock?'View locked — pan and zoom are off.':'View unlocked.');
  };

  /* =========================================================================
     SNAP / ORTHO
     ========================================================================= */
  function anchors(){
    const a=[];
    for(const el of S.els){
      if(el.pts) el.pts.forEach(p=>a.push(p));
      if(el.type==='arc') a.push(arcMid(el));
      else if(el.type==='rect'){const{x,y,w,h}=el;a.push({x,y},{x:x+w,y},{x,y:y+h},{x:x+w,y:y+h});}
      else if(el.type==='circle') a.push({x:el.x,y:el.y});
      else if(el.type==='symbol'){const q=symXY(el); a.push({x:q.x,y:q.y});}
    }
    // points of the run currently being drawn — all but the one we're drawing from,
    // so the 4th corner of a rectangle can close onto the 1st
    if(S.draft?.pts) S.draft.pts.slice(0,-1).forEach(p=>a.push(p));
    return a;
  }
  function nearestVertex(p,R,skip){
    let hit=null, best=R*R;
    for(const a of anchors()){
      if(a===skip) continue;
      const d=(a.x-p.x)**2+(a.y-p.y)**2;
      if(d<best){best=d; hit={x:a.x,y:a.y};}
    }
    return hit;
  }
  function ortho(a,b){
    return Math.abs(b.x-a.x)>Math.abs(b.y-a.y) ? {x:b.x,y:a.y} : {x:a.x,y:b.y};
  }
  // Ortho button locks H/V. Shift temporarily inverts whatever the button says.
  function orthoOn(e){ return S.ortho !== !!(e&&e.shiftKey); }

  /* ---- where does a click actually land? ---------------------------------
     Strict priority, highest first. Whichever step claims the point, the
     later steps leave it alone.

     Grid snap is a quantiser, not a suggestion: when it's on it beats
     everything except an explicit vertex, and it switches off the
     land-anywhere-along-a-line snap entirely. Those two want the point in
     different places, and the edge always won — which is exactly why the
     grid appeared to do nothing.
     ---------------------------------------------------------------------- */
  function resolve(raw,last,e,skip){
    const k=scale(), o=last && orthoOn(e);
    const lock = p => {                       // re-apply the H/V lock after any rounding
      if(!o) return p;
      return Math.abs(raw.x-last.x) >= Math.abs(raw.y-last.y)
        ? {x:p.x, y:last.y} : {x:last.x, y:p.y};
    };

    // With ortho on you can only hard-connect to an anchor that actually lies
    // on the H/V line from `last` — anything off-axis would break the lock.
    // `reach` is true when the ortho-projected point still lands on the anchor;
    // off-axis anchors fall through to the alignment-guide system instead,
    // which lines the free axis up with the anchor and draws the arrow to it.
    const reach = (v) => !o || Math.hypot(lock(v).x - v.x, lock(v).y - v.y) <= 2.5*k;

    if(S.snapG){
      if(S.snapA){
        const v=nearestVertex(raw, 9*k, skip);
        if(v && reach(v)) return {p:lock(v), kind:'vertex'};
      }
      const g=S.gridSize;
      return {p:lock({x:Math.round(raw.x/g)*g, y:Math.round(raw.y/g)*g}), kind:'grid'};
    }
    if(S.snapA){
      const v=nearestVertex(raw,12*k,skip);
      if(v && reach(v)) return {p:lock(v), kind:'vertex'};
      const s=nearestSeg(raw,10*k);
      if(s && reach({x:s.x,y:s.y})) return {p:lock({x:s.x,y:s.y}), kind:'edge'};
    }
    const base=lock({x:raw.x,y:raw.y});
    const a=alignPoint(base,last,o,e&&e.altKey);
    return {p:a.p, lines:a.lines, kind:'free'};
  }
  // used by the tools that don't draw a run (rect, circle, vertex drag, symbols)
  function snap(p,skip){
    const r=resolve(p,null,null,skip);
    S.snapKind=r.kind;
    return {p:r.p, hit:(r.kind==='vertex'||r.kind==='edge'||r.kind==='grid')?r.p:null};
  }

  /* ---- alignment guides -------------------------------------------------
     Nudges a point so it lines up with an existing anchor, and reports a
     dashed guide line back so we can show why. Only the axis that is still
     free gets aligned: under ortho a horizontal run can only align its X.
     Drift further than the tolerance, or hold Alt, and it lets go.
     ---------------------------------------------------------------------- */
  function alignPoint(base,last,isOrtho,off){
    if(!S.guides||off) return {p:base,lines:[]};
    const T=9*scale(), out={...base}, lines=[];
    const horiz = isOrtho && last && Math.abs(base.y-last.y) < 1e-9;  // running left/right → X free
    const vert  = isOrtho && last && Math.abs(base.x-last.x) < 1e-9;  // running up/down   → Y free
    const startPt = S.draft?.pts?.[0];             // the point you'd close a shape onto
    const isStart = a => startPt && Math.abs(a.x-startPt.x)<0.01 && Math.abs(a.y-startPt.y)<0.01;
    let bx=T, by=T, gx=null, gy=null;
    for(const a of anchors()){
      const dx=Math.abs(a.x-base.x), dy=Math.abs(a.y-base.y);
      if(dx<bx){bx=dx; gx=a;}
      if(dy<by){by=dy; gy=a;}
    }
    // x1,y1 = the anchor we're lining up with; x2,y2 = where the point sits now
    if(gx && (!isOrtho || horiz)){ out.x=gx.x; lines.push({x1:gx.x,y1:gx.y,x2:gx.x,y2:out.y,start:isStart(gx)}); }
    if(gy && (!isOrtho || vert )){ out.y=gy.y; lines.push({x1:gy.x,y1:gy.y,x2:out.x,y2:gy.y,start:isStart(gy)}); }
    return {p:out,lines};
  }

  /* ---- hosting symbols on walls ----------------------------------------
     A door or window carries a `cut` width. Dropped near a line it grabs on:
     it stores which line and how far along, takes the wall's angle, and the
     wall is drawn with a gap the width of the opening.
     ---------------------------------------------------------------------- */
  function nearestSeg(p,maxD,onlyId){
    let best=null;
    for(const el of S.els){
      if(el.type!=='poly') continue;
      if(onlyId && el.id!==onlyId) continue;
      for(let i=0;i<el.pts.length-1;i++){
        const a=el.pts[i], b=el.pts[i+1];
        const vx=b.x-a.x, vy=b.y-a.y, L2=vx*vx+vy*vy;
        if(!L2) continue;
        let t=((p.x-a.x)*vx+(p.y-a.y)*vy)/L2; t=Math.max(0,Math.min(1,t));
        const qx=a.x+vx*t, qy=a.y+vy*t, dist=Math.hypot(p.x-qx,p.y-qy);
        if(dist<maxD && (!best||dist<best.dist))
          best={dist,id:el.id,seg:i,d:t*Math.sqrt(L2),x:qx,y:qy,
                rot:Math.atan2(vy,vx)*180/Math.PI};
      }
    }
    return best;
  }
  // where a symbol actually sits — derived from its host wall if it has one,
  // so it slides along when the wall is edited
  function symXY(el){
    if(el.host){
      const p=S.els.find(x=>x.id===el.host.id && x.type==='poly');
      const a=p?.pts[el.host.seg], b=p?.pts[el.host.seg+1];
      if(a&&b){
        const L=Math.hypot(b.x-a.x,b.y-a.y);
        if(L){
          const d=Math.min(L,Math.max(0,el.host.d));
          return {x:a.x+(b.x-a.x)/L*d, y:a.y+(b.y-a.y)/L*d,
                  rot:Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI};
        }
      }
      delete el.host;                       // host went away — fall back to free placement
    }
    return {x:el.x, y:el.y, rot:el.rot};
  }
  // gaps this line must leave for any doors/windows sitting on it
  function cutsOn(id){
    const out={};
    for(const s of S.els){
      if(s.type!=='symbol'||s.host?.id!==id) continue;
      const def=findSym(s.sym);
      if(!def?.cut) continue;
      const hw=def.cut/2*s.scale;
      (out[s.host.seg] ||= []).push([s.host.d-hw, s.host.d+hw]);
    }
    return out;
  }
  /* ---- corner geometry ---------------------------------------------------
     A fillet or chamfer is stored against the vertex, not baked into the
     points — so the radius stays editable and the corner stays a corner.
     For a fillet of radius R between two legs meeting at interior angle a,
     the tangent point sits R/tan(a/2) back along each leg.
     ------------------------------------------------------------------------ */
  function cornerGeo(el,i){
    const c=el.corners?.[i];
    if(!c||!(c.r>0)) return null;
    const pts=el.pts, a=pts[i-1], v=pts[i], b=pts[i+1];
    if(!a||!b) return null;
    const u1={x:a.x-v.x,y:a.y-v.y}, u2={x:b.x-v.x,y:b.y-v.y};
    const l1=Math.hypot(u1.x,u1.y), l2=Math.hypot(u2.x,u2.y);
    if(!l1||!l2) return null;
    u1.x/=l1; u1.y/=l1; u2.x/=l2; u2.y/=l2;
    const ang=Math.acos(Math.max(-1,Math.min(1,u1.x*u2.x+u1.y*u2.y)));
    if(ang<0.02 || Math.abs(ang-Math.PI)<0.02) return null;   // straight, or doubled back
    let t = c.t==='chamfer' ? c.r : c.r/Math.tan(ang/2);
    t = Math.min(t, l1*0.98, l2*0.98);                        // never eat a whole leg
    if(t<=0) return null;
    const p1={x:v.x+u1.x*t, y:v.y+u1.y*t}, p2={x:v.x+u2.x*t, y:v.y+u2.y*t};
    const cr = (-u1.x)*u2.y - (-u1.y)*u2.x;                   // which way the path turns
    return {t, p1, p2, type:c.t, R:t*Math.tan(ang/2), sweep: cr>0?1:0};
  }
  function polyD(el){
    const pts=el.pts, n=pts.length;
    const cuts=cutsOn(el.id);
    const geo=[], trim=new Array(n).fill(0);
    for(let i=0;i<n;i++){
      const g = (i>0 && i<n-1) ? cornerGeo(el,i) : null;
      geo[i]=g; if(g) trim[i]=g.t;
    }
    if(!Object.keys(cuts).length && !geo.some(Boolean))       // plain run — one clean path
      return 'M'+pts.map(p=>`${p.x} ${p.y}`).join('L');

    let d='';
    for(let i=0;i<n-1;i++){
      const a=pts[i], b=pts[i+1];
      const L=Math.hypot(b.x-a.x,b.y-a.y);
      if(!L) continue;
      const ux=(b.x-a.x)/L, uy=(b.y-a.y)/L;
      const s0=trim[i], s1=L-trim[i+1];
      if(s1>s0){
        const gaps=(cuts[i]||[])
          .map(g=>[Math.max(s0,g[0]),Math.min(s1,g[1])])
          .filter(g=>g[1]>g[0]).sort((p,q)=>p[0]-q[0]);
        let pos=s0; const runs=[];
        for(const g of gaps){ if(g[0]>pos) runs.push([pos,g[0]]); pos=Math.max(pos,g[1]); }
        if(pos<s1) runs.push([pos,s1]);
        for(const [x0,x1] of runs)
          d+=`M${a.x+ux*x0} ${a.y+uy*x0}L${a.x+ux*x1} ${a.y+uy*x1}`;
      }
      const g=geo[i+1];
      if(g) d += g.type==='chamfer'
        ? `M${g.p1.x} ${g.p1.y}L${g.p2.x} ${g.p2.y}`
        : `M${g.p1.x} ${g.p1.y}A${g.R} ${g.R} 0 0 ${g.sweep} ${g.p2.x} ${g.p2.y}`;
    }
    return d;
  }

  /* ---- arcs --------------------------------------------------------------
     Stored as its two ends plus a sagitta: how far the middle bulges off the
     straight line between them. Sign picks the side. Keeping the ends in
     `pts` means snapping, welding and dragging all work with no extra code.
     ------------------------------------------------------------------------ */
  function arcMid(el){
    const [a,b]=el.pts, L=Math.hypot(b.x-a.x,b.y-a.y);
    if(!L) return {x:a.x,y:a.y};
    const nx=-(b.y-a.y)/L, ny=(b.x-a.x)/L;
    return {x:(a.x+b.x)/2+nx*el.sag, y:(a.y+b.y)/2+ny*el.sag};
  }
  function arcD(el){
    const [a,b]=el.pts, s=el.sag||0;
    const L=Math.hypot(b.x-a.x,b.y-a.y);
    if(!L) return '';
    if(Math.abs(s)<0.2) return `M${a.x} ${a.y}L${b.x} ${b.y}`;
    const R=(L*L/4 + s*s)/(2*Math.abs(s));
    return `M${a.x} ${a.y}A${R} ${R} 0 ${Math.abs(s)>L/2?1:0} ${s>0?1:0} ${b.x} ${b.y}`;
  }
  function sagFrom(a,b,p){
    const L=Math.hypot(b.x-a.x,b.y-a.y);
    if(!L) return 0;
    const nx=-(b.y-a.y)/L, ny=(b.x-a.x)/L;
    return (p.x-(a.x+b.x)/2)*nx + (p.y-(a.y+b.y)/2)*ny;
  }
  function nearestCorner(p,maxD){
    let best=null;
    for(const el of S.els){
      if(el.type!=='poly'||!el.pts) continue;
      for(let i=1;i<el.pts.length-1;i++){
        const d=Math.hypot(el.pts[i].x-p.x, el.pts[i].y-p.y);
        if(d<maxD && (!best||d<best.d)) best={d,el,i};
      }
    }
    return best;
  }

  /* =========================================================================
     RENDER
     ========================================================================= */
  function svgOf(el){
    const da = el.dash && DASH[el.dash] ? ` stroke-dasharray="${DASH[el.dash]}"` : '';
    const st=`stroke="${el.color}" stroke-width="${el.weight}" fill="none" stroke-linecap="round" stroke-linejoin="round"${da}`;
    if(el.type==='poly')
      return `<path data-id="${el.id}" d="${polyD(el)}" ${st}/>`;
    if(el.type==='arc')
      return `<path data-id="${el.id}" d="${arcD(el)}" ${st}/>`;
    if(el.type==='rect')
      return `<rect data-id="${el.id}" x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" ${st}/>`;
    if(el.type==='circle')
      return `<circle data-id="${el.id}" cx="${el.x}" cy="${el.y}" r="${el.r}" ${st}/>`;
    if(el.type==='text'){
      const lines=String(el.txt).split('\n');
      const anchor=el.align||'start';
      const spans=lines.map((ln,i)=>
        `<tspan x="${el.x}" dy="${i===0?0:el.size*1.25}">${esc(ln)||' '}</tspan>`).join('');
      return `<text data-id="${el.id}" x="${el.x}" y="${el.y}" fill="${el.color}" stroke="none"
        font-size="${el.size}" font-family="${fontStack(el.font)}" text-anchor="${anchor}"
        font-weight="${el.bold?700:400}" font-style="${el.italic?'italic':'normal'}">${spans}</text>`;
    }
    if(el.type==='symbol'){
      const d=findSym(el.sym)||{svg:''};
      const q=symXY(el);
      const det = el.details?` data-details="${esc(el.details)}"`:'';
      const sx = el.scale*(el.mirror?-1:1), sy = el.scale*(el.flip?-1:1);
      const lab = S.labels && el.showLabel && el.label;
      // mirroring lives on an inner group so the name never comes out backwards
      return `<g class="sym" data-id="${el.id}" data-label="${esc(el.label||d.name||'')}"${det}
        transform="translate(${q.x} ${q.y}) rotate(${q.rot})" color="${el.color}">
        <g transform="scale(${sx} ${sy})" stroke="currentColor" fill="none"
           stroke-width="${1.6/el.scale*(el.weight/2)}" stroke-linecap="round" stroke-linejoin="round">
          <rect x="-18" y="-18" width="36" height="36" fill="transparent" stroke="none"/>
          ${d.svg}
        </g>
        ${(lab&&d.inner)?`<text x="0" y="${4*el.scale}" text-anchor="middle" font-size="${(el.labelSize||11)*el.scale}"
          fill="currentColor" stroke="none" font-family="Outfit, sans-serif"
          transform="rotate(${-q.rot})">${esc(el.label)}</text>`:''}
        ${(lab&&!d.inner)?`<text x="${el.nx||0}" y="${(el.ny??26)*el.scale}" text-anchor="middle" font-size="${el.labelSize||11}"
          fill="currentColor" stroke="none" font-family="Outfit, sans-serif"
          transform="rotate(${-q.rot} ${el.nx||0} ${(el.ny??26)*el.scale})">${esc(el.label)}</text>`:''}
      </g>`;
    }
    return '';
  }
  function bbox(el){
    if(el.type==='arc'){
      const ps=[...el.pts, arcMid(el)];
      const xs=ps.map(p=>p.x), ys=ps.map(p=>p.y);
      return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
    }
    if(el.pts){const xs=el.pts.map(p=>p.x),ys=el.pts.map(p=>p.y);
      return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};}
    if(el.type==='rect') return {x:el.x,y:el.y,w:el.w,h:el.h};
    if(el.type==='circle') return {x:el.x-el.r,y:el.y-el.r,w:el.r*2,h:el.r*2};
    if(el.type==='symbol'){const s=18*el.scale, q=symXY(el);return {x:q.x-s,y:q.y-s,w:s*2,h:s*2};}
    if(el.type==='text'){
      const lines=String(el.txt).split('\n');
      const cw=(el.font==='mono'?0.62:0.55)*(el.bold?1.05:1);
      const w=Math.max(1,...lines.map(l=>l.length))*el.size*cw;
      const h=el.size*0.35 + lines.length*el.size*1.25;
      const a=el.align||'start';
      const x = a==='middle' ? el.x-w/2 : a==='end' ? el.x-w : el.x;
      return {x, y:el.y-el.size, w, h};
    }
    return {x:0,y:0,w:0,h:0};
  }

  function drawGrid(){
    const g=S.gridSize, M=5, big=g*M, k=scale();
    const set=(id,o)=>{const n=$(id); for(const a in o) n.setAttribute(a,o[a]);};
    set('#gridMinor',{width:g,height:g});
    set('#gridMinorPath',{d:`M${g} 0H0V${g}`,'stroke-width':Math.max(0.4,0.5*k)});
    set('#gridMajor',{width:big,height:big});
    set('#gridMinorFill',{width:big,height:big,
      opacity: g/k < 6 ? 0 : 1});                 // drop minor lines when they'd smear together
    set('#gridMajorPath',{d:`M${big} 0H0V${big}`,'stroke-width':Math.max(0.6,0.9*k)});
    gridEl.style.display = S.grid && big/k > 5 ? '' : 'none';
  }

  /* ---- background image transform ---------------------------------------
     Rotation and skew pivot on the image centre so the picture turns in
     place. skewX shears horizontally; that plus independent width/height is
     enough to square up a photo taken at an angle.
     ---------------------------------------------------------------------- */
  function bgTransform(b){
    const cx=b.x+b.w/2, cy=b.y+b.h/2;
    const parts=[`rotate(${b.rot||0} ${cx} ${cy})`];
    if(b.skx) parts.push(`translate(${cx} ${cy}) skewX(${b.skx}) translate(${-cx} ${-cy})`);
    if(b.sky) parts.push(`translate(${cx} ${cy}) skewY(${b.sky}) translate(${-cx} ${-cy})`);
    return parts.join(' ');
  }
  function render(){
    const pr=paperRect();
    paperEl.setAttribute('x',pr.x); paperEl.setAttribute('y',pr.y);
    paperEl.setAttribute('width',pr.w); paperEl.setAttribute('height',pr.h);
    gridEl.setAttribute('x',pr.x); gridEl.setAttribute('y',pr.y);
    gridEl.setAttribute('width',pr.w); gridEl.setAttribute('height',pr.h);
    drawGrid();

    if(S.bg && !S.bgHidden){
      bgEl.setAttribute('href',S.bg.href);
      bgEl.setAttribute('x',S.bg.x); bgEl.setAttribute('y',S.bg.y);
      bgEl.setAttribute('width',S.bg.w); bgEl.setAttribute('height',S.bg.h);
      bgEl.setAttribute('opacity',$('#bgOp').value/100);
      bgEl.setAttribute('transform', bgTransform(S.bg));
      bgEl.style.display='';
    } else bgEl.style.display='none';

    content.innerHTML = S.hideDrawing ? '' : S.els.map(svgOf).join('');
    if(!S.sel.length || S.hideDrawing) $('#hilite').innerHTML='';
    $('#empty').style.display = (S.els.length||S.bg)?'none':'';

    let o=''; const k=scale();
    if(S.draft){
      if(S.draft.type==='poly'&&S.draft.pts.length){
        const pts=[...S.draft.pts,...(S.draft.cur?[S.draft.cur]:[])];
        o+=`<path d="M${pts.map(p=>`${p.x} ${p.y}`).join('L')}" stroke="${S.color}" stroke-width="${S.weight}"
          fill="none" stroke-dasharray="${6*k} ${4*k}"/>`;
        o+=S.draft.pts.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="${3.5*k}" fill="${C.a}"/>`).join('');
      }
      if(S.draft.type==='arc'){
        const [a]=S.draft.pts;
        if(S.draft.tan){
          const prev={pts:[a, S.draft.cur||a], sag:S.draft.sag||0};
          o+=`<path d="${arcD(prev)}" stroke="${S.color}" stroke-width="${S.weight}"
            fill="none" stroke-dasharray="${6*k} ${4*k}"/>`;
          o+=`<line x1="${a.x}" y1="${a.y}" x2="${a.x+S.draft.tan.x*40*k}" y2="${a.y+S.draft.tan.y*40*k}"
            stroke="${C.a2}" stroke-width="${1*k}" stroke-dasharray="${4*k} ${4*k}"/>`;
        } else {
          if(S.draft.pts.length===1 && S.draft.cur)
            o+=`<line x1="${a.x}" y1="${a.y}" x2="${S.draft.cur.x}" y2="${S.draft.cur.y}"
              stroke="${S.color}" stroke-width="${S.weight}" stroke-dasharray="${6*k} ${4*k}"/>`;
          if(S.draft.pts.length===2)
            o+=`<path d="${arcD(S.draft)}" stroke="${S.color}" stroke-width="${S.weight}"
              fill="none" stroke-dasharray="${6*k} ${4*k}"/>`;
        }
        o+=S.draft.pts.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="${3.5*k}" fill="${C.a}"/>`).join('');
      }
      if(S.draft.type==='rect') o+=`<rect x="${S.draft.x}" y="${S.draft.y}" width="${S.draft.w}" height="${S.draft.h}"
        stroke="${S.color}" stroke-width="${S.weight}" fill="none" stroke-dasharray="${6*k} ${4*k}"/>`;
      if(S.draft.type==='circle') o+=`<circle cx="${S.draft.x}" cy="${S.draft.y}" r="${S.draft.r}"
        stroke="${S.color}" stroke-width="${S.weight}" fill="none" stroke-dasharray="${6*k} ${4*k}"/>`;
    }
    if(S.guideL?.length) o+=S.guideL.map(g=>{
      const col = g.start ? C.a : C.a2;
      // arrow points from the current position back toward the anchor it lines up with
      let dx=g.x1-g.x2, dy=g.y1-g.y2;
      const L=Math.hypot(dx,dy)||1; dx/=L; dy/=L;
      const s=(g.start?9:6)*k;                     // px1,py1 = perpendicular for the barbs
      const px=-dy, py=dx;
      const tipX=g.x1-dx*3*k, tipY=g.y1-dy*3*k;    // sit the tip just off the anchor
      const bx=tipX-dx*s, by=tipY-dy*s;
      const arrow=`<path d="M${tipX} ${tipY}L${bx+px*s*0.6} ${by+py*s*0.6}L${bx-px*s*0.6} ${by-py*s*0.6}Z"
        fill="${col}"/>`;
      return `<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" stroke="${col}"
        stroke-width="${(g.start?1.4:1)*k}" stroke-dasharray="${5*k} ${4*k}" opacity=".9"/>
        ${arrow}
        <circle cx="${g.x1}" cy="${g.y1}" r="${(g.start?4:3)*k}" fill="none" stroke="${col}" stroke-width="${1.4*k}"/>`;
    }).join('');
    if(S.snapHit){
      const grid = S.snapKind==='grid';
      const col = grid ? C.a2 : C.a;
      o+=`<circle cx="${S.snapHit.x}" cy="${S.snapHit.y}" r="${13*k}" fill="${col}" opacity=".16"/>`;
      o+= grid
        ? `<path d="M${S.snapHit.x-8*k} ${S.snapHit.y}h${16*k}M${S.snapHit.x} ${S.snapHit.y-8*k}v${16*k}"
             stroke="${col}" stroke-width="${1.5*k}"/>`
        : `<circle cx="${S.snapHit.x}" cy="${S.snapHit.y}" r="${7*k}" fill="none"
             stroke="${col}" stroke-width="${1.5*k}"/>`;
    }
    if(S.joinA) o+=`<circle cx="${S.joinA.x}" cy="${S.joinA.y}" r="${9*k}" fill="none"
      stroke="${C.a2}" stroke-width="${1.8*k}"/><circle cx="${S.joinA.x}" cy="${S.joinA.y}"
      r="${3*k}" fill="${C.a2}"/>`;
    // highlight the actual selected shapes (a fat translucent copy behind them),
    // so it's obvious what's picked — not just a dashed bounding box
    const hi = S.sel.map(s=>{
      const g=svgOf(s).replace(/stroke="[^"]*"/,'stroke="${C.a}"')
        .replace(/stroke-width="[^"]*"/,`stroke-width="${(s.weight||2)+6*k}"`)
        .replace(/data-id="[^"]*"/,'');
      return `<g opacity=".28">${g}</g>`;
    }).join('');
    $('#hilite').innerHTML = hi;

    const nodeMode = S.tool==='node';
    for(const s of S.sel){
      if(nodeMode) continue;                      // node mode shows nodes, not a move box
      const b=bbox(s), m=8*k;
      o+=`<rect x="${b.x-m}" y="${b.y-m}" width="${b.w+m*2}" height="${b.h+m*2}" fill="none"
        stroke="${C.a}" stroke-width="${1.2*k}" stroke-dasharray="${5*k} ${3*k}"/>`;
    }
    // a picked segment, ready for Delete
    if(S.segSel && S.segSel.el.pts){
      const a=S.segSel.el.pts[S.segSel.i], b=S.segSel.el.pts[S.segSel.i+1];
      if(a&&b) o+=`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"
        stroke="${C.err}" stroke-width="${4*k}" opacity=".7" stroke-linecap="round"/>`;
    }
    // vertex handles: in node mode for the active line, or when a single shape is picked
    const one=sel1();
    if(one?.pts) o+=one.pts.map(p=>{
      const r=(nodeMode?4.5:3.5)*k;
      return `<rect x="${p.x-r}" y="${p.y-r}" width="${r*2}" height="${r*2}"
        fill="${nodeMode?C.a:'#FAFAF7'}" stroke="${nodeMode?'#12161C':C.a}" stroke-width="${1.2*k}"/>`;
    }).join('');
    // show which corners can be filleted while those tools are up
    if(S.tool==='fillet'||S.tool==='chamfer'){
      for(const el of S.els){
        if(el.type!=='poly') continue;
        for(let i=1;i<el.pts.length-1;i++){
          const on=el.corners?.[i];
          o+=`<circle cx="${el.pts[i].x}" cy="${el.pts[i].y}" r="${5*k}" fill="none"
            stroke="${on?C.a:C.a2}" stroke-width="${1.2*k}" opacity=".85"/>`;
        }
      }
    }
    // and which points can be joined
    if(S.tool==='join'){
      for(const el of S.els){
        if(!el.pts) continue;
        for(const p of el.pts)
          o+=`<circle cx="${p.x}" cy="${p.y}" r="${4*k}" fill="none"
            stroke="${C.a2}" stroke-width="${1.1*k}" opacity=".7"/>`;
      }
    }
    // free ends a tangent arc can spring from
    if(S.tool==='arctan'&&!S.draft){
      for(const el of S.els){
        if(!el.pts||el.pts.length<2) continue;
        for(const p of [el.pts[0], el.pts.at(-1)])
          o+=`<circle cx="${p.x}" cy="${p.y}" r="${5*k}" fill="none"
            stroke="${C.a2}" stroke-width="${1.2*k}" opacity=".8"/>`;
      }
    }
    if(S.bg && !$('#bgLock').checked){
      const b=S.bg;
      // the frame follows the image's own rotate/skew so the handles sit on it
      o+=`<g transform="${bgTransform(b)}">
        <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="${C.a2}"
          stroke-width="${1.2*k}" stroke-dasharray="${8*k} ${5*k}"/>
        <rect x="${b.x+b.w-6*k}" y="${b.y+b.h-6*k}" width="${12*k}" height="${12*k}" fill="${C.a2}"/>
        <line x1="${b.x+b.w/2}" y1="${b.y}" x2="${b.x+b.w/2}" y2="${b.y-26*k}" stroke="${C.a2}" stroke-width="${1.2*k}"/>
        <circle cx="${b.x+b.w/2}" cy="${b.y-26*k}" r="${6*k}" fill="${C.a2}"/>
      </g>`;
    }
    if(S.marquee){
      const m=S.marquee, x=Math.min(m.x0,m.x1), y=Math.min(m.y0,m.y1),
            w=Math.abs(m.x1-m.x0), hgt=Math.abs(m.y1-m.y0);
      const col=m.zoom?C.a2:C.a;
      o+=`<rect x="${x}" y="${y}" width="${w}" height="${hgt}" fill="${col}" fill-opacity=".08"
        stroke="${col}" stroke-width="${1*k}" stroke-dasharray="${5*k} ${3*k}"/>`;
    }
    // crop box: the sheet outline with 8 drag handles
    if(S.tool==='crop'){
      const b=paperRect(), hs=5*k;
      o+=`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none"
        stroke="${C.a}" stroke-width="${1.4*k}" stroke-dasharray="${7*k} ${4*k}"/>`;
      for(const [hx,hy] of cropHandles()){
        const px=b.x + (hx+1)/2*b.w, py=b.y + (hy+1)/2*b.h;
        o+=`<rect x="${px-hs}" y="${py-hs}" width="${hs*2}" height="${hs*2}"
          fill="#fff" stroke="${C.a}" stroke-width="${1.4*k}"/>`;
      }
    }
    overlay.innerHTML=o;
  }
  // the 8 crop handles as (hx,hy) in {-1,0,1}, excluding the centre
  function cropHandles(){
    const r=[]; for(const hy of [-1,0,1]) for(const hx of [-1,0,1]) if(hx||hy) r.push([hx,hy]); return r;
  }

  /* =========================================================================
     HISTORY — push() records the state *before* a change, so undo steps back
     onto it. Any fresh change abandons the redo trail, as you'd expect.
     ========================================================================= */
  const snap0 = () => JSON.stringify(S.els);
  function push(){
    S.undo.push(snap0());
    if(S.undo.length>80) S.undo.shift();
    S.redo.length=0; S.dirty=true; syncHist();
  }
  function undo(){
    if(!S.undo.length) return;
    S.redo.push(snap0());
    S.els=JSON.parse(S.undo.pop());
    S.sel=[]; syncHist(); render(); props();
  }
  function redo(){
    if(!S.redo.length) return;
    S.undo.push(snap0());
    S.els=JSON.parse(S.redo.pop());
    S.sel=[]; syncHist(); render(); props();
  }
  function syncHist(){
    $('#btnUndo').disabled = !S.undo.length;
    $('#btnRedo').disabled = !S.redo.length;
  }
  $('#btnUndo').onclick=undo;
  $('#btnRedo').onclick=redo;

  /* ---- picking ----------------------------------------------------------
     e.target only lands if you click exactly on a 1px stroke, which made
     selection feel broken. Instead measure the real distance from the click
     to each shape and take the nearest within a tolerance — topmost first.
     ---------------------------------------------------------------------- */
  function distSeg(p,a,b){
    const vx=b.x-a.x, vy=b.y-a.y, L2=vx*vx+vy*vy;
    let t = L2 ? ((p.x-a.x)*vx+(p.y-a.y)*vy)/L2 : 0;
    t=Math.max(0,Math.min(1,t));
    return Math.hypot(p.x-(a.x+vx*t), p.y-(a.y+vy*t));
  }
  function distTo(el,p){
    if(el.type==='poly'){
      let d=Infinity;
      for(let i=0;i<el.pts.length-1;i++) d=Math.min(d,distSeg(p,el.pts[i],el.pts[i+1]));
      return d;
    }
    if(el.type==='arc'){                          // sample the curve into a few chords
      const m=arcMid(el), a=el.pts[0], b=el.pts[1];
      const pts=[a, {x:(a.x+m.x)/2,y:(a.y+m.y)/2}, m, {x:(m.x+b.x)/2,y:(m.y+b.y)/2}, b];
      let d=Infinity;
      for(let i=0;i<pts.length-1;i++) d=Math.min(d,distSeg(p,pts[i],pts[i+1]));
      return d;
    }
    if(el.type==='rect'){
      const c=[{x:el.x,y:el.y},{x:el.x+el.w,y:el.y},{x:el.x+el.w,y:el.y+el.h},{x:el.x,y:el.y+el.h}];
      let d=Infinity;
      for(let i=0;i<4;i++) d=Math.min(d,distSeg(p,c[i],c[(i+1)%4]));
      return d;
    }
    if(el.type==='circle') return Math.abs(Math.hypot(p.x-el.x,p.y-el.y)-el.r);
    const b=bbox(el);                             // symbols, text: anywhere in the box
    if(p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h) return 0;
    const cx=Math.max(b.x,Math.min(p.x,b.x+b.w)), cy=Math.max(b.y,Math.min(p.y,b.y+b.h));
    return Math.hypot(p.x-cx,p.y-cy);
  }
  function pickAt(p){
    if(S.hideDrawing) return null;                 // can't grab what isn't shown
    const R=8*scale();
    let best=null;
    for(const el of S.els){                       // later = on top, so last match wins
      if(distTo(el,p)<=R) best=el;
    }
    return best;
  }

  /* ---- node editing -----------------------------------------------------
     A rectangle drawn with the line tool is one polyline, so you can't grab
     one corner or delete one side with the ordinary Select tool. The Edit
     tool works inside a single line: drag any node, or click a segment and
     Delete to drop just that side — which splits the line or opens the loop.
     ---------------------------------------------------------------------- */
  function nearestPolyVertex(p,R){
    let best=null;
    for(const el of S.els){
      if(el.type!=='poly'&&el.type!=='arc') continue;
      el.pts.forEach((q,i)=>{
        const d=Math.hypot(q.x-p.x,q.y-p.y);
        if(d<R && (!best||d<best.d)) best={d,el,v:q,i};
      });
    }
    return best;
  }
  function nearestPolySeg(p,R){
    let best=null;
    for(const el of S.els){
      if(el.type!=='poly') continue;
      for(let i=0;i<el.pts.length-1;i++){
        const d=distSeg(p,el.pts[i],el.pts[i+1]);
        if(d<R && (!best||d<best.d)) best={d,el,i};
      }
    }
    return best;
  }
  const sameKey = (a,b)=>vkey(a)===vkey(b);
  // every point of this one line sitting on the same spot (keeps a closed
  // rectangle's shared corner together without touching other lines)
  function coincidentIn(el,v){ return el.pts.filter(q=>sameKey(q,v)); }

  function deleteSegment(el,i){
    push();
    const pts=el.pts;
    const closed = pts.length>2 && sameKey(pts[0],pts.at(-1));
    const verts = closed ? pts.slice(0,-1) : pts.slice();
    const m=verts.length, made=[];
    if(closed){
      const seq=[];                               // reopen, starting just after the cut
      for(let j=1;j<=m;j++) seq.push(verts[(i+j)%m]);
      made.push(seq);
    } else {
      const left=verts.slice(0,i+1), right=verts.slice(i+1);
      if(left.length>=2) made.push(left);
      if(right.length>=2) made.push(right);
    }
    const idx=S.els.indexOf(el);
    const parts=made.map(seq=>{
      const c=JSON.parse(JSON.stringify(el));
      c.id=uid(); c.pts=seq.map(p=>({x:p.x,y:p.y})); delete c.corners; delete c.grp;
      return c;
    });
    S.els.splice(idx,1,...parts);
    S.sel=parts; S.segSel=null;
    render(); props();
    toast(parts.length>1?'Segment removed — the line split in two.':'Segment removed.');
  }

  /* =========================================================================
     POINTER
     ========================================================================= */
  let down=null;
  stage.addEventListener('pointerdown',e=>{
    if(e.button===2)return;
    stage.setPointerCapture(e.pointerId);
    const raw=pt(e);
    let {p}=snap(raw);
    if(S.tool==='line'&&S.draft?.pts.length&&orthoOn(e)&&!S.snapHit) p=ortho(S.draft.pts.at(-1),p);
    down={raw,p};

    if(S.tool==='pan'){ if(!S.viewLock) down.view={...S.view}; return; }
    if(S.tool==='marquee'||S.tool==='zoombox'){ down.marquee=true; S.marquee={x0:raw.x,y0:raw.y,x1:raw.x,y1:raw.y,add:e.shiftKey,zoom:S.tool==='zoombox'}; return; }
    if(S.tool==='crop'){
      const b=paperRect(), R=8*scale();
      // nearest handle?
      let grab=null;
      for(const [hx,hy] of cropHandles()){
        const px=b.x+(hx+1)/2*b.w, py=b.y+(hy+1)/2*b.h;
        if(Math.abs(raw.x-px)<R && Math.abs(raw.y-py)<R){ grab={hx,hy}; break; }
      }
      push();
      if(grab) down.crop={...grab, start:{...b}};
      else if(raw.x>b.x&&raw.x<b.x+b.w&&raw.y>b.y&&raw.y<b.y+b.h) down.crop={move:true, start:{...b}};
      else { S.undo.pop(); }                      // clicked outside the sheet — nothing to do
      return;
    }

    if(S.bg && !$('#bgLock').checked){
      const b=S.bg, k=scale();
      const c={x:b.x+b.w/2, y:b.y+b.h/2};
      // undo the image's own rotation so we can test the handles in its frame
      const a=-(b.rot||0)*Math.PI/180, ca=Math.cos(a), sa=Math.sin(a);
      const lp={x:c.x+(raw.x-c.x)*ca-(raw.y-c.y)*sa, y:c.y+(raw.x-c.x)*sa+(raw.y-c.y)*ca};
      if(Math.hypot(lp.x-c.x, lp.y-(b.y-26*k))<10*k){ down.bgRot={c,start:Math.atan2(raw.y-c.y,raw.x-c.x),rot0:b.rot||0}; return; }
      if(Math.abs(lp.x-(b.x+b.w))<9*k && Math.abs(lp.y-(b.y+b.h))<9*k){ down.bgScale={w0:b.w,h0:b.h,lp0:lp}; return; }
      if(lp.x>b.x&&lp.x<b.x+b.w&&lp.y>b.y&&lp.y<b.y+b.h){ down.bgMove={...b}; return; }
    }

    if(S.tool==='node'){
      const vh=nearestPolyVertex(raw, 9*scale());
      if(vh){                                     // grab this line's node (and its own twin if closed)
        S.sel=[vh.el]; S.segSel=null;
        down.verts = vh.el.type==='poly' ? coincidentIn(vh.el,vh.v) : [vh.v];
        down.pushedV=false; render(); props(); return;
      }
      const sh=nearestPolySeg(raw, 8*scale());
      if(sh){ S.sel=[sh.el]; S.segSel={el:sh.el,i:sh.i}; render(); props(); return; }
      const el=pickAt(raw);
      S.sel = el?[el]:[]; S.segSel=null; render(); props(); return;
    }

    if(S.tool==='select'){
      const one=sel1();
      if(one?.pts){
        const k=scale();
        const v=one.pts.find(q=>Math.abs(q.x-raw.x)<6*k&&Math.abs(q.y-raw.y)<6*k);
        // in a group, coincident points are one joint; on their own, a point is just a point
        if(v){ down.verts = one.grp ? jointAt(v,one.grp) : [v]; down.pushedV=false; return; }
      }
      const el=pickAt(raw);
      // clicking empty space starts a box-select rather than just clearing
      if(!el){
        if(!e.shiftKey){ S.sel=[]; render(); props(); }
        down.marquee=true; S.marquee={x0:raw.x,y0:raw.y,x1:raw.x,y1:raw.y,add:e.shiftKey};
        return;
      }
      const grab = (el.grp && !e.altKey) ? groupOf(el) : [el];
      S.sel = e.shiftKey ? [...new Set([...S.sel,...grab])] : grab;
      down.move=S.sel.map(x=>({el:x, b:JSON.parse(JSON.stringify(x))}));
      down.pushed=false;                          // history entry waits for the first drag
      render(); props(); return;
    }
    if(S.tool==='join'){
      const h=vertexRef(raw, 14*scale());
      if(!h){ toast('Click an end point or corner of a line.',true); return; }
      if(!S.joinA){ S.joinA=h.q; render(); toast('Now click the point to bring onto it.'); return; }
      if(S.joinA===h.q){ S.joinA=null; render(); return; }
      push();
      h.q.x=S.joinA.x; h.q.y=S.joinA.y;          // the second point moves onto the first
      S.joinA=null; render();
      toast('Joined. Group the two lines if you want the joint to hold when you move them.');
      return;
    }
    if(S.tool==='arctan'){
      if(!S.draft){
        const h=endpointNear(raw, 16*scale());
        if(!h){ toast('Start on the free end of a line or arc.',true); return; }
        S.draft={type:'arc',pts:[{x:h.p.x,y:h.p.y}],tan:h.t,sag:0,cur:h.p};
        render(); return;
      }
      finishDraft(); return;                      // second click commits
    }
    if(S.tool==='line'){
      const last = S.draft?.pts.at(-1) || null;
      const r = resolve(raw, last, e);
      if(!S.draft){ S.draft={type:'poly',pts:[{x:r.p.x,y:r.p.y}],cur:r.p}; render(); return; }
      S.draft.pts.push({x:r.p.x,y:r.p.y});
      // landing on something that already exists closes the run — the next
      // click starts a fresh one rather than chaining off it
      if(r.kind==='vertex'||r.kind==='edge') finishDraft();
      else render();
      return;
    }
    if(S.tool==='arc'){
      const r=resolve(raw, S.draft?.pts.at(-1)||null, e);
      if(!S.draft){ S.draft={type:'arc',pts:[{x:r.p.x,y:r.p.y}],sag:0,cur:r.p}; }
      else if(S.draft.pts.length===1){ S.draft.pts.push({x:r.p.x,y:r.p.y}); }
      else finishDraft();                       // third click locks the bulge in
      render(); return;
    }
    if(S.tool==='fillet'||S.tool==='chamfer'){
      const h=nearestCorner(raw, 20*scale());
      if(!h){ toast('Click a corner where two segments of one line meet.',true); return; }
      push();
      h.el.corners = h.el.corners || {};
      if(S.rad>0) h.el.corners[h.i]={t:S.tool, r:S.rad};
      else delete h.el.corners[h.i];             // radius 0 puts the sharp corner back
      render(); return;
    }
    if(S.tool==='rect'){ down.draw=1; S.draft={type:'rect',x:p.x,y:p.y,w:0,h:0}; return; }
    if(S.tool==='circle'){ down.draw=1; S.draft={type:'circle',x:p.x,y:p.y,r:0}; return; }
    if(S.tool==='symbol'){
      push();
      const def=findSym(S.sym);
      // architectural bits read better bare; kit you'd schedule wants its name showing
      const el={id:uid(),type:'symbol',sym:S.sym,x:p.x,y:p.y,rot:0,scale:S.symScale,mirror:false,flip:false,
        color:S.color,weight:S.weight,label:def.name,details:'',showLabel:!def.cut};
      if(def.cut){                                   // doors, windows, openings grab the wall
        const h=nearestSeg(raw, 22*scale());
        if(h) el.host={id:h.id,seg:h.seg,d:h.d};
      }
      S.els.push(el); S.sel=[el]; setTool('select'); render(); props(); return;
    }
    if(S.tool==='text'){
      const at={x:p.x,y:p.y};
      askText('').then(t=>{
        if(t==null || !t.trim()) return;
        push();
        const el={id:uid(),type:'text',x:at.x,y:at.y,txt:t,size:S.textSize,color:S.color,
          font:S.textFont, align:S.textAlign, bold:S.textBold, italic:S.textItalic};
        S.els.push(el); S.sel=[el]; setTool('select'); render(); props();
      });
      return;
    }
  });

  stage.addEventListener('pointermove',e=>{
    const raw=pt(e);
    const {p,hit}=snap(raw, down?.verts?.[0]);
    S.snapHit = ['line','arc','arctan','select','node','join'].includes(S.tool) ? hit : null;

    if(down?.view){
      S.view.x=down.view.x-(raw.x-down.raw.x);
      S.view.y=down.view.y-(raw.y-down.raw.y);
      applyView();
    }
    if(down?.marquee && S.marquee){ S.marquee.x1=raw.x; S.marquee.y1=raw.y; }
    if(down?.crop){
      const st=down.crop.start;
      if(down.crop.move){
        S.paperX=st.x+(raw.x-down.raw.x); S.paperY=st.y+(raw.y-down.raw.y);
      } else {
        let x=st.x, y=st.y, w=st.w, h=st.h;
        const g=S.snapG ? v=>Math.round(v/S.gridSize)*S.gridSize : v=>v;
        if(down.crop.hx===-1){ const r=st.x+st.w; x=g(raw.x); w=r-x; }
        if(down.crop.hx=== 1){ w=g(raw.x)-st.x; }
        if(down.crop.hy===-1){ const bt=st.y+st.h; y=g(raw.y); h=bt-y; }
        if(down.crop.hy=== 1){ h=g(raw.y)-st.y; }
        if(w<50){ if(down.crop.hx===-1) x=st.x+st.w-50; w=50; }
        if(h<50){ if(down.crop.hy===-1) y=st.y+st.h-50; h=50; }
        S.paperX=x; S.paperY=y; PAPER_W=Math.round(w); PAPER_H=Math.round(h);
      }
      S.dirty=true;
    }
    if(down?.bgRot){
      const ang=Math.atan2(raw.y-down.bgRot.c.y, raw.x-down.bgRot.c.x);
      S.bg.rot = Math.round((down.bgRot.rot0 + (ang-down.bgRot.start)*180/Math.PI)%360);
      S.dirty=true; syncBgPanel();
    }
    if(down?.bgScale){
      // resize in the image's own frame so a rotated image still scales sensibly
      const c={x:S.bg.x+S.bg.w/2, y:S.bg.y+S.bg.h/2};
      const a=-(S.bg.rot||0)*Math.PI/180, ca=Math.cos(a), sa=Math.sin(a);
      const lp={x:c.x+(raw.x-c.x)*ca-(raw.y-c.y)*sa, y:c.y+(raw.x-c.x)*sa+(raw.y-c.y)*ca};
      const nw=Math.max(20,lp.x-S.bg.x), nh=Math.max(20,lp.y-S.bg.y);
      S.bg.x -= (nw-S.bg.w)/2; S.bg.y -= (nh-S.bg.h)/2;   // keep the centre fixed
      S.bg.w=nw; S.bg.h=nh; S.dirty=true; syncBgPanel();
    }
    if(down?.bgMove){
      S.bg.x=down.bgMove.x+(raw.x-down.raw.x); S.bg.y=down.bgMove.y+(raw.y-down.raw.y); S.dirty=true;
    }
    if(down?.verts){ if(!down.pushedV){ push(); down.pushedV=true; } down.verts.forEach(v=>{ v.x=p.x; v.y=p.y; }); }
    if(down?.move){
      if(!down.pushed){ push(); down.pushed=true; }   // first drag frame records the undo point
      const dx=raw.x-down.raw.x, dy=raw.y-down.raw.y;
      for(const {el,b} of down.move){
        if(el.pts) el.pts.forEach((q,i)=>{q.x=b.pts[i].x+dx;q.y=b.pts[i].y+dy;});
        else if(el.type==='symbol' && findSym(el.sym)?.cut && down.move.length===1){
          // Stay put. Sliding along the wall is what you nearly always mean, so
          // dragging never detaches — it can only hop to a different wall you
          // drag it right onto. Press D to lift it off deliberately.
          const near=nearestSeg(raw, 26*scale());
          if(near && near.id!==el.host?.id){ el.host={id:near.id,seg:near.seg,d:near.d}; }
          else if(el.host){
            const own=nearestSeg(raw, 1e9, el.host.id);
            if(own) el.host={id:own.id,seg:own.seg,d:own.d};
          }
          else if(near){ el.host={id:near.id,seg:near.seg,d:near.d}; }
          else { el.x=b.x+dx; el.y=b.y+dy; }
        }
        else if(!el.host){ el.x=b.x+dx; el.y=b.y+dy; }
      }
    }
    if(S.draft?.type==='poly'&&S.draft.pts.length){
      const r=resolve(raw, S.draft.pts.at(-1), e);
      S.draft.cur=r.p; S.guideL=r.lines||[]; S.snapKind=r.kind;
      S.snapHit=(r.kind!=='free')?r.p:null;
    } else if(S.draft?.type==='arc'){
      if(S.draft.tan){                                  // tangent arc: one end is pinned
        const r=resolve(raw, null, e);
        S.draft.cur=r.p;
        S.draft.sag=tangentSag(S.draft.pts[0], r.p, S.draft.tan);
        S.snapHit=(r.kind!=='free')?r.p:null; S.guideL=[];
      } else if(S.draft.pts.length===1){
        const r=resolve(raw, S.draft.pts[0], e);
        S.draft.cur=r.p; S.guideL=r.lines||[];
        S.snapHit=(r.kind!=='free')?r.p:null;
      } else {
        S.draft.sag = sagFrom(S.draft.pts[0], S.draft.pts[1], raw);
        S.guideL=[];
      }
    } else S.guideL=[];
    if(down?.draw&&S.draft?.type==='rect'){
      S.draft.x=Math.min(down.p.x,p.x); S.draft.y=Math.min(down.p.y,p.y);
      S.draft.w=Math.abs(p.x-down.p.x); S.draft.h=Math.abs(p.y-down.p.y);
    }
    if(down?.draw&&S.draft?.type==='circle') S.draft.r=Math.hypot(p.x-down.p.x,p.y-down.p.y);
    render();
  });

  stage.addEventListener('pointerup',()=>{
    if(down?.marquee && S.marquee){
      const m=S.marquee;
      const x0=Math.min(m.x0,m.x1), x1=Math.max(m.x0,m.x1),
            y0=Math.min(m.y0,m.y1), y1=Math.max(m.y0,m.y1);
      const big = Math.hypot(x1-x0,y1-y0) > 3*scale();
      if(m.zoom){
        // zoom the view to the dragged rectangle (keeping the stage aspect)
        if(big){
          const r=stage.getBoundingClientRect(), ar=r.width/r.height;
          let w=x1-x0, h=y1-y0;
          if(w/h > ar) h=w/ar; else w=h*ar;       // grow the short side to fit
          S.view={x:(x0+x1)/2-w/2, y:(y0+y1)/2-h/2, w, h:0};
          applyView();
        }
        S.marquee=null; down=null; render(); return;
      }
      if(big){
        // grab anything the box touches — full-containment felt too fussy
        const box={x:x0,y:y0,w:x1-x0,h:y1-y0};
        const overlaps = b => !(b.x>box.x+box.w || b.x+b.w<box.x || b.y>box.y+box.h || b.y+b.h<box.y);
        const inside = S.els.filter(el=>overlaps(bbox(el)));
        const grabbed=new Set(inside);
        for(const el of [...grabbed]) if(el.grp) groupOf(el).forEach(g=>grabbed.add(g));
        S.sel = m.add ? [...new Set([...S.sel,...grabbed])] : [...grabbed];
      }
      S.marquee=null; down=null; render(); props(); return;
    }
    if(down?.draw&&S.draft){
      if(S.draft.w>2||S.draft.r>2){
        push();
        S.els.push(S.draft.type==='rect'
          ? {id:uid(),type:'rect',x:S.draft.x,y:S.draft.y,w:S.draft.w,h:S.draft.h,color:S.color,weight:S.weight,dash:S.dash}
          : {id:uid(),type:'circle',x:S.draft.x,y:S.draft.y,r:S.draft.r,color:S.color,weight:S.weight,dash:S.dash});
      }
      S.draft=null;
    }
    down=null; render(); props();
  });
  stage.addEventListener('dblclick',finishDraft);
  stage.addEventListener('contextmenu',e=>{e.preventDefault();finishDraft();});

  function finishDraft(){
    const d=S.draft;
    if(d?.type==='poly'&&d.pts.length>1){
      push();
      S.els.push({id:uid(),type:'poly',pts:d.pts.map(p=>({x:p.x,y:p.y})),
        color:S.color,weight:S.weight,dash:S.dash});
    }
    if(d?.type==='arc'){
      const ends = d.tan ? (d.cur?[d.pts[0],d.cur]:null) : (d.pts.length===2?d.pts:null);
      if(ends && Math.hypot(ends[1].x-ends[0].x, ends[1].y-ends[0].y) > 1){
        push();
        S.els.push({id:uid(),type:'arc',pts:ends.map(p=>({x:p.x,y:p.y})),sag:d.sag||0,
          color:S.color,weight:S.weight,dash:S.dash});
      }
    }
    S.draft=null; render();
  }

  /* =========================================================================
     KEYBOARD — this table is the single source of truth: it drives the
     legend as well, so the two can never drift apart.
     ========================================================================= */
  const KEYS = [
    ['Tools',[
      [['V'],'Select'], [['E'],'Edit nodes'], [['B'],'Zoom to area'], [['L'],'Line'], [['N'],'Arc'], [['Shift','N'],'Tangent arc'],
      [['R'],'Rectangle'], [['C'],'Circle'],
      [['K'],'Fillet a corner'], [['J'],'Chamfer a corner'], [['U'],'Join two points'],
      [['S'],'Symbol'], [['T'],'Text'], [['H'],'Pan'],
      [['Space'],'Hold to pan from any tool'],
      [['F'],'Fit view to the drawing']
    ]],
    ['Drawing',[
      [['Esc'],'End the run \u00b7 again to leave the tool'],
      [['Enter'],'End the run, stay in the tool'],
      [['D'],'Disconnect \u2014 end the run, or lift a door off its wall'],
      [['Shift'],'Hold to invert the ortho lock'],
      [['Alt'],'Hold to ignore alignment guides'],
      [['1','\u2026','5'],'Line weight, thinnest to thickest']
    ]],
    ['Modes',[
      [['A'],'Snap to anchor points'],
      [['O'],'Ortho \u2014 horizontal / vertical only'],
      [['Y'],'Alignment guides'],
      [['G'],'Show grid'],
      [['Shift','G'],'Snap to grid'],
      [['Shift','L'],'Show symbol names on the plan'],
      [['['],'Halve grid size'], [[']'],'Double grid size']
    ]],
    ['Editing & view',[
      [['Ctrl','Z'],'Undo'],
      [['Ctrl','Y'],'Redo'],
      [['Ctrl','G'],'Group \u2014 shared points become one joint'],
      [['Ctrl','Shift','G'],'Ungroup'],
      [['Alt','click'],'Select one piece inside a group'],
      [['Shift','click'],'Add to the selection'],
      [['Ctrl','A'],'Select everything'],
      [['Ctrl','D'],'Duplicate the selection'],
      [['.'],'Rotate 90\u00b0 right'], [[','],'Rotate 90\u00b0 left'],
      [['M'],'Mirror \u2014 swap a door\'s hinge side'],
      [['X'],'Flip \u2014 swap a door\'s swing direction'],
      [['\u2190','\u2192','\u2191','\u2193'],'Nudge the selection'],
      [['Shift','\u2190'],'Nudge by ten'],
      [['Alt','\u2191','\u2193'],'Scroll the page while zoomed in'],
      [['Del'],'Delete the selection, or a picked line segment'],
      [['Ctrl','N'],'New project'],
      [['Ctrl','S'],'Save'], [['Ctrl','Shift','S'],'Save as\u2026'],
      [['?'],'This list']
    ]]
  ];
  $('#keysBody').innerHTML = KEYS.map(([grp,rows])=>
    `<div><div class="kgrp">${grp}</div>${rows.map(([k,d])=>
      `<div class="krow"><div class="keys">${k.map(x=>`<kbd>${x}</kbd>`).join('')}</div><span>${d}</span></div>`
    ).join('')}</div>`).join('');

  const keysOpen = v => $('#keysBg').classList.toggle('show', v);
  $('#btnKeys').onclick=()=>keysOpen(true);
  $('#keysX').onclick=()=>keysOpen(false);
  $('#keysBg').onclick=e=>{ if(e.target.id==='keysBg') keysOpen(false); };

  /* ---- editing helpers driven by the keys above ---- */
  function duplicate(){
    if(!S.sel.length) return;
    push();
    const copies=S.sel.map(el=>{
      const c=JSON.parse(JSON.stringify(el));
      c.id=uid(); delete c.host;                     // a copy shouldn't share a wall slot
      const off=20;
      if(c.pts) c.pts.forEach(p=>{p.x+=off;p.y+=off;}); else {c.x=(c.x||0)+off; c.y=(c.y||0)+off;}
      return c;
    });
    S.els.push(...copies); S.sel=copies; render(); props();
  }
  function nudge(dx,dy){
    if(!S.sel.length) return;
    push();
    for(const el of S.sel){
      if(el.host) el.host.d += dx||dy;               // hosted: slide along the wall instead
      else if(el.pts) el.pts.forEach(p=>{p.x+=dx;p.y+=dy;});
      else {el.x+=dx; el.y+=dy;}
    }
    render();
  }
  function disconnect(){
    if(S.draft){ finishDraft(); return; }            // break the chain you're drawing
    const el=sel1();
    if(el?.host){                                    // or lift a door off its wall
      push();
      const q=symXY(el);
      delete el.host; el.x=q.x; el.y=q.y;
      render(); props(); toast('Lifted off the wall — the opening is closed up.');
      return;
    }
    if(S.tool!=='select') setTool('select');
  }
  function mirrorSel(axis){                          // 'mirror' = hinge side, 'flip' = swing side
    const el=sel1();
    if(!el || el.type!=='symbol') return;
    if(axis==='mirror' && findSym(el.sym)?.symmetric) return;
    push(); el[axis]=!el[axis]; render(); props();
  }
  function groupSel(){
    if(S.sel.length<2){ toast('Select two or more items first — Shift+click to add to the selection.',true); return; }
    push();
    const id='g'+uid();
    S.sel.forEach(el=>el.grp=id);
    render(); props();
    toast(`Grouped ${S.sel.length} items. Points they share now move as one joint.`);
  }
  function ungroupSel(){
    if(!S.sel.some(el=>el.grp)){ toast('Nothing in the selection is grouped.',true); return; }
    push();
    S.sel.forEach(el=>delete el.grp);
    render(); props();
    toast('Ungrouped — each piece is independent again.');
  }
  $('#btnGrp').onclick=groupSel;
  $('#btnUngrp').onclick=ungroupSel;
  function pageScroll(dx,dy){                        // Alt+arrows / PageUp / PageDown
    S.view.x += dx*S.view.w*0.85;
    S.view.y += dy*S.view.h*0.85;
    applyView(); render();
  }

  /* ---- rotate the current selection about its own centre ---------------- */
  function selCentre(){
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const el of S.sel){const b=bbox(el);
      x0=Math.min(x0,b.x);y0=Math.min(y0,b.y);x1=Math.max(x1,b.x+b.w);y1=Math.max(y1,b.y+b.h);}
    return {x:(x0+x1)/2, y:(y0+y1)/2};
  }
  function rotateSel(deg){
    if(!S.sel.length) return;
    push();
    const c=selCentre(), a=deg*Math.PI/180, ca=Math.cos(a), sa=Math.sin(a);
    const rot=p=>{const dx=p.x-c.x, dy=p.y-c.y;
      p.x=c.x+dx*ca-dy*sa; p.y=c.y+dx*sa+dy*ca;};
    for(const el of S.sel){
      if(el.pts) el.pts.forEach(rot);              // lines and arcs carry their points
      if(el.type==='rect'){                        // rect has no rotation field — turn it into a poly
        const {x,y,w,h}=el; el.type='poly';
        el.pts=[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h},{x,y}];
        delete el.x;delete el.y;delete el.w;delete el.h; el.pts.forEach(rot);
      }
      if(el.type==='circle'){ const p={x:el.x,y:el.y}; rot(p); el.x=p.x; el.y=p.y; }
      if(el.type==='symbol' && !el.host){ const p={x:el.x,y:el.y}; rot(p); el.x=p.x; el.y=p.y; el.rot=(el.rot+deg)%360; }
      if(el.type==='text'){ const p={x:el.x,y:el.y}; rot(p); el.x=p.x; el.y=p.y; }
    }
    render(); props();
  }

  let panPrev=null;
  _on(window, 'keydown',e=>{
    if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const k=e.key, low=k.toLowerCase();

    if(e.ctrlKey||e.metaKey){
      if(low==='z'){ e.preventDefault(); e.shiftKey?redo():undo(); return; }
      if(low==='y'){ e.preventDefault(); redo(); return; }
      if(low==='d'){ e.preventDefault(); duplicate(); return; }
      if(low==='s'){ e.preventDefault(); saveProject(e.shiftKey); return; }
      if(low==='a'){ e.preventDefault(); S.sel=[...S.els]; render(); props(); return; }
      if(low==='n'){ e.preventDefault(); newProject(); return; }
      if(low==='g'){ e.preventDefault(); e.shiftKey?ungroupSel():groupSel(); return; }
      return;                                        // leave every other browser combo alone
    }

    if(k==='?'||k==='/'){ e.preventDefault(); keysOpen(!$('#keysBg').classList.contains('show')); return; }
    if($('#keysBg').classList.contains('show')){ if(k==='Escape') keysOpen(false); return; }

    // scroll the page around while zoomed in, rather than nudging anything
    if(k==='PageUp'){ pageScroll(0,-1); e.preventDefault(); return; }
    if(k==='PageDown'){ pageScroll(0,1); e.preventDefault(); return; }
    if(k.startsWith('Arrow') && e.altKey){
      pageScroll(k==='ArrowLeft'?-1:k==='ArrowRight'?1:0,
                 k==='ArrowUp'?-1:k==='ArrowDown'?1:0);
      e.preventDefault(); return;
    }

    if(k===' '&&!panPrev&&S.tool!=='pan'){ e.preventDefault(); panPrev=S.tool; setTool('pan'); return; }
    if(k==='Enter'){ if(S.draft) finishDraft(); return; }
    if(k==='Escape'){
      if(S.joinA){ S.joinA=null; render(); return; }
      if(S.draft) finishDraft();
      else if(S.tool!=='select') setTool('select');
      else { S.sel=[]; render(); props(); }
      return;
    }
    if(k==='Delete'||k==='Backspace'){
      if(S.segSel){ deleteSegment(S.segSel.el, S.segSel.i); e.preventDefault(); return; }
      if(S.sel.length){ push(); S.els=S.els.filter(x=>!S.sel.includes(x)); S.sel=[]; render(); props(); e.preventDefault(); }
      return;
    }
    if(k.startsWith('Arrow')){
      const step=e.shiftKey?10:1;
      nudge(k==='ArrowLeft'?-step:k==='ArrowRight'?step:0,
            k==='ArrowUp'?-step:k==='ArrowDown'?step:0);
      e.preventDefault(); return;
    }
    if(k==='[') return setGrid(S.gridSize/2);
    if(k===']') return setGrid(S.gridSize*2);
    if(k>='1'&&k<='5'){ $$('.wt')[+k-1]?.click(); return; }
    if(low==='d'){ disconnect(); return; }
    if(low==='f'){ fit(); render(); return; }
    if(low==='g'){ toggle(e.shiftKey?'snapG':'grid'); return; }
    if(low==='x'){ mirrorSel('flip'); return; }
    if(low==='m'){ mirrorSel('mirror'); return; }
    if(k==='.'&&S.sel.length){ rotateSel(90); return; }
    if(k===','&&S.sel.length){ rotateSel(-90); return; }
    if(low==='l'&&e.shiftKey){ toggle('labels'); return; }

    if(low==='n'){ setTool(e.shiftKey?'arctan':'arc'); return; }
    if(low==='b'){ setTool('zoombox'); return; }
    const t={v:'select',e:'node',l:'line',r:'rect',c:'circle',
             k:'fillet',j:'chamfer',u:'join',s:'symbol',t:'text',h:'pan'}[low];
    if(t){ setTool(t); return; }
    const m={a:'snapA',o:'ortho',y:'guides'}[low];
    if(m) toggle(m);
  });
  _on(window, 'keyup',e=>{
    if(e.key===' '&&panPrev){ setTool(panPrev); panPrev=null; return; }
    if(e.key==='Shift'&&S.draft) render();           // redraw the preview when ortho flips back
  });

  /* =========================================================================
     PROPERTIES
     ========================================================================= */
  function props(){
    const box=$('#props'), card=$('#propCard'), title=$('#propTitle');
    const idle = !S.sel.length;
    card.classList.toggle('idle', idle);
    if(idle){
      title.textContent='Settings';
      box.innerHTML='<div class="muted">Pick a select tool and click an item. Its settings open here, under the library.</div>';
      return;
    }
    const one=S.sel[0];
    title.textContent = S.sel.length>1 ? `${S.sel.length} items`
      : one.type==='symbol' ? (findSym(one.sym)?.name || 'Symbol')
      : one.type==='poly' ? 'Line'
      : one.type[0].toUpperCase()+one.type.slice(1);
    if(S.sel.length>1){
      const n=S.sel.length;
      const grouped=S.sel.filter(x=>x.grp).length;
      box.innerHTML=`<div class="muted"><b>${n} items selected.</b> Drag to move them together;
        the colour and weight buttons apply to all of them.<br>
        ${grouped===n&&S.sel[0].grp&&S.sel.every(x=>x.grp===S.sel[0].grp)
          ? 'Grouped — points they share move as one joint.'
          : 'Not grouped. Group them to weld shared points together.'}</div>
        <div style="height:10px"></div>
        <div class="row"><label>Rotate</label>
          <button class="tbtn" id="pRotL" style="width:auto;flex:1" title="Rotate 90° left">↺ 90°</button>
          <button class="tbtn" id="pRotR" style="width:auto;flex:1" title="Rotate 90° right">↻ 90°</button></div>
        <button class="tbtn" id="pGrp">Group (Ctrl+G)</button>
        <button class="tbtn" id="pUngrp">Ungroup</button>
        <button class="tbtn" id="pDup">Duplicate all (Ctrl+D)</button>
        <button class="tbtn danger" id="pDel">Delete all ${n}</button>`;
      $('#pRotL').onclick=()=>rotateSel(-90); $('#pRotR').onclick=()=>rotateSel(90);
      $('#pGrp').onclick=groupSel; $('#pUngrp').onclick=ungroupSel;
      $('#pDup').onclick=duplicate;
      $('#pDel').onclick=()=>{push();S.els=S.els.filter(x=>!S.sel.includes(x));S.sel=[];render();props();};
      return;
    }

    const el=S.sel[0];
    let h='';
    if(el.type==='symbol'){
      const def=findSym(el.sym)||{};
      const hosted=!!el.host, cuts=!!def.cut;
      h+=`<div class="row"><label>Name</label><input type="text" id="pLab" value="${esc(el.label)}"></div>
          <label class="chk"><input type="checkbox" id="pShow" ${el.showLabel?'checked':''}>
            Show name on the plan</label>`;
      if(!def.inner)                                   // inner-tag symbols carry the text inside
        h+=`<div class="row"><label>Name X</label><input type="range" id="pNx" min="-60" max="60" value="${el.nx||0}">
              <input class="num" id="pNxN" type="number" min="-60" max="60" value="${el.nx||0}" style="width:48px"></div>
            <div class="row"><label>Name Y</label><input type="range" id="pNy" min="-40" max="60" value="${el.ny??26}">
              <input class="num" id="pNyN" type="number" min="-40" max="60" value="${el.ny??26}" style="width:48px"></div>`;
      if(el.showLabel)
        h+=`<div class="row"><label>Name size</label><input type="range" id="pLSz" min="6" max="40" value="${el.labelSize||11}">
              <input class="num" id="pLSzN" type="number" min="6" max="40" value="${el.labelSize||11}" style="width:48px"></div>`;
      h+=`<div class="muted" style="margin:-2px 0 8px">The name always shows in the popup, whether or not it's drawn.</div>
          <div class="h">Popup details</div>
          <textarea id="pDet" placeholder="e.g. 4000K &middot; 32W &middot; Circuit L3">${esc(el.details)}</textarea>
          <div style="height:8px"></div>
          <div class="row"><label>Size %</label><input type="range" id="pSc" min="20" max="600" value="${el.scale*100}">
            <input class="num" id="pScN" type="number" min="20" max="600" step="5" value="${Math.round(el.scale*100)}" style="width:52px"></div>`;
      if(!hosted)
        h+=`<div class="row"><label>Angle</label>
              <input type="range" id="pRo" min="0" max="359" value="${el.rot}">
              <input class="num" id="pRoN" type="number" min="0" max="359" step="1" value="${Math.round(el.rot)}"
                     style="width:54px" title="Type an exact bearing"></div>`;
      h+=`<div class="row" style="gap:6px">
            ${def.symmetric?'':`<button class="tbtn" id="pMir" style="flex:1">Mirror (M)</button>`}
            <button class="tbtn" id="pFlip" style="flex:1">Flip (X)</button>
          </div>`;
      if(cuts)
        h+=`<div class="muted" style="margin-top:6px">${def.symmetric
          ? 'Flip swaps which way it opens.'
          : 'Mirror swaps the hinge side; Flip swaps the swing direction.'}<br>${hosted
          ? 'Sitting on a wall &mdash; its angle comes from the wall, and the wall is gapped to suit. Drag to slide along, or press D to lift it off.'
          : 'Not on a wall. Drag it within about a symbol\'s width of a line to attach.'}</div>`;
    }
    if(el.type==='text'){
      const al=el.align||'start', fn=el.font||'sans';
      const abtn=(v,label,title)=>`<button class="tbtn tbx${al===v?' on':''}" data-al="${v}" title="${title}" style="flex:1">${label}</button>`;
      h+=`<div class="h">Text</div>
          <textarea id="pTx" rows="3" placeholder="Label text…">${esc(el.txt)}</textarea>
          <div class="muted" style="margin:2px 0 8px">Enter for a new line.</div>
          <div class="row"><label>Align</label>
            <div style="display:flex;gap:4px;flex:1">${abtn('start','⤎ L','Left')}${abtn('middle','↔ C','Centre')}${abtn('end','R ⤏','Right')}</div></div>
          <div class="row"><label>Font</label>
            <select id="pFont" style="flex:1">
              <option value="sans"${fn==='sans'?' selected':''}>Sans (Outfit)</option>
              <option value="mono"${fn==='mono'?' selected':''}>Mono (JetBrains)</option>
              <option value="serif"${fn==='serif'?' selected':''}>Serif</option>
            </select></div>
          <div class="row"><label>Style</label>
            <div style="display:flex;gap:4px;flex:1">
              <button class="tbtn tbx${el.bold?' on':''}" id="pBold" style="flex:1;font-weight:700">B</button>
              <button class="tbtn tbx${el.italic?' on':''}" id="pItal" style="flex:1;font-style:italic">I</button>
            </div></div>
          <div class="row"><label>Size</label><input type="range" id="pSz" min="8" max="120" value="${el.size}">
            <input class="num" id="pSzN" type="number" min="8" max="120" value="${el.size}" style="width:52px"></div>`;
    }
    if(el.type==='arc')
      h+=`<div class="row"><label>Bulge</label><input type="range" id="pSag" min="-400" max="400" value="${el.sag}"></div>
          <div class="muted">Drag past zero to swing the arc the other way.</div>`;
    if(el.type==='poly'){
      const c=Object.keys(el.corners||{}).length;
      h+=`<div class="muted">Line with ${el.pts.length} points${c?`, ${c} rounded or cut corner${c>1?'s':''}`:''}.
        ${el.grp?'In a group &mdash; shared points move as one joint.':'Not grouped &mdash; it moves on its own.'}</div>`;
      if(S.tool==='node'){
        h+=`<div class="muted" style="margin-top:6px">Drag a node to move it. Click a side to pick it, then use the button or Delete.</div>`;
        if(S.segSel && S.segSel.el===el)
          h+=`<div style="height:8px"></div><button class="tbtn danger" id="pSeg">Delete this side (Del)</button>`;
      } else {
        h+=`<div class="muted" style="margin-top:6px">Switch to the <b>Edit</b> tool to drag single nodes or delete one side.</div>`;
      }
      if(c) h+=`<div style="height:8px"></div><button class="tbtn" id="pSharp">Sharpen all corners</button>`;
    }
    // rotation for anything geometric (symbols already have their own Angle control)
    if(el.type!=='symbol')
      h+=`<div style="height:8px"></div>
          <div class="row"><label>Rotate</label>
            <button class="tbtn" id="pRotL" style="width:auto;flex:1" title="Rotate 90° left">↺ 90°</button>
            <button class="tbtn" id="pRotR" style="width:auto;flex:1" title="Rotate 90° right">↻ 90°</button>
            <input class="num" id="pRotN" type="number" value="0" step="5" style="width:52px" title="Rotate by this many degrees"></div>`;
    h+=`<div style="height:10px"></div><button class="tbtn danger" id="pDel">Delete item</button>`;
    box.innerHTML=h;

    // one history entry per editing session, not one per pixel of slider drag
    const bind=(id,fn)=>{
      const n=$(id); if(!n) return;
      let first=true;
      n.onfocus=()=>first=true;
      n.oninput=ev=>{ if(first){push();first=false;} fn(ev.target.value); render(); };
    };
    bind('#pLab',v=>el.label=v); bind('#pDet',v=>el.details=v);
    bind('#pSc',v=>{el.scale=v/100; S.symScale=el.scale; const n=$('#pScN'); if(n)n.value=Math.round(v);});
    bind('#pScN',v=>{el.scale=(+v||100)/100; S.symScale=el.scale; const n=$('#pSc'); if(n)n.value=+v;});
    bind('#pNx',v=>{el.nx=+v; const n=$('#pNxN'); if(n)n.value=+v;});
    bind('#pNy',v=>{el.ny=+v; const n=$('#pNyN'); if(n)n.value=+v;});
    bind('#pNxN',v=>{el.nx=+v||0; const n=$('#pNx'); if(n)n.value=+v;});
    bind('#pNyN',v=>{el.ny=+v||0; const n=$('#pNy'); if(n)n.value=+v;});
    bind('#pRo',v=>{el.rot=+v; const n=$('#pRoN'); if(n) n.value=Math.round(+v);});
    bind('#pRoN',v=>{el.rot=((+v||0)%360+360)%360; const n=$('#pRo'); if(n) n.value=el.rot;});
    bind('#pLSz',v=>{el.labelSize=+v; const n=$('#pLSzN'); if(n)n.value=+v;});
    bind('#pLSzN',v=>{el.labelSize=+v||11; const n=$('#pLSz'); if(n)n.value=el.labelSize;});
    bind('#pTx',v=>el.txt=v);
    bind('#pSz',v=>{el.size=+v; S.textSize=+v; const n=$('#pSzN'); if(n)n.value=+v;});
    bind('#pSzN',v=>{el.size=+v||16; S.textSize=el.size; const n=$('#pSz'); if(n)n.value=el.size;});
    bind('#pSag',v=>el.sag=+v);
    // text alignment buttons
    $$('[data-al]').forEach(b=>b.onclick=()=>{
      push(); el.align=b.dataset.al; S.textAlign=el.align;
      $$('[data-al]').forEach(x=>x.classList.toggle('on',x===b)); render();
    });
    if($('#pFont')) $('#pFont').onchange=ev=>{push(); el.font=ev.target.value; S.textFont=el.font; render();};
    if($('#pBold')) $('#pBold').onclick=()=>{push(); el.bold=!el.bold; S.textBold=el.bold; $('#pBold').classList.toggle('on',el.bold); render();};
    if($('#pItal')) $('#pItal').onclick=()=>{push(); el.italic=!el.italic; S.textItalic=el.italic; $('#pItal').classList.toggle('on',el.italic); render();};
    if($('#pShow')) $('#pShow').onchange=ev=>{push(); el.showLabel=ev.target.checked; render();};
    if($('#pMir'))  $('#pMir').onclick=()=>mirrorSel('mirror');
    if($('#pFlip')) $('#pFlip').onclick=()=>mirrorSel('flip');
    if($('#pSharp')) $('#pSharp').onclick=()=>{push(); delete el.corners; render(); props();};
    if($('#pSeg')) $('#pSeg').onclick=()=>{ if(S.segSel) deleteSegment(S.segSel.el,S.segSel.i); };
    if($('#pRotL')) $('#pRotL').onclick=()=>rotateSel(-90);
    if($('#pRotR')) $('#pRotR').onclick=()=>rotateSel(90);
    if($('#pRotN')) $('#pRotN').onchange=ev=>{ const d=+ev.target.value||0; if(d){rotateSel(d); ev.target.value=0;} };
    $('#pDel').onclick=()=>{push();S.els=S.els.filter(x=>x!==el);S.sel=[];render();props();};
    // make sure the populated settings are actually visible (not below the fold)
    try{ card.scrollIntoView({block:'nearest'}); }catch{}
  }

  /* =========================================================================
     IMAGE  — handles JPEG / PNG / WebP and iPhone HEIC / HEIF
     ------------------------------------------------------------------------
     No browser except Safari can decode HEIC. So:
       1. try to decode it natively (Safari does, free and offline);
       2. if that fails, pull in the heic2any decoder from a CDN and convert.
     Either way the picture is re-encoded to JPEG, which keeps exported files
     viewable on every browser and keeps their size sane.
     ========================================================================= */
  const MAX_PX = 4000;                       // longest edge; keeps exports manageable
  const HEIC2ANY_CDN = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
  const isHeic = f => /\.(heic|heif)$/i.test(f.name||'') || /image\/hei[cf]/i.test(f.type||'');


  function toast(msg,err){
    const t=$('#toast'); t.textContent=msg;
    t.classList.toggle('err',!!err); t.classList.add('show');
    clearTimeout(_toastHandle);
    if(msg) _toastHandle=setTimeout(()=>t.classList.remove('show'), err?9000:2500);
  }
  const hideToast = () => $('#toast').classList.remove('show');

  /* ---- blocking dialogs, in the same skin as everything else ---- */
  function busy(title,msg){
    $('#busyT').textContent=title;
    $('#busyM').textContent=msg||'';
    $('#busyBg').classList.add('show');
  }
  const busyOff = () => $('#busyBg').classList.remove('show');

  // ask('Title','message',[{k:'save',t:'Save',primary:true},…]) → Promise of the key
  // custom multi-line text box (replaces the browser prompt)
  function askText(initial){
    return new Promise(res=>{
      const bg=$('#textBg'), ta=$('#textInput');
      ta.value=initial||'';
      bg.classList.add('show');
      setTimeout(()=>{ ta.focus(); ta.select(); }, 30);
      const done=v=>{ bg.classList.remove('show'); ta.onkeydown=null; res(v); };
      $('#textOK').onclick=()=>done(ta.value);
      $('#textCancel').onclick=()=>done(null);
      // Enter adds a newline (default textarea); Ctrl/Cmd+Enter confirms, Esc cancels
      ta.onkeydown=ev=>{
        if(ev.key==='Enter' && (ev.ctrlKey||ev.metaKey)){ ev.preventDefault(); done(ta.value); }
        else if(ev.key==='Escape'){ ev.preventDefault(); done(null); }
      };
    });
  }
  function ask(title,msg,buttons){
    return new Promise(res=>{
      $('#askT').textContent=title;
      $('#askM').textContent=msg;
      $('#askBtns').innerHTML=buttons.map((b,i)=>
        `<button class="tbtn${b.danger?' danger':''}" data-i="${i}"
          ${b.primary?'style="border-color:var(--amber);color:var(--amber)"':''}>${esc(b.t)}</button>`).join('');
      const bg=$('#askBg'); bg.classList.add('show');
      const done=k=>{ bg.classList.remove('show'); document.removeEventListener('keydown',key,true); res(k); };
      $('#askBtns').querySelectorAll('button').forEach(n=>
        n.onclick=()=>done(buttons[+n.dataset.i].k));
      const key=ev=>{
        if(ev.key==='Escape'){ ev.stopPropagation(); done('cancel'); }
      };
      document.addEventListener('keydown',key,true);
    });
  }

  const decode = src => new Promise((res,rej)=>{
    const i=new Image(); i.onload=()=>res(i); i.onerror=()=>rej(new Error('decode')); i.src=src;
  });
  function loadScript(src){
    return new Promise((res,rej)=>{
      const s=document.createElement('script');
      s.src=src; s.onload=res; s.onerror=()=>rej(new Error('cdn'));
      document.head.appendChild(s);
    });
  }
  // draw through a canvas → always ends up as a portable JPEG data URL
  function reencode(img){
    let {naturalWidth:w, naturalHeight:h}=img;
    const f=Math.min(1, MAX_PX/Math.max(w,h));
    const c=document.createElement('canvas');
    c.width=Math.round(w*f); c.height=Math.round(h*f);
    const x=c.getContext('2d');
    x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height);
    x.drawImage(img,0,0,c.width,c.height);
    return c.toDataURL('image/jpeg',0.92);
  }

  async function fileToDataURL(f){
    const url=URL.createObjectURL(f);
    try{
      const img=await decode(url);            // native path — covers JPEG/PNG/WebP + HEIC on Safari
      return reencode(img);
    }catch{
      if(!isHeic(f)) throw new Error(`${f.name||'That file'} isn't an image this browser can read.`);
      busy('Converting HEIC photo','This browser can\'t read Apple\'s format directly, so it\'s being decoded here. Large photos take a few seconds.');
      if(!window.heic2any){
        try{ await loadScript(HEIC2ANY_CDN); }
        catch{ throw new Error('Couldn\'t reach the HEIC converter. Connect to the internet once, or on your iPhone set Settings → Camera → Formats → Most Compatible and re-take the photo.'); }
      }
      const out=await window.heic2any({blob:f,toType:'image/jpeg',quality:0.92});
      const jpg=Array.isArray(out)?out[0]:out;
      const img=await decode(URL.createObjectURL(jpg));
      return reencode(img);
    }finally{ URL.revokeObjectURL(url); }
  }

  async function useImage(f){
    if(!f) return;
    busy('Inserting image','Reading the file…');
    // let the dialog paint before the decode blocks the thread
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    try{
      const href=await fileToDataURL(f);
      busy('Inserting image','Placing it on the sheet…');
      const img=await decode(href);
      const _pr=paperRect();
      const s=Math.min(_pr.w/img.naturalWidth, _pr.h/img.naturalHeight)*0.9;
      S.bg={href, w:img.naturalWidth*s, h:img.naturalHeight*s, x:0, y:0, rot:0, skx:0, sky:0};
      S.bg.w0=S.bg.w; S.bg.h0=S.bg.h;             // remember native aspect for the ratio lock
      S.bg.x=_pr.x+(_pr.w-S.bg.w)/2; S.bg.y=_pr.y+(_pr.h-S.bg.h)/2;
      S.dirty=true;
      hideToast(); syncBgPanel(); fit(); render();
    }catch(err){ toast(err.message||'Could not load that image.', true); }
    finally{ busyOff(); }
  }

  $('#btnImg').onclick=()=>$('#fileImg').click();
  $('#btnImg2').onclick=()=>$('#fileImg').click();
  $('#fileImg').onchange=e=>{ useImage(e.target.files[0]); e.target.value=''; };
  $('#bgOp').oninput=render; $('#bgLock').onchange=render;
  $('#bgHide').onchange=e=>{ S.bgHidden=e.target.checked; render(); };
  $('#drawHide').onchange=e=>{ S.hideDrawing=e.target.checked; if(S.hideDrawing) S.sel=[]; render(); props(); };
  $('#btnImgDel').onclick=()=>{
    if(!S.bg){ toast('No image to remove.',true); return; }
    S.bg=null; S.dirty=true; syncBgPanel(); render();
    toast('Background image removed.');
  };

  // mirror the image's current state into the panel (called after handle drags too)
  function syncBgPanel(){
    const on=!!S.bg;
    $('#bgControls').style.display = on?'':'none';
    $('#bgHint').style.display = on?'none':'';
    if(!on){ render(); return; }
    const b=S.bg;
    $('#bgW').value=Math.round(b.w); $('#bgH').value=Math.round(b.h);
    $('#bgRotS').value=b.rot||0; $('#bgRotN').value=b.rot||0;
    $('#bgSkX').value=b.skx||0; $('#bgSkY').value=b.sky||0;
    $('#bgHide').checked=S.bgHidden;
    $('#drawHide').checked=S.hideDrawing;
    render();
  }
  function bgResize(w,h){
    const b=S.bg, cx=b.x+b.w/2, cy=b.y+b.h/2;   // resize about the centre
    if($('#bgAspect').checked){
      const r=(b.w0||b.w)/(b.h0||b.h);
      if(w!==b.w) h=w/r; else w=h*r;
    }
    b.w=Math.max(20,w); b.h=Math.max(20,h);
    b.x=cx-b.w/2; b.y=cy-b.h/2; S.dirty=true; syncBgPanel();
  }
  $('#bgW').oninput=e=>bgResize(+e.target.value||S.bg.w, S.bg.h);
  $('#bgH').oninput=e=>bgResize(S.bg.w, +e.target.value||S.bg.h);
  $('#bgRotS').oninput=e=>{ S.bg.rot=+e.target.value; $('#bgRotN').value=S.bg.rot; S.dirty=true; render(); };
  $('#bgRotN').oninput=e=>{ S.bg.rot=+e.target.value||0; $('#bgRotS').value=S.bg.rot; S.dirty=true; render(); };
  $('#bgSkX').oninput=e=>{ S.bg.skx=+e.target.value; S.dirty=true; render(); };
  $('#bgSkY').oninput=e=>{ S.bg.sky=+e.target.value; S.dirty=true; render(); };
  $('#bgReset').onclick=()=>{ S.bg.rot=0; S.bg.skx=0; S.bg.sky=0; S.dirty=true; syncBgPanel(); };

  /* ---- drag and drop onto the canvas ---- */
  const wrap=$('#stagewrap');
  let dragN=0;
  wrap.addEventListener('dragenter',e=>{e.preventDefault();if(++dragN)$('#drop').classList.add('show')});
  wrap.addEventListener('dragover',e=>e.preventDefault());
  wrap.addEventListener('dragleave',()=>{if(--dragN<=0){dragN=0;$('#drop').classList.remove('show')}});
  wrap.addEventListener('drop',e=>{
    e.preventDefault(); dragN=0; $('#drop').classList.remove('show');
    const f=e.dataTransfer.files[0]; if(!f) return;
    if(/\.json$/i.test(f.name)) openProject(f); else useImage(f);
  });

  /* =========================================================================
     EXPORT
     ========================================================================= */
  function bounds(){
    let b = S.bg ? {x:S.bg.x,y:S.bg.y,w:S.bg.w,h:S.bg.h} : paperRect();
    for(const el of S.els){const e=bbox(el);
      const x=Math.min(b.x,e.x), y=Math.min(b.y,e.y);
      b={x,y,w:Math.max(b.x+b.w,e.x+e.w)-x,h:Math.max(b.y+b.h,e.y+e.h)-y};}
    const p=Math.max(b.w,b.h)*0.03;
    return {x:b.x-p,y:b.y-p,w:b.w+p*2,h:b.h+p*2};
  }
  function svgDoc(withImage){
    const b=bounds();
    const showImg = withImage && S.bg && !S.bgHidden;
    const bg = showImg ? `<image href="${S.bg.href}" x="${S.bg.x}" y="${S.bg.y}" width="${S.bg.w}"
      height="${S.bg.h}" opacity="${$('#bgOp').value/100}" transform="${bgTransform(S.bg)}"
      preserveAspectRatio="none"/>` : '';
    return {b, svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x} ${b.y} ${b.w} ${b.h}"
      width="${Math.round(b.w)}" height="${Math.round(b.h)}">
      <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#FAFAF7"/>
      ${bg}${S.els.map(svgOf).join('')}</svg>`};
  }
  /* ---- DXF export -------------------------------------------------------
     Converts the drawing to AutoCAD R12 DXF (text-based, opens in every CAD
     package; AutoCAD can then Save As DWG). SVG Y runs down, CAD Y runs up,
     so every Y is negated. Lines, rectangles and circles become native CAD
     entities; arcs and symbols are flattened to polylines by sampling their
     rendered SVG paths in the browser (with safe fallbacks). Units are the
     drawing's own — rescale in CAD until a real-world calibration exists.
     ---------------------------------------------------------------------- */
  function dxfDoc(){
    const out=[]; const put=(c,v)=>{ out.push(c); out.push(v); };
    const fmt=n=>(+n).toFixed(4);
    const FY=y=>-y;                                   // flip to CAD's up-axis
    put(0,'SECTION'); put(2,'ENTITIES');

    const ePolyline=(pts,closed)=>{
      if(pts.length<2) return;
      put(0,'POLYLINE'); put(8,'0'); put(66,1); put(70,closed?1:0);
      for(const p of pts){ put(0,'VERTEX'); put(8,'0'); put(10,fmt(p.x)); put(20,fmt(FY(p.y))); }
      put(0,'SEQEND');
    };
    const eCircle=(x,y,r)=>{ put(0,'CIRCLE'); put(8,'0'); put(10,fmt(x)); put(20,fmt(FY(y))); put(40,fmt(r)); };
    const eText=(x,y,hgt,s)=>{ put(0,'TEXT'); put(8,'0'); put(10,fmt(x)); put(20,fmt(FY(y))); put(40,fmt(hgt)); put(1,String(s).slice(0,255)); };

    // offscreen 1:1 SVG so getCTM / getPointAtLength return world coordinates
    const off=document.createElementNS('http://www.w3.org/2000/svg','svg');
    const _pr=paperRect();
    off.setAttribute('viewBox',`${_pr.x} ${_pr.y} ${_pr.w} ${_pr.h}`);
    off.setAttribute('width',_pr.w); off.setAttribute('height',_pr.h);
    off.style.cssText='position:absolute;left:-99999px;top:0;visibility:hidden';
    off.innerHTML=S.els.map(svgOf).join('');
    (container.querySelector('#stagewrap')||container).appendChild(off);

    const splitSubpaths = d => /[a-z]/.test(d) ? [d] : (d.match(/M[^M]*/g)||[d]);
    const sampleNode=(node)=>{                        // → array of world-space polylines
      const res=[];
      const geoms=[...node.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon')];
      if(node.matches && node.matches('path,rect,circle,ellipse,line,polyline,polygon')) geoms.unshift(node);
      for(const g of geoms){
        try{
          const ctm=g.getCTM(); if(!ctm) continue;
          const subs = g.tagName==='path' ? splitSubpaths(g.getAttribute('d')||'') : [null];
          for(const d of subs){
            let geo=g;
            if(d!=null){ geo=document.createElementNS('http://www.w3.org/2000/svg','path'); geo.setAttribute('d',d); off.appendChild(geo); }
            const len = geo.getTotalLength ? geo.getTotalLength() : 0;
            if(len>0){
              const n=Math.max(2,Math.ceil(len/2)), pl=[];
              for(let i=0;i<=n;i++){ const pt=geo.getPointAtLength(len*i/n).matrixTransform(ctm); pl.push({x:pt.x,y:pt.y}); }
              res.push(pl);
            }
            if(d!=null) off.removeChild(geo);
          }
        }catch(e){ /* this element couldn't be sampled — skip it */ }
      }
      return res;
    };

    for(const el of S.els){
      if(el.type==='poly'){
        const closed = el.pts.length>2 && vkey(el.pts[0])===vkey(el.pts.at(-1));
        ePolyline(closed?el.pts.slice(0,-1):el.pts, closed);
      } else if(el.type==='rect'){
        ePolyline([{x:el.x,y:el.y},{x:el.x+el.w,y:el.y},{x:el.x+el.w,y:el.y+el.h},{x:el.x,y:el.y+el.h}], true);
      } else if(el.type==='circle'){
        eCircle(el.x,el.y,el.r);
      } else if(el.type==='arc'){
        const node=off.querySelector(`[data-id="${el.id}"]`);
        const pls = node ? sampleNode(node) : [];
        if(pls.length) pls.forEach(pl=>ePolyline(pl,false));
        else ePolyline([el.pts[0],el.pts[1]],false);   // fallback: chord
      } else if(el.type==='symbol'){
        const node=off.querySelector(`[data-id="${el.id}"]`);
        const pls = node ? sampleNode(node) : [];
        if(pls.length) pls.forEach(pl=>ePolyline(pl,false));
        else { const q=symXY(el); eCircle(q.x,q.y,4*el.scale); }   // fallback: marker
        if(el.showLabel && el.label){ const q=symXY(el); eText(q.x, q.y+(el.ny??26)*el.scale, el.labelSize||11, el.label); }
      } else if(el.type==='text'){
        const lines=String(el.txt).split('\n');
        const cw=(el.font==='mono'?0.62:0.55)*(el.bold?1.05:1);
        lines.forEach((ln,i)=>{
          const lw=ln.length*el.size*cw;
          const lx = el.align==='middle' ? el.x-lw/2 : el.align==='end' ? el.x-lw : el.x;
          eText(lx, el.y + i*el.size*1.25, el.size, ln);
        });
      }
    }

    off.remove();
    put(0,'ENDSEC'); put(0,'EOF');
    let s=''; for(let i=0;i<out.length;i+=2) s+=out[i]+'\n'+out[i+1]+'\n';
    return s;
  }

  // ask once, before an export, whether to bake in the traced image
  async function wantImage(){
    if(!S.bg || S.bgHidden) return false;         // nothing to include
    const a=await ask('Include the traced image?',
      'Your export can keep the background photo/plan behind the drawing, or leave just your lines and symbols on a blank sheet.',
      [{k:'with',t:'Include image',primary:true},{k:'without',t:'Drawing only'},{k:'cancel',t:'Cancel'}]);
    return a==='cancel' ? null : a==='with';
  }
  /* ---- saving -----------------------------------------------------------
     Chrome and Edge can open a real "Save as" dialog, so you pick the folder
     and confirm the name. Firefox and Safari have no such API — they fall
     back to a normal download into the browser's download folder.
     ---------------------------------------------------------------------- */
  const docName = () => ($('#docName').value.trim() || 'Untitled plan');
  const safeName = () => docName().replace(/[\\/:*?"<>|]/g,'-').slice(0,80);
  $('#docName').oninput = () => { /* title owned by hub */ };

  async function saveAs(filename, blob, mime, ext, label, handle){
    if(window.showSaveFilePicker){
      try{
        const h = handle || await window.showSaveFilePicker({
          suggestedName:filename,
          types:[{description:label, accept:{[mime]:[ext]}}]
        });
        const w=await h.createWritable(); await w.write(blob); await w.close();
        toast('Saved to '+h.name);
        return h;                                            // hand it back so Save can reuse it
      }catch(err){
        if(err.name==='AbortError') return 'cancelled';      // user backed out — say nothing
        /* anything else: fall through to a plain download */
      }
    }
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download=filename; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),4000);
    toast('Downloaded '+filename);
    return 'downloaded';
  }
  $('#btnPng').onclick=async()=>{
    const inc=await wantImage(); if(inc===null) return;
    const {b,svg}=svgDoc(inc);
    const img=new Image();
    img.onload=()=>{
      const c=document.createElement('canvas'); c.width=b.w*2; c.height=b.h*2;
      const x=c.getContext('2d'); x.fillStyle='#FAFAF7'; x.fillRect(0,0,c.width,c.height);
      x.drawImage(img,0,0,c.width,c.height);
      c.toBlob(bl=>saveAs(safeName()+'.png', bl, 'image/png', '.png', 'PNG image'));
    };
    img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  };
  $('#btnSvg').onclick=async()=>{
    const inc=await wantImage(); if(inc===null) return;
    const {svg}=svgDoc(inc);
    saveAs(safeName()+'.svg', new Blob([svg],{type:'image/svg+xml'}), 'image/svg+xml', '.svg', 'SVG vector');
  };
  $('#btnDxf').onclick=()=>{
    if(!S.els.length){ toast('Nothing to export yet.',true); return; }
    try{
      const dxf=dxfDoc();
      saveAs(safeName()+'.dxf', new Blob([dxf],{type:'application/dxf'}), 'application/dxf', '.dxf', 'DXF drawing (CAD)');
      toast('DXF exported — open in CAD, then Save As DWG if you need DWG. Units are the drawing\'s own; rescale in CAD.');
    }catch(e){ toast('Could not build the DXF.',true); }
  };
  $('#btnHtml').onclick=async()=>{
    const inc=await wantImage(); if(inc===null) return;
    const {svg}=svgDoc(inc);
    const doc=`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(docName())}</title>
  <style>
  :root{--amber:#ea580c}
  *{box-sizing:border-box;margin:0}
  body{background:#0D1014;font-family:system-ui,sans-serif;height:100vh;overflow:hidden}
  svg{width:100%;height:100vh;display:block;touch-action:none;cursor:grab}
  svg.drag{cursor:grabbing}
  .sym{cursor:pointer}
  .sym:hover{filter:drop-shadow(0 0 6px var(--amber))}
  #pop{position:fixed;display:none;background:#171B22;color:#DDE3EC;border:1px solid var(--amber);
   border-radius:6px;padding:12px 14px;max-width:280px;box-shadow:0 10px 30px rgba(0,0,0,.55);font-size:13px}
  #pop h3{font-size:13px;margin-bottom:6px;color:var(--amber);font-weight:600}
  #pop p{font-size:12px;line-height:1.55;white-space:pre-wrap;color:#AEB7C4}
  #pop button{position:absolute;top:4px;right:8px;background:none;border:0;color:#7D8798;cursor:pointer;font-size:16px}
  #tip{position:fixed;left:12px;bottom:12px;color:#7D8798;font-size:11px;
   background:rgba(13,16,20,.8);padding:4px 8px;border-radius:3px}
  </style></head><body>
  ${svg}
  <div id="pop"><button onclick="document.getElementById('pop').style.display='none'">×</button>
  <h3 id="pt"></h3><p id="pd"></p></div>
  <div id="tip">${esc(docName())} · click a symbol for details · scroll to zoom · drag to pan</div>
  <script>
  const s=document.querySelector('svg');
  let vb=s.getAttribute('viewBox').split(' ').map(Number);
  const set=()=>s.setAttribute('viewBox',vb.join(' '));
  const P=e=>{const p=s.createSVGPoint();p.x=e.clientX;p.y=e.clientY;return p.matrixTransform(s.getScreenCTM().inverse())};
  s.addEventListener('wheel',e=>{e.preventDefault();const p=P(e),f=e.deltaY>0?1.12:1/1.12;
   vb[0]=p.x-(p.x-vb[0])*f;vb[1]=p.y-(p.y-vb[1])*f;vb[2]*=f;vb[3]*=f;set();},{passive:false});
  let d=null;
  s.addEventListener('pointerdown',e=>{d={p:P(e),vb:[...vb]};s.classList.add('drag');s.setPointerCapture(e.pointerId)});
  s.addEventListener('pointermove',e=>{if(!d)return;const p=P(e);vb[0]=d.vb[0]-(p.x-d.p.x);vb[1]=d.vb[1]-(p.y-d.p.y);set()});
  s.addEventListener('pointerup',()=>{d=null;s.classList.remove('drag')});
  const pop=document.getElementById('pop');
  s.addEventListener('click',e=>{
    const g=e.target.closest('.sym');
    if(!g){pop.style.display='none';return;}
    document.getElementById('pt').textContent=g.dataset.label||'Item';
    document.getElementById('pd').textContent=g.dataset.details||'No details recorded.';
    pop.style.display='block';
    const r=pop.getBoundingClientRect();
    pop.style.left=Math.min(e.clientX+14,innerWidth-r.width-10)+'px';
    pop.style.top=Math.min(e.clientY+14,innerHeight-r.height-10)+'px';
  });
  <\/script></body></html>`;
    saveAs(safeName()+'.html', new Blob([doc],{type:'text/html'}),
      'text/html', '.html', 'Interactive plan');
  };

  /* =========================================================================
     SAVE / OPEN
     ========================================================================= */
  // First Save asks where. After that, Save writes straight back to the same
  // file and only Save as… asks again — as you'd expect from a desktop app.
  let fileHandle=null;
  async function saveProject(forceDialog){
    const blob=new Blob(
      [JSON.stringify({name:docName(),els:S.els,bg:S.bg,gridSize:S.gridSize,paperW:PAPER_W,paperH:PAPER_H,paperX:S.paperX,paperY:S.paperY})],
      {type:'application/json'});
    const h=await saveAs(safeName()+'.json', blob, 'application/json', '.json',
      'Plan Tracer project', forceDialog?null:fileHandle);
    if(h==='cancelled') return false;
    if(h && h!=='downloaded') fileHandle=h;
    S.dirty=false;
    return true;
  }

  /* ---- new project ------------------------------------------------------
     Only nags when there's something to lose, and Cancel really does cancel
     — including if you back out of the save dialog itself.
     ---------------------------------------------------------------------- */
  const hasWork = () => S.els.length>0 || !!S.bg;
  async function newProject(){
    if(hasWork() && S.dirty){
      const a=await ask('Unsaved changes',
        `"${docName()}" has changes that aren't saved. Save it before starting a new plan?`,
        [{k:'save',t:'Save first',primary:true},{k:'discard',t:'Discard',danger:true},{k:'cancel',t:'Cancel'}]);
      if(a==='cancel'||a===undefined) return;
      if(a==='save' && !(await saveProject(false))) return;
    }
    S.els=[]; S.bg=null; S.sel=[]; S.draft=null;
    S.undo.length=0; S.redo.length=0; S.dirty=false;
    fileHandle=null;
    $('#docName').value='Untitled plan';
    /* title owned by hub */
    syncHist(); syncBgPanel(); fit(); render(); props();
    toast('New plan started.');
  }
  $('#btnNew').onclick=newProject;
  $('#btnSave').onclick=()=>saveProject(false);
  $('#btnSaveAs').onclick=()=>saveProject(true);
  $('#btnOpen').onclick=()=>$('#fileProj').click();
  $('#fileProj').onchange=e=>{ openProject(e.target.files[0]); e.target.value=''; };
  async function openProject(f){
    if(!f) return;
    if(hasWork() && S.dirty){
      const a=await ask('Unsaved changes',
        `"${docName()}" has changes that aren't saved. Save it before opening another plan?`,
        [{k:'save',t:'Save first',primary:true},{k:'discard',t:'Discard',danger:true},{k:'cancel',t:'Cancel'}]);
      if(a==='cancel'||a===undefined) return;
      if(a==='save' && !(await saveProject(false))) return;
    }
    const r=new FileReader();
    r.onload=()=>{
      try{
        const d=JSON.parse(r.result);
        S.els=d.els||[]; S.bg=d.bg||null; S.sel=[];
        fileHandle=null;                      // Save should ask again, not overwrite the old file
        S.undo.length=0; S.redo.length=0; S.dirty=false; syncHist();
        // projects saved before names could be hidden: fall back to the current default
        for(const el of S.els)
          if(el.type==='symbol' && el.showLabel===undefined) el.showLabel = !findSym(el.sym)?.cut;
        if(d.name){ $('#docName').value=d.name; /* title owned by hub */ }
        if(d.gridSize){S.gridSize=d.gridSize;$('#gSize').value=d.gridSize;$('#gPre').value=String(d.gridSize);}
        if(d.paperW) PAPER_W=d.paperW; if(d.paperH) PAPER_H=d.paperH;
        S.paperX=d.paperX||0; S.paperY=d.paperY||0;
        syncBgPanel(); fit(); render(); props();
      }catch{ toast('That file is not a Plan Tracer project.',true); }
    };
    r.readAsText(f);
  }

  /* =========================================================================
     INIT
     ========================================================================= */
  $('#btnKeys2').onclick=()=>keysOpen(true);

  // the browser's own guard — the only one it will let us use on unload
  _on(window, 'beforeunload',e=>{
    if(hasWork() && S.dirty){ e.preventDefault(); e.returnValue=''; }
  });



  // ---- startup: draw with whatever is registered, then pull in libraries ----
  refreshCategories();
  $('.sw')?.classList.add('on');
  $$('.wt')[1]?.classList.add('on');
  $('.symbtn')?.classList.add('on');
  syncModes(); syncHist(); syncBgPanel(); setTool('line'); fit(); render();

  ensureLibraries()
    .then(() => {
      refreshCategories();
      $('.symbtn')?.classList.add('on');
      toast('Loaded ' + Object.keys(LIB).length + ' symbol categories.');
    })
    .catch(() => toast('Could not load symbol libraries — using the built-in set.', true));

  _active = { container, listeners: _listeners, themeObs: _themeObs };
}

export function unmount(){
  if(!_active) return;
  _active.themeObs?.disconnect();
  for(const [t, ev, fn, opt] of _active.listeners) t.removeEventListener(ev, fn, opt);
  try{ clearTimeout(_toastHandle); }catch{}
  _active.container.innerHTML = '';
  _active = null;
}


const TEMPLATE = `<!-- ============ HEADER 1 : FILE ============ -->
<!-- ============ BAR 1 : FILE ============ -->
<div id="top">
  <div id="brand">Plan<span>Tracer</span></div>
  <input id="docName" type="text" value="Untitled plan" spellcheck="false"
    title="Document name — used for saved and exported files">
  <div class="sep"></div>
  <button class="tbtn" id="btnNew" title="New project (Ctrl+N)">New</button>
  <button class="tbtn" id="btnOpen" title="Open a project">Open</button>
  <button class="tbtn" id="btnSave" title="Save (Ctrl+S)">Save</button>
  <button class="tbtn" id="btnSaveAs" title="Save as… (Ctrl+Shift+S)">Save as…</button>
  <div class="sep"></div>
  <button class="tbtn" id="btnImg">Upload image</button>
  <button class="tbtn" id="btnUndo" title="Undo (Ctrl+Z)">↶</button>
  <button class="tbtn" id="btnRedo" title="Redo (Ctrl+Y)">↷</button>
  <div class="grow"></div>
  <button class="tbtn" id="btnKeys" title="Keyboard shortcuts (?)">⌨ Shortcuts</button>
  <button class="tbtn" id="btnPng">Export PNG</button>
  <button class="tbtn" id="btnSvg">Export SVG</button>
  <button class="tbtn" id="btnDxf">Export DXF</button>
  <button class="tbtn" id="btnHtml" style="border-color:var(--amber);color:var(--amber)">Export interactive HTML</button>
  <input type="file" id="fileImg" accept="image/*,.heic,.heif,.HEIC,.HEIF">
  <input type="file" id="fileProj" accept=".json,application/json">
</div>

<!-- ============ BAR 2 : DRAFTING AIDS + VIEW (its own colour) ============ -->
<div id="mb">
  <div class="tile">
    <span class="cap">Snapping</span>
    <div class="grp" id="modes"></div>
  </div>
  <div class="tile">
    <span class="cap">Grid Size</span>
    <div class="grp">
      <button class="stp" id="gDn" title="Halve the grid size ( [ )">–</button>
      <input class="num" id="gSize" type="number" min="1" max="500" step="1" value="20" title="Grid size">
      <button class="stp" id="gUp" title="Double the grid size ( ] )">+</button>
    </div>
  </div>
  <div class="tile">
    <span class="cap">Presets</span>
    <div class="grp">
      <select class="num" id="gPre" title="Preset grid sizes" style="width:80px">
        <option value="1">1</option><option value="5">5</option>
        <option value="10">10</option><option value="20" selected>20</option>
        <option value="25">25</option><option value="50">50</option>
        <option value="100">100</option><option value="200">200</option>
      </select>
    </div>
  </div>
  <div class="tile">
    <span class="cap">View</span>
    <div class="grp" id="viewGrp">
      <button class="tool" data-tool="pan" title="Pan (H) · or hold Space">
        <svg viewBox="0 0 16 16"><path d="M8 14V5M5 8V3M11 8V4M3 8v3a5 5 0 0 0 10 0V6"/></svg>Pan</button>
      <button class="tool" data-tool="zoombox" title="Zoom to area — drag a box over the part to zoom into (B)">
        <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14M5 7h4M7 5v4"/></svg>Zoom</button>
      <button class="tool" id="btnFit2" title="Fit view to the drawing (F)">
        <svg viewBox="0 0 16 16"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg>Fit</button>
      <button class="tool" id="btnLock" title="Lock the view — stops accidental panning and zooming">
        <svg viewBox="0 0 16 16"><rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>Lock</button>
    </div>
  </div>
  <div class="tile">
    <span class="cap">Canvas</span>
    <div class="grp">
      <select class="num" id="cvPre2" style="width:132px" title="Document size">
        <option value="">Document size…</option>
        <option value="1123,794">A4 landscape</option>
        <option value="794,1123">A4 portrait</option>
        <option value="1587,1123">A3 landscape</option>
        <option value="1123,1587">A3 portrait</option>
        <option value="2245,1587">A2 landscape</option>
        <option value="1587,2245">A2 portrait</option>
        <option value="1600,1100">Default</option>
        <option value="1920,1080">16:9 screen</option>
        <option value="2000,2000">Square</option>
        <option value="custom">Custom size…</option>
      </select>
      <button class="tool" data-tool="crop" title="Crop — drag the sheet edges to resize, drag inside to move it over your drawing">
        <svg viewBox="0 0 16 16"><path d="M5 1v10h10M1 5h10v10" /></svg>Crop</button>
      <button class="tool" id="btnFitSheet" title="Fit the view to the sheet">
        <svg viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="9" rx="1"/><path d="M6 7h4M8 5v4" opacity=".5"/></svg>Fit sheet</button>
    </div>
  </div>
  <div class="grow"></div>
</div>

<!-- ============ BAR 3 : DRAWING TOOLS ============ -->
<div id="tb">
  <div class="tile">
    <span class="cap">Drawing Tools</span>
    <div class="grp" id="tools"></div>
    <div class="grp" id="toolSettings" style="display:none"></div>
  </div>
  <div class="tile">
    <span class="cap">Line Weight</span>
    <div class="grp" id="wts"></div>
  </div>
  <div class="tile">
    <span class="cap">Colour &amp; style</span>
    <div class="grp" id="swatches"></div>
    <div class="grp">
      <select class="num" id="dash" title="Line style" style="width:86px">
        <option value="solid">Solid</option>
        <option value="dashed">Dashed</option>
        <option value="dotted">Dotted</option>
        <option value="dashdot">Dash-dot</option>
      </select>
    </div>
  </div>
  <div class="tile">
    <span class="cap">Group</span>
    <div class="grp">
      <button class="tool" id="btnGrp" title="Group the selection (Ctrl+G) — shared points then move as one joint">
        <svg viewBox="0 0 16 16"><rect x="2" y="2" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/><path d="M7 4.5h4.5V9" opacity=".5"/></svg>Group</button>
      <button class="tool" id="btnUngrp" title="Ungroup the selection (Ctrl+Shift+G)">
        <svg viewBox="0 0 16 16"><rect x="2" y="2" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/><path d="M13 3 10 6M10 3l3 3" opacity=".7"/></svg>Ungroup</button>
    </div>
  </div>
  <div class="grow"></div>
</div>

<div id="main">
  <!-- LEFT : library, then whatever settings the selection needs -->
  <aside id="left">
    <section class="card">
      <div class="h">Symbol library</div>
      <select id="cat"></select>
      <div style="height:8px"></div>
      <div id="symgrid"></div>
    </section>

    <section class="card" id="propCard">
      <div class="h" id="propTitle">Settings</div>
      <div id="props"><div class="muted">Pick a select tool and click an item to edit it.</div></div>
    </section>
  </aside>

  <!-- STAGE -->
  <div id="stagewrap">
    <svg id="stage" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="gridMinor" patternUnits="userSpaceOnUse">
          <path id="gridMinorPath" fill="none" stroke="#CDD2C8"/>
        </pattern>
        <pattern id="gridMajor" patternUnits="userSpaceOnUse">
          <rect id="gridMinorFill" fill="url(#gridMinor)"/>
          <path id="gridMajorPath" fill="none" stroke="#9AA396"/>
        </pattern>
      </defs>
      <g id="world">
        <rect id="paper" fill="#FAFAF7"/>
        <rect id="grid" fill="url(#gridMajor)" style="display:none"/>
        <image id="bg" preserveAspectRatio="none"/>
        <g id="hilite"></g>
        <g id="content"></g>
      </g>
      <g id="overlay"></g>
    </svg>
    <div id="empty">
      <b>Start a drawing</b>
      <p>Upload or drag in a floor plan or photo to trace over — JPEG, PNG or iPhone HEIC. Or start drawing lines on the blank sheet.</p>
    </div>
    <div id="hud">0, 0 · 100%</div>
    <div id="hint"></div>
    <div id="toast"></div>
    <div id="drop">Drop image to trace</div>
  </div>

  <!-- RIGHT : the image you're tracing, and the key list -->
  <aside id="right">
    <section class="card">
      <div class="h">Background image</div>
      <button class="tbtn" id="btnImg2">Upload image</button>
      <div id="bgControls" style="display:none">
        <div class="row"><label>Opacity</label><input type="range" id="bgOp" min="0" max="100" value="55"></div>
        <label class="chk"><input type="checkbox" id="bgLock" checked> Lock image</label>
        <label class="chk"><input type="checkbox" id="bgHide"> Hide image</label>
        <label class="chk"><input type="checkbox" id="drawHide"> Hide drawing (show plan only)</label>
        <div class="h" style="margin-top:6px">Adjust</div>
        <div class="row"><label>Width</label><input class="num" id="bgW" type="number" min="20" step="1" style="width:70px"></div>
        <div class="row"><label>Height</label><input class="num" id="bgH" type="number" min="20" step="1" style="width:70px"></div>
        <label class="chk"><input type="checkbox" id="bgAspect" checked> Keep aspect ratio</label>
        <div class="row"><label>Rotate</label><input type="range" id="bgRotS" min="-180" max="180" value="0">
          <input class="num" id="bgRotN" type="number" min="-180" max="180" style="width:50px"></div>
        <div class="row"><label>Skew X</label><input type="range" id="bgSkX" min="-45" max="45" value="0"></div>
        <div class="row"><label>Skew Y</label><input type="range" id="bgSkY" min="-45" max="45" value="0"></div>
        <button class="tbtn" id="bgReset">Reset adjustments</button>
      </div>
      <div class="muted" id="bgHint">Upload or drag in a plan, then unlock to move it or drag the teal handles to scale and rotate.</div>
      <div style="height:8px"></div>
      <button class="tbtn danger" id="btnImgDel">Remove image</button>
    </section>

    <section class="card">
      <div class="h">Keyboard Shortcuts</div>
      <div class="muted">
        <b>V</b> select · <b>B</b> box select · <b>L</b> line · <b>S</b> symbol<br>
        <b>Esc</b> end the run · <b>D</b> disconnect · <b>O</b> ortho<br>
        <b>Space</b> pan · <b>Ctrl+G</b> group
      </div>
      <div style="height:8px"></div>
      <button class="tbtn" id="btnKeys2">See all shortcuts</button>
    </section>
  </aside>
</div>

<!-- ============ BUSY + ASK DIALOGS ============ -->
<div id="busyBg"><div id="busyBox">
  <div class="spin"></div>
  <div><b id="busyT">Working…</b><p id="busyM"></p></div>
</div></div>

<div id="askBg"><div id="askBox">
  <h2 id="askT"></h2>
  <p id="askM"></p>
  <div id="askBtns"></div>
</div></div>

<div id="textBg"><div id="askBox">
  <h2>Text label</h2>
  <p>Type your text. Press Enter for a new line.</p>
  <textarea id="textInput" rows="4" spellcheck="true" placeholder="Label text…"></textarea>
  <div id="askBtns" style="margin-top:14px">
    <button class="tbtn" id="textCancel">Cancel</button>
    <button class="tbtn" id="textOK" style="border-color:var(--amber);color:var(--amber)">Add (Ctrl+Enter)</button>
  </div>
</div></div>

<div id="canvasBg"><div id="askBox">
  <h2>Canvas size</h2>
  <p>The sheet your drawing sits on. Existing work isn't moved or scaled.</p>
  <div class="row"><label>Presets</label>
    <select class="num" id="cvPre" style="width:100%;text-align:left">
      <option value="">Custom…</option>
      <option value="1600,1100">Default (1600 × 1100)</option>
      <option value="1123,794">A4 landscape</option>
      <option value="794,1123">A4 portrait</option>
      <option value="1587,1123">A3 landscape</option>
      <option value="2245,1587">A2 landscape</option>
      <option value="1920,1080">16:9 screen</option>
      <option value="2000,2000">Square (2000)</option>
    </select></div>
  <div class="row"><label>Width</label><input class="num" id="cvW" type="number" min="100" max="20000" style="width:100%"></div>
  <div class="row"><label>Height</label><input class="num" id="cvH" type="number" min="100" max="20000" style="width:100%"></div>
  <div id="askBtns" style="margin-top:14px">
    <button class="tbtn" id="cvCancel">Cancel</button>
    <button class="tbtn" id="cvApply" style="border-color:var(--amber);color:var(--amber)">Apply</button>
  </div>
</div></div>

<!-- ============ SHORTCUTS LEGEND ============ -->
<div id="keysBg"><div id="keysBox">
  <header><h2>Keyboard shortcuts</h2><button id="keysX" title="Close (Esc)">×</button></header>
  <div id="keysBody"></div>
  <footer>Keys are ignored while you're typing in a field.</footer>
</div></div>`;
