# Glicemia por refeição — arquitetura

## Componentes (um único processo Node 22 + TypeScript)

```
┌──────────── servidor (Fastify) ────────────┐
│ sync job (node-cron, 90 min) ── LLU API    │
│ importador CSV LibreView                   │
│ SQLite (better-sqlite3, data/glicemia.db)  │
│ API REST: /readings /meals /table /targets │
│           /export.csv /export.pdf /status  │
│ serve o front estático                     │
└──────────────────┬─────────────────────────┘
                   │ HTTPS + senha única
         PWA React + Vite (iPhone/iPad, "Adicionar à Tela de Início")
```

- **Servidor sempre ligado** (Raspberry/NAS em casa, VPS ou Fly.io com volume): o job e o SQLite moram nele.
- **Front**: React + Vite como PWA; gráfico com uPlot (leve, bom em telas touch); fusos com Luxon.
- **Export**: CSV no servidor; PDF com pdfkit no servidor (mesmo layout no iPhone e no iPad).
- **Acesso**: senha única + cookie de sessão; são dados de saúde e o app fica exposto na internet.

## Sincronização (LibreLinkUp)
- Biblioteca `@diakem/libre-link-up-api-client` 0.7.2 (segue o redirect de região sozinha).
  Precisa de `clientVersion` ≥ 4.16.0 e `@babel/runtime@7` instalado à parte (bug de empacotamento).
- A API devolve só as **~12 h mais recentes** (`graphData`). Job a cada 90 min dá folga para
  ~7 falhas seguidas; acima disso o buraco só é preenchido pelo CSV.
- Cada execução grava uma linha em `sync_runs`; `INSERT OR IGNORE` faz a deduplicação.
- Token JWT em cache em `settings` para não logar a cada execução (evita bloqueio por excesso de login).

## Importador CSV LibreView
- Linha 1 = metadados, linha 2 = cabeçalho. Colunas por nome (PT e EN).
- `Tipo de registro` 0 → `cgm` (Histórico de glicose), 1 → `scan` (Glicose escaneada).
  Os demais (insulina, alimentos, notas, cetonas…) são contados por tipo e gravados em `csv_imports.ignored_types`.
- O horário do CSV é local do aparelho, sem fuso → interpretado como America/Sao_Paulo (Luxon cuida do
  horário de verão de antes de 2019).

## Dedup
`UNIQUE(kind, ts_minute)`: a API tem segundos e o CSV só minutos; dois pontos `cgm` nunca caem no mesmo minuto.

## Cálculo da tabela (sob demanda, nada armazenado)
Dia = 00:00–24:00 em America/Sao_Paulo. Para cada refeição em T:
| campo | regra |
|---|---|
| Jejum (1 por dia) | leitura antes da 1ª refeição do dia — ver questão 1 |
| Pré | leitura mais próxima de T−15 min, ±7 min |
| 1h / 2h | leitura mais próxima de T+60 / T+120, ±7 min; nenhuma → célula vazia sinalizada "sem leitura" |
| Pico | máx em [T, T+180] + horário; marcado "parcial" se a janela tiver buraco > 20 min |
Sem interpolação. As leituras escaneadas entram como candidatas a "mais próxima".

Valor acima de `max_mgdl` (ou abaixo de `min_mgdl`) → destaque de cor.
