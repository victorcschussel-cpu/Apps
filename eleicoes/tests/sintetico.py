"""Gera zips no layout do TSE com uma matriz de transição CONHECIDA, para testar o pipeline.

Nada aqui é dado real. Uso: ELEICOES_RAIZ=<dir> python -I tests/sintetico.py
"""
import json
import os
import zipfile
from pathlib import Path

import numpy as np

RAIZ = Path(os.environ["ELEICOES_RAIZ"])
UFS = ["SP", "BA", "RS"]
LIN = ["dir", "lula", "outros", "bn", "abst"]
COL = ["dir", "lula", "bn", "abst"]
B_VERD = np.array([  # linhas somam 1
    [0.93, 0.02, 0.01, 0.04],
    [0.02, 0.93, 0.01, 0.04],
    [0.45, 0.35, 0.08, 0.12],
    [0.20, 0.20, 0.35, 0.25],
    [0.06, 0.07, 0.02, 0.85],
])
NOMES = {2026: ("FLÁVIO NANTES BOLSONARO", "LUIZ INÁCIO LULA DA SILVA", 22),
         2022: ("JAIR MESSIAS BOLSONARO", "LUIZ INÁCIO LULA DA SILVA", 22)}
FAIXAS = ["16 anos", "17 anos", "18 anos", "21 a 24 anos", "45 a 49 anos", "60 a 64 anos", "65 a 69 anos",
          "70 a 74 anos", "100 anos ou mais", "Inválido"]

CAB_V = ("DT_GERACAO;HH_GERACAO;ANO_ELEICAO;CD_TIPO_ELEICAO;NM_TIPO_ELEICAO;NR_TURNO;CD_ELEICAO;DS_ELEICAO;"
         "DT_ELEICAO;TP_ABRANGENCIA;SG_UF;SG_UE;NM_UE;CD_MUNICIPIO;NM_MUNICIPIO;NR_ZONA;NR_SECAO;CD_CARGO;"
         "DS_CARGO;NR_VOTAVEL;NM_VOTAVEL;QT_VOTOS;NR_LOCAL_VOTACAO;SQ_CANDIDATO;NM_LOCAL_VOTACAO;"
         "DS_LOCAL_VOTACAO_ENDERECO")
CAB_D = ("DT_GERACAO;HH_GERACAO;ANO_ELEICAO;NR_TURNO;SG_UF;CD_MUNICIPIO;NM_MUNICIPIO;NR_ZONA;NR_SECAO;"
         "CD_CARGO;DS_CARGO;QT_APTOS;QT_COMPARECIMENTO;QT_ABSTENCOES;QT_VOTOS_NOMINAIS;QT_VOTOS_BRANCOS;"
         "QT_VOTOS_NULOS;QT_VOTOS_LEGENDA;QT_VOTOS_ANULADOS_APU_SEP;DS_MODELO_URNA")
CAB_P = ("DT_GERACAO;HH_GERACAO;ANO_ELEICAO;SG_UF;CD_MUNICIPIO;NM_MUNICIPIO;NR_ZONA;NR_SECAO;NR_LOCAL_VOTACAO;"
         "CD_GENERO;DS_GENERO;CD_FAIXA_ETARIA;DS_FAIXA_ETARIA;QT_ELEITORES_PERFIL")


def q(*xs):
    return ";".join(f'"{x}"' for x in xs)


def gerar(ano, rng):
    dirn, lulan, _ = NOMES[ano]
    linhas_v, linhas_d, linhas_p = {u: [] for u in UFS + ["ZZ"]}, {u: [] for u in UFS + ["ZZ"]}, {}
    tot = {1: {}, 2: {}}
    for uf in UFS + ["ZZ"]:
        linhas_p[uf] = []
        nmun = 2 if uf == "ZZ" else 25
        for m in range(nmun):
            cd = 90000 + m if uf == "ZZ" else 10000 + 100 * UFS.index(uf) + m
            base = rng.dirichlet([3, 3, 0.6, 0.5, 1.2])
            for s in range(1, 41):
                zona, local = 1 + s % 3, 1000 + s // 4
                aptos = int(rng.integers(50, 420))
                frac = rng.dirichlet(base * 60)
                n1 = rng.multinomial(aptos, frac)
                n2 = sum(rng.multinomial(k, B_VERD[i]) for i, k in enumerate(n1))
                modelo = rng.choice(["UE2020", "UE2015", "UE2010"])
                for fx_i, fx in enumerate(FAIXAS):
                    linhas_p[uf].append(q("01/01/2026", "00:00", ano, uf, cd, f"MUN {cd}", zona, s, local, 2,
                                          "M", fx_i, fx, int(rng.integers(0, aptos // 5 + 1))))
                for turno, n in ((1, n1), (2, n2)):
                    if (turno == 1 and s == 40 and m == 0) or (turno == 2 and s == 39 and m == 1):
                        continue  # seções não pareadas de propósito
                    if turno == 1:
                        dirv, lula, outros, bn, abst = n
                        o1 = rng.multinomial(outros, [0.5, 0.3, 0.2])
                        votos = [(lulan, 13, lula), (dirn, 22, dirv), ("FULANO A", 12, o1[0]),
                                 ("FULANO B", 15, o1[1]), ("FULANO C", 30, o1[2])]
                    else:
                        dirv, lula, bn, abst = n
                        votos = [(lulan, 13, lula), (dirn, 22, dirv)]
                    br = int(rng.binomial(bn, 0.4))
                    votos += [("VOTO BRANCO", 95, br), ("VOTO NULO", 96, bn - br)]
                    for nm, nr, v in votos:
                        if v > 0:
                            linhas_v[uf].append(q("01/01/2026", "00:00", ano, 619, "Eleição Ordinária", turno, 1,
                                                  "Eleição Geral", "04/10/2026", "F", uf, uf, uf, cd, f"MUN {cd}",
                                                  zona, s, 1, "Presidente", nr, nm, v, local, -1, "ESCOLA", "RUA"))
                        tot[turno][nr] = tot[turno].get(nr, 0) + v
                    comp = aptos - abst
                    linhas_d[uf].append(q("01/01/2026", "00:00", ano, turno, uf, cd, f"MUN {cd}", zona, s, 1,
                                          "Presidente", aptos, comp, abst, comp - bn, br, bn - br, 0, 0, modelo))
                    tot[turno]["comp"] = tot[turno].get("comp", 0) + comp
                    tot[turno]["br"] = tot[turno].get("br", 0) + br
                    tot[turno]["nu"] = tot[turno].get("nu", 0) + bn - br
    raw = RAIZ / "data" / "raw" / str(ano)

    def gravar(tipo, nome, membros):
        (raw / tipo).mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(raw / tipo / nome, "w", zipfile.ZIP_DEFLATED) as z:
            for mnome, cab, ls in membros:
                z.writestr(mnome, ("\n".join([q(*cab.split(";"))] + ls) + "\n").encode("latin-1"))

    gravar("votacao", f"votacao_secao_{ano}_BR.zip",
           [(f"votacao_secao_{ano}_BR.csv", CAB_V, sum(linhas_v.values(), []))])
    gravar("detalhe", f"detalhe_votacao_secao_{ano}.zip",
           [(f"detalhe_votacao_secao_{ano}_{u}.csv", CAB_D, l) for u, l in linhas_d.items()])
    for u, l in linhas_p.items():
        gravar("perfil", f"perfil_eleitor_secao_{ano}_{u}.zip", [(f"perfil_eleitor_secao_{ano}_{u}.csv", CAB_P, l)])
    return {t: {"lula": ("exato", d[13]), "dir": ("exato", d[22]), "comparecimento": ("exato", d["comp"]),
                "brancos": ("exato", d["br"]), "nulos": ("exato", d["nu"])} for t, d in tot.items()}


if __name__ == "__main__":
    rng = np.random.default_rng(1)
    alvos = {ano: gerar(ano, rng) for ano in (2026, 2022)}
    (RAIZ / "alvos_sinteticos.json").write_text(json.dumps(alvos, default=int))
    np.save(RAIZ / "B_verdadeira.npy", B_VERD)
    print("ok", RAIZ)
