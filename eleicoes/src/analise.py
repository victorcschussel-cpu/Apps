"""Passos 3 a 7 para um ano: chave de seção, fluxo líquido, giro bruto, inferência ecológica e resíduos.

A mesma função roda para 2026 e 2022; nada aqui é específico de um ano.
"""
import json

import duckdb
import numpy as np
import pandas as pd
from scipy import optimize, stats

from config import PROC, REPORTS, SEED, UF_EXTERIOR

CHAVE = ["uf", "cd_mun", "zona", "secao"]
LIN = ["dir", "lula", "outros", "bn", "abst"]   # 1º turno
COL = ["dir", "lula", "bn", "abst"]             # 2º turno


def carregar(ano):
    df = duckdb.sql(f"select * from '{(PROC / f'secoes_{ano}.parquet').as_posix()}'").df()
    df["bn"] = df["brancos"] + df["nulos"]
    votos = df[["lula", "dir", "outros", "bn"]].sum(axis=1)
    # abstenção definida por fechamento (aptos - votos apurados), para as linhas somarem os aptos
    df["abst"] = df["aptos"] - votos
    df["comp_apurado"] = votos
    return df


# ---------------------------------------------------------------- passo 3
def parear(df):
    t1 = df[df.turno == 1].set_index(CHAVE)
    t2 = df[df.turno == 2].set_index(CHAVE)
    so1, so2 = t1.index.difference(t2.index), t2.index.difference(t1.index)
    ambos = t1.index.intersection(t2.index)
    p = t1.loc[ambos].add_suffix("_1").join(t2.loc[ambos].add_suffix("_2")).reset_index()
    p["nm_mun"] = p["nm_mun_1"].fillna(p["nm_mun_2"])
    p["exterior"] = p["uf"] == UF_EXTERIOR

    def resumo(idx, nome, base):
        sub = base.loc[idx].reset_index()
        return {"grupo": nome, "secoes": len(sub), "exterior": int((sub.uf == UF_EXTERIOR).sum()),
                "aptos": int(sub.aptos.sum()), "comparecimento": int(sub.comp_apurado.sum())}

    chave = pd.DataFrame([
        {"grupo": "nos dois turnos", "secoes": len(p), "exterior": int(p.exterior.sum()),
         "aptos": int(p.aptos_1.sum()), "comparecimento": int(p.comp_apurado_1.sum())},
        resumo(so1, "só no 1º turno", t1), resumo(so2, "só no 2º turno", t2)])
    # divergência entre comparecimento do detalhe e votos apurados (ex.: anulados), por turno
    chave.attrs["dif_comparecimento"] = {
        t: int((g.comparecimento - g.comp_apurado).sum()) for t, g in df.groupby("turno")}
    chave.attrs["dif_aptos_pareadas"] = int((p.aptos_2 - p.aptos_1).abs().sum())
    so = pd.concat([t1.loc[so1].reset_index(), t2.loc[so2].reset_index()])
    return p, chave, so


# ---------------------------------------------------------------- passo 4
def fluxo_liquido(p, so, grupo="uf"):
    """Variação absoluta de cada categoria e parcela do estoque liberado que cada uma captou."""
    def linha(g, rotulo):
        r = {"recorte": rotulo, "aptos_1": g.aptos_1.sum(), "aptos_2": g.aptos_2.sum()}
        for c in LIN:
            r[f"{c}_1"] = g[f"{c}_1"].sum()
        for c in COL:
            r[f"{c}_2"] = g[f"{c}_2"].sum()
        r["outros_2"] = 0
        delta = {c: r[f"{c}_2"] - r[f"{c}_1"] for c in LIN}
        liberado = sum(-d for d in delta.values() if d < 0)
        captado = sum(d for d in delta.values() if d > 0)
        for c in LIN:
            r[f"d_{c}"] = delta[c]
            r[f"capt_{c}"] = max(delta[c], 0) / captado if captado else np.nan
        r["estoque_liberado"], r["estoque_captado"] = liberado, captado
        return r

    dom = p[~p.exterior]
    linhas = [linha(dom, "BR (seções pareadas, sem exterior)")]
    linhas += [linha(g, uf) for uf, g in dom.groupby(grupo)]
    if p.exterior.any():
        linhas.append(linha(p[p.exterior], "Exterior (ZZ)"))
    return pd.DataFrame(linhas)


# ---------------------------------------------------------------- passo 5
def giro_bruto(p, so):
    """Piso das entradas e saídas: soma separada de d>0 e d<0 por seção (compensações internas somem)."""
    def linha(g, rotulo):
        r = {"recorte": rotulo, "secoes": len(g), "comparecimento_1": g.comp_apurado_1.sum()}
        for nome, a, b in [("comparecimento", "comp_apurado_1", "comp_apurado_2"),
                           ("lula", "lula_1", "lula_2"), ("dir", "dir_1", "dir_2")]:
            d = g[b] - g[a]
            r[f"{nome}_entradas_piso"] = d[d > 0].sum()
            r[f"{nome}_saidas_piso"] = -d[d < 0].sum()
            r[f"{nome}_liquido"] = d.sum()
        r["giro_piso_%comp1"] = 100 * (r["comparecimento_entradas_piso"] + r["comparecimento_saidas_piso"]) / \
            r["comparecimento_1"]
        r["secoes_d_pos"], r["secoes_d_neg"] = int((g.comp_apurado_2 > g.comp_apurado_1).sum()), \
            int((g.comp_apurado_2 < g.comp_apurado_1).sum())
        return r

    dom = p[~p.exterior]
    out = [linha(dom, "BR (pareadas, sem exterior)")] + [linha(g, uf) for uf, g in dom.groupby("uf")]
    if p.exterior.any():
        out.append(linha(p[p.exterior], "Exterior (ZZ)"))
    t = pd.DataFrame(out)
    # seções não pareadas entram inteiras como entrada (só 2T) ou saída (só 1T)
    t.attrs["nao_pareadas"] = {
        "entradas_so_2T": int(so.loc[so.turno == 2, "comp_apurado"].sum()),
        "saidas_so_1T": int(so.loc[so.turno == 1, "comp_apurado"].sum())}
    return t


# ---------------------------------------------------------------- passo 6
def _matrizes(p):
    X = np.column_stack([p[f"{c}_1"] / p.aptos_1 for c in LIN])
    Y = np.column_stack([p[f"{c}_2"] / p.aptos_2 for c in COL])
    return X, Y, p.aptos_1.to_numpy(float)


def ls_restrito(G, H, B0=None):
    """min tr(B'GB) - 2tr(B'H)  s.a.  B >= 0, B·1 = 1   (B: 5x4)."""
    r, c = H.shape
    escala = np.trace(G) or 1.0
    G, H = G / escala, H / escala
    f = lambda b: float(np.sum(b.reshape(r, c) * (G @ b.reshape(r, c))) - 2 * np.sum(b.reshape(r, c) * H))
    g = lambda b: (2 * (G @ b.reshape(r, c)) - 2 * H).ravel()
    A = np.kron(np.eye(r), np.ones((1, c)))
    b0 = (B0 if B0 is not None else np.full((r, c), 1 / c)).ravel()
    res = optimize.minimize(f, b0, jac=g, method="SLSQP", bounds=[(0, 1)] * (r * c),
                            constraints=[{"type": "eq", "fun": lambda b: A @ b - 1, "jac": lambda b: A}],
                            options={"ftol": 1e-14, "maxiter": 1000})
    B = np.clip(res.x.reshape(r, c), 0, 1)
    return B / B.sum(axis=1, keepdims=True), res.success


def transicao(p, n_boot=200, seed=SEED):
    """Matriz por UF (MQ restrito ponderado por aptos) + nacional agregada pelos estoques do 1º turno."""
    rng = np.random.default_rng(seed)
    dom = p[~p.exterior & (p.aptos_1 > 0) & (p.aptos_2 > 0)]
    por_uf, boots, pesos, diag = {}, {}, {}, []
    for uf, g in dom.groupby("uf"):
        X, Y, w = _matrizes(g)
        B, ok = ls_restrito(X.T @ (w[:, None] * X), X.T @ (w[:, None] * Y))
        bs = []
        for _ in range(n_boot):
            cnt = rng.multinomial(len(g), np.full(len(g), 1 / len(g))).astype(float)
            wb = w * cnt
            bs.append(ls_restrito(X.T @ (wb[:, None] * X), X.T @ (wb[:, None] * Y), B)[0])
        por_uf[uf], boots[uf] = B, np.array(bs)
        pesos[uf] = g[[f"{c}_1" for c in LIN]].sum().to_numpy(float)
        prev = (g.aptos_1.to_numpy()[:, None] * X) @ B * (g.aptos_2 / g.aptos_1).to_numpy()[:, None]
        obs = g[[f"{c}_2" for c in COL]].sum().to_numpy(float)
        diag.append({"uf": uf, "secoes": len(g), "convergiu": ok,
                     **{f"erro_agregado_{c}": float(prev.sum(0)[j] - obs[j]) for j, c in enumerate(COL)},
                     "rmse_fracoes": float(np.sqrt(np.average(((Y - X @ B) ** 2).sum(1), weights=w)))})

    def agrega(mats):
        num = sum(pesos[u][:, None] * mats[u] for u in mats)
        den = sum(pesos[u] for u in mats)[:, None]
        return num / den

    nac = agrega(por_uf)
    nac_boot = np.array([agrega({u: boots[u][k] for u in boots}) for k in range(n_boot)]) if n_boot else None
    return {"por_uf": por_uf, "boot_uf": boots, "nacional": nac, "boot_nacional": nac_boot,
            "estoque_1t_nacional": sum(pesos.values()), "diagnostico": pd.DataFrame(diag)}


def tabela_matriz(B, boot=None, estoque=None):
    linhas = []
    for i, r in enumerate(LIN):
        for j, c in enumerate(COL):
            d = {"de_1T": r, "para_2T": c, "proporcao": B[i, j]}
            if boot is not None:
                d["ic95_inf"], d["ic95_sup"] = np.percentile(boot[:, i, j], [2.5, 97.5])
            if estoque is not None:
                d["eleitores_estimados"] = estoque[i] * B[i, j]
            linhas.append(d)
    return pd.DataFrame(linhas)


def pyei_amostra(p, n_total=2000, por_uf_min=30, draws=500, tune=500, chains=2, seed=SEED):
    """Robustez: multinomial-Dirichlet (PyEI) numa amostra de seções estratificada por UF (alocação ∝ aptos)."""
    from pyei.r_by_c import RowByColumnEI

    rng = np.random.default_rng(seed)
    dom = p[~p.exterior & (p.aptos_1 > 0) & (p.aptos_2 > 0)]
    peso = dom.groupby("uf").aptos_1.sum()
    alvo = np.maximum(por_uf_min, np.round(n_total * peso / peso.sum())).astype(int)
    partes = [g.iloc[rng.choice(len(g), min(len(g), alvo[uf]), replace=False)] for uf, g in dom.groupby("uf")]
    a = pd.concat(partes)
    X, Y, w = _matrizes(a)
    Y = Y / Y.sum(1, keepdims=True)
    ei = RowByColumnEI(model_name="multinomial-dirichlet")
    ei.fit(X.T, Y.T, a.aptos_1.to_numpy(int), demographic_group_names=LIN, candidate_names=COL,
           draws=draws, tune=tune, chains=chains, random_seed=seed, progressbar=False)
    return {"media": ei.posterior_mean_voting_prefs, "ic95": ei.credible_interval_95_mean_voting_prefs,
            "secoes": len(a), "por_uf": alvo.to_dict()}


# ---------------------------------------------------------------- passo 7
def _demean(M, grupos, w):
    """Remove médias ponderadas por grupo (efeito fixo de município)."""
    df = pd.DataFrame(M)
    wm = df.mul(w, axis=0).groupby(grupos).transform("sum").div(pd.Series(w).groupby(grupos).transform("sum"),
                                                                 axis=0)
    return (df - wm).to_numpy()


def modelo_residuos(p, usar_perfil=True):
    d = p[~p.exterior].copy()
    d["validos_2"] = d.lula_2 + d.dir_2
    d["validos_1"] = d.lula_1 + d.dir_1 + d.outros_1
    d = d[(d.validos_2 > 0) & (d.aptos_1 > 0) & (d.aptos_2 > 0)].copy()
    d["y"] = d.lula_2 / d.validos_2
    feats = {
        "lula1": d.lula_1 / d.aptos_1, "dir1": d.dir_1 / d.aptos_1, "outros1": d.outros_1 / d.aptos_1,
        "bn1": d.bn_1 / d.aptos_1,
        "d_comparecimento": d.comp_apurado_2 / d.aptos_2 - d.comp_apurado_1 / d.aptos_1,
    }
    feats["lula1_sq"], feats["dir1_sq"] = feats["lula1"] ** 2, feats["dir1"] ** 2
    feats["lula1_x_dir1"] = feats["lula1"] * feats["dir1"]
    if usar_perfil:
        e = d.eleitores_1.where(d.eleitores_1 > 0)
        feats.update({"idade_60_69": d.e60_69_1 / e, "idade_70m": d.e70m_1 / e, "idade_16_17": d.e16_17_1 / e})
    F = pd.DataFrame(feats, index=d.index)
    ok = F.notna().all(1)
    d, F = d[ok], F[ok]
    w = d.validos_2.to_numpy(float)
    grupos = (d.uf + "_" + d.cd_mun.astype(str)).to_numpy()
    Xd = _demean(F.to_numpy(float), grupos, w)
    yd = _demean(d[["y"]].to_numpy(float), grupos, w)[:, 0]
    sw = np.sqrt(w)
    beta, *_ = np.linalg.lstsq(Xd * sw[:, None], yd * sw, rcond=None)
    d["residuo"] = yd - Xd @ beta
    d["y_hat"] = d.y - d.residuo
    ph = d.y_hat.clip(0.01, 0.99)
    # resíduo padronizado pela variância binomial: comparável entre seções de tamanhos diferentes
    d["z"] = d.residuo / np.sqrt(ph * (1 - ph) / d.validos_2)
    coef = pd.Series(beta, index=F.columns)
    r2_within = 1 - np.average(d.residuo ** 2, weights=w) / np.average(yd ** 2, weights=w)
    return d, coef, float(r2_within)


def _resumo(z, r):
    sd_rob = 1.4826 * np.median(np.abs(z - np.median(z)))
    out = {"n": len(z), "media_res": float(r.mean()), "dp_res": float(r.std()),
           "curtose_exc_res": float(stats.kurtosis(r)), "assimetria_res": float(stats.skew(r)),
           "dp_z": float(z.std()), "dp_robusto_z": float(sd_rob), "curtose_exc_z": float(stats.kurtosis(z))}
    for k in (3, 4, 5):
        out[f"%|z|>{k}"] = float(100 * (np.abs(z) > k).mean())
        # esperado sob normal com a escala robusta observada
        out[f"%esperado_normal_{k}"] = float(100 * 2 * stats.norm.sf(k / sd_rob)) if sd_rob > 0 else np.nan
    return out


def analisar_residuos(d, top=200, n_sim=2000, seed=SEED):
    rng = np.random.default_rng(seed)
    geral = _resumo(d.z.to_numpy(), d.residuo.to_numpy())
    d = d.copy()
    d["porte"] = pd.qcut(d.aptos_1, 5, labels=[f"Q{i}" for i in range(1, 6)], duplicates="drop")
    corte = d.z.abs().nlargest(top).min()
    d["top"] = d.z.abs() >= corte

    def por(col):
        t = d.groupby(col, observed=True).apply(lambda g: pd.Series({
            **_resumo(g.z.to_numpy(), g.residuo.to_numpy()), "top200": int(g.top.sum()),
            "top200_esperado": top * len(g) / len(d)}), include_groups=False)
        t["razao_top"] = t.top200 / t.top200_esperado
        return t.reset_index()

    tabelas = {"uf": por("uf"), "porte": por("porte")}
    for c in [c for c in d.columns if c.startswith("attr_") and c.endswith("_2")]:
        if 1 < d[c].nunique() < 200:
            tabelas[c] = por(c)

    topdf = d[d.top].sort_values("z", key=np.abs, ascending=False)
    # concentração: compara com 200 seções sorteadas ao acaso (mesmo universo)
    def conc(s):
        return {"ufs_distintas": s.uf.nunique(), "municipios_distintos": s.mun_id.nunique(),
                "locais_distintos": s.local_id.nunique(), "max_por_municipio": s.mun_id.value_counts().max(),
                "max_por_local": s.local_id.value_counts().max()}
    d["mun_id"] = d.uf + "_" + d.cd_mun.astype(str)
    d["local_id"] = d.mun_id + "_" + d.zona.astype(str) + "_" + d.nr_local_1.astype(str)
    obs = conc(d.loc[topdf.index])
    sims = pd.DataFrame([conc(d.iloc[rng.choice(len(d), len(topdf), replace=False)]) for _ in range(n_sim)])
    concentracao = pd.DataFrame({
        "observado": obs, "media_aleatorio": sims.mean(),
        "p_valor_concentracao": {k: float(((sims[k] >= v) if k.startswith("max") else (sims[k] <= v)).mean())
                                 for k, v in obs.items()}})
    obs_uf = tabelas["uf"].top200.to_numpy(float)
    exp = tabelas["uf"].top200_esperado.to_numpy(float)
    exp = exp * obs_uf.sum() / exp.sum()
    grande = exp >= 5
    # UFs com esperado < 5 são somadas numa só categoria
    o_q, e_q = list(obs_uf[grande]), list(exp[grande])
    if (~grande).any():
        o_q.append(obs_uf[~grande].sum())
        e_q.append(exp[~grande].sum())
    qui = stats.chisquare(o_q, e_q) if len(o_q) > 1 else None
    sinal = {"z>0 (Lula acima do previsto)": int((topdf.z > 0).sum()), "z<0": int((topdf.z < 0).sum())}
    return {"geral": geral, "tabelas": tabelas, "top": topdf, "concentracao": concentracao,
            "qui2_uf": None if qui is None else {"estat": float(qui.statistic), "p": float(qui.pvalue)},
            "sinal_top": sinal, "z": d.z.to_numpy(), "residuo": d.residuo.to_numpy()}


# ---------------------------------------------------------------- orquestração
def executar(ano, usar_perfil=True, n_boot=200, pyei=True, pyei_kw=None):
    out = REPORTS / "tabelas" / str(ano)
    out.mkdir(parents=True, exist_ok=True)
    df = carregar(ano)
    p, chave, so = parear(df)
    chave.to_csv(out / "passo3_chave.csv", index=False)
    so.to_csv(out / "passo3_secoes_nao_pareadas.csv", index=False)

    fl = fluxo_liquido(p, so)
    fl.to_csv(out / "passo4_fluxo_liquido.csv", index=False)
    gb = giro_bruto(p, so)
    gb.to_csv(out / "passo5_giro_bruto.csv", index=False)

    tr = transicao(p, n_boot=n_boot)
    nac = tabela_matriz(tr["nacional"], tr["boot_nacional"], tr["estoque_1t_nacional"])
    nac.to_csv(out / "passo6_matriz_nacional.csv", index=False)
    pd.concat([tabela_matriz(B, tr["boot_uf"][uf]).assign(uf=uf) for uf, B in tr["por_uf"].items()]) \
        .to_csv(out / "passo6_matriz_por_uf.csv", index=False)
    tr["diagnostico"].to_csv(out / "passo6_diagnostico.csv", index=False)
    pe = None
    (out / "passo6_pyei_nacional.csv").unlink(missing_ok=True)
    if pyei:
        pe = pyei_amostra(p, **(pyei_kw or {}))
        tabela_matriz(pe["media"]).assign(ic95_inf=pe["ic95"][..., 0].ravel(), ic95_sup=pe["ic95"][..., 1].ravel()) \
            .to_csv(out / "passo6_pyei_nacional.csv", index=False)

    d, coef, r2 = modelo_residuos(p, usar_perfil)
    res = analisar_residuos(d)
    coef.to_csv(out / "passo7_coeficientes.csv")
    for k, t in res["tabelas"].items():
        t.to_csv(out / f"passo7_residuos_por_{k}.csv", index=False)
    cols = ["uf", "nm_mun", "cd_mun", "zona", "secao", "nr_local_1", "aptos_1", "lula_1", "dir_1", "outros_1",
            "lula_2", "dir_2", "y", "y_hat", "residuo", "z"]
    res["top"][cols].to_csv(out / "passo7_top200.csv", index=False)
    res["concentracao"].to_csv(out / "passo7_concentracao_top200.csv")
    np.save(out / "z.npy", res["z"])
    np.save(out / "residuo.npy", res["residuo"])
    resumo = {"ano": ano, "chave": chave.to_dict("records"), "dif_comparecimento": chave.attrs["dif_comparecimento"],
              "dif_aptos_pareadas": chave.attrs["dif_aptos_pareadas"], "nao_pareadas_giro": gb.attrs["nao_pareadas"],
              "r2_within": r2, "usar_perfil": usar_perfil, "n_boot": n_boot, "residuos_geral": res["geral"],
              "qui2_uf_top200": res["qui2_uf"], "sinal_top200": res["sinal_top"],
              "pyei": None if pe is None else {"secoes": pe["secoes"]}}
    (out / "resumo.json").write_text(json.dumps(resumo, indent=2, default=str, ensure_ascii=False))
    return resumo
