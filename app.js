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

    function spawn() {
      items.push({
        x: Math.random() * W,
        y: H + 20 + Math.random() * 40,
        vy: -(6 + Math.random() * 14) * (U / 4),
        vx: (Math.random() - 0.5) * 6 * (U / 4),
        s: (3.5 + Math.random() * 6) * (U / 4),
        rot: (Math.random() - 0.5) * 0.7,
        vr: (Math.random() - 0.5) * 0.35,
        a: 0.10 + Math.random() * 0.26,
        hue: 338 + Math.random() * 24,
        ph: Math.random() * Math.PI * 2
      });
    }

    function burst(n) {
      if (REDUCED) return;
      var cx = W / 2, cy = H * 0.54;
      for (var i = 0; i < n; i++) {
        var ang = (Math.PI * 2 * i) / n + Math.random() * 0.4;
        var sp = (2.2 + Math.random() * 3.6) * U * 0.8;
        bursts.push({
          x: cx + (Math.random() - 0.5) * 30,
          y: cy + (Math.random() - 0.5) * 30,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp - 1.2 * U,
          s: (4 + Math.random() * 8) * (U / 4),
          life: 1, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
          hue: 336 + Math.random() * 28
        });
      }
      start();
    }

    function draw(list, dt) {
      for (var i = list.length - 1; i >= 0; i--) {
        var p = list[i];
        if (p.life !== undefined) {
          p.life -= dt * 0.36;
          p.vy += 26 * dt;
          p.vx *= 0.988;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
          if (p.life <= 0) { list.splice(i, 1); continue; }
          ctx.save();
          ctx.globalAlpha = clamp(p.life, 0, 1) * 0.85;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = 'hsl(' + p.hue + ',92%,66%)';
          heartPath(ctx, p.s * (0.6 + p.life * 0.6));
          ctx.fill();
          ctx.restore();
        } else {
          p.ph += dt * 1.4;
          p.y += p.vy * dt;
          p.x += (p.vx + Math.sin(p.ph) * 5) * dt;
          p.rot += p.vr * dt;
          if (p.y < -60 || p.x < -70 || p.x > W + 70) { list.splice(i, 1); continue; }
          ctx.save();
          ctx.globalAlpha = p.a;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = 'hsl(' + p.hue + ',88%,72%)';
          heartPath(ctx, p.s);
          ctx.fill();
          ctx.restore();
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
        if (acc > 0.42 && items.length < 34) { acc = 0; spawn(); }
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

    return { start: start, stop: stop, burst: burst };
  }

  var fx = HeartField($('fx'));

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

  /* 让光标始终跟着视线走（每 220ms 最多滚一次，避免打字慢时抖） */
  var lastFollow = 0;
  function followCaret(now, caret, opt) {
    if (opt.follow === false || !caret.parentNode) return;
    if (now - lastFollow < 220) return;
    lastFollow = now;
    try { caret.scrollIntoView({ block: 'end', behavior: REDUCED ? 'auto' : 'smooth' }); }
    catch (e) { try { caret.scrollIntoView(false); } catch (e2) { /* 忽略 */ } }
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
          followCaret(t, caret, opt);            /* 打字慢的时候不用每帧都滚 */
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

    var empty = document.createElement('div');
    empty.className = 'video-empty';
    empty.hidden = true;
    empty.innerHTML = '<span class="ve-heart">' + HEART_SVG + '</span>' +
      '<p class="ve-title"></p><p class="ve-sub"></p>' +
      '<button class="ve-retry" type="button">再看一次</button>';
    frame.appendChild(empty);

    var cap = document.createElement('p');
    cap.className = 'video-cap';
    cap.textContent = stage.caption || '';
    cap.hidden = !stage.caption;

    wrap.appendChild(frame);
    wrap.appendChild(cap);

    return {
      el: wrap, video: v, play: play, sound: vSound, empty: empty,
      veTitle: empty.querySelector('.ve-title'),
      veSub: empty.querySelector('.ve-sub'),
      retry: empty.querySelector('.ve-retry')
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
    function showTip() {
      if (stopped) return;
      c.veTitle.textContent = '视频还没放进来';
      c.veSub.textContent = '把 ' + stage.video + ' 放进 assets 文件夹，刷新就能看到啦';
      c.play.hidden = true;
      c.sound.style.display = 'none';
      c.empty.hidden = false;
    }
    function markReady() { ready = true; c.empty.hidden = true; }
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
    v.addEventListener('error', function () { if (!ready) { showTip(); finish(); } });
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
    c.retry.addEventListener('click', function () {
      /* 重试只是再放一次，不推进剧情；想往下看请点「跳过视频」 */
      if (tk !== TOKEN) return;
      c.empty.hidden = true;
      c.sound.style.display = '';
      ready = false; done = false; stopped = false;
      p = new Promise(function (res) { resolveFn = res; });
      try { v.load(); } catch (e) { /* 忽略 */ }
      startPoll();
      setTimeout(attempt, 400);
    });

    function startPoll() {
      if (timer) return;
      var ticks = 0;
      timer = setInterval(function () {
        ticks += 1;
        if (done || stopped) { clearInterval(timer); timer = 0; return; }
        if (!ready && (v.readyState >= 3 || v.videoWidth)) markReady();
        if (!ready && ticks > 6) { showTip(); finish(); return; }
        if (ready && v.paused && !v.ended) attempt();
      }, 450);
    }

    try { v.load(); } catch (e) { /* 忽略 */ }
    startPoll();
    c.sound.style.display = '';
    attempt();

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

    function nextStage() {
      if (tk !== TOKEN || !running) return;
      if (i >= stages.length) { finale(tk); return; }

      var stage = stages[i];
      i += 1;
      setStageHead(i - 1, stage);
      unmountVideo();
      elTitle.innerHTML = '';
      elBody.innerHTML = '';
      elBody2.innerHTML = '';
      setSkip(false);
      step = null;
      /* 每一幕都从头看起 */
      try { elTitle.scrollIntoView({ block: 'start', behavior: REDUCED ? 'auto' : 'smooth' }); }
      catch (e) { paperScroll.scrollTop = 0; }

      var hasVideo = !!(stage.video || '').trim();

      /* 标题先打出来（不阻塞正文） */
      var titleText = stage.title || (i === 1 ? '写给最特别的你' : '');
      var titleSeq = titleText ? typeSeq([titleText], elTitle, tk) : Promise.resolve(true);

      typeSeq(stage.open || [], elBody, tk).then(function (ok) {
        if (!ok || tk !== TOKEN || !running) return false;
        /* 等标题也打完再往下走 */
        return titleSeq.then(waitText).then(function () {
          if (tk !== TOKEN || !running) return false;
          if (!hasVideo) return afterVideo().then(function () { return true; });
          if (CFG.video.mode === 'cine') {
            setSkip(true, '跳过视频');
            return playCine(stage, tk).then(function () {
              if (tk !== TOKEN) return false;
              return afterVideo().then(function () { return true; });
            });
          }
          setSkip(true, '跳过视频');
          var ctl = mountVideo(stage, tk);
          cardCtl = ctl;
          step = { skip: function () { ctl.skip(); } };
          return ctl.done.then(function () {
            if (tk !== TOKEN) return false;
            step = null;
            return afterVideo().then(function () { return true; });
          });
        });
      }).then(function (ok) {
        if (ok === false) return false;
        /* 给点时间读完，再翻到下一幕 */
        return later(CFG.video.closePause || 1400, tk);
      }).then(function (ok) {
        if (!ok) return;
        nextStage();
      }).catch(function (e) {
        if (window.console && console.warn) console.warn('流程中断：', e);
      });
    }

    /* 等标题和正文都打完（它们可能同时在打） */
    function waitText() {
      return new Promise(function (res) {
        (function check() {
          if (!typingEls.length || !running || tk !== TOKEN) { res(); return; }
          setTimeout(check, 90);
        })();
      });
    }

    /* 视频之后那段话：先打完，再停留一会儿 */
    function afterVideo() {
      var st = stages[i - 1] || {};
      var list = st.close || [];
      if (!list.length) { setSkip(false); step = null; return Promise.resolve(); }
      setSkip(true, '跳过');
      return typeSeq(list, elBody2, tk).then(function (ok) {
        step = null;
        if (!ok || tk !== TOKEN) return;
        setSkip(false);
        return later(CFG.video.closePause || 1400, tk);
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
      fx.burst(26);
      setTimeout(function () { if (tk === TOKEN && running) fx.burst(16); }, 640);
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
