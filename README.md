# Golden Valley — Gold Mining Simulator

A stylized 3D gold mining sim that runs in your browser. Peaceful by day, under siege by night.

## Play

**Play in your browser: <https://crudetree.github.io/gold-mining-sim/>** — no install needed. Saves live in
your browser, so everyone gets their own.

Every push to `main` rebuilds and redeploys the site automatically (GitHub Actions → Pages).

### Run locally

Double-click `start.bat`. The first run installs dependencies; after that it opens the game in your browser.

(Or from a terminal: `npm install` once, then `npm run dev`.)

## Controls

| Key | Action |
| --- | --- |
| WASD | Move (Shift to run) |
| Mouse | Aim · wheel to zoom |
| LMB | Use tool: dig / pan / place torch / swing sword / place turret |
| 1 – 8 | Shovel / Gold pan / Torch / Sword / Turret / Axe / Detector / Command |
| TAB | Phone: shop, sell gold, stats, save & load |
| E | Enter or exit vehicles, collect gold at the wash plant |
| F | Dump paydirt into the truck or wash plant hopper (or on the ground) |
| C | Tow cable: hook / connect / release |
| B | Build mode for conveyors (1 belt / 2 hopper, R rotate, LMB place, RMB remove) |
| Esc | Pause menu and controls |

## How gold works

Gold concentrates in the gravel just above **bedrock**, and bedrock depth varies across the valley
(it is shallow under the streams). Topsoil is worthless. Strip it off, dump it aside, then get the
grey-gold gravel into the truck and into the wash plant hopper — or pan it by hand while standing
in the stream. Rain speeds up the wash plant.

**Nuggets.** Rich ground near bedrock sometimes coughs up a solid nugget when you dig it (by hand or
by machine). It pops out onto the ground with a glow — walk over it, or drive over it, and it goes
straight into your gold on hand, no washing needed. Most are a gram or two; a few are monsters. The
Stats tab on your phone tracks how many you've found and your biggest.

## Surviving the night

Skeletons come out after **20:30** and crumble at dawn. Each night the wave grows: swordsmen first,
then archers, and from night 3 brutes. They attack you, your turrets, and the wash plant — if they
reach the sluice they steal gold and eventually wreck the plant (repair it from your phone).

- The moon runs an 8-night cycle (shown in the HUD next to the day). Full-moon nights are lit by a soft blue glow with moon shadows; new-moon nights are pitch black beyond your torches. Heavy cloud and thunderstorms blot the moon out, but lightning lights up the whole valley for a moment.
- You start with a rusty sword (slot 4). Upgrade it on your phone.
- Buy **auto turrets** on your phone and place them with slot 5. They repair themselves by day.
- Vehicles flatten skeletons at speed.
- Getting knocked out sends you back to the tent, minus your bucket and 10% of your gold on hand.

## Machines

- **Excavator** — precise digging with mouse aim. The bucket holds exactly **one scoop**: dig, swing the arm over the truck bed (or hopper), press F, repeat. The bucket upgrade makes each scoop bigger.
- **Metal detector** (buy on phone, slot 7) — hold it out and the ground around the coil turns see-through, showing the gold sitting on bedrock as glowing veins (denser and brighter = richer; darker ground = deeper overburden). Hold LMB to sweep wider and faster. Everything you've scanned stays revealed and is saved, so you build up an underground map over time.
- **Axe** (buy on phone, slot 6) — three swings fells a tree for 3 logs (sell on the phone) and clears the ground for digging or turrets.
- **Dump truck** — hauls 40 m³ to the wash plant.
- **Front-end loader** (buy on phone) — fast wheeled scooper: drive into the dirt, LMB to scoop, F to tip into the truck or hopper.
- **Bulldozer** (buy on phone) — sitting in it opens the **Earthworks** panel: **1** raise, **2** lower, **3** flatten, **[ ]** brush size. Aim within ~18 m and hold LMB to sculpt. Flatten locks its target height where you first click, so click on the level you want and paint across. Every cubic metre moved is billed ($14 raise, $6 lower, $9 flatten) and stops when you're out of cash. Sculpted fill is barren topsoil and lowered ground is hauled away without collecting its gold, so it's for roads, ramps out of pits, and bridging streams — not for manufacturing paydirt.
- **Tow cable** (buy on phone) — press **C** beside a vehicle to hook it, walk to another vehicle and press C to connect, then drive that one: once the 9 m cable goes taut it drags the stuck machine along (C releases it, on foot or from the seat).

Vehicles never freeze up completely: steep climbs and deep water just slow them down, and moving toward shallower ground is always allowed. The dozer and cable are for when "slow" isn't good enough.

## Conveyors

The world has an invisible 2 m grid. Press **B** (on foot) to open build mode: the grid shows around your cursor
and a ghost snaps to it.

- **Belts** come in packs of 10 ($450). Hold LMB and drag to lay a line — each belt points the way you dragged
  and the belt behind you turns to follow, so corners become curves automatically (a belt fed from the side
  and not from behind renders as a 90° curve). Placing belts one at a time works too: the ghost previews
  the curve it will become, and dropping a belt beside the dead end of a line turns that end to meet it.
  **R** rotates the ghost, or the belt under the cursor. **RMB** picks a piece back up into your inventory.
- **Belt hopper** ($900) — a bin vehicles dump into (truck bed, excavator or loader bucket, or your own
  bucket with F). It drips 0.5 m³ lumps onto the belt in front of it and holds 30 m³.
- Any belt whose next cell is the wash plant hopper pours into it. A belt that ends nowhere just backs up —
  nothing is lost in transit, and every lump carries its own gold.
- Belts can't go in water or on very steep ground, but they tilt to follow hills. Use the dozer to flatten a
  route or bridge a stream. Ground under belts can't be dug.
- Belts have no collision, so trucks drive straight over them. Hoppers are solid.

## Buildings

Buildings go on the same grid as the belts (build mode, **B**). Their footprint blocks belts and digging.

- **Inn** ($2,500, 6×6 m, tool **3**) — the ground under it has to be fairly level (dozer-flatten if not).
  Stand at the door from **19:30** (or before 05:00) and press **E** to sleep until **06:00**. The night's
  raid still comes, but it's settled as a **dice battle** (below) instead of in real time; afterwards the
  clock fast-forwards and you wake fully healed with a report. You can't turn in with skeletons within 30 m
  of the inn, and **E** gets you up early. Remove it with RMB in build mode to move it.
- **Barracks** ($3,000, 6×6 m, tool **4**) — unlocks **mercenaries** on the phone (Buildings tab), paid in
  gold (2.5 g each, up to 8). They loiter around the yard by day, heal up, and charge any skeleton that
  comes within earshot — while you're awake they fight for real alongside your turrets, and skeletons fight
  back. **Mercenary Drill** (phone upgrade) makes them hit harder and adds +1 to their battle rolls per level.

- **Church** ($3,500, 6×6 m, tool **5**) — the blessed ground around it (14 m, shown as a soft glowing disc)
  heals **you and your mercenaries** at 9 hp/s, and unlike normal regen it keeps working while you're being
  hit — so fall back to it mid-fight. Skeletons and everything else get nothing. Hurt soldiers with no orders
  walk over on their own and return to their post once they're patched up.

### Commanding mercenaries (hotbar 8)

Owning a Barracks unlocks the **Command** standard in slot **8**. With it out, the game plays like an RTS:

| Input | Effect |
| --- | --- |
| LMB on a soldier | Select (Shift adds/removes; double-click selects everyone) |
| LMB drag | Box-select |
| RMB on ground | Move there — the squad spreads into a formation and then holds that spot |
| RMB on a skeleton | Attack it |
| M / Z + click | Move / Patrol between where they stand and the click |
| X | Stand ground where they are |
| H | Back to the barracks (default guard duty) |

Soldiers on orders are *defensive*: they only break off for skeletons close to them or their post, then go
back. Guards at the barracks range wider. Orders survive saving, and a unit that gets boxed in by rocks or
machines sidesteps, then settles for where it is.

## The night battle (sleeping at the inn)

Your defenders line up on the left — mercenaries first, then turrets — and the horde on the right, in the
order they'd have spawned (swordsmen, archers, brutes). Each round the front unit of each side rolls a d6
plus its bonuses; the loser's unit is destroyed and the next one steps up. **Ties go to the defender.** The
fight ends when one side is wiped out. Space skips the animation.

Bonuses stack on top of the die:

- **Unique units** (Age of Imperialism rule): every unit gets +1 for each *other* unit type standing on its
  side. Mercs + turrets = +1 for everyone; the moment your last turret falls the mercs lose it. The horde
  gets the same from mixing swordsmen, archers and brutes.
- **Type modifiers**: turrets +1, brutes +1 (golems will be +2). Mercenary Drill adds +1 per level to mercs;
  Turret Ammo level 2 adds +1 to turrets.
- **Situational**: 4+ placed torches give you "Well-lit camp" +1; a Steel sword +1. A moonless night, a
  thunderstorm or fog gives the horde +1.

Win and every skeleton pays its bounty as if you'd killed it. Lose and the survivors run loose: they loot
whatever gold is sitting in the sluice, wreck the wash plant, and if three or more are still standing they
sabotage one of your machines — it sits there smoking and won't drive until you buy **Repair Wrecked
Machines** ($600) on the phone. Sleep with nobody on guard and the raid is an automatic loss.


## Project layout

- `src/terrain.js` — deformable heightmap, bedrock field, gold richness, digging/piling
- `src/world.js` — trees, rocks, flowers, camp
- `src/player.js`, `src/vehicles.js`, `src/washplant.js` — the things you control and use
- `src/enemies.js`, `src/turrets.js` — skeleton waves, arrows, auto turrets
- `src/weather.js`, `src/daynight.js` — weather states, rain, lightning, sun/moon, sky, lighting
- `src/conveyors.js` — grid, belts, curves, belt hoppers, lump flow, build mode
- `src/buildings.js` — grid-placed buildings (Inn, Barracks)
- `src/mercs.js` — hired swordsmen: guard, follow orders, fight, take damage
- `src/command.js` — RTS controls for mercenaries: selection, box-select, move/patrol/attack orders
- `src/battle.js` — the Risk-style dice battle fought while you sleep
- `src/ui.js` — HUD and the phone
- `src/main.js` — game loop, interactions, combat, economy, save/load
