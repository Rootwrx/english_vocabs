#!/usr/bin/env python3
"""Scans data/**/*.json and writes data/index.json and data/search.json (run locally or by the GitHub Action).
Lists can be flat files (data/unit1.json) or live in subfolders (data/by_level/Basic Vocabulary (A1A2)/part1.json).
The folders are only for organising: the group / set / part fields inside each file decide where it shows on the home page.
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
    entries.append({"id": lid, "file": rel.as_posix(), "title": d.get("title") or rel.stem,
                    "group": d.get("group", ""), "set": d.get("set", ""), "part": d.get("part", 0), "count": len(d["words"]), "texts": len(d.get("texts", []))})

(DATA / "index.json").write_text(json.dumps(entries, ensure_ascii=False, indent=1), encoding="utf-8")
(DATA / "search.json").write_text(json.dumps(search, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"index.json: {len(entries)} lists; search.json: {len(search)} words; skipped {failed} invalid file(s)")
sys.exit(1 if failed else 0)
