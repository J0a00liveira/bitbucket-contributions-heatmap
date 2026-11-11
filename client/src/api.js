// Camada fina de acesso ao backend proxy.

async function postJson(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Erro ${res.status}`);
  }
  return data;
}

/** Lista os anos já cacheados para a URL + e-mail (para os botões de ano). */
export async function fetchCachedYears(creds) {
  try {
    const data = await postJson("/api/cached-years", {
      url: creds.url,
      email: creds.email,
    });
    return Array.isArray(data.years) ? data.years : [];
  } catch {
    return [];
  }
}

/** Contribuições de todos os anos cacheados (para o HTML interativo). */
export async function fetchAllContributions(creds) {
  const data = await postJson("/api/all-contributions", {
    url: creds.url,
    email: creds.email,
  });
  return data; // { workspace, repoSlug, years: { [year]: {contributions,total} } }
}

/**
 * Busca progressiva via SSE (POST + ReadableStream).
 *
 * `handlers` pode conter: onMeta, onProgress, onDone, onError.
 * Retorna uma função `abort()` para cancelar.
 */
export function streamContributions(creds, year, handlers = {}, forceRefresh = false) {
  const controller = new AbortController();

  (async () => {
    try {
      const qs = `year=${year}${forceRefresh ? "&refresh=1" : ""}`;
      const res = await fetch(`/api/contributions/stream?${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(creds),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        // Em erro antes do stream, o backend pode responder JSON.
        const data = await res.json().catch(() => ({}));
        const err = new Error(data.error || `Erro ${res.status}`);
        err.field = data.field || null;
        throw err;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Eventos SSE são separados por linha em branco.
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          dispatchEvent(chunk, handlers);
        }
      }
    } catch (err) {
      if (err.name === "AbortError") return;
      handlers.onError?.(err.message || "Falha na conexão.", err.field || null);
    }
  })();

  return () => controller.abort();
}

/** Faz o parse de um bloco SSE ("event: x\ndata: {...}") e chama o handler. */
function dispatchEvent(chunk, handlers) {
  let event = "message";
  let data = "";
  for (const line of chunk.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return;

  let payload;
  try {
    payload = JSON.parse(data);
  } catch {
    return;
  }

  if (event === "meta") handlers.onMeta?.(payload);
  else if (event === "progress") handlers.onProgress?.(payload);
  else if (event === "done") handlers.onDone?.(payload);
  else if (event === "error")
    handlers.onError?.(payload.error, payload.field || null);
}
