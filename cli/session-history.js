'use strict';
const path = require('node:path'),
  { randomUUID } = require('node:crypto');
const { createTurnHistory } = require('../src/services/turn-history');
function createSessionHistory(home, sessionId, limits = {}) {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(sessionId || ''))
    throw new Error('Invalid checkpoint session ID');
  // Separate transaction journals prevent one session from recovering another
  // session's in-flight undo. The caller holds that session's exclusive lock.
  const history = createTurnHistory(path.join(home, 'checkpoints', sessionId), {
    ...limits,
    excludePaths: [path.resolve(home)],
  });
  const recover = (session) =>
    history.recover((id) => (session.historyTransactions || []).includes(id));
  function start(session) {
    if (session.pendingTurn) {
      session.turns ||= [];
      session.turns.push({
        ...session.pendingTurn,
        end: session.messages.length,
        available: false,
        reason: 'Interrupted checkpoint; inspect files before continuing.',
      });
    }
    const turn = {
      id: randomUUID(),
      start: session.messages.length,
      records: [],
      available: true,
      files: 0,
      previousEvents: session.lastEvents || [],
    };
    session.pendingTurn = turn;
    delete session.redoStack;
    const recorders = new Map();
    let queue = Promise.resolve();
    async function track(project, operation, scope) {
      let recorder = recorders.get(project);
      if (!recorder) {
        const id = randomUUID();
        recorder = await history.start({ sessionId, messageId: id, project });
        recorders.set(project, recorder);
        turn.records.push({ role: 'assistant', id });
      }
      return recorder.track(operation, scope);
    }
    return {
      unavailable(reason) {
        turn.available = false;
        turn.reason = reason;
      },
      track(project, operation, scope) {
        const pending = queue.then(() => track(project, operation, scope));
        queue = pending.catch(() => {});
        return pending;
      },
      async finish(session) {
        await queue;
        for (const recorder of recorders.values()) {
          const result = await recorder.finish();
          turn.available &&= result.available;
          turn.files += result.files;
          if (!result.available) turn.reason = result.reason;
        }
        turn.end = session.messages.length;
        turn.events = session.lastEvents || [];
        turn.status = session.status;
        session.turns ||= [];
        session.turns.push(turn);
        delete session.pendingTurn;
        return { available: turn.available, files: turn.files, reason: turn.reason || '' };
      },
    };
  }
  async function change(session, save, direction, targetStart) {
    await recover(session);
    const redo = direction === 'redo',
      redoEntry = session.redoStack?.at(-1);
    const chosen = redo
      ? redoEntry?.turns || (redoEntry ? [redoEntry.turn] : [])
      : targetStart == null
        ? session.turns?.slice(-1)
        : session.turns?.slice(session.turns.findIndex((turn) => turn.start === targetStart));
    if (!redo && targetStart != null && !session.turns?.some((turn) => turn.start === targetStart))
      throw new Error('This message has no complete task checkpoint.');
    const turn = chosen?.[0],
      last = chosen?.at(-1);
    if (!turn) throw new Error('No session checkpoint available to ' + direction);
    if (session.pendingTurn)
      throw new Error(
        'A task checkpoint is still running or interrupted; resume or stop it first.',
      );
    if (chosen.some((t) => !t.available))
      throw new Error(
        'This checkpoint has no complete snapshot: ' +
          (chosen.find((t) => !t.available).reason || 'unavailable'),
      );
    if (
      (!redo && last.end !== session.messages.length) ||
      chosen.some((t, i) => i && t.start !== chosen[i - 1].end)
    )
      throw new Error('Conversation changed after this checkpoint; no files were restored.');
    const changes = await history.compose(
      sessionId,
      chosen.flatMap((t) => t.records),
    );
    const transaction = await history.apply(changes, direction);
    const original = structuredClone(session),
      next = structuredClone(session);
    if (redo) {
      const entry = next.redoStack.pop();
      if (next.messages.length !== turn.start) {
        await transaction.rollback();
        throw new Error('Conversation changed since undo');
      }
      next.messages.push(...entry.messages);
      next.turns.push(...chosen);
      next.lastEvents = last.events;
      next.status = last.status || 'complete';
    } else {
      const messages = next.messages.splice(turn.start);
      next.turns.splice(next.turns.length - chosen.length);
      next.redoStack ||= [];
      next.redoStack.push({ turn, turns: chosen, messages });
      next.lastEvents = turn.previousEvents;
      next.status = 'undone';
      delete next.error;
    }
    next.historyTransactions = [...(next.historyTransactions || []), transaction.id];
    next.updatedAt = new Date().toISOString();
    try {
      await save(next);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    for (const key of Object.keys(session)) delete session[key];
    Object.assign(session, next);
    await transaction.commit();
    return {
      action: direction,
      files: chosen.reduce((sum, t) => sum + t.files, 0),
      tasks: chosen.length,
      prompt: !redo
        ? original.messages.slice(turn.start).find((message) => message.role === 'user')?.content ||
          ''
        : '',
      sessionId,
    };
  }
  return {
    start,
    recover,
    undo: (session, save) => change(session, save, 'undo'),
    undoTo: (session, save, start) => change(session, save, 'undo', start),
    redo: (session, save) => change(session, save, 'redo'),
  };
}
module.exports = { createSessionHistory };
