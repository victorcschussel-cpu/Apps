import { DateTime } from 'luxon';

// Exibição sempre em São Paulo, mesmo com o aparelho em outro fuso.
export const TZ = 'America/Sao_Paulo';

const fromTs = (ts: number) => DateTime.fromSeconds(ts, { zone: TZ }).setLocale('pt-BR');
export const hhmm = (ts: number) => fromTs(ts).toFormat('HH:mm');
export const dateTime = (ts: number) => fromTs(ts).toFormat('dd/LL HH:mm');
export const todayIso = () => DateTime.now().setZone(TZ).toISODate()!;
export const addDays = (iso: string, n: number) => DateTime.fromISO(iso, { zone: TZ }).plus({ days: n }).toISODate()!;
export const dayLabel = (iso: string) => {
  const s = DateTime.fromISO(iso, { zone: TZ }).setLocale('pt-BR').toFormat("cccc, dd 'de' LLLL");
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const isoDate = (ts: number) => fromTs(ts).toISODate()!;
/** Valores para <input type="date"> e <input type="time">. */
export const toInputs = (ts: number) => ({ date: fromTs(ts).toISODate()!, time: fromTs(ts).toFormat('HH:mm') });
export const fromInputs = (date: string, time: string) => Math.floor(DateTime.fromISO(`${date}T${time}`, { zone: TZ }).toSeconds());

export function ago(ts: number, now = Date.now() / 1000) {
  const m = Math.round((now - ts) / 60);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
  return `há ${Math.floor(h / 24)} d`;
}
