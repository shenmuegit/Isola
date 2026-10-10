export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
};

export interface PluginClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  subscribe(path: string, listener: (data: unknown) => void): () => void;
}

export type BridgeMessage =
  | { type: 'disconnect' }
  | { type: 'request'; id: string; path: string; options?: RequestOptions }
  | { type: 'subscribe'; id: string; path: string }
  | { type: 'unsubscribe'; id: string }
  | { type: 'result'; id: string; data: unknown }
  | { type: 'event'; id: string; data: unknown }
  | { type: 'error'; id: string; message: string };
