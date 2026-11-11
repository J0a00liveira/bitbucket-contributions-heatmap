import React, { useEffect, useRef } from "react";

// Fundo animado: uma grade de "bloquinhos" (estilo heatmap) que acendem em azul
// de forma sutil conforme o cursor passa por perto. Desenhado em <canvas> para
// manter a performance mesmo com muitas células.

const CELL = 16; // tamanho do bloquinho
const GAP = 6; // espaço entre eles
const STEP = CELL + GAP;
const RADIUS = 130; // raio de influência do cursor (px)
const BASE_ALPHA = 0.04; // brilho de repouso (bem sutil)
const MAX_ALPHA = 0.5; // brilho máximo sob o cursor (não muito claro)

export default function HeroBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    let width = 0;
    let height = 0;
    let cols = 0;
    let rows = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Alvo do cursor e posição suavizada (para um "acender" fluido).
    const mouse = { x: -9999, y: -9999 };
    const smooth = { x: -9999, y: -9999 };
    let raf = 0;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    function resize() {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(width / STEP) + 1;
      rows = Math.ceil(height / STEP) + 1;
    }

    function draw() {
      // Suaviza o movimento do brilho em direção ao cursor. Fator mais alto =
      // mais "grudado" no cursor (menos delay). 1 = sem suavização.
      const FOLLOW = 1;
      smooth.x += (mouse.x - smooth.x) * FOLLOW;
      smooth.y += (mouse.y - smooth.y) * FOLLOW;

      ctx.clearRect(0, 0, width, height);

      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const x = c * STEP;
          const y = r * STEP;
          const cx = x + CELL / 2;
          const cy = y + CELL / 2;

          const dx = cx - smooth.x;
          const dy = cy - smooth.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          let alpha = BASE_ALPHA;
          let color = "56, 139, 255"; // azul Bitbucket
          if (dist < RADIUS) {
            const t = 1 - dist / RADIUS; // 0..1 (1 = bem perto do cursor)
            alpha = BASE_ALPHA + (MAX_ALPHA - BASE_ALPHA) * t * t;

            // Bloquinho central (sob o cursor) fica mais claro/brilhante:
            // clareia a cor em direção ao branco e reforça a opacidade.
            if (dist < STEP * 1.5) {
              const glow = 1 - dist / (STEP * 1.5); // 0..1
              const mix = Math.round(170 * glow); // aproxima do branco
              color = `${56 + mix}, ${139 + Math.round(80 * glow)}, 255`;
              alpha = Math.min(1, alpha + 0.4 * glow);
            }
          }

          ctx.fillStyle = `rgba(${color}, ${alpha})`;
          // Glow suave só no bloquinho bem central (sob o cursor).
          if (dist < STEP) {
            ctx.shadowColor = "rgba(133, 184, 255, 0.9)";
            ctx.shadowBlur = 14;
          } else {
            ctx.shadowBlur = 0;
          }
          roundRect(ctx, x, y, CELL, CELL, 3);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      if (!reduceMotion) raf = requestAnimationFrame(draw);
    }

    function roundRect(c, x, y, w, h, rad) {
      c.beginPath();
      c.moveTo(x + rad, y);
      c.arcTo(x + w, y, x + w, y + h, rad);
      c.arcTo(x + w, y + h, x, y + h, rad);
      c.arcTo(x, y + h, x, y, rad);
      c.arcTo(x, y, x + w, y, rad);
      c.closePath();
    }

    function onMove(e) {
      // Só acende os bloquinhos quando o cursor está sobre o fundo (hero).
      // Se estiver sobre um painel de vidro, trata como "fora" para não
      // iluminar por baixo do conteúdo.
      const overPanel = e.target instanceof Element && e.target.closest(".glass");
      if (overPanel) {
        mouse.x = -9999;
        mouse.y = -9999;
      } else {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
      }
    }

    function onLeave() {
      mouse.x = -9999;
      mouse.y = -9999;
    }

    resize();
    draw(); // primeiro frame (garante o estado de repouso mesmo com reduce-motion)
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div className="hero-bg" aria-hidden="true">
      <canvas ref={canvasRef} className="hero-canvas" />
    </div>
  );
}
