/* ============================================================
   「我们的回忆」独立页面
   ------------------------------------------------------------
   入口：首页「我们的回忆」卡 / 底部导航「回忆」/ 布布菜单
   数据：Space 的 memories 文档 + PhotoStore 的照片（加密存在 data 分支）
   返回：写入一条 history，微信/浏览器返回键先关页面，不退出站点
   ============================================================ */
(function (global) {
  'use strict';

  var S = global.Space;
  var PS = global.PhotoStore;
  var IDENTITIES = { cat: '小猫', fish: '小鱼', us: '我们' };
  var IDENTITY_KEY = 'catfish-identity-v1';
  var DRAFT_KEY = 'catfish-memories-draft-v1';
  var FILTERS = [
    { key: 'all', label: '全部' },
    { key: 'photo', label: '有照片' },
    { key: 'text', label: '只有文字' },
    { key: 'mine', label: '我写的' }
  ];

  var page = null;
  var els = {};
  var state = {
    filter: 'all',
    view: 'timeline',
    detailId: '',
    editingId: '',
    pendingPhoto: null,
    editPhotoName: '',
    originalPhotoName: '',
    saving: false,
    undo: null,
    toastTimer: 0,
    inited: false
  };

  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function identity() {
    try {
      var v = global.localStorage.getItem(IDENTITY_KEY) || '';
      return IDENTITIES[v] ? v : 'us';
    } catch (e) { return 'us'; }
  }
  function setIdentity(key) {
    try { global.localStorage.setItem(IDENTITY_KEY, key); } catch (e) { /* 忽略 */ }
  }
  function whoLabel(k) { return IDENTITIES[k] || '我们'; }
  function whoChar(k) { return k === 'cat' ? '猫' : k === 'fish' ? '鱼' : '♡'; }

  function monthLabel(ts) { var d = new Date(ts); return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月'; }
  function dayLabel(ts) { var d = new Date(ts); return (d.getMonth() + 1) + '/' + pad(d.getDate()); }
  function timeLabel(ts) { var d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fullDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · ' + timeLabel(ts);
  }
  function dateInputValue(ts) {
    var d = new Date(ts || Date.now());
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* ---------------- 数据 ---------------- */
  function items() {
    var doc = (S && S.get && S.get('memories')) || {};
    var arr = Array.isArray(doc.items) ? doc.items : [];
    return arr.filter(function (m) { return m && typeof m === 'object'; }).map(function (m) {
      return {
        id: String(m.id || ''),
        at: Number(m.at) || 0,
        title: String(m.title || ''),
        text: String(m.text || ''),
        photoName: String(m.photoName || ''),
        place: String(m.place || ''),
        by: IDENTITIES[m.by] ? m.by : 'us'
      };
    }).sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
  }
  function write(updater) {
    if (!S) return Promise.reject(new Error('数据层还没准备好'));
    return (typeof S.apply === 'function') ? S.apply('memories', updater) : S.mutate('memories', updater);
  }
  function syncHome() {
    try { if (global.SpaceApp && SpaceApp.refreshUI) SpaceApp.refreshUI(); } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 页面骨架 ---------------- */
  function init() {
    if (state.inited) return;
    state.inited = true;

    var section = document.createElement('section');
    section.className = 'memories-page';
    section.id = 'memoriesPage';
    section.hidden = true;
    section.setAttribute('aria-label', '我们的回忆');
    section.innerHTML = [
      '<div class="mp-shell">',
      '  <header class="mp-head">',
      '    <button class="mp-round" type="button" id="mpBack" aria-label="返回空间">',
      '      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      '    </button>',
      '    <div class="mp-title"><b>我们的回忆</b><small>MEMORIES</small></div>',
      '    <button class="mp-add" type="button" id="mpAddTop" aria-label="添加回忆">+</button>',
      '  </header>',
      '  <div class="mp-scroll" id="mpScroll">',
      '    <section class="mp-summary">',
      '      <p class="mp-eyebrow">OUR LITTLE ARCHIVE</p>',
      '      <h2>把喜欢的每一天，<br>一张一张收好</h2>',
      '      <p class="mp-sub">照片加密后存在仓库里，只有你们两个人的空间密码能打开。</p>',
      '      <div class="mp-stats">',
      '        <span><b id="mpCount">0</b><small>全部回忆</small></span>',
      '        <span><b id="mpPhotoCount">0</b><small>带照片</small></span>',
      '        <span><b id="mpSince">—</b><small>从这天开始</small></span>',
      '      </div>',
      '    </section>',
      '    <div class="mp-chips" id="mpChips"></div>',
      '    <div class="mp-viewbar">',
      '      <div class="mp-seg" role="tablist" aria-label="浏览方式">',
      '        <button type="button" class="is-on" data-mp-view="timeline" role="tab" aria-selected="true">时间轴</button>',
      '        <button type="button" data-mp-view="album" role="tab" aria-selected="false">相册</button>',
      '      </div>',
      '      <span class="mp-sort">最新在前</span>',
      '    </div>',
      '    <div id="mpList"></div>',
      '  </div>',
      '  <button class="mp-fab" type="button" id="mpAdd"><b>+</b> 记一段</button>',
      '</div>',

      '<section class="mp-detail" id="mpDetail" hidden aria-label="回忆详情">',
      '  <div class="mp-detail-scroll" id="mpDetailScroll"></div>',
      '</section>',

      '<section class="mp-editor" id="mpEditor" hidden aria-label="写一段回忆">',
      '  <header class="mp-ed-head">',
      '    <button type="button" id="mpCancel">取消</button>',
      '    <b id="mpEdTitle">新回忆</b>',
      '    <button type="button" class="mp-save" id="mpSave" disabled>保存</button>',
      '  </header>',
      '  <div class="mp-ed-scroll">',
      '    <div class="mp-pick" id="mpPick" role="button" tabindex="0" aria-label="添加一张照片">',
      '      <div class="mp-pick-empty" id="mpPickEmpty"><span class="mp-pick-plus">+</span><em>添加一张照片</em></div>',
      '      <img class="mp-pick-img" id="mpPickImg" alt="" hidden>',
      '      <button type="button" class="mp-pick-remove" id="mpPickRemove" aria-label="移除照片" hidden>×</button>',
      '    </div>',
      '    <input type="file" id="mpFile" accept="image/*" hidden>',
      '    <div class="mp-field">',
      '      <label for="mpTitle">标题 <span class="mp-count" id="mpTitleCount">0/40</span></label>',
      '      <input id="mpTitle" type="text" maxlength="40" placeholder="给这段回忆起个名字" autocomplete="off">',
      '    </div>',
      '    <div class="mp-field">',
      '      <label for="mpText">那天发生了什么 <span class="mp-count" id="mpTextCount">0/300</span></label>',
      '      <textarea id="mpText" maxlength="300" placeholder="风很大，你把围巾分了我一半……"></textarea>',
      '    </div>',
      '    <div class="mp-field-row">',
      '      <div class="mp-field"><label for="mpDate">日期</label><input id="mpDate" type="date"></div>',
      '      <div class="mp-field"><label for="mpPlace">地点 <span class="mp-count">可选</span></label><input id="mpPlace" type="text" maxlength="20" placeholder="在哪"></div>',
      '    </div>',
      '    <div class="mp-field">',
      '      <label>这一条是谁写的</label>',
      '      <div class="mp-who" id="mpWho" role="group" aria-label="作者">',
      '        <button type="button" data-who="cat"><i class="mp-dot cat"></i>小猫</button>',
      '        <button type="button" data-who="fish"><i class="mp-dot fish"></i>小鱼</button>',
      '        <button type="button" data-who="us"><i class="mp-dot us"></i>我们</button>',
      '      </div>',
      '    </div>',
      '    <p class="mp-hint"><b>照片会先压到长边 1400 像素</b>，再用空间密码加密提交进仓库；没贴写入密钥也能先写文字。</p>',
      '  </div>',
      '</section>',

      '<div class="mp-backdrop" id="mpBackdrop" hidden></div>',
      '<div class="mp-sheet" id="mpConfirm" hidden role="dialog" aria-modal="true" aria-labelledby="mpConfirmTitle">',
      '  <span class="mp-grab" aria-hidden="true"></span>',
      '  <h3 id="mpConfirmTitle">删掉这段回忆？</h3>',
      '  <p>文字和照片会一起从仓库里删除。<br>删掉后还有 5 秒可以撤销。</p>',
      '  <div class="mp-sheet-row"><button type="button" id="mpConfirmKeep">再想想</button><button type="button" class="mp-danger" id="mpConfirmDel">删掉</button></div>',
      '</div>',
      '<div class="mp-toast" id="mpToast" role="status" aria-live="polite"></div>'
    ].join('');

    document.body.appendChild(section);
    page = section;

    els.back = $('mpBack');
    els.addTop = $('mpAddTop');
    els.add = $('mpAdd');
    els.scroll = $('mpScroll');
    els.count = $('mpCount');
    els.photoCount = $('mpPhotoCount');
    els.since = $('mpSince');
    els.chips = $('mpChips');
    els.list = $('mpList');
    els.detail = $('mpDetail');
    els.detailScroll = $('mpDetailScroll');
    els.editor = $('mpEditor');
    els.edHeading = $('mpEdTitle');
    els.cancel = $('mpCancel');
    els.save = $('mpSave');
    els.pick = $('mpPick');
    els.pickEmpty = $('mpPickEmpty');
    els.pickImg = $('mpPickImg');
    els.pickRemove = $('mpPickRemove');
    els.file = $('mpFile');
    els.title = $('mpTitle');
    els.text = $('mpText');
    els.date = $('mpDate');
    els.place = $('mpPlace');
    els.who = $('mpWho');
    els.titleCount = $('mpTitleCount');
    els.textCount = $('mpTextCount');
    els.backdrop = $('mpBackdrop');
    els.confirm = $('mpConfirm');
    els.confirmKeep = $('mpConfirmKeep');
    els.confirmDel = $('mpConfirmDel');
    els.toast = $('mpToast');

    els.chips.innerHTML = FILTERS.map(function (f) {
      return '<button type="button" class="mp-chip' + (f.key === 'all' ? ' is-on' : '') + '" data-filter="' + f.key + '" role="tab" aria-selected="' + (f.key === 'all') + '">' + f.label + ' <b>0</b></button>';
    }).join('');

    bind();
    if (S && S.on) {
      S.on('change', function (e) {
        if (!page || page.hidden) return;
        if (e && e.key && e.key !== 'memories' && e.key !== 'media') return;
        render();
        if (state.detailId) renderDetail(state.detailId);
      });
    }
  }

  /* ---------------- 列表 ---------------- */
  function counts(list) {
    var c = { all: list.length, photo: 0, text: 0, mine: 0 };
    list.forEach(function (m) {
      if (m.photoName) c.photo += 1; else c.text += 1;
      if (m.by === identity()) c.mine += 1;
    });
    return c;
  }
  function filtered() {
    var list = items();
    if (state.filter === 'photo') list = list.filter(function (m) { return !!m.photoName; });
    if (state.filter === 'text') list = list.filter(function (m) { return !m.photoName; });
    if (state.filter === 'mine') list = list.filter(function (m) { return m.by === identity(); });
    return list;
  }

  function cardHTML(m) {
    var photo = m.photoName
      ? '<div class="mp-card-photo"><img loading="lazy" decoding="async" data-photo="' + esc(m.photoName) + '" alt="' + esc(m.title || '回忆') + '"><span class="mp-day">' + dayLabel(m.at) + '</span></div>'
      : '<div class="mp-card-photo is-paper"><span class="mp-quote" aria-hidden="true">“</span><span class="mp-day">' + dayLabel(m.at) + '</span></div>';
    return '<article class="mp-card" role="button" tabindex="0" data-id="' + esc(m.id) + '" aria-label="' + esc(m.title || '一段回忆') + '">' +
      photo +
      '<div class="mp-card-body">' +
        '<h3>' + esc(m.title || (m.photoName ? '一段回忆' : '记一笔')) + '</h3>' +
        (m.text ? '<p>' + esc(m.text) + '</p>' : '') +
        '<div class="mp-card-meta">' +
          '<span class="mp-who-chip ' + esc(m.by) + '"><i>' + whoChar(m.by) + '</i>' + whoLabel(m.by) + '</span>' +
          '<span class="mp-sep">·</span><span>' + timeLabel(m.at) + '</span>' +
          (m.place ? '<span class="mp-sep">·</span><span>' + esc(m.place) + '</span>' : '') +
          (m.photoName ? '' : '<span class="mp-sep">·</span><span>只写了文字</span>') +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function timelineHTML(list) {
    var html = '';
    var last = '';
    list.forEach(function (m) {
      var key = new Date(m.at).getFullYear() + '-' + new Date(m.at).getMonth();
      if (key !== last) {
        var count = list.filter(function (x) {
          var d = new Date(x.at);
          return d.getFullYear() + '-' + d.getMonth() === key;
        }).length;
        html += '<div class="mp-month"><i></i><b>' + monthLabel(m.at) + '</b><small>' + count + ' 段</small></div>';
        last = key;
      }
      html += cardHTML(m);
    });
    return html;
  }

  function albumHTML(list) {
    var html = '<div class="mp-album">';
    list.forEach(function (m) {
      if (m.photoName) {
        html += '<div class="mp-tile" role="button" tabindex="0" data-id="' + esc(m.id) + '" aria-label="' + esc(m.title || '一段回忆') + '">' +
          '<img loading="lazy" decoding="async" data-photo="' + esc(m.photoName) + '" alt="' + esc(m.title || '回忆') + '">' +
          '<span class="mp-tile-label">' + dayLabel(m.at) + ' · ' + esc(m.title || '一段回忆') + '</span></div>';
      } else {
        html += '<div class="mp-tile is-paper" role="button" tabindex="0" data-id="' + esc(m.id) + '" aria-label="' + esc(m.title || '一段回忆') + '">' +
          '<span class="mp-quote">“</span><span class="mp-tile-label">' + dayLabel(m.at) + ' · 文字</span></div>';
      }
    });
    return html + '</div>';
  }

  function emptyHTML() {
    var isAll = state.filter === 'all';
    return '<div class="mp-empty"><span class="mp-empty-icon">♡</span>' +
      '<b>' + (isAll ? '还没有回忆' : '这里还是空的') + '</b>' +
      '<p>' + (isAll ? '放一张照片、写一段话，它会被加密存起来，两个人都能看到。' : '换个筛选看看，或者现在就记一段新的。') + '</p>' +
      '<button type="button" class="mp-empty-cta" data-new>+ 记第一段</button></div>';
  }

  function render() {
    if (!page) return;
    var list = items();
    var c = counts(list);
    els.count.textContent = String(c.all);
    els.photoCount.textContent = String(c.photo);
    els.since.textContent = list.length ? (function () {
      var d = new Date(list[list.length - 1].at);
      return d.getFullYear() + '.' + pad(d.getMonth() + 1);
    })() : '—';

    els.chips.querySelectorAll('[data-filter]').forEach(function (chip) {
      var key = chip.getAttribute('data-filter');
      chip.classList.toggle('is-on', key === state.filter);
      chip.setAttribute('aria-selected', key === state.filter ? 'true' : 'false');
      chip.querySelector('b').textContent = c[key];
    });
    document.querySelectorAll('[data-mp-view]').forEach(function (b) {
      var on = b.getAttribute('data-mp-view') === state.view;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    var shown = filtered();
    els.add.hidden = shown.length === 0;
    els.list.innerHTML = shown.length ? (state.view === 'album' ? albumHTML(shown) : timelineHTML(shown)) : emptyHTML();

    els.list.querySelectorAll('[data-id]').forEach(function (el) {
      el.addEventListener('click', function () { openDetail(el.getAttribute('data-id')); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(el.getAttribute('data-id')); }
      });
    });
    var cta = els.list.querySelector('[data-new]');
    if (cta) cta.addEventListener('click', function () { openEditor(); });

    if (PS && PS.hydrate) PS.hydrate(els.list);
  }

  /* ---------------- 详情 ---------------- */
  function findItem(id) {
    var all = items();
    for (var i = 0; i < all.length; i += 1) if (all[i].id === id) return all[i];
    return null;
  }
  function openDetail(id) {
    var m = findItem(id);
    if (!m) return;
    state.detailId = id;
    renderDetail(id);
    els.detail.hidden = false;
    els.detail.classList.add('is-open');
    els.detailScroll.scrollTop = 0;
  }
  function renderDetail(id) {
    var m = findItem(id);
    if (!m) return;
    var hero = m.photoName
      ? '<div class="mp-hero"><img id="mpHeroImg" alt="' + esc(m.title || '回忆') + '">' +
          '<button type="button" class="mp-hero-back" id="mpDetailBack" aria-label="返回列表">' +
          '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
          '<span class="mp-lock">已加密</span></div>'
      : '<div class="mp-hero is-paper"><span class="mp-quote-big">“</span>' +
          '<button type="button" class="mp-hero-back" id="mpDetailBack" aria-label="返回列表">' +
          '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
          '<span class="mp-lock">已加密</span></div>';

    els.detailScroll.innerHTML = hero +
      '<div class="mp-detail-card">' +
        '<p class="mp-eyebrow">' + fullDate(m.at) + '</p>' +
        '<h1>' + esc(m.title || (m.photoName ? '一段回忆' : '记一笔')) + '</h1>' +
        '<div class="mp-byline"><span class="mp-av">' + whoChar(m.by) + '</span>' + whoLabel(m.by) + ' 写的' +
          (m.place ? '<span class="mp-sep">·</span><span>' + esc(m.place) + '</span>' : '') + '</div>' +
        (m.text ? '<div class="mp-prose"><p>' + esc(m.text) + '</p></div>' : '') +
        '<div class="mp-actions"><button type="button" id="mpEdit">编辑</button><button type="button" class="mp-danger" id="mpDelete">删除</button></div>' +
        '<p class="mp-foot">这段文字和照片都以密文存在 data 分支</p>' +
      '</div>';

    var img = $('mpHeroImg');
    if (img && PS) {
      PS.url(m.photoName).then(function (src) {
        if (src) img.src = src;
        else img.parentNode.classList.add('is-missing');
      }, function () { img.parentNode.classList.add('is-missing'); });
    }
    $('mpDetailBack').addEventListener('click', closeDetail);
    $('mpEdit').addEventListener('click', function () { openEditor(m); });
    $('mpDelete').addEventListener('click', askDelete);
  }
  function closeDetail() {
    state.detailId = '';
    els.detail.classList.remove('is-open');
    els.detail.hidden = true;
  }

  /* ---------------- 编辑 ---------------- */
  function currentWho() {
    var on = els.who.querySelector('.is-on');
    return on ? on.getAttribute('data-who') : identity();
  }
  function setWho(k) {
    els.who.querySelectorAll('[data-who]').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-who') === k);
    });
  }
  function setPhotoUI(src) {
    var has = !!src;
    els.pickEmpty.hidden = has;
    els.pickImg.hidden = !has;
    els.pickRemove.hidden = !has;
    if (has) els.pickImg.src = src;
    else els.pickImg.removeAttribute('src');
    els.pick.classList.toggle('has-photo', has);
  }
  function updateCounts() {
    els.titleCount.textContent = els.title.value.length + '/40';
    els.textCount.textContent = els.text.value.length + '/300';
  }
  function updateSaveState() {
    var has = els.title.value.trim() || els.text.value.trim() || state.pendingPhoto || state.editPhotoName;
    els.save.disabled = !has || state.saving;
  }
  function saveDraft() {
    if (state.editingId) return;
    try {
      global.localStorage.setItem(DRAFT_KEY, JSON.stringify({
        title: els.title.value, text: els.text.value, place: els.place.value,
        date: els.date.value, who: currentWho()
      }));
    } catch (e) { /* 忽略 */ }
  }
  function clearDraft() {
    try { global.localStorage.removeItem(DRAFT_KEY); } catch (e) { /* 忽略 */ }
  }
  function restoreDraft() {
    try {
      var raw = global.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (!d || (!d.title && !d.text)) return;
      els.title.value = d.title || '';
      els.text.value = d.text || '';
      els.place.value = d.place || '';
      if (d.date) els.date.value = d.date;
      if (d.who) setWho(d.who);
      updateCounts();
      toast('已恢复上次没写完的草稿');
    } catch (e) { /* 忽略 */ }
  }

  function openEditor(memory) {
    state.editingId = memory ? memory.id : '';
    state.pendingPhoto = null;
    state.editPhotoName = memory ? memory.photoName : '';
    state.originalPhotoName = memory ? memory.photoName : '';
    els.edHeading.textContent = memory ? '编辑回忆' : '新回忆';
    els.title.value = memory ? memory.title : '';
    els.text.value = memory ? memory.text : '';
    els.place.value = memory ? memory.place : '';
    els.date.value = dateInputValue(memory ? memory.at : Date.now());
    setWho(memory ? memory.by : identity());
    setPhotoUI('');
    updateCounts();
    els.save.disabled = true;
    if (state.editPhotoName && PS) {
      PS.url(state.editPhotoName).then(function (src) { if (src && state.editPhotoName) setPhotoUI(src); });
    }
    els.editor.hidden = false;
    els.editor.classList.add('is-open');
    if (!memory) restoreDraft();
    updateSaveState();
  }
  function closeEditor() {
    state.editingId = '';
    state.pendingPhoto = null;
    state.editPhotoName = '';
    state.originalPhotoName = '';
    els.editor.classList.remove('is-open');
    els.editor.hidden = true;
    els.file.value = '';
  }

  function combineDate(value, baseTs) {
    var parts = String(value || '').split('-');
    var d = new Date();
    if (parts.length === 3) d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (baseTs) {
      var old = new Date(baseTs);
      d.setHours(old.getHours(), old.getMinutes(), 0, 0);
    } else {
      var now = new Date();
      d.setHours(now.getHours(), now.getMinutes(), 0, 0);
    }
    return d.getTime();
  }

  function saveMemory() {
    if (state.saving) return;
    var title = els.title.value.trim();
    var text = els.text.value.trim();
    var place = els.place.value.trim();
    var who = currentWho();
    if (!title && !text && !state.pendingPhoto && !state.editPhotoName) { toast('写点什么，或者放一张照片'); return; }
    if (!document.body.classList.contains('access-unlocked')) { toast('先输入空间密码'); return; }

    state.saving = true;
    updateSaveState();
    var base = state.editingId ? findItem(state.editingId) : null;
    var at = combineDate(els.date.value, base ? base.at : 0);

    var photoPromise;
    if (state.pendingPhoto) {
      if (!PS || !PS.enabled) { state.saving = false; updateSaveState(); toast('config.js 里还没配 storage.repo，照片没地方放'); return; }
      if (!PS.hasToken()) { state.saving = false; updateSaveState(); toast('这台设备还没有写入密钥，去「设置 → 写入密钥」贴一次'); return; }
      toast('照片上传中…');
      photoPromise = PS.upload(state.pendingPhoto.blob).then(function (entry) {
        return { name: entry.name };
      }, function (err) {
        return { error: err };
      });
    } else {
      photoPromise = Promise.resolve({ name: state.editPhotoName || '' });
    }

    var photoFailed = false;
    photoPromise.then(function (res) {
      if (res.error) {
        var msg = (res.error && res.error.message) || '网络不通';
        /* 只放照片、没有文字：留在编辑页，让用户重试或补一句文字 */
        if (!title && !text) {
          state.saving = false;
          updateSaveState();
          toast('照片没传上去：' + msg);
          return null;
        }
        /* 有文字就先保存文字，照片失败不拖累这条回忆 */
        photoFailed = true;
        toast('照片没传上去（' + msg + '），先保存文字');
        res = { name: '' };
      }

      var photoName = res.name || '';
      var item = {
        id: state.editingId || uid(),
        at: at,
        title: title || (photoName ? '一段回忆' : '记一笔'),
        text: text,
        photoName: photoName || '',
        place: place,
        by: who,
        updatedAt: Date.now()
      };
      var editing = state.editingId;
      return write(function (doc) {
        var arr = Array.isArray(doc.items) ? doc.items.slice() : [];
        if (editing) {
          var hit = false;
          arr = arr.map(function (x) {
            if (x && x.id === editing) { hit = true; return item; }
            return x;
          });
          if (!hit) arr.unshift(item);
        } else {
          arr.unshift(item);
        }
        return { items: arr };
      }).then(function () {
        var oldPhoto = state.originalPhotoName;
        state.saving = false;
        try {
          if (oldPhoto && photoName && oldPhoto !== photoName && PS && PS.hasToken && PS.hasToken()) {
            PS.remove(oldPhoto).then(null, function () { return null; });
          }
          clearDraft();
          closeEditor();
          render();
          syncHome();
          /* scrollTo(options) 在旧版 iOS / X5 上会抛错，用 scrollTop 最稳 */
          els.scroll.scrollTop = 0;
        } catch (e) { /* 重绘出问题也不影响已经保存的结果 */ }
        toast(photoFailed ? '文字已保存，照片没传上去' : (editing ? '改好了' : (photoName ? '记进回忆里了' : '文字已保存')));
      });
    }).then(null, function (err) {
      state.saving = false;
      updateSaveState();
      toast('保存失败：' + ((err && err.message) || '网络不通'));
    });
  }
  /* ---------------- 删除 ---------------- */
  function askDelete() {
    if (!state.detailId) return;
    els.backdrop.hidden = false;
    els.confirm.hidden = false;
    requestAnimationFrame(function () {
      els.backdrop.classList.add('is-on');
      els.confirm.classList.add('is-on');
    });
  }
  function closeConfirm() {
    els.backdrop.classList.remove('is-on');
    els.confirm.classList.remove('is-on');
    setTimeout(function () { els.backdrop.hidden = true; els.confirm.hidden = true; }, 220);
  }
  function doDelete() {
    var item = findItem(state.detailId);
    if (!item) { closeConfirm(); return; }
    write(function (doc) {
      var arr = Array.isArray(doc.items) ? doc.items : [];
      return { items: arr.filter(function (x) { return !x || x.id !== item.id; }) };
    }).then(function () {
      closeConfirm();
      closeDetail();
      render();
      syncHome();
      var timer = setTimeout(function () {
        if (item.photoName && PS && PS.hasToken && PS.hasToken()) {
          PS.remove(item.photoName).then(null, function () { return null; });
        }
        state.undo = null;
      }, 6000);
      state.undo = { item: item, timer: timer };
      toast('已经删掉', '撤销', undoDelete, 6000);
    }, function (err) {
      closeConfirm();
      toast('删除失败：' + ((err && err.message) || '网络不通'));
    });
  }
  function undoDelete() {
    if (!state.undo) return;
    var undo = state.undo;
    state.undo = null;
    clearTimeout(undo.timer);
    write(function (doc) {
      var arr = Array.isArray(doc.items) ? doc.items.slice() : [];
      arr.push(undo.item);
      return { items: arr };
    }).then(function () {
      render(); syncHome(); toast('回来了');
    }, function () { toast('撤销失败，网络不通'); });
  }

  /* ---------------- Toast ---------------- */
  function toast(message, actionLabel, action, duration) {
    if (!els.toast) return;
    els.toast.innerHTML = '<span>' + esc(message) + '</span>' +
      (actionLabel ? '<button type="button">' + esc(actionLabel) + '</button>' : '');
    if (actionLabel) {
      els.toast.querySelector('button').addEventListener('click', function () {
        els.toast.classList.remove('is-on');
        if (action) action();
      });
    }
    els.toast.classList.add('is-on');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () { els.toast.classList.remove('is-on'); }, duration || 2400);
  }

  /* ---------------- 打开 / 关闭 ---------------- */
  function open() {
    init();
    if (!document.body.classList.contains('access-unlocked')) { toast('先输入空间密码，再进回忆'); return; }
    if (!page.hidden) return;
    page.hidden = false;
    document.body.classList.add('memories-open');
    if (global.history && history.pushState) history.pushState({ memories: true }, '', '#/memories');
    render();
  }
  function close(fromPop) {
    if (!page || page.hidden) return;
    page.hidden = true;
    document.body.classList.remove('memories-open');
    closeDetail();
    closeEditor();
    closeConfirm();
    if (!fromPop) {
      if (global.history && history.state && history.state.memories) history.back();
      else if (location.hash === '#/memories') history.replaceState(null, '', location.pathname + location.search);
    }
  }

  function bind() {
    els.back.addEventListener('click', function () { close(false); });
    els.addTop.addEventListener('click', function () { openEditor(); });
    els.add.addEventListener('click', function () { openEditor(); });
    els.cancel.addEventListener('click', function () {
      if (els.title.value.trim() || els.text.value.trim()) saveDraft();
      closeEditor();
    });
    els.save.addEventListener('click', saveMemory);
    els.who.addEventListener('click', function (e) {
      var b = e.target.closest('[data-who]');
      if (!b) return;
      setWho(b.getAttribute('data-who'));
      setIdentity(b.getAttribute('data-who'));
      updateSaveState();
    });
    els.chips.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-filter]');
      if (!chip) return;
      state.filter = chip.getAttribute('data-filter');
      render();
    });
    document.querySelectorAll('[data-mp-view]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.view = b.getAttribute('data-mp-view');
        render();
      });
    });
    ['mpTitle', 'mpText'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        updateCounts(); updateSaveState(); saveDraft();
      });
    });
    ['mpPlace', 'mpDate'].forEach(function (id) {
      $(id).addEventListener('input', saveDraft);
    });
    els.pick.addEventListener('click', function (e) {
      if (e.target.closest('#mpPickRemove')) return;
      els.file.click();
    });
    els.pick.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.file.click(); }
    });
    els.pickRemove.addEventListener('click', function (e) {
      e.stopPropagation();
      state.pendingPhoto = null;
      state.editPhotoName = '';
      setPhotoUI('');
      updateSaveState();
    });
    els.file.addEventListener('change', function () {
      var file = els.file.files && els.file.files[0];
      if (!file) return;
      if (!PS || !PS.enabled) { toast('先在 config.js 里配好存储仓库'); return; }
      toast('正在压缩照片…');
      PS.prepare(file).then(function (res) {
        state.pendingPhoto = res;
        setPhotoUI(res.preview);
        updateSaveState();
        toast('照片准备好了（' + Math.round(res.blob.size / 1024) + 'KB），点保存就提交');
      }).catch(function (err) {
        toast(err.message || '这张照片用不了');
      });
    });
    els.confirmKeep.addEventListener('click', closeConfirm);
    els.confirmDel.addEventListener('click', doDelete);
    els.backdrop.addEventListener('click', closeConfirm);

    document.addEventListener('keydown', function (e) {
      if (!page || page.hidden) return;
      if (e.key !== 'Escape') return;
      if (!els.confirm.hidden) { closeConfirm(); return; }
      if (!els.editor.hidden) { closeEditor(); return; }
      if (!els.detail.hidden) { closeDetail(); return; }
      close(false);
    });
    global.addEventListener('popstate', function () {
      if (page && !page.hidden) close(true);
    });

    /* 直接带 #/memories 打开：等密码门通过后再进 */
    if (location.hash === '#/memories') {
      var tick = setInterval(function () {
        if (document.body.classList.contains('access-unlocked')) {
          clearInterval(tick);
          open();
        }
      }, 500);
      setTimeout(function () { clearInterval(tick); }, 120000);
    }
  }

  global.Memories = {
    open: open,
    close: function () { close(false); },
    refresh: function () { if (page && !page.hidden) render(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
