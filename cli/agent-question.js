'use strict';
async function answerAgentQuestion(payload, { ui, question, signal }) {
  const options = Array.isArray(payload.options) ? payload.options : [];
  const t = (text) => require('./i18n').translate(ui.state?.language, text);
  if (!ui || !options.length)
    return { approved: true, text: await question(payload.question + ' > ', signal) };
  const selected = new Set();
  while (true) {
    const answer = await ui.choose(
      payload.question,
      [
        ...options.map((text, i) => ({
          value: 'option:' + i,
          command: (payload.multiple ? (selected.has(text) ? '● ' : '○ ') : '') + text,
          description: payload.multiple ? t('Toggle selection') : t('Choose this answer'),
        })),
        ...(payload.multiple
          ? [
              {
                value: 'done',
                command: t('Submit selection'),
                description: `${selected.size} ${t('selected')}`,
              },
            ]
          : []),
        { value: 'custom', command: t('Write an answer'), description: t('Use your own response') },
      ],
      signal,
    );
    signal?.throwIfAborted();
    if (!answer) return { approved: false, selected: [], text: '' };
    if (answer === 'custom') {
      const text = await ui.ask(payload.question, signal);
      return { approved: Boolean(text.trim() || selected.size), selected: [...selected], text };
    }
    if (answer === 'done') {
      if (selected.size) return { approved: true, selected: [...selected], text: '' };
      ui.toast(t('Select at least one answer.'));
      continue;
    }
    const value = options[Number(answer.slice(7))];
    if (!value) continue;
    if (!payload.multiple) return { approved: true, selected: [value], text: '' };
    if (selected.has(value)) selected.delete(value);
    else selected.add(value);
  }
}
module.exports = { answerAgentQuestion };
