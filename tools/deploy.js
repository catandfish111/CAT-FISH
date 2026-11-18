/* ============================================================
   把本地改动推到 GitHub（走 api.github.com，不需要 git、不需要 clone）
   为什么不用 git push：这台机器连不上 github.com:443，只有 api.github.com 通。
   用法：
     1. 把 GitHub token 放进 .deploy-token.txt（一行，别带空格）
     2. node tools/deploy.js
   它会：读文件 → 建 blob → 建 tree → 建一个 commit → 移动 main 指针 → 等线上生效
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OWNER = 'catandfish111';
const REPO = 'CAT-FISH';
const BRANCH = 'main';
const API = 'https://api.github.com';

/* 只推这些：页面、数据层、照片层、文档 */
const FILES = [
  'index.html',
  'app.js',
  'styles.css',
  'config.js',
  'sync.js',
  'photo-store.js',
  'space-app.js',
  'memories.js',
  'memories.css',
  'baby-pet.js',
  'baby-pet.css',
  'README.md'
];

const MESSAGE = [
  '回忆独立成页：点「我们的回忆」不再打开布布浮层',
  '',
  '- 新增 memories.js：时间轴 / 相册、详情、编辑、删除撤销，数据仍走加密的 data 分支',
  '- 新增 memories.css：独立页样式，正文 14.5px、触控 44px，桌面居中手机全屏',
  '- 首页卡与底部导航的「回忆」直接打开独立页；布布面板移除回忆 tab',
  '- 返回键先关回忆页，不退出站点；照片仍由 photo-store.js 压缩加密上传',
  '- 部署白名单加入 memories.js / memories.css'
].join('\n');

/* ---------------- 工具 ---------------- */
function readToken() {
  const candidates = ['.deploy-token.txt', 'deploy-token.txt', '.token'];
  for (const name of candidates) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (raw) return raw.replace(/\s+/g, '');
  }
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  console.error('没找到 token：请在 .deploy-token.txt（或 deploy-token.txt）里写一行，或设置 GITHUB_TOKEN');
  process.exit(1);
}

const TOKEN = readToken();

async function api(method, endpoint, body, tries) {
  const max = tries || 3;
  let lastErr = null;
  for (let attempt = 1; attempt <= max; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const res = await fetch(API + endpoint, {
        method,
        headers: {
          'Authorization': 'Bearer ' + TOKEN,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'catfish-deploy'
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal
      });
      clearTimeout(timer);
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
      if (res.ok) return json;
      /* 401/403/404 这类是我们的问题，别重试 */
      if (res.status < 500 && res.status !== 429) {
        const msg = (json && (json.message || json.error)) || text.slice(0, 200);
        throw new Error('GitHub API ' + res.status + ': ' + msg);
      }
      lastErr = new Error('GitHub API ' + res.status);
    } catch (err) {
      clearTimeout(timer);
      if (err && /GitHub API 4/.test(err.message)) throw err;
      lastErr = err;
      if (attempt < max) await sleep(800 * attempt);
    }
  }
  throw lastErr || new Error('请求失败');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function blobShaFor(file) {
  const text = fs.readFileSync(path.join(ROOT, file));
  return { size: text.length, b64: text.toString('base64') };
}

/* ---------------- 主流程 ---------------- */
(async function main() {
  console.log('\n1. 检查 token 和仓库');
  const me = await api('GET', '/user');
  console.log('   身份：' + me.login);

  const repo = await api('GET', `/repos/${OWNER}/${REPO}`);
  const canPush = repo.permissions && repo.permissions.push;
  console.log('   仓库：' + repo.full_name + '（默认分支 ' + repo.default_branch + '）');
  if (!canPush) {
    console.error('   这个 token 没有写权限：请给 Contents: Read and write（细粒度）或 repo（经典）');
    process.exit(1);
  }

  console.log('\n2. 取当前 main 的最新提交');
  const ref = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  const headSha = ref.object.sha;
  const headCommit = await api('GET', `/repos/${OWNER}/${REPO}/git/commits/${headSha}`);
  console.log('   ' + headSha.slice(0, 7) + ' ' + String(headCommit.message).split('\n')[0]);

  console.log('\n3. 上传 ' + FILES.length + ' 个文件的内容');
  const tree = [];
  for (const file of FILES) {
    const { size, b64 } = blobShaFor(file);
    const blob = await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, { content: b64, encoding: 'base64' });
    tree.push({ path: file, mode: '100644', type: 'blob', sha: blob.sha });
    console.log('   ' + file.padEnd(14) + (size / 1024).toFixed(1) + ' KB  → ' + blob.sha.slice(0, 7));
  }

  console.log('\n4. 建一个新的 commit');
  const newTree = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, { base_tree: headCommit.tree.sha, tree });
  const commit = await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
    message: MESSAGE,
    tree: newTree.sha,
    parents: [headSha]
  });
  console.log('   ' + commit.sha.slice(0, 7) + '  ' + commit.html_url);

  console.log('\n5. 移动 main 指针');
  await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false });
  console.log('   完成：https://github.com/' + OWNER + '/' + REPO + '/commit/' + commit.sha);

  console.log('\n6. 等 GitHub Pages 重新构建');
  const live = `https://catandfish111.github.io/${REPO}`;
  const probe = '/sync.js';
  let ok = false;
  let offline = false;
  for (let i = 1; i <= 30; i++) {
    try {
      const res = await fetch(live + probe + '?t=' + Date.now(), { signal: AbortSignal.timeout(12000) });
      if (res.ok) {
        const body = await res.text();
        if (body.indexOf('catfish-space-cache-v3') >= 0) { ok = true; break; }
      }
    } catch (e) {
      /* 这台机器连不上 github.io：跳过线上验证，别把部署判成失败 */
      if (e && (e.name === 'TypeError' || /fetch failed|ENOTFOUND|ECONN|network/i.test(String(e.message)))) {
        offline = true;
        break;
      }
    }
    process.stdout.write('   ' + (i * 10) + 's… ');
    await sleep(10000);
  }
  console.log('');
  if (offline) {
    console.log('   这台机器连不上 github.io（只有 api.github.com 通），跳过线上验证。');
    console.log('   自己去 https://github.com/' + OWNER + '/' + REPO + '/actions 看构建，30~60 秒后手机上刷新即可。');
    process.exit(0);
  }
  if (!ok) {
    console.log('   ⚠ 三分钟内没等到 sync.js 上线，去 https://github.com/' + OWNER + '/' + REPO + '/actions 看看构建状态');
    process.exit(2);
  }

  console.log('\n7. 线上验证');
  const checks = [
    ['sync.js', '/sync.js', 'catfish-space-cache-v3'],
    ['photo-store.js', '/photo-store.js', 'catfish-media-cache-v1'],
    ['space-app.js', '/space-app.js', 'SpaceApp'],
    ['app.js', '/app.js', 'SpaceApp.handleClick'],
    ['index.html', '/index.html', 'sync-chip'],
    ['config.js', '/config.js', 'storage']
  ];
  let bad = 0;
  for (const [name, url, marker] of checks) {
    try {
      const res = await fetch(live + url + '?t=' + Date.now(), { signal: AbortSignal.timeout(15000) });
      const body = await res.text();
      const good = res.ok && body.indexOf(marker) >= 0;
      console.log('   ' + (good ? '✓' : '×') + ' ' + name + (good ? '' : '（HTTP ' + res.status + '）'));
      if (!good) bad += 1;
    } catch (err) {
      console.log('   × ' + name + '（' + err.message + '）');
      bad += 1;
    }
  }

  console.log('\n站点：' + live + '/');
  console.log(bad === 0 ? '全部上线 ✅' : '有 ' + bad + ' 项没通过 ⚠');
  process.exit(bad === 0 ? 0 : 2);
})().catch((err) => {
  console.error('\n部署失败：' + (err && err.message));
  process.exit(1);
});
