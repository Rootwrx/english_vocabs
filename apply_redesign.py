#!/usr/bin/env python3
"""Run from the repo root:  python apply_redesign.py
Applies the Category -> Topic -> Part redesign to make_index.py, js/github.js, js/manage.js and index.html.
Every edit is checked: if a snippet is not found exactly once, nothing is written for that file and the script stops.
Running it twice is safe (it detects already-patched files)."""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).parent

def load(p): return open(ROOT / p, encoding="utf-8", newline="").read()
def store(p, s): open(ROOT / p, "w", encoding="utf-8", newline="").write(s)

def rep(s, old, new, what):
    if s.count(old) != 1:
        sys.exit(f"✗ {what}: expected exactly 1 match, found {s.count(old)}. Nothing written for this file.")
    return s.replace(old, new)

def rex(s, pat, new, what):
    m = list(re.finditer(pat, s, re.S))
    if len(m) != 1:
        sys.exit(f"✗ {what}: expected exactly 1 match, found {len(m)}. Nothing written for this file.")
    return s[:m[0].start()] + new + s[m[0].end():]

# ---------------------------------------------------------------- make_index.py
s = load("make_index.py")
if '"catalog.json"' in s:
    print("make_index.py already patched")
else:
    s = rep(s, 'SKIP = {"index.json", "search.json"}', 'SKIP = {"index.json", "search.json", "catalog.json"}', "make_index SKIP")
    s = rep(s, "    errs, seen = [], set()\n",
            '    if "part" in d and not (isinstance(d["part"], int) and not isinstance(d["part"], bool) and d["part"] > 0):\n'
            '        return [\'"part" must be a positive integer\']\n'
            "    errs, seen = [], set()\n", "make_index part check")
    s = rep(s, '"group": d.get("group", ""), "count"',
            '"group": d.get("group", ""), "set": d.get("set", ""), "part": d.get("part", 0), "count"', "make_index entry")
    store("make_index.py", s); print("✓ make_index.py")

# ---------------------------------------------------------------- js/github.js
s = load("js/github.js")
if "'catalog'" in s:
    print("github.js already patched")
else:
    s = rep(s, "const RESERVED = ['index', 'search'];", "const RESERVED = ['index', 'search', 'catalog'];", "github RESERVED")
    store("js/github.js", s); print("✓ js/github.js")

# ---------------------------------------------------------------- js/manage.js
s = load("js/manage.js")
if "set: d.set" in s:
    print("manage.js already patched")
else:
    s = rep(s, "group: d.group || '',", "group: d.group || '',\n  set: d.set || '', part: d.part || 0,", "manage idxEntry")
    s = rep(s, """if (!Array.isArray(d.words) || !d.words.length) return ['"words" is missing or empty'];""",
            """if (!Array.isArray(d.words) || !d.words.length) return ['"words" is missing or empty'];
  if ('part' in d && !(Number.isInteger(d.part) && d.part > 0)) return ['"part" must be a positive integer'];""", "manage validateList")
    store("js/manage.js", s); print("✓ js/manage.js")

# ---------------------------------------------------------------- index.html
s = load("index.html")
if "groupView" in s:
    print("index.html already patched")
else:
    CSS = """.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}.grid .card{margin:0}
.gc{display:block;color:inherit;text-decoration:none}.gc .bar{margin-top:10px}
"""
    s = rep(s, "</style></head>", CSS + "</style></head>", "css")

    HELPERS = r'''

let CAT=null;
async function getCatalog(){if(!CAT){try{CAT=await J('data/catalog.json')}catch(e){CAT=[]}}return CAT}
/* group -> Map(topic -> [parts]); catalog order first, then anything uploaded */
function tree(idx){
  const G=new Map(),set=(g,s)=>{g=g||'Other';if(!G.has(g))G.set(g,new Map());const m=G.get(g);if(!m.has(s))m.set(s,[]);return m.get(s)};
  (CAT||[]).forEach(c=>{if(!(c.sets||[]).length)set(c.group,'\0');(c.sets||[]).forEach(s=>set(c.group,s))});
  idx.forEach(e=>set(e.group,e.set||e.title).push(e));
  G.forEach(m=>{m.delete('\0');m.forEach(a=>a.sort((x,y)=>(x.part||0)-(y.part||0)||x.title.localeCompare(y.title,undefined,{numeric:true})))});
  return G}
const stat=e=>{const k=Object.keys(S).filter(x=>x.startsWith(e.id+'::'));return{due:k.filter(x=>S[x].due<=Date.now()).length,seen:k.length,count:e.count||0}};
const sum=es=>es.reduce((a,e)=>{const s=stat(e);a.due+=s.due;a.seen+=s.seen;a.count+=s.count;return a},{due:0,seen:0,count:0});
const partCard=e=>{const s=stat(e);return `<div class="card" style="padding:14px 18px"><a style="display:block;color:inherit;text-decoration:none" href="#/l/${e.id}"><h2 style="margin:0">${esc(e.title)}</h2><div class="mut">${esc([e.group,e.set].filter(Boolean).join(' / '))} · ${e.count} words · <span class="${s.due?'good':''}">${s.due} due</span></div></a>${EDITMODE?listTools(e.file):''}</div>`};'''
    s = rep(s, "return cache[id]=l}", "return cache[id]=l}" + HELPERS, "helpers")

    s = rex(s, r"const idx=await getIndex\(\);(\s*)app\.innerHTML='<h1>Your lists",
            "const idx=await getIndex();await getCatalog();\\1app.innerHTML='<h1>Your lists".replace("\\1", "\n  "), "home catalog")

    DRAW = r'''const draw=()=>{const q=document.getElementById('q').value.trim().toLowerCase();words(q);
    const L=document.getElementById('lists');
    if(q){L.innerHTML=idx.filter(e=>(e.title+' '+(e.group||'')+' '+(e.set||'')).toLowerCase().includes(q)).map(partCard).join('');return}
    L.innerHTML='<div class="grid">'+[...tree(idx)].map(([g,m])=>{
      const sets=[...m.values()],parts=sets.flat(),t=sum(parts),started=sets.filter(a=>a.length).length;
      return `<a class="card gc" href="#/g/${encodeURIComponent(g)}"><h2>${esc(g)}</h2>
        <div class="mut">${started}/${sets.length} topics started · ${parts.length} part${parts.length===1?'':'s'} · ${t.count} words</div>
        <div class="${t.due?'good':'mut'}">${t.due} due</div><div class="bar"><i style="width:${t.count?t.seen/t.count*100:0}%"></i></div></a>`}).join('')+'</div>'};
  '''
    s = rex(s, r"const draw=\(\)=>\{const raw=.*?(?=document\.getElementById\('q'\)\.oninput=draw;draw\(\);)",
            DRAW.replace("\\", "\\\\") if False else DRAW, "home draw")

    GROUPVIEW = r'''/* ---------- category page: topics -> parts ---------- */
async function groupView(g){
  document.getElementById('crumb').textContent='/ '+g;
  const idx=await getIndex();await getCatalog();const m=tree(idx).get(g);
  if(!m){app.innerHTML='<p class="mut">Unknown category.</p>';return}
  app.innerHTML=`<h1>${esc(g)}</h1><div><button class="btn alt" id="editmode">${EDITMODE?'✓ Done editing':'✏️ Edit lists'}</button><a class="btn alt" href="#/upload">⬆️ Add part</a></div>`+
  [...m].map(([name,parts])=>{
    const t=sum(parts),next=Math.max(0,...parts.map(p=>p.part||0))+1;
    return `<div class="card" style="padding:14px 18px"><h2 style="margin:0">${esc(name)}</h2>
      <div class="mut">${parts.length?`${parts.length} part${parts.length>1?'s':''} · ${t.count} words · <span class="${t.due?'good':''}">${t.due} due</span>`:'Not started'}</div>
      <div>${parts.map(p=>{const s=stat(p);return `<a class="chip" href="#/l/${p.id}">${p.part?'Part '+p.part:esc(p.title)}${s.due?' · '+s.due+' due':''}${s.count&&s.seen>=s.count&&!s.due?' ✓':''}</a>`}).join('')}
      <a class="chip" href="#/upload" style="opacity:.5">+ Part ${next}</a></div>
      ${EDITMODE?parts.map(p=>`<div class="mut" style="margin-top:6px">${esc(p.file)}</div>`+listTools(p.file)).join(''):''}</div>`}).join('');
  document.getElementById('editmode').onclick=()=>{EDITMODE=!EDITMODE;groupView(g)}}

'''
    s = rep(s, "/* ---------- router ---------- */", GROUPVIEW + "/* ---------- router ---------- */", "groupView")
    s = rep(s, "else if(p[0]==='upload')uploadView();",
            "else if(p[0]==='upload')uploadView();\n    else if(p[0]==='g')await groupView(decodeURIComponent(p[1]||''));", "router")

    BACK = r'''${l.group?`<a class="mut" href="#/g/${encodeURIComponent(l.group)}">← ${esc(l.group)}${l.set?' / '+esc(l.set):''}</a>`:''}'''
    s = rep(s, "app.innerHTML=`<h1>${esc(l.title)}</h1>", "app.innerHTML=`" + BACK + "<h1>${esc(l.title)}</h1>", "back link")
    store("index.html", s); print("✓ index.html")

print("\nDone. Next: python make_catalog.py <your reverso folder>, move catalog.json to data/, commit.")
