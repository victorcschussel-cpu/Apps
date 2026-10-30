import { useCallback, useEffect, useState } from 'react';
import type { PageProps } from '../App';
import { api, FIELD_LABELS, MEAL_LABELS, type Cell, type DayTable, type Meal, type PeakCell, type Targets } from '../api';
import { MealSheet } from '../MealSheet';
import { addDays, dayLabel, hhmm, todayIso } from '../time';

const PRESETS = [{ label: '7 dias', days: 7 }, { label: '14 dias', days: 14 }, { label: '30 dias', days: 30 }];

function Value({ c, title }: { c: Cell; title: string }) {
  if (c.value == null) {
    return c.status === 'pending'
      ? <span className="v pending" title={`${title}: aguardando`}>…</span>
      : <span className="v missing" title={`${title}: sem leitura a ±7 min de ${hhmm(c.target)}`}>sem</span>;
  }
  const icon = c.flag === 'high' ? '▲' : c.flag === 'low' ? '▼' : '';
  const flagText = c.flag === 'high' ? ' (acima do limite)' : c.flag === 'low' ? ' (abaixo do limite)' : '';
  return (
    <span className={`v${c.flag ? ` ${c.flag}` : ''}`} title={`${title}: ${c.value} mg/dL às ${hhmm(c.ts!)}${flagText}`}>
      {c.value}{icon && <span aria-hidden> {icon}</span>}
    </span>
  );
}

function PeakValue({ p }: { p: PeakCell }) {
  const marks = [p.cut && '✂', p.partial && '≈', p.status === 'pending' && p.value != null && '…'].filter(Boolean).join(' ');
  return (
    <>
      <Value c={p} title="Pico" />
      {p.ts != null && <span className="sub">{hhmm(p.ts)}{marks && ` ${marks}`}</span>}
    </>
  );
}

function DayCard({ day, onEdit }: { day: DayTable; onEdit: (m: Meal) => void }) {
  return (
    <section className="day">
      <div className="day-head">
        <h2>{dayLabel(day.date)}</h2>
        <span className="jejum-chip muted">
          Jejum 7h <Value c={day.jejum} title="Jejum 7h" />
          {day.jejum.ts != null && <span className="small"> às {hhmm(day.jejum.ts)}</span>}
        </span>
      </div>
      {day.rows.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Nenhuma refeição registrada.</p> : (
      <table className="gtable">
        <thead>
          <tr>
            <th>Refeição</th>
            <th>{FIELD_LABELS.pos1h}</th>
            <th>{FIELD_LABELS.pos2h}</th>
            <th>{FIELD_LABELS.pico}</th>
          </tr>
        </thead>
        <tbody>
          {day.rows.flatMap((r) => {
            const rows = [
              <tr key={r.meal.id} className={r.meal.note ? 'has-note' : undefined} onClick={() => onEdit(r.meal)} style={{ cursor: 'pointer' }}>
                <td><span className="meal-name">{MEAL_LABELS[r.meal.type]}</span><span className="sub">{hhmm(r.meal.ts)}</span></td>
                <td><Value c={r.pos1h} title="1h pós" /></td>
                <td><Value c={r.pos2h} title="2h pós" /></td>
                <td><PeakValue p={r.pico} /></td>
              </tr>,
            ];
            if (r.meal.note) rows.push(<tr key={`${r.meal.id}-n`} className="note"><td colSpan={4}>{r.meal.note}</td></tr>);
            return rows;
          })}
        </tbody>
      </table>
      )}
    </section>
  );
}

export function TablePage({ onError }: PageProps) {
  const [to, setTo] = useState(todayIso);
  const [from, setFrom] = useState(() => addDays(todayIso(), -6));
  const [data, setData] = useState<{ days: DayTable[]; targets: Targets } | null>(null);
  const [editing, setEditing] = useState<Meal | null>(null);

  const load = useCallback(() => api.table(from, to).then(setData, onError), [from, to, onError]);
  useEffect(() => void load(), [load]);

  const qs = `from=${from}&to=${to}`;
  const t = data?.targets;
  const lim = (f: keyof Targets) => (t?.[f].max != null ? `${FIELD_LABELS[f]} ≤ ${t[f].max}` : null);

  return (
    <>
      <h1>Tabela</h1>
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="seg">
          {PRESETS.map((p) => {
            const f = addDays(todayIso(), -(p.days - 1));
            return <button key={p.days} aria-pressed={from === f && to === todayIso()} onClick={() => { setTo(todayIso()); setFrom(f); }}>{p.label}</button>;
          })}
        </div>
      </div>
      <div className="row date-range" style={{ marginBottom: 8 }}>
        <input className="input" style={{ width: 'auto', flex: 1 }} type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="De" />
        <span className="muted">a</span>
        <input className="input" style={{ width: 'auto', flex: 1 }} type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="Até" />
      </div>
      <div className="row">
        <a className="btn small" href={`/api/export.csv?${qs}`} download>Exportar CSV</a>
        <a className="btn small" href={`/api/export.pdf?${qs}`} download>Exportar PDF</a>
      </div>
      <div className="legend">
        <span>mg/dL · {['jejum', 'pos1h', 'pos2h', 'pico'].map((f) => lim(f as keyof Targets)).filter(Boolean).join(' · ')}</span>
        <span><span className="v high">▲</span> acima</span>
        <span><span className="v low">▼</span> abaixo</span>
        <span><span className="v missing">sem</span> sem leitura a ±7 min</span>
        <span>… aguardando</span>
        <span>✂ pico cortado na refeição seguinte</span>
        <span>≈ buraco &gt; 20 min na janela</span>
      </div>

      {data && data.days.length === 0 && <p className="muted">Nenhuma refeição no período.</p>}
      {data?.days.map((d) => <DayCard key={d.date} day={d} onEdit={setEditing} />)}

      {editing && <MealSheet meal={editing} onError={onError} onClose={(changed) => { setEditing(null); if (changed) void load(); }} />}
    </>
  );
}
