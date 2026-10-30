"""Lê os CSVs do TSE (dentro dos .zip) com DuckDB e grava Parquet em data/proc.

Cada membro do zip é extraído para data/tmp, lido como texto (all_varchar) e apagado em seguida,
para não manter os CSVs descompactados em disco.
"""
import re
import shutil
import zipfile
from pathlib import Path

import duckdb

from config import ALIASES, CANDIDATOS, NR_BRANCO, NR_NULO, PROC, RAW, REGEX_ATRIBUTOS_URNA, TMP


def cabecalho(zf: zipfile.ZipFile, membro: str):
    with zf.open(membro) as f:
        linha = f.readline().decode("latin-1").strip()
    return [c.strip().strip('"') for c in linha.split(";")]


def mapear(colunas, necessarias, opcionais=()):
    """Resolve nomes lógicos -> nome real da coluna; erro explícito se faltar algo."""
    m = {}
    for nome in list(necessarias) + list(opcionais):
        real = next((a for a in ALIASES[nome] if a in colunas), None)
        if real is None and nome in necessarias:
            raise KeyError(f"coluna '{nome}' não encontrada (aliases {ALIASES[nome]}). Cabeçalho: {colunas}")
        if real:
            m[nome] = real
    return m


def inspecionar(ano):
    """Imprime o cabeçalho de cada tipo de arquivo (primeiro CSV de cada zip)."""
    vistos = {}
    for z in sorted((RAW / str(ano)).rglob("*.zip")):
        with zipfile.ZipFile(z) as zf:
            for membro in [n for n in zf.namelist() if n.lower().endswith(".csv")][:1]:
                cols = cabecalho(zf, membro)
                chave = (z.parent.name, tuple(cols))
                if chave not in vistos:
                    vistos[chave] = z.name
                    print(f"[{ano}/{z.parent.name}] {z.name}::{membro}\n  {';'.join(cols)}")
    return vistos


def _membros(tipo, ano):
    for z in sorted((RAW / str(ano) / tipo).glob("*.zip")):
        with zipfile.ZipFile(z) as zf:
            for membro in zf.namelist():
                if membro.lower().endswith(".csv"):
                    yield z, zf, membro


def _ler(con, zf, membro, destino_tmp: Path):
    destino_tmp.mkdir(parents=True, exist_ok=True)
    caminho = Path(zf.extract(membro, destino_tmp))
    rel = con.sql(f"""select * from read_csv('{caminho.as_posix()}', delim=';', quote='"', header=true,
                      encoding='latin-1', all_varchar=true, ignore_errors=false)""")
    return caminho, rel


def _i(col):
    return f"try_cast(nullif(nullif(\"{col}\", '#NULO#'), '#NE#') as bigint)"


def _cargo_presidente(m):
    return f"(\"{m['cd_cargo']}\" = '1' or upper(\"{m['ds_cargo']}\") like 'PRESIDENTE%')"


def _processar(tipo, ano, sql_de_membro):
    con = duckdb.connect()
    saida = PROC / str(ano) / tipo
    shutil.rmtree(saida, ignore_errors=True)
    saida.mkdir(parents=True)
    n = 0
    for z, zf, membro in _membros(tipo, ano):
        cols = cabecalho(zf, membro)
        caminho, rel = _ler(con, zf, membro, TMP / z.stem)
        con.register("src", rel)
        sql = sql_de_membro(cols)
        con.sql(f"copy ({sql}) to '{(saida / f'part_{n:03d}.parquet').as_posix()}' (format parquet)")
        con.unregister("src")
        caminho.unlink()
        n += 1
        print(f"  {tipo} {ano}: {z.name}::{membro}")
    shutil.rmtree(TMP, ignore_errors=True)
    if n == 0:
        raise FileNotFoundError(f"nenhum CSV de {tipo} {ano} em {RAW / str(ano) / tipo}")
    return con, saida


def votos(ano):
    def sql(cols):
        m = mapear(cols, ["turno", "uf", "cd_mun", "nm_mun", "zona", "secao", "cd_cargo", "ds_cargo",
                          "nr_votavel", "nm_votavel", "votos"], ["local"])
        local = _i(m["local"]) if "local" in m else "null::bigint"
        return f"""select {_i(m['turno'])} turno, "{m['uf']}" uf, {_i(m['cd_mun'])} cd_mun, "{m['nm_mun']}" nm_mun,
                   {_i(m['zona'])} zona, {_i(m['secao'])} secao, {local} nr_local,
                   {_i(m['nr_votavel'])} nr_votavel, "{m['nm_votavel']}" nm_votavel, {_i(m['votos'])} votos
                   from src where {_cargo_presidente(m)}"""
    con, saida = _processar("votacao", ano, sql)
    destino = PROC / f"votos_{ano}.parquet"
    con.sql(f"copy (select * from '{saida.as_posix()}/*.parquet') to '{destino.as_posix()}' (format parquet)")
    dup = con.sql(f"""select count(*) from (select turno,uf,cd_mun,zona,secao,nr_votavel,count(*) c
                      from '{destino.as_posix()}' group by all having c>1)""").fetchall()[0][0]
    if dup:
        raise ValueError(f"{dup} chaves (seção, votável) duplicadas em votos_{ano} — arquivos BR e UF sobrepostos?")
    return destino


def detalhe(ano):
    def sql(cols):
        m = mapear(cols, ["turno", "uf", "cd_mun", "zona", "secao", "cd_cargo", "ds_cargo", "aptos",
                          "comparecimento", "brancos", "nulos"], ["abstencoes", "nominais", "anulados", "local"])
        extras = [c for c in cols if re.search(REGEX_ATRIBUTOS_URNA, c)]
        opc = {k: (_i(m[k]) if k in m else "null::bigint") for k in ["abstencoes", "nominais", "anulados", "local"]}
        ex = "".join(f', "{c}" as "attr_{c}"' for c in extras)
        return f"""select {_i(m['turno'])} turno, "{m['uf']}" uf, {_i(m['cd_mun'])} cd_mun, {_i(m['zona'])} zona,
                   {_i(m['secao'])} secao, {opc['local']} nr_local, {_i(m['aptos'])} aptos,
                   {_i(m['comparecimento'])} comparecimento, {opc['abstencoes']} abstencoes,
                   {_i(m['brancos'])} brancos_det, {_i(m['nulos'])} nulos_det, {opc['nominais']} nominais,
                   {opc['anulados']} anulados {ex}
                   from src where {_cargo_presidente(m)}"""
    con, saida = _processar("detalhe", ano, sql)
    destino = PROC / f"detalhe_{ano}.parquet"
    con.sql(f"""copy (select * from read_parquet('{saida.as_posix()}/*.parquet', union_by_name=true))
                to '{destino.as_posix()}' (format parquet)""")
    return destino


def perfil(ano):
    def sql(cols):
        m = mapear(cols, ["uf", "cd_mun", "zona", "secao", "faixa", "qt_perfil"])
        idade = f"try_cast(regexp_extract(\"{m['faixa']}\", '(\\d+)', 1) as int)"
        q = _i(m["qt_perfil"])
        return f"""select "{m['uf']}" uf, {_i(m['cd_mun'])} cd_mun, {_i(m['zona'])} zona, {_i(m['secao'])} secao,
                   sum({q}) eleitores,
                   sum(case when {idade} between 16 and 17 then {q} else 0 end) e16_17,
                   sum(case when {idade} between 60 and 69 then {q} else 0 end) e60_69,
                   sum(case when {idade} >= 70 then {q} else 0 end) e70m
                   from src group by all"""
    con, saida = _processar("perfil", ano, sql)
    destino = PROC / f"perfil_{ano}.parquet"
    con.sql(f"""copy (select uf, cd_mun, zona, secao, sum(eleitores) eleitores, sum(e16_17) e16_17,
                sum(e60_69) e60_69, sum(e70m) e70m from '{saida.as_posix()}/*.parquet' group by all)
                to '{destino.as_posix()}' (format parquet)""")
    return destino


def identificar_candidatos(ano, con=None):
    """Lista os votáveis de Presidente e resolve 'lula' / 'dir' por regex sobre NM_VOTAVEL."""
    con = con or duckdb.connect()
    tab = con.sql(f"""select turno, nr_votavel, nm_votavel, sum(votos) v from '{(PROC / f'votos_{ano}.parquet').as_posix()}'
                      group by all order by turno, v desc""").fetchall()
    print(f"Votáveis Presidente {ano}:")
    for t, nr, nm, v in tab:
        print(f"  T{t} {nr:>3} {nm:40s} {v:>14,}")
    nums = {}
    for chave, rx in CANDIDATOS[ano].items():
        achados = {nr for t, nr, nm, _ in tab if re.search(rx, nm or "", re.I) and nr not in (NR_BRANCO, NR_NULO)}
        if len(achados) != 1:
            raise ValueError(f"{ano}: regex '{rx}' casou {achados} (esperado exatamente 1)")
        nums[chave] = achados.pop()
    return nums


def secoes(ano):
    """Tabela larga por seção e turno: aptos, comparecimento, votos por categoria e perfil etário."""
    con = duckdb.connect()
    nums = identificar_candidatos(ano, con)
    v, d = (PROC / f"votos_{ano}.parquet").as_posix(), (PROC / f"detalhe_{ano}.parquet").as_posix()
    p = PROC / f"perfil_{ano}.parquet"
    attrs = [c for c in con.sql(f"select * from '{d}' limit 0").columns if c.startswith("attr_")]
    attr_sel = "".join(f', any_value(d."{c}") "{c}"' for c in attrs)
    chave = " and ".join(f"p.{k} = coalesce(vv.{k}, dd.{k})" for k in ("uf", "cd_mun", "zona", "secao"))
    perfil_join = f"left join '{p.as_posix()}' p on {chave}" if p.exists() else ""
    perfil_sel = ("p.eleitores, p.e16_17, p.e60_69, p.e70m" if p.exists()
                  else "null::bigint eleitores, null::bigint e16_17, null::bigint e60_69, null::bigint e70m")
    destino = PROC / f"secoes_{ano}.parquet"
    con.sql(f"""
    copy (
      with vv as (
        select turno, uf, cd_mun, zona, secao, any_value(nm_mun) nm_mun, any_value(nr_local) nr_local_v,
          sum(votos) filter (where nr_votavel = {nums['lula']}) lula,
          sum(votos) filter (where nr_votavel = {nums['dir']}) dir,
          sum(votos) filter (where nr_votavel not in ({nums['lula']}, {nums['dir']}, {NR_BRANCO}, {NR_NULO})) outros,
          sum(votos) filter (where nr_votavel = {NR_BRANCO}) brancos,
          sum(votos) filter (where nr_votavel = {NR_NULO}) nulos
        from '{v}' group by turno, uf, cd_mun, zona, secao),
      dd as (
        select turno, uf, cd_mun, zona, secao, sum(aptos) aptos, sum(comparecimento) comparecimento,
          sum(abstencoes) abstencoes, sum(brancos_det) brancos_det, sum(nulos_det) nulos_det,
          sum(anulados) anulados, any_value(nr_local) nr_local_d {attr_sel}
        from '{d}' d group by turno, uf, cd_mun, zona, secao)
      select coalesce(vv.turno, dd.turno) turno, coalesce(vv.uf, dd.uf) uf, coalesce(vv.cd_mun, dd.cd_mun) cd_mun,
        coalesce(vv.zona, dd.zona) zona, coalesce(vv.secao, dd.secao) secao, vv.nm_mun,
        coalesce(dd.nr_local_d, vv.nr_local_v) nr_local,
        coalesce(vv.lula,0) lula, coalesce(vv.dir,0) dir, coalesce(vv.outros,0) outros,
        coalesce(vv.brancos,0) brancos, coalesce(vv.nulos,0) nulos,
        dd.* exclude (turno, uf, cd_mun, zona, secao, nr_local_d),
        (vv.turno is not null) tem_votos, (dd.turno is not null) tem_detalhe, {perfil_sel}
      from vv full join dd using (turno, uf, cd_mun, zona, secao)
      {perfil_join}
    ) to '{destino.as_posix()}' (format parquet)""")
    return destino


def executar(ano):
    votos(ano)
    detalhe(ano)
    if list((RAW / str(ano) / "perfil").glob("*.zip")):
        perfil(ano)
    else:
        print(f"AVISO: sem perfil do eleitorado por seção para {ano}")
    return secoes(ano)
