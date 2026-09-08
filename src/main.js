import * as THREE from 'three';
import { CONFIG, richnessLabel } from './config.js';
import { Terrain, WATER_LEVEL, clamp } from './terrain.js';
import { buildWorld, cyl } from './world.js';
import { Player } from './player.js';
import { DumpTruck, Excavator, FrontLoader, Bulldozer } from './vehicles.js';
import { Nuggets } from './nuggets.js';
import { Conveyors } from './conveyors.js';
import { Buildings } from './buildings.js';
import { Mercs } from './mercs.js';
import { Command } from './command.js';
import { Battle } from './battle.js';
import { WashPlant } from './washplant.js';
import { DayNight } from './daynight.js';
import { Particles } from './particles.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { EnemyManager } from './enemies.js';
import { Turret, buildTurretMesh } from './turrets.js';
import { Weather } from './weather.js';
import { Forest } from './forest.js';
import { hasSave, saveGame, loadGame } from './save.js';

const CAM_OFFSET = new THREE.Vector3(0, 26, 17);

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.5, 900);
    this.camTarget = new THREE.Vector3();
    this.zoom = 1.2;
    this.input = new Input(this.canvas);
    this.ui = new UI();
    this.ui.game = this;
    this.raycaster = new THREE.Raycaster();
    this.clock = new THREE.Clock();
    this.mode = 'start';
    this.autosaveTimer = 0;
    this._v = new THREE.Vector3();
    this._scr = { x: 0, y: 0 };

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    this.bindMenus();
    this.buildWorld(Math.floor(Math.random() * 1e6));
    this.fresh = true;
    this.ui.showStart(hasSave());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ------------------------------------------------------------ setup
  bindMenus() {
    const ui = this.ui;
    ui.el.newGameBtn.onclick = () => this.newGame();
    ui.el.continueBtn.onclick = () => this.loadSaved();
    ui.el.resumeBtn.onclick = () => this.setMode('playing');
    ui.el.saveBtn.onclick = () => { this.save(); this.setMode('playing'); };
    ui.el.loadBtn.onclick = () => this.loadSavedFromMenu();
    ui.el.newBtn.onclick = () => { if (confirm('Start a new game? Unsaved progress will be lost.')) this.newGame(); };
  }

  newGame() {
    if (!this.fresh) this.buildWorld(Math.floor(Math.random() * 1e6));
    this.fresh = false;
    this.setMode('playing');
    this.ui.toast('Welcome to Golden Valley! Dig near the stream to find gold.');
  }

  loadSavedFromMenu() {
    if (hasSave()) this.loadSaved();
    else this.ui.toast('No save found', 'bad');
  }

  loadSaved() {
    const data = loadGame();
    if (!data) return;
    this.buildWorld(data.seed);
    this.fresh = false;
    this.applySave(data);
    this.setMode('playing');
    this.ui.toast('Game loaded');
  }

  buildWorld(seed) {
    this.seed = seed;
    this.scene = new THREE.Scene();
    this.terrain = new Terrain(seed);
    this.scene.add(this.terrain.mesh, this.terrain.water);
    const world = buildWorld(this.scene, this.terrain, seed);
    this.colliders = world.colliders;
    this.campfire = world.campfire;
    this.forest = new Forest(this, world.forest, this.colliders);
    this.daynight = new DayNight(this.scene);
    this.weather = new Weather(this.scene);
    this.particles = new Particles(this.scene, 900);

    const s = this.terrain.sites;
    this.player = new Player(this.scene, this.terrain, s.spawn);
    this.truck = new DumpTruck(this, s.truck, s.truck.yaw);
    this.excavator = new Excavator(this, s.excavator, s.excavator.yaw);
    this.loader = null;
    this.dozer = null;
    this.vehicles = [this.truck, this.excavator];
    this.nuggets = new Nuggets(this);
    this.conveyors = new Conveyors(this);
    this.buildings = new Buildings(this);
    this.mercs = new Mercs(this);
    this.command = new Command(this);
    this.battle = new Battle(this);
    this.terra = { mode: 'flatten', size: 1, lockY: null, spent: 0 };
    // tow cable: a = hooked vehicle, b = other end (vehicle) or null while carrying the free end
    this.cable = { a: null, b: null };
    this.cableMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1, 6),
      new THREE.MeshStandardMaterial({ color: 0x2f2f33, roughness: 0.8, metalness: 0.5 })
    );
    this.cableMesh.visible = false;
    this.scene.add(this.cableMesh);
    this.washPlant = new WashPlant(this, s.washPlant);
    this.colliders.push({ x: s.washPlant.x, z: s.washPlant.z, r: 4.2, plant: true });
    this.enemies = new EnemyManager(this);
    this.turrets = [];
    this.placedTorches = [];

    // aim reticle
    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.0, 40),
      new THREE.MeshBasicMaterial({ color: 0xfff1a0, transparent: true, opacity: 0.75, depthTest: false, side: THREE.DoubleSide })
    );
    this.reticle.rotation.x = -Math.PI / 2;
    this.reticle.renderOrder = 10;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    // turret placement ghost
    this.ghost = buildTurretMesh(true).group;
    this.ghost.visible = false;
    this.ghost.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    this.scene.add(this.ghost);

    this.state = {
      money: CONFIG.startMoney,
      gold: 0,
      goldMined: 0,
      torches: CONFIG.startTorches,
      turrets: 0,
      belts: 0,
      hoppers: 0,
      kits: { inn: 0, barracks: 0, church: 0 },
      sleeping: false,
      nightsSlept: 0,
      battlesWon: 0,
      battlesLost: 0,
      mercsLost: 0,
      goldSpentOnMercs: 0,
      wood: 0,
      carry: 0,
      carryGold: 0,
      upgrades: { bucket: 0, shovel: 0, sword: 0, excBucket: 0, plantSpeed: 0, turretDmg: 0, mercTraining: 0 },
      owned: {},
      day: 1,
      hp: CONFIG.combat.playerHp,
      maxHp: CONFIG.combat.playerHp,
      lastHit: 99,
      ko: false,
      koTimer: 0,
      kills: 0,
      inVehicle: null,
      hotbar: 0,
      digTimer: 0,
      panProgress: 0,
      swordTimer: 0,
    };
    this.applyUpgrades();
    this.player.setTool(0);
    this.camTarget.copy(this.player.pos);
    this.camera.position.copy(this.camTarget).add(CAM_OFFSET.clone().multiplyScalar(this.zoom));
    this.camera.lookAt(this.camTarget);
    this.prevHours = this.daynight.hours;
  }

  applyUpgrades() {
    const u = this.state.upgrades;
    this.carryCap = CONFIG.player.carryCap[u.bucket];
    this.shovelMul = 1 + 0.45 * u.shovel;
    this.excavator.setBucketLevel(u.excBucket);
    this.washPlant.rate = CONFIG.washPlant.rate[u.plantSpeed];
    this.player.setSwordLevel(u.sword);
  }

  spawnLoader(data = null) {
    if (this.loader) return this.loader;
    const s = this.terrain.sites.loader;
    this.loader = new FrontLoader(this, s, s.yaw);
    this.vehicles.push(this.loader);
    if (data) this.loader.deserialize(data);
    return this.loader;
  }

  spawnDozer(data = null) {
    if (this.dozer) return this.dozer;
    const s = this.terrain.sites.dozer;
    this.dozer = new Bulldozer(this, s, s.yaw);
    this.vehicles.push(this.dozer);
    if (data) this.dozer.deserialize(data);
    return this.dozer;
  }

  // ------------------------------------------------------------ earthworks (bulldozer seat)
  /**
   * Brush-based terraforming, paid per cubic metre. Called every frame while seated in the dozer.
   * Returns the HUD prompt string.
   */
  earthworks(v, aim, dt) {
    const T = CONFIG.terraform, s = this.state, input = this.input, ew = this.terra;
    if (input.pressed('1')) ew.mode = 'raise';
    if (input.pressed('2')) ew.mode = 'lower';
    if (input.pressed('3')) ew.mode = 'flatten';
    if (input.pressed('[')) ew.size = Math.max(0, ew.size - 1);
    if (input.pressed(']')) ew.size = Math.min(T.radius.length - 1, ew.size + 1);
    const radius = T.radius[ew.size];
    const costPer = T.cost[ew.mode];

    // work point: mouse aim, clamped to reach from the tractor
    let ax = null, az = null, tooFar = false;
    if (aim) {
      let dx = aim.x - v.pos.x, dz = aim.z - v.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > T.range) { dx *= T.range / d; dz *= T.range / d; tooFar = true; }
      ax = v.pos.x + dx; az = v.pos.z + dz;
      this.reticle.visible = true;
      this.reticle.position.set(ax, this.terrain.heightAt(ax, az) + 0.12, az);
      this.reticle.scale.setScalar(radius);
      this.reticle.material.color.setHex(ew.mode === 'raise' ? 0x9fe07a : ew.mode === 'lower' ? 0xffa26b : 0x9fdcff);
    }

    const holding = input.mouseDown(0) && ax !== null;
    if (!holding) ew.lockY = null;
    let hint = 'Hold LMB on the ground to work', bad = false;
    if (ew.mode === 'flatten') hint = ew.lockY === null ? 'Flatten: click sets the target height, then paint' : `Levelling to ${ew.lockY.toFixed(1)} m`;
    if (holding) {
      if (s.money < costPer * 0.05) {
        hint = 'Out of money — sell some gold first'; bad = true;
        if (input.clicked(0)) this.ui.toast("You can't afford any more earthworks", 'bad');
      } else {
        if (ew.mode === 'flatten' && ew.lockY === null) ew.lockY = this.terrain.heightAt(ax, az);
        const amt = T.rate * dt;
        let vol = 0, blocked = false;
        if (ew.mode === 'raise') vol = this.terrain.raise(ax, az, radius, amt, T.fillCap);
        else if (ew.mode === 'lower') { const r = this.terrain.dig(ax, az, radius, amt); vol = r.volume; blocked = r.blocked && vol < 1e-3; }
        else { const r = this.terrain.flatten(ax, az, radius, ew.lockY, amt, T.fillCap); vol = r.cut + r.fill; blocked = r.blocked && vol < 1e-3; }
        if (vol > 1e-4) {
          const cost = Math.min(s.money, vol * costPer);
          s.money -= cost;
          ew.spent += cost;
          s.earthworksSpent = (s.earthworksSpent || 0) + cost;
          v.working = 1;
          if (Math.random() < dt * 30) {
            const gy = this.terrain.heightAt(ax, az) + 0.25;
            this.particles.burst(ax + (Math.random() - 0.5) * radius, gy, az + (Math.random() - 0.5) * radius, 2, ew.mode === 'raise' ? 0x9a6a3a : 0x8a5a30, 0.6, 2.2, 0.7);
          }
        } else if (blocked) { hint = "Can't work here — the camp is protected"; bad = true; }
        else if (ew.mode === 'lower') { hint = 'Down to bedrock — nothing more to remove'; }
        else if (ew.mode === 'raise') { hint = 'At the height limit'; }
      }
    }
    if (tooFar && !bad) { hint = 'Too far — drive closer'; }

    this.ui.setEarthworks({ mode: ew.mode, size: ew.size, cost: costPer, spent: ew.spent, hint, bad });
    const modeName = ew.mode[0].toUpperCase() + ew.mode.slice(1);
    return `<b>${modeName}</b> brush · <b>1</b>/<b>2</b>/<b>3</b> mode · <b>[</b> <b>]</b> size · <b>LMB</b> work ($${costPer}/m³)`;
  }

  // ------------------------------------------------------------ tow cable
  /** C key: hook / connect / release the tow cable. `near` is the vehicle in reach (or the one we're driving). */
  cableAction(near) {
    const c = this.cable, ui = this.ui;
    if (!this.state.owned.towCable) { ui.toast('You need a tow cable — buy one on your phone (TAB)', 'bad'); return; }
    if (c.a && c.b) { c.a = c.b = null; ui.toast('Tow cable released'); return; }
    if (!near) { if (c.a) { c.a = null; ui.toast('Tow cable put away'); } else ui.toast('Stand next to a vehicle to hook the cable', 'bad'); return; }
    if (!c.a) { c.a = near; ui.toast(`Cable hooked to the ${near.name} — hook the other end to another vehicle (C)`); return; }
    if (c.a === near) { c.a = null; ui.toast('Cable unhooked'); return; }
    if (Math.hypot(c.a.pos.x - near.pos.x, c.a.pos.z - near.pos.z) > CONFIG.tow.length + 4) { ui.toast('Too far apart — the cable is ' + CONFIG.tow.length + ' m long', 'bad'); return; }
    c.b = near;
    ui.toast(`${c.a.name} cabled to the ${near.name}. Drive to pull it.`);
  }

  updateCable(dt) {
    const c = this.cable, m = this.cableMesh;
    if (!c.a) { m.visible = false; return; }
    const from = c.a.pos.clone(); from.y += 1.1;
    let to;
    if (c.b) {
      to = c.b.pos.clone(); to.y += 1.1;
      // whichever end is being driven pulls the other
      const puller = c.a.occupied ? c.a : c.b.occupied ? c.b : null;
      if (puller) {
        const pulled = puller === c.a ? c.b : c.a;
        const dx = puller.pos.x - pulled.pos.x, dz = puller.pos.z - pulled.pos.z;
        const d = Math.hypot(dx, dz);
        const L = CONFIG.tow.length;
        if (d > L) {
          const k = (d - L) / d;
          pulled.pos.x += dx * k; pulled.pos.z += dz * k;
          this.resolveCollisions(pulled.pos, pulled.radius, pulled);
          let want = Math.atan2(dx, dz), dy = want - pulled.yaw;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          pulled.yaw += dy * Math.min(1, dt * 2.5);
          pulled.place();
          puller.speed *= 1 - (1 - CONFIG.tow.pullSpeedMul) * Math.min(1, dt * 10);
          if (Math.random() < dt * 6) {
            this.particles.burst(pulled.pos.x, pulled.pos.y + 0.2, pulled.pos.z, 2, 0x8a5a30, pulled.radius, 1.2, 0.5);
          }
        }
      }
    } else {
      // free end carried by the player
      to = this.player.pos.clone(); to.y += 0.9;
      if (from.distanceTo(to) > CONFIG.tow.length + 6) { c.a = null; this.ui.toast('The cable slipped off — too far from the vehicle', 'bad'); m.visible = false; return; }
    }
    const dir = to.clone().sub(from);
    const len = dir.length();
    m.visible = len > 0.1;
    m.position.copy(from).addScaledVector(dir, 0.5);
    m.position.y -= Math.min(0.6, len * 0.05); // slight sag
    m.scale.set(1, len, 1);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  }

  setMode(m) {
    this.mode = m;
    this.ui.hideStart();
    this.ui.closePause();
    this.ui.closePhone();
    this.ui.showHud(true);
    if (m === 'paused') this.ui.openPause();
    if (m === 'phone') { this.ui.openPhone(this); this.ui.setPrompt(''); }
    this.input.keys.clear();
  }

  // ------------------------------------------------------------ economy
  sellGold() {
    const g = this.state.gold;
    if (g < 0.005) return;
    const cash = g * CONFIG.goldPrice;
    this.state.money += cash;
    this.state.gold = 0;
    this.ui.toast(`Sold ${g.toFixed(2)} g for $${Math.floor(cash).toLocaleString()}`, 'gold');
  }

  sellWood() {
    const n = this.state.wood;
    if (n <= 0) return;
    const cash = n * CONFIG.woodPrice;
    this.state.money += cash;
    this.state.wood = 0;
    this.ui.toast(`Sold ${n} logs for $${cash.toLocaleString()}`, 'gold');
  }

  chopTree(aim) {
    const s = this.state, p = this.player;
    if (s.swordTimer > 0) return;
    const ax = aim ? aim.x : p.pos.x + Math.sin(p.yaw) * 1.5;
    const az = aim ? aim.z : p.pos.z + Math.cos(p.yaw) * 1.5;
    const tree = this.forest.nearest(ax, az, 1.6) || this.forest.nearest(p.pos.x, p.pos.z, 1.2);
    if (!tree) return;
    if (Math.hypot(tree.x - p.pos.x, tree.z - p.pos.z) > CONFIG.player.reach + 0.6) { this.ui.toast('Get closer to the tree', 'bad'); s.swordTimer = 0.3; return; }
    s.swordTimer = 0.55;
    p.yaw = Math.atan2(tree.x - p.pos.x, tree.z - p.pos.z);
    p.startSwing();
    if (this.forest.chop(tree, p.pos)) {
      s.wood += CONFIG.logsPerTree;
      this.ui.toast(`Timber! +${CONFIG.logsPerTree} logs`, 'gold');
    }
  }

  buy(id) {
    const item = CONFIG.shop.find((i) => i.id === id);
    if (!item) return;
    const s = this.state;
    if (item.consumable) {
      if (s.money < item.price) return;
      s.money -= item.price;
      if (id === 'turret') { s.turrets++; this.ui.toast('Turret added — select slot 5 to place it', 'gold'); }
      else if (id === 'belts') { s.belts += CONFIG.conveyor.beltPack; this.ui.toast(`${CONFIG.conveyor.beltPack} belts added — press B to build`, 'gold'); }
      else if (id === 'beltHopper') { s.hoppers++; this.ui.toast('Belt hopper added — press B to build', 'gold'); }
      else s.torches++;
    } else if (item.unique) {
      if (s.owned[id] || s.money < item.price) return;
      s.money -= item.price;
      s.owned[id] = true;
      if (id === 'loader') { this.spawnLoader(); this.ui.toast('Front-End Loader delivered to camp!', 'gold'); }
      if (id === 'dozer') { this.spawnDozer(); this.ui.toast('Bulldozer delivered to camp! Hold LMB to drop the blade.', 'gold'); }
      if (id === 'towCable') this.ui.toast('Tow cable bought — press C next to a vehicle to hook it', 'gold');
      if (id === 'inn') { s.kits.inn = (s.kits.inn || 0) + 1; this.ui.toast('Inn kit bought — press B, then 3 to place it', 'gold'); }
      if (id === 'barracks') { s.kits.barracks = (s.kits.barracks || 0) + 1; this.ui.toast('Barracks kit bought — press B, then 4 to place it', 'gold'); }
      if (id === 'church') { s.kits.church = (s.kits.church || 0) + 1; this.ui.toast('Church kit bought — press B, then 5 to place it', 'gold'); }
      if (id === 'axe') this.ui.toast('Axe added to slot 6 — chop trees for wood', 'gold');
      if (id === 'detector') this.ui.toast('Metal detector added to slot 7 — sweep the ground to find gold', 'gold');
    } else if (item.recruit) {
      const barracks = this.buildings.first('barracks');
      if (!barracks || this.mercs.count >= CONFIG.mercs.max || s.gold < item.goldPrice) return;
      s.gold -= item.goldPrice;
      s.goldSpentOnMercs = (s.goldSpentOnMercs || 0) + item.goldPrice;
      this.mercs.recruit(barracks);
      this.ui.toast(`Mercenary hired (${this.mercs.count}/${CONFIG.mercs.max})`, 'gold');
    } else if (item.action) {
      if (id === 'repairPlant') {
        if (!this.washPlant.damaged || s.money < item.price) return;
        s.money -= item.price;
        this.washPlant.repair();
        this.ui.toast('Wash plant repaired', 'gold');
      } else if (id === 'repairVehicles') {
        const wrecked = this.vehicles.filter((v) => v.wrecked);
        if (!wrecked.length || s.money < item.price) return;
        s.money -= item.price;
        for (const v of wrecked) v.repair();
        this.ui.toast(`${wrecked.map((v) => v.name).join(' & ')} repaired`, 'gold');
      }
    } else {
      const lvl = s.upgrades[id] || 0;
      if (lvl >= item.prices.length) return;
      const price = item.prices[lvl];
      if (s.money < price) return;
      s.money -= price;
      s.upgrades[id] = lvl + 1;
      this.applyUpgrades();
      this.ui.toast(`${item.name} upgraded!`, 'gold');
    }
  }

  // ------------------------------------------------------------ save/load
  save() {
    const data = {
      version: 2,
      seed: this.seed,
      hours: this.daynight.hours,
      state: { ...this.state, inVehicle: this.state.inVehicle ? this.state.inVehicle.name : null, ko: false, koTimer: 0 },
      player: { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw },
      truck: this.truck.serialize(),
      excavator: this.excavator.serialize(),
      loader: this.loader ? this.loader.serialize() : null,
      dozer: this.dozer ? this.dozer.serialize() : null,
      cable: { a: this.cable.a ? this.cable.a.name : null, b: this.cable.b ? this.cable.b.name : null },
      nuggets: this.nuggets.serialize(),
      conveyors: this.conveyors.serialize(),
      buildings: this.buildings.serialize(),
      mercs: this.mercs.serialize(),
      washPlant: this.washPlant.serialize(),
      enemies: this.enemies.serialize(),
      weather: this.weather.serialize(),
      torches: this.placedTorches.map((t) => ({ x: t.group.position.x, z: t.group.position.z })),
      turrets: this.turrets.filter((t) => t.alive).map((t) => t.serialize()),
      chopped: this.forest.serialize(),
      terrain: this.terrain.serializeHeights(),
      reveal: this.terrain.serializeReveal(),
    };
    if (saveGame(data)) this.ui.toast('Game saved');
    else this.ui.toast('Save failed (storage full?)', 'bad');
  }

  applySave(d) {
    this.daynight.hours = d.hours ?? CONFIG.startHour;
    this.prevHours = this.daynight.hours;
    const fresh = this.state;
    Object.assign(this.state, d.state, { inVehicle: null, digTimer: 0, panProgress: 0, ko: false, koTimer: 0, swordTimer: 0 });
    this.state.upgrades = { ...fresh.upgrades, ...(d.state.upgrades || {}) };
    this.state.owned = d.state.owned || {};
    if (this.state.hp == null || this.state.hp <= 0) this.state.hp = this.state.maxHp;
    this.player.pos.set(d.player.x, 0, d.player.z);
    this.player.yaw = d.player.yaw || 0;
    this.player.setTool(this.state.hotbar || 0);
    this.truck.deserialize(d.truck);
    this.excavator.deserialize(d.excavator);
    if (this.state.owned.loader) this.spawnLoader(d.loader);
    if (this.state.owned.dozer) this.spawnDozer(d.dozer);
    this.nuggets.deserialize(d.nuggets);
    if (d.cable) {
      const byName = (n) => (n ? this.vehicles.find((v) => v.name === n) || null : null);
      this.cable.a = byName(d.cable.a);
      this.cable.b = this.cable.a ? byName(d.cable.b) : null;
    }
    this.washPlant.deserialize(d.washPlant);
    this.enemies.deserialize(d.enemies);
    const h = this.daynight.hours;
    if ((h >= CONFIG.combat.nightStart || h < CONFIG.combat.spawnEnd) && !this.enemies.resolved) this.enemies.resumeNight();
    this.weather.deserialize(d.weather);
    this.terrain.deserializeHeights(d.terrain);
    this.terrain.deserializeReveal(d.reveal);
    this.conveyors.deserialize(d.conveyors); // after heights so belts sit on the saved ground
    this.buildings.deserialize(d.buildings);
    this.state.kits = { inn: 0, barracks: 0, church: 0, ...(this.state.kits || {}) };
    this.mercs.deserialize(d.mercs);
    this.state.sleeping = false;
    for (const t of d.torches || []) this.placeTorch(t.x, t.z, false);
    for (const t of d.turrets || []) { const tr = new Turret(this, t.x, t.z); tr.hp = t.hp ?? tr.maxHp; this.turrets.push(tr); }
    this.forest.deserialize(d.chopped);
    this.applyUpgrades();
    if (d.state.inVehicle) {
      const v = this.vehicles.find((v) => v.name === d.state.inVehicle);
      if (v) this.enterVehicle(v);
    }
    this.camTarget.copy(this.player.pos);
    this.camera.position.copy(this.camTarget).add(CAM_OFFSET.clone().multiplyScalar(this.zoom));
  }

  // ------------------------------------------------------------ helpers
  resolveCollisions(pos, r, self = null) {
    let hit = false;
    for (const c of this.colliders) {
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = r + c.r;
      if (d < min && d > 1e-4) { pos.x += (dx / d) * (min - d); pos.z += (dz / d) * (min - d); hit = true; }
    }
    for (const v of this.vehicles) {
      if (v === self) continue;
      const dx = pos.x - v.pos.x, dz = pos.z - v.pos.z;
      const d = Math.hypot(dx, dz);
      const min = r + v.radius;
      if (d < min && d > 1e-4) { pos.x += (dx / d) * (min - d); pos.z += (dz / d) * (min - d); hit = true; }
    }
    for (const t of this.turrets) {
      if (!t.alive) continue;
      const dx = pos.x - t.pos.x, dz = pos.z - t.pos.z;
      const d = Math.hypot(dx, dz);
      const min = r + 0.8;
      if (d < min && d > 1e-4) { pos.x += (dx / d) * (min - d); pos.z += (dz / d) * (min - d); hit = true; }
    }
    const lim = this.terrain.half - 4;
    pos.x = clamp(pos.x, -lim, lim);
    pos.z = clamp(pos.z, -lim, lim);
    return hit;
  }

  computeAim() {
    if (!this.input.hasMouse) return null;
    this.raycaster.setFromCamera(this.input.ndc, this.camera);
    const o = this.raycaster.ray.origin, d = this.raycaster.ray.direction;
    if (d.y >= -0.02) return null;
    let t = 0, prevT = 0;
    const p = new THREE.Vector3();
    for (let i = 0; i < 400; i++) {
      p.copy(o).addScaledVector(d, t);
      if (Math.abs(p.x) > this.terrain.half + 40 || Math.abs(p.z) > this.terrain.half + 40) return null;
      if (p.y <= this.terrain.heightAt(p.x, p.z)) {
        let lo = prevT, hi = t;
        for (let k = 0; k < 10; k++) {
          const mid = (lo + hi) / 2;
          p.copy(o).addScaledVector(d, mid);
          if (p.y <= this.terrain.heightAt(p.x, p.z)) hi = mid; else lo = mid;
        }
        return p.copy(o).addScaledVector(d, hi);
      }
      prevT = t;
      t += 0.8;
    }
    return null;
  }

  nearestVehicle(pos, maxDist) {
    let best = null, bd = maxDist;
    for (const v of this.vehicles) {
      const d = Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z) - v.radius;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  placeTorch(x, z, spend = true) {
    if (spend) {
      if (this.state.torches <= 0) { this.ui.toast('No torches left — buy more on your phone (TAB)', 'bad'); return; }
      this.state.torches--;
    }
    const g = new THREE.Group();
    const y = this.terrain.heightAt(x, z);
    g.position.set(x, y, z);
    cyl(0.05, 0.07, 1.3, 0x6f4a26, 0, 0.55, 0, g, 8);
    cyl(0.1, 0.1, 0.2, 0x3a2a1a, 0, 1.15, 0, g, 8);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.15, 0.45, 8),
      new THREE.MeshStandardMaterial({ color: 0xffb04a, emissive: 0xff7a1a, emissiveIntensity: 2.2 })
    );
    flame.position.y = 1.45;
    g.add(flame);
    const light = new THREE.PointLight(0xffa552, 0, 18, 2);
    light.position.y = 1.7;
    g.add(light);
    this.scene.add(g);
    this.placedTorches.push({ group: g, flame, light, phase: Math.random() * 10 });
    while (this.placedTorches.filter((t) => t.light.parent).length > CONFIG.maxTorchLights) {
      const old = this.placedTorches.find((t) => t.light.parent);
      old.group.remove(old.light);
    }
    if (spend) this.particles.burst(x, y + 1.4, z, 10, 0xffa040, 0.3, 1.5, 0.5);
  }

  placeTurret(x, z) {
    const s = this.state;
    if (s.turrets <= 0) { this.ui.toast('No turrets — buy them on your phone (TAB)', 'bad'); return; }
    if (this.turrets.filter((t) => t.alive).length >= CONFIG.turret.max) { this.ui.toast(`Turret limit reached (${CONFIG.turret.max})`, 'bad'); return; }
    if (!this.turretSpotOk(x, z)) { this.ui.toast("Can't place a turret here", 'bad'); return; }
    s.turrets--;
    const t = new Turret(this, x, z);
    this.turrets.push(t);
    this.particles.burst(x, t.pos.y + 0.5, z, 14, 0x8b939c, 1, 2, 0.6);
    this.ui.toast('Turret deployed');
  }

  turretSpotOk(x, z) {
    if (this.terrain.heightAt(x, z) < WATER_LEVEL + 0.1) return false;
    if (this.terrain.normalAt(x, z).y < 0.75) return false;
    const p = new THREE.Vector3(x, 0, z);
    const before = p.clone();
    this.resolveCollisions(p, 0.9);
    return p.distanceTo(before) < 0.05;
  }

  enterVehicle(v) {
    this.state.inVehicle = v;
    v.occupied = true;
    this.player.group.visible = false;
    this.ghost.visible = false;
    if (this.conveyors.build.active) { this.conveyors.toggleBuild(false); this.ui.setBuild(null); }
    if (v.wrecked) this.ui.toast(`${v.name} is wrecked — it won't move until repaired (phone → Machines)`, 'bad');
    else this.ui.toast(`Entered ${v.name}`);
  }

  exitVehicle() {
    const v = this.state.inVehicle;
    if (!v) return;
    v.occupied = false;
    v.speed = 0;
    this.state.inVehicle = null;
    const f = v.forward();
    this.player.pos.set(v.pos.x - f.z * (v.radius + 1.0), 0, v.pos.z + f.x * (v.radius + 1.0));
    this.resolveCollisions(this.player.pos, this.player.radius);
    this.player.group.visible = true;
  }

  // ------------------------------------------------------------ combat
  damagePlayer(dmg, fromPos) {
    const s = this.state;
    if (s.ko || s.inVehicle) return;
    s.hp -= dmg;
    s.lastHit = 0;
    this.ui.hitFlash(0.7);
    if (fromPos) {
      const dx = this.player.pos.x - fromPos.x, dz = this.player.pos.z - fromPos.z;
      const d = Math.hypot(dx, dz) || 1;
      this.player.pos.x += (dx / d) * 0.5;
      this.player.pos.z += (dz / d) * 0.5;
      this.resolveCollisions(this.player.pos, this.player.radius);
    }
    if (s.hp <= 0) this.knockOut();
  }

  knockOut() {
    const s = this.state;
    s.hp = 0;
    s.ko = true;
    s.koTimer = CONFIG.combat.knockoutSeconds;
    const lostGold = s.gold * 0.1;
    s.gold -= lostGold;
    s.carry = 0; s.carryGold = 0;
    this.ui.showKO(true);
    this.ui.hitFlash(1);
    this.player.group.rotation.x = 0;
  }

  respawn() {
    const s = this.state;
    const t = this.terrain.sites.tent;
    this.player.pos.set(t.x + 2.5, 0, t.z - 2.5);
    this.resolveCollisions(this.player.pos, this.player.radius);
    s.hp = Math.round(s.maxHp * 0.6);
    s.ko = false;
    s.lastHit = 99;
    this.ui.showKO(false);
    this.ui.toast('You came to at the tent.');
  }

  swordAttack(aim) {
    const s = this.state, p = this.player;
    if (s.swordTimer > 0) return;
    s.swordTimer = CONFIG.combat.swordCooldown;
    if (aim) {
      const dx = aim.x - p.pos.x, dz = aim.z - p.pos.z;
      if (Math.hypot(dx, dz) > 0.3) p.yaw = Math.atan2(dx, dz);
    }
    p.startSwing();
    const dmg = CONFIG.combat.swordDamage[s.upgrades.sword || 0];
    const hits = this.enemies.hitArc(p.pos, p.yaw, CONFIG.combat.swordRange, CONFIG.combat.swordArc, dmg);
    if (hits > 0) {
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      this.particles.burst(p.pos.x + fx * 1.3, p.pos.y + 1.1, p.pos.z + fz * 1.3, 8, 0xfff3c0, 0.6, 2.5, 0.4);
    }
  }

  // ------------------------------------------------------------ game actions
  excavatorScoop(v) {
    const p = v.digPoint;
    const room = v.singleScoop ? Infinity : v.capacity - v.bucket;
    if (room <= 0.01 || (v.singleScoop && v.isFull)) return;
    const res = this.terrain.dig(p.x, p.z, v.digRadius, v.digAmount);
    if (res.blocked && res.volume < 0.01) { this.ui.toast("Can't dig here", 'bad'); return; }
    if (res.volume < 0.01) { if (res.hitBedrock) this.ui.toast('Bedrock — nothing left to dig here'); return; }
    const accept = Math.min(res.volume, room);
    v.bucket += accept;
    v.bucketGold += res.gold * (accept / res.volume);
    v.updateBucketMesh();
    this.particles.burst(p.x, p.y + 0.3, p.z, 24, 0x8a5a30, 2.2, 2.5, 0.9);
    if (res.richness > 0.5) this.particles.burst(p.x, p.y + 0.4, p.z, Math.round(res.richness * 8), 0xffd23f, 1.6, 3, 1.1);
    if (res.hitBedrock) this.ui.toast('Hit bedrock!');
    const nug = this.nuggets.roll(p.x, p.z, res);
    if (nug) this.ui.toast(`A nugget tumbled out of the bucket — ${nug.grams.toFixed(1)} g on the ground!`, 'gold');
  }

  shovelDig(aim) {
    const s = this.state;
    if (s.carry >= this.carryCap - 0.01) {
      this.ui.toast('Bucket is full — pan it in the stream or press F near the truck/hopper', 'bad');
      s.digTimer = -1.2;
      return;
    }
    const p = this.player.pos;
    let dx = aim.x - p.x, dz = aim.z - p.z;
    const d = Math.hypot(dx, dz);
    const reach = CONFIG.player.reach;
    if (d > reach) { dx *= reach / d; dz *= reach / d; }
    const x = p.x + dx, z = p.z + dz;
    const res = this.terrain.dig(x, z, CONFIG.player.digRadius, CONFIG.player.digAmount * this.shovelMul);
    if (res.blocked && res.volume < 0.005) { this.ui.toast("Can't dig here", 'bad'); return; }
    if (res.volume < 0.005) { if (res.hitBedrock) this.ui.toast('Bedrock!'); return; }
    const accept = Math.min(res.volume, this.carryCap - s.carry);
    s.carry += accept;
    s.carryGold += res.gold * (accept / res.volume);
    const y = this.terrain.heightAt(x, z);
    this.particles.burst(x, y + 0.2, z, 10, 0x8a5a30, 1.2, 2.2, 0.7);
    if (res.richness > 0.5) this.particles.burst(x, y + 0.3, z, Math.round(res.richness * 4), 0xffd23f, 0.9, 2.5, 1.0);
    if (res.hitBedrock) this.ui.toast('Hit bedrock — this is where the gold is!');
    this.nuggets.roll(x, z, res);
  }

  depositCarry() {
    const s = this.state;
    if (s.carry < 0.01) { this.ui.toast('Your bucket is empty', 'bad'); return; }
    const p = this.player.pos;
    const truckD = Math.hypot(this.truck.pos.x - p.x, this.truck.pos.z - p.z);
    const wpD = Math.hypot(this.washPlant.hopperPos.x - p.x, this.washPlant.hopperPos.z - p.z);
    const beltH = this.conveyors.nearestHopper(p.x, p.z, 3.4);
    let target = null, name = '';
    if (beltH) { target = beltH; name = 'belt hopper'; }
    else if (wpD < 5.5) { target = this.washPlant; name = 'hopper'; }
    else if (truckD < 4.6) { target = this.truck; name = 'truck'; }
    if (!target) { this.ui.toast('Stand next to the truck, a belt hopper or the wash plant hopper to dump', 'bad'); return; }
    if (target === this.washPlant && this.washPlant.damaged) { this.ui.toast('The wash plant is wrecked — repair it from your phone', 'bad'); return; }
    const acc = target === this.truck ? target.addLoad(s.carry, s.carryGold)
      : target === beltH ? this.conveyors.hopperAdd(beltH, s.carry, s.carryGold)
      : target.addPaydirt(s.carry, s.carryGold);
    if (acc <= 0) { this.ui.toast(`${name[0].toUpperCase() + name.slice(1)} is full`, 'bad'); return; }
    const frac = acc / s.carry;
    s.carryGold -= s.carryGold * frac;
    s.carry -= acc;
    if (s.carry < 0.01) { s.carry = 0; s.carryGold = 0; }
    this.ui.toast(`Dumped paydirt into the ${name}`);
  }

  /** Belt hopper within reach of a point (for vehicle dumping). */
  beltHopperNear(x, z, maxD) { return this.conveyors.nearestHopper(x, z, maxD); }

  /** Move a bucket/load into the wash plant; returns accepted volume or -1 if refused. */
  feedPlant(vol, gold) {
    if (this.washPlant.damaged) { this.ui.toast('The wash plant is wrecked — repair it from your phone', 'bad'); return -1; }
    const acc = this.washPlant.addPaydirt(vol, gold);
    if (acc <= 0) { this.ui.toast('Hopper is full', 'bad'); return -1; }
    return acc;
  }

  vehicleDump(v) {
    if (v === this.truck) {
      if (v.load < 0.01) { this.ui.toast('Truck is empty', 'bad'); return; }
      const bed = v.bedWorldPos();
      const wpD = Math.hypot(this.washPlant.hopperPos.x - bed.x, this.washPlant.hopperPos.z - bed.z);
      const beltH = this.beltHopperNear(bed.x, bed.z, 4.5);
      if (beltH) {
        v.startDump(() => {
          const acc = this.conveyors.hopperAdd(beltH, v.load, v.loadGold);
          if (acc <= 0) { this.ui.toast('Belt hopper is full', 'bad'); return; }
          v.loadGold -= v.loadGold * (acc / v.load);
          v.load -= acc;
          if (v.load < 0.01) { v.load = 0; v.loadGold = 0; }
          v.updateLoadMesh();
          this.ui.toast(`Dumped ${acc.toFixed(1)} m³ into the belt hopper`);
          this.particles.burst(beltH.x, beltH.y + 2.2, beltH.z, 30, 0x8a5a30, 2, 1.5, 0.8);
        });
      } else if (wpD < 6.5) {
        if (this.washPlant.damaged) { this.ui.toast('The wash plant is wrecked — repair it from your phone', 'bad'); return; }
        v.startDump(() => {
          const acc = this.feedPlant(v.load, v.loadGold);
          if (acc <= 0) return;
          const frac = acc / v.load;
          v.loadGold -= v.loadGold * frac;
          v.load -= acc;
          if (v.load < 0.01) { v.load = 0; v.loadGold = 0; }
          v.updateLoadMesh();
          this.ui.toast(`Dumped ${acc.toFixed(1)} m³ into the wash plant`);
          this.particles.burst(this.washPlant.hopperPos.x, this.washPlant.hopperPos.y, this.washPlant.hopperPos.z, 30, 0x8a5a30, 2, 1.5, 0.8);
        });
      } else {
        v.startDump(() => {
          const r = v.takeAll();
          const spread = 2.6;
          this.terrain.raise(bed.x, bed.z, spread, r.vol / (Math.PI * spread * spread * 0.35), 3);
          this.particles.burst(bed.x, bed.y - 1, bed.z, 30, 0x8a5a30, 2.5, 1.5, 0.9);
          this.ui.toast(`Dumped load on the ground${r.gold > 0.05 ? ` (lost ${r.gold.toFixed(2)} g of gold!)` : ''}`, r.gold > 0.05 ? 'bad' : '');
        });
      }
      return;
    }

    // diggers: excavator / loader
    const d = v;
    if (!d.isDigger) { this.ui.toast(`The ${d.name} carries no dirt`, 'bad'); return; }
    if (d.bucket < 0.01) { this.ui.toast('Bucket is empty', 'bad'); return; }
    if (d.cycle >= 0 || d.dumpTimer >= 0) return;
    // Decide the target NOW, from where the bucket is when F is pressed — the same measurement the
    // "F feed hopper" prompt uses. The loader's tip animation raises the arms (which swings the bucket
    // forward) before the dirt actually leaves, so re-measuring at that moment could miss the hopper.
    const bp0 = d.bucketWorldPos();
    const truckBed = this.truck.bedWorldPos();
    const tD = Math.hypot(truckBed.x - bp0.x, truckBed.z - bp0.z);
    const wpD = Math.hypot(this.washPlant.hopperPos.x - bp0.x, this.washPlant.hopperPos.z - bp0.z);
    const beltH = this.beltHopperNear(bp0.x, bp0.z, 2.6);
    const target = tD < 3.4 ? 'truck' : beltH ? 'belt' : wpD < 4.2 ? 'plant' : 'ground';
    if (target === 'plant' && this.washPlant.damaged) { this.ui.toast('The wash plant is wrecked — repair it from your phone', 'bad'); return; }
    const doDump = () => {
      const bp = d.bucketWorldPos();
      let msg;
      if (target === 'truck') {
        const acc = this.truck.addLoad(d.bucket, d.bucketGold);
        if (acc <= 0) { this.ui.toast('Truck is full', 'bad'); return; }
        d.bucketGold -= d.bucketGold * (acc / d.bucket);
        d.bucket -= acc;
        msg = 'Loaded the truck';
      } else if (target === 'belt') {
        const acc = this.conveyors.hopperAdd(beltH, d.bucket, d.bucketGold);
        if (acc <= 0) { this.ui.toast('Belt hopper is full', 'bad'); return; }
        d.bucketGold -= d.bucketGold * (acc / d.bucket);
        d.bucket -= acc;
        msg = 'Fed the belt hopper';
      } else if (target === 'plant') {
        const acc = this.feedPlant(d.bucket, d.bucketGold);
        if (acc <= 0) return;
        d.bucketGold -= d.bucketGold * (acc / d.bucket);
        d.bucket -= acc;
        msg = 'Fed the wash plant';
      } else {
        const r = d.takeAll();
        const spread = 2.2;
        this.terrain.raise(bp.x, bp.z, spread, r.vol / (Math.PI * spread * spread * 0.35), 3);
        msg = r.gold > 0.05 ? `Dumped on the ground (lost ${r.gold.toFixed(2)} g of gold)` : 'Dumped overburden on the ground';
      }
      if (d.bucket < 0.01) { d.bucket = 0; d.bucketGold = 0; }
      d.updateBucketMesh();
      this.particles.burst(bp.x, bp.y - 0.5, bp.z, 18, 0x8a5a30, 1.5, 1.2, 0.8);
      this.ui.toast(msg, msg.includes('lost') ? 'bad' : '');
    };
    if (d.startDump) d.startDump(doDump); // loader animates the tip
    else doDump();
  }

  // ------------------------------------------------------------ frame
  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const input = this.input;

    if (this.mode === 'start') {
      this.daynight.update(dt * 0.35, this.player.pos, this.weather);
      this.weather.update(dt, dt * 0.35 * this.daynight.hoursPerSecond, this.player.pos, this.terrain);
      this.player.animate(dt, 0, false, this.daynight.night);
      this.updateCamera(dt, this.player.pos);
      this.flicker();
      this.renderer.render(this.scene, this.camera);
      this.input.endFrame();
      return;
    }

    if (input.pressed('escape')) this.setMode(this.mode === 'playing' ? 'paused' : 'playing');
    if (input.pressed('tab')) this.setMode(this.mode === 'phone' ? 'playing' : 'phone');

    const playing = this.mode === 'playing';
    if (playing) this.updateGame(dt);

    const target = this.state.inVehicle ? this.state.inVehicle.pos : this.player.pos;
    this.daynight.update(playing ? dt : 0, target, this.weather);
    this.weather.update(dt, playing ? dt * this.daynight.hoursPerSecond : 0, this.camTarget, this.terrain);
    this.updateCamera(dt, target);
    this.flicker();
    this.particles.update(dt);
    this.ui.updateVignette(dt, this.state.hp < this.state.maxHp * 0.25 && !this.state.ko);
    this.updateWorldLabels();
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  /** Project a world point to CSS pixels; null if behind the camera. */
  toScreen(p, out = this._scr) {
    this._v.copy(p).project(this.camera);
    if (this._v.z > 1) return null;
    out.x = (this._v.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-this._v.y * 0.5 + 0.5) * window.innerHeight;
    return out;
  }

  /** Fill percentages floating above the hopper and every dirt-carrying machine. */
  updateWorldLabels() {
    const ui = this.ui;
    this.camera.updateMatrixWorld();
    const anchor = new THREE.Vector3();
    const stateOf = (fill, wrecked) => (wrecked ? 'wrecked' : fill >= 0.995 ? 'full' : fill < 0.005 ? 'empty' : '');

    const wp = this.washPlant;
    anchor.copy(wp.hopperPos).y += 2.2;
    ui.setWorldLabel('plant', this.toScreen(anchor), {
      title: 'Hopper',
      fill: wp.fill,
      state: stateOf(wp.fill, wp.damaged),
      extra: wp.processing && !wp.damaged ? richnessLabel(wp.richness).text : '',
    });

    for (const v of this.vehicles) {
      if (v.isDozer) {
        if (v.wrecked) { anchor.copy(v.pos).y += 4.4; ui.setWorldLabel(v.name, this.toScreen(anchor), { title: v.name, fill: 0, state: 'wrecked', extra: 'repair on phone' }); }
        else ui.hideWorldLabel(v.name);
        continue; // carries nothing
      }
      const vol = v.load ?? v.bucket;
      const fill = v.fill;
      anchor.copy(v.pos).y += v === this.truck ? 4.4 : 4.8;
      ui.setWorldLabel(v.name, this.toScreen(anchor), {
        title: v.wrecked ? v.name : v === this.truck ? 'Truck bed' : v.singleScoop ? 'Scoop' : 'Bucket',
        fill,
        state: stateOf(fill, v.wrecked),
        extra: v.wrecked ? 'repair on phone' : vol > 0.01 ? richnessLabel(v.richness).text : '',
      });
    }

    // belt hoppers (labels keyed by grid cell; hide labels for removed hoppers)
    const live = new Set();
    for (const h of this.conveyors.hoppers) {
      const id = `bh:${h.gx},${h.gz}`;
      live.add(id);
      const fill = h.vol / h.capacity;
      anchor.set(h.x, h.y + 3.2, h.z);
      const n = this.conveyors.nextOf(h);
      const fed = this.conveyors.at(n.gx, n.gz)?.type === 'belt';
      ui.setWorldLabel(id, this.toScreen(anchor), {
        title: 'Belt hopper',
        fill,
        state: !fed && h.vol > 0.01 ? 'full' : stateOf(fill, false),
        extra: !fed ? 'no belt in front' : h.vol > 0.01 ? richnessLabel(h.gold / h.vol).text : '',
      });
    }
    for (const id of ui.labels.keys()) if (id.startsWith('bh:') && !live.has(id)) ui.hideWorldLabel(id);
  }

  flicker() {
    const now = performance.now();
    const night = this.daynight.night;
    for (const t of this.placedTorches) {
      const f = 0.85 + 0.15 * Math.sin(now * 0.012 + t.phase) * Math.sin(now * 0.0047 + t.phase * 2);
      t.light.intensity = (5 + 32 * night) * f;
      t.flame.scale.setScalar(0.9 + 0.15 * Math.sin(now * 0.02 + t.phase));
    }
    const cf = this.campfire;
    cf.light.intensity = (8 + 30 * night) * (0.85 + 0.15 * Math.sin(now * 0.011) * Math.sin(now * 0.005));
    cf.flame.scale.setScalar(0.9 + 0.15 * Math.sin(now * 0.017));
  }

  updateCamera(dt, target) {
    if (this.input.wheel !== 0 && this.mode !== 'phone') {
      this.zoom = clamp(this.zoom * (1 + this.input.wheel * 0.0012), 0.5, 2.2);
    }
    this.camTarget.lerp(target, 1 - Math.exp(-dt * 6));
    const desired = this.camTarget.clone().add(CAM_OFFSET.clone().multiplyScalar(this.zoom));
    this.camera.position.lerp(desired, 1 - Math.exp(-dt * 8));
    this.camera.lookAt(this.camTarget.x, this.camTarget.y + 1, this.camTarget.z);
  }

  /** World simulation for one step: plant, machines, belts, enemies, turrets. Shared by play and sleep. */
  simulate(dt, aim) {
    const s = this.state;
    const night = this.daynight.night, daylight = this.daynight.daylight;
    if (this.daynight.hours < this.prevHours) s.day++;
    this.daynight.day = s.day;
    const hoursNow = this.daynight.hours;

    this.washPlant.update(dt, night, daylight, this.weather.plantBonus);
    for (const v of this.vehicles) {
      if (v === this.excavator) v.update(dt, night, this.input, aim);
      else v.update(dt, night);
    }
    this.updateCable(dt);
    this.nuggets.update(dt);
    this.conveyors.update(dt);
    this.buildings.update(dt, night);
    this.enemies.update(dt, hoursNow, this.prevHours, this.camera);
    this.prevHours = hoursNow;
    this.mercs.update(dt, this.camera, night);
    this.forest.update(dt);
    for (const t of this.turrets) t.update(dt, daylight, this.camera);
    for (let i = this.turrets.length - 1; i >= 0; i--) if (!this.turrets[i].alive) this.turrets.splice(i, 1);
  }

  // ------------------------------------------------------------ inn / sleeping
  /** Why you can't sleep right now, or null if you can. */
  sleepBlocker(inn) {
    const h = this.daynight.hours, c = CONFIG.inn;
    if (!(h >= c.sleepFrom || h < c.sleepUntil)) return `You can only sleep after ${Math.floor(c.sleepFrom)}:${String(Math.round((c.sleepFrom % 1) * 60)).padStart(2, '0')}`;
    if (this.enemies.nearest(inn.x, inn.z, c.dangerRadius)) return 'Skeletons are too close to sleep!';
    return null;
  }

  sleep(inn) {
    const s = this.state;
    if (this.conveyors.build.active) { this.conveyors.toggleBuild(false); this.ui.setBuild(null); }
    s.sleeping = true;
    s.hotbar = 0;
    this.player.setTool(0);
    this.player.group.visible = false;
    this.player.pos.set(inn.door.x, 0, inn.door.z);
    this.sleepStart = { stolen: this.washPlant.stolen, turrets: this.turrets.length, kills: s.kills, wasDamaged: this.washPlant.damaged, day: s.day };
    this.lastBattle = null;
    this.ui.setPrompt('');
    this.reticle.visible = false;
    this.ghost.visible = false;
    // the night's raid is settled with dice instead of in real time
    const army = this.enemies.raidForSleep();
    if (army.length) {
      this.ui.setSleep(false);
      this.battle.start(this.enemies.night, army, (res) => {
        this.applyBattleOutcome(res);
        if (s.sleeping) this.ui.setSleep(true, this.daynight.timeString);
      });
    } else this.ui.setSleep(true, this.daynight.timeString);
  }

  /** World consequences of the dice battle. */
  applyBattleOutcome(r) {
    const s = this.state, c = CONFIG.combat;
    for (const type of r.killed) { s.money += c.bounty[type] || 0; s.kills++; }
    for (let i = 0; i < r.lostMercs; i++) this.mercs.loseOne();
    // turrets fall weakest-first
    const alive = this.turrets.filter((t) => t.alive).sort((a, b) => a.hp - b.hp);
    for (let i = 0; i < r.lostTurrets && i < alive.length; i++) alive[i].destroy(true);
    const out = { ...r, bounty: r.killed.reduce((a, t) => a + (c.bounty[t] || 0), 0), stolen: 0, plantWrecked: false, wrecked: null };
    if (r.won) s.battlesWon = (s.battlesWon || 0) + 1;
    else {
      s.battlesLost = (s.battlesLost || 0) + 1;
      const wp = this.washPlant;
      // the survivors ransack the camp: they empty the sluice and wreck the plant…
      if (wp.goldTrap > 0) { out.stolen = wp.goldTrap; wp.stolen += wp.goldTrap; wp.goldTrap = 0; }
      if (!wp.damaged) { wp.hp = 0; wp.damaged = true; out.plantWrecked = true; }
      this.particles.burst(wp.raidPos.x, wp.raidPos.y + 1.5, wp.raidPos.z, 30, 0xff8a30, 2, 3, 1.0);
      // …and a big enough mob also sabotages a machine
      if (r.survivors.length >= CONFIG.battle.wreckSurvivors) {
        const targets = this.vehicles.filter((v) => !v.wrecked);
        if (targets.length) {
          const v = targets[Math.floor(Math.random() * targets.length)];
          v.wreck();
          out.wrecked = v.name;
          this.particles.burst(v.pos.x, v.pos.y + 2, v.pos.z, 30, 0x2a2a2a, 2, 3, 1.4);
        }
      }
    }
    this.lastBattle = out;
  }

  /** Fast-forward the world while asleep; wake at morning or when the player insists. */
  sleepStep(dt) {
    const s = this.state, c = CONFIG.inn, dtSim = 0.05;
    if (this.battle.active) { this.battle.update(dt, this.input); return; }
    if (this.input.pressed('e') || this.input.pressed(' ')) { this.wakeUp(true); return; }
    for (let i = 0; i < c.speed && s.sleeping; i++) {
      this.simulate(dtSim, null);
      this.daynight.update(dtSim, this.player.pos, this.weather);
      this.weather.update(dtSim, dtSim * this.daynight.hoursPerSecond, this.camTarget, this.terrain);
      this.particles.update(dtSim);
      const h = this.daynight.hours;
      if (h >= c.wakeHour && h < 12) this.wakeUp(false);
    }
    if (s.sleeping) this.ui.setSleep(true, this.daynight.timeString);
    this.ui.setHealth(s.hp, s.maxHp);
    this.ui.setStats({ money: s.money, gold: s.gold, time: this.daynight.timeString, day: s.day, isNight: this.daynight.night > 0.5, weather: this.weather.type, moon: this.daynight.moon });
  }

  wakeUp(early) {
    const s = this.state, ui = this.ui;
    s.sleeping = false;
    this.player.group.visible = true;
    ui.setSleep(false);
    const st = this.sleepStart || {};
    if (!early) {
      s.hp = s.maxHp;
      s.nightsSlept++;
      const stolen = this.washPlant.stolen - (st.stolen || 0);
      const lostTurrets = Math.max(0, (st.turrets || 0) - this.turrets.length);
      const kills = s.kills - (st.kills || 0);
      const parts = [];
      let bad = false;
      const b = this.lastBattle;
      if (b) {
        const k = b.killed.length;
        if (b.won) parts.push(`your defenders won the night battle, destroying ${k} skeleton${k === 1 ? '' : 's'} (+$${b.bounty})`);
        else { parts.push(`your defenders lost the night battle${k ? ` after destroying ${k} skeleton${k === 1 ? '' : 's'}` : ''}`); bad = true; }
        if (b.lostMercs) { parts.push(`${b.lostMercs} mercenar${b.lostMercs === 1 ? 'y' : 'ies'} fell`); bad = true; }
        if (b.lostTurrets) { parts.push(`${b.lostTurrets} turret${b.lostTurrets === 1 ? ' was' : 's were'} destroyed`); bad = true; }
        if (b.stolen > 0.01) parts.push(`${b.stolen.toFixed(2)} g of gold was looted from the sluice`);
        if (b.plantWrecked) parts.push('the wash plant was wrecked');
        if (b.wrecked) parts.push(`the ${b.wrecked} was sabotaged — repair it on your phone`);
      } else {
        if (kills > 0) parts.push(`your turrets destroyed ${kills} skeleton${kills === 1 ? '' : 's'}`);
        if (lostTurrets > 0) { parts.push(`${lostTurrets} turret${lostTurrets === 1 ? ' was' : 's were'} destroyed`); bad = true; }
        if (stolen > 0.01) { parts.push(`${stolen.toFixed(2)} g of gold was stolen from the sluice`); bad = true; }
        if (this.washPlant.damaged && !st.wasDamaged) { parts.push('the wash plant was wrecked'); bad = true; }
      }
      ui.toast(parts.length ? `Good morning. Overnight: ${parts.join(', ')}.` : 'Good morning! A quiet night — fully rested.', bad ? 'bad' : 'gold', 9000);
    } else ui.toast('You get up early.');
    this.save();
  }

  updateGame(dt) {
    const input = this.input, s = this.state, ui = this.ui;
    const night = this.daynight.night;
    const daylight = this.daynight.daylight;

    if (s.sleeping) { this.sleepStep(dt); return; }

    const aim = this.computeAim();
    this.reticle.visible = false;
    this.reticle.material.color.setHex(0xfff1a0);
    this.ghost.visible = false;

    // underground map is brightest while the detector is out
    const om = this.terrain.overlay.material;
    const wantOp = !s.inVehicle && s.hotbar === 6 ? 0.9 : 0.55;
    om.opacity += (wantOp - om.opacity) * Math.min(1, dt * 4);

    this.autosaveTimer += dt;
    if (this.autosaveTimer > 120) { this.autosaveTimer = 0; this.save(); }

    this.simulate(dt, aim);

    // ---- health ----
    s.lastHit += dt;
    s.swordTimer = Math.max(0, s.swordTimer - dt);
    if (s.ko) {
      s.koTimer -= dt;
      if (s.koTimer <= 0) this.respawn();
    } else if (s.lastHit > CONFIG.combat.regenDelay && s.hp < s.maxHp) {
      s.hp = Math.min(s.maxHp, s.hp + (daylight > 0.5 ? CONFIG.combat.regenDay : CONFIG.combat.regenNight) * dt);
    }
    ui.setHealth(s.hp, s.maxHp);
    if (this.enemies.nightActive || this.enemies.aliveCount > 0) {
      const left = this.enemies.aliveCount;
      const coming = Math.max(0, this.enemies.quota - this.enemies.spawned);
      ui.setNight(`Night ${this.enemies.night} · ${this.daynight.moon.icon} ${this.daynight.moon.name} · ${left} skeleton${left === 1 ? '' : 's'} nearby${coming > 0 ? ` · ${coming} more coming` : ''}`);
    } else ui.setNight(null);

    let prompt = '';
    if (!(s.inVehicle && s.inVehicle.isDozer) || s.ko) ui.setEarthworks(null);

    if (s.ko) {
      this.player.animate(dt, 0, false, night);
      this.player.group.rotation.x = -Math.PI / 2 * Math.min(1, (CONFIG.combat.knockoutSeconds - s.koTimer) * 3);
      ui.setVehicle(null);
      ui.setProgress(null);
      ui.setPrompt('');
      ui.setStats({ money: s.money, gold: s.gold, time: this.daynight.timeString, day: s.day, isNight: night > 0.5, weather: this.weather.type, moon: this.daynight.moon });
      return;
    }
    this.player.group.rotation.x = 0;

    if (s.inVehicle) {
      const v = s.inVehicle;
      this.command.update(dt, null, input, false); // hides the panel, fades order markers
      v.drive(dt, input);
      if (input.pressed('e')) { this.exitVehicle(); ui.setVehicle(null); }
      else {
        if (input.pressed('c')) this.cableAction(v);
        const towing = this.cable.a && this.cable.b && (this.cable.a === v || this.cable.b === v);
        const towTag = towing ? `  ·  towing the ${(this.cable.a === v ? this.cable.b : this.cable.a).name} (<b>C</b> release)` : '';
        if (v.isDozer) {
          prompt = this.earthworks(v, aim, dt) + towTag + '  ·  <b>E</b> exit';
          if (v.terrainMul < 0.6) prompt = `<span style="color:#ffb3b3">Steep / boggy ground</span> · ` + prompt;
          v.hint = 'Every m³ you move is billed — sculpted fill holds no gold';
          ui.setVehicle(v);
          ui.setProgress(null);
        } else if (v.isDigger) {
          this.reticle.visible = true;
          this.reticle.position.set(v.digPoint.x, v.digPoint.y + 0.1, v.digPoint.z);
          this.reticle.scale.setScalar(v.digRadius);
          if (input.mouseDown(0) && v.cycle < 0 && !(v.dumpTimer >= 0)) {
            if (v.isFull) { if (input.clicked(0)) ui.toast(v.singleScoop ? 'Bucket is loaded — swing it over the truck and press F' : 'Bucket full — press F to dump', 'bad'); }
            else v.startDig();
          }
          const bp = v.bucketWorldPos();
          const tb = this.truck.bedWorldPos();
          const tD = Math.hypot(tb.x - bp.x, tb.z - bp.z);
          const wpD = Math.hypot(this.washPlant.hopperPos.x - bp.x, this.washPlant.hopperPos.z - bp.z);
          const overBelt = !!this.beltHopperNear(bp.x, bp.z, 2.6);
          const overTruck = tD < 3.4, overHopper = wpD < 4.2 || overBelt;
          v.hint = overTruck ? 'Bucket over truck bed' : overBelt ? 'Bucket over belt hopper' : overHopper ? 'Bucket over hopper' : v === this.excavator ? (v.isFull ? 'Loaded — aim at the truck bed' : 'Aim with mouse · LMB dig') : 'Drive into the dirt · LMB scoop';
          if (v.singleScoop && v.isFull && !overTruck && !overHopper) prompt = `Bucket loaded (${richnessLabel(v.richness).text}) · aim at the truck bed and press <b>F</b>  ·  <b>E</b> exit`;
          else prompt = `<b>LMB</b> ${v === this.excavator ? 'dig' : 'scoop'}  ·  <b>F</b> ${overTruck ? 'load truck' : overBelt ? 'feed belt hopper' : overHopper ? 'feed hopper' : 'dump on ground'}  ·  <b>E</b> exit`;
        } else {
          const bed = v.bedWorldPos();
          const wpD = Math.hypot(this.washPlant.hopperPos.x - bed.x, this.washPlant.hopperPos.z - bed.z);
          const nearBelt = !!this.beltHopperNear(bed.x, bed.z, 4.5);
          v.hint = nearBelt ? 'Backed up to a belt hopper' : wpD < 6.5 ? 'Backed up to the hopper' : 'Back the bed up to a hopper to dump';
          prompt = `<b>F</b> ${nearBelt ? 'dump into belt hopper' : wpD < 6.5 ? 'dump into wash plant' : 'dump on ground'}  ·  <b>E</b> exit`;
        }
        if (input.pressed('f') && !v.isDozer) this.vehicleDump(v);
        ui.setVehicle(v);
        ui.setProgress(null);
      }
    } else {
      // ---------------- on foot ----------------
      const p = this.player;
      let mx = 0, mz = 0;
      if (input.down('w') || input.down('arrowup')) mz -= 1;
      if (input.down('s') || input.down('arrowdown')) mz += 1;
      if (input.down('a') || input.down('arrowleft')) mx -= 1;
      if (input.down('d') || input.down('arrowright')) mx += 1;
      const len = Math.hypot(mx, mz);
      const inWater = this.terrain.heightAt(p.pos.x, p.pos.z) < WATER_LEVEL - 0.05;
      const speed = CONFIG.player.speed * (input.down('shift') ? CONFIG.player.sprintMul : 1) * (inWater ? 0.55 : 1);
      if (len > 0) {
        mx /= len; mz /= len;
        const nx = p.pos.x + mx * speed * dt, nz = p.pos.z + mz * speed * dt;
        if (this.terrain.heightAt(nx, nz) > WATER_LEVEL - 0.95 && this.terrain.inBounds(nx, nz, 3)) {
          p.pos.x = nx; p.pos.z = nz;
        }
      }
      // standing on a belt? it carries you along
      if (!s.ko) this.conveyors.carry(p.pos, dt);
      this.resolveCollisions(p.pos, p.radius);

      // build mode (conveyors): B toggles; while active LMB/RMB/1/2/R belong to the builder
      if (input.pressed('b')) this.conveyors.toggleBuild(); // always opens — the panel itself says what you can place
      const building = this.conveyors.build.active;
      if (!building) ui.setBuild(null);

      // hotbar
      for (let i = 0; i < 8 && !building; i++) {
        if (input.pressed(String(i + 1))) {
          if (i === 5 && !s.owned.axe) ui.toast('You need an axe — buy one on your phone (TAB)', 'bad');
          else if (i === 6 && !s.owned.detector) ui.toast('You need a metal detector — buy one on your phone (TAB)', 'bad');
          else if (i === 7 && !s.owned.barracks) ui.toast('Build a Barracks first — then you can command mercenaries', 'bad');
          else { s.hotbar = i; p.setTool(i); }
        }
      }

      // mercenary command (slot 8): selection boxes, orders, patrol routes
      this.command.update(dt, aim, input, !building);
      const commanding = s.hotbar === 7;

      const using = input.mouseDown(0) && !!aim && !building && !commanding;
      if (using && aim && s.hotbar !== 3 && s.hotbar !== 5) {
        const dx = aim.x - p.pos.x, dz = aim.z - p.pos.z;
        if (Math.hypot(dx, dz) > 0.3) p.faceDir(dx, dz, dt);
      } else if (len > 0) {
        p.faceDir(mx, mz, dt);
      } else if (aim) {
        const dx = aim.x - p.pos.x, dz = aim.z - p.pos.z;
        if (Math.hypot(dx, dz) > 0.6) p.faceDir(dx, dz, dt, 5);
      }

      let panning = false;
      if (building) {
        const hint = this.conveyors.buildUpdate(aim, input);
        const b = this.conveyors.build;
        const informational = /rotate|remove|already placed/.test(hint);
        ui.setBuild({ tool: b.tool, dir: b.dir, belts: s.belts, hoppers: s.hoppers, kits: s.kits, owned: s.owned, hint, bad: !!hint && !informational });
      } else if (s.hotbar === 0) {
        if (aim) {
          const d = Math.hypot(aim.x - p.pos.x, aim.z - p.pos.z);
          const k = d > CONFIG.player.reach ? CONFIG.player.reach / d : 1;
          const rx = p.pos.x + (aim.x - p.pos.x) * k, rz = p.pos.z + (aim.z - p.pos.z) * k;
          this.reticle.visible = true;
          this.reticle.position.set(rx, this.terrain.heightAt(rx, rz) + 0.08, rz);
          this.reticle.scale.setScalar(CONFIG.player.digRadius);
        }
        if (using) {
          s.digTimer += dt;
          if (s.digTimer >= CONFIG.player.digInterval / (1 + 0.3 * s.upgrades.shovel)) { s.digTimer = 0; this.shovelDig(aim); }
        } else s.digTimer = CONFIG.player.digInterval * 0.6;
        if (s.carry > 0.01) prompt = `Bucket ${Math.round((s.carry / this.carryCap) * 100)}% · <b>F</b> dump into truck or hopper · pan it at the stream`;
      } else if (s.hotbar === 1) {
        if (!inWater) prompt = 'Stand in the stream to pan';
        else if (s.carry < 0.02) prompt = 'Your bucket is empty — shovel some gravel first';
        else if (using) {
          panning = true;
          s.panProgress += dt / CONFIG.player.panTime;
          if (s.panProgress >= 1) {
            s.panProgress = 0;
            const take = Math.min(CONFIG.player.panTake, s.carry);
            const frac = take / s.carry;
            const g = s.carryGold * frac * CONFIG.player.panEfficiency;
            s.carryGold -= s.carryGold * frac;
            s.carry -= take;
            if (s.carry < 0.01) { s.carry = 0; s.carryGold = 0; }
            s.gold += g; s.goldMined += g;
            if (g > 0.01) {
              ui.toast(`+${g.toFixed(2)} g gold!`, 'gold');
              this.particles.burst(p.pos.x, p.pos.y + 1.2, p.pos.z, 12, 0xffd23f, 0.6, 2.2, 1);
            } else ui.toast('Nothing but sand…');
          }
          prompt = 'Panning… hold <b>LMB</b>';
        } else prompt = 'Hold <b>LMB</b> to pan your paydirt';
        if (!using) s.panProgress = Math.max(0, s.panProgress - dt * 0.5);
      } else if (s.hotbar === 2) {
        if (aim && Math.hypot(aim.x - p.pos.x, aim.z - p.pos.z) < 4 && input.clicked(0)) {
          if (this.terrain.heightAt(aim.x, aim.z) > WATER_LEVEL) this.placeTorch(aim.x, aim.z);
          else ui.toast("Can't place a torch in water", 'bad');
        }
        prompt = `<b>LMB</b> place a torch (${s.torches} left)`;
      } else if (s.hotbar === 3) {
        if (input.clicked(0) || (input.mouseDown(0) && s.swordTimer <= 0)) this.swordAttack(aim);
        const near = this.enemies.nearest(p.pos.x, p.pos.z, 30);
        prompt = near ? `<b>LMB</b> swing sword · skeleton ${Math.round(Math.hypot(near.pos.x - p.pos.x, near.pos.z - p.pos.z))} m away` : '<b>LMB</b> swing sword';
      } else if (s.hotbar === 6) {
        // metal detector: scans around the coil constantly, faster and wider while sweeping (LMB)
        const dc = CONFIG.detector;
        const cx = p.pos.x + Math.sin(p.yaw) * dc.coilForward, cz = p.pos.z + Math.cos(p.yaw) * dc.coilForward;
        const sweeping = input.mouseDown(0);
        this.terrain.revealArea(cx, cz, sweeping ? dc.sweepRadius : dc.radius, (sweeping ? dc.sweepRate : dc.rate) * dt);
        const probe = this.terrain.probe(cx, cz);
        const sig = clamp(probe.richness / 1.8, 0, 1);
        const bars = Math.round(sig * 5);
        const meter = '▮'.repeat(bars) + '▯'.repeat(5 - bars);
        const r = richnessLabel(probe.richness);
        this.reticle.visible = true;
        this.reticle.position.set(cx, this.terrain.heightAt(cx, cz) + 0.1, cz);
        this.reticle.scale.setScalar(1.2 + 0.5 * sig * (0.5 + 0.5 * Math.sin(performance.now() * (0.004 + sig * 0.02))));
        this.reticle.material.color.setHex(sig > 0.55 ? 0xffd23f : sig > 0.2 ? 0xe6c56b : 0x9fdcff);
        p.detLed.material.emissiveIntensity = 0.3 + 3 * sig * (0.5 + 0.5 * Math.sin(performance.now() * (0.004 + sig * 0.02)));
        prompt = `Signal <span style="color:${r.color}">${meter} ${r.text}</span> · bedrock ${probe.depth.toFixed(1)} m down · hold <b>LMB</b> to sweep`;
      } else if (s.hotbar === 5) {
        if (input.clicked(0) || (input.mouseDown(0) && s.swordTimer <= 0)) this.chopTree(aim);
        const tree = this.forest.nearest(p.pos.x, p.pos.z, 4);
        prompt = tree ? `<b>LMB</b> chop tree (${tree.hp}/${CONFIG.treeHits} hits left)` : `<b>LMB</b> chop a tree · ${s.wood} logs`;
      } else if (s.hotbar === 7) {
        // command standard: selection and orders are handled by this.command
        const n = this.mercs.count, sel = this.command.selected.length;
        prompt = !n ? 'No mercenaries — recruit them on your phone (<b>TAB</b> → Buildings)'
          : sel ? `${sel}/${n} selected · <b>RMB</b> ground to move, <b>RMB</b> skeleton to attack · <b>M</b> move <b>Z</b> patrol <b>X</b> stand <b>H</b> home`
          : `<b>LMB</b> a soldier or drag a box to select · double-click for all ${n}`;
      } else {
        // turret placement
        if (aim) {
          const d = Math.hypot(aim.x - p.pos.x, aim.z - p.pos.z);
          const k = d > 6 ? 6 / d : 1;
          const gx = p.pos.x + (aim.x - p.pos.x) * k, gz = p.pos.z + (aim.z - p.pos.z) * k;
          const ok = this.turretSpotOk(gx, gz);
          this.ghost.visible = true;
          this.ghost.position.set(gx, this.terrain.heightAt(gx, gz), gz);
          this.ghost.traverse((o) => { if (o.isMesh && o.material.color) o.material.color.setHex(ok ? 0x66ccff : 0xff5555); });
          if (input.clicked(0)) this.placeTurret(gx, gz);
        }
        prompt = s.turrets > 0 ? `<b>LMB</b> place turret (${s.turrets} left) · range ${CONFIG.turret.range} m` : 'No turrets — buy them on your phone (<b>TAB</b>)';
      }
      ui.setProgress(panning ? s.panProgress : null);

      // interactions
      const nearV = this.nearestVehicle(p.pos, 2.2);
      const wpD = Math.hypot(this.washPlant.pos.x - p.pos.x, this.washPlant.pos.z - p.pos.z);
      let interact = null;
      if (nearV) {
        interact = () => this.enterVehicle(nearV);
        const c = this.cable;
        let cableTag = '';
        if (s.owned.towCable) {
          if (c.a && c.b) cableTag = '  ·  <b>C</b> release cable';
          else if (c.a === nearV) cableTag = '  ·  <b>C</b> unhook cable';
          else if (c.a) cableTag = `  ·  <b>C</b> connect cable from ${c.a.name}`;
          else cableTag = '  ·  <b>C</b> hook tow cable';
        }
        prompt = `<b>E</b> enter ${nearV.name}${cableTag}`;
      } else if (wpD < 7.5) {
        const g = this.washPlant.goldTrap;
        interact = () => {
          const got = this.washPlant.collect();
          if (got > 0.001) { s.gold += got; s.goldMined += got; ui.toast(`Collected ${got.toFixed(2)} g of gold from the sluice!`, 'gold'); }
          else ui.toast('Nothing in the sluice yet');
        };
        const status = this.washPlant.damaged ? 'WRECKED — repair from phone (TAB)'
          : this.washPlant.processing ? `Processing ${Math.round(this.washPlant.fill * 100)}% · ${richnessLabel(this.washPlant.richness).text}` : 'Hopper empty';
        prompt = `${status}\n<b>E</b> collect gold (${g.toFixed(2)} g)${s.carry > 0.01 ? '  ·  <b>F</b> dump bucket into hopper' : ''}`;
      } else if (!building && this.buildings.nearest(p.pos.x, p.pos.z, 3.2, 'inn')) {
        const inn = this.buildings.nearest(p.pos.x, p.pos.z, 3.2, 'inn');
        const why = this.sleepBlocker(inn);
        if (why) prompt = `<b>Inn</b> · ${why}`;
        else {
          const def = this.mercs.count + this.turrets.filter((t) => t.alive).length;
          const raid = !this.enemies.resolved;
          prompt = `<b>Inn</b> · <b>E</b> sleep until morning${raid ? (def ? `\n${this.mercs.count} mercenar${this.mercs.count === 1 ? 'y' : 'ies'} & ${def - this.mercs.count} turret${def - this.mercs.count === 1 ? '' : 's'} will fight tonight's raid` : '\n⚠ No defenders — the camp will be raided while you sleep!') : ''}`;
          interact = () => this.sleep(inn);
        }
      } else if (!building && this.buildings.nearest(p.pos.x, p.pos.z, 3.4, 'barracks')) {
        const n = this.mercs.count;
        prompt = `<b>Barracks</b> · ${n}/${CONFIG.mercs.max} mercenaries on the payroll · recruit more on your phone (<b>TAB</b> → Buildings, ${CONFIG.mercs.goldPrice} g each)`;
      } else if (!building && this.buildings.nearest(p.pos.x, p.pos.z, 3.4, 'church')) {
        const healing = s.hp < s.maxHp;
        prompt = `<b>Church</b> · blessed ground heals you and your mercenaries within ${CONFIG.church.radius} m${healing ? ' · <span style="color:#ffe08a">healing…</span>' : ''}`;
      } else if (!building && this.conveyors.nearestHopper(p.pos.x, p.pos.z, 3.4)) {
        const h = this.conveyors.nearestHopper(p.pos.x, p.pos.z, 3.4);
        prompt = `Belt hopper ${Math.round((h.vol / h.capacity) * 100)}%${s.carry > 0.01 ? '  ·  <b>F</b> dump bucket into it' : ''}`;
      } else if (this.cable.a && !this.cable.b) prompt = `Carrying the tow cable from the ${this.cable.a.name} — walk to another vehicle and press <b>C</b>`;
      if (building) prompt = `Build · <b>1</b> belt <b>2</b> hopper <b>3</b> inn <b>4</b> barracks <b>5</b> church · <b>R</b> rotate · <b>LMB</b> place (drag for a line) · <b>RMB</b> remove · <b>B</b> done${nearV ? `  ·  <b>E</b> enter ${nearV.name}` : ''}`;
      if (input.pressed('c')) this.cableAction(this.nearestVehicle(p.pos, 3.5));
      if (input.pressed('e') && interact) interact();
      if (input.pressed('f')) this.depositCarry();

      p.animate(dt, len, (using && (s.hotbar === 0 || s.hotbar === 1 || s.hotbar === 6)) || (commanding && this.command.waving > 0), night);
      ui.setVehicle(null);
      ui.setCarry(s.carry, this.carryCap, s.carry > 0 ? s.carryGold / s.carry : 0);
      ui.setHotbar(s.hotbar, s);
    }

    ui.setPrompt(prompt);
    ui.setStats({ money: s.money, gold: s.gold, time: this.daynight.timeString, day: s.day, isNight: night > 0.5, weather: this.weather.type, moon: this.daynight.moon });
  }
}

window.game = new Game();
