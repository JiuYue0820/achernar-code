'use strict';
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

// Bounded stdio JSON-RPC. No arbitrary server commands or workspace edits are accepted.
class LspClient extends EventEmitter {
  constructor(command, args, { cwd, env, signal } = {}) {
    super();
    signal?.throwIfAborted();
    this.pending = new Map();
    this.sequence = 0;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    this.child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.stderr = '';
    this.child.stderr.on('data', (data) => {
      this.stderr = (this.stderr + data.toString()).slice(-4000);
    });
    this.child.stdin.on('error', (error) => this.fail(error));
    this.child.stdout.on('data', (data) => {
      try {
        this.consume(data);
      } catch (error) {
        this.fail(error);
        this.kill();
      }
    });
    this.child.on('error', (error) => this.fail(error));
    this.child.on('close', () => {
      this.closed = true;
      signal?.removeEventListener('abort', abort);
      this.fail(new Error('Language server stopped'));
    });
    const abort = () => {
      this.fail(signal.reason);
      this.kill();
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  }
  fail(error) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
  send(message) {
    if (this.closed || this.child.stdin.destroyed) throw new Error('Language server is closed');
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }));
    this.child.stdin.write(
      Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]),
    );
  }
  notify(method, params) {
    this.send({ method, params });
  }
  request(method, params, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        try {
          this.notify('$/cancelRequest', { id });
        } catch {}
        reject(new Error(`Language server timed out: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  consume(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    if (this.buffer.length > 16 * 1024 * 1024)
      throw new Error('Language server frame exceeds 16 MB');
    while (true) {
      const end = this.buffer.indexOf('\r\n\r\n');
      if (end < 0) {
        if (this.buffer.length > 8192) throw new Error('Invalid language server header');
        return;
      }
      const match = /^Content-Length:\s*(\d+)\s*$/im.exec(
        this.buffer.subarray(0, end).toString('ascii'),
      );
      const length = match ? Number(match[1]) : NaN;
      if (!Number.isSafeInteger(length) || length < 0 || length > 16 * 1024 * 1024)
        throw new Error('Invalid language server frame length');
      if (this.buffer.length < end + 4 + length) return;
      const message = JSON.parse(this.buffer.subarray(end + 4, end + 4 + length).toString('utf8'));
      this.buffer = this.buffer.subarray(end + 4 + length);
      if (message.method && message.id != null) {
        if (message.method === 'workspace/configuration')
          this.send({ id: message.id, result: (message.params?.items || []).map(() => null) });
        else if (message.method === 'workspace/applyEdit')
          this.send({
            id: message.id,
            result: { applied: false, failureReason: 'Achernar language tools are read-only' },
          });
        else
          this.send({
            id: message.id,
            error: { code: -32601, message: 'Client request unsupported' },
          });
      } else if (message.method) this.emit('notification', message);
      else {
        const entry = this.pending.get(message.id);
        if (!entry) continue;
        clearTimeout(entry.timer);
        this.pending.delete(message.id);
        if (message.error)
          entry.reject(
            new Error(String(message.error.message || 'Language server request failed')),
          );
        else entry.resolve(message.result);
      }
    }
  }
  kill() {
    if (!this.child.pid || this.closed) return;
    if (process.platform === 'win32')
      spawn('taskkill.exe', ['/pid', String(this.child.pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      }).on('error', () => this.child.kill());
    else {
      try {
        process.kill(-this.child.pid, 'SIGKILL');
      } catch {}
    }
  }
  async close() {
    if (this.closed) return;
    try {
      await this.request('shutdown', null, 1000);
      this.notify('exit');
    } catch {}
    // tsserver is a grandchild. Kill the owned tree before the language server exits.
    this.kill();
    this.fail(new Error('Language server session closed'));
  }
}
module.exports = { LspClient };
