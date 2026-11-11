import React, { useMemo } from "react";
import {
  CELL,
  GAP,
  LEFT,
  TOP,
  LABEL_FONT,
  LABEL_COLOR,
  WEEKDAY_LABELS,
  LEVEL_COLORS,
  levelFor,
  buildWeeks,
  monthTicksOf,
} from "./heatmapCore.js";

// Heatmap estilo GitHub a partir de um mapa { "YYYY-MM-DD": contagem }.
export default function Heatmap({ contributions, year }) {
  const { weeks, max, monthTicks } = useMemo(() => {
    const weeks = buildWeeks(contributions, year);
    const max = Math.max(0, ...Object.values(contributions));
    return { weeks, max, monthTicks: monthTicksOf(weeks) };
  }, [contributions, year]);

  const width = weeks.length * (CELL + GAP) + LEFT;
  const height = 7 * (CELL + GAP) + TOP + 10;

  return (
    <div className="heatmap-wrapper">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMinYMin meet"
        className="heatmap-svg"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Rótulos de mês */}
        {monthTicks.map((t) => (
          <text
            key={`${t.label}-${t.col}`}
            x={LEFT + t.col * (CELL + GAP)}
            y={TOP - 10}
            fill={LABEL_COLOR}
            fontSize={LABEL_FONT}
          >
            {t.label}
          </text>
        ))}

        {/* Rótulos de dia da semana */}
        {WEEKDAY_LABELS.map((label, i) =>
          label ? (
            <text
              key={label}
              x={0}
              y={TOP + i * (CELL + GAP) + CELL - 2}
              fill={LABEL_COLOR}
              fontSize={LABEL_FONT}
            >
              {label}
            </text>
          ) : null
        )}

        {/* Células */}
        <g transform={`translate(${LEFT}, ${TOP})`}>
          {weeks.map((week, wi) =>
            week.map((day) =>
              day.inYear ? (
                <rect
                  key={day.key}
                  x={wi * (CELL + GAP)}
                  y={day.date.getDay() * (CELL + GAP)}
                  width={CELL}
                  height={CELL}
                  rx={3}
                  fill={LEVEL_COLORS[levelFor(day.count, max)]}
                >
                  <title>
                    {day.count} commits em {day.key}
                  </title>
                </rect>
              ) : null
            )
          )}
        </g>
      </svg>

      <div className="legend">
        <span>Menos</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span
            key={l}
            className="legend-cell"
            style={{ background: LEVEL_COLORS[l] }}
          />
        ))}
        <span>Mais</span>
      </div>
    </div>
  );
}
