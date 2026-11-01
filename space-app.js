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

  /* ---------------- 同步状态 ---------------- */
  function statusText() {
    var st = S.status();
    if (!st.configured) return '未接入云端';
    if (!st.online) return st.pending ? '离线 · ' + st.pending + ' 条待上传' : '离线中';
    if (st.pending) return '待上传 ' + st.pending + ' 条';
    if (!st.lastSync) return '正在连接';
    var d = new Date(st.lastSync);
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return '云端已连接 · ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function renderSyncChip() {
    var chip = $('syncChip');
    if (!chip) return;
    var st = S.status();
    chip.textContent = statusText();
    chip.classList.toggle('is-offline', st.configured ? !st.online : true);
    chip.title = st.configured
      ? '数据存在 LeanCloud，两台设备看到的是同一份内容'
      : '还没填 LeanCloud 密钥，现在只存在这台设备的浏览器里';
  }

  /* ---------------- 回忆：照片压缩 ---------------- */
  function dataURLtoBlob(dataUrl) {
    var parts = String(dataUrl).split(',');
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
    var bin = atob(parts[1] || '');
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  function compressImage(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      if (!global.URL || !global.URL.createObjectURL) { reject(new Error('浏览器不支持本地预览')); return; }
      var url = global.URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
          var w = Math.max(1, Math.round((img.width || 1) * scale));
          var h = Math.max(1, Math.round((img.height || 1) * scale));
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          global.URL.revokeObjectURL(url);
          if (canvas.toBlob) {
            canvas.toBlob(function (blob) {
              if (blob) resolve({ blob: blob, width: w, height: h });
              else reject(new Error('图片压缩失败'));
            }, 'image/jpeg', quality);
          } else {
            resolve({ blob: dataURLtoBlob(canvas.toDataURL('image/jpeg', quality)), width: w, height: h });
          }
        } catch (e) { reject(e); }
      };
      img.onerror = function () {
        global.URL.revokeObjectURL(url);
        reject(new Error('这张照片读不出来，iPhone 的 HEIC 请先在相册里转成 JPG'));
      };
      img.src = url;
    });
  }

  /* ---------------- 面板渲染 ---------------- */
  function intro(title, sub) {
    return '<div class="bubu-panel-intro"><span>' + esc(title) + '</span><small>' + esc(sub) + '</small></div>';
  }
  function empty(icon, title, copy) {
    return '<div class="panel-empty"><span class="panel-empty-icon">' + icon + '</span><b>' + esc(title) + '</b><p>' + esc(copy) + '</p></div>';
  }

  function renderMemories() {
    var html = intro('我们的回忆', '照片和故事都存在云端，两个人打开都能看到');
    html += '<div class="panel-toolbar"><button class="bubu-primary" type="button" data-memory-new>＋ 添加一段回忆</button>' +
      '<span class="panel-count">共 <b>' + state.memories.length + '</b> 条</span></div>';
    if (memoryEditorOpen) {
      html += '<div class="memory-editor" id="memoryEditor">' +
        '<label class="memory-pick"><input type="file" accept="image/*" data-memory-file hidden><span class="memory-pick-box" id="memoryPickBox">选择照片</span></label>' +
        '<div class="memory-preview" id="memoryPreview"' + (pendingPhoto ? '' : ' hidden') + '>' +
        (pendingPhoto ? '<img src="' + esc(pendingPhoto.preview) + '" alt="预览">' : '') + '</div>' +
        '<input class="bubu-field" id="memoryTitle" type="text" maxlength="40" placeholder="给这段回忆起个名字">' +
        '<textarea class="bubu-field bubu-note-field" id="memoryText" rows="3" maxlength="300" placeholder="那天发生了什么……"></textarea>' +
        '<div class="bubu-form-actions"><button class="bubu-primary" type="button" data-memory-save>保存到云端</button><button type="button" data-memory-cancel>取消</button></div>' +
        '<p class="panel-note">照片会自动压到长边 1200 像素再上传，省流量也省空间。</p>' +
        '</div>';
    }
    if (!state.memories.length) {
      html += empty('♡', '还没有回忆', '把照片和当时的心情放进来，对方刷新就能看到。');
    } else {
      var items = state.memories.slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
      html += '<div class="memory-grid">';
      items.forEach(function (item) {
        html += '<article class="memory-card" data-memory-id="' + esc(item.id) + '">' +
          '<div class="memory-photo">' + (item.photo
            ? '<img loading="lazy" decoding="async" src="' + esc(item.photo) + '" alt="' + esc(item.title || '回忆') + '">'
            : '<span class="memory-no-photo">♡</span>') + '</div>' +
          '<div class="memory-info"><b>' + esc(item.title || '没有名字的一段') + '</b>' +
          (item.text ? '<p>' + esc(item.text) + '</p>' : '') +
          '<small>' + esc(when(item.at)) + (item.by ? ' · ' + esc(identityLabel(item.by)) : '') + '</small></div>' +
          '<button class="panel-del" type="button" data-memory-del="' + esc(item.id) + '" aria-label="删除这条回忆">×</button>' +
          '</article>';
      });
      html += '</div>';
    }
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

  function renderSettings() {
    var html = intro('设置', '改动会同步到云端，两台设备保持一致');
    html += '<div class="setting-block"><b>我是</b><div class="identity-row">';
    [['cat', '小猫'], ['fish', '小鱼'], ['us', '我们']].forEach(function (pair) {
      html += '<button type="button" class="identity-chip' + (identity() === pair[0] ? ' is-active' : '') + '" data-identity="' + pair[0] + '">' + pair[1] + '</button>';
    });
    html += '</div><small>只影响这台设备上显示的署名</small></div>';

    html += '<div class="setting-block"><b>恋爱开始日期</b>' +
      '<div class="panel-inline-form"><input class="bubu-field" id="startDate" type="date" value="' + esc(state.profile.startDate || '') + '">' +
      '<button class="bubu-primary" type="button" data-profile-save>保存</button></div>' +
      '<small>首页的「一起走过第几天」按这一天算</small></div>';

    html += '<div class="setting-block"><b>空间密码</b>' +
      '<input class="bubu-field" id="oldPassword" type="password" autocomplete="current-password" placeholder="现在的密码">' +
      '<input class="bubu-field" id="newPassword" type="password" autocomplete="new-password" placeholder="新密码（至少 4 位）">' +
      '<input class="bubu-field" id="newPassword2" type="password" autocomplete="new-password" placeholder="再输一次新密码">' +
      '<div class="bubu-form-actions"><button class="bubu-primary" type="button" data-password-save>改密码</button></div>' +
      '<small>密码只存加盐哈希，改完两台设备都用新密码</small></div>';

    html += '<div class="setting-block"><b>同步</b>' +
      '<p class="panel-note" id="syncDetail">' + esc(statusText()) + ' · ' + esc(S.config.serverURL || '未配置服务器') + '</p>' +
      '<div class="bubu-form-actions"><button class="bubu-primary" type="button" data-sync-now>立即同步</button>' +
      '<button type="button" data-sync-test>云端自检</button></div>' +
      '<div class="selftest-out" id="selftestOut" hidden></div></div>';

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
    item.photo = draft.photo || '';
    return S.mutate('memories', function (doc) {
      var items = Array.isArray(doc.items) ? doc.items : [];
      items.push(item);
      return { items: items };
    }).then(function () {
      toast('这段回忆已经存到云端');
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
      if (!S.configured) { toast('还没有接入云端，填好 config.js 的 cloud 就能保存'); return true; }
      busy = true;
      var photoPromise = pendingPhoto
        ? S.uploadFile(pendingPhoto.blob, 'memory-' + Date.now() + '.jpg').then(function (r) { return r.url; }).catch(function (err) {
          /* 上传失败就不要把整条记录弄丢：文字先存，照片后面再补 */
          toast('照片上传失败（' + (err.message || '网络') + '），先存文字');
          return '';
        })
        : Promise.resolve('');
      photoPromise.then(function (photo) {
        return addMemory({ title: title || '一段回忆', text: text, photo: photo });
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
      var mid = memDel.getAttribute('data-memory-del');
      if (global.confirm && !global.confirm('删掉这段回忆？')) return true;
      S.mutate('memories', function (doc) {
        var items = Array.isArray(doc.items) ? doc.items : [];
        return { items: items.filter(function (it) { return it.id !== mid; }) };
      }).then(function () { toast('已经删掉'); renderPanel('memories', currentBody); });
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
        renderPanel('settings', currentBody);
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
        return S.set('access', doc).then(function () {
          toast('密码改好了，两台设备都用新密码');
          renderPanel('settings', currentBody);
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
      toast('正在压缩照片……');
      compressImage(file, 1200, 0.82).then(function (res) {
        pendingPhoto = {
          blob: res.blob,
          preview: global.URL.createObjectURL(res.blob),
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
        toast('照片准备好了（' + Math.round(res.blob.size / 1024) + 'KB）');
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
  function verifyPassword(input) {
    var doc = state.access;
    if (doc && doc.hash) {
      return Promise.resolve(S.hashPassword(input, doc.salt) === doc.hash);
    }
    /* 云端还没有密码：用 config.js 里那个进来，并把它写进云端。
       这里必须是「只创建、不覆盖」：两台设备同时首次进入时，
       后到的那台不能把对方刚设好的密码改掉。 */
    var fallback = String((CFG.access && CFG.access.password) || '');
    if (!fallback || String(input) !== fallback) return Promise.resolve(false);
    var salt = S.makeSalt();
    var seeded = { enabled: true, salt: salt, hash: S.hashPassword(fallback, salt), at: Date.now() };
    return S.mutate('access', function (remote) {
      if (remote && remote.hash) return null;      /* 别人已经设过了，不动它 */
      return seeded;
    }).then(function (finalDoc) {
      var use = (finalDoc && finalDoc.hash) ? finalDoc : seeded;
      state.access = use;
      return S.hashPassword(input, use.salt) === use.hash;
    }, function () {
      /* 断网：先让本次进来，等有网再补写 */
      state.access = seeded;
      return true;
    });
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
    ticketMatches: ticketMatches,
    daysSince: daysSince,
    state: state,
    toast: toast,
    statusText: statusText
  };
})(window);
