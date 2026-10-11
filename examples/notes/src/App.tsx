import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { connect, type PluginClient } from '@isola/plugin';
import { Stack, Columns, Pane, ListDetail } from '@isola/plugin/ui';

type Note = { id: string; title: string; body: string };

function App() {
  const [client, setClient] = useState<PluginClient>();
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState<Note | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void connect().then(connection => {
      if (!active) return;
      setClient(connection);
      unsubscribe = connection.subscribe('/events', data => {
        const event = data as { type: string; note?: Note };
        if (event.type === 'ready') {
          void connection.request<Note[]>('/notes').then(loaded => { if (active) setNotes(loaded); }).catch(error => { if (active) setError(error.message); });
        }
        if (event.type === 'changed' && event.note) {
          const note = event.note;
          setNotes(previous => [...previous.filter(item => item.id !== note.id), note]);
        }
      });
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; unsubscribe?.(); };
  }, []);

  useEffect(() => client?.registerMenu([
    { id: 'new-note', label: '新建笔记', disabled: saving, onSelect: () => { setDraft({ id: '', title: '', body: '' }); setStatus(''); } },
  ]), [client, saving]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !draft || saving) return;
    setSaving(true);
    setError('');
    setStatus('');
    try {
      const saved = await client.request<Note>(draft.id ? `/notes/${draft.id}` : '/notes', {
        method: draft.id ? 'PUT' : 'POST', body: { title: draft.title, body: draft.body },
      });
      setNotes(previous => [...previous.filter(item => item.id !== saved.id), saved]);
      setDraft(saved);
      setStatus('已保存');
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  }

  return <Stack>
    {error && <p role="alert">{error}</p>}
    <ListDetail hasSelection={draft !== null} onBack={() => setDraft(null)} list={
      <Pane label="笔记列表">
        <Stack>
          <button disabled={!client || saving} onClick={() => { setDraft({ id: '', title: '', body: '' }); setStatus(''); }}>新建</button>
          {notes.map(note => <button key={note.id} disabled={saving} onClick={() => { setDraft(note); setStatus(''); }}>{note.title}</button>)}
        </Stack>
      </Pane>
    } detail={
      <form onSubmit={save}>
        <Columns>
          <Pane label="编辑" flexBasis="28rem" flexGrow={2}>
            <Stack>
              <label htmlFor="title">标题</label>
              <input id="title" required disabled={!draft || saving} value={draft?.title ?? ''} onChange={event => { setDraft(previous => previous && { ...previous, title: event.target.value }); setStatus(''); }} />
              <label htmlFor="body">内容</label>
              <textarea id="body" rows={12} disabled={!draft || saving} value={draft?.body ?? ''} onChange={event => { setDraft(previous => previous && { ...previous, body: event.target.value }); setStatus(''); }} />
            </Stack>
          </Pane>
          <Pane label="操作" flexBasis="8rem">
            <Stack><button type="submit" disabled={!draft || !client || saving}>保存</button><p role="status">{status}</p></Stack>
          </Pane>
        </Columns>
      </form>
    } />
  </Stack>;
}

createRoot(document.getElementById('root')!).render(<App />);
