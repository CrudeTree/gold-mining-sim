import * as THREE from 'three';
import { CONFIG } from './config.js';
import { smoothstep, lerp } from './terrain.js';

const SKY_DAY = new THREE.Color(0x8ccdf0);
const SKY_SUNSET = new THREE.Color(0xf29a63);
const SKY_NIGHT = new THREE.Color(0x070b1c);      // new moon: near black
const SKY_MOONLIT = new THREE.Color(0x1c2b5c);    // full moon: deep blue
const MOON_LIGHT = new THREE.Color(0xaabdff);
const SUN_DAY = new THREE.Color(0xfff3dc);
const SUN_SUNSET = new THREE.Color(0xffb271);
const SUN_NIGHT = new THREE.Color(0x8ea2e8);
const HEMI_SKY_DAY = new THREE.Color(0xbfe4ff);
const HEMI_SKY_NIGHT = new THREE.Color(0x1a2240);
const HEMI_SKY_MOONLIT = new THREE.Color(0x4a5f9a);
const HEMI_GROUND_DAY = new THREE.Color(0x6b8f4a);
const HEMI_GROUND_NIGHT = new THREE.Color(0x0c1018);
const HEMI_GROUND_MOONLIT = new THREE.Color(0x232c3a);
const GREY_DAY = new THREE.Color(0x8d98a6);
const GREY_NIGHT = new THREE.Color(0x0e1016);
const WHITE = new THREE.Color(0xffffff);

/** 8-night lunar cycle. Returns { index 0..7, light 0..1, name, icon }. 0 = new moon, 4 = full. */
export function moonPhase(nightIndex) {
  const idx = (((nightIndex + 2) % 8) + 8) % 8; // night 1 lands on a waxing gibbous so the first night isn't black
  const light = 0.5 - 0.5 * Math.cos((idx / 8) * Math.PI * 2);
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  const icons = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
  return { index: idx, light, name: names[idx], icon: icons[idx] };
}

export class DayNight {
  constructor(scene) {
    this.scene = scene;
    this.hours = CONFIG.startHour;
    this.hoursPerSecond = 24 / (CONFIG.dayLengthMinutes * 60);
    this.night = 0; // 0 = full day, 1 = full night
    this.daylight = 1;

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48;
    sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(HEMI_SKY_DAY, HEMI_GROUND_DAY, 1.2);
    scene.add(this.hemi);

    this.sky = new THREE.Color();
    scene.background = this.sky;
    scene.fog = new THREE.Fog(this.sky, 80, 210);

    // Sun and moon discs
    this.sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(7, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff1b0, fog: false })
    );
    this.moonDisc = new THREE.Mesh(
      new THREE.SphereGeometry(5, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xe6ecfa, fog: false })
    );
    // sky-coloured sphere that slides across the moon to draw its phase
    this.moonShadow = new THREE.Mesh(
      new THREE.SphereGeometry(5.3, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x000000, fog: false })
    );
    this.moonGlow = new THREE.Mesh(
      new THREE.SphereGeometry(9, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xb8c6ff, fog: false, transparent: true, opacity: 0.18, depthWrite: false })
    );
    scene.add(this.sunDisc, this.moonDisc, this.moonShadow, this.moonGlow);
    this.day = 1;
    this.moon = moonPhase(1);
    this.moonlight = 0; // effective moonlight on the ground right now (0..1), after clouds

    // Stars
    const count = 900;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = Math.random(), v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(1 - v); // upper hemisphere
      const r = 380;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = Math.abs(r * Math.cos(phi)) + 5;
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false })
    );
    scene.add(this.stars);

    this.sunDir = new THREE.Vector3();
    this._perp = new THREE.Vector3();
    this._grey = new THREE.Color();
  }

  get timeString() {
    const h = Math.floor(this.hours);
    const m = Math.floor((this.hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  update(dt, target, weather = null) {
    this.hours = (this.hours + dt * this.hoursPerSecond) % 24;
    const cloud = weather ? weather.cloud : 0;
    const fogAmt = weather ? weather.fog : 0;
    const flash = weather ? weather.flash : 0;
    const ang = ((this.hours - 6) / 24) * Math.PI * 2;
    const elev = Math.sin(ang);
    this.sunDir.set(Math.cos(ang) * 0.75, elev, 0.45).normalize();

    const daylight = smoothstep(-0.12, 0.28, elev);
    const twilight = 1 - smoothstep(0, 0.4, Math.abs(elev));
    this.daylight = daylight;
    this.night = 1 - daylight;

    // Moon phase: constant through a night (the night that starts on day N runs past midnight into day N+1)
    const nightIndex = this.hours >= 12 ? this.day : this.day - 1;
    if (!this.moon || this.moon.nightIndex !== nightIndex) { this.moon = moonPhase(nightIndex); this.moon.nightIndex = nightIndex; }
    const phaseLight = this.moon.light;
    // heavy cloud (storms) blots the moon out almost entirely
    const moon = phaseLight * (1 - 0.92 * cloud);
    this.moonlight = moon * (1 - daylight);

    // Sun / moon light
    const isDay = elev > -0.05;
    const lightDir = isDay ? this.sunDir : this.sunDir.clone().negate();
    this.sun.position.copy(target).addScaledVector(lightDir, 120);
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();
    const c = this.sun.color;
    c.copy(SUN_NIGHT).lerp(MOON_LIGHT, isDay ? 0 : phaseLight).lerp(SUN_SUNSET, smoothstep(-0.1, 0.05, elev)).lerp(SUN_DAY, smoothstep(0.1, 0.45, elev));
    const nightSun = lerp(0.06, 1.05, moon);
    this.sun.intensity = (isDay ? lerp(0.6, 3.2, daylight) * (1 - 0.82 * cloud) : nightSun) + flash * 2.5;

    // Ambient: pitch black on a clouded new moon, a soft blue wash under a full moon
    this.hemi.color.copy(HEMI_SKY_NIGHT).lerp(HEMI_SKY_MOONLIT, moon).lerp(HEMI_SKY_DAY, daylight);
    this.hemi.groundColor.copy(HEMI_GROUND_NIGHT).lerp(HEMI_GROUND_MOONLIT, moon).lerp(HEMI_GROUND_DAY, daylight);
    const nightHemi = lerp(0.16, 0.55, moon);
    this.hemi.intensity = lerp(nightHemi, 1.3 * (1 - 0.4 * cloud), daylight) + flash * 6;

    // Sky
    this.sky.copy(SKY_NIGHT).lerp(SKY_MOONLIT, moon).lerp(SKY_DAY, daylight);
    this.sky.lerp(SKY_SUNSET, twilight * 0.65 * smoothstep(-0.25, 0.0, elev) * (1 - cloud));
    this._grey.copy(GREY_NIGHT).lerp(GREY_DAY, daylight);
    this.sky.lerp(this._grey, cloud * 0.85);
    this.sky.lerp(WHITE, flash * 0.7);
    this.scene.fog.color.copy(this.sky);
    this.scene.fog.near = lerp(lerp(80, 55, cloud), 18, fogAmt);
    this.scene.fog.far = lerp(lerp(210, 150, cloud), 70, fogAmt);
    this.sunDisc.visible = cloud < 0.7;
    const moonVisible = cloud < 0.7 && !isDay;
    this.moonDisc.visible = moonVisible;
    this.moonShadow.visible = moonVisible && this.moon.index !== 4;
    this.moonGlow.visible = moonVisible;

    this.sunDisc.position.copy(target).addScaledVector(this.sunDir, 330);
    this.moonDisc.position.copy(target).addScaledVector(this.sunDir, -330);
    this.moonGlow.position.copy(this.moonDisc.position);
    this.moonGlow.material.opacity = 0.05 + 0.2 * phaseLight * (1 - cloud);
    // Phase: slide the shadow sphere sideways; fully covering at new moon, clear of the disc at full moon
    const side = this.moon.index < 4 ? -1 : 1;
    const perp = this._perp.set(this.sunDir.z, 0, -this.sunDir.x).normalize();
    this.moonShadow.position.copy(this.moonDisc.position).addScaledVector(perp, side * lerp(0, 10.6, phaseLight)).addScaledVector(this.sunDir, 2);
    this.moonShadow.material.color.copy(this.sky);
    this.stars.position.set(target.x, 0, target.z);
    this.stars.material.opacity = (1 - daylight) * lerp(0.95, 0.55, phaseLight) * (1 - cloud);
  }
}
