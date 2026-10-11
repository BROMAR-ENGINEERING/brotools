/* Repo path: js/app.js */
/* ============================================================
   BROTOOLS — APP SHELL
   Router + header title + theme toggle.
   To add a tool: add one entry to TOOLS below.
   Each tool lives in js/tools/<id>/ and its entry file exports
   mount(container) and unmount(). Tools load their own CSS and
   assets; set `css` only if a tool needs the hub to load it.
   ============================================================ */

const TOOLS = [
  {
    id: 'pdf-toolkit',
    entry: 'index.js',
    title: 'PDF Toolkit',
    desc: 'Split, combine, rotate, crop and watermark PDFs.',
    icon: '<path d="M14 6h26l12 12v40H14z"/><path d="M40 6v12h12"/><path d="M22 30h20M22 38h20M22 46h12"/>'
  },
  {
    id: 'plan-tracer',
    entry: 'index.js',
    title: 'Plan Tracer',
    desc: 'Draw floor plans and P&ID diagrams.',
    icon: '<path d="M8 8h48v48H8z"/><path d="M8 30h22v26M30 30V8M30 22h26"/><path d="M30 40a10 10 0 0 1 10-10" stroke-dasharray="3 3"/>'
  }
];

const view = document.getElementById('view');
const shell = document.querySelector('.bt-shell');
const titleEl = document.getElementById('pageTitle');

let current = null;      // { module, cssLink }
let navToken = 0;        // ignores stale loads if user clicks quickly

/* ── THEME ── */
document.getElementById('themeToggle').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.getAttribute('data-theme') === 'dark';
  if (dark) root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', 'dark');
  try { localStorage.setItem('brotools-theme', dark ? 'light' : 'dark'); } catch (e) {}
});

/* ── HELPERS ── */
function setTitle(text) {
  titleEl.textContent = text;
  document.title = text === 'BroTools' ? 'BroTools' : `${text} · BroTools`;
}

function unmountCurrent() {
  if (!current) return;
  try { current.module?.unmount?.(); } catch (e) { console.error(e); }
  current.cssLink?.remove();
  current = null;
}

function loadCss(href) {
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve(link);
    link.onerror = () => resolve(link);   // tool may not have CSS yet
    document.head.appendChild(link);
  });
}

/* ── VIEWS ── */
function renderHome() {
  setTitle('BroTools');
  shell.classList.remove('bt-tool-active');
  view.className = 'page-content';
  view.innerHTML = `
    <nav class="bt-tiles" aria-label="Tools">
      ${TOOLS.map((t, i) => `
        <a class="bt-tile" href="#/${t.id}" style="animation-delay:${i * 0.05}s">
          <svg viewBox="0 0 64 64">${t.icon}</svg>
          <h2>${t.title}</h2>
          <p>${t.desc}</p>
        </a>`).join('')}
    </nav>`;
}

function renderStatus(html) {
  view.className = '';
  view.innerHTML = `<div class="bt-status">${html}</div>`;
}

async function renderTool(tool, token) {
  setTitle(tool.title);
  shell.classList.add('bt-tool-active');
  renderStatus('<div class="spinner"></div>');

  const folder = `js/tools/${tool.id}/`;
  const cssLink = tool.css ? await loadCss(folder + tool.css) : null;
  let mod;
  try {
    mod = await import(`./tools/${tool.id}/${tool.entry}`);
  } catch (err) {
    cssLink?.remove();
    if (token !== navToken) return;
    console.error(err);
    renderStatus(`<p>${tool.title} isn't installed yet.</p>
      <p>Add <code>${folder}${tool.entry}</code> to the repo.</p>`);
    return;
  }
  if (token !== navToken) { cssLink?.remove(); return; }

  view.className = '';
  view.innerHTML = '';
  const container = document.createElement('div');
  container.className = `bt-tool tool-${tool.id}`;
  view.appendChild(container);

  current = { module: mod, cssLink };
  try {
    await mod.mount(container);
  } catch (err) {
    console.error(err);
    renderStatus(`<p>${tool.title} failed to start.</p><p>Check the browser console for details.</p>`);
  }
}

/* ── ROUTER ── */
function route() {
  const token = ++navToken;
  unmountCurrent();
  window.scrollTo(0, 0);

  const id = location.hash.replace(/^#\/?/, '');
  const tool = TOOLS.find(t => t.id === id);
  if (tool) renderTool(tool, token);
  else renderHome();
}

window.addEventListener('hashchange', route);
route();
