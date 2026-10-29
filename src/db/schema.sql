-- Todos os instantes em epoch UTC (segundos). Conversão para America/Sao_Paulo só na exibição.

CREATE TABLE glucose_readings (
  id          INTEGER PRIMARY KEY,
  ts_utc      INTEGER NOT NULL,             -- instante da medição
  ts_minute   INTEGER GENERATED ALWAYS AS (ts_utc / 60) STORED,
  value_mgdl  INTEGER NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('cgm', 'scan')),          -- histórica (automática) x escaneada
  source      TEXT NOT NULL CHECK (source IN ('llu', 'csv')),
  trend       TEXT,                         -- só vem da API
  imported_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (kind, ts_minute)                  -- dedup: API e CSV gravam o mesmo ponto com precisão diferente
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

-- Um limite por campo da tabela; null = sem limite.
CREATE TABLE targets (
  field     TEXT PRIMARY KEY CHECK (field IN ('jejum', 'pre', 'pos1h', 'pos2h', 'pico')),
  max_mgdl  INTEGER,
  min_mgdl  INTEGER
);
INSERT INTO targets VALUES ('jejum', 99, 70), ('pre', 99, 70), ('pos1h', 140, NULL), ('pos2h', 120, NULL), ('pico', 140, NULL);

CREATE TABLE sync_runs (
  id           INTEGER PRIMARY KEY,
  started_at   INTEGER NOT NULL,
  finished_at  INTEGER,
  status       TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
  region       TEXT,
  n_fetched    INTEGER,
  n_inserted   INTEGER,
  newest_ts    INTEGER,                     -- leitura mais recente recebida
  error        TEXT
);

CREATE TABLE csv_imports (
  id             INTEGER PRIMARY KEY,
  filename       TEXT NOT NULL,
  imported_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  n_rows         INTEGER NOT NULL,
  n_inserted     INTEGER NOT NULL,
  n_duplicates   INTEGER NOT NULL,
  ignored_types  TEXT NOT NULL              -- JSON {"tipo 4 (insulina)": 12, ...}
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- região/token em cache, etc.
