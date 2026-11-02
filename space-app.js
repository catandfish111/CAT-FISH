/* ============================================================
   情侣空间的「云同步业务层」
   ------------------------------------------------------------
   sync.js 负责搬运 JSON，这个文件负责定义存什么、怎么显示。
   所有两个人共享的内容都在这里：便签 / 提醒 / 愿望 / 回忆 /
   恋爱开始日期 / 番茄钟 / 空间密码。
   ============================================================ */
(function (global) {
  'use strict';

  var S = global.Space;
  var CFG = global.LOVE_CONFIG || {};
  var IDENTITY_KEY = 'catfish-identity-v1';
  var NOTE_HIDDEN_KEY = 'catfish-note-hidden-v1';

  /* ---------------- 内存镜像 ---------------- */
  var state = {
    profile: { startDate: '', title: '' },
    notes: [], reminders: [], wishes: [], memories: [],
    access: null,
    timer: { running: false, mode: 'focus', endsAt: 0, duration: 1500, by: '' }
  };

  var currentPanel = '';
  var currentBody = null;
  var memoryEditorOpen = false;
  var pendingPhoto = null;
  var busy = false;

  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function toast(message) {
    var el = $('spaceToast');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('is-visible');
    void el.offsetWidth;
    el.classList.add('is-visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('is-visible'); }, 2600);
  }

  /* ---------------- 身份（谁写的） ---------------- */
  var IDENTITIES = { cat: '小猫', fish: '小鱼', us: '我们' };
  function identity() {
    var v = '';
    try { v = global.localStorage.getItem(IDENTITY_KEY) || ''; } catch (e) { v = ''; }
    return IDENTITIES[v] ? v : 'us';
  }
  function identityLabel(key) {
    if (!key) return '';
    return IDENTITIES[key] || String(key);
  }
  function setIdentity(key) {
    try { global.localStorage.setItem(IDENTITY_KEY, key); } catch (e) { /* 忽略 */ }
  }
  function stamp() {
    return { id: uid(), by: identity(), at: Date.now() };
  }
  function when(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var sameYear = d.getFullYear() === now.getFullYear();
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return (sameYear ? '' : d.getFullYear() + '年') + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* ---------------- 从 Space 拉进内存 ---------------- */
  function pullDoc(key, fallback) {
    var v = S.get(key);
    if (v && typeof v === 'object') return v;
    return fallback;
  }
  function pullAll() {
    var profile = pullDoc('profile', {});
    state.profile = {
      startDate: typeof profile.startDate === 'string' ? profile.startDate : '',
      title: typeof profile.title === 'string' ? profile.title : ''
    };
    state.notes = listOf('notes');
    state.reminders = listOf('reminders');
    state.wishes = listOf('wishes');
    state.memories = listOf('memories');
    var access = pullDoc('access', null);
    state.access = (access && (access.hash || access.password)) ? access : null;
    var timer = pullDoc('timer', {});
    state.timer = {
      running: !!timer.running,
      mode: timer.mode === 'break' ? 'break' : 'focus',
      endsAt: Number(timer.endsAt) || 0,
      duration: Number(timer.duration) || 1500,
      by: typeof timer.by === 'string' ? timer.by : ''
    };
  }
  function listOf(key) {
    var doc = pullDoc(key, {});
    var items = Array.isArray(doc.items) ? doc.items : [];
    return items.filter(function (it) { return it && typeof it === 'object'; });
  }

  /* ---------------- 首页：恋爱天数 + 便签 ---------------- */
  function daysSince() {
    if (!state.profile.startDate) return 0;
    var parts = String(state.profile.startDate).split('-');
    if (parts.length !== 3) return 0;
    var start = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(start.getTime())) return 0;
    var today = new Date();
    var t0 = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    var t1 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return Math.max(0, Math.round((t1 - t0) / 86400000) + 1);
  }
  var DAYS_HTML = null;
  function renderDays() {
    var line = document.querySelector('.space-days');
    if (!line) return;
    if (DAYS_HTML === null) DAYS_HTML = line.innerHTML;
    var n = daysSince();
    if (!n) {
      line.innerHTML = '把开始在一起的那天写下来，这里就会每天长大 <strong>—</strong>';
      return;
    }
    line.innerHTML = DAYS_HTML;
    var strong = line.querySelector('strong');
    if (strong) strong.textContent = String(n);
  }

  function topNote() {
    if (!state.notes.length) return null;
    var pinned = state.notes.filter(function (n) { return n.pin; });
    var pool = pinned.length ? pinned : state.notes.slice();
    pool.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    return pool[0] || null;
  }
  function renderHomeNote() {
    var widget = $('bubuNoteWidget');
    var textEl = $('bubuNoteText');
    if (!widget || !textEl) return;
    var note = topNote();
    var hiddenId = '';
    try { hiddenId = global.localStorage.getItem(NOTE_HIDDEN_KEY) || ''; } catch (e) { hiddenId = ''; }
    if (!note || !String(note.text || '').trim() || note.id === hiddenId) {
      widget.hidden = true;
      return;
    }
    textEl.textContent = note.text;
    widget.hidden = false;
  }
  function hideHomeNote() {
    var note = topNote();
    try { global.localStorage.setItem(NOTE_HIDDEN_KEY, note ? note.id : 'none'); } catch (e) { /* 忽略 */ }
    renderHomeNote();
  }

  /* ---------------- 首页信息条：纪念日 / 最近回忆 / 今天想对你说 ---------------- */
  function startDateObj() {
    var s = String(state.profile.startDate || '');
    var p = s.split('-');
    if (p.length !== 3) return null;
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return isNaN(d.getTime()) ? null : d;
  }

  function nextMilestone() {
    var start = startDateObj();
    var days = daysSince();
    if (!start || !days) return null;
    var today = new Date();
    var t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var cands = [];

    /* 下一个整百天（今天正好是整百天就算今天） */
    var hundred = (days % 100 === 0) ? days : Math.ceil(days / 100) * 100;
    cands.push({
      date: new Date(start.getFullYear(), start.getMonth(), start.getDate() + (hundred - 1)),
      label: '第 ' + hundred + ' 天'
    });

    /* 下一个周年 */
    var years = t0.getFullYear() - start.getFullYear();
    var anniv = new Date(start.getFullYear() + years, start.getMonth(), start.getDate());
    if (anniv.getTime() < t0.getTime()) {
      years += 1;
      anniv = new Date(start.getFullYear() + years, start.getMonth(), start.getDate());
    }
    cands.push({ date: anniv, label: years + ' 周年' });

    cands.sort(function (a, b) { return a.date.getTime() - b.date.getTime(); });
    var pick = cands[0];
    var diff = Math.round((new Date(pick.date.getFullYear(), pick.date.getMonth(), pick.date.getDate()) - t0) / 86400000);
    return { label: pick.label, days: diff };
  }

  function dailyQuote() {
    var list = (CFG.quotes && CFG.quotes.length) ? CFG.quotes : [];
    if (!list.length) return '';
    var today = new Date();
    var dayIndex = Math.floor(new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() / 86400000);
    return String(list[dayIndex % list.length]);
  }

  function renderStats() {
    var msEl = $('statMilestone');
    var msSub = $('statMilestoneSub');
    var memEl = $('statMemory');
    var memSub = $('statMemorySub');
    var quoteEl = $('statQuote');
    if (!msEl && !memEl && !quoteEl) return;

    var ms = nextMilestone();
    if (msEl) msEl.textContent = ms ? ms.label : '还没设置';
    if (msSub) {
      if (!ms) msSub.textContent = '在「更多」里填开始日期';
      else if (ms.days === 0) msSub.textContent = '就是今天';
      else msSub.textContent = '还有 ' + ms.days + ' 天';
    }

    var latest = gallery()[0];
    if (memEl) memEl.textContent = latest ? (latest.title || '一段回忆') : '还没有';
    if (memSub) memSub.textContent = latest ? when(latest.at) : '去「我们的回忆」放一张';

    if (quoteEl) {
      var q = dailyQuote();
      quoteEl.textContent = q || '';
      var card = quoteEl.parentNode;
      if (card) card.hidden = !q;
    }
  }

  /* ---------------- 同步状态 ---------------- */
  function statusText() {
    var st = S.status();
    if (!st.configured) return '只存在这台设备';
    if (!st.secure) return '这个浏览器不支持加密';
    if (st.locked) return st.writable ? '等待空间密码' : '本机模式 · 还没贴写入密钥';
    if (!st.online) return st.pending ? '离线 · ' + st.pending + ' 条待上传' : '离线中';
    if (st.pending) return '待上传 ' + st.pending + ' 条';
    if (!st.lastSync) return '正在连接';
    var d = new Date(st.lastSync);
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return '已同步 · ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function renderSyncChip() {
    var chip = $('syncChip');
    if (!chip) return;
    var st = S.status();
    /* 没有接云端的时候标签就藏起来，别占地方 */
    if (!st.configured) {
      chip.hidden = true;
      chip.textContent = '';
      return;
    }
    chip.hidden = false;
    chip.textContent = statusText();
    chip.classList.toggle('is-offline', !st.online || st.locked);
    chip.title = st.locked
      ? '输入空间密码后才会解密云端内容'
      : '内容加密存在 GitHub 仓库，两台设备看到的是同一份';
  }

  /* ---------------- 回忆：照片来自 GitHub 仓库的 photos/ 文件夹 ----------------
     照片本身就是线上资源，所以「回忆」= 仓库里的照片 + 本地给它们配的文字。 */
  function photoStore() {
    return global.PhotoStore || null;
  }

  function gallery() {
    var ps = photoStore();
    var photos = (ps && ps.enabled) ? ps.cached() : [];
    var byPhoto = {};
    state.memories.forEach(function (r) { if (r && r.photoName) byPhoto[r.photoName] = r; });

    var items = photos.map(function (p) {
      var r = byPhoto[p.name];
      return {
        key: p.name,
        name: p.name,
        sha: p.sha,
        photo: p.url,
        title: (r && r.title) || '',
        text: (r && r.text) || '',
        at: (r && r.at) || p.at,
        by: (r && r.by) || ''
      };
    });

    /* 只有文字、没有照片的回忆也要显示 */
    state.memories.forEach(function (r) {
      if (!r.photoName) {
        items.push({ key: r.id, id: r.id, name: '', sha: '', photo: '', title: r.title, text: r.text, at: r.at, by: r.by });
      }
    });

    items.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    return items;
  }

  /* ---------------- 面板渲染 ---------------- */
  function intro(title, sub) {
    return '<div class="bubu-panel-intro"><span>' + esc(title) + '</span><small>' + esc(sub) + '</small></div>';
  }
  function empty(icon, title, copy) {
    return '<div class="panel-empty"><span class="panel-empty-icon">' + icon + '</span><b>' + esc(title) + '</b><p>' + esc(copy) + '</p></div>';
  }

  function renderMemories() {
    var ps = photoStore();
    var items = gallery();
    var canUpload = !!(ps && ps.enabled && ps.hasToken());
    var html = intro('我们的回忆', (ps && ps.enabled)
      ? '照片加密后存进仓库，哪台设备输入同一个空间密码都能看到'
      : '先在 config.js 里配好 storage.repo，照片才有地方放');
    html += '<div class="panel-toolbar"><button class="bubu-primary" type="button" data-memory-new>＋ 添加一段回忆</button>' +
      '<span class="panel-count">共 <b>' + items.length + '</b> 条</span></div>';

    if (memoryEditorOpen) {
      html += '<div class="memory-editor" id="memoryEditor">' +
        '<label class="memory-pick"><input type="file" accept="image/*" data-memory-file hidden><span class="memory-pick-box" id="memoryPickBox">' +
        (pendingPhoto ? '换一张照片' : '选择照片') + '</span></label>' +
        '<div class="memory-preview" id="memoryPreview"' + (pendingPhoto ? '' : ' hidden') + '>' +
        (pendingPhoto ? '<img src="' + esc(pendingPhoto.preview) + '" alt="预览">' : '') + '</div>' +
        '<input class="bubu-field" id="memoryTitle" type="text" maxlength="40" placeholder="给这段回忆起个名字">' +
        '<textarea class="bubu-field bubu-note-field" id="memoryText" rows="3" maxlength="300" placeholder="那天发生了什么……"></textarea>' +
        '<div class="bubu-form-actions"><button class="bubu-primary" type="button" data-memory-save>保存</button>' +
        '<button type="button" data-memory-cancel>取消</button></div>' +
        '<p class="panel-note">' + (canUpload
          ? '照片会压到长边 1400 像素、加密后提交进仓库，滚到跟前才解密显示。'
          : '这台设备还没有写入密钥：去「设置 → 写入密钥」贴一次就能传照片，也可以只写文字。') + '</p>' +
        '</div>';
    }

    if (!items.length) {
      html += empty('♡', '还没有回忆', '放一张照片进来，它会加密存进仓库，两个人都能看到。');
      return html;
    }

    html += '<div class="memory-grid">';
    items.forEach(function (item) {
      var photoHtml = item.name
        ? '<img loading="lazy" decoding="async" data-photo="' + esc(item.name) + '" alt="' + esc(item.title || '回忆') + '">'
        : '<span class="memory-no-photo">♡</span>';
      var key = item.name || item.id || '';
      html += '<article class="memory-card" data-memory-id="' + esc(key) + '">' +
        '<div class="memory-photo">' + photoHtml + '</div>' +
        '<div class="memory-info"><b>' + esc(item.title || (item.name ? '一段回忆' : '没有名字的一段')) + '</b>' +
        (item.text ? '<p>' + esc(item.text) + '</p>' : '') +
        '<small>' + esc(when(item.at)) + (item.by ? ' · ' + esc(identityLabel(item.by)) : '') + '</small></div>' +
        (canUpload
          ? '<button class="panel-del" type="button" data-memory-del="' + esc(key) + '" data-memory-sha="' + esc(item.sha || '') + '" aria-label="删除这条回忆">×</button>'
          : '') +
        '</article>';
    });
    html += '</div>';
    return html;
  }

  function renderWishes() {
    var done = state.wishes.filter(function (w) { return w.done; }).length;
    var html = intro('想和你一起', '写下来的愿望两个人都能看到，谁勾掉都算数');
    html += '<div class="panel-inline-form"><input class="bubu-field" id="wishInput" type="text" maxlength="60" placeholder="想一起做的一件小事">' +
      '<button class="bubu-primary" type="button" data-wish-add>加上</button></div>';
    if (!state.wishes.length) {
      html += empty('✦', '清单还是空的', '「去看一次海」「学会做那道菜」，随便写一件。');
    } else {
      var items = state.wishes.slice().sort(function (a, b) {
        if (!!a.done !== !!b.done) return a.done ? 1 : -1;
        return (b.at || 0) - (a.at || 0);
      });
      html += '<p class="panel-count panel-count-top">已完成 <b>' + done + '</b> / ' + state.wishes.length + '</p><ul class="wish-list">';
      items.forEach(function (item) {
        html += '<li class="wish-row' + (item.done ? ' is-done' : '') + '">' +
          '<button class="wish-check" type="button" data-wish-toggle="' + esc(item.id) + '" aria-label="标记完成">' + (item.done ? '✓' : '') + '</button>' +
          '<span class="wish-text">' + esc(item.text) + '</span>' +
          '<small class="wish-by">' + esc(item.done ? (identityLabel(item.doneBy) || identityLabel(item.by)) : identityLabel(item.by)) + '</small>' +
          '<button class="panel-del" type="button" data-wish-del="' + esc(item.id) + '" aria-label="删除">×</button>' +
          '</li>';
      });
      html += '</ul>';
    }
    return html;
  }

  function renderNotes() {
    var html = intro('便签', '写下的便签会立刻出现在对方的首页');
    html += '<textarea class="bubu-field bubu-note-field" id="noteInput" rows="4" maxlength="200" placeholder="写下今天想说的话……"></textarea>' +
      '<div class="bubu-form-actions"><button class="bubu-primary" type="button" data-note-save>贴到首页</button>' +
      '<span class="panel-count">共 <b>' + state.notes.length + '</b> 张</span></div>';
    if (!state.notes.length) {
      html += empty('✎', '还没有便签', '第一张便签贴在首页，对方一进来就能看见。');
    } else {
      var items = state.notes.slice().sort(function (a, b) {
        if (!!a.pin !== !!b.pin) return a.pin ? -1 : 1;
        return (b.at || 0) - (a.at || 0);
      });
      html += '<ul class="note-list">';
      items.forEach(function (item) {
        html += '<li class="note-row' + (item.pin ? ' is-pinned' : '') + '">' +
          '<div class="note-body"><p>' + esc(item.text) + '</p><small>' + esc(when(item.at)) + (item.by ? ' · ' + esc(identityLabel(item.by)) : '') + '</small></div>' +
          '<div class="note-tools"><button type="button" data-note-pin="' + esc(item.id) + '" aria-label="' + (item.pin ? '取消置顶' : '置顶') + '">' + (item.pin ? '★' : '☆') + '</button>' +
          '<button class="panel-del" type="button" data-note-del="' + esc(item.id) + '" aria-label="删除">×</button></div>' +
          '</li>';
      });
      html += '</ul>';
    }
    return html;
  }

  function renderReminders() {
    var html = intro('温柔提醒', '提醒也存在云端，谁都可以加、都可以删');
    html += '<div class="bubu-reminder-form">' +
      '<input class="bubu-field" id="reminderText" type="text" maxlength="60" placeholder="提醒内容">' +
      '<input class="bubu-field" id="reminderTime" type="datetime-local">' +
      '<button class="bubu-primary" type="button" data-reminder-add>添加提醒</button></div>';
    if (!state.reminders.length) {
      html += empty('♧', '还没有提醒', '给未来的你们留一句话吧。');
      return html;
    }
    var items = state.reminders.slice().sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
    html += '<div class="bubu-reminder-list">';
    items.forEach(function (item) {
      var overdue = !item.done && Number(item.at) <= Date.now();
      html += '<div class="bubu-reminder-row' + (item.done ? ' is-done' : '') + (overdue ? ' is-overdue' : '') + '">' +
        '<span>' + esc(item.text) + '<small>' + esc(when(item.at)) + (item.done ? ' · 已提醒' : '') + (item.by ? ' · ' + esc(identityLabel(item.by)) : '') + '</small></span>' +
        '<button class="panel-del" type="button" data-reminder-del="' + esc(item.id) + '" aria-label="删除提醒">×</button>' +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  function timerRemaining() {
    if (!state.timer.running) return 0;
    return Math.max(0, Math.ceil((state.timer.endsAt - Date.now()) / 1000));
  }
  function fmt(seconds) {
    var s = Math.max(0, Math.floor(seconds || 0));
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return pad(Math.floor(s / 60)) + ':' + pad(s % 60);
  }
  function renderTimer() {
    var remaining = timerRemaining();
    var mode = state.timer.mode === 'break' ? '休息' : '专注';
    var html = intro('一起专注一会儿', '番茄钟状态在云端，谁开的开始另一边也看得到');
    html += '<div class="bubu-timer-card">' +
      '<span class="bubu-timer-mode">' + (state.timer.running ? mode + '中' : '还没开始') + '</span>' +
      '<strong id="panelTimerClock">' + (state.timer.running ? fmt(remaining) : fmt(state.timer.duration || 1500)) + '</strong>' +
      '<label>分钟 <input class="bubu-number" id="timerMinutes" type="number" min="1" max="120" value="' +
      Math.max(1, Math.round((state.timer.duration || 1500) / 60)) + '"></label></div>';
    html += '<div class="bubu-form-actions"><button class="bubu-primary" type="button" data-timer-toggle>' +
      (state.timer.running ? '暂停' : '开始') + '</button><button type="button" data-timer-reset>重置</button></div>';
    if (state.timer.running && state.timer.by) {
      html += '<p class="panel-note">这一轮是 ' + esc(identityLabel(state.timer.by)) + ' 开的，' + fmt(remaining) + ' 之后结束。</p>';
    }
    return html;
  }

  /* 照片仓库的状态（异步，渲染完再填） */
  function fillPhotoStats() {
    var el = $('photoStats');
    if (!el) return;
    var ps = photoStore();
    if (!ps || !ps.enabled) {
      el.textContent = 'config.js 里还没配 storage.repo，照片没地方放';
      return;
    }
    if (!S.hasKey || !S.hasKey()) {
      el.textContent = '还没解锁：输入空间密码后照片才会解密';
      return;
    }
    var rows = ps.cached();
    el.textContent = (ps.hasToken() ? '可以上传' : '只读（没贴写入密钥）') +
      ' · 仓库里已有 ' + rows.length + ' 张照片' +
      (ps.lastError() ? ' · ' + ps.lastError() : '');
  }

  function renderSettings() {
    var html = intro('设置', S.configured ? '内容加密存在 GitHub，两台设备共享' : '这些设置只保存在这台设备上');
    html += '<div class="setting-block"><b>我是</b><div class="identity-row">';
    [['cat', '小猫'], ['fish', '小鱼'], ['us', '我们']].forEach(function (pair) {
      html += '<button type="button" class="identity-chip' + (identity() === pair[0] ? ' is-active' : '') + '" data-identity="' + pair[0] + '">' + pair[1] + '</button>';
    });
    html += '</div><small>只影响这台设备上显示的署名</small></div>';

    html += '<div class="setting-block"><b>恋爱开始日期</b>' +
      '<div class="panel-inline-form"><input class="bubu-field" id="startDate" type="date" value="' + esc(state.profile.startDate || '') + '">' +
      '<button class="bubu-primary" type="button" data-profile-save>保存</button></div>' +
      '<small>首页的「一起走过第几天」和纪念日都按这一天算</small></div>';

    var ps = photoStore();
    html += '<div class="setting-block"><b>写入密钥</b>' +
      '<p class="panel-note" id="photoStats">正在检查…</p>' +
      '<input class="bubu-field" id="ghToken" type="password" autocomplete="off" spellcheck="false" placeholder="GitHub 写入密钥（只存这台设备）">' +
      '<div class="bubu-form-actions">' +
      '<button class="bubu-primary" type="button" data-photo-token-save>保存密钥</button>' +
      '<button type="button" data-photo-refresh>立即同步</button>' +
      '<button type="button" data-photo-token-clear>清除</button></div>' +
      '<small>' + (ps && ps.enabled
        ? '内容会加密后提交到 <code>' + esc(ps.repo) + '</code> 的 <code>' + esc(S.config.branch) + '</code> 分支；密钥只存在这台设备'
        : '先在 config.js 里配好 storage.repo') + '</small></div>';

    html += '<div class="setting-block"><b>空间密码</b>' +
      '<input class="bubu-field" id="oldPassword" type="password" autocomplete="current-password" placeholder="现在的密码">' +
      '<input class="bubu-field" id="newPassword" type="password" autocomplete="new-password" placeholder="新密码（至少 4 位）">' +
      '<input class="bubu-field" id="newPassword2" type="password" autocomplete="new-password" placeholder="再输一次新密码">' +
      '<div class="bubu-form-actions"><button class="bubu-primary" type="button" data-password-save>改密码</button></div>' +
      '<small>只换包裹密钥的那一层，仓库里的文件不会重新上传；改完两台设备都要用新密码</small></div>';

    if (S.configured) {
      html += '<div class="setting-block"><b>同步</b>' +
        '<p class="panel-note" id="syncDetail">' + esc(statusText()) + ' · ' + esc(S.config.repo + ' · ' + S.config.branch) + '</p>' +
        '<div class="bubu-form-actions"><button class="bubu-primary" type="button" data-sync-now>立即同步</button>' +
        '<button type="button" data-sync-test>云端自检</button></div>' +
        '<div class="selftest-out" id="selftestOut" hidden></div></div>';
    }

    return html;
  }

  /* ---------------- 面板入口 ---------------- */
  function renderPanel(name, el) {
    if (!el) return false;
    currentPanel = name;
    currentBody = el;
    var html = null;
    if (name === 'memories') html = renderMemories();
    else if (name === 'wishes') html = renderWishes();
    else if (name === 'notes') html = renderNotes();
    else if (name === 'reminders') html = renderReminders();
    else if (name === 'timer') html = renderTimer();
    else if (name === 'settings') html = renderSettings();
    if (html === null) return false;
    el.innerHTML = html;
    if (name === 'settings') fillPhotoStats();
    if (name === 'memories') {
      var ps = photoStore();
      if (ps && ps.hydrate) ps.hydrate(el);
    }
    var title = document.getElementById('bubuPanelTitle');
    if (title) {
      var names = {
        memories: '我们的回忆', notes: '便签', wishes: '想和你一起',
        reminders: '提醒', timer: '番茄钟', settings: '设置'
      };
      title.textContent = names[name] || '小工具';
    }
    return true;
  }

  /* 云端来的变化：面板没开着就只刷新首页 */
  function refreshUI() {
    pullAll();
    renderDays();
    renderHomeNote();
    renderStats();
    renderSyncChip();
    if (!currentBody || !currentPanel) return;
    var active = document.activeElement;
    var typingInPanel = active && currentBody.contains(active) && /input|textarea|select/i.test(active.tagName);
    if (typingInPanel || memoryEditorOpen) return;
    renderPanel(currentPanel, currentBody);
  }

  /* ---------------- 各模块的写操作 ---------------- */
  function addMemory(draft) {
    var item = stamp();
    item.title = draft.title;
    item.text = draft.text;
    item.photoName = draft.photoName || '';
    return S.mutate('memories', function (doc) {
      var items = Array.isArray(doc.items) ? doc.items : [];
      items.push(item);
      return { items: items };
    }).then(function () {
      toast(draft.photoName ? '照片已经提交进仓库' : '这段回忆记下来了');
    });
  }

  function handleClick(e, root) {
    var target = e.target;
    if (!target || !target.closest) return false;
    var hit = function (sel) { return target.closest(sel); };

    /* 回忆 */
    if (hit('[data-memory-new]')) {
      memoryEditorOpen = true;
      pendingPhoto = null;
      renderPanel('memories', currentBody);
      return true;
    }
    if (hit('[data-memory-cancel]')) {
      memoryEditorOpen = false;
      pendingPhoto = null;
      renderPanel('memories', currentBody);
      return true;
    }
    if (hit('[data-memory-save]')) {
      if (busy) return true;
      var titleEl = $('memoryTitle');
      var textEl = $('memoryText');
      var title = titleEl ? titleEl.value.trim() : '';
      var text = textEl ? textEl.value.trim() : '';
      if (!title && !text && !pendingPhoto) { toast('写点什么，或者挑一张照片'); return true; }
      var ps = photoStore();
      if (pendingPhoto && (!ps || !ps.enabled)) { toast('config.js 里还没配 storage.repo，照片没地方放'); return true; }
      if (pendingPhoto && !ps.hasToken()) { toast('这台设备还没有上传密钥，去「设置 → 照片仓库」贴一次'); return true; }
      busy = true;
      var photoPromise = pendingPhoto
        ? ps.upload(pendingPhoto.blob).then(function (entry) { return entry.name; })
        : Promise.resolve('');
      photoPromise.then(function (photoName) {
        return addMemory({ title: title || (photoName ? '一段回忆' : '记一笔'), text: text, photoName: photoName });
      }).then(function () {
        busy = false;
        memoryEditorOpen = false;
        pendingPhoto = null;
        renderPanel('memories', currentBody);
      }).catch(function (err) {
        busy = false;
        toast('保存失败：' + (err.message || '网络不通'));
      });
      return true;
    }
    var memDel = hit('[data-memory-del]');
    if (memDel) {
      var key = memDel.getAttribute('data-memory-del');
      var sha = memDel.getAttribute('data-memory-sha') || '';
      if (global.confirm && !global.confirm('删掉这段回忆？仓库里那张照片也会一起删掉。')) return true;
      var ps2 = photoStore();
      var removeRemote = (ps2 && sha)
        ? ps2.remove(key, sha).catch(function (err) { toast('仓库里的照片没删掉：' + (err.message || '网络')); })
        : Promise.resolve();
      removeRemote.then(function () {
        return S.mutate('memories', function (doc) {
          var items = Array.isArray(doc.items) ? doc.items : [];
          return {
            items: items.filter(function (it) {
              return it.photoName !== key && it.id !== key;
            })
          };
        });
      }).then(function () {
        toast('已经删掉');
        renderPanel('memories', currentBody);
        renderStats();
      });
      return true;
    }

    /* 愿望 */
    if (hit('[data-wish-add]')) {
      var wi = $('wishInput');
      var text = wi ? wi.value.trim() : '';
      if (!text) { toast('写一件想一起做的事'); return true; }
      var wish = stamp();
      wish.text = text;
      wish.done = false;
      S.mutate('wishes', function (doc) {
        var items = Array.isArray(doc.items) ? doc.items : [];
        items.push(wish);
        return { items: items };
      }).then(function () { toast('加进清单啦'); renderPanel('wishes', currentBody); });
      return true;
    }
    var wishToggle = hit('[data-wish-toggle]');
    if (wishToggle) {
      var wid = wishToggle.getAttribute('data-wish-toggle');
      S.mutate('wishes', function (doc) {
        var items = Array.isArray(doc.items) ? doc.items : [];
        items.forEach(function (it) {
          if (it.id !== wid) return;
          it.done = !it.done;
          it.doneAt = it.done ? Date.now() : 0;
          it.doneBy = it.done ? identity() : '';
        });
        return { items: items };
      }).then(function () { renderPanel('wishes', currentBody); });
      return true;
    }
    var wishDel = hit('[data-wish-del]');
    if (wishDel) {
      var wid2 = wishDel.getAttribute('data-wish-del');
      S.mutate('wishes', function (doc) {
        var items = Array.isArray(doc.items) ? doc.items : [];
        return { items: items.filter(function (it) { return it.id !== wid2; }) };
      }).then(function () { renderPanel('wishes', currentBody); });
      return true;
    }

    /* 便签 */
    if (hit('[data-note-save]')) {
      var ni = $('noteInput');
      var noteText = ni ? ni.value.trim() : '';
      if (!noteText) { toast('便签还是空的'); return true; }
      var note = stamp();
      note.text = noteText;
      note.pin = true;
      S.mutate('notes', function (doc) {
        var items = Array.isArray(doc.items) ? doc.items : [];
        items.forEach(function (it) { it.pin = false; });
        items.push(note);
        return { items: items };
      }).then(function () {
        try { global.localStorage.removeItem(NOTE_HIDDEN_KEY); } catch (e) { /* 忽略 */ }
        toast('便签贴好了，对方刷新就能看到');
        renderPanel('notes', currentBody);
      });
      return true;
    }
    var pinBtn = hit('[data-note-pin]');
    if (pinBtn) {
      var nid = pinBtn.getAttribute('data-note-pin');
      S.mutate('notes', function (doc) {
        var items = Array.isArray(doc.items) ? doc.items : [];
        var turnOn = true;
        items.forEach(function (it) {
          if (it.id === nid) { turnOn = !it.pin; it.pin = turnOn; } else if (turnOn) it.pin = false;
        });
        return { items: items };
      }).then(function () { renderPanel('notes', currentBody); renderHomeNote(); });
      return true;
    }
    var noteDel = hit('[data-note-del]');
    if (noteDel) {
      var nid2 = noteDel.getAttribute('data-note-del');
      S.mutate('notes', function (doc) {
        var items = Array.isArray(doc.items) ? doc.items : [];
        return { items: items.filter(function (it) { return it.id !== nid2; }) };
      }).then(function () { renderPanel('notes', currentBody); });
      return true;
    }

    /* 提醒 */
    if (hit('[data-reminder-add]')) {
      var rt = $('reminderText'), rtTime = $('reminderTime');
      if (!rt || !rt.value.trim() || !rtTime || !rtTime.value) { toast('把内容和时间都填好哦'); return true; }
      var rem = stamp();
      rem.text = rt.value.trim();
      rem.at = new Date(rtTime.value).getTime();
      rem.done = false;
      S.mutate('reminders', function (doc) {
        var items = Array.isArray(doc.items) ? doc.items : [];
        items.push(rem);
        return { items: items };
      }).then(function () { toast('提醒已经存到云端'); renderPanel('reminders', currentBody); });
      return true;
    }
    var remDel = hit('[data-reminder-del]');
    if (remDel) {
      var rid = remDel.getAttribute('data-reminder-del');
      S.mutate('reminders', function (doc) {
        var items = Array.isArray(doc.items) ? doc.items : [];
        return { items: items.filter(function (it) { return it.id !== rid; }) };
      }).then(function () { renderPanel('reminders', currentBody); });
      return true;
    }

    /* 番茄钟 */
    if (hit('[data-timer-toggle]')) {
      if (state.timer.running) {
        var left = timerRemaining();
        S.set('timer', { running: false, mode: state.timer.mode, endsAt: 0, duration: left || state.timer.duration, by: identity() })
          .then(function () { renderPanel('timer', currentBody); });
      } else {
        var minutesEl = $('timerMinutes');
        var minutes = minutesEl ? Math.min(120, Math.max(1, Number(minutesEl.value) || 25)) : 25;
        S.set('timer', { running: true, mode: 'focus', endsAt: Date.now() + minutes * 60000, duration: minutes * 60, by: identity() })
          .then(function () { toast('专注开始，另一边也会看到'); renderPanel('timer', currentBody); });
      }
      return true;
    }
    if (hit('[data-timer-reset]')) {
      S.set('timer', { running: false, mode: 'focus', endsAt: 0, duration: 1500, by: identity() })
        .then(function () { renderPanel('timer', currentBody); });
      return true;
    }

    /* 设置 */
    var idChip = hit('[data-identity]');
    if (idChip) {
      setIdentity(idChip.getAttribute('data-identity'));
      renderPanel('settings', currentBody);
      return true;
    }
    if (hit('[data-profile-save]')) {
      var sd = $('startDate');
      var value = sd ? sd.value : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) { toast('先选一个日期'); return true; }
      S.mutate('profile', function (doc) {
        doc.startDate = value;
        return doc;
      }).then(function () {
        toast('开始日期记住啦');
        renderDays();
        renderStats();
        renderPanel('settings', currentBody);
      });
      return true;
    }
    if (hit('[data-photo-token-save]')) {
      var tk = $('ghToken');
      var value = tk ? tk.value.trim() : '';
      if (!value) { toast('先把密钥粘进来'); return true; }
      if (!photoStore() || !photoStore().enabled) { toast('config.js 里还没配 storage.repo'); return true; }
      photoStore().setToken(value);
      if (tk) tk.value = '';
      fillPhotoStats();
      renderPanel('settings', currentBody);
      /* 这台设备还没解锁过云端：贴好密钥后要重新输一次密码，才能建立 / 打开云端空间 */
      if (S.configured && (!S.hasKey || !S.hasKey())) {
        relockForPassword('密钥存好了，再输一次空间密码：会把这台设备的内容加密传到云端。');
        return true;
      }
      toast('密钥存好了，正在同步…');
      S.refresh().then(function () { refreshUI(); }, function () { /* 网络不好就算了 */ });
      return true;
    }
    if (hit('[data-photo-token-clear]')) {
      if (photoStore()) photoStore().clearToken();
      toast('密钥已清除，这台设备只能看，不能改');
      renderPanel('settings', currentBody);
      return true;
    }
    if (hit('[data-photo-refresh]')) {
      var ps3 = photoStore();
      if (!ps3 || !ps3.enabled) { toast('config.js 里还没配 storage.repo'); return true; }
      toast('正在同步…');
      ps3.list(true).then(function (rows) {
        toast('同步完成，仓库里现在有 ' + rows.length + ' 张照片');
        renderStats();
        if (currentPanel === 'memories') renderPanel('memories', currentBody);
        else renderPanel('settings', currentBody);
      }).catch(function (err) {
        toast('同步失败：' + ((err && err.message) || '网络'));
      });
      return true;
    }
    if (hit('[data-password-save]')) {
      var oldEl = $('oldPassword'), newEl = $('newPassword'), new2El = $('newPassword2');
      var oldPwd = oldEl ? oldEl.value : '';
      var newPwd = newEl ? newEl.value : '';
      var newPwd2 = new2El ? new2El.value : '';
      if (newPwd.length < 4) { toast('新密码至少 4 位'); return true; }
      if (newPwd !== newPwd2) { toast('两次输入的新密码不一样'); return true; }
      SpaceApp.verifyPassword(oldPwd).then(function (ok) {
        if (!ok) { toast('现在的密码不对'); return; }
        var salt = S.makeSalt();
        var doc = { enabled: true, salt: salt, hash: S.hashPassword(newPwd, salt), at: Date.now() };
        /* 先把本机票据换成新的，否则“旧票据失效”的检查会把自己踢出去 */
        S.writeTicket(doc.hash.slice(0, 12));
        /* 云端：用新密码重新包裹数据密钥（文件本身不用重传） */
        var rewrap = (S.configured && S.changePassword) ? S.changePassword(newPwd) : Promise.resolve(true);
        return rewrap.then(function () {
          return S.set('access', doc);
        }).then(function () {
          toast('密码改好了，另一台设备也要用新密码进来');
          renderPanel('settings', currentBody);
        }, function (err) {
          toast('改密码失败：' + ((err && err.message) || '网络'));
        });
      });
      return true;
    }
    if (hit('[data-sync-now]')) {
      toast('正在同步……');
      S.refresh().then(function (ok) {
        toast(ok ? '同步完成' : '同步失败，检查网络或云端密钥');
        refreshUI();
      });
      return true;
    }
    if (hit('[data-sync-test]')) {
      var out = $('selftestOut');
      if (out) { out.hidden = false; out.innerHTML = '<p class="panel-note">正在自检……</p>'; }
      S.selfTest().then(function (report) {
        if (!out) return;
        out.innerHTML = report.steps.map(function (s) {
          return '<p class="selftest-row ' + (s.ok ? 'is-ok' : 'is-bad') + '"><b>' + (s.ok ? '✓' : '×') + ' ' + esc(s.name) + '</b><span>' + esc(s.detail) + '</span></p>';
        }).join('');
      });
      return true;
    }
    return false;
  }

  function handleChange(e, root) {
    var target = e.target;
    if (!target || !target.closest) return false;
    if (target.closest('[data-memory-file]')) {
      var file = target.files && target.files[0];
      if (!file) return true;
      var ps = photoStore();
      if (!ps || !ps.enabled) { toast('config.js 里还没配 storage.repo，照片没地方放'); return true; }
      toast('正在压缩照片……');
      ps.prepare(file).then(function (res) {
        pendingPhoto = {
          blob: res.blob,
          preview: res.preview,
          width: res.width,
          height: res.height
        };
        var box = $('memoryPickBox');
        if (box) box.textContent = '换一张照片';
        var preview = $('memoryPreview');
        if (preview) {
          preview.hidden = false;
          preview.innerHTML = '<img src="' + esc(pendingPhoto.preview) + '" alt="预览">';
        }
        toast('照片准备好了（' + Math.round(res.blob.size / 1024) + 'KB），点保存就提交进仓库');
      }).catch(function (err) {
        toast(err.message || '这张照片用不了');
      });
      return true;
    }
    return false;
  }

  /* ---------------- 密码门 ---------------- */
  function accessDoc() {
    return state.access;
  }

  /* 密码同时是解密钥匙：先解锁云端（解开 meta 里的数据密钥），再比对密码哈希 */
  var unlockHint = '';
  function verifyPassword(input) {
    var fallback = String((CFG.access && CFG.access.password) || '');
    var st = S.status();
    var open;
    unlockHint = '';
    if (!S.configured || !st.secure) {
      /* 本机模式 / 浏览器不支持加密：只做密码门 */
      open = Promise.resolve(true);
    } else {
      open = S.hasSpace().then(function (exists) {
        if (!exists) {
          /* 云端还没有空间：第一次只能用 config.js 里那个密码把它建起来，
             这样两台设备第一次进来用的密码一定是同一个 */
          if (!fallback || String(input) !== fallback) return false;
          if (!S.hasToken()) {
            /* 还没有写入密钥：先按本机模式用，等贴了密钥、再解锁一次就会建立云端空间 */
            unlockHint = '';
            return true;
          }
          return S.createSpace(input).then(function () { return true; }, function (err) {
            unlockHint = '建立云端空间失败：' + ((err && err.message) || '网络不通');
            return false;
          });
        }
        return S.unlock(input).then(function () { return true; }, function () { return false; });
      }, function () {
        /* 读不到 meta（断网）：先按本机缓存进来，等有网再说 */
        return true;
      });
    }
    return open.then(function (ok) {
      if (!ok) return false;
      return S.refresh().then(function () { pullAll(); }, function () { pullAll(); }).then(function () {
        var doc = state.access;
        if (doc && doc.hash) return S.hashPassword(input, doc.salt) === doc.hash;
        /* 云端还没有密码记录：用 config.js 里那个进来，并把它写进云端。
           这里必须是「只创建、不覆盖」：两台设备同时首次进入时，
           后到的那台不能把对方刚设好的密码改掉。 */
        if (!fallback || String(input) !== fallback) return false;
        var salt = S.makeSalt();
        var seeded = { enabled: true, salt: salt, hash: S.hashPassword(fallback, salt), at: Date.now() };
        return S.mutate('access', function (remote) {
          if (remote && remote.hash) return null;
          return seeded;
        }).then(function (finalDoc) {
          var use = (finalDoc && finalDoc.hash) ? finalDoc : seeded;
          state.access = use;
          return S.hashPassword(input, use.salt) === use.hash;
        }, function () {
          state.access = seeded;
          return true;
        });
      });
    }).then(function (ok) {
      if (ok) { renderSyncChip(); refreshUI(); }
      return ok;
    });
  }
  /* 把密码门重新盖上来：贴好写入密钥后需要再解锁一次 */
  function relockForPassword(hint) {
    document.body.classList.remove('access-unlocked');
    var gate = $('accessGate');
    if (gate) {
      gate.classList.remove('is-unlocked');
      gate.removeAttribute('aria-hidden');
    }
    var appEl = $('app');
    if (appEl) appEl.setAttribute('aria-hidden', 'true');
    var errEl = $('accessError');
    if (errEl) errEl.textContent = hint || '请输入空间密码。';
    var pwd = $('accessPassword');
    if (pwd) {
      pwd.value = '';
      try { pwd.focus(); } catch (e) { /* 忽略 */ }
    }
  }

  function ticketMatches() {
    var ticket = S.readTicket();
    var doc = state.access;
    if (!ticket) return false;
    if (!doc || !doc.hash) return true;      /* 云端还没有密码时，旧票据继续有效 */
    return ticket === doc.hash.slice(0, 12);
  }

  /* ---------------- 提醒到点检查 ---------------- */
  function checkDueReminders() {
    var now = Date.now();
    var due = state.reminders.filter(function (it) { return !it.done && Number(it.at) <= now; });
    if (!due.length) return;
    var ids = due.map(function (it) { return it.id; });
    toast('提醒时间到：' + due[0].text);
    S.mutate('reminders', function (doc) {
      var items = Array.isArray(doc.items) ? doc.items : [];
      items.forEach(function (it) {
        if (ids.indexOf(it.id) >= 0) { it.done = true; it.doneAt = now; }
      });
      return { items: items };
    });
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    pullAll();
    renderDays();
    renderHomeNote();
    renderStats();
    renderSyncChip();

    /* 第一次打开：把 config.js 里的开始日期写进云端，之后以云端为准 */
    if (!state.profile.startDate && CFG.couple && CFG.couple.startDate) {
      var seedDate = String(CFG.couple.startDate);
      if (/^\d{4}-\d{2}-\d{2}$/.test(seedDate) && S.configured) {
        S.mutate('profile', function (doc) {
          if (!doc.startDate) doc.startDate = seedDate;
          return doc;
        });
      }
    }

    S.on('change', function (detail) {
      refreshUI();
      if (detail && detail.key === 'reminders') checkDueReminders();
    });
    S.on('status', function () { renderSyncChip(); });

    S.ready.then(function () {
      pullAll();
      refreshUI();
      checkDueReminders();
      /* 仓库里的照片：有就拿来展示，没有也不影响其他功能 */
      var ps = photoStore();
      if (ps && ps.enabled) {
        ps.list().then(function () {
          refreshUI();
        }).catch(function () { /* 网络不行就先不显示相册 */ });
      }
    });

    /* 番茄钟倒计时：只刷新面板里的数字，不重新渲染整块 */
    setInterval(function () {
      var clock = $('panelTimerClock');
      if (clock && state.timer.running) clock.textContent = fmt(timerRemaining());
      var chip = $('bubuCountdown');
      if (chip && state.timer.running && !chip.hidden) {
        var c = $('bubuCountdownClock');
        if (c) c.textContent = fmt(timerRemaining());
      }
    }, 1000);

    var noteClose = $('bubuNoteClose');
    if (noteClose) noteClose.addEventListener('click', function (e) { e.preventDefault(); hideHomeNote(); });
  }

  global.SpaceApp = {
    init: init,
    renderPanel: renderPanel,
    handleClick: handleClick,
    handleChange: handleChange,
    refreshUI: refreshUI,
    verifyPassword: verifyPassword,
    unlockHint: function () { return unlockHint; },
    ticketMatches: ticketMatches,
    daysSince: daysSince,
    state: state,
    toast: toast,
    statusText: statusText
  };
})(window);
