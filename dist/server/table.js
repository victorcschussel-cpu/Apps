import { localDate } from './time.js';
export * from '../shared/types.js';
const MIN = 60;
export const TOLERANCE = 7 * MIN;
export const PRE_OFFSET = -15 * MIN;
export const PEAK_WINDOW = 180 * MIN;
/** Buraco entre leituras acima disso marca o pico como "parcial". */
export const MAX_GAP = 20 * MIN;
/** Primeiro índice com ts >= t (readings ordenadas por ts). */
function lowerBound(readings, t) {
    let lo = 0;
    let hi = readings.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (readings[mid].ts < t)
            lo = mid + 1;
        else
            hi = mid;
    }
    return lo;
}
function flagFor(value, field, targets) {
    if (value == null)
        return null;
    const { max, min } = targets[field];
    if (max != null && value > max)
        return 'high';
    if (min != null && value < min)
        return 'low';
    return null;
}
/** Leitura mais próxima de `target` dentro de ±TOLERANCE. Empate: a mais antiga. Sem interpolação. */
export function nearest(readings, target, field, targets, now) {
    let best = null;
    for (let i = lowerBound(readings, target - TOLERANCE); i < readings.length; i++) {
        const r = readings[i];
        if (r.ts > target + TOLERANCE)
            break;
        if (!best || Math.abs(r.ts - target) < Math.abs(best.ts - target))
            best = r;
    }
    if (best)
        return { value: best.value, ts: best.ts, target, status: 'ok', flag: flagFor(best.value, field, targets) };
    // Sem leitura, mas a janela de tolerância ainda não fechou (ou a sincronização ainda não trouxe).
    const status = target + TOLERANCE > now ? 'pending' : 'missing';
    return { value: null, ts: null, target, status, flag: null };
}
/** Máximo em [start, end]. Empate: o mais cedo. */
export function peak(readings, start, end, targets, now, cut) {
    const inWindow = [];
    for (let i = lowerBound(readings, start); i < readings.length && readings[i].ts <= end; i++)
        inWindow.push(readings[i]);
    const observedEnd = Math.min(end, now);
    const edges = [start, ...inWindow.map((r) => r.ts), observedEnd];
    const partial = edges.some((t, i) => i > 0 && t - edges[i - 1] > MAX_GAP);
    let best = null;
    for (const r of inWindow)
        if (!best || r.value > best.value)
            best = r;
    const status = end > now ? 'pending' : best ? 'ok' : 'missing';
    return {
        value: best?.value ?? null,
        ts: best?.ts ?? null,
        target: start,
        status,
        flag: flagFor(best?.value ?? null, 'pico', targets),
        windowEnd: end,
        cut,
        partial,
    };
}
/**
 * Monta a tabela por dia (America/Sao_Paulo).
 * `meals` deve incluir a primeira refeição após o período, para cortar a janela do pico do último dia.
 */
export function buildTables(readings, meals, targets, from, to, now) {
    const sortedReadings = [...readings].sort((a, b) => a.ts - b.ts);
    const sortedMeals = [...meals].sort((a, b) => a.ts - b.ts || a.id - b.id);
    const days = new Map();
    sortedMeals.forEach((meal, i) => {
        const date = localDate(meal.ts);
        if (date < from || date > to)
            return;
        const next = sortedMeals.slice(i + 1).find((m) => m.ts > meal.ts);
        const fullEnd = meal.ts + PEAK_WINDOW;
        const cut = next != null && next.ts < fullEnd;
        const end = cut ? next.ts : fullEnd;
        const row = {
            meal,
            pre: nearest(sortedReadings, meal.ts + PRE_OFFSET, 'pre', targets, now),
            pos1h: nearest(sortedReadings, meal.ts + 60 * MIN, 'pos1h', targets, now),
            pos2h: nearest(sortedReadings, meal.ts + 120 * MIN, 'pos2h', targets, now),
            pico: peak(sortedReadings, meal.ts, end, targets, now, cut),
        };
        let day = days.get(date);
        if (!day)
            days.set(date, (day = { date, jejum: null, rows: [] }));
        day.rows.push(row);
    });
    for (const day of days.values()) {
        // Jejum = T-15 do café; sem café no dia, usa a primeira refeição.
        const ref = day.rows.find((r) => r.meal.type === 'cafe') ?? day.rows[0];
        const cell = nearest(sortedReadings, ref.meal.ts + PRE_OFFSET, 'jejum', targets, now);
        day.jejum = { ...cell, mealId: ref.meal.id };
    }
    return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}
//# sourceMappingURL=table.js.map