export const PLUGIN_API_VERSION = 1;

export type PluginManifest = {
  name: string;
  version: string;
  description: string;
  isola: {
    title: string;
    apiVersion: typeof PLUGIN_API_VERSION;
    entry: 'dist/index.html';
    server?: { image: string };
  };
};

export const manifestSchema = {
  type: 'object',
  required: ['name', 'version', 'description', 'isola'],
  properties: {
    name: { type: 'string' },
    version: { type: 'string' },
    description: { type: 'string' },
    isola: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'apiVersion', 'entry'],
      properties: {
        title: { type: 'string' },
        apiVersion: { type: 'integer', const: PLUGIN_API_VERSION },
        entry: { type: 'string', const: 'dist/index.html' },
        server: {
          type: 'object',
          additionalProperties: false,
          required: ['image'],
          properties: { image: { type: 'string' } },
        },
      },
    },
  },
} as const;
