'use strict';
const { segments, cellWidth, width, clip, wrap, safeText } = require('./tui-text');
const { artwork, star } = require('./tui-art');
const { codeSpans, transcriptLines } = require('./tui-output');
const palette = {
  bg: 'default',
  field: 'default',
  menu: 'default',
  selected: '#303030',
  text: '#e6e6e6',
  soft: '#b5b5b5',
  dim: '#858585',
  edge: '#555555',
  warning: '#d1b178',
};
class Canvas {
  constructor(columns, rows) {
    this.width = Math.max(1, columns - 1);
    this.height = Math.max(1, rows);
    this.cells = Array.from({ length: this.height }, () =>
      Array.from({ length: this.width }, () => ({ char: ' ', fg: palette.text, bg: palette.bg })),
    );
  }
  fill(x, y, w, h, bg) {
    for (let row = Math.max(0, y); row < Math.min(this.height, y + h); row++)
      for (let col = Math.max(0, x); col < Math.min(this.width, x + w); col++)
        this.cells[row][col] = { char: ' ', fg: palette.text, bg };
  }
  text(x, y, value, fg = palette.text, bg, max = this.width - x) {
    if (y < 0 || y >= this.height) return;
    let col = x;
    for (const char of segments(safeText(value))) {
      const count = cellWidth(char);
      if (char === '\n' || col + count > Math.min(this.width, x + max)) break;
      if (count === 0) continue;
      if (col >= 0) {
        this.cells[y][col] = { char, fg, bg: bg || this.cells[y][col].bg };
        if (count === 2)
          this.cells[y][col + 1] = { char: '', fg, bg: bg || this.cells[y][col + 1].bg };
      }
      col += count;
    }
  }
  pixels(x, y, pixels) {
    for (let row = 0; row < pixels.length; row += 2)
      for (let col = 0; col < pixels[row].length; col++) {
        const top = pixels[row][col],
          bottom = pixels[row + 1]?.[col];
        if (!top && !bottom) continue;
        if (top && bottom && top === bottom) this.text(x + col, y + row / 2, '█', top, palette.bg);
        else
          this.text(
            x + col,
            y + row / 2,
            top ? '▀' : '▄',
            top || bottom,
            top && bottom ? bottom : palette.bg,
          );
      }
  }
  box(x, y, w, h, color = palette.edge) {
    this.text(x, y, '╭' + '─'.repeat(w - 2) + '╮', color);
    for (let row = y + 1; row < y + h - 1; row++) {
      this.text(x, row, '│', color);
      this.text(x + w - 1, row, '│', color);
    }
    this.text(x, y + h - 1, '╰' + '─'.repeat(w - 2) + '╯', color);
  }
  lines(color = true) {
    const rgb = (hex, kind) =>
      hex === 'default'
        ? `\x1b[${kind === 48 ? 49 : 39}m`
        : `\x1b[${kind};2;${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}m`;
    return this.cells.map((row) => {
      let text = '',
        fg = '',
        bg = '';
      for (const cell of row) {
        if (color && cell.fg !== fg) {
          text += rgb(cell.fg, 38);
          fg = cell.fg;
        }
        if (color && cell.bg !== bg) {
          text += rgb(cell.bg, 48);
          bg = cell.bg;
        }
        text += cell.char;
      }
      return text + (color ? '\x1b[0m' : '');
    });
  }
}
function inputLines(editor, size) {
  const lines = [''];
  let row = 0,
    col = 0,
    caret = { row: 0, col: 0 };
  segments(editor.text).forEach((char, i) => {
    const count = cellWidth(char);
    if (char !== '\n' && col + count > size) {
      lines.push('');
      row++;
      col = 0;
    }
    if (i === editor.cursor) caret = { row, col };
    if (char === '\n') {
      lines.push('');
      row++;
      col = 0;
    } else {
      lines[row] += char;
      col += count;
    }
  });
  if (editor.cursor === segments(editor.text).length) {
    if (col >= size) {
      lines.push('');
      row++;
      col = 0;
    }
    caret = { row, col };
  }
  return { lines, caret };
}
// Show what will actually run instead of raw JSON: `$ npm test`, `write · src/a.js`.
function approvalSummary({ name, arguments: args = {} }) {
  if (name === 'terminal' && args.command) return '$ ' + args.command.replace(/\s+/g, ' ');
  if (args.path) return [args.action, args.path].filter(Boolean).join(' · ');
  if (args.url) return args.url;
  return JSON.stringify(args);
}
const count = (number) =>
  number == null ? '—' : Number(number).toLocaleString('en-US', { maximumFractionDigits: 0 });
function metricsText(metrics) {
  const used = metrics.used == null ? '—' : count(metrics.used),
    percent = metrics.used == null ? '' : ` · ${Math.round((metrics.used / metrics.limit) * 100)}%`;
  return {
    left: `${metrics.rate == null ? '—' : metrics.rate.toFixed(1)} token/s · Used ${count(metrics.total)} tokens`,
    right: `Context ${metrics.estimated && metrics.used != null ? '≈' : ''}${used} / ${count(metrics.limit)}${percent}`,
  };
}
function renderScreen(state, columns = 110, rows = 34) {
  const canvas = new Canvas(columns, rows),
    w = canvas.width,
    h = canvas.height,
    hitboxes = [];
  const t = (text) => require('./i18n').translate(state.language || 'en', text);
  if (w < 30 || h < 16) {
    canvas.text(1, 1, 'Achernar · ' + t('Enlarge terminal'));
    return { canvas, cursor: null, layout: {} };
  }
  const inConversation = state.logs.some(
      (block) => block.kind === 'user' || block.kind === 'assistant',
    ),
    areaWidth = inConversation ? w - 4 : Math.min(96, w - 6),
    x = inConversation ? 2 : Math.floor((w - areaWidth) / 2);
  const displayEditor = state.form?.secret
    ? { text: '•'.repeat(segments(state.editor.text).length), cursor: state.editor.cursor }
    : state.editor;
  const hasPlan = Boolean(state.plan?.steps.length);
  const compactPlan = hasPlan && h < 28;
  const entered = inputLines(displayEditor, areaWidth - 6),
    topPadding = h >= 22 && !compactPlan ? 2 : 1;
  const visible = compactPlan
    ? h < 22
      ? 1
      : 2
    : Math.min(h < 22 ? 2 : 4, Math.max(h >= 26 ? 3 : 2, entered.lines.length));
  const inputHeight = compactPlan ? visible + 2 : visible + topPadding + 4;
  const welcome = !state.logs.length && !state.busy && !state.question && !hasPlan;
  const metrics = metricsText(state.metrics);
  metrics.left =
    metrics.left.replace('Used', t('Used')) +
    (state.cost
      ? ` · ${t('Cost')} ${state.cost.costUsd == null ? '?' : '$' + state.cost.costUsd.toFixed(4)}${state.cost.maxCostUsd ? '/$' + state.cost.maxCostUsd : ''}`
      : '');
  metrics.right = metrics.right.replace('Context', t('Context'));
  const metricsRows = width(metrics.left) + width(metrics.right) + 3 > areaWidth ? 2 : 1;
  const y = Math.max(
    2,
    welcome
      ? Math.min(h - inputHeight - metricsRows - 3, Math.max(12, Math.floor(h * 0.6)))
      : h - inputHeight - metricsRows - 3,
  );
  const planRows = hasPlan
    ? Math.min(state.plan.expanded ? state.plan.steps.length : 1, Math.max(1, Math.min(6, y - 13)))
    : 0;
  const planHeight = hasPlan ? planRows + 2 : 0,
    planTop = hasPlan ? y - 2 - planHeight : null;
  const contentBottom = hasPlan ? planTop - 1 : y - 1;
  const showStatus = state.busy && !state.question && contentBottom >= 8;
  const activeStep = hasPlan
    ? Math.max(
        0,
        state.plan.steps.findIndex((step) => step.status !== 'completed'),
      )
    : 0;
  const planMaxOffset = hasPlan ? Math.max(0, state.plan.steps.length - planRows) : 0;
  const planOffset = hasPlan
    ? Math.min(
        planMaxOffset,
        Math.max(0, state.plan.expanded ? (state.plan.offset ?? activeStep) : activeStep),
      )
    : 0;
  canvas.text(2, 1, 'Achernar', palette.soft);
  const headerRight = 'CODE  ' + state.version;
  canvas.text(Math.max(10, w - headerRight.length), 1, headerRight, palette.dim);
  if (state.toast && (!hasPlan || planTop > 2))
    canvas.text(x, 2, t(state.toast), palette.soft, undefined, areaWidth);
  if (welcome && y >= 12 && !state.menu) {
    const compact = w < 78,
      pixels = artwork(state.tick, compact);
    const artY = Math.max(1, y - (compact ? 10 : 12));
    canvas.pixels(Math.floor((w - pixels[0].length) / 2), artY, pixels);
    if (compact) canvas.text(Math.floor((w - 8) / 2), artY + 7, 'Achernar');
    const tagline = t('MAKE ROOM FOR YOUR NEXT IDEA');
    canvas.text(Math.floor((w - width(tagline)) / 2), y - 2, tagline, palette.dim);
  } else if (!welcome) {
    const content = transcriptLines(state, areaWidth - 2);
    const height = Math.max(0, contentBottom - (showStatus ? 5 : 3));
    if (state.scrollAnchor) {
      const line = content.findIndex(
        (item) =>
          item.index === state.scrollAnchor.index && item.action === state.scrollAnchor.action,
      );
      if (line >= 0)
        state.scroll = Math.max(
          0,
          content.length - height - Math.max(0, line - state.scrollAnchor.row + 3),
        );
      state.scrollAnchor = null;
    }
    const scroll = Math.min(state.scroll, Math.max(0, content.length - height)),
      end = Math.max(0, content.length - scroll),
      start = Math.max(0, end - height);
    state.scroll = scroll;
    content.slice(start, end).forEach((line, i) => {
      const left = x + 1 + (line.indent || 0),
        row = 3 + i,
        hovering = line.action && state.hover === `${line.action}:${line.index}`;
      if (line.userPanel) canvas.fill(left, row, areaWidth - 6, 1, '#292929');
      else if (line.card || line.style === 'code' || line.style === 'code-title')
        canvas.fill(
          left,
          row,
          line.card ? areaWidth - 6 : areaWidth - 5,
          1,
          hovering ? '#303030' : '#1c1c1c',
        );
      canvas.text(
        left,
        row,
        line.text,
        hovering
          ? palette.text
          : line.edge
            ? palette.dim
            : line.style === 'code-title'
              ? palette.dim
              : palette[line.tone] || palette.text,
      );
      if (line.action)
        hitboxes.push({
          x: left,
          y: row,
          width: areaWidth - 6,
          height: 1,
          action: line.action,
          index: line.index,
        });
      if (line.style === 'code')
        for (const span of codeSpans(line.text))
          canvas.text(left + span.x, row, span.text, span.color, '#1c1c1c', areaWidth - 5 - span.x);
    });
    if (showStatus) {
      // Achernar's own busy mark: a breathing star with an orbiting companion, one row high.
      const glow = star(state.tick),
        row = contentBottom - 2;
      if (glow.front && glow.offset)
        canvas.text(x + 4 + glow.offset, row, '·', glow.bright ? palette.text : palette.dim);
      canvas.text(x + 4, row, glow.core, palette.text);
      canvas.text(
        x + 8,
        contentBottom - 2,
        t(state.status || 'Working') + '.'.repeat((state.tick % 3) + 1),
        palette.soft,
        undefined,
        areaWidth - 11,
      );
    }
  }
  if (hasPlan) {
    const hovering = state.hover === 'fold-plan:',
      done = state.plan.steps.filter((step) => step.status === 'completed').length;
    canvas.fill(x, planTop, areaWidth, planHeight, palette.field);
    canvas.box(x, planTop, areaWidth, planHeight);
    canvas.text(
      x + 2,
      planTop,
      ` ${state.plan.expanded ? '▾' : '▸'} ${t('Task plan')} · ${done}/${state.plan.steps.length} · F5 `,
      hovering ? palette.text : palette.soft,
      hovering ? palette.selected : palette.field,
      areaWidth - 4,
    );
    hitboxes.push({ x, y: planTop, width: areaWidth, height: 1, action: 'fold-plan' });
    state.plan.steps.slice(planOffset, planOffset + planRows).forEach((step, index) => {
      const symbol =
        step.status === 'completed'
          ? '✓'
          : step.status === 'in_progress'
            ? state.busy
              ? ['◐', '◓', '◑', '◒'][state.tick % 4]
              : '◐'
            : '○';
      const text = step.text.replace(/\s+/g, ' '),
        max = areaWidth - 8;
      canvas.text(
        x + 3,
        planTop + index + 1,
        symbol + ' ' + (width(text) > max ? clip(text, max - 1) + '…' : text),
        step.status === 'in_progress' ? palette.text : palette.dim,
        undefined,
        areaWidth - 6,
      );
    });
    if (state.plan.expanded && planMaxOffset)
      canvas.text(
        x + 2,
        planTop + planHeight - 1,
        ` ${planOffset + 1}–${planOffset + planRows}/${state.plan.steps.length} · scroll `,
        palette.dim,
        palette.field,
        areaWidth - 4,
      );
    hitboxes.push({
      x,
      y: planTop + 1,
      width: areaWidth,
      height: planHeight - 1,
      action: 'plan-scroll',
    });
  }
  const modeLabel = state.mode === 'plan' ? 'Plan' : state.mode === 'review' ? 'Review' : 'Code';
  const bindings = require('./shortcuts').normalize(state.shortcuts);
  const modeKey = bindings['cycle-mode'] === 'Shift+Tab' ? 'S-Tab' : bindings['cycle-mode'];
  let controlX = x + 2;
  for (const [label, value, action] of [
    [t(modeLabel) + (modeKey ? ` [${modeKey}]` : ''), modeLabel.toLowerCase(), 'mode'],
    ...['strict', 'code', 'auto'].map((value) => [
      (value === (state.approval || 'strict') ? '● ' : '') +
        t(value[0].toUpperCase() + value.slice(1)),
      value,
      'approval',
    ]),
  ]) {
    const targetValue =
        action === 'mode' ? { code: 'plan', plan: 'review', review: 'code' }[value] : value,
      size = width(label),
      hovering = state.hover === `${action}:${targetValue}`;
    if (hovering) canvas.fill(controlX - 1, y - 1, size + 2, 1, palette.selected);
    canvas.text(
      controlX,
      y - 1,
      label,
      hovering || action === 'mode' || value === state.approval ? palette.text : palette.dim,
      undefined,
      x + areaWidth - controlX,
    );
    hitboxes.push({
      x: controlX,
      y: y - 1,
      width: Math.min(size, x + areaWidth - controlX),
      height: 1,
      action,
      value: targetValue,
    });
    controlX += size + 3;
  }
  const approvalHint = bindings['cycle-approval'] ? `[${bindings['cycle-approval']}]` : '';
  if (controlX + width(approvalHint) < x + areaWidth)
    canvas.text(controlX, y - 1, approvalHint, palette.dim);
  canvas.fill(x, y, areaWidth, inputHeight, palette.field);
  canvas.box(x, y, areaWidth, inputHeight);
  const start = Math.max(0, entered.caret.row - visible + 1);
  const placeholder = state.picker
    ? 'Type to filter choices…'
    : state.busy && !state.question
      ? 'Add a correction… Enter queues · Esc stops'
      : state.question
        ? 'Type an answer and press Enter…'
        : 'Describe a task, or type / for commands…';
  if (!displayEditor.text)
    canvas.text(x + 3, y + topPadding, t(placeholder), palette.dim, palette.field, areaWidth - 6);
  else
    entered.lines
      .slice(start, start + visible)
      .forEach((line, i) =>
        canvas.text(x + 3, y + topPadding + i, line, palette.text, palette.field, areaWidth - 6),
      );
  const mode = state.question ? 'Your choice' : state.busy ? state.status || 'Thinking' : modeLabel;
  if (inputHeight > 4)
    canvas.text(
      x + 3,
      y + inputHeight - 3,
      clip(t(mode), Math.floor(areaWidth / 3)) +
        (state.queued ? ` · ${state.queued} queued` : '') +
        ' · ' +
        (state.model || t('No model selected')) +
        (state.reasoning ? ' · ' + t(state.reasoning) : ''),
      palette.soft,
      palette.field,
      areaWidth - 6,
    );
  canvas.text(x, y + inputHeight + 1, metrics.left, palette.dim, undefined, areaWidth);
  canvas.text(
    metricsRows === 2 ? x : x + areaWidth - width(metrics.right),
    y + inputHeight + metricsRows,
    metrics.right,
    palette.dim,
    undefined,
    areaWidth,
  );
  const hint = 'Enter send · Alt+Enter newline · / commands · PgUp/PgDn scroll';
  if (welcome && h - (y + inputHeight + metricsRows) > 3)
    canvas.text(x, y + inputHeight + metricsRows + 2, t(hint), palette.dim, undefined, areaWidth);
  const tips = require('./shortcuts').tips(state.shortcuts, state.busy);
  const footer = clip(
    'Tips · ' + t(tips[(state.tipIndex || 0) % tips.length]),
    Math.max(12, Math.floor(w * 0.65)),
  );
  canvas.text(2, h - 1, clip(state.project, Math.max(0, w - width(footer) - 6)), palette.dim);
  canvas.text(Math.max(2, w - width(footer) - 2), h - 1, footer, palette.dim);
  let menuTop;
  if (state.menu && !state.question) {
    const available = Math.max(1, Math.min(7, y - 4)),
      from = Math.max(0, state.selected - available + 1),
      entries = state.matches.slice(from, from + available);
    const menuY = Math.max(2, y - entries.length - 3);
    menuTop = menuY;
    canvas.fill(x, menuY, areaWidth, entries.length + 2, palette.menu);
    canvas.text(
      x + 2,
      menuY,
      t(state.picker?.title || 'Commands & Skills') + ' · ↑↓ / Enter / Esc',
      palette.dim,
      palette.menu,
      areaWidth - 4,
    );
    if (!entries.length) canvas.text(x + 2, menuY + 1, t('No matching entries'), palette.dim);
    entries.forEach((entry, i) => {
      const chosen = from + i === state.selected,
        row = menuY + i + 1;
      if (chosen) canvas.fill(x + 1, row, areaWidth - 2, 1, palette.selected);
      if (chosen) canvas.text(x + 1, row, '›', palette.text);
      const commandWidth = Math.min(36, Math.floor(areaWidth * 0.45));
      canvas.text(
        x + 2,
        row,
        clip(entry.command, commandWidth),
        chosen ? palette.text : palette.soft,
        undefined,
        commandWidth,
      );
      const description =
        state.busy && ['/model', '/reasoning'].includes(entry.command)
          ? 'Applies to the next task'
          : entry.description;
      canvas.text(
        x + 3 + commandWidth,
        row,
        t(description),
        palette.dim,
        undefined,
        areaWidth - commandWidth - 5,
      );
      hitboxes.push({
        x: x + 1,
        y: row,
        width: areaWidth - 2,
        height: 1,
        action: 'select',
        index: from + i,
      });
    });
  }
  let cursor = { x: x + 3 + entered.caret.col, y: y + topPadding + entered.caret.row - start };
  if (state.question) {
    hitboxes.length = 0;
    // A real terminal modal: dim the underlying cell grid without losing state.
    for (const row of canvas.cells)
      for (const cell of row) {
        cell.fg = '#4d4d4d';
        cell.bg = '#161616';
      }
    if (state.viewer) {
      const viewer = state.viewer,
        mw = Math.min(120, w - 4),
        mx = Math.floor((w - mw) / 2),
        my = 2,
        mh = h - 4,
        body = mh - 5;
      canvas.fill(mx, my, mw, mh, '#171717');
      canvas.box(mx, my, mw, mh);
      canvas.text(mx + 2, my + 1, viewer.title, palette.text, undefined, mw - 7);
      canvas.text(mx + mw - 3, my + 1, '×');
      hitboxes.push({ x: mx + mw - 4, y: my, width: 4, height: 3, action: 'close' });
      const raw = viewer.text.split('\n'),
        gutter = viewer.lineNumbers ? String(raw.length).length + 2 : 0,
        bodyWidth = mw - 6 - gutter;
      if (viewer.cacheWidth !== bodyWidth) {
        viewer.lines = raw.flatMap((line, index) =>
          wrap(line || ' ', bodyWidth).map((text, part) => ({
            text,
            number: part ? '' : String(index + 1),
          })),
        );
        viewer.cacheWidth = bodyWidth;
      }
      viewer.offset = Math.min(viewer.offset, Math.max(0, viewer.lines.length - body));
      viewer.lines.slice(viewer.offset, viewer.offset + body).forEach((line, index) => {
        const row = my + 3 + index,
          left = mx + 3 + gutter;
        if (gutter) canvas.text(mx + 3, row, line.number.padStart(gutter - 2), palette.dim);
        const color =
          viewer.language === 'diff'
            ? line.text.startsWith('+')
              ? '#9bc39b'
              : line.text.startsWith('-')
                ? '#dfaaaa'
                : palette.soft
            : palette.text;
        canvas.text(left, row, line.text, color, undefined, bodyWidth);
        if (viewer.language && viewer.language !== 'diff')
          for (const span of codeSpans(line.text))
            canvas.text(left + span.x, row, span.text, span.color, undefined, bodyWidth - span.x);
      });
      canvas.text(
        mx + 2,
        my + mh - 2,
        `${viewer.offset + 1}–${Math.min(viewer.lines.length, viewer.offset + body)}/${viewer.lines.length} · ↑↓ PgUp/PgDn · Esc`,
        palette.dim,
        undefined,
        mw - 4,
      );
      hitboxes.push({ x: mx + 1, y: my + 3, width: mw - 2, height: body, action: 'viewer-scroll' });
      return {
        canvas,
        cursor: null,
        hitboxes,
        layout: { x, y, areaWidth, inputHeight, metricsRows },
      };
    }
    if (state.approvalRequest?.preview?.diff && state.picker) {
      const mw = Math.min(104, w - 4),
        mx = Math.floor((w - mw) / 2);
      const previewHeight = Math.min(18, Math.max(1, h - 14)),
        available = Math.min(5, Math.max(1, h - previewHeight - 10));
      const from = Math.max(0, state.selected - available + 1),
        entries = state.matches.slice(from, from + available);
      const mh = previewHeight + entries.length + 8,
        my = Math.max(0, Math.floor((h - mh) / 2));
      canvas.fill(mx, my, mw, mh, '#171717');
      canvas.box(mx, my, mw, mh, '#707070');
      canvas.text(mx + 2, my + 1, t('Review file change'), palette.text, undefined, mw - 7);
      canvas.text(mx + mw - 3, my + 1, '×');
      hitboxes.push({ x: mx + mw - 4, y: my, width: 3, height: 3, action: 'close' });
      canvas.text(
        mx + 2,
        my + 2,
        state.approvalRequest.preview.path,
        palette.dim,
        undefined,
        mw - 4,
      );
      const lines = state.approvalRequest.preview.diff.split('\n').flatMap((line) =>
        wrap(line || ' ', mw - 6).map((text) => ({
          text,
          color: line.startsWith('+')
            ? '#9bc39b'
            : line.startsWith('-')
              ? '#dfaaaa'
              : line.startsWith('@@')
                ? '#bbc4d0'
                : palette.soft,
        })),
      );
      const offset = Math.min(
        state.approvalPreviewScroll || 0,
        Math.max(0, lines.length - previewHeight),
      );
      state.approvalPreviewScroll = offset;
      canvas.fill(mx + 2, my + 3, mw - 4, previewHeight, '#202020');
      lines
        .slice(offset, offset + previewHeight)
        .forEach((line, i) =>
          canvas.text(mx + 3, my + 3 + i, line.text, line.color, undefined, mw - 6),
        );
      hitboxes.push({
        x: mx + 2,
        y: my + 3,
        width: mw - 4,
        height: previewHeight,
        action: 'preview',
      });
      canvas.text(
        mx + 2,
        my + 3 + previewHeight,
        `${offset + 1}–${Math.min(lines.length, offset + previewHeight)}/${lines.length} · PgUp/PgDn scroll`,
        palette.dim,
        undefined,
        mw - 4,
      );
      entries.forEach((entry, i) => {
        const row = my + 5 + previewHeight + i,
          chosen = from + i === state.selected;
        canvas.fill(mx + 2, row, mw - 4, 1, chosen ? '#343434' : '#171717');
        const label = (chosen ? '› ' : '  ') + t(entry.command);
        canvas.text(mx + 2, row, label, chosen ? palette.text : palette.soft, undefined, mw - 4);
        if (mw > 58)
          canvas.text(mx + 18, row, t(entry.description), palette.dim, undefined, mw - 20);
        hitboxes.push({
          x: mx + 2,
          y: row,
          width: mw - 4,
          height: 1,
          action: 'select',
          index: from + i,
        });
      });
      canvas.text(
        mx + 2,
        my + mh - 2,
        t('↑↓ choose · Enter confirm · Esc deny'),
        palette.dim,
        undefined,
        mw - 4,
      );
      return {
        canvas,
        cursor: null,
        hitboxes,
        layout: { x, y, areaWidth, inputHeight, metricsRows, menuTop },
      };
    }
    const roomy = state.picker?.roomy && h >= 24,
      stride = roomy ? 2 : 1;
    const mw = Math.min(roomy ? 96 : 84, w - 6),
      mx = Math.floor((w - mw) / 2);
    const contextLines = (state.picker?.context || [])
      .slice(0, 3)
      .flatMap((line) => wrap(safeText(line), mw - 6))
      .slice(0, Math.max(1, h - 13));
    const extra = (state.approvalRequest ? 3 : 0) + contextLines.length;
    const available = Math.max(1, Math.min(9, Math.floor((h - 11 - extra) / stride)));
    const from = Math.max(0, state.selected - available + 1),
      entries = state.picker ? state.matches.slice(from, from + available) : [];
    const promptLines = wrap(t(state.question), mw - 6).slice(0, Math.max(1, h - 11));
    const mh = state.picker
        ? Math.max(9, entries.length * stride + 7 + extra)
        : Math.max(9, promptLines.length + 7),
      my = Math.floor((h - mh) / 2);
    canvas.fill(mx, my, mw, mh, '#171717');
    canvas.box(mx, my, mw, mh, '#707070');
    canvas.text(
      mx + 3,
      my + 1,
      t(state.form?.title || state.picker?.title || 'Achernar'),
      palette.text,
      undefined,
      mw - 10,
    );
    canvas.text(
      mx + mw - 4,
      my + 1,
      state.form ? '‹' : '×',
      state.hover === 'close:' ? palette.text : palette.soft,
      state.hover === 'close:' ? '#444444' : undefined,
    );
    hitboxes.push({ x: mx + mw - 5, y: my, width: 4, height: 3, action: 'close' });
    const inputY = state.picker ? my + 3 + extra : my + promptLines.length + 3;
    if (state.approvalRequest) {
      canvas.text(mx + 3, my + 3, state.approvalRequest.project, palette.dim, undefined, mw - 6);
      canvas.text(
        mx + 3,
        my + 4,
        approvalSummary(state.approvalRequest),
        palette.soft,
        undefined,
        mw - 6,
      );
    }
    contextLines.forEach((line, i) =>
      canvas.text(
        mx + 3,
        my + 3 + (state.approvalRequest ? 3 : 0) + i,
        clip(safeText(line), mw - 6),
        palette.dim,
        undefined,
        mw - 6,
      ),
    );
    if (!state.picker)
      promptLines.forEach((line, i) => canvas.text(mx + 3, my + 3 + i, line, palette.soft));
    canvas.fill(mx + 2, inputY, mw - 4, 1, '#303030');
    const formChars = segments(displayEditor.text.replace(/\n/g, ' '));
    let inputStart = 0;
    while (width(formChars.slice(inputStart, displayEditor.cursor).join('')) >= mw - 7)
      inputStart++;
    const input = clip(formChars.slice(inputStart).join(''), mw - 7),
      caret = width(formChars.slice(inputStart, displayEditor.cursor).join(''));
    canvas.text(
      mx + 3,
      inputY,
      input || t(state.picker ? 'Filter…' : 'Type your answer…'),
      input ? palette.text : palette.dim,
      '#303030',
      mw - 6,
    );
    entries.forEach((entry, i) => {
      const row = my + 5 + extra + i * stride,
        chosen = from + i === state.selected;
      canvas.fill(mx + 2, row, mw - 4, 1, chosen ? '#343434' : '#171717');
      if (chosen) canvas.text(mx + 2, row, '›', palette.text);
      const split = Math.min(36, Math.floor(mw * 0.48));
      canvas.text(
        mx + 3,
        row,
        clip(t(entry.command), split),
        entry.danger ? '#dc9292' : chosen ? palette.text : palette.soft,
        undefined,
        split,
      );
      canvas.text(
        mx + 4 + split,
        row,
        t(entry.description),
        palette.dim,
        undefined,
        mw - split - 7,
      );
      hitboxes.push({
        x: mx + 2,
        y: row,
        width: mw - 4,
        height: 1,
        action: 'select',
        index: from + i,
      });
    });
    let footerX = mx + 3;
    if (state.picker?.actions) {
      for (const action of state.picker.actions) {
        const label = t(action.label),
          active = state.matches[state.selected]?.editable;
        canvas.text(
          footerX,
          my + mh - 2,
          label,
          active ? (action.danger ? '#dc9292' : palette.soft) : palette.dim,
          undefined,
          mw - 6,
        );
        if (active)
          hitboxes.push({
            x: footerX,
            y: my + mh - 2,
            width: width(label),
            height: 1,
            action: 'picker-action',
            value: action.key,
          });
        footerX += width(label) + 3;
      }
    }
    canvas.text(
      footerX,
      my + mh - 2,
      t(
        state.form
          ? 'Enter next · Esc previous step'
          : state.picker?.actions
            ? 'Enter select · Esc back'
            : 'Enter choose · Esc back · Hover / click',
      ),
      palette.dim,
      undefined,
      mx + mw - 3 - footerX,
    );
    cursor = { x: mx + 3 + Math.min(caret, mw - 7), y: inputY };
  }
  return {
    canvas,
    cursor,
    hitboxes,
    layout: {
      x,
      y,
      areaWidth,
      inputHeight,
      metricsRows,
      menuTop,
      planTop,
      planHeight,
      planOffset,
      planMaxOffset,
    },
  };
}
module.exports = { Canvas, renderScreen, metricsText, inputLines, palette };
