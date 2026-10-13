// History Bowl Study, phase 3: the match format and the computer opponent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUARTERS, tieredPoints, tossupPoints, lightningPoints, firstPick, shorten, botProfile, botTossup, botBuzzWord,
  BOT_PRESETS, offerCategories, lightningFromBonuses, newMatch, award, unaward, scores, afterFourth, winner, LIGHTNING,
} from '../src/historybowl/match.js';
import { fromQbBonus } from '../src/historybowl/question.js';
import { words } from '../src/historybowl/text.js';
import { readFileSync } from 'node:fs';

function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

test('the four quarters match the regional format', () => {
  assert.deepEqual(QUARTERS.map((q) => q.tossups || 0), [10, 8, 0, 8]);
  assert.ok(QUARTERS[1].bonus && QUARTERS[2].lightning && QUARTERS[3].tiered);
  assert.deepEqual([LIGHTNING.questions, LIGHTNING.seconds, LIGHTNING.points, LIGHTNING.sweep], [8, 60, 10, 20]);
});

test('fourth-quarter points by thirds of the question', () => {
  assert.equal(tieredPoints(1, 90), 30);
  assert.equal(tieredPoints(30, 90), 30);
  assert.equal(tieredPoints(31, 90), 20);
  assert.equal(tieredPoints(60, 90), 20);
  assert.equal(tieredPoints(61, 90), 10);
  assert.equal(tieredPoints(90, 90), 10);
  assert.equal(tossupPoints(1, 5, 90), 10);
  assert.equal(tossupPoints(4, 5, 90), 30);
});

test('lightning: 10 each, 20 more for all 8', () => {
  assert.equal(lightningPoints([true, true, false, true, false, false, false, false]), 30);
  assert.equal(lightningPoints(Array(8).fill(true)), 100);
  assert.equal(lightningPoints(Array(7).fill(true).concat([null])), 70);
});

test('the trailing team picks first; a tie is a coin toss', () => {
  assert.equal(firstPick([40, 60]), 0);
  assert.equal(firstPick([80, 60]), 1);
  assert.equal(firstPick([50, 50], () => 0.1), 0);
  assert.equal(firstPick([50, 50], () => 0.9), 1);
});

test('shortened tossups keep the last sentences and the question', () => {
  const long = 'First clue is very hard and long and specific to experts only. Second clue narrows it down for most players. Third clue is easier. For 10 points, name this Roman emperor.';
  const s = shorten(long, 14);
  assert.equal(s.shortened, true);
  assert.equal(s.text, 'Third clue is easier. For 10 points, name this Roman emperor.');
  assert.equal(shorten('Short one. For 10 points, name it.', 45).shortened, false);
  // A single long sentence stays whole.
  const one = Array(60).fill('word').join(' ') + '.';
  assert.equal(words(shorten(one, 20).text).length, 60);
});

test('the bot buzzes near its set point and knows more when stronger', () => {
  for (const [name, mu] of Object.entries(BOT_PRESETS)) {
    const p = botProfile(mu);
    const rnd = seeded(name.length * 99);
    let rightBuzz = [];
    let right = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const plan = botTossup(p, rnd);
      if (plan.buzz !== null && plan.right) {
        right++;
        rightBuzz.push(plan.buzz);
      }
    }
    const avg = rightBuzz.reduce((a, b) => a + b, 0) / rightBuzz.length;
    assert.ok(Math.abs(avg - mu) < 0.05, `${name}: average correct buzz ${avg.toFixed(2)} vs ${mu}`);
    assert.ok(right / N > 0.3 && right / N < 0.9, `${name}: ${right / N}`);
  }
  assert.ok(botProfile(BOT_PRESETS.hard).know > botProfile(BOT_PRESETS.easy).know);
  assert.equal(botBuzzWord({ buzz: 0.5 }, 90), 45);
  assert.equal(botBuzzWord({ buzz: null }, 90), null);
  assert.equal(botBuzzWord({ buzz: 0.001 }, 90), 1);
});

test('lightning categories: three offered, two of them history', () => {
  const offer = offerCategories(seeded(3));
  assert.equal(offer.length, 3);
  assert.equal(offer.filter((c) => c.cat === 'History').length, 2);
  assert.equal(new Set(offer.map((c) => c.label)).size, 3);
});

test('lightning questions take each bonus\'s first part before any second part', () => {
  const b = (id) => fromQbBonus({
    _id: id,
    leadin_sanitized: `Leadin ${id}. For 10 points each,`,
    parts_sanitized: [`Name this first ${id}.`, `Name this second ${id}.`, `Name this third ${id}.`],
    answers_sanitized: ['A', 'B', 'C'],
    answers: ['<b><u>A</u></b>', 'B', 'C'],
    category: 'History',
    subcategory: 'World History',
    difficultyModifiers: ['e', 'm', 'h'],
  });
  const bonuses = ['x', 'y', 'z', 'w', 'v'].map(b);
  assert.equal(bonuses[0].leadin, 'Leadin x.');
  const lead = fromQbBonus({ _id: 'l', leadin_sanitized: 'For ten points each, answer some questions about a lance:', parts_sanitized: ['p'], answers_sanitized: ['a'], answers: ['a'] });
  assert.equal(lead.leadin, 'Answer some questions about a lance:');
  const qs = lightningFromBonuses(bonuses);
  assert.equal(qs.length, 8);
  assert.deepEqual(qs.slice(0, 5).map((q) => q.text), ['Name this first x.', 'Name this first y.', 'Name this first z.', 'Name this first w.', 'Name this first v.']);
  assert.equal(qs[0].leadin, 'Leadin x.');
  assert.equal(qs[5].leadin, '');
});

test('scoring a match, an overrule, and a tiebreak', () => {
  const m = newMatch();
  award(m, 0, 10);
  award(m, 1, 30);
  m.quarter = 4;
  award(m, 0, 30);
  assert.deepEqual(scores(m), [40, 30]);
  unaward(m, 0, 30, 4);
  award(m, 1, 10);
  assert.deepEqual(scores(m), [10, 40]);
  assert.deepEqual(m.teams[0].byQuarter, [10, 0, 0, 0, 0]);
  award(m, 0, 30);
  assert.equal(afterFourth(m), 'tiebreak');
  assert.equal(m.quarter, 5);
  award(m, 0, 10);
  assert.equal(afterFourth(m), 'done');
  assert.equal(winner(m), 0);
});

// Lightning odds, through the same planners the simulator calls.
import { planBotLightning, planBotBounces } from '../src/historybowl/match.js';

function histogram(runs, draw) {
  const h = Array(9).fill(0);
  for (let i = 0; i < runs; i++) h[draw()]++;
  const mean = h.reduce((s, c, k) => s + c * k, 0) / runs;
  return { h, mean };
}

test('lightning turns and bounceback lists center on 8 times the per-question odds', () => {
  const runs = 10000;
  for (const [name, mu] of Object.entries(BOT_PRESETS)) {
    const p = botProfile(mu);
    const rnd = seeded(1000 + name.length);
    const own = histogram(runs, () => planBotLightning(p, 8, rnd).filter((q) => q.right).length);
    const bounce = histogram(runs, () => planBotBounces(p, 8, rnd).filter(Boolean).length);
    // Standard error of the mean is under 0.02 here; 0.08 is four of them.
    assert.ok(Math.abs(own.mean - 8 * p.lightning) < 0.08, `${name} own turn mean ${own.mean}`);
    assert.ok(Math.abs(bounce.mean - 8 * p.lightning * 0.6) < 0.08, `${name} bounceback mean ${bounce.mean}`);
    // A clean sweep of 8 bouncebacks is rare at every level (under 1%).
    assert.ok(bounce.h[8] / runs < 0.01, `${name} 8 of 8 bouncebacks: ${bounce.h[8]}`);
  }
  // At Hard, the medians: own turn 6, bouncebacks 3 or 4.
  const hard = botProfile(BOT_PRESETS.hard);
  const rnd7 = seeded(7);
  const b = histogram(runs, () => planBotBounces(hard, 8, rnd7).filter(Boolean).length);
  assert.ok(b.mean > 3.5 && b.mean < 3.7, `hard bounceback mean ${b.mean}`);
});

test('a slow computer runs out of time and the rest go unreached', () => {
  const slow = { ...botProfile(0.95), pace: 11 };
  const plan = planBotLightning(slow, 8, seeded(3));
  const reached = plan.filter((q) => q.reached).length;
  assert.ok(reached < 8 && reached >= 4, `reached ${reached}`);
  assert.equal(plan.length, 8);
  // Once one is unreached, all later ones are, and none of them count as right.
  const first = plan.findIndex((q) => !q.reached);
  assert.ok(plan.slice(first).every((q) => !q.reached && !q.right));
  assert.ok(plan.filter((q) => q.reached).reduce((s, q) => s + q.seconds, 0) <= 60);
});

test('the simulator draws lightning outcomes only through the tested planners', () => {
  const src = readFileSync(new URL('../src/historybowl/sim.js', import.meta.url), 'utf8');
  assert.ok(src.includes('planBotLightning(') && src.includes('planBotBounces('));
  assert.ok(!/\bbotLightning\(|\bbotBounce\(/.test(src), 'sim.js calls botLightning or botBounce directly');
});
