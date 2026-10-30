import { useCallback, useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import type { PageProps } from '../App';
import { api, MEAL_LABELS, type Meal, type Reading, type Targets } from '../api';
import { addDays, dayLabel, hhmm, TZ, todayIso } from '../time';

/** Acima disso a linha é interrompida: não desenhamos o que não foi medido. */
const GAP_BREAK = 20 * 60;

type DayData = { start: number; end: number; readings: Reading[]; meals: Meal[]; targets: Targets };

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function toSeries(readings: Reading[]): uPlot.AlignedData {
  const xs: number[] = [];
  const ys: (number | null)[] = [];
  readings.forEach((r, i) => {
    if (i > 0 && r.ts - readings[i - 1].ts > GAP_BREAK) {
      xs.push(r.ts - 1);
      ys.push(null);
    }
    xs.push(r.ts);
    ys.push(r.value);
  });
  return [xs, ys];
}

function GlucoseChart({ data }: { data: DayData }) {
  const ref = useRef<HTMLDivElement>(null);
  const [readout, setReadout] = useState<string>('');
  const [scheme, setScheme] = useState(0);

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setScheme((s) => s + 1);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    const el = ref.current!;
    const { targets, meals } = data;
    const bandLo = targets.jejum.min ?? 70;
    const bandHi = targets.pico.max ?? 140;
    const maxVal = Math.max(200, ...data.readings.map((r) => r.value)) + 20;
    const c = { text2: css('--text-2'), text3: css('--text-3'), grid: css('--grid'), series: css('--series'), band: css('--band'), surface: css('--surface') };
    const dpr = devicePixelRatio;

    const opts: uPlot.Options = {
      width: el.clientWidth,
      height: Math.min(360, Math.max(240, el.clientWidth * 0.55)),
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), TZ),
      legend: { show: false },
      cursor: { y: false, points: { size: 10, fill: c.series, stroke: c.surface, width: 2 }, drag: { x: false, y: false } },
      scales: { x: { time: true, range: [data.start, data.end] }, y: { range: [40, maxVal] } },
      axes: [
        { stroke: c.text2, grid: { stroke: c.grid, width: 1 }, ticks: { show: false }, values: (_u, ticks) => ticks.map((t) => hhmm(t)), font: '12px system-ui' },
        { stroke: c.text2, grid: { stroke: c.grid, width: 1 }, ticks: { show: false }, size: 40, font: '12px system-ui' },
      ],
      series: [{}, { label: 'Glicose', stroke: c.series, width: 2, spanGaps: false, points: { show: false } }],
      hooks: {
        drawClear: [
          (u) => {
            // Faixa-alvo ao fundo
            const ctx = u.ctx;
            const y1 = u.valToPos(bandHi, 'y', true);
            const y0 = u.valToPos(bandLo, 'y', true);
            ctx.save();
            ctx.fillStyle = c.band;
            ctx.fillRect(u.bbox.left, y1, u.bbox.width, y0 - y1);
            ctx.restore();
          },
        ],
        draw: [
          (u) => {
            // Marcadores das refeições: linha tracejada + rótulo no topo
            const ctx = u.ctx;
            ctx.save();
            ctx.font = `${600} ${11 * dpr}px system-ui`;
            ctx.textAlign = 'center';
            // Rótulos que não cabem na linha de cima descem uma linha (até 3), para não sobrepor
            const rowRight: number[] = [];
            const rowH = 13 * dpr;
            for (const m of meals) {
              const x = u.valToPos(m.ts, 'x', true);
              if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) continue;
              const label = `${MEAL_LABELS[m.type]} ${hhmm(m.ts)}`;
              const half = ctx.measureText(label).width / 2;
              let row = rowRight.findIndex((right) => x - half > right + 6 * dpr);
              if (row < 0) row = Math.min(rowRight.length, 2);
              rowRight[row] = x + half;
              const labelY = u.bbox.top + 10 * dpr + row * rowH;
              ctx.strokeStyle = c.text3;
              ctx.lineWidth = 1 * dpr;
              ctx.setLineDash([4 * dpr, 4 * dpr]);
              ctx.beginPath();
              ctx.moveTo(x, labelY + 6 * dpr);
              ctx.lineTo(x, u.bbox.top + u.bbox.height);
              ctx.stroke();
              ctx.fillStyle = c.text2;
              ctx.fillText(label, x, labelY);
            }
            ctx.restore();
          },
        ],
        setCursor: [
          (u) => {
            const i = u.cursor.idx;
            const v = i != null ? u.data[1][i] : null;
            setReadout(i != null && v != null ? `${hhmm(u.data[0][i])} · ${v} mg/dL` : '');
          },
        ],
      },
    };
    const plot = new uPlot(opts, toSeries(data.readings), el);
    const ro = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height: Math.min(360, Math.max(240, el.clientWidth * 0.55)) }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.destroy();
    };
  }, [data, scheme]);

  const vals = data.readings.map((r) => r.value);
  return (
    <>
      <div className="chart-wrap">
        <div className="readout" aria-live="polite">{readout ? <b>{readout}</b> : 'Toque ou passe o dedo no gráfico para ver a leitura'}</div>
        <div ref={ref} role="img" aria-label={`Glicose ao longo do dia, ${vals.length} leituras`} />
      </div>
      <div className="legend">
        <span><span style={{ display: 'inline-block', width: 16, height: 2, background: 'var(--series)', verticalAlign: 'middle' }} /> glicose (mg/dL)</span>
        <span><span style={{ display: 'inline-block', width: 16, height: 10, background: 'var(--band)', verticalAlign: 'middle' }} /> faixa-alvo {data.targets.jejum.min ?? 70}–{data.targets.pico.max ?? 140}</span>
        <span>┆ refeição</span>
        <span>linha interrompida = sem leitura &gt; 20 min</span>
      </div>
      {vals.length > 0 && (
        <div className="cards">
          <div className="card"><div className="k">Mínima</div><div className="val">{Math.min(...vals)}</div></div>
          <div className="card"><div className="k">Máxima</div><div className="val">{Math.max(...vals)}</div></div>
          <div className="card"><div className="k">Média</div><div className="val">{Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)}</div></div>
          <div className="card"><div className="k">Leituras</div><div className="val">{vals.length}</div></div>
        </div>
      )}
    </>
  );
}

export function ChartPage({ onError }: PageProps) {
  const [date, setDate] = useState(todayIso);
  const [data, setData] = useState<DayData | null>(null);
  const load = useCallback(() => api.day(date).then(setData, onError), [date, onError]);
  useEffect(() => void load(), [load]);
  const isToday = date >= todayIso();

  return (
    <>
      <h1>Gráfico do dia</h1>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn small" onClick={() => setDate(addDays(date, -1))} aria-label="Dia anterior">‹</button>
        <input className="input" style={{ width: 'auto', flex: 1 }} type="date" value={date} max={todayIso()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button className="btn small" disabled={isToday} onClick={() => setDate(addDays(date, 1))} aria-label="Próximo dia">›</button>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>{dayLabel(date)}</p>
      {data && (data.readings.length === 0 ? <p className="muted">Sem leituras neste dia.</p> : <GlucoseChart data={data} />)}
    </>
  );
}
