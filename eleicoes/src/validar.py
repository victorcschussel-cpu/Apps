"""Confere os totais nacionais com os oficiais antes de qualquer análise."""
import duckdb

from config import ALVOS, PROC, TOL


def totais(ano):
    s = (PROC / f"secoes_{ano}.parquet").as_posix()
    rows = duckdb.sql(f"""select turno, sum(lula) lula, sum(dir) dir, sum(outros) outros,
        sum(lula)+sum(dir)+sum(outros) validos, sum(brancos) brancos_votacao, sum(nulos) nulos_votacao,
        sum(brancos_det) brancos_detalhe, sum(nulos_det) nulos_detalhe, sum(comparecimento) comparecimento,
        sum(aptos) aptos, sum(anulados) anulados
        from '{s}' group by turno order by turno""").fetchall()
    cols = ["turno", "lula", "dir", "outros", "validos", "brancos_votacao", "nulos_votacao", "brancos_detalhe",
            "nulos_detalhe", "comparecimento", "aptos", "anulados"]
    return {r[0]: dict(zip(cols, r)) for r in rows}


def conferir(ano, alvos=None):
    """Retorna (ok, linhas). Brancos/nulos são conferidos nas duas fontes (votação 95/96 e detalhe)."""
    alvos = alvos or ALVOS[ano]
    tot = totais(ano)
    linhas, ok = [], True
    for turno, metas in alvos.items():
        t = tot.get(turno, {})
        for nome, meta in metas.items():
            fontes = [f"{nome}_votacao", f"{nome}_detalhe"] if nome in ("brancos", "nulos") else [nome]
            for fonte in fontes:
                obs = t.get(fonte)
                if meta[0] == "exato":
                    alvo, tol = meta[1], meta[1] * TOL
                else:
                    alvo, tol = meta[1], meta[2]
                diff = None if obs is None else obs - alvo
                passou = diff is not None and abs(diff) <= tol
                linhas.append((ano, turno, fonte, alvo, obs, diff, None if obs is None else diff / alvo, tol, passou))
            # basta uma das fontes bater para brancos/nulos; ambas são impressas
            ok &= any(l[-1] for l in linhas[-len(fontes):])
    return ok, linhas


def imprimir(linhas):
    print(f"{'ano':>4} {'T':>1} {'métrica':18s} {'oficial':>14} {'TSE dados':>14} {'diferença':>10} {'dif %':>9} ok")
    for ano, t, f, alvo, obs, diff, rel, tol, p in linhas:
        obs_s = "—" if obs is None else f"{obs:,.0f}"
        d_s = "—" if diff is None else f"{diff:+,.0f}"
        r_s = "—" if rel is None else f"{100 * rel:+.4f}%"
        print(f"{ano:>4} {t:>1} {f:18s} {alvo:>14,.0f} {obs_s:>14} {d_s:>10} {r_s:>9} {'OK' if p else 'FALHA'}")
