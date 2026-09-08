import { CONFIG } from './config.js';

/**
 * The night battle you fight in your sleep — a Risk-style dice duel.
 *
 * Your defenders (mercenaries, then turrets) line up on the left, the skeleton horde on the right.
 * Each round the front unit of each side rolls a d6 plus its bonuses; the loser's unit is destroyed.
 * Ties go to the defender (you). The fight ends when one side has nothing left.
 *
 * Bonuses (Age of Imperialism-style): every unit gets +1 for each *other* unique unit type standing on
 * its side, plus a per-type modifier (turrets and brutes are tougher) and situational buffs — a well-lit
 * camp for you, a moonless night or a storm for them.
 *
 * The class is frame-driven (update(dt, input)) so pausing/tab-switching can't desync it. It resolves
 * the fight cosmetically here; the world consequences are applied by Game.applyBattleOutcome().
 */

const UNIT = {
  merc: { name: 'Mercenary', icon: '🛡️' },
  turret: { name: 'Turret', icon: '⚙️' },
  sword: { name: 'Skeleton', icon: '💀' },
  archer: { name: 'Archer', icon: '🏹' },
  brute: { name: 'Brute', icon: '🦴' },
  golem: { name: 'Golem', icon: '🗿' },
};
const ENEMY_ORDER = ['sword', 'archer', 'brute', 'golem'];
const ROLL_MS = 620;

export class Battle {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.el = {};
    for (const id of ['battle', 'bTitle', 'bSub', 'bLeft', 'bRight', 'bLeftCount', 'bRightCount', 'bLeftBuffs', 'bRightBuffs', 'bRound', 'dieL', 'dieR', 'dieLMod', 'dieRMod', 'bResult', 'bLog', 'bSkip', 'bDone']) {
      this.el[id] = document.getElementById(id);
    }
    this.el.bSkip.onclick = () => this.skip();
    this.el.bDone.onclick = () => this.finish();
  }

  // ------------------------------------------------------------ setup
  /**
   * @param night   night number (for the title)
   * @param army    enemy unit types, e.g. ['sword','sword','archer']
   * @param onDone  called with the result once the player dismisses the screen
   */
  start(night, army, onDone) {
    const g = this.game, s = g.state;
    this.onDone = onDone;
    this.night = night;
    this.left = { name: 'defenders', units: [], buffs: [] };
    this.right = { name: 'horde', units: [], buffs: [] };
    for (let i = 0; i < g.mercs.count; i++) this.left.units.push({ type: 'merc' });
    for (const t of g.turrets) if (t.alive) this.left.units.push({ type: 'turret' });
    const sorted = [...army].sort((a, b) => ENEMY_ORDER.indexOf(a) - ENEMY_ORDER.indexOf(b));
    for (const type of sorted) this.right.units.push({ type });

    // situational buffs
    const moon = g.daynight.moon, weather = g.weather.type;
    if (g.placedTorches.length >= CONFIG.battle.torchesForBuff) this.left.buffs.push({ label: `Well-lit camp (${g.placedTorches.length} torches)`, val: 1 });
    if (s.upgrades.sword >= 2) this.left.buffs.push({ label: 'Steel from your armoury', val: 1 });
    if (moon && moon.light < 0.15) this.right.buffs.push({ label: `${moon.icon} Moonless night`, val: 1 });
    if (weather === 'storm') this.right.buffs.push({ label: '⛈ Thunderstorm', val: 1 });
    if (weather === 'fog') this.right.buffs.push({ label: '🌫 Fog', val: 1 });

    this.result = { won: false, killed: [], lostMercs: 0, lostTurrets: 0, survivors: [], rounds: 0, log: [] };
    this.round = 0;
    this.phase = 'intro';
    this.t = 0;
    this.faceTimer = 0;
    this.active = true;

    // render
    const el = this.el;
    el.battle.classList.remove('hidden');
    el.bDone.classList.add('hidden');
    el.bSkip.classList.remove('hidden');
    el.bTitle.textContent = `Night ${night} — The Raid`;
    el.bSub.textContent = `${moon ? `${moon.icon} ${moon.name}` : ''} · ${weather.charAt(0).toUpperCase() + weather.slice(1)} · ${this.right.units.length} attacker${this.right.units.length === 1 ? '' : 's'}`;
    el.bLog.innerHTML = '';
    el.bResult.className = 'bResult';
    el.bResult.textContent = this.left.units.length ? 'The horde approaches…' : 'Nobody is guarding the camp!';
    el.dieL.querySelector('span').textContent = '?';
    el.dieR.querySelector('span').textContent = '?';
    el.dieL.className = 'die left';
    el.dieR.className = 'die right';
    el.bRound.textContent = 'Battle stations';
    this._renderSide(this.left, el.bLeft, el.bLeftCount, el.bLeftBuffs);
    this._renderSide(this.right, el.bRight, el.bRightCount, el.bRightBuffs);
    this._refreshBonuses();
  }

  _renderSide(side, container, countEl, buffsEl) {
    container.innerHTML = '';
    for (const u of side.units) {
      const d = document.createElement('div');
      d.className = 'bu';
      d.innerHTML = `<span class="ic">${UNIT[u.type].icon}</span><span class="nm">${UNIT[u.type].name}</span><span class="bn"></span>`;
      container.appendChild(d);
      u.el = d;
    }
    if (!side.units.length) container.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px">— none —</div>';
    countEl.textContent = `${side.units.length}`;
    buffsEl.innerHTML = side.buffs.map((b) => `<div><b>+${b.val}</b> ${b.label}</div>`).join('') || '<div>No situational bonuses</div>';
  }

  /** Alive units of a side (dead ones are kept for the DOM, flagged). */
  alive(side) { return side.units.filter((u) => !u.dead); }

  /** Roll modifier of a unit: type modifier + (other unique types alive on its side) + situational buffs. */
  bonus(side, unit) {
    const types = new Set(this.alive(side).map((u) => u.type));
    const unique = Math.max(0, types.size - 1);
    const situ = side.buffs.reduce((a, b) => a + b.val, 0);
    return (CONFIG.battle.unitBonus[unit.type] || 0) + this.typeUpgrade(unit.type) + unique + situ;
  }

  /** Extra roll bonus a unit type earns from your phone upgrades. */
  typeUpgrade(type) {
    const up = this.game.state.upgrades;
    if (type === 'merc') return up.mercTraining || 0;
    if (type === 'turret') return (up.turretDmg || 0) >= 2 ? 1 : 0;
    return 0;
  }

  _refreshBonuses() {
    for (const side of [this.left, this.right]) {
      const alive = this.alive(side);
      for (const u of alive) { u.el.querySelector('.bn').textContent = `+${this.bonus(side, u)}`; u.el.classList.remove('front'); }
      if (alive.length) alive[0].el.classList.add('front');
    }
    this.el.bLeftCount.textContent = `${this.alive(this.left).length}`;
    this.el.bRightCount.textContent = `${this.alive(this.right).length}`;
    // the bonus list also shows the unique-unit stack and per-type modifiers
    for (const [side, el] of [[this.left, this.el.bLeftBuffs], [this.right, this.el.bRightBuffs]]) {
      const types = new Set(this.alive(side).map((u) => u.type));
      const uniq = Math.max(0, types.size - 1);
      const rows = [...side.buffs.map((b) => `<div><b>+${b.val}</b> ${b.label}</div>`)];
      if (uniq > 0) rows.push(`<div><b>+${uniq}</b> ${types.size} unique unit types</div>`);
      for (const t of types) {
        const v = (CONFIG.battle.unitBonus[t] || 0) + this.typeUpgrade(t);
        if (v > 0) rows.push(`<div><b>+${v}</b> ${UNIT[t].name}s${t === 'merc' ? ' (drilled)' : t === 'turret' && this.typeUpgrade(t) ? ' (heavy rounds)' : ''}</div>`);
      }
      el.innerHTML = rows.join('') || '<div>No bonuses</div>';
    }
  }

  // ------------------------------------------------------------ resolution
  /** Resolve one round. Returns the record, or null when the battle is over. */
  resolveRound() {
    const L = this.alive(this.left), R = this.alive(this.right);
    if (!L.length || !R.length) return null;
    const lu = L[0], ru = R[0];
    const lb = this.bonus(this.left, lu), rb = this.bonus(this.right, ru);
    const ld = 1 + Math.floor(Math.random() * 6), rd = 1 + Math.floor(Math.random() * 6);
    const lt = ld + lb, rt = rd + rb;
    const leftWins = lt >= rt; // ties to the defender
    const loser = leftWins ? ru : lu;
    loser.dead = true;
    this.round++;
    this.result.rounds++;
    if (leftWins) this.result.killed.push(ru.type);
    else if (lu.type === 'merc') this.result.lostMercs++;
    else this.result.lostTurrets++;
    const rec = { lu, ru, ld, rd, lb, rb, lt, rt, leftWins, loser };
    const text = leftWins
      ? `${UNIT[lu.type].name} ${ld}${lb ? `+${lb}` : ''} beats ${UNIT[ru.type].name} ${rd}${rb ? `+${rb}` : ''}${lt === rt ? ' (tie → defender)' : ''}`
      : `${UNIT[ru.type].name} ${rd}${rb ? `+${rb}` : ''} beats ${UNIT[lu.type].name} ${ld}${lb ? `+${lb}` : ''}`;
    rec.text = text;
    this.result.log.push(text);
    return rec;
  }

  _finalise() {
    const L = this.alive(this.left), R = this.alive(this.right);
    this.result.won = R.length === 0;
    this.result.survivors = R.map((u) => u.type);
    this.result.leftLeft = L.length;
  }

  // ------------------------------------------------------------ per-frame
  update(dt, input) {
    if (!this.active) return;
    const el = this.el;
    this.t += dt;
    if (this.phase !== 'end' && input.pressed(' ')) { this.skip(); return; }
    if (this.phase === 'end' && (input.pressed('e') || input.pressed(' ') || input.pressed('enter'))) { this.finish(); return; }

    switch (this.phase) {
      case 'intro':
        if (this.t > 1.4) this._startRound();
        break;
      case 'roll': {
        this.faceTimer -= dt;
        if (this.faceTimer <= 0) {
          this.faceTimer = 0.07;
          el.dieL.querySelector('span').textContent = 1 + Math.floor(Math.random() * 6);
          el.dieR.querySelector('span').textContent = 1 + Math.floor(Math.random() * 6);
        }
        if (this.t > (ROLL_MS / 1000) * this.pace()) this._showRound();
        break;
      }
      case 'show':
        if (this.t > (Math.max(0.3, (CONFIG.battle.rollMs - ROLL_MS) / 1000) + 0.35) * this.pace()) this._afterRound();
        break;
      default: break;
    }
  }

  /** Long sieges speed up so a 40-skeleton night doesn't take a minute to watch. */
  pace() { return this.round >= 16 ? 0.45 : this.round >= 8 ? 0.65 : 1; }

  _startRound() {
    const L = this.alive(this.left), R = this.alive(this.right);
    if (!L.length || !R.length) { this._end(); return; }
    this.phase = 'roll';
    this.t = 0;
    this.faceTimer = 0;
    const el = this.el;
    el.bRound.textContent = `Round ${this.round + 1}`;
    el.dieL.className = 'die left rolling';
    el.dieR.className = 'die right rolling';
    el.dieLMod.textContent = `+${this.bonus(this.left, L[0])}`;
    el.dieRMod.textContent = `+${this.bonus(this.right, R[0])}`;
    el.bResult.className = 'bResult';
    el.bResult.textContent = `${UNIT[L[0].type].name} vs ${UNIT[R[0].type].name}`;
  }

  _showRound() {
    const rec = this.resolveRound();
    this.phase = 'show';
    this.t = 0;
    if (!rec) { this._end(); return; }
    this.current = rec;
    const el = this.el;
    el.dieL.querySelector('span').textContent = rec.ld;
    el.dieR.querySelector('span').textContent = rec.rd;
    el.dieL.className = `die left ${rec.leftWins ? 'win' : 'lose'}`;
    el.dieR.className = `die right ${rec.leftWins ? 'lose' : 'win'}`;
    el.bResult.className = `bResult ${rec.leftWins ? 'good' : 'bad'}`;
    el.bResult.textContent = rec.text;
    rec.loser.el.classList.add('hit');
    this._log(rec.text);
  }

  _afterRound() {
    const rec = this.current;
    if (rec) { rec.loser.el.classList.remove('hit'); rec.loser.el.classList.add('dead'); }
    this._refreshBonuses();
    this._startRound();
  }

  _log(text) {
    const d = document.createElement('div');
    d.textContent = text;
    this.el.bLog.appendChild(d);
    while (this.el.bLog.children.length > 6) this.el.bLog.removeChild(this.el.bLog.firstChild);
  }

  /** Resolve every remaining round instantly. */
  skip() {
    if (!this.active || this.phase === 'end') return;
    if (this.phase === 'show' && this.current) { this.current.loser.el.classList.add('dead'); }
    let rec;
    while ((rec = this.resolveRound())) { rec.loser.el.classList.add('dead'); this._log(rec.text); }
    this._refreshBonuses();
    this._end();
  }

  _end() {
    this.phase = 'end';
    this.t = 0;
    this._finalise();
    const r = this.result, el = this.el;
    el.dieL.className = 'die left';
    el.dieR.className = 'die right';
    el.dieLMod.textContent = '';
    el.dieRMod.textContent = '';
    el.bRound.textContent = `${r.rounds} round${r.rounds === 1 ? '' : 's'}`;
    el.bResult.className = 'bResult final';
    if (r.won) {
      el.bResult.textContent = r.lostMercs + r.lostTurrets === 0 ? 'Flawless victory! The camp is safe.' : `Victory — but it cost ${this._losses(r)}.`;
    } else {
      const n = r.survivors.length;
      el.bResult.textContent = this.left.units.length
        ? `Defeat. ${n} skeleton${n === 1 ? '' : 's'} run loose in the camp…`
        : `Undefended — ${n} skeleton${n === 1 ? '' : 's'} run loose in the camp…`;
    }
    el.bSkip.classList.add('hidden');
    el.bDone.classList.remove('hidden');
  }

  _losses(r) {
    const p = [];
    if (r.lostMercs) p.push(`${r.lostMercs} mercenar${r.lostMercs === 1 ? 'y' : 'ies'}`);
    if (r.lostTurrets) p.push(`${r.lostTurrets} turret${r.lostTurrets === 1 ? '' : 's'}`);
    return p.join(' and ');
  }

  finish() {
    if (!this.active) return;
    if (this.phase !== 'end') this.skip();
    this.active = false;
    this.el.battle.classList.add('hidden');
    const r = this.result;
    this.onDone?.(r);
  }
}
