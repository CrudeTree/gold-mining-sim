import * as THREE from 'three';
import { CONFIG } from './config.js';
import { WATER_LEVEL, clamp } from './terrain.js';

const BONE = 0xe9e4d6;
const UP = new THREE.Vector3(0, 1, 0);

// Shared geometry (cheap to instantiate many skeletons)
const G = {
  leg: new THREE.BoxGeometry(0.13, 0.55, 0.13),
  pelvis: new THREE.BoxGeometry(0.42, 0.14, 0.2),
  spine: new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6),
  rib: new THREE.TorusGeometry(0.2, 0.03, 6, 12, Math.PI),
  skull: new THREE.SphereGeometry(0.24, 12, 10),
  jaw: new THREE.BoxGeometry(0.22, 0.1, 0.16),
  eye: new THREE.SphereGeometry(0.045, 6, 6),
  arm: new THREE.BoxGeometry(0.1, 0.55, 0.1),
  blade: new THREE.BoxGeometry(0.07, 0.85, 0.03),
  hilt: new THREE.BoxGeometry(0.22, 0.05, 0.06),
  bow: new THREE.TorusGeometry(0.42, 0.025, 6, 12, Math.PI),
  string: new THREE.BoxGeometry(0.01, 0.84, 0.01),
  club: new THREE.CylinderGeometry(0.15, 0.06, 0.95, 7),
  arrow: new THREE.CylinderGeometry(0.02, 0.02, 0.7, 5),
  hpBg: new THREE.PlaneGeometry(0.8, 0.09),
  hpFg: new THREE.PlaneGeometry(0.8, 0.09),
};
const M = {
  bone: new THREE.MeshStandardMaterial({ color: BONE, roughness: 0.9 }),
  boneDark: new THREE.MeshStandardMaterial({ color: 0xbdb5a2, roughness: 0.9 }),
  eye: new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 2.5 }),
  eyeBrute: new THREE.MeshStandardMaterial({ color: 0x40ff90, emissive: 0x20ff70, emissiveIntensity: 2.5 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.6, roughness: 0.35 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x5c3d1e, roughness: 0.9 }),
  hpBg: new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.8, depthTest: false }),
  hpFg: new THREE.MeshBasicMaterial({ color: 0xe53935, depthTest: false }),
};

function mesh(geo, mat, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  if (parent) parent.add(m);
  return m;
}

export class Skeleton {
  constructor(game, type, x, z) {
    this.game = game;
    this.type = type;
    const cfg = CONFIG.enemies[type];
    this.cfg = cfg;
    this.hp = cfg.hp;
    this.maxHp = cfg.hp;
    this.pos = new THREE.Vector3(x, 0, z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.alive = true;
    this.attackTimer = 1 + Math.random();
    this.retargetTimer = Math.random() * 0.4;
    this.attackAnim = 0;
    this.flash = 0;
    this.hitCooldown = 0;
    this.cycle = Math.random() * 6;
    this.target = null;
    this.radius = 0.4 * cfg.scale;

    const s = cfg.scale;
    const g = new THREE.Group();
    this.group = g;
    // body material is per-skeleton so it can flash on hit
    this.bodyMat = (type === 'brute' ? M.boneDark : M.bone).clone();
    const bm = this.bodyMat;

    this.legL = new THREE.Group(); this.legL.position.set(-0.12, 0.6, 0);
    this.legR = new THREE.Group(); this.legR.position.set(0.12, 0.6, 0);
    mesh(G.leg, bm, 0, -0.28, 0, this.legL);
    mesh(G.leg, bm, 0, -0.28, 0, this.legR);
    g.add(this.legL, this.legR);
    mesh(G.pelvis, bm, 0, 0.66, 0, g);
    mesh(G.spine, bm, 0, 0.98, 0, g);
    for (let i = 0; i < 3; i++) {
      const r = mesh(G.rib, bm, 0, 0.85 + i * 0.13, 0.02, g);
      r.rotation.x = Math.PI / 2;
      r.rotation.z = Math.PI;
      r.scale.setScalar(1 - i * 0.12);
    }
    mesh(G.skull, bm, 0, 1.5, 0, g);
    mesh(G.jaw, bm, 0, 1.32, 0.05, g);
    const eyeMat = type === 'brute' ? M.eyeBrute : M.eye;
    mesh(G.eye, eyeMat, -0.09, 1.53, 0.2, g);
    mesh(G.eye, eyeMat, 0.09, 1.53, 0.2, g);

    this.armL = new THREE.Group(); this.armL.position.set(-0.3, 1.22, 0);
    this.armR = new THREE.Group(); this.armR.position.set(0.3, 1.22, 0);
    mesh(G.arm, bm, 0, -0.28, 0, this.armL);
    mesh(G.arm, bm, 0, -0.28, 0, this.armR);
    g.add(this.armL, this.armR);

    if (type === 'archer') {
      const bow = mesh(G.bow, M.wood, 0, -0.5, 0.15, this.armL);
      bow.rotation.y = Math.PI / 2;
      bow.rotation.z = Math.PI / 2;
      mesh(G.string, M.bone, 0, -0.5, 0.15, this.armL);
      this.armL.rotation.x = -1.4;
      this.armR.rotation.x = -1.2;
    } else if (type === 'brute') {
      const club = mesh(G.club, M.wood, 0, -0.75, 0.15, this.armR);
      club.rotation.x = 0.4;
    } else {
      const blade = mesh(G.blade, M.steel, 0, -0.95, 0.1, this.armR);
      blade.rotation.x = 0.35;
      mesh(G.hilt, M.wood, 0, -0.56, 0.1, this.armR).rotation.x = 0.35;
    }

    // health bar (billboard)
    this.hpBar = new THREE.Group();
    this.hpBar.position.y = 1.95;
    this.hpBar.add(new THREE.Mesh(G.hpBg, M.hpBg));
    this.hpFg = new THREE.Mesh(G.hpFg, M.hpFg);
    this.hpFg.position.z = 0.01;
    this.hpBar.add(this.hpFg);
    this.hpBar.visible = false;
    this.hpBar.renderOrder = 20;
    g.add(this.hpBar);

    g.scale.setScalar(s);
    game.scene.add(g);
    this.place();
  }

  turnToward(want, k) {
    let dy = want - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, k);
  }

  place() {
    this.pos.y = this.game.terrain.heightAt(this.pos.x, this.pos.z);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
  }

  /** Choose what to go after. */
  retarget() {
    const g = this.game;
    const p = g.player.pos;
    const onFoot = !g.state.inVehicle && !g.state.ko && !g.state.sleeping;
    const dp = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    if (onFoot && dp < 7) { this.target = { kind: 'player', pos: p, r: 0.5 }; return; }
    let best = null, bd = 14, kind = 'turret';
    for (const t of g.turrets) {
      if (!t.alive) continue;
      const d = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
      if (d < bd) { bd = d; best = t; }
    }
    // mercenaries in the way get fought too (slightly preferred over turrets: they hit back)
    for (const m of g.mercs.list) {
      if (!m.alive) continue;
      const d = Math.hypot(m.pos.x - this.pos.x, m.pos.z - this.pos.z) - 2;
      if (d < bd) { bd = d; best = m; kind = 'merc'; }
    }
    if (onFoot && dp < 18 && dp < bd) { this.target = { kind: 'player', pos: p, r: 0.5 }; return; }
    if (best) { this.target = { kind, obj: best, pos: best.pos, r: kind === 'merc' ? 0.45 : 0.7 }; return; }
    this.target = { kind: 'plant', obj: g.washPlant, pos: g.washPlant.raidPos, r: 1.6 };
  }

  update(dt, camera) {
    if (!this.alive) return;
    const g = this.game, cfg = this.cfg, t = g.terrain;
    this.retargetTimer -= dt;
    if (this.retargetTimer <= 0 || !this.target) { this.retarget(); this.retargetTimer = 0.4; }
    if ((this.target.kind === 'turret' || this.target.kind === 'merc') && !this.target.obj.alive) this.retarget();
    if (this.target.kind === 'player' && (g.state.inVehicle || g.state.ko || g.state.sleeping)) this.retarget();

    const tp = this.target.pos;
    const dx = tp.x - this.pos.x, dz = tp.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    const nx = d > 1e-4 ? dx / d : 0, nz = d > 1e-4 ? dz / d : 0;
    const reach = this.type === 'archer' ? cfg.range : cfg.range + this.target.r;

    let mx = 0, mz = 0;
    if (this.type === 'archer') {
      if (d > cfg.keepDist + 2) { mx = nx; mz = nz; }
      else if (d < cfg.keepDist - 2.5) { mx = -nx; mz = -nz; }
    } else if (d > reach) { mx = nx; mz = nz; }

    // knockback velocity decays
    this.vel.multiplyScalar(Math.max(0, 1 - dt * 6));

    let moving = 0;
    if (mx !== 0 || mz !== 0) {
      let sx = this.pos.x + (mx * cfg.speed + this.vel.x) * dt;
      let sz = this.pos.z + (mz * cfg.speed + this.vel.z) * dt;
      if (t.heightAt(sx, sz) < WATER_LEVEL - 0.7) {
        // slide sideways around deep water
        sx = this.pos.x + (-mz * cfg.speed) * dt;
        sz = this.pos.z + (mx * cfg.speed) * dt;
      }
      if (t.inBounds(sx, sz, 3)) { this.pos.x = sx; this.pos.z = sz; }
      moving = 1;
      this.turnToward(Math.atan2(mx, mz), dt * 10);
    } else {
      this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
      if (d > 0.2) this.turnToward(Math.atan2(nx, nz), dt * 8);
    }
    // separation from other skeletons + static colliders/vehicles
    for (const o of g.enemies.list) {
      if (o === this || !o.alive) continue;
      const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
      const od = Math.hypot(ox, oz), min = this.radius + o.radius + 0.1;
      if (od < min && od > 1e-4) { this.pos.x += (ox / od) * (min - od) * 0.5; this.pos.z += (oz / od) * (min - od) * 0.5; }
    }
    g.resolveCollisions(this.pos, this.radius);

    // attack
    this.attackTimer -= dt;
    if (d <= reach && this.attackTimer <= 0) {
      this.attackTimer = cfg.attackInterval;
      this.attackAnim = 1;
      if (this.type === 'archer') {
        g.enemies.shootArrow(this, tp);
      } else {
        this.dealDamage(cfg.dmg);
      }
    }

    // animation
    if (moving) this.cycle += dt * 9;
    const sw = moving ? Math.sin(this.cycle) * 0.7 : 0;
    this.legL.rotation.x = sw;
    this.legR.rotation.x = -sw;
    if (this.type !== 'archer') {
      this.armL.rotation.x = -sw * 0.6;
      this.attackAnim = Math.max(0, this.attackAnim - dt * 3);
      const a = this.attackAnim;
      this.armR.rotation.x = a > 0 ? -2.3 + (1 - a) * 2.0 : -0.5 + sw * 0.6;
    } else {
      this.attackAnim = Math.max(0, this.attackAnim - dt * 2);
      this.armR.rotation.x = -1.2 - this.attackAnim * 0.4;
    }
    if (this.flash > 0) {
      this.flash -= dt;
      this.bodyMat.emissive.setScalar(this.flash > 0 ? 0.8 : 0);
    }
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    this.hpBar.visible = this.hp < this.maxHp;
    if (this.hpBar.visible) {
      this.hpBar.quaternion.copy(camera.quaternion);
      const f = this.hp / this.maxHp;
      this.hpFg.scale.x = f;
      this.hpFg.position.x = -(1 - f) * 0.4;
    }
    this.place();
  }

  dealDamage(dmg) {
    const g = this.game, tg = this.target;
    if (tg.kind === 'player') g.damagePlayer(dmg, this.pos);
    else if (tg.kind === 'turret') tg.obj.damage(dmg);
    else if (tg.kind === 'merc') tg.obj.damage(dmg, this.pos);
    else if (tg.kind === 'plant') g.washPlant.raid(dmg);
  }

  damage(amount, fromPos, knock = 4) {
    if (!this.alive) return false;
    this.hp -= amount;
    this.flash = 0.12;
    this.bodyMat.emissive.setScalar(0.8);
    if (fromPos) {
      const dx = this.pos.x - fromPos.x, dz = this.pos.z - fromPos.z;
      const d = Math.hypot(dx, dz) || 1;
      this.vel.x += (dx / d) * knock;
      this.vel.z += (dz / d) * knock;
    }
    if (this.hp <= 0) { this.die(true); return true; }
    return false;
  }

  die(bounty) {
    if (!this.alive) return;
    this.alive = false;
    const g = this.game;
    g.particles.burst(this.pos.x, this.pos.y + 0.9, this.pos.z, 26, BONE, 1.2, 3, 1.1);
    g.scene.remove(this.group);
    if (bounty) {
      const b = CONFIG.combat.bounty[this.type];
      g.state.money += b;
      g.state.kills++;
      g.enemies.killsTonight++;
      g.ui.toast(`Skeleton destroyed  +$${b}`);
    }
  }
}

// ------------------------------------------------------------------
export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.arrows = [];
    this.night = 0;
    this.killsTonight = 0;
    this.quota = 0;
    this.spawned = 0;
    this.spawnTimer = 0;
    this.nightActive = false;
    this.warned = false;
  }

  get aliveCount() { return this.list.length; }

  isNightHours(h) {
    const c = CONFIG.combat;
    return h >= c.nightStart || h < c.dawn;
  }

  startNight() {
    const c = CONFIG.combat;
    this.night++;
    this.nightActive = true;
    this.resolved = false;
    this.killsTonight = 0;
    this.spawned = 0;
    this.quota = Math.min(c.waveMax, c.waveBase + c.wavePerNight * (this.night - 1));
    this.spawnTimer = 4;
    this.game.ui.toast(`Night ${this.night} — the skeletons are coming!`, 'bad');
  }

  /** Called after loading a save mid-night: continue the current night with a reduced wave. */
  resumeNight() {
    const c = CONFIG.combat;
    if (this.night === 0) this.night = 1;
    this.nightActive = true;
    this.killsTonight = 0;
    this.spawned = 0;
    this.quota = Math.ceil(Math.min(c.waveMax, c.waveBase + c.wavePerNight * (this.night - 1)) / 2);
    this.spawnTimer = 8;
  }

  /** Type mix for a given night, in spawn order (used to roll the army you fight in your sleep). */
  rollType(night) {
    const r = Math.random();
    const pArcher = Math.min(0.4, 0.08 + 0.07 * night);
    const pBrute = night >= 3 ? Math.min(0.25, 0.06 * (night - 2)) : 0;
    return r < pBrute ? 'brute' : r < pBrute + pArcher ? 'archer' : 'sword';
  }

  /**
   * The player is going to sleep: hand the night's raid over to the dice battle. Returns the list of
   * enemy types that would have come tonight (those already in the field plus the rest of the wave)
   * and takes them out of the world so nothing spawns while the clock fast-forwards.
   */
  raidForSleep() {
    const c = CONFIG.combat;
    const army = [];
    if (this.nightActive) {
      for (const e of this.list) if (e.alive) army.push(e.type);
      for (let i = this.spawned; i < this.quota; i++) army.push(this.rollType(this.night));
      for (const e of this.list) e.die(false);
      this.list.length = 0;
      for (const a of this.arrows) this.game.scene.remove(a.mesh);
      this.arrows.length = 0;
      this.spawned = this.quota;
      this.nightActive = false;
    } else {
      // turning in before the raid starts: it still comes, but we settle it now
      this.night++;
      this.skipNextStart = true;
      const quota = Math.min(c.waveMax, c.waveBase + c.wavePerNight * (this.night - 1));
      for (let i = 0; i < quota; i++) army.push(this.rollType(this.night));
    }
    this.resolved = true; // no real-time raid for the rest of this night
    return army;
  }

  endNight() {
    this.nightActive = false;
    this.resolved = false;
    let n = 0;
    for (const e of this.list) { if (e.alive) { e.die(false); n++; } }
    this.list.length = 0;
    for (const a of this.arrows) this.game.scene.remove(a.mesh);
    this.arrows.length = 0;
    if (this.night > 0) this.game.ui.toast(`Dawn. ${n > 0 ? `${n} skeletons crumbled to dust. ` : ''}You survived night ${this.night}.`, 'gold');
  }

  spawnGroup(n) {
    const g = this.game, t = g.terrain, camp = t.sites.camp;
    const c = CONFIG.combat;
    const baseAng = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      let placed = false;
      for (let tries = 0; tries < 12 && !placed; tries++) {
        const ang = baseAng + (Math.random() - 0.5) * 0.8;
        const dist = 40 + Math.random() * 14;
        const x = camp.x + Math.cos(ang) * dist, z = camp.z + Math.sin(ang) * dist;
        if (!t.inBounds(x, z, 6) || t.heightAt(x, z) < WATER_LEVEL + 0.3) continue;
        this.list.push(new Skeleton(g, this.rollType(this.night), x, z));
        placed = true;
      }
      this.spawned++;
    }
  }

  shootArrow(from, targetPos) {
    const start = from.pos.clone(); start.y += 1.3 * from.cfg.scale;
    const end = targetPos.clone(); end.y += 0.9;
    const dir = end.clone().sub(start);
    const dist = dir.length();
    dir.normalize();
    const speed = 20;
    const vel = dir.multiplyScalar(speed);
    vel.y += dist * 0.15; // slight arc
    const m = new THREE.Mesh(G.arrow, M.wood);
    m.quaternion.setFromUnitVectors(UP, vel.clone().normalize());
    m.position.copy(start);
    this.game.scene.add(m);
    this.arrows.push({ mesh: m, pos: start, vel, life: 2.2, dmg: from.cfg.dmg });
  }

  updateArrows(dt) {
    const g = this.game, t = g.terrain;
    const onFoot = !g.state.inVehicle && !g.state.ko && !g.state.sleeping;
    const p = g.player.pos;
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.life -= dt;
      a.vel.y -= 7 * dt;
      a.pos.addScaledVector(a.vel, dt);
      a.mesh.position.copy(a.pos);
      a.mesh.quaternion.setFromUnitVectors(UP, a.vel.clone().normalize());
      let done = a.life <= 0 || a.pos.y < t.heightAt(a.pos.x, a.pos.z);
      if (!done && onFoot && Math.hypot(a.pos.x - p.x, a.pos.z - p.z) < 0.7 && a.pos.y > p.y && a.pos.y < p.y + 2.1) {
        g.damagePlayer(a.dmg, a.pos);
        done = true;
      }
      if (!done) {
        for (const tr of g.turrets) {
          if (tr.alive && Math.hypot(a.pos.x - tr.pos.x, a.pos.z - tr.pos.z) < 0.9 && a.pos.y < tr.pos.y + 1.8) { tr.damage(a.dmg); done = true; break; }
        }
      }
      if (!done) {
        for (const m of g.mercs.list) {
          if (m.alive && Math.hypot(a.pos.x - m.pos.x, a.pos.z - m.pos.z) < 0.7 && a.pos.y > m.pos.y && a.pos.y < m.pos.y + 2.0) { m.damage(a.dmg, a.pos); done = true; break; }
        }
      }
      if (done) { g.scene.remove(a.mesh); this.arrows.splice(i, 1); }
    }
  }

  update(dt, hours, prevHours, camera) {
    const c = CONFIG.combat;
    // night transitions (handle wrap at midnight)
    const crossed = (h) => (prevHours < h && hours >= h) || (prevHours > hours && (h > prevHours || h <= hours));
    if (crossed(c.nightStart)) {
      if (this.skipNextStart) this.skipNextStart = false; // tonight's raid was already fought at the inn
      else this.startNight();
    }
    if (crossed(c.dawn)) {
      if (this.nightActive || this.list.length) this.endNight();
      this.resolved = false;
    }
    if (!this.warned && crossed(19.5)) { this.warned = true; this.game.ui.toast('The skeletons come at nightfall. Grab your sword (4) and defend the camp!', 'bad'); }

    if (this.nightActive && this.spawned < this.quota && !(hours >= c.spawnEnd && hours < c.nightStart)) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        const group = Math.min(this.quota - this.spawned, 3 + Math.floor(this.night / 2));
        this.spawnGroup(group);
        this.spawnTimer = Math.max(10, 32 - this.night * 2);
      }
    }
    for (const e of this.list) e.update(dt, camera);
    for (let i = this.list.length - 1; i >= 0; i--) if (!this.list[i].alive) this.list.splice(i, 1);
    this.updateArrows(dt);
  }

  /** Damage all enemies in an arc in front of (x,z) facing yaw. Returns hits. */
  hitArc(pos, yaw, range, halfArc, dmg) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let hits = 0;
    for (const e of this.list) {
      if (!e.alive) continue;
      const dx = e.pos.x - pos.x, dz = e.pos.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > range + e.radius) continue;
      const cos = (dx * fx + dz * fz) / (d || 1);
      if (cos < Math.cos(halfArc) && d > 0.6) continue;
      e.damage(dmg, pos, 6);
      hits++;
    }
    return hits;
  }

  nearest(x, z, maxD) {
    let best = null, bd = maxD;
    for (const e of this.list) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - x, e.pos.z - z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  serialize() { return { night: this.night, warned: this.warned, skipNextStart: !!this.skipNextStart, resolved: !!this.resolved }; }
  deserialize(d) { if (d) { this.night = d.night || 0; this.warned = !!d.warned; this.skipNextStart = !!d.skipNextStart; this.resolved = !!d.resolved; } }
}
