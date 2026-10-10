import { Fragment, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { connect, type PluginClient } from '@isola/plugin';
import { Columns, Stack, Pane, ListDetail } from '@isola/plugin/ui';

const earlyConnection = new URLSearchParams(location.search).get('mode') === 'auto' ? connect() : null;

function Editor() {
  const [text, setText] = useState('');
  return <label>内容<textarea value={text} onChange={event => setText(event.target.value)} /></label>;
}

function Fixture() {
  const [extra, setExtra] = useState(false);
  const [selected, setSelected] = useState(false);
  const [output, setOutput] = useState('');
  const mode = new URLSearchParams(location.search).get('mode');
  const automatic = useRef<PluginClient | null>(null);
  useEffect(() => {
    if (earlyConnection) void earlyConnection.then(client => { automatic.current = client; setOutput('已连接'); }).catch(error => setOutput(error.message));
  }, [mode]);
  if (mode === 'form') return <form onSubmit={event => {
    event.preventDefault();
    const text = new FormData(event.currentTarget).get('text');
    void connect().then(async client => setOutput(JSON.stringify(await client.request('/json', { method: 'POST', body: { text } })))).catch(error => setOutput(error.message));
  }}>
    <label htmlFor="form-text">内容</label><input id="form-text" name="text" required />
    <button type="submit">保存表单</button><output>{output}</output>
  </form>;
  if (mode === 'auto') return <Stack>
    <img src="/delayed-image" alt="加载中的图片" />
    <button onClick={() => void automatic.current?.request('/json').then(data => setOutput(JSON.stringify(data))).catch(error => setOutput(error.message))}>自动连接请求</button>
    <output>{output}</output>
  </Stack>;
  if (mode === 'bridge') return <Stack>
    <button onClick={() => void connect().then(async client => {
      setOutput(JSON.stringify(await client.request('/upload', { method: 'POST', body: new File(['文件内容\0 unchanged'], 'sample.txt', { type: 'text/plain' }) })));
    }).catch(error => setOutput(error.message))}>上传文件</button>
    <button onClick={() => void connect().then(async client => setOutput(JSON.stringify(await client.request('/json', { method: 'POST', body: { text: 'hello' } })))).catch(error => setOutput(error.message))}>JSON 请求</button>
    <button onClick={() => void connect().then(async client => setOutput(String(await client.request('/empty')))).catch(error => setOutput(error.message))}>空响应</button>
    <button onClick={() => void connect().then(async client => { await client.request('/failure'); }).catch(error => setOutput(error.message))}>错误响应</button>
    <button onClick={() => void connect().then(client => { const stop = client.subscribe('/events', data => { setOutput(JSON.stringify(data)); stop(); }); }).catch(error => setOutput(error.message))}>订阅</button>
    <button onClick={() => void connect().then(async client => setOutput(JSON.stringify(await client.request('/slow')))).catch(error => setOutput(error.message))}>超时请求</button>
    <output>{output}</output>
  </Stack>;
  if (mode === 'detail-form') return <form onSubmit={event => { event.preventDefault(); setOutput('submitted'); }}>
    <ListDetail hasSelection={selected} onBack={() => setSelected(false)} list={<button type="button" onClick={() => setSelected(true)}>选择笔记</button>} detail={<Editor />} />
    <output>{output || 'not submitted'}</output>
  </form>;
  if (mode === 'detail') return <ListDetail hasSelection={selected} onBack={() => setSelected(false)} list={<button onClick={() => setSelected(true)}>选择笔记</button>} detail={<Editor />} />;
  if (mode === 'nested-detail') return <ListDetail hasSelection={false} onBack={() => {}} list={<ListDetail hasSelection={selected} onBack={() => setSelected(false)} list={<button onClick={() => setSelected(true)}>选择内层笔记</button>} detail={<Editor />} />} detail="外层详情" />;
  if (mode === 'input') return <Stack><Pane label="表单"><div style={{ height: 1200 }}>业务内容</div><Editor /><button>保存</button></Pane></Stack>;
  if (mode === 'default') return <Columns><Pane label="默认一"><Editor /></Pane><Pane label="默认二">第二个区域</Pane></Columns>;
  if (mode === 'nested') return <Columns><Pane label="外层一" flexBasis={360}><Columns gap={24}><Pane label="内层一" flexBasis={240}>一</Pane><Pane label="内层二" flexBasis={240}>二</Pane></Columns></Pane><Pane label="外层二" flexBasis={800}>外部</Pane></Columns>;
  return <Stack gap={0}>
    <button onClick={() => setExtra(value => !value)}>切换区域</button>
    <Columns gap={24}>
      {[<Pane key="nav" label="导航" flexBasis={240} flexGrow={1}>导航</Pane>]}
      {extra && <Pane key="extra" label="新增" flexBasis={240}><input aria-label="新增输入" /></Pane>}
      <Fragment key="editor"><Pane label="编辑" flexBasis={480} flexGrow={2}><Editor /><div style={{ width: 1800 }}>超宽业务内容</div></Pane></Fragment>
      <Pane key="aside" label="辅助" flexBasis={240} flexGrow={1}>辅助</Pane>
    </Columns>
  </Stack>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
