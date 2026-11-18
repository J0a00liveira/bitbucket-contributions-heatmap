import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import {
  streamRepoCommits,
  streamRepoCommitsMultiYear,
} from "../src/bitbucket.js";

const base = {
  workspace: "ws",
  repoSlug: "repo",
  email: "dev@example.com",
  apiToken: "tok",
  authorFilter: "dev@example.com",
};

const commit = (hash, date, email = "dev@example.com") => ({
  hash,
  date: `${date}T10:00:00+00:00`,
  author: { raw: `Fulano <${email}>` },
});

const okResponse = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

const errResponse = (status, body = "", headers = {}) => ({
  ok: false,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

let fetchMock;
beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock;
});
afterEach(() => {
  delete global.fetch;
});

describe("streamRepoCommits", () => {
  test("conta apenas commits do autor e agrega por dia", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        values: [
          commit("a", "2024-05-02"),
          commit("b", "2024-05-02"),
          commit("c", "2024-05-01", "outro@x.com"),
          commit("d", "2024-05-01"),
        ],
      })
    );
    const res = await streamRepoCommits(base);
    expect(res.counts).toEqual({ "2024-05-02": 2, "2024-05-01": 1 });
    expect(res.total).toBe(3);
    expect(res.commitsSeen).toBe(4);
    expect(res.headHash).toBe("a");
    expect(res.oldestDay).toBe("2024-05-01");
    expect(res.pages).toBe(1);
  });

  test("filtro de autor ignora maiúsculas e, sem filtro, conta todos", async () => {
    const values = [commit("a", "2024-05-02", "DEV@Example.com"), commit("b", "2024-05-02", "x@y.com")];
    fetchMock.mockResolvedValueOnce(okResponse({ values }));
    expect((await streamRepoCommits(base)).total).toBe(1);

    fetchMock.mockResolvedValueOnce(okResponse({ values }));
    expect((await streamRepoCommits({ ...base, authorFilter: "" })).total).toBe(2);
  });

  test("envia Basic Auth, fields enxutos e URL com workspace/repo codificados", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ values: [] }));
    await streamRepoCommits({ ...base, workspace: "my ws", exclude: "deadbeef" });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/repositories/my%20ws/repo/commits?");
    expect(url).toContain("pagelen=100");
    expect(url).toContain("exclude=deadbeef");
    expect(opts.headers.Authorization).toBe(
      `Basic ${Buffer.from("dev@example.com:tok").toString("base64")}`
    );
  });

  test("segue a paginação via data.next e chama onPage a cada página", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse({ values: [commit("a", "2024-05-02")], next: "https://next/1" }))
      .mockResolvedValueOnce(okResponse({ values: [commit("b", "2024-05-01")] }));
    const onPage = jest.fn();
    const res = await streamRepoCommits({ ...base, onPage });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("https://next/1");
    expect(onPage).toHaveBeenCalledTimes(2);
    expect(onPage.mock.calls[0][0]).toMatchObject({ page: 1, total: 1, done: false });
    expect(onPage.mock.calls[1][0]).toMatchObject({ page: 2, total: 2, done: true });
    expect(res.total).toBe(2);
  });

  test("respeita since/until e para ao alcançar commits antigos", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        values: [
          commit("novo", "2025-02-01"), // depois do until
          commit("a", "2024-12-31"),
          commit("b", "2024-01-01"),
          commit("velho", "2023-12-31"), // antes do since
        ],
        next: "https://next/never",
      })
    );
    const res = await streamRepoCommits({ ...base, since: "2024-01-01", until: "2024-12-31" });
    expect(res.counts).toEqual({ "2024-12-31": 1, "2024-01-01": 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // não busca a próxima página
  });

  test("não conta duas vezes um hash já presente no seed (incremental)", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ values: [commit("a", "2024-05-02"), commit("b", "2024-05-03")] })
    );
    const res = await streamRepoCommits({
      ...base,
      seedHashDays: { a: "2024-05-02", z: "2024-04-01" },
    });
    expect(res.total).toBe(3);
    expect(res.counts).toEqual({ "2024-05-02": 1, "2024-04-01": 1, "2024-05-03": 1 });
  });

  test("ignora commits sem data ou hash", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ values: [{ hash: "a" }, { date: "2024-05-01T00:00:00Z" }, commit("b", "2024-05-01")] })
    );
    const res = await streamRepoCommits(base);
    expect(res.total).toBe(1);
    expect(res.commitsSeen).toBe(1);
  });

  test("respeita commitPageLimit", async () => {
    fetchMock.mockResolvedValue(okResponse({ values: [commit("a", "2024-05-01")], next: "https://n" }));
    const res = await streamRepoCommits({ ...base, commitPageLimit: 3 });
    expect(res.pages).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  describe("tratamento de erros", () => {
    test("401/403 -> credenciais inválidas no campo apiToken", async () => {
      fetchMock.mockResolvedValueOnce(errResponse(401, { error: { message: "x" } }));
      await expect(streamRepoCommits(base)).rejects.toMatchObject({
        message: "E-mail ou API Token inválidos.",
        status: 401,
        field: "apiToken",
      });
    });

    test("404 -> repositório não encontrado no campo url", async () => {
      fetchMock.mockResolvedValueOnce(errResponse(404, { error: { message: "nope" } }));
      await expect(streamRepoCommits(base)).rejects.toMatchObject({
        status: 404,
        field: "url",
        message: expect.stringContaining("Repositório não encontrado"),
      });
    });

    test("token sem escopos tem mensagem específica", async () => {
      fetchMock.mockResolvedValueOnce(
        errResponse(403, { error: { message: "Token has no Bitbucket scopes" } })
      );
      await expect(streamRepoCommits(base)).rejects.toMatchObject({
        field: "apiToken",
        message: expect.stringContaining("escopos"),
      });
    });

    test("outros erros 4xx incluem o status", async () => {
      fetchMock.mockResolvedValueOnce(errResponse(400, "bad request"));
      await expect(streamRepoCommits(base)).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining("HTTP 400"),
      });
    });
  });

  describe("retry", () => {
    test("repete em 429 respeitando Retry-After e depois tem sucesso", async () => {
      fetchMock
        .mockResolvedValueOnce(errResponse(429, "", { "retry-after": "0" }))
        .mockResolvedValueOnce(errResponse(503, "", { "retry-after": "0" }))
        .mockResolvedValueOnce(okResponse({ values: [commit("a", "2024-05-01")] }));
      const res = await streamRepoCommits(base);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(res.total).toBe(1);
    });

    test("desiste após 5 tentativas e lança erro com o status", async () => {
      fetchMock.mockResolvedValue(errResponse(502, "", { "retry-after": "0" }));
      await expect(streamRepoCommits(base)).rejects.toMatchObject({ status: 502 });
      expect(fetchMock).toHaveBeenCalledTimes(6); // 1 + 5 retries
    });
  });
});

describe("streamRepoCommitsMultiYear", () => {
  test("agrega por ano, até o ano alvo, e para ao cruzar a borda", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        values: [
          commit("a", "2025-03-01"),
          commit("b", "2025-03-01"),
          commit("c", "2024-12-31"),
          commit("o", "2024-06-01", "outro@x.com"),
          commit("d", "2024-01-01"),
          commit("velho", "2023-12-31"),
        ],
        next: "https://next/never",
      })
    );
    const onPage = jest.fn();
    const res = await streamRepoCommitsMultiYear({ ...base, targetYear: 2024, onPage });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.hashDaysByYear).toEqual({
      2025: { a: "2025-03-01", b: "2025-03-01" },
      2024: { c: "2024-12-31", d: "2024-01-01" },
    });
    // topo do ano = primeiro hash visto, mesmo de outro autor
    expect(res.headHashByYear).toEqual({ 2025: "a", 2024: "c" });

    const info = onPage.mock.calls[0][0];
    expect(info.byYear).toEqual({
      2025: { "2025-03-01": 2 },
      2024: { "2024-12-31": 1, "2024-01-01": 1 },
    });
    expect(info.totalsByYear).toEqual({ 2025: 2, 2024: 2 });
    expect(info.currentYear).toBe(2024);
    expect(info.done).toBe(true);
  });

  test("pagina até alcançar o ano alvo", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse({ values: [commit("a", "2025-01-01")], next: "https://n/2" }))
      .mockResolvedValueOnce(okResponse({ values: [commit("b", "2024-06-01")] }));
    const res = await streamRepoCommitsMultiYear({ ...base, targetYear: 2024 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Object.keys(res.hashDaysByYear)).toEqual(["2024", "2025"]);
  });
});
