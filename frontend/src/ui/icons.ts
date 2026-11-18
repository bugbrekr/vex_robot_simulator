// Simple inline SVG icons (stroke = currentColor). Original drawings, VEXcode-like in spirit.
const svg = (body: string, vb = "0 0 24 24") =>
  `<svg viewBox="${vb}" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  run: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>'),
  step: svg('<path d="M5 4.5v15l10-7.5z" fill="currentColor" stroke="none"/><rect x="16.5" y="4.5" width="3" height="15" fill="currentColor" stroke="none"/>'),
  stop: svg('<rect x="5" y="5" width="14" height="14" rx="1.5" fill="currentColor" stroke="none"/>'),
  share: svg('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  feedback: svg('<path d="M4 5h16v11H9l-5 4z"/><circle cx="9" cy="10.5" r=".6" fill="currentColor"/><circle cx="12" cy="10.5" r=".6" fill="currentColor"/><circle cx="15" cy="10.5" r=".6" fill="currentColor"/>'),
  arm: svg('<path d="M5 20h10"/><path d="M7 20v-3h6v3"/><path d="M10 17l-3-8 8-4"/><circle cx="7" cy="9" r="1.6"/><circle cx="15" cy="5" r="1.6"/><path d="M16.5 6l2 2.5-1.5 1.5"/>'),
  code: svg('<path d="M9 7l-5 5 5 5"/><path d="M15 7l5 5-5 5"/>'),
  monitor: svg('<path d="M4 17a8 8 0 0 1 16 0z"/><path d="M12 17l3.5-5"/><path d="M7 13l-1-1M12 10.5V9M17 13l1-1"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5V14"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>'),
  map: svg('<path d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2z"/><path d="M9 4v14M15 6v14"/>'),
  chevronRight: svg('<path d="M9 5l7 7-7 7"/>'),
  chevronLeft: svg('<path d="M15 5l-7 7 7 7"/>'),
  caret: svg('<path d="M6 9l6 6 6-6"/>'),
  erase: svg('<path d="M4 16l8-8 6 6-5 5H8z"/><path d="M14 20h6"/>'),
  reset: svg('<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4h4"/>'),
  camera3d: svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>'),
  cameraTop: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/>'),
  cameraSide: svg('<path d="M3 19h18"/><path d="M7 19v-6h4V8l5-3"/>'),
  trash: svg('<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  sliders: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  pause: svg('<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>'),
  hand: svg('<path d="M8 13V6a1.5 1.5 0 0 1 3 0v5M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6 7-2.5 0-4-1.5-5.5-4L4 13a1.5 1.5 0 0 1 2.5-1.6L8 13"/>'),
};
