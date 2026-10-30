import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageProps } from '../App';
import { api, MEAL_LABELS, type Meal, type MealType } from '../api';
import { MealSheet } from '../MealSheet';
import { hhmm, todayIso } from '../time';

const BUTTONS: { type: MealType; emoji: string }[] = [
  { type: 'cafe', emoji: '☕️' },
  { type: 'almoco', emoji: '🍛' },
  { type: 'lanche', emoji: '🍎' },
  { type: 'jantar', emoji: '🍲' },
  { type: 'outro', emoji: '🍴' },
];

export function RegisterPage({ onError }: PageProps) {
  const [meals, setMeals] = useState<Meal[]>([]);
  const [editing, setEditing] = useState<Meal | null>(null);
  const [toast, setToast] = useState<Meal | null>(null);
  const [busy, setBusy] = useState(false);
  const toastTimer = useRef<number>(undefined);

  const load = useCallback(() => api.meals(todayIso()).then(setMeals, onError), [onError]);
  useEffect(() => void load(), [load]);

  const register = async (type: MealType) => {
    if (busy) return;
    setBusy(true);
    try {
      const meal = await api.createMeal(type);
      navigator.vibrate?.(30);
      setToast(meal);
      clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToast(null), 8000);
      await load();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Registrar refeição</h1>
      <div className="meal-grid">
        {BUTTONS.map((b) => (
          <button key={b.type} className={`meal-btn${b.type === 'outro' ? ' wide' : ''}`} disabled={busy} onClick={() => register(b.type)}>
            <span className="emoji" aria-hidden>{b.emoji}</span>
            {MEAL_LABELS[b.type]}
          </button>
        ))}
      </div>
      <p className="muted small">Toque registra o horário atual. Toque numa refeição abaixo para mudar a hora ou anotar.</p>

      <h2>Hoje</h2>
      {meals.length === 0 ? (
        <p className="muted">Nenhuma refeição registrada hoje.</p>
      ) : (
        <div className="list">
          {meals.map((m) => (
            <button key={m.id} className="list-item" onClick={() => setEditing(m)}>
              <span className="time">{hhmm(m.ts)}</span>
              <span style={{ flex: 1 }}>
                <b>{MEAL_LABELS[m.type]}</b>
                {m.note && <span className="muted small" style={{ display: 'block' }}>{m.note}</span>}
              </span>
              <span className="muted" aria-hidden>›</span>
            </button>
          ))}
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <span style={{ flex: 1 }}>{MEAL_LABELS[toast.type]} registrado às {hhmm(toast.ts)}</span>
          <button onClick={() => { setEditing(toast); setToast(null); }}>Editar</button>
        </div>
      )}
      {editing && (
        <MealSheet meal={editing} onError={onError} onClose={(changed) => { setEditing(null); if (changed) void load(); }} />
      )}
    </>
  );
}
