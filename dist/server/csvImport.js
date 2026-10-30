import { parse } from 'csv-parse/sync';
import { DateTime } from 'luxon';
import { TZ } from './time.js';
const MMOL_TO_MGDL = 18.016;
// Cabeçalhos do export do LibreView em PT e EN (comparados em minúsculas, sem acento).
const COLS = {
    timestamp: ['carimbo de data/hora do dispositivo', 'device timestamp'],
    type: ['tipo de registro', 'record type'],
    historic: ['historico de glicose', 'historic glucose'],
    scan: ['glicose escaneada', 'scan glucose'],
};
const RECORD_HISTORIC = '0';
const RECORD_SCAN = '1';
const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
function findCol(header, names) {
    const idx = header.findIndex((h) => names.some((n) => normalize(h).startsWith(n)));
    if (idx < 0)
        return null;
    return { idx, mmol: normalize(header[idx]).includes('mmol') };
}
/** Decide dd-MM x MM-dd olhando o arquivo inteiro; na dúvida, dd-MM (padrão BR). */
function detectDateFormat(samples) {
    let dayFirst = true;
    for (const s of samples) {
        const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{4}/);
        if (!m)
            continue;
        if (Number(m[1]) > 12) {
            dayFirst = true;
            break;
        }
        if (Number(m[2]) > 12) {
            dayFirst = false;
            break;
        }
    }
    const d = dayFirst ? 'd' : 'M';
    const mo = dayFirst ? 'M' : 'd';
    const formats = [
        `${d}-${mo}-yyyy H:mm`, `${d}/${mo}/yyyy H:mm`, `${d}.${mo}.yyyy H:mm`,
        `${d}-${mo}-yyyy h:mm a`, `${d}/${mo}/yyyy h:mm a`,
        `${d}-${mo}-yyyy H:mm:ss`, `${d}/${mo}/yyyy H:mm:ss`,
        'yyyy-MM-dd H:mm', 'yyyy-MM-dd H:mm:ss', "yyyy-MM-dd'T'H:mm", "yyyy-MM-dd'T'H:mm:ss",
    ];
    return (s) => {
        for (const f of formats) {
            // O CSV traz o horário local do aparelho, sem fuso.
            const dt = DateTime.fromFormat(s.trim(), f, { zone: TZ, locale: 'en-US' });
            if (dt.isValid)
                return dt;
        }
        return DateTime.invalid('formato desconhecido');
    };
}
function parseValue(raw, mmol) {
    if (!raw?.trim())
        return null;
    const n = Number(raw.trim().replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0)
        return null;
    return Math.round(mmol ? n * MMOL_TO_MGDL : n);
}
export function parseLibreViewCsv(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    // Linha 1 = metadados ("Dados de glicose", "Gerado em", ...); o cabeçalho é a primeira linha com a coluna de tipo.
    const headerLine = lines.findIndex((l) => COLS.type.some((n) => normalize(l).includes(n)));
    if (headerLine < 0)
        throw new Error('Cabeçalho do LibreView não encontrado (coluna "Tipo de registro" / "Record Type").');
    const delimiter = (lines[headerLine].match(/;/g)?.length ?? 0) > (lines[headerLine].match(/,/g)?.length ?? 0) ? ';' : ',';
    const rows = parse(lines.slice(headerLine).join('\n'), {
        delimiter, relax_column_count: true, relax_quotes: true, skip_empty_lines: true,
    });
    const [header, ...data] = rows;
    const tsCol = findCol(header, COLS.timestamp);
    const typeCol = findCol(header, COLS.type);
    const histCol = findCol(header, COLS.historic);
    const scanCol = findCol(header, COLS.scan);
    if (!tsCol || !typeCol || (!histCol && !scanCol)) {
        throw new Error(`Colunas esperadas ausentes. Cabeçalho: ${header.join(' | ')}`);
    }
    const parseDate = detectDateFormat(data.slice(0, 500).map((r) => r[tsCol.idx] ?? ''));
    const result = { readings: [], nRows: data.length, ignored: {}, errors: [] };
    const skip = (reason) => (result.ignored[reason] = (result.ignored[reason] ?? 0) + 1);
    data.forEach((row, i) => {
        const type = row[typeCol.idx]?.trim();
        const col = type === RECORD_HISTORIC ? histCol : type === RECORD_SCAN ? scanCol : null;
        if (!col)
            return skip(`tipo ${type || 'vazio'}`);
        const value = parseValue(row[col.idx], col.mmol);
        if (value == null)
            return skip(`valor vazio (tipo ${type})`);
        const dt = parseDate(row[tsCol.idx] ?? '');
        if (!dt.isValid) {
            if (result.errors.length < 20)
                result.errors.push(`linha ${headerLine + i + 2}: data "${row[tsCol.idx]}" inválida`);
            return skip('data inválida');
        }
        result.readings.push({ ts: Math.floor(dt.toSeconds()), value, kind: type === RECORD_HISTORIC ? 'cgm' : 'scan' });
    });
    return result;
}
//# sourceMappingURL=csvImport.js.map