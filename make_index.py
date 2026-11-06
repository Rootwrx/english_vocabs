#!/usr/bin/env python3
"""Scans data/**/*.json and writes data/index.json and data/search.json (run locally or by the GitHub Action).
Lists can be flat files (data/unit1.json) or live in subfolders (data/by_level/Basic Vocabulary (A1A2)/part1.json).
The folders decide the category: data/<group>/<set>/part<N>.json shows under that group and set as "Part N", and its title is
"<set> – Part N", so a list file needs no title / group / set / part fields (they are optional overrides).
The list id is the path without .json, folders joined with "__" and unsafe characters replaced by "_"
(keep listId() in js/manage.js identical).
search.json = one compact entry per word: w, pos, ar, def, l (list id), i (word index), c (collocations [[phrase, arabic], ...]).

Invalid files are SKIPPED (the other lists still get indexed) and reported as GitHub annotations
(::error file=...::message). The script then exits 1 so the Action run is marked red.
Keep check() in sync with validateList() in js/manage.js."""
import json, re, sys, pathlib
DATA = pathlib.Path(__file__).parent / "data"
SKIP = {"index.json", "search.json", "catalog.json"}   # generated files; only skipped at the top level of data/
strip = lambda s: (s or "").replace("*", "")
stars = lambda s: str(s).count("*")
gdir = lambda g: re.sub(r"[^a-z0-9]+", "_", g.lower()).strip("_") or "other"   # same rule as gDir() in js/manage.js
try: GROUPS = [c["group"] for c in json.loads((DATA / "catalog.json").read_text(encoding="utf-8-sig"))]
except Exception: GROUPS = []

def meta(rel, d):
    """group / set / part / title of a list. The FOLDER decides (data/<group>/<set>/part<N>.json), e.g.
    data/by_level/Basic Vocabulary (A1A2)/part1.json -> By Level / Basic Vocabulary (A1A2) / part 1,
    title "Basic Vocabulary (A1A2) – Part 1". Fields written inside the file override the folder.
    Keep identical to meta() in js/manage.js."""
    folders = list(rel.with_suffix("").parts); stem = folders.pop()
    group, st, part = d.get("group", ""), d.get("set", ""), d.get("part", 0)
    if folders:
        group = group or next((g for g in GROUPS if gdir(g) == folders[0]), folders[0].replace("_", " ").title())
        st = st or " / ".join(folders[1:])
        m = re.fullmatch(r"part[-_ ]?(\d+)", stem, re.I)
        part = part or (int(m.group(1)) if m else 0)
    title = d.get("title") or (f"{st} – Part {part}" if st and part else f"{st} – {stem}" if st and folders else st or stem)
    return group, st, part, title

def check(d):
    if not isinstance(d, dict) or not isinstance(d.get("words"), list) or not d["words"]:
        return ['needs an object with a non-empty "words" list']
    if "part" in d and not (isinstance(d["part"], int) and not isinstance(d["part"], bool) and d["part"] > 0):
        return ['"part" must be a positive integer']
    errs, seen = [], set()
    for i, w in enumerate(d["words"]):
        if not isinstance(w, dict): errs.append(f"word {i+1}: must be an object"); continue
        nm = f"word {i+1} ({w.get('w','?')})"
        for k in ("w", "pos", "def", "ar", "emoji"):
            if not w.get(k): errs.append(f"{nm}: missing '{k}'")
        key = str(w.get("w", "")).lower()
        if key and key in seen: errs.append(f"{nm}: duplicate word in this list")
        seen.add(key)
        for c in w.get("col", []):
            if stars(c.get("p", "")) != 2: errs.append(f"{nm}: collocation '{c.get('p')}' needs exactly one *form*")
            if c.get("en") and stars(c["en"]) != 2: errs.append(f"{nm}: example for '{c.get('p')}' needs exactly one *form*")
        for e in w.get("ex", []):
            if stars(e.get("en", "")) != 2: errs.append(f"{nm}: example needs exactly one *form*: {e.get('en')}")
    return errs

entries, search, failed = [], [], 0
for f in sorted(DATA.rglob("*.json")):
    rel = f.relative_to(DATA)
    if rel.name in SKIP and len(rel.parts) == 1: continue
    try:
        d = json.loads(f.read_text(encoding="utf-8-sig"))   # utf-8-sig: tolerate a BOM
        errs = check(d)
    except Exception as e:
        errs = [f"invalid JSON ({e})"]
    if errs:
        failed += 1
        for m in errs: print(f"::error file=data/{rel.as_posix()}::{m}")
        continue
    lid = re.sub(r"[^A-Za-z0-9_-]+", "_", "__".join(rel.with_suffix("").parts))
    for i, w in enumerate(d["words"]):
        search.append({"w": w["w"], "pos": w["pos"], "ar": w["ar"], "def": strip(w.get("def")), "l": lid, "i": i,
                       "c": [[strip(c.get("p")), c.get("p_ar", "")] for c in w.get("col", [])]})
    group, st, part, title = meta(rel, d)
    entries.append({"id": lid, "file": rel.as_posix(), "title": title,
                    "group": group, "set": st, "part": part, "source": d.get("source", ""),
                    "count": len(d["words"]), "texts": len(d.get("texts", []))})

(DATA / "index.json").write_text(json.dumps(entries, ensure_ascii=False, indent=1), encoding="utf-8")
(DATA / "search.json").write_text(json.dumps(search, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"index.json: {len(entries)} lists; search.json: {len(search)} words; skipped {failed} invalid file(s)")
sys.exit(1 if failed else 0)
