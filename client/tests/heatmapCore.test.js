import { describe, test, expect } from "@jest/globals";
import {
  toKey,
  levelFor,
  buildWeeks,
  monthTicksOf,
  MONTH_LABELS,
} from "../src/heatmapCore.js";

describe("toKey", () => {
  test("formata data local com zero à esquerda", () => {
    expect(toKey(new Date(2024, 0, 5))).toBe("2024-01-05");
    expect(toKey(new Date(2024, 11, 31))).toBe("2024-12-31");
  });
});

describe("levelFor", () => {
  test.each([
    [0, 10, 0],
    [undefined, 10, 0],
    [5, 0, 0],
    [1, 10, 1],
    [2, 10, 1],
    [3, 10, 2], // 0.3
    [5, 10, 2], // 0.5 (limite exclusivo)
    [6, 10, 3],
    [7, 10, 3], // 0.7
    [8, 10, 4],
    [10, 10, 4],
  ])("count=%p max=%p -> nível %p", (count, max, level) => {
    expect(levelFor(count, max)).toBe(level);
  });
});

describe("buildWeeks", () => {
  test("começa no domingo e cobre 1º de jan a 31 de dez", () => {
    const weeks = buildWeeks({}, 2024); // 1/1/2024 foi segunda
    expect(weeks[0][0].date.getDay()).toBe(0);
    expect(weeks[0][0].key).toBe("2023-12-31");
    expect(weeks[0][0].inYear).toBe(false);
    expect(weeks[0][1].key).toBe("2024-01-01");
    expect(weeks[0][1].inYear).toBe(true);

    const all = weeks.flat();
    expect(all[all.length - 1].key).toBe("2024-12-31");
    expect(all.filter((d) => d.inYear)).toHaveLength(366); // ano bissexto
  });

  test("semanas completas têm 7 dias; a última pode ser parcial", () => {
    const weeks = buildWeeks({}, 2024);
    weeks.slice(0, -1).forEach((w) => expect(w).toHaveLength(7));
    expect(weeks[weeks.length - 1].length).toBeLessThanOrEqual(7);
  });

  test("ano que começa no domingo não tem dias fora do ano na primeira semana", () => {
    const weeks = buildWeeks({}, 2023); // 1/1/2023 foi domingo
    expect(weeks[0][0].key).toBe("2023-01-01");
    expect(weeks[0].every((d) => d.inYear)).toBe(true);
  });

  test("preenche count a partir das contribuições, 0 quando ausente", () => {
    const weeks = buildWeeks({ "2024-03-15": 7 }, 2024);
    const byKey = Object.fromEntries(weeks.flat().map((d) => [d.key, d.count]));
    expect(byKey["2024-03-15"]).toBe(7);
    expect(byKey["2024-03-16"]).toBe(0);
  });

  test("ano não bissexto tem 365 dias", () => {
    const days = buildWeeks({}, 2023).flat().filter((d) => d.inYear);
    expect(days).toHaveLength(365);
  });
});

describe("monthTicksOf", () => {
  test("gera um tick por mês, em ordem, com rótulos em pt-BR", () => {
    const ticks = monthTicksOf(buildWeeks({}, 2024));
    expect(ticks.map((t) => t.label)).toEqual(MONTH_LABELS);
    const cols = ticks.map((t) => t.col);
    expect(cols).toEqual([...cols].sort((a, b) => a - b));
    expect(cols[0]).toBe(0);
  });

  test("ignora semanas sem dias do ano", () => {
    const outside = [{ date: new Date(2023, 11, 31), inYear: false }];
    expect(monthTicksOf([outside])).toEqual([]);
  });
});
