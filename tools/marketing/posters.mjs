/* global document */
/**
 * Awareness posters for WhatsApp Status and other places: the "coming soon" Status poster, a
 * square post, and "Who sabi this one?" question posters with next-day answers. Written to
 * tools/marketing/out/. Run: node tools/marketing/posters.mjs
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { band, C, CATEGORIES, page } from './common.mjs';

const chips = (size) =>
  `<div style="display:flex;flex-wrap:wrap;gap:${size * 0.5}px;justify-content:center">${CATEGORIES.map(
    ([e, n, c]) => `<span class="chip" style="background:${c};font-size:${size}px">${e} ${n}</span>`,
  ).join('')}</div>`;

const soon = (size) => `
  <div style="display:flex;flex-direction:column;align-items:center;gap:${size * 0.35}px">
    <span class="pill display" style="background:${C.orange};color:${C.ink};font-size:${size * 1.5}px;padding:.15em .9em .05em">COMING SOON</span>
    <span style="color:#fff;font-size:${size}px;font-weight:800">Free to play · Android and the web</span>
  </div>`;

// A question on a cream card. `answer` shows the right option in green (the next-day post).
function questionCard(q, { answer = false, size = 1 } = {}) {
  const letters = ['A', 'B', 'C', 'D'];
  const rows = q.options
    .map((o, i) => {
      const right = answer && i === q.correct;
      const dim = answer && !right;
      return `<div style="display:flex;align-items:center;gap:${22 * size}px;padding:${18 * size}px ${22 * size}px;border-radius:${26 * size}px;
        border:${4 * size}px solid ${right ? C.greenInk : '#E5DFCF'};background:${right ? C.greenInk : '#fff'};opacity:${dim ? 0.45 : 1}">
        <span class="display" style="flex:0 0 auto;width:${64 * size}px;height:${64 * size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;
          background:${right ? '#fff' : C.sand};color:${right ? C.greenInk : C.ink};font-size:${38 * size}px;padding-top:${4 * size}px">${right ? '✓' : letters[i]}</span>
        <span style="font-size:${40 * size}px;font-weight:800;color:${right ? '#fff' : C.ink}">${o}</span>
      </div>`;
    })
    .join('');
  return `<div style="background:${C.cream};border-radius:${48 * size}px;padding:${44 * size}px;display:flex;flex-direction:column;gap:${20 * size}px">
    <div class="display" style="font-size:${66 * size}px;color:${C.ink};margin-bottom:${10 * size}px">${q.text}</div>${rows}
    ${answer && q.fact ? `<div style="font-size:${32 * size}px;color:${C.inkSoft};margin-top:${8 * size}px">${q.fact}</div>` : ''}
  </div>`;
}

const QUESTIONS = [
  {
    slug: 'japa',
    cat: CATEGORIES[0],
    text: 'What does “japa” mean?',
    options: ['To dance', 'To relocate abroad', 'To borrow money', 'To eat quickly'],
    correct: 1,
    fact: '“Japa” is Yoruba for “run away”, and became the word for leaving Naija for abroad.',
  },
  {
    slug: 'swallow',
    cat: CATEGORIES[3],
    text: 'Which of these is NOT a swallow?',
    options: ['Eba', 'Amala', 'Semo', 'Moi moi'],
    correct: 3,
    fact: 'Moi moi is steamed bean pudding. You chop am with rice or pap, not soup.',
  },
  {
    slug: 'davido',
    cat: CATEGORIES[2],
    text: 'What is Davido’s real name?',
    options: ['Damini Ogulu', 'David Adeleke', 'Ayodeji Balogun', 'David Adedeji'],
    correct: 1,
    fact: 'Damini Ogulu na Burna Boy, and Ayodeji Balogun na Wizkid.',
  },
  {
    slug: 'jenifa',
    cat: CATEGORIES[1],
    text: 'Which actress created and plays Jenifa?',
    options: ['Toyin Abraham', 'Mercy Johnson', 'Funke Akindele', 'Omotola Jalade-Ekeinde'],
    correct: 2,
    fact: 'Everybody Loves Jenifa (2024) became one of the highest-grossing Nollywood films.',
  },
];

const W = 1080;
const STATUS = 1920;

const teaser = page(
  W,
  STATUS,
  `
  <div style="display:flex;flex-direction:column;height:100%">
    ${band(W, 108)}
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:70px 64px 60px;text-align:center">
      <div style="display:flex;flex-direction:column;align-items:center;gap:6px">
        <div class="display" style="font-size:200px;color:#fff">Who Sabi?</div>
        <div style="font-size:50px;color:${C.gold};font-weight:800;letter-spacing:2px">NAIJA TRIVIA DUELS 🇳🇬</div>
      </div>
      <div class="display" style="font-size:96px;color:#fff">Think say you<br>sabi pass your guy?</div>
      ${questionCard(QUESTIONS[0], { size: 0.82 })}
      <div style="font-size:44px;color:${C.greenTint};line-height:1.3">Challenge your people to Naija trivia.<br>Winner takes the bragging rights 😎</div>
      ${chips(34)}
      ${soon(40)}
    </div>
    ${band(W, 108)}
  </div>`,
);

const square = page(
  W,
  W,
  `
  <div style="display:flex;flex-direction:column;height:100%">
    ${band(W, 72)}
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:44px 56px 40px;text-align:center">
      <div class="display" style="font-size:168px;color:#fff">Who Sabi?</div>
      <div class="display" style="font-size:74px;color:#fff">Who sabi pass? 🇳🇬</div>
      <div style="font-size:40px;color:${C.greenTint};line-height:1.3">Naija trivia duels with your people:<br>slang, Nollywood, music, food and more.</div>
      ${chips(30)}
      ${soon(34)}
    </div>
    ${band(W, 72)}
  </div>`,
);

function questionPoster(q, answer) {
  return page(
    W,
    STATUS,
    `
  <div style="display:flex;flex-direction:column;height:100%">
    ${band(W, 108)}
    <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:60px 60px 56px">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div class="display" style="font-size:92px;color:#fff">Who Sabi?</div>
        <span class="chip" style="background:${q.cat[2]};font-size:36px">${q.cat[0]} ${q.cat[1]}</span>
      </div>
      <div class="display" style="font-size:${answer ? 104 : 90}px;color:#fff;text-align:center;white-space:nowrap">${answer ? 'Did you sabi? ✅' : 'Who sabi this one? 🤔'}</div>
      ${questionCard(q, { answer })}
      <div style="text-align:center;font-size:52px;color:#fff;font-weight:800">${
        answer
          ? `Answer: ${['A', 'B', 'C', 'D'][q.correct]}. ${q.options[q.correct]} 🎉`
          : 'Reply with A, B, C or D 👇'
      }</div>
      <div style="text-align:center">${soon(36)}</div>
    </div>
    ${band(W, 108)}
  </div>`,
  );
}

const out = new URL('./out/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
async function shoot(html, w, h, file) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: `${out}${file}` });
  await p.close();
  console.log(file);
}
await shoot(teaser, W, STATUS, 'whosabi-status-coming-soon.png');
await shoot(square, W, W, 'whosabi-square-coming-soon.png');
for (const [i, q] of QUESTIONS.entries()) {
  await shoot(questionPoster(q, false), W, STATUS, `whosabi-question-${i + 1}-${q.slug}.png`);
  await shoot(questionPoster(q, true), W, STATUS, `whosabi-question-${i + 1}-${q.slug}-answer.png`);
}
await browser.close();
