// A small set of inline SVG icons (stroke-based, single colour via
// currentColor) used across the site instead of emoji, so the UI reads
// as a proper product rather than a chat message. Import the ones you
// need: `import { icon } from '/js/utils/icons.js'`.

const paths = {
  building: '<path d="M4 21V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v16"/><path d="M14 21V9a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v12"/><path d="M9 7h.01M9 11h.01M9 15h.01M18 12h.01M18 16h.01"/>',
  door: '<rect x="6" y="3" width="12" height="18" rx="1"/><path d="M14 12h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  hospital: '<rect x="3" y="8" width="18" height="13" rx="1.2"/><path d="M9 21V8"/><path d="M12 12v4M10 14h4"/><path d="M9 8V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3"/>',
  ambulance: '<path d="M3 17V9a1 1 0 0 1 1-1h9v9"/><path d="M13 12h4l3 3v2h-2"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/><path d="M7 6v3M5.5 7.5h3"/>',
  phone: '<path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1L6.6 10.8Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  note: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  lock: '<rect x="4" y="10" width="16" height="10" rx="1.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="m3.5 6 8.5 6.5L20.5 6"/>',
  shield: '<path d="M12 3l7 3v6c0 4.6-3 8-7 9-4-1-7-4.4-7-9V6l7-3Z"/>',
  chevronLeft: '<path d="m14.5 5-7 7 7 7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  logout: '<path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3"/><path d="M10 12H3m0 0 3.5-3.5M3 12l3.5 3.5"/>'
};

// Returns a ready-to-insert SVG string. size in px, defaults to 18.
function icon(name, size) {
  const s = size || 18;
  const body = paths[name] || paths.note;
  return `<svg class="icon" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export { icon };
