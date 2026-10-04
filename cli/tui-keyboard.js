'use strict';
// Input routing is separate from rendering and provider events. Dialogs own
// their keys before global shortcuts; selecting text owns Ctrl+C before cancel.
function handleKey(ui, name, text) {
  if (ui.closed) return;
  if (name === 'mouse') {
    ui.mouse(text);
    return;
  }
  if (ui.selection?.active) {
    if (name === 'cancel') {
      void ui.copy(require('./tui-selection').text(ui.selection));
      return;
    }
    if (name === 'escape') {
      ui.selection = null;
      ui.draw();
      return;
    }
    if (['up', 'down', 'pageup', 'pagedown'].includes(name)) return;
    ui.selection = null;
  }
  if (ui.state.picker && ui.state.picker.actions?.some((action) => action.key === name)) {
    const entry = ui.state.matches[ui.state.selected],
      action = ui.state.picker.actions.find((action) => action.key === name);
    if (entry?.editable) ui.finishQuestion({ action: action.action, value: entry.value });
    ui.draw();
    return;
  }
  if (name === 'edit-model') name = 'end';
  if (!ui.state.question) name = require('./shortcuts').resolve(ui.state.shortcuts, name);
  if (name === 'unbound') return;
  if (name === 'undo-task' || name === 'redo-task') {
    if (!ui.state.question && !ui.state.busy)
      void ui.runCommand(name === 'undo-task' ? '/undo' : '/redo');
    else ui.toast('Finish or stop the current operation before rewinding.');
    return;
  }
  if (name === 'palette') {
    if (!ui.state.question && !ui.state.busy) void ui.commandPalette();
    else ui.toast('Finish the current operation before opening commands.');
    return;
  }
  if (ui.state.viewer) {
    if (['escape', 'enter', 'cancel', 'eof'].includes(name)) ui.finishQuestion('');
    else if (['up', 'down', 'pageup', 'pagedown', 'home', 'end'].includes(name)) {
      const viewer = ui.state.viewer;
      viewer.offset =
        name === 'home'
          ? 0
          : name === 'end'
            ? Number.MAX_SAFE_INTEGER
            : Math.max(0, viewer.offset + { up: -1, down: 1, pageup: -10, pagedown: 10 }[name]);
    }
    ui.draw();
    return;
  }
  if (name === 'fold-plan') {
    if (ui.state.plan && !ui.state.question && !ui.state.menu) {
      ui.state.plan.expanded = !ui.state.plan.expanded;
      ui.draw();
    }
    return;
  }
  if (['toggle-details', 'toggle-thinking'].includes(name)) {
    if (!ui.state.question) ui.display(name.slice(7));
    ui.draw();
    return;
  }
  if (name === 'fold-latest' || name === 'fold-all') {
    if (!ui.state.question && !ui.state.menu) {
      const blocks = ui.state.logs.filter(require('./tui-output').foldable);
      if (name === 'fold-all') {
        const expanded = blocks.some((b) => !b.expanded);
        for (const block of blocks) {
          block.expanded = expanded;
          block.outputExpanded = expanded;
          block.userFolded = true;
        }
      } else if (blocks.length) {
        const block = blocks.at(-1);
        block.expanded = !block.expanded;
        block.userFolded = true;
        ui.state.scrollAnchor = { index: ui.state.logs.indexOf(block), action: 'fold', row: 3 };
      }
      ui.draw();
    }
    return;
  }
  if (name === 'cycle-approval' || name === 'cycle-mode') {
    if (!ui.state.form) ui.onControl?.(name);
    ui.draw();
    return;
  }
  if (name === 'cancel' || (name === 'eof' && !ui.editor.text)) {
    if (ui.state.busy) {
      ui.onCancel?.();
      ui.finishQuestion('');
      return;
    }
    ui.onExit?.();
    return;
  }
  if (name === 'escape') {
    if (ui.state.form) ui.finishQuestion({ action: 'back', value: ui.editor.text });
    else if (ui.state.question) ui.finishQuestion('');
    else if (ui.state.menu) ui.state.menu = false;
    else if (ui.state.busy) ui.onCancel?.();
    ui.draw();
    return;
  }
  if (name === 'pageup' || name === 'pagedown') {
    if (ui.state.approvalRequest?.preview?.diff)
      ui.state.approvalPreviewScroll = Math.max(
        0,
        (ui.state.approvalPreviewScroll || 0) + (name === 'pageup' ? -8 : 8),
      );
    else ui.state.scroll = Math.max(0, ui.state.scroll + (name === 'pageup' ? 8 : -8));
    ui.draw();
    return;
  }
  if (name === 'redraw') {
    ui.previous = [];
    ui.draw();
    return;
  }
  if (name === 'enter' && !ui.state.form && /^\/(?:approval|mode)(?:\s|$)/.test(ui.editor.text)) {
    const command = ui.editor.text.trim();
    ui.editor.set('');
    ui.state.menu = false;
    if (ui.onControl) {
      try {
        ui.onControl(command);
      } catch (error) {
        ui.toast(error.message);
      }
      ui.draw();
      return;
    }
  }
  if (ui.state.picker && ['up', 'down', 'tab', 'enter'].includes(name)) {
    if (name === 'up' || name === 'down')
      ui.state.selected =
        (ui.state.selected + (name === 'up' ? -1 : 1) + ui.state.matches.length) %
        Math.max(1, ui.state.matches.length);
    else if (ui.state.matches[ui.state.selected])
      ui.finishQuestion(ui.state.matches[ui.state.selected].value);
    ui.draw();
    return;
  }
  if (ui.state.menu && ['up', 'down', 'tab', 'enter'].includes(name)) {
    if (name === 'up' || name === 'down')
      ui.state.selected =
        (ui.state.selected + (name === 'up' ? -1 : 1) + ui.state.matches.length) %
        Math.max(1, ui.state.matches.length);
    else if (ui.state.matches[ui.state.selected]) {
      ui.editor.set(ui.state.matches[ui.state.selected].command + ' ');
      ui.state.menu = false;
    } else if (name === 'enter') ui.state.menu = false;
    const needsArgument = /^\/(?:plan|review|test|cd|add-dir|resume|skill\/|plugin\/)/.test(
      ui.editor.text,
    );
    if (name !== 'enter' || needsArgument) {
      ui.draw();
      return;
    }
  }
  if (name === 'enter') {
    const value = ui.editor.text.trim();
    if (ui.state.form) {
      if (!value && !ui.state.form.allowEmpty) return;
      ui.finishQuestion({ action: 'next', value });
      ui.draw();
      return;
    }
    if (!value) return;
    if (!ui.state.question && value === '/stop') {
      ui.onCancel?.();
      ui.editor.set('');
      ui.state.menu = false;
      ui.toast(ui.state.busy ? 'Stopping…' : 'No task is running.');
      ui.draw();
      return;
    }
    if (!ui.state.question && /^\/(details|thinking)$/.test(value)) {
      ui.display(value.slice(1));
      ui.editor.set('');
      ui.state.menu = false;
      ui.draw();
      return;
    }
    if (ui.onControl && /^\/(?:approval|mode)(?:\s|$)/.test(value)) {
      ui.editor.set('');
      ui.state.menu = false;
      try {
        ui.onControl(value);
      } catch (error) {
        ui.toast(error.message);
      }
      ui.draw();
      return;
    }
    if (ui.state.busy && !ui.state.question) {
      if (value.startsWith('/')) {
        if (
          /^\/(?:model|reasoning|language|shortcuts|help|status|config|output|cost)(?:\s|$)/.test(
            value,
          )
        ) {
          ui.editor.set('');
          ui.state.menu = false;
          void ui.runCommand(value);
        } else
          ui.toast(
            'Unavailable while running. Use /model, /reasoning, /language, /approval or /stop.',
          );
        ui.draw();
        return;
      }
      try {
        if (!ui.onSteer)
          throw new Error('A task is running. Use /approval, /mode, F2 or Shift+Tab.');
        ui.state.queued = ui.onSteer(value);
        ui.editor.set('');
        ui.toast('Queued · applied after the current tool or model response.');
      } catch (error) {
        ui.toast(error.message);
      }
      ui.draw();
      return;
    }
    ui.editor.set('');
    ui.state.menu = false;
    if (ui.state.question) {
      ui.finishQuestion(value);
      ui.draw();
      return;
    }
    ui.history.push(value);
    ui.history = ui.history.slice(-100);
    ui.historyIndex = ui.history.length;
    ui.state.busy = true;
    ui.draw();
    Promise.resolve()
      .then(() => ui.onSubmit(value))
      .catch((error) => ui.notice(error.message, 'error'))
      .finally(() => {
        for (const block of ui.state.logs)
          if (block.running) {
            block.running = false;
            block.stopped = true;
          }
        ui.state.busy = false;
        ui.state.status = '';
        ui.refreshMenu();
        ui.dirty = true;
        ui.draw();
      });
    return;
  }
  if (name === 'up' || name === 'down') {
    if (ui.editor.text.includes('\n')) ui.editor.key(name);
    else if (!ui.state.question) {
      if (ui.historyIndex === ui.history.length && name === 'up') ui.historyDraft = ui.editor.text;
      ui.historyIndex = Math.max(
        0,
        Math.min(ui.history.length, ui.historyIndex + (name === 'up' ? -1 : 1)),
      );
      ui.editor.set(ui.history[ui.historyIndex] ?? ui.historyDraft ?? '');
    }
  } else if (name === 'text') ui.editor.insert(text);
  else if (name === 'newline') ui.editor.insert('\n');
  else ui.editor.key(name);
  ui.refreshMenu();
  ui.draw();
}
module.exports = { handleKey };
