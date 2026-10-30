import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { buildTables, type Meal, type Reading, type Targets } from '../src/server/table.js';

const TZ = 'America/Sao_Paulo';
const at = (hhmm: string, date = '2026-10-20') => DateTime.fromISO(`${date}T${hhmm}`, { zone: TZ }).toSeconds();
const targets: Targets = {
  jejum: { max: 95, min: 70 },
  pos1h: { max: 140, min: null }, pos2h: { max: 120, min: null }, pico: { max: 140, min: null },
};
const LATER = at('23:59', '2026-10-25');

/** Leituras a cada 15 min, valor = função do horário. */
function series(fromHHMM: string, toHHMM: string, value: (ts: number) => number, step = 15): Reading[] {
  const out: Reading[] = [];
  for (let t = at(fromHHMM); t <= at(toHHMM); t += step * 60) out.push({ ts: t, value: value(t), kind: 'cgm' });
  return out;
}
const meal = (id: number, type: Meal['type'], hhmm: string, date?: string): Meal => ({ id, type, ts: at(hhmm, date), note: null });

describe('buildTables', () => {
  it('pega a leitura mais próxima de T+60, T+120 e o pico', () => {
    const readings = [
      { ts: at('07:01'), value: 88, kind: 'cgm' as const },
      { ts: at('07:03'), value: 90, kind: 'cgm' as const }, // 3 min das 07:00; 07:01 está a 1 min e vence
      { ts: at('09:03'), value: 150, kind: 'cgm' as const },
      { ts: at('09:30'), value: 170, kind: 'cgm' as const },
      { ts: at('10:05'), value: 118, kind: 'cgm' as const },
    ];
    const [day] = buildTables(readings, [meal(1, 'cafe', '08:00')], targets, '2026-10-20', '2026-10-20', LATER);
    const row = day.rows[0];
    expect(row.pos1h).toMatchObject({ value: 150, status: 'ok', flag: 'high' });
    expect(row.pos2h).toMatchObject({ value: 118, flag: null });
    expect(row.pico).toMatchObject({ value: 170, ts: at('09:30'), flag: 'high' });
    expect(day.jejum).toMatchObject({ value: 88, status: 'ok', flag: null });
  });

  it('deixa a célula vazia quando não há leitura em ±7 min (sem interpolar)', () => {
    const readings = [
      { ts: at('08:52'), value: 130, kind: 'cgm' as const }, // T+52: fora da tolerância de 1h
      { ts: at('09:08'), value: 140, kind: 'cgm' as const }, // T+68: fora
    ];
    const [day] = buildTables(readings, [meal(1, 'almoco', '08:00')], targets, '2026-10-20', '2026-10-20', LATER);
    expect(day.rows[0].pos1h).toMatchObject({ value: null, status: 'missing' });
  });

  it('aceita exatamente ±7 min', () => {
    const readings = [{ ts: at('09:07'), value: 130, kind: 'cgm' as const }];
    const [day] = buildTables(readings, [meal(1, 'almoco', '08:00')], targets, '2026-10-20', '2026-10-20', LATER);
    expect(day.rows[0].pos1h.value).toBe(130);
  });

  it('marca como pendente o que ainda não aconteceu', () => {
    const readings = series('07:30', '08:30', () => 100);
    const [day] = buildTables(readings, [meal(1, 'cafe', '08:00')], targets, '2026-10-20', '2026-10-20', at('08:30'));
    expect(day.rows[0].pos1h.status).toBe('pending');
    expect(day.rows[0].pico).toMatchObject({ status: 'pending', value: 100 });
  });

  it('jejum é a leitura mais próxima das 07:00, independente das refeições', () => {
    const readings = series('05:00', '23:00', (t) => (t === at('06:45') ? 80 : t === at('07:00') ? 96 : 110));
    const [day] = buildTables(readings, [meal(1, 'cafe', '06:30')], targets, '2026-10-20', '2026-10-20', LATER);
    expect(day.jejum).toMatchObject({ value: 96, ts: at('07:00'), flag: 'high' }); // limite 95
  });

  it('jejum vazio quando não há leitura entre 06:53 e 07:07', () => {
    const readings = [{ ts: at('06:52'), value: 90, kind: 'cgm' as const }, { ts: at('07:08'), value: 91, kind: 'cgm' as const }];
    const [day] = buildTables(readings, [meal(1, 'cafe', '08:00')], targets, '2026-10-20', '2026-10-20', LATER);
    expect(day.jejum).toMatchObject({ value: null, status: 'missing' });
  });

  it('dia sem refeição aparece se houver jejum; sem nada, não aparece', () => {
    const readings = [{ ts: at('07:02', '2026-10-21'), value: 90, kind: 'cgm' as const }];
    const days = buildTables(readings, [], targets, '2026-10-20', '2026-10-21', LATER);
    expect(days.map((d) => [d.date, d.rows.length, d.jejum.value])).toEqual([['2026-10-21', 0, 90]]);
  });

  it('jejum de hoje fica pendente antes das 07:07', () => {
    const [day] = buildTables([], [], targets, '2026-10-20', '2026-10-20', at('06:30'));
    expect(day.jejum.status).toBe('pending');
  });

  it('corta a janela do pico na próxima refeição', () => {
    const readings = series('07:00', '14:00', (t) => (t === at('10:00') ? 200 : 120));
    const meals = [meal(1, 'cafe', '08:00'), meal(2, 'lanche', '09:30')];
    const [day] = buildTables(readings, meals, targets, '2026-10-20', '2026-10-20', LATER);
    const cafe = day.rows.find((r) => r.meal.id === 1)!;
    expect(cafe.pico).toMatchObject({ cut: true, windowEnd: at('09:30'), value: 120 });
    const lanche = day.rows.find((r) => r.meal.id === 2)!;
    expect(lanche.pico).toMatchObject({ cut: false, value: 200 });
  });

  it('corta pelo primeiro registro do dia seguinte', () => {
    const readings = series('21:00', '23:45', () => 100);
    const meals = [meal(1, 'jantar', '22:30'), meal(2, 'outro', '00:30', '2026-10-21')];
    const [day] = buildTables(readings, meals, targets, '2026-10-20', '2026-10-20', LATER);
    expect(day.rows).toHaveLength(1);
    expect(day.rows[0].pico.cut).toBe(true);
  });

  it('marca pico parcial quando há buraco na janela', () => {
    const readings = [...series('07:30', '09:00', () => 110), ...series('10:30', '11:30', () => 115)];
    const [day] = buildTables(readings, [meal(1, 'cafe', '08:00')], targets, '2026-10-20', '2026-10-20', LATER);
    expect(day.rows[0].pico).toMatchObject({ partial: true, value: 115 });
  });

  it('agrupa por dia de São Paulo, não UTC (22h local = 01h UTC do dia seguinte)', () => {
    const readings = series('21:00', '23:45', () => 100);
    const days = buildTables(readings, [meal(1, 'jantar', '22:00')], targets, '2026-10-20', '2026-10-21', LATER);
    expect(days.map((d) => d.date)).toEqual(['2026-10-20']);
  });

  it('sinaliza abaixo do mínimo', () => {
    const readings = [{ ts: at('07:00'), value: 65, kind: 'cgm' as const }];
    const [day] = buildTables(readings, [meal(1, 'cafe', '08:00')], targets, '2026-10-20', '2026-10-20', LATER);
    expect(day.jejum.flag).toBe('low');
  });
});
