/* brotools/js/tools/plan-tracer/libraries/pid.js */
/* =========================================================================
   Plan Tracer symbol library: P&ID
   -------------------------------------------------------------------------
   Process instruments, valves, vessels and inline fittings.

   HOW LIBRARIES WORK
   Each file registers itself by calling PlanTracer.registerLibrary(...).
   The app discovers files listed in libraries/manifest.json at startup, so
   adding a new library is: drop a .js file in this folder, add its name to
   the manifest. No change to the core HTML.

   Every symbol is drawn in a 32x32 box centred on 0,0 (coords run -16..16),
   strokes only, using currentColor so the app can colour it. Optional flags:
     cut:<n>      an opening width; the symbol hosts on a wall and gaps it
     symmetric:true   only offer Flip, not Mirror
     inner:true   draw the name inside the symbol (instrument bubbles)
   ========================================================================= */
PlanTracer.registerLibrary({
  id: 'pid',
  name: 'P&ID',
  symbols: {
    instField:  {name:'FT-000', inner:true, symmetric:true,
                 svg:`<circle cx="0" cy="0" r="14"/>`},
    instPanel:  {name:'FIC-000', inner:true, symmetric:true,
                 svg:`<circle cx="0" cy="0" r="14"/><path d="M-14 0H14"/>`},
    instRear:   {name:'FI-000', inner:true, symmetric:true,
                 svg:`<circle cx="0" cy="0" r="14"/><path d="M-14 0H14" stroke-dasharray="3 2.5"/>`},
    instDcs:    {name:'FIC-000', inner:true, symmetric:true,
                 svg:`<rect x="-15" y="-11" width="30" height="22"/><circle cx="0" cy="0" r="11"/>`},
    instPlc:    {name:'UC-000', inner:true, symmetric:true,
                 svg:`<path d="M-15 0 0-11 15 0 0 11z"/>`},
    instShared: {name:'FY-000', inner:true, symmetric:true,
                 svg:`<path d="M-8-13h16l7 13-7 13h-16l-7-13z"/>`},
    vGate:      {name:'Gate valve', symmetric:true,
                 svg:`<path d="M-13-8 0 0-13 8zM13-8 0 0 13 8z" fill="currentColor" fill-opacity=".15"/><path d="M0 0v-10M-6-10h12"/>`},
    vGlobe:     {name:'Globe valve', symmetric:true,
                 svg:`<path d="M-13-8 0 0-13 8zM13-8 0 0 13 8z" fill="currentColor" fill-opacity=".15"/><circle cx="0" cy="0" r="4.5" fill="currentColor" fill-opacity=".5"/><path d="M0-4v-6M-6-10h12"/>`},
    vBall:      {name:'Ball valve', symmetric:true,
                 svg:`<path d="M-13-8 0 0-13 8zM13-8 0 0 13 8z" fill="currentColor" fill-opacity=".15"/><circle cx="0" cy="0" r="4.5"/><path d="M0-4v-6M-6-10h12"/>`},
    vCheck:     {name:'Check valve',
                 svg:`<path d="M-13-8 0 0-13 8z" fill="currentColor" fill-opacity=".15"/><path d="M13-9v18"/>`},
    vButterfly: {name:'Butterfly valve', symmetric:true,
                 svg:`<path d="M-13-8 0 0-13 8zM13-8 0 0 13 8z" fill="currentColor" fill-opacity=".15"/><path d="M-5 6 5-6"/><path d="M0 0v-10M-6-10h12"/>`},
    vControl:   {name:'Control valve', symmetric:true,
                 svg:`<path d="M-13 0 0-8-13 8zM13 0 0-8 13 8z" fill="currentColor" fill-opacity=".15" transform="translate(0 4)"/><path d="M0 4v-6"/><path d="M-8-13a8 8 0 0 1 16 0z" fill="currentColor" fill-opacity=".2"/><path d="M-8-13h16"/>`},
    vRelief:    {name:'Relief valve',
                 svg:`<path d="M-11 12 0 4-11-4z" fill="currentColor" fill-opacity=".15"/><path d="M0 4v-8M-5-4h10M-5-4l10-8"/>`},
    pumpC:      {name:'Pump', symmetric:true,
                 svg:`<circle cx="0" cy="2" r="11"/><path d="M-11 2h-3v-9h14" /><path d="M-4-4 7 2-4 8z" fill="currentColor" fill-opacity=".2"/>`},
    motorM:     {name:'Motor (M)', symmetric:true,
                 svg:`<circle cx="0" cy="0" r="12"/><path d="M-5 5V-5L0 1 5-5V5"/>`},
    isolator:   {name:'Isolator', symmetric:true,
                 svg:`<rect x="-11" y="-11" width="22" height="22"/><path d="M-15 0h4M11 0h4"/><circle cx="-7" cy="0" r="1.6" fill="currentColor"/><circle cx="7" cy="0" r="1.6"/><path d="M-7 0 6-7"/>`},
    vessel:     {name:'Vessel', symmetric:true,
                 svg:`<path d="M-10-9v18a10 6 0 0 0 20 0v-18a10 6 0 0 0-20 0" /><path d="M-10-9a10 6 0 0 0 20 0"/>`},
    column:     {name:'Column', symmetric:true,
                 svg:`<path d="M-8-12v24a8 4 0 0 0 16 0v-24a8 4 0 0 0-16 0"/><path d="M-8-3h16M-8 4h16"/>`},
    exchanger:  {name:'Exchanger', symmetric:true,
                 svg:`<circle cx="0" cy="0" r="13"/><path d="M-13 0-6-7 6 7 13 0"/>`},
    orifice:    {name:'Orifice plate', symmetric:true,
                 svg:`<path d="M-13 0h9M4 0h9"/><path d="M-4-11v22M4-11v22"/>`},
    rotameter:  {name:'Rotameter', symmetric:true,
                 svg:`<path d="M0-13v26"/><path d="M-6-11 6-4v8l-12 7z" fill="currentColor" fill-opacity=".15"/>`},
    reducer:    {name:'Reducer',
                 svg:`<path d="M-11-9 2-4v8l-13 5z" fill="currentColor" fill-opacity=".15"/><path d="M2-4h11M2 4h11"/>`},
    filterP:    {name:'Filter', symmetric:true,
                 svg:`<rect x="-8" y="-11" width="16" height="22"/><path d="M-8-4h16M-8 4h16" stroke-dasharray="2 2"/><path d="M-13 0h5M8 0h5"/>`}
  }
});
