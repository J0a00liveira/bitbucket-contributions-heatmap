// Geradores de exportação: SVG (um ano) e HTML standalone interativo (todos
// os anos). O SVG reaproveita o núcleo compartilhado (heatmapCore). O HTML é
// self-contained (JS embutido), então mantém sua própria cópia inline.

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

const BG = "#0e1420";

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/**
 * Gera o markup SVG do heatmap de um ano.
 * `opts.title` opcional desenha um título acima.
 */
export function buildHeatmapSvg(contributions, year, opts = {}) {
  const weeks = buildWeeks(contributions, year);
  const max = Math.max(0, ...Object.values(contributions));
  const monthTicks = monthTicksOf(weeks);

  const titleH = opts.title ? 28 : 0;
  const gridW = weeks.length * (CELL + GAP) + LEFT;
  const gridH = 7 * (CELL + GAP) + TOP + 10;
  const width = gridW + 24;
  const height = gridH + titleH + 24;

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system,Segoe UI,Roboto,Arial,sans-serif">`
  );
  parts.push(`<rect width="${width}" height="${height}" rx="14" fill="${BG}"/>`);

  let offY = 12;
  if (opts.title) {
    parts.push(
      `<text x="16" y="${offY + 14}" fill="#e9eef6" font-size="14" font-weight="600">${esc(
        opts.title
      )}</text>`
    );
    offY += titleH;
  }

  const gx = 12;
  const gy = offY;

  // Rótulos de mês
  for (const t of monthTicks) {
    parts.push(
      `<text x="${gx + LEFT + t.col * (CELL + GAP)}" y="${
        gy + TOP - 10
      }" fill="${LABEL_COLOR}" font-size="${LABEL_FONT}">${t.label}</text>`
    );
  }
  // Rótulos de dia da semana
  WEEKDAY_LABELS.forEach((label, i) => {
    if (!label) return;
    parts.push(
      `<text x="${gx}" y="${
        gy + TOP + i * (CELL + GAP) + CELL - 2
      }" fill="${LABEL_COLOR}" font-size="${LABEL_FONT}">${label}</text>`
    );
  });
  // Células
  weeks.forEach((week, wi) => {
    week.forEach((day) => {
      if (!day.inYear) return;
      const x = gx + LEFT + wi * (CELL + GAP);
      const y = gy + TOP + day.date.getDay() * (CELL + GAP);
      const fill = LEVEL_COLORS[levelFor(day.count, max)];
      parts.push(
        `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="3" fill="${fill}"><title>${day.count} commits em ${day.key}</title></rect>`
      );
    });
  });

  parts.push(`</svg>`);
  return parts.join("");
}

/**
 * Dispara o download de um conteúdo como arquivo.
 */
export function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Gera um HTML standalone e interativo com todos os anos (troca por botões).
 * `yearsData` = { [year]: { contributions, total } }.
 */
export function buildStandaloneHtml({ repoLabel, yearsData }) {
  const years = Object.keys(yearsData)
    .map(Number)
    .sort((a, b) => b - a);

  // Os dados e as constantes vão embutidos; um JS mínimo redesenha e troca ano.
  const data = {};
  for (const y of years) data[y] = yearsData[y].contributions;

  const payload = JSON.stringify(data);
  const repo = esc(repoLabel || "Bitbucket");

  return `<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${repo} — Contributions Heatmap</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;background:#0b0f17;color:#e9eef6;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:32px}
  .wrap{max-width:900px;margin:0 auto}
  h1{font-size:1.1rem;font-weight:600;margin:0 0 4px}
  .sub{color:#93a1b5;font-size:.85rem;margin:0 0 20px}
  .card{background:linear-gradient(180deg,#0e1420,#0b0f17);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:22px;overflow-x:auto}
  .years{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}
  .yb{min-width:56px;padding:7px 12px;font-size:.85rem;font-weight:600;color:#93a1b5;background:transparent;border:1px solid transparent;border-radius:8px;cursor:pointer}
  .yb:hover{color:#fff;background:rgba(255,255,255,.05)}
  .yb.active{color:#fff;background:rgba(12,102,228,.18);border-color:#0c66e4}
  .meta{color:#93a1b5;font-size:.85rem;margin:0 0 12px}
  svg{display:block;width:100%;height:auto}
  .foot{color:#93a1b5;font-size:.75rem;text-align:center;margin-top:24px}
</style>
</head>
<body>
<div class="wrap">
  <h1>${repo}</h1>
  <p class="sub">Gráfico de contribuições — gerado por Bitbucket Contributions Heatmap</p>
  <div class="years" id="years"></div>
  <div class="card">
    <p class="meta" id="meta"></p>
    <div id="chart"></div>
  </div>
  <p class="foot">Visualização interativa · troque o ano nos botões acima</p>
</div>
<script>
const DATA = ${payload};
const YEARS = Object.keys(DATA).map(Number).sort((a,b)=>b-a);
const CELL=16,GAP=4,LEFT=44,TOP=26,LF=13;
const WD=["","Seg","","Qua","","Sex",""];
const MO=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const COLORS=["#182233","#10335c","#0e5fd6","#388bff","#85b8ff"];
function key(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}
function level(c,mx){if(!c||mx<=0)return 0;const r=c/mx;if(r>.75)return 4;if(r>.5)return 3;if(r>.25)return 2;return 1;}
function weeksOf(contrib,year){const s=new Date(year,0,1);s.setHours(0,0,0,0);s.setDate(s.getDate()-s.getDay());const e=new Date(year,11,31);e.setHours(0,0,0,0);const w=[];let cur=new Date(s),wk=[];while(cur<=e){wk.push({d:new Date(cur),k:key(cur),c:contrib[key(cur)]||0,iy:cur.getFullYear()===year});if(cur.getDay()===6){w.push(wk);wk=[];}cur.setDate(cur.getDate()+1);}if(wk.length)w.push(wk);return w;}
function render(year){
  const contrib=DATA[year]||{};
  const weeks=weeksOf(contrib,year);
  const mx=Math.max(0,...Object.values(contrib));
  const ticks=[];let lm=-1;
  weeks.forEach((wk,i)=>{const fd=wk.find(x=>x.iy);if(!fd)return;const m=fd.d.getMonth();if(m!==lm){ticks.push({col:i,l:MO[m]});lm=m;}});
  const gw=weeks.length*(CELL+GAP)+LEFT, gh=7*(CELL+GAP)+TOP+10;
  let s='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+gw+' '+gh+'">';
  ticks.forEach(t=>{s+='<text x="'+(LEFT+t.col*(CELL+GAP))+'" y="'+(TOP-10)+'" fill="#93a1b5" font-size="'+LF+'">'+t.l+'</text>';});
  WD.forEach((l,i)=>{if(!l)return;s+='<text x="0" y="'+(TOP+i*(CELL+GAP)+CELL-2)+'" fill="#93a1b5" font-size="'+LF+'">'+l+'</text>';});
  s+='<g transform="translate('+LEFT+','+TOP+')">';
  weeks.forEach((wk,wi)=>wk.forEach(day=>{if(!day.iy)return;s+='<rect x="'+(wi*(CELL+GAP))+'" y="'+(day.d.getDay()*(CELL+GAP))+'" width="'+CELL+'" height="'+CELL+'" rx="3" fill="'+COLORS[level(day.c,mx)]+'"><title>'+day.c+' commits em '+day.k+'</title></rect>';}));
  s+='</g></svg>';
  document.getElementById("chart").innerHTML=s;
  const total=Object.values(contrib).reduce((a,b)=>a+b,0);
  document.getElementById("meta").textContent=total+" contribuições em "+year;
  document.querySelectorAll(".yb").forEach(b=>b.classList.toggle("active",Number(b.dataset.y)===year));
}
const yc=document.getElementById("years");
if(YEARS.length>1){YEARS.forEach(y=>{const b=document.createElement("button");b.className="yb";b.dataset.y=y;b.textContent=y;b.onclick=()=>render(y);yc.appendChild(b);});}
render(YEARS[0]);
</script>
</body>
</html>`;
}
