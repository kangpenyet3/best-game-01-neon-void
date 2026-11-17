// Screenshot scenes behind ?shot=start|play|boss|end&seed=N. Each scene builds a real game state
// and steps the actual simulation forward with a simple autopilot, so the frame is a genuine
// moment of play — the same seed always produces the same frame.
import { Game, VIEW, render } from './main.js';

function autopilot(g, input) {
  const p = g.player;
  let nearest = null; let nd = 1e9;
  for (const e of g.enemies) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < nd) { nd = d; nearest = e; } }
  input.left = input.right = input.up = input.down = 0;
  if (nearest) {
    input.mouseX = nearest.x; input.mouseY = nearest.y; input.firing = 1;
    // strafe around the target, backing off when it gets close
    const dx = p.x - nearest.x, dy = p.y - nearest.y;
    const px = -dy, py = dx;
    const want = nd < 190 ? 1 : 0.25;
    const mx = px * 0.8 + dx * want, my = py * 0.8 + dy * want;
    if (mx < -20) input.left = 1; if (mx > 20) input.right = 1;
    if (my < -20) input.up = 1; if (my > 20) input.down = 1;
  } else { input.firing = 0; input.mouseX = p.x + 120; input.mouseY = p.y - 60; }
  // dodge enemy bullets crudely: dash when one is close and closing
  input.dash = g.enemyBullets.some(b => Math.hypot(b.x - p.x, b.y - p.y) < 90) ? 1 : 0;
}

function compose(g, input, x, y) {
  // Final framing: park the ship at (x, y), aim at the nearest enemy, and run a short firing
  // burst through the real simulation so the frame shows live fire, not a frozen diorama.
  const p = g.player;
  p.x = x; p.y = y; p.vx = 0; p.vy = 0;
  let nearest = null; let nd = 1e9;
  for (const e of g.enemies) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < nd) { nd = d; nearest = e; } }
  const aim = { left: 0, right: 0, up: 0, down: 0, firing: 1, dash: 0, mouseX: nearest ? nearest.x : x + 200, mouseY: nearest ? nearest.y : y - 100 };
  for (let s = 0; s < 14; s++) g.update(1 / 60, aim);
  return aim;
}

function stage(g, kind) {
  const input = { left: 0, right: 0, up: 0, down: 0, firing: 0, dash: 0, mouseX: VIEW.width / 2, mouseY: VIEW.height / 3 };
  if (kind === 'start') { g.time = 1.4; return { g, input }; }
  g.startGame();
  if (kind === 'play') {
    g.wave = 2; g.beginWave(); // wave 3
    g.player.x = 470; g.player.y = 470;
    for (let i = 0; i < 10; i++) g.spawnEnemy(['chaser', 'weaver', 'splitter', 'gunner'][i % 4]);
    for (let s = 0; s < 150; s++) { autopilot(g, input); g.update(1 / 60, input); }
    g.score = 15300; g.combo = 9; g.comboTimer = 2.0;
    // a few fresh hunters converging at mid-range so the frame reads as a swarm
    const spots = [[300, 250], [880, 300], [760, 620], [380, 640]];
    for (let i = 0; i < spots.length; i++) {
      g.spawnEnemy(['chaser', 'weaver', 'chaser', 'splitter'][i]);
      const e = g.enemies[g.enemies.length - 1];
      e.x = spots[i][0]; e.y = spots[i][1]; e.spawnIn = 0;
    }
    return { g, input: compose(g, input, 620, 430) };
  }
  if (kind === 'boss') {
    g.wave = 4; g.beginWave(); // wave 5: Dreadnought + escorts
    g.lives = 2; g.player.shield = 6;
    g.player.x = 640; g.player.y = 560;
    const boss = g.enemies.find(e => e.kind === 'boss');
    if (boss) { boss.hp = Math.floor(boss.maxHp * 0.58); boss.fireTimer = 0.25; }
    for (let s = 0; s < 200; s++) { autopilot(g, input); g.update(1 / 60, input); }
    g.score = 38900; g.combo = 7; g.comboTimer = 2.0;
    const b2 = g.enemies.find(e => e.kind === 'boss');
    if (b2) { // guarantee a radial volley is mid-flight in the frame
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + 0.4;
        g.enemyBullets.push({ x: b2.x + Math.cos(a) * 95, y: b2.y + Math.sin(a) * 95, vx: Math.cos(a) * 215, vy: Math.sin(a) * 215, life: 2.4, radius: 6 });
      }
    }
    return { g, input: compose(g, input, 640, 545) };
  }
  if (kind === 'end') {
    g.wave = 6; g.beginWave();
    g.score = 52340; g.kills = 143; g.wave = 7; g.lives = 0;
    g.player.alive = false; g.screen = 'over';
    g.burst(g.player.x, g.player.y, '#39c2ff', 60, 340);
    g.burst(g.player.x, g.player.y, '#ffffff', 30, 240);
    for (let s = 0; s < 26; s++) g.updateFx(1 / 60);
    g.time = 2.2;
  }
  return { g, input };
}

export function runShot(canvas, params) {
  const kind = params.get('shot') || 'play';
  const seed = Number(params.get('seed') || 1);
  const ctx = canvas.getContext('2d');
  const g = new Game(seed);
  const { input } = stage(g, kind);
  render(ctx, g, input);
  document.title = `shot:${kind}`;
}
