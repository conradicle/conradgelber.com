import { BALLS } from './engine/physics.js';
import { groupBalls, lowestBall, onTheEight } from './engine/rules.js';

/**
 * Everything the game says in words: the result of each shot (shown on
 * screen and announced), and the table summary for screen readers.
 * `names` is [player 0, player 1] and `me` is the viewer's seat (or null).
 */

const list = (ns) => {
  const b = ns.map((n) => `the ${n}`);
  if (b.length <= 1) return b.join('');
  return `${b.slice(0, -1).join(', ')} and ${b[b.length - 1]}`;
};

function who(names, me, p) {
  return p === me ? 'You' : names[p];
}
const pocketed = (names, me, p) => `${who(names, me, p)} pocketed`;

const FOULS = {
  scratch: 'scratch',
  'no-hit': 'no ball hit',
  'no-rail': 'no ball reached a rail',
  timeout: 'out of time',
  'eight-first': 'the 8 was hit first on an open table',
};

function foulText(r) {
  return r.fouls
    .map((f) => {
      if (f === 'wrong-first') {
        if (r.game === 9) return `the ${r.firstHit} was hit before the ${r.wanted[0]}`;
        if (r.wanted.length === 1 && r.wanted[0] === 8) return `the ${r.firstHit} was hit before the 8`;
        return r.firstHit === 8 ? 'the 8 was hit first' : `the ${r.firstHit} is the other group`;
      }
      return FOULS[f];
    })
    .join('; ');
}

const WIN = {
  eight: (w) => `${w} pocketed the 8.`,
  nine: (w) => `${w} pocketed the 9.`,
  'early-eight': () => 'The 8 went down early.',
  'wrong-pocket': () => 'The 8 went in the wrong pocket.',
  'scratch-on-eight': () => 'Scratch on the 8.',
  'foul-on-eight': () => 'The 8 went down on a foul.',
  forfeit: () => 'The other player did not come back.',
  left: () => 'The other player left.',
};

/** One or two sentences about the last shot or event. */
export function describe(state, names, me) {
  const r = state.last;
  if (!r) return '';
  const parts = [];
  if (r.kind === 'shot') {
    const mine = r.pocketed.filter((n) => !(r.win && n === (state.game === 9 ? 9 : 8)));
    if (r.fouls.length) {
      if (mine.length) parts.push(`${pocketed(names, me, r.shooter)} ${list(mine)}.`);
      parts.push(`Foul: ${foulText(r)}.`);
    } else if (mine.length) {
      parts.push(`${pocketed(names, me, r.shooter)} ${list(mine)}.`);
    } else if (!r.win) parts.push(`${who(names, me, r.shooter)} missed.`);
    if (r.respotted?.length) parts.push(`${list(r.respotted).replace(/^t/, 'T')} ${r.respotted.length > 1 ? 'are' : 'is'} back on the foot spot.`);
    if (r.assigned) {
      const g = r.assigned.group;
      const other = g === 'solids' ? 'stripes' : 'solids';
      const p = r.assigned.player;
      parts.push(p === me ? `You have ${g}.` : `${names[p]} has ${g}${me != null ? `; you have ${other}` : `; ${names[1 - p]} has ${other}`}.`);
    }
  } else if (r.kind === 'timeout') {
    parts.push(`Foul: ${who(names, me, r.shooter) === 'You' ? 'you ran' : `${names[r.shooter]} ran`} out of time.`);
  }
  if (r.win) {
    const w = who(names, me, r.win.winner);
    const reason = WIN[r.win.reason] ? WIN[r.win.reason](who(names, me, r.kind === 'shot' ? r.shooter : r.win.winner)) : '';
    parts.push(reason, r.win.winner === me ? 'You win.' : `${w} wins.`);
    return parts.filter(Boolean).join(' ');
  }
  const next = state.turn;
  if (state.ballInHand) parts.push(next === me ? 'Ball in hand for you.' : `Ball in hand for ${names[next]}.`);
  parts.push(next === me ? 'Your turn.' : `${names[next]}'s turn.`);
  if (next === me && onTheEight(state, me)) parts.push(`You are on the 8: call a pocket before you shoot.`);
  return parts.join(' ');
}

/** A plain summary of the table: what is left, whose group is whose, whose turn. */
export function summary(state, names, me) {
  const t = state.table;
  const on = [];
  for (let n = 1; n < BALLS; n++) if (t.on[n]) on.push(n);
  const lines = [];
  if (state.game === 9) {
    lines.push(`9-ball. On the table: ${on.join(', ') || 'nothing'}.`);
    if (on.length) lines.push(`The lowest ball is the ${lowestBall(t)}.`);
  } else if (!state.groups) {
    lines.push(`8-ball, open table. On the table: ${on.join(', ') || 'nothing'}.`);
  } else {
    lines.push('8-ball.');
    for (const p of [0, 1]) {
      const left = groupBalls(state.groups[p]).filter((n) => t.on[n]);
      const name = p === me ? 'You' : names[p];
      lines.push(`${name}: ${state.groups[p]}, ${left.length ? `${left.join(', ')} left` : 'all down, on the 8'}.`);
    }
    lines.push(t.on[8] ? 'The 8 is on the table.' : 'The 8 is down.');
  }
  if (!t.on[0]) lines.push('The cue ball is off the table.');
  if (state.phase === 'over') lines.push(state.winner === me ? 'You won.' : `${names[state.winner]} won.`);
  else {
    const turn = state.turn === me ? 'Your turn' : `${names[state.turn]}'s turn`;
    const hand = state.ballInHand === 'kitchen' ? ', ball in hand behind the line' : state.ballInHand ? ', ball in hand' : '';
    lines.push(`${turn}${hand}.`);
    if (state.phase === 'break') lines.push('This shot is the break.');
  }
  return lines.join(' ');
}

