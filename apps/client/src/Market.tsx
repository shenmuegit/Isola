import { useEffect, useState, type FormEvent } from 'react';
import { PLUGIN_API_VERSION, type PluginManifest } from '@isola/plugin';

export type Release = { id: string; manifest: PluginManifest; entryUrl: string };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? `HTTP ${response.status}`);
  return result;
}

export function Market({ onOpen }: { onOpen: (release: Release) => void }) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [installed, setInstalled] = useState<Release[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  async function load() {
    const [releases, installations] = await Promise.all([request<Release[]>('/api/market/releases'), request<Release[]>('/api/installations')]);
    setReleases(releases); setInstalled(installations);
  }
  useEffect(() => { void load().catch(cause => setError(cause.message)); }, []);
  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get('package') as File;
    setBusy('publish'); setError(''); setStatus('');
    try {
      await request('/api/market/releases', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      await load(); setStatus('已发布');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  }
  async function install(release: Release) {
    setBusy(release.id); setError(''); setStatus('');
    try {
      const result = await request<Release>('/api/installations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ releaseId: release.id }) });
      setInstalled(previous => [...previous.filter(item => item.manifest.name !== result.manifest.name), result]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  }
  return <main style={{ overflow: 'auto' }}>
    <h1>插件市场</h1>
    <form onSubmit={publish}><label>插件包<input name="package" type="file" accept=".tgz" required disabled={Boolean(busy)} /></label><button type="submit" disabled={Boolean(busy)}>发布</button></form>
    {error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    {releases.map(release => {
      const installation = installed.find(item => item.id === release.id);
      const compatible = release.manifest.isola.apiVersion === PLUGIN_API_VERSION;
      return <article key={release.id} aria-label={`${release.manifest.isola.title} ${release.manifest.version}`}>
        <h2>{release.manifest.isola.title} <small>{release.manifest.version}</small></h2><p>{release.manifest.description}</p>
        {!compatible ? <p role="alert">插件接口版本 {release.manifest.isola.apiVersion} 与当前客户端接口版本 {PLUGIN_API_VERSION} 不兼容</p> : installation ? <button disabled={Boolean(busy)} onClick={() => onOpen(installation)}>打开</button> : <button disabled={Boolean(busy)} onClick={() => void install(release)}>{busy === release.id ? '安装中…' : '安装'}</button>}
      </article>;
    })}
  </main>;
}
