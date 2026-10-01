'use strict';
const { segments, safeText, cellWidth, width } = require('./tui-text');
class Editor {
  constructor() {
    this.text = '';
    this.cursor = 0;
  }
  set(text) {
    this.text = text;
    this.cursor = segments(text).length;
    this.goalColumn = null;
  }
  insert(text) {
    const chars = segments(this.text),
      input = segments(safeText(text));
    let room = Math.max(0, 20000 - this.text.length);
    const actual = [];
    for (const char of input) {
      if (char.length > room) break;
      actual.push(char);
      room -= char.length;
    }
    chars.splice(this.cursor, 0, ...actual);
    this.text = chars.join('');
    this.cursor += actual.length;
    this.goalColumn = null;
  }
  key(name) {
    const chars = segments(this.text);
    if (name === 'up' || name === 'down') {
      const starts = [0];
      chars.forEach((char, index) => {
        if (char === '\n') starts.push(index + 1);
      });
      const row = starts.findLastIndex((start) => start <= this.cursor),
        next = row + (name === 'up' ? -1 : 1);
      if (next < 0 || next >= starts.length) return;
      this.goalColumn ??= width(chars.slice(starts[row], this.cursor).join(''));
      this.cursor = starts[next];
      let col = 0;
      while (
        this.cursor < chars.length &&
        chars[this.cursor] !== '\n' &&
        col + cellWidth(chars[this.cursor]) <= this.goalColumn
      )
        col += cellWidth(chars[this.cursor++]);
      return;
    }
    this.goalColumn = null;
    if (name === 'word-left' || name === 'delete-word') {
      const end = this.cursor;
      while (this.cursor && /\s/u.test(chars[this.cursor - 1])) this.cursor--;
      const word = /[\p{L}\p{N}_]/u.test(chars[this.cursor - 1] || '');
      while (
        this.cursor &&
        !/\s/u.test(chars[this.cursor - 1]) &&
        /[\p{L}\p{N}_]/u.test(chars[this.cursor - 1]) === word
      )
        this.cursor--;
      if (name === 'delete-word') chars.splice(this.cursor, end - this.cursor);
    }
    if (name === 'word-right') {
      const word = /[\p{L}\p{N}_]/u.test(chars[this.cursor] || '');
      while (
        this.cursor < chars.length &&
        !/\s/u.test(chars[this.cursor]) &&
        /[\p{L}\p{N}_]/u.test(chars[this.cursor]) === word
      )
        this.cursor++;
      while (this.cursor < chars.length && /\s/u.test(chars[this.cursor])) this.cursor++;
    }
    if (name === 'left') this.cursor = Math.max(0, this.cursor - 1);
    if (name === 'right') this.cursor = Math.min(chars.length, this.cursor + 1);
    if (name === 'backspace' && this.cursor) chars.splice(--this.cursor, 1);
    if (name === 'delete') chars.splice(this.cursor, 1);
    if (name === 'home') {
      while (this.cursor > 0 && chars[this.cursor - 1] !== '\n') this.cursor--;
    }
    if (name === 'end') {
      while (this.cursor < chars.length && chars[this.cursor] !== '\n') this.cursor++;
    }
    if (name === 'clear') {
      chars.length = 0;
      this.cursor = 0;
    }
    this.text = chars.join('');
  }
}
const keys = {
  '\x1b[Z': 'cycle-mode',
  '\x1bOQ': 'cycle-approval',
  '\x1b[12~': 'cycle-approval',
  '\x1b[A': 'up',
  '\x1b[B': 'down',
  '\x1b[C': 'right',
  '\x1b[D': 'left',
  '\x1b[H': 'home',
  '\x1b[F': 'end',
  '\x1bOH': 'home',
  '\x1bOF': 'end',
  '\x1b[1~': 'home',
  '\x1b[4~': 'end',
  '\x1b[3~': 'delete',
  '\x1b[5~': 'pageup',
  '\x1b[6~': 'pagedown',
  '\x1b[13;2u': 'newline',
  '\x1b[27;2;13~': 'newline',
  '\x1b\r': 'newline',
};
function decoder(emit) {
  Object.assign(keys, {
    '\x1bOR': 'fold-latest',
    '\x1b[13~': 'fold-latest',
    '\x1bOS': 'fold-all',
    '\x1b[14~': 'fold-all',
    '\x1b[15~': 'fold-plan',
  });
  Object.assign(keys, {
    '\x1b[1;5D': 'word-left',
    '\x1b[1;5C': 'word-right',
    '\x1b[127;5u': 'delete-word',
  });
  Object.assign(keys, {
    '\x1b[17~': 'f6',
    '\x1b[18~': 'f7',
    '\x1b[19~': 'f8',
    '\x1b[20~': 'f9',
    '\x1b[21~': 'f10',
    '\x1b[23~': 'f11',
    '\x1b[24~': 'f12',
  });
  let buffer = '',
    paste = false,
    timer;
  function feed(text) {
    clearTimeout(timer);
    buffer += text;
    while (buffer) {
      if (paste) {
        const end = buffer.indexOf('\x1b[201~');
        if (end < 0) {
          if (buffer.length > 24000) {
            emit('text', buffer.slice(0, 20000));
            buffer = buffer.slice(-6);
          }
          return;
        }
        emit('text', buffer.slice(0, end).replace(/\r\n?/g, '\n'));
        buffer = buffer.slice(end + 6);
        paste = false;
        continue;
      }
      if (buffer.startsWith('\x1b[200~')) {
        paste = true;
        buffer = buffer.slice(6);
        continue;
      }
      if (buffer[0] === '\x1b') {
        const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(buffer);
        if (mouse) {
          emit('mouse', {
            button: Number(mouse[1]),
            x: Number(mouse[2]) - 1,
            y: Number(mouse[3]) - 1,
            down: mouse[4] === 'M',
          });
          buffer = buffer.slice(mouse[0].length);
          continue;
        }
        if (/^\x1b\[<[\d;]*$/.test(buffer)) {
          timer = setTimeout(() => {
            buffer = '';
          }, 70);
          return;
        }
        const matched = Object.keys(keys).find((key) => buffer.startsWith(key));
        if (matched) {
          emit(keys[matched]);
          buffer = buffer.slice(matched.length);
          continue;
        }
        if (
          buffer === '\x1b' ||
          [...Object.keys(keys), '\x1b[200~'].some((key) => key.startsWith(buffer))
        ) {
          timer = setTimeout(() => {
            buffer = '';
            emit('escape');
          }, 70);
          return;
        }
        const sequence = /^\x1b\[[0-?]*[ -/]*[@-~]/.exec(buffer);
        if (sequence) {
          buffer = buffer.slice(sequence[0].length);
          continue;
        }
        buffer = buffer.slice(1);
        emit('escape');
        continue;
      }
      const controls = {
        '\r': 'enter',
        '\n': 'newline',
        '\x03': 'cancel',
        '\x04': 'eof',
        '\x7f': 'backspace',
        '\b': 'backspace',
        '\t': 'tab',
        '\x01': 'home',
        '\x05': 'edit-model',
        '\x15': 'undo-task',
        '\x12': 'redo-task',
        '\x0c': 'redraw',
        '\x0f': 'toggle-details',
        '\x14': 'toggle-thinking',
        '\x10': 'palette',
        '\x17': 'delete-word',
      };
      if (controls[buffer[0]]) {
        emit(controls[buffer[0]]);
        buffer = buffer.slice(1);
        continue;
      }
      const next = buffer.search(/[\x00-\x1f\x7f]/);
      const length = next < 0 ? buffer.length : next || 1;
      emit('text', buffer.slice(0, length));
      buffer = buffer.slice(length);
    }
  }
  return {
    feed,
    dispose() {
      clearTimeout(timer);
    },
  };
}
module.exports = { Editor, decoder };
