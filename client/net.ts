import type { ClientMsg, ServerMsg } from '../shared/protocol';

export type Status = 'connecting' | 'open' | 'closed';

/**
 * A WebSocket that reconnects on its own. `hello` is sent first on every
 * (re)connection; messages sent while offline are queued and flushed after it.
 */
export class Connection {
  status: Status = 'connecting';
  private ws: WebSocket | null = null;
  private queue: ClientMsg[] = [];
  private flushed: ClientMsg[] = [];
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hb: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(
    private hello: () => ClientMsg,
    private onMsg: (m: ServerMsg) => void,
    private onStatus: (s: Status) => void,
  ) {
    this.connect();
    document.addEventListener('visibilitychange', this.wake);
    window.addEventListener('online', this.wake);
  }

  private wake = () => {
    if (document.visibilityState === 'visible' && this.status === 'closed') { this.retry = 0; this.connect(); }
  };

  private setStatus(s: Status) { this.status = s; this.onStatus(s); }

  private connect() {
    if (this.stopped) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.ws?.close();
    this.setStatus('connecting');
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify(this.hello()));
      this.flushed = this.queue.splice(0);
      for (const m of this.flushed) ws.send(JSON.stringify(m));
      this.setStatus('open');
      if (this.hb) clearInterval(this.hb);
      this.hb = setInterval(() => this.send({ type: 'hb' }), 20_000);
    };
    ws.onmessage = (e) => {
      try { this.onMsg(JSON.parse(String(e.data)) as ServerMsg); } catch (err) { console.error('bad message', err); }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      if (this.hb) clearInterval(this.hb);
      this.setStatus('closed');
      if (this.stopped) return;
      const delay = Math.min(5000, 400 * 2 ** this.retry++);
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }

  /** Messages flushed from the offline queue on the latest connection. */
  takeFlushed(): ClientMsg[] { const f = this.flushed; this.flushed = []; return f; }

  send(m: ClientMsg, queueIfOffline = true) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.status === 'open') this.ws.send(JSON.stringify(m));
    else if (queueIfOffline && m.type === 'op') this.queue.push(m);
  }

  reconnect() { this.retry = 0; this.connect(); }

  close() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.hb) clearInterval(this.hb);
    document.removeEventListener('visibilitychange', this.wake);
    window.removeEventListener('online', this.wake);
    this.ws?.close();
  }
}
