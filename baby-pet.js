/* ============================================================
   小团子 · 首页电子养娃宠物
   ------------------------------------------------------------
   · 原创 SVG，头 / 耳朵 / 眼睛 / 瞳孔 / 手臂 / 腿 / 身体 / 呆毛
     都是独立分组，各自有 transform-origin，可以单独动
   · 待机时会有小动作：眨眼、东张西望、抖耳朵、点脚、摆手臂
   · 点一下会触发成套动作：挥手 / 跳舞 / 跳 / 转圈 / 打哈欠 /
     害羞 / 捂眼睛 / 踢腿 / 打嗝，每个动作都是各部位配合
   · 可拖动，位置记在本机；随机说话，但频率很低
   ============================================================ */
(function (global) {
  'use strict';

  var POS_KEY = 'catfish-baby-pos-v1';
  var HINT_KEY = 'catfish-baby-hinted-v1';
  var GREET_KEY = 'catfish-baby-greeted-v1';

  var LINES = {
    tap: ['嘿嘿～', '抱抱！', '宝宝在这里', '咿呀！', '摸摸头', '宝宝开心', '再点一下嘛', '咕噜咕噜'],
    day: ['宝宝在长大哦', '今天也喜欢你们', '宝宝乖不乖？', '想被摸摸头', '猫猫～鱼鱼～', '宝宝会自己玩', '咿呀咿呀'],
    morning: ['早安呀', '今天也要开心', '宝宝醒啦', '太阳晒屁股咯'],
    night: ['呼……困困', '晚安呀', '宝宝要睡觉觉', '月亮好圆'],
    drag: ['晕晕…', '放我下来～', '飞起来啦', '慢慢放嘛']
  };

  var ACTIONS = ['is-wave', 'is-dance', 'is-jump', 'is-spin', 'is-yawn', 'is-shy', 'is-nod', 'is-kick', 'is-hiccup'];
  var MICRO = ['ear', 'look', 'tilt', 'foot', 'arm', 'yawn', 'hiccup'];

  var root = null;
  var bubble = null;
  var hearts = null;
  var spaceHome = null;

  var state = {
    pos: null,
    drag: null,
    moved: false,
    suppressClickUntil: 0,
    lastActionAt: 0,
    lastAction: '',
    actionUntil: 0,
    lastInteractAt: Date.now(),
    lastLine: '',
    nextTalkAt: Date.now() + 120000,
    bubbleTimer: 0,
    blinkTimer: 0,
    talkTimer: 0,
    idleTimer: 0,
    lookFrame: 0,
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
  function phaseIsSpace() {
    var app = document.getElementById('app');
    return !app || app.dataset.phase === 'space';
  }

  /* ---------------- 分部件 SVG ----------------
     每个 g 都有自己的 transform-origin，CSS 里单独驱动 */
  var SVG = [
    '<svg viewBox="0 0 160 200" role="img" aria-hidden="true">',
    '  <ellipse class="bp-shadow" cx="80" cy="188" rx="38" ry="6"/>',

    '  <g class="bp-leg left">',
    '    <rect class="bp-limb" x="59.5" y="154" width="9" height="20" rx="4.5"/>',
    '    <ellipse class="bp-foot" cx="62" cy="177" rx="12" ry="8"/>',
    '  </g>',
    '  <g class="bp-leg right">',
    '    <rect class="bp-limb" x="91.5" y="154" width="9" height="20" rx="4.5"/>',
    '    <ellipse class="bp-foot" cx="98" cy="177" rx="12" ry="8"/>',
    '  </g>',

    '  <g class="bp-body">',
    '    <path class="bp-onesie" d="M52 118 Q52 106 64 106 H96 Q108 106 108 118 V154 Q108 174 80 174 Q52 174 52 154 Z"/>',
    '    <ellipse class="bp-belly" cx="80" cy="147" rx="19" ry="14"/>',
    '    <path class="bp-star" d="M80 132 l3.2 6.6 7.2 1 -5.2 5.1 1.2 7.2 -6.4-3.4 -6.4 3.4 1.2-7.2 -5.2-5.1 7.2-1 z"/>',
    '  </g>',

    '  <g class="bp-head-tilt">',
    '    <g class="bp-head">',
    '      <g class="bp-ear left">',
    '        <path class="bp-ear-outer" d="M42 52 Q36 23 61 36 Z"/>',
    '        <path class="bp-ear-inner" d="M47 46 Q45 32 57 39 Z"/>',
    '      </g>',
    '      <g class="bp-ear right">',
    '        <path class="bp-ear-outer" d="M118 52 Q124 23 99 36 Z"/>',
    '        <path class="bp-ear-inner" d="M113 46 Q115 32 103 39 Z"/>',
    '      </g>',
    '      <circle class="bp-face" cx="80" cy="80" r="46"/>',
    '      <g class="bp-ahoge"><path d="M80 35 Q82 19 92 15 Q104 12 100 24"/></g>',

    '      <g class="bp-eye left">',
    '        <ellipse class="bp-sclera" cx="63" cy="80" rx="8" ry="10"/>',
    '        <g class="bp-pupil">',
    '          <ellipse class="bp-pupil-dark" cx="63" cy="81" rx="5.4" ry="7.8"/>',
    '          <circle class="bp-glint" cx="61" cy="77" r="2.2"/>',
    '        </g>',
    '      </g>',
    '      <g class="bp-eye right">',
    '        <ellipse class="bp-sclera" cx="97" cy="80" rx="8.4" ry="10.4"/>',
    '        <g class="bp-pupil">',
    '          <ellipse class="bp-pupil-dark" cx="97" cy="81" rx="5.8" ry="8.2"/>',
    '          <circle class="bp-glint" cx="95" cy="76.5" r="2.3"/>',
    '        </g>',
    '      </g>',

    '      <ellipse class="bp-blush" cx="49" cy="96" rx="8.5" ry="4.5"/>',
    '      <ellipse class="bp-blush" cx="111" cy="96" rx="8.5" ry="4.5"/>',
    '      <path class="bp-mouth" d="M73 95 Q80 101 87 95"/>',
    '      <circle class="bp-drool" cx="91" cy="103" r="2.4"/>',
    '    </g>',
    '  </g>',
    '  <g class="bp-arm left">',
    '    <path class="bp-arm-limb" d="M52 122 Q44 134 46 150"/>',
    '    <circle class="bp-hand" cx="46" cy="152" r="5"/>',
    '  </g>',
    '  <g class="bp-arm right">',
    '    <path class="bp-arm-limb" d="M108 122 Q116 134 114 150"/>',
    '    <circle class="bp-hand" cx="114" cy="152" r="5"/>',
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

    if (isNight()) root.classList.add('is-night');
    restorePos();
    bindDrag();
    bindTap();
    bindLook();
    startBlink();
    startIdle();
    startTalking();
    watchNote();

    setTimeout(function () { if (!state.greeted) greet(); }, 12000);
    setTimeout(function () {
      if (state.pos) return;
      try {
        if (global.sessionStorage.getItem(HINT_KEY)) return;
        global.sessionStorage.setItem(HINT_KEY, '1');
      } catch (e) { /* 忽略 */ }
      say('可以把我拖走哦', 3400);
    }, 4500);
    setTimeout(restatePos, 300);
    global.addEventListener('resize', restatePos);
  }

  /* ---------------- 位置 ---------------- */
  function homeRect() { return spaceHome.getBoundingClientRect(); }

  function clampPos(left, top) {
    var h = homeRect();
    var w = root.offsetWidth || 72;
    var ph = root.offsetHeight || 86;
    var maxLeft = Math.max(8, h.width - w - 8);
    var maxTop = Math.max(8, h.height - ph - 74);
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
  function restatePos() { if (state.pos) place(state.pos.left, state.pos.top); }

  function restorePos() {
    var saved = null;
    try { saved = JSON.parse(global.localStorage.getItem(POS_KEY) || 'null'); } catch (e) { saved = null; }
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') place(saved.left, saved.top);
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
      clearMicro();
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

  /* ---------------- 点击 / 动作 ---------------- */
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
    if (now - state.lastActionAt < 700) return;
    state.lastActionAt = now;
    state.lastInteractAt = now;

    var pool = ACTIONS.filter(function (a) { return a !== state.lastAction; });
    var action = pool[Math.floor(Math.random() * pool.length)];
    state.lastAction = action;
    play(action);
    if (Math.random() < 0.72) say(pick(LINES.tap), 1900);
    if (Math.random() < 0.4) burst('heart', 3);
    else burst('spark', 2);
  }

  function play(action) {
    clearMicro();
    ACTIONS.forEach(function (name) { root.classList.remove(name); });
    void root.offsetWidth;
    root.classList.add(action);
    state.actionUntil = Date.now() + 1250;
    setTimeout(function () {
      root.classList.remove(action);
      state.actionUntil = Date.now() + 300;
    }, 1200);
  }

  /* ---------------- 待机小动作 ---------------- */
  function clearMicro() {
    ['is-ear-twitch', 'is-tilt', 'is-foot-tap', 'is-arm-sway'].forEach(function (name) {
      root.classList.remove(name);
    });
  }

  function startIdle() {
    function loop() {
      state.idleTimer = setTimeout(function () {
        if (canIdle()) micro();
        loop();
      }, rand(2400, 5200));
    }
    loop();
  }

  function canIdle() {
    if (document.hidden || state.drag) return false;
    if (!phaseIsSpace()) return false;
    if (document.body.classList.contains('memories-open')) return false;
    var panel = document.getElementById('bubuFeaturePanel');
    if (panel && !panel.hidden) return false;
    if (Date.now() < state.actionUntil) return false;
    return true;
  }

  function micro() {
    var roll = Math.random();
    if (roll < 0.30) twitch('is-ear-twitch', 420);
    else if (roll < 0.55) glance();
    else if (roll < 0.72) twitch('is-tilt', 900);
    else if (roll < 0.86) twitch('is-foot-tap', 520);
    else if (roll < 0.95) twitch('is-arm-sway', 720);
    else if (roll < 0.98) play('is-yawn');
    else play('is-hiccup');
  }

  function twitch(name, ms) {
    clearMicro();
    root.classList.add(name);
    setTimeout(function () { root.classList.remove(name); }, ms);
  }

  function glance() {
    var dx = (Math.random() < 0.5 ? -1 : 1) * rand(1.2, 2.4);
    setLook(dx, rand(-1, 1.2), dx * 1.4);
    setTimeout(function () { setLook(0, 0, 0); }, 900);
  }

  /* ---------------- 视线跟随 ---------------- */
  function setLook(x, y, turn) {
    root.style.setProperty('--look-x', x.toFixed(2) + 'px');
    root.style.setProperty('--look-y', y.toFixed(2) + 'px');
    root.style.setProperty('--head-turn', turn.toFixed(2) + 'deg');
  }

  function bindLook() {
    if (!global.addEventListener) return;
    spaceHome.addEventListener('pointermove', function (e) {
      if (state.drag || !phaseIsSpace()) return;
      if (state.lookFrame) return;
      state.lookFrame = global.requestAnimationFrame(function () {
        state.lookFrame = 0;
        var r = root.getBoundingClientRect();
        var cx = r.left + r.width / 2;
        var cy = r.top + r.height * 0.45;
        var dx = Math.max(-1.6, Math.min(1.6, (e.clientX - cx) / 160));
        var dy = Math.max(-1.4, Math.min(1.4, (e.clientY - cy) / 160));
        setLook(dx * 1.6, dy * 1.4, dx * 5);
      });
    }, { passive: true });
    spaceHome.addEventListener('pointerleave', function () { setLook(0, 0, 0); });
  }

  /* ---------------- 说话 ---------------- */
  function say(text, duration) {
    if (!text || !bubble) return;
    bubble.textContent = text;
    bubble.classList.add('is-on');
    root.classList.add('is-talk');
    clearTimeout(state.talkTimer);
    state.talkTimer = setTimeout(function () { root.classList.remove('is-talk'); }, 620);
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

    if (Math.random() < 0.22 && global.SpaceApp && SpaceApp.daysSince) {
      var days = 0;
      try { days = SpaceApp.daysSince(); } catch (e) { days = 0; }
      if (days > 0) return '宝宝陪你们第 ' + days + ' 天啦';
    }
    return pick(pool);
  }

  function canSpeak() {
    if (document.hidden) return false;
    if (!phaseIsSpace()) return false;
    if (document.body.classList.contains('memories-open')) return false;
    var panel = document.getElementById('bubuFeaturePanel');
    if (panel && !panel.hidden) return false;
    if (state.drag) return false;
    if (Date.now() - state.lastInteractAt < 45000) return false;
    return true;
  }

  function startTalking() {
    state.nextTalkAt = Date.now() + rand(100000, 180000);
    state.talkTimer = setInterval(function () {
      if (Date.now() < state.nextTalkAt) return;
      if (!canSpeak()) {
        state.nextTalkAt = Date.now() + 20000;
        return;
      }
      say(randomLine(), 3600);
      burst('heart', 1);
      state.nextTalkAt = Date.now() + rand(120000, 260000);
    }, 10000);
  }

  /* ---------------- 眨眼 ---------------- */
  function startBlink() {
    function schedule() {
      state.blinkTimer = setTimeout(function () {
        if (!document.hidden && phaseIsSpace()) {
          root.classList.add('is-blink');
          setTimeout(function () { root.classList.remove('is-blink'); }, 120);
        }
        schedule();
      }, rand(3200, 6800));
    }
    schedule();
  }

  /* ---------------- 爱心 / 星星 ---------------- */
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
