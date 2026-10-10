import { useEffect, useRef } from 'react';
import type { BridgeMessage } from '@isola/plugin';

export function PluginFrame({ releaseId, entryUrl }: { releaseId: string; entryUrl: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const disconnect = useRef<() => void>(() => {});

  useEffect(() => {
    const connect = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== 'isola:connect' || event.data.apiVersion !== 1) return;
      disconnect.current();
      const channel = new MessageChannel();
      const port = channel.port1;
      const requests = new Map<string, AbortController>();
      const subscriptions = new Map<string, EventSource>();
      let closed = false;
      const send = (message: BridgeMessage) => { if (!closed) port.postMessage(message); };
      const close = () => {
        if (closed) return;
        for (const [id, controller] of requests) {
          send({ type: 'error', id, message: 'Plugin connection closed' });
          controller.abort();
        }
        for (const subscription of subscriptions.values()) subscription.close();
        requests.clear();
        subscriptions.clear();
        closed = true;
        port.close();
      };
      disconnect.current = close;
      const businessUrl = (path: string) => {
        if (typeof path !== 'string' || !path || path.includes('\\') || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path)) throw new Error('Expected a relative plugin business path');
        const prefix = `/api/plugins/${encodeURIComponent(releaseId)}/api/`;
        const url = new URL(prefix + path.replace(/^\//, ''), window.location.origin);
        if (!url.pathname.startsWith(prefix) || decodeURIComponent(url.pathname).split('/').includes('..')) throw new Error('Plugin path must stay inside its business API');
        return url.href;
      };
      port.onmessage = async ({ data }: MessageEvent<BridgeMessage>) => {
        if (!data || typeof data.id !== 'string') return;
        try {
          if (data.type === 'unsubscribe') {
            subscriptions.get(data.id)?.close();
            subscriptions.delete(data.id);
            return;
          }
          if (data.type !== 'request' && data.type !== 'subscribe') return;
          const url = businessUrl(data.path);
          if (requests.has(data.id) || subscriptions.has(data.id)) throw new Error('Duplicate plugin message id');
          if (data.type === 'subscribe') {
            const subscription = new EventSource(url, { withCredentials: true });
            subscriptions.set(data.id, subscription);
            subscription.onmessage = event => {
              try { send({ type: 'event', id: data.id, data: JSON.parse(event.data) }); }
              catch { send({ type: 'error', id: data.id, message: 'Invalid JSON subscription event' }); }
            };
            subscription.onerror = () => {
              subscription.close();
              subscriptions.delete(data.id);
              send({ type: 'error', id: data.id, message: 'Plugin subscription failed' });
            };
            return;
          }
          const method = data.options?.method ?? 'GET';
          if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) throw new Error('Unsupported plugin request method');
          const controller = new AbortController();
          requests.set(data.id, controller);
          const timer = window.setTimeout(() => controller.abort(new Error('Plugin request timed out after 30 seconds')), 30_000);
          try {
            const body = data.options?.body;
            const response = await fetch(url, {
              method,
              credentials: 'same-origin',
              signal: controller.signal,
              body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
              headers: body === undefined || body instanceof Blob ? undefined : { 'Content-Type': 'application/json' },
            });
            if (!response.ok) throw new Error(`Plugin request failed: HTTP ${response.status} ${response.statusText}`);
            send({ type: 'result', id: data.id, data: response.status === 204 ? undefined : await response.json() });
          } finally {
            window.clearTimeout(timer);
            requests.delete(data.id);
          }
        } catch (error) {
          send({ type: 'error', id: data.id, message: error instanceof Error ? error.message : String(error) });
        }
      };
      port.onmessageerror = close;
      port.addEventListener('close', close);
      frame.current!.contentWindow!.postMessage({ type: 'isola:connect', apiVersion: 1 }, '*', [channel.port2]);
    };
    window.addEventListener('message', connect);
    return () => { window.removeEventListener('message', connect); disconnect.current(); };
  }, [releaseId, entryUrl]);

  return <iframe ref={frame} title="插件" sandbox="allow-scripts" src={entryUrl} onLoad={() => disconnect.current()} style={{ display: 'block', width: '100%', height: '100%', border: 0 }} />;
}
