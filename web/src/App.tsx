import { useCallback, useEffect, useState } from 'react';
import { api, Unauthorized } from './api';
import { ChartPage } from './pages/ChartPage';
import { RegisterPage } from './pages/RegisterPage';
import { SettingsPage } from './pages/SettingsPage';
import { StatusPage } from './pages/StatusPage';
import { TablePage } from './pages/TablePage';

const PAGES = [
  { id: 'registrar', label: 'Registrar', ico: '🍽', C: RegisterPage },
  { id: 'tabela', label: 'Tabela', ico: '▦', C: TablePage },
  { id: 'grafico', label: 'Gráfico', ico: '📈', C: ChartPage },
  { id: 'status', label: 'Status', ico: '⟳', C: StatusPage },
  { id: 'ajustes', label: 'Ajustes', ico: '⚙', C: SettingsPage },
] as const;
type PageId = (typeof PAGES)[number]['id'];

const fromHash = (): PageId => {
  const h = location.hash.slice(1);
  return (PAGES.find((p) => p.id === h)?.id ?? 'registrar') as PageId;
};

export type PageProps = { onError: (e: unknown) => void };

export function App() {
  const [page, setPage] = useState<PageId>(fromHash);
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const onHash = () => setPage(fromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    api.targets().then(() => setAuthed(true), (e) => setAuthed(e instanceof Unauthorized ? false : true));
  }, []);

  const onError = useCallback((e: unknown) => {
    if (e instanceof Unauthorized) setAuthed(false);
    else alert((e as Error).message);
  }, []);

  if (authed === null) return null;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  const Current = PAGES.find((p) => p.id === page)!.C;
  return (
    <>
      <main className="app">
        <Current onError={onError} />
      </main>
      <nav className="nav">
        <div className="nav-inner">
          {PAGES.map((p) => (
            <button key={p.id} aria-current={p.id === page ? 'page' : undefined} onClick={() => (location.hash = p.id)}>
              <span className="ico" aria-hidden>{p.ico}</span>
              {p.label}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="login app"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr('');
        try {
          await api.login(pw);
          onDone();
        } catch (e) {
          setErr((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1>Glicemia</h1>
      <input className="input" type="password" autoComplete="current-password" placeholder="Senha" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
      {err && <div className="err">{err}</div>}
      <button className="btn primary" disabled={busy || !pw}>Entrar</button>
    </form>
  );
}
