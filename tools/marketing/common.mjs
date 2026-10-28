// Shared look for Who Sabi? awareness posts: the game's colours, fonts and pattern band.
import { readFileSync } from 'node:fs';

const FONTS = new URL('../../apps/api/assets/fonts', import.meta.url).pathname;
const b64 = (f) => readFileSync(`${FONTS}/${f}`).toString('base64');

export const C = {
  green: '#008751',
  greenInk: '#006B40',
  greenTint: '#E3F3EA',
  orange: '#FF7A00',
  gold: '#FFB547',
  cream: '#FFFDF7',
  ink: '#14231B',
  inkSoft: '#3F4A44',
  wrong: '#B3191C',
  sand: '#F3EEE1',
  slang: '#8E44AD',
  nollywood: '#E67E22',
  music: '#2980B9',
  food: '#C0392B',
  sport: '#B8860B',
  mixed: '#16A085',
};

export const css = `
@font-face { font-family: Baloo; font-weight: 800; src: url(data:font/ttf;base64,${b64('Baloo2_800ExtraBold.ttf')}); }
@font-face { font-family: Nunito; font-weight: 700; src: url(data:font/ttf;base64,${b64('Nunito_700Bold.ttf')}); }
@font-face { font-family: Nunito; font-weight: 800; src: url(data:font/ttf;base64,${b64('Nunito_800ExtraBold.ttf')}); }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; }
body { font-family: Nunito, 'Noto Color Emoji', sans-serif; font-weight: 700; color: ${C.ink}; background: ${C.green}; }
.display { font-family: Baloo, 'Noto Color Emoji', sans-serif; font-weight: 800; line-height: 1.02; }
.band { display: flex; width: 100%; }
.tile { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; }
.tile.g { background: ${C.greenInk}; }
.tile.o { background: ${C.orange}; }
.tile.g i { display: block; width: 40%; height: 40%; border-radius: 50%; background: ${C.orange}; }
.tile.o i { display: block; width: 34%; height: 34%; background: #fff; transform: rotate(45deg); }
.chip { display: inline-flex; align-items: center; gap: .35em; padding: .35em .8em; border-radius: 999px; color: #fff; font-weight: 800; }
.pill { display: inline-flex; padding: .3em 1em; border-radius: 999px; font-weight: 800; }
`;

export function band(width, tile) {
  const n = Math.ceil(width / tile);
  return `<div class="band" style="height:${tile}px">${Array.from(
    { length: n },
    (_, i) => `<div class="tile ${i % 2 ? 'o' : 'g'}" style="width:${tile}px;height:${tile}px"><i></i></div>`,
  ).join('')}</div>`;
}

export const CATEGORIES = [
  ['🗣️', 'Slang & Pidgin', C.slang],
  ['🎬', 'Nollywood', C.nollywood],
  ['🎶', 'Music', C.music],
  ['🍲', 'Food', C.food],
  ['⚽', 'Sport', C.sport],
  ['🇳🇬', 'Mixed Naija', C.mixed],
];

export const page = (w, h, body, extraCss = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${css}
  html,body{width:${w}px;height:${h}px}${extraCss}</style></head><body>${body}</body></html>`;
