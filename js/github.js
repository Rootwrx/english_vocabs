/* github.js — the ONLY file that talks to GitHub.
 * Everything the app changes in the repo goes through ghCommit(): one atomic commit per action
 * (add/replace/delete/rename any number of files). A rename is therefore a single commit, and the
 * build-index Action runs once and rebuilds index.json + search.json from whatever is in data/. */
const GH_KEY = 'wordlists.gh.v1';
const RESERVED = ['index', 'search', 'catalog'];            // generated files, never edited by the app

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

/** JSON files in data/ (except generated ones): [{name, sha}] */
async function ghList(cfg) {
  const a = await ghApi(cfg, 'GET', `contents/data?ref=${encodeURIComponent(cfg.branch)}`);
  return (a || []).filter(f => f.type === 'file' && /\.json$/i.test(f.name) && !RESERVED.includes(f.name.slice(0, -5)))
    .map(f => ({ name: f.name, sha: f.sha }));
}
/** One data file: {text, sha} or null */
async function ghFile(cfg, name) {
  const j = await ghApi(cfg, 'GET', `contents/data/${encodeURIComponent(name)}?ref=${encodeURIComponent(cfg.branch)}`);
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
