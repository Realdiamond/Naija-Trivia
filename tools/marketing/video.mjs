/* global document, window */
/**
 * A 16-second WhatsApp Status video (1080×1920, 30 fps, H.264): drawn frame by frame in a browser
 * from one HTML page whose `render(t)` sets every element for time t, then encoded with ffmpeg
 * (which must be installed). Written to tools/marketing/out/. Run: node tools/marketing/video.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { band, C, CATEGORIES, page } from './common.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const W = 1080;
const H = 1920;
const FPS = 30;
const SECONDS = 16;

const options = ['To dance', 'To relocate abroad', 'To borrow money', 'To eat quickly'];

const html = page(
  W,
  H,
  `
<div id="top" style="position:absolute;top:0;left:0;right:0">${band(W, 108)}</div>
<div id="bottom" style="position:absolute;bottom:0;left:0;right:0">${band(W, 108)}</div>

<div id="s1" class="scene" style="justify-content:center;gap:28px">
  <div id="logo" class="display" style="font-size:186px;color:#fff;white-space:nowrap">Who Sabi?</div>
  <div id="tag" style="font-size:54px;color:${C.gold};font-weight:800;letter-spacing:3px">NAIJA TRIVIA DUELS 🇳🇬</div>
  <div id="line" class="display" style="font-size:100px;color:#fff;margin-top:60px">Think say you<br>sabi pass your guy?</div>
</div>

<div id="s2" class="scene" style="justify-content:center;gap:34px">
  <div id="round" class="chip" style="background:${C.slang};font-size:40px">🗣️ Round 1 · Slang & Pidgin</div>
  <div id="card" style="width:100%;background:${C.cream};border-radius:52px;padding:46px;display:flex;flex-direction:column;gap:22px">
    <div style="display:flex;align-items:center;gap:20px">
      <div style="flex:1;height:22px;border-radius:11px;background:${C.sand};overflow:hidden"><div id="timer" style="height:100%;width:100%;background:${C.orange};border-radius:11px"></div></div>
      <div id="secs" class="display" style="font-size:52px;width:70px;text-align:right">10</div>
    </div>
    <div class="display" style="font-size:78px;margin:6px 0 10px">What does “japa” mean?</div>
    ${options.map((o, i) => `<div id="o${i}" class="opt"><span class="letter display" id="l${i}">${'ABCD'[i]}</span><span>${o}</span></div>`).join('')}
  </div>
  <div style="position:relative;height:140px;width:100%;display:flex;justify-content:center;align-items:center">
    <div id="points" class="display" style="position:absolute;font-size:96px;color:${C.gold}">+186</div>
    <div id="cheer" class="pill display" style="position:absolute;background:#fff;color:${C.greenInk};font-size:78px;padding:.18em .8em .08em">You too sabi! 😎</div>
  </div>
</div>

<div id="s3" class="scene" style="justify-content:center;gap:56px">
  <div id="t3" class="display" style="font-size:104px;color:#fff">Challenge<br>your people</div>
  <div style="display:flex;align-items:center;justify-content:center;gap:30px;width:100%">
    <div id="pa" class="player"><div id="ra" class="avatar" style="background:${C.greenInk}">T</div><div class="pname">Tolu</div><div id="sa" class="score display">0</div></div>
    <div id="vs" class="display" style="font-size:80px;color:${C.gold}">vs</div>
    <div id="pb" class="player"><div id="rb" class="avatar" style="background:#C0392B">A</div><div class="pname">Ada</div><div id="sb" class="score display">0</div></div>
  </div>
  <div id="cap" class="display" style="font-size:80px;color:#fff;background:rgba(0,0,0,.18);border-radius:40px;padding:26px 40px">Tolu don school Ada<br>for Food 🍲</div>
</div>

<div id="s4" class="scene" style="justify-content:center;gap:44px">
  <div id="logo4" class="display" style="font-size:150px;color:#fff;white-space:nowrap">Who Sabi?</div>
  <div id="ask" class="display" style="font-size:100px;color:#fff;white-space:nowrap">Who sabi pass? 🇳🇬</div>
  <div id="chips" style="display:flex;flex-wrap:wrap;gap:20px;justify-content:center">${CATEGORIES.map(
    ([e, n, c], i) => `<span id="c${i}" class="chip" style="background:${c};font-size:44px">${e} ${n}</span>`,
  ).join('')}</div>
  <div id="soon" class="pill display" style="background:${C.orange};color:${C.ink};font-size:96px;padding:.14em .9em .04em;margin-top:30px">COMING SOON</div>
  <div id="free" style="color:#fff;font-size:50px;font-weight:800">Free to play · Android and the web</div>
</div>
`,
  `
.scene { position:absolute; left:70px; right:70px; top:108px; bottom:108px; display:flex; flex-direction:column; align-items:center; text-align:center; opacity:0; }
.opt { display:flex; align-items:center; gap:24px; padding:20px 26px; border-radius:30px; border:4px solid #E5DFCF; background:#fff; font-size:48px; font-weight:800; text-align:left; }
.letter { flex:0 0 auto; width:72px; height:72px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:${C.sand}; font-size:42px; padding-top:4px; }
.player { display:flex; flex-direction:column; align-items:center; gap:14px; width:380px; }
.avatar { width:230px; height:230px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-family:Baloo; font-size:120px; border:12px solid ${C.cream}; padding-top:10px; }
.pname { color:#fff; font-size:54px; font-weight:800; }
.score { color:#fff; font-size:120px; }
`,
);

// Runs in the page: sets every element for time t (seconds).
function render(t) {
  const $ = (id) => document.getElementById(id);
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const seg = (a, b) => clamp((t - a) / (b - a));
  const out = (x) => 1 - (1 - x) ** 3;
  const back = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 + 2.4 * (x - 1) ** 3 + 1.4 * (x - 1) ** 2);
  const show = (id, a, b, dy = 40) => {
    const p = out(seg(a, b));
    $(id).style.opacity = p;
    $(id).style.transform = `translateY(${(1 - p) * dy}px)`;
  };
  const pop = (id, a, b) => {
    const p = seg(a, b);
    $(id).style.opacity = clamp(p * 3);
    $(id).style.transform = `scale(${0.3 + 0.7 * back(p)})`;
  };
  // A scene is shown from a to b, fading out over its last 0.35 s.
  const scene = (id, a, b) => {
    const visible = t >= a && t < b;
    $(id).style.opacity = visible ? Math.min(seg(a, a + 0.25), 1 - seg(b - 0.35, b)) : 0;
    $(id).style.transform = `translateY(${-60 * seg(b - 0.35, b)}px)`;
  };

  // The bands drop in, tile by tile.
  [...$('top').querySelectorAll('.tile')].forEach((el, i) => {
    const p = out(seg(0.03 * i, 0.03 * i + 0.4));
    el.style.transform = `translateY(${(p - 1) * 110}px)`;
  });
  [...$('bottom').querySelectorAll('.tile')].forEach((el, i) => {
    const p = out(seg(0.03 * i, 0.03 * i + 0.4));
    el.style.transform = `translateY(${(1 - p) * 110}px)`;
  });

  scene('s1', 0, 3.1);
  pop('logo', 0.3, 1.0);
  show('tag', 0.9, 1.3);
  show('line', 1.4, 1.9, 60);

  scene('s2', 3.1, 8.7);
  show('round', 3.1, 3.4);
  show('card', 3.2, 3.6, 120);
  for (let i = 0; i < 4; i++) show(`o${i}`, 3.5 + 0.12 * i, 3.8 + 0.12 * i, 30);
  const timeLeft = 1 - 0.55 * seg(4.1, 6.2);
  $('timer').style.width = `${timeLeft * 100}%`;
  $('secs').textContent = String(Math.ceil(timeLeft * 10));
  const tapped = t >= 6.2;
  for (let i = 0; i < 4; i++) {
    const o = $(`o${i}`);
    const right = tapped && i === 1;
    o.style.background = right ? '#006B40' : '#fff';
    o.style.borderColor = right ? '#006B40' : '#E5DFCF';
    o.style.color = right ? '#fff' : '#14231B';
    if (tapped && i !== 1) o.style.opacity = Math.min(Number(o.style.opacity), 1 - 0.55 * seg(6.2, 6.4));
    $(`l${i}`).textContent = right ? '✓' : 'ABCD'[i];
    $(`l${i}`).style.background = right ? '#fff' : '#F3EEE1';
    $(`l${i}`).style.color = right ? '#006B40' : '#14231B';
  }
  const press = seg(6.05, 6.2) - seg(6.2, 6.35);
  if (t >= 6.05) $('o1').style.transform = `scale(${1 - 0.04 * press})`;
  const rise = seg(6.35, 7.2);
  $('points').style.opacity = t >= 6.35 ? Math.min(seg(6.35, 6.5), 1 - seg(6.85, 7.05)) : 0;
  $('points').style.transform = `translateY(${-90 * out(rise)}px)`;
  pop('cheer', 7.05, 7.5);

  scene('s3', 8.7, 12.7);
  show('t3', 8.7, 9.1);
  const slide = out(seg(8.9, 9.4));
  $('pa').style.transform = `translateX(${(slide - 1) * 600}px)`;
  $('pb').style.transform = `translateX(${(1 - slide) * 600}px)`;
  pop('vs', 9.2, 9.6);
  const count = out(seg(9.5, 10.9));
  $('sa').textContent = Math.round(1840 * count).toLocaleString('en-NG');
  $('sb').textContent = Math.round(1520 * count).toLocaleString('en-NG');
  $('ra').style.borderColor = t >= 11.0 ? '#FFB547' : '#FFFDF7';
  $('ra').style.transform = `scale(${1 + 0.08 * (seg(11.0, 11.15) - seg(11.15, 11.4))})`;
  pop('cap', 11.1, 11.6);

  scene('s4', 12.7, 99);
  pop('logo4', 12.7, 13.2);
  show('ask', 13.1, 13.5);
  for (let i = 0; i < 6; i++) pop(`c${i}`, 13.5 + 0.1 * i, 13.9 + 0.1 * i);
  pop('soon', 14.3, 14.8);
  // A gentle pulse on "coming soon" while it holds.
  if (t > 14.8) $('soon').style.transform = `scale(${1 + 0.04 * Math.sin((t - 14.8) * 5)})`;
  show('free', 14.7, 15.1);
}

const dir = new URL('./frames/', import.meta.url).pathname;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: W, height: H } });
await p.setContent(html);
await p.evaluate(() => document.fonts.ready);
await p.evaluate(`window.render = ${render.toString()}`);
const frames = FPS * SECONDS;
for (let f = 0; f < frames; f++) {
  await p.evaluate((t) => window.render(t), f / FPS);
  await p.screenshot({ path: `${dir}f${String(f).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 92 });
}
await browser.close();
mkdirSync(new URL('./out/', import.meta.url).pathname, { recursive: true });
const out = new URL('./out/whosabi-status-video.mp4', import.meta.url).pathname;
execFileSync('ffmpeg', [
  '-y',
  '-loglevel',
  'error',
  '-framerate',
  String(FPS),
  '-i',
  `${dir}f%04d.jpg`,
  '-c:v',
  'libx264',
  '-preset',
  'slow',
  '-crf',
  '20',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  out,
]);
console.log('video', out);
