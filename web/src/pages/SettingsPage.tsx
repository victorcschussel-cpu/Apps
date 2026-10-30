import { useEffect, useState } from 'react';
import type { PageProps } from '../App';
import { api, FIELD_LABELS, type Field, type Targets } from '../api';

const FIELDS = Object.keys(FIELD_LABELS) as Field[];
type Draft = Record<Field, { max: string; min: string }>;

const toDraft = (t: Targets) =>
  Object.fromEntries(FIELDS.map((f) => [f, { max: t[f].max?.toString() ?? '', min: t[f].min?.toString() ?? '' }])) as Draft;
const parse = (s: string) => (s.trim() === '' ? null : Math.round(Number(s)));

export function SettingsPage({ onError }: PageProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => void api.targets().then((t) => setDraft(toDraft(t)), onError), [onError]);
  if (!draft) return <h1>Ajustes</h1>;

  const set = (f: Field, k: 'max' | 'min', v: string) => {
    setSaved(false);
    setDraft({ ...draft, [f]: { ...draft[f], [k]: v } });
  };

  const save = async () => {
    const body = Object.fromEntries(FIELDS.map((f) => [f, { max: parse(draft[f].max), min: parse(draft[f].min) }])) as Targets;
    try {
      setDraft(toDraft(await api.setTargets(body)));
      setSaved(true);
    } catch (e) {
      onError(e);
    }
  };

  return (
    <>
      <h1>Ajustes</h1>
      <h2>Limites-alvo (mg/dL)</h2>
      <p className="small muted" style={{ marginTop: 0 }}>Valores acima do máximo ficam em vermelho ▲, abaixo do mínimo em azul ▼. Deixe vazio para não sinalizar.</p>
      <div className="targets-grid">
        <span />
        <span className="h">Mínimo</span>
        <span className="h">Máximo</span>
        {FIELDS.map((f) => (
          <FieldRow key={f} f={f} v={draft[f]} onChange={set} />
        ))}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={save}>Salvar limites</button>
        {saved && <span className="badge ok">✓ salvo</span>}
      </div>

      <h2>Sessão</h2>
      <button className="btn" onClick={() => api.logout().then(() => location.reload(), onError)}>Sair</button>
    </>
  );
}

function FieldRow({ f, v, onChange }: { f: Field; v: { max: string; min: string }; onChange: (f: Field, k: 'max' | 'min', v: string) => void }) {
  return (
    <>
      <b>{FIELD_LABELS[f]}</b>
      <input className="input" inputMode="numeric" pattern="[0-9]*" value={v.min} onChange={(e) => onChange(f, 'min', e.target.value)} aria-label={`${FIELD_LABELS[f]} mínimo`} />
      <input className="input" inputMode="numeric" pattern="[0-9]*" value={v.max} onChange={(e) => onChange(f, 'max', e.target.value)} aria-label={`${FIELD_LABELS[f]} máximo`} />
    </>
  );
}
