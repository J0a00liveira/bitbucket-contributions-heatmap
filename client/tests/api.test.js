import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import {
  fetchCachedYears,
  fetchAllContributions,
  streamContributions,
} from "../src/api.js";

const creds = { url: "ws/repo", email: "a@b.com", apiToken: "secret" };

let fetchMock;
beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock;
});
afterEach(() => {
  delete global.fetch;
});

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** Cria uma Response com body em stream a partir de pedaços de texto. */
function sseResponse(chunks) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { value: enc.encode(chunks[i++]), done: false }
            : { value: undefined, done: true },
      }),
    },
  };
}

const waitFor = async (cond) => {
  for (let i = 0; i < 50 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
};

describe("fetchCachedYears", () => {
  test("envia só url e e-mail (sem o token) e retorna os anos", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { years: [2024, 2023] }));
    expect(await fetchCachedYears(creds)).toEqual([2024, 2023]);
    const [path, opts] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/cached-years");
    expect(JSON.parse(opts.body)).toEqual({ url: "ws/repo", email: "a@b.com" });
  });

  test("retorna [] em erro HTTP, falha de rede ou resposta inesperada", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: "x" }));
    expect(await fetchCachedYears(creds)).toEqual([]);
    fetchMock.mockRejectedValueOnce(new Error("rede"));
    expect(await fetchCachedYears(creds)).toEqual([]);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { years: "x" }));
    expect(await fetchCachedYears(creds)).toEqual([]);
  });
});

describe("fetchAllContributions", () => {
  test("retorna o payload da API", async () => {
    const payload = { workspace: "ws", repoSlug: "repo", years: {} };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, payload));
    expect(await fetchAllContributions(creds)).toEqual(payload);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/all-contributions");
  });

  test("lança com a mensagem do servidor ou com o status", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: "URL inválida." }));
    await expect(fetchAllContributions(creds)).rejects.toThrow("URL inválida.");
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("sem json");
      },
    });
    await expect(fetchAllContributions(creds)).rejects.toThrow("Erro 502");
  });
});

describe("streamContributions", () => {
  test("despacha eventos SSE, inclusive quebrados entre chunks", async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'event: meta\ndata: {"workspace":"ws"}\n\nevent: prog',
        'ress\ndata: {"page":1}\n\n',
        'event: done\ndata: {"total":3}\n\n',
      ])
    );
    const h = { onMeta: jest.fn(), onProgress: jest.fn(), onDone: jest.fn(), onError: jest.fn() };
    streamContributions(creds, 2024, h);
    await waitFor(() => h.onDone.mock.calls.length > 0);

    expect(h.onMeta).toHaveBeenCalledWith({ workspace: "ws" });
    expect(h.onProgress).toHaveBeenCalledWith({ page: 1 });
    expect(h.onDone).toHaveBeenCalledWith({ total: 3 });
    expect(h.onError).not.toHaveBeenCalled();
  });

  test("monta a URL com year e refresh, e envia as credenciais no body", async () => {
    fetchMock.mockResolvedValue(sseResponse([]));
    streamContributions(creds, 2022, {}, true);
    streamContributions(creds, 2023, {}, false);
    await waitFor(() => fetchMock.mock.calls.length === 2);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/contributions/stream?year=2022&refresh=1");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/contributions/stream?year=2023");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(creds);
  });

  test("evento 'error' chama onError com mensagem e campo", async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse(['event: error\ndata: {"error":"falhou","field":"apiToken"}\n\n'])
    );
    const onError = jest.fn();
    streamContributions(creds, 2024, { onError });
    await waitFor(() => onError.mock.calls.length > 0);
    expect(onError).toHaveBeenCalledWith("falhou", "apiToken");
  });

  test("resposta HTTP de erro vira onError com o campo do backend", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      body: null,
      json: async () => ({ error: "URL inválida.", field: "url" }),
    });
    const onError = jest.fn();
    streamContributions(creds, 2024, { onError });
    await waitFor(() => onError.mock.calls.length > 0);
    expect(onError).toHaveBeenCalledWith("URL inválida.", "url");
  });

  test("falha de rede vira onError", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Failed to fetch"));
    const onError = jest.fn();
    streamContributions(creds, 2024, { onError });
    await waitFor(() => onError.mock.calls.length > 0);
    expect(onError).toHaveBeenCalledWith("Failed to fetch", null);
  });

  test("ignora blocos sem data, com JSON inválido ou evento desconhecido", async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        "event: progress\n\n",
        "event: progress\ndata: {quebrado\n\n",
        'event: outro\ndata: {"a":1}\n\n',
        'event: done\ndata: {"ok":true}\n\n',
      ])
    );
    const h = { onProgress: jest.fn(), onDone: jest.fn(), onError: jest.fn() };
    streamContributions(creds, 2024, h);
    await waitFor(() => h.onDone.mock.calls.length > 0);
    expect(h.onProgress).not.toHaveBeenCalled();
    expect(h.onError).not.toHaveBeenCalled();
    expect(h.onDone).toHaveBeenCalledWith({ ok: true });
  });

  test("abort() cancela sem chamar onError", async () => {
    fetchMock.mockImplementationOnce((_url, { signal }) =>
      new Promise((_res, rej) =>
        signal.addEventListener("abort", () =>
          rej(Object.assign(new Error("aborted"), { name: "AbortError" }))
        )
      )
    );
    const onError = jest.fn();
    const abort = streamContributions(creds, 2024, { onError });
    abort();
    await new Promise((r) => setTimeout(r, 20));
    expect(onError).not.toHaveBeenCalled();
  });
});
