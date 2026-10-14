# Structure weathering pass

Makes an add-on's prebuilt structures look lived-in: a share of clean blocks become worn, mossy,
cracked or carved variants (quartz -> calcite / diorite / chiseled, stone -> cobble / mossy cobble /
andesite, stone bricks -> mossy / cracked, sandstone -> carved / cut, and so on; see `RULES` in
`weather.py`). Deterministic per file, so re-running changes nothing new.

    python3 weather.py <behavior_pack>/structures --dry   # preview counts
    python3 weather.py <behavior_pack>/structures         # apply in place (back the folder up first)
    python3 mcstructure.py stats <behavior_pack>/structures   # block usage per pack

Only newly generated structures pick up the change; existing ones in a world stay as they were.
Reinstalling the add-on restores its original files. Verified in-game with `/structure load` on
Mythological Craft 2.6.3 and Bedrock 1.26.52 (2026-10-14).

## Foundations (stop floating builds)

    python3 foundation.py <behavior_pack_dir> --depth 5 [--dry]

Adds 5 layers of stone/cobble/mossy/andesite under every structure that a feature rule places at the
surface (heightmap Y), and lowers that rule's Y by the same amount, so the floor lands where it did
before and the new base sinks into slopes instead of leaving air underneath. Underground and
script-placed structures are left alone. Applied to Mythological Craft 2.6.3 on 2026-10-14
(20 structures, 19 rules); verified with `/structure load` on the clone.
