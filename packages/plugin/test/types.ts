import {
  PLUGIN_API_VERSION,
  manifestSchema,
  type BridgeMessage,
  type PluginClient,
  type PluginMenuItem,
  type PluginManifest,
  type RequestOptions,
} from '../src/index.js';
import { createElement } from 'react';
import { Columns, Stack, Pane, ListDetail, type PaneProps, type ColumnsProps } from '../src/ui.js';

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
  { type: 'disconnect' },
  { type: 'request', id: '1', path: '/notes', options },
  { type: 'subscribe', id: '2', path: '/notes/events' },
  { type: 'unsubscribe', id: '2' },
  { type: 'result', id: '1', data: { id: 'note' } },
  { type: 'event', id: '2', data: { text: 'hello' } },
  { type: 'error', id: '1', message: 'Request failed' },
];

async function useClient(client: PluginClient): Promise<string> {
  const items: PluginMenuItem[] = [{ id: 'import', label: 'Import', file: { accept: '.txt', multiple: true }, onSelect: async files => { await files[0]?.text(); } }];
  const unregister = client.registerMenu(items);
  unregister();
  const note = await client.request<{ text: string }>('/notes', options);
  const unsubscribe = client.subscribe('/notes/events', (data: unknown) => void data);
  unsubscribe();
  return note.text;
}

void [manifestSchema, wrongVersion, clientSelection, messages, useClient];

const layouts = createElement(Stack, { gap: '1rem', children: createElement(Columns, {
  gap: 24,
  children: [createElement(Pane, { key: 'editor', label: '编辑', flexBasis: 480, flexGrow: 2, children: createElement(Stack, { children: '内容' }) })],
}) });
const optionalDetail = createElement(ListDetail, { list: '列表', detail: layouts, hasSelection: true, onBack: () => {} });
const noClientPane: PaneProps = {
  label: '区域', children: null,
  // @ts-expect-error Plugins do not select a client-specific layout.
  client: 'iphone',
};
const noBreakpoint: ColumnsProps = {
  children: null,
  // @ts-expect-error Layout follows its container, not a plugin-defined device breakpoint.
  breakpoint: 768,
};
void [optionalDetail, noClientPane, noBreakpoint];
