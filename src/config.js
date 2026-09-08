export const CONFIG = {
  dayLengthMinutes: 14,      // real minutes per in-game day
  startHour: 8,
  goldPrice: 65,             // $ per gram
  woodPrice: 10,             // $ per log
  detector: { radius: 4.2, sweepRadius: 5.5, rate: 0.5, sweepRate: 1.1, coilForward: 1.7 },
  treeHits: 3,               // axe swings to fell a tree
  logsPerTree: 3,
  startMoney: 250,
  startTorches: 6,
  maxTorchLights: 10,

  player: {
    speed: 6.2,
    sprintMul: 1.55,
    reach: 2.7,
    digInterval: 0.55,
    digRadius: 1.05,
    digAmount: 0.32,
    carryCap: [3, 5, 8],
    panTime: 3.0,
    panTake: 0.3,
    panEfficiency: 0.9,
  },

  truck: { capacity: 40, maxSpeed: 10, accel: 7, turnRate: 1.5 },

  excavator: {
    // The bucket holds exactly one scoop; upgrades make each scoop bigger.
    digRadius: [1.9, 2.3, 2.7],
    digAmount: [0.55, 0.65, 0.75],
    cycleTime: 1.7,
    maxSpeed: 4.5,
    accel: 5,
    turnRate: 1.3,
    minReach: 2.4,
    maxReach: 6.0,
  },

  loader: {
    capacity: 10,
    digRadius: 2.0,
    digAmount: 0.5,
    cycleTime: 1.4,
    dumpTime: 1.8,
    maxSpeed: 7.5,
    accel: 6,
    turnRate: 1.5,
  },

  dozer: {
    maxSpeed: 4.2,
    accel: 5,
    turnRate: 1.4,
  },

  // Earthworks brush (available from the bulldozer seat). Every cubic metre moved costs money so
  // sculpting land is a tool, not a gold farm: fill is barren topsoil and cut material is hauled away.
  terraform: {
    range: 18,                    // how far from the dozer you can work
    radius: [1.6, 2.6, 3.8, 5.2], // brush sizes
    rate: 1.1,                    // metres of height change per second at the brush centre
    fillCap: 6,                   // metres above the original surface you can build up
    cost: { raise: 14, lower: 6, flatten: 9 }, // $ per m³ moved
  },

  tow: { length: 9, pullSpeedMul: 0.7 },

  conveyor: {
    speed: 1.6,          // m/s along the belt
    lumpVol: 0.5,        // m³ per lump
    spacing: 0.3,        // min gap between lumps, in belt-lengths (0.6 m on a 2 m belt)
    hopperCapacity: 30,  // m³ a belt hopper holds
    intakeRadius: 3.4,   // a belt ending this close to the wash plant hopper feeds it
    maxSlope: 2.0,       // max height difference across a cell (≈45°); belts tilt to follow hills
    buildRange: 16,
    maxLumps: 1200,
    beltPack: 10,
  },

  buildings: {
    inn: { name: 'Inn', size: 3, maxRise: 1.2, ghostHeight: 4.5 },
    barracks: { name: 'Barracks', size: 3, maxRise: 1.2, ghostHeight: 4.0 },
    church: { name: 'Church', size: 3, maxRise: 1.2, ghostHeight: 7.5 },
  },

  church: {
    radius: 14,       // blessed ground: friendly units inside heal
    healRate: 9,      // hp/s for the player and mercenaries (mercs have 70 hp, you have 100)
    seekBelow: 0.4,   // idle mercs this hurt walk to the church on their own…
    seekUntil: 0.95,  // …and go back to their post once this healthy
  },

  mercs: {
    hp: 70, dmg: 12, speed: 4.2, attackInterval: 1.0, range: 1.9, radius: 0.45,
    wander: 8,        // how far they stroll from the barracks
    alert: 22,        // spot skeletons this far from the barracks (or 14 m from themselves)
    leash: 40,        // never chase further than this from home
    max: 8,
    goldPrice: 2.5,   // grams of gold per recruit
    healRate: 6,      // hp/s at the barracks by day
  },

  battle: {
    // roll modifier by unit type (on top of the unique-unit bonus)
    unitBonus: { merc: 0, turret: 1, sword: 0, archer: 0, brute: 1, golem: 2 },
    torchesForBuff: 4,   // this many placed torches: "Well-lit camp" +1
    wreckSurvivors: 3,   // enemies left standing to also sabotage a machine
    rollMs: 950,         // ms per dice round in the UI
  },

  inn: {
    sleepFrom: 19.5,   // can turn in from 19:30…
    sleepUntil: 5,     // …or any time before 05:00
    wakeHour: 6,       // morning
    dangerRadius: 30,  // skeletons this close to the inn keep you awake
    speed: 40,         // simulation steps per frame while asleep (~120× time)
  },

  nuggets: {
    minRichness: 0.35,   // g/m³ below which nuggets never form
    baseChance: 0.06,    // × richness × sqrt(volume) per dig
    bedrockBonus: 0.07,  // flat extra chance when the dig scrapes bedrock
    maxGrams: 31,
    bigGrams: 8,         // "monster" threshold for the celebration
  },

  washPlant: { capacity: 80, rate: [2.0, 3.5, 6.0], efficiency: 0.95, hp: 500, repairCost: 500 },

  combat: {
    playerHp: 100,
    regenDay: 3,
    regenNight: 0.6,
    regenDelay: 4,
    swordDamage: [25, 45, 70],
    swordRange: 2.2,
    swordArc: 1.25,          // half-angle in radians
    swordCooldown: 0.45,
    knockoutSeconds: 4,
    vehicleHitDamage: 45,
    nightStart: 20.5,        // skeletons start spawning
    spawnEnd: 4.5,           // no new spawns after this
    dawn: 6.0,               // remaining skeletons crumble
    waveBase: 4,
    wavePerNight: 3,
    waveMax: 40,
    bounty: { sword: 8, archer: 10, brute: 30 },
  },

  enemies: {
    sword: { hp: 40, speed: 3.4, dmg: 7, attackInterval: 1.4, range: 1.8, scale: 1.0 },
    archer: { hp: 30, speed: 3.0, dmg: 7, attackInterval: 2.6, range: 15, keepDist: 9, scale: 0.95 },
    brute: { hp: 150, speed: 2.5, dmg: 22, attackInterval: 1.8, range: 2.4, scale: 1.55 },
  },

  turret: { range: 14, interval: 0.7, damage: [18, 30, 45], hp: 220, max: 12, repairRate: 25 },

  weather: { minHours: 2, maxHours: 6 },

  shop: [
    { id: 'bucket', cat: 'Tools', name: 'Bigger Bucket', desc: 'Carry more paydirt on foot.', prices: [400, 1200] },
    { id: 'shovel', cat: 'Tools', name: 'Sharper Shovel', desc: 'Dig faster with bigger scoops.', prices: [600, 1600] },
    { id: 'sword', cat: 'Tools', name: 'Better Sword', desc: 'Rusty → Iron → Steel. More damage per swing.', prices: [500, 1800] },
    { id: 'axe', cat: 'Tools', name: 'Axe', desc: 'Chop down trees for wood (slot 6). Clears land for digging and turrets.', price: 350, unique: true },
    { id: 'detector', cat: 'Tools', name: 'Metal Detector', desc: 'Slot 7. Sweep the ground to reveal the gold hidden on bedrock — builds a map you keep.', price: 600, unique: true },
    { id: 'excBucket', cat: 'Machines', name: 'Excavator Bucket', desc: 'Wider bucket — each scoop takes more dirt.', prices: [2500, 6000] },
    { id: 'plantSpeed', cat: 'Machines', name: 'Wash Plant Upgrade', desc: 'Process paydirt faster.', prices: [2000, 5000] },
    { id: 'loader', cat: 'Machines', name: 'Front-End Loader', desc: 'Fast wheeled loader for moving dirt. Delivered to camp.', price: 3500, unique: true },
    { id: 'dozer', cat: 'Machines', name: 'Bulldozer', desc: 'Earthworks crew: raise, lower or flatten ground from the seat, build roads and bridges. Every m³ moved costs money. Delivered to camp.', price: 4000, unique: true },
    { id: 'belts', cat: 'Logistics', name: 'Conveyor Belts ×10', desc: 'Press B to build. Drag to lay a line; belts curve automatically. Carry paydirt to the wash plant hands-free.', price: 450, consumable: true },
    { id: 'beltHopper', cat: 'Logistics', name: 'Belt Hopper', desc: 'Press B to build. Dump truck loads or buckets into it; it feeds the belt in front of it. Holds 30 m³.', price: 900, consumable: true },
    { id: 'inn', cat: 'Buildings', name: 'Inn', desc: 'Press B, tool 3 to place it (6×6 m). Sleep from 19:30 to skip the night — the night raid is then fought as a dice battle by your mercenaries and turrets. No sleeping with skeletons at the door.', price: 2500, unique: true },
    { id: 'barracks', cat: 'Buildings', name: 'Barracks', desc: 'Press B, tool 4 to place it (6×6 m). Lets you recruit mercenaries who patrol the camp and fight skeletons — awake or asleep.', price: 3000, unique: true },
    { id: 'church', cat: 'Buildings', name: 'Church', desc: 'Press B, tool 5 to place it (6×6 m). The blessed ground around it (14 m) heals you and your mercenaries, even mid-fight — skeletons get nothing. Hurt soldiers walk there on their own.', price: 3500, unique: true },
    { id: 'merc', cat: 'Buildings', name: 'Recruit Mercenary', desc: 'Paid in gold. A swordsman who guards the barracks, fights at night and rolls dice for you while you sleep. Up to 8.', goldPrice: 2.5, recruit: true },
    { id: 'mercTraining', cat: 'Buildings', name: 'Mercenary Drill', desc: 'Train the squad: +1 to every mercenary\'s battle roll per level, and harder hits in the field.', prices: [1500, 4000] },
    { id: 'towCable', cat: 'Machines', name: 'Tow Cable', desc: 'Press C near a vehicle to hook it, C at another to connect, then drive to pull it free.', price: 250, unique: true },
    { id: 'repairPlant', cat: 'Machines', name: 'Repair Wash Plant', desc: 'Fix skeleton damage so it runs again.', price: 500, action: true },
    { id: 'repairVehicles', cat: 'Machines', name: 'Repair Wrecked Machines', desc: 'Skeletons that win a night battle sabotage a machine. Send the mechanic to fix everything that smokes.', price: 600, action: true },
    { id: 'turret', cat: 'Defense', name: 'Auto Turret', desc: 'Place with slot 5. Shoots skeletons automatically.', price: 1200, consumable: true },
    { id: 'turretDmg', cat: 'Defense', name: 'Turret Ammo', desc: 'Heavier rounds for all turrets.', prices: [1500, 4000] },
    { id: 'torch', cat: 'Defense', name: 'Torch', desc: 'Light up your dig site at night.', price: 15, consumable: true },
  ],
};

export function richnessLabel(r) {
  if (r < 0.08) return { text: 'Barren', color: '#9aa0a6' };
  if (r < 0.35) return { text: 'Poor', color: '#c8b48a' };
  if (r < 0.8) return { text: 'Fair', color: '#e6c56b' };
  if (r < 1.5) return { text: 'Rich', color: '#ffd23f' };
  return { text: 'Very rich!', color: '#ffb300' };
}
