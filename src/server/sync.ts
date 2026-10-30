import { LibreLinkUpClient } from '@diakem/libre-link-up-api-client';
import { insertReadings, type DB, type NewReading } from './db.js';

type Client = ReturnType<typeof LibreLinkUpClient>;

const { LLU_EMAIL, LLU_PASSWORD, LLU_VERSION = '4.16.0', LLU_PATIENT_NAME } = process.env;
export const syncConfigured = Boolean(LLU_EMAIL && LLU_PASSWORD);
export const SYNC_INTERVAL_MIN = Number(process.env.SYNC_INTERVAL_MIN || 90);

// Um cliente por processo: a lib guarda o token e só refaz login quando uma chamada falha.
// Logar a cada execução arrisca bloqueio da conta por excesso de logins.
let client: Client | null = null;
let accountCountry: string | null = null;
let running: Promise<void> | null = null;
let nextRunAt: number | null = null;

async function getClient(): Promise<Client> {
  if (client) return client;
  const c = LibreLinkUpClient({
    username: LLU_EMAIL!,
    password: LLU_PASSWORD!,
    clientVersion: LLU_VERSION,
    ...(LLU_PATIENT_NAME ? { connectionIdentifier: LLU_PATIENT_NAME } : {}),
  });
  const login = await c.login();
  accountCountry = login.data.user.country ?? null;
  return (client = c);
}

/** Só status/corpo da resposta: o erro do axios carrega o corpo da requisição de login (com a senha). */
export function describeError(e: unknown): string {
  const err = e as { response?: { status: number; data: unknown }; message?: string };
  if (err.response) return `HTTP ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 500)}`;
  return err.message ?? String(e);
}

async function doSync(db: DB, trigger: 'schedule' | 'manual') {
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO sync_runs (started_at, status, trigger) VALUES (unixepoch(), 'running', ?)`)
    .run(trigger);
  const runId = Number(lastInsertRowid);
  try {
    const { current, history } = await (await getClient()).read();
    const readings: NewReading[] = [...history, current].map((r) => ({
      ts: Math.floor(r.date.getTime() / 1000),
      value: r.value,
      kind: 'cgm',
      trend: r.trend,
    }));
    const valid = readings.filter((r) => Number.isFinite(r.ts) && r.value > 0);
    const { inserted } = insertReadings(db, valid, 'llu');
    db.prepare(
      `UPDATE sync_runs SET status = 'ok', finished_at = unixepoch(), account_country = ?, n_fetched = ?, n_inserted = ?, newest_ts = ? WHERE id = ?`,
    ).run(accountCountry, valid.length, inserted, Math.max(...valid.map((r) => r.ts)), runId);
  } catch (e) {
    client = null;
    db.prepare(`UPDATE sync_runs SET status = 'error', finished_at = unixepoch(), error = ? WHERE id = ?`).run(describeError(e), runId);
  }
}

/** Execuções concorrentes (manual + agendada) compartilham a mesma. */
export function runSync(db: DB, trigger: 'schedule' | 'manual' = 'manual') {
  if (!syncConfigured) throw new Error('LLU_EMAIL/LLU_PASSWORD não configurados');
  running ??= doSync(db, trigger).finally(() => (running = null));
  return running;
}

export function startScheduler(db: DB) {
  if (!syncConfigured) return;
  const tick = async () => {
    await runSync(db, 'schedule');
    nextRunAt = Math.floor(Date.now() / 1000) + SYNC_INTERVAL_MIN * 60;
    setTimeout(tick, SYNC_INTERVAL_MIN * 60_000).unref();
  };
  void tick();
}

export const schedulerState = () => ({
  configured: syncConfigured,
  intervalMin: SYNC_INTERVAL_MIN,
  nextRunAt,
  running: running != null,
});
