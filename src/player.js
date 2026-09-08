import * as THREE from 'three';
import { box, cyl, sphere } from './world.js';

const SKIN = 0xf3c48f, SHIRT = 0xd94a3d, PANTS = 0x3b5b8c, HAT = 0x8a5a2b, BOOT = 0x4a3220;

function std(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
}

export class Player {
  constructor(scene, terrain, pos) {
    this.terrain = terrain;
    this.pos = new THREE.Vector3(pos.x, 0, pos.z);
    this.yaw = 0;
    this.radius = 0.45;
    this.cycle = 0;
    this.useTimer = 0;
    this.tool = 0;

    const g = new THREE.Group();
    this.group = g;

    // legs (pivot at hips)
    this.legL = new THREE.Group(); this.legL.position.set(-0.16, 0.55, 0);
    this.legR = new THREE.Group(); this.legR.position.set(0.16, 0.55, 0);
    for (const leg of [this.legL, this.legR]) {
      box(0.24, 0.5, 0.26, PANTS, 0, -0.25, 0, leg);
      box(0.26, 0.14, 0.34, BOOT, 0, -0.5, 0.04, leg);
      g.add(leg);
    }
    // torso
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 0.42, 6, 14), std(SHIRT));
    torso.position.y = 1.0;
    torso.castShadow = true;
    g.add(torso);
    // suspenders
    box(0.1, 0.55, 0.05, 0x5a3a20, -0.15, 1.05, 0.33, g);
    box(0.1, 0.55, 0.05, 0x5a3a20, 0.15, 1.05, 0.33, g);
    // head + hat
    sphere(0.3, SKIN, 0, 1.62, 0, g, 16);
    const beard = sphere(0.2, 0xd8b98a, 0, 1.47, 0.16, g, 10);
    beard.scale.set(1.2, 0.8, 0.8);
    cyl(0.48, 0.48, 0.06, HAT, 0, 1.8, 0, g, 16);
    cyl(0.3, 0.33, 0.28, HAT, 0, 1.96, 0, g, 16);
    // arms (pivot at shoulder)
    this.armL = new THREE.Group(); this.armL.position.set(-0.42, 1.28, 0);
    this.armR = new THREE.Group(); this.armR.position.set(0.42, 1.28, 0);
    for (const arm of [this.armL, this.armR]) {
      const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.42, 4, 10), std(SHIRT));
      a.position.y = -0.28;
      a.castShadow = true;
      arm.add(a);
      sphere(0.12, SKIN, 0, -0.56, 0, arm, 10);
      g.add(arm);
    }

    // ---- tools (attached to right hand) ----
    this.hand = new THREE.Group();
    this.hand.position.set(0, -0.56, 0);
    this.armR.add(this.hand);

    // Shovel: handle along -y of hand, blade at the end
    const shovel = new THREE.Group();
    cyl(0.035, 0.035, 1.35, 0x8b5a2b, 0, -0.35, 0, shovel, 8);
    const blade = box(0.32, 0.42, 0.05, std(0x8d939b, { metalness: 0.6, roughness: 0.4 }), 0, -1.15, 0, shovel);
    blade.rotation.x = 0.25;
    box(0.12, 0.05, 0.22, 0x8b5a2b, 0, 0.34, 0, shovel);
    this.shovel = shovel;

    // Pan
    const pan = new THREE.Group();
    const dish = cyl(0.4, 0.28, 0.1, std(0x2b2f36, { metalness: 0.5, roughness: 0.5 }), 0, -0.1, 0.15, pan, 18);
    dish.rotation.x = 0.35;
    this.pan = pan;

    // Torch
    const torch = new THREE.Group();
    cyl(0.04, 0.05, 0.75, 0x6f4a26, 0, 0.1, 0, torch, 8);
    const wrap = cyl(0.075, 0.075, 0.18, 0x3a2a1a, 0, 0.42, 0, torch, 8);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.11, 0.36, 8),
      new THREE.MeshStandardMaterial({ color: 0xffb04a, emissive: 0xff7a1a, emissiveIntensity: 2.2 })
    );
    flame.position.y = 0.68;
    torch.add(flame);
    this.torchFlame = flame;
    this.torchLight = new THREE.PointLight(0xffa552, 0, 16, 2);
    this.torchLight.position.y = 0.9;
    torch.add(this.torchLight);
    this.torch = torch;
    wrap.castShadow = false;

    // Sword: blade along -y of the hand (points down when arm hangs, forward when raised)
    const sword = new THREE.Group();
    this.bladeMat = std(0x9aa3ad, { metalness: 0.7, roughness: 0.3 });
    const swBlade = box(0.09, 1.05, 0.035, this.bladeMat, 0, -0.62, 0, sword);
    swBlade.position.y = -0.7;
    box(0.3, 0.06, 0.08, 0x6b4a2a, 0, -0.16, 0, sword);
    cyl(0.04, 0.05, 0.28, 0x3b2a18, 0, 0.0, 0, sword, 8);
    sphere(0.06, 0xc9a33a, 0, 0.15, 0, sword, 8);
    this.sword = sword;
    this.swing = 0;

    // Axe: gripped at the hand, handle along -y with the head at the far end
    const axe = new THREE.Group();
    cyl(0.04, 0.05, 1.0, 0x6b4a2a, 0, -0.4, 0, axe, 8);
    box(0.08, 0.22, 0.42, 0x8f98a3, 0, -0.8, 0.14, axe);
    box(0.05, 0.26, 0.08, 0xd8dee5, 0, -0.8, 0.36, axe);
    this.axe = axe;

    // Metal detector: shaft along -y with a flat coil at the end and a control box near the grip
    const det = new THREE.Group();
    cyl(0.025, 0.025, 1.1, 0x2b2f36, 0, -0.5, 0, det, 8);
    box(0.16, 0.1, 0.22, 0xe0a52a, 0, -0.1, 0.1, det);
    const coil = cyl(0.36, 0.36, 0.05, std(0x3a4048, { metalness: 0.3 }), 0, -1.05, 0.12, det, 20);
    coil.rotation.x = 0.9;
    const coilRing = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 6, 20), std(0xe0a52a));
    coilRing.position.set(0, -1.05, 0.12);
    coilRing.rotation.x = Math.PI / 2 + 0.9;
    det.add(coilRing);
    this.detLed = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), new THREE.MeshStandardMaterial({ color: 0x40ff70, emissive: 0x20ff50, emissiveIntensity: 0.3 }));
    this.detLed.position.set(0, -0.03, 0.22);
    det.add(this.detLed);
    this.detector = det;
    this.sweepPhase = 0;

    // Command standard: a short staff with a red pennant, held upright like the torch
    const flag = new THREE.Group();
    cyl(0.025, 0.03, 1.3, 0x6b4a2a, 0, 0.25, 0, flag, 8);
    sphere(0.05, 0xc9a33a, 0, 0.92, 0, flag, 8);
    const pennant = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.3), std(0xc0392b, { side: THREE.DoubleSide }));
    pennant.position.set(0.28, 0.72, 0);
    flag.add(pennant);
    this.standard = flag;

    this.tools = [shovel, pan, torch, sword, null, axe, det, flag];
    for (const t of this.tools) if (t) this.hand.add(t);
    this.setTool(0);

    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    this.pos.y = terrain.heightAt(this.pos.x, this.pos.z);
    g.position.copy(this.pos);
    scene.add(g);
  }

  setTool(i) {
    this.tool = i;
    this.tools.forEach((t, k) => { if (t) t.visible = k === i; });
    this.torchLight.intensity = 0;
  }

  /** Sword level 0..2 changes the blade look. */
  setSwordLevel(lvl) {
    const colors = [0x8a7a66, 0x9aa3ad, 0xdfe6ee];
    this.bladeMat.color.setHex(colors[Math.min(2, lvl)]);
    this.bladeMat.metalness = lvl === 0 ? 0.3 : 0.8;
    this.bladeMat.roughness = lvl === 0 ? 0.7 : 0.25;
  }

  startSwing() { this.swing = 1; }

  /** Smoothly rotate to face a world direction. */
  faceDir(dx, dz, dt, speed = 12) {
    const target = Math.atan2(dx, dz);
    let d = target - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * speed);
  }

  /** Update visuals. moving: 0..1, using: bool, night: 0..1 */
  animate(dt, moving, using, night) {
    this.pos.y = this.terrain.heightAt(this.pos.x, this.pos.z);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;

    if (moving > 0.05) this.cycle += dt * 11 * moving;
    const swing = moving > 0.05 ? Math.sin(this.cycle) * 0.75 : 0;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.8;

    // Tool poses
    if (this.tool === 3 || this.tool === 5) {
      // sword / axe: the tool's -y axis is the blade/handle. A hand rotation of -1.3 flips it so
      // the blade points forward-and-up out of the fist instead of hanging down behind the arm.
      this.swing = Math.max(0, this.swing - dt * 3.2);
      const s = this.swing;
      this.hand.rotation.x = -1.3;
      if (s > 0) {
        const t = 1 - s; // 0..1 over swing: raised overhead → chopped down in front
        this.armR.rotation.x = -2.6 + t * 2.0;
        this.armR.rotation.z = -0.5 + t * 0.9;
      } else {
        this.armR.rotation.x = -0.9 + swing * 0.3;
        this.armR.rotation.z = -0.15;
      }
    } else if (this.tool === 6) {
      // metal detector: arm forward-down, coil skimming the ground; sweeps side to side while scanning
      this.sweepPhase += dt * (using ? 4.5 : 1.6);
      const sw2 = Math.sin(this.sweepPhase) * (using ? 0.55 : 0.18);
      this.armR.rotation.x = -0.55;
      this.armR.rotation.z = -0.25 + sw2;
      this.hand.rotation.x = -0.35;
    } else if (this.tool === 4) {
      // empty hands (placing turrets)
      this.armR.rotation.x = swing * 0.8;
      this.armR.rotation.z = 0;
      this.hand.rotation.x = 0;
    } else if (this.tool === 7) {
      // command standard: held upright at the side, waved when giving orders
      this.armR.rotation.z = -0.2;
      this.armR.rotation.x = -1.2 - (using ? 0.6 : 0);
      this.hand.rotation.x = 1.2 + (using ? 0.6 : 0);
    } else if (this.tool === 2) {
      this.armR.rotation.z = 0;
      // torch held upright, arm forward-horizontal
      this.armR.rotation.x = -1.5;
      this.hand.rotation.x = 1.5;
      this.torchLight.intensity = (4 + 30 * night) * (0.88 + 0.12 * Math.sin(performance.now() * 0.013 + Math.sin(performance.now() * 0.004) * 2));
      this.torchFlame.scale.setScalar(0.9 + 0.15 * Math.sin(performance.now() * 0.02));
    } else if (this.tool === 1) {
      this.armR.rotation.z = 0;
      this.armR.rotation.x = -1.15;
      this.hand.rotation.x = 1.15;
      if (using) {
        this.useTimer += dt;
        this.hand.rotation.z = Math.sin(this.useTimer * 9) * 0.25;
        this.armR.rotation.x = -1.25 + Math.sin(this.useTimer * 9) * 0.12;
      } else {
        this.hand.rotation.z = 0;
      }
    } else {
      // shovel
      this.armR.rotation.z = 0;
      if (using) {
        this.useTimer += dt;
        const t = (Math.sin(this.useTimer * 9) + 1) * 0.5;
        this.armR.rotation.x = -0.4 - t * 1.1;
        this.hand.rotation.x = 0.35;
      } else {
        this.armR.rotation.x = -0.55 + swing * 0.5;
        this.hand.rotation.x = 0.35;
      }
    }
    if (!using) this.useTimer = 0;
  }
}
