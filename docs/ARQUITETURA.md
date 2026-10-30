# Glicemia por refeição: arquitetura

## Componentes (um único processo Node 22 + TypeScript, no Fly.io)

```
┌──────────── servidor (Fastify) ────────────┐
│ job de sync (a cada 90 min) ── LLU API     │
│ importador CSV LibreView                   │
│ SQLite (better-sqlite3) no volume /data    │
│ API REST /api/*  +  front estático         │
└──────────────────┬─────────────────────────┘
                   │ HTTPS + senha única (cookie 180 dias)
         PWA React + Vite (iPhone/iPad, "Adicionar à Tela de Início")
```

| Arquivo | Papel |
|---|---|
| `src/server/table.ts` | regras da tabela (função pura, testada) |
| `src/server/db.ts` | schema (migrações), dedup, consultas |
| `src/server/sync.ts` | cliente LibreLinkUp + agendador |
| `src/server/csvImport.ts` | parser do CSV do LibreView |
| `src/server/export.ts` | CSV e PDF |
| `src/server/app.ts` | rotas |
| `src/shared/types.ts` | tipos usados pelo servidor e pelo front |
| `web/src/` | telas: Registrar, Tabela, Gráfico, Status, Ajustes |

## Regras da tabela (dia = 00:00–24:00 em America/Sao_Paulo)
| Campo | Regra |
|---|---|
| Jejum (1 por dia) | leitura mais próxima de T−15 min do **café**, ±7 min. Sem café no dia, usa a 1ª refeição. |
| Pré | leitura mais próxima de T−15 min, ±7 min |
| 1h / 2h | leitura mais próxima de T+60 / T+120, ±7 min |
| Pico | máximo em [T, T+180], **cortado na refeição seguinte** se ela vier antes |

Sem interpolação. Estados de célula: `ok`, `missing` ("sem": nenhuma leitura na tolerância) e
`pending` (a janela ainda não terminou). O pico pode vir marcado como ✂ (cortado) ou ≈ (parcial:
buraco > 20 min na janela). Escaneadas também contam como candidatas a "mais próxima".
Valor acima de `max` vai em vermelho ▲; abaixo de `min`, em azul ▼.

## Banco
Todos os instantes ficam em epoch UTC (segundos); a conversão de fuso acontece só na exibição.
- `glucose_readings`: `UNIQUE(kind, ts_minute)`. Além disso, uma leitura `cgm` de outra fonte a ±2 min
  é tratada como a mesma (o relógio do sensor e o do celular diferem no CSV).
- `meals`, `targets` (max/min por campo), `sync_runs` (cada execução, com erro),
  `csv_imports` (cada arquivo, com a contagem de linhas ignoradas por tipo).

## Sincronização (LibreLinkUp)
- `@diakem/libre-link-up-api-client` 0.7.2 segue o redirect de região sozinha. Requer
  `clientVersion` ≥ 4.16.0 e `@babel/runtime@7` (dependência que a lib não declara).
- Um cliente por processo: o login só é refeito quando uma chamada falha, para não arriscar
  bloqueio por excesso de logins.
- A API só devolve **~12 h**. A cada 90 min há folga para ~7 falhas seguidas; além disso, o buraco
  só é preenchido pelo CSV. A tela de Status avisa quando a leitura mais recente tem mais de 3 h.

## CSV do LibreView
Cabeçalho em PT ou EN; `,` ou `;`; mg/dL ou mmol/L; datas dd-MM ou MM-dd (detectado no arquivo).
`Tipo de registro` 0 = histórica, 1 = escaneada. Os demais tipos são contados e registrados.
O horário do CSV é local do aparelho e é interpretado como America/Sao_Paulo.
