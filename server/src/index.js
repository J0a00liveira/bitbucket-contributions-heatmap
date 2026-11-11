import express from "express";
import cors from "cors";
import {
  streamRepoCommits,
  streamRepoCommitsMultiYear,
} from "./bitbucket.js";
import { parseBitbucketUrl } from "./parseUrl.js";
import { readCache, writeCache, listCachedYears, readAllCached } from "./cache.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

/**
 * Lê e valida as credenciais enviadas pelo cliente.
 * Elas chegam no corpo da requisição, são usadas e descartadas (nunca salvas).
 *
 * O cliente envia uma `url` do Bitbucket (de um repositório ou do workspace);
 * daqui extraímos o workspace e, se houver, o repositório específico.
 */
function readCredentials(req) {
  const { url, email, apiToken } = req.body || {};
  const missing = !url ? "url" : !email ? "email" : !apiToken ? "apiToken" : null;
  if (missing) {
    const labels = { url: "a URL", email: "o e-mail", apiToken: "o API Token" };
    const err = new Error(`Preencha ${labels[missing]}.`);
    err.status = 400;
    err.field = missing;
    throw err;
  }

  const { workspace, repoSlug } = parseBitbucketUrl(url);
  return { workspace, repoSlug, email, apiToken };
}

function handleError(res, err) {
  const status = err.status || 500;
  res.status(status).json({ error: err.message, field: err.field || null });
}

// Health check simples.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

/**
 * Lista os anos que já têm cache para a URL + e-mail informados.
 * Usado para montar os botões laterais de ano (estilo GitHub).
 * Não consulta o Bitbucket — só olha o cache local.
 */
app.post("/api/cached-years", async (req, res) => {
  try {
    const { url, email } = req.body || {};
    if (!url || !email) {
      const err = new Error("Campos obrigatórios: url e email.");
      err.status = 400;
      throw err;
    }
    const { workspace, repoSlug } = parseBitbucketUrl(url);
    if (!repoSlug) return res.json({ years: [] });
    const years = await listCachedYears({ workspace, repoSlug, email });
    res.json({ years });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * Retorna as contribuições de TODOS os anos cacheados (para exportar o HTML
 * interativo com troca de anos). Só olha o cache local.
 */
app.post("/api/all-contributions", async (req, res) => {
  try {
    const { url, email } = req.body || {};
    if (!url || !email) {
      const err = new Error("Campos obrigatórios: url e email.");
      err.status = 400;
      throw err;
    }
    const { workspace, repoSlug } = parseBitbucketUrl(url);
    if (!repoSlug) return res.json({ workspace, repoSlug: null, years: {} });
    const years = await readAllCached({ workspace, repoSlug, email });
    res.json({ workspace, repoSlug, years });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * Endpoint de streaming progressivo (SSE sobre POST).
 *
 * Emite eventos conforme pagina os commits, para o gráfico preencher ao vivo:
 *   - meta:     { workspace, repoSlug, year }
 *   - progress: { contributions, total, commitsSeen, oldestDay, page }
 *   - done:     { total }
 *   - error:    { error }
 *
 * Query opcional: ?year=2026
 */
app.post("/api/contributions/stream", async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let aborted = false;
  // Detecta desconexão do cliente pela resposta (não pela requisição: o
  // "close" do req dispara quando o corpo do POST termina de ser lido, o que
  // aconteceria logo no início e cancelaria o streaming indevidamente).
  res.on("close", () => {
    if (!res.writableEnded) aborted = true;
  });

  try {
    const { workspace, repoSlug, email, apiToken } = readCredentials(req);

    if (!repoSlug) {
      send("error", {
        error: "Cole a URL de um repositório específico (não do workspace).",
        field: "url",
      });
      return res.end();
    }

    const now = new Date();
    const year = Math.min(
      Math.max(parseInt(req.query.year, 10) || now.getFullYear(), 2000),
      now.getFullYear()
    );
    const since = `${year}-01-01`;
    const until = `${year}-12-31`;

    send("meta", { workspace, repoSlug, year });

    const cacheParams = { workspace, repoSlug, year, email };
    const cached = await readCache(cacheParams);
    const isCurrentYear = year === now.getFullYear();
    // Só relê do Bitbucket quando pedido explicitamente (botão "Nova busca").
    const forceRefresh = req.query.refresh === "1";

    // Com cache e sem pedido de atualização: serve direto e encerra.
    // Vale para qualquer ano — anos fechados nunca mudam, e reabrir o ano
    // corrente não deve reprocessar todo o histórico sem necessidade.
    if (cached && !forceRefresh && !aborted) {
      send("progress", {
        contributions: cached.contributions,
        total: cached.total,
        commitsSeen: 0,
        oldestDay: since,
        page: 0,
        fromCache: true,
      });
      send("done", { total: cached.total, fromCache: true });
      return res.end();
    }

    // Caminho multi-ano: ano passado ainda não cacheado (ou refresh forçado).
    // Percorre do ano atual até o alvo, capturando TODOS os anos do caminho,
    // mostrando o preenchimento ano a ano e cacheando cada um.
    const pastYear = year < now.getFullYear();
    if (pastYear && (!cached || forceRefresh) && !aborted) {
      const result = await streamRepoCommitsMultiYear({
        workspace,
        repoSlug,
        email,
        apiToken,
        authorFilter: email,
        targetYear: year,
        onPage: ({ byYear, totalsByYear, currentYear, commitsSeen, oldestDay, page }) => {
          if (aborted) return;
          // Mostra o ano que está sendo preenchido agora (viagem no tempo).
          const cy = currentYear ?? now.getFullYear();
          send("progress", {
            year: cy,
            contributions: byYear[cy] || {},
            total: totalsByYear[cy] || 0,
            commitsSeen,
            oldestDay,
            page,
            multiYear: true,
          });
        },
      });

      // Cacheia cada ano percorrido.
      for (const [y, map] of Object.entries(result.hashDaysByYear)) {
        const counts = {};
        for (const day of Object.values(map)) counts[day] = (counts[day] || 0) + 1;
        await writeCache(
          { workspace, repoSlug, year: Number(y), email },
          {
            contributions: counts,
            total: Object.keys(map).length,
            headHash: result.headHashByYear[y] || null,
            hashDays: map,
          }
        );
      }

      if (!aborted) {
        // Fixa no ano que o usuário pediu.
        const targetMap = result.hashDaysByYear[year] || {};
        const targetCounts = {};
        for (const day of Object.values(targetMap))
          targetCounts[day] = (targetCounts[day] || 0) + 1;
        send("progress", {
          year,
          contributions: targetCounts,
          total: Object.keys(targetMap).length,
          commitsSeen: 0,
          oldestDay: since,
          page: 0,
          final: true,
        });
        send("done", { total: Object.keys(targetMap).length, year });
      }
      return res.end();
    }

    // Mostra o cache imediatamente (se houver) enquanto revalida.
    if (cached && !aborted) {
      send("progress", {
        contributions: cached.contributions,
        total: cached.total,
        commitsSeen: 0,
        oldestDay: since,
        page: 0,
        fromCache: true,
      });
    }

    const result = await streamRepoCommits({
      workspace,
      repoSlug,
      email,
      apiToken,
      authorFilter: email,
      since,
      until,
      // Revalidação incremental a partir do topo salvo, deduplicando por hash.
      // Sem cache: busca completa.
      exclude: cached?.headHash || null,
      seedHashDays: cached?.hashDays || null,
      onPage: ({ counts, total, commitsSeen, oldestDay, page }) => {
        if (aborted) return;
        send("progress", {
          year,
          contributions: counts,
          total,
          commitsSeen,
          oldestDay,
          page,
        });
      },
    });

    if (!aborted) {
      await writeCache(cacheParams, {
        contributions: result.counts,
        total: result.total,
        headHash: result.headHash || cached?.headHash || null,
        hashDays: result.hashDays,
      });
      send("done", { total: result.total });
    }
    res.end();
  } catch (err) {
    if (!aborted) send("error", { error: err.message, field: err.field || null });
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(
    `Bitbucket Contributions server rodando em http://localhost:${PORT}`
  );
});
