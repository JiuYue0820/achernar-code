'use strict';
const { safeText } = require('./tui-text');

function sessionTitle(session) {
  return safeText(
    String(session.messages?.find((message) => message.role === 'user')?.content || session.id),
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** Select or delete a saved record without touching its project files. */
async function selectSession({ ui, listSessions, deleteSession, currentId, onDeleted }) {
  const t = (text) => require('./i18n').translate(ui.state.language, text);
  while (true) {
    const sessions = listSessions();
    if (!sessions.length) {
      ui.notice('No saved sessions yet. Send a task to start one.');
      return;
    }
    const selected = await ui.choose(
      'Sessions',
      sessions.map((session) => ({
        value: session.id,
        command: sessionTitle(session),
        description: [
          ...(session.id === currentId() ? [t('Current session')] : []),
          (session.updatedAt || '').slice(0, 16),
          session.project,
        ]
          .filter(Boolean)
          .join(' · '),
        editable: Boolean(deleteSession),
      })),
      undefined,
      deleteSession
        ? { actions: [{ key: 'delete', label: 'Del Delete', action: 'delete', danger: true }] }
        : {},
    );
    if (!selected) return;
    const id = typeof selected === 'object' ? selected.value : selected;
    const target = sessions.find((session) => session.id === id);
    if (!target) continue;
    if (!deleteSession) return id;
    const context = [sessionTitle(target), target.id];
    const action =
      selected.action ||
      (await ui.choose(
        'Session actions',
        [
          {
            value: 'resume',
            command: 'Resume session',
            description: 'Open its project and conversation',
          },
          {
            value: 'delete',
            command: 'Delete session',
            description: 'Remove history only; keep project files',
            danger: true,
          },
          { value: 'back', command: 'Back to sessions', description: '' },
        ],
        undefined,
        { context },
      ));
    if (action === 'resume') return id;
    if (action !== 'delete') continue;
    const confirm = await ui.choose(
      'Delete this session?',
      [
        { value: 'keep', command: 'Keep session', description: 'Return without deleting' },
        {
          value: 'delete',
          command: 'Delete session',
          description: 'Permanently remove this conversation record',
          danger: true,
        },
      ],
      undefined,
      { context: [...context, t('Remove history only; keep project files')] },
    );
    if (confirm !== 'delete') continue;
    try {
      await deleteSession(id);
    } catch (error) {
      ui.notice(error.message, 'error');
      ui.toast?.(error.message);
      continue;
    }
    onDeleted(id);
    const message = 'Session deleted. Project files were kept.';
    ui.notice(message);
    ui.toast?.(message);
  }
}

module.exports = { selectSession, sessionTitle };
