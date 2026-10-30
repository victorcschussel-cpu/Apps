import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { registerAuth } from './auth.js';
import { parseLibreViewCsv } from './csvImport.js';
import * as repo from './db.js';
import { tableToCsv, tableToPdf } from './export.js';
import { runSync, schedulerState, syncConfigured } from './sync.js';
import { buildTables, FIELDS, MEAL_TYPES, PEAK_WINDOW } from './table.js';
import { addDays, dayBounds, isIsoDate, nowSec, today } from './time.js';
const MAX_RANGE_DAYS = 120;
const bad = (message) => Object.assign(new Error(message), { statusCode: 400 });
function parseRange(q) {
    const to = q.to ?? today();
    const from = q.from ?? addDays(to, -6);
    if (!isIsoDate(from) || !isIsoDate(to) || from > to)
        throw bad('Período inválido (use from/to em YYYY-MM-DD)');
    if (dayBounds(to)[0] - dayBounds(from)[0] > MAX_RANGE_DAYS * 86400)
        throw bad(`Período máximo: ${MAX_RANGE_DAYS} dias`);
    return { from, to };
}
function computeTables(db, from, to) {
    const [start] = dayBounds(from);
    const [, end] = dayBounds(to);
    const meals = repo.getMeals(db, start, end);
    const next = repo.getNextMeal(db, end);
    if (next)
        meals.push(next);
    // Pré/jejum olham até T-22 min; o pico até T+180 da última refeição.
    const readings = repo.getReadings(db, start - 3600, end + PEAK_WINDOW + 3600);
    return buildTables(readings, meals, repo.getTargets(db), from, to, nowSec());
}
function parseMealBody(body, partial) {
    const b = (body ?? {});
    const out = {};
    if (b.type !== undefined || !partial) {
        if (!MEAL_TYPES.includes(b.type))
            throw bad('Tipo de refeição inválido');
        out.type = b.type;
    }
    if (b.ts !== undefined) {
        if (typeof b.ts !== 'number' || !Number.isInteger(b.ts) || b.ts < 1e9 || b.ts > nowSec() + 86400)
            throw bad('Horário inválido');
        out.ts = b.ts;
    }
    else if (!partial)
        out.ts = nowSec();
    if (b.note !== undefined) {
        if (b.note !== null && typeof b.note !== 'string')
            throw bad('Nota inválida');
        out.note = b.note?.trim().slice(0, 500) || null;
    }
    else if (!partial)
        out.note = null;
    return out;
}
export async function buildApp({ db, password, sessionSecret, webDir }) {
    const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy: true });
    await app.register(cookie, { secret: sessionSecret });
    await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
    registerAuth(app, password);
    app.get('/api/health', async () => ({ ok: true }));
    // Refeições
    app.get('/api/meals', async (req) => {
        const date = req.query.date ?? today();
        if (!isIsoDate(date))
            throw bad('Data inválida');
        const [s, e] = dayBounds(date);
        return repo.getMeals(db, s, e);
    });
    app.post('/api/meals', async (req, reply) => {
        const m = parseMealBody(req.body, false);
        return reply.code(201).send(repo.createMeal(db, m));
    });
    app.patch('/api/meals/:id', async (req, reply) => {
        const meal = repo.updateMeal(db, Number(req.params.id), parseMealBody(req.body, true));
        return meal ?? reply.code(404).send({ error: 'Refeição não encontrada' });
    });
    app.delete('/api/meals/:id', async (req, reply) => repo.deleteMeal(db, Number(req.params.id)) ? { ok: true } : reply.code(404).send({ error: 'Refeição não encontrada' }));
    // Tabela, gráfico, exportação
    app.get('/api/table', async (req) => {
        const { from, to } = parseRange(req.query);
        return { from, to, targets: repo.getTargets(db), days: computeTables(db, from, to) };
    });
    app.get('/api/day', async (req) => {
        const date = req.query.date ?? today();
        if (!isIsoDate(date))
            throw bad('Data inválida');
        const [s, e] = dayBounds(date);
        return { date, start: s, end: e, readings: repo.getReadings(db, s, e), meals: repo.getMeals(db, s, e), targets: repo.getTargets(db) };
    });
    app.get('/api/export.csv', async (req, reply) => {
        const { from, to } = parseRange(req.query);
        reply.header('content-type', 'text/csv; charset=utf-8')
            .header('content-disposition', `attachment; filename="glicemia_${from}_${to}.csv"`);
        return tableToCsv(computeTables(db, from, to));
    });
    app.get('/api/export.pdf', async (req, reply) => {
        const { from, to } = parseRange(req.query);
        const period = from === to ? from : `${from} a ${to}`;
        reply.header('content-type', 'application/pdf')
            .header('content-disposition', `attachment; filename="glicemia_${from}_${to}.pdf"`);
        return reply.send(tableToPdf(computeTables(db, from, to), repo.getTargets(db), period));
    });
    // Limites
    app.get('/api/targets', async () => repo.getTargets(db));
    app.put('/api/targets', async (req) => {
        const body = (req.body ?? {});
        const ok = (v) => v === null || (typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 600);
        for (const f of FIELDS) {
            if (body[f] && (!ok(body[f].max) || !ok(body[f].min)))
                throw bad(`Limite inválido em ${f}`);
        }
        repo.setTargets(db, body);
        return repo.getTargets(db);
    });
    // Sincronização e importação
    app.post('/api/sync', async (_req, reply) => {
        if (!syncConfigured)
            return reply.code(409).send({ error: 'Credenciais do LibreLinkUp não configuradas' });
        await runSync(db, 'manual');
        return db.prepare(`SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1`).get();
    });
    app.post('/api/import/csv', async (req) => {
        const file = await req.file();
        if (!file)
            throw bad('Envie um arquivo CSV');
        const text = (await file.toBuffer()).toString('utf8');
        let parsed;
        try {
            parsed = parseLibreViewCsv(text);
        }
        catch (e) {
            throw bad(e.message);
        }
        const { inserted, duplicates } = repo.insertReadings(db, parsed.readings, 'csv');
        req.log.info({ file: file.filename, ignored: parsed.ignored, errors: parsed.errors }, 'csv import');
        db.prepare(`INSERT INTO csv_imports (filename, n_rows, n_inserted, n_duplicates, ignored, errors) VALUES (?, ?, ?, ?, ?, ?)`).run(file.filename, parsed.nRows, inserted, duplicates, JSON.stringify(parsed.ignored), JSON.stringify(parsed.errors));
        return { filename: file.filename, nRows: parsed.nRows, readings: parsed.readings.length, inserted, duplicates, ignored: parsed.ignored, errors: parsed.errors };
    });
    app.get('/api/status', async () => {
        const lastOk = db.prepare(`SELECT * FROM sync_runs WHERE status = 'ok' ORDER BY id DESC LIMIT 1`).get();
        const runs = db.prepare(`SELECT * FROM sync_runs ORDER BY id DESC LIMIT 20`).all();
        const errors = db.prepare(`SELECT * FROM sync_runs WHERE status = 'error' ORDER BY id DESC LIMIT 10`).all();
        const imports = db.prepare(`SELECT * FROM csv_imports ORDER BY id DESC LIMIT 10`).all();
        const readings = db.prepare(`SELECT COUNT(*) AS total, MIN(ts_utc) AS oldest, MAX(ts_utc) AS newest,
              SUM(source = 'llu') AS llu, SUM(source = 'csv') AS csv, SUM(kind = 'scan') AS scans
       FROM glucose_readings`).get();
        return { scheduler: schedulerState(), lastOk, runs, errors, imports, readings, now: nowSec() };
    });
    app.setErrorHandler((err, req, reply) => {
        const code = err.statusCode ?? 500;
        if (code >= 500)
            req.log.error(err);
        reply.code(code).send({ error: code >= 500 ? 'Erro interno' : err.message });
    });
    if (webDir && fs.existsSync(webDir)) {
        await app.register(fastifyStatic, { root: path.resolve(webDir) });
        // SPA: qualquer rota fora de /api cai no index.html
        app.setNotFoundHandler((req, reply) => req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Não encontrado' }) : reply.sendFile('index.html'));
    }
    return app;
}
//# sourceMappingURL=app.js.map