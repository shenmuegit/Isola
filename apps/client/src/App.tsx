import { PluginFrame } from './PluginFrame.js';
import { useEffect, useRef } from 'react';
import { bindViewport } from './viewport.js';

export function App() {
  const params = new URLSearchParams(location.search);
  const entryUrl = params.get('entry');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => bindViewport(root.current!), []);
  return <div ref={root} style={{ position: 'fixed', boxSizing: 'border-box', padding: 'env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)' }}>
    {entryUrl ? <PluginFrame releaseId={params.get('release') ?? ''} entryUrl={entryUrl} /> : <main><h1>Isola</h1></main>}
  </div>;
}
