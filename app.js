/* ============================================================
   情侣小站 · 全部逻辑
   想改文字 / 视频，请编辑 config.js（这个文件一般不用动）
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- 兜底配置 ---------------- */
  var DEFAULTS = {
    cover: { intro: '写给你的一封信', hint: '轻触这里，打开信封', miniNote: '只给你看' },
    stages: [{ name: '启封', open: ['你好呀。'], video: '', caption: '', close: [] }],
    ending: { sign: '永远站在你这边的人', replay: '轻触重新看一遍' },
    video: { mode: 'inline', muted: true, loop: false, rate: 0.92, closePause: 1400 },
    typing: { speed: 15, titleSpeed: 11 },
    mascots: { enabled: true, cat: true, fish: true, jar: true, seal: 'fish' },
    fx: { particles: true, sealSound: true, heartCursor: true }
  };

  function merge(base, over) {
    var out = {}, k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    if (over && typeof over === 'object') {
      for (k in over) {
        if (!Object.prototype.hasOwnProperty.call(over, k)) continue;
        var b = out[k], o = over[k];
        if (Array.isArray(b)) out[k] = Array.isArray(o) ? o : b;
        else if (b && typeof b === 'object' && o && typeof o === 'object') out[k] = merge(b, o);
        else if (o !== undefined && o !== null) out[k] = o;
      }
    }
    return out;
  }

  var CFG = merge(DEFAULTS, window.LOVE_CONFIG);
  var REDUCED = false;
  try { REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch (e) { REDUCED = false; }

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---------------- DOM ---------------- */
  var app = $('app');
  var envWrap = $('envWrap');
  var envSeal = $('envSeal');
  var envHint = $('envHint');
  var paper = $('paper');
  var paperScroll = $('paperScroll');
  var veil = $('veil');
  var btnSound = $('sound');
  var btnClose = $('paperClose');
  var btnSkip = $('paperSkip');
  var stageNo = $('stageNo');
  var stageTotal = $('stageTotal');
  var stageName = $('stageName');
  var elTitle = $('letterTitle');
  var elBody = $('letterBody');
  var elBody2 = $('letterBody2');
  var elSign = $('letterSign');
  var elEnd = $('letterEnd');
  var bigHeart = $('bigHeart');
  var cine = $('cine');
  var cineVideo = $('cineVideo');
  var cinePlay = $('cinePlay');
  var cineSkip = $('cineSkip');

  /* ---------------- 流程状态 ---------------- */
  var TOKEN = {};        // 每次开信封换一个，旧流程的回调会自动作废
  var running = false;   // 信是否正在播放
  var step = null;       // 当前这一步：{ skip: fn }，没有就代表这一步不能跳过
  var typing = null;     // 当前打字任务
  var typingEls = [];    // 正在打字的元素（标题和正文可能同时在打）
  var busy = false;      // 防止连点跳过重复触发

  /* 延时：token 变了就自动作废 */
  function later(ms, tk) {
    return new Promise(function (res) {
      setTimeout(function () {
        if (tk !== undefined && tk !== TOKEN) { res(false); return; }
        res(true);
      }, REDUCED ? Math.min(ms, 60) : ms);
    });
  }
  /* 到下一个自然节点再继续（给 token 变的旧流程踩刹车） */
  function tick(tk) {
    return new Promise(function (res) {
      setTimeout(function () {
        if (tk !== undefined && tk !== TOKEN) { res(false); return; }
        res(true);
      }, REDUCED ? 16 : 0);
    });
  }

  /* ---------------- 初始文案 ---------------- */
  $('introLine').textContent = CFG.cover.intro;
  envHint.textContent = CFG.cover.hint;
  $('miniNote').textContent = CFG.cover.miniNote;
  document.querySelector('.tap-hint-word').textContent = CFG.ending.replay;

  var stages = (CFG.stages || []).filter(function (s) {
    return s && ((s.open && s.open.length) || (s.video || '').trim() || (s.close && s.close.length));
  });
  if (!stages.length) stages = DEFAULTS.stages;
  stageTotal.textContent = String(stages.length).padStart(2, '0');

  if (!CFG.fx.heartCursor) {
    var st = document.createElement('style');
    st.textContent = '.stage button,.stage .big-heart,.stage .env{cursor:pointer;}';
    document.head.appendChild(st);
  }

  /* ---------------- 信封大小自适应 ---------------- */
  (function fitEnvelope() {
    function fit() {
      var vw = Math.min(window.innerWidth || 375, 460);
      var vh = window.innerHeight || 667;
      var w = clamp(vw * 0.74, 190, 300);
      var h = w * 188 / 278;
      var maxH = vh * 0.34;
      if (h > maxH) { h = maxH; w = h * 278 / 188; }
      envWrap.style.setProperty('--w', w.toFixed(1) + 'px');
      envWrap.style.setProperty('--h', h.toFixed(1) + 'px');
    }
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', function () { setTimeout(fit, 240); });
  })();

  /* ---------------- 背景爱心粒子 ---------------- */
  function HeartField(canvas) {
    var ctx = canvas.getContext('2d');
    var dpr = 1, W = 0, H = 0, items = [], bursts = [], raf = 0, dying = false, U = 4;

    function heartPath(c, s) {
      c.beginPath();
      c.moveTo(0, 0.34 * s);
      c.bezierCurveTo(-0.62 * s, -0.14 * s, -0.42 * s, -0.94 * s, 0, -0.42 * s);
      c.bezierCurveTo(0.42 * s, -0.94 * s, 0.62 * s, -0.14 * s, 0, 0.34 * s);
      c.closePath();
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      W = canvas.clientWidth || window.innerWidth;
      H = canvas.clientHeight || window.innerHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      U = clamp(Math.min(W, H) / 100, 2.6, 6);
    }

    /* ---- 各种小图形 ---- */
    function pawPath(c, s) {
      c.beginPath();
      c.ellipse(0, 0.16 * s, 0.40 * s, 0.31 * s, 0, 0, Math.PI * 2);
      for (var k = 0; k < 4; k++) {
        var a = -Math.PI * 0.78 + k * 0.42;
        c.moveTo(Math.cos(a) * 0.44 * s, Math.sin(a) * 0.44 * s);
        c.ellipse(Math.cos(a) * 0.44 * s, Math.sin(a) * 0.44 * s, 0.15 * s, 0.18 * s, 0, 0, Math.PI * 2);
      }
      c.closePath();
    }
    function starPath(c, s) {
      c.beginPath();
      c.moveTo(0, -s);
      c.bezierCurveTo(0.14 * s, -0.2 * s, 0.2 * s, -0.14 * s, s, 0);
      c.bezierCurveTo(0.2 * s, 0.14 * s, 0.14 * s, 0.2 * s, 0, s);
      c.bezierCurveTo(-0.14 * s, 0.2 * s, -0.2 * s, 0.14 * s, -s, 0);
      c.bezierCurveTo(-0.2 * s, -0.14 * s, -0.14 * s, -0.2 * s, 0, -s);
      c.closePath();
    }

    var KIND = {
      bubble: { r: 5.5, a: 0.34, col: 'rgba(255,214,224,.9)' },
      paw: { r: 6, a: 0.20, col: 'rgba(255,175,195,.85)' },
      spark: { r: 5, a: 0.55 },
      heart: { r: 6.5, a: 0.22 }
    };

    function spawn(kind) {
      kind = kind || 'heart';
      var k = KIND[kind] || KIND.heart;
      items.push({
        kind: kind,
        x: Math.random() * W,
        y: H + 20 + Math.random() * 40,
        vy: -(6 + Math.random() * 14) * (U / 4),
        vx: (Math.random() - 0.5) * 6 * (U / 4),
        s: k.r * (U / 4),
        rot: (Math.random() - 0.5) * 0.7,
        vr: (Math.random() - 0.5) * 0.35,
        a: k.a,
        col: k.col,
        hue: 338 + Math.random() * 24,
        life: 1,
        ph: Math.random() * Math.PI * 2
      });
    }

    /* 从屏幕上方落下来的爱心雨 */
    function rainHearts(n) {
      if (REDUCED) return;
      for (var i = 0; i < n; i++) {
        bursts.push({
          kind: Math.random() < 0.34 ? 'bubble' : 'heart',
          x: Math.random() * W,
          y: -30 - Math.random() * H * 0.5,
          vx: (Math.random() - 0.5) * 16,
          vy: 26 + Math.random() * 40,
          s: (4 + Math.random() * 8) * (U / 4),
          rot: Math.random() * 6, vr: (Math.random() - 0.5) * 1.2,
          life: 1, decay: 0.19,
          hue: 336 + Math.random() * 30
        });
      }
      start();
    }

    /* 从屏幕下方冒上来的一簇（彩蛋/结尾用） */
    function confetti(n) {
      if (REDUCED) return;
      var kinds = ['heart', 'bubble', 'spark', 'paw'];
      for (var i = 0; i < n; i++) {
        var ang = -Math.PI * 0.5 + (Math.random() - 0.5) * 2.1;
        var sp = (2.2 + Math.random() * 4.4) * U * 0.8;
        bursts.push({
          kind: kinds[(Math.random() * kinds.length) | 0],
          x: W * 0.5 + (Math.random() - 0.5) * W * 0.5,
          y: H * 0.98 + Math.random() * 30,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          s: (4 + Math.random() * 8) * (U / 4),
          rot: Math.random() * 6, vr: (Math.random() - 0.5) * 3,
          life: 1, decay: 0.40,
          hue: 330 + Math.random() * 34
        });
      }
      start();
    }

    /* 从某一点炸开（点小猫/小鱼时用） */
    function burstAt(px, py, kind, n) {
      if (REDUCED) return;
      kind = kind || 'heart';
      for (var i = 0; i < (n || 10); i++) {
        var ang = Math.random() * Math.PI * 2;
        var sp = (1.6 + Math.random() * 3.4) * U * 0.8;
        bursts.push({
          kind: kind,
          x: px, y: py,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp - 1.4 * U,
          s: (4 + Math.random() * 7) * (U / 4),
          rot: Math.random() * 6, vr: (Math.random() - 0.5) * 2.4,
          life: 1, decay: 0.42,
          hue: 332 + Math.random() * 28
        });
      }
      start();
    }

    function burst(n) { burstAt(W / 2, H * 0.54, 'heart', n); }

    function drawOne(p, rising) {
      var k = KIND[p.kind] || KIND.heart;
      ctx.save();
      ctx.globalAlpha = clamp(p.life, 0, 1) * (rising ? (p.a || k.a) : 0.88);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.col || ('hsl(' + p.hue + ',92%,66%)');
      var s = p.s * (rising ? 1 : (0.6 + p.life * 0.6));
      if (p.kind === 'bubble') {
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.62, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha *= 0.75;
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        ctx.beginPath();
        ctx.arc(-s * 0.2, -s * 0.22, s * 0.16, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'paw') {
        pawPath(ctx, s);
        ctx.fill();
      } else if (p.kind === 'spark') {
        ctx.fillStyle = 'hsl(' + (p.hue || 340) + ',96%,78%)';
        starPath(ctx, s);
        ctx.fill();
      } else {
        heartPath(ctx, s);
        ctx.fill();
      }
      ctx.restore();
    }

    function draw(list, dt) {
      for (var i = list.length - 1; i >= 0; i--) {
        var p = list[i];
        if (list === bursts) {
          p.life -= dt * (p.decay || 0.40);
          p.vy += 22 * dt;
          p.vx *= 0.99;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
          if (p.life <= 0 || p.y > H + 90) { list.splice(i, 1); continue; }
          drawOne(p, false);
        } else {
          p.ph += dt * 1.4;
          p.y += p.vy * dt;
          p.x += (p.vx + Math.sin(p.ph) * 5) * dt;
          p.rot += p.vr * dt;
          if (p.kind === 'bubble') p.x += Math.sin(p.ph * 2.4) * 12 * dt;
          if (p.y < -60 || p.x < -70 || p.x > W + 70) { list.splice(i, 1); continue; }
          drawOne(p, true);
        }
      }
    }

    var last = 0, acc = 0;
    function frame(t) {
      raf = requestAnimationFrame(frame);
      if (!last) last = t;
      var dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      ctx.clearRect(0, 0, W, H);
      if (CFG.fx.particles && !REDUCED) {
        acc += dt;
        if (acc > 0.34 && items.length < 46) {
          acc = 0;
          var r = Math.random();
          /* 水里的小鱼会吐泡，小猫偶尔留下爪印 */
          if (r < 0.22 && CFG.mascots.fish) spawn('bubble');
          else if (r < 0.30 && CFG.mascots.cat) spawn('paw');
          else if (r < 0.36) spawn('spark');
          else spawn('heart');
        }
      }
      draw(items, dt);
      draw(bursts, dt);
      if (dying && !items.length && !bursts.length) stop();
    }

    function start() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
    function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } ctx.clearRect(0, 0, W, H); }

    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else start();
    });
    if (CFG.fx.particles && !REDUCED) { for (var i = 0; i < 16; i++) spawn(); start(); }

    return { start: start, stop: stop, burst: burst, burstAt: burstAt, confetti: confetti, rainHearts: rainHearts };
  }

  var fx = HeartField($('fx'));

  /* ============================================================
     卡通形象：小猫 / 小鱼 / 心形罐子
     全部是手绘 SVG，靠 CSS 做眨眼、摆尾、悬浮
     ============================================================ */
  var DEFS_SVG = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
    '<linearGradient id="gCat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc98b"/><stop offset=".58" stop-color="#f7ab5f"/><stop offset="1" stop-color="#e2914a"/></linearGradient>' +
    '<linearGradient id="gFish" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb65e"/><stop offset=".55" stop-color="#ff8f3f"/><stop offset="1" stop-color="#ef6f2c"/></linearGradient>' +
    '<linearGradient id="gJar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe8ef"/><stop offset=".5" stop-color="#ffc9d9"/><stop offset="1" stop-color="#f6a8c0"/></linearGradient>' +
    '<linearGradient id="gJarTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9db6"/><stop offset="1" stop-color="#e2728f"/></linearGradient>' +
    '</defs></svg>';

  var CAT_SVG =
    '<svg viewBox="0 0 100 90" role="img" aria-label="小猫">' +
      '<g class="mst-tail" fill="none" stroke="#e2914a" stroke-width="9" stroke-linecap="round">' +
        '<path d="M22 70C9 68 3 56 6 43c2-9 9-13 15-11"/>' +
      '</g>' +
      '<ellipse cx="50" cy="68" rx="27" ry="21" fill="url(#gCat)"/>' +
      '<ellipse cx="36" cy="86" rx="9.5" ry="6" fill="#ffeed3"/>' +
      '<ellipse cx="64" cy="86" rx="9.5" ry="6" fill="#ffeed3"/>' +
      '<g class="mst-ear">' +
        '<path d="M27 40 21.5 15 42.5 27Z" fill="#f7ab5f"/>' +
        '<path d="M29.5 36 26.5 22 37 29Z" fill="#ffbccb"/>' +
      '</g>' +
      '<g class="mst-ear" style="animation-delay:.7s">' +
        '<path d="M73 40 78.5 15 57.5 27Z" fill="#f7ab5f"/>' +
        '<path d="M70.5 36 73.5 22 63 29Z" fill="#ffbccb"/>' +
      '</g>' +
      '<ellipse cx="50" cy="47" rx="26" ry="24" fill="url(#gCat)"/>' +
      '<ellipse cx="29" cy="56" rx="6" ry="4.2" fill="#ff9db1" opacity=".45"/>' +
      '<ellipse cx="71" cy="56" rx="6" ry="4.2" fill="#ff9db1" opacity=".45"/>' +
      '<ellipse class="mst-eye" cx="39.5" cy="45" rx="4.6" ry="5.4" fill="#4a2b16"/>' +
      '<ellipse class="mst-eye mst-eye-b" cx="60.5" cy="45" rx="4.6" ry="5.4" fill="#4a2b16"/>' +
      '<ellipse cx="41" cy="43.4" rx="1.5" ry="1.7" fill="#fff"/>' +
      '<ellipse cx="62" cy="43.4" rx="1.5" ry="1.7" fill="#fff"/>' +
      '<path d="M50 51.5 46.6 55.2h6.8z" fill="#e2728f"/>' +
      '<path d="M45.6 57.6c1.8 3.2 7 3.2 8.8 0" fill="none" stroke="#7a4a22" stroke-width="1.9" stroke-linecap="round"/>' +
      '<g fill="none" stroke="#fff1dd" stroke-width="1.5" stroke-linecap="round" opacity=".92">' +
        '<path d="M21 46 8 40M21 52 7 52M21 58 9 64"/>' +
        '<path d="M79 46 92 40M79 52 93 52M79 58 91 64"/>' +
      '</g>' +
    '</svg>';

  var FISH_SVG =
    '<svg viewBox="0 0 112 76" role="img" aria-label="小鱼">' +
      '<g class="mst-tail" fill="#f2703f">' +
        '<path d="M76 38C86 24 96 16 110 10 104 24 102 30 102 38s2 14 8 28c-14-6-24-14-34-28Z"/>' +
      '</g>' +
      '<g class="mst-fin" fill="#ffa04f">' +
        '<path d="M54 22C60 9 70 3 82 1 78 12 74 18 72 24Z"/>' +
        '<path d="M38 58c-2 8-8 13-16 16 2-8 6-13 9-16Z" opacity=".9"/>' +
      '</g>' +
      '<ellipse cx="42" cy="38" rx="34" ry="26" fill="url(#gFish)"/>' +
      '<path d="M24 22c10-9 30-13 44-8-16 1-32 4-44 8Z" fill="#ffd6ae" opacity=".55"/>' +
      '<path d="M1 40C8 42 16 46 20 56c-6 2-13 1-19-3Z" fill="#ffb066" opacity=".9"/>' +
      '<ellipse class="mst-eye" cx="24" cy="33" rx="8" ry="8.6" fill="#fff"/>' +
      '<circle cx="22" cy="34" r="4.4" fill="#3b2416"/>' +
      '<circle cx="20.4" cy="32.2" r="1.7" fill="#fff"/>' +
      '<ellipse cx="38" cy="49" rx="7" ry="4.6" fill="#ff7f8f" opacity=".45"/>' +
      '<path d="M23 50c4 4.6 12 4.6 16 0" fill="none" stroke="#a53f1a" stroke-width="2.2" stroke-linecap="round"/>' +
      '<g fill="none" stroke="#f2703f" stroke-width="2" stroke-linecap="round" opacity=".8">' +
        '<path d="M44 20c0-4-3-7-7-7M52 17c0-5-3-8-8-9"/>' +
      '</g>' +
    '</svg>';

  var HEART_SVG = '<svg viewBox="0 0 32 32" role="img" aria-label="爱心"><path d="M16 28.4C6.7 21.9 2 16.6 2 11.2 2 6.9 5.3 4 9.2 4c2.6 0 5 1.4 6.8 4.1C17.8 5.4 20.2 4 22.8 4 26.7 4 30 6.9 30 11.2c0 5.4-4.7 10.7-14 17.2z"/></svg>';

  var JAR_SVG =
    '<svg viewBox="0 0 100 104" role="img" aria-label="装满爱心的罐子">' +
      '<rect x="26" y="28" width="48" height="60" rx="13" fill="url(#gJar)" stroke="#e2728f" stroke-width="3"/>' +
      '<path d="M33 36h8v44h-8z" fill="#fff" opacity=".35"/>' +
      '<g>' +
        '<path d="M50 32.5C43 27.6 39.5 24 39.5 20.6c0-2.9 2.2-5 5-5 2 0 3.9 1.1 5.5 3.3 1.6-2.2 3.5-3.3 5.5-3.3 2.8 0 5 2.1 5 5 0 3.4-3.5 7-10.5 11.9Z" fill="#ff5d7e"/>' +
        '<path d="M50 48.5c-6.6-4.6-10-8-10-11.2 0-2.7 2.1-4.7 4.7-4.7 1.9 0 3.7 1 5.3 3.1 1.6-2.1 3.4-3.1 5.3-3.1 2.6 0 4.7 2 4.7 4.7 0 3.2-3.4 6.6-10 11.2Z" fill="#ff8fa3"/>' +
        '<path d="M50 66.5c-6.6-4.6-10-8-10-11.2 0-2.7 2.1-4.7 4.7-4.7 1.9 0 3.7 1 5.3 3.1 1.6-2.1 3.4-3.1 5.3-3.1 2.6 0 4.7 2 4.7 4.7 0 3.2-3.4 6.6-10 11.2Z" fill="#ffc2ce"/>' +
      '</g>' +
      '<rect x="29" y="19" width="42" height="10" rx="5" fill="url(#gJarTop)"/>' +
      '<rect x="33" y="12" width="34" height="9" rx="4.5" fill="#ff9db6" stroke="#e2728f" stroke-width="2.4"/>' +
      '<g class="mst-spark" fill="#ffd76e"><path d="M18 12l1.7 3.6L23 17.3l-3.3 1.7L18 22.6l-1.7-3.6L13 17.3l3.3-1.7Z"/><path d="M83 26l1.3 2.7 2.7 1.3-2.7 1.3L83 34l-1.3-2.7L79 30l2.7-1.3Z"/></g>' +
    '</svg>';

  var MASCOT_LIST = ['cat', 'fish', 'jar'];
  function isOn(id) {
    var m = CFG.mascots || {};
    if (m.enabled === false) return false;
    return m[id] !== false;
  }
  function pickMascot(i) {
    var list = MASCOT_LIST.filter(isOn);
    if (!list.length) return 'cat';
    return list[i % list.length];
  }

  /* 把形象注入所有 data-slot 占位；先按配置去掉关闭的形象 */
  (function mountMascots() {
    if (document.head && document.head.appendChild) {
      var holder = document.createElement('div');
      holder.style.display = 'none';
      holder.innerHTML = DEFS_SVG;
      document.head.appendChild(holder);
    }
    var svgs = { cat: CAT_SVG, fish: FISH_SVG, jar: JAR_SVG, heart: HEART_SVG };
    var slots = document.querySelectorAll ? document.querySelectorAll('[data-slot]') : [];
    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      var name = slot.getAttribute ? slot.getAttribute('data-slot') : null;
      if (!name) continue;
      if (name !== 'heart' && name !== 'bubbles' && !isOn(name)) {
        if (slot.parentNode) slot.parentNode.removeChild(slot);
        continue;
      }
      if (name === 'bubbles') {
        var html = '';
        for (var b = 0; b < 4; b++) {
          html += '<i class="bb" style="animation-duration:' + (2.4 + b * 0.5).toFixed(1) + 's;animation-delay:' + (b * 0.6).toFixed(1) + 's;--dx:' + (4 + b * 3) + 'px;left:' + (b * 4) + 'px"></i>';
        }
        slot.innerHTML = html;
        continue;
      }
      slot.innerHTML = svgs[name] || '';
    }
  })();

  /* 点一下形象 → 撒爱心 / 吐泡泡 */
  function cheer(el, kind) {
    el.classList.remove('happy');
    void el.offsetWidth;
    el.classList.add('happy');
    sound.pop();
    var r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (r) fx.burstAt(r.left + r.width / 2, r.top + r.height / 2, kind, 12);
  }

  var mascotCat = $('mascotCat');
  var mascotFish = $('mascotFishEnvelope');
  var jar = null;
  if (isOn('jar')) {
    jar = document.createElement('div');
    jar.className = 'mascot mascot-jar';
    jar.setAttribute('aria-hidden', 'true');
    jar.innerHTML = '<div class="jar-float" data-slot="jar"></div>';
    envWrap.appendChild(jar);
    var jarSvg = jar.querySelector ? jar.querySelector('[data-slot="jar"]') : null;
    if (jarSvg) jarSvg.innerHTML = JAR_SVG;
  }
  if (mascotCat) mascotCat.addEventListener('click', function (e) { e.stopPropagation(); cheer(mascotCat, 'heart'); });
  if (mascotFish) mascotFish.addEventListener('click', function (e) { e.stopPropagation(); cheer(mascotFish, 'bubble'); });
  if (jar) jar.addEventListener('click', function (e) { e.stopPropagation(); cheer(jar, 'heart'); });

  /* 信纸里每一幕的小陪读（换幕时先退场再登场） */
  var paperMascot = $('paperMascot');
  var mascotTimer = 0;
  function showMascot(id) {
    return new Promise(function (res) {
      if (!paperMascot) { res(); return; }
      if (mascotTimer) { clearTimeout(mascotTimer); mascotTimer = 0; }
      var slots = paperMascot.querySelectorAll ? paperMascot.querySelectorAll('[data-slot]') : [];
      var next = paperMascot.querySelector ? paperMascot.querySelector('[data-slot="' + id + '"]') : null;
      if (!next) next = paperMascot.querySelector ? paperMascot.querySelector('[data-slot="cat"]') : null;
      if (!next) { res(); return; }
      var shown = [];
      for (var i = 0; i < slots.length; i++) if (slots[i].classList.contains('in')) shown.push(slots[i]);
      var leaving = shown.some(function (s) { return s !== next; });
      if (leaving) {
        shown.forEach(function (s) { if (s !== next) { s.classList.remove('in'); s.classList.add('out'); } });
        mascotTimer = setTimeout(function () {
          mascotTimer = 0;
          shown.forEach(function (s) { s.classList.remove('out'); });
          next.classList.remove('out');
          void next.offsetWidth;
          next.classList.add('in');
          next.setAttribute('data-kind', id);
          res();
        }, 230);
      } else {
        next.classList.remove('out');
        void next.offsetWidth;
        next.classList.add('in');
        next.setAttribute('data-kind', id);
        res();
      }
    });
  }
  if (paperMascot) {
    paperMascot.addEventListener('click', function () {
      var shown = paperMascot.querySelector ? paperMascot.querySelector('.in') : null;
      if (!shown) return;
      cheer(shown, shown.getAttribute('data-kind') === 'fish' ? 'bubble' : 'heart');
    });
  }
  /* 落款处的两个形象也可以点 */
  var duo = document.querySelector ? document.querySelector('.duo') : null;
  if (duo) {
    duo.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-slot]') : null;
      if (!t) return;
      cheer(t, t.getAttribute('data-slot') === 'fish' ? 'bubble' : 'heart');
    });
  }

  /* 火漆封印的图案：默认爱心，可换成小鱼 */
  (function mountSeal() {
    if ($('sealIcon').innerHTML && (CFG.mascots || {}).seal !== 'fish') return;
    if ((CFG.mascots || {}).seal === 'fish') {
      $('sealIcon').innerHTML =
        '<svg viewBox="0 0 96 96" aria-hidden="true">' +
          '<ellipse cx="40" cy="50" rx="26" ry="20" class="ic-fish-body"/>' +
          '<path d="M64 50c8-7 14-12 20-16-2 6-3 11-3 16s1 10 3 16c-6-4-12-9-20-16Z" class="ic-fish-tail"/>' +
          '<path d="M40 30c5-7 12-11 19-13-2 8-4 13-6 18Z" class="ic-fish-top"/>' +
          '<circle cx="30" cy="46" r="5.4" class="ic-eye"/>' +
          '<circle cx="28.6" cy="47" r="2.6" class="ic-piece"/>' +
          '<path d="M30 60c4 4 10 4 14 0" fill="none" stroke="#7a0f2a" stroke-width="2.6" stroke-linecap="round"/>' +
        '</svg>';
    } else {
      $('sealIcon').innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><path class="ic-heart" d="M16 28.4C6.7 21.9 2 16.6 2 11.2 2 6.9 5.3 4 9.2 4c2.6 0 5 1.4 6.8 4.1C17.8 5.4 20.2 4 22.8 4 26.7 4 30 6.9 30 11.2c0 5.4-4.7 10.7-14 17.2z"/></svg>';
    }
  })();

  /* ---------------- 轻音效（可关） ---------------- */
  var sound = (function () {
    var ac = null, master = null, on = !!CFG.fx.sealSound, lastBlip = 0;
    function ensure() {
      if (ac) return ac;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0.5;
        master.connect(ac.destination);
      } catch (e) { ac = null; }
      return ac;
    }
    function resume() { if (ac && ac.state === 'suspended' && ac.resume) ac.resume(); }
    function tone(freq, dur, vol, type, delay) {
      if (!on) return;
      var c = ensure(); if (!c) return;
      resume();
      var t0 = c.currentTime + (delay || 0);
      var o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(master);
      o.start(t0); o.stop(t0 + dur + 0.04);
    }
    return {
      enable: function () { on = true; ensure(); resume(); },
      disable: function () { on = false; },
      isOn: function () { return on; },
      unlock: function () { if (on) { ensure(); resume(); } },
      blip: function () {
        if (!on) return;
        var now = Date.now();
        if (now - lastBlip < 62) return;
        lastBlip = now;
        tone(1500 + Math.random() * 420, 0.035, 0.02, 'triangle');
      },
      open: function () {
        tone(330, 0.5, 0.07, 'sine');
        tone(494, 0.42, 0.05, 'sine', 0.05);
        tone(784, 0.6, 0.032, 'sine', 0.13);
      },
      chime: function () {
        tone(660, 0.55, 0.055, 'sine');
        tone(880, 0.65, 0.045, 'sine', 0.08);
        tone(1320, 0.8, 0.03, 'sine', 0.17);
      },
      finale: function () {
        [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) { tone(f, 1.5, 0.04, 'sine', i * 0.14); });
      },
      pop: function () {
        tone(880 + Math.random() * 320, 0.16, 0.045, 'sine');
        tone(1320 + Math.random() * 420, 0.12, 0.025, 'triangle', 0.04);
      }
    };
  })();

  function syncSoundButton() {
    var on = sound.isOn();
    btnSound.classList.toggle('is-off', !on);
    btnSound.setAttribute('aria-label', on ? '关闭声音' : '打开声音');
  }
  syncSoundButton();

  btnSound.addEventListener('click', function () {
    if (sound.isOn()) sound.disable();
    else { sound.enable(); sound.chime(); }
    syncSoundButton();
  });
  ['touchstart', 'pointerdown', 'click'].forEach(function (ev) {
    window.addEventListener(ev, function () { sound.unlock(); }, { once: true, passive: true });
  });
  document.addEventListener('WeixinJSBridgeReady', function () { sound.unlock(); }, false);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) sound.unlock(); });

  /* ---------------- 打字机（光标是小爱心） ---------------- */
  function tokenize(text) {
    var raw = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    var html = raw.split('\n').map(function (s) { return s.trim(); })
      .filter(function (s) { return s !== ''; })
      .map(function (s) { return '<p>' + s + '</p>'; }).join('');
    var units = [], re = /<[^>]+>|[\s\S]/g, m;
    while ((m = re.exec(html))) units.push(m[0]);
    return units;
  }

  /* 每个字的「时间权重」：标点后多停一拍，读起来才有呼吸感 */
  function charWeight(ch) {
    if (/[。！？!?…]/.test(ch)) return 5.5;      /* 句末：停得最久 */
    if (/[，、；：,;]/.test(ch)) return 3;       /* 句中：稍停 */
    if (ch === '—' || ch === '－' || ch === '~') return 4;
    if (ch === '\n') return 3;
    return 1;
  }

  function typeInto(el, text, opt) {
    opt = opt || {};
    var cps = opt.cps || 15;                     /* 每秒大约打几个字 */
    var units = tokenize(text);
    var acc_html = '';                           /* 已经打出来的内容（累积，不清空前面的段落） */
    var caret = null;
    if (opt.append !== false) acc_html = el._typed || '';
    var base = acc_html;                         /* 本次要保留的底稿 */

    function mountCaret() {
      if (caret && caret.parentNode === el) return;
      caret = document.createElement('i');
      caret.className = 'caret';
      el.innerHTML = acc_html;
      el.appendChild(caret);
    }
    mountCaret();

    if (!units.length) return { done: Promise.resolve(), finish: function () {} };

    var state = { finish: null };
    var done = new Promise(function (resolve) {
      var i = 0, last = 0, acc = 0, finished = false;

      function finish() {
        if (finished) return;
        finished = true;
        acc_html = base + units.join('');        /* 只保留底稿 + 本次内容，不会跨轮次堆积 */
        el._typed = acc_html;
        el.innerHTML = acc_html;
        resolve();
      }
      state.finish = finish;

      function frame(t) {
        if (finished) return;
        if (!last) last = t;
        var dt = (t - last) / 1000;
        last = t;
        acc += dt * cps;
        if (acc > 0) {
          var moved = false;
          /* budget = 这一帧允许消耗的「时间量」；一次最多吐 6 个字，防止快节奏时一帧糊一堆 */
          var budget = 6;
          while (budget > 0 && i < units.length) {
            var u = units[i];
            var w = (u.charAt(0) === '<') ? 0.05 : charWeight(u);
            if (w > acc) break;                   /* 时间还不够，等下一帧 */
            acc -= w;
            budget -= w;
            i += 1;
            caret.insertAdjacentHTML('beforebegin', u);
            if (u.charAt(0) !== '<') moved = true;
          }
        } else {
          acc = 0;
        }
        if (moved) {
          sound.blip();
        }
        if (i >= units.length) { finish(); return; }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });

    return { done: done, finish: function () { if (state.finish) state.finish(); } };
  }

  /* ---------------- 跳过按钮 ---------------- */
  var skipLabel = document.createElement('span');
  while (btnSkip.firstChild) skipLabel.appendChild(btnSkip.firstChild);
  btnSkip.appendChild(skipLabel);

  function setSkip(show, label) {
    btnSkip.hidden = !show;
    if (label) skipLabel.textContent = label;
  }

  /* 唯一的推进入口：正在打字就立刻打完，否则执行当前这一步的跳过动作 */
  function advance() {
    if (busy) return;
    if (typing) {
      var t = typing;
      typing = null;
      t.finish();
      return;
    }
    if (!step || !step.skip) return;
    busy = true;
    var fn = step.skip;
    step = null;
    try { fn(); } catch (e) { /* 忽略 */ }
    busy = false;
  }
  btnSkip.addEventListener('click', advance);
  bigHeart.addEventListener('click', advance);

  function setStageHead(i, stage) {
    stageNo.textContent = String(i + 1).padStart(2, '0');
    stageName.textContent = stage.name || ('第 ' + (i + 1) + ' 幕');
  }

  /* 把一段一段话依次打进同一个元素（每段一个自然段，不覆盖前面的） */
  function typeSeq(list, el, tk) {
    var seq = Promise.resolve(true);
    (list || []).forEach(function (txt) {
      seq = seq.then(function (ok) {
        if (!ok || !running || tk !== TOKEN) return false;
        var job = typeInto(el, txt, { cps: el === elTitle ? (CFG.typing.titleSpeed || 11) : (CFG.typing.speed || 15) });
        typing = job;
        /* 只登记，不动 step —— step 归流程管，免得把跳过按钮弄没了 */
        if (typingEls.indexOf(el) < 0) typingEls.push(el);
        return job.done.then(function () {
          if (typing === job) typing = null;
          var k = typingEls.indexOf(el);
          if (k >= 0) typingEls.splice(k, 1);
          return later(240, tk);
        });
      });
    });
    return seq;
  }

  /* ---------------- 视频 ---------------- */
  var card = null;      /* 当前信纸里的视频卡 */
  var cardCtl = null;

  function absUrl(u) { try { return new URL(u, location.href).href; } catch (e) { return u; } }
  function setRate(v) { if (CFG.video.rate) { try { v.playbackRate = CFG.video.rate; } catch (e) { /* 忽略 */ } } }
  function playOut(target, onBlocked) {
    var pm;
    try { pm = target.play(); } catch (e) { if (onBlocked) onBlocked(); return Promise.resolve(false); }
    if (!pm || !pm.then) return Promise.resolve(true);
    return pm.then(function () { return true; }).catch(function () { if (onBlocked) onBlocked(); return false; });
  }

  var HEART_SVG = '<svg viewBox="0 0 32 32"><path d="M16 28.4C6.7 21.9 2 16.6 2 11.2 2 6.9 5.3 4 9.2 4c2.6 0 5 1.4 6.8 4.1C17.8 5.4 20.2 4 22.8 4 26.7 4 30 6.9 30 11.2c0 5.4-4.7 10.7-14 17.2z"/></svg>';
  var MUTE_SVG = '<svg class="ico-mute" viewBox="0 0 24 24"><path d="M4 9h3l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6" class="ico-x"/></svg>';
  var WAVE_SVG = '<svg class="ico-on" viewBox="0 0 24 24"><path d="M4 9h3l5-4v14l-5-4H4z"/><path d="M15.6 8.6a5 5 0 0 1 0 6.8M18.2 6.2a8.5 8.5 0 0 1 0 11.6" class="ico-wave"/></svg>';

  function buildCard(stage) {
    var wrap = document.createElement('div');
    wrap.className = 'video-slot';

    var frame = document.createElement('div');
    frame.className = 'video-frame';

    var v = document.createElement('video');
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.setAttribute('x5-playsinline', '');
    v.setAttribute('x5-video-player-type', 'h5');
    v.setAttribute('x5-video-player-fullscreen', 'false');
    v.preload = 'auto';
    v.muted = CFG.video.muted !== false;
    v.loop = !!CFG.video.loop;
    if (stage.poster) v.setAttribute('poster', stage.poster);
    v.src = absUrl(stage.video);
    frame.appendChild(v);

    var play = document.createElement('button');
    play.type = 'button';
    play.className = 'video-play';
    play.setAttribute('aria-label', '播放视频');
    play.hidden = true;
    play.innerHTML = '<span class="vp-ring"></span><svg viewBox="0 0 24 24"><path d="M8 5.5l11 6.5-11 6.5z"/></svg>';
    frame.appendChild(play);

    var vSound = document.createElement('button');
    vSound.type = 'button';
    vSound.className = 'video-sound' + (v.muted ? ' is-off' : '');
    vSound.setAttribute('aria-label', '视频声音');
    vSound.innerHTML = MUTE_SVG + WAVE_SVG;
    frame.appendChild(vSound);

    var cap = document.createElement('p');
    cap.className = 'video-cap';
    cap.textContent = stage.caption || '';
    cap.hidden = !stage.caption;

    wrap.appendChild(frame);
    wrap.appendChild(cap);

    return {
      el: wrap, video: v, play: play, sound: vSound
    };
  }

  /* 放一个视频卡，返回 { done: Promise(结束/出错都算结束), skip: fn } */
  function mountVideo(stage, tk) {
    var c = buildCard(stage);
    elBody2.parentNode.insertBefore(c.el, elBody2);
    card = c;
    c.sound.style.display = 'none';

    var done = false, stopped = false, ready = false;
    var resolveFn = null;
    var p = new Promise(function (res) { resolveFn = res; });
    var timer = 0;

    function finish() {
      if (done) return;
      done = true;
      if (timer) { clearInterval(timer); timer = 0; }
      resolveFn(true);
    }
    function markReady() { ready = true; }
    function attempt() {
      if (done || stopped || !ready) return;
      c.play.hidden = true;
      setRate(c.video);
      playOut(c.video, function () { if (!done && !stopped) c.play.hidden = false; });
    }

    var v = c.video;
    v.addEventListener('loadeddata', markReady);
    v.addEventListener('canplay', markReady);
    v.addEventListener('playing', markReady);
    v.addEventListener('error', function () {
      if (!ready) {
        c.el.hidden = true;
        finish();
      }
    });
    v.addEventListener('ended', function () { if (!v.loop) finish(); });

    c.play.addEventListener('click', attempt);
    c.sound.addEventListener('click', function () {
      v.muted = !v.muted;
      c.sound.classList.toggle('is-off', v.muted);
      if (!v.muted) attempt();
    });
    v.addEventListener('click', function () {
      if (v.paused) attempt();
      else { try { v.pause(); } catch (e) { /* 忽略 */ } c.play.hidden = false; }
    });
    function startPoll() {
      if (timer) return;
      var ticks = 0;
      timer = setInterval(function () {
        ticks += 1;
        if (done || stopped) { clearInterval(timer); timer = 0; return; }
        if (!ready && (v.readyState >= 3 || v.videoWidth)) markReady();
        if (ready && v.paused && !v.ended) attempt();
      }, 450);
    }

    try { v.load(); } catch (e) { /* 忽略 */ }
    startPoll();
    c.sound.style.display = 'grid';
    attempt();

    /* 视频只在用户点击互动按钮后出现，此时把视线带到播放器。 */
    try { c.el.scrollIntoView({ block: 'center', behavior: REDUCED ? 'auto' : 'smooth' }); }
    catch (e) { /* 忽略 */ }

    return {
      get done() { return p; },
      skip: function () {
        if (stopped) return;
        stopped = true;
        try { v.pause(); } catch (e) { /* 忽略 */ }
        finish();
      }
    };
  }

  function unmountVideo() {
    if (cardCtl) cardCtl.skip();
    cardCtl = null;
    if (!card) return;
    var c = card;
    card = null;
    var v = c.el.querySelector ? c.el.querySelector('video') : null;
    try { if (v) v.pause(); } catch (e) { /* 忽略 */ }
    if (c.el.parentNode) c.el.parentNode.removeChild(c.el);
  }

  /* 全屏播放（config 里把 mode 改成 cine 时启用） */
  function playCine(stage, tk) {
    cine.hidden = false;
    cineVideo.src = absUrl(stage.video);
    cineVideo.muted = CFG.video.muted !== false;
    cineVideo.loop = !!CFG.video.loop;
    cinePlay.hidden = true;
    var done = false;
    return new Promise(function (resolve) {
      function finish() {
        if (done) { return; }
        done = true;
        step = null;
        try { cineVideo.pause(); } catch (e) { /* 忽略 */ }
        cine.hidden = true;
        resolve();
      }
      cineSkip.onclick = finish;
      cinePlay.onclick = function () {
        cinePlay.hidden = true;
        setRate(cineVideo);
        playOut(cineVideo, function () { cinePlay.hidden = false; });
      };
      cineVideo.onclick = function () {
        if (cineVideo.paused) cinePlay.onclick();
        else { try { cineVideo.pause(); } catch (e) { /* 忽略 */ } cinePlay.hidden = false; }
      };
      cineVideo.onended = finish;
      step = { skip: finish };
      later(300, tk).then(function (ok) {
        if (!ok || done) return;
        setRate(cineVideo);
        playOut(cineVideo, function () { cinePlay.hidden = false; });
      });
    });
  }

  /* ---------------- 一幕一幕地放 ---------------- */
  function resetLetter() {
    unmountVideo();
    step = null;
    typing = null;
    typingEls = [];
    /* 清掉上一遍留下的打字底稿，重新看的时候才不会接在旧内容后面 */
    [elTitle, elBody, elBody2, elSign].forEach(function (el) {
      el._typed = '';
      el.innerHTML = '';
    });
    elEnd.classList.remove('on');
    bigHeart.classList.remove('on');
    paperScroll.scrollTop = 0;
    setSkip(false);
  }

  function runStages() {
    var tk = TOKEN;
    var i = 0;

    function waitForAction(label, fn) {
      if (tk !== TOKEN || !running) return;
      setSkip(true, label);
      step = {
        skip: function () {
          if (tk !== TOKEN || !running) return;
          step = null;
          setSkip(false);
          fn();
        }
      };
    }

    function nextStage() {
      if (tk !== TOKEN || !running) return;
      if (i >= stages.length) { finale(tk); return; }

      var stage = stages[i];
      i += 1;
      var hasVideo = !!(stage.video || '').trim();
      setStageHead(i - 1, stage);
      unmountVideo();
      elTitle.innerHTML = '';
      elBody.innerHTML = '';
      elBody2.innerHTML = '';
      /* 只在用户点击继续后切换到新的一幕，切换时从这一幕顶部开始。 */
      paperScroll.scrollTop = 0;
      setSkip(false);
      step = null;
      /* 换一位小陪读出场 */
      var mascotReady = showMascot(stage.mascot || pickMascot(i - 1));

      /* 标题先打出来（不阻塞正文） */
      var titleText = stage.title || (i === 1 ? '写给最特别的你' : '');
      var titleSeq = titleText ? typeSeq([titleText], elTitle, tk) : Promise.resolve(true);
      var bodySeq = typeSeq(stage.open || [], elBody, tk);

      Promise.all([titleSeq, bodySeq, mascotReady]).then(function (result) {
        if (result.some(function (ok) { return ok === false; }) || tk !== TOKEN || !running) return;
        waitForAction(hasVideo ? (stage.action || '打开这段影像') : '继续', function () {
          if (hasVideo) revealVideo(stage);
          else revealClose(stage);
        });
      }).catch(function (e) {
        if (window.console && console.warn) console.warn('流程中断：', e);
      });
    }

    function revealVideo(stage) {
      if (tk !== TOKEN || !running) return;
      setSkip(false);
      if (CFG.video.mode === 'cine') {
        setSkip(true, '跳过视频');
        playCine(stage, tk).then(function () {
          if (tk === TOKEN && running) revealClose(stage);
        });
        return;
      }
      setSkip(true, '跳过视频');
      var ctl = mountVideo(stage, tk);
      cardCtl = ctl;
      step = { skip: function () { ctl.skip(); } };
      ctl.done.then(function () {
        if (tk !== TOKEN || !running) return;
        step = null;
        cardCtl = null;
        revealClose(stage);
      });
    }

    /* 互动后显示视频后的文字，再由下一次互动进入下一幕。 */
    function revealClose(stage) {
      if (tk !== TOKEN || !running) return;
      var list = stage.close || [];
      if (!list.length) {
        waitForAction('继续', nextStage);
        return;
      }
      setSkip(false);
      step = null;
      return typeSeq(list, elBody2, tk).then(function (ok) {
        if (!ok || tk !== TOKEN || !running) return;
        waitForAction('继续', nextStage);
      });
    }

    nextStage();
  }

  function finale(tk) {
    if (tk !== TOKEN || !running) return;
    step = null;
    setSkip(false);
    stageNo.textContent = String(stages.length).padStart(2, '0');
    stageName.textContent = '落款';
    unmountVideo();

    var job = typeInto(elSign, CFG.ending.sign || '', { cps: (CFG.typing.speed || 15) * 0.85 });
    typing = job;
    job.done.then(function () {
      typing = null;
      if (tk !== TOKEN || !running) return;
      elEnd.classList.add('on');
      bigHeart.classList.add('on');
      sound.finale();
      fx.confetti(30);
      fx.rainHearts(18);
      later(700, tk).then(function (ok2) {
        if (ok2 && running) fx.rainHearts(12);
      });
    });
  }

  /* ---------------- 开信封 ---------------- */
  function openEnvelope() {
    if (app.dataset.phase !== 'sealed') return;
    TOKEN = {};
    var tk = TOKEN;
    app.dataset.phase = 'opening';
    running = true;
    sound.enable();
    syncSoundButton();
    sound.open();
    try { if (navigator.vibrate) navigator.vibrate(18); } catch (e) { /* 忽略 */ }

    later(950, tk).then(function (ok) {
      if (!ok) return;
      sound.chime();
      fx.burst(12);
      return later(880, tk);
    }).then(function (ok) {
      if (!ok) return;
      paper.hidden = false;
      veil.hidden = false;
      requestAnimationFrame(function () {
        if (tk !== TOKEN) return;
        veil.classList.add('on');
        app.dataset.phase = 'reading';
      });
      return later(900, tk);
    }).then(function (ok) {
      if (!ok) return;
      resetLetter();
      runStages();
    }).catch(function (e) {
      if (window.console && console.warn) console.warn('开信失败：', e);
    });
  }

  envSeal.addEventListener('click', function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    openEnvelope();
  });
  $('env').addEventListener('click', openEnvelope);

  /* ---------------- 收好这封信 ---------------- */
  function closeLetter() {
    TOKEN = {};                 /* 让所有在途回调作废 */
    running = false;
    resetLetter();
    try { cineVideo.pause(); } catch (e) { /* 忽略 */ }
    cine.hidden = true;
    paper.classList.add('is-out');
    veil.classList.remove('on');
    var tk = TOKEN;
    later(560, tk).then(function () {
      paper.hidden = true;
      paper.classList.remove('is-out');
      veil.hidden = true;
      app.dataset.phase = 'sealed';
      envHint.style.animation = 'none';
      void envHint.offsetWidth;   /* 强制回流，重播呼吸动画 */
      envHint.style.animation = '';
      fx.start();
    });
  }
  btnClose.addEventListener('click', closeLetter);
})();
