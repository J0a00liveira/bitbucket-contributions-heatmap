import React, { useMemo } from "react";

// Skeleton de carregamento com o mesmo formato do heatmap (53 semanas x 7 dias),
// com células pulsando enquanto os commits são buscados.

const CELL = 12;
const GAP = 3;
const WEEKS = 53;
const DAYS = 7;

export default function HeatmapSkeleton() {
  // Intensidade pseudo-aleatória estável para dar textura ao skeleton.
  const cells = useMemo(() => {
    const out = [];
    for (let w = 0; w < WEEKS; w += 1) {
      for (let d = 0; d < DAYS; d += 1) {
        // Padrão determinístico só para variar um pouco o tom das células.
        const shade = (w * 7 + d) % 5;
        out.push({ w, d, shade });
      }
    }
    return out;
  }, []);

  const width = WEEKS * (CELL + GAP) + 40;
  const height = DAYS * (CELL + GAP) + 30;

  return (
    <div className="heatmap-wrapper" aria-busy="true" aria-label="Carregando contribuições">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMinYMin meet"
        className="heatmap-svg skeleton"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g transform="translate(40, 20)">
          {cells.map(({ w, d, shade }) => (
            <rect
              key={`${w}-${d}`}
              x={w * (CELL + GAP)}
              y={d * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={2}
              className={`skeleton-cell shade-${shade}`}
              style={{ animationDelay: `${((w + d) % 8) * 0.1}s` }}
            />
          ))}
        </g>
      </svg>
      <p className="skeleton-note">Buscando commits no Bitbucket…</p>
    </div>
  );
}
