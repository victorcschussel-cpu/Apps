import { useState } from 'react';
import { api, MEAL_LABELS, MEAL_TYPES, type Meal } from './api';
import { fromInputs, toInputs } from './time';

type Props = { meal: Meal; onClose: (changed: boolean) => void; onError: (e: unknown) => void };

/** Editar tipo, data/hora e nota de uma refeição. */
export function MealSheet({ meal, onClose, onError }: Props) {
  const init = toInputs(meal.ts);
  const [type, setType] = useState(meal.type);
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState(init.time);
  const [note, setNote] = useState(meal.note ?? '');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onClose(true);
    } catch (e) {
      onError(e);
      setBusy(false);
    }
  };

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose(false)}>
      <form
        className="sheet"
        onSubmit={(e) => {
          e.preventDefault();
          if (!date || !time) return;
          void run(() => api.updateMeal(meal.id, { type, ts: fromInputs(date, time), note: note.trim() || null }));
        }}
      >
        <div className="row">
          <h2 style={{ margin: 0 }}>Editar refeição</h2>
          <span className="spacer" />
          <button type="button" className="btn small" onClick={() => onClose(false)}>Cancelar</button>
        </div>
        <div className="seg" role="group" aria-label="Tipo">
          {MEAL_TYPES.map((t) => (
            <button type="button" key={t} aria-pressed={t === type} onClick={() => setType(t)}>{MEAL_LABELS[t]}</button>
          ))}
        </div>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <label className="field" style={{ flex: 1 }}>Data<input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          <label className="field" style={{ flex: 1 }}>Hora<input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} required /></label>
        </div>
        <label className="field">Nota<textarea className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="ex.: pão integral, 2 ovos" /></label>
        <div className="row">
          <button type="button" className="btn danger" disabled={busy} onClick={() => confirm('Excluir esta refeição?') && run(() => api.deleteMeal(meal.id))}>Excluir</button>
          <span className="spacer" />
          <button className="btn primary" disabled={busy}>Salvar</button>
        </div>
      </form>
    </div>
  );
}
