'use strict';

// A notification belongs to a task/request, never to a render or token event.
// Keep prompts, file contents, commands and credentials off the lock screen.
function createTaskNotifications({ send, enabled = process.env.ACHERNAR_NOTIFICATIONS !== '0' }) {
  return {
    start({ language = 'zh', source = 'desktop', onClick, enabled: taskEnabled = true, signal: taskSignal } = {}) {
      const seen = new Set(), lifetime = new AbortController(), attention = new AbortController();
      const taskSignals = [lifetime.signal, ...(taskSignal ? [taskSignal] : [])];
      let ended = false, completed = false;
      const notify = async (kind, id, requestSignal) => {
        const signal = AbortSignal.any([...taskSignals, ...(kind === 'complete' ? [] : [attention.signal]), ...(requestSignal ? [requestSignal] : [])]);
        if (!enabled || !taskEnabled || ended || signal.aborted || seen.has(id)) return false;
        seen.add(id);
        const locale = String(language).split(/[-_]/)[0];
        const translated = {
          ru: { complete: ['Задача завершена', 'Результат готов. Вернитесь в Achernar для просмотра.'], approval: ['Требуется разрешение', 'Задача ожидает разрешения. Вернитесь в Achernar.'], question: ['Нужен ваш выбор', 'Задача ожидает ответа. Вернитесь в Achernar.'] },
          ja: { complete: ['タスク完了', '結果の準備ができました。Achernar に戻って確認してください。'], approval: ['承認が必要です', '操作の許可を待っています。Achernar に戻ってください。'], question: ['選択が必要です', '回答を待っています。Achernar に戻ってください。'] },
          ko: { complete: ['작업 완료', '결과가 준비되었습니다. Achernar에서 확인하세요.'], approval: ['승인 필요', '작업이 승인을 기다리고 있습니다. Achernar로 돌아오세요.'], question: ['선택 필요', '작업이 답변을 기다리고 있습니다. Achernar로 돌아오세요.'] },
          es: { complete: ['Tarea completada', 'El resultado está listo. Vuelve a Achernar para revisarlo.'], approval: ['Se requiere aprobación', 'Una tarea espera tu permiso. Vuelve a Achernar.'], question: ['Se necesita tu elección', 'Una tarea espera tu respuesta. Vuelve a Achernar.'] },
        };
        const labels = translated[locale] || (locale === 'en' ? {
          complete: ['Task complete', 'The result is ready. Return to your terminal to review it.'],
          approval: ['Approval required', 'A task is waiting for your permission. Return to your terminal to continue.'],
          question: ['Your choice is needed', 'A task is waiting for your answer. Return to your terminal to continue.'],
        } : {
          complete: ['任务已完成', '结果已准备好，点击返回 Achernar 查看。'],
          approval: ['等待你的审批', '任务已暂停，请返回 Achernar 决定是否执行。'],
          question: ['等待你的选择', '任务需要你的回答，请返回 Achernar 继续。'],
        });
        const [heading, body] = labels[kind];
        try { return await send({ title: `${source === 'cli' ? 'Achernar Code' : 'Achernar'} · ${heading}`, body, kind, onClick, signal }); }
        catch { return false; } // OS notification settings must never fail an agent task.
      };
      return {
        attention(type, id = Symbol(), { signal } = {}) { return type === 'question' || type === 'approval' ? notify(type, id, signal) : Promise.resolve(false); },
        async complete() {
          if (ended) return false;
          attention.abort();
          const result = notify('complete', 'complete'); ended = true; completed = true; return result;
        },
        close() { ended = true; attention.abort(); if (!completed) lifetime.abort(); seen.clear(); },
      };
    },
  };
}

function createElectronNotificationSender({ Notification, initialize = Promise.resolve() }) {
  const active = new Set(); let disposed = false;
  const send = async ({ title, body, onClick, signal }) => {
    try {
      await initialize;
      if (disposed || signal?.aborted || !Notification.isSupported()) return false;
      const item = new Notification({ title, body, timeoutType: 'default' });
      active.add(item);
      const cancel = () => { item.close(); release(); };
      const release = () => { clearTimeout(expiry); active.delete(item); signal?.removeEventListener('abort', cancel); };
      const expiry = setTimeout(release, 120000); expiry.unref?.();
      item.once('close', release); item.once('failed', release);
      item.once('click', () => { release(); Promise.resolve().then(() => onClick?.()).catch(() => {}); });
      signal?.addEventListener('abort', cancel, { once: true });
      item.show(); return true;
    } catch { return false; }
  };
  send.dispose = () => { disposed = true; for (const item of active) item.close(); active.clear(); };
  return send;
}
module.exports = { createTaskNotifications, createElectronNotificationSender };
