import { CONFIG, richnessLabel } from './config.js';
import { WEATHER_LABEL } from './weather.js';

const $ = (id) => document.getElementById(id);
const WEATHER_ICON = { clear: '☀', cloudy: '☁', rain: '☂', storm: '⚡', fog: '≋' };
const SWORD_NAMES = ['Rusty Sword', 'Iron Sword', 'Steel Sword'];

export class UI {
  constructor() {
    this.el = {
      hud: $('hud'), money: $('money'), gold: $('gold'), clock: $('clock'), dayIcon: $('dayIcon'), dayNum: $('dayNum'),
      weatherIcon: $('weatherIcon'), weatherText: $('weatherText'),
      hpFill: $('hpFill'), hpText: $('hpText'), nightBanner: $('nightBanner'), nightText: $('nightText'), vignette: $('vignette'),
      carry: $('carry'), carryFill: $('carryFill'), carryRich: $('carryRich'),
      vehicleHud: $('vehicleHud'), vehicleName: $('vehicleName'), vehicleFill: $('vehicleFill'), vehicleRich: $('vehicleRich'), vehicleHint: $('vehicleHint'),
      progress: $('progress'), progressFill: $('progressFill'), prompt: $('prompt'),
      hotbar: $('hotbar'), torchCount: $('torchCount'), turretCount: $('turretCount'), swordName: $('swordName'), toasts: $('toasts'),
      axeSlot: $('axeSlot'), woodCount: $('woodCount'), woodStat: $('woodStat'), wood: $('wood'), detectorSlot: $('detectorSlot'),
      ko: $('ko'), labels: $('labels'),
      phone: $('phone'), phoneClock: $('phoneClock'), phMoney: $('phMoney'), phGold: $('phGold'), phoneContent: $('phoneContent'), phoneTabs: $('phone').querySelector('.phone-tabs'),
      pause: $('pause'), resumeBtn: $('resumeBtn'), saveBtn: $('saveBtn'), loadBtn: $('loadBtn'), newBtn: $('newBtn'),
      start: $('start'), continueBtn: $('continueBtn'), newGameBtn: $('newGameBtn'),
    };
    this._lastPrompt = null;
    this._lastNight = null;
    this.labels = new Map();
    this.phoneTab = 'shop';
    this.vignetteLevel = 0;
    for (const b of this.el.phoneTabs.children) {
      b.onclick = () => { this.phoneTab = b.dataset.tab; this.refreshPhone(); };
    }
  }

  showHud(v) { this.el.hud.classList.toggle('hidden', !v); }

  setStats({ money, gold, time, day, isNight, weather, moon }) {
    this.el.money.textContent = Math.floor(money).toLocaleString();
    this.el.gold.textContent = `${gold.toFixed(2)} g`;
    this.el.clock.textContent = time;
    this.el.dayIcon.textContent = isNight && moon ? moon.icon : isNight ? '☾' : '☀';
    this.el.dayIcon.title = isNight && moon ? moon.name : '';
    this.el.dayNum.textContent = isNight && moon ? `Day ${day} · ${moon.name}` : `Day ${day}`;
    if (weather) {
      this.el.weatherIcon.textContent = WEATHER_ICON[weather] || '◌';
      this.el.weatherText.textContent = WEATHER_LABEL[weather] || weather;
    }
  }

  setHealth(hp, max) {
    this.el.hpFill.style.width = `${Math.max(0, Math.min(100, (hp / max) * 100))}%`;
    this.el.hpText.textContent = Math.ceil(hp);
  }

  setNight(text) {
    if (text === this._lastNight) return;
    this._lastNight = text;
    this.el.nightBanner.classList.toggle('hidden', !text);
    this.el.nightText.textContent = text || '';
  }

  /** Red vignette pulse (0..1). Decays over time via update(). */
  hitFlash(strength = 0.8) { this.vignetteLevel = Math.min(1, this.vignetteLevel + strength); }
  updateVignette(dt, lowHealth) {
    this.vignetteLevel = Math.max(lowHealth ? 0.35 + 0.1 * Math.sin(performance.now() * 0.006) : 0, this.vignetteLevel - dt * 2.5);
    this.el.vignette.style.opacity = this.vignetteLevel.toFixed(2);
  }

  showKO(v) { this.el.ko.classList.toggle('hidden', !v); }

  /** Earthworks panel shown while seated in the bulldozer. Pass null to hide. */
  setEarthworks(info) {
    const el = document.getElementById('earthworks');
    if (!info) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    for (const m of el.querySelectorAll('.ewMode')) m.classList.toggle('active', m.dataset.mode === info.mode);
    const key = `${info.mode}|${info.size}|${info.cost}|${Math.round(info.spent)}|${info.hint}|${info.bad}`;
    if (key === this._ewKey) return;
    this._ewKey = key;
    document.getElementById('ewBrush').textContent = '◉'.repeat(info.size + 1) + '◯'.repeat(3 - info.size);
    document.getElementById('ewCost').textContent = `$${info.cost} / m³`;
    document.getElementById('ewSpent').textContent = `$${Math.round(info.spent).toLocaleString()}`;
    const h = document.getElementById('ewHint');
    h.textContent = info.hint;
    h.classList.toggle('bad', !!info.bad);
  }

  /** Sleeping overlay (inn). */
  setSleep(on, time = '') {
    const el = document.getElementById('sleep');
    el.classList.toggle('hidden', !on);
    if (on) document.getElementById('sleepTime').textContent = time;
  }

  /** Build-mode panel. Pass null to hide. */
  setBuild(info) {
    const el = document.getElementById('buildPanel');
    if (!info) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    for (const m of el.querySelectorAll('.ewMode')) m.classList.toggle('active', m.dataset.tool === info.tool);
    const key = `${info.tool}|${info.dir}|${info.belts}|${info.hoppers}|${JSON.stringify(info.kits)}|${JSON.stringify(info.owned)}|${info.hint}`;
    if (key === this._buildKey) return;
    this._buildKey = key;
    document.getElementById('beltCount').textContent = `×${info.belts}`;
    document.getElementById('hopperCount').textContent = `×${info.hoppers}`;
    for (const type of ['inn', 'barracks', 'church']) {
      const row = el.querySelector(`[data-tool="${type}"]`);
      const owned = !!info.owned[type], kits = info.kits[type] || 0;
      row.classList.toggle('locked', !owned);
      document.getElementById(`${type}Count`).textContent = owned ? (kits > 0 ? '×1' : 'placed') : 'buy on phone';
    }
    // camera looks toward −z, so +z (dir 0) is down the screen
    document.getElementById('buildDir').textContent = ['↓', '→', '↑', '←'][info.dir];
    const h = document.getElementById('buildHint');
    h.textContent = info.hint || 'Belts ending at the wash plant hopper feed it';
    h.classList.toggle('bad', !!info.bad);
  }

  /** Big centre-screen celebration for a picked-up nugget. */
  nuggetPop(grams, by = 'you') {
    const el = document.getElementById('nuggetPop');
    const monster = grams >= CONFIG.nuggets.bigGrams;
    el.children[0].textContent = monster ? 'MONSTER NUGGET!' : 'NUGGET!';
    const who = by === 'you' ? '' : ` · scooped up by the ${by}`;
    el.children[1].textContent = `${grams.toFixed(2)} g  ·  worth $${Math.round(grams * CONFIG.goldPrice).toLocaleString()}${who}`;
    el.classList.remove('show', 'monster');
    void el.offsetWidth; // restart the animation
    el.classList.add('show');
    if (monster) el.classList.add('monster');
  }

  /**
   * Floating label anchored to a projected world point.
   * info: { title, fill (0..1), state: 'full'|'empty'|'wrecked'|'' , extra }
   */
  setWorldLabel(id, screen, info) {
    let l = this.labels.get(id);
    if (!l) {
      const d = document.createElement('div');
      d.className = 'wlabel';
      d.innerHTML = '<span class="title"></span><span class="pct"></span><span class="mini"><div></div></span>';
      this.el.labels.appendChild(d);
      l = { d, title: d.children[0], pct: d.children[1], bar: d.children[2].firstChild, last: '' };
      this.labels.set(id, l);
    }
    if (!screen) { l.d.style.display = 'none'; return; }
    l.d.style.display = '';
    l.d.style.transform = `translate(-50%, -100%) translate(${screen.x.toFixed(0)}px, ${screen.y.toFixed(0)}px)`;
    const pctNum = Math.round(info.fill * 100);
    const text = info.state === 'wrecked' ? 'WRECKED' : pctNum >= 100 ? 'FULL' : `${pctNum}%`;
    const key = `${info.title}|${text}|${info.state}|${info.extra || ''}`;
    if (key !== l.last) {
      l.last = key;
      l.title.textContent = info.title;
      l.pct.textContent = info.extra ? `${text} · ${info.extra}` : text;
      l.d.className = `wlabel ${info.state || ''}`;
    }
    l.bar.style.width = `${Math.min(100, info.fill * 100)}%`;
  }
  hideWorldLabel(id) { const l = this.labels.get(id); if (l) l.d.style.display = 'none'; }

  setCarry(vol, cap, richness) {
    this.el.carryFill.style.width = `${Math.min(100, (vol / cap) * 100)}%`;
    if (vol > 0.01) {
      const r = richnessLabel(richness);
      this.el.carryRich.textContent = r.text;
      this.el.carryRich.style.color = r.color;
    } else {
      this.el.carryRich.textContent = 'empty';
      this.el.carryRich.style.color = '#9aa0a6';
    }
  }

  setVehicle(v) {
    if (!v) {
      this.el.vehicleHud.classList.add('hidden');
      this.el.carry.classList.remove('hidden');
      this.el.hotbar.classList.remove('hidden');
      return;
    }
    this.el.vehicleHud.classList.remove('hidden');
    this.el.carry.classList.add('hidden');
    this.el.hotbar.classList.add('hidden');
    this.el.vehicleName.textContent = v.name;
    const vol = v.load ?? v.bucket;
    const fill = v.fill;
    this.el.vehicleFill.style.width = `${Math.min(100, fill * 100)}%`;
    if (vol > 0.01) {
      const r = richnessLabel(v.richness);
      this.el.vehicleRich.textContent = v.singleScoop ? `Loaded ${vol.toFixed(1)} m³ · ${r.text}` : `${Math.round(fill * 100)}% · ${r.text}`;
      this.el.vehicleRich.style.color = r.color;
    } else {
      this.el.vehicleRich.textContent = v.isDozer ? 'earthworks' : 'empty';
      this.el.vehicleRich.style.color = '#9aa0a6';
    }
    this.el.vehicleHint.textContent = v.hint || '';
  }

  setProgress(p) {
    if (p == null) { this.el.progress.classList.add('hidden'); return; }
    this.el.progress.classList.remove('hidden');
    this.el.progressFill.style.width = `${Math.round(p * 100)}%`;
  }

  setPrompt(text) {
    if (text === this._lastPrompt) return;
    this._lastPrompt = text;
    this.el.prompt.innerHTML = text || '';
  }

  setHotbar(active, state) {
    for (const s of this.el.hotbar.children) s.classList.toggle('active', Number(s.dataset.i) === active);
    this.el.torchCount.textContent = state.torches;
    this.el.turretCount.textContent = state.turrets;
    this.el.swordName.textContent = SWORD_NAMES[state.upgrades.sword || 0];
    const hasAxe = !!state.owned.axe;
    this.el.axeSlot.classList.toggle('locked', !hasAxe);
    this.el.detectorSlot.classList.toggle('locked', !state.owned.detector);
    this.el.woodCount.textContent = hasAxe && state.wood > 0 ? state.wood : '';
    const slot = document.getElementById('commandSlot');
    slot.classList.toggle('locked', !state.owned.barracks);
    document.getElementById('mercCount').textContent = state.owned.barracks && this.game?.mercs ? this.game.mercs.count : '';
    this.el.woodStat.classList.toggle('hidden', !(state.wood > 0));
    this.el.wood.textContent = state.wood;
  }

  toast(msg, cls = '', ms = 2600) {
    const d = document.createElement('div');
    d.className = `toast ${cls}`;
    d.textContent = msg;
    d.style.animationDuration = `${ms}ms`;
    if (ms > 4000) d.classList.add('long'); // multi-sentence reports get more room
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 4) this.el.toasts.removeChild(this.el.toasts.firstChild);
    setTimeout(() => d.remove(), ms);
  }

  // ----- phone -----
  openPhone(game) {
    this.game = game;
    this.el.phone.classList.remove('hidden');
    this.refreshPhone();
  }
  closePhone() { this.el.phone.classList.add('hidden'); }
  get phoneOpen() { return !this.el.phone.classList.contains('hidden'); }

  refreshPhone() {
    const g = this.game;
    if (!g || !this.phoneOpen) return;
    const s = g.state;
    this.el.phoneClock.textContent = g.daynight.timeString;
    this.el.phMoney.textContent = Math.floor(s.money).toLocaleString();
    this.el.phGold.textContent = s.gold.toFixed(2);
    for (const b of this.el.phoneTabs.children) b.classList.toggle('active', b.dataset.tab === this.phoneTab);
    const c = this.el.phoneContent;
    c.innerHTML = '';
    if (this.phoneTab === 'shop') this.renderShop(c);
    else if (this.phoneTab === 'stats') this.renderStats(c);
    else this.renderSystem(c);
  }

  renderShop(c) {
    const g = this.game, s = g.state;
    const sell = document.createElement('button');
    sell.className = 'btn primary wide';
    sell.disabled = s.gold < 0.005;
    sell.textContent = s.gold >= 0.005
      ? `Sell ${s.gold.toFixed(2)} g gold for $${Math.floor(s.gold * CONFIG.goldPrice).toLocaleString()}`
      : `No gold to sell ($${CONFIG.goldPrice}/g)`;
    sell.onclick = () => { g.sellGold(); this.refreshPhone(); };
    c.appendChild(sell);
    if (s.wood > 0) {
      const sw = document.createElement('button');
      sw.className = 'btn wide';
      sw.textContent = `Sell ${s.wood} log${s.wood === 1 ? '' : 's'} for $${(s.wood * CONFIG.woodPrice).toLocaleString()}`;
      sw.onclick = () => { g.sellWood(); this.refreshPhone(); };
      c.appendChild(sw);
    }

    let lastCat = null;
    for (const item of CONFIG.shop) {
      if (item.cat !== lastCat) {
        lastCat = item.cat;
        const h = document.createElement('div');
        h.className = 'phone-section';
        h.textContent = item.cat;
        c.appendChild(h);
      }
      const row = document.createElement('div');
      row.className = 'item';
      let price, label, disabled = false, meta = '';
      if (item.consumable) {
        price = item.price; label = `$${price}`;
        const have = { turret: s.turrets, torch: s.torches, belts: s.belts, beltHopper: s.hoppers }[item.id] ?? 0;
        meta = `You have ${have}`;
      } else if (item.unique) {
        if (s.owned[item.id]) {
          label = 'Owned'; disabled = true;
          meta = item.id === 'loader' || item.id === 'dozer' ? 'Parked at camp'
            : item.id === 'inn' ? ((s.kits?.inn || 0) > 0 ? 'Ready to place (B → 3)' : 'Built')
            : item.id === 'barracks' ? ((s.kits?.barracks || 0) > 0 ? 'Ready to place (B → 4)' : 'Built')
            : item.id === 'church' ? ((s.kits?.church || 0) > 0 ? 'Ready to place (B → 5)' : 'Built')
            : item.id === 'towCable' ? 'In your pack' : 'In your hotbar';
        }
        else { price = item.price; label = `$${price.toLocaleString()}`; }
      } else if (item.recruit) {
        const n = g.mercs.count, max = CONFIG.mercs.max;
        label = `${item.goldPrice} g`;
        const barracks = g.buildings.first('barracks');
        if (!barracks) { label = 'Needs barracks'; disabled = true; }
        else if (n >= max) { label = 'Full'; disabled = true; }
        else if (s.gold < item.goldPrice) disabled = true;
        meta = `${n}/${max} on the payroll`;
      } else if (item.action) {
        price = item.price; label = `$${price}`;
        if (item.id === 'repairPlant') {
          if (!g.washPlant.damaged) { label = 'Not needed'; disabled = true; }
          meta = g.washPlant.damaged ? 'WRECKED' : `Condition ${Math.round((g.washPlant.hp / g.washPlant.maxHp) * 100)}%`;
        } else if (item.id === 'repairVehicles') {
          const wrecked = g.vehicles.filter((v) => v.wrecked);
          if (!wrecked.length) { label = 'Not needed'; disabled = true; meta = 'All machines running'; }
          else meta = `Wrecked: ${wrecked.map((v) => v.name).join(', ')}`;
        }
      } else {
        const lvl = s.upgrades[item.id] || 0;
        if (lvl >= item.prices.length) { label = 'Maxed'; disabled = true; }
        else { price = item.prices[lvl]; label = `$${price.toLocaleString()}`; }
        meta = `Level ${lvl}/${item.prices.length}`;
      }
      if (price != null && s.money < price) disabled = true;
      row.innerHTML = `<div><div class="name">${item.name} <span class="lvl">${meta}</span></div><div class="desc">${item.desc}</div></div>`;
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = label;
      btn.disabled = disabled;
      btn.onclick = () => { g.buy(item.id); this.refreshPhone(); };
      row.appendChild(btn);
      c.appendChild(row);
    }
  }

  renderStats(c) {
    const g = this.game, s = g.state;
    const rows = [
      ['Day', s.day],
      ['Nights survived', Math.max(0, g.enemies.night - (g.enemies.nightActive ? 1 : 0))],
      ['Nights slept at the inn', s.nightsSlept || 0],
      ['Night battles won / lost', `${s.battlesWon || 0} / ${s.battlesLost || 0}`],
      ['Mercenaries on the payroll', `${g.mercs.count} (${s.mercsLost || 0} fallen)`],
      ['Skeletons destroyed', s.kills],
      ['Gold on hand', `${s.gold.toFixed(2)} g`],
      ['Gold mined (total)', `${s.goldMined.toFixed(2)} g`],
      ['Nuggets found', s.nuggetsFound || 0],
      ['Biggest nugget', s.biggestNugget ? `${s.biggestNugget.toFixed(2)} g` : '—'],
      ['Gold stolen by skeletons', `${g.washPlant.stolen.toFixed(2)} g`],
      ['Turrets deployed', g.turrets.filter((t) => t.alive).length],
      ['Trees chopped', g.forest.chopped.length],
      ['Spent on earthworks', `$${Math.round(s.earthworksSpent || 0).toLocaleString()}`],
      ['Logs on hand', s.wood],
      ['Wash plant condition', g.washPlant.damaged ? 'WRECKED' : `${Math.round((g.washPlant.hp / g.washPlant.maxHp) * 100)}%`],
      ['Weather', WEATHER_LABEL[g.weather.type]],
    ];
    for (const [k, v] of rows) {
      const r = document.createElement('div');
      r.className = 'stat-row';
      r.innerHTML = `<span>${k}</span><span>${v}</span>`;
      c.appendChild(r);
    }
  }

  renderSystem(c) {
    const g = this.game;
    const mk = (label, cls, fn) => {
      const b = document.createElement('button');
      b.className = `btn wide ${cls}`;
      b.textContent = label;
      b.onclick = fn;
      c.appendChild(b);
    };
    mk('Save game', 'primary', () => { g.save(); this.refreshPhone(); });
    mk('Load last save', '', () => g.loadSavedFromMenu());
    mk('New game', 'danger', () => { if (confirm('Start a new game? Unsaved progress will be lost.')) g.newGame(); });
    const h = document.createElement('div');
    h.className = 'phone-section';
    h.textContent = 'Controls';
    c.appendChild(h);
    const ctl = document.createElement('div');
    ctl.className = 'controls';
    ctl.innerHTML = '<div><b>WASD</b> move · <b>Shift</b> run · <b>LMB</b> use tool</div><div><b>1-7</b> tools · <b>B</b> build · <b>E</b> vehicles / collect gold · <b>F</b> dump</div><div><b>TAB</b> phone · <b>Esc</b> pause</div>';
    c.appendChild(ctl);

    // developer cheats for testing
    const dh = document.createElement('div');
    dh.className = 'phone-section';
    dh.textContent = 'Developer (cheats)';
    c.appendChild(dh);
    const s = g.state;
    mk('+ $10,000', '', () => { s.money += 10000; this.toast('+$10,000 (cheat)', 'gold'); this.refreshPhone(); });
    mk('+ 50 g gold', '', () => { s.gold += 50; this.toast('+50 g gold (cheat)', 'gold'); this.refreshPhone(); });
    mk('+ 20 belts, 2 hoppers, 3 turrets, 5 torches', '', () => { s.belts += 20; s.hoppers += 2; s.turrets += 3; s.torches += 5; this.toast('Supplies added (cheat)', 'gold'); this.refreshPhone(); });
    mk('Unlock Inn, Barracks & Church kits', '', () => {
      for (const id of ['inn', 'barracks', 'church']) if (!s.owned[id]) { s.owned[id] = true; s.kits[id] = (s.kits[id] || 0) + 1; }
      this.toast('Building kits added — press B, then 3 / 4 / 5 (cheat)', 'gold'); this.refreshPhone();
    });
    mk('Skip to next morning (08:00)', '', () => { g.daynight.hours = 8; g.prevHours = 8; if (g.enemies.nightActive || g.enemies.list.length) g.enemies.endNight(); g.enemies.resolved = false; this.toast('Time set to 08:00 (cheat)'); this.refreshPhone(); });
    mk('Skip to dusk (20:00)', '', () => { g.daynight.hours = 20; g.prevHours = 20; this.toast('Time set to 20:00 (cheat)'); this.refreshPhone(); });
  }

  // ----- pause -----
  openPause() { this.el.pause.classList.remove('hidden'); }
  closePause() { this.el.pause.classList.add('hidden'); }

  // ----- start -----
  showStart(hasSave) {
    this.el.start.classList.remove('hidden');
    this.el.continueBtn.classList.toggle('hidden', !hasSave);
  }
  hideStart() { this.el.start.classList.add('hidden'); }
}
