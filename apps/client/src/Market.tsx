import { useEffect, useState, type FormEvent } from 'react';
import { PLUGIN_API_VERSION, type PluginManifest } from '@isola/plugin';

export type Release = { id: string; manifest: PluginManifest; entryUrl: string };

export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? `HTTP ${response.status}`);
  return result;
}

export function Market({ installed, canInstall, onInstalled, onOpen }: { installed: Release[]; canInstall: boolean; onInstalled: (release: Release) => void; onOpen: (release: Release) => void }) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  async function load(signal?: AbortSignal) {
    const releases = await request<Release[]>('/api/market/releases', { signal });
    if (!signal?.aborted) setReleases(releases);
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
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
      onInstalled(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(''); }
  }
  return <main className="market-page"><div className="market-content">
    <div className="market-heading"><h1>插件市场</h1><p>把需要的工具，带进你的工作空间。</p></div>
    <section className="publish-panel" aria-labelledby="publish-heading"><div><h2 id="publish-heading">分享你的插件</h2><p>选择符合 Isola 规范的 .tgz 插件包。</p></div><form className="publish-form" onSubmit={publish}><label>插件包<input name="package" type="file" accept=".tgz" required disabled={Boolean(busy)} /></label><button className="button button-secondary" type="submit" disabled={Boolean(busy)}>{busy === 'publish' ? '正在发布…' : '发布'}</button></form></section>
    {error && <p className="notice notice-error" role="alert">{error}<button className="text-button" disabled={Boolean(busy)} onClick={() => { setLoading(true); setError(''); void load().catch(cause => setError(cause.message)).finally(() => setLoading(false)); }}>重试</button></p>}{status && <p className="notice notice-success" role="status">{status}</p>}
    {loading && <p className="market-empty" role="status">正在读取插件…</p>}
    {!loading && !error && releases.length === 0 && <div className="market-empty"><h2>还没有插件</h2><p>发布第一个插件，开始建立你的工作空间。</p></div>}
    <div className="plugin-grid">{releases.map(release => {
      const installation = installed.find(item => item.manifest.name === release.manifest.name);
      const current = installation ?? release;
      const updateAvailable = installation && installation.id !== release.id;
      const compatible = release.manifest.isola.apiVersion === PLUGIN_API_VERSION;
      const currentCompatible = current.manifest.isola.apiVersion === PLUGIN_API_VERSION;
      return <article className="plugin-card" key={release.manifest.name} aria-label={`${current.manifest.isola.title} ${current.manifest.version}`}>
        <div className="plugin-card-heading"><span className="plugin-initial" aria-hidden="true">{current.manifest.isola.title.slice(0, 1)}</span><div><h2>{current.manifest.isola.title}</h2><span className="version">{current.manifest.version}</span></div></div><p className="plugin-description">{current.manifest.description}</p>
        {updateAvailable && <p className="plugin-update">可更新至 {release.manifest.version}</p>}
        <div className="plugin-card-footer">{installation && <span className="installed-label">已安装</span>}<div className="plugin-card-actions">{compatible && (!installation || updateAvailable) && <button className="button button-secondary" disabled={Boolean(busy) || !canInstall} onClick={() => void install(release)}>{busy === release.id ? installation ? '更新中…' : '安装中…' : installation ? '更新' : '安装'}</button>}{installation && currentCompatible && <button className="button button-primary" disabled={Boolean(busy)} onClick={() => onOpen(installation)}>打开</button>}</div></div>
        {(!compatible || !currentCompatible) && <p className="compatibility-error" role="alert">插件接口版本 {!currentCompatible ? current.manifest.isola.apiVersion : release.manifest.isola.apiVersion} 与当前客户端接口版本 {PLUGIN_API_VERSION} 不兼容</p>}
      </article>;
    })}</div>
    <footer className="market-footer">Isola<span>你的工具，各有空间。</span></footer>
  </div>
  </main>;
}
