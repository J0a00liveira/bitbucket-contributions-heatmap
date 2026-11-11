// Parser de URLs do Bitbucket Cloud.
//
// Aceita formatos como:
//   https://bitbucket.org/devsmartnx
//   https://bitbucket.org/devsmartnx/
//   https://bitbucket.org/devsmartnx/nx-suite-fullbackend
//   https://bitbucket.org/devsmartnx/nx-suite-fullbackend/src/master/
//   bitbucket.org/devsmartnx/nx-suite-fullbackend
//   devsmartnx/nx-suite-fullbackend
//
// Retorna { workspace, repoSlug } onde repoSlug pode ser null (URL de
// workspace). Lança erro se não conseguir extrair um workspace.

// Segmentos que fazem parte da navegação do Bitbucket e não são repositórios.
const WORKSPACE_RESERVED = new Set([
  "workspace",
  "dashboard",
  "account",
  "repo",
  "projects",
  "snippets",
]);

export function parseBitbucketUrl(input) {
  const urlError = (message) => {
    const err = new Error(message);
    err.status = 400;
    err.field = "url";
    return err;
  };

  if (!input || typeof input !== "string") {
    throw urlError("Informe a URL do repositório.");
  }

  let raw = input.trim();

  // Normaliza para uma URL absoluta que o construtor URL consiga parsear.
  // - "https://bitbucket.org/..."        -> usa como está
  // - "bitbucket.org/..."                -> adiciona o protocolo
  // - "devsmartnx/repo" ou "devsmartnx"  -> assume o host bitbucket.org
  if (/^https?:\/\//i.test(raw)) {
    // já tem protocolo
  } else if (/^bitbucket\.org\//i.test(raw) || /^bitbucket\.org$/i.test(raw)) {
    raw = `https://${raw.replace(/^\/+/, "")}`;
  } else {
    raw = `https://bitbucket.org/${raw.replace(/^\/+/, "")}`;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw urlError("URL inválida.");
  }

  const host = parsed.hostname.toLowerCase();
  if (host && !host.endsWith("bitbucket.org")) {
    throw urlError("A URL precisa ser do bitbucket.org.");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);

  if (segments.length === 0) {
    throw urlError(
      "Não encontramos o workspace na URL. Ex.: bitbucket.org/workspace/repositorio"
    );
  }

  const workspace = decodeURIComponent(segments[0]);

  if (WORKSPACE_RESERVED.has(workspace.toLowerCase())) {
    throw urlError(
      "Cole a URL de um repositório ou do seu workspace no Bitbucket."
    );
  }

  // Segundo segmento, quando existe e não é uma seção reservada, é o repo.
  // Ex.: .../{repo}/src/master  -> pegamos apenas {repo}.
  const repoSlug =
    segments.length >= 2 ? decodeURIComponent(segments[1]) : null;

  return { workspace, repoSlug };
}
