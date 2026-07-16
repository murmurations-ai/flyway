/* ============================================================================
   flyway — brand runtime
   · theme toggle (persists to data-theme)
   · scroll reveals
   · hero murmuration: three sub-flocks; when birds of DIFFERENT flocks pass
     close, a gold "recognition thread" flashes between them — the protocol's
     recognition primitive, shown not stated.
   ========================================================================== */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- theme toggle (persists across pages) ---- */
  function initTheme() {
    var root = document.documentElement;
    try {
      var saved = localStorage.getItem("flyway-theme");
      if (saved === "dark" || saved === "light") root.setAttribute("data-theme", saved);
    } catch (e) { /* private mode: fall back to OS preference */ }
    var btn = document.querySelector("[data-theme-toggle]");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var cur = root.getAttribute("data-theme");
      if (!cur) cur = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      var next = cur === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("flyway-theme", next); } catch (e) { /* ignore */ }
      window.dispatchEvent(new Event("flyway:themechange"));
    });
  }

  /* ---- scroll reveal ---- */
  function initReveal() {
    var els = document.querySelectorAll(".reveal");
    if (reduce || !("IntersectionObserver" in window)) {
      els.forEach(function (e) { e.classList.add("in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -8% 0px" });
    els.forEach(function (e) { io.observe(e); });
  }

  /* ---- murmuration ---- */
  function palette() {
    var d = document.documentElement.getAttribute("data-theme");
    var dark = d ? d === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    return dark
      ? { bird: "rgba(215,225,245,", teal: "rgba(58,214,184,", violet: "rgba(168,124,255,", gold: "255,194,75", birdA: 0.62 }
      : { bird: "rgba(24,33,54,",   teal: "rgba(14,158,133,", violet: "rgba(114,72,214,", gold: "242,168,30", birdA: 0.55 };
  }

  function initFlock(canvas) {
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var W, H, DPR, birds = [], raf = null, pal = palette();
    var FLOCKS = 3;

    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = W * DPR; canvas.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    function seed() {
      var n = Math.max(90, Math.min(340, Math.round(W * H / 3400)));
      birds = [];
      for (var i = 0; i < n; i++) {
        var f = i % FLOCKS;
        birds.push({
          x: Math.random() * W, y: Math.random() * H,
          vx: (Math.random() - 0.5) * 1.4, vy: (Math.random() - 0.5) * 1.4,
          f: f,
          sheen: Math.random() < 0.08 ? (Math.random() < 0.5 ? "teal" : "violet") : null
        });
      }
    }
    function tri(b, a, s, col) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(b.x + Math.cos(a) * s, b.y + Math.sin(a) * s);
      ctx.lineTo(b.x + Math.cos(a + 2.5) * s * 0.8, b.y + Math.sin(a + 2.5) * s * 0.8);
      ctx.lineTo(b.x + Math.cos(a - 2.5) * s * 0.8, b.y + Math.sin(a - 2.5) * s * 0.8);
      ctx.closePath(); ctx.fill();
    }
    function frame(animate) {
      ctx.clearRect(0, 0, W, H);
      var per = 58, perc = per * per, thread = 34, threadc = thread * thread;
      // recognition threads: birds of different flocks passing close
      for (var i = 0; i < birds.length; i++) {
        for (var j = i + 1; j < birds.length; j++) {
          var b = birds[i], o = birds[j];
          if (b.f === o.f) continue;
          var dx = o.x - b.x, dy = o.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < threadc) {
            var a = (1 - d2 / threadc) * 0.5;
            ctx.strokeStyle = "rgba(" + pal.gold + "," + a.toFixed(3) + ")";
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(o.x, o.y); ctx.stroke();
          }
        }
      }
      for (var k = 0; k < birds.length; k++) {
        var b2 = birds[k];
        if (animate) {
          var cx = 0, cy = 0, ax = 0, ay = 0, sx = 0, sy = 0, cnt = 0;
          for (var m = 0; m < birds.length; m++) {
            if (m === k) continue;
            var oo = birds[m];
            if (oo.f !== b2.f) continue;                 // flock only with own sub-flock
            var ddx = oo.x - b2.x, ddy = oo.y - b2.y, dd = ddx * ddx + ddy * ddy;
            if (dd < perc && dd > 0) {
              cx += oo.x; cy += oo.y; ax += oo.vx; ay += oo.vy;
              if (dd < 320) { sx -= ddx; sy -= ddy; }
              cnt++;
            }
          }
          if (cnt > 0) {
            b2.vx += (cx / cnt - b2.x) * 0.0011 + (ax / cnt - b2.vx) * 0.035 + sx * 0.0018;
            b2.vy += (cy / cnt - b2.y) * 0.0011 + (ay / cnt - b2.vy) * 0.035 + sy * 0.0018;
          }
          b2.vx += 0.008;                                 // gentle drift along the corridor
          var sp = Math.hypot(b2.vx, b2.vy), mx = 1.7;
          if (sp > mx) { b2.vx = b2.vx / sp * mx; b2.vy = b2.vy / sp * mx; }
          b2.x += b2.vx; b2.y += b2.vy;
          if (b2.x > W + 10) b2.x = -10; if (b2.x < -10) b2.x = W + 10;
          if (b2.y > H + 10) b2.y = -10; if (b2.y < -10) b2.y = H + 10;
        }
        var ang = Math.atan2(b2.vy, b2.vx);
        var col = b2.sheen === "teal" ? pal.teal + "0.75)"
                : b2.sheen === "violet" ? pal.violet + "0.75)"
                : pal.bird + pal.birdA + ")";
        tri(b2, ang, 4.2, col);
      }
    }
    function loop() { frame(true); raf = requestAnimationFrame(loop); }
    function boot() {
      resize(); seed(); pal = palette();
      if (reduce) { frame(false); }          // one settled poster frame + threads
      else { if (raf) cancelAnimationFrame(raf); loop(); }
    }
    window.addEventListener("resize", function () { resize(); seed(); if (reduce) frame(false); });
    window.addEventListener("flyway:themechange", function () { pal = palette(); if (reduce) frame(false); });
    boot();
  }

  function init() {
    initTheme(); initReveal();
    document.querySelectorAll("[data-flock]").forEach(initFlock);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
