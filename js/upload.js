/* upload.js — upload, edit and delete list files (JSON) in the GitHub repo's data/ folder.
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

/* ---------- manage: list, edit and delete the files in data/ ----------
 * Lists the repo's data/ folder directly (not index.json), so lists the build skipped
 * because they are invalid still show up here and can be fixed. Every change is a commit;
 * the build-index Action then rebuilds index.json and search.json. */
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0)));
const listId = name => name.replace(/[^A-Za-z0-9_-]+/g, '_');          // same rule as make_index.py
const ghReady = () => { const c = ghCfg(); return /^[\w.-]+\/[\w.-]+$/.test(c.repo) && c.token ? c : null; };
const NO_CFG = '<div class="card"><p>Connect to GitHub first: <a href="#/upload">⬆️ Upload → GitHub connection</a>.</p></div>';

async function manageView() {
  document.getElementById('crumb').textContent = '/ Manage';
  const cfg = ghReady();
  if (!cfg) { app.innerHTML = '<h1>Manage lists</h1>' + NO_CFG; return; }
  app.innerHTML = '<h1>Manage lists</h1><p class="mut">Loading…</p>';
  try {
    const [files, idx] = await Promise.all([gh(cfg, 'GET', 'data'), J('data/index.json').catch(() => [])]);
    const lists = (files || []).filter(f => f.type === 'file' && /\.json$/i.test(f.name) && !RESERVED.includes(f.name.slice(0, -5)));
    app.innerHTML = `<h1>Manage lists</h1>
      <p class="mut">Changes are committed to the repo; the build-index Action then updates index.json and search.json (about a minute).</p>
      <a class="btn" href="#/upload">⬆️ Upload new lists</a>` +
      (lists.map(f => {
        const e = idx.find(x => x.file === f.name);
        return `<div class="card" style="padding:14px 18px"><b>${esc(e ? e.title : f.name)}</b>
          <span class="mut">${esc(f.name)}${e ? ' · ' + e.count + ' words' : ''}</span>
          ${e ? '' : '<span class="bad"> ⚠ not in index (invalid, or build pending)</span>'}
          <div><a class="btn alt" href="#/edit/${encodeURIComponent(f.name.slice(0, -5))}">✏️ Edit</a>
          <button class="btn alt" data-del="${esc(f.name)}" data-sha="${esc(f.sha)}">🗑 Delete</button></div></div>`;
      }).join('') || '<p class="mut">No lists in data/ yet.</p>');
    app.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const n = b.dataset.del, id = listId(n.slice(0, -5));
      if (!confirm(`Delete ${n} from the repo?`)) return;
      const wipe = confirm('Also reset your learning progress for this list on this device?\nOK = reset, Cancel = keep it');
      b.disabled = true;
      try {
        await gh(cfg, 'DELETE', 'data/' + n, { message: 'delete list: ' + n.slice(0, -5), sha: b.dataset.sha, branch: cfg.branch });
        if (wipe) { Object.keys(S).filter(k => k.startsWith(id + '::')).forEach(k => delete S[k]); save(); }
        delete cache[id];
        b.closest('.card').innerHTML = `<span class="good">Deleted ✓</span> <span class="mut">${esc(n)}</span>`;
      } catch (e) { b.disabled = false; alert(e.message); }
    });
  } catch (e) { app.innerHTML = `<h1>Manage lists</h1><div class="card bad">${esc(e.message)}</div>`; }
}

async function editView(name) {
  document.getElementById('crumb').textContent = '/ Edit ' + name;
  const cfg = ghReady();
  if (!cfg) { app.innerHTML = '<h1>Edit list</h1>' + NO_CFG; return; }
  app.innerHTML = '<h1>Edit list</h1><p class="mut">Loading…</p>';
  try {
    const j = await gh(cfg, 'GET', `data/${name}.json`);
    if (!j) throw new Error(`data/${name}.json not found in ${cfg.repo}`);
    let text = b64dec(j.content);
    try { text = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { /* invalid file: show it raw so it can be fixed */ }
    app.innerHTML = `<h1>Edit ${esc(name)}.json</h1>
      <p class="mut">Edit the JSON, then save. It is checked first; Save is enabled only when the list is valid.</p>
      <textarea id="ed" spellcheck="false" style="width:100%;height:60vh;font:14px/1.4 ui-monospace,Menlo,Consolas,monospace;border-radius:10px;border:2px solid var(--bd);background:var(--card);color:var(--tx);padding:10px"></textarea>
      <div id="ed-st" style="margin:8px 0"></div>
      <button class="btn" id="ed-save">Save to repo</button><a class="btn alt" href="#/manage">← Back</a>`;
    const ta = document.getElementById('ed'), st = document.getElementById('ed-st'), sv = document.getElementById('ed-save');
    ta.value = text;
    const chk = () => {
      let d, errs;
      try { d = JSON.parse(ta.value); errs = validateList(d); } catch (e) { errs = ['Invalid JSON: ' + e.message]; }
      st.innerHTML = errs.length
        ? `<span class="bad">✗ ${errs.length} problem${errs.length > 1 ? 's' : ''}</span>` + errs.slice(0, 8).map(x => `<div class="mut">• ${esc(x)}</div>`).join('') + (errs.length > 8 ? `<div class="mut">…and ${errs.length - 8} more</div>` : '')
        : '<span class="good">✓ valid</span>';
      sv.disabled = !!errs.length;
      return errs.length ? null : d;
    };
    ta.oninput = chk; chk();
    sv.onclick = async () => {
      const d = chk(); if (!d) return;
      sv.disabled = true;
      try {
        const r = await gh(cfg, 'PUT', `data/${name}.json`, { message: 'edit list: ' + name, content: b64(JSON.stringify(d, null, 2) + '\n'), sha: j.sha, branch: cfg.branch });
        j.sha = r.content.sha;                       // allow further saves without reloading
        delete cache[listId(name)];
        st.innerHTML = '<span class="good">Saved ✓</span> <span class="mut">The index rebuilds in about a minute.</span>';
      } catch (e) { st.innerHTML = `<span class="bad">${esc(e.message)}</span>`; sv.disabled = false; }
    };
  } catch (e) { app.innerHTML = `<h1>Edit list</h1><div class="card bad">${esc(e.message)}</div>`; }
}
