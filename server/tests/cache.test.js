import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";

// fs em memória: evita tocar em server/.cache de verdade.
const store = new Map();
const fsMock = {
  mkdir: jest.fn(async () => {}),
  readFile: jest.fn(async (file) => {
    if (!store.has(file)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return store.get(file);
  }),
  writeFile: jest.fn(async (file, content) => {
    store.set(file, content);
  }),
  access: jest.fn(async (file) => {
    if (!store.has(file)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  }),
};

jest.unstable_mockModule("node:fs/promises", () => ({ default: fsMock, ...fsMock }));

const { readCache, writeCache, listCachedYears, readAllCached } = await import(
  "../src/cache.js"
);

const params = { workspace: "ws", repoSlug: "repo", year: 2024, email: "Dev@Example.com" };
const payload = {
  contributions: { "2024-03-01": 2 },
  total: 2,
  headHash: "abc",
  hashDays: { h1: "2024-03-01", h2: "2024-03-01" },
};

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("cache", () => {
  test("readCache retorna null quando não há cache", async () => {
    expect(await readCache(params)).toBeNull();
  });

  test("writeCache seguido de readCache devolve os dados", async () => {
    await writeCache(params, payload);
    const data = await readCache(params);
    expect(data).toMatchObject({
      workspace: "ws",
      repoSlug: "repo",
      year: 2024,
      ...payload,
    });
    expect(typeof data.updatedAt).toBe("string");
    expect(fsMock.mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });

  test("a chave ignora maiúsculas/minúsculas do e-mail", async () => {
    await writeCache(params, payload);
    expect(await readCache({ ...params, email: "dev@example.com" })).not.toBeNull();
  });

  test("não persiste credenciais (e-mail não vai no arquivo)", async () => {
    await writeCache(params, payload);
    const [content] = [...store.values()];
    expect(content).not.toMatch(/example\.com/i);
  });

  test("chaves diferentes por workspace, repo, ano e e-mail", async () => {
    await writeCache(params, payload);
    expect(await readCache({ ...params, workspace: "outro" })).toBeNull();
    expect(await readCache({ ...params, repoSlug: "outro" })).toBeNull();
    expect(await readCache({ ...params, year: 2023 })).toBeNull();
    expect(await readCache({ ...params, email: "x@y.com" })).toBeNull();
  });

  test("readCache retorna null para JSON corrompido ou formato inválido", async () => {
    await writeCache(params, payload);
    const file = [...store.keys()][0];
    store.set(file, "{nao e json");
    expect(await readCache(params)).toBeNull();
    store.set(file, JSON.stringify({ contributions: "texto" }));
    expect(await readCache(params)).toBeNull();
  });

  test("writeCache não lança se a gravação falhar", async () => {
    fsMock.writeFile.mockRejectedValueOnce(new Error("disco cheio"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await expect(writeCache(params, payload)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("disco cheio"));
  });

  test("listCachedYears lista só anos com cache, em ordem decrescente", async () => {
    for (const year of [2019, 2024, 2021]) {
      await writeCache({ ...params, year }, { ...payload, total: year });
    }
    expect(await listCachedYears(params)).toEqual([2024, 2021, 2019]);
  });

  test("listCachedYears retorna vazio sem cache", async () => {
    expect(await listCachedYears(params)).toEqual([]);
  });

  test("readAllCached devolve contribuições e total por ano", async () => {
    await writeCache({ ...params, year: 2024 }, payload);
    await writeCache(
      { ...params, year: 2023 },
      { ...payload, contributions: { "2023-01-02": 1 }, total: 1 }
    );
    expect(await readAllCached(params)).toEqual({
      2024: { contributions: { "2024-03-01": 2 }, total: 2 },
      2023: { contributions: { "2023-01-02": 1 }, total: 1 },
    });
  });
});
