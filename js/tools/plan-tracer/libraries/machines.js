/* brotools/js/tools/plan-tracer/libraries/machines.js */
/* =========================================================================
   Plan Tracer symbol library: Machines
   -------------------------------------------------------------------------
   Pumps, motors, tanks, conveyors and general plant.

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
  id: 'machines',
  name: 'Machines',
  symbols: {
    pump:    {name:'Pump',      svg:`<circle cx="0" cy="0" r="11"/><path d="M-4-6 7 0-4 6z" fill="currentColor" fill-opacity=".2"/>`},
    motor:   {name:'Motor',     svg:`<circle cx="0" cy="0" r="11"/><path d="M-5 5v-10l5 6 5-6v10" stroke-width="1.8"/>`},
    tank:    {name:'Tank',      svg:`<rect x="-9" y="-13" width="18" height="26" rx="5"/><path d="M-9 5h18"/>`},
    valve:   {name:'Valve',     svg:`<path d="M-10-7 0 0-10 7zM10-7 0 0 10 7z" fill="currentColor" fill-opacity=".2"/><path d="M0 0v-9M-5-9h10"/>`},
    conveyor:{name:'Conveyor',  svg:`<rect x="-15" y="-6" width="30" height="12" rx="6"/><circle cx="-9" cy="0" r="2.5"/><circle cx="0" cy="0" r="2.5"/><circle cx="9" cy="0" r="2.5"/>`},
    fan:     {name:'Fan',       svg:`<circle cx="0" cy="0" r="11"/><path d="M0 0c0-8 10-8 0-9M0 0c7 4 2 12-1 3M0 0c-7 4-11-4-1-3" fill="currentColor" fill-opacity=".2"/>`},
    press:   {name:'Press',     svg:`<rect x="-12" y="-13" width="24" height="6"/><rect x="-12" y="7" width="24" height="6"/><path d="M0-7v9M-5 2h10"/>`},
    panel:   {name:'Elec panel',svg:`<rect x="-9" y="-12" width="18" height="24"/><path d="M-9-4h18"/><path d="M2-9 -3-1h5l-4 8" stroke-width="1.6"/>`},
    robot:   {name:'Robot arm', svg:`<rect x="-13" y="9" width="12" height="5"/><path d="M-7 9V-2l10-8" stroke-width="1.8"/><circle cx="-7" cy="-2" r="2.5"/><path d="M3-10l6 2"/>`},
    machine: {name:'Machine',   svg:`<rect x="-14" y="-9" width="28" height="18"/><path d="M-14-3h28"/><circle cx="-7" cy="3" r="2"/><circle cx="0" cy="3" r="2"/><circle cx="7" cy="3" r="2"/>`}
  }
});
