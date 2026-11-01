/* ============================================================
   云端数据层（LeanCloud REST，无第三方 SDK 依赖）
   ------------------------------------------------------------
   这一层只负责「把 JSON 存到线上、拿回来」，不关心业务。
   所有业务字段（便签、提醒、愿望、回忆……）都在 space-app.js 里。
   ============================================================ */
(function (global) {
  'use strict';

  var CACHE_KEY = 'catfish-space-cache-v2';
  var QUEUE_KEY = 'catfish-space-queue-v2';
  var TICKET_KEY = 'catfish-space-unlocked-v1';
  var TIMEOUT = 15000;

  /* ---------------- 配置 ---------------- */
  function readConfig() {
    var raw = (global.LOVE_CONFIG && global.LOVE_CONFIG.cloud) || {};
    return {
      appId: String(raw.appId || '').trim(),
      appKey: String(raw.appKey || '').trim(),
      serverURL: String(raw.serverURL || '').trim().replace(/\/+$/, ''),
      className: String(raw.className || 'SpaceDoc').trim() || 'SpaceDoc'
    };
  }

  var CFG = readConfig();
  /* 三个都填了才算接入云端；否则退化成「只存本机」，页面照常能用。 */
  var configured = !!(CFG.appId && CFG.appKey && CFG.serverURL);
  var CLASS_URL = CFG.serverURL + '/1.1/classes/' + encodeURIComponent(CFG.className);

  /* ---------------- 本地缓存 / 待发队列 ---------------- */
  var docs = {};      /* key -> { payload, rev, updatedAt, objectId } */
  var queue = [];     /* [{ key, payload, rev }] 网络失败时暂存，下次同步补发 */
  var lastSync = 0;
  var lastError = '';
  var online = (typeof navigator === 'undefined') ? true : navigator.onLine !== false;
  var listeners = [];
  var chains = {};    /* 每个 key 一条串行链，避免同一条数据并发写坏 */

  function loadCache() {
    try {
      var raw = global.localStorage.getItem(CACHE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.docs && typeof parsed.docs === 'object') docs = parsed.docs;
        if (parsed && typeof parsed.lastSync === 'number') lastSync = parsed.lastSync;
      }
    } catch (e) { /* 隐私模式或数据损坏：从空开始 */ }
    try {
      var q = global.localStorage.getItem(QUEUE_KEY);
      if (q) { var arr = JSON.parse(q); if (Array.isArray(arr)) queue = arr; }
    } catch (e2) { queue = []; }
  }
  function saveCache() {
    try { global.localStorage.setItem(CACHE_KEY, JSON.stringify({ docs: docs, lastSync: lastSync })); } catch (e) { /* 忽略配额错误 */ }
  }
  function saveQueue() {
    try { global.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 事件 ---------------- */
  function emit(name, detail) {
    for (var i = 0; i < listeners.length; i++) {
      try {
        if (listeners[i].name === name) listeners[i].fn(detail);
      } catch (e) { /* 一个监听器出错不影响其它 */ }
    }
  }
  function on(name, fn) { listeners.push({ name: name, fn: fn }); }

  /* ---------------- HTTP（XHR：微信 X5 内核兼容性最好） ---------------- */
  function markOffline(err) {
    online = false;
    lastError = (err && err.message) || 'network';
    emit('status', status());
    return err;
  }

  function http(method, url, body, extraHeaders) {
    return new Promise(function (resolve, reject) {
      if (!configured) { reject(new Error('云端未配置')); return; }
      var x = new XMLHttpRequest();
      try { x.open(method, url, true); } catch (e) { reject(new Error('无法发起请求')); return; }
      x.timeout = TIMEOUT;
      try {
        x.setRequestHeader('X-LC-Id', CFG.appId);
        x.setRequestHeader('X-LC-Key', CFG.appKey);
      } catch (e1) { /* 少数环境限制设置头，交给 onerror 兜底 */ }
      if (body instanceof Blob) {
        x.setRequestHeader('Content-Type', body.type || 'application/octet-stream');
      } else if (body !== null && body !== undefined) {
        x.setRequestHeader('Content-Type', 'application/json');
      }
      if (extraHeaders) {
        for (var h in extraHeaders) {
          if (Object.prototype.hasOwnProperty.call(extraHeaders, h)) x.setRequestHeader(h, extraHeaders[h]);
        }
      }
      x.onload = function () {
        var data = null;
        try { data = x.responseText ? JSON.parse(x.responseText) : null; } catch (e) { data = null; }
        if (x.status >= 200 && x.status < 300) {
          online = true;
          lastError = '';
          resolve(data);
        } else {
          var err = new Error((data && (data.error || data.code)) ? (data.error || ('错误码 ' + data.code)) : ('HTTP ' + x.status));
          err.status = x.status;
          err.code = data && data.code;
          if (x.status === 0 || x.status >= 500) markOffline(err);
          reject(err);
        }
      };
      x.onerror = function () { reject(markOffline(new Error('网络未连通'))); };
      x.ontimeout = function () { reject(markOffline(new Error('请求超时'))); };
      x.onabort = function () { reject(new Error('请求被取消')); };
      try { x.send(body === undefined ? null : body); } catch (e2) { reject(markOffline(new Error('发送失败'))); }
    });
  }

  /* ---------------- 文档读写 ---------------- */
  function normalizeRow(row) {
    return {
      payload: (row && row.payload && typeof row.payload === 'object') ? row.payload : {},
      rev: Number(row && row.rev) || 0,
      updatedAt: (row && row.updatedAt) || '',
      objectId: (row && row.objectId) || ''
    };
  }

  function fetchAll() {
    return http('GET', CLASS_URL + '?limit=1000&order=docKey').then(function (res) {
      var rows = (res && res.results) || [];
      var next = {};
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var key = row && row.docKey;
        if (!key) continue;
        next[key] = normalizeRow(row);
      }
      /* 云端有、本地也有的，取云端；云端没有但本地有且未同步的，保留 */
      for (var k in next) if (Object.prototype.hasOwnProperty.call(next, k)) docs[k] = next[k];
      lastSync = Date.now();
      online = true;
      lastError = '';
      saveCache();
      emit('status', status());
      return true;
    });
  }

  function fetchOne(key) {
    var d = docs[key];
    if (!configured || !d || !d.objectId) return Promise.resolve(d ? d.payload : null);
    return http('GET', CLASS_URL + '/' + d.objectId).then(function (row) {
      var n = normalizeRow(row);
      docs[key] = n;
      saveCache();
      return n.payload;
    }).catch(function () {
      /* 网络断了就用缓存，不要让界面卡住 */
      return d ? d.payload : null;
    });
  }

  /* 写入一条；revGuard 用来做「只有版本没被别人改过才写」的乐观锁 */
  function writeDoc(key, payload, revGuard) {
    var d = docs[key];
    var body = JSON.stringify({ payload: payload, rev: revGuard + 1 });
    if (d && d.objectId) {
      var q = '?where=' + encodeURIComponent(JSON.stringify({ rev: revGuard }));
      return http('PUT', CLASS_URL + '/' + d.objectId + q, body).then(function (res) {
        docs[key] = {
          payload: payload,
          rev: revGuard + 1,
          objectId: d.objectId,
          updatedAt: (res && res.updatedAt) || new Date().toISOString()
        };
        saveCache();
        return payload;
      });
    }
    return http('POST', CLASS_URL, JSON.stringify({ docKey: key, payload: payload, rev: 1 })).then(function (res) {
      docs[key] = {
        payload: payload,
        rev: 1,
        objectId: (res && res.objectId) || '',
        updatedAt: (res && res.createdAt) || new Date().toISOString()
      };
      saveCache();
      return payload;
    });
  }

  function enqueue(key, payload, rev) {
    var found = false;
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].key === key) { queue[i].payload = payload; queue[i].rev = rev; found = true; break; }
    }
    if (!found) queue.push({ key: key, payload: payload, rev: rev });
    saveQueue();
    emit('status', status());
  }

  function flushQueue() {
    if (!configured || !queue.length) return Promise.resolve();
    var snapshot = queue.slice();
    queue = [];
    saveQueue();
    var chainP = Promise.resolve();
    snapshot.forEach(function (item) {
      chainP = chainP.then(function () {
        return writeDoc(item.key, item.payload, item.rev).catch(function (err) {
          /* 版本冲突（305）：云端已经有更新，丢掉这次的旧写入，避免把新内容盖回去 */
          if (err && err.code === 305) return null;
          enqueue(item.key, item.payload, item.rev);
          return null;
        });
      });
    });
    return chainP;
  }

  /* 每个 key 串行执行，避免快速连点时自己踩自己 */
  function chain(key, task) {
    var prev = chains[key] || Promise.resolve();
    var run = prev.then(task, task);
    chains[key] = run.then(function () { }, function () { });
    return run;
  }

  function clone(v) {
    if (v === null || typeof v !== 'object') return v;
    return JSON.parse(JSON.stringify(v));
  }

  /* ---------------- 对外接口 ---------------- */
  function get(key) {
    var d = docs[key];
    return d ? clone(d.payload) : null;
  }

  /* 整份替换。先读一次云端最新版本再写，避免拿着旧 rev 去撞 305 把改动丢掉。 */
  function set(key, payload) {
    var next = clone(payload);
    if (!configured) {
      docs[key] = { payload: next, rev: (docs[key] ? docs[key].rev : 0) + 1, objectId: '', updatedAt: new Date().toISOString() };
      saveCache();
      emit('change', { key: key, payload: clone(next), local: true });
      return Promise.resolve(next);
    }
    /* 乐观更新：先改本地并广播，界面立刻有反馈，随后再和云端对齐 */
    docs[key] = {
      payload: next,
      rev: docs[key] ? docs[key].rev : 0,
      objectId: docs[key] ? docs[key].objectId : '',
      updatedAt: new Date().toISOString()
    };
    saveCache();
    emit('change', { key: key, payload: clone(next), local: true });
    return mutate(key, function () { return clone(next); }).then(function () {
      return next;
    });
  }

  /* 读最新的云端内容 -> 交给 updater 改 -> 带版本校验写回。
     冲突（305）时自动重读重试，这样两个人在不同设备上同时加东西不会互相覆盖。 */
  function mutate(key, updater, attempts) {
    var left = typeof attempts === 'number' ? attempts : 3;
    return chain(key, function () {
      function attempt(n) {
        return fetchOne(key).then(function (remote) {
          var base = (remote && typeof remote === 'object') ? clone(remote) : {};
          var next = updater(clone(base));
          if (next === undefined || next === null) return base;   /* updater 决定不改 */
          return writeDoc(key, next, docs[key] ? docs[key].rev : 0).then(function () {
            emit('change', { key: key, payload: clone(next) });
            emit('status', status());
            return next;
          });
        }).catch(function (err) {
          if (err && err.code === 305 && n > 1) return attempt(n - 1);
          /* 没配云端或者网络不通：先存在本机，配了云端的再进队列等补发 */
          var base2 = get(key) || {};
          var next2 = updater(clone(base2));
          if (next2 === undefined || next2 === null) return base2;
          var prevRev = docs[key] ? docs[key].rev : 0;
          docs[key] = {
            payload: next2,
            rev: prevRev + 1,
            objectId: docs[key] ? docs[key].objectId : '',
            updatedAt: new Date().toISOString()
          };
          saveCache();
          if (configured) enqueue(key, next2, prevRev);
          emit('change', { key: key, payload: clone(next2), local: true });
          return next2;
        });
      }
      return attempt(left);
    });
  }

  function refresh() {
    if (!configured) return Promise.resolve(false);
    return flushQueue().then(fetchAll).then(function () {
      emit('change', { key: null, payload: null });
      return true;
    }).catch(function () { return false; });
  }

  function status() {
    return {
      configured: configured,
      online: online,
      pending: queue.length,
      lastSync: lastSync,
      lastError: lastError,
      className: CFG.className
    };
  }

  /* ---------------- 文件上传（回忆照片） ---------------- */
  function uploadFile(blob, filename) {
    if (!configured) return Promise.reject(new Error('云端未配置'));
    var name = filename || ('photo-' + Date.now() + '.jpg');
    var url = CFG.serverURL + '/1.1/files/' + encodeURIComponent(name);
    return http('POST', url, blob).then(function (res) {
      var u = res && res.url;
      if (!u) throw new Error('上传没有返回地址');
      if (u.indexOf('http') !== 0) u = CFG.serverURL + (u.charAt(0) === '/' ? '' : '/') + u;
      return { url: u, objectId: (res && res.objectId) || '' };
    });
  }

  /* ---------------- 密码：SHA-256（不依赖 crypto.subtle，http 环境也能用） ---------------- */
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function sha256(ascii) {
    function rightRotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
    var mathPow = Math.pow;
    var maxWord = mathPow(2, 32);
    var words = [], asciiBitLength = ascii.length * 8;
    var hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var k = K.slice(0);
    var i, j;

    /* UTF-8 编码，让中文密码也正确 */
    var utf8 = [];
    for (i = 0; i < ascii.length; i++) {
      var code = ascii.charCodeAt(i);
      if (code < 0x80) utf8.push(code);
      else if (code < 0x800) utf8.push(0xc0 | (code >> 6), 0x80 | (code & 63));
      else if (code < 0xd800 || code >= 0xe000) utf8.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
      else {
        i += 1;
        var code2 = 0x10000 + (((code & 0x3ff) << 10) | (ascii.charCodeAt(i) & 0x3ff));
        utf8.push(0xf0 | (code2 >> 18), 0x80 | ((code2 >> 12) & 63), 0x80 | ((code2 >> 6) & 63), 0x80 | (code2 & 63));
      }
    }
    asciiBitLength = utf8.length * 8;

    hash = hash.slice(0, 8);
    k = k.slice(0, 64);

    var padded = utf8.slice(0);
    padded.push(0x80);
    while (padded.length % 64 !== 56) padded.push(0);
    /* 末尾 8 字节是「比特长度」的大端整数 */
    var lenHi = Math.floor(asciiBitLength / maxWord);
    var lenLo = asciiBitLength >>> 0;
    for (i = 0; i < 4; i++) padded.push((lenHi >>> (24 - i * 8)) & 255);
    for (i = 0; i < 4; i++) padded.push((lenLo >>> (24 - i * 8)) & 255);

    for (j = 0; j < padded.length; j += 64) {
      var w = new Array(64), chunk = padded.slice(j, j + 64);
      for (i = 0; i < 16; i++) {
        w[i] = (chunk[i * 4] << 24) | (chunk[i * 4 + 1] << 16) | (chunk[i * 4 + 2] << 8) | chunk[i * 4 + 3];
      }
      for (i = 16; i < 64; i++) {
        var s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = hash[0], b = hash[1], c = hash[2], d = hash[3], e = hash[4], f = hash[5], g = hash[6], h = hash[7];
      for (i = 0; i < 64; i++) {
        var S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
        var ch = (e & f) ^ ((~e) & g);
        var temp1 = (h + S1 + ch + k[i] + w[i]) | 0;
        var S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var temp2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + temp1) | 0;
        d = c; c = b; b = a; a = (temp1 + temp2) | 0;
      }
      hash[0] = (hash[0] + a) | 0; hash[1] = (hash[1] + b) | 0;
      hash[2] = (hash[2] + c) | 0; hash[3] = (hash[3] + d) | 0;
      hash[4] = (hash[4] + e) | 0; hash[5] = (hash[5] + f) | 0;
      hash[6] = (hash[6] + g) | 0; hash[7] = (hash[7] + h) | 0;
    }

    var hex = '';
    for (i = 0; i < 8; i++) {
      var part = (hash[i] >>> 0).toString(16);
      while (part.length < 8) part = '0' + part;
      hex += part;
    }
    return hex;
  }

  /* 密码不落地明文：存 salt + sha256(salt + password) */
  function hashPassword(password, salt) {
    return sha256(String(salt || '') + '\u0001' + String(password == null ? '' : password));
  }
  function makeSalt() {
    var s = '';
    var pool = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (var i = 0; i < 16; i++) s += pool.charAt(Math.floor(Math.random() * pool.length));
    return s;
  }

  /* ---------------- 登录票据 ---------------- */
  function readTicket() {
    try { return global.sessionStorage.getItem(TICKET_KEY) || global.localStorage.getItem(TICKET_KEY) || ''; } catch (e) { return ''; }
  }
  function writeTicket(value) {
    try {
      if (value) {
        global.sessionStorage.setItem(TICKET_KEY, value);
        global.localStorage.setItem(TICKET_KEY, value);
      } else {
        global.sessionStorage.removeItem(TICKET_KEY);
        global.localStorage.removeItem(TICKET_KEY);
      }
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 自检 ---------------- */
  function selfTest() {
    var steps = [];
    function step(name, fn) {
      return fn().then(function (detail) {
        steps.push({ name: name, ok: true, detail: detail || '' });
      }).catch(function (err) {
        steps.push({ name: name, ok: false, detail: (err && (err.message || err.error)) || String(err) });
      });
    }
    var first = configured ? Promise.resolve() : Promise.reject(new Error('config.js 里的 cloud.appId / appKey / serverURL 还没填'));
    return first
      .then(function () { return step('配置读取', function () { return Promise.resolve(CFG.serverURL + ' · ' + CFG.className); }); })
      .then(function () { return step('服务端连通', function () { return http('GET', CFG.serverURL + '/1.1/date').then(function (r) { return '服务器时间 ' + (r && r.iso); }); }); })
      .then(function () { return step('读取数据表', function () { return http('GET', CLASS_URL + '?limit=1').then(function (r) { return '共 ' + ((r && r.results) ? r.results.length : 0) + ' 条（最多看 1 条）'; }); }); })
      .then(function () {
        return step('写入测试', function () {
          var probe = { at: Date.now() };
          return http('POST', CLASS_URL, JSON.stringify({ docKey: '__selftest__', payload: probe, rev: 1 })).then(function (r) {
            var id = r && r.objectId;
            if (!id) throw new Error('创建没有返回 objectId');
            return http('PUT', CLASS_URL + '/' + id + '?where=' + encodeURIComponent(JSON.stringify({ rev: 1 })), JSON.stringify({ payload: { at: probe.at + 1 }, rev: 2 }))
              .then(function () { return http('DELETE', CLASS_URL + '/' + id); })
              .then(function () { return '创建 / 更新 / 删除都通过（objectId ' + id + '）'; })
              .catch(function (err) {
                return http('DELETE', CLASS_URL + '/' + id).then(function () { throw err; }, function () { throw err; });
              });
          });
        });
      })
      .then(function () {
        return step('文件上传', function () {
          /* 1×1 透明 PNG，只验证通道 */
          var b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
          var bin = atob(b64);
          var arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          var blob = new Blob([arr], { type: 'image/png' });
          return uploadFile(blob, 'selftest-' + Date.now() + '.png').then(function (r) { return '上传成功 ' + r.url; });
        });
      })
      .then(function () { return { steps: steps, status: status() }; });
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    loadCache();
    if (!configured) { emit('status', status()); return Promise.resolve(false); }
    return flushQueue().then(fetchAll).catch(function () { return false; });
  }

  if (typeof global.addEventListener === 'function') {
    global.addEventListener('online', function () { online = true; refresh(); });
    global.addEventListener('offline', function () { online = false; emit('status', status()); });
  }
  if (typeof global.document !== 'undefined' && global.document.addEventListener) {
    global.document.addEventListener('visibilitychange', function () {
      if (!global.document.hidden && configured) refresh();
    });
  }

  var readyPromise = init();

  global.Space = {
    ready: readyPromise,
    configured: configured,
    init: init,
    status: status,
    on: on,
    get: get,
    set: set,
    mutate: mutate,
    refresh: refresh,
    uploadFile: uploadFile,
    sha256: sha256,
    hashPassword: hashPassword,
    makeSalt: makeSalt,
    readTicket: readTicket,
    writeTicket: writeTicket,
    ticketKey: TICKET_KEY,
    selfTest: selfTest,
    config: CFG
  };
})(window);
