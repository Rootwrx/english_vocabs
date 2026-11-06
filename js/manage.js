/* manage.js — upload, edit, rename/details, duplicate, download and delete lists.
 * UI lives on the home page (an "Edit lists" toggle adds a toolbar to every list card; dialogs are modals).
 * All repo writes go through ghCommit() in github.js; the build-index Action rebuilds index.json/search.json.
 * After each commit the in-memory INDEX is patched so the home page updates instantly.
 * validateList() mirrors check() in make_index.py — keep both in sync.
 * Lists may live in subfolders of data/; a file name below is always the path relative to data/
 * (e.g. "by_level/Basic Vocabulary (A1A2)/part1.json").
 * Uses globals from index.html at call time: app, esc, S, save, cache, INDEX, J, route. */

/* ---------- helpers ---------- */
const slug = s => String(s).replace(/\.json$/i, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
/* same rule as make_index.py: path without .json, folders joined with "__", unsafe characters -> "_" */
const listId = file => file.replace(/\.json$/i, '').split('/').join('__').replace(/[^A-Za-z0-9_-]+/g, '_');
/* where an uploaded list is saved: data/<group>/<set>/part<N>.json when it has group + set, else a flat data/<name>.json */
const dirName = s => String(s).replace(/[\\/:*?"<>|#%]+/g, '-').replace(/\s+/g, ' ').trim();
const gDir = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'other';
const listPath = (d, name) => d && d.group && d.set
  ? `${gDir(d.group)}/${dirName(d.set) || 'set'}/${d.part ? 'part' + d.part : name}.json` : name + '.json';
const partOf = name => { const m = /^part[-_ ]?(\d+)$/i.exec(name); return m ? +m[1] : 0; };
/* group / set / part / title of a list — same rule as meta() in make_index.py: the FOLDER decides
 * (data/<group>/<set>/part<N>.json), fields inside the file override it, and the title is "<set> – Part <N>" unless the file has one */
function meta(file, d) {
  const folders = file.replace(/\.json$/i, '').split('/'), stem = folders.pop();
  let group = d.group || '', set = d.set || '', part = d.part || 0;
  if (folders.length) {
    group = group || (CAT || []).map(c => c.group).find(g => gDir(g) === folders[0]) || folders[0].replace(/_+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    set = set || folders.slice(1).join(' / ');
    part = part || partOf(stem);
  }
  const title = d.title || (set && part ? `${set} – Part ${part}` : set && folders.length ? `${set} – ${stem}` : set || stem);
  return { group, set, part, title };
}
const idxEntry = (file, d) => ({ id: listId(file), file, ...meta(file, d),
  count: (d.words || []).length, texts: (d.texts || []).length });
const idxSet = (file, d) => { if (!INDEX) return; const e = idxEntry(file, d), i = INDEX.findIndex(x => x.file === file); i < 0 ? INDEX.push(e) : (INDEX[i] = e); };
const idxDel = file => { if (INDEX) INDEX = INDEX.filter(x => x.file !== file); };
const pretty = d => JSON.stringify(d, null, 2) + '\n';

function validateList(d) {
  const errs = [], stars = s => (String(s).match(/\*/g) || []).length;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ['Top level must be an object with a "words" array'];
  if (!Array.isArray(d.words) || !d.words.length) return ['"words" is missing or empty'];
  if ('part' in d && !(Number.isInteger(d.part) && d.part > 0)) return ['"part" must be a positive integer'];
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
const errHtml = errs => errs.length
  ? `<span class="bad">✗ ${errs.length} problem${errs.length > 1 ? 's' : ''}</span>` + errs.slice(0, 8).map(e => `<div class="mut">• ${esc(e)}</div>`).join('') + (errs.length > 8 ? `<div class="mut">…and ${errs.length - 8} more</div>` : '')
  : '<span class="good">✓ valid</span>';

function modal(html) {
  const o = document.createElement('div'); o.className = 'ov';
  o.innerHTML = `<div class="dlg">${html}</div>`;
  o.onclick = e => { if (e.target === o) o.remove(); };
  o.querySelectorAll('[data-close]').forEach(b => b.onclick = () => o.remove());
  document.body.appendChild(o); return o;
}
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 6000);
}
const DONE = '✓ Committed. The index rebuilds in about a minute.';
const need = () => { const c = ghReady(); if (!c) { alert('Connect GitHub first (⬆️ Upload → GitHub connection).'); location.hash = '#/upload'; } return c; };

/* ---------- toolbar on each list card (edit mode) ---------- */
const listTools = file => '<div class="tools">' + [['edit', '✏️ Edit'], ['details', '🏷 Rename'], ['dup', '⧉ Duplicate'], ['dl', '⬇ Download'], ['del', '🗑 Delete']]
  .map(([a, t]) => `<button class="btn alt sm" data-act="${a}" data-file="${esc(file)}">${t}</button>`).join('') + '</div>';

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  ({ edit: editList, details: detailsList, dup: dupList, dl: dlList, del: delList })[b.dataset.act](b.dataset.file);
});

/** Files in data/ (any subfolder) that are not in index.json (invalid lists, or a build that has not run yet) */
async function orphanCards() {
  const cfg = ghReady();
  if (!cfg) return '<p class="mut">Connect GitHub (⬆️ Upload) to edit lists.</p>';
  try {
    const miss = (await ghList(cfg)).filter(f => !(INDEX || []).some(e => e.file === f.name));
    return miss.length ? '<div class="tag">In the repo but not in the index (invalid, or build pending)</div>' +
      miss.map(f => `<div class="card" style="padding:14px 18px"><b>${esc(f.name)}</b> <span class="bad">⚠ not indexed</span>${listTools(f.name)}</div>`).join('') : '';
  } catch (e) { return `<p class="bad">${esc(e.message)}</p>`; }
}

/* ---------- edit (raw JSON, validated) ---------- */
async function editList(f) {
  const cfg = need(); if (!cfg) return;
  let file; try { file = await ghFile(cfg, f); } catch (e) { return alert(e.message); }
  if (!file) return alert(`data/${f} was not found in ${cfg.repo}`);
  let text = file.text; try { text = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { /* invalid: show raw so it can be fixed */ }
  const m = modal(`<h2>Edit ${esc(f)}</h2><p class="mut">Save is enabled only when the list is valid.</p>
    <textarea id="ed" spellcheck="false" style="width:100%;height:55vh;font:14px/1.4 ui-monospace,Menlo,Consolas,monospace;border-radius:10px;border:2px solid var(--bd);background:var(--bg);color:var(--tx);padding:10px"></textarea>
    <div id="ed-st" style="margin:8px 0"></div><button class="btn" id="ed-save">Save to repo</button><button class="btn alt" data-close>Cancel</button>`);
  const ta = m.querySelector('#ed'), st = m.querySelector('#ed-st'), sv = m.querySelector('#ed-save');
  ta.value = text;
  const chk = () => {
    let d, errs; try { d = JSON.parse(ta.value); errs = validateList(d); } catch (e) { errs = ['Invalid JSON: ' + e.message]; }
    st.innerHTML = errHtml(errs); sv.disabled = !!errs.length; return errs.length ? null : d;
  };
  ta.oninput = chk; chk();
  sv.onclick = async () => {
    const d = chk(); if (!d) return; sv.disabled = true; st.textContent = 'Committing…';
    try {
      await ghCommit(cfg, 'edit list: ' + f.replace(/\.json$/, ''), [{ path: 'data/' + f, content: pretty(d) }]);
      delete cache[listId(f)]; idxSet(f, d); m.remove(); toast(DONE); route();
    } catch (e) { st.innerHTML = `<span class="bad">${esc(e.message)}</span>`; sv.disabled = false; }
  };
}

/* ---------- rename / details: title, Arabic title, group, file name — one atomic commit ---------- */
async function detailsList(f) {
  const cfg = need(); if (!cfg) return;
  let file; try { file = await ghFile(cfg, f); } catch (e) { return alert(e.message); }
  if (!file) return alert(`data/${f} was not found in ${cfg.repo}`);
  let d; try { d = JSON.parse(file.text); } catch (e) { return alert('This file is not valid JSON. Use ✏️ Edit to fix it first.'); }
  const dir = f.slice(0, f.lastIndexOf('/') + 1),               // the folder stays; only the file name changes
    base = f.slice(dir.length).replace(/\.json$/i, ''), groups = [...new Set((INDEX || []).map(e => e.group).filter(Boolean))];
  const inp = (id, label, val, extra = '') => `<div class="tag">${label}</div><input class="ans" id="${id}" value="${esc(val)}" style="text-align:left;margin:4px 0" ${extra}>`;
  const m = modal(`<h2>Rename / details</h2>
    ${inp('d-title', 'Title (optional, empty = “' + esc(meta(f, { ...d, title: '' }).title) + '”)', d.title || '')}${inp('d-ar', 'Arabic title (optional)', d.title_ar || '')}
    ${inp('d-group', 'Group (optional override, normally taken from the folder)', d.group || '', 'list="d-groups"')}
    <datalist id="d-groups">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
    ${inp('d-file', 'File name (changing it renames data/' + esc(f) + ')', base)}
    <p class="mut">Renaming the file keeps your learning progress on this device. The folder stays the same.</p>
    <div id="d-st"></div><button class="btn" id="d-save">Save to repo</button><button class="btn alt" data-close>Cancel</button>`);
  const v = id => m.querySelector('#' + id).value.trim(), st = m.querySelector('#d-st');
  m.querySelector('#d-save').onclick = async () => {
    const nf = slug(v('d-file')), newFile = dir + nf + '.json';
    if (!nf) return st.innerHTML = '<span class="bad">File name is empty.</span>';
    if (!dir && RESERVED.includes(nf)) return st.innerHTML = `<span class="bad">"${nf}" is reserved.</span>`;
    v('d-title') ? d.title = v('d-title') : delete d.title;     // empty = automatic "<set> – Part N"
    v('d-ar') ? d.title_ar = v('d-ar') : delete d.title_ar;
    v('d-group') ? d.group = v('d-group') : delete d.group;
    st.textContent = 'Committing…';
    try {
      const moved = newFile !== f;
      if (moved && (await ghList(cfg)).some(x => x.name === newFile)) return st.innerHTML = `<span class="bad">data/${esc(newFile)} already exists.</span>`;
      const changes = [{ path: 'data/' + newFile, content: pretty(d) }]; if (moved) changes.push({ path: 'data/' + f, del: true });
      await ghCommit(cfg, moved ? `rename list: ${base} → ${nf}` : 'update list details: ' + base, changes);
      if (moved) {                                    // carry progress over to the new id, then drop the old entry
        const o = listId(f) + '::', n = listId(newFile) + '::';
        Object.keys(S).filter(k => k.startsWith(o)).forEach(k => { S[n + k.slice(o.length)] = S[k]; delete S[k]; }); save();
        idxDel(f); delete cache[listId(f)];
      }
      delete cache[listId(newFile)]; idxSet(newFile, d); m.remove(); toast(DONE); route();
    } catch (e) { st.innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
  };
}

/* ---------- duplicate (the copy is created in the same folder) ---------- */
async function dupList(f) {
  const cfg = need(); if (!cfg) return;
  const dir = f.slice(0, f.lastIndexOf('/') + 1), base = f.slice(dir.length).replace(/\.json$/i, ''),
    nf = slug(prompt('File name for the copy:', base + '-copy') || '');
  if (!nf || (!dir && RESERVED.includes(nf))) return;
  try {
    if ((await ghList(cfg)).some(x => x.name === dir + nf + '.json')) return alert(`data/${dir}${nf}.json already exists.`);
    const file = await ghFile(cfg, f), d = JSON.parse(file.text); d.title = meta(f, d).title + ' (copy)';
    await ghCommit(cfg, `duplicate list: ${base} → ${nf}`, [{ path: `data/${dir}${nf}.json`, content: pretty(d) }]);
    idxSet(dir + nf + '.json', d); toast(DONE); route();
  } catch (e) { alert(e.message); }
}

/* ---------- download (no token needed) ---------- */
async function dlList(f) {
  try {
    const r = await fetch('data/' + f.split('/').map(encodeURIComponent).join('/'), { cache: 'no-cache' }); if (!r.ok) throw new Error('Cannot load data/' + f);
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = f.split('/').pop(); a.click(); URL.revokeObjectURL(a.href);
  } catch (e) { alert(e.message); }
}

/* ---------- delete ---------- */
function delList(f) {
  const cfg = need(); if (!cfg) return;
  const id = listId(f), title = ((INDEX || []).find(e => e.file === f) || {}).title || f;
  const m = modal(`<h2>Delete “${esc(title)}”?</h2><p>This removes <code>data/${esc(f)}</code> from the repo (git history keeps a copy). The index drops it automatically.</p>
    <label><input type="checkbox" id="del-p" checked> Also reset my learning progress for this list</label>
    <div id="del-st" style="margin:8px 0"></div><button class="btn" id="del-go" style="background:var(--no)">Delete</button><button class="btn alt" data-close>Cancel</button>`);
  m.querySelector('#del-go').onclick = async () => {
    const wipe = m.querySelector('#del-p').checked; m.querySelector('#del-st').textContent = 'Committing…';
    try {
      await ghCommit(cfg, 'delete list: ' + f.replace(/\.json$/, ''), [{ path: 'data/' + f, del: true }]);
      if (wipe) { Object.keys(S).filter(k => k.startsWith(id + '::')).forEach(k => delete S[k]); save(); }
      delete cache[id]; idxDel(f); m.remove(); toast(DONE); route();
    } catch (e) { m.querySelector('#del-st').innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
  };
}

/* ---------- settings helper: progress of lists that no longer exist ---------- */
async function cleanProgress() {
  const ids = new Set((await getIndex()).map(e => e.id)), dead = Object.keys(S).filter(k => !ids.has(k.split('::')[0]));
  if (!dead.length) return alert('Nothing to clean up.');
  if (confirm(`Remove ${dead.length} saved card(s) belonging to lists that no longer exist?`)) { dead.forEach(k => delete S[k]); save(); toast('Cleaned up ✓'); }
}

/* ---------- upload page: many files, ONE commit ---------- */
let UP = [];
function renderUp() {
  const ready = UP.filter(r => !r.errs.length && !/✓/.test(r.st || ''));
  document.getElementById('up-rows').innerHTML = UP.map(r => `<div class="box"><b>data/${esc(r.path)}</b>
    <span class="mut">${esc(r.data?.title || '')} · ${r.data?.words?.length || 0} words</span>
    <span class="${r.errs.length || /failed/.test(r.st) ? 'bad' : 'good'}"> ${r.errs.length ? '' : esc(r.st || '✓ valid')}</span>${r.errs.length ? '<div>' + errHtml(r.errs) + '</div>' : ''}</div>`).join('');
  const act = document.getElementById('up-act');
  act.innerHTML = ready.length ? `<button class="btn" id="up-go">Upload ${ready.length} file${ready.length > 1 ? 's' : ''}</button>` : '';
  const go = document.getElementById('up-go'); if (!go) return;
  go.onclick = async () => {
    const cfg = need(); if (!cfg) return; go.disabled = true;
    try {
      const have = new Set((await ghList(cfg)).map(f => f.name)), over = ready.filter(r => have.has(r.path));
      if (over.length && !confirm(`Overwrite existing: ${over.map(r => r.path).join(', ')}?`)) { go.disabled = false; return; }
      await ghCommit(cfg, `${ready.length > 1 ? 'add lists' : 'add list'}: ${ready.map(r => r.name).join(', ')}`,
        ready.map(r => ({ path: `data/${r.path}`, content: pretty(r.data) })));
      ready.forEach(r => { r.st = (have.has(r.path) ? 'updated' : 'uploaded') + ' ✓'; idxSet(r.path, r.data); delete cache[listId(r.path)]; });
      renderUp(); toast(DONE);
      document.getElementById('up-act').innerHTML = '<a class="btn" href="#/">← Back to lists</a>';
    } catch (e) { ready.forEach(r => r.st = 'failed: ' + e.message); renderUp(); }
  };
}
/* where each selected file goes. With a Group + Set chosen: data/<group>/<set>/part<N>.json — a file named part3.json keeps
 * number 3, any other file name gets the next free part number. Without them: the group/set written inside the file, else flat. */
function assignPaths() {
  const val = id => (document.getElementById(id) || {}).value?.trim() || '', g = val('up-g'), s = val('up-s');
  const explicit = r => partOf(r.name) || (r.data && r.data.part) || 0;
  let next = Math.max(0, ...(INDEX || []).filter(e => e.group === g && e.set === s).map(e => e.part || 0), ...UP.map(explicit));
  UP.forEach(r => {
    r.path = g && s ? `${gDir(g)}/${dirName(s) || 'set'}/part${explicit(r) || ++next}.json` : listPath(r.data, r.name);
    r.errs = r.v.concat(!r.path.includes('/') && RESERVED.includes(r.name) ? [`"${r.name}" is a reserved name; rename the file`] : []);
  });
}
function uploadView(pg = '', ps = '') {
  document.getElementById('crumb').textContent = '/ Upload'; UP = [];
  const c = ghCfg();
  app.innerHTML = `<h1>Upload lists</h1>
  <div class="card"><h2>1 · GitHub connection</h2>
    <p class="mut">Lists are committed to <code>data/</code> in your repo. Use a fine-grained token limited to that one repository with “Contents: Read and write”. It is stored only in this browser.</p>
    <input class="ans" id="gh-repo" placeholder="owner/english_vocab" value="${esc(c.repo)}" style="text-align:left">
    <input class="ans" id="gh-branch" placeholder="branch" value="${esc(c.branch)}" style="text-align:left">
    <input class="ans" id="gh-token" type="password" placeholder="GitHub token" value="${esc(c.token)}" style="text-align:left">
    <button class="btn alt" id="gh-save">Save</button> <span class="mut" id="gh-msg"></span></div>
  <div class="card"><h2>2 · Category</h2>
    <p class="mut">Lists are saved to <code>data/&lt;group&gt;/&lt;set&gt;/part&lt;N&gt;.json</code> and show up under that group and set as “Part N”.
    A file named <code>part3.json</code> keeps number 3; any other file name gets the next free part number.
    Leave both empty only for a list that has <code>group</code> and <code>set</code> written inside it (otherwise it is saved flat).</p>
    <input class="ans" id="up-g" list="up-gs" placeholder="Group, e.g. By Level" value="${esc(pg)}" style="text-align:left" autocomplete="off"><datalist id="up-gs"></datalist>
    <input class="ans" id="up-s" list="up-ss" placeholder="Set, e.g. Basic Vocabulary (A1A2)" value="${esc(ps)}" style="text-align:left" autocomplete="off"><datalist id="up-ss"></datalist></div>
  <div class="card"><h2>3 · Choose list files (.json)</h2>
    <p class="mut">Same format as <a href="data/example.json">example.json</a>, but title, group, set and part are not needed. Every file is checked before upload, and all files go in one commit.</p>
    <input type="file" id="up-files" accept=".json,application/json" multiple><div id="up-rows"></div><div id="up-act"></div></div>`;
  document.getElementById('gh-save').onclick = () => {
    const v = id => document.getElementById(id).value.trim();
    try { localStorage.setItem(GH_KEY, JSON.stringify({ repo: v('gh-repo'), branch: v('gh-branch') || 'main', token: v('gh-token') })); } catch (e) {}
    document.getElementById('gh-msg').textContent = 'Saved ✓';
  };
  document.getElementById('up-files').onchange = async ev => {
    UP = [];
    for (const f of ev.target.files) {
      const row = { name: slug(f.name) || 'list', data: null, v: [], errs: [], st: '', path: '' };   // v = validation errors
      try { row.data = JSON.parse(await f.text()); row.v = validateList(row.data); } catch (e) { row.v = ['Invalid JSON: ' + e.message]; }
      UP.push(row);
    }
    assignPaths(); renderUp();
  };
  /* suggestions: groups and sets from catalog.json + lists already uploaded */
  const val = id => document.getElementById(id).value.trim();
  const fillSets = () => {
    const g = val('up-g'), sets = new Set();
    (CAT || []).filter(c => c.group === g).forEach(c => (c.sets || []).forEach(s => sets.add(s)));
    (INDEX || []).filter(e => e.group === g && e.set).forEach(e => sets.add(e.set));
    document.getElementById('up-ss').innerHTML = [...sets].map(s => `<option value="${esc(s)}">`).join('');
  };
  Promise.all([getIndex(), getCatalog()]).then(() => {
    document.getElementById('up-gs').innerHTML = [...new Set([...(CAT || []).map(c => c.group), ...INDEX.map(e => e.group).filter(Boolean)])]
      .map(g => `<option value="${esc(g)}">`).join('');
    fillSets(); assignPaths(); renderUp();
  }).catch(() => {});
  document.getElementById('up-g').oninput = () => { fillSets(); assignPaths(); renderUp(); };
  document.getElementById('up-s').oninput = () => { assignPaths(); renderUp(); };
}
