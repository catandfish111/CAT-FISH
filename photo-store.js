/* ============================================================
   照片仓库：照片加密后直接提交进 GitHub 仓库
   ------------------------------------------------------------
   照片压缩到长边 1400 像素（约 150KB）→ 用空间密钥加密 → 提交到
   data 分支的 data/v1/media/ 文件夹。仓库里只有密文，谁点开都是乱码；
   两个人用同一个空间密码在任何设备上都能解开。

   一览：data/v1/docs/media.json 存的是「有哪些照片」的索引（也是密文），
   照片本身按需下载、解密，解出来的图缓存在 IndexedDB 里，
   所以第二次看不会再跑一遍解密。
   ============================================================ */
(function (global) {
  'use strict';

  var CFG = (global.LOVE_CONFIG && global.LOVE_CONFIG.photos) || {};
  var maxSide = Number(CFG.maxSide) || 1400;
  var quality = Number(CFG.quality) || 0.82;
  var DB_NAME = 'catfish-media-cache-v1';
  var STORE = 'blobs';

  var previews = {};     /* name -> 本机刚传上去的预览地址 */
  var urls = {};         /* name -> 解密后生成的地址 */
  var lastError = '';
  var listing = null;

  function space() { return global.Space || null; }
  function ready() {
    var S = space();
    return !!(S && S.configured);
  }

  /* ---------------- 密钥（交给 sync.js 统一管） ---------------- */
  function token() { var S = space(); return S && S.token ? S.token() : ''; }
  function hasToken() { var S = space(); return !!(S && S.hasToken && S.hasToken()); }
  function setToken(value) {
    var S = space();
    if (!S || !S.setToken) return false;
    var ok = S.setToken(value);
    return ok;
  }
  function clearToken() {
    var S = space();
    if (S && S.setToken) S.setToken('');
    return false;
  }

  /* ---------------- 压缩 ---------------- */
  function dataURLtoBlob(dataUrl) {
    var parts = String(dataUrl).split(',');
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
    var bin = global.atob(parts[1] || '');
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
    return new global.Blob([arr], { type: mime });
  }

  function compress(file) {
    return new Promise(function (resolve, reject) {
      if (!global.URL || !global.URL.createObjectURL) { reject(new Error('浏览器不支持本地预览')); return; }
      var url = global.URL.createObjectURL(file);
      var img = new global.Image();
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
              else reject(new Error('压缩失败'));
            }, 'image/jpeg', quality);
          } else {
            resolve({ blob: dataURLtoBlob(canvas.toDataURL('image/jpeg', quality)), width: w, height: h });
          }
        } catch (e) { reject(e); }
      };
      img.onerror = function () {
        global.URL.revokeObjectURL(url);
        reject(new Error('这张照片读不出来，iPhone 的 HEIC 请先转成 JPG'));
      };
      img.src = url;
    });
  }

  function prepare(file) {
    return compress(file).then(function (res) {
      return {
        blob: res.blob,
        width: res.width,
        height: res.height,
        preview: global.URL.createObjectURL(res.blob)
      };
    });
  }

  /* ---------------- 文件名 ---------------- */
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function makeName(ext) {
    var d = new Date();
    var stamp = String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
    var rand = Math.random().toString(36).slice(2, 6);
    return 'p' + stamp + '-' + rand + (ext || '.jpg');
  }
  /* 从文件名里读回时间：p20261102-2312-xxxx.jpg */
  function timeFromName(name) {
    var m = /^p(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(String(name || ''));
    if (!m) return 0;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
    return d.getTime() || 0;
  }

  /* ---------------- 索引 ---------------- */
  function rows() {
    var S = space();
    var doc = (S && S.get && S.get('media')) || {};
    var items = Array.isArray(doc.items) ? doc.items : [];
    var out = items.filter(function (it) { return it && it.name; }).map(function (it) {
      return {
        name: it.name,
        sha: it.sha || '',
        size: Number(it.size) || 0,
        at: Number(it.at) || timeFromName(it.name),
        url: urls[it.name] || previews[it.name] || ''
      };
    });
    out.sort(function (a, b) { return (b.at || 0) - (a.at || 0) || (a.name < b.name ? 1 : -1); });
    return out;
  }

  function list(force) {
    var S = space();
    if (!S || !S.configured) return Promise.resolve([]);
    if (!force) return Promise.resolve(rows());
    if (listing) return listing;
    listing = S.refresh().then(function () {
      listing = null;
      lastError = '';
      return rows();
    }, function (err) {
      listing = null;
      lastError = (err && err.message) || '读取失败';
      return rows();
    });
    return listing;
  }

  /* ---------------- 解密（带 IndexedDB 缓存） ---------------- */
  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error('没有 IndexedDB')); return; }
      var req = global.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        try { req.result.createObjectStore(STORE); } catch (e) { /* 已经有了 */ }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('打不开本地缓存')); };
    });
  }

  function cacheGet(name) {
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get(name);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }

  function cachePut(name, blob) {
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(blob, name);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      });
    }).catch(function () { return false; });
  }

  function cacheDelete(name) {
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(name);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      });
    }).catch(function () { return false; });
  }

  function revoke(name) {
    if (urls[name]) {
      try { global.URL.revokeObjectURL(urls[name]); } catch (e) { /* 忽略 */ }
      delete urls[name];
    }
    if (previews[name]) {
      try { global.URL.revokeObjectURL(previews[name]); } catch (e) { /* 忽略 */ }
      delete previews[name];
    }
  }

  function remember(name, blob) {
    try {
      revoke(name);
      urls[name] = global.URL.createObjectURL(blob);
      return urls[name];
    } catch (e) { return ''; }
  }

  /* 拿到一张照片的可用地址：本机预览 > 已解密 > IndexedDB > 从仓库下载解密 */
  function url(name) {
    if (previews[name]) return Promise.resolve(previews[name]);
    if (urls[name]) return Promise.resolve(urls[name]);
    return cacheGet(name).then(function (blob) {
      if (blob) return remember(name, blob);
      var S = space();
      if (!S || !S.readMedia) return '';
      return S.readMedia(name).then(function (media) {
        if (!media) return '';
        var out = new global.Blob([media.bytes], { type: media.mime || 'image/jpeg' });
        lastError = '';
        return cachePut(name, out).then(function () { return remember(name, out); });
      }).catch(function (err) {
        lastError = (err && err.message) || '照片解密失败';
        return '';
      });
    });
  }

  /* 相册里的 <img data-photo="名字">：滚到跟前再去下载解密 */
  function hydrate(root) {
    if (!root || !root.querySelectorAll) return;
    var imgs = root.querySelectorAll('img[data-photo]');
    if (!imgs.length) return;

    function load(img) {
      var name = img.getAttribute('data-photo');
      if (!name || img.getAttribute('src')) return;
      var box = img.parentNode;
      if (box && box.classList) box.classList.add('is-loading');
      url(name).then(function (src) {
        if (box && box.classList) box.classList.remove('is-loading');
        if (!src) {
          if (box && box.classList) box.classList.add('is-missing');
          return;
        }
        img.src = src;
      });
    }

    if (typeof global.IntersectionObserver === 'function') {
      var observer = new global.IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          load(entry.target);
        });
      }, { rootMargin: '240px' });
      Array.prototype.forEach.call(imgs, function (img) { observer.observe(img); });
    } else {
      Array.prototype.forEach.call(imgs, load);
    }
  }

  /* ---------------- 上传 / 删除 ---------------- */
  function upload(blob, name) {
    var S = space();
    if (!S || !S.configured) return Promise.reject(new Error('config.js 里没有配置 storage.repo'));
    if (!S.hasKey || !S.hasKey()) return Promise.reject(new Error('先输入空间密码再传照片'));
    if (!hasToken()) return Promise.reject(new Error('这台设备还没有写入密钥（设置里贴一次）'));
    var filename = name || makeName('.jpg');
    return S.uploadMedia(blob, filename).then(function (info) {
      return S.mutate('media', function (doc) {
        var items = Array.isArray(doc.items) ? doc.items : [];
        items = items.filter(function (it) { return it && it.name !== filename; });
        items.push({ name: filename, at: timeFromName(filename) || Date.now(), size: info.size, sha: info.sha });
        return { items: items };
      }).then(function () {
        try { previews[filename] = global.URL.createObjectURL(blob); } catch (e) { /* 忽略 */ }
        return {
          name: filename,
          sha: info.sha,
          size: info.size,
          at: timeFromName(filename) || Date.now(),
          url: previews[filename] || ''
        };
      });
    });
  }

  function remove(name) {
    var S = space();
    if (!S || !S.hasToken || !S.hasToken()) return Promise.reject(new Error('没有写入密钥，删不了仓库里的照片'));
    return S.deleteMedia(name).catch(function () { return false; }).then(function () {
      return S.mutate('media', function (doc) {
        var items = Array.isArray(doc.items) ? doc.items : [];
        return { items: items.filter(function (it) { return it && it.name !== name; }) };
      });
    }).then(function () {
      return cacheDelete(name);
    }).then(function () {
      revoke(name);
    });
  }

  global.PhotoStore = {
    get enabled() { return ready(); },
    get repo() { var S = space(); return (S && S.config && S.config.repo) || ''; },
    get dir() { var S = space(); return (S && S.config) ? (S.config.dir + '/media') : 'media'; },
    hasToken: hasToken,
    token: token,
    setToken: setToken,
    clearToken: clearToken,
    list: list,
    upload: upload,
    remove: remove,
    prepare: prepare,
    url: url,
    hydrate: hydrate,
    publicUrl: function () { return ''; },
    cached: function () { return rows(); },
    timeFromName: timeFromName,
    lastError: function () { return lastError; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
