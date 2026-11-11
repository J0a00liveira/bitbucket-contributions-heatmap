// Núcleo compartilhado do heatmap: constantes de geometria, cores e funções de
// cálculo. Usado pelo componente React (Heatmap.jsx) e pelo exportador SVG
// (exporters.js) para evitar duplicação.

export const CELL = 16; // tamanho da célula
export const GAP = 4; // espaço entre células
export const LEFT = 44; // margem à esquerda (rótulos de dia)
export const TOP = 26; // margem no topo (rótulos de mês)
export const LABEL_FONT = 13; // fonte dos rótulos mês/dia
export const LABEL_COLOR = "#93a1b5";

export const WEEKDAY_LABELS = ["", "Seg", "", "Qua", "", "Sex", ""];
export const MONTH_LABELS = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

// Escala azul (alusão ao Bitbucket). Usada inline no fill para que a exportação
// não dependa de variáveis CSS (que podem não resolver no html-to-image/SVG).
export const LEVEL_COLORS = ["#182233", "#10335c", "#0e5fd6", "#388bff", "#85b8ff"];

/** Converte uma data local para "YYYY-MM-DD" (sem shift de fuso). */
export function toKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Nível (0-4) de cor com base na contagem e no máximo observado. */
export function levelFor(count, max) {
  if (!count || max <= 0) return 0;
  const ratio = count / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

/**
 * Matriz de semanas (colunas) x dias (linhas) de um ano civil, de 1º de janeiro
 * a 31 de dezembro, alinhada ao domingo. Cada célula: { date, key, count, inYear }.
 */
export function buildWeeks(contributions, year) {
  const start = new Date(year, 0, 1);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());

  const end = new Date(year, 11, 31);
  end.setHours(0, 0, 0, 0);

  const weeks = [];
  let current = new Date(start);
  let week = [];
  while (current <= end) {
    const key = toKey(current);
    week.push({
      date: new Date(current),
      key,
      count: contributions[key] || 0,
      inYear: current.getFullYear() === year,
    });
    if (current.getDay() === 6) {
      weeks.push(week);
      week = [];
    }
    current.setDate(current.getDate() + 1);
  }
  if (week.length) weeks.push(week);
  return weeks;
}

/** Marca em qual coluna cada mês começa (para os rótulos do topo). */
export function monthTicksOf(weeks) {
  const ticks = [];
  let lastMonth = -1;
  weeks.forEach((week, i) => {
    const firstDay = week.find((d) => d.inYear)?.date;
    if (!firstDay) return;
    const m = firstDay.getMonth();
    if (m !== lastMonth) {
      ticks.push({ col: i, label: MONTH_LABELS[m] });
      lastMonth = m;
    }
  });
  return ticks;
}
