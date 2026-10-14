# Playground HUD

A resource pack holding ONE `ui/hud_screen.json` that carries the HUD modifications of Origins BE, A Magic Way, Roll and Stamina, WAILA and Durability Armor Viewer, so none of them loses when they are installed together (the game loads only one hud_screen.json: the highest-priority pack's). Their own screens, textures and scripts stay in their own packs; this pack must sit at the top of the world's resource pack list.

Rebuild after any of those add-ons updates its HUD: re-run the merge (see the session notes) and `python3 mods/build.py "Playground HUD"`.
