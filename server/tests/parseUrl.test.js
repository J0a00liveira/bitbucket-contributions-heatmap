import { describe, test, expect } from "@jest/globals";
import { parseBitbucketUrl } from "../src/parseUrl.js";

describe("parseBitbucketUrl", () => {
  test.each([
    ["https://bitbucket.org/ws", { workspace: "ws", repoSlug: null }],
    ["https://bitbucket.org/ws/", { workspace: "ws", repoSlug: null }],
    ["https://bitbucket.org/ws/repo", { workspace: "ws", repoSlug: "repo" }],
    ["https://bitbucket.org/ws/repo/src/master/", { workspace: "ws", repoSlug: "repo" }],
    ["http://bitbucket.org/ws/repo", { workspace: "ws", repoSlug: "repo" }],
    ["bitbucket.org/ws/repo", { workspace: "ws", repoSlug: "repo" }],
    ["bitbucket.org/ws", { workspace: "ws", repoSlug: null }],
    ["ws/repo", { workspace: "ws", repoSlug: "repo" }],
    ["ws", { workspace: "ws", repoSlug: null }],
    ["  ws/repo  ", { workspace: "ws", repoSlug: "repo" }],
    ["https://BITBUCKET.ORG/ws/repo", { workspace: "ws", repoSlug: "repo" }],
  ])("extrai workspace e repo de %s", (input, expected) => {
    expect(parseBitbucketUrl(input)).toEqual(expected);
  });

  test("decodifica segmentos com percent-encoding", () => {
    expect(parseBitbucketUrl("https://bitbucket.org/my%20ws/my%20repo")).toEqual({
      workspace: "my ws",
      repoSlug: "my repo",
    });
  });

  test.each([undefined, null, "", 42, {}])("rejeita entrada vazia ou não string (%p)", (input) => {
    expect(() => parseBitbucketUrl(input)).toThrow("Informe a URL do repositório.");
  });

  test("rejeita hosts que não são bitbucket.org", () => {
    expect(() => parseBitbucketUrl("https://github.com/ws/repo")).toThrow(
      "A URL precisa ser do bitbucket.org."
    );
  });

  test("rejeita URL sem workspace", () => {
    expect(() => parseBitbucketUrl("https://bitbucket.org/")).toThrow(
      /Não encontramos o workspace/
    );
  });

  test.each(["dashboard", "account", "workspace", "repo", "projects", "snippets", "Dashboard"])(
    "rejeita segmento reservado %s",
    (segment) => {
      expect(() => parseBitbucketUrl(`https://bitbucket.org/${segment}/x`)).toThrow(
        /Cole a URL de um repositório/
      );
    }
  );

  test("erros têm status 400 e field 'url'", () => {
    try {
      parseBitbucketUrl("");
      throw new Error("deveria ter lançado");
    } catch (err) {
      expect(err.status).toBe(400);
      expect(err.field).toBe("url");
    }
  });
});
