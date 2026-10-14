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
