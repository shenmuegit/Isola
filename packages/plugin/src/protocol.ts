export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
};

export interface PluginClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  subscribe(path: string, listener: (data: unknown) => void): () => void;
  registerMenu(items: PluginMenuItem[]): () => void;
}

export type PluginMenuItem = {
  id: string;
  label: string;
  disabled?: boolean;
  file?: { accept: string; multiple?: boolean };
  onSelect: (files: File[]) => void | Promise<void>;
};

export type BridgeMessage =
  | { type: 'disconnect' }
  | { type: 'menu-register'; id: string; items: Omit<PluginMenuItem, 'onSelect'>[] }
  | { type: 'menu-unregister'; id: string }
  | { type: 'menu-select'; id: string; itemId: string; files: File[] }
  | { type: 'menu-error'; id: string; message: string }
  | { type: 'request'; id: string; path: string; options?: RequestOptions }
  | { type: 'subscribe'; id: string; path: string }
  | { type: 'unsubscribe'; id: string }
  | { type: 'result'; id: string; data: unknown }
  | { type: 'event'; id: string; data: unknown }
  | { type: 'error'; id: string; message: string };
