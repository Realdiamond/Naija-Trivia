/* global document */
/**
 * The web app's icons (build plan step 2.5c): the welcome screen's logo, a tilted cream tile with
 * a "?" and an orange dot, on the game's green. Written to apps/app/public/icons/, where the page
 * manifest, the Home Screen and web push notifications use them.
 * Run: node tools/marketing/icons.mjs
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { C, page } from './common.mjs';

// The logo inside the middle 80% circle, so round and squircle masks never cut it (maskable icons).
const logo = (s) => `
  <div style="width:${s}px;height:${s}px;background:${C.green};display:flex;align-items:center;justify-content:center">
    <div style="position:relative;width:${s * 0.44}px;height:${s * 0.44}px">
      <div style="width:100%;height:100%;border-radius:${s * 0.12}px;background:${C.cream};transform:rotate(-4deg);
        display:flex;align-items:center;justify-content:center">
        <span class="display" style="font-size:${s * 0.32}px;color:${C.greenInk};padding-top:${s * 0.045}px">?</span>
      </div>
      <div style="position:absolute;right:${-s * 0.08}px;top:${-s * 0.06}px;width:${s * 0.11}px;height:${s * 0.11}px;
        border-radius:50%;background:${C.orange}"></div>
    </div>
  </div>`;

// Android shows the badge in the status bar as a white shape: only its transparency counts.
const badge = (s) => `
  <div style="width:${s}px;height:${s}px;display:flex;align-items:center;justify-content:center">
    <span class="display" style="font-size:${s * 0.9}px;color:#fff;padding-top:${s * 0.12}px">?</span>
  </div>`;

const out = new URL('../../apps/app/public/icons/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
async function shoot(body, size, file, transparent = false) {
  const p = await browser.newPage({ viewport: { width: size, height: size } });
  await p.setContent(page(size, size, body, transparent ? 'body{background:transparent}' : ''));
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: `${out}${file}`, omitBackground: transparent });
  await p.close();
  console.log(file);
}
await shoot(logo(512), 512, 'icon-512.png');
await shoot(logo(192), 192, 'icon-192.png');
await shoot(logo(180), 180, 'apple-touch-icon.png');
await shoot(logo(48), 48, 'favicon-48.png');
await shoot(badge(96), 96, 'badge-96.png', true);
await browser.close();
