import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { FIELDS, type Field, type Meal, type MealType, type Reading, type Targets } from './table.js';

export type DB = Database.Database;

/** Uma leitura cgm de outra fonte a menos disso é considerada a mesma (relógio do sensor x do celular). */
export const CROSS_SOURCE_WINDOW = 120;

// Todos os instantes em epoch UTC (segundos). Conversão para America/Sao_Paulo só na exibição.
const MIGRATIONS = [
  `
  CREATE TABLE glucose_readings (
    id          INTEGER PRIMARY KEY,
    ts_utc      INTEGER NOT NULL,
    ts_minute   INTEGER GENERATED ALWAYS AS (ts_utc / 60) STORED,
    value_mgdl  INTEGER NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('cgm', 'scan')),
    source      TEXT NOT NULL CHECK (source IN ('llu', 'csv')),
    trend       TEXT,
    imported_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (kind, ts_minute)
  );
  CREATE INDEX idx_readings_ts ON glucose_readings (ts_utc);

  CREATE TABLE meals (
    id          INTEGER PRIMARY KEY,
    type        TEXT NOT NULL CHECK (type IN ('cafe', 'almoco', 'lanche', 'jantar', 'outro')),
    ts_utc      INTEGER NOT NULL,
    note        TEXT,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX idx_meals_ts ON meals (ts_utc);

  CREATE TABLE targets (
    field     TEXT PRIMARY KEY CHECK (field IN ('jejum', 'pre', 'pos1h', 'pos2h', 'pico')),
    max_mgdl  INTEGER,
    min_mgdl  INTEGER
  );
  INSERT INTO targets VALUES ('jejum', 99, 70), ('pre', 99, 70), ('pos1h', 140, NULL), ('pos2h', 120, NULL), ('pico', 140, NULL);

  CREATE TABLE sync_runs (
    id               INTEGER PRIMARY KEY,
    started_at       INTEGER NOT NULL,
    finished_at      INTEGER,
    status           TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
    trigger          TEXT NOT NULL CHECK (trigger IN ('schedule', 'manual')),
    account_country  TEXT,
    n_fetched        INTEGER,
    n_inserted       INTEGER,
    newest_ts        INTEGER,
    error            TEXT
  );

  CREATE TABLE csv_imports (
    id             INTEGER PRIMARY KEY,
    filename       TEXT NOT NULL,
    imported_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    n_rows         INTEGER NOT NULL,
    n_inserted     INTEGER NOT NULL,
    n_duplicates   INTEGER NOT NULL,
    ignored        TEXT NOT NULL,
    errors         TEXT NOT NULL
  );
  `,
];

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const version = db.pragma('user_version', { simple: true }) as number;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  // Uma execução interrompida (deploy/restart) não fica "running" para sempre.
  db.prepare(`UPDATE sync_runs SET status = 'error', error = 'interrompida', finished_at = unixepoch() WHERE status = 'running'`).run();
  return db;
}

export type NewReading = Reading & { trend?: string | null };

/**
 * Grava leituras com deduplicação:
 * - mesmo tipo no mesmo minuto → ignora (UNIQUE);
 * - cgm de outra fonte a ±CROSS_SOURCE_WINDOW → ignora (API e CSV marcam o mesmo ponto com relógios diferentes).
 */
export function insertReadings(db: DB, readings: NewReading[], source: 'llu' | 'csv') {
  const nearOther = db.prepare(
    `SELECT 1 FROM glucose_readings WHERE kind = 'cgm' AND source != ? AND ts_utc BETWEEN ? AND ? LIMIT 1`,
  );
  const insert = db.prepare(
    `INSERT OR IGNORE INTO glucose_readings (ts_utc, value_mgdl, kind, source, trend) VALUES (?, ?, ?, ?, ?)`,
  );
  let inserted = 0;
  db.transaction(() => {
    for (const r of readings) {
      if (r.kind === 'cgm' && nearOther.get(source, r.ts - CROSS_SOURCE_WINDOW, r.ts + CROSS_SOURCE_WINDOW)) continue;
      inserted += insert.run(r.ts, r.value, r.kind, source, r.trend ?? null).changes;
    }
  })();
  return { inserted, duplicates: readings.length - inserted };
}

export function getReadings(db: DB, from: number, to: number): Reading[] {
  return db
    .prepare(`SELECT ts_utc AS ts, value_mgdl AS value, kind FROM glucose_readings WHERE ts_utc >= ? AND ts_utc < ? ORDER BY ts_utc`)
    .all(from, to) as Reading[];
}

const MEAL_COLS = `id, type, ts_utc AS ts, note`;

export function getMeals(db: DB, from: number, to: number): Meal[] {
  return db.prepare(`SELECT ${MEAL_COLS} FROM meals WHERE ts_utc >= ? AND ts_utc < ? ORDER BY ts_utc, id`).all(from, to) as Meal[];
}

export function getNextMeal(db: DB, after: number): Meal | undefined {
  return db.prepare(`SELECT ${MEAL_COLS} FROM meals WHERE ts_utc >= ? ORDER BY ts_utc, id LIMIT 1`).get(after) as Meal | undefined;
}

export function getMeal(db: DB, id: number): Meal | undefined {
  return db.prepare(`SELECT ${MEAL_COLS} FROM meals WHERE id = ?`).get(id) as Meal | undefined;
}

export function createMeal(db: DB, m: { type: MealType; ts: number; note: string | null }): Meal {
  const { lastInsertRowid } = db.prepare(`INSERT INTO meals (type, ts_utc, note) VALUES (?, ?, ?)`).run(m.type, m.ts, m.note);
  return getMeal(db, Number(lastInsertRowid))!;
}

export function updateMeal(db: DB, id: number, m: Partial<{ type: MealType; ts: number; note: string | null }>) {
  const cur = getMeal(db, id);
  if (!cur) return undefined;
  const next = { ...cur, ...m };
  db.prepare(`UPDATE meals SET type = ?, ts_utc = ?, note = ?, updated_at = unixepoch() WHERE id = ?`).run(next.type, next.ts, next.note, id);
  return getMeal(db, id);
}

export const deleteMeal = (db: DB, id: number) => db.prepare(`DELETE FROM meals WHERE id = ?`).run(id).changes > 0;

export function getTargets(db: DB): Targets {
  const rows = db.prepare(`SELECT field, max_mgdl AS max, min_mgdl AS min FROM targets`).all() as { field: Field; max: number | null; min: number | null }[];
  return Object.fromEntries(rows.map((r) => [r.field, { max: r.max, min: r.min }])) as Targets;
}

export function setTargets(db: DB, targets: Partial<Targets>) {
  const stmt = db.prepare(`UPDATE targets SET max_mgdl = ?, min_mgdl = ? WHERE field = ?`);
  db.transaction(() => {
    for (const f of FIELDS) {
      const t = targets[f];
      if (t) stmt.run(t.max, t.min, f);
    }
  })();
}
