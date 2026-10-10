import { createRoot } from 'react-dom/client';
import { useEffect, useRef } from 'react';
import { PluginFrame } from '../../../apps/client/src/PluginFrame.js';
import { bindViewport } from '../../../apps/client/src/viewport.js';

function Host() {
  const root = useRef<HTMLDivElement>(null);
  const params = new URLSearchParams(location.search);
  useEffect(() => bindViewport(root.current!), []);
  return <div ref={root} style={{ position: 'fixed' }}><PluginFrame releaseId={params.get('release') ?? ''} entryUrl={params.get('entry') ?? ''} /></div>;
}
createRoot(document.getElementById('root')!).render(<Host />);
