import {
  PLUGIN_API_VERSION,
  manifestSchema,
  type BridgeMessage,
  type PluginClient,
  type PluginManifest,
  type RequestOptions,
} from '../src/index.js';

const manifest: PluginManifest = {
  name: '@isola/notes',
  version: '1.0.0',
  description: 'Notes example',
  isola: {
    title: 'Notes',
    apiVersion: PLUGIN_API_VERSION,
    entry: 'dist/index.html',
    server: { image: 'isola/notes:1.0.0' },
  },
};

const wrongVersion: PluginManifest = {
  ...manifest,
  isola: {
    ...manifest.isola,
    // @ts-expect-error Only API version 1 is supported.
    apiVersion: 2,
  },
};

const clientSelection: PluginManifest = {
  ...manifest,
  isola: {
    ...manifest.isola,
    // @ts-expect-error All clients load the same frontend entry.
    client: 'desktop',
  },
};

const options: RequestOptions = { method: 'POST', body: { text: 'hello' } };
const messages: BridgeMessage[] = [
  { type: 'request', id: '1', path: '/notes', options },
  { type: 'subscribe', id: '2', path: '/notes/events' },
  { type: 'unsubscribe', id: '2' },
  { type: 'result', id: '1', data: { id: 'note' } },
  { type: 'event', id: '2', data: { text: 'hello' } },
  { type: 'error', id: '1', message: 'Request failed' },
];

async function useClient(client: PluginClient): Promise<string> {
  const note = await client.request<{ text: string }>('/notes', options);
  const unsubscribe = client.subscribe('/notes/events', (data: unknown) => void data);
  unsubscribe();
  return note.text;
}

void [manifestSchema, wrongVersion, clientSelection, messages, useClient];
