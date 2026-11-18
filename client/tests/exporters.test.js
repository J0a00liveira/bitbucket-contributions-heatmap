import { describe, test, expect, afterEach, jest } from "@jest/globals";
import {
  buildHeatmapSvg,
  buildStandaloneHtml,
  downloadFile,
} from "../src/exporters.js";
import { LEVEL_COLORS } from "../src/heatmapCore.js";

describe("buildHeatmapSvg", () => {
  const contributions = { "2024-03-15": 10, "2024-03-16": 1 };

  test("gera um SVG válido com uma célula por dia do ano", () => {
    const svg = buildHeatmapSvg(contributions, 2024);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg.match(/<title>/g)).toHaveLength(366);
  });

  test("usa a cor do nível máximo para o dia mais ativo e inclui tooltip", () => {
    const svg = buildHeatmapSvg(contributions, 2024);
    expect(svg).toContain(`fill="${LEVEL_COLORS[4]}"><title>10 commits em 2024-03-15</title>`);
    expect(svg).toContain(`fill="${LEVEL_COLORS[1]}"><title>1 commits em 2024-03-16</title>`);
  });

  test("inclui rótulos de mês e dia da semana", () => {
    const svg = buildHeatmapSvg({}, 2024);
    for (const label of ["Jan", "Dez", "Seg", "Qua", "Sex"]) {
      expect(svg).toContain(`>${label}</text>`);
    }
  });

  test("título é opcional e escapa HTML", () => {
    expect(buildHeatmapSvg({}, 2024)).not.toContain("font-weight=\"600\"");
    const svg = buildHeatmapSvg({}, 2024, { title: `<b>"A&B"</b>` });
    expect(svg).toContain("&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;");
    expect(svg).not.toContain("<b>");
  });

  test("com título a altura aumenta", () => {
    const h = (s) => Number(s.match(/height="(\d+)"/)[1]);
    expect(h(buildHeatmapSvg({}, 2024, { title: "x" }))).toBeGreaterThan(
      h(buildHeatmapSvg({}, 2024))
    );
  });
});

describe("buildStandaloneHtml", () => {
  const yearsData = {
    2023: { contributions: { "2023-01-02": 1 }, total: 1 },
    2024: { contributions: { "2024-03-15": 4 }, total: 4 },
  };

  test("gera documento HTML com os dados embutidos", () => {
    const html = buildStandaloneHtml({ repoLabel: "ws/repo", yearsData });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>ws/repo — Contributions Heatmap</title>");
    expect(html).toContain(
      `const DATA = ${JSON.stringify({
        2023: yearsData[2023].contributions,
        2024: yearsData[2024].contributions,
      })};`
    );
  });

  test("escapa o rótulo do repositório", () => {
    const html = buildStandaloneHtml({ repoLabel: "<script>x</script>", yearsData });
    expect(html).not.toContain("<h1><script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });

  test("usa 'Bitbucket' quando não há rótulo", () => {
    expect(buildStandaloneHtml({ yearsData })).toContain("<h1>Bitbucket</h1>");
  });

  test("o script embutido é JavaScript válido", () => {
    const html = buildStandaloneHtml({ repoLabel: "r", yearsData });
    const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
    expect(() => new Function(script)).not.toThrow();
  });
});

describe("downloadFile", () => {
  const original = { URL: global.URL, document: global.document, Blob: global.Blob };
  afterEach(() => {
    global.URL = original.URL;
    global.document = original.document;
  });

  test("cria um link com download e libera a URL do blob", () => {
    const a = { click: jest.fn() };
    global.document = { createElement: jest.fn(() => a) };
    global.URL = {
      createObjectURL: jest.fn(() => "blob:fake"),
      revokeObjectURL: jest.fn(),
    };

    downloadFile("heatmap.svg", "<svg/>", "image/svg+xml");

    const blob = global.URL.createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("image/svg+xml");
    expect(a.href).toBe("blob:fake");
    expect(a.download).toBe("heatmap.svg");
    expect(a.click).toHaveBeenCalledTimes(1);
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });
});
