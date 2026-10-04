'use strict';
const { setTimeout: delay } = require('node:timers/promises');

function frame(tick = 0, { width = 80, color = true, final = false, language } = {}) {
  const dim = (text) => (color ? '\x1b[90m' + text + '\x1b[0m' : text);
  const bright = (text) => (color ? '\x1b[1m' + text + '\x1b[0m' : text);
  const tagline = require('./i18n').translate(
    language || require('./i18n').resolveLocale(process.env.ACHERNAR_LANGUAGE),
    'Build with intent.',
  );
  if (width < 54) return [bright('  *  Achernar'), dim('     CODE / YOUR WORKSPACE')];
  const sky = Array.from({ length: 7 }, () => Array(23).fill(' '));
  const put = (x, y, text) =>
    [...text].forEach((letter, offset) => {
      if (sky[y] && x + offset >= 0 && x + offset < 23) sky[y][x + offset] = letter;
    });
  put(8, 1, '.---.');
  put(7, 2, '/     \\');
  put(6, 3, '(  (@)  )');
  put(7, 4, '\\     /');
  put(8, 5, "'---'");
  // A slanted ring and three independent orbits around the stellar core.
  put(15, 1, '_.');
  put(13, 2, '-');
  put(5, 4, '-');
  put(2, 5, "'--");
  const phase = tick * 0.31;
  for (let i = 0; i < 3; i++) {
    const angle = phase * (i === 1 ? -0.75 : 1 + i * 0.23) + i * 2.1;
    const x = Math.round(10 + (i === 2 ? 7 : 10) * Math.cos(angle));
    const y = Math.round(3 + (i === 2 ? 2 : 3) * Math.sin(angle));
    put(x, y, i === tick % 3 ? '*' : '.');
  }
  const revealed = final ? 'Achernar' : 'Achernar'.slice(0, Math.min(8, tick + 1));
  const text = [
    '',
    '',
    bright(revealed) + (final ? '' : dim('  *')),
    dim('C O D E'),
    '',
    dim(tagline),
    '',
  ];
  return sky.map((row, i) => dim('  ' + row.join('')) + '  ' + text[i]);
}
async function showBanner({
  stream = process.stdout,
  animate = true,
  env = process.env,
  signal,
} = {}) {
  const terminal = Boolean(stream.isTTY) && env.TERM !== 'dumb';
  const color = terminal && !Object.hasOwn(env, 'NO_COLOR');
  const options = { width: stream.columns || 80, color, language: require('./i18n').resolveLocale(env.ACHERNAR_LANGUAGE, env) };
  if (!terminal || !animate || env.ACHERNAR_NO_ANIMATION === '1' || (stream.rows || 24) < 14) {
    stream.write('\n' + frame(13, { ...options, final: true }).join('\n') + '\n');
    return;
  }
  let lines = frame(0, options),
    resized = false;
  const resize = () => {
    resized = true;
  };
  stream.on?.('resize', resize);
  stream.write('\n\x1b[?25l' + lines.join('\n'));
  try {
    for (let tick = 1; tick <= 13; tick++) {
      await delay(55, undefined, { signal });
      // Avoid rewriting an obsolete cursor region after the user resizes the terminal.
      if (resized) {
        stream.write('\nAchernar Code');
        break;
      }
      stream.write(`\r\x1b[${lines.length - 1}A`);
      lines = frame(tick, { ...options, final: tick === 13 });
      stream.write(lines.map((line) => '\x1b[2K' + line).join('\n'));
    }
  } finally {
    stream.off?.('resize', resize);
    stream.write('\x1b[0m\x1b[?25h\n');
  }
}
module.exports = { frame, showBanner };
