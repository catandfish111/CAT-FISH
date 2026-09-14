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
  var spaceHome = $('spaceHome');
  var openLetter = $('openLetter');
  var spaceBack = $('spaceBack');
  var spaceToast = $('spaceToast');
  var spaceMenu = $('spaceMenu');
  var bubuPet = $('bubuPet');

  /* ---------------- 流程状态 ---------------- */
  var TOKEN = {};        // 每次开信封换一个，旧流程的回调会自动作废
  var running = false;   // 信是否正在播放
  var step = null;       // 当前这一步：{ skip: fn }，没有就代表这一步不能跳过
  var typing = null;     // 当前打字任务
  var typingEls = [];    // 正在打字的元素（标题和正文可能同时在打）
  var busy = false;      // 防止连点跳过重复触发

  function enterLetter() {
    if (!app || app.dataset.phase !== 'space') return;
    app.dataset.phase = 'sealed';
    if (spaceHome) spaceHome.setAttribute('aria-hidden', 'true');
    sound.unlock();
  }

  function returnToSpace() {
    if (!app || app.dataset.phase !== 'sealed') return;
    app.dataset.phase = 'space';
    if (spaceHome) spaceHome.removeAttribute('aria-hidden');
    if (fx && fx.start) fx.start();
  }


  function showSpaceToast(message) {
    if (!spaceToast) return;
    spaceToast.textContent = message;
    spaceToast.classList.remove('is-visible');
    void spaceToast.offsetWidth;
    spaceToast.classList.add('is-visible');
    setTimeout(function () { spaceToast.classList.remove('is-visible'); }, 2400);
  }

  if (openLetter) openLetter.addEventListener('click', enterLetter);
  if (spaceBack) spaceBack.addEventListener('click', returnToSpace);
  /* ---------------- 布布网页端控制台 ----------------
     参考桌宠的窗口能力在网页里落成可触摸的动作库和工具面板。 */
  var bubuImage = $('bubuImage');
  var bubuActionChip = $('bubuActionChip');
  var bubuCountdown = $('bubuCountdown');
  var bubuCountdownMode = $('bubuCountdownMode');
  var bubuCountdownClock = $('bubuCountdownClock');
  var bubuFeaturePanel = $('bubuFeaturePanel');
  var bubuPanelTitle = $('bubuPanelTitle');
  var bubuPanelBody = $('bubuPanelBody');
  var bubuPanelClose = $('bubuPanelClose');
  var bubuContext = $('bubuContext');
  var bubuNoteWidget = $('bubuNoteWidget');
  var bubuNoteText = $('bubuNoteText');
  var bubuNoteClose = $('bubuNoteClose');
  var BUBU_STORE = 'catfish-bubu-room-v1';
  var BUBU_FALLBACK = 'assets/bubu/idle.gif';
  var BUBU_ACTIONS = [
    ['assets/bubu/一二咬布布.gif', '咬一口布布，今天也要黏在一起。', '咬布布'],
    ['assets/bubu/一二布布最最好.gif', '你们两个当然是最最好。', '最最好'],
    ['assets/bubu/一二布布跳舞.gif', '跳一支只属于我们的舞。', '跳舞'],
    ['assets/bubu/一二白眼.gif', '哼，这个表情只给你看。', '翻白眼'],
    ['assets/bubu/一二贴贴布布.gif', '贴贴，距离再近一点。', '贴贴'],
    ['assets/bubu/一二走路.gif', '一起走走，去看看今天的风。', '走路'],
    ['assets/bubu/一二遛狗.gif', '牵好绳子，出门散步啦。', '遛狗'],
    ['assets/bubu/举牌一二.gif', '我有一句话想举给你看。', '举牌'],
    ['assets/bubu/化妆一二.gif', '认真打扮一下，去见喜欢的人。', '化妆'],
    ['assets/bubu/吃汉堡一二.gif', '今天也要好好吃饭。', '吃汉堡'],
    ['assets/bubu/吃辣条一二.gif', '偷偷分享一根辣条。', '吃辣条'],
    ['assets/bubu/喝奶茶一二.gif', '奶茶要两杯，快乐要双份。', '喝奶茶'],
    ['assets/bubu/孙悟空一二，猪八戒布布.gif', '今天也要一起闯关。', '悟空与八戒'],
    ['assets/bubu/idle.gif', '安安静静陪着你。', '安静待机'],
    ['assets/bubu/开心一二.gif', '戳到我啦，开心一下。', '开心'],
    ['assets/bubu/开车一二宝.gif', '上车，带你去兜风。', '兜风'],
    ['assets/bubu/打扫卫生一二.gif', '把小空间收拾得亮晶晶。', '打扫卫生'],
    ['assets/bubu/敲鼓布布.gif', '咚咚咚，给你打节拍。', '敲鼓'],
    ['assets/bubu/无聊一二.gif', '有一点无聊，想找你玩。', '无聊'],
    ['assets/bubu/洗澡一二.gif', '洗香香，再来陪你。', '洗澡'],
    ['assets/bubu/涂口红一二.gif', '今天的可爱也要认真准备。', '涂口红'],
    ['assets/bubu/玩手机一二.gif', '刷到什么有趣的，记得分享给我。', '玩手机'],
    ['assets/bubu/生气一二.gif', '生气三秒，还是舍不得你。', '生气'],
    ['assets/bubu/看书一二.gif', '陪你安静读一会儿。', '看书'],
    ['assets/bubu/sleep.gif', '晚安，做个甜甜的梦。', '睡觉'],
    ['assets/bubu/睡觉觉一二.gif', '困困了，靠着你睡一会儿。', '困困'],
    ['assets/bubu/离家出走一二.gif', '我走两步就会想你。', '离家出走'],
    ['assets/bubu/荡秋千一二.gif', '荡到最高处，把心事告诉风。', '荡秋千'],
    ['assets/bubu/记录一二.gif', '把今天也记进我们的回忆。', '记录'],
    ['assets/bubu/跳草裙舞一二.gif', '海风来了，跳起来。', '草裙舞'],
    ['assets/bubu/蹦蹦跳跳一二.gif', '蹦蹦跳跳，烦恼都甩掉。', '蹦蹦跳跳'],
    ['assets/bubu/躺床上玩手机一二.gif', '今天就窝在被子里陪你。', '床上玩手机'],
    ['assets/bubu/锻炼一二.gif', '一起动一动，精神满满。', '锻炼'],
    ['assets/bubu/鬼脸.gif', '略略略，抓到我的小鬼脸了吗。', '鬼脸']
  ].map(function (item, index) { return { file: item[0], quote: item[1], display: item[2], index: index }; });

  /* 按序号取一个动作（越界就用待机那个） */
  function bubuActionAt(i) {
    var a = BUBU_ACTIONS[i];
    return (a && a.file) ? a : BUBU_ACTIONS[13];
  }

  var bubuData = {
    note: '', notePinned: false, reminders: [],
    timer: { running: false, mode: 'focus', duration: 1500, remaining: 1500, endsAt: 0 },
    settings: { quiet: false, auto: true, bubbles: true, sound: true }
  };
  try {
    var storedBubu = JSON.parse(localStorage.getItem(BUBU_STORE) || 'null');
    if (storedBubu && typeof storedBubu === 'object') {
      bubuData.note = typeof storedBubu.note === 'string' ? storedBubu.note : '';
      bubuData.notePinned = !!storedBubu.notePinned;
      bubuData.reminders = Array.isArray(storedBubu.reminders) ? storedBubu.reminders : [];
      bubuData.timer = Object.assign(bubuData.timer, storedBubu.timer || {});
      bubuData.settings = Object.assign(bubuData.settings, storedBubu.settings || {});
    }
  } catch (e) { /* 本地存储不可用时继续使用内存数据 */ }

  function saveBubuData() {
    try { localStorage.setItem(BUBU_STORE, JSON.stringify(bubuData)); } catch (e) { /* 忽略 */ }
  }
  /* 动作图现在是本地文件（assets/bubu/），不再依赖第三方仓库 */
  function bubuAsset(file) {
    return file;
  }
  function escapeBubuHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }
  function formatBubuSeconds(value) {
    var seconds = Math.max(0, Math.floor(Number(value) || 0));
    return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  }
  function bubuTimerRemaining() {
    if (!bubuData.timer.running) return bubuData.timer.remaining;
    return Math.max(0, Math.ceil((bubuData.timer.endsAt - Date.now()) / 1000));
  }
  function updateBubuCountdown() {
    var runningTimer = !!bubuData.timer.running;
    if (bubuCountdown) bubuCountdown.hidden = !runningTimer;
    if (!runningTimer) return;
    if (bubuCountdownMode) bubuCountdownMode.textContent = bubuData.timer.mode === 'break' ? '休息' : '专注';
    if (bubuCountdownClock) bubuCountdownClock.textContent = formatBubuSeconds(bubuTimerRemaining());
  }
  var bubuActionSeq = 0;
  var bubuLastActionAt = 0;
  var bubuAutoNextAt = Date.now() + 45000;
  function setBubuImage(action) {
    if (!bubuImage || !action) return;
    bubuImage.alt = '';   /* 不把名字当替代文字显示 */
    bubuImage.onerror = function () {
      bubuImage.onerror = null;
      bubuImage.src = BUBU_FALLBACK;
    };
    /* 使用稳定 URL，让手机复用已经下载过的 GIF 缓存。 */
    var src = bubuAsset(action.file);
    if (bubuImage.src !== src) bubuImage.src = src;
  }
  function showBubuAction(action, quote, duration) {
    action = action || BUBU_ACTIONS[13];
    var actionSeq = ++bubuActionSeq;
    bubuLastActionAt = Date.now();
    setBubuImage(action);
    /* 播放动作时不显示任何名字/文案——名字只在动作库面板里出现 */
    if (bubuActionChip) bubuActionChip.textContent = '';
    if (bubuPet) {
      bubuPet.classList.remove('is-happy', 'is-action');
      void bubuPet.offsetWidth;
      bubuPet.classList.add('is-action');
    }
    var note = bubuPet ? bubuPet.querySelector('.bubu-pet-note') : null;
    if (note) note.textContent = '';
    if (sound && sound.pop) sound.pop();
    var rect = bubuPet && bubuPet.getBoundingClientRect ? bubuPet.getBoundingClientRect() : null;
    if (rect && fx && fx.burstAt && bubuData.settings.bubbles) fx.burstAt(rect.left + rect.width * .5, rect.top + rect.height * .42, 'heart', 12);
    if (bubuPet) {
      bubuPet.classList.add('is-happy');
      setTimeout(function () { bubuPet.classList.remove('is-happy'); }, 760);
    }
    /* 有 duration 就在到点后回到待机（click 传 5000；自动轮换传 2200） */
    if (duration) setTimeout(function () {
      if (actionSeq !== bubuActionSeq) return;                    /* 已经被别的动作取代了 */
      if (bubuDrag) return;                                       /* 正在拖，先别打断 */
      if (bubuFeaturePanel && !bubuFeaturePanel.hidden) return;   /* 面板开着，保持不动 */
      if (bubuData.settings.quiet) return;                        /* 开了安静模式 */
      showBubuAction(bubuActionAt(13), '');
    }, duration);
  }
  /* 回到待机（不带动画、不发声，只把图换回去） */
  function bubuIdle() {
    var idle = BUBU_ACTIONS.filter(function (a) { return a.file === BUBU_FALLBACK; })[0] || bubuActionAt(13);
    bubuActionSeq += 1;
    setBubuImage(idle);
    if (bubuActionChip) bubuActionChip.textContent = '';
    var note = bubuPet ? bubuPet.querySelector('.bubu-pet-note') : null;
    if (note) note.textContent = '';
  }
  function renderBubuNoteWidget() {
    if (!bubuNoteWidget) return;
    if (bubuData.notePinned && bubuData.note.trim()) {
      bubuNoteWidget.hidden = false;
      if (bubuNoteText) bubuNoteText.textContent = bubuData.note;
    } else bubuNoteWidget.hidden = true;
  }
  function bubuCurrentPanel() {
    return bubuFeaturePanel && bubuFeaturePanel.getAttribute('data-panel') || 'actions';
  }
  function renderBubuPanel(panel) {
    if (!bubuPanelBody || !bubuPanelTitle) return;
    panel = panel || bubuCurrentPanel();
    var titles = { actions: '布布动作库', notes: '便签', timer: '番茄钟', reminders: '提醒', shortcuts: '快捷启动', settings: '设置' };
    bubuPanelTitle.textContent = titles[panel] || titles.actions;
    if (bubuFeaturePanel) bubuFeaturePanel.setAttribute('data-panel', panel);
    var tabs = document.querySelectorAll('[data-bubu-panel]');
    for (var t = 0; t < tabs.length; t++) tabs[t].classList.toggle('is-active', tabs[t].getAttribute('data-bubu-panel') === panel);
    if (panel === 'actions') {
      bubuPanelBody.innerHTML = '<div class="bubu-panel-intro"><span>全部动作</span><small>点选后布布会立刻换装</small></div><div class="bubu-action-grid">' +
        BUBU_ACTIONS.map(function (action, index) {
          return '<button class="bubu-action-item" type="button" data-bubu-action="' + index + '"><img loading="lazy" decoding="async" src="' + bubuAsset(action.file) + '" alt="' + escapeBubuHtml(action.file) + '"><span>' + escapeBubuHtml(action.display || action.file) + '</span></button>';
        }).join('') + '</div>';
    } else if (panel === 'notes') {
      bubuPanelBody.innerHTML = '<div class="bubu-panel-intro"><span>留一句给彼此</span><small>内容保存在这台设备的浏览器里</small></div><textarea class="bubu-field bubu-note-field" id="bubuNoteInput" rows="5" placeholder="写下今天想说的话……">' + escapeBubuHtml(bubuData.note) + '</textarea><div class="bubu-form-actions"><button class="bubu-primary" type="button" data-bubu-note-save>保存便签</button><button type="button" data-bubu-note-pin>' + (bubuData.notePinned ? '取消贴在首页' : '贴在首页') + '</button></div>';
    } else if (panel === 'timer') {
      var timerRemaining = bubuTimerRemaining();
      bubuPanelBody.innerHTML = '<div class="bubu-panel-intro"><span>一起专注一会儿</span><small>完成后布布会送你一段庆祝动作</small></div><div class="bubu-timer-card"><span class="bubu-timer-mode">' + (bubuData.timer.mode === 'break' ? '休息中' : '专注中') + '</span><strong id="bubuTimerClock">' + formatBubuSeconds(timerRemaining) + '</strong><label>分钟 <input class="bubu-number" id="bubuTimerMinutes" type="number" min="1" max="120" value="' + Math.max(1, Math.round((bubuData.timer.duration || 1500) / 60)) + '"></label></div><div class="bubu-form-actions"><button class="bubu-primary" type="button" data-bubu-timer-toggle>' + (bubuData.timer.running ? '暂停' : '开始') + '</button><button type="button" data-bubu-timer-reset>重置</button></div>';
    } else if (panel === 'reminders') {
      bubuPanelBody.innerHTML = '<div class="bubu-panel-intro"><span>温柔提醒</span><small>打开页面时会检查到期提醒</small></div><div class="bubu-reminder-form"><input class="bubu-field" id="bubuReminderText" type="text" placeholder="提醒内容"><input class="bubu-field" id="bubuReminderTime" type="datetime-local"><button class="bubu-primary" type="button" data-bubu-reminder-add>添加提醒</button></div><div class="bubu-reminder-list">' + (bubuData.reminders.length ? bubuData.reminders.map(function (item, index) { return '<div class="bubu-reminder-row"><span>' + escapeBubuHtml(item.text) + '<small>' + escapeBubuHtml(new Date(item.at).toLocaleString()) + '</small></span><button type="button" data-bubu-reminder-remove="' + index + '" aria-label="删除提醒">×</button></div>'; }).join('') : '<p class="bubu-empty">还没有提醒，给未来的你留一句话吧。</p>') + '</div>';
    } else if (panel === 'shortcuts') {
      bubuPanelBody.innerHTML = '<div class="bubu-panel-intro"><span>常用入口</span><small>把情侣空间里常用的事放在一起</small></div><div class="bubu-shortcut-list"><button type="button" data-bubu-shortcut="letter"><span>✉</span><b>写给你的信</b><small>打开分页信件</small></button><button type="button" data-bubu-shortcut="notes"><span>♡</span><b>留一句便签</b><small>记下今天的心情</small></button><button type="button" data-bubu-shortcut="random"><span>✦</span><b>随机动作</b><small>让布布自己选一个</small></button><button type="button" data-bubu-shortcut="wishes"><span>＋</span><b>愿望清单</b><small>把想一起做的事写下来</small></button></div>';
    } else {
      bubuPanelBody.innerHTML = '<div class="bubu-panel-intro"><span>布布偏好</span><small>调整后会自动保存在浏览器里</small></div><label class="bubu-setting"><span><b>安静模式</b><small>暂停自动动作和背景提示</small></span><input type="checkbox" data-bubu-setting="quiet" ' + (bubuData.settings.quiet ? 'checked' : '') + '></label><label class="bubu-setting"><span><b>自动待机轮换</b><small>让布布偶尔走路、跳舞和休息</small></span><input type="checkbox" data-bubu-setting="auto" ' + (bubuData.settings.auto ? 'checked' : '') + '></label><label class="bubu-setting"><span><b>爱心粒子</b><small>互动时撒出小爱心</small></span><input type="checkbox" data-bubu-setting="bubbles" ' + (bubuData.settings.bubbles ? 'checked' : '') + '></label><label class="bubu-setting"><span><b>轻音效</b><small>互动时播放轻轻的提示音</small></span><input type="checkbox" data-bubu-setting="sound" ' + (bubuData.settings.sound ? 'checked' : '') + '></label>';
    }
    updateBubuCountdown();
  }
  function openBubuPanel(panel) {
    if (!bubuFeaturePanel) return;
    if (bubuContext) bubuContext.hidden = true;
    bubuFeaturePanel.hidden = false;
    bubuFeaturePanel.classList.remove('is-opening');
    void bubuFeaturePanel.offsetWidth;
    bubuFeaturePanel.classList.add('is-opening');
    renderBubuPanel(panel || 'actions');
  }
  function closeBubuPanel() {
    if (bubuFeaturePanel) bubuFeaturePanel.hidden = true;
    if (bubuContext) bubuContext.hidden = true;
  }
  function randomBubuAction() {
    /* 随机换动作时不要抽到待机图，否则「点一下」会看着像没反应 */
    var pool = BUBU_ACTIONS.filter(function (a) { return a.file !== BUBU_FALLBACK; });
    if (!pool.length) pool = BUBU_ACTIONS;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function triggerBubuReminder(item) {
    showBubuAction(BUBU_ACTIONS[7], item.text, 5200);
    showSpaceToast('布布提醒你：' + item.text);
  }
  function checkBubuReminders() {
    var now = Date.now(), changed = false;
    for (var r = 0; r < bubuData.reminders.length; r++) {
      var reminder = bubuData.reminders[r];
      if (!reminder.done && Number(reminder.at) <= now) {
        reminder.done = true;
        changed = true;
        triggerBubuReminder(reminder);
      }
    }
    if (changed) { saveBubuData(); if (!bubuFeaturePanel || bubuCurrentPanel() !== 'reminders') return; renderBubuPanel('reminders'); }
  }
  function bubuTimerTick() {
    if (bubuData.timer.running) {
      var remain = bubuTimerRemaining();
      bubuData.timer.remaining = remain;
      if (remain <= 0) {
        bubuData.timer.running = false;
        bubuData.timer.remaining = 0;
        saveBubuData();
        showBubuAction(BUBU_ACTIONS[14], '', 4200);
        showSpaceToast('番茄钟完成，休息一下吧');
        if (!bubuFeaturePanel || bubuCurrentPanel() === 'timer') renderBubuPanel('timer');
      }
    }
    updateBubuCountdown();
    var timerClock = $('bubuTimerClock');
    if (timerClock) timerClock.textContent = formatBubuSeconds(bubuTimerRemaining());
  }
  function bubuStartTimer() {
    var minutesInput = $('bubuTimerMinutes');
    if (minutesInput && !bubuData.timer.running) bubuData.timer.duration = clamp(Number(minutesInput.value) * 60 || 1500, 60, 7200);
    if (bubuData.timer.remaining <= 0 || bubuData.timer.remaining > bubuData.timer.duration) bubuData.timer.remaining = bubuData.timer.duration;
    bubuData.timer.endsAt = Date.now() + bubuData.timer.remaining * 1000;
    bubuData.timer.running = true;
    saveBubuData();
    showBubuAction(BUBU_ACTIONS[28], '', 5000);
    renderBubuPanel('timer');
  }
  function bubuPauseTimer() {
    bubuData.timer.remaining = bubuTimerRemaining();
    bubuData.timer.running = false;
    saveBubuData();
    renderBubuPanel('timer');
  }
  function bubuResetTimer() {
    var minutesInput = $('bubuTimerMinutes');
    var duration = minutesInput ? clamp(Number(minutesInput.value) * 60 || bubuData.timer.duration, 60, 7200) : bubuData.timer.duration;
    bubuData.timer.duration = duration;
    bubuData.timer.remaining = duration;
    bubuData.timer.running = false;
    saveBubuData();
    renderBubuPanel('timer');
  }

  if (bubuFeaturePanel) bubuFeaturePanel.addEventListener('click', function (e) {
    var actionButton = e.target.closest ? e.target.closest('[data-bubu-action]') : null;
    if (actionButton) {
      var action = BUBU_ACTIONS[Number(actionButton.getAttribute('data-bubu-action'))] || BUBU_ACTIONS[13];
      showBubuAction(action, action.quote);
      closeBubuPanel();
      return;
    }
    if (e.target.closest && e.target.closest('[data-bubu-note-save]')) {
      var noteInput = $('bubuNoteInput');
      bubuData.note = noteInput ? noteInput.value.trim() : bubuData.note;
      bubuData.notePinned = true;
      saveBubuData(); renderBubuNoteWidget(); showSpaceToast('便签已经贴在首页啦'); return;
    }
    if (e.target.closest && e.target.closest('[data-bubu-note-pin]')) {
      var input = $('bubuNoteInput');
      if (input) bubuData.note = input.value.trim();
      bubuData.notePinned = !bubuData.notePinned;
      saveBubuData(); renderBubuNoteWidget(); renderBubuPanel('notes'); return;
    }
    if (e.target.closest && e.target.closest('[data-bubu-timer-toggle]')) {
      if (bubuData.timer.running) bubuPauseTimer(); else bubuStartTimer(); return;
    }
    if (e.target.closest && e.target.closest('[data-bubu-timer-reset]')) { bubuResetTimer(); return; }
    if (e.target.closest && e.target.closest('[data-bubu-reminder-add]')) {
      var textInput = $('bubuReminderText'), timeInput = $('bubuReminderTime');
      if (!textInput || !textInput.value.trim() || !timeInput || !timeInput.value) { showSpaceToast('把提醒内容和时间都填好哦'); return; }
      bubuData.reminders.push({ text: textInput.value.trim(), at: new Date(timeInput.value).getTime(), done: false });
      saveBubuData(); renderBubuPanel('reminders'); showSpaceToast('提醒收好啦'); return;
    }
    var removeReminder = e.target.closest ? e.target.closest('[data-bubu-reminder-remove]') : null;
    if (removeReminder) { bubuData.reminders.splice(Number(removeReminder.getAttribute('data-bubu-reminder-remove')), 1); saveBubuData(); renderBubuPanel('reminders'); return; }
    var shortcut = e.target.closest ? e.target.closest('[data-bubu-shortcut]') : null;
    if (shortcut) {
      var shortcutName = shortcut.getAttribute('data-bubu-shortcut');
      if (shortcutName === 'letter') { closeBubuPanel(); enterLetter(); }
      else if (shortcutName === 'notes') renderBubuPanel('notes');
      else if (shortcutName === 'random') { showBubuAction(randomBubuAction()); closeBubuPanel(); }
      else { closeBubuPanel(); showSpaceToast('愿望清单会和你们的故事一起长大'); }
    }
  });
  if (bubuFeaturePanel) bubuFeaturePanel.addEventListener('change', function (e) {
    var input = e.target.closest ? e.target.closest('[data-bubu-setting]') : null;
    if (!input) return;
    var key = input.getAttribute('data-bubu-setting');
    bubuData.settings[key] = !!input.checked;
    saveBubuData();
    if (key === 'quiet') bubuActionChip.textContent = input.checked ? '安静模式' : '安静待机';
    if (key === 'sound' && typeof sound !== 'undefined') { if (input.checked) sound.enable(); else sound.disable(); syncSoundButton(); }
    showSpaceToast(input.checked ? '已打开' : '已关闭');
  });
  var bubuTabButtons = document.querySelectorAll('[data-bubu-panel]');
  for (var bubuTabIndex = 0; bubuTabIndex < bubuTabButtons.length; bubuTabIndex++) (function (button) {
    button.addEventListener('click', function (e) { e.stopPropagation(); openBubuPanel(button.getAttribute('data-bubu-panel')); });
  })(bubuTabButtons[bubuTabIndex]);
  /* 捕获阶段兜底，避免页面其它点击逻辑影响功能栏切换。 */
  document.addEventListener('click', function (e) {
    var panelButton = e.target && e.target.closest ? e.target.closest('[data-bubu-panel]') : null;
    if (!panelButton || !panelButton.closest('#bubuFeaturePanel,#bubuContext')) return;
    e.preventDefault();
    openBubuPanel(panelButton.getAttribute('data-bubu-panel'));
  }, true);
  if (bubuPanelClose) bubuPanelClose.addEventListener('click', closeBubuPanel);
  if (bubuNoteClose) bubuNoteClose.addEventListener('click', function () { bubuData.notePinned = false; saveBubuData(); renderBubuNoteWidget(); });
  if (spaceMenu) spaceMenu.addEventListener('click', function () { openBubuPanel('settings'); });
  if (bubuContext) bubuContext.addEventListener('click', function (e) { var button = e.target.closest ? e.target.closest('[data-bubu-panel]') : null; if (button) openBubuPanel(button.getAttribute('data-bubu-panel')); });
  document.addEventListener('click', function (e) {
    if (bubuContext && !bubuContext.hidden && !e.target.closest('#bubuContext,#bubuPet')) bubuContext.hidden = true;
  });

  var spaceTools = document.querySelectorAll('[data-space-tool]');
  for (var spaceIndex = 0; spaceIndex < spaceTools.length; spaceIndex++) (function (button) {
    button.addEventListener('click', function () {
      var label = button.getAttribute('data-space-tool');
      var target = { memories: 'notes', calendar: 'reminders', wishes: 'shortcuts', settings: 'settings' }[label];
      if (target) openBubuPanel(target); else showSpaceToast('这个空间会慢慢长出更多故事');
    });
  })(spaceTools[spaceIndex]);

  var bubuClickTimer = 0, bubuLongTimer = 0, bubuLongTriggered = false, bubuSuppressClick = false, bubuDrag = null;
  function clearBubuLongTimer() { if (bubuLongTimer) { clearTimeout(bubuLongTimer); bubuLongTimer = 0; } }
  function placeBubu(left, top) {
    if (!bubuPet || !spaceHome) return;
    var homeRect = spaceHome.getBoundingClientRect(), petRect = bubuPet.getBoundingClientRect();
    var maxLeft = Math.max(8, homeRect.width - petRect.width - 8), maxTop = Math.max(8, homeRect.height - petRect.height - 8);
    left = clamp(left, 8, maxLeft); top = clamp(top, 8, maxTop);
    bubuPet.style.right = 'auto'; bubuPet.style.bottom = 'auto';
    bubuPet.style.left = left + 'px'; bubuPet.style.top = top + 'px';
  }
  function bubuInertia(vx, vy) {
    if (!bubuPet || !bubuDrag) return;
    var homeRect = spaceHome.getBoundingClientRect(), petRect = bubuPet.getBoundingClientRect();
    var left = petRect.left - homeRect.left, top = petRect.top - homeRect.top, frame = 0;
    function move() {
      vx *= .88; vy *= .88; left += vx * 16; top += vy * 16; placeBubu(left, top); frame += 1;
      if (frame < 28 && (Math.abs(vx) > .08 || Math.abs(vy) > .08)) requestAnimationFrame(move);
    }
    if (Math.abs(vx) > .08 || Math.abs(vy) > .08) requestAnimationFrame(move);
  }
  function openBubuContext(e) {
    if (!bubuContext) return;
    bubuContext.hidden = false;
    var homeRect = spaceHome.getBoundingClientRect();
    bubuContext.style.left = clamp(e.clientX - homeRect.left, 12, homeRect.width - 170) + 'px';
    bubuContext.style.top = clamp(e.clientY - homeRect.top, 12, homeRect.height - 210) + 'px';
  }
  if (bubuPet) {
    setBubuImage(BUBU_ACTIONS[13]);
    renderBubuNoteWidget();
    bubuPet.addEventListener('dragstart', function (e) { e.preventDefault(); });
    bubuPet.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      clearBubuLongTimer();
      bubuLongTriggered = false;
      var rect = bubuPet.getBoundingClientRect();
      bubuDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, left: rect.left, top: rect.top, moved: false, vx: 0, vy: 0, at: Date.now() };
      bubuLongTimer = setTimeout(function () { bubuLongTriggered = true; openBubuPanel('actions'); showSpaceToast('动作栏展开啦'); }, 640);
      try { bubuPet.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    });
    bubuPet.addEventListener('pointermove', function (e) {
      var drag = bubuDrag; if (!drag || drag.id !== e.pointerId) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.sqrt(dx * dx + dy * dy) < 5) return;
      clearBubuLongTimer(); drag.moved = true; bubuSuppressClick = true;
      var now = Date.now(), dt = Math.max(8, now - drag.at); drag.vx = (e.clientX - drag.lastX) / dt; drag.vy = (e.clientY - drag.lastY) / dt; drag.lastX = e.clientX; drag.lastY = e.clientY; drag.at = now;
      var homeRect = spaceHome.getBoundingClientRect(); placeBubu(drag.left + dx - homeRect.left, drag.top + dy - homeRect.top);
    });
    bubuPet.addEventListener('pointerup', function (e) {
      var drag = bubuDrag; if (!drag || drag.id !== e.pointerId) return;
      bubuDrag = null; clearBubuLongTimer();
      if (drag.moved) { showBubuAction(BUBU_ACTIONS[14], '', 5000); bubuInertia(drag.vx, drag.vy); setTimeout(function () { bubuSuppressClick = false; }, 40); }
      else if (bubuLongTriggered) setTimeout(function () { bubuLongTriggered = false; }, 0);
    });
    bubuPet.addEventListener('pointercancel', function () { bubuDrag = null; clearBubuLongTimer(); bubuSuppressClick = false; });
    bubuPet.addEventListener('dblclick', function (e) { e.preventDefault(); e.stopPropagation(); clearBubuLongTimer(); if (bubuClickTimer) { clearTimeout(bubuClickTimer); bubuClickTimer = 0; } openBubuPanel(bubuFeaturePanel && !bubuFeaturePanel.hidden ? 'actions' : 'actions'); });
    bubuPet.addEventListener('click', function (e) {
      e.stopPropagation(); clearBubuLongTimer();
      if (bubuSuppressClick || bubuLongTriggered) { bubuSuppressClick = false; return; }
      if (bubuClickTimer) clearTimeout(bubuClickTimer);
      /* 点一下：随机播一个动作，5 秒后自动回到待机 */
      bubuClickTimer = setTimeout(function () { bubuClickTimer = 0; showBubuAction(randomBubuAction(), '', 5000); }, 240);
    });
    bubuPet.addEventListener('contextmenu', function (e) { e.preventDefault(); e.stopPropagation(); clearBubuLongTimer(); openBubuContext(e); });
  }
  setInterval(function () {
    bubuTimerTick(); checkBubuReminders();
    var now = Date.now();
    if (now >= bubuAutoNextAt && !document.hidden && !bubuData.settings.quiet && bubuData.settings.auto && (!bubuFeaturePanel || bubuFeaturePanel.hidden) && (!app || app.dataset.phase === 'space') && !bubuDrag && now - bubuLastActionAt >= 30000) {
      showBubuAction(randomBubuAction(), null, 2200);
      bubuAutoNextAt = Date.now() + 45000 + Math.floor(Math.random() * 20000);
    }
  }, 1000);
  updateBubuCountdown();

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

  /* 手机轻触背景时，弹出一小簇有方向感的爱心。 */
  (function bindTapHearts() {
    var touchStart = null;
    var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    if (!isTouch) return;

    function isInteractive(target) {
      if (!target || !target.closest) return false;
      return !!target.closest('button,a,input,textarea,select,video,.env,.paper,.mascot,.duo,[data-slot]');
    }

    document.addEventListener('touchstart', function (e) {
      var t = e.touches && e.touches[0];
      if (t) touchStart = { x: t.clientX, y: t.clientY };
    }, { passive: true });

    document.addEventListener('touchend', function (e) {
      var t = e.changedTouches && e.changedTouches[0];
      if (!t || !touchStart) return;
      var dx = t.clientX - touchStart.x;
      var dy = t.clientY - touchStart.y;
      var moved = Math.sqrt(dx * dx + dy * dy);
      touchStart = null;
      if (moved > 16 || isInteractive(e.target)) return;
      fx.burstAt(t.clientX, t.clientY, 'heart', 8);
    }, { passive: true });
  })();

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
    '<svg viewBox="0 0 112 96" role="img" aria-label="可爱的小鱼">' +
      '<g class="mst-tail" fill="#f3a7bd" stroke="#d97f9c" stroke-width="1.4" stroke-linejoin="round">' +
        '<path d="M80 48c10-14 20-21 30-24-4 9-6 16-6 24s2 15 6 24c-10-3-20-10-30-24Z"/>' +
      '</g>' +
      '<g class="mst-fin" fill="#ffbdc8" stroke="#df8099" stroke-width="1.5" stroke-linejoin="round">' +
        '<path d="M42 21c3-12 12-18 23-19-1 10-5 18-13 24Z"/>' +
        '<path d="M45 73c-4 10-12 15-22 15 3-9 8-15 16-19Z"/>' +
        '<path d="M17 48c-9-5-14-12-14-21 9 2 16 8 20 17Z"/>' +
      '</g>' +
      '<ellipse cx="50" cy="51" rx="35" ry="31" fill="url(#gFish)" stroke="#dd784a" stroke-width="1.8"/>' +
      '<ellipse cx="50" cy="59" rx="23" ry="16" fill="#ffe7c8" opacity=".33"/>' +
      '<path d="M25 29c13-10 32-12 47-4-15 0-32 4-47 12Z" fill="#ffe8cf" opacity=".7"/>' +
      '<ellipse class="mst-eye" cx="39.5" cy="47" rx="6.2" ry="7.2" fill="#fff"/>' +
      '<ellipse class="mst-eye mst-eye-b" cx="60.5" cy="47" rx="6.2" ry="7.2" fill="#fff"/>' +
      '<ellipse cx="40" cy="48" rx="3.5" ry="4.4" fill="#4a2b16"/>' +
      '<ellipse cx="61" cy="48" rx="3.5" ry="4.4" fill="#4a2b16"/>' +
      '<circle cx="38.8" cy="46.2" r="1.5" fill="#fff"/>' +
      '<circle cx="59.8" cy="46.2" r="1.5" fill="#fff"/>' +
      '<ellipse cx="28" cy="59" rx="7" ry="4.5" fill="#ff829b" opacity=".52"/>' +
      '<ellipse cx="72" cy="59" rx="7" ry="4.5" fill="#ff829b" opacity=".52"/>' +
      '<path d="M50 54 46.7 57.5h6.6Z" fill="#db6682"/>' +
      '<path d="M44 61c2.2 4.2 9.8 4.2 12 0" fill="none" stroke="#7a3b35" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M47 37c2-2 4-2 6 0M59 37c2-2 4-2 6 0" fill="none" stroke="#c95c46" stroke-width="1.8" stroke-linecap="round" opacity=".7"/>' +
      '<path d="M50 15c-4-5-3-10 2-13 1 5 4 8 9 9-2 4-6 5-11 4Z" fill="#ffe79a" stroke="#e5ad5b" stroke-width="1.2"/>' +
      '<path d="M86 37c4-4 8-5 12-4M88 63c4 4 8 5 12 4" fill="none" stroke="#f7c17d" stroke-width="2" stroke-linecap="round" opacity=".85"/>' +
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

  var catSpeech = null;
  var catSpeechTimer = 0;
  var catSpeechOutTimer = 0;
  function speakCat() {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return;
    try {
      window.speechSynthesis.cancel();
      var utterance = new window.SpeechSynthesisUtterance('有没有想我呀');
      utterance.lang = 'zh-CN';
      utterance.pitch = 1.35;
      utterance.rate = 0.9;
      utterance.volume = 0.85;
      window.speechSynthesis.speak(utterance);
    } catch (e) { /* 某些微信内置浏览器没有可用的语音引擎 */ }
  }
  function showCatSpeech(target) {
    if (!target || !document.body) return;
    if (!catSpeech) {
      catSpeech = document.createElement('div');
      catSpeech.className = 'cat-speech';
      catSpeech.setAttribute('role', 'status');
      catSpeech.setAttribute('aria-live', 'polite');
      catSpeech.textContent = '有没有想我呀';
      document.body.appendChild(catSpeech);
    }
    if (catSpeechTimer) clearTimeout(catSpeechTimer);
    if (catSpeechOutTimer) clearTimeout(catSpeechOutTimer);
    catSpeech.classList.remove('is-leaving', 'is-left');
    catSpeech.classList.add('is-visible');
    var rect = target.getBoundingClientRect ? target.getBoundingClientRect() : null;
    if (!rect) return;
    var gap = 10;
    var bubbleWidth = Math.min(168, Math.max(132, window.innerWidth - 28));
    var left = rect.right + gap;
    if (left + bubbleWidth > window.innerWidth - 12) left = rect.left - bubbleWidth - gap;
    var placedLeft = left < rect.left;
    if (left < 12) {
      left = clamp(rect.left + rect.width / 2 - bubbleWidth / 2, 12, window.innerWidth - bubbleWidth - 12);
      placedLeft = false;
    }
    if (placedLeft) catSpeech.classList.add('is-left');
    var top = rect.top + rect.height * 0.16;
    top = clamp(top, 14, window.innerHeight - 58);
    catSpeech.style.width = bubbleWidth + 'px';
    catSpeech.style.left = left + 'px';
    catSpeech.style.top = top + 'px';
    catSpeechTimer = setTimeout(function () {
      catSpeech.classList.remove('is-visible');
      catSpeech.classList.add('is-leaving');
      catSpeechOutTimer = setTimeout(function () {
        if (catSpeech) catSpeech.classList.remove('is-leaving');
      }, 420);
    }, 2900);
  }
  function reactToCat(el) {
    cheer(el, 'heart');
    showCatSpeech(el);
    speakCat();
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
  if (mascotCat) mascotCat.addEventListener('click', function (e) { e.stopPropagation(); reactToCat(mascotCat); });
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
      if (shown.getAttribute('data-kind') === 'cat') reactToCat(shown);
      else cheer(shown, 'bubble');
    });
  }
  /* 落款处的两个形象也可以点 */
  var duo = document.querySelector ? document.querySelector('.duo') : null;
  if (duo) {
    duo.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-slot]') : null;
      if (!t) return;
      if (t.getAttribute('data-slot') === 'cat') reactToCat(t);
      else cheer(t, 'bubble');
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
    v.muted = false;
    v.loop = !!CFG.video.loop;
    if (stage.poster) v.setAttribute('poster', stage.poster);
    v.src = absUrl(stage.video);
    frame.appendChild(v);

    var play = document.createElement('button');
    play.type = 'button';
    play.className = 'video-play';
    play.setAttribute('aria-label', '播放视频');
    play.hidden = false;
    play.innerHTML = '<span class="vp-ring"></span><svg viewBox="0 0 24 24"><path d="M8 5.5l11 6.5-11 6.5z"/></svg><span class="video-play-label">开始</span>';
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
      c.video.muted = false;
      c.sound.classList.remove('is-off');
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
      if (!v.paused) {
        try { v.pause(); } catch (e) { /* ignore */ }
      }
      c.play.hidden = false;
    });
    function startPoll() {
      if (timer) return;
      var ticks = 0;
      timer = setInterval(function () {
        ticks += 1;
        if (done || stopped) { clearInterval(timer); timer = 0; return; }
        if (!ready && (v.readyState >= 3 || v.videoWidth)) markReady();
        if (ready && v.paused && !v.ended) c.play.hidden = false;
      }, 450);
    }

    try { v.load(); } catch (e) { /* 忽略 */ }
    startPoll();
    c.sound.style.display = 'grid';
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
    cineVideo.muted = false;
    cineVideo.loop = !!CFG.video.loop;
    cinePlay.hidden = false;
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
        cineVideo.muted = false;
        cinePlay.hidden = true;
        setRate(cineVideo);
        playOut(cineVideo, function () { cinePlay.hidden = false; });
      };
      cineVideo.onclick = function () {
        if (!cineVideo.paused) {
          try { cineVideo.pause(); } catch (e) { /* ignore */ }
        }
        cinePlay.hidden = false;
      };
      cineVideo.onended = finish;
      step = { skip: finish };
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
      var shouldTurn = i > 0;

      function render() {
        if (tk !== TOKEN || !running) return;
        paperScroll.classList.remove('page-turning');
        if (i >= stages.length) { finale(tk); return; }

        var stage = stages[i];
        i += 1;
        var hasVideo = !!(stage.video || '').trim();
        setStageHead(i - 1, stage);
        unmountVideo();
        /* 每页都有自己的打字缓存，标题不会带入上一页的内容。 */
        [elTitle, elBody, elBody2].forEach(function (el) {
          el._typed = '';
          el.innerHTML = '';
        });
        paperScroll.scrollTop = 0;
        setSkip(false);
        step = null;
        var mascotReady = showMascot(stage.mascot || pickMascot(i - 1));
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

      if (!shouldTurn) {
        render();
        return;
      }
      paperScroll.classList.add('page-turning');
      setTimeout(render, REDUCED ? 30 : 260);
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
      app.dataset.phase = 'space';
      if (spaceHome) spaceHome.removeAttribute('aria-hidden');
      envHint.style.animation = 'none';
      void envHint.offsetWidth;   /* 强制回流，重播呼吸动画 */
      envHint.style.animation = '';
      fx.start();
    });
  }
  btnClose.addEventListener('click', closeLetter);
})();
