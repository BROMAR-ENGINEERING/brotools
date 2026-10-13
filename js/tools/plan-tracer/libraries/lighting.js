/* brotools/js/tools/plan-tracer/libraries/lighting.js */
/* =========================================================================
   Plan Tracer symbol library: Lighting
   -------------------------------------------------------------------------
   Downlights, battens, emergency & exit fittings, switches and sensors.

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
  id: 'lighting',
  name: 'Lighting',
  symbols: {
    downlight:  {name:'Downlight',   svg:`<circle cx="0" cy="0" r="10"/><path d="M-7-7 7 7M-7 7 7-7"/>`},
    pendant:    {name:'Pendant',     svg:`<path d="M0-14V-6"/><path d="M-8 4a8 8 0 0 1 16 0z" fill="currentColor" fill-opacity=".15"/><path d="M-9 4H9"/>`},
    fluoro:     {name:'Fluorescent', svg:`<rect x="-15" y="-5" width="30" height="10"/><path d="M-15 0H15"/>`},
    twin:       {name:'Twin batten', svg:`<rect x="-15" y="-6" width="30" height="12"/><path d="M-15-2H15M-15 2H15"/>`},
    wall:       {name:'Wall light',  svg:`<path d="M-12 8H12"/><path d="M-7 8a7 7 0 0 1 14 0" fill="currentColor" fill-opacity=".15"/>`},
    track:      {name:'Track / spot',svg:`<path d="M-14-8H14"/><circle cx="-7" cy="0" r="4"/><circle cx="7" cy="0" r="4"/><path d="M-7-8v4M7-8v4"/>`},
    emergency:  {name:'Emergency',   svg:`<circle cx="0" cy="0" r="10"/><path d="M-4-5h8M0-5v10M-4 5h8" stroke-width="2"/>`},
    emgTwin:    {name:'Emergency twin spot', svg:`<rect x="-12" y="2" width="24" height="7" rx="1"/><circle cx="-6" cy="-4" r="4"/><circle cx="6" cy="-4" r="4"/><path d="M-6 0v2M6 0v2"/>`},
    exitsign:   {name:'Exit sign',   svg:`<rect x="-14" y="-7" width="28" height="14"/><path d="M-8-2h6M-8 2h6M-8-2v4"/><path d="M2 0h9M7-4l4 4-4 4"/>`},
    exitR:      {name:'Exit → (right)', svg:`<rect x="-14" y="-8" width="28" height="16" rx="1.5"/><path d="M-9 0H6"/><path d="M3-5l5 5-5 5"/>`},
    exitL:      {name:'Exit ← (left)',  svg:`<rect x="-14" y="-8" width="28" height="16" rx="1.5"/><path d="M9 0H-6"/><path d="M-3-5l-5 5 5 5"/>`},
    exitU:      {name:'Exit ↑ (up)',    svg:`<rect x="-14" y="-8" width="28" height="16" rx="1.5"/><path d="M0 8V-5"/><path d="M-5-2l5-5 5 5"/>`},
    exitD:      {name:'Exit ↓ (down)',  svg:`<rect x="-14" y="-8" width="28" height="16" rx="1.5"/><path d="M0-8V5"/><path d="M-5 2l5 5 5-5"/>`},
    floodlight: {name:'Floodlight',  svg:`<rect x="-12" y="-6" width="10" height="12"/><path d="M-2-6 14-12M-2 0H14M-2 6 14 12"/>`},
    swtch:      {name:'Switch',      svg:`<circle cx="-6" cy="6" r="3" fill="currentColor"/><path d="M-4 4 8-8"/><path d="M8-8v6M8-8h-6"/>`},
    socket:     {name:'Socket',      svg:`<path d="M-9 6a9 9 0 0 1 18 0z" fill="currentColor" fill-opacity=".15"/><path d="M-11 6H11M0 6v-14M-5-8h10"/>`},
    sensor:     {name:'PIR sensor',  svg:`<circle cx="0" cy="0" r="6"/><path d="M-11-11a15.5 15.5 0 0 1 22 0M-7-7a10 10 0 0 1 14 0"/>`}
  }
});
