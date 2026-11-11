// Cache local em disco (JSON), para acelerar buscas repetidas.
//
// Como a app roda na máquina do próprio usuário, podemos persistir os números
// agregados sem risco de vazamento entre usuários. As CREDENCIAIS NUNCA são
// salvas — apenas as contagens por dia, o hash do topo e um timestamp.
//
// Chave: (workspace, repoSlug, year, email). O filtro por autor é por e-mail,
// então o cache é por autor.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Pasta de cache na raiz do server (server/.cache), ignorada pelo git.
const CACHE_DIR = path.join(__dirname, "..", ".cache");

function keyFor({ workspace, repoSlug, year, email }) {
  const raw = `${workspace}/${repoSlug}/${year}/${email.toLowerCase()}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

function fileFor(key) {
  return path.join(CACHE_DIR, `${key}.json`);
}

/**
 * Lê o cache de uma busca, ou null se não existir.
 * Retorna { contributions, total, headHash, updatedAt }.
 */
export async function readCache(params) {
  try {
    const raw = await fs.readFile(fileFor(keyFor(params)), "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data.contributions !== "object") return null;
    return data;
  } catch {
    return null; // sem cache ou ilegível
  }
}

/**
 * Lista os anos que têm cache para um dado (workspace, repoSlug, email).
 * Verifica a existência do arquivo de cada ano possível (barato: ~19 anos).
 * Retorna os anos em ordem decrescente.
 */
export async function listCachedYears({ workspace, repoSlug, email }) {
  const current = new Date().getFullYear();
  const years = [];
  for (let year = current; year >= 2008; year -= 1) {
    const file = fileFor(keyFor({ workspace, repoSlug, year, email }));
    try {
      await fs.access(file);
      years.push(year);
    } catch {
      // sem cache para este ano
    }
  }
  return years;
}

/**
 * Lê as contribuições de todos os anos cacheados para (workspace, repoSlug,
 * email). Retorna { [year]: { contributions, total } } em ordem decrescente.
 */
export async function readAllCached({ workspace, repoSlug, email }) {
  const years = await listCachedYears({ workspace, repoSlug, email });
  const out = {};
  for (const year of years) {
    const data = await readCache({ workspace, repoSlug, year, email });
    if (data) {
      out[year] = { contributions: data.contributions, total: data.total };
    }
  }
  return out;
}

/**
 * Grava/atualiza o cache de uma busca.
 */
export async function writeCache(
  params,
  { contributions, total, headHash, hashDays }
) {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const payload = {
      workspace: params.workspace,
      repoSlug: params.repoSlug,
      year: params.year,
      contributions,
      total,
      headHash,
      hashDays, // { hash: "YYYY-MM-DD" } dos commits do autor, para dedup
      updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(fileFor(keyFor(params)), JSON.stringify(payload), "utf8");
  } catch (err) {
    // Falha de cache não deve derrubar a busca.
    console.warn(`Falha ao gravar cache: ${err.message}`);
  }
}
