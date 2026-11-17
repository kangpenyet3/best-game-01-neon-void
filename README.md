# NEON VOID — Arena

A neon arena shooter for the desktop browser. Survive escalating waves in a sealed arena,
chain kills to raise your combo multiplier, grab cores for Rapid Fire / Shield / Nova,
and bring down the **Dreadnought** every fifth wave.

**Play:** open `game/index.html` in a browser (or `node serve.ts` and visit
http://localhost:8080). Fully offline — no assets, no network: art is drawn with canvas
paths and every sound is synthesized with WebAudio.

**Controls:** WASD / arrows to fly · mouse to aim · click / Space to fire · Shift to dash ·
P to pause · Enter to start / restart.

**Enemies:** Chaser (fast dart) · Weaver (sine strafing) · Splitter (bursts into Minis) ·
Gunner (keeps range, shoots back) · the Dreadnought (radial barrages, two phases).

Built with vanilla JavaScript ES modules — `game/src/main.js` holds the simulation and
renderer, `game/src/shots.js` stages the deterministic screenshot scenes (`?shot=`).
The make.fun entry program is `main.ts`, which copies `game/` and `screenshots/` to the
output and writes the judge's dossier with the vendored `buildDossier`.

License: MIT (see LICENSE).
