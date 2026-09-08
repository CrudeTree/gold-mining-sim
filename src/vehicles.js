import * as THREE from 'three';
import { box, cyl } from './world.js';
import { CONFIG } from './config.js';
import { WATER_LEVEL, clamp, lerp, smoothstep } from './terrain.js';

const UP = new THREE.Vector3(0, 1, 0);
const YELLOW = 0xf2b632, DARK = 0x2f333a, STEEL = 0x8b939c, GLASS = 0x8fd3ff, TIRE = 0x23262b;

function std(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.1, ...extra });
}

export class Vehicle {
  constructor(game, pos, yaw, opts) {
    this.game = game;
    this.terrain = game.terrain;
    this.group = new THREE.Group();
    this.pos = new THREE.Vector3(pos.x, 0, pos.z);
    this.yaw = yaw;
    this.speed = 0;
    this.occupied = false;
    this.radius = opts.radius;
    this.maxSpeed = opts.maxSpeed;
    this.accel = opts.accel;
    this.turnRate = opts.turnRate;
    this.name = opts.name;
    this.wheels = [];
    this.headlights = [];
    this.wrecked = false; // sabotaged in a night raid — won't drive until repaired from the phone
    this.smokeTimer = 0;
    this._q1 = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._n = new THREE.Vector3();
    game.scene.add(this.group);
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  addHeadlight(x, y, z) {
    const lamp = box(0.3, 0.2, 0.1, new THREE.MeshStandardMaterial({ color: 0xfff4c0, emissive: 0xfff0a0, emissiveIntensity: 0 }), x, y, z, this.group);
    const spot = new THREE.SpotLight(0xfff1c8, 0, 40, 0.5, 0.45, 1.5);
    spot.position.set(x, y, z);
    spot.target.position.set(x, y - 1.5, z + 12);
    this.group.add(spot, spot.target);
    this.headlights.push({ lamp, spot });
  }

  drive(dt, input) {
    if (this.wrecked) { this.speed = 0; this.terrainMul = 1; return; }
    const th = (input.down('w') || input.down('arrowup') ? 1 : 0) - (input.down('s') || input.down('arrowdown') ? 1 : 0);
    const st = (input.down('a') || input.down('arrowleft') ? 1 : 0) - (input.down('d') || input.down('arrowright') ? 1 : 0);
    if (th !== 0) this.speed += th * this.accel * dt;
    else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), this.accel * 1.4 * dt);
    this.speed = clamp(this.speed, -this.maxSpeed * 0.5, this.maxSpeed);
    if (Math.abs(this.speed) > 0.05) {
      this.yaw += st * this.turnRate * dt * Math.sign(this.speed) * Math.min(1, Math.abs(this.speed) / 2.5);
    }
    const f = this.forward(this._n);
    // Terrain resistance: steep climbs and deep water/mud slow you down but never freeze you,
    // and moving toward shallower ground is always allowed so a vehicle can crawl out of a hole.
    const probe = Math.max(0.6, this.radius * 0.5);
    const hHere = this.terrain.heightAt(this.pos.x, this.pos.z);
    const hAhead = this.terrain.heightAt(this.pos.x + f.x * probe * Math.sign(this.speed || 1), this.pos.z + f.z * probe * Math.sign(this.speed || 1));
    const grade = (hAhead - hHere) / probe; // rise per metre in the direction of travel
    let mul = grade > 0 ? clamp(1 - grade * 0.55, 0.3, 1) : clamp(1 + grade * 0.15, 0.85, 1.2);
    const depth = WATER_LEVEL - hHere;
    if (depth > 0.3) mul *= clamp(1 - (depth - 0.3) * 0.7, 0.25, 1); // bogged in deep water
    this.terrainMul = mul;
    const nx = this.pos.x + f.x * this.speed * mul * dt;
    const nz = this.pos.z + f.z * this.speed * mul * dt;
    const h = this.terrain.heightAt(nx, nz);
    if (!this.terrain.inBounds(nx, nz, 6) || (h < WATER_LEVEL - 1.4 && h < hHere - 0.02)) {
      this.speed = 0;
      return;
    }
    this.pos.x = nx; this.pos.z = nz;
    // Touching something: bleed speed over time (not per frame) so you can still slide/creep around it
    if (this.game.resolveCollisions(this.pos, this.radius, this)) this.speed *= Math.max(0, 1 - 4 * dt);

    // Run over skeletons
    if (Math.abs(this.speed) > 2.5 && this.game.enemies) {
      for (const e of this.game.enemies.list) {
        if (!e.alive || e.hitCooldown > 0) continue;
        if (Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z) < this.radius + e.radius) {
          e.hitCooldown = 0.8;
          e.damage(CONFIG.combat.vehicleHitDamage, this.pos, 9);
          this.speed *= 0.85;
        }
      }
    }
  }

  place() {
    const t = this.terrain;
    const f = this.forward(this._n);
    const rx = f.z, rz = -f.x;
    const L = this.radius * 0.7;
    // average normal over footprint
    const n = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    n.add(t.normalAt(this.pos.x + f.x * L, this.pos.z + f.z * L, tmp));
    n.add(t.normalAt(this.pos.x - f.x * L, this.pos.z - f.z * L, tmp));
    n.add(t.normalAt(this.pos.x + rx * L * 0.6, this.pos.z + rz * L * 0.6, tmp));
    n.add(t.normalAt(this.pos.x - rx * L * 0.6, this.pos.z - rz * L * 0.6, tmp));
    n.normalize();
    this.pos.y = t.heightAt(this.pos.x, this.pos.z);
    this._q1.setFromUnitVectors(UP, n);
    this._q2.setFromAxisAngle(UP, this.yaw);
    this.group.quaternion.copy(this._q1).multiply(this._q2);
    this.group.position.copy(this.pos);
    this.group.updateMatrixWorld(true);
  }

  updateCommon(dt, night) {
    for (const w of this.wheels) w.rotation.x += (this.speed * dt) / 0.55;
    const on = this.occupied && night > 0.25 && !this.wrecked ? night : 0;
    for (const h of this.headlights) {
      h.spot.intensity = on * 260;
      h.lamp.material.emissiveIntensity = on * 2;
    }
    if (this.wrecked) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.12;
        const f = this.forward(this._n);
        this.game.particles.burst(this.pos.x + f.x * 1.2, this.pos.y + 2.4, this.pos.z + f.z * 1.2, 3, 0x3a3a3c, 0.9, 1.6, 2.4, -0.9);
      }
    }
  }

  wreck() { this.wrecked = true; this.speed = 0; }
  repair() { this.wrecked = false; }

  serialize() {
    return { x: this.pos.x, z: this.pos.z, yaw: this.yaw, wrecked: this.wrecked };
  }
  deserialize(d) {
    if (!d) return;
    this.pos.set(d.x, 0, d.z);
    this.yaw = d.yaw;
    this.speed = 0;
    this.wrecked = !!d.wrecked;
    this.place();
  }
}

// ------------------------------------------------------------------
export class DumpTruck extends Vehicle {
  constructor(game, pos, yaw) {
    super(game, pos, yaw, { radius: 2.6, maxSpeed: CONFIG.truck.maxSpeed, accel: CONFIG.truck.accel, turnRate: CONFIG.truck.turnRate, name: 'Dump Truck' });
    this.capacity = CONFIG.truck.capacity;
    this.load = 0;
    this.loadGold = 0;
    this.dumpTimer = -1;
    this.pendingDump = null;

    const g = this.group;
    box(2.3, 0.45, 5.6, DARK, 0, 0.95, 0, g); // chassis
    const cab = box(2.4, 1.5, 1.7, YELLOW, 0, 1.95, 1.9, g);
    box(2.2, 0.7, 0.2, GLASS, 0, 2.2, 2.78, g); // windshield
    box(0.2, 0.6, 1.0, GLASS, 1.15, 2.2, 1.9, g);
    box(0.2, 0.6, 1.0, GLASS, -1.15, 2.2, 1.9, g);
    box(2.4, 0.8, 0.9, YELLOW, 0, 1.6, 3.2, g); // hood
    box(2.0, 0.3, 0.3, STEEL, 0, 1.2, 3.75, g); // bumper
    box(0.4, 0.4, 0.8, DARK, 0.9, 2.9, 1.7, g); // exhaust
    this.addHeadlight(0.8, 1.75, 3.7);
    this.addHeadlight(-0.8, 1.75, 3.7);

    // bed (pivot at rear)
    this.bed = new THREE.Group();
    this.bed.position.set(0, 1.25, -2.7);
    g.add(this.bed);
    const bedMat = std(0xe0a52a);
    box(2.4, 0.15, 3.6, bedMat, 0, 0.05, 1.9, this.bed); // floor
    box(0.12, 1.1, 3.6, bedMat, 1.15, 0.6, 1.9, this.bed);
    box(0.12, 1.1, 3.6, bedMat, -1.15, 0.6, 1.9, this.bed);
    box(2.4, 1.3, 0.12, bedMat, 0, 0.75, 3.7, this.bed); // front wall (higher)
    box(2.4, 0.9, 0.12, bedMat, 0, 0.5, 0.1, this.bed); // tailgate
    this.loadMesh = box(2.15, 1, 3.4, std(0x8a5a30, { roughness: 1 }), 0, 0.15, 1.9, this.bed);
    this.loadMesh.castShadow = false;

    // wheels
    const wheelGeo = new THREE.CylinderGeometry(0.58, 0.58, 0.5, 14);
    const wheelMat = std(TIRE, { roughness: 1 });
    const hubMat = std(0xd8d8d8);
    for (const [x, z] of [[1.15, 2.1], [-1.15, 2.1], [1.15, -0.9], [-1.15, -0.9], [1.15, -2.2], [-1.15, -2.2]]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.castShadow = true;
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.58, z);
      pivot.add(w);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.52, 10), hubMat);
      hub.rotation.z = Math.PI / 2;
      pivot.add(hub);
      g.add(pivot);
      this.wheels.push(pivot);
    }
    this.updateLoadMesh();
    this.place();
  }

  get fill() { return this.load / this.capacity; }
  get richness() { return this.load > 0 ? this.loadGold / this.load : 0; }

  addLoad(vol, gold) {
    const accept = Math.max(0, Math.min(vol, this.capacity - this.load));
    if (accept <= 0) return 0;
    this.load += accept;
    this.loadGold += gold * (accept / vol);
    this.updateLoadMesh();
    return accept;
  }

  takeAll() {
    const r = { vol: this.load, gold: this.loadGold };
    this.load = 0; this.loadGold = 0;
    this.updateLoadMesh();
    return r;
  }

  updateLoadMesh() {
    const f = Math.max(0.02, this.fill);
    this.loadMesh.visible = this.load > 0.01;
    this.loadMesh.scale.y = f * 1.1;
    this.loadMesh.position.y = 0.12 + (f * 1.1) / 2;
  }

  bedWorldPos(out = new THREE.Vector3()) {
    return this.group.localToWorld(out.set(0, 1.9, -0.8));
  }

  /** Start a tipping animation; onMid called at the top of the tip. */
  startDump(onMid) {
    if (this.dumpTimer >= 0) return false;
    this.dumpTimer = 0;
    this.pendingDump = onMid;
    return true;
  }

  update(dt, night) {
    this.updateCommon(dt, night);
    if (this.dumpTimer >= 0) {
      this.dumpTimer += dt;
      const t = this.dumpTimer / 2.2;
      const tilt = Math.sin(Math.min(1, t) * Math.PI);
      this.bed.rotation.x = -tilt * 0.9;
      if (this.pendingDump && t >= 0.45) { this.pendingDump(); this.pendingDump = null; }
      if (t >= 1) { this.dumpTimer = -1; this.bed.rotation.x = 0; }
    }
    this.place();
  }

  serialize() { return { ...super.serialize(), load: this.load, loadGold: this.loadGold }; }
  deserialize(d) {
    super.deserialize(d);
    if (d) { this.load = d.load || 0; this.loadGold = d.loadGold || 0; this.updateLoadMesh(); }
  }
}

// ------------------------------------------------------------------
export class Excavator extends Vehicle {
  constructor(game, pos, yaw) {
    super(game, pos, yaw, { radius: 2.4, maxSpeed: CONFIG.excavator.maxSpeed, accel: CONFIG.excavator.accel, turnRate: CONFIG.excavator.turnRate, name: 'Excavator' });
    this.isDigger = true;
    this.singleScoop = true; // holds exactly one scoop: dig, swing to the truck, dump, repeat
    this.bucket = 0;
    this.bucketGold = 0;
    this.L1 = 3.6;
    this.L2 = 2.8;
    this.pivotLocal = new THREE.Vector3(0, 0.8, 0.95);
    this.rest = { a1: 1.05, e: 1.25 };
    this.cur = { a1: 1.05, e: 1.25, curl: 0 };
    this.target = { a1: 1.05, e: 1.25 };
    this.cycle = -1; // -1 idle, else 0..1
    this.digPoint = new THREE.Vector3();
    this.turretYaw = 0;
    this.turretTargetYaw = 0;

    const g = this.group;
    // tracks
    for (const x of [-1.05, 1.05]) {
      box(0.75, 0.75, 3.8, DARK, x, 0.42, 0, g);
      box(0.85, 0.25, 4.0, 0x3d4249, x, 0.85, 0, g);
      for (let i = 0; i < 4; i++) cyl(0.32, 0.32, 0.8, 0x4a5058, x, 0.42, -1.4 + i * 0.93, g, 10).rotation.z = Math.PI / 2;
    }
    box(2.0, 0.35, 2.4, STEEL, 0, 0.98, 0, g);

    // turret
    this.turret = new THREE.Group();
    this.turret.position.y = 1.15;
    g.add(this.turret);
    box(2.3, 1.1, 2.9, YELLOW, 0, 0.55, -0.25, this.turret); // body
    box(2.3, 0.6, 0.8, DARK, 0, 0.55, -1.75, this.turret); // counterweight
    const cab = box(1.05, 1.25, 1.35, YELLOW, -0.62, 1.7, 0.55, this.turret);
    box(0.9, 0.7, 0.1, GLASS, -0.62, 1.85, 1.25, this.turret);
    box(0.1, 0.7, 1.1, GLASS, -1.17, 1.85, 0.55, this.turret);
    box(1.1, 0.1, 1.45, DARK, -0.62, 2.36, 0.55, this.turret);
    box(0.3, 0.5, 0.3, DARK, 0.7, 1.35, -1.2, this.turret); // exhaust
    this.addHeadlight(-0.62, 2.2, 1.28);

    // boom
    this.boom = new THREE.Group();
    this.boom.position.copy(this.pivotLocal);
    this.turret.add(this.boom);
    const boomMesh = box(0.5, 0.55, this.L1, YELLOW, 0, 0, this.L1 / 2, this.boom);
    boomMesh.position.y = 0.1;
    // stick
    this.stick = new THREE.Group();
    this.stick.position.set(0, 0, this.L1);
    this.boom.add(this.stick);
    box(0.4, 0.42, this.L2, YELLOW, 0, 0, this.L2 / 2, this.stick);
    // bucket
    this.bucketGroup = new THREE.Group();
    this.bucketGroup.position.set(0, 0, this.L2);
    this.stick.add(this.bucketGroup);
    const bm = std(0x5c6169, { metalness: 0.3 });
    box(1.4, 0.12, 0.9, bm, 0, -0.45, 0.45, this.bucketGroup); // floor
    box(1.4, 0.9, 0.12, bm, 0, 0.0, 0.05, this.bucketGroup); // back
    box(0.12, 0.9, 0.9, bm, 0.7, 0.0, 0.45, this.bucketGroup);
    box(0.12, 0.9, 0.9, bm, -0.7, 0.0, 0.45, this.bucketGroup);
    for (let i = -1; i <= 1; i++) box(0.18, 0.12, 0.35, STEEL, i * 0.5, -0.45, 1.0, this.bucketGroup); // teeth
    this.bucketFill = box(1.2, 0.5, 0.75, std(0x8a5a30, { roughness: 1 }), 0, -0.15, 0.45, this.bucketGroup);
    this.bucketFill.castShadow = false;
    this.setBucketLevel(0);
    this.updateBucketMesh();

    // hydraulic cylinders (cosmetic)
    cyl(0.09, 0.09, 1.6, STEEL, 0, 0.5, 1.2, this.boom, 8).rotation.x = Math.PI / 2 - 0.15;

    this.applyPose();
    this.place();
  }

  setBucketLevel(lvl) {
    const c = CONFIG.excavator;
    this.digRadius = c.digRadius[lvl];
    this.digAmount = c.digAmount[lvl];
    // nominal volume of one full scoop (used only for the fill readout)
    this.capacity = (Math.PI * this.digRadius * this.digRadius / 3) * this.digAmount;
    this.bucketGroup.scale.setScalar(1 + 0.18 * lvl);
  }

  /** One scoop fills the bucket, however much it actually picked up. */
  get isFull() { return this.bucket > 0.01; }
  get fill() { return this.isFull ? 1 : 0; }
  get richness() { return this.bucket > 0 ? this.bucketGold / this.bucket : 0; }

  updateBucketMesh() {
    const f = this.isFull ? Math.min(1, Math.max(0.35, this.bucket / this.capacity)) : 0.03;
    this.bucketFill.visible = this.isFull;
    this.bucketFill.scale.y = f;
    this.bucketFill.position.y = -0.4 + f * 0.25;
  }

  takeAll() {
    const r = { vol: this.bucket, gold: this.bucketGold };
    this.bucket = 0; this.bucketGold = 0;
    this.updateBucketMesh();
    return r;
  }

  bucketWorldPos(out = new THREE.Vector3()) {
    this.bucketGroup.updateWorldMatrix(true, false);
    return this.bucketGroup.getWorldPosition(out);
  }

  pivotWorldPos(out = new THREE.Vector3()) {
    this.turret.updateWorldMatrix(true, false);
    return this.turret.localToWorld(out.copy(this.pivotLocal));
  }

  /** Compute dig point from an aim point (clamped to reach). */
  setAim(aim) {
    const pivot = this.pivotWorldPos(new THREE.Vector3());
    if (!aim) {
      const f = this.forward(new THREE.Vector3());
      aim = new THREE.Vector3(pivot.x + f.x * 4, 0, pivot.z + f.z * 4);
    }
    let dx = aim.x - pivot.x, dz = aim.z - pivot.z;
    let d = Math.hypot(dx, dz);
    if (d < 1e-3) { dx = Math.sin(this.yaw); dz = Math.cos(this.yaw); d = 1; }
    const reach = clamp(d, CONFIG.excavator.minReach, CONFIG.excavator.maxReach);
    dx /= d; dz /= d;
    this.digPoint.set(pivot.x + dx * reach, 0, pivot.z + dz * reach);
    this.digPoint.y = this.terrain.heightAt(this.digPoint.x, this.digPoint.z);
    // turret yaw in vehicle frame
    const local = this.group.worldToLocal(this.digPoint.clone());
    this.turretTargetYaw = Math.atan2(local.x, local.z);

    // IK target relative to pivot, in turret frame (after turret faces target)
    const hd = reach;
    const dy = this.digPoint.y + 0.25 - pivot.y;
    let r = Math.hypot(hd, dy);
    const rMax = this.L1 + this.L2 - 0.08, rMin = Math.abs(this.L1 - this.L2) + 0.3;
    const rc = clamp(r, rMin, rMax);
    const k = rc / r;
    const hd2 = hd * k, dy2 = dy * k;
    const cosE = clamp((this.L1 ** 2 + this.L2 ** 2 - rc ** 2) / (2 * this.L1 * this.L2), -1, 1);
    const E = Math.acos(cosE);
    const phi = Math.atan2(dy2, hd2);
    const alpha = Math.acos(clamp((this.L1 ** 2 + rc ** 2 - this.L2 ** 2) / (2 * this.L1 * rc), -1, 1));
    this.target.a1 = phi + alpha;
    this.target.e = E;
  }

  applyPose() {
    const { a1, e, curl } = this.cur;
    this.boom.rotation.x = -a1;
    this.stick.rotation.x = Math.PI - e;
    const a2 = a1 - (Math.PI - e); // absolute stick angle
    this.bucketGroup.rotation.x = a2 + Math.PI / 2 - 0.55 + curl * 1.2;
  }

  startDig() {
    if (this.cycle >= 0) return false;
    if (this.isFull) return false;
    this.cycle = 0;
    return true;
  }

  update(dt, night, input, aim) {
    this.updateCommon(dt, night);
    if (this.occupied) this.setAim(aim);

    // turret rotate
    let dy = this.turretTargetYaw - this.turretYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.turretYaw += dy * Math.min(1, dt * (this.occupied ? 3.5 : 1));
    this.turret.rotation.y = this.turretYaw;

    // dig cycle
    let blend = 0, curl = 0;
    if (this.cycle >= 0) {
      const prev = this.cycle;
      this.cycle += dt / CONFIG.excavator.cycleTime;
      const p = this.cycle;
      if (p < 0.38) blend = smoothstep(0, 1, p / 0.38);
      else if (p < 0.62) blend = 1;
      else blend = 1 - smoothstep(0, 1, (p - 0.62) / 0.38);
      curl = Math.sin(clamp((p - 0.4) / 0.35, 0, 1) * Math.PI);
      if (prev < 0.5 && p >= 0.5) this.game.excavatorScoop(this);
      if (p >= 1) { this.cycle = -1; blend = 0; }
    }
    const tgtA1 = this.occupied ? lerp(this.rest.a1, this.target.a1, blend) : this.rest.a1;
    const tgtE = this.occupied ? lerp(this.rest.e, this.target.e, blend) : this.rest.e;
    this.cur.a1 += (tgtA1 - this.cur.a1) * Math.min(1, dt * 8);
    this.cur.e += (tgtE - this.cur.e) * Math.min(1, dt * 8);
    this.cur.curl = curl;
    this.applyPose();
    this.place();
  }

  serialize() { return { ...super.serialize(), bucket: this.bucket, bucketGold: this.bucketGold }; }
  deserialize(d) {
    super.deserialize(d);
    if (d) { this.bucket = d.bucket || 0; this.bucketGold = d.bucketGold || 0; this.updateBucketMesh(); }
  }
}

// ------------------------------------------------------------------
export class Bulldozer extends Vehicle {
  constructor(game, pos, yaw) {
    const c = CONFIG.dozer;
    super(game, pos, yaw, { radius: 2.4, maxSpeed: c.maxSpeed, accel: c.accel, turnRate: c.turnRate, name: 'Bulldozer' });
    this.isDozer = true;
    this.working = 0;   // 0..1 — blade dips and shakes while earthworks are running
    this.workPhase = 0;

    const g = this.group;
    // tracks
    for (const x of [-1.15, 1.15]) {
      box(0.8, 0.8, 4.0, DARK, x, 0.45, 0, g);
      box(0.9, 0.25, 4.2, 0x3d4249, x, 0.9, 0, g);
      for (let i = 0; i < 5; i++) cyl(0.32, 0.32, 0.85, 0x4a5058, x, 0.45, -1.6 + i * 0.8, g, 10).rotation.z = Math.PI / 2;
    }
    box(2.3, 0.4, 3.6, STEEL, 0, 1.05, 0, g);
    box(2.2, 1.1, 2.0, YELLOW, 0, 1.75, 0.6, g); // engine hood
    box(1.6, 0.4, 0.3, DARK, 0, 1.7, 1.65, g); // grille
    box(0.25, 0.7, 0.25, DARK, 0.7, 2.6, 1.0, g); // exhaust
    box(1.8, 1.3, 1.5, YELLOW, 0, 1.95, -1.0, g); // cab
    box(1.7, 0.75, 0.12, GLASS, 0, 2.1, -0.24, g);
    box(0.12, 0.75, 1.3, GLASS, 0.92, 2.1, -1.0, g);
    box(0.12, 0.75, 1.3, GLASS, -0.92, 2.1, -1.0, g);
    box(1.9, 0.1, 1.7, DARK, 0, 2.65, -1.0, g);
    box(1.4, 0.7, 0.5, DARK, 0, 1.6, -2.1, g); // ripper block
    this.addHeadlight(0.65, 2.45, -0.2);
    this.addHeadlight(-0.65, 2.45, -0.2);

    // push arms + blade
    this.armsGroup = new THREE.Group();
    this.armsGroup.position.set(0, 0.9, 0.4);
    g.add(this.armsGroup);
    for (const x of [-1.5, 1.5]) box(0.2, 0.25, 2.6, YELLOW, x, 0.2, 1.3, this.armsGroup);
    this.blade = new THREE.Group();
    this.blade.position.set(0, 0, 2.65);
    this.armsGroup.add(this.blade);
    const bm = std(0x5c6169, { metalness: 0.3 });
    const plate = box(3.6, 1.3, 0.18, bm, 0, 0.55, 0, this.blade);
    plate.rotation.x = -0.25;
    box(3.6, 0.12, 0.4, STEEL, 0, -0.05, 0.12, this.blade); // cutting edge
    box(0.15, 1.0, 0.5, bm, 1.75, 0.5, 0.15, this.blade);
    box(0.15, 1.0, 0.5, bm, -1.75, 0.5, 0.15, this.blade);
    this.armsGroup.rotation.x = -0.3; // blade carried clear of the ground
    this.place();
  }

  // The dozer carries no dirt; earthworks are paid for, not hauled. Keeps the label code simple.
  get fill() { return 0; }
  get richness() { return 0; }
  get load() { return 0; }

  update(dt, night) {
    this.updateCommon(dt, night);
    this.workPhase += dt * 18;
    this.armsGroup.rotation.x = -0.3 + this.working * (0.12 + 0.03 * Math.sin(this.workPhase));
    this.working = Math.max(0, this.working - dt * 3);
    this.place();
  }
}

// ------------------------------------------------------------------
export class FrontLoader extends Vehicle {
  constructor(game, pos, yaw) {
    const c = CONFIG.loader;
    super(game, pos, yaw, { radius: 2.3, maxSpeed: c.maxSpeed, accel: c.accel, turnRate: c.turnRate, name: 'Front Loader' });
    this.isDigger = true;
    this.digRadius = c.digRadius;
    this.digAmount = c.digAmount;
    this.capacity = c.capacity;
    this.bucket = 0;
    this.bucketGold = 0;
    this.cycle = -1;
    this.dumpTimer = -1;
    this.pendingDump = null;
    this.digPoint = new THREE.Vector3();
    this.lift = -0.15;   // arm angle (rotation.x); more negative = higher
    this.tilt = -0.35;   // bucket tilt; negative = curled back, positive = dumping forward

    const g = this.group;
    box(2.2, 1.25, 2.3, YELLOW, 0, 1.35, -1.3, g); // rear engine
    box(1.6, 0.5, 0.3, DARK, 0, 1.25, -2.5, g); // grille
    box(0.3, 0.5, 0.3, DARK, 0.7, 2.2, -1.9, g); // exhaust
    box(2.0, 0.6, 1.5, YELLOW, 0, 1.0, 0.6, g); // front frame
    box(2.0, 0.3, 0.9, DARK, 0, 0.75, -0.2, g); // articulation
    const cab = box(1.6, 1.3, 1.5, YELLOW, 0, 2.45, -0.4, g);
    box(1.5, 0.75, 0.12, GLASS, 0, 2.6, 0.38, g);
    box(0.12, 0.75, 1.3, GLASS, 0.82, 2.6, -0.4, g);
    box(0.12, 0.75, 1.3, GLASS, -0.82, 2.6, -0.4, g);
    box(1.7, 0.1, 1.6, DARK, 0, 3.15, -0.4, g);
    this.addHeadlight(0.7, 2.75, 0.4);
    this.addHeadlight(-0.7, 2.75, 0.4);

    const wheelGeo = new THREE.CylinderGeometry(0.78, 0.78, 0.6, 14);
    const wheelMat = std(TIRE, { roughness: 1 });
    const hubMat = std(0xe0a52a);
    for (const [x, z] of [[1.2, 1.1], [-1.2, 1.1], [1.2, -1.6], [-1.2, -1.6]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.78, z);
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.castShadow = true;
      pivot.add(w);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.62, 10), hubMat);
      hub.rotation.z = Math.PI / 2;
      pivot.add(hub);
      g.add(pivot);
      this.wheels.push(pivot);
    }

    // lift arms
    this.arms = new THREE.Group();
    this.arms.position.set(0, 1.55, 0.9);
    g.add(this.arms);
    for (const x of [-0.9, 0.9]) {
      const a = box(0.22, 0.32, 2.7, YELLOW, x, 0, 1.3, this.arms);
      a.position.y = 0.05;
    }
    box(2.0, 0.18, 0.18, YELLOW, 0, 0.1, 1.2, this.arms); // cross member
    // bucket
    this.bucketGroup = new THREE.Group();
    this.bucketGroup.position.set(0, 0, 2.65);
    this.arms.add(this.bucketGroup);
    const bm = std(0x5c6169, { metalness: 0.3 });
    box(2.8, 0.12, 1.2, bm, 0, -0.45, 0.6, this.bucketGroup); // floor
    box(2.8, 0.95, 0.12, bm, 0, 0.0, 0.05, this.bucketGroup); // back
    box(0.12, 0.95, 1.2, bm, 1.4, 0.0, 0.6, this.bucketGroup);
    box(0.12, 0.95, 1.2, bm, -1.4, 0.0, 0.6, this.bucketGroup);
    for (let i = -2; i <= 2; i++) box(0.22, 0.1, 0.35, STEEL, i * 0.55, -0.45, 1.3, this.bucketGroup);
    this.bucketFill = box(2.6, 0.5, 1.0, std(0x8a5a30, { roughness: 1 }), 0, -0.15, 0.6, this.bucketGroup);
    this.bucketFill.castShadow = false;
    this.updateBucketMesh();
    this.applyPose();
    this.place();
  }

  get fill() { return this.bucket / this.capacity; }
  get isFull() { return this.bucket >= this.capacity - 0.01; }
  get richness() { return this.bucket > 0 ? this.bucketGold / this.bucket : 0; }

  updateBucketMesh() {
    const f = Math.max(0.03, this.fill);
    this.bucketFill.visible = this.bucket > 0.01;
    this.bucketFill.scale.y = f;
    this.bucketFill.position.y = -0.4 + f * 0.25;
  }

  takeAll() {
    const r = { vol: this.bucket, gold: this.bucketGold };
    this.bucket = 0; this.bucketGold = 0;
    this.updateBucketMesh();
    return r;
  }

  bucketWorldPos(out = new THREE.Vector3()) {
    this.bucketGroup.updateWorldMatrix(true, false);
    return this.bucketGroup.getWorldPosition(out).add(this.forward(new THREE.Vector3()).multiplyScalar(0.6));
  }

  applyPose() {
    this.arms.rotation.x = this.lift;
    this.bucketGroup.rotation.x = this.tilt - this.lift; // keep bucket angle world-relative
  }

  setAim() {
    const f = this.forward(new THREE.Vector3());
    this.digPoint.set(this.pos.x + f.x * 3.9, 0, this.pos.z + f.z * 3.9);
    this.digPoint.y = this.terrain.heightAt(this.digPoint.x, this.digPoint.z);
  }

  startDig() {
    if (this.cycle >= 0 || this.dumpTimer >= 0) return false;
    if (this.isFull) return false;
    this.cycle = 0;
    return true;
  }

  /** Raise and tip the bucket; onMid runs at the top of the tip. */
  startDump(onMid) {
    if (this.dumpTimer >= 0 || this.cycle >= 0) return false;
    this.dumpTimer = 0;
    this.pendingDump = onMid;
    return true;
  }

  update(dt, night) {
    this.updateCommon(dt, night);
    this.setAim();
    let tgtLift = -0.15, tgtTilt = -0.35;
    if (this.cycle >= 0) {
      const prev = this.cycle;
      this.cycle += dt / CONFIG.loader.cycleTime;
      const p = this.cycle;
      tgtLift = 0.08;
      tgtTilt = p < 0.5 ? 0.35 : -0.5;
      if (prev < 0.5 && p >= 0.5) this.game.excavatorScoop(this);
      if (p >= 1) this.cycle = -1;
    } else if (this.dumpTimer >= 0) {
      this.dumpTimer += dt;
      const p = this.dumpTimer / CONFIG.loader.dumpTime;
      tgtLift = -1.05;
      tgtTilt = p > 0.35 && p < 0.8 ? 1.1 : -0.35;
      if (this.pendingDump && p >= 0.5) { this.pendingDump(); this.pendingDump = null; }
      if (p >= 1) this.dumpTimer = -1;
    }
    this.lift += (tgtLift - this.lift) * Math.min(1, dt * 5);
    this.tilt += (tgtTilt - this.tilt) * Math.min(1, dt * 7);
    this.applyPose();
    this.place();
  }

  serialize() { return { ...super.serialize(), bucket: this.bucket, bucketGold: this.bucketGold }; }
  deserialize(d) {
    super.deserialize(d);
    if (d) { this.bucket = d.bucket || 0; this.bucketGold = d.bucketGold || 0; this.updateBucketMesh(); }
  }
}
