import type { DayTable, Field, Meal, MealType, Reading, Targets } from '../../src/shared/types';

export type { Cell, DayTable, Field, Meal, MealRow, MealType, PeakCell, Reading, Targets } from '../../src/shared/types';

export class Unauthorized extends Error {}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  const res = await fetch(url, init);
  if (res.status === 401 && url !== '/api/login') throw new Unauthorized();
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error ?? `Erro ${res.status}`);
  return data as T;
}

export type SyncRun = {
  id: number; started_at: number; finished_at: number | null; status: 'running' | 'ok' | 'error';
  trigger: string; account_country: string | null; n_fetched: number | null; n_inserted: number | null;
  newest_ts: number | null; error: string | null;
};
export type CsvImport = {
  id: number; filename: string; imported_at: number; n_rows: number; n_inserted: number;
  n_duplicates: number; ignored: string; errors: string;
};
export type Status = {
  now: number;
  scheduler: { configured: boolean; intervalMin: number; nextRunAt: number | null; running: boolean };
  lastOk: SyncRun | undefined; runs: SyncRun[]; errors: SyncRun[]; imports: CsvImport[];
  readings: { total: number; oldest: number | null; newest: number | null; llu: number | null; csv: number | null; scans: number | null };
};
export type ImportResult = {
  filename: string; nRows: number; readings: number; inserted: number; duplicates: number;
  ignored: Record<string, number>; errors: string[];
};

export const api = {
  login: (password: string) => call('POST', '/api/login', { password }),
  logout: () => call('POST', '/api/logout'),
  meals: (date: string) => call<Meal[]>('GET', `/api/meals?date=${date}`),
  createMeal: (type: MealType) => call<Meal>('POST', '/api/meals', { type }),
  updateMeal: (id: number, m: Partial<Pick<Meal, 'type' | 'ts' | 'note'>>) => call<Meal>('PATCH', `/api/meals/${id}`, m),
  deleteMeal: (id: number) => call('DELETE', `/api/meals/${id}`),
  table: (from: string, to: string) => call<{ from: string; to: string; targets: Targets; days: DayTable[] }>('GET', `/api/table?from=${from}&to=${to}`),
  day: (date: string) => call<{ date: string; start: number; end: number; readings: Reading[]; meals: Meal[]; targets: Targets }>('GET', `/api/day?date=${date}`),
  targets: () => call<Targets>('GET', '/api/targets'),
  setTargets: (t: Partial<Targets>) => call<Targets>('PUT', '/api/targets', t),
  status: () => call<Status>('GET', '/api/status'),
  sync: () => call<SyncRun>('POST', '/api/sync'),
  importCsv: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return call<ImportResult>('POST', '/api/import/csv', fd);
  },
};

export const FIELD_LABELS: Record<Field, string> = { jejum: 'Jejum', pre: 'Pré', pos1h: '1h pós', pos2h: '2h pós', pico: 'Pico' };
export const MEAL_LABELS: Record<MealType, string> = { cafe: 'Café', almoco: 'Almoço', lanche: 'Lanche', jantar: 'Jantar', outro: 'Outro' };
export const MEAL_TYPES = Object.keys(MEAL_LABELS) as MealType[];
