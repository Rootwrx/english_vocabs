/* github.js — the ONLY file that talks to GitHub.
 * Everything the app changes in the repo goes through ghCommit(): one atomic commit per action
 * (add/replace/delete/rename any number of files). A rename is therefore a single commit, and the
 * build-index Action runs once and rebuilds index.json + search.json from whatever is in data/.
 * List files may live in subfolders of data/ (e.g. data/by_level/Basic Vocabulary (A1A2)/part1.json);
 * every "name" below is the path relative to data/ ("by_level/Basic Vocabulary (A1A2)/part1.json"). */
const GH_KEY = 'wordlists.gh.v1';
const RESERVED = ['index', 'search', 'catalog'];            // generated files at the top of data/, never edited by the app

function ghCfg() {
  let c = { repo: '', branch: 'main', token: '' };
  try { Object.assign(c, JSON.parse(localStorage.getItem(GH_KEY) || '{}')); } catch (e) {}
  if (!c.repo && /\.github\.io$/.test(location.hostname))   // owner.github.io/repo/ -> owner/repo
    c.repo = location.hostname.split('.')[0] + '/' + (location.pathname.split('/')[1] || 'english_vocab');
  return c;
}
const ghReady = () => { const c = ghCfg(); return /^[\w.-]+\/[\w.-]+$/.test(c.repo) && c.token ? c : null; };
const b64 = s => { let t = ''; new TextEncoder().encode(s).forEach(c => t += String.fromCharCode(c)); return btoa(t); };
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0)));

async function ghApi(cfg, method, path, body) {
  const r = await fetch(`https://api.github.com/repos/${cfg.repo}/${path}`, {
    method, body: body && JSON.stringify(body),
    headers: { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json' }
  });
  if (method === 'GET' && r.status === 404) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(
    r.status === 401 ? 'Token rejected (401).' :
    r.status === 403 || r.status === 404 ? `No access (${r.status}). The token needs "Contents: Read and write" on ${cfg.repo}.` :
    r.status === 409 || r.status === 422 ? `The repo changed meanwhile or the request was refused (${r.status}); try again. ${j.message || ''}` :
    `GitHub ${r.status}: ${j.message || ''}`);
  return j;
}

/** JSON files under data/ including subfolders (except generated ones): [{name: "sub/file.json", sha}] */
async function ghList(cfg) {
  const t = await ghApi(cfg, 'GET', `git/trees/${encodeURIComponent(cfg.branch)}?recursive=1`);
  return ((t && t.tree) || [])
    .filter(f => f.type === 'blob' && /^data\/.+\.json$/i.test(f.path))
    .map(f => ({ name: f.path.slice(5), sha: f.sha }))
    .filter(f => !RESERVED.includes(f.name.slice(0, -5)));   // only top-level names can match, nested ones contain "/"
}
/** One data file (name relative to data/): {text, sha} or null */
async function ghFile(cfg, name) {
  const p = name.split('/').map(encodeURIComponent).join('/');
  const j = await ghApi(cfg, 'GET', `contents/data/${p}?ref=${encodeURIComponent(cfg.branch)}`);
  return j && { text: b64dec(j.content), sha: j.sha };
}
/** Atomic commit. changes: [{path, content}] to add/replace, [{path, del:true}] to remove. */
async function ghCommit(cfg, message, changes) {
  const head = (await ghApi(cfg, 'GET', `git/ref/heads/${cfg.branch}`)).object.sha;
  const base = (await ghApi(cfg, 'GET', `git/commits/${head}`)).tree.sha;
  const tree = await ghApi(cfg, 'POST', 'git/trees', { base_tree: base, tree: changes.map(c =>
    c.del ? { path: c.path, mode: '100644', type: 'blob', sha: null } : { path: c.path, mode: '100644', type: 'blob', content: c.content }) });
  const commit = await ghApi(cfg, 'POST', 'git/commits', { message, tree: tree.sha, parents: [head] });
  await ghApi(cfg, 'PATCH', `git/refs/heads/${cfg.branch}`, { sha: commit.sha });
}
