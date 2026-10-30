# Transição de eleitores 1º → 2º turno (Presidente 2026, controle 2022)

Pipeline em Python + DuckDB sobre os dados abertos do TSE por seção eleitoral. Roda igual no Windows e no Linux.

```
pip install duckdb polars pandas matplotlib scipy pyarrow pyei
python -I run.py plano        # disponibilidade e tamanho dos arquivos (não baixa nada)
python -I run.py baixar       # data/raw/<ano>/<tipo>/*.zip  (para se faltar algum conjunto)
python -I run.py inspecionar  # cabeçalhos dos CSVs, para conferir mudanças de layout
python -I run.py consolidar   # data/proc/*.parquet (CSV lido com DuckDB, latin-1, ';')
python -I run.py validar      # totais nacionais x oficiais (0,01%); interrompe se divergir
python -I run.py analisar     # passos 3–8 -> reports/tabelas/<ano>/
python -I run.py relatorio    # reports/transicao_2026.md + reports/graficos/*.png
```

| Arquivo | Conteúdo |
|---|---|
| `src/config.py` | URLs, regex dos candidatos (por `NM_VOTAVEL`), totais oficiais de validação, aliases de colunas |
| `src/baixar.py` | descoberta via CKAN do TSE (fallback: padrões do CDN), download com retomada |
| `src/consolidar.py` | CSV → Parquet; tabela larga `secoes_<ano>.parquet` por (turno, UF, município, zona, seção) |
| `src/validar.py` | conferência dos totais |
| `src/analise.py` | chave de seção, fluxo líquido, giro bruto, MQ restrito + bootstrap, PyEI, modelo de resíduos |
| `src/relatorio.py` | relatório Markdown e gráficos |
| `tests/sintetico.py` | gera dados no layout do TSE com matriz de transição conhecida (teste do pipeline) |

Teste com dados sintéticos (não toca em `data/` nem em `reports/`):

```
ELEICOES_RAIZ=/tmp/sint python -I tests/sintetico.py
ELEICOES_RAIZ=/tmp/sint python -I run.py consolidar
ELEICOES_RAIZ=/tmp/sint python -I run.py validar --alvos /tmp/sint/alvos_sinteticos.json
ELEICOES_RAIZ=/tmp/sint python -I run.py analisar --boot 50 --pyei-secoes 300
ELEICOES_RAIZ=/tmp/sint python -I run.py relatorio
```
