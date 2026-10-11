import { PluginFrame, PluginMenuActions } from './PluginFrame.js';
import { useCallback, useEffect, useRef } from 'react';
import { PLUGIN_API_VERSION, type PluginMenuItem } from '@isola/plugin';
import { bindViewport } from './viewport.js';
import { useState, type FormEvent } from 'react';
import { createAuthClient } from 'better-auth/react';
import { Market, request, type Release } from './Market.js';

const auth = createAuthClient();

function Brand() {
  return <strong className="brand"><svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M9 23V12h5v11zm0-16h5v3H9zm9 0h5v16h-5z" fill="currentColor" /></svg>Isola</strong>;
}

function Workspace({ user, onSignOut }: { user: { name: string }; onSignOut: () => Promise<void> }) {
  const [selected, setSelected] = useState<Release>();
  const [installed, setInstalled] = useState<Release[]>([]);
  const [items, setItems] = useState<PluginMenuItem[]>([]);
  const [menuError, setMenuError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const menu = useRef<HTMLElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void request<Release[]>('/api/installations', { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setInstalled(result);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  const installedRelease = useCallback((release: Release) => {
    setInstalled(previous => [...previous.filter(item => item.manifest.name !== release.manifest.name), release]);
    setSelected(previous => previous?.manifest.name === release.manifest.name ? release : previous);
  }, []);
  const navigate = (release?: Release) => {
    if (release && release.manifest.isola.apiVersion !== PLUGIN_API_VERSION) return;
    if (release && release.id === selected?.id) { menu.current?.hidePopover(); return; }
    setItems([]); setMenuError(''); setSelected(release); menu.current?.hidePopover();
  };
  return <>
    <header className="shell-header"><button className="button button-quiet menu-toggle" popoverTarget="workspace-menu" aria-label="菜单">☰</button><Brand /><span className="shell-page" title={selected?.manifest.isola.title}>{selected?.manifest.isola.title ?? '插件市场'}</span></header>
    <nav ref={menu} id="workspace-menu" className="workspace-menu" popover="auto" aria-label="工作空间导航">
      <div className="menu-group"><button onClick={() => navigate()}>{selected ? '返回市场' : '插件市场'}</button>{installed.map(release => <button key={release.manifest.name} disabled={release.manifest.isola.apiVersion !== PLUGIN_API_VERSION} aria-current={selected?.id === release.id ? 'page' : undefined} onClick={() => navigate(release)}>{release.manifest.isola.title}</button>)}</div>
      {items.length > 0 && <div className="menu-group" aria-label="当前插件操作"><PluginMenuActions items={items} onSelect={() => menu.current?.hidePopover()} /></div>}
      <div className="menu-group"><span className="menu-user">{user.name}</span><button onClick={() => { menu.current?.hidePopover(); void onSignOut().catch(cause => setError(String(cause))); }}>退出登录</button></div>
    </nav>
    {loading && <p className="shell-status" role="status">正在读取已安装插件…</p>}
    {error && <p className="notice notice-error shell-error" role="alert">{error}<button className="text-button" onClick={() => setAttempt(value => value + 1)}>重试</button></p>}
    {menuError && <p className="notice notice-error shell-error" role="alert">{menuError}</p>}
    {selected ? <div className="plugin-stage"><PluginFrame key={selected.id} releaseId={selected.id} entryUrl={selected.entryUrl} onMenuChange={setItems} onMenuError={setMenuError} /></div> : <Market installed={installed} canInstall={!loading && !error} onInstalled={installedRelease} onOpen={navigate} />}
  </>;
}

export function App() {
  const { data: session, isPending, error: sessionError } = auth.useSession();
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => bindViewport(root.current!), []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    const values = new FormData(event.currentTarget);
    try {
      const credentials = { email: String(values.get('email')), password: String(values.get('password')) };
      const result = register ? await auth.signUp.email({ ...credentials, name: String(values.get('name')) }) : await auth.signIn.email(credentials);
      if (result.error) setError(result.error.message ?? '登录失败');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <div ref={root} className="app-root">
    {isPending ? <div className="session-loading"><Brand /><p role="status">正在读取会话…</p></div> : session ? <>
      <Workspace key={session.user.id} user={session.user} onSignOut={async () => {
        const result = await auth.signOut();
        if (result.error) throw new Error(result.error.message ?? '退出失败');
      }} />
    </> : <main className="auth-layout">
      <section className="auth-intro" aria-label="Isola"><Brand /><div className="auth-story"><p className="auth-title">各有空间，<br />又归于一处。</p><p>让不同的工具，回到同一个工作空间。</p><div className="auth-rule" /></div><p className="auth-caption">开源 React 插件框架</p></section>
      <section className="auth-panel" aria-labelledby="auth-heading"><div className="auth-content">
        <h1 id="auth-heading">{register ? '注册' : '登录'}</h1><p className="auth-description">{register ? '创建一个账号，开始使用你的插件。' : '欢迎回来，继续你的工作。'}</p>
        {(error || sessionError) && <p id="auth-error" className="notice notice-error" role="alert">{error || sessionError?.message}</p>}
        <form className="auth-form" onSubmit={submit} aria-busy={busy} aria-describedby={error || sessionError ? 'auth-error' : undefined}>
          {register && <label>姓名<input name="name" autoComplete="name" placeholder="你的名字" disabled={busy} required /></label>}
          <label>邮箱<input name="email" type="email" autoComplete="email" placeholder="you@example.com" disabled={busy} required /></label>
          <label>密码<input name="password" type="password" minLength={8} autoComplete={register ? 'new-password' : 'current-password'} placeholder="至少 8 个字符" disabled={busy} required /></label>
          <button className="button button-primary auth-submit" disabled={busy} type="submit">{busy ? register ? '正在注册…' : '正在登录…' : register ? '注册' : '登录'}</button>
        </form>
        <p className="auth-switch">{register ? '已经有账号？' : '还没有账号？'}<button className="text-button" disabled={busy} onClick={() => { setRegister(!register); setError(''); }}>{register ? '已有账号' : '创建账号'}</button></p>
      </div></section>
    </main>}
  </div>;
}
