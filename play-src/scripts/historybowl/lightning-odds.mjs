// Print how many of 8 the computer gets in lightning turns and bounceback
// lists, through the same functions a match uses (planBotLightning and
// planBotBounces in match.js).
//   node play-src/scripts/historybowl/lightning-odds.mjs [runs]

import { BOT_PRESETS, LIGHTNING, botProfile, planBotLightning, planBotBounces } from '../../src/historybowl/match.js';

const runs = Number(process.argv[2]) || 10000;
const N = LIGHTNING.questions;

function report(label, counts, p) {
  const mean = counts.reduce((s, c, k) => s + c * k, 0) / runs;
  const sd = Math.sqrt(counts.reduce((s, c, k) => s + c * (k - mean) ** 2, 0) / runs);
  console.log(`  ${label}: per question ${p.toFixed(3)}, expected ${(N * p).toFixed(2)} of ${N}, got mean ${mean.toFixed(2)} (sd ${sd.toFixed(2)})`);
  for (let k = 0; k <= N; k++) {
    const share = counts[k] / runs;
    console.log(`    ${k} of ${N}: ${String(counts[k]).padStart(5)}  ${(share * 100).toFixed(2).padStart(6)}%  ${'#'.repeat(Math.round(share * 60))}`);
  }
}

for (const [name, mu] of Object.entries(BOT_PRESETS)) {
  const profile = botProfile(mu);
  const own = Array(N + 1).fill(0);
  const bounce = Array(N + 1).fill(0);
  let unreached = 0;
  for (let t = 0; t < runs; t++) {
    const plan = planBotLightning(profile, N);
    own[plan.filter((q) => q.right).length]++;
    unreached += plan.filter((q) => !q.reached).length;
    bounce[planBotBounces(profile, N).filter(Boolean).length]++;
  }
  console.log(`${name} (buzzes right at about ${Math.round(mu * 100)}%), ${runs} runs each`);
  report('own 60-second turn', own, profile.lightning);
  console.log(`    questions not reached in time: ${(unreached / runs).toFixed(2)} a turn`);
  report('bounceback list of 8', bounce, profile.lightning * 0.6);
}
