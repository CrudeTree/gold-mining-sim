import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { WATER_LEVEL } from './terrain.js';

const rr = (rng, a, b) => a + rng() * (b - a);

function std(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.0, ...extra });
}

export function box(w, h, d, color, x = 0, y = 0, z = 0, parent = null) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'number' ? std(color) : color);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}

export function cyl(rt, rb, h, color, x = 0, y = 0, z = 0, parent = null, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof color === 'number' ? std(color) : color);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}

export function sphere(r, color, x = 0, y = 0, z = 0, parent = null, seg = 12) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 4)), typeof color === 'number' ? std(color) : color);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}

/**
 * Builds vegetation, rocks and the camp. Returns { colliders, campfire }.
 */
export function buildWorld(scene, terrain, seed) {
  const rng = mulberry32(seed + 999);
  const colliders = [];
  const s = terrain.sites;
  const half = terrain.half - 8;

  const exclusions = [
    { x: s.camp.x, z: s.camp.z, r: 17 },
    { x: s.washPlant.x, z: s.washPlant.z, r: 10 },
  ];
  const excluded = (x, z, extra = 0) =>
    exclusions.some((e) => Math.hypot(x - e.x, z - e.z) < e.r + extra);

  // ---------------- trees ----------------
  const trees = [];
  for (let tries = 0; tries < 2600 && trees.length < 380; tries++) {
    const x = rr(rng, -half, half), z = rr(rng, -half, half);
    const o = terrain.heightAt(x, z);
    if (o < WATER_LEVEL + 0.55) continue;
    const nrm = terrain.normalAt(x, z);
    if (nrm.y < 0.8) continue;
    if (excluded(x, z)) continue;
    const sd = terrain.streamDist(x, z);
    if (sd < 4.5 && rng() > 0.15) continue;
    const sc = rr(rng, 0.8, 1.55);
    let ok = true;
    for (const t of trees) {
      if (Math.hypot(t.x - x, t.z - z) < 2.4 * Math.max(sc, t.s)) { ok = false; break; }
    }
    if (!ok) continue;
    trees.push({ x, z, y: o, s: sc, hue: rng() });
  }

  const palette = [0x4caf50, 0x5cb85c, 0x3f9a44, 0x7ccf5a, 0x58a84f, 0x8fd35f, 0x45a35b];
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.3, 1.9, 8);
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, std(0x7a4b2a), trees.length);
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;

  const blobs = [];
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  trees.forEach((t, i) => {
    m4.makeTranslation(t.x, t.y + 0.9 * t.s, t.z);
    m4.scale(new THREE.Vector3(t.s, t.s, t.s));
    trunkMesh.setMatrixAt(i, m4);
    const top = t.y + 1.75 * t.s;
    const R = rr(rng, 1.35, 1.75) * t.s;
    const base = new THREE.Color(palette[Math.floor(t.hue * palette.length)]);
    t.blobStart = blobs.length;
    blobs.push({ x: t.x, y: top + R * 0.55, z: t.z, r: R, c: base.clone() });
    const count = 3 + Math.floor(rng() * 3);
    for (let b = 0; b < count; b++) {
      const ang = rng() * Math.PI * 2;
      const dist = R * rr(rng, 0.45, 0.8);
      const br = R * rr(rng, 0.5, 0.78);
      const c = base.clone().offsetHSL(rr(rng, -0.02, 0.02), rr(rng, -0.05, 0.05), rr(rng, -0.06, 0.08));
      blobs.push({ x: t.x + Math.cos(ang) * dist, y: top + R * 0.55 + rr(rng, -0.35, 0.55) * R, z: t.z + Math.sin(ang) * dist, r: br, c });
    }
    t.blobCount = blobs.length - t.blobStart;
    t.collider = { x: t.x, z: t.z, r: 0.45 * t.s };
    t.index = i;
    colliders.push(t.collider);
  });

  const blobGeo = new THREE.SphereGeometry(1, 14, 10);
  const blobMesh = new THREE.InstancedMesh(blobGeo, std(0xffffff, { roughness: 0.85 }), blobs.length);
  blobMesh.castShadow = true;
  blobMesh.receiveShadow = true;
  blobs.forEach((b, i) => {
    m4.makeTranslation(b.x, b.y, b.z);
    m4.scale(new THREE.Vector3(b.r, b.r * 0.92, b.r));
    blobMesh.setMatrixAt(i, m4);
    blobMesh.setColorAt(i, b.c);
  });
  scene.add(trunkMesh, blobMesh);

  // ---------------- bushes ----------------
  const bushes = [];
  for (let tries = 0; tries < 900 && bushes.length < 220; tries++) {
    const x = rr(rng, -half, half), z = rr(rng, -half, half);
    const o = terrain.heightAt(x, z);
    if (o < WATER_LEVEL + 0.4) continue;
    if (terrain.normalAt(x, z).y < 0.75) continue;
    if (excluded(x, z, -6)) continue;
    bushes.push({ x, z, y: o, r: rr(rng, 0.45, 0.95), c: new THREE.Color(palette[Math.floor(rng() * palette.length)]).offsetHSL(0, 0, rr(rng, -0.05, 0.1)) });
  }
  const bushMesh = new THREE.InstancedMesh(blobGeo, std(0xffffff), bushes.length);
  bushMesh.castShadow = true;
  bushMesh.receiveShadow = true;
  bushes.forEach((b, i) => {
    m4.makeTranslation(b.x, b.y + b.r * 0.55, b.z);
    m4.scale(new THREE.Vector3(b.r, b.r * 0.8, b.r));
    bushMesh.setMatrixAt(i, m4);
    bushMesh.setColorAt(i, b.c);
  });
  scene.add(bushMesh);

  // ---------------- rocks ----------------
  const rocks = [];
  for (let tries = 0; tries < 700 && rocks.length < 130; tries++) {
    const x = rr(rng, -half, half), z = rr(rng, -half, half);
    const o = terrain.heightAt(x, z);
    if (excluded(x, z, -4)) continue;
    const sc = rr(rng, 0.35, 1.5);
    rocks.push({ x, z, y: o - 0.15 * sc, s: sc, rot: rng() * Math.PI * 2, tilt: rr(rng, -0.4, 0.4) });
    if (sc > 0.7) colliders.push({ x, z, r: sc * 0.85 });
  }
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMesh = new THREE.InstancedMesh(rockGeo, std(0xffffff, { roughness: 0.95, flatShading: true }), rocks.length);
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  const e = new THREE.Euler(), q = new THREE.Quaternion(), v = new THREE.Vector3();
  rocks.forEach((r, i) => {
    e.set(r.tilt, r.rot, 0);
    q.setFromEuler(e);
    m4.compose(v.set(r.x, r.y, r.z), q, new THREE.Vector3(r.s, r.s * 0.75, r.s));
    rockMesh.setMatrixAt(i, m4);
    col.setHex(0x8b9096).offsetHSL(0, 0, rr(rng, -0.08, 0.08));
    rockMesh.setColorAt(i, col);
  });
  scene.add(rockMesh);

  // ---------------- flowers ----------------
  const flowers = [];
  const fcolors = [0xffd93d, 0xff6b9d, 0xffffff, 0xb98cff, 0xff8f4d, 0x7fd8ff];
  for (let tries = 0; tries < 2500 && flowers.length < 1100; tries++) {
    const x = rr(rng, -half, half), z = rr(rng, -half, half);
    const o = terrain.heightAt(x, z);
    if (o < WATER_LEVEL + 0.5) continue;
    if (terrain.normalAt(x, z).y < 0.8) continue;
    if (excluded(x, z, -10)) continue;
    flowers.push({ x, z, y: o + 0.12, c: fcolors[Math.floor(rng() * fcolors.length)], s: rr(rng, 0.09, 0.16) });
  }
  const flowerGeo = new THREE.SphereGeometry(1, 6, 5);
  const flowerMesh = new THREE.InstancedMesh(flowerGeo, std(0xffffff, { roughness: 0.7 }), flowers.length);
  flowers.forEach((f, i) => {
    m4.makeTranslation(f.x, f.y, f.z);
    m4.scale(new THREE.Vector3(f.s, f.s, f.s));
    flowerMesh.setMatrixAt(i, m4);
    flowerMesh.setColorAt(i, col.setHex(f.c));
  });
  scene.add(flowerMesh);

  // ---------------- camp ----------------
  const campfire = buildCamp(scene, terrain, colliders);

  return { colliders, campfire, forest: { trees, trunkMesh, blobMesh } };
}

function buildCamp(scene, terrain, colliders) {
  const s = terrain.sites;

  // Trading post cabin
  const shop = new THREE.Group();
  const sy = terrain.heightAt(s.shop.x, s.shop.z);
  shop.position.set(s.shop.x, sy, s.shop.z);
  box(6, 3, 5, 0xb98456, 0, 1.5, 0, shop);
  // log stripes
  for (let i = 0; i < 4; i++) box(6.1, 0.12, 5.1, 0x8f6239, 0, 0.55 + i * 0.7, 0, shop);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(5.3, 2.4, 4), std(0x9c3b2b));
  roof.position.y = 4.15;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  shop.add(roof);
  box(0.8, 1.2, 0.8, 0x6d6d6d, 1.6, 4.6, -1.0, shop); // chimney
  box(1.1, 2.0, 0.2, 0x5b3a1e, 0, 1.0, 2.55, shop); // door
  box(1.0, 0.9, 0.15, 0x9fd8ff, -1.9, 1.8, 2.55, shop); // window
  box(1.0, 0.9, 0.15, 0x9fd8ff, 1.9, 1.8, 2.55, shop);
  const sign = box(3.2, 0.8, 0.2, 0xf1d98a, 0, 3.2, 2.7, shop);
  sign.material = std(0xf1d98a);
  const nugget = sphere(0.28, std(0xf6c744, { roughness: 0.4, metalness: 0.5 }), 0, 3.2, 2.85, shop, 10);
  nugget.scale.set(1.3, 0.9, 0.6);
  scene.add(shop);
  colliders.push({ x: s.shop.x, z: s.shop.z, r: 4.2 });

  // Tent
  const ty = terrain.heightAt(s.tent.x, s.tent.z);
  const tent = new THREE.Mesh(new THREE.ConeGeometry(2.3, 2.4, 4), std(0xe89b3a));
  tent.position.set(s.tent.x, ty + 1.2, s.tent.z);
  tent.rotation.y = Math.PI / 4;
  tent.castShadow = true;
  tent.receiveShadow = true;
  scene.add(tent);
  colliders.push({ x: s.tent.x, z: s.tent.z, r: 2.2 });

  // Campfire
  const fire = new THREE.Group();
  const fy = terrain.heightAt(s.fire.x, s.fire.z);
  fire.position.set(s.fire.x, fy, s.fire.z);
  for (let i = 0; i < 3; i++) {
    const log = cyl(0.13, 0.13, 1.3, 0x6b4423, 0, 0.15, 0, fire, 7);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = (i / 3) * Math.PI;
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), std(0x7d7f84, { flatShading: true }));
    st.position.set(Math.cos(a) * 0.95, 0.1, Math.sin(a) * 0.95);
    st.castShadow = true;
    fire.add(st);
  }
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 0.9, 8),
    new THREE.MeshStandardMaterial({ color: 0xff9a2e, emissive: 0xff6a00, emissiveIntensity: 1.6, roughness: 1 })
  );
  flame.position.y = 0.65;
  fire.add(flame);
  const light = new THREE.PointLight(0xffa348, 25, 16, 2);
  light.position.y = 1.0;
  fire.add(light);
  scene.add(fire);
  colliders.push({ x: s.fire.x, z: s.fire.z, r: 1.1 });

  // A few crates / barrels around camp
  const cx = s.camp.x, cz = s.camp.z;
  const crate = box(0.9, 0.9, 0.9, 0xa87a4a, cx - 4.5, terrain.heightAt(cx - 4.5, cz - 2) + 0.45, cz - 2);
  crate.rotation.y = 0.4;
  scene.add(crate);
  const barrel = cyl(0.45, 0.45, 1.0, 0x3e6fb0, cx - 5.5, terrain.heightAt(cx - 5.5, cz - 3) + 0.5, cz - 3);
  scene.add(barrel);
  colliders.push({ x: cx - 4.5, z: cz - 2, r: 0.7 }, { x: cx - 5.5, z: cz - 3, r: 0.55 });

  return { group: fire, light, flame };
}
