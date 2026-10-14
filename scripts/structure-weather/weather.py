# Weathering pass for Bedrock .mcstructure files: swap a share of "clean" blocks for worn, mossy,
# cracked or carved variants so prebuilt structures look lived-in. Deterministic per file.
import sys, os, random, collections, copy
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mcstructure import load, dump, palette
S = lambda **kw: ("comp", collections.OrderedDict((k, ("str", v)) for k, v in kw.items()))
# original block name -> list of (share, new name or None for same name, state overrides or None)
RULES = {
    "minecraft:quartz_block":  [(0.08, "minecraft:chiseled_quartz_block", "keep"), (0.10, "minecraft:calcite", {}), (0.05, "minecraft:diorite", {}), (0.02, "minecraft:polished_diorite", {})],
    "minecraft:smooth_quartz": [(0.10, "minecraft:calcite", {}), (0.06, "minecraft:quartz_bricks", {}), (0.04, "minecraft:diorite", {})],
    "minecraft:quartz_bricks": [(0.10, "minecraft:calcite", {}), (0.05, "minecraft:diorite", {})],
    "minecraft:quartz_pillar": [(0.08, "minecraft:chiseled_quartz_block", "keep")],
    "minecraft:stone":         [(0.10, "minecraft:cobblestone", {}), (0.06, "minecraft:mossy_cobblestone", {}), (0.04, "minecraft:andesite", {})],
    "minecraft:cobblestone":   [(0.15, "minecraft:mossy_cobblestone", {})],
    "minecraft:stonebrick":    [(0.12, None, {"stone_brick_type": "mossy"}), (0.10, None, {"stone_brick_type": "cracked"})],
    "minecraft:sandstone":     [(0.08, None, {"sand_stone_type": "heiroglyphs"}), (0.08, None, {"sand_stone_type": "cut"})],
    "minecraft:polished_basalt": [(0.10, "minecraft:basalt", "keep")],
    "minecraft:deepslate_bricks": [(0.12, "minecraft:cracked_deepslate_bricks", {})],
    "minecraft:polished_blackstone_bricks": [(0.12, "minecraft:cracked_polished_blackstone_bricks", {})],
}
def weather_file(path, dry=False):
    name, root = load(path)
    pal, st = palette(root)
    entries = st["palette"][1]["default"][1]["block_palette"][2]
    layer = st["block_indices"][2][0][2]            # ("i", idx) list, layer 0 = blocks
    version = entries[0][1]["version"] if entries else ("i", 0)
    rng = random.Random(os.path.basename(path))
    by_name = collections.defaultdict(list)
    for i, (n, _) in enumerate(pal): by_name[n].append(i)
    changed = collections.Counter(); cache = {}
    def variant_index(src_entry, new_name, states):
        key = (new_name, repr(states))
        if key in cache: return cache[key]
        e = copy.deepcopy(src_entry)
        if new_name: e[1]["name"] = ("str", new_name)
        if states == "keep": pass
        elif states: 
            for k, v in states.items(): e[1].setdefault("states", ("comp", collections.OrderedDict()))[1][k] = ("str", v)
        else: e[1]["states"] = ("comp", collections.OrderedDict())
        e[1]["version"] = version
        entries.append(e); cache[key] = len(entries) - 1; return cache[key]
    for pos, (_, idx) in enumerate(layer):
        if idx < 0 or idx >= len(pal): continue
        n = pal[idx][0]
        rules = RULES.get(n)
        if not rules: continue
        r = rng.random(); acc = 0.0
        for share, new_name, states in rules:
            acc += share
            if r < acc:
                if not dry:
                    layer[pos] = ("i", variant_index(entries[idx], new_name, states))
                changed[(n, new_name or n + "*")] += 1
                break
    if not dry and changed: dump(path, name, root)
    return changed
if __name__ == "__main__":
    d = sys.argv[1]; dry = "--dry" in sys.argv
    total = collections.Counter(); files = 0; skipped = 0
    for rt, _, fs in os.walk(d):
        for f in sorted(fs):
            if not f.endswith(".mcstructure"): continue
            try: c = weather_file(os.path.join(rt, f), dry); files += 1; total.update(c)
            except Exception as e: skipped += 1
    print(("DRY RUN: " if dry else "APPLIED: ") + f"{files} structures, {skipped} skipped, {sum(total.values())} blocks changed")
    for (a, b), c in total.most_common(14): print(f"   {a:34s} -> {b:40s} {c}")
