import { PluginFrame } from './PluginFrame.js';
import { useEffect, useRef } from 'react';
import { bindViewport } from './viewport.js';
import { useState, type FormEvent } from 'react';
import { createAuthClient } from 'better-auth/react';
import { Market, type Release } from './Market.js';

const auth = createAuthClient();

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
  return <div ref={root} style={{ display: 'flex', flexDirection: 'column', position: 'fixed', boxSizing: 'border-box', overflow: 'auto', padding: 'env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)' }}>
    {isPending ? <p role="status">正在读取会话…</p> : session ? <>
      <header><strong>Isola</strong> · {session.user.name} <button onClick={() => void auth.signOut().then(result => {
        if (result.error) setError(result.error.message ?? '退出失败');
        else setSelected(undefined);
      }).catch(cause => setError(String(cause)))}>退出登录</button></header>
      {error && <p role="alert">{error}</p>}
      {selected ? <><nav><button onClick={() => setSelected(undefined)}>返回市场</button> {selected.manifest.isola.title}</nav><div style={{ flex: 1, minHeight: 0 }}><PluginFrame releaseId={selected.id} entryUrl={selected.entryUrl} /></div></> : <Market key={session.user.id} onOpen={setSelected} />}
    </> : <main>
      <h1>Isola</h1><h2>{register ? '注册' : '登录'}</h2>
      {(error || sessionError) && <p role="alert">{error || sessionError?.message}</p>}
      <form onSubmit={submit}>
        {register && <label>姓名<input name="name" autoComplete="name" required /></label>}
        <label>邮箱<input name="email" type="email" autoComplete="email" required /></label>
        <label>密码<input name="password" type="password" minLength={8} autoComplete={register ? 'new-password' : 'current-password'} required /></label>
        <button disabled={busy} type="submit">{register ? '注册' : '登录'}</button>
      </form>
      <button disabled={busy} onClick={() => { setRegister(!register); setError(''); }}>{register ? '已有账号' : '创建账号'}</button>
    </main>}
  </div>;
}
