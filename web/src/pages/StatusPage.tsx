import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageProps } from '../App';
import { api, type ImportResult, type Status, type SyncRun } from '../api';
import { ago, dateTime } from '../time';

const STATUS_BADGE: Record<SyncRun['status'], string> = { ok: '✓ ok', error: '✕ erro', running: '… rodando' };

export function StatusPage({ onError }: PageProps) {
  const [s, setS] = useState<Status | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lastImport, setLastImport] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => api.status().then(setS, onError), [onError]);
  useEffect(() => {
    void load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      await api.sync();
    } catch (e) {
      onError(e);
    } finally {
      setSyncing(false);
      void load();
    }
  };

  const importCsv = async (file: File) => {
    setImporting(true);
    try {
      setLastImport(await api.importCsv(file));
    } catch (e) {
      onError(e);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
      void load();
    }
  };

  if (!s) return <h1>Status</h1>;
  const last = s.runs[0];
  const newest = s.readings.newest;
  const stale = newest != null && s.now - newest > 3 * 3600;

  return (
    <>
      <h1>Status</h1>
      {!s.scheduler.configured && <p className="err">LLU_EMAIL/LLU_PASSWORD não configurados no servidor: sincronização desativada.</p>}
      <div className="cards">
        <div className="card">
          <div className="k">Última sincronização OK</div>
          <div className="val">{s.lastOk ? ago(s.lastOk.finished_at!, s.now) : '—'}</div>
          {s.lastOk && <div className="small muted">{dateTime(s.lastOk.finished_at!)}</div>}
        </div>
        <div className="card">
          <div className="k">Leitura mais recente</div>
          <div className="val" style={stale ? { color: 'var(--danger)' } : undefined}>{newest ? ago(newest, s.now) : '—'}</div>
          {newest && <div className="small muted">{dateTime(newest)}{stale && ' · a API só guarda ~12 h'}</div>}
        </div>
        <div className="card">
          <div className="k">Próxima execução</div>
          <div className="val">{s.scheduler.nextRunAt ? dateTime(s.scheduler.nextRunAt).slice(-5) : '—'}</div>
          <div className="small muted">a cada {s.scheduler.intervalMin} min</div>
        </div>
        <div className="card">
          <div className="k">Leituras no banco</div>
          <div className="val">{s.readings.total.toLocaleString('pt-BR')}</div>
          <div className="small muted">API {s.readings.llu ?? 0} · CSV {s.readings.csv ?? 0} · escaneadas {s.readings.scans ?? 0}</div>
        </div>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={syncing || !s.scheduler.configured} onClick={sync}>{syncing ? 'Sincronizando…' : 'Sincronizar agora'}</button>
        {last && <span className={`badge ${last.status}`}>{STATUS_BADGE[last.status]}</span>}
        {last?.account_country && <span className="small muted">conta: {last.account_country}</span>}
      </div>
      {last?.status === 'error' && <p className="err">{last.error}</p>}

      <h2>Importar CSV do LibreView</h2>
      <p className="small muted" style={{ marginTop: 0 }}>LibreView → Relatórios → Baixar dados de glicose. Duplicatas são ignoradas.</p>
      <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
      <button className="btn" disabled={importing} onClick={() => fileRef.current?.click()}>{importing ? 'Importando…' : 'Escolher arquivo CSV'}</button>
      {lastImport && (
        <div className="card" style={{ marginTop: 10 }}>
          <b>{lastImport.filename}</b>: {lastImport.nRows} linhas, {lastImport.inserted} leituras novas, {lastImport.duplicates} duplicadas.
          <IgnoredList ignored={lastImport.ignored} errors={lastImport.errors} />
        </div>
      )}
      {s.imports.length > 0 && (
        <div className="scroll-x" style={{ marginTop: 10 }}>
          <table className="plain">
            <thead><tr><th>Quando</th><th>Arquivo</th><th>Linhas</th><th>Novas</th><th>Dupl.</th><th>Ignoradas</th></tr></thead>
            <tbody>
              {s.imports.map((i) => (
                <tr key={i.id}>
                  <td>{dateTime(i.imported_at)}</td><td>{i.filename}</td><td>{i.n_rows}</td><td>{i.n_inserted}</td><td>{i.n_duplicates}</td>
                  <td>{Object.entries(JSON.parse(i.ignored) as Record<string, number>).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Execuções recentes</h2>
      <div className="scroll-x">
        <table className="plain">
          <thead><tr><th>Início</th><th>Origem</th><th>Status</th><th>Recebidas</th><th>Novas</th><th>Erro</th></tr></thead>
          <tbody>
            {s.runs.map((r) => (
              <tr key={r.id}>
                <td>{dateTime(r.started_at)}</td>
                <td>{r.trigger === 'manual' ? 'manual' : 'agendada'}</td>
                <td><span className={`badge ${r.status}`}>{STATUS_BADGE[r.status]}</span></td>
                <td>{r.n_fetched ?? ''}</td>
                <td>{r.n_inserted ?? ''}</td>
                <td className="err" style={{ whiteSpace: 'normal', minWidth: 200 }}>{r.error ?? ''}</td>
              </tr>
            ))}
            {s.runs.length === 0 && <tr><td colSpan={6} className="muted">Nenhuma execução ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function IgnoredList({ ignored, errors }: { ignored: Record<string, number>; errors: string[] }) {
  const entries = Object.entries(ignored);
  if (!entries.length && !errors.length) return null;
  return (
    <div className="small muted" style={{ marginTop: 6 }}>
      {entries.length > 0 && <>Ignoradas: {entries.map(([k, v]) => `${k} (${v})`).join(', ')}</>}
      {errors.map((e) => <div key={e} className="err">{e}</div>)}
    </div>
  );
}
