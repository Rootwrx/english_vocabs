# python make_catalog.py reverso_french_vocab   ->  writes catalog.json (move it to data/catalog.json)
import json, pathlib, sys
root = pathlib.Path(sys.argv[1]); out = []
for g in sorted(p for p in root.iterdir() if p.is_dir()):
    out.append({"group": g.name, "sets": sorted(f.stem for f in g.glob("*.txt"))})
json.dump(out, open("catalog.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"catalog.json: {len(out)} categories, {sum(len(c['sets']) for c in out)} topics")
