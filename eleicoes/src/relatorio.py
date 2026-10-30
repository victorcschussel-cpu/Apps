"""Gera reports/transicao_2026.md e os gráficos PNG a partir das tabelas de reports/tabelas/<ano>."""
import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from scipy import stats  # noqa: E402

from config import NOME_DIR, REPORTS  # noqa: E402

# Paleta de referência (validada): slot 1 azul, slot 2 laranja; sequencial azul.
COR = {2026: "#2a78d6", 2022: "#eb6834"}
TXT, TXT2, GRADE, FUNDO = "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb"
SEQ = ["#fcfcfb", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]
ROT_LIN = {"dir": "{dir}", "lula": "Lula", "outros": "Outros", "bn": "Branco/Nulo", "abst": "Abstenção"}

plt.rcParams.update({
    "figure.facecolor": FUNDO, "axes.facecolor": FUNDO, "axes.edgecolor": GRADE, "axes.labelcolor": TXT2,
    "xtick.color": TXT2, "ytick.color": TXT2, "text.color": TXT, "axes.grid": True, "grid.color": GRADE,
    "grid.linewidth": 0.6, "axes.spines.top": False, "axes.spines.right": False, "font.size": 10,
    "legend.frameon": False,
})


def br(x, casas=0):
    if pd.isna(x):
        return "—"
    s = f"{x:,.{casas}f}"
    return s.replace(",", "X").replace(".", ",").replace("X", ".")


def pct(x, casas=1):
    return "—" if pd.isna(x) else br(100 * x, casas) + "%"


def rot(c, ano):
    return ROT_LIN[c].format(dir=NOME_DIR[ano])


def md(df):
    cols = list(df.columns)
    linhas = ["| " + " | ".join(map(str, cols)) + " |", "|" + "|".join("---" for _ in cols) + "|"]
    linhas += ["| " + " | ".join(map(str, r)) + " |" for r in df.itertuples(index=False)]
    return "\n".join(linhas)


def ler(ano):
    T = REPORTS / "tabelas" / str(ano)
    r = {p.stem: pd.read_csv(p) for p in T.glob("*.csv")}
    r["resumo"] = json.loads((T / "resumo.json").read_text())
    r["z"] = np.load(T / "z.npy")
    return r


# ---------------------------------------------------------------- tabelas
def t_chave(r):
    c = r["passo3_chave"].copy()
    return md(pd.DataFrame({"Grupo": c.grupo, "Seções": c.secoes.map(br), "das quais exterior": c.exterior.map(br),
                            "Aptos": c.aptos.map(br), "Votos apurados": c.comparecimento.map(br)}))


def t_fluxo(r, ano, so_br=False):
    f = r["passo4_fluxo_liquido"]
    f = f.head(1) if so_br else f
    cats = ["dir", "lula", "outros", "bn", "abst"]
    out = pd.DataFrame({"Recorte": f.recorte})
    for c in cats:
        out[f"Δ {rot(c, ano)}"] = f[f"d_{c}"].map(lambda v: ("+" if v > 0 else "") + br(v))
    for c in ["dir", "lula", "bn", "abst"]:
        out[f"% captado {rot(c, ano)}"] = f[f"capt_{c}"].map(pct)
    out["Estoque liberado"] = f.estoque_liberado.map(br)
    return md(out)


def t_giro(r, so_br=False):
    g = r["passo5_giro_bruto"]
    g = g.head(1) if so_br else g
    return md(pd.DataFrame({
        "Recorte": g.recorte, "Seções": g.secoes.map(br),
        "Entradas (piso)": g.comparecimento_entradas_piso.map(br), "Saídas (piso)": g.comparecimento_saidas_piso.map(br),
        "Líquido": g.comparecimento_liquido.map(br), "Giro piso, % do comp. 1T": g["giro_piso_%comp1"].map(lambda v: br(v, 2)),
        "Lula entradas/saídas (piso)": g.lula_entradas_piso.map(br) + " / " + g.lula_saidas_piso.map(br),
        "Adversário entradas/saídas (piso)": g.dir_entradas_piso.map(br) + " / " + g.dir_saidas_piso.map(br)}))


def t_matriz(df, ano, com_ic=True, votos=False):
    linhas = []
    for de, g in df.groupby("de_1T", sort=False):
        d = {"1º turno ↓ / 2º turno →": rot(de, ano)}
        for _, x in g.iterrows():
            s = pct(x.proporcao)
            if com_ic and "ic95_inf" in x and not pd.isna(x.ic95_inf):
                s += f" ({pct(x.ic95_inf)}–{pct(x.ic95_sup)})"
            if votos and "eleitores_estimados" in x:
                s += f"<br>≈{br(x.eleitores_estimados / 1e3)} mil"
            d[rot(x.para_2T, ano)] = s
        linhas.append(d)
    return md(pd.DataFrame(linhas))


def t_matriz_uf(r, ano):
    m = r["passo6_matriz_por_uf"]
    chaves = [("outros", "dir"), ("outros", "lula"), ("bn", "dir"), ("bn", "lula"), ("abst", "dir"), ("abst", "lula"),
              ("dir", "lula"), ("lula", "dir")]
    linhas = []
    for uf, g in m.groupby("uf"):
        d = {"UF": uf}
        for a, b in chaves:
            x = g[(g.de_1T == a) & (g.para_2T == b)].iloc[0]
            d[f"{rot(a, ano)}→{rot(b, ano)}"] = f"{pct(x.proporcao)} ({pct(x.ic95_inf, 0)}–{pct(x.ic95_sup, 0)})"
        linhas.append(d)
    return md(pd.DataFrame(linhas))


def t_res_geral(rs):
    linhas = []
    for ano, r in rs.items():
        g = r["resumo"]["residuos_geral"]
        linhas.append({"Ano": ano, "Seções": br(g["n"]), "R² (within)": br(r["resumo"]["r2_within"], 3),
                       "DP resíduo (p.p.)": br(100 * g["dp_res"], 2), "Curtose exc. resíduo": br(g["curtose_exc_res"], 2),
                       "Assimetria": br(g["assimetria_res"], 2), "DP z": br(g["dp_z"], 2),
                       "DP robusto z": br(g["dp_robusto_z"], 2), "Curtose exc. z": br(g["curtose_exc_z"], 2),
                       "% |z|>4": br(g["%|z|>4"], 3), "% esperado (normal)": br(g["%esperado_normal_4"], 4),
                       "% |z|>5": br(g["%|z|>5"], 3)})
    return md(pd.DataFrame(linhas))


def t_res_uf(rs):
    a, b = rs[2026]["passo7_residuos_por_uf"], rs[2022]["passo7_residuos_por_uf"]
    m = a.merge(b, on="uf", suffixes=("_26", "_22"), how="outer")
    return md(pd.DataFrame({
        "UF": m.uf, "DP res. 2026 (p.p.)": (100 * m.dp_res_26).map(lambda v: br(v, 2)),
        "DP res. 2022 (p.p.)": (100 * m.dp_res_22).map(lambda v: br(v, 2)),
        "% |z|>4 2026": m["%|z|>4_26"].map(lambda v: br(v, 3)), "% |z|>4 2022": m["%|z|>4_22"].map(lambda v: br(v, 3)),
        "Top200 2026 (obs/esp)": m.top200_26.map(br) + " / " + m.top200_esperado_26.map(lambda v: br(v, 1)),
        "Top200 2022 (obs/esp)": m.top200_22.map(br) + " / " + m.top200_esperado_22.map(lambda v: br(v, 1))}))


def t_res_grupo(rs, chave):
    linhas = []
    for ano, r in rs.items():
        t = r.get(f"passo7_residuos_por_{chave}")
        if t is None:
            continue
        col = t.columns[0]
        for _, x in t.iterrows():
            linhas.append({"Ano": ano, "Grupo": x[col], "Seções": br(x.n), "DP res. (p.p.)": br(100 * x.dp_res, 2),
                           "% |z|>4": br(x["%|z|>4"], 3), "Top200 obs/esp": f"{br(x.top200)} / {br(x.top200_esperado, 1)}"})
    return md(pd.DataFrame(linhas)) if linhas else "_Atributo não presente nos dados._"


def t_conc(rs):
    linhas = []
    for ano, r in rs.items():
        c = r["passo7_concentracao_top200"].set_index("Unnamed: 0")
        for k, x in c.iterrows():
            linhas.append({"Ano": ano, "Medida": k, "Top 200": br(x.observado), "200 ao acaso (média)": br(x.media_aleatorio, 1),
                           "p (concentração ≥ observada)": br(x.p_valor_concentracao, 3)})
    return md(pd.DataFrame(linhas))


def t_top(r, n=25):
    t = r["passo7_top200"].head(n)
    return md(pd.DataFrame({"UF": t.uf, "Município": t.nm_mun, "Zona": t.zona, "Seção": t.secao, "Aptos": t.aptos_1.map(br),
                            "Lula 2T obs.": t.y.map(pct), "Previsto": t.y_hat.map(pct), "z": t.z.map(lambda v: br(v, 1))}))


# ---------------------------------------------------------------- gráficos
def g_residuos(rs, destino):
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(11, 4.2))
    lim = max(np.percentile(np.abs(r["z"]), 99.99) for r in rs.values())
    bins = np.linspace(-lim, lim, 81)
    for ano, r in rs.items():
        h, e = np.histogram(r["z"], bins=bins, density=True)
        a1.step(e[:-1], np.where(h > 0, h, np.nan), where="post", color=COR[ano], lw=2, label=str(ano))
        q = np.sort(r["z"])
        teo = stats.norm.ppf((np.arange(1, len(q) + 1) - 0.5) / len(q))
        idx = np.unique(np.linspace(0, len(q) - 1, 2000).astype(int))
        a2.plot(teo[idx], q[idx], color=COR[ano], lw=2, label=str(ano))
    a1.set_yscale("log")
    a1.set_title("Distribuição do resíduo padronizado z (escala log)", loc="left", fontsize=11)
    a1.set_xlabel("z = resíduo / erro binomial esperado")
    a1.set_ylabel("densidade")
    a1.legend()
    t = np.linspace(-4.5, 4.5, 2)
    a2.plot(t, t, color=TXT2, lw=1, ls="--", label="normal padrão")
    a2.set_title("Quantis de z vs. normal", loc="left", fontsize=11)
    a2.set_xlabel("quantil teórico N(0,1)")
    a2.set_ylabel("quantil observado")
    a2.legend()
    fig.tight_layout()
    fig.savefig(destino, dpi=150)
    plt.close(fig)


def g_matriz(df, ano, destino):
    linhas, colunas = list(dict.fromkeys(df.de_1T)), list(dict.fromkeys(df.para_2T))
    M = df.pivot(index="de_1T", columns="para_2T", values="proporcao").loc[linhas, colunas].to_numpy()
    fig, ax = plt.subplots(figsize=(7.2, 4.8))
    cmap = matplotlib.colors.LinearSegmentedColormap.from_list("seq", SEQ)
    ax.imshow(M, cmap=cmap, vmin=0, vmax=1)
    ax.grid(False)
    for i in range(M.shape[0]):
        for j in range(M.shape[1]):
            ax.text(j, i, pct(M[i, j]), ha="center", va="center", fontsize=9, color=TXT if M[i, j] < 0.55 else FUNDO)
    ax.set_xticks(range(len(colunas)), [rot(c, ano).replace("/", "/\n") for c in colunas])
    ax.set_yticks(range(len(linhas)), [rot(c, ano) for c in linhas])
    ax.set_xlabel("2º turno")
    ax.set_ylabel("1º turno")
    ax.set_title(f"Matriz de transição estimada, {ano} (MQ restrito)", loc="left", fontsize=11)
    fig.tight_layout()
    fig.savefig(destino, dpi=150)
    plt.close(fig)


def g_por_uf(rs, col, titulo, xlabel, destino, fonte="passo7_residuos_por_uf"):
    base = rs[2026][fonte]
    chave = base.columns[0]
    nac = base[chave].astype(str).str.startswith("BR")
    ordem = base[~nac].sort_values(col)[chave].tolist()
    fig, ax = plt.subplots(figsize=(7, 0.26 * len(ordem) + 1.2))
    for k, (ano, r) in enumerate(rs.items()):
        t = r[fonte].set_index(chave).reindex(ordem)
        ax.scatter(t[col], np.arange(len(ordem)) + (0.18 if k else -0.18), s=30, color=COR[ano], label=str(ano),
                   edgecolor=FUNDO, linewidth=1, zorder=3)
        tb = r[fonte]
        linha_br = tb[tb[chave].astype(str).str.startswith("BR")]
        if len(linha_br):
            ax.axvline(linha_br[col].iloc[0], color=COR[ano], lw=1, ls="--", zorder=2, label=f"Brasil {ano}")
    ax.set_yticks(range(len(ordem)), ordem)
    ax.set_xlabel(xlabel)
    ax.set_title(titulo, loc="left", fontsize=11)
    ax.legend(loc="upper left", bbox_to_anchor=(1.01, 1))
    fig.tight_layout()
    fig.savefig(destino, dpi=150)
    plt.close(fig)


# ---------------------------------------------------------------- relatório
def gerar(anos=(2026, 2022)):
    rs = {a: ler(a) for a in anos}
    G = REPORTS / "graficos"
    G.mkdir(parents=True, exist_ok=True)
    g_residuos(rs, G / "residuos_2026_vs_2022.png")
    for a in anos:
        g_matriz(rs[a]["passo6_matriz_nacional"], a, G / f"matriz_{a}.png")
    g_por_uf(rs, "%|z|>4", "Seções com |z| > 4, por UF", "% das seções da UF", G / "anomalias_por_uf.png")
    g_por_uf(rs, "giro_piso_%comp1", "Giro bruto (piso) do comparecimento, por UF", "% do comparecimento do 1º turno",
             G / "giro_por_uf.png", fonte="passo5_giro_bruto")

    r26, r22 = rs[2026], rs[2022]
    s26 = r26["resumo"]
    perfil = "incluído" if s26["usar_perfil"] else "NÃO incluído (perfil por seção indisponível em pelo menos um dos anos)"
    pyei = {a: rs[a].get("passo6_pyei_nacional") for a in anos}
    attrs = [k.replace("passo7_residuos_por_", "") for k in r26 if k.startswith("passo7_residuos_por_attr_")]

    def qui(a):
        q = rs[a]["resumo"]["qui2_uf_top200"]
        return f"{a}: —" if not q else f"{a}: χ² = {br(q['estat'], 1)}, p = {br(q['p'], 4)}"

    def sinal(a):
        v = list(rs[a]["resumo"]["sinal_top200"].values())
        return f"{a}: {v[0]} / {v[1]}"

    def bloco_pyei(a):
        if pyei[a] is None or not rs[a]["resumo"]["pyei"]:
            return "_PyEI não executado._"
        return (f"Amostra de {br(rs[a]['resumo']['pyei']['secoes'])} seções, estratificada por UF (alocação ∝ aptos). "
                f"Média a posteriori (IC 95%):\n\n{t_matriz(pyei[a], a)}")

    texto = f"""# Transição de eleitores 1º → 2º turno — Presidente 2026 (controle: 2022)

Fonte: TSE, Portal de Dados Abertos (votação por seção, detalhe da votação por seção, perfil do eleitorado por seção).
Todos os números deste relatório são gerados por `eleicoes/run.py` a partir dos arquivos em `data/raw`.
Nenhuma pesquisa eleitoral foi usada.

## 1. Validação

Os totais nacionais conferem com os oficiais (tolerância de 0,01% para valores exatos). A análise só roda depois disso
(`run.py validar` interrompe o pipeline em caso de divergência).

## 2. Chave de seção (UF, município, zona, seção)

### 2026
{t_chave(r26)}

### 2022
{t_chave(r22)}

Seções que existem em um só turno (agregação/desagregação, voto em trânsito, exterior) ficam fora das matrizes e do
modelo; no giro bruto entram à parte (2026: entradas só-2T {br(s26['nao_pareadas_giro']['entradas_so_2T'])},
saídas só-1T {br(s26['nao_pareadas_giro']['saidas_so_1T'])}). O exterior (UF = ZZ) é reportado separadamente.
Diferença entre comparecimento do arquivo de detalhe e votos apurados (2026): 1º turno
{br(s26['dif_comparecimento']['1'])}, 2º turno {br(s26['dif_comparecimento']['2'])}.

## 3. Fluxo líquido (passo 4) — contagem oficial

"Estoque liberado" = votos de Outros no 1º turno + reduções das demais categorias. "% captado" = parcela do total de
aumentos que coube a cada categoria. É saldo líquido: não diz quem migrou para onde.

### 2026
{t_fluxo(r26, 2026)}

### 2022 (controle, Brasil)
{t_fluxo(r22, 2022, so_br=True)}

## 4. Giro bruto do comparecimento (passo 5) — LIMITE INFERIOR

Por seção, d = comparecimento 2T − comparecimento 1T. Entradas (piso) = soma dos d > 0; saídas (piso) = soma dos d < 0.
**É um piso**: dentro de uma seção, quem deixou de votar e quem passou a votar se compensam e não aparecem.

### 2026
{t_giro(r26)}

### 2022 (controle, Brasil)
{t_giro(r22, so_br=True)}

![giro](graficos/giro_por_uf.png)

## 5. Matriz de transição (passo 6) — ESTIMATIVA

Linhas: categoria no 1º turno (fração dos aptos). Colunas: destino no 2º turno. Cada linha soma 100%.
Método principal: mínimos quadrados restritos por UF (proporções em [0,1], linhas somando 1, ponderação por aptos),
nacional = média das UFs ponderada pelo estoque de cada linha no 1º turno. IC 95%: bootstrap por seção ({br(s26['n_boot'])} réplicas).

### 2026 — nacional
{t_matriz(r26['passo6_matriz_nacional'], 2026, votos=True)}

![matriz 2026](graficos/matriz_2026.png)

### 2022 — nacional
{t_matriz(r22['passo6_matriz_nacional'], 2022, votos=True)}

![matriz 2022](graficos/matriz_2022.png)

### Robustez — PyEI (multinomial-Dirichlet)
**2026.** {bloco_pyei(2026)}

**2022.** {bloco_pyei(2022)}

### 2026 — por UF (principais células; demais em `tabelas/2026/passo6_matriz_por_uf.csv`)
{t_matriz_uf(r26, 2026)}

### Premissas e quando o método falha
- **Constância da matriz dentro da UF**: supõe que a taxa de transição de cada grupo é a mesma em todas as seções da UF
  (ou varia sem correlação com a composição da seção). Se eleitores de Outros migram de forma diferente em seções
  onde Outros é forte, a estimativa é viesada — é o **viés de agregação** (falácia ecológica).
- **Identificação fraca** em linhas pequenas e de baixa variância entre seções (tipicamente Outros e Branco/Nulo):
  os ICs largos sinalizam isso. O bootstrap mede ruído amostral, **não** o viés de agregação.
- **Mesmo eleitorado nos dois turnos**: os aptos praticamente não mudam; seções não pareadas são excluídas.
- **Abstenção definida por fechamento** (aptos − votos apurados) para que as linhas somem os aptos.
- MQ restrito não força os totais agregados previstos a coincidirem com os observados; o erro agregado por UF está em
  `passo6_diagnostico.csv`.
- PyEI usa amostra; diferenças em relação ao MQ dentro dos ICs não indicam discordância.

## 6. Teste de anomalia (passo 7) — ESTIMATIVA

Modelo por seção (MQ ponderado por votos válidos do 2T, efeito fixo de município): participação de Lula nos válidos do
2T ~ Lula, adversário, Outros e Branco/Nulo do 1T (frações dos aptos), seus termos quadráticos e interação Lula×adversário,
variação da taxa de comparecimento e perfil etário (% 16-17, % 60-69, % 70+; {perfil}).
z = resíduo / √(p̂(1−p̂)/válidos): resíduo em unidades do erro binomial esperado, comparável entre seções de tamanhos
diferentes. A mesma especificação é aplicada a 2022 e 2026.

### Distribuição geral
{t_res_geral(rs)}

"% esperado (normal)" usa a escala robusta (MAD) observada; excesso de |z|>4 sobre esse valor indica caudas mais
pesadas que a normal. A comparação relevante é **2026 vs. 2022**, medidos com a mesma régua.

![resíduos](graficos/residuos_2026_vs_2022.png)

### Por UF
{t_res_uf(rs)}

![anomalias por UF](graficos/anomalias_por_uf.png)

### Por porte da seção (quintis de aptos)
{t_res_grupo(rs, 'porte')}

### Por tipo/modelo de urna
{chr(10).join(t_res_grupo(rs, a) for a in attrs) if attrs else '_O campo de modelo de urna não existe nos arquivos usados; não foi possível fazer este corte._'}

### As 200 seções com maior |z|
Concentração comparada com {br(2000)} sorteios de 200 seções ao acaso no mesmo universo:

{t_conc(rs)}

O sorteio ao acaso supõe que todas as seções têm a mesma chance de cair no top 200. Municípios com mais
heterogeneidade entre seções concentram resíduos grandes naturalmente; por isso a leitura é **comparativa**
(2026 vs. 2022, mesma régua), não um teste isolado.

Qui-quadrado da distribuição por UF do top 200 vs. o esperado pelo número de seções: {qui(2026)}; {qui(2022)}.
Sinal dos resíduos no top 200 (Lula acima / abaixo do previsto): {sinal(2026)}; {sinal(2022)}.

Primeiras 25 de 2026 (lista completa em `tabelas/2026/passo7_top200.csv`):

{t_top(r26)}

## 7. Fato / Estimativa / Limitação

**Fato (contagem oficial do TSE)**
- Totais por candidato, brancos, nulos, comparecimento e aptos, nacionais, por UF e por seção, nos dois turnos.
- Fluxo líquido (seção 3): variação de cada categoria entre os turnos.
- Piso do giro bruto (seção 4): pelo menos esse número de comparecimentos entrou e saiu, no agregado das seções.

**Estimativa (depende de modelo)**
- Matriz de transição (seção 5): quanto de cada grupo do 1º turno foi para cada destino no 2º. Depende das premissas
  da inferência ecológica; os ICs cobrem só a incerteza amostral.
- Resíduos e seções atípicas (seção 6): atípico **em relação a este modelo**. Um resíduo grande pode vir de
  especificação incompleta (variáveis locais não observadas), mudança de agregação de seções, erro de cadastro ou
  comportamento local genuíno.

**Limitação (o que os dados não permitem concluir)**
- O voto é secreto e não há painel individual: nenhuma tabela aqui identifica a trajetória de eleitores individuais.
- O giro bruto real é maior que o piso, em quantidade desconhecida.
- A matriz não é identificável sem premissas; viés de agregação não é detectável pelo bootstrap.
- Resíduo atípico não é evidência, por si só, de irregularidade; e ausência de resíduos atípicos não prova ausência
  de qualquer problema. Este relatório não faz afirmações políticas nem de causalidade.
"""
    destino = REPORTS / "transicao_2026.md"
    destino.write_text(texto, encoding="utf-8")
    return destino
