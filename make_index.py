#!/usr/bin/env python3
"""Scans data/*.json and writes data/index.json (run locally or by the GitHub Action).
Lists are flat files (data/unit1.json, data/unit2.json ...). An optional "group" field in a file groups lists on the home page."""
import json, re, sys, pathlib
DATA = pathlib.Path(__file__).parent / "data"
entries, errs = [], []
for f in sorted(DATA.glob("*.json")):
    rel = f.relative_to(DATA)
    if rel.name == "index.json" and len(rel.parts) == 1: continue
    try: d = json.loads(f.read_text(encoding="utf-8"))
    except Exception as e: errs.append(f"{rel}: invalid JSON ({e})"); continue
    for i, w in enumerate(d.get("words", [])):
        nm = f"{rel}: word {i+1} ({w.get('w','?')})"
        for k in ("w", "pos", "def", "ar", "emoji"):
            if not w.get(k): errs.append(f"{nm}: missing '{k}'")
        for c in w.get("col", []):
            if c.get("p", "").count("*") != 2: errs.append(f"{nm}: col '{c.get('p')}' needs exactly one *form*")
            if c.get("en") and c["en"].count("*") != 2: errs.append(f"{nm}: col example for '{c.get('p')}' needs exactly one *form*")
        for e in w.get("ex", []):
            if e.get("en", "").count("*") != 2: errs.append(f"{nm}: ex needs exactly one *form*: {e.get('en')}")
    if not d.get("words"): errs.append(f"{rel}: no words")
    entries.append({"id": re.sub(r"[^A-Za-z0-9_-]+", "_", "__".join(rel.with_suffix("").parts)),
                    "file": rel.as_posix(), "title": d.get("title") or rel.stem,
                    "group": d.get("group", ""), "count": len(d.get("words", [])), "texts": len(d.get("texts", []))})
if errs: print("\n".join(errs)); sys.exit(1)
(DATA / "index.json").write_text(json.dumps(entries, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"index.json: {len(entries)} lists")
