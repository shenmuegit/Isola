import { useEffect, useRef } from 'react';
import type { BridgeMessage, PluginMenuItem } from '@isola/plugin';

export function PluginMenuActions({ items, onSelect }: { items: PluginMenuItem[]; onSelect?: () => void }) {
  const current = useRef(items);
  current.current = items;
  return <>{items.map(item => <span className="plugin-menu-action" key={item.id}>
    <button disabled={item.disabled} onClick={event => {
      if (item.file) {
        const input = event.currentTarget.nextElementSibling as HTMLInputElement;
        input.value = '';
        // Keep an open picker bound to the registration that opened it.
        input.onchange = () => {
          if (current.current !== items) return;
          const files = Array.from(input.files ?? []);
          if (files.length) { item.onSelect(files); onSelect?.(); }
        };
        input.click();
      } else { item.onSelect([]); onSelect?.(); }
    }}>{item.label}</button>
    {item.file && <input type="file" hidden accept={item.file.accept} multiple={item.file.multiple} />}
  </span>)}</>;
}

function validMenu(items: unknown): items is Omit<PluginMenuItem, 'onSelect'>[] {
  if (!Array.isArray(items)) return false;
  const ids = new Set<string>();
  return items.every(item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || typeof item.label !== 'string' || !item.label || ids.has(item.id)) return false;
    if (item.disabled !== undefined && typeof item.disabled !== 'boolean') return false;
    if (item.file !== undefined && (!item.file || typeof item.file !== 'object' || typeof item.file.accept !== 'string' || (item.file.multiple !== undefined && typeof item.file.multiple !== 'boolean'))) return false;
    ids.add(item.id);
    return true;
  });
}

export function PluginFrame({ releaseId, entryUrl, onMenuChange, onMenuError }: { releaseId: string; entryUrl: string; onMenuChange?: (items: PluginMenuItem[]) => void; onMenuError?: (message: string) => void }) {
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
      let menuId: string | undefined;
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
        menuId = undefined;
        onMenuChange?.([]);
        onMenuError?.('');
        send({ type: 'disconnect' });
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
        if (closed || !data) return;
        if (data.type === 'disconnect') { close(); return; }
        if (typeof data.id !== 'string') return;
        try {
          if (data.type === 'menu-register') {
            if (!data.id || !validMenu(data.items)) throw new Error('Invalid plugin menu entries');
            menuId = data.id;
            onMenuError?.('');
            onMenuChange?.(data.items.map(item => ({ ...item, onSelect: files => {
              if (closed || menuId !== data.id || item.disabled) return;
              onMenuError?.('');
              send({ type: 'menu-select', id: data.id, itemId: item.id, files });
            } })));
            return;
          }
          if (data.type === 'menu-unregister') {
            if (menuId === data.id) { menuId = undefined; onMenuChange?.([]); onMenuError?.(''); }
            return;
          }
          if (data.type === 'menu-error') {
            if (menuId === data.id && typeof data.message === 'string') onMenuError?.(data.message);
            return;
          }
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
          if (data.type === 'menu-register') onMenuError?.(error instanceof Error ? error.message : String(error));
          send({ type: 'error', id: data.id, message: error instanceof Error ? error.message : String(error) });
        }
      };
      port.onmessageerror = close;
      port.addEventListener('close', close);
      frame.current!.contentWindow!.postMessage({ type: 'isola:connect', apiVersion: 1 }, '*', [channel.port2]);
    };
    window.addEventListener('message', connect);
    return () => { window.removeEventListener('message', connect); disconnect.current(); };
  }, [releaseId, entryUrl, onMenuChange, onMenuError]);

  return <iframe ref={frame} title="插件" sandbox="allow-scripts allow-forms" src={entryUrl} onLoad={() => disconnect.current()} style={{ display: 'block', width: '100%', height: '100%', border: 0 }} />;
}
