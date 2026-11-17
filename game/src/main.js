// NEON VOID — a neon arena shooter in one module (plus shots.js for the screenshot scenes).
// Survive escalating waves in a sealed arena: WASD/arrows to fly, mouse to aim, click or Space
// to fire, Shift for a dash, P to pause. Chain kills to raise the combo multiplier, grab cores
// for Rapid / Shield / Nova, and bring down the Dreadnought every fifth wave.
// Everything is drawn with canvas paths and synthesized with WebAudio — no assets, no network.

export const VIEW = { width: 1280, height: 800 };
const TAU = Math.PI * 2;

// Deterministic RNG (mulberry32) so screenshot scenes and replays are stable per seed.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- audio
// Tiny synth: every sound is an oscillator blip; music is a looping bass arp scheduled live.
class SoundBank {
  constructor() { this.ctx = null; this.musicOn = false; this.nextNote = 0; this.step = 0; }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    } catch { this.ctx = null; }
  }
  blip(freq, dur, type = 'square', vol = 0.5, slide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur);
  }
  shoot() { this.blip(880 + Math.random() * 120, 0.08, 'square', 0.16, -420); }
  hit() { this.blip(220, 0.06, 'sawtooth', 0.14, -90); }
  boom(big) { this.blip(big ? 90 : 140, big ? 0.5 : 0.28, 'sawtooth', 0.5, -70); this.blip(55, big ? 0.6 : 0.3, 'triangle', 0.5, -20); }
  pickup() { this.blip(660, 0.09, 'sine', 0.4, 330); setTimeout(() => this.blip(990, 0.12, 'sine', 0.35, 220), 55); }
  hurt() { this.blip(160, 0.25, 'sawtooth', 0.5, -110); }
  dash() { this.blip(320, 0.14, 'sine', 0.25, 480); }
  wave() { this.blip(523, 0.12, 'triangle', 0.35); setTimeout(() => this.blip(784, 0.16, 'triangle', 0.35), 90); }
  musicTick(now) {
    if (!this.ctx || !this.musicOn) return;
    const bass = [55, 55, 82.4, 55, 65.4, 55, 98, 73.4];
    while (this.nextNote < now + 0.12) {
      const f = bass[this.step % bass.length];
      const t = Math.max(this.nextNote, now);
      const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.20, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.24);
      if (this.step % 4 === 0) this.blip(1318, 0.05, 'sine', 0.05);
      this.nextNote = t + 0.235; this.step += 1;
    }
  }
}
export const sound = new SoundBank();

// ---------------------------------------------------------------- entities
const ENEMY_TYPES = {
  chaser:  { hp: 1, speed: 118, radius: 15, score: 100, color: '#ff3b6b' },
  weaver:  { hp: 2, speed: 92,  radius: 16, score: 150, color: '#ffb02e' },
  splitter:{ hp: 3, speed: 74,  radius: 21, score: 200, color: '#b26bff' },
  mini:    { hp: 1, speed: 168, radius: 10, score: 50,  color: '#e08fff' },
  gunner:  { hp: 4, speed: 58,  radius: 19, score: 300, color: '#2ee6a8' },
  boss:    { hp: 60, speed: 34, radius: 58, score: 5000, color: '#ff4545' },
};

export class Game {
  constructor(seed = 1) {
    this.rng = makeRng(seed);
    this.screen = 'title'; // title | play | over
    this.paused = false;
    this.time = 0;
    this.reset();
  }
  reset() {
    this.score = 0; this.combo = 1; this.comboTimer = 0; this.kills = 0;
    this.wave = 0; this.waveState = 'banner'; this.waveTimer = 1.6; this.toSpawn = 0; this.spawnTimer = 0;
    this.lives = 3; this.shake = 0; this.flash = 0; this.slowmo = 1;
    this.bullets = []; this.enemyBullets = []; this.enemies = []; this.particles = [];
    this.texts = []; this.pickups = []; this.stars = [];
    for (let i = 0; i < 130; i++) this.stars.push({ x: this.rng() * VIEW.width, y: this.rng() * VIEW.height, z: 0.3 + this.rng() * 0.7, r: this.rng() * 1.6 + 0.4 });
    this.player = { x: VIEW.width / 2, y: VIEW.height / 2, vx: 0, vy: 0, angle: -Math.PI / 2, radius: 14,
      fireTimer: 0, rapid: 0, shield: 0, invuln: 0, dashTimer: 0, dashCooldown: 0, alive: true, thrust: 0 };
  }
  startGame() { this.reset(); this.screen = 'play'; sound.ensure(); sound.musicOn = true; sound.nextNote = 0; }

  // ------------------------------------------------------------ waves
  beginWave() {
    this.wave += 1;
    const w = this.wave;
    this.toSpawn = 6 + w * 3;
    this.spawnTimer = 0.4;
    this.waveState = 'spawning';
    if (w % 5 === 0) { this.spawnBoss(); this.toSpawn = Math.floor(this.toSpawn / 2); }
    sound.wave();
  }
  spawnPoint() {
    // Spawn on the arena edge, away from the player.
    for (let tries = 0; tries < 8; tries++) {
      const side = Math.floor(this.rng() * 4);
      const x = side === 0 ? 30 : side === 1 ? VIEW.width - 30 : 40 + this.rng() * (VIEW.width - 80);
      const y = side === 2 ? 30 : side === 3 ? VIEW.height - 30 : 40 + this.rng() * (VIEW.height - 80);
      const d = Math.hypot(x - this.player.x, y - this.player.y);
      if (d > 260 || tries === 7) return { x, y };
    }
    return { x: 40, y: 40 };
  }
  spawnEnemy(kind) {
    const t = ENEMY_TYPES[kind]; const p = this.spawnPoint();
    this.enemies.push({ kind, x: p.x, y: p.y, vx: 0, vy: 0, hp: t.hp, maxHp: t.hp, radius: t.radius,
      angle: this.rng() * TAU, wobble: this.rng() * TAU, fireTimer: 1 + this.rng() * 1.6, spawnIn: 0.45, flash: 0 });
    this.burst(p.x, p.y, t.color, 10, 130);
  }
  spawnBoss() {
    const t = ENEMY_TYPES.boss;
    this.enemies.push({ kind: 'boss', x: VIEW.width / 2, y: 110, vx: 0, vy: 0, hp: t.hp + this.wave * 4, maxHp: t.hp + this.wave * 4,
      radius: t.radius, angle: 0, wobble: 0, fireTimer: 1.2, spawnIn: 0.8, flash: 0, phase: 1 });
    this.texts.push({ x: VIEW.width / 2, y: 210, vy: -18, life: 2.2, maxLife: 2.2, text: '⚠ DREADNOUGHT ⚠', color: '#ff4545', size: 34 });
  }
  pickKind() {
    const w = this.wave; const r = this.rng();
    if (w >= 3 && r < 0.16) return 'gunner';
    if (w >= 2 && r < 0.38) return 'splitter';
    if (r < 0.62) return 'weaver';
    return 'chaser';
  }

  // ------------------------------------------------------------ fx
  burst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = this.rng() * TAU; const s = (0.25 + this.rng() * 0.75) * speed;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35 + this.rng() * 0.45, maxLife: 0.8, color, size: 1.5 + this.rng() * 2.6 });
    }
  }
  addText(x, y, text, color = '#ffffff', size = 17) {
    this.texts.push({ x, y, vy: -44, life: 0.9, maxLife: 0.9, text, color, size });
  }

  // ------------------------------------------------------------ update
  update(dt, input) {
    this.time += dt;
    if (this.screen !== 'play' || this.paused) { this.updateFx(dt); return; }
    dt *= this.slowmo; this.slowmo += (1 - this.slowmo) * Math.min(1, dt * 5 + 0.02);
    const p = this.player;

    if (this.waveState === 'banner') {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) this.beginWave();
    } else if (this.waveState === 'spawning') {
      this.spawnTimer -= dt;
      if (this.toSpawn > 0 && this.spawnTimer <= 0) { this.spawnEnemy(this.pickKind()); this.toSpawn -= 1; this.spawnTimer = Math.max(0.24, 0.85 - this.wave * 0.045); }
      if (this.toSpawn <= 0 && this.enemies.length === 0) { this.waveState = 'banner'; this.waveTimer = 2.0; this.addText(VIEW.width / 2, 300, `WAVE ${this.wave} CLEAR`, '#2ee6a8', 30); }
    }

    // combo decay
    if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.combo = 1; }

    // player movement
    if (p.alive) {
      const ax = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const ay = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      const len = Math.hypot(ax, ay) || 1;
      const ACCEL = 2400, MAXV = 335;
      p.vx += (ax / len) * ACCEL * dt; p.vy += (ay / len) * ACCEL * dt;
      p.vx *= Math.pow(0.0015, dt); p.vy *= Math.pow(0.0015, dt);
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > MAXV) { p.vx = p.vx / sp * MAXV; p.vy = p.vy / sp * MAXV; }
      p.thrust = Math.min(1, sp / MAXV);
      if (input.dash && p.dashCooldown <= 0 && sp > 30) {
        p.dashTimer = 0.16; p.dashCooldown = 1.1; sound.dash();
        this.burst(p.x, p.y, '#39c2ff', 12, 90);
      }
      if (p.dashTimer > 0) { p.dashTimer -= dt; p.vx *= 1 + 9 * dt; p.vy *= 1 + 9 * dt; }
      p.dashCooldown = Math.max(0, p.dashCooldown - dt);
      p.x = Math.min(VIEW.width - 18, Math.max(18, p.x + p.vx * dt));
      p.y = Math.min(VIEW.height - 18, Math.max(18, p.y + p.vy * dt));
      p.angle = Math.atan2(input.mouseY - p.y, input.mouseX - p.x);
      p.invuln = Math.max(0, p.invuln - dt);
      p.rapid = Math.max(0, p.rapid - dt);
      p.shield = Math.max(0, p.shield - dt);

      // firing
      p.fireTimer -= dt;
      if (input.firing && p.fireTimer <= 0) {
        p.fireTimer = p.rapid > 0 ? 0.085 : 0.16;
        const spread = (this.rng() - 0.5) * 0.045;
        this.bullets.push({ x: p.x + Math.cos(p.angle) * 20, y: p.y + Math.sin(p.angle) * 20,
          vx: Math.cos(p.angle + spread) * 860, vy: Math.sin(p.angle + spread) * 860, life: 0.85, radius: 4 });
        sound.shoot();
      }
    }

    // bullets
    for (const b of this.bullets) { b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; }
    this.bullets = this.bullets.filter(b => b.life > 0 && b.x > -20 && b.x < VIEW.width + 20 && b.y > -20 && b.y < VIEW.height + 20);
    for (const b of this.enemyBullets) { b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; }
    this.enemyBullets = this.enemyBullets.filter(b => b.life > 0 && b.x > -20 && b.x < VIEW.width + 20 && b.y > -20 && b.y < VIEW.height + 20);

    // enemies
    for (const e of this.enemies) {
      if (e.spawnIn > 0) { e.spawnIn -= dt; continue; }
      e.flash = Math.max(0, e.flash - dt * 6);
      const t = ENEMY_TYPES[e.kind];
      const dx = p.x - e.x, dy = p.y - e.y; const d = Math.hypot(dx, dy) || 1;
      e.wobble += dt * 3;
      let mx = dx / d, my = dy / d;
      if (e.kind === 'weaver') { const s = Math.sin(e.wobble) * 0.85; const px = -my, py = mx; mx += px * s; my += py * s; }
      if (e.kind === 'gunner' && d < 300) { mx *= -0.4; my *= -0.4; } // keep distance
      if (e.kind === 'boss') {
        e.x += Math.sin(this.time * 0.6) * 26 * dt + mx * t.speed * dt * 0.4;
        e.y += (my * t.speed * 0.55) * dt;
        e.phase = e.hp < e.maxHp * 0.4 ? 2 : 1;
        e.fireTimer -= dt;
        if (e.fireTimer <= 0 && p.alive) {
          e.fireTimer = e.phase === 2 ? 0.55 : 0.85;
          const n = e.phase === 2 ? 10 : 7;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU + this.time;
            this.enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 215, vy: Math.sin(a) * 215, life: 2.6, radius: 6 });
          }
          sound.hit();
        }
      } else {
        e.vx += (mx * t.speed - e.vx) * Math.min(1, dt * 3.2);
        e.vy += (my * t.speed - e.vy) * Math.min(1, dt * 3.2);
        e.x += e.vx * dt; e.y += e.vy * dt;
        e.angle = Math.atan2(e.vy, e.vx);
        if (e.kind === 'gunner') {
          e.fireTimer -= dt;
          if (e.fireTimer <= 0 && d < 460 && p.alive) {
            e.fireTimer = 1.7 + this.rng() * 0.7;
            this.enemyBullets.push({ x: e.x, y: e.y, vx: (dx / d) * 300, vy: (dy / d) * 300, life: 2.4, radius: 5 });
            sound.hit();
          }
        }
      }
      // touch damage
      if (p.alive && p.invuln <= 0 && p.dashTimer <= 0 && d < e.radius + p.radius - 2) this.hurtPlayer(e);
    }

    // bullet vs enemy
    for (const b of this.bullets) {
      for (const e of this.enemies) {
        if (e.spawnIn > 0 || b.life <= 0) continue;
        if (Math.hypot(b.x - e.x, b.y - e.y) < e.radius + b.radius) {
          b.life = 0; e.hp -= 1; e.flash = 1; sound.hit();
          this.burst(b.x, b.y, ENEMY_TYPES[e.kind].color, 4, 150);
          if (e.hp <= 0) this.killEnemy(e);
        }
      }
    }
    this.enemies = this.enemies.filter(e => e.hp > 0);
    // enemy bullets vs player
    if (p.alive && p.invuln <= 0) {
      for (const b of this.enemyBullets) {
        if (Math.hypot(b.x - p.x, b.y - p.y) < p.radius + b.radius) { b.life = 0; this.hurtPlayer(null); break; }
      }
    }
    // pickups
    for (const k of this.pickups) {
      k.age += dt;
      const d = Math.hypot(k.x - p.x, k.y - p.y);
      if (p.alive && d < 130) { k.x += (p.x - k.x) * dt * 6; k.y += (p.y - k.y) * dt * 6; }
      if (p.alive && d < p.radius + 14) {
        k.taken = true; sound.pickup();
        if (k.kind === 'rapid') { p.rapid = 8; this.addText(p.x, p.y - 30, 'RAPID FIRE', '#ffd52e'); }
        if (k.kind === 'shield') { p.shield = 9; this.addText(p.x, p.y - 30, 'SHIELD UP', '#39c2ff'); }
        if (k.kind === 'nova') { this.novaBlast(); }
        if (k.kind === 'life') { this.lives = Math.min(5, this.lives + 1); this.addText(p.x, p.y - 30, '+1 HULL', '#2ee6a8'); }
      }
    }
    this.pickups = this.pickups.filter(k => !k.taken && k.age < 11);
    this.updateFx(dt);
    this.shake = Math.max(0, this.shake - dt * 26);
    this.flash = Math.max(0, this.flash - dt * 2.4);
  }
  updateFx(dt) {
    for (const q of this.particles) { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= Math.pow(0.02, dt); q.vy *= Math.pow(0.02, dt); q.life -= dt; }
    this.particles = this.particles.filter(q => q.life > 0);
    for (const t of this.texts) { t.y += t.vy * dt; t.life -= dt; }
    this.texts = this.texts.filter(t => t.life > 0);
  }
  novaBlast() {
    this.addText(this.player.x, this.player.y - 44, 'NOVA!', '#ff9f2e', 24);
    this.flash = Math.max(this.flash, 0.5); this.shake = Math.max(this.shake, 9);
    sound.boom(true);
    for (const e of this.enemies) { if (e.spawnIn <= 0) { e.hp -= 3; e.flash = 1; if (e.hp <= 0) this.killEnemy(e); } }
    this.enemies = this.enemies.filter(e => e.hp > 0);
    this.enemyBullets = [];
    this.burst(this.player.x, this.player.y, '#ff9f2e', 42, 380);
  }
  killEnemy(e) {
    const t = ENEMY_TYPES[e.kind];
    this.kills += 1;
    this.combo = Math.min(12, this.combo + (e.kind === 'boss' ? 4 : 1));
    this.comboTimer = 2.6;
    const gained = t.score * this.combo;
    this.score += gained;
    this.addText(e.x, e.y - 10, `+${gained}`, '#ffffff', e.kind === 'boss' ? 30 : 16);
    this.burst(e.x, e.y, t.color, e.kind === 'boss' ? 90 : 18, e.kind === 'boss' ? 340 : 230);
    this.shake = Math.max(this.shake, e.kind === 'boss' ? 14 : 4);
    sound.boom(e.kind === 'boss');
    if (e.kind === 'splitter') for (let i = 0; i < 3; i++) {
      const m = ENEMY_TYPES.mini;
      this.enemies.push({ kind: 'mini', x: e.x + (this.rng() - 0.5) * 30, y: e.y + (this.rng() - 0.5) * 30, vx: (this.rng() - 0.5) * 160, vy: (this.rng() - 0.5) * 160,
        hp: m.hp, maxHp: m.hp, radius: m.radius, angle: this.rng() * TAU, wobble: this.rng() * TAU, fireTimer: 2, spawnIn: 0.15, flash: 0 });
    }
    // drops
    const roll = this.rng();
    if (e.kind === 'boss') this.pickups.push({ x: e.x, y: e.y, kind: 'life', age: 0 });
    else if (roll < 0.055) this.pickups.push({ x: e.x, y: e.y, kind: 'rapid', age: 0 });
    else if (roll < 0.10) this.pickups.push({ x: e.x, y: e.y, kind: 'shield', age: 0 });
    else if (roll < 0.135) this.pickups.push({ x: e.x, y: e.y, kind: 'nova', age: 0 });
  }
  hurtPlayer(source) {
    const p = this.player;
    if (p.shield > 0) { p.invuln = 0.8; this.burst(p.x, p.y, '#39c2ff', 16, 240); sound.hit(); if (source) source.hp = 0; return; }
    this.lives -= 1; p.invuln = 1.6; this.shake = 12; this.flash = 0.55; this.slowmo = 0.25;
    this.burst(p.x, p.y, '#39c2ff', 30, 300); sound.hurt();
    if (source) source.hp = 0;
    if (this.lives <= 0) { p.alive = false; this.screen = 'over'; sound.musicOn = false; this.burst(p.x, p.y, '#ffffff', 70, 360); sound.boom(true); }
  }
}

// ---------------------------------------------------------------- render
function drawShip(ctx, p, time) {
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
  if (p.invuln > 0 && Math.floor(time * 14) % 2 === 0) ctx.globalAlpha = 0.35;
  // engine flame
  const flame = 12 + p.thrust * 16 + Math.sin(time * 40) * 3;
  ctx.beginPath(); ctx.moveTo(-13, 6); ctx.lineTo(-13 - flame, 0); ctx.lineTo(-13, -6); ctx.closePath();
  ctx.fillStyle = '#ff9f2e'; ctx.shadowColor = '#ff9f2e'; ctx.shadowBlur = 16; ctx.fill();
  // hull
  ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(-8, 11); ctx.lineTo(-14, 5); ctx.lineTo(-14, -5); ctx.lineTo(-8, -11); ctx.closePath();
  ctx.fillStyle = '#0e2a3f'; ctx.shadowColor = '#39c2ff'; ctx.shadowBlur = 18; ctx.fill();
  ctx.lineWidth = 2.2; ctx.strokeStyle = '#39c2ff'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-4, 6); ctx.lineTo(-4, -6); ctx.closePath();
  ctx.fillStyle = '#39c2ff'; ctx.fill();
  ctx.restore();
  if (p.shield > 0) {
    ctx.save(); ctx.beginPath(); ctx.arc(p.x, p.y, 30 + Math.sin(time * 5) * 2, 0, TAU);
    ctx.strokeStyle = 'rgba(57,194,255,0.75)'; ctx.lineWidth = 2.5; ctx.shadowColor = '#39c2ff'; ctx.shadowBlur = 14; ctx.stroke(); ctx.restore();
  }
}
function drawEnemy(ctx, e, time) {
  const t = ENEMY_TYPES[e.kind];
  ctx.save(); ctx.translate(e.x, e.y);
  const scale = e.spawnIn > 0 ? 1 - e.spawnIn / 0.45 * 0.7 : 1;
  ctx.scale(scale, scale); ctx.rotate(e.kind === 'boss' ? time * 0.35 : e.angle + Math.PI / 2);
  ctx.shadowColor = t.color; ctx.shadowBlur = 16;
  ctx.lineWidth = 2.4; ctx.strokeStyle = e.flash > 0.4 ? '#ffffff' : t.color;
  ctx.fillStyle = 'rgba(10,10,26,0.9)';
  const r = e.radius;
  ctx.beginPath();
  if (e.kind === 'chaser') { ctx.moveTo(r, 0); ctx.lineTo(-r * 0.8, r * 0.8); ctx.lineTo(-r * 0.4, 0); ctx.lineTo(-r * 0.8, -r * 0.8); }
  else if (e.kind === 'weaver') { ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); }
  else if (e.kind === 'splitter' || e.kind === 'mini') { for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; const rr = i % 2 ? r * 0.62 : r; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); } }
  else if (e.kind === 'gunner') { ctx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6); }
  else { for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; const rr = i % 2 ? r * 0.52 : r; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); } }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  if (e.kind === 'boss') { // counter-rotating inner ring for a mechanical core look
    ctx.save(); ctx.rotate(-time * 0.8); ctx.strokeRect(-r * 0.52, -r * 0.52, r * 1.04, r * 1.04); ctx.restore();
  }
  ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, TAU); ctx.fillStyle = e.flash > 0.4 ? '#fff' : t.color; ctx.fill();
  ctx.restore();
  if ((e.kind === 'boss' || e.kind === 'gunner' || e.kind === 'splitter') && e.hp < e.maxHp) {
    ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(e.x - e.radius, e.y - e.radius - 13, e.radius * 2, 5);
    ctx.fillStyle = t.color; ctx.fillRect(e.x - e.radius, e.y - e.radius - 13, e.radius * 2 * (e.hp / e.maxHp), 5); ctx.restore();
  }
}
const PICKUP_STYLE = { rapid: ['#ffd52e', 'R'], shield: ['#39c2ff', 'S'], nova: ['#ff9f2e', 'N'], life: ['#2ee6a8', '+'] };
export function render(ctx, g, input) {
  ctx.save();
  ctx.clearRect(0, 0, VIEW.width, VIEW.height);
  if (g.shake > 0) ctx.translate((Math.random() - 0.5) * g.shake, (Math.random() - 0.5) * g.shake);
  // grid + stars
  ctx.save(); ctx.strokeStyle = 'rgba(70,90,200,0.13)'; ctx.lineWidth = 1;
  for (let x = 0; x <= VIEW.width; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, VIEW.height); ctx.stroke(); }
  for (let y = 0; y <= VIEW.height; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(VIEW.width, y); ctx.stroke(); }
  for (const s of g.stars) { ctx.globalAlpha = 0.35 + s.z * 0.5; ctx.fillStyle = '#cfe6ff'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill(); }
  ctx.restore();
  // arena border
  ctx.save(); ctx.strokeStyle = 'rgba(57,194,255,0.5)'; ctx.lineWidth = 3; ctx.shadowColor = '#39c2ff'; ctx.shadowBlur = 12;
  ctx.strokeRect(9, 9, VIEW.width - 18, VIEW.height - 18); ctx.restore();

  for (const k of g.pickups) {
    const [color, letter] = PICKUP_STYLE[k.kind];
    const bob = Math.sin(g.time * 4 + k.x) * 3;
    ctx.save(); ctx.translate(k.x, k.y + bob); ctx.rotate(g.time * 1.6);
    ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 14; ctx.lineWidth = 2.2;
    ctx.strokeRect(-11, -11, 22, 22); ctx.restore();
    ctx.save(); ctx.fillStyle = color; ctx.font = 'bold 15px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(letter, k.x, k.y + bob + 1); ctx.restore();
  }
  for (const b of g.enemyBullets) {
    ctx.save(); ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, TAU);
    ctx.fillStyle = '#ff5d5d'; ctx.shadowColor = '#ff5d5d'; ctx.shadowBlur = 12; ctx.fill(); ctx.restore();
  }
  for (const b of g.bullets) {
    ctx.save(); ctx.strokeStyle = '#aef3ff'; ctx.shadowColor = '#39c2ff'; ctx.shadowBlur = 10; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(b.x - b.vx * 0.016, b.y - b.vy * 0.016); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
  }
  for (const e of g.enemies) drawEnemy(ctx, e, g.time);
  if (g.player.alive) drawShip(ctx, g.player, g.time);
  for (const q of g.particles) {
    ctx.save(); ctx.globalAlpha = Math.max(0, q.life / q.maxLife);
    ctx.fillStyle = q.color; ctx.shadowColor = q.color; ctx.shadowBlur = 8;
    ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size); ctx.restore();
  }
  for (const t of g.texts) {
    ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, t.life / (t.maxLife * 0.6)));
    ctx.fillStyle = t.color; ctx.font = `bold ${t.size}px system-ui`; ctx.textAlign = 'center';
    ctx.shadowColor = t.color; ctx.shadowBlur = 10; ctx.fillText(t.text, t.x, t.y); ctx.restore();
  }
  if (g.flash > 0) { ctx.fillStyle = `rgba(255,240,240,${g.flash * 0.35})`; ctx.fillRect(0, 0, VIEW.width, VIEW.height); }
  ctx.restore();

  // ------------------------------------------------------------ HUD / screens
  ctx.save();
  if (g.screen === 'play' || g.screen === 'over') {
    ctx.fillStyle = '#eaf6ff'; ctx.font = 'bold 25px system-ui'; ctx.textAlign = 'left';
    ctx.fillText(`SCORE ${g.score.toLocaleString('en-US')}`, 26, 42);
    ctx.font = 'bold 19px system-ui'; ctx.fillStyle = g.combo > 1 ? '#ffd52e' : 'rgba(234,246,255,0.55)';
    ctx.fillText(`COMBO ×${g.combo}`, 26, 70);
    if (g.combo > 1) { ctx.fillStyle = 'rgba(255,213,46,0.35)'; ctx.fillRect(26, 78, 110 * Math.max(0, g.comboTimer / 2.6), 4); }
    ctx.textAlign = 'right'; ctx.fillStyle = '#eaf6ff'; ctx.font = 'bold 22px system-ui';
    ctx.fillText(`WAVE ${Math.max(1, g.wave)}`, VIEW.width - 26, 42);
    for (let i = 0; i < g.lives; i++) {
      ctx.save(); ctx.translate(VIEW.width - 44 - i * 30, 62); ctx.rotate(-Math.PI / 2);
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, 6); ctx.lineTo(-6, -6); ctx.closePath();
      ctx.fillStyle = '#39c2ff'; ctx.shadowColor = '#39c2ff'; ctx.shadowBlur = 8; ctx.fill(); ctx.restore();
    }
    const boss = g.enemies.find(e => e.kind === 'boss');
    if (boss) {
      ctx.textAlign = 'center'; ctx.fillStyle = '#ff4545'; ctx.font = 'bold 16px system-ui';
      ctx.fillText('DREADNOUGHT', VIEW.width / 2, 30);
      ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fillRect(VIEW.width / 2 - 210, 38, 420, 9);
      ctx.fillStyle = '#ff4545'; ctx.fillRect(VIEW.width / 2 - 210, 38, 420 * Math.max(0, boss.hp / boss.maxHp), 9);
    }
    if (g.waveState === 'banner' && g.screen === 'play') {
      ctx.textAlign = 'center'; ctx.fillStyle = '#eaf6ff'; ctx.font = 'bold 54px system-ui';
      ctx.shadowColor = '#39c2ff'; ctx.shadowBlur = 24;
      ctx.fillText(`WAVE ${g.wave + 1}`, VIEW.width / 2, VIEW.height / 2 - 10);
      ctx.shadowBlur = 0; ctx.font = '19px system-ui'; ctx.fillStyle = 'rgba(234,246,255,0.75)';
      ctx.fillText(g.wave % 5 === 4 ? 'Something massive is coming…' : 'Get ready', VIEW.width / 2, VIEW.height / 2 + 28);
    }
    if (g.paused) {
      ctx.fillStyle = 'rgba(3,4,12,0.66)'; ctx.fillRect(0, 0, VIEW.width, VIEW.height);
      ctx.textAlign = 'center'; ctx.fillStyle = '#eaf6ff'; ctx.font = 'bold 46px system-ui'; ctx.fillText('PAUSED', VIEW.width / 2, VIEW.height / 2);
      ctx.font = '19px system-ui'; ctx.fillStyle = 'rgba(234,246,255,0.8)'; ctx.fillText('Press P to resume', VIEW.width / 2, VIEW.height / 2 + 40);
    }
  }
  if (g.screen === 'title') {
    ctx.textAlign = 'center';
    ctx.font = '900 96px system-ui';
    ctx.fillStyle = '#39c2ff'; ctx.shadowColor = '#39c2ff'; ctx.shadowBlur = 34;
    ctx.fillText('NEON VOID', VIEW.width / 2, 268);
    ctx.font = '900 40px system-ui'; ctx.fillStyle = '#ff3b6b'; ctx.shadowColor = '#ff3b6b'; ctx.shadowBlur = 22;
    ctx.fillText('A R E N A', VIEW.width / 2, 322);
    ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(234,246,255,0.88)'; ctx.font = '21px system-ui';
    ctx.fillText('Survive the swarm. Chain the combo. Down the Dreadnought.', VIEW.width / 2, 386);
    ctx.font = '19px system-ui'; ctx.fillStyle = 'rgba(234,246,255,0.66)';
    ctx.fillText('WASD / Arrows — fly      Mouse — aim      Click / Space — fire', VIEW.width / 2, 452);
    ctx.fillText('Shift — dash      P — pause      Grab cores: R Rapid · S Shield · N Nova · + Hull', VIEW.width / 2, 484);
    ctx.font = 'bold 26px system-ui'; ctx.fillStyle = `rgba(255,213,46,${0.65 + Math.sin(g.time * 4) * 0.35})`;
    ctx.fillText('CLICK OR PRESS ENTER TO LAUNCH', VIEW.width / 2, 566);
  }
  if (g.screen === 'over') {
    ctx.fillStyle = 'rgba(3,4,12,0.55)'; ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    ctx.textAlign = 'center';
    ctx.font = '900 72px system-ui'; ctx.fillStyle = '#ff3b6b'; ctx.shadowColor = '#ff3b6b'; ctx.shadowBlur = 28;
    ctx.fillText('SHIP DOWN', VIEW.width / 2, 300);
    ctx.shadowBlur = 0; ctx.fillStyle = '#eaf6ff'; ctx.font = 'bold 30px system-ui';
    ctx.fillText(`SCORE ${g.score.toLocaleString('en-US')}`, VIEW.width / 2, 366);
    ctx.font = '21px system-ui'; ctx.fillStyle = 'rgba(234,246,255,0.8)';
    ctx.fillText(`Reached wave ${Math.max(1, g.wave)} · ${g.kills} kills`, VIEW.width / 2, 404);
    ctx.font = 'bold 24px system-ui'; ctx.fillStyle = `rgba(255,213,46,${0.65 + Math.sin(g.time * 4) * 0.35})`;
    ctx.fillText('CLICK OR PRESS ENTER TO FLY AGAIN', VIEW.width / 2, 478);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- boot / input
export function boot(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  const g = new Game(opts.seed ?? 1);
  const input = { left: 0, right: 0, up: 0, down: 0, firing: 0, dash: 0, mouseX: VIEW.width / 2, mouseY: VIEW.height / 3 };
  const keys = {};
  const setKey = (code, v) => {
    keys[code] = v;
    input.left = keys.ArrowLeft || keys.KeyA; input.right = keys.ArrowRight || keys.KeyD;
    input.up = keys.ArrowUp || keys.KeyW; input.down = keys.ArrowDown || keys.KeyS;
    input.dash = keys.ShiftLeft || keys.ShiftRight; input.firing = input.firing || (keys.Space ? 1 : 0);
    if (keys.Space) input.firing = 1; else if (!mouseDown) input.firing = 0;
  };
  let mouseDown = false;
  window.addEventListener('keydown', e => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    setKey(e.code, true);
    if (e.code === 'KeyP' && g.screen === 'play') g.paused = !g.paused;
    if (e.code === 'Enter') { sound.ensure(); if (g.screen !== 'play') g.startGame(); }
  });
  window.addEventListener('keyup', e => setKey(e.code, false));
  const toGame = e => {
    const r = canvas.getBoundingClientRect();
    input.mouseX = (e.clientX - r.left) / r.width * VIEW.width;
    input.mouseY = (e.clientY - r.top) / r.height * VIEW.height;
  };
  canvas.addEventListener('mousemove', toGame);
  canvas.addEventListener('mousedown', e => { toGame(e); mouseDown = true; input.firing = 1; sound.ensure(); if (g.screen !== 'play') g.startGame(); });
  window.addEventListener('mouseup', () => { mouseDown = false; if (!keys.Space) input.firing = 0; });
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000); last = now;
    sound.musicTick(now / 1000);
    g.update(dt, input);
    render(ctx, g, input);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return { game: g, input, ctx };
}

const params = new URLSearchParams(location.search);
if (!params.has('shot')) {
  boot(document.getElementById('game'));
} else {
  import('./shots.js').then(m => m.runShot(document.getElementById('game'), params));
}
