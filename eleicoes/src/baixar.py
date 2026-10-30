"""Descoberta (CKAN do TSE) e download dos arquivos, com retomada."""
import json
import re
import shutil
import time
import urllib.error
import urllib.request
from pathlib import Path

from config import ARQUIVOS, CKAN, RAW, VOTACAO_POR_UF

UA = {"User-Agent": "transicao-eleitoral/1.0"}

# Conjuntos do CKAN onde cada tipo de arquivo costuma estar.
PACOTES = {"votacao": "resultados-{ano}", "detalhe": "resultados-{ano}", "perfil": "eleitorado-{ano}"}
PADRAO_RECURSO = {
    "votacao": r"/votacao_secao_{ano}_(BR|[A-Z]{{2}})\.zip$",
    "detalhe": r"/detalhe_votacao_secao_{ano}(_[A-Z]{{2}})?\.zip$",
    "perfil": r"/perfil_eleitor_secao_{ano}_[A-Z]{{2}}\.zip$",
}


def _req(url, method="GET", headers=None, timeout=60):
    return urllib.request.urlopen(urllib.request.Request(url, method=method, headers={**UA, **(headers or {})}),
                                  timeout=timeout)


def tamanho(url):
    """Tamanho em bytes via HEAD; None se não existe."""
    try:
        with _req(url, "HEAD", timeout=30) as r:
            return int(r.headers.get("Content-Length") or 0)
    except urllib.error.HTTPError as e:
        if e.code in (403, 404):
            return None
        raise


def recursos_ckan(tipo, ano):
    pacote = PACOTES[tipo].format(ano=ano)
    try:
        with _req(f"{CKAN}/package_show?id={pacote}") as r:
            res = json.load(r)["result"]["resources"]
    except urllib.error.HTTPError:
        return []
    pad = re.compile(PADRAO_RECURSO[tipo].format(ano=ano))
    return [x["url"] for x in res if pad.search(x.get("url", ""))]


def descobrir(ano):
    """Lista {tipo: [(url, bytes)]}. Tipos sem arquivo publicado ficam com lista vazia."""
    out = {}
    for tipo, padroes in ARQUIVOS.items():
        urls = recursos_ckan(tipo, ano) or [p.format(ano=ano) for p in padroes]
        if tipo == "votacao":
            br = [u for u in urls if u.endswith("_BR.zip")]
            urls = br or [u for u in urls if not u.endswith("_BR.zip")] or [p.format(ano=ano) for p in VOTACAO_POR_UF]
        achados = [(u, tamanho(u)) for u in sorted(set(urls))]
        out[tipo] = [(u, b) for u, b in achados if b is not None]
    return out


def baixar(url, destino: Path, tentativas=5):
    destino.parent.mkdir(parents=True, exist_ok=True)
    total = tamanho(url)
    if destino.exists() and total and destino.stat().st_size == total:
        return destino
    parcial = destino.with_suffix(destino.suffix + ".part")
    for i in range(tentativas):
        ja = parcial.stat().st_size if parcial.exists() else 0
        try:
            with _req(url, headers={"Range": f"bytes={ja}-"} if ja else None, timeout=120) as r, \
                    open(parcial, "ab" if ja and r.status == 206 else "wb") as f:
                shutil.copyfileobj(r, f, length=1 << 20)
            if total and parcial.stat().st_size != total:
                raise IOError(f"tamanho {parcial.stat().st_size} != {total}")
            parcial.replace(destino)
            return destino
        except (urllib.error.URLError, IOError, TimeoutError) as e:
            espera = 2 ** (i + 1)
            print(f"  falha ({e}); nova tentativa em {espera}s")
            time.sleep(espera)
    raise RuntimeError(f"não consegui baixar {url}")


def plano(anos):
    faltando, total = [], 0
    disponivel = {}
    for ano in anos:
        disponivel[ano] = d = descobrir(ano)
        for tipo, lst in d.items():
            b = sum(x or 0 for _, x in lst)
            total += b
            print(f"{ano} {tipo:8s} {len(lst):3d} arquivo(s)  {b / 1e9:6.2f} GB")
            if not lst:
                faltando.append((ano, tipo))
    print(f"TOTAL zips: {total / 1e9:.2f} GB")
    livre = shutil.disk_usage(RAW.parent if RAW.parent.exists() else Path.cwd()).free
    print(f"Disco livre: {livre / 1e9:.1f} GB")
    return disponivel, faltando


def executar(anos, so_plano=False):
    disponivel, faltando = plano(anos)
    if faltando:
        print("NÃO PUBLICADO (ou inacessível):", ", ".join(f"{t} {a}" for a, t in faltando))
    if so_plano:
        return faltando
    for ano, d in disponivel.items():
        for tipo, lst in d.items():
            for url, _ in lst:
                destino = RAW / str(ano) / tipo / url.rsplit("/", 1)[1]
                print(f"baixando {destino.name}")
                baixar(url, destino)
    return faltando
