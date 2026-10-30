"""Pipeline de transição 1º→2º turno (Presidente).

Uso (rode sempre com -I, para que nada em data/ seja importado):
  python -I run.py plano                  # tamanhos e disponibilidade, sem baixar
  python -I run.py baixar                 # baixa 2026 e 2022 para data/raw
  python -I run.py inspecionar            # cabeçalhos dos CSVs
  python -I run.py consolidar             # CSV -> Parquet (data/proc)
  python -I run.py validar                # totais x oficiais; para se divergir
  python -I run.py analisar [--sem-pyei] [--boot N]
  python -I run.py relatorio
  python -I run.py tudo
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

import config  # noqa: E402

ANOS = [2026, 2022]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("etapa", choices=["plano", "baixar", "inspecionar", "consolidar", "validar", "analisar",
                                      "relatorio", "tudo"])
    ap.add_argument("--anos", type=int, nargs="+", default=ANOS)
    ap.add_argument("--boot", type=int, default=200)
    ap.add_argument("--sem-pyei", action="store_true")
    ap.add_argument("--pyei-secoes", type=int, default=2000)
    ap.add_argument("--alvos", type=Path, help="JSON com totais oficiais alternativos (teste)")
    a = ap.parse_args()
    etapas = ["baixar", "consolidar", "validar", "analisar", "relatorio"] if a.etapa == "tudo" else [a.etapa]

    for etapa in etapas:
        if etapa in ("plano", "baixar"):
            import baixar
            faltando = baixar.executar(a.anos, so_plano=etapa == "plano")
            if faltando and etapa == "baixar":
                sys.exit("Conjuntos ausentes: " + ", ".join(f"{t} {y}" for y, t in faltando)
                         + ". Parei aqui (sem improvisar).")
        elif etapa == "inspecionar":
            import consolidar
            for ano in a.anos:
                consolidar.inspecionar(ano)
        elif etapa == "consolidar":
            import consolidar
            for ano in a.anos:
                consolidar.executar(ano)
        elif etapa == "validar":
            import validar
            alvos = json.loads(a.alvos.read_text()) if a.alvos else {}
            tudo_ok = True
            for ano in a.anos:
                metas = {int(t): {k: tuple(v) for k, v in m.items()} for t, m in alvos[str(ano)].items()} \
                    if alvos else None
                ok, linhas = validar.conferir(ano, metas)
                validar.imprimir(linhas)
                tudo_ok &= ok
            if not tudo_ok:
                sys.exit("VALIDAÇÃO FALHOU — análise interrompida. Veja as divergências acima.")
        elif etapa == "analisar":
            import analise
            import duckdb
            # mesma régua nos dois anos: perfil etário só entra se existir para todos
            usar_perfil = all(
                duckdb.sql(f"select count(eleitores) from '{(config.PROC / f'secoes_{ano}.parquet').as_posix()}'")
                .fetchall()[0][0] > 0 for ano in a.anos)
            for ano in a.anos:
                r = analise.executar(ano, usar_perfil=usar_perfil, n_boot=a.boot, pyei=not a.sem_pyei,
                                     pyei_kw={"n_total": a.pyei_secoes})
                print(json.dumps(r["residuos_geral"], indent=1))
        elif etapa == "relatorio":
            import relatorio
            print(relatorio.gerar(a.anos))


if __name__ == "__main__":
    main()
