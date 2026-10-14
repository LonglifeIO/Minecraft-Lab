# Admin / test mode: fly, no damage, no hunger. Back to normal play with /function admin/off
gamemode creative @s
effect @s clear
tellraw @s {"rawtext":[{"text":"§6Admin mode on§r: creative (fly, no damage, no hunger). §7/function admin/off§r to play normally again."}]}
