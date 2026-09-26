/**
 * What the browser and the pool Worker agree on: the socket path, room
 * codes, names and frame sizes. Room codes and names follow Cambio's rules
 * (conradicle/cambio-game, packages/shared/src/protocol.ts) so the two
 * games behave the same way.
 */
export { ENGINE_VERSION } from './version.js';

/** Same-origin socket path on conradgelber.com. */
export const WS_PATH = '/pool/ws';

/** Frames larger than this are dropped unread. */
export const MAX_FRAME_BYTES = 4096;

export const NAME_MAX = 16;

/**
 * Six letters from 17 is 24,137,569 codes, so guessing one that is in use is
 * hopeless at the per-IP limit on wrong codes. Codes are read aloud, so
 * letters that look or sound alike are out: I/O (1/0), B/D/E/P/V, M/N.
 */
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = 'ACFGHJKLQRSTUWXYZ';

const BLOCKED_CODES = new Set([
  'ARSE', 'ARSS', 'ASSS', 'CLAT', 'COCK', 'CRAP', 'CUCK', 'CUMS', 'CUNT', 'DAMN', 'DICK', 'DYKE', 'FAGS', 'FAGG', 'FART',
  'FUCK', 'FUKK', 'FUKS', 'FUXX', 'GASH', 'GOOK', 'HAGS', 'HELL', 'HOAR', 'HORE', 'JAPS', 'JISM', 'JIZZ', 'KIKE',
  'KUKS', 'LUST', 'PAKI', 'PISS', 'POOP', 'PORN', 'PUSS', 'RAPE', 'SCAT', 'SHAT', 'SHIT', 'SLAG', 'SLUT', 'SUCK', 'SUKK',
  'TITS', 'TURD', 'TWAT', 'WANK', 'WHOR', 'WTFF', 'XXXX', 'ASSH', 'THOT', 'SCUM', 'SKAG', 'SHAG', 'HARD', 'FAAG', 'FUQQ',
]);
const BLOCKED_PARTS = ['FAG', 'FUK', 'FUC', 'FUQ', 'KKK', 'ASS', 'CUM', 'JIZ', 'TIT', 'WTF', 'XXX', 'SUK', 'CUK', 'KYK', 'NAZ', 'SS'];

/** No blocked word anywhere in the code, and no blocked fragment. */
export function isAllowedRoomCode(code) {
  for (let i = 0; i + 4 <= code.length; i++) if (BLOCKED_CODES.has(code.slice(i, i + 4))) return false;
  return !BLOCKED_PARTS.some((part) => code.includes(part));
}

/** A room code as typed (any case, spaces round it), or null if it cannot be one. */
export function cleanCode(raw) {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return code.length === ROOM_CODE_LENGTH && [...code].every((c) => ROOM_CODE_ALPHABET.includes(c)) ? code : null;
}

/**
 * Control and format characters, separators and blank-looking fillers are
 * stripped from names, so "Bo" plus a zero-width space cannot pass for "Bo".
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}ᅟᅠㅤﾠ⠀]/gu;

export function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const flat = raw.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  // Cut by code points so an emoji is never split into a lone surrogate.
  const name = Array.from(flat).slice(0, NAME_MAX).join('').trim();
  return name.length > 0 ? name : null;
}

/** Seconds on the shot clock, and how long a player may be away mid-game. */
export const SHOT_CLOCK_MS = 60_000;
export const RECONNECT_MS = 5 * 60_000;
/** Shots play back at this speed, so the server can tell when the animation ends. */
export const PLAYBACK = 1.2;
