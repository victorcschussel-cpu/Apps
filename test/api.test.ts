import { DateTime } from 'luxon';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { insertReadings, openDb } from '../src/server/db.js';

const sp = (iso: string) => DateTime.fromISO(iso, { zone: 'America/Sao_Paulo' }).toSeconds();
let app: Awaited<ReturnType<typeof buildApp>>;
let cookie = '';

beforeAll(async () => {
  const db = openDb(':memory:');
  const readings = [];
  for (let t = sp('2026-10-20T06:00'); t < sp('2026-10-20T23:00'); t += 300) readings.push({ ts: t, value: 100 + ((t / 300) % 7) * 10, kind: 'cgm' as const });
  insertReadings(db, readings, 'llu');
  app = await buildApp({ db, password: 'segredo', sessionSecret: 'x'.repeat(32) });
});

const req = (method: string, url: string, payload?: unknown) =>
  app.inject({ method: method as 'GET', url, payload: payload as object, headers: { cookie } });

describe('API', () => {
  it('exige login', async () => {
    expect((await req('GET', '/api/table')).statusCode).toBe(401);
    expect((await req('POST', '/api/login', { password: 'errada' })).statusCode).toBe(401);
    const ok = await req('POST', '/api/login', { password: 'segredo' });
    expect(ok.statusCode).toBe(200);
    cookie = ok.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  });

  it('registra, edita e calcula a tabela', async () => {
    const created = await req('POST', '/api/meals', { type: 'cafe', ts: sp('2026-10-20T08:00'), note: 'pão' });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    await req('POST', '/api/meals', { type: 'almoco', ts: sp('2026-10-20T12:30') });
    expect((await req('PATCH', `/api/meals/${id}`, { ts: sp('2026-10-20T08:10') })).json().ts).toBe(sp('2026-10-20T08:10'));
    expect((await req('POST', '/api/meals', { type: 'ceia' })).statusCode).toBe(400);

    const table = (await req('GET', '/api/table?from=2026-10-20&to=2026-10-20')).json();
    expect(table.days).toHaveLength(1);
    const [day] = table.days;
    expect(day.rows.map((r: { meal: { type: string } }) => r.meal.type)).toEqual(['cafe', 'almoco']);
    expect(day.jejum.status).toBe('ok');
    expect(day.rows[0].pos1h.status).toBe('ok');
    expect(table.targets.jejum.max).toBe(95);
    expect(table.targets.pre).toBeUndefined();
  });

  it('exporta CSV e PDF', async () => {
    const csv = await req('GET', '/api/export.csv?from=2026-10-20&to=2026-10-20');
    expect(csv.body.split('\r\n')[1]).toMatch(/^2026-10-20;\d+;Café;08:10;\d+;\d+;/);
    const pdf = await req('GET', '/api/export.pdf?from=2026-10-20&to=2026-10-20');
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('importa CSV via upload e registra no status', async () => {
    const csv = `Dados de glicose,Gerado em\nDispositivo,Número de série,Carimbo de data/hora do dispositivo,Tipo de registro,Histórico de glicose mg/dL,Glicose escaneada mg/dL\nL,X,19-10-2026 08:00,0,99,\nL,X,19-10-2026 08:01,4,,\n`;
    const boundary = 'b0undary';
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="libre.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`;
    const res = await app.inject({ method: 'POST', url: '/api/import/csv', payload: body, headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` } });
    expect(res.json()).toMatchObject({ inserted: 1, ignored: { 'tipo 4': 1 } });
    const status = (await req('GET', '/api/status')).json();
    expect(status.imports[0]).toMatchObject({ filename: 'libre.csv', n_inserted: 1 });
    expect(status.scheduler.configured).toBe(false);
  });

  it('valida período', async () => {
    expect((await req('GET', '/api/table?from=2026-10-21&to=2026-10-20')).statusCode).toBe(400);
  });
});
