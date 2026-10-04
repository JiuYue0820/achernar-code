'use strict';
// Two square pixels per terminal cell, rendered with solid half-block fills.
const glyphs = {
  A: ['01110', '11011', '11011', '11111', '11011', '11011', '11011'],
  c: ['00000', '00000', '01111', '11000', '11000', '11000', '01111'],
  h: ['11000', '11000', '11110', '11011', '11011', '11011', '11011'],
  e: ['00000', '00000', '01110', '11011', '11111', '11000', '01111'],
  r: ['00000', '00000', '11011', '11100', '11000', '11000', '11000'],
  n: ['00000', '00000', '11110', '11011', '11011', '11011', '11011'],
  a: ['00000', '00000', '01110', '00011', '01111', '11011', '01111'],
};
function artwork(tick = 0, compact = false) {
  const w = compact ? 23 : 74,
    h = compact ? 14 : 18;
  const pixels = Array.from({ length: h }, () => Array(w).fill(null));
  const put = (x, y, color) => {
    if (pixels[y] && x >= 0 && x < w) pixels[y][x] = color;
  };
  const cx = 11,
    cy = compact ? 6 : 8;
  // Flattened stellar disk, with discrete neutral bands rather than a gradient.
  for (let y = -4; y <= 4; y++)
    for (let x = -5; x <= 5; x++)
      if ((x * x) / 25 + (y * y) / 16 <= 1)
        put(cx + x, cy + y, y < -1 ? '#bdbdbd' : y > 1 ? '#747474' : '#dedede');
  for (let i = 0; i < 90; i++) {
    const angle = (i / 90) * Math.PI * 2,
      x = Math.cos(angle) * 10,
      y = Math.sin(angle) * 3 - x * 0.35;
    if (Math.sin(angle) > 0 || Math.abs(x) > 5)
      put(Math.round(cx + x), Math.round(cy + y), '#b0b0b0');
  }
  for (let i = 0; i < 3; i++) {
    const angle = tick * 0.075 * (i === 1 ? -0.7 : 1) + i * 2.15;
    const x = Math.round(cx + Math.cos(angle) * (i === 2 ? 8 : 11)),
      y = Math.round(cy + Math.sin(angle) * (i === 2 ? 5 : 7));
    put(x, y, '#eeeeee');
    if (i === 0) {
      put(x - 1, y, '#868686');
      put(x + 1, y, '#868686');
      put(x, y - 1, '#868686');
      put(x, y + 1, '#868686');
    }
  }
  if (!compact)
    [...'Achernar'].forEach((letter, index) =>
      glyphs[letter].forEach((row, y) =>
        [...row].forEach((pixel, x) => {
          if (pixel === '1') put(27 + index * 6 + x, y + 5, index < 2 ? '#a4a4a4' : '#e6e6e6');
        }),
      ),
    );
  return pixels;
}
// Busy indicator: a small star that breathes while a companion orbits it on one row.
// Kept to single-width glyphs so it never shifts neighbouring cells.
// Glyphs are limited to ones Cascadia Mono and Consolas both ship, avoiding font fallback.
const CORE = ['+', '*', '×', '*'];
function star(tick = 0) {
  const angle = ((((tick % 12) + 12) % 12) / 12) * Math.PI * 2;
  const offset = Math.round(Math.cos(angle) * 2);
  return {
    core: CORE[Math.floor(tick / 3) % CORE.length],
    // Companion offset -2..2 from the core; it is hidden while passing behind the star.
    offset,
    front: Math.sin(angle) >= 0 || offset !== 0,
    bright: Math.sin(angle) > 0,
  };
}
module.exports = { artwork, star };
