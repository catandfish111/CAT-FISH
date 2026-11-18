/* ============================================================
   小团子 · 首页电子养娃宠物
   ------------------------------------------------------------
   · 原创 SVG 形象，不依赖任何图片
   · 可拖动（带倾斜和落地回弹），位置记在本机
   · 点一下有动作和台词；隔一段时间自己说一句，但不会太频繁
   ============================================================ */
(function (global) {
  'use strict';

  var POS_KEY = 'catfish-baby-pos-v1';
  var GREET_KEY = 'catfish-baby-greeted-v1';
  var NAME = '小团子';

  var LINES = {
    tap: ['嘿嘿～', '抱抱！', '宝宝在这里', '咿呀！', '摸摸头', '宝宝开心', '再点一下嘛', '咕噜咕噜'],
    day: ['宝宝在长大哦', '今天也喜欢你们', '宝宝乖不乖？', '想被摸摸头', '猫猫～鱼鱼～', '宝宝会自己玩', '咿呀咿呀'],
    morning: ['早安呀', '今天也要开心', '宝宝醒啦', '太阳晒屁股咯'],
    night: ['呼……困困', '晚安呀', '宝宝要睡觉觉', '月亮好圆'],
    drag: ['晕晕…', '放我下来～', '飞起来啦', '慢慢放嘛']
  };

  var ACTIONS = ['is-jump', 'is-spin', 'is-wiggle', 'is-yawn'];

  var root = null;
  var bubble = null;
  var hearts = null;
  var spaceHome = null;

  var state = {
    attention: 0.65,
    pos: null,
    drag: null,
    moved: false,
    suppressClickUntil: 0,
    lastActionAt: 0,
    lastInteractAt: Date.now(),
    lastLine: '',
    nextTalkAt: Date.now() + 120000,
    bubbleTimer: 0,
    blinkTimer: 0,
    talkTimer: 0,
    greeted: false,
    inited: false
  };

  function rand(min, max) { return min + Math.random() * (max - min); }
  function pick(list) {
    if (!list || !list.length) return '';
    var line = list[Math.floor(Math.random() * list.length)];
    if (list.length > 1 && line === state.lastLine) return pick(list);
    state.lastLine = line;
    return line;
  }
  function nowHour() { return new Date().getHours(); }
  function isNight() { var h = nowHour(); return h >= 22 || h < 6; }

  var SVG = [
    '<svg viewBox="0 0 160 200" role="img" aria-hidden="true">',
    '  <ellipse class="bp-shadow" cx="80" cy="186" rx="40" ry="7"/>',
    '  <g class="bp-body">',
    '    <ellipse class="bp-foot" cx="61" cy="176" rx="12" ry="9"/>',
    '    <ellipse class="bp-foot" cx="99" cy="176" rx="12" ry="9"/>',
    '    <path class="bp-onesie" d="M52 118 Q52 106 64 106 H96 Q108 106 108 118 V154 Q108 176 80 176 Q52 176 52 154 Z"/>',
    '    <ellipse class="bp-belly" cx="80" cy="146" rx="19" ry="15"/>',
    '    <path class="bp-arm" d="M53 126 Q42 132 45 144 Q47 151 54 149"/>',
    '    <path class="bp-arm right" d="M107 126 Q118 132 115 144 Q113 151 106 149"/>',
    '    <path class="bp-star" d="M80 132 l3.2 6.6 7.2 1 -5.2 5.1 1.2 7.2 -6.4-3.4 -6.4 3.4 1.2-7.2 -5.2-5.1 7.2-1 z"/>',
    '  </g>',
    '  <g class="bp-head">',
    '    <path class="bp-ear" d="M42 50 Q38 22 62 36 Z"/>',
    '    <path class="bp-ear right" d="M118 50 Q122 22 98 36 Z"/>',
    '    <path class="bp-ear-in" d="M47 46 Q45 32 57 39 Z"/>',
    '    <path class="bp-ear-in right" d="M113 46 Q115 32 103 39 Z"/>',
    '    <circle class="bp-face" cx="80" cy="80" r="46"/>',
    '    <path class="bp-ahoge" d="M80 35 Q82 20 92 16 Q104 12 100 24"/>',
    '    <g class="bp-eyes">',
    '      <ellipse class="bp-eye" cx="63" cy="80" rx="7" ry="9.5"/>',
    '      <ellipse class="bp-eye" cx="97" cy="80" rx="8" ry="10"/>',
    '      <circle class="bp-glint" cx="60.5" cy="75.5" r="2.6"/>',
    '      <circle class="bp-glint" cx="94" cy="75" r="2.8"/>',
    '    </g>',
    '    <ellipse class="bp-blush" cx="49" cy="96" rx="9" ry="5"/>',
    '    <ellipse class="bp-blush" cx="111" cy="96" rx="9" ry="5"/>',
    '    <path class="bp-mouth" d="M73 95 Q80 102 87 95"/>',
    '    <circle class="bp-drool" cx="90" cy="104" r="3"/>',
    '  </g>',
    '</svg>'
  ].join('');

  function init() {
    if (state.inited) return;
    spaceHome = document.getElementById('spaceHome');
    if (!spaceHome) return;
    state.inited = true;

    root = document.createElement('button');
    root.type = 'button';
    root.className = 'baby-pet';
    root.id = 'babyPet';
    root.setAttribute('aria-label', '和小团子玩');
    root.innerHTML = SVG +
      '<span class="bp-bubble" role="status" aria-live="polite"></span>' +
      '<span class="bp-hearts" aria-hidden="true"></span>';
    spaceHome.appendChild(root);

    bubble = root.querySelector('.bp-bubble');
    hearts = root.querySelector('.bp-hearts');

    restorePos();
    bindDrag();
    bindTap();
    startBlink();
    startTalking();
    watchNote();

    if (isNight()) root.classList.add('is-night');

    setTimeout(function () { if (!state.greeted) greet(); }, 12000);
    setTimeout(function () {
      if (state.pos) return;
      try {
        if (global.sessionStorage.getItem('catfish-baby-hinted-v1')) return;
        global.sessionStorage.setItem('catfish-baby-hinted-v1', '1');
      } catch (e) { /* 忽略 */ }
      say('可以把我拖走哦', 3400);
    }, 4500);
    setTimeout(function () { restatePos(); }, 300);
    global.addEventListener('resize', restatePos);
  }

  /* ---------------- 位置 ---------------- */
  function homeRect() { return spaceHome.getBoundingClientRect(); }

  function clampPos(left, top) {
    var h = homeRect();
    var w = root.offsetWidth || 92;
    var ph = root.offsetHeight || 112;
    var maxLeft = Math.max(8, h.width - w - 8);
    var maxTop = Math.max(8, h.height - ph - 74);   /* 别压住底部导航 */
    return {
      left: Math.min(Math.max(8, left), maxLeft),
      top: Math.min(Math.max(8, top), maxTop)
    };
  }

  function place(left, top) {
    var p = clampPos(left, top);
    root.style.left = p.left + 'px';
    root.style.top = p.top + 'px';
    root.style.bottom = 'auto';
    state.pos = p;
  }

  function restatePos() {
    if (!state.pos) return;
    place(state.pos.left, state.pos.top);
  }

  function restorePos() {
    var saved = null;
    try { saved = JSON.parse(global.localStorage.getItem(POS_KEY) || 'null'); } catch (e) { saved = null; }
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
      place(saved.left, saved.top);
    }
  }

  function savePos() {
    try { global.localStorage.setItem(POS_KEY, JSON.stringify(state.pos)); } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 拖动 ---------------- */
  function bindDrag() {
    root.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (!e.isPrimary && e.isPrimary !== undefined) return;
      var h = homeRect();
      var r = root.getBoundingClientRect();
      state.drag = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        left: r.left - h.left,
        top: r.top - h.top,
        moved: false
      };
      state.moved = false;
      root.classList.add('is-hold');
      try { root.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    });

    root.addEventListener('pointermove', function (e) {
      var d = state.drag;
      if (!d || d.id !== e.pointerId) return;
      var dx = e.clientX - d.startX;
      var dy = e.clientY - d.startY;
      if (!d.moved && Math.sqrt(dx * dx + dy * dy) < 6) return;
      d.moved = true;
      state.moved = true;
      root.classList.add('is-dragging');
      root.classList.remove('is-hold');
      place(d.left + dx, d.top + dy);
      var tilt = Math.max(-10, Math.min(10, dx / 12));
      root.style.setProperty('--bp-tilt', tilt.toFixed(2) + 'deg');
      e.preventDefault();
    });

    function endDrag(e) {
      var d = state.drag;
      if (!d || d.id !== e.pointerId) return;
      state.drag = null;
      root.classList.remove('is-dragging', 'is-hold');
      root.style.removeProperty('--bp-tilt');
      if (d.moved) {
        state.suppressClickUntil = Date.now() + 320;
        state.lastInteractAt = Date.now();
        savePos();
        if (Math.random() < 0.45) say(pick(LINES.drag), 2200);
        burst('heart', 2);
      } else {
        state.suppressClickUntil = 0;
      }
    }
    root.addEventListener('pointerup', endDrag);
    root.addEventListener('pointercancel', endDrag);
    root.addEventListener('lostpointercapture', function () {
      if (state.drag) { state.drag = null; root.classList.remove('is-dragging', 'is-hold'); }
    });
  }

  /* ---------------- 点击 ---------------- */
  function bindTap() {
    root.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (Date.now() < state.suppressClickUntil) return;
      tap();
    });
    root.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function tap() {
    var now = Date.now();
    if (now - state.lastActionAt < 900) return;
    state.lastActionAt = now;
    /* 注意力：被逗一次就少一点，逗得越勤越安静 */
    state.attention = Math.max(0, state.attention - 0.45);

    /* 呆的关键不是动作，是慢半拍：先愣一下再动 */
    var delay = 110 + Math.random() * 130;
    setTimeout(function () {
      if (state.drag) return;
      state.lastInteractAt = Date.now();
      var action = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
      play(action);
      /* 一次只给一到两种反馈，不同时把动作、台词、粒子全放出来 */
      var spoke = false;
      if (Math.random() < 0.45) { say(pick(LINES.tap), 1900); spoke = true; }
      if (!spoke) {
        if (Math.random() < 0.5) burst('heart', 2);
        else burst('spark', 1);
      }
      if (isNight()) root.classList.add('is-night');
    }, delay);
  }

  function play(action) {
    ACTIONS.forEach(function (name) { root.classList.remove(name); });
    void root.offsetWidth;
    root.classList.add(action);
    setTimeout(function () { root.classList.remove(action); }, 900);
  }

  /* ---------------- 说话 ---------------- */
  function say(text, duration) {
    if (!text || !bubble) return;
    bubble.textContent = text;
    bubble.classList.add('is-on');
    clearTimeout(state.bubbleTimer);
    state.bubbleTimer = setTimeout(function () {
      bubble.classList.remove('is-on');
    }, duration || 2600);
  }

  function greet() {
    state.greeted = true;
    try {
      if (global.sessionStorage.getItem(GREET_KEY)) return;
      global.sessionStorage.setItem(GREET_KEY, '1');
    } catch (e) { /* 忽略 */ }
    say(isNight() ? '宝宝来陪你们睡觉啦' : '宝宝来啦～', 3200);
    burst('heart', 3);
  }

  function randomLine() {
    var h = nowHour();
    var pool = LINES.day;
    if (h >= 5 && h < 10) pool = LINES.morning;
    else if (h >= 22 || h < 5) pool = LINES.night;

    /* 偶尔提一句陪了多少天，让「养成」有点存在感 */
    if (Math.random() < 0.22 && global.SpaceApp && SpaceApp.daysSince) {
      var days = 0;
      try { days = SpaceApp.daysSince(); } catch (e) { days = 0; }
      if (days > 0) return '宝宝陪你们第 ' + days + ' 天啦';
    }
    return pick(pool);
  }

  function canSpeak() {
    if (document.hidden) return false;
    var app = document.getElementById('app');
    if (app && app.dataset.phase !== 'space') return false;
    if (document.body.classList.contains('memories-open')) return false;
    var panel = document.getElementById('bubuFeaturePanel');
    if (panel && !panel.hidden) return false;
    if (state.drag) return false;
    if (Date.now() - state.lastInteractAt < 45000) return false;
    return true;
  }

  function startTalking() {
    state.nextTalkAt = Date.now() + 90000;
    state.talkTimer = setInterval(function () {
      /* 安静的时候注意力慢慢回满；回满了才可能自言自语 */
      state.attention = Math.min(1, state.attention + 0.06);
      if (state.attention < 0.9) return;
      if (Date.now() < state.nextTalkAt) return;
      if (!canSpeak()) { state.nextTalkAt = Date.now() + 15000; return; }
      say(randomLine(), 3600);
      burst('heart', 1);
      state.attention = Math.max(0, state.attention - 0.6);
      state.nextTalkAt = Date.now() + 45000;
    }, 10000);
  }

  /* ---------------- 眨眼 ---------------- */
  function startBlink() {
    function schedule() {
      state.blinkTimer = setTimeout(function () {
        root.classList.add('is-blink');
        setTimeout(function () { root.classList.remove('is-blink'); }, 130);
        schedule();
      }, rand(3200, 6800));
    }
    schedule();
  }

  /* ---------------- 小爱心 / 星星 ---------------- */
  function burst(kind, count) {
    if (!hearts) return;
    for (var i = 0; i < count; i += 1) {
      var bit = document.createElement('i');
      bit.className = 'bp-bit ' + (kind === 'spark' ? 'is-spark' : 'is-heart');
      bit.textContent = kind === 'spark' ? '✦' : '♡';
      bit.style.left = rand(18, 74).toFixed(1) + '%';
      bit.style.animationDelay = (i * 90) + 'ms';
      hearts.appendChild(bit);
      (function (node) {
        setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 1400);
      })(bit);
    }
  }

  /* ---------------- 有便签时往上让一点 ---------------- */
  function watchNote() {
    var note = document.getElementById('bubuNoteWidget');
    if (!note || !global.MutationObserver) return;
    function sync() { root.classList.toggle('has-note', !note.hidden); }
    sync();
    new global.MutationObserver(sync).observe(note, { attributes: true, attributeFilter: ['hidden'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
