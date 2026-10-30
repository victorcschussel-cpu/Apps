import { DateTime } from 'luxon';
export const TZ = process.env.TZ_DISPLAY || 'America/Sao_Paulo';
export const nowSec = () => Math.floor(Date.now() / 1000);
/** Data local (YYYY-MM-DD) de um instante UTC em segundos. */
export const localDate = (ts) => DateTime.fromSeconds(ts, { zone: TZ }).toISODate();
export const localTime = (ts) => DateTime.fromSeconds(ts, { zone: TZ }).toFormat('HH:mm');
/** [início, fim) do dia local, em segundos UTC. */
export function dayBounds(date) {
    const start = DateTime.fromISO(date, { zone: TZ }).startOf('day');
    if (!start.isValid)
        throw new Error(`Data inválida: ${date}`);
    return [start.toSeconds(), start.plus({ days: 1 }).toSeconds()];
}
export function isIsoDate(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && DateTime.fromISO(s).isValid;
}
export const today = () => localDate(nowSec());
export const addDays = (date, n) => DateTime.fromISO(date, { zone: TZ }).plus({ days: n }).toISODate();
//# sourceMappingURL=time.js.map