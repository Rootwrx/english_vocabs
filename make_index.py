#!/usr/bin/env python3
"""Scans data/*.json and writes data/index.json and data/search.json (run locally or by the GitHub Action).
Lists are flat files (data/unit1.json, data/unit2.json ...). An optional "group" field in a file groups lists on the home page.
search.json = one compact entry per word: w, pos, ar, def, l (list id), i (word index), c (collocations [[phrase, arabic], ...])."""
import json, re, sys, pathlib
DATA = pathlib.Path(__file__).parent / "data"
SKIP = {"index.json", "search.json"}
entries, search, errs = [], [], []
strip = lambda s: (s or "").replace("*", "")
for f in sorted(DATA.glob("*.json")):
    rel = f.relative_to(DATA)
    if rel.name in SKIP and len(rel.parts) == 1: continue
    try: d = json.loads(f.read_text(encoding="utf-8"))
    except Exception as e: errs.append(f"{rel}: invalid JSON ({e})"); continue
    lid = re.sub(r"[^A-Za-z0-9_-]+", "_", "__".join(rel.with_suffix("").parts))
    for i, w in enumerate(d.get("words", [])):
        nm = f"{rel}: word {i+1} ({w.get('w','?')})"
        for k in ("w", "pos", "def", "ar", "emoji"):
            if not w.get(k): errs.append(f"{nm}: missing '{k}'")
        for c in w.get("col", []):
            if c.get("p", "").count("*") != 2: errs.append(f"{nm}: col '{c.get('p')}' needs exactly one *form*")
            if c.get("en") and c["en"].count("*") != 2: errs.append(f"{nm}: col example for '{c.get('p')}' needs exactly one *form*")
        for e in w.get("ex", []):
            if e.get("en", "").count("*") != 2: errs.append(f"{nm}: ex needs exactly one *form*: {e.get('en')}")
        search.append({"w": w.get("w", ""), "pos": w.get("pos", ""), "ar": w.get("ar", ""), "def": strip(w.get("def")),
                       "l": lid, "i": i, "c": [[strip(c.get("p")), c.get("p_ar", "")] for c in w.get("col", [])]})
    if not d.get("words"): errs.append(f"{rel}: no words")
    entries.append({"id": lid, "file": rel.as_posix(), "title": d.get("title") or rel.stem,
                    "group": d.get("group", ""), "count": len(d.get("words", [])), "texts": len(d.get("texts", []))})
if errs: print("\n".join(errs)); sys.exit(1)
(DATA / "index.json").write_text(json.dumps(entries, ensure_ascii=False, indent=1), encoding="utf-8")
(DATA / "search.json").write_text(json.dumps(search, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"index.json: {len(entries)} lists; search.json: {len(search)} words")
