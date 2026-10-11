/* js/tools/pdf-toolkit/pdf-toolkit.css
   PDF Toolkit — BroTools module styles. Injected by index.js on first mount.
   Every selector is scoped under .tool-pdf-toolkit so nothing leaks into the
   hub. Colours derive from shared.css tokens (--bg-main, --accent, --text …)
   with fallbacks, so the tool follows the hub's light/dark mode.               */

.tool-pdf-toolkit{
  --pt-accent:    var(--accent, #c8102e);
  --pt-on-accent: var(--accent-contrast, #ffffff);
  --pt-danger:    var(--danger, #e4572e);
  --pt-bg:        var(--bg-main, #f4f3f0);
  --pt-text:      var(--text, #1b2127);
  --pt-page:      #ffffff;               /* a PDF page is always white paper */

  --pt-surface: color-mix(in srgb, var(--pt-bg) 92%, var(--pt-text));
  --pt-panel:   color-mix(in srgb, var(--pt-bg) 96%, var(--pt-text));
  --pt-border:  color-mix(in srgb, var(--pt-text) 20%, transparent);
  --pt-muted:   color-mix(in srgb, var(--pt-text) 55%, var(--pt-bg));

  --pt-mono: ui-monospace, "Space Mono", "SFMono-Regular", Menlo, Consolas, monospace;

  color: var(--pt-text);
  font-size: 14px;
}
@media (prefers-color-scheme: dark){
  .tool-pdf-toolkit{ --pt-bg: var(--bg-main, #1b2128); --pt-text: var(--text, #e8ebee); }
}

.tool-pdf-toolkit, .tool-pdf-toolkit *, .tool-pdf-toolkit *::before, .tool-pdf-toolkit *::after{ box-sizing: border-box; }
.tool-pdf-toolkit h2, .tool-pdf-toolkit h3, .tool-pdf-toolkit p{ margin: 0; }
.tool-pdf-toolkit [hidden]{ display: none !important; }

/* the hub gives this container a fixed height below the header; we scroll inside it */
.ptk-root{ height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }

.tool-pdf-toolkit .mono{ font-family: var(--pt-mono); }
.tool-pdf-toolkit .eyebrow{
  font-family: var(--pt-mono); font-size: 10px; letter-spacing: .16em;
  text-transform: uppercase; color: var(--pt-muted);
}
.tool-pdf-toolkit .eyebrow b{ color: var(--pt-text); font-weight: 400; }

.tool-pdf-toolkit button,
.tool-pdf-toolkit .btn,
.tool-pdf-toolkit select{
  font-family: var(--pt-mono); font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
  background: var(--pt-surface); color: var(--pt-text); border: 1px solid var(--pt-border);
  padding: 9px 12px; border-radius: 3px; cursor: pointer;
}
.tool-pdf-toolkit button:hover,
.tool-pdf-toolkit .btn:hover{ border-color: var(--pt-accent); color: var(--pt-accent); }
.tool-pdf-toolkit .btn-key{ background: var(--pt-accent); color: var(--pt-on-accent); border-color: var(--pt-accent); font-weight: 700; }
.tool-pdf-toolkit .btn-key:hover{ filter: brightness(1.08); color: var(--pt-on-accent); border-color: var(--pt-accent); }
.tool-pdf-toolkit .btn-danger:hover{ border-color: var(--pt-danger); color: var(--pt-danger); }
.tool-pdf-toolkit :focus-visible{ outline: 2px solid var(--pt-accent); outline-offset: 2px; }

/* tool toolbar — pinned; the hub owns the page header above this */
.tool-pdf-toolkit .ptk-bar{
  flex: none; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 12px 18px; border-bottom: 1px solid var(--pt-border); background: var(--pt-panel);
}
.tool-pdf-toolkit .ptk-spacer{ flex: 1; }

/* everything below the toolbar scrolls together */
.tool-pdf-toolkit .ptk-main{
  flex: 1; min-height: 0; overflow-y: auto;
  display: grid; grid-template-columns: 1fr 380px; align-items: start;
}

.tool-pdf-toolkit .ptk-bench{ padding: 22px; position: relative; }
.tool-pdf-toolkit .corner{ position: absolute; width: 14px; height: 14px; opacity: .4; stroke: var(--pt-muted); }
.tool-pdf-toolkit .corner.tl{ top: 8px; left: 8px; } .tool-pdf-toolkit .corner.tr{ top: 8px; right: 8px; }
.tool-pdf-toolkit .corner.bl{ bottom: 8px; left: 8px; } .tool-pdf-toolkit .corner.br{ bottom: 8px; right: 8px; }

.tool-pdf-toolkit .ptk-drop{
  border: 1px dashed var(--pt-border); border-radius: 4px; padding: 56px 20px;
  text-align: center; color: var(--pt-muted);
}
.tool-pdf-toolkit .ptk-drop.hot{ border-color: var(--pt-accent); color: var(--pt-accent); }
.tool-pdf-toolkit .ptk-drop h2{ font-size: 26px; font-weight: 800; letter-spacing: -.02em; color: var(--pt-text); margin-bottom: 8px; }

/* align-items:start — otherwise cards stretch to row height and a landscape page
   renders correctly but sits inside a tall portrait box */
.tool-pdf-toolkit .ptk-grid{ display: grid; grid-template-columns: repeat(auto-fill, minmax(136px, 1fr)); gap: 16px; align-items: start; }
.tool-pdf-toolkit .card{
  position: relative; background: var(--pt-page); border-radius: 3px; overflow: hidden; cursor: pointer;
  box-shadow: 0 6px 14px rgba(0,0,0,.28); border: 2px solid transparent; transition: transform .12s; line-height: 0;
}
.tool-pdf-toolkit .card:hover{ transform: translateY(-2px); }
.tool-pdf-toolkit .card canvas{ display: block; width: 100%; height: auto; background: #fff; }
.tool-pdf-toolkit .card.sel{ border-color: var(--pt-accent); }

/* chips sit over the white page thumbnail, so they keep a fixed dark wash */
.tool-pdf-toolkit .pick{
  position: absolute; left: 0; top: 0; padding: 0; width: 26px; height: 22px; border: none;
  border-radius: 0 0 3px 0; background: rgba(16,20,24,.85); color: #fff; font-size: 10px; letter-spacing: 0; line-height: 22px;
}
.tool-pdf-toolkit .pick:hover{ background: var(--pt-accent); color: var(--pt-on-accent); }
.tool-pdf-toolkit .card.sel .pick{ background: var(--pt-accent); color: var(--pt-on-accent); font-weight: 700; }
.tool-pdf-toolkit .tags{
  position: absolute; left: 0; bottom: 0; right: 0; display: flex; gap: 4px; padding: 4px;
  background: rgba(16,20,24,.78); font-family: var(--pt-mono); font-size: 8px; line-height: 1.5; letter-spacing: .06em; align-items: center;
}
.tool-pdf-toolkit .tags .name{ color: #cbd3dc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
.tool-pdf-toolkit .tag{ background: var(--pt-accent); color: var(--pt-on-accent); padding: 1px 3px; border-radius: 2px; flex: none; }
.tool-pdf-toolkit .kill, .tool-pdf-toolkit .rot{
  position: absolute; top: 4px; padding: 0; width: 20px; height: 20px; line-height: 1; border-radius: 50%;
  background: rgba(16,20,24,.85); border: none; color: #fff; font-size: 12px; opacity: 0;
}
.tool-pdf-toolkit .kill{ right: 4px; } .tool-pdf-toolkit .rot{ right: 28px; font-size: 13px; }
.tool-pdf-toolkit .card:hover .kill, .tool-pdf-toolkit .card:hover .rot{ opacity: 1; }
.tool-pdf-toolkit .kill:hover{ background: var(--pt-danger); color: #fff; }
.tool-pdf-toolkit .rot:hover{ background: var(--pt-accent); color: var(--pt-on-accent); }
.tool-pdf-toolkit .card.drag{ opacity: .35; }
.tool-pdf-toolkit .card.over{ border-color: var(--pt-accent); border-style: dashed; }

/* right rail — sticks to the top of the scroll area */
.tool-pdf-toolkit .ptk-rail{
  border-left: 1px solid var(--pt-border); background: var(--pt-panel);
  position: sticky; top: 0; align-self: start; max-height: 100%; overflow-y: auto;
}
.tool-pdf-toolkit .pane{ border-bottom: 1px solid var(--pt-border); padding: 18px; }
.tool-pdf-toolkit .pane h3{ font-size: 15px; font-weight: 800; margin-bottom: 2px; letter-spacing: -.01em; }
.tool-pdf-toolkit p.hint{ color: var(--pt-muted); font-size: 12px; margin: 6px 0 14px; line-height: 1.45; }
.tool-pdf-toolkit .row{ display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.tool-pdf-toolkit .row > *{ flex: 1; }
.tool-pdf-toolkit .sect{ border-top: 1px solid var(--pt-border); padding-top: 14px; margin-top: 14px; }
.tool-pdf-toolkit .sect:first-child{ border-top: none; padding-top: 0; margin-top: 0; }
.tool-pdf-toolkit .sect > .eyebrow{ display: flex; justify-content: space-between; margin-bottom: 9px; }
.tool-pdf-toolkit label.f{ display: block; margin-bottom: 12px; }
.tool-pdf-toolkit label.f .eyebrow{ display: flex; justify-content: space-between; margin-bottom: 5px; }

.tool-pdf-toolkit input[type=text],
.tool-pdf-toolkit input[type=number],
.tool-pdf-toolkit select{
  width: 100%; background: var(--pt-bg); border: 1px solid var(--pt-border); color: var(--pt-text);
  padding: 8px; border-radius: 3px; font-family: var(--pt-mono); font-size: 12px; text-transform: none; letter-spacing: 0;
}
.tool-pdf-toolkit input[type=range]{ width: 100%; accent-color: var(--pt-accent); }
.tool-pdf-toolkit input[type=color]{
  width: 100%; height: 32px; background: var(--pt-bg); border: 1px solid var(--pt-border); border-radius: 3px; padding: 2px; cursor: pointer;
}
.tool-pdf-toolkit .toggle{
  display: flex; align-items: center; gap: 7px; font-family: var(--pt-mono); font-size: 11px;
  text-transform: uppercase; letter-spacing: .08em; color: var(--pt-muted); cursor: pointer; flex: none;
}
.tool-pdf-toolkit .toggle input{ accent-color: var(--pt-accent); }
.tool-pdf-toolkit .seg{ display: flex; gap: 0; }
.tool-pdf-toolkit .seg button{ flex: 1; border-radius: 0; border-right: none; padding: 8px 4px; }
.tool-pdf-toolkit .seg button:first-child{ border-radius: 3px 0 0 3px; }
.tool-pdf-toolkit .seg button:last-child{ border-radius: 0 3px 3px 0; border-right: 1px solid var(--pt-border); }

/* editor (shared by the rail and the per-page popup) */
.tool-pdf-toolkit .ed .stage{
  position: relative; background: var(--pt-bg); border: 1px solid var(--pt-border); border-radius: 3px;
  padding: 10px; display: flex; justify-content: center; margin-bottom: 12px;
}
.tool-pdf-toolkit .ed canvas{ max-width: 100%; max-height: 64vh; cursor: crosshair; box-shadow: 0 4px 12px rgba(0,0,0,.3); touch-action: none; }
.tool-pdf-toolkit .ed .read{
  position: absolute; right: 12px; top: 12px; background: var(--pt-panel); color: var(--pt-accent);
  border: 1px solid var(--pt-border); font-family: var(--pt-mono); font-size: 10px; padding: 3px 6px;
  border-radius: 3px; opacity: 0; transition: opacity .15s; pointer-events: none;
}
.tool-pdf-toolkit .ed .read.on{ opacity: 1; }
.tool-pdf-toolkit .ed.wide{ display: grid; grid-template-columns: 1fr 320px; gap: 20px; align-items: start; }
.tool-pdf-toolkit .ed.wide .ctls{ max-height: 74vh; overflow-y: auto; padding-right: 4px; }

.tool-pdf-toolkit .ptk-status{ padding: 12px 18px; color: var(--pt-muted); font-family: var(--pt-mono); font-size: 11px; line-height: 1.5; }
.tool-pdf-toolkit .ptk-status.err{ color: var(--pt-danger); }
.tool-pdf-toolkit .ptk-boot{ padding: 40px; color: var(--pt-muted); font-family: var(--pt-mono); font-size: 12px; }

/* per-page popup — lives on <body>, carries the class so tokens + scope apply */
.ptk-modal-root{
  position: fixed; inset: 0; z-index: 2147483000; padding: 20px; overflow: auto;
  background: rgba(8,11,14,.8); display: none;
}
.ptk-modal-root.on{ display: flex; align-items: flex-start; justify-content: center; }
.ptk-modal-root .sheet{ background: var(--pt-panel); border: 1px solid var(--pt-border); border-radius: 4px; width: min(900px, 100%); }
.ptk-modal-root .sheet .top{ display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--pt-border); }
.ptk-modal-root .sheet .top h3{ font-size: 15px; font-weight: 800; flex: 1; }
.ptk-modal-root .sheet .pad{ padding: 18px; }

@media (max-width: 900px){
  .tool-pdf-toolkit .ptk-main{ grid-template-columns: 1fr; }
  .tool-pdf-toolkit .ptk-rail{ position: static; max-height: none; border-left: none; border-top: 1px solid var(--pt-border); }
  .tool-pdf-toolkit .ed.wide{ display: block; }
}
