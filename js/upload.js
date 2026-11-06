/* upload.js — upload list files (JSON) to the GitHub repo's data/ folder.
 *
 * Design: the browser only ever writes data/<name>.json. index.json and search.json are
 * rebuilt by the build-index GitHub Action (make_index.py), so there is ONE source of truth
 * for the indexes and no merge conflicts, however many lists are uploaded.
 *
 * Maintenance map:
 *   validateList()  – mirrors the checks in make_index.py (keep both in sync)
 *   gh()            – the only function that talks to GitHub
 *   uploadView()    – UI; reads globals from index.html (app, esc, G...) lazily at call time
 */
const GH_KEY = 'wordlists.gh.v1';
const RESERVED = ['index', 'search'];          // generated files, never uploadable
let UP = [];                                   // rows: {name, data, errs[], st}

function ghCfg() {
  let c = { repo: '', branch: 'main', token: '' };
  try { Object.assign(c, JSON.parse(localStorage.getItem(GH_KEY) || '{}')); } catch (e) {}
  // On GitHub Pages (owner.github.io/repo/) the repo can be guessed
  if (!c.repo && /\.github\.io$/.test(location.hostname))
    c.repo = location.hostname.split('.')[0] + '/' + (location.pathname.split('/')[1] || 'english_vocab');
  return c;
}

function validateList(d) {
  const errs = [], stars = s => (String(s).match(/\*/g) || []).length;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ['Top level must be an object with a "words" array'];
  if (!Array.isArray(d.words) || !d.words.length) return ['"words" is missing or empty'];
  const seen = new Set();
  d.words.forEach((w, i) => {
    const nm = `word ${i + 1} (${w.w || '?'})`;
    for (const k of ['w', 'pos', 'def', 'ar', 'emoji']) if (!w[k]) errs.push(`${nm}: missing "${k}"`);
    if (w.w) { const k = w.w.toLowerCase(); if (seen.has(k)) errs.push(`${nm}: duplicate word in this list`); seen.add(k); }
    (w.col || []).forEach(c => {
      if (stars(c.p || '') !== 2) errs.push(`${nm}: collocation "${c.p}" needs exactly one *form*`);
      if (c.en && stars(c.en) !== 2) errs.push(`${nm}: example for "${c.p}" needs exactly one *form*`);
    });
    (w.ex || []).forEach(x => { if (stars(x.en || '') !== 2) errs.push(`${nm}: example needs exactly one *form*: ${x.en}`); });
  });
  return errs;
}

const b64 = s => { let t = ''; new TextEncoder().encode(s).forEach(c => t += String.fromCharCode(c)); return btoa(t); };

async function gh(cfg, method, path, body) {
  const url = `https://api.github.com/repos/${cfg.repo}/contents/${path}` + (method === 'GET' ? `?ref=${encodeURIComponent(cfg.branch)}` : '');
  const r = await fetch(url, {
    method, body: body && JSON.stringify(body),
    headers: { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json' }
  });
  if (method === 'GET' && r.status === 404) return null;          // file does not exist yet
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(
    r.status === 401 ? 'Token rejected (401).' :
    r.status === 403 || r.status === 404 ? `No access (${r.status}). The token needs "Contents: Read and write" on ${cfg.repo}.` :
    `GitHub ${r.status}: ${j.message || ''}`);
  return j;
}

async function uploadOne(cfg, row) {
  const path = 'data/' + row.name + '.json';
  const cur = await gh(cfg, 'GET', path);
  if (cur && !confirm(`data/${row.name}.json already exists. Overwrite it?`)) { row.st = 'skipped'; return; }
  await gh(cfg, 'PUT', path, {
    message: (cur ? 'update list: ' : 'add list: ') + row.name,
    content: b64(JSON.stringify(row.data, null, 2) + '\n'),
    branch: cfg.branch, ...(cur ? { sha: cur.sha } : {})
  });
  row.st = cur ? 'updated ✓' : 'uploaded ✓';
}

function renderUp() {
  const ready = UP.filter(r => !r.errs.length && !/✓|skipped/.test(r.st || ''));
  document.getElementById('up-rows').innerHTML = UP.map(r => {
    const bad = r.errs.length;
    return `<div class="box"><b>${esc(r.name)}.json</b> <span class="mut">${esc(r.data?.title || '')} · ${r.data?.words?.length || 0} words</span>
      <span class="${bad || /failed/.test(r.st || '') ? 'bad' : 'good'}"> ${bad ? '✗ ' + bad + ' problem' + (bad > 1 ? 's' : '') : esc(r.st || '✓ valid')}</span>
      ${r.errs.slice(0, 8).map(e => `<div class="mut">• ${esc(e)}</div>`).join('')}${bad > 8 ? `<div class="mut">…and ${bad - 8} more</div>` : ''}</div>`;
  }).join('');
  document.getElementById('up-act').innerHTML = ready.length
    ? `<button class="btn" id="up-go">Upload ${ready.length} file${ready.length > 1 ? 's' : ''}</button>` : '';
  const go = document.getElementById('up-go');
  if (go) go.onclick = async () => {
    const cfg = ghCfg();
    if (!/^[\w.-]+\/[\w.-]+$/.test(cfg.repo) || !cfg.token) { alert('Fill in and save the GitHub connection first.'); return; }
    go.disabled = true;
    for (const r of ready) {                       // sequential: parallel commits to one branch cause 409s
      r.st = 'uploading…'; renderUp();
      try { await uploadOne(cfg, r); } catch (e) { r.st = 'failed: ' + e.message; }
      renderUp();
    }
    if (UP.some(r => /✓/.test(r.st || '')))
      document.getElementById('up-act').innerHTML += `<p class="mut">Committed. The <a href="https://github.com/${esc(cfg.repo)}/actions" target="_blank" rel="noopener">build-index Action</a> now updates index.json and search.json; reload this site in about a minute.</p>`;
  };
}

function uploadView() {
  document.getElementById('crumb').textContent = '/ Upload';
  UP = [];
  const c = ghCfg();
  app.innerHTML = `<h1>Upload lists</h1>
  <div class="card"><h2>1 · GitHub connection</h2>
    <p class="mut">Lists are committed to <code>data/</code> in your repo. Use a fine-grained token limited to that one repository with “Contents: Read and write”. It is stored only in this browser.</p>
    <input class="ans" id="gh-repo" placeholder="owner/english_vocab" value="${esc(c.repo)}" style="text-align:left">
    <input class="ans" id="gh-branch" placeholder="branch" value="${esc(c.branch)}" style="text-align:left">
    <input class="ans" id="gh-token" type="password" placeholder="GitHub token" value="${esc(c.token)}" style="text-align:left">
    <button class="btn alt" id="gh-save">Save</button> <span class="mut" id="gh-msg"></span></div>
  <div class="card"><h2>2 · Choose list files (.json)</h2>
    <p class="mut">Same format as <a href="data/example.json">example.json</a>. Every file is checked before upload.</p>
    <input type="file" id="up-files" accept=".json,application/json" multiple>
    <div id="up-rows"></div><div id="up-act"></div></div>`;
  document.getElementById('gh-save').onclick = () => {
    const v = id => document.getElementById(id).value.trim();
    try { localStorage.setItem(GH_KEY, JSON.stringify({ repo: v('gh-repo'), branch: v('gh-branch') || 'main', token: v('gh-token') })); } catch (e) {}
    document.getElementById('gh-msg').textContent = 'Saved ✓';
  };
  document.getElementById('up-files').onchange = async ev => {
    UP = [];
    for (const f of ev.target.files) {
      const row = { name: f.name.replace(/\.json$/i, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'list', data: null, errs: [], st: '' };
      try { row.data = JSON.parse(await f.text()); row.errs = validateList(row.data); }
      catch (e) { row.errs = ['Invalid JSON: ' + e.message]; }
      if (RESERVED.includes(row.name)) row.errs.push(`"${row.name}" is a reserved name; rename the file`);
      UP.push(row);
    }
    renderUp();
  };
}
