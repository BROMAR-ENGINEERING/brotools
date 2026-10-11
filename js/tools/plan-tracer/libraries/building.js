/* brotools/js/tools/plan-tracer/libraries/building.js */
/* =========================================================================
   Plan Tracer symbol library: Building
   -------------------------------------------------------------------------
   Doors, windows, stairs, columns and site furniture.

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
  id: 'building',
  name: 'Building',
  symbols: {
    door:      {name:'Door', cut:16,
                svg:`<path d="M-8 0v-15"/><path d="M-8-15A15 15 0 0 1 7 0" stroke-dasharray="2.5 2.5"/><path d="M-11 0h3M8 0h3"/>`},
    doorD:     {name:'Double door', cut:24, symmetric:true,
                svg:`<path d="M-12 0v-11M12 0v-11"/><path d="M-12-11A11 11 0 0 1 -1 0" stroke-dasharray="2.5 2.5"/><path d="M12-11A11 11 0 0 0 1 0" stroke-dasharray="2.5 2.5"/>`},
    window:    {name:'Window', cut:26, symmetric:true,
                svg:`<path d="M-13-3H13M-13 3H13M-13-3v6M13-3v6"/>`},
    opening:   {name:'Opening', cut:20, symmetric:true, svg:`<path d="M-10-4v8M10-4v8"/>`},
    compass:   {name:'Compass', symmetric:true,
                svg:`<circle cx="0" cy="0" r="15"/><path d="M0-15 4-4 15 0 4 4 0 15-4 4-15 0-4-4z" fill="currentColor" fill-opacity=".12"/><path d="M0-15 4-4 0 0-4-4z" fill="currentColor" fill-opacity=".55"/><circle cx="0" cy="0" r="1.6" fill="currentColor"/>`},
    stairs:    {name:'Stairs',      svg:`<rect x="-12" y="-12" width="24" height="24"/><path d="M-12-6h24M-12 0h24M-12 6h24"/><path d="M0-12v24M-3 8l3 4 3-4"/>`},
    column:    {name:'Column',      svg:`<rect x="-7" y="-7" width="14" height="14" fill="currentColor" fill-opacity=".25"/>`},
    north:     {name:'North',       svg:`<path d="M0-14 6 6 0 1-6 6z" fill="currentColor" fill-opacity=".2"/><text x="0" y="16" font-size="10" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif">N</text>`},
    camera:    {name:'Camera',      svg:`<rect x="-10" y="-5" width="14" height="9"/><path d="M4-2 11-6v9L4 2z" fill="currentColor" fill-opacity=".2"/><path d="M-6 4v6"/>`},
    extinguish:{name:'Extinguisher',svg:`<rect x="-5" y="-6" width="10" height="18" rx="2" fill="currentColor" fill-opacity=".2"/><path d="M-2-6v-4h4v4M2-9h5"/>`},
    dim:       {name:'Dimension',   svg:`<path d="M-14 0H14M-14-5v10M14-5v10"/><path d="M-10-3 -14 0l4 3M10-3l4 3-4 3" fill="none"/>`}
  }
});
