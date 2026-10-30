import { describe, expect, it } from 'vitest';
import { getReadings, insertReadings, openDb } from '../src/server/db.js';

describe('insertReadings', () => {
  it('deduplica por minuto e entre fontes com relógios diferentes', () => {
    const db = openDb(':memory:');
    const t = 1_792_000_000 - (1_792_000_000 % 60);
    expect(insertReadings(db, [{ ts: t + 37, value: 110, kind: 'cgm' }], 'llu')).toEqual({ inserted: 1, duplicates: 0 });
    // Mesmo ponto vindo de novo da API (próxima sincronização)
    expect(insertReadings(db, [{ ts: t + 37, value: 110, kind: 'cgm' }], 'llu').inserted).toBe(0);
    // Mesmo ponto no CSV, 1 min de diferença de relógio
    expect(insertReadings(db, [{ ts: t + 60, value: 111, kind: 'cgm' }], 'csv').inserted).toBe(0);
    // Escaneada no mesmo minuto é outra medição
    expect(insertReadings(db, [{ ts: t, value: 112, kind: 'scan' }], 'csv').inserted).toBe(1);
    // Ponto seguinte do CSV, 5 min depois
    expect(insertReadings(db, [{ ts: t + 300, value: 115, kind: 'cgm' }], 'csv').inserted).toBe(1);
    expect(getReadings(db, t - 1, t + 1000).map((r) => r.value)).toEqual([112, 110, 115]);
  });
});
