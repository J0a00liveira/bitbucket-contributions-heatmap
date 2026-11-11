// Cliente da API REST do Bitbucket (v2.0).
// Usa fetch nativo (Node 18+). As credenciais são passadas por chamada e nunca
// persistidas.
//
// Autenticação: desde 09/06/2026 os App Passwords foram descontinuados. O
// Basic Auth agora usa o E-MAIL da conta Atlassian como usuário e um API TOKEN
// como senha. A mecânica (base64 "user:password") permanece a mesma.

const BITBUCKET_API = "https://api.bitbucket.org/2.0";

/**
 * Monta o header de autenticação Basic a partir do e-mail da conta Atlassian
 * e de um API Token.
 */
function authHeader(email, apiToken) {
  const token = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return `Basic ${token}`;
}

/**
 * Faz uma requisição GET autenticada à API do Bitbucket.
 *
 * Trata rate limiting (429) e erros transitórios (502/503/504) com retry e
 * backoff exponencial, respeitando o header Retry-After quando presente.
 */
async function bbGet(url, auth, { maxRetries = 5 } = {}) {
  let attempt = 0;

  while (true) {
    const res = await fetch(url, {
      headers: {
        Authorization: auth,
        Accept: "application/json",
      },
    });

    if (res.ok) return res.json();

    const retriable = res.status === 429 || res.status >= 500;
    if (retriable && attempt < maxRetries) {
      // Respeita Retry-After (segundos); senão usa backoff exponencial.
      const retryAfter = parseInt(res.headers.get("retry-after") || "", 10);
      const waitMs = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : Math.min(1000 * 2 ** attempt, 15000);
      await sleep(waitMs);
      attempt += 1;
      continue;
    }

    const body = await res.text();

    // Tenta extrair a mensagem estruturada do Bitbucket.
    let apiMessage = "";
    try {
      apiMessage = JSON.parse(body)?.error?.message || "";
    } catch {
      apiMessage = body.slice(0, 300);
    }

    // Caso comum: token criado sem escopos do Bitbucket.
    if (/no Bitbucket scopes/i.test(apiMessage)) {
      const err = new Error(
        'O API Token não tem escopos do Bitbucket. Crie um novo com "Create ' +
          'API token with scopes" e marque Repositories → Read e User → Read.'
      );
      err.status = res.status;
      err.field = "apiToken";
      throw err;
    }

    // Credenciais inválidas: e-mail ou token errados.
    if (res.status === 401 || res.status === 403) {
      const err = new Error("E-mail ou API Token inválidos.");
      err.status = res.status;
      err.field = "apiToken";
      throw err;
    }

    // Repositório/workspace não encontrado (ou sem acesso): problema na URL.
    if (res.status === 404) {
      const err = new Error(
        "Repositório não encontrado. Verifique a URL e seu acesso a ele."
      );
      err.status = res.status;
      err.field = "url";
      throw err;
    }

    const err = new Error(
      `Erro ao consultar o Bitbucket (HTTP ${res.status}). Tente novamente.`
    );
    err.status = res.status;
    throw err;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normaliza a identidade do autor de um commit para comparação.
 * O campo raw costuma ser "Nome <email@dominio>".
 */
function matchesAuthor(commit, authorFilter) {
  if (!authorFilter) return true;
  const needle = authorFilter.trim().toLowerCase();
  // O filtro é o e-mail, que aparece no campo raw: "Nome <email@dominio>".
  const raw = commit?.author?.raw?.toLowerCase() || "";
  return raw.includes(needle);
}

/**
 * Versão progressiva: pagina os commits de um repositório chamando `onPage`
 * após cada página, com o estado parcial. Permite que o servidor envie
 * atualizações ao cliente (SSE) enquanto a busca ainda está em andamento.
 *
 * `onPage(info)` recebe:
 *   - counts: mapa acumulado { "YYYY-MM-DD": n } (do autor, na janela)
 *   - total: soma acumulada de contribuições do autor
 *   - commitsSeen: total de commits percorridos (de todos os autores)
 *   - oldestDay: dia mais antigo já alcançado (YYYY-MM-DD) ou null
 *   - page: índice da página processada (1-based)
 *   - done: true quando não há mais páginas na janela
 */
export async function streamRepoCommits({
  workspace,
  repoSlug,
  email,
  apiToken,
  authorFilter,
  since,
  until,
  onPage,
  // Atualização incremental. `exclude` (hash do topo salvo) evita rebaixar
  // ancestrais já vistos; `seedHashDays` é o mapa { hash: "YYYY-MM-DD" } dos
  // commits do autor já contados antes. A deduplicação por hash garante que
  // nenhum commit seja contado duas vezes, mesmo com múltiplas branches.
  exclude = null,
  seedHashDays = null,
  commitPageLimit = 500,
}) {
  const auth = authHeader(email, apiToken);
  const base = `${BITBUCKET_API}/repositories/${encodeURIComponent(
    workspace
  )}/${encodeURIComponent(repoSlug)}/commits`;
  // fields enxuto: só o necessário (hash para dedup/cache, date e author.raw
  // para o filtro por e-mail). Reduz muito o tamanho de cada resposta.
  const params = new URLSearchParams({
    pagelen: "100",
    fields: "next,values.hash,values.date,values.author.raw",
  });
  if (exclude) params.append("exclude", exclude);
  const url = `${base}?${params.toString()}`;

  // Mapa hash -> dia dos commits do autor já contados (começa com o seed).
  const hashDays = seedHashDays ? { ...seedHashDays } : {};

  // Recalcula as contagens por dia a partir do mapa de hashes (fonte da verdade).
  const recomputeCounts = () => {
    const c = {};
    for (const day of Object.values(hashDays)) c[day] = (c[day] || 0) + 1;
    return c;
  };

  let counts = recomputeCounts();
  let total = Object.keys(hashDays).length;
  let commitsSeen = 0;
  let oldestDay = null;
  let headHash = null; // hash do commit mais recente visto nesta busca

  let next = url;
  let pages = 0;

  while (next && pages < commitPageLimit) {
    const data = await bbGet(next, auth);
    const values = Array.isArray(data.values) ? data.values : [];

    let reachedOld = false;
    let changed = false;
    for (const commit of values) {
      if (!commit.date || !commit.hash) continue;
      if (!headHash) headHash = commit.hash;
      commitsSeen += 1;
      const day = commit.date.slice(0, 10); // YYYY-MM-DD

      if (until && day > until) continue;

      if (since && day < since) {
        reachedOld = true;
        continue;
      }

      oldestDay = day; // commits em ordem decrescente: o último visto é o mais antigo

      // Conta só se for do autor E ainda não tiver sido contado (dedup).
      if (matchesAuthor(commit, authorFilter) && !(commit.hash in hashDays)) {
        hashDays[commit.hash] = day;
        changed = true;
      }
    }

    if (changed) {
      counts = recomputeCounts();
      total = Object.keys(hashDays).length;
    }

    pages += 1;
    next = reachedOld ? null : data.next || null;

    if (typeof onPage === "function") {
      await onPage({
        counts,
        total,
        commitsSeen,
        oldestDay,
        page: pages,
        done: !next,
      });
    }

    if (reachedOld) break;
  }

  return { counts, total, commitsSeen, oldestDay, headHash, hashDays, pages };
}

/**
 * Varredura multi-ano: percorre do ano mais recente até `targetYear`,
 * agregando as contribuições do autor em TODOS os anos do caminho (não
 * descarta os intermediários). Emite progresso indicando qual ano está sendo
 * preenchido no momento, para o frontend "trocar de página" conforme desce no
 * histórico.
 *
 * `onPage(info)`:
 *   - byYear: { [year]: { "YYYY-MM-DD": n } }  contagens por dia, por ano
 *   - totalsByYear: { [year]: total }
 *   - currentYear: ano mais antigo alcançado até agora (o que está preenchendo)
 *   - headHashByYear: { [year]: hashDoTopo } para o cache incremental
 *   - hashDaysByYear: { [year]: { hash: "YYYY-MM-DD" } } para dedup/cache
 *   - commitsSeen, oldestDay, page, done
 */
export async function streamRepoCommitsMultiYear({
  workspace,
  repoSlug,
  email,
  apiToken,
  authorFilter,
  targetYear,
  onPage,
  commitPageLimit = 500,
}) {
  const auth = authHeader(email, apiToken);
  const base = `${BITBUCKET_API}/repositories/${encodeURIComponent(
    workspace
  )}/${encodeURIComponent(repoSlug)}/commits`;
  const params = new URLSearchParams({
    pagelen: "100",
    fields: "next,values.hash,values.date,values.author.raw",
  });
  const url = `${base}?${params.toString()}`;

  const since = `${targetYear}-01-01`; // para quando cruzar isto

  // Estado por ano.
  const hashDaysByYear = {}; // { year: { hash: day } }
  const headHashByYear = {}; // { year: primeiro hash visto naquele ano }

  const yearOf = (day) => parseInt(day.slice(0, 4), 10);

  const snapshot = () => {
    const byYear = {};
    const totalsByYear = {};
    for (const [y, map] of Object.entries(hashDaysByYear)) {
      const counts = {};
      for (const day of Object.values(map)) counts[day] = (counts[day] || 0) + 1;
      byYear[y] = counts;
      totalsByYear[y] = Object.keys(map).length;
    }
    return { byYear, totalsByYear };
  };

  let commitsSeen = 0;
  let oldestDay = null;
  let currentYear = null;

  let next = url;
  let pages = 0;

  while (next && pages < commitPageLimit) {
    const data = await bbGet(next, auth);
    const values = Array.isArray(data.values) ? data.values : [];

    let reachedOld = false;
    for (const commit of values) {
      if (!commit.date || !commit.hash) continue;
      commitsSeen += 1;
      const day = commit.date.slice(0, 10);

      // Passou da borda inferior do ano alvo: para.
      if (day < since) {
        reachedOld = true;
        continue;
      }

      oldestDay = day;
      const y = yearOf(day);
      currentYear = y;

      // Primeiro hash visto num ano = topo daquele ano (para cache incremental).
      if (!headHashByYear[y]) headHashByYear[y] = commit.hash;

      if (matchesAuthor(commit, authorFilter)) {
        if (!hashDaysByYear[y]) hashDaysByYear[y] = {};
        if (!(commit.hash in hashDaysByYear[y])) {
          hashDaysByYear[y][commit.hash] = day;
        }
      }
    }

    pages += 1;
    next = reachedOld ? null : data.next || null;

    if (typeof onPage === "function") {
      const { byYear, totalsByYear } = snapshot();
      await onPage({
        byYear,
        totalsByYear,
        currentYear,
        headHashByYear,
        hashDaysByYear,
        commitsSeen,
        oldestDay,
        page: pages,
        done: !next,
      });
    }

    if (reachedOld) break;
  }

  return { hashDaysByYear, headHashByYear };
}
