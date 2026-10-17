// Map geometry: turn N metric windows into a grid that always fits one card.
//
// Why this exists: the map used to be one column per window with a hard 10px
// floor, so a long recording produced a bitmap tens of thousands of pixels wide
// (7.5 h at 5 s windows = 5402 columns = 54,064 px before devicePixelRatio).
// Chrome refuses to allocate a canvas past its max dimension (32,767 px on many
// desktops, 65,535 elsewhere) and paints a "sad face" placeholder instead.
//
// So the grid gets a fixed pixel budget: when there are more windows than fit,
// consecutive windows are aggregated into one column (S.step windows per column).
// Pure and dependency-free so it can be unit-tested in Node.

export const GUT = 44;   // left gutter for channel labels, CSS px
export const TOP = 20;   // top strip for time labels, CSS px
export const ROW = 30;   // row height per channel, CSS px
export const MAP_W = 900; // pixel budget for the grid itself, CSS px
export const CELL_MIN = 6;
export const CELL_MAX = 15;
export const MAX_PX = 16000; // conservative safe canvas side (all browsers)

export function mapLayout(nWindows, nChannels, dpr = 1) {
  const n = Math.max(0, Math.floor(nWindows) || 0);
  const ch = Math.max(1, Math.floor(nChannels) || 1);

  // How many columns can we afford at the minimum legible width?
  const maxCols = Math.max(1, Math.floor(MAP_W / CELL_MIN));
  const step = Math.max(1, Math.ceil(n / maxCols)); // windows per column
  const cols = Math.ceil(n / step);                 // columns actually drawn
  const cw = Math.max(CELL_MIN, Math.min(CELL_MAX, Math.floor(MAP_W / Math.max(cols, 1)) || CELL_MIN));

  const cssW = GUT + cols * cw;
  const cssH = TOP + ch * ROW;

  // Belt-and-braces: never hand the browser a bitmap past its limit, even if
  // the CSS layout would suggest one (e.g. 100s of channels on a HiDPI screen).
  const scale = Math.min(dpr, MAX_PX / Math.max(cssW, cssH, 1));
  const pxW = Math.max(1, Math.round(cssW * scale));
  const pxH = Math.max(1, Math.round(cssH * scale));

  return { step, cols, cw, cssW, cssH, scale, pxW, pxH };
}
