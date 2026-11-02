/* ============================================================
   云端数据层：GitHub 仓库 + 空间密码加密
   ------------------------------------------------------------
   数据存在哪里：
     仓库 <owner>/<repo> 的 data 分支（另开一个分支，不触发 Pages 构建）
       data/v1/meta.json          加密参数 + 用密码包起来的密钥
       data/v1/docs/<名字>.json   每类内容一个文件（都是密文）
       data/v1/media/<文件名>     照片（也是密文）

   为什么这么做：
     静态站没有服务器，浏览器要写回 GitHub 只能带一个写入密钥。
     密钥被看到也只能「乱写」，看不到内容 —— 内容用空间密码派生的密钥加密，
     真正的密码不会出现在任何文件里。

   加密：
     密码 --PBKDF2-SHA256(150000)--> KEK --包裹--> DEK(随机 32 字节)
     文件全部用 DEK 加密（AES-256-GCM + 随机 IV）。
     换密码只需要用新密码重新包裹 DEK，不用重新加密所有文件。

   并发：
     GitHub Contents API 的 sha 就是版本号：sha 对不上 → 409，
     此时重新读远端、重新套用这次改动、再写一次（最多 3 次），
     所以两个人同时加东西不会互相覆盖。
   ============================================================ */
(function (global) {
  'use strict';

  var CACHE_KEY = 'catfish-space-cache-v3';
  var LEGACY_CACHE_KEY = 'catfish-space-cache-v2';
  var QUEUE_KEY = 'catfish-space-queue-v3';
  var TICKET_KEY = 'catfish-space-unlocked-v1';
  var DEK_KEY = 'catfish-space-dek-v1';
  var TOKEN_KEY = 'catfish-gh-token';          /* 和 photo-store 共用同一个令牌 */
  var TIMEOUT = 25000;
  var POLL_MS = 45000;

  /* ---------------- 配置 ---------------- */
  function readConfig() {
    var raw = (global.LOVE_CONFIG && global.LOVE_CONFIG.storage) || {};
    var repo = String(raw.repo || '').trim();
    var parts = repo.split('/');
    return {
      repo: repo,
      owner: parts[0] || '',
      name: parts[1] || '',
      branch: String(raw.branch || 'data').trim(),
      dir: String(raw.path || 'data/v1').replace(/^\/+|\/+$/g, ''),
      apiBase: String(raw.apiBase || 'https://api.github.com').replace(/\/+$/, ''),
      rawBase: String(raw.rawBase || 'https://raw.githubusercontent.com').replace(/\/+$/, ''),
      token: String(raw.token || '').trim(),
      iterations: Number(raw.iterations) || 150000,
      docs: (raw.docs && raw.docs.length) ? raw.docs.slice() : ['profile', 'notes', 'reminders', 'wishes', 'memories', 'timer', 'access', 'media']
    };
  }

  var CFG = readConfig();
  var configured = !!(CFG.repo && CFG.owner && CFG.name);

  /* ---------------- 运行时状态 ---------------- */
  var docs = {};          /* key -> { payload, rev, updatedAt, sha } */
  var queue = [];         /* [{ key, payload }] 网络失败时暂存，下次补发 */
  var pendingSeed = [];   /* 旧版本存在本机的数据，解锁后补传到云端 */
  var lastSync = 0;
  var lastError = '';
  var online = (typeof global.navigator === 'undefined') ? true : global.navigator.onLine !== false;
  var listeners = [];
  var chains = {};
  var META = null;        /* { v, kdf, iter, salt, wrap, sha } */
  var DEK = null;         /* 解密用的 CryptoKey */
  var branchState = 0;    /* 0 未知、1 已存在 */
  var polling = false;

  var subtle = (global.crypto && global.crypto.subtle) || null;
  var SECURE = !!subtle;

  /* ---------------- 本地缓存 ---------------- */
  function storage() {
    try { return global.localStorage || null; } catch (e) { return null; }
  }

  function loadCache() {
    var ls = storage();
    if (!ls) return;
    var raw = null;
    try { raw = ls.getItem(CACHE_KEY); } catch (e) { raw = null; }
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.docs && typeof parsed.docs === 'object') docs = parsed.docs;
        if (parsed && typeof parsed.lastSync === 'number') lastSync = parsed.lastSync;
        if (parsed && Array.isArray(parsed.pendingSeed)) pendingSeed = parsed.pendingSeed;
      } catch (e) { /* 数据坏了就从空开始 */ }
    } else {
      /* 从旧版本（本机模式）搬一次数据上来 */
      try {
        var legacy = JSON.parse(ls.getItem(LEGACY_CACHE_KEY) || 'null');
        var old = legacy && legacy.docs;
        if (old && typeof old === 'object') {
          Object.keys(old).forEach(function (key) {
            var row = old[key];
            if (!row || !row.payload) return;
            docs[key] = { payload: row.payload, rev: 1, updatedAt: '', sha: '' };
            if (key !== 'access') pendingSeed.push(key);
          });
          if (pendingSeed.length) saveCache();
        }
      } catch (e2) { /* 忽略 */ }
    }
    try {
      var q = ls.getItem(QUEUE_KEY);
      if (q) { var arr = JSON.parse(q); if (Array.isArray(arr)) queue = arr; }
    } catch (e3) { queue = []; }
  }

  function saveCache() {
    var ls = storage();
    if (!ls) return;
    try { ls.setItem(CACHE_KEY, JSON.stringify({ docs: docs, lastSync: lastSync, pendingSeed: pendingSeed })); } catch (e) { /* 配额满了就忽略 */ }
  }

  function saveQueue() {
    var ls = storage();
    if (!ls) return;
    try { ls.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch (e) { /* 忽略 */ }
  }

  /* 还没解锁（本机模式）时写的东西：记下来，等云端空间建好后补传 */
  function markPending(key) {
    if (!configured || key === 'access') return;
    if (pendingSeed.indexOf(key) < 0) pendingSeed.push(key);
  }

  /* ---------------- 事件 ---------------- */
  function emit(name, detail) {
    for (var i = 0; i < listeners.length; i += 1) {
      try {
        if (listeners[i].name === name) listeners[i].fn(detail);
      } catch (e) { /* 一个监听器出错不影响其它 */ }
    }
  }
  function on(name, fn) { listeners.push({ name: name, fn: fn }); }

  function status() {
    return {
      configured: configured,
      locked: configured && !DEK,
      secure: SECURE,
      online: online,
      pending: queue.length,
      lastSync: lastSync,
      lastError: lastError,
      repo: CFG.repo,
      branch: CFG.branch,
      writable: hasToken()
    };
  }

  /* ---------------- 编码 / 加密 ---------------- */
  function utf8Bytes(text) { return new global.TextEncoder().encode(String(text == null ? '' : text)); }
  function utf8Text(bytes) { return new global.TextDecoder().decode(bytes); }

  function toB64(bytes) {
    var arr = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes);
    var out = '';
    for (var i = 0; i < arr.length; i += 0x8000) {
      out += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
    }
    return global.btoa(out);
  }
  function fromB64(text) {
    var bin = global.atob(String(text || '').replace(/\s+/g, ''));
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  function randomBytes(n) {
    var arr = new Uint8Array(n);
    global.crypto.getRandomValues(arr);
    return arr;
  }

  function needKey() {
    if (!DEK) {
      var err = new Error('先输入空间密码');
      err.locked = true;
      throw err;
    }
    return DEK;
  }

  function deriveKek(password, saltBytes, iterations) {
    if (!SECURE) return Promise.reject(new Error('这台浏览器不支持加密（要 https 或 localhost）'));
    return subtle.importKey('raw', utf8Bytes(password), { name: 'PBKDF2' }, false, ['deriveKey'])
      .then(function (base) {
        return subtle.deriveKey({
          name: 'PBKDF2',
          salt: saltBytes,
          iterations: Math.max(10000, Number(iterations) || 150000),
          hash: 'SHA-256'
        }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
  }

  function importDek(rawBytes) {
    return subtle.importKey('raw', rawBytes, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  }

  function aesEncrypt(key, bytes) {
    var iv = randomBytes(12);
    return subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, bytes).then(function (ct) {
      var buf = new Uint8Array(12 + ct.byteLength);
      buf.set(iv, 0);
      buf.set(new Uint8Array(ct), 12);
      return buf;
    });
  }

  function aesDecrypt(key, buf) {
    var bytes = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf);
    if (bytes.length < 13) return Promise.reject(new Error('密文损坏'));
    return subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12))
      .then(function (plain) { return new Uint8Array(plain); });
  }

  function encryptText(text) {
    return Promise.resolve().then(function () {
      return aesEncrypt(needKey(), utf8Bytes(text));
    }).then(function (buf) {
      return JSON.stringify({ v: 2, b: toB64(buf) });
    });
  }

  function decryptText(text) {
    return Promise.resolve().then(function () {
      var box = JSON.parse(String(text || ''));
      if (!box || !box.b) throw new Error('数据格式不对');
      return aesDecrypt(needKey(), fromB64(box.b));
    }).then(function (bytes) { return utf8Text(bytes); });
  }

  /* ---------------- HTTP ---------------- */
  function authHeaders() {
    var h = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    var tk = hasToken() ? token() : '';
    if (tk) h['Authorization'] = 'Bearer ' + tk;
    return h;
  }

  function request(url, opt) {
    if (typeof global.fetch !== 'function') return Promise.reject(new Error('这个浏览器不支持 fetch'));
    var options = opt || {};
    options.cache = 'no-store';
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        online = false;
        lastError = '请求超时';
        emit('status', status());
        reject(new Error('请求超时'));
      }, TIMEOUT);
      global.fetch(url, options).then(function (res) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        online = true;
        resolve(res);
      }, function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        online = false;
        lastError = (err && err.message) || '网络未连通';
        emit('status', status());
        reject(new Error(lastError));
      });
    });
  }

  function gh(method, url, body) {
    if (method === 'GET' && !hasToken()) return Promise.reject(new Error('没有读取密钥'));
    var opt = { method: method, headers: authHeaders() };
    if (body !== undefined && body !== null) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    return request(url, opt).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (res.ok) {
          online = true;
          lastError = '';
          return data;
        }
        var err = new Error((data && data.message) || ('GitHub ' + res.status));
        err.status = res.status;
        err.data = data;
        if (res.status >= 500) {
          online = false;
          lastError = err.message;
          emit('status', status());
        }
        throw err;
      });
    });
  }

  function encodePath(path) {
    return String(path).split('/').map(encodeURIComponent).join('/');
  }
  function apiUrl(path) { return CFG.apiBase + '/repos/' + CFG.repo + '/contents/' + encodePath(path); }
  function rawUrl(path) {
    return CFG.rawBase + '/' + CFG.repo + '/' + encodeURIComponent(CFG.branch) + '/' + encodePath(path) + '?t=' + Date.now();
  }

  /* ---------------- 密钥（写入令牌） ---------------- */
  function token() {
    /* 本机贴的优先：这样即使 config.js 里写了 token，也可以在某台设备上换掉 */
    var ls = storage();
    if (ls) {
      try {
        var local = ls.getItem(TOKEN_KEY) || '';
        if (local) return local;
      } catch (e) { /* 忽略 */ }
    }
    return CFG.token;
  }
  function setToken(value) {
    var v = String(value == null ? '' : value).trim();
    var ls = storage();
    if (ls) {
      try {
        if (v) ls.setItem(TOKEN_KEY, v);
        else ls.removeItem(TOKEN_KEY);
      } catch (e) { /* 忽略 */ }
    }
    emit('status', status());
    return hasToken();
  }
  function hasToken() { return !!token(); }

  /* ---------------- 分支 ---------------- */
  function ensureBranch() {
    if (!hasToken()) return Promise.reject(new Error('这台设备没有写入密钥'));
    if (branchState === 1) return Promise.resolve(true);
    return request(CFG.apiBase + '/repos/' + CFG.repo + '/git/ref/heads/' + encodeURIComponent(CFG.branch), { headers: authHeaders() })
      .then(function (res) {
        if (res.ok) { branchState = 1; return true; }
        if (res.status !== 404 && res.status !== 409 && res.status !== 422) throw new Error('仓库访问失败 ' + res.status);
        return createBranch();
      });
  }

  function createBranch() {
    return gh('POST', CFG.apiBase + '/repos/' + CFG.repo + '/git/trees', { tree: [] }).then(function (tree) {
      return gh('POST', CFG.apiBase + '/repos/' + CFG.repo + '/git/commits', {
        message: 'space: 初始化数据分支',
        tree: tree && tree.sha,
        parents: []
      });
    }).then(function (commit) {
      return gh('POST', CFG.apiBase + '/repos/' + CFG.repo + '/git/refs', {
        ref: 'refs/heads/' + CFG.branch,
        sha: commit && commit.sha
      });
    }).then(function () {
      branchState = 1;
      return true;
    }, function (err) {
      if (err && (err.status === 422 || err.status === 409)) { branchState = 1; return true; }
      throw err;
    });
  }

  /* ---------------- 文件读写 ---------------- */
  function readTextFile(path) {
    if (hasToken()) {
      return gh('GET', apiUrl(path) + '?ref=' + encodeURIComponent(CFG.branch)).then(function (data) {
        if (!data || !data.content) return null;
        return { sha: data.sha || '', text: utf8Text(fromB64(data.content)) };
      }, function (err) {
        if (err && err.status === 404) return null;
        throw err;
      });
    }
    return request(rawUrl(path), {}).then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('读取失败 ' + res.status);
      return res.text().then(function (text) { return { sha: '', text: text }; });
    });
  }

  function readBinaryFile(path) {
    if (hasToken()) {
      return gh('GET', apiUrl(path) + '?ref=' + encodeURIComponent(CFG.branch)).then(function (data) {
        if (!data || !data.content) return null;
        return { sha: data.sha || '', bytes: fromB64(data.content) };
      }, function (err) {
        if (err && err.status === 404) return null;
        throw err;
      });
    }
    return request(rawUrl(path), {}).then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('读取失败 ' + res.status);
      return res.arrayBuffer().then(function (buf) { return { sha: '', bytes: new Uint8Array(buf) }; });
    });
  }

  function getMeta(path) {
    if (!hasToken()) return Promise.resolve(null);
    return gh('GET', apiUrl(path) + '?ref=' + encodeURIComponent(CFG.branch))
      .then(function (data) { return (data && data.sha) ? { sha: data.sha } : null; })
      .catch(function (err) { if (err && err.status === 404) return null; throw err; });
  }

  /* 写一个文件；shaHint 是本地记住的版本号，对不上会抛 conflict */
  function putFile(path, base64, message, shaHint) {
    if (!hasToken()) return Promise.reject(new Error('这台设备没有写入密钥'));
    return ensureBranch().then(function () {
      var body = { message: message, content: base64, branch: CFG.branch };
      if (shaHint) body.sha = shaHint;
      return gh('PUT', apiUrl(path), body);
    }).then(function (res) {
      return (res && res.content && res.content.sha) || '';
    }, function (err) {
      if (err && (err.status === 409 || err.status === 422)) err.conflict = true;
      throw err;
    });
  }

  function deleteFile(path, message) {
    if (!hasToken()) return Promise.reject(new Error('这台设备没有写入密钥'));
    return getMeta(path).then(function (meta) {
      if (!meta) return false;
      return gh('DELETE', apiUrl(path), { message: message, sha: meta.sha, branch: CFG.branch }).then(function () { return true; });
    });
  }

  function treeMap() {
    if (!hasToken()) return Promise.resolve(null);
    return request(CFG.apiBase + '/repos/' + CFG.repo + '/git/trees/' + encodeURIComponent(CFG.branch) + '?recursive=1', { headers: authHeaders() })
      .then(function (res) {
        if (res.status === 404 || res.status === 409) return {};
        if (!res.ok) return null;
        return res.json().then(function (data) {
          var map = {};
          ((data && data.tree) || []).forEach(function (node) {
            if (node && node.path) map[node.path] = node.sha;
          });
          return map;
        });
      })
      .catch(function () { return null; });
  }

  /* ---------------- 空间的建立 / 解锁 ---------------- */
  function metaPath() { return CFG.dir + '/meta.json'; }

  function readMeta() {
    return readTextFile(metaPath()).then(function (file) {
      if (!file) return null;
      var meta = null;
      try { meta = JSON.parse(file.text); } catch (e) { meta = null; }
      if (!meta || !meta.salt || !meta.wrap) return null;
      meta.sha = file.sha;
      return meta;
    });
  }

  function rememberDek(key, rawBytes) {
    DEK = key;
    var ls = storage();
    if (!ls) return;
    try { ls.setItem(DEK_KEY, toB64(rawBytes)); } catch (e) { /* 忽略 */ }
  }

  function restoreDek() {
    var ls = storage();
    if (!ls) return Promise.resolve(false);
    var raw = '';
    try { raw = ls.getItem(DEK_KEY) || ''; } catch (e) { raw = ''; }
    if (!raw) return Promise.resolve(false);
    return importDek(fromB64(raw)).then(function (key) { DEK = key; return true; }, function () { return false; });
  }

  function clearKey() {
    DEK = null;
    var ls = storage();
    if (ls) {
      try { ls.removeItem(DEK_KEY); } catch (e) { /* 忽略 */ }
    }
    emit('status', status());
  }

  function openWithMeta(meta, password) {
    return deriveKek(password, fromB64(meta.salt), meta.iter).then(function (kek) {
      return aesDecrypt(kek, fromB64(meta.wrap)).then(function (dekBytes) {
        return importDek(dekBytes).then(function (key) {
          META = meta;
          rememberDek(key, dekBytes);
          emit('status', status());
          return true;
        });
      });
    }).then(null, function () {
      var err = new Error('密码不对');
      err.wrongPassword = true;
      throw err;
    });
  }

  function createSpace(password) {
    if (!hasToken()) return Promise.reject(new Error('第一次建立云端空间需要先在设置里贴写入密钥'));
    if (!SECURE) return Promise.reject(new Error('这台浏览器不支持加密（要 https 或 localhost）'));
    var salt = toB64(randomBytes(16));
    var dekBytes = randomBytes(32);
    var meta = {
      v: 2,
      kdf: 'PBKDF2-SHA256',
      iter: CFG.iterations,
      salt: salt,
      wrap: '',
      at: Date.now()
    };
    return deriveKek(password, fromB64(salt), CFG.iterations).then(function (kek) {
      return aesEncrypt(kek, dekBytes);
    }).then(function (wrapped) {
      meta.wrap = toB64(wrapped);
      return putFile(metaPath(), toB64(utf8Bytes(JSON.stringify(meta))), 'space: 建立加密空间');
    }).then(function (sha) {
      return importDek(dekBytes).then(function (key) {
        meta.sha = sha;
        META = meta;
        rememberDek(key, dekBytes);
        emit('status', status());
        return true;
      });
    }).catch(function (err) {
      /* 两个人同时第一次打开：别人已经建好了，就用同一密码打开 */
      if (err && err.conflict) {
        return readMeta().then(function (meta) {
          if (!meta) throw err;
          return openWithMeta(meta, password);
        });
      }
      throw err;
    });
  }

  function hasSpace() {
    if (!configured) return Promise.resolve(false);
    return readMeta().then(function (meta) {
      META = meta;
      return !!meta;
    }).catch(function () { return false; });
  }

  function unlock(password) {
    if (!configured) return Promise.resolve(true);
    return readMeta().then(function (meta) {
      if (!meta) return createSpace(password);
      return openWithMeta(meta, password);
    });
  }

  function changePassword(newPassword) {
    if (!DEK) return Promise.reject(new Error('先输入现在的密码'));
    return subtle.exportKey('raw', DEK).then(function (raw) {
      var salt = toB64(randomBytes(16));
      return deriveKek(newPassword, fromB64(salt), CFG.iterations).then(function (kek) {
        return aesEncrypt(kek, new Uint8Array(raw)).then(function (wrapped) {
          return readMeta().then(function (old) {
            var meta = {
              v: 2,
              kdf: 'PBKDF2-SHA256',
              iter: CFG.iterations,
              salt: salt,
              wrap: toB64(wrapped),
              at: Date.now()
            };
            return putFile(metaPath(), toB64(utf8Bytes(JSON.stringify(meta))), 'space: 换密码', old ? old.sha : '')
              .then(function (sha) {
                meta.sha = sha;
                META = meta;
                return true;
              });
          });
        });
      });
    });
  }

  /* ---------------- 文档 ---------------- */
  function docPath(key) { return CFG.dir + '/docs/' + key + '.json'; }

  function readDoc(key) {
    return readTextFile(docPath(key)).then(function (file) {
      if (!file) return null;
      return decryptText(file.text).then(function (plain) {
        var obj = null;
        try { obj = JSON.parse(plain); } catch (e) { obj = null; }
        return {
          sha: file.sha,
          rev: Number(obj && obj.rev) || 0,
          updatedAt: (obj && obj.updatedAt) || '',
          payload: (obj && obj.payload && typeof obj.payload === 'object') ? obj.payload : {}
        };
      });
    });
  }

  function writeDoc(key, row, shaHint) {
    return encryptText(JSON.stringify({ rev: row.rev, updatedAt: row.updatedAt, payload: row.payload }))
      .then(function (text) {
        return putFile(docPath(key), toB64(utf8Bytes(text)), 'space: ' + key, shaHint);
      });
  }

  function syncDoc(key, map) {
    var path = docPath(key);
    var known = docs[key];
    if (map) {
      var sha = map[path];
      if (sha === undefined) return Promise.resolve();                 /* 远端还没有这个文件 */
      if (known && known.sha && known.sha === sha) return Promise.resolve();  /* 没变，不用读 */
    }
    return readDoc(key).then(function (row) {
      if (!row) return;
      docs[key] = row;
      saveCache();
      emit('change', { key: key, payload: clone(row.payload) });
    }).catch(function () { /* 单条失败不影响其它 */ });
  }

  function fetchAll() {
    if (!configured || !DEK) return Promise.resolve(false);
    return treeMap().then(function (map) {
      var jobs = [];
      for (var i = 0; i < CFG.docs.length; i += 1) jobs.push(syncDoc(CFG.docs[i], map));
      return Promise.all(jobs);
    }).then(function () {
      lastSync = Date.now();
      online = true;
      lastError = '';
      saveCache();
      emit('status', status());
      emit('change', { key: null, payload: null });
      return true;
    }).catch(function (err) {
      lastError = (err && err.message) || '同步失败';
      emit('status', status());
      return false;
    });
  }

  /* 把旧版本留在本机、云端还没有的文档补传上去 */
  function pushSeeds() {
    if (!pendingSeed.length || !hasToken() || !DEK) return Promise.resolve();
    var keys = pendingSeed.slice();
    pendingSeed = [];
    saveCache();
    var p = Promise.resolve();
    keys.forEach(function (key) {
      p = p.then(function () {
        var local = docs[key];
        if (!local) return null;
        return readDoc(key).then(function (row) {
          if (row) return null;    /* 云端已经有了，不覆盖 */
          /* 第三个参数是「文件当前的 sha」：新建的文件没有 sha，必须留空 */
          return writeDoc(key, { rev: 1, updatedAt: new Date().toISOString(), payload: local.payload }, '');
        }).catch(function () { return null; });
      });
    });
    return p;
  }

  function clone(v) {
    if (v === null || typeof v !== 'object') return v;
    return JSON.parse(JSON.stringify(v));
  }

  /* 每个 key 串行执行，避免快速连点时自己踩自己 */
  function chain(key, task) {
    var prev = chains[key] || Promise.resolve();
    var run = prev.then(task, task);
    chains[key] = run.then(function () { }, function () { });
    return run;
  }

  function enqueue(key, payload) {
    var found = false;
    for (var i = 0; i < queue.length; i += 1) {
      if (queue[i].key === key) { queue[i].payload = payload; found = true; break; }
    }
    if (!found) queue.push({ key: key, payload: payload });
    saveQueue();
    emit('status', status());
  }

  function flushQueue() {
    if (!configured || !DEK || !queue.length) return Promise.resolve();
    var snapshot = queue.slice();
    queue = [];
    saveQueue();
    var p = Promise.resolve();
    snapshot.forEach(function (item) {
      p = p.then(function () {
        return mutate(item.key, function () { return clone(item.payload); }, 2).then(null, function () { return null; });
      });
    });
    return p.then(function () { emit('status', status()); });
  }

  /* ---------------- 对外：读写 ---------------- */
  function get(key) {
    var d = docs[key];
    return d ? clone(d.payload) : null;
  }

  function set(key, payload) {
    var next = clone(payload);
    if (!configured || !DEK) {
      docs[key] = {
        payload: next,
        rev: (docs[key] ? docs[key].rev : 0) + 1,
        updatedAt: new Date().toISOString(),
        sha: ''
      };
      markPending(key);
      saveCache();
      emit('change', { key: key, payload: clone(next), local: true });
      return Promise.resolve(next);
    }
    docs[key] = {
      payload: next,
      rev: docs[key] ? docs[key].rev : 0,
      updatedAt: new Date().toISOString(),
      sha: docs[key] ? docs[key].sha : ''
    };
    saveCache();
    emit('change', { key: key, payload: clone(next), local: true });
    return mutate(key, function () { return clone(next); });
  }

  /* 读最新 -> 改 -> 带版本校验写回；冲突就重读重试，两个人同时改不会互相盖掉 */
  function mutate(key, updater, attempts) {
    var left = typeof attempts === 'number' ? attempts : 3;
    if (!configured || !DEK) {
      var base = get(key) || {};
      var next = updater(clone(base));
      if (next === undefined || next === null) return Promise.resolve(base);
      docs[key] = { payload: next, rev: (docs[key] ? docs[key].rev : 0) + 1, updatedAt: new Date().toISOString(), sha: '' };
      markPending(key);
      saveCache();
      emit('change', { key: key, payload: clone(next), local: true });
      return Promise.resolve(next);
    }
    return chain(key, function () {
      function attempt(n) {
        return readDoc(key).then(function (remote) {
          var base = (remote && remote.payload) ? clone(remote.payload) : {};
          var next = updater(clone(base));
          if (next === undefined || next === null) return base;
          var rev = ((remote && remote.rev) || 0) + 1;
          var updatedAt = new Date().toISOString();
          return writeDoc(key, { rev: rev, updatedAt: updatedAt, payload: next }, remote ? remote.sha : '')
            .then(function (sha) {
              docs[key] = { payload: next, rev: rev, updatedAt: updatedAt, sha: sha };
              saveCache();
              emit('change', { key: key, payload: clone(next) });
              emit('status', status());
              return next;
            });
        }).catch(function (err) {
          if (err && err.conflict && n > 1) return attempt(n - 1);
          if (err && err.locked) throw err;
          /* 断网 / 没有密钥：先存在本机，等能写了再补发 */
          var localBase = get(key) || {};
          var localNext = updater(clone(localBase));
          if (localNext === undefined || localNext === null) return localBase;
          docs[key] = {
            payload: localNext,
            rev: (docs[key] ? docs[key].rev : 0) + 1,
            updatedAt: new Date().toISOString(),
            sha: docs[key] ? docs[key].sha : ''
          };
          saveCache();
          enqueue(key, localNext);
          emit('change', { key: key, payload: clone(localNext), local: true });
          return localNext;
        });
      }
      return attempt(left);
    });
  }

  function refresh() {
    if (!configured) return Promise.resolve(false);
    if (!DEK) return Promise.resolve(false);
    return flushQueue().then(pushSeeds).then(fetchAll);
  }

  /* ---------------- 对外：照片 ---------------- */
  function bytesOf(input) {
    if (input instanceof Uint8Array) return Promise.resolve(input);
    if (input && typeof input.arrayBuffer === 'function') {
      return input.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
    }
    return Promise.reject(new Error('读不出这个文件'));
  }

  function mimeOf(name) {
    var ext = String(name || '').toLowerCase().split('.').pop();
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'gif') return 'image/gif';
    return 'image/jpeg';
  }

  function mediaFile(name) { return CFG.dir + '/media/' + name; }

  function uploadMedia(data, name) {
    if (!DEK) return Promise.reject(new Error('先输入空间密码'));
    var filename = name || ('m' + Date.now() + '.jpg');
    return bytesOf(data).then(function (bytes) {
      return aesEncrypt(DEK, bytes).then(function (buf) {
        return putFile(mediaFile(filename), toB64(buf), 'media: ' + filename);
      }).then(function (sha) {
        return { name: filename, sha: sha, size: bytes.length, mime: mimeOf(filename) };
      });
    });
  }

  function readMedia(name) {
    if (!DEK) return Promise.reject(new Error('先输入空间密码'));
    return readBinaryFile(mediaFile(name)).then(function (file) {
      if (!file) return null;
      return aesDecrypt(DEK, file.bytes).then(function (bytes) {
        return { name: name, bytes: bytes, mime: mimeOf(name), sha: file.sha };
      });
    });
  }

  function deleteMedia(name) {
    return deleteFile(mediaFile(name), 'media: 删除 ' + name);
  }

  /* ---------------- 密码哈希（旧逻辑，给密码门和票据用） ---------------- */
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
    var maxWord = Math.pow(2, 32);
    var hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var k = K.slice(0);
    var i, j;

    var utf8 = [];
    for (i = 0; i < ascii.length; i += 1) {
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
    var asciiBitLength = utf8.length * 8;

    hash = hash.slice(0, 8);
    k = k.slice(0, 64);

    var padded = utf8.slice(0);
    padded.push(0x80);
    while (padded.length % 64 !== 56) padded.push(0);
    var lenHi = Math.floor(asciiBitLength / maxWord);
    var lenLo = asciiBitLength >>> 0;
    for (i = 0; i < 4; i += 1) padded.push((lenHi >>> (24 - i * 8)) & 255);
    for (i = 0; i < 4; i += 1) padded.push((lenLo >>> (24 - i * 8)) & 255);

    for (j = 0; j < padded.length; j += 64) {
      var w = new Array(64);
      var chunk = padded.slice(j, j + 64);
      for (i = 0; i < 16; i += 1) {
        w[i] = (chunk[i * 4] << 24) | (chunk[i * 4 + 1] << 16) | (chunk[i * 4 + 2] << 8) | chunk[i * 4 + 3];
      }
      for (i = 16; i < 64; i += 1) {
        var s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = hash[0], b = hash[1], c = hash[2], d = hash[3], e = hash[4], f = hash[5], g = hash[6], h = hash[7];
      for (i = 0; i < 64; i += 1) {
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
    for (i = 0; i < 8; i += 1) {
      var part = (hash[i] >>> 0).toString(16);
      while (part.length < 8) part = '0' + part;
      hex += part;
    }
    return hex;
  }

  function hashPassword(password, salt) {
    return sha256(String(salt || '') + '\u0001' + String(password == null ? '' : password));
  }
  function makeSalt() {
    var s = '';
    var pool = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (var i = 0; i < 16; i += 1) s += pool.charAt(Math.floor(Math.random() * pool.length));
    return s;
  }

  /* ---------------- 登录票据 ---------------- */
  function readTicket() {
    var ls = storage();
    try { return global.sessionStorage.getItem(TICKET_KEY) || (ls && ls.getItem(TICKET_KEY)) || ''; } catch (e) { return ''; }
  }
  function writeTicket(value) {
    var ls = storage();
    try {
      if (value) {
        global.sessionStorage.setItem(TICKET_KEY, value);
        if (ls) ls.setItem(TICKET_KEY, value);
      } else {
        global.sessionStorage.removeItem(TICKET_KEY);
        if (ls) ls.removeItem(TICKET_KEY);
      }
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 自检 ---------------- */
  function selfTest() {
    var steps = [];
    function step(name, fn) {
      return fn().then(function (detail) {
        steps.push({ name: name, ok: true, detail: detail || '' });
      }, function (err) {
        steps.push({ name: name, ok: false, detail: (err && (err.message || err.error)) || String(err) });
      });
    }
    var first = configured ? Promise.resolve() : Promise.reject(new Error('config.js 里的 storage.repo 还没填'));
    return first
      .then(function () { return step('仓库配置', function () { return Promise.resolve(CFG.repo + ' · 分支 ' + CFG.branch); }); })
      .then(function () {
        return step('加密通道', function () {
          if (!SECURE) throw new Error('浏览器不支持 WebCrypto（需要 https 或 localhost）');
          if (!DEK) throw new Error('还没解锁：先输入空间密码');
          var probe = 'catfish-' + Date.now();
          return encryptText(probe).then(function (box) { return decryptText(box); }).then(function (back) {
            if (back !== probe) throw new Error('加密往返对不上');
            return 'PBKDF2 ' + (META ? META.iter : CFG.iterations) + ' 次 · AES-256-GCM 正常';
          });
        });
      })
      .then(function () {
        return step('读取 meta', function () {
          return readMeta().then(function (meta) {
            if (!meta) throw new Error('仓库里还没有 meta.json（还没建立空间）');
            return '已建立于 ' + new Date(Number(meta.at) || 0).toLocaleString();
          });
        });
      })
      .then(function () {
        return step('写入测试', function () {
          var path = CFG.dir + '/.selftest.json';
          var payload = toB64(utf8Bytes('ping ' + Date.now()));
          return putFile(path, payload, 'space: 自检').then(function () {
            return deleteFile(path, 'space: 自检清理');
          }).then(function () { return '写入 / 删除都通过'; });
        });
      })
      .then(function () { return { steps: steps, status: status() }; });
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    loadCache();
    if (!configured) {
      emit('status', status());
      return Promise.resolve(false);
    }
    if (!SECURE) {
      lastError = '这台浏览器不支持加密（要 https 或 localhost）';
      emit('status', status());
      return Promise.resolve(false);
    }
    return restoreDek().then(function (ok) {
      if (!ok) {
        emit('status', status());
        return false;
      }
      return refresh().then(function () { return true; }, function () { return false; });
    });
  }

  function startPolling() {
    if (polling || !configured) return;
    polling = true;
    var timer = setInterval(function () {
      if (global.document && global.document.hidden) return;
      if (!DEK) return;
      refresh();
    }, POLL_MS);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  if (typeof global.addEventListener === 'function') {
    global.addEventListener('online', function () { online = true; refresh(); });
    global.addEventListener('offline', function () { online = false; emit('status', status()); });
  }
  if (typeof global.document !== 'undefined' && global.document.addEventListener) {
    global.document.addEventListener('visibilitychange', function () {
      if (!global.document.hidden) refresh();
    });
    if (global.document.readyState !== 'loading') startPolling();
    else global.document.addEventListener('DOMContentLoaded', startPolling);
  }

  var readyPromise = init();

  global.Space = {
    ready: readyPromise,
    configured: configured,
    config: CFG,
    status: status,
    on: on,
    get: get,
    set: set,
    mutate: mutate,
    refresh: refresh,
    unlock: unlock,
    hasSpace: hasSpace,
    createSpace: createSpace,
    changePassword: changePassword,
    locked: function () { return !DEK; },
    hasKey: function () { return !!DEK; },
    clearKey: clearKey,
    token: token,
    setToken: setToken,
    hasToken: hasToken,
    uploadMedia: uploadMedia,
    readMedia: readMedia,
    deleteMedia: deleteMedia,
    uploadFile: function (blob, name) {
      return uploadMedia(blob, name).then(function (row) {
        return { url: row.name, name: row.name, sha: row.sha, size: row.size };
      });
    },
    sha256: sha256,
    hashPassword: hashPassword,
    makeSalt: makeSalt,
    readTicket: readTicket,
    writeTicket: writeTicket,
    ticketKey: TICKET_KEY,
    selfTest: selfTest
  };
})(typeof window !== 'undefined' ? window : globalThis);
