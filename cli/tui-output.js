'use strict';
const { wrap, width, clip } = require('./tui-text');
const inline = (text) => text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
function outputLines(text, size) {
  const result = [];
  let code = false,
    number = 0;
  for (const raw of text.split('\n')) {
    const fence = /^\s*```(.*)$/.exec(raw);
    if (fence) {
      code = !code;
      number = 0;
      result.push({
        text: code ? '  ' + (fence[1].trim() || 'code') : '',
        style: code ? 'code-title' : 'normal',
      });
      continue;
    }
    if (code) {
      number++;
      for (const [part, line] of wrap(raw, size - 7).entries())
        result.push({
          text: (part ? '   ' : String(number).padStart(3)) + ' │ ' + line,
          style: 'code',
          number: part ? null : number,
        });
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(raw);
    if (!raw.trim() && result.at(-1)?.text === '') continue;
    const value = inline(heading ? heading[1] : raw.replace(/^(\s*)[-*]\s+/, '$1• '));
    for (const line of wrap(value, size))
      result.push({ text: line, style: heading ? 'heading' : 'normal' });
  }
  return result;
}
function codeSpans(line) {
  const parts = [];
  const pattern =
    /(?:\/\/|#).*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:const|let|var|function|return|if|else|async|await|class|import|from|export|def|for|in|true|false|null|None)\b|\b\d+(?:\.\d+)?\b/g;
  for (const match of line.matchAll(pattern)) {
    const cursor = width(line.slice(0, match.index));
    parts.push({
      x: cursor,
      text: match[0],
      color: /^(\/\/|#)/.test(match[0])
        ? '#777777'
        : /^["']/.test(match[0])
          ? '#b3c1a6'
          : /^\d/.test(match[0])
            ? '#cbb79f'
            : '#c0b4cf',
    });
  }
  return parts;
}
const foldable = (block) => ['reasoning', 'tool', 'terminal'].includes(block.kind);
function formatToolResult(name, raw) {
  let result;
  try {
    result = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return String(raw || '');
  }
  if (!result || typeof result !== 'object') return String(raw || '');
  if (result.error || result.denied)
    return [result.denied ? 'Denied' : 'Error', result.error || result.message].join(' · ');
  if (name === 'terminal')
    return [
      `Exit ${result.exitCode ?? 'unknown'}${result.timedOut ? ' · timed out' : ''}`,
      result.stdout || '',
      result.stderr || '',
    ]
      .filter(Boolean)
      .join('\n');
  if (typeof result.content === 'string')
    return result.content + (result.truncated ? '\n[Partial preview]' : '');
  if (result.matches)
    return result.matches.map((m) => `${m.path}:${m.line}  ${m.text}`).join('\n') || 'No matches.';
  if (result.cacheHit) return 'Unchanged · previous read is still current.';
  if (result.written)
    return [
      `Written ${result.written} · ${result.bytes} bytes`,
      result.validation ? JSON.stringify(result.validation, null, 2) : '',
    ]
      .filter(Boolean)
      .join('\n');
  return JSON.stringify(result, null, 2);
}
function transcriptLines(state, size) {
  const content = [],
    cardWidth = Math.max(12, size - 4),
    bodyWidth = cardWidth - 4;
  const t = (text) => require('./i18n').translate(state.language || 'en', text);
  let assistantHeader = false;
  state.logs.forEach((block, index) => {
    if (block.kind === 'user') {
      assistantHeader = false;
      const panelWidth = Math.max(8, size - 6);
      content.push({ text: '', indent: 2, userPanel: true, action: 'user-message', index });
      for (const text of wrap(block.text, panelWidth))
        content.push({
          text: ' ' + text,
          indent: 2,
          userPanel: true,
          action: 'user-message',
          index,
        });
      content.push({ text: '', indent: 2, userPanel: true, action: 'user-message', index });
      content.push({ text: '' });
      return;
    }
    if (['assistant', 'reasoning', 'tool', 'terminal'].includes(block.kind) && !assistantHeader) {
      content.push({ text: 'Achernar', tone: 'text' });
      assistantHeader = true;
    }
    if (foldable(block)) {
      const expanded = block.expanded ?? false,
        status = block.running
          ? 'Running'
          : block.stopped
            ? 'Stopped'
            : block.failed
              ? 'Failed'
              : block.kind === 'reasoning'
                ? 'Done'
                : 'Completed';
      const title =
        block.kind === 'reasoning'
          ? 'Thinking'
          : block.kind === 'terminal'
            ? 'Console output'
            : block.title || 'Activity';
      if (!expanded) {
        const suffix = ` · ${t(status)}${block.duration != null ? ` · ${(block.duration / 1000).toFixed(1)}s` : ''}`;
        const available = Math.max(1, cardWidth - width(suffix));
        const label = `▸ ${t(title)}${block.summary ? ' · ' + block.summary.replace(/\s+/g, ' ') : ''}`;
        const summary = width(label) > available ? clip(label, available - 1) + '…' : label;
        content.push({
          text: clip(summary + suffix, cardWidth),
          indent: 2,
          card: true,
          action: 'fold',
          index,
          tone: block.failed ? 'warning' : 'soft',
        });
        return;
      }
      const heading = ` ${expanded ? '▾' : '▸'} ${t(title)} · ${t(status)}${block.duration != null ? ` · ${(block.duration / 1000).toFixed(1)}s` : ''} `;
      const short = clip(heading, cardWidth - 3);
      content.push({
        text: '╭' + short + '─'.repeat(Math.max(0, cardWidth - width(short) - 2)) + '╮',
        indent: 2,
        card: true,
        edge: true,
        action: 'fold',
        index,
        tone: block.failed ? 'warning' : 'soft',
      });
      const bodyLine = (text, style) => ({
        text: '│ ' + text + ' '.repeat(Math.max(0, bodyWidth - width(text))) + ' │',
        indent: 2,
        card: true,
        style,
        tone: block.failed ? 'warning' : 'soft',
      });
      if (expanded) {
        if (block.cacheText !== block.text || block.cacheWidth !== bodyWidth) {
          block.cardLines = wrap(block.text || '(No details)', bodyWidth);
          block.cacheText = block.text;
          block.cacheWidth = bodyWidth;
        }
        for (const text of block.cardLines) content.push(bodyLine(text));
        if (block.output) {
          const outputExpanded = block.outputExpanded ?? false;
          content.push({
            ...bodyLine(
              clip(
                `${outputExpanded ? '▾' : '▸'} ${t('Console / result')} · ${block.output.split('\n').length}`,
                bodyWidth,
              ),
            ),
            action: 'fold-output',
            index,
          });
          if (outputExpanded) {
            if (block.cacheOutput !== block.output || block.outputWidth !== bodyWidth) {
              block.outputLines = wrap(block.output, bodyWidth);
              block.cacheOutput = block.output;
              block.outputWidth = bodyWidth;
            }
            for (const text of block.outputLines) content.push(bodyLine(text));
          }
        }
      }
      content.push({
        text: '╰' + '─'.repeat(cardWidth - 2) + '╯',
        indent: 2,
        card: true,
        edge: true,
        tone: 'dim',
      });
      content.push({ text: '' });
      return;
    }
    if (block.kind === 'assistant' && block.phase === 'final') {
      // Collapsed cards have no trailing gap; keep the result visually separate from them.
      if (content.at(-1)?.card) content.push({ text: '' });
      content.push({ text: t('Result'), indent: 2, tone: 'soft' });
    }
    const indent = 2;
    const available = size - indent - 2;
    const visibleText = block.kind === 'assistant' ? block.text.trim() : t(block.text);
    if (!visibleText) return;
    if (block.wrapWidth !== available || block.wrapText !== visibleText) {
      block.wrapped =
        block.kind === 'assistant'
          ? outputLines(visibleText, available)
          : wrap(visibleText, available).map((text) => ({ text }));
      block.wrapWidth = available;
      block.wrapText = visibleText;
    }
    for (const line of block.wrapped)
      content.push({
        ...line,
        indent,
        tone:
          block.kind === 'error'
            ? 'warning'
            : block.kind === 'notice' || block.phase === 'update'
              ? 'dim'
              : 'text',
      });
    content.push({ text: '' });
  });
  return content;
}
module.exports = { outputLines, codeSpans, transcriptLines, foldable, formatToolResult };
