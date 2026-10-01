'use strict';
const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
const segments = (text) => [...segmenter.segment(String(text))].map((item) => item.segment);
const safeText = (value) =>
  String(value ?? '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
    .replace(/\t/g, '  ');
function cellWidth(char) {
  if (!char || char === '\n') return 0;
  if (/^\p{Mark}+$/u.test(char)) return 0;
  const n = char.codePointAt(0);
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(char) ||
    (n >= 0x1100 &&
      (n <= 0x115f ||
        n === 0x2329 ||
        n === 0x232a ||
        (n >= 0x2e80 && n <= 0xa4cf) ||
        (n >= 0xac00 && n <= 0xd7a3) ||
        (n >= 0xf900 && n <= 0xfaff) ||
        (n >= 0xfe10 && n <= 0xfe6f) ||
        (n >= 0xff01 && n <= 0xff60) ||
        (n >= 0xffe0 && n <= 0xffe6) ||
        n >= 0x20000))
    ? 2
    : 1;
}
const width = (text) => segments(text).reduce((sum, char) => sum + cellWidth(char), 0);
function clip(text, size) {
  let value = '',
    length = 0;
  for (const char of segments(safeText(text))) {
    if (char === '\n' || length + cellWidth(char) > size) break;
    value += char;
    length += cellWidth(char);
  }
  return value;
}
function wrap(text, size) {
  const lines = [''];
  let length = 0;
  // Prefer word boundaries for English, but split long identifiers and CJK by cells.
  const tokens =
    safeText(text).match(
      /\n|[^\s\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff]+|[^\S\n]+|[\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff]/gu,
    ) || [];
  for (const token of tokens) {
    if (token === '\n') {
      lines.push('');
      length = 0;
      continue;
    }
    const tokenWidth = width(token);
    if (length && token.trim() && tokenWidth <= size && length + tokenWidth > size) {
      lines[lines.length - 1] = lines.at(-1).trimEnd();
      lines.push('');
      length = 0;
    }
    for (const char of segments(token)) {
      const count = cellWidth(char);
      if (length + count > size) {
        lines.push('');
        length = 0;
        if (char === ' ') continue;
      }
      lines[lines.length - 1] += char;
      length += count;
    }
  }
  return lines;
}
module.exports = { segments, safeText, cellWidth, width, clip, wrap };
