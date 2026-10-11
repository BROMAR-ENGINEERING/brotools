// js/tools/pdf-toolkit/index.js
//
// PDF Toolkit — BroTools module (same pattern as Plan Tracer).
// Named exports mount(container) / unmount(); no default export.
// index.js injects its own pdf-toolkit.css (resolved via import.meta.url) on first
// mount — the hub does not load it. pdf-lib, pdf.js and JSZip load from pinned CDN
// builds the module pulls in itself; the hub supplies no globals.
//
// Note: pdf.js is loaded as its UMD build (it registers window.pdfjsLib), because
// its ESM/bundled builds don't handle the worker reliably. That global is an
// internal detail of this module, not something the hub needs or sets.
//
// Features: split (ZIP + filename tokens), combine, per-page rotate, draggable
// crop handles, greyscale/B&W tone conversion, text + image watermarks, reorder.

const CDN = {
  pdfLib: 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
  pdfjs:  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  worker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  jszip:  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
};

function injectScript(src) {
  return new Promise((res, rej) => {
    let el = document.querySelector(`script[data-ptk-lib="${src}"]`);
    if (el) {
      if (el.dataset.ok) return res();
      el.addEventListener('load', () => res());
      el.addEventListener('error', () => rej(new Error('Failed to load ' + src)));
      return;
    }
    el = document.createElement('script');
    el.src = src; el.async = true; el.dataset.ptkLib = src;
    el.onload = () => { el.dataset.ok = '1'; res(); };
    el.onerror = () => rej(new Error('Failed to load ' + src));
    document.head.appendChild(el);
  });
}

let libs = null;           // cached across mounts
async function loadLibs() {
  if (libs) return libs;
  await Promise.all([injectScript(CDN.pdfLib), injectScript(CDN.pdfjs), injectScript(CDN.jszip)]);
  const PDFLib = window.PDFLib, pdfjsLib = window.pdfjsLib, JSZip = window.JSZip;
  if (!PDFLib || !pdfjsLib || !JSZip) throw new Error('PDF libraries did not initialise');
  pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.worker;
  libs = {
    PDFDocument: PDFLib.PDFDocument, StandardFonts: PDFLib.StandardFonts,
    rgb: PDFLib.rgb, degrees: PDFLib.degrees, pdfjsLib, JSZip,
  };
  return libs;
}

function ensureStyles() {
  const href = new URL('./pdf-toolkit.css', import.meta.url).href;
  if (![...document.querySelectorAll('link[rel="stylesheet"]')].some(l => l.href === href)) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.dataset.ptkStyle = '1';
    document.head.appendChild(l);
  }
}

let active = null;

export async function mount(container) {
  if (active) unmount();
  const inst = { disposed: false, container, destroy: () => {} };
  active = inst;

  ensureStyles();
  container.classList.add('tool-pdf-toolkit', 'ptk-root');
  container.innerHTML = '<div class="ptk-boot">Loading PDF libraries…</div>';

  let L;
  try { L = await loadLibs(); }
  catch (err) {
    if (!inst.disposed) container.querySelector('.ptk-boot').textContent =
      'Could not load the PDF libraries (' + (err && err.message || err) + '). Check the internet connection, then reopen the tool.';
    return;
  }
  if (inst.disposed) return;

  const { PDFDocument, StandardFonts, rgb, degrees, pdfjsLib, JSZip } = L;

  /* ---- cleanup registry ---- */
  const disposers = [];
  const urls = new Set();
  const timers = new Set();
  const on = (t, ty, fn, o) => { t.addEventListener(ty, fn, o); disposers.push(() => t.removeEventListener(ty, fn, o)); };
  const mkURL = blobOrFile => { const u = URL.createObjectURL(blobOrFile); urls.add(u); return u; };
  const after = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };

  /* ---- UI (container is the scoped root) ---- */
  const root = container;
  root.innerHTML = `
    <div class="ptk-bar">
      <span class="eyebrow" id="ptk-count">no pages loaded</span>
      <div class="ptk-spacer"></div>
      <button id="ptk-selAll">Select all</button>
      <button id="ptk-selNone">Clear</button>
      <label class="btn" for="ptk-file">Add PDFs</label>
      <input id="ptk-file" type="file" accept="application/pdf" multiple hidden>
    </div>
    <div class="ptk-main">
      <section class="ptk-bench" id="ptk-bench">
        <svg class="corner tl" viewBox="0 0 12 12" fill="none"><path d="M0 0h12M0 0v12"/></svg>
        <svg class="corner tr" viewBox="0 0 12 12" fill="none"><path d="M12 0H0M12 0v12"/></svg>
        <svg class="corner bl" viewBox="0 0 12 12" fill="none"><path d="M0 12h12M0 12V0"/></svg>
        <svg class="corner br" viewBox="0 0 12 12" fill="none"><path d="M12 12H0M12 12V0"/></svg>
        <div class="ptk-drop" id="ptk-drop">
          <h2>Drop PDFs here</h2>
          <div class="eyebrow">click a page to edit it on its own · drag to reorder</div>
        </div>
        <div class="ptk-grid" id="ptk-grid"></div>
      </section>
      <aside class="ptk-rail" id="ptk-rail">
        <div class="pane">
          <h3>Global settings</h3>
          <p class="hint">Set it up here, then stamp it onto every page, or just the ones you select.</p>
          <div class="row" style="margin-bottom:12px">
            <button id="ptk-gPrev">◀</button>
            <span class="eyebrow" id="ptk-gLbl" style="flex:2;text-align:center;align-self:center">—</span>
            <button id="ptk-gNext">▶</button>
          </div>
          <div id="ptk-gCtl" class="ed"></div>
          <div class="row" style="margin-top:16px">
            <button id="ptk-applySel">Apply to selected</button>
            <button id="ptk-applyAll" class="btn-key">Apply to all</button>
          </div>
          <div class="row"><button id="ptk-resetAll" class="btn-danger">Reset every page</button></div>
        </div>
        <div class="pane">
          <h3>Save</h3>
          <p class="hint">Pages export in the order shown in the grid.</p>
          <div class="row"><button id="ptk-exAll" class="btn-key">Save all as one PDF</button></div>
          <div class="row"><button id="ptk-exSel">Save selected as one PDF</button></div>
          <label class="f" style="margin-top:14px"><span class="eyebrow">Split into separate files</span>
            <input id="ptk-ranges" type="text" placeholder="1-3, 4, 5-9  (blank = one file per page)"></label>
          <label class="f"><span class="eyebrow">Name each file</span><input id="ptk-pattern" type="text" value="{name}-{n}"></label>
          <p class="hint" style="margin-top:-4px"><b class="mono">{name}</b> source · <b class="mono">{n}</b> counter · <b class="mono">{range}</b> pages · <b class="mono">{start}</b> <b class="mono">{end}</b> · <b class="mono">{date}</b></p>
          <div class="row"><button id="ptk-exSplit">Split to ZIP</button></div>
        </div>
        <div class="ptk-status" id="ptk-status">Ready.</div>
      </aside>
    </div>`;

  const modal = document.createElement('div');
  modal.className = 'tool-pdf-toolkit ptk-modal-root';
  modal.innerHTML = `
    <div class="sheet">
      <div class="top">
        <h3 id="ptk-mTitle">Page</h3>
        <button id="ptk-mReset" class="btn-danger">Reset page</button>
        <button id="ptk-mDone" class="btn-key">Done</button>
      </div>
      <div class="pad"><div id="ptk-mCtl" class="ed wide"></div></div>
    </div>`;
  document.body.appendChild(modal);

  const $ = s => root.querySelector(s);
  const say = (m, err) => { const s = $('#ptk-status'); s.textContent = m; s.classList.toggle('err', !!err); };

  /* ---- state ---- */
  const docs = new Map();      // docId -> {name, bytes, js}
  const stamps = new Map();    // stampId -> {bytes, type, el, ratio, name}
  const baseCache = new Map();
  let pages = [];              // {uid, docId, i, rot0, sel, s}
  let uid = 0, gIndex = 0, mIdx = -1;

  const defaults = () => ({
    rot: 0, tone: 'orig', thr: 128, dpi: 150,
    crop: { l: 0, t: 0, r: 0, b: 0 },
    wm: { on: false, kind: 'text', text: 'DRAFT', size: 64, pct: 40, rot: 45, col: '#c8102e', bold: true, img: null, x: .5, y: .5, op: .25 }
  });
  const clone = o => JSON.parse(JSON.stringify(o));
  let G = defaults();

  /* ---- geometry (stored in unrotated page space; mapped into view space) ---- */
  const CMAP = { 0: ['l','t','r','b'], 90: ['b','l','t','r'], 180: ['r','b','l','t'], 270: ['t','r','b','l'] };
  const cropView = (c, r) => { const k = CMAP[r]; return { l: c[k[0]], t: c[k[1]], r: c[k[2]], b: c[k[3]] }; };
  const cropSet = (c, r, edge, v) => { c[CMAP[r][{ l:0, t:1, r:2, b:3 }[edge]]] = v; };
  function toView(wm, r) {
    if (r === 90) return [wm.y, wm.x];
    if (r === 180) return [1 - wm.x, wm.y];
    if (r === 270) return [1 - wm.y, 1 - wm.x];
    return [wm.x, 1 - wm.y];
  }
  function toPage(u, v, r) {
    if (r === 90) return [v, u];
    if (r === 180) return [1 - u, v];
    if (r === 270) return [1 - v, 1 - u];
    return [u, 1 - v];
  }
  const viewRot = (p, s) => (p.rot0 + s.rot) % 360;

  /* ---- painting ---- */
  function applyTone(ctx, W, H, s) {
    if (s.tone === 'orig') return;
    const d = ctx.getImageData(0, 0, W, H), a = d.data;
    for (let i = 0; i < a.length; i += 4) {
      const g = .299 * a[i] + .587 * a[i + 1] + .114 * a[i + 2];
      a[i] = a[i + 1] = a[i + 2] = s.tone === 'mono' ? (g > s.thr ? 255 : 0) : g;
    }
    ctx.putImageData(d, 0, 0);
  }
  function paintMark(ctx, wm, W, H, scale, r) {
    const [u, v] = toView(wm, r);
    const pw = r % 180 === 0 ? W : H;
    ctx.save();
    ctx.globalAlpha = wm.op ?? 1;
    ctx.translate(u * W, v * H);
    ctx.rotate((r - wm.rot) * Math.PI / 180);
    if (wm.kind === 'image') {
      const st = stamps.get(wm.img);
      if (st) { const w = pw * wm.pct / 100, h = w * st.ratio; ctx.drawImage(st.el, -w / 2, -h / 2, w, h); }
    } else {
      const fs = wm.size * scale;
      ctx.fillStyle = wm.col;
      ctx.font = `${wm.bold ? 700 : 400} ${fs}px Helvetica, Arial, sans-serif`;
      ctx.fillText(wm.text, -ctx.measureText(wm.text).width / 2, fs * .355);
    }
    ctx.restore();
  }
  function paintCrop(ctx, W, H, crop, r, handles) {
    const v = cropView(crop, r);
    if (!(v.l || v.t || v.r || v.b) && !handles) return;
    const x0 = v.l * W, x1 = (1 - v.r) * W, y0 = v.t * H, y1 = (1 - v.b) * H;
    ctx.save();
    ctx.fillStyle = 'rgba(16,20,24,.6)';
    ctx.fillRect(0, 0, W, y0); ctx.fillRect(0, y1, W, H - y1);
    ctx.fillRect(0, y0, x0, y1 - y0); ctx.fillRect(x1, y0, W - x1, y1 - y0);
    if (handles) {
      const accent = getComputedStyle(root).getPropertyValue('--pt-accent').trim() || '#c8102e';
      ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([]); ctx.fillStyle = accent;
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, g = Math.min(18, (x1 - x0) / 4);
      ctx.fillRect(mx - g, y0 - 2, g * 2, 5); ctx.fillRect(mx - g, y1 - 3, g * 2, 5);
      ctx.fillRect(x0 - 2, my - g, 5, g * 2); ctx.fillRect(x1 - 3, my - g, 5, g * 2);
    }
    ctx.restore();
  }

  async function pageCanvas(p, W, vr) {
    const key = p.uid + '@' + vr + '@' + W;
    let e = baseCache.get(key);
    if (!e) {
      const pg = await docs.get(p.docId).js.getPage(p.i + 1);
      const scale = W / pg.getViewport({ scale: 1, rotation: 0 }).width;
      const vp = pg.getViewport({ scale, rotation: vr });
      const cv = document.createElement('canvas');
      cv.width = vp.width; cv.height = vp.height;
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      e = { cv, scale };
      baseCache.set(key, e);
    }
    return e;
  }
  async function composite(p, s, out, W, handles) {
    const vr = viewRot(p, s);
    const e = await pageCanvas(p, W, vr);
    out.width = e.cv.width; out.height = e.cv.height;
    const c = out.getContext('2d');
    c.drawImage(e.cv, 0, 0);
    applyTone(c, out.width, out.height, s);
    if (s.wm.on) paintMark(c, s.wm, out.width, out.height, e.scale, vr);
    paintCrop(c, out.width, out.height, s.crop, vr, handles);
    return vr;
  }

  /* ---- loading ---- */
  on($('#ptk-file'), 'change', e => { addFiles([...e.target.files]); e.target.value = ''; });
  const dz = $('#ptk-drop');
  ['dragover', 'dragenter'].forEach(t => on(document, t, e => { e.preventDefault(); dz.classList.add('hot'); }));
  ['dragleave', 'drop'].forEach(t => on(document, t, e => { e.preventDefault(); dz.classList.remove('hot'); }));
  on(document, 'drop', e => {
    const f = [...(e.dataTransfer?.files || [])].filter(f => f.type === 'application/pdf');
    if (f.length) addFiles(f);
  });
  async function addFiles(files) {
    for (const f of files) {
      try {
        say('Reading ' + f.name + '…');
        const bytes = new Uint8Array(await f.arrayBuffer());
        const js = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
        const id = 'd' + (uid++);
        docs.set(id, { name: f.name.replace(/\.pdf$/i, ''), bytes, js });
        for (let i = 0; i < js.numPages; i++) {
          let r = (await js.getPage(i + 1)).rotate || 0;
          r = ((Math.round(r / 90) * 90) % 360 + 360) % 360;
          pages.push({ uid: 'p' + (uid++), docId: id, i, rot0: r, sel: false, s: defaults() });
        }
        say(f.name + ' — ' + js.numPages + ' pages added.');
      } catch { say("Couldn't read " + f.name + '. It may be encrypted or damaged.', true); }
    }
    draw();
  }

  /* ---- the grid ---- */
  function draw() {
    const g = $('#ptk-grid');
    g.innerHTML = '';
    dz.hidden = pages.length > 0;
    $('#ptk-count').textContent = pages.length ? pages.length + ' pages · ' + docs.size + ' files' : 'no pages loaded';
    pages.forEach((p, idx) => {
      const c = document.createElement('div');
      c.className = 'card' + (p.sel ? ' sel' : '');
      c.draggable = true;
      const tags = [];
      if (p.s.rot) tags.push(p.s.rot + '°');
      if (p.s.tone !== 'orig') tags.push(p.s.tone === 'mono' ? 'B&W' : 'GREY');
      if (p.s.crop.l || p.s.crop.t || p.s.crop.r || p.s.crop.b) tags.push('CROP');
      if (p.s.wm.on) tags.push('MARK');
      c.innerHTML = `<canvas></canvas>
        <button class="pick mono" title="Select">${p.sel ? '✓' : String(idx + 1).padStart(2, '0')}</button>
        <button class="rot" title="Rotate 90°">⟳</button>
        <button class="kill" title="Remove page">✕</button>
        <div class="tags">${tags.map(t => `<span class="tag">${t}</span>`).join('')}<span class="name">${docs.get(p.docId).name}</span></div>`;
      c.onclick = () => openPage(idx);
      c.querySelector('.pick').onclick = e => { e.stopPropagation(); p.sel = !p.sel; draw(); };
      c.querySelector('.rot').onclick = e => { e.stopPropagation(); p.s.rot = (p.s.rot + 90) % 360; draw(); };
      c.querySelector('.kill').onclick = e => { e.stopPropagation(); pages.splice(idx, 1); draw(); };
      c.ondragstart = e => { e.dataTransfer.setData('text/plain', idx); c.classList.add('drag'); };
      c.ondragend = () => c.classList.remove('drag');
      c.ondragover = e => { e.preventDefault(); c.classList.add('over'); };
      c.ondragleave = () => c.classList.remove('over');
      c.ondrop = e => {
        e.preventDefault(); c.classList.remove('over');
        const from = +e.dataTransfer.getData('text/plain');
        if (from !== idx) { pages.splice(idx, 0, pages.splice(from, 1)[0]); draw(); }
      };
      g.appendChild(c);
      composite(p, p.s, c.querySelector('canvas'), 300, false).catch(() => {});
    });
    if (gIndex >= pages.length) gIndex = 0;
    $('#ptk-gLbl').textContent = pages.length ? 'preview: page ' + (gIndex + 1) + ' / ' + pages.length : 'no pages';
    gEd.sync();
  }

  /* ---- editor (used by the rail and the page popup) ---- */
  function ctlHTML(k) { return `
<div class="stage"><canvas id="${k}Pv"></canvas><div class="read mono" id="${k}Read"></div></div>
<div class="ctls">
  <div class="sect">
    <div class="eyebrow"><span>Colour</span></div>
    <div class="seg" id="${k}Tone">
      <button data-v="orig">Original</button><button data-v="gray">Greyscale</button><button data-v="mono">B&amp;W</button>
    </div>
    <label class="f" id="${k}ThrWrap" style="margin-top:10px"><span class="eyebrow">Threshold <b id="${k}ThrV">128</b></span>
      <input id="${k}Thr" type="range" min="16" max="240" value="128"></label>
    <label class="f" id="${k}DpiWrap"><span class="eyebrow">Quality</span>
      <select id="${k}Dpi"><option value="96">96 dpi — smallest</option><option value="150">150 dpi</option><option value="200">200 dpi</option><option value="300">300 dpi — sharpest</option></select></label>
    <p class="hint" id="${k}ToneNote" style="margin:0">Greyscale and B&amp;W redraw the page as an image, so text stops being selectable.</p>
  </div>

  <div class="sect">
    <div class="eyebrow"><span>Rotate</span><b id="${k}PRotV">0°</b></div>
    <div class="row"><button id="${k}PRotL">⟲</button><button id="${k}PRotR">⟳</button><button id="${k}PRot0">Reset</button></div>
  </div>

  <div class="sect">
    <div class="eyebrow"><span>Crop</span></div>
    <p class="hint" style="margin-top:0">Drag the dashed edges on the preview, or set the inset off each edge as a %.</p>
    <div class="row">
      <label class="f"><span class="eyebrow">Left</span><input id="${k}CL" type="number" min="0" max="98" value="0"></label>
      <label class="f"><span class="eyebrow">Right</span><input id="${k}CR" type="number" min="0" max="98" value="0"></label>
    </div>
    <div class="row">
      <label class="f"><span class="eyebrow">Top</span><input id="${k}CT" type="number" min="0" max="98" value="0"></label>
      <label class="f"><span class="eyebrow">Bottom</span><input id="${k}CB" type="number" min="0" max="98" value="0"></label>
    </div>
    <button id="${k}CropR">Reset crop</button>
  </div>

  <div class="sect">
    <div class="eyebrow"><span>Watermark</span><label class="toggle"><input id="${k}WmOn" type="checkbox"> On</label></div>
    <div id="${k}WmBody">
      <div class="seg" style="margin-bottom:12px"><button id="${k}MText" data-v="text">Text</button><button id="${k}MImage" data-v="image">Image</button></div>
      <div id="${k}TextOnly">
        <label class="f"><span class="eyebrow">Text</span><input id="${k}Text" type="text"></label>
        <label class="f"><span class="eyebrow">Size <b id="${k}SzV">64 pt</b></span><input id="${k}Sz" type="range" min="8" max="240"></label>
        <div class="row" style="align-items:center">
          <label class="f" style="margin:0"><span class="eyebrow">Colour</span><input id="${k}Col" type="color"></label>
          <label class="toggle"><input id="${k}Bold" type="checkbox"> Bold</label>
        </div>
      </div>
      <div id="${k}ImgOnly">
        <label class="btn" for="${k}ImgFile" style="display:block;text-align:center">Choose image</label>
        <input id="${k}ImgFile" type="file" accept="image/png,image/jpeg" hidden>
        <div class="eyebrow" id="${k}ImgName" style="margin:9px 0 12px">no image yet — png or jpg</div>
        <label class="f"><span class="eyebrow">Width <b id="${k}PctV">40%</b></span><input id="${k}Pct" type="range" min="3" max="100"></label>
      </div>
      <label class="f" style="margin-top:12px"><span class="eyebrow">Opacity <b id="${k}OpV">25%</b></span><input id="${k}Op" type="range" min="2" max="100"></label>
      <label class="f"><span class="eyebrow">Angle <b id="${k}WRotV">45°</b></span><input id="${k}WRot" type="range" min="-90" max="90"></label>
      <button id="${k}Centre">Centre it</button>
    </div>
  </div>
</div>`; }

  function mkEditor(k, host, ctx) {
    host.innerHTML = ctlHTML(k);
    const q = id => host.querySelector('#' + k + id);
    const S = () => ctx.S(), P = () => ctx.page();
    const cv = q('Pv'), read = q('Read');
    const changed = () => { paint(); ctx.changed && ctx.changed(); };

    function sync() {
      const s = S();
      if (!s) return;
      q('Tone').querySelectorAll('button').forEach(b => b.classList.toggle('btn-key', b.dataset.v === s.tone));
      q('ThrWrap').hidden = s.tone !== 'mono';
      q('DpiWrap').hidden = q('ToneNote').hidden = s.tone === 'orig';
      q('Thr').value = s.thr; q('ThrV').textContent = s.thr;
      q('Dpi').value = s.dpi;
      q('PRotV').textContent = s.rot + '°';
      ['L','T','R','B'].forEach(e => q('C' + e).value = Math.round(s.crop[e.toLowerCase()] * 100));
      q('WmOn').checked = s.wm.on; q('WmBody').hidden = !s.wm.on;
      q('MText').classList.toggle('btn-key', s.wm.kind === 'text');
      q('MImage').classList.toggle('btn-key', s.wm.kind === 'image');
      q('TextOnly').hidden = s.wm.kind !== 'text';
      q('ImgOnly').hidden = s.wm.kind !== 'image';
      q('Text').value = s.wm.text;
      q('Sz').value = s.wm.size; q('SzV').textContent = s.wm.size + ' pt';
      q('Pct').value = s.wm.pct; q('PctV').textContent = s.wm.pct + '%';
      q('Op').value = Math.round(s.wm.op * 100); q('OpV').textContent = Math.round(s.wm.op * 100) + '%';
      q('WRot').value = s.wm.rot; q('WRotV').textContent = s.wm.rot + '°';
      q('Col').value = s.wm.col; q('Bold').checked = s.wm.bold;
      const st = stamps.get(s.wm.img);
      q('ImgName').textContent = st ? st.name : 'no image yet — png or jpg';
      paint();
    }

    async function paint() {
      const p = P(), s = S();
      if (!p || !s) { cv.width = 260; cv.height = 340; cv.getContext('2d').clearRect(0, 0, 260, 340); return; }
      await composite(p, s, cv, 620, true).catch(() => {});
    }

    q('Tone').querySelectorAll('button').forEach(b => b.onclick = () => { S().tone = b.dataset.v; sync(); ctx.changed && ctx.changed(); });
    q('Thr').oninput = () => { S().thr = +q('Thr').value; q('ThrV').textContent = S().thr; changed(); };
    q('Dpi').onchange = () => { S().dpi = +q('Dpi').value; ctx.changed && ctx.changed(); };
    q('PRotL').onclick = () => { S().rot = (S().rot + 270) % 360; sync(); ctx.changed && ctx.changed(); };
    q('PRotR').onclick = () => { S().rot = (S().rot + 90) % 360; sync(); ctx.changed && ctx.changed(); };
    q('PRot0').onclick = () => { S().rot = 0; sync(); ctx.changed && ctx.changed(); };
    ['L','T','R','B'].forEach(e => q('C' + e).oninput = () => {
      const s = S(), key = e.toLowerCase(), opp = { l:'r', r:'l', t:'b', b:'t' }[key];
      s.crop[key] = Math.min(Math.max(+q('C' + e).value || 0, 0) / 100, 1 - s.crop[opp] - .02);
      q('C' + e).value = Math.round(s.crop[key] * 100);
      changed();
    });
    q('CropR').onclick = () => { S().crop = { l:0, t:0, r:0, b:0 }; sync(); ctx.changed && ctx.changed(); };
    q('WmOn').onchange = () => { S().wm.on = q('WmOn').checked; sync(); ctx.changed && ctx.changed(); };
    q('MText').onclick = () => { S().wm.kind = 'text'; sync(); ctx.changed && ctx.changed(); };
    q('MImage').onclick = () => { S().wm.kind = 'image'; sync(); ctx.changed && ctx.changed(); };
    q('Text').oninput = () => { S().wm.text = q('Text').value; changed(); };
    q('Sz').oninput = () => { S().wm.size = +q('Sz').value; q('SzV').textContent = S().wm.size + ' pt'; changed(); };
    q('Pct').oninput = () => { S().wm.pct = +q('Pct').value; q('PctV').textContent = S().wm.pct + '%'; changed(); };
    q('Op').oninput = () => { S().wm.op = +q('Op').value / 100; q('OpV').textContent = q('Op').value + '%'; changed(); };
    q('WRot').oninput = () => { S().wm.rot = +q('WRot').value; q('WRotV').textContent = S().wm.rot + '°'; changed(); };
    q('Col').oninput = () => { S().wm.col = q('Col').value; changed(); };
    q('Bold').onchange = () => { S().wm.bold = q('Bold').checked; changed(); };
    q('Centre').onclick = () => {
      const c = S().crop;
      S().wm.x = (c.l + 1 - c.r) / 2; S().wm.y = (c.b + 1 - c.t) / 2;
      changed();
    };
    q('ImgFile').onchange = async e => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      if (!/^image\/(png|jpeg)$/.test(f.type)) return say('Stamps must be a PNG or JPG.', true);
      const bytes = new Uint8Array(await f.arrayBuffer());
      const el = new Image(); el.src = mkURL(f);
      try { await el.decode(); } catch { return say("Couldn't read that image.", true); }
      const id = 's' + (uid++);
      stamps.set(id, { bytes, type: f.type, el, ratio: el.naturalHeight / el.naturalWidth, name: f.name });
      S().wm.img = id; S().wm.kind = 'image'; S().wm.on = true;
      sync(); ctx.changed && ctx.changed();
      say('Stamp ready — drag it into place on the preview.');
    };

    /* drag: near a dashed crop edge moves that edge, anywhere else moves the mark */
    let grab = null;
    const at = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, r]; };
    const pd = e => {
      const p = P(), s = S(); if (!p) return;
      const [u, v, r] = at(e), vr = viewRot(p, s), c = cropView(s.crop, vr);
      const tx = 14 / r.width, ty = 14 / r.height;
      let edge = null;
      if (Math.abs(u - c.l) < tx) edge = 'l';
      else if (Math.abs(u - (1 - c.r)) < tx) edge = 'r';
      else if (Math.abs(v - c.t) < ty) edge = 't';
      else if (Math.abs(v - (1 - c.b)) < ty) edge = 'b';
      grab = edge ? { edge } : (s.wm.on ? { wm: 1 } : null);
      if (!grab) return;
      cv.setPointerCapture(e.pointerId); read.classList.add('on');
      move(e);
    };
    const pm = e => grab && move(e);
    const pu = () => { grab = null; read.classList.remove('on'); ctx.changed && ctx.changed(); };
    on(cv, 'pointerdown', pd);
    on(cv, 'pointermove', pm);
    on(cv, 'pointerup', pu);
    function move(e) {
      const p = P(), s = S();
      const [u, v] = at(e), vr = viewRot(p, s);
      if (grab.wm) {
        [s.wm.x, s.wm.y] = toPage(Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v)), vr);
        read.textContent = `x ${Math.round(s.wm.x * 100)}% · y ${Math.round(s.wm.y * 100)}%`;
      } else {
        const c = cropView(s.crop, vr), e2 = grab.edge;
        const raw = e2 === 'l' ? u : e2 === 'r' ? 1 - u : e2 === 't' ? v : 1 - v;
        const opp = c[{ l:'r', r:'l', t:'b', b:'t' }[e2]];
        cropSet(s.crop, vr, e2, Math.min(Math.max(raw, 0), 1 - opp - .02));
        const nc = cropView(s.crop, vr);
        read.textContent = `crop  ${Math.round(nc.l * 100)}/${Math.round(nc.t * 100)}/${Math.round(nc.r * 100)}/${Math.round(nc.b * 100)}`;
        ['L','T','R','B'].forEach(x => q('C' + x).value = Math.round(s.crop[x.toLowerCase()] * 100));
      }
      paint();
    }
    return { sync, paint };
  }

  const gEd = mkEditor('ptk-g', $('#ptk-gCtl'), {
    page: () => pages[gIndex] || null,
    S: () => G,
    changed: () => {}
  });
  const mEd = mkEditor('ptk-m', modal.querySelector('#ptk-mCtl'), {
    page: () => pages[mIdx] || null,
    S: () => (pages[mIdx] || {}).s || null
  });

  /* ---- popup ---- */
  function openPage(idx) {
    mIdx = idx;
    modal.querySelector('#ptk-mTitle').textContent = 'Page ' + (idx + 1) + ' · ' + docs.get(pages[idx].docId).name;
    modal.classList.add('on');
    mEd.sync();
  }
  function shut() { modal.classList.remove('on'); mIdx = -1; draw(); }
  modal.querySelector('#ptk-mDone').onclick = shut;
  modal.querySelector('#ptk-mReset').onclick = () => { pages[mIdx].s = defaults(); mEd.sync(); };
  modal.onclick = e => { if (e.target === modal) shut(); };
  on(document, 'keydown', e => { if (e.key === 'Escape' && mIdx >= 0) shut(); });

  const gNav = d => {
    if (!pages.length) return;
    gIndex = (gIndex + d + pages.length) % pages.length;
    $('#ptk-gLbl').textContent = 'preview: page ' + (gIndex + 1) + ' / ' + pages.length;
    gEd.sync();
  };
  $('#ptk-gPrev').onclick = () => gNav(-1);
  $('#ptk-gNext').onclick = () => gNav(1);
  $('#ptk-selAll').onclick = () => { pages.forEach(p => p.sel = true); draw(); };
  $('#ptk-selNone').onclick = () => { pages.forEach(p => p.sel = false); draw(); };
  $('#ptk-applyAll').onclick = () => { if (!pages.length) return say('Add a PDF first.', true); pages.forEach(p => p.s = clone(G)); draw(); say('Applied to all ' + pages.length + ' pages.'); };
  $('#ptk-applySel').onclick = () => {
    const n = pages.filter(p => p.sel).length;
    if (!n) return say('Select some pages first — tap the number in the corner of a page.', true);
    pages.forEach(p => { if (p.sel) p.s = clone(G); });
    draw(); say('Applied to ' + n + ' pages.');
  };
  $('#ptk-resetAll').onclick = () => { pages.forEach(p => p.s = defaults()); draw(); say('All pages back to as-loaded.'); };

  /* ---- export ---- */
  const hex = h => { const n = parseInt(h.slice(1), 16); return rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };

  async function rasterize(p) {
    const pg = await docs.get(p.docId).js.getPage(p.i + 1);
    const u = pg.getViewport({ scale: 1, rotation: 0 });
    const vp = pg.getViewport({ scale: p.s.dpi / 72, rotation: 0 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: x, viewport: vp }).promise;
    applyTone(x, c.width, c.height, p.s);
    const png = p.s.tone === 'mono';
    const blob = await new Promise(r => c.toBlob(r, png ? 'image/png' : 'image/jpeg', .85));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), png, w: u.width, h: u.height };
  }
  async function drawWm(out, page, wm, mb, cache) {
    const W = mb.width, H = mb.height, th = wm.rot * Math.PI / 180;
    let w, h, img = null, font = null;
    if (wm.kind === 'image') {
      const st = stamps.get(wm.img);
      if (!st) return;
      const ck = 'i' + wm.img;
      cache[ck] = cache[ck] || await (st.type === 'image/png' ? out.embedPng(st.bytes.slice()) : out.embedJpg(st.bytes.slice()));
      img = cache[ck]; w = W * wm.pct / 100; h = w * st.ratio;
    } else {
      if (!wm.text.trim()) return;
      const ck = wm.bold ? 'fb' : 'fr';
      cache[ck] = cache[ck] || await out.embedFont(wm.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
      font = cache[ck]; w = font.widthOfTextAtSize(wm.text, wm.size); h = wm.size * .71;
    }
    const dx = (w / 2) * Math.cos(th) - (h / 2) * Math.sin(th);
    const dy = (w / 2) * Math.sin(th) + (h / 2) * Math.cos(th);
    const x = mb.x + wm.x * W - dx, y = mb.y + wm.y * H - dy;
    if (img) page.drawImage(img, { x, y, width: w, height: h, opacity: wm.op, rotate: degrees(wm.rot) });
    else page.drawText(wm.text, { x, y, size: wm.size, font, color: hex(wm.col), opacity: wm.op, rotate: degrees(wm.rot) });
  }
  async function build(list) {
    const out = await PDFDocument.create(), cache = {}, srcs = new Map();
    for (const p of list) {
      const s = p.s;
      let page;
      if (s.tone === 'orig') {
        if (!srcs.has(p.docId)) srcs.set(p.docId, await PDFDocument.load(docs.get(p.docId).bytes.slice()));
        const [cp] = await out.copyPages(srcs.get(p.docId), [p.i]);
        page = out.addPage(cp);
      } else {
        const r = await rasterize(p);
        page = out.addPage([r.w, r.h]);
        page.drawImage(r.png ? await out.embedPng(r.bytes) : await out.embedJpg(r.bytes), { x: 0, y: 0, width: r.w, height: r.h });
      }
      const mb = page.getMediaBox();
      if (s.wm.on) await drawWm(out, page, s.wm, mb, cache);
      const c = s.crop;
      if (c.l || c.t || c.r || c.b)
        page.setCropBox(mb.x + c.l * mb.width, mb.y + c.b * mb.height, mb.width * (1 - c.l - c.r), mb.height * (1 - c.t - c.b));
      page.setRotation(degrees((p.rot0 + s.rot) % 360));
    }
    return out.save();
  }
  function saveFile(bytes, name) {
    const url = mkURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    after(() => { URL.revokeObjectURL(url); urls.delete(url); }, 4000);
  }
  const stem = () => (docs.size ? [...docs.values()][0].name : 'pdf-toolkit');

  $('#ptk-exAll').onclick = async () => {
    if (!pages.length) return say('Add a PDF first.', true);
    say('Building…'); saveFile(await build(pages), stem() + '-merged.pdf'); say('Saved ' + pages.length + ' pages.');
  };
  $('#ptk-exSel').onclick = async () => {
    const sel = pages.filter(p => p.sel);
    if (!sel.length) return say('Select some pages first.', true);
    say('Building…'); saveFile(await build(sel), stem() + '-extract.pdf'); say('Saved ' + sel.length + ' pages.');
  };
  $('#ptk-exSplit').onclick = async () => {
    if (!pages.length) return say('Add a PDF first.', true);
    const txt = $('#ptk-ranges').value.trim();
    let groups;
    if (!txt) groups = pages.map((p, i) => ({ list: [p], a: i + 1, b: i + 1 }));
    else {
      groups = [];
      for (const part of txt.split(',')) {
        const m = part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
        if (!m) return say('Ranges look like: 1-3, 4, 5-9', true);
        const a = +m[1], b = +(m[2] || m[1]);
        if (a < 1 || b > pages.length || a > b) return say(`Range "${part.trim()}" is outside 1-${pages.length}.`, true);
        groups.push({ list: pages.slice(a - 1, b), a, b });
      }
    }
    const pat = $('#ptk-pattern').value.trim() || '{name}-{n}';
    const pad = String(groups.length).length, used = new Set(), zip = new JSZip();
    say('Splitting into ' + groups.length + ' files…');
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      let name = pat
        .replace(/{name}/gi, stem())
        .replace(/{n}/gi, String(i + 1).padStart(pad, '0'))
        .replace(/{start}/gi, g.a).replace(/{end}/gi, g.b)
        .replace(/{range}/gi, g.a === g.b ? g.a : g.a + '-' + g.b)
        .replace(/{date}/gi, new Date().toISOString().slice(0, 10))
        .replace(/[\\/:*?"<>|]+/g, '_').trim() || 'page';
      while (used.has(name.toLowerCase())) name += '_' + (i + 1);
      used.add(name.toLowerCase());
      zip.file(name + '.pdf', await build(g.list));
    }
    saveFile(await zip.generateAsync({ type: 'blob' }), stem() + '-split.zip');
    say('Saved ' + groups.length + ' files as a ZIP.');
  };

  gEd.sync();

  /* ---- teardown ---- */
  inst.destroy = () => {
    inst.disposed = true;
    disposers.forEach(fn => { try { fn(); } catch {} });
    timers.forEach(id => clearTimeout(id));
    urls.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
    docs.forEach(d => { try { d.js.destroy(); } catch {} });
    baseCache.clear(); stamps.clear(); docs.clear(); pages = [];
    modal.remove();
    root.classList.remove('tool-pdf-toolkit', 'ptk-root');
    root.innerHTML = '';
  };
}

export function unmount() {
  if (active) { active.destroy(); active = null; }
}
