import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import type { PluginMenuItem } from '@isola/plugin';
import { PluginFrame, PluginMenuActions } from '../../../apps/client/src/PluginFrame.js';
import { bindViewport } from '../../../apps/client/src/viewport.js';
import { App } from '../../../apps/client/src/App.js';
import '../../../apps/client/src/app.css';

function Host() {
  const root = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<PluginMenuItem[]>([]);
  const [error, setError] = useState('');
  const params = new URLSearchParams(location.search);
  useEffect(() => bindViewport(root.current!), []);
  return <div ref={root} style={{ position: 'fixed' }}><PluginMenuActions items={menu} />{error && <p role="alert">{error}</p>}<PluginFrame onMenuChange={setMenu} onMenuError={setError} releaseId={params.get('release') ?? ''} entryUrl={params.get('entry') ?? ''} /></div>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).get('mode') === 'app' ? <App /> : <Host />);
