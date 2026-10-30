"""Parâmetros fixos do pipeline: caminhos, fontes, candidatos e totais oficiais de validação."""
import os
from pathlib import Path

# ELEICOES_RAIZ permite rodar o teste sintético sem tocar em data/ e reports/ reais.
RAIZ = Path(os.environ.get("ELEICOES_RAIZ") or Path(__file__).resolve().parent.parent)
RAW = RAIZ / "data" / "raw"
PROC = RAIZ / "data" / "proc"
TMP = RAIZ / "data" / "tmp"
REPORTS = RAIZ / "reports"

UFS = [
    "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
    "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
]
UF_EXTERIOR = "ZZ"

CKAN = "https://dadosabertos.tse.jus.br/api/3/action"
CDN = "https://cdn.tse.jus.br/estatistica/sead/odsele"

# Padrões de arquivo no CDN (usados se a busca no CKAN não achar o recurso).
ARQUIVOS = {
    "votacao": [f"{CDN}/votacao_secao/votacao_secao_{{ano}}_BR.zip"],
    "detalhe": [f"{CDN}/detalhe_votacao_secao/detalhe_votacao_secao_{{ano}}.zip"],
    "perfil": [f"{CDN}/perfil_eleitor_secao/perfil_eleitor_secao_{{ano}}_{uf}.zip" for uf in UFS + [UF_EXTERIOR]],
}
# Fallback se o arquivo BR de votação não existir.
VOTACAO_POR_UF = [f"{CDN}/votacao_secao/votacao_secao_{{ano}}_{uf}.zip" for uf in UFS + [UF_EXTERIOR]]

# Candidatos: identificados por NM_VOTAVEL via regex (o script falha se não houver exatamente 1 match).
CANDIDATOS = {
    2026: {"lula": r"LUIZ IN[AÁ]CIO|\bLULA\b", "dir": r"FL[AÁ]VIO.*BOLSONARO"},
    2022: {"lula": r"LUIZ IN[AÁ]CIO|\bLULA\b", "dir": r"JAIR.*BOLSONARO"},
}
NOME_DIR = {2026: "Flávio", 2022: "Jair"}

# Totais oficiais. "exato" => tolerância relativa TOL; "aprox" => tolerância declarada no próprio alvo.
TOL = 1e-4  # 0,01%
ALVOS = {
    2026: {
        1: {
            "dir": ("exato", 56_104_503),
            "lula": ("exato", 53_879_538),
            "comparecimento": ("aprox", 125.0e6, 0.05e6),
            "brancos": ("aprox", 2.2e6, 0.05e6),
            "nulos": ("aprox", 3.6e6, 0.05e6),
        },
        2: {
            "lula": ("exato", 64_256_232),
            "validos": ("exato", 124_082_273),
            "comparecimento": ("exato", 128_236_074),
            "brancos": ("exato", 1_430_496),
            "nulos": ("exato", 2_723_305),
        },
    },
    # 2022: totais divulgados pelo TSE (controle).
    2022: {
        1: {
            "lula": ("exato", 57_259_504),
            "dir": ("exato", 51_072_345),
            "comparecimento": ("exato", 123_682_372),
            "brancos": ("exato", 1_964_779),
            "nulos": ("exato", 3_487_874),
        },
        2: {
            "lula": ("exato", 60_345_999),
            "dir": ("exato", 58_206_354),
            "comparecimento": ("exato", 124_252_796),
            "brancos": ("exato", 1_769_678),
            "nulos": ("exato", 3_930_765),
        },
    },
}
# Nomes alternativos de colunas (o layout pode mudar entre 2022 e 2026).
ALIASES = {
    "turno": ["NR_TURNO"],
    "uf": ["SG_UF"],
    "cd_mun": ["CD_MUNICIPIO"],
    "nm_mun": ["NM_MUNICIPIO"],
    "zona": ["NR_ZONA"],
    "secao": ["NR_SECAO"],
    "local": ["NR_LOCAL_VOTACAO"],
    "cd_cargo": ["CD_CARGO"],
    "ds_cargo": ["DS_CARGO"],
    "nr_votavel": ["NR_VOTAVEL"],
    "nm_votavel": ["NM_VOTAVEL"],
    "votos": ["QT_VOTOS"],
    "aptos": ["QT_APTOS"],
    "comparecimento": ["QT_COMPARECIMENTO"],
    "abstencoes": ["QT_ABSTENCOES"],
    "brancos": ["QT_VOTOS_BRANCOS"],
    "nulos": ["QT_VOTOS_NULOS", "QT_VOTOS_NULOS_TECNICOS"],
    "nominais": ["QT_VOTOS_NOMINAIS"],
    "anulados": ["QT_VOTOS_ANULADOS", "QT_VOTOS_ANULADOS_APU_SEP", "QT_TOTAL_VOTOS_ANULADOS"],
    "faixa": ["DS_FAIXA_ETARIA"],
    "qt_perfil": ["QT_ELEITORES_PERFIL", "QT_ELEITORES"],
}
# Colunas opcionais que, se existirem em algum arquivo, entram no teste de anomalia.
REGEX_ATRIBUTOS_URNA = r"MODELO|URNA|AGREGAD"

NR_BRANCO, NR_NULO = 95, 96
SEED = 20261025
