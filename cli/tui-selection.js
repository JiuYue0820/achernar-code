'use strict';
function point(frame, event) {
  return {
    x: Math.max(0, Math.min(frame.canvas.width - 1, event.x)),
    y: Math.max(0, Math.min(frame.canvas.height - 1, event.y)),
  };
}
function bounds(selection) {
  const a = selection.anchor,
    b = selection.end;
  return a.y < b.y || (a.y === b.y && a.x <= b.x) ? [a, b] : [b, a];
}
function text(selection) {
  const [a, b] = bounds(selection),
    rows = [];
  for (let y = a.y; y <= b.y; y++)
    rows.push(
      selection.frame.canvas.cells[y]
        .slice(y === a.y ? a.x : 0, y === b.y ? b.x + 1 : undefined)
        .map((c) => c.char)
        .join('')
        .trimEnd(),
    );
  return rows.join('\n');
}
function render(selection) {
  const frame = selection.frame,
    canvas = Object.create(Object.getPrototypeOf(frame.canvas));
  Object.assign(canvas, frame.canvas, {
    cells: frame.canvas.cells.map((row) => row.map((cell) => ({ ...cell }))),
  });
  const [a, b] = bounds(selection);
  for (let y = a.y; y <= b.y; y++)
    for (let x = y === a.y ? a.x : 0; x <= (y === b.y ? b.x : canvas.width - 1); x++)
      Object.assign(canvas.cells[y][x], { bg: '#494949', fg: '#ffffff' });
  return { ...frame, canvas, cursor: null, hitboxes: [] };
}
module.exports = { point, text, render };
