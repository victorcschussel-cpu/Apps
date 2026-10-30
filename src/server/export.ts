import PDFDocument from 'pdfkit';
import { DateTime } from 'luxon';
import type { Cell, DayTable, MealType, PeakCell, Targets } from './table.js';
import { localTime, TZ } from './time.js';

export const MEAL_LABELS: Record<MealType, string> = {
  cafe: 'Café', almoco: 'Almoço', lanche: 'Lanche', jantar: 'Jantar', outro: 'Outro',
};

const cellText = (c: Cell) =>
  c.value != null ? String(c.value) : c.status === 'pending' ? 'aguardando' : 'sem leitura';

const peakText = (p: PeakCell) => {
  if (p.value == null) return cellText(p);
  const marks = [p.cut && 'cortado', p.partial && 'parcial', p.status === 'pending' && 'em andamento'].filter(Boolean);
  return `${p.value} às ${localTime(p.ts!)}${marks.length ? ` (${marks.join(', ')})` : ''}`;
};

const fmtDate = (d: string) => DateTime.fromISO(d, { zone: TZ }).setLocale('pt-BR').toFormat('ccc dd/LL/yyyy');

/** CSV com ";" e BOM: abre direto no Excel em português. */
export function tableToCsv(days: DayTable[]): string {
  const esc = (s: string | number | null) => {
    const v = s == null ? '' : String(s);
    return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const num = (c: Cell) => (c.value != null ? c.value : '');
  const header = ['data', 'refeicao', 'hora', 'jejum', 'pre', 'pos_1h', 'pos_2h', 'pico', 'hora_pico', 'pico_cortado', 'pico_parcial', 'nota'];
  const lines = [header.join(';')];
  for (const day of [...days].reverse()) {
    for (const r of day.rows) {
      const isJejumRow = day.jejum?.mealId === r.meal.id;
      lines.push([
        day.date, MEAL_LABELS[r.meal.type], localTime(r.meal.ts),
        isJejumRow ? num(day.jejum!) : '', num(r.pre), num(r.pos1h), num(r.pos2h),
        num(r.pico), r.pico.ts ? localTime(r.pico.ts) : '', r.pico.cut ? 'sim' : '', r.pico.partial ? 'sim' : '',
        r.meal.note ?? '',
      ].map(esc).join(';'));
    }
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

const COLORS = { high: '#c0392b', low: '#2c6fbb', missing: '#8a8a8a', text: '#1a1a1a', grid: '#d9d9d9', head: '#f2f2f2' };

export function tableToPdf(days: DayTable[], targets: Targets, period: string): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
  const cols = [
    { title: 'Refeição', w: 90 }, { title: 'Hora', w: 50 }, { title: 'Pré', w: 70 },
    { title: '1h pós', w: 70 }, { title: '2h pós', w: 70 }, { title: 'Pico (hora)', w: 160 }, { title: 'Nota', w: 259 },
  ];
  const left = doc.page.margins.left;
  const rowH = 18;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  doc.fontSize(16).fillColor(COLORS.text).text('Glicemia por refeição', { continued: false });
  const lim = (f: keyof Targets, label: string) => `${label} máx ${targets[f].max ?? "-"}`;
  doc.fontSize(9).fillColor(COLORS.missing)
    .text(`${period} · mg/dL · fora do limite em negrito (vermelho = acima, azul = abaixo) · limites: ${[lim('jejum', 'jejum'), lim('pre', 'pré'), lim('pos1h', '1h'), lim('pos2h', '2h'), lim('pico', 'pico')].join(', ')}`)
    .moveDown(0.8);

  const colorFor = (c: Cell) => (c.flag === 'high' ? COLORS.high : c.flag === 'low' ? COLORS.low : c.value == null ? COLORS.missing : COLORS.text);

  const drawRow = (cells: { text: string; color?: string; bold?: boolean }[], y: number, fill?: string) => {
    if (fill) doc.rect(left, y, cols.reduce((s, c) => s + c.w, 0), rowH).fill(fill);
    let x = left;
    cells.forEach((c, i) => {
      doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(c.color ?? COLORS.text)
        .text(c.text, x + 4, y + 5, { width: cols[i].w - 8, height: rowH - 4, ellipsis: true, lineBreak: false });
      x += cols[i].w;
    });
    doc.moveTo(left, y + rowH).lineTo(x, y + rowH).strokeColor(COLORS.grid).lineWidth(0.5).stroke();
  };

  let y = doc.y;
  for (const day of [...days].reverse()) {
    if (y + rowH * (day.rows.length + 2) > bottom()) { doc.addPage(); y = doc.page.margins.top; }
    const j = day.jejum;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.text).text(fmtDate(day.date), left, y);
    if (j) {
      doc.font('Helvetica').fontSize(10).fillColor(colorFor(j))
        .text(`Jejum: ${cellText(j)}${j.value != null ? ` (${localTime(j.ts!)})` : ''}`, left + 160, y);
    }
    y += rowH;
    drawRow(cols.map((c) => ({ text: c.title, bold: true })), y, COLORS.head);
    y += rowH;
    for (const r of day.rows) {
      if (y + rowH > bottom()) { doc.addPage(); y = doc.page.margins.top; }
      drawRow([
        { text: MEAL_LABELS[r.meal.type], bold: true },
        { text: localTime(r.meal.ts) },
        { text: cellText(r.pre), color: colorFor(r.pre), bold: r.pre.flag != null },
        { text: cellText(r.pos1h), color: colorFor(r.pos1h), bold: r.pos1h.flag != null },
        { text: cellText(r.pos2h), color: colorFor(r.pos2h), bold: r.pos2h.flag != null },
        { text: peakText(r.pico), color: colorFor(r.pico), bold: r.pico.flag != null },
        { text: r.meal.note ?? '', color: COLORS.missing },
      ], y);
      y += rowH;
    }
    y += rowH / 2;
  }
  doc.end();
  return doc;
}
