# Give an add-on's prebuilt structures a stone foundation so they stop floating on slopes.
#
# For every .mcstructure: add K layers underneath; columns that carry something solid in the
# structure's bottom two layers get filled with stone / cobble / mossy cobble / andesite, the rest
# stays air. Indices, waterlog layer, block entity data and the recorded world origin are remapped
# so the content above is untouched. The matching feature rule's Y offset is lowered by K, so the
# original floor lands at the same height as before and the new foundation sinks into the hill.
#
#   python3 foundation.py <behavior_pack_dir> [--depth 5] [--dry]
import sys, os, json, re, random, collections, copy
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mcstructure import load, dump
FOUNDATION = [(0.60, "minecraft:stone"), (0.25, "minecraft:cobblestone"), (0.10, "minecraft:mossy_cobblestone"), (0.05, "minecraft:andesite")]
AIR = {"minecraft:air", "minecraft:structure_void"}

def strip_json(t):
    t = re.sub(r"/\*.*?\*/", "", t, flags=re.S); t = re.sub(r"//[^\n]*", "", t); return t

def add_foundation(path, K, dry):
    name, root = load(path); R = root[1]
    size = [v[1] for v in R["size"][2]]; X, Y, Z = size
    st = R["structure"][1]; layers = st["block_indices"][2]
    pal_entries = st["palette"][1]["default"][1]["block_palette"][2]
    names = [e[1]["name"][1] for e in pal_entries]
    l0 = [v[1] for v in layers[0][2]]
    if len(l0) != X * Y * Z: raise ValueError("index count mismatch")
    idx = lambda x, y, z: (x * Y + y) * Z + z
    # footprint: columns with something solid in the bottom two layers
    footprint = set()
    for x in range(X):
        for z in range(Z):
            for y in range(min(2, Y)):
                i = l0[idx(x, y, z)]
                if 0 <= i < len(names) and names[i] not in AIR: footprint.add((x, z)); break
    if not footprint: return None
    rng = random.Random(os.path.basename(path) + "foundation")
    version = pal_entries[0][1]["version"] if pal_entries else ("i", 0)
    air_i = next((i for i, n in enumerate(names) if n == "minecraft:air"), None)
    if air_i is None:
        pal_entries.append(("comp", collections.OrderedDict([("name", ("str", "minecraft:air")), ("states", ("comp", collections.OrderedDict())), ("version", version)]))); air_i = len(pal_entries) - 1
    found_i = {}
    for _, bn in FOUNDATION:
        pal_entries.append(("comp", collections.OrderedDict([("name", ("str", bn)), ("states", ("comp", collections.OrderedDict())), ("version", version)]))); found_i[bn] = len(pal_entries) - 1
    def pick():
        r = rng.random(); acc = 0
        for share, bn in FOUNDATION:
            acc += share
            if r < acc: return found_i[bn]
        return found_i["minecraft:stone"]
    NY = Y + K
    nidx = lambda x, y, z: (x * NY + y) * Z + z
    new_layers = []
    for li, layer in enumerate(layers):
        old = [v[1] for v in layer[2]]
        new = [-1] * (X * NY * Z)
        for x in range(X):
            for z in range(Z):
                for y in range(Y): new[nidx(x, y + K, z)] = old[idx(x, y, z)]
                for y in range(K):
                    new[nidx(x, y, z)] = (pick() if (x, z) in footprint else air_i) if li == 0 else -1
        new_layers.append(("list", layer[1], [("i", v) for v in new]))
    # block entity / extra data keyed by flat index
    bpd = st["palette"][1]["default"][1].get("block_position_data")
    if bpd:
        remapped = collections.OrderedDict()
        for k, v in bpd[1].items():
            i = int(k); x = i // (Y * Z); y = (i // Z) % Y; z = i % Z
            remapped[str(nidx(x, y + K, z))] = v
        st["palette"][1]["default"][1]["block_position_data"] = ("comp", remapped)
    if not dry:
        st["block_indices"] = ("list", layers[0][1] if False else st["block_indices"][1], new_layers)
        R["size"] = ("list", R["size"][1], [("i", X), ("i", NY), ("i", Z)])
        if "structure_world_origin" in R:
            o = [v[1] for v in R["structure_world_origin"][2]]
            R["structure_world_origin"] = ("list", R["structure_world_origin"][1], [("i", o[0]), ("i", o[1] - K), ("i", o[2])])
        dump(path, name, root)
        # round-trip check: the original content must sit exactly K higher
        _, r2 = load(path); l2 = [v[1] for v in r2[1]["structure"][1]["block_indices"][2][0][2]]
        for x in range(X):
            for z in range(Z):
                for y in range(Y):
                    assert l2[nidx(x, y + K, z)] == l0[idx(x, y, z)], "round-trip mismatch"
    return len(footprint)

def lower_feature_rules(pack, structure_names, K, dry):
    """Lower the Y offset of every feature rule whose feature places one of the modified structures."""
    feat_to_struct = {}
    for f in glob_json(os.path.join(pack, "features")):
        try: j = json.loads(strip_json(open(f, encoding="utf-8-sig").read()))
        except Exception: continue
        tf = j.get("minecraft:structure_template_feature")
        if tf and tf.get("structure_name") in structure_names:
            feat_to_struct[tf["description"]["identifier"]] = tf["structure_name"]
    changed = 0
    for f in glob_json(os.path.join(pack, "feature_rules")):
        try: j = json.loads(strip_json(open(f, encoding="utf-8-sig").read()))
        except Exception: continue
        fr = j.get("minecraft:feature_rules");
        if not fr or fr["description"].get("places_feature") not in feat_to_struct: continue
        dist = fr.get("distribution", {}); y = dist.get("y")
        if isinstance(y, str): dist["y"] = f"({y}) - {K}"
        elif isinstance(y, (int, float)): dist["y"] = y - K
        else: print("   skip y offset (unusual form):", os.path.basename(f)); continue
        if not dry: json.dump(j, open(f, "w"), indent=2)
        changed += 1
    return changed, len(feat_to_struct)


def _feats(pack):
    feats = {}
    for f in glob_json(os.path.join(pack, "features")):
        try: j = json.loads(strip_json(open(f, encoding="utf-8-sig").read()))
        except Exception: continue
        k = next((k for k in j if k.startswith("minecraft:")), None)
        if k: feats[j[k]["description"]["identifier"]] = (k, j[k])
    return feats

def _children(k, d):
    if k == "minecraft:scatter_feature": return [d.get("places_feature")]
    if k in ("minecraft:aggregate_feature", "minecraft:sequence_feature"): return list(d.get("features", []))
    if k == "minecraft:weighted_random_feature": return [x[0] for x in d.get("features", [])]
    if k == "minecraft:conditional_list": return [x.get("places_feature") for x in d.get("conditional_features", [])]
    if k == "minecraft:search_feature": return [d.get("places_feature")]
    if k == "minecraft:snap_to_surface_feature": return [d.get("feature_to_snap")]
    if k == "minecraft:surface_relative_threshold_feature": return [d.get("feature_to_place")]
    return []

def _leaves(feats, fid, seen=()):
    if fid not in feats or fid in seen: return set()
    k, d = feats[fid]
    if k == "minecraft:structure_template_feature": return {d.get("structure_name")}
    out = set()
    for c in _children(k, d): out |= _leaves(feats, c, seen + (fid,))
    return out

def surface_structures(pack):
    """Structures placed by a feature rule whose Y is a heightmap expression (a string)."""
    feats = _feats(pack); surface = set(); rule_files = []
    for f in glob_json(os.path.join(pack, "feature_rules")):
        try: fr = json.loads(strip_json(open(f, encoding="utf-8-sig").read()))["minecraft:feature_rules"]
        except Exception: continue
        y = fr.get("distribution", {}).get("y")
        ls = _leaves(feats, fr["description"].get("places_feature"))
        if ls and isinstance(y, str): surface |= ls; rule_files.append(f)
    return surface, rule_files

def lower_rules(rule_files, K, dry):
    n = 0
    for f in rule_files:
        j = json.loads(strip_json(open(f, encoding="utf-8-sig").read()))
        dist = j["minecraft:feature_rules"]["distribution"]; dist["y"] = f"({dist['y']}) - {K}"
        if not dry: json.dump(j, open(f, "w"), indent=2)
        n += 1
    return n

def glob_json(d):
    out = []
    for rt, _, fs in os.walk(d):
        out += [os.path.join(rt, f) for f in fs if f.endswith(".json")]
    return out

if __name__ == "__main__":
    pack = sys.argv[1]; K = int(sys.argv[sys.argv.index("--depth") + 1]) if "--depth" in sys.argv else 5; dry = "--dry" in sys.argv
    surface, rule_files = surface_structures(pack)
    print(f"surface-placed structures (rules with a heightmap Y): {len(surface)}; underground or script-placed ones are left alone")
    sdir = os.path.join(pack, "structures"); done = {}; skipped = []
    for rt, _, fs in os.walk(sdir):
        for f in sorted(fs):
            if not f.endswith(".mcstructure"): continue
            p = os.path.join(rt, f); rel = os.path.relpath(p, sdir)[:-len(".mcstructure")]
            sname = "mystructure:" + rel if "/" not in rel else rel.replace("/", ":", 1)
            if sname not in surface: continue
            try:
                n = add_foundation(p, K, dry)
                if n: done[sname] = n
            except Exception as e: skipped.append((f, str(e)[:60]))
    rules = lower_rules(rule_files, K, dry)
    print(("DRY RUN: " if dry else "APPLIED: ") + f"{len(done)} structures got a {K}-deep foundation, {len(skipped)} skipped; {rules} feature rules lowered by {K}")
    for f, e in skipped[:6]: print("   skipped", f, e)
