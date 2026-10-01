'use strict';
function createTaskInbox({ limit = 8, maxChars = 20000 } = {}) {
  let pending = [],
    closed = false;
  return {
    push(text) {
      if (closed) throw new Error('The task is finishing. Send this as your next message.');
      if (typeof text !== 'string' || !text.trim() || text.length > maxChars)
        throw new Error('Message must contain 1–20000 characters.');
      if (pending.length >= limit)
        throw new Error('The task inbox is full. Wait for queued messages to be applied.');
      pending.push(text.trim());
      return pending.length;
    },
    take() {
      const items = pending;
      pending = [];
      return items;
    },
    close() {
      closed = true;
      const items = pending;
      pending = [];
      return items;
    },
    get count() {
      return pending.length;
    },
  };
}
module.exports = { createTaskInbox };
