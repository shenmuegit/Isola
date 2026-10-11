import { PluginFrame } from './PluginFrame.js';
import { useEffect, useRef } from 'react';
import { bindViewport } from './viewport.js';
import { useState, type FormEvent } from 'react';
import { createAuthClient } from 'better-auth/react';
import { Market, type Release } from './Market.js';

const auth = createAuthClient();

function Brand() {
  return <strong className="brand"><svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M9 23V12h5v11zm0-16h5v3H9zm9 0h5v16h-5z" fill="currentColor" /></svg>Isola</strong>;
}

export function App() {
  const { data: session, isPending, error: sessionError } = auth.useSession();
  const [selected, setSelected] = useState<Release>();
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
      <header className="shell-header">
        <div className="shell-identity"><Brand /><span className="shell-context">你的工作空间</span></div>
        <div className="shell-account"><span className="user-avatar" aria-hidden="true">{session.user.name.slice(0, 1)}</span><span className="user-name" title={session.user.name}>{session.user.name}</span><button className="button button-quiet" onClick={() => void auth.signOut().then(result => {
        if (result.error) setError(result.error.message ?? '退出失败');
        else setSelected(undefined);
      }).catch(cause => setError(String(cause)))}>退出登录</button></div></header>
      {error && <p className="notice notice-error shell-error" role="alert">{error}</p>}
      {selected ? <><nav className="plugin-toolbar" aria-label="插件导航"><button className="button button-quiet back-button" onClick={() => setSelected(undefined)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m11 5-5 5 5 5M6 10h9" /></svg>返回市场</button><span className="plugin-toolbar-title" title={selected.manifest.isola.title}>{selected.manifest.isola.title}</span><span className="version">{selected.manifest.version}</span></nav><div className="plugin-stage"><PluginFrame releaseId={selected.id} entryUrl={selected.entryUrl} /></div></> : <Market key={session.user.id} onOpen={setSelected} />}
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
