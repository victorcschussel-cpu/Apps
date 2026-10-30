// Tipos compartilhados entre servidor e front. Sem imports: o front compila este arquivo.

export const MEAL_TYPES = ['cafe', 'almoco', 'lanche', 'jantar', 'outro'] as const;
export type MealType = (typeof MEAL_TYPES)[number];
export const FIELDS = ['jejum', 'pre', 'pos1h', 'pos2h', 'pico'] as const;
export type Field = (typeof FIELDS)[number];

export type Reading = { ts: number; value: number; kind: 'cgm' | 'scan' };
export type Meal = { id: number; type: MealType; ts: number; note: string | null };
export type Targets = Record<Field, { max: number | null; min: number | null }>;

/** ok = achou leitura; missing = não há leitura na tolerância; pending = a janela ainda não terminou. */
export type CellStatus = 'ok' | 'missing' | 'pending';
export type Cell = {
  value: number | null;
  ts: number | null;
  /** Horário-alvo (para "mais próxima de") ou início da janela. */
  target: number;
  status: CellStatus;
  flag: 'high' | 'low' | null;
};
export type PeakCell = Cell & { windowEnd: number; cut: boolean; partial: boolean };
export type MealRow = { meal: Meal; pre: Cell; pos1h: Cell; pos2h: Cell; pico: PeakCell };
export type DayTable = { date: string; jejum: (Cell & { mealId: number }) | null; rows: MealRow[] };
