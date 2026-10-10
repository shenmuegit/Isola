import type { BridgeMessage, PluginClient, RequestOptions } from './protocol.js';

let connection: Promise<PluginClient> | undefined;

export function connect(): Promise<PluginClient> {
  if (connection) return connection;
  if (window.parent === window) return Promise.reject(new Error('Plugin must run inside its host iframe'));
  connection = new Promise<PluginClient>((resolve, reject) => {
    let startTimer: number | undefined;
    // The iframe load handler closes the previous document's channel.
    const start = () => { startTimer = window.setTimeout(() => window.parent.postMessage({ type: 'isola:connect', apiVersion: 1 }, '*'), 0); };
    const fail = (message: string) => {
      window.clearTimeout(timeout);
      window.clearTimeout(startTimer);
      window.removeEventListener('load', start);
      window.removeEventListener('message', handshake);
      window.removeEventListener('pagehide', leave);
      connection = undefined;
      reject(new Error(message));
    };
    const leave = () => fail('Plugin connection closed');
    const timeout = window.setTimeout(() => fail('Plugin connection timed out after 30 seconds'), 30_000);
    const handshake = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== 'isola:connect' || event.data.apiVersion !== 1 || event.ports.length !== 1) return;
      window.clearTimeout(timeout);
      window.clearTimeout(startTimer);
      window.removeEventListener('load', start);
      window.removeEventListener('message', handshake);
      window.removeEventListener('pagehide', leave);
      const port = event.ports[0]!;
      let nextId = 0;
      let closed = false;
      const requests = new Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: number }>();
      const subscriptions = new Map<string, (data: unknown) => void>();
      const close = () => {
        if (closed) return;
        closed = true;
        port.postMessage({ type: 'disconnect' } satisfies BridgeMessage);
        subscriptions.clear();
        for (const request of requests.values()) {
          window.clearTimeout(request.timer);
          request.reject(new Error('Plugin connection closed'));
        }
        requests.clear();
        port.close();
        connection = undefined;
        window.removeEventListener('pagehide', close);
      };
      port.onmessage = ({ data }: MessageEvent<BridgeMessage>) => {
        if (data?.type === 'event') { subscriptions.get(data.id)?.(data.data); return; }
        if (data?.type !== 'result' && data?.type !== 'error') return;
        const request = requests.get(data.id);
        if (!request) return;
        window.clearTimeout(request.timer);
        requests.delete(data.id);
        if (data.type === 'error') request.reject(new Error(data.message));
        else request.resolve(data.data);
      };
      port.onmessageerror = close;
      port.addEventListener('close', close);
      window.addEventListener('pagehide', close);
      resolve({
        request<T>(path: string, options?: RequestOptions): Promise<T> {
          if (closed) return Promise.reject(new Error('Plugin connection closed'));
          const id = String(++nextId);
          return new Promise<T>((resolveRequest, rejectRequest) => {
            const timer = window.setTimeout(() => {
              requests.delete(id);
              rejectRequest(new Error('Plugin request timed out after 30 seconds'));
            }, 30_000);
            requests.set(id, { resolve: data => resolveRequest(data as T), reject: rejectRequest, timer });
            try { port.postMessage({ type: 'request', id, path, options } satisfies BridgeMessage); }
            catch (error) {
              window.clearTimeout(timer);
              requests.delete(id);
              rejectRequest(error);
            }
          });
        },
        subscribe(path, listener) {
          if (closed) throw new Error('Plugin connection closed');
          const id = String(++nextId);
          subscriptions.set(id, listener);
          port.postMessage({ type: 'subscribe', id, path } satisfies BridgeMessage);
          return () => {
            if (subscriptions.delete(id) && !closed) port.postMessage({ type: 'unsubscribe', id } satisfies BridgeMessage);
          };
        },
      });
    };
    window.addEventListener('message', handshake);
    window.addEventListener('pagehide', leave);
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
  });
  return connection;
}
