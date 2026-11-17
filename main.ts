// NEON VOID — entry program for make.fun best-game-01 (Node 22, standard library only).
// The game itself lives in game/ as plain static files (index.html + ES modules, no library,
// no network). This program is the hand-in: it stages game/ and screenshots/ into the output
// directory and writes dossier.json there with the vendored buildDossier — that dossier is
// what the house judge reads. Run locally with MAKEFUN_OUTPUT_DIR=out node main.ts, and play
// the staged copy with `node serve.ts` (http://localhost:8080).

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Copy one tree of the entry into the output directory and report how many files landed.
function stageTree(name) {
  const from = join(repoDir, name);
  if (!existsSync(from)) return 0;
  const into = join(outputDir, name);
  mkdirSync(into, { recursive: true });
  cpSync(from, into, { recursive: true });
  return readdirSync(into, { recursive: true }).length;
}

mkdirSync(outputDir, { recursive: true });
const gameFiles = stageTree('game');
const shotFiles = stageTree('screenshots');

// The gate's caps, mirrored from the kit's reference/gate.json so a local run refuses what
// the scorer would refuse: dossier text up to 160 KiB, at most 4 screenshots of 256 KiB,
// and game/ within 993 files / 48 MiB / 1000-byte paths.
const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);
console.log(`NEON VOID staged: ${gameFiles} game files, ${shotFiles} screenshots, dossier written.`);
