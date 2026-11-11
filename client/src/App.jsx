import React, { useRef, useState, useMemo, useEffect } from "react";
import { toPng } from "html-to-image";
import Heatmap from "./Heatmap.jsx";
import HeatmapSkeleton from "./HeatmapSkeleton.jsx";
import HeroBackground from "./HeroBackground.jsx";
import { streamContributions, fetchCachedYears, fetchAllContributions } from "./api.js";
import { buildHeatmapSvg, buildStandaloneHtml, downloadFile } from "./exporters.js";

// Frases que alternam durante o carregamento (dão vida à espera).
const LOADING_PHRASES = [
  "Lendo commits",
  "Sincronizando histórico",
  "Mapeando contribuições",
  "Entendendo seu codigo",
  "Vendo suas tasks",
  "Percorrendo o código",
  "Lendo seus PR's",
  "Julgando seus bugs",
  "Reconstruindo sua jornada",
  "Montando seu histórico",
  "Esse com certeza foi o claude",
  "Verificando a codebase",
  "Analisando o histórico do git",
];

const EMPTY = {
  url: "",
  email: "",
  apiToken: "",
};

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 2008; // Bitbucket foi lançado em 2008.

const MONTHS_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const MONTHS_ABBR = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

// "2026-03-14" -> "14/mar"
function formatShortDay(day) {
  if (!day) return "—";
  const d = parseInt(day.slice(8, 10), 10);
  const m = parseInt(day.slice(5, 7), 10) - 1;
  return `${d}/${MONTHS_ABBR[m] || "?"}`;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Calcula os KPIs a partir do mapa { "YYYY-MM-DD": contagem }.
function computeKpis(contributions) {
  const entries = Object.entries(contributions || {});
  const total = entries.reduce((a, [, n]) => a + n, 0);
  const activeDays = entries.filter(([, n]) => n > 0).length;

  // Melhor mês (soma por mês).
  const byMonth = {};
  for (const [day, n] of entries) {
    const m = parseInt(day.slice(5, 7), 10) - 1;
    byMonth[m] = (byMonth[m] || 0) + n;
  }
  let bestMonth = null;
  let bestMonthCount = 0;
  for (const [m, n] of Object.entries(byMonth)) {
    if (n > bestMonthCount) {
      bestMonthCount = n;
      bestMonth = MONTHS_PT[Number(m)];
    }
  }

  // Melhor dia (maior contagem em um único dia) e qual foi.
  let bestDayCount = 0;
  let bestDay = null;
  for (const [day, n] of entries) {
    if (n > bestDayCount) {
      bestDayCount = n;
      bestDay = day;
    }
  }

  // Média por dia ativo (commits nos dias em que houve commits).
  const avgPerActiveDay = activeDays ? total / activeDays : 0;

  return {
    total,
    activeDays,
    bestMonth: bestMonth ? capitalize(bestMonth) : "—",
    bestMonthCount,
    bestDayCount,
    bestDay, // "YYYY-MM-DD" do dia mais produtivo (ou null)
    avgPerActiveDay,
  };
}

export default function App() {
  const [form, setForm] = useState(EMPTY);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [status, setStatus] = useState(null); // erro geral (sem campo)
  const [fieldErrors, setFieldErrors] = useState({}); // { url, email, apiToken }
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(null); // { commitsSeen }
  const [showToken, setShowToken] = useState(false);
  const [collapsed, setCollapsed] = useState(false); // colapsa a conexão após gerar
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [cachedYears, setCachedYears] = useState([]);

  const cardRef = useRef(null);
  const abortRef = useRef(null);

  // Enquanto carrega, alterna a frase de loading a cada 2,2s.
  useEffect(() => {
    if (!loading) {
      setPhraseIndex(0);
      return;
    }
    const id = setInterval(() => {
      setPhraseIndex((i) => (i + 1) % LOADING_PHRASES.length);
    }, 3500);
    return () => clearInterval(id);
  }, [loading]);

  function update(field) {
    return (e) => {
      const value = e.target.value;
      setForm((f) => ({ ...f, [field]: value }));
      // Limpa o erro do campo assim que o usuário o edita.
      setFieldErrors((errs) =>
        errs[field] ? { ...errs, [field]: null } : errs
      );
    };
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Valida o formato do e-mail ao sair do campo (blur).
  function validateEmailOnBlur() {
    const email = form.email.trim();
    if (email && !EMAIL_RE.test(email)) {
      setFieldErrors((errs) => ({ ...errs, email: "E-mail inválido." }));
    }
  }

  function changeYear(delta) {
    setYear((y) => Math.min(CURRENT_YEAR, Math.max(MIN_YEAR, y + delta)));
  }

  // Validação local, por campo, antes de chamar o backend.
  function validateForm() {
    const errs = {};
    const url = form.url.trim();
    const email = form.email.trim();
    const token = form.apiToken.trim();

    if (!url) errs.url = "Informe a URL do repositório.";
    else if (!/bitbucket\.org\/[^/]+\/[^/]+/i.test(url) &&
             !/^[^/\s]+\/[^/\s]+$/.test(url))
      errs.url = "URL inválida. Ex.: bitbucket.org/workspace/repositorio";

    if (!email) errs.email = "Informe o e-mail.";
    else if (!EMAIL_RE.test(email)) errs.email = "E-mail inválido.";

    if (!token) errs.apiToken = "Informe o API Token.";

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleGenerate(forceRefresh = false, explicitYear = null) {
    // Navegação entre anos (clique num botão de ano) com um resultado já na
    // tela: não revalida o formulário nem reabre a conexão — só troca o ano.
    const isYearNav = explicitYear != null && !!result;

    if (!isYearNav && !validateForm()) return;

    // Cancela qualquer busca anterior em andamento.
    abortRef.current?.();

    setLoading(true);
    setStatus(null);
    setFieldErrors({});
    if (!isYearNav) {
      setResult(null);
      setCollapsed(false);
    }
    setProgress(null);

    const selectedYear = explicitYear ?? year;
    if (explicitYear != null) setYear(explicitYear);
    let meta = null;

    abortRef.current = streamContributions(form, selectedYear, {
      onMeta: (m) => {
        meta = m;
      },
      onProgress: (p) => {
        // O ano exibido segue o que o backend está preenchendo agora
        // (na viagem multi-ano, isto "troca a página" até o ano alvo).
        const shownYear = p.year ?? selectedYear;
        setResult({
          workspace: meta?.workspace,
          repoSlug: meta?.repoSlug,
          year: shownYear,
          totalContributions: p.total,
          contributions: p.contributions,
        });
        setProgress({ commitsSeen: p.commitsSeen });
        // Assim que há dados (skeleton some), colapsa a conexão.
        setCollapsed(true);
      },
      onDone: () => {
        setLoading(false);
        setProgress(null);
        setCollapsed(true);
        // Atualiza os botões de ano com o que está em cache agora.
        fetchCachedYears(form).then(setCachedYears);
      },
      onError: (message, field) => {
        setLoading(false);
        setProgress(null);
        if (field) {
          // Erro atribuído a um campo específico: destaca o campo.
          setFieldErrors((errs) => ({ ...errs, [field]: message }));
        } else {
          setStatus({ type: "error", message });
        }
      },
    }, forceRefresh);
  }

  async function handleExport() {
    if (!cardRef.current) return;
    try {
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 2,
        backgroundColor: "#0b0f17",
      });
      const link = document.createElement("a");
      const nome = result?.repoSlug || result?.workspace || "bitbucket";
      link.download = `contribuicoes-${nome}-${year}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      setStatus({ type: "error", message: `Falha ao exportar: ${err.message}` });
    }
  }

  // Exporta o SVG do ano exibido.
  function handleExportSvg() {
    if (!result) return;
    try {
      const nome = result.repoSlug || result.workspace || "bitbucket";
      const title = `${
        result.repoSlug ? `${result.workspace}/${result.repoSlug}` : result.workspace
      } · ${result.year}`;
      const svg = buildHeatmapSvg(result.contributions, result.year, { title });
      downloadFile(`contribuicoes-${nome}-${result.year}.svg`, svg, "image/svg+xml");
    } catch (err) {
      setStatus({ type: "error", message: `Falha ao exportar SVG: ${err.message}` });
    }
  }

  // Exporta um HTML interativo com todos os anos cacheados.
  async function handleExportHtml() {
    try {
      const data = await fetchAllContributions(form);
      const yearsData = data.years || {};
      if (!Object.keys(yearsData).length) {
        setStatus({ type: "error", message: "Nenhum ano gerado para exportar." });
        return;
      }
      const repoLabel = data.repoSlug
        ? `${data.workspace}/${data.repoSlug}`
        : data.workspace;
      const html = buildStandaloneHtml({ repoLabel, yearsData });
      const nome = data.repoSlug || data.workspace || "bitbucket";
      downloadFile(`contribuicoes-${nome}.html`, html, "text/html");
    } catch (err) {
      setStatus({ type: "error", message: `Falha ao exportar HTML: ${err.message}` });
    }
  }

  // Habilita o botão só com todos os campos preenchidos e sem erros ativos.
  const allFilled =
    form.url.trim() && form.email.trim() && form.apiToken.trim();
  const hasFieldError = Object.values(fieldErrors).some(Boolean);
  const canGenerate = !loading && allFilled && !hasFieldError;

  // KPIs derivados do resultado (recalculados só quando as contribuições mudam).
  const kpis = useMemo(
    () => (result ? computeKpis(result.contributions) : null),
    [result]
  );

  return (
    <div className="app">
      <HeroBackground />

      <header className="app-header">
        <div className="brand">
          <svg
            className="brand-icon"
            viewBox="0 0 62 62"
            width="22"
            height="22"
            aria-hidden="true"
          >
            <path
              fill="#2684ff"
              d="M3 7.5a2 2 0 012-2.3h52a2 2 0 012 2.3l-8 48.8a2.6 2.6 0 01-2.6 2.2H13.4a2.6 2.6 0 01-2.6-2.2L3 7.5z"
            />
            <path
              fill="#0052cc"
              d="M37.9 23.8H24.3l2.3 13.5h8.9z"
            />
          </svg>
          Bitbucket Contributions Heatmap
        </div>
        <p className="subtitle">
           Gere e exporte seu gráfico de contribuições anual
        </p>
      </header>

      <section className="panel glass form">
        {collapsed && result && (
          <div className="collapsed-bar">
            {loading && progress ? (
              <span className="progress-info collapsed-progress">
                <span className="progress-spinner" aria-hidden="true" />
                ({progress.commitsSeen.toLocaleString("pt-BR")}){" "}
                <span key={phraseIndex} className="phrase-fade">
                  {LOADING_PHRASES[phraseIndex]}
                </span>
              </span>
            ) : (
              <span />
            )}
            <div className="collapsed-actions">
              {!loading && result && (
                <div className="export-group">
                  <span className="tip">
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={handleExport}
                      aria-label="Exportar PNG"
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                        <path
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"
                        />
                      </svg>
                      <span className="icon-text">PNG</span>
                    </button>
                    <span className="tip-bubble">
                      Imagem PNG do ano exibido ({result.year}).
                    </span>
                  </span>

                  <span className="tip">
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={handleExportSvg}
                      aria-label="Exportar SVG"
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                        <path
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M4 16l4-8 4 8m-7-3h6M15 8v8m5-8v8h-3"
                        />
                      </svg>
                      <span className="icon-text">SVG</span>
                    </button>
                    <span className="tip-bubble">
                      Vetor SVG do ano exibido ({result.year}) — ideal para o
                      README do GitHub.
                    </span>
                  </span>

                  <span className="tip">
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={handleExportHtml}
                      aria-label="Exportar HTML"
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                        <path
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M8 9l-3 3 3 3m8-6l3 3-3 3"
                        />
                      </svg>
                      <span className="icon-text">HTML</span>
                    </button>
                    <span className="tip-bubble">
                      Página HTML interativa com todos os anos gerados e troca
                      entre eles.
                    </span>
                  </span>
                </div>
              )}
              <button
                type="button"
                className="icon-btn"
                onClick={() => handleGenerate(true)}
                disabled={loading}
                aria-label="Atualizar"
                title="Atualizar"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 12a9 9 0 11-2.64-6.36M21 3v4h-4"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setCollapsed(false)}
                disabled={loading}
                aria-label="Nova busca"
                title="Nova busca"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10.3 4.3l-.5 2a7.6 7.6 0 00-1.7 1l-2-.8-1.7 3 1.6 1.3a7.6 7.6 0 000 2l-1.6 1.3 1.7 3 2-.8c.5.4 1.1.7 1.7 1l.5 2h3.4l.5-2c.6-.3 1.2-.6 1.7-1l2 .8 1.7-3-1.6-1.3a7.6 7.6 0 000-2l1.6-1.3-1.7-3-2 .8a7.6 7.6 0 00-1.7-1l-.5-2z"
                  />
                  <circle
                    cx="12"
                    cy="12"
                    r="2.6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </svg>
              </button>
            </div>
          </div>
        )}

        {!collapsed && (
          <>
        <div className="form-topbar">
          {result && (
            <button
              type="button"
              className="btn-link"
              onClick={() => setCollapsed(true)}
            >
              ✕
            </button>
          )}
          <span className="tip help-tip">
            <span className="help-icon" tabIndex={0} aria-label="Por que pode demorar?">
              ?
            </span>
            <span className="tip-bubble">
              A API do Bitbucket não permite filtrar commits por data nem por
              usuário no servidor. Por isso, precisamos percorrer o histórico do
              repositório para montar o gráfico — em repositórios grandes, a
              primeira busca de um ano pode demorar. Depois fica em cache e abre
              na hora.
            </span>
          </span>
        </div>
        <label className="field">
          <span className="field-label">
            API Token
            <span className="tooltip" tabIndex={0} aria-label="Sobre suas credenciais">
              <span className="tooltip-icon">🔒</span>
              <span className="tooltip-bubble">
                Suas credenciais não são salvas — ficam só nesta sessão do
                navegador e são usadas apenas como proxy para o Bitbucket.
              </span>
            </span>
          </span>
          <span className="field-hint">
            Em{" "}
            <a
              href="https://id.atlassian.com/manage-profile/security/api-tokens"
              target="_blank"
              rel="noreferrer"
            >
              id.atlassian.com → API tokens
            </a>
            , use <strong>Create API token with scopes</strong>, escolha o app
            Bitbucket e marque:
            <span className="scope-list">
              <span className="scope-item">
                <strong>Read → Repositories</strong>{" "}
                <code>read:repository:bitbucket</code>
              </span>
              <span className="scope-item">
                <strong>Read → User</strong> <code>read:user:bitbucket</code>
              </span>
            </span>
          </span>
          <div className="input-with-icon">
            <input
              type={showToken ? "text" : "password"}
              className={fieldErrors.apiToken ? "has-error" : ""}
              placeholder="cole o token aqui"
              value={form.apiToken}
              onChange={update("apiToken")}
              autoComplete="off"
            />
            <button
              type="button"
              className="icon-toggle"
              onClick={() => setShowToken((v) => !v)}
              aria-label={showToken ? "Ocultar token" : "Mostrar token"}
              title={showToken ? "Ocultar token" : "Mostrar token"}
            >
              {showToken ? (
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.4 5.1A9.5 9.5 0 0112 5c5 0 9 4.5 9 7 0 1.2-1 2.9-2.6 4.3M6.1 6.1C3.9 7.5 3 9.6 3 12c0 .9 2 4.5 6.5 6.1"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"
                  />
                  <circle
                    cx="12"
                    cy="12"
                    r="3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </svg>
              )}
            </button>
          </div>
          {fieldErrors.apiToken && (
            <span className="field-error">{fieldErrors.apiToken}</span>
          )}
        </label>

        <div className="field-row">
          <label className="field">
            <span className="field-label">URL do repositório</span>
            <input
              type="text"
              className={fieldErrors.url ? "has-error" : ""}
              placeholder="https://bitbucket.org/workspace/repositorio"
              value={form.url}
              onChange={update("url")}
              autoComplete="off"
            />
            {fieldErrors.url && (
              <span className="field-error">{fieldErrors.url}</span>
            )}
          </label>

          <label className="field">
            <span className="field-label">E-mail da conta Atlassian</span>
            <input
              type="email"
              className={fieldErrors.email ? "has-error" : ""}
              placeholder="voce@exemplo.com"
              value={form.email}
              onChange={update("email")}
              onBlur={validateEmailOnBlur}
              autoComplete="off"
            />
            {fieldErrors.email && (
              <span className="field-error">{fieldErrors.email}</span>
            )}
          </label>
        </div>

        <div className="row-bottom">
          <div className="year-stepper">
            <span className="field-label">Ano</span>
            <div className="stepper">
              <button
                type="button"
                className="stepper-btn"
                onClick={() => changeYear(-1)}
                disabled={year <= MIN_YEAR}
                aria-label="Ano anterior"
              >
                −
              </button>
              <span className="stepper-value">{year}</span>
              <button
                type="button"
                className="stepper-btn"
                onClick={() => changeYear(1)}
                disabled={year >= CURRENT_YEAR}
                aria-label="Próximo ano"
              >
                +
              </button>
            </div>
          </div>

          <button
            onClick={() => handleGenerate(false)}
            disabled={!canGenerate}
            className={`btn-primary btn-generate${loading ? " is-loading" : ""}`}
          >
            {loading ? (
              <>
                <span className="btn-spinner" aria-hidden="true" />
                Gerando…
              </>
            ) : (
              <>
                <svg
                  className="btn-icon"
                  viewBox="0 0 24 24"
                  width="17"
                  height="17"
                  aria-hidden="true"
                >
                  <path
                    fill="currentColor"
                    d="M13 2L4.5 13.5H11l-1 8.5L19.5 10H13z"
                  />
                </svg>
                Gerar Heatmap
              </>
            )}
          </button>
        </div>

        {status && status.type === "error" && (
          <div className="status status-error">{status.message}</div>
        )}
          </>
        )}

        {/* Antes da primeira página: skeleton */}
        {loading && !result && (
          <div className="graph-area">
            <div className="result-meta skeleton-meta">
              Conectando ao Bitbucket…
            </div>
            <div className="export-card is-loading">
              <div className="export-title skeleton-title" />
              <HeatmapSkeleton />
            </div>
          </div>
        )}

        {/* Com dados (parciais durante o loading, ou finais) */}
        {result && (
          <div className="graph-area">
            <div className="graph-layout">
            <div
              ref={cardRef}
              className={`export-card${loading ? " is-loading" : ""}`}
            >
              <div className="export-head">
                <span className="export-title-text">
                  {result.repoSlug
                    ? `${result.workspace}/${result.repoSlug}`
                    : result.workspace}{" "}
                  · {result.year}
                </span>
              </div>

              {kpis && (
                <div className="kpis">
                  <div className="kpi">
                    <span className="kpi-value">
                      {kpis.total.toLocaleString("pt-BR")}
                    </span>
                    <span className="kpi-label">Contribuições</span>
                  </div>
                  <div className="kpi">
                    <span className="kpi-value">
                      {kpis.avgPerActiveDay.toLocaleString("pt-BR", {
                        maximumFractionDigits: 1,
                      })}
                    </span>
                    <span className="kpi-label">Média / dia ativo</span>
                  </div>
                  <div className="kpi">
                    <span className="kpi-value">{kpis.bestMonth}</span>
                    <span className="kpi-label">
                      Melhor mês
                      {kpis.bestMonthCount ? ` · ${kpis.bestMonthCount}` : ""}
                    </span>
                  </div>
                  <div className="kpi">
                    <span className="kpi-value">
                      {kpis.bestDay ? formatShortDay(kpis.bestDay) : "—"}
                    </span>
                    <span className="kpi-label">
                      Melhor dia
                      {kpis.bestDayCount ? ` · ${kpis.bestDayCount}` : ""}
                    </span>
                  </div>
                  <div className="kpi">
                    <span className="kpi-value">{kpis.activeDays}</span>
                    <span className="kpi-label">Dias ativos</span>
                  </div>
                </div>
              )}

              <Heatmap contributions={result.contributions} year={result.year} />
            </div>

            {cachedYears.length > 1 && (
              <div className="year-nav" aria-label="Anos gerados">
                {cachedYears.map((y) => (
                  <button
                    key={y}
                    type="button"
                    className={`year-btn${y === result.year ? " active" : ""}`}
                    onClick={() => handleGenerate(false, y)}
                    disabled={loading}
                  >
                    {y}
                  </button>
                ))}
              </div>
            )}
            </div>
          </div>
        )}
      </section>

      <footer className="app-footer">
        <a
          href="https://github.com/J0a00liveira"
          target="_blank"
          rel="noreferrer"
          className="gh-link"
        >
          <svg
            className="gh-icon"
            viewBox="0 0 16 16"
            width="18"
            height="18"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
                 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01
                 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95
                 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27
                 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82
                 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01
                 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
            />
          </svg>
          J0a00liveira
        </a>
      </footer>
    </div>
  );
}
