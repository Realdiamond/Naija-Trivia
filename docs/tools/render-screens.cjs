// Renders every artboard of the Who Sabi? canvas to PNG, then builds a PDF with one page per row.
// Usage (from the repo root): node docs/tools/render-screens.cjs docs/design/mockups <output dir>
// Needs Playwright with Chromium. Writes <output dir>/png/*.png and <output dir>/Who-Sabi-screens.pdf.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const [projectDir, outDir] = process.argv.slice(2);
const canvas = JSON.parse(fs.readFileSync(path.join(projectDir, 'canvas.json'), 'utf8'));
const pngDir = path.join(outDir, 'png');
fs.mkdirSync(pngDir, { recursive: true });

// A minimal stand-in for the canvas runtime: holes, sc-for, sc-if and renderVals(), first render only.
const RUNTIME = `
class DCLogic { constructor(props) { this.props = props || {}; this.state = null; } setState() {} forceUpdate() {} }
const Component = new Function('DCLogic', window.__SRC + '\\nreturn Component;')(DCLogic);
const vals = new Component({}).renderVals();
const SVG = 'http://www.w3.org/2000/svg';
function lookup(expr, scope) {
  expr = expr.trim();
  if (expr === 'true') return true;
  if (expr === 'false') return false;
  if (/^-?\\d+(\\.\\d+)?$/.test(expr)) return Number(expr);
  let v = scope;
  for (const part of expr.split('.')) { if (v == null) return undefined; v = v[part]; }
  return v;
}
const interp = (s, scope) => s.replace(/\\{\\{\\s*([^}]+?)\\s*\\}\\}/g, (_, e) => { const v = lookup(e, scope); return v == null ? '' : String(v); });
function render(nodes, scope, parent) {
  for (const node of nodes) {
    if (node.nodeType === 3) { parent.appendChild(document.createTextNode(interp(node.data, scope))); continue; }
    if (node.nodeType !== 1) continue;
    if (node.localName === 'template' && node.dataset.sc) {
      if (node.dataset.sc === 'for') {
        const list = lookup(node.getAttribute('list').replace(/[{}]/g, ''), scope) || [];
        const as = node.getAttribute('as');
        list.forEach((item, i) => render(node.content.childNodes, Object.assign({}, scope, { [as]: item, $index: i }), parent));
      } else if (lookup(node.getAttribute('value').replace(/[{}]/g, ''), scope)) {
        render(node.content.childNodes, scope, parent);
      }
      continue;
    }
    const el = node.namespaceURI === SVG ? document.createElementNS(SVG, node.localName) : document.createElement(node.localName);
    for (const attr of node.attributes) {
      const name = attr.name;
      if (/^on/i.test(name) || name.startsWith('hint-')) continue;
      const m = attr.value.match(/^\\s*\\{\\{\\s*([^}]+?)\\s*\\}\\}\\s*$/);
      if (!m) { el.setAttribute(name, interp(attr.value, scope)); continue; }
      const v = lookup(m[1], scope);
      if (typeof v === 'function') continue;
      if (v === false || v == null) { if (name.startsWith('aria-')) el.setAttribute(name, 'false'); continue; }
      el.setAttribute(name, v === true ? (name.startsWith('aria-') ? 'true' : '') : String(v));
    }
    render(node.childNodes, scope, el);
    parent.appendChild(el);
  }
}
render(document.getElementById('root').content.childNodes, vals, document.body);
`;

function pageFor(file) {
  const src = fs.readFileSync(path.join(projectDir, file), 'utf8');
  const xdc = src.match(/<x-dc>([\s\S]*?)<\/x-dc>/)[1];
  const helmet = (xdc.match(/<helmet>([\s\S]*?)<\/helmet>/) || ['', ''])[1];
  const body = xdc
    .replace(/<helmet>[\s\S]*?<\/helmet>/, '')
    .replace(/<sc-for\b/g, '<template data-sc="for"')
    .replace(/<\/sc-for>/g, '</template>')
    .replace(/<sc-if\b/g, '<template data-sc="if"')
    .replace(/<\/sc-if>/g, '</template>');
  const script = src.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
  const title = src.match(/<title>([\s\S]*?)<\/title>/)[1];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${helmet}</head>` +
    `<body><template id="root">${body}</template>` +
    `<script>window.__SRC = ${JSON.stringify(script)};</script><script>${RUNTIME}</script></body></html>`;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

(async () => {
  const browser = await chromium.launch();
  const shots = [];
  let n = 0;
  for (const file of canvas.order) {
    const b = canvas.boards[file];
    n++;
    const name = String(n).padStart(2, '0') + '-' + slug(b.title || file.replace('.dc.html', ''));
    const page = await browser.newPage({ viewport: { width: b.w, height: b.h }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent(pageFor(file), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const out = path.join(pngDir, name + '.png');
    if (b.expand === 'fill') await page.screenshot({ path: out, fullPage: true });
    else await page.screenshot({ path: out, clip: { x: 0, y: 0, width: b.w, height: b.h } });
    const size = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
    shots.push({ file, name, title: b.title, x: b.x, y: b.y, w: b.w, h: b.expand === 'fill' ? Math.max(b.h, size.h) : b.h, png: out });
    console.log((errors.length ? 'ERR ' : 'ok  ') + name + (errors.length ? ' :: ' + errors.join(' | ') : ''));
    await page.close();
  }

  // One PDF page per canvas row, titled like the canvas.
  const rows = [];
  for (const s of shots) {
    let row = rows.find((r) => r.y === s.y);
    if (!row) rows.push((row = { y: s.y, items: [] }));
    row.items.push(s);
  }
  rows.sort((a, b) => a.y - b.y);
  const titles = Object.values(canvas.notes).filter((nt) => nt.kind === 'title1').sort((a, b) => a.y - b.y).map((nt) => nt.text);
  const PAGE_W = 3330, PAGE_H = 1100, IMG_H = 900;
  const pagesHtml = rows.map((row, i) => {
    const items = row.items.sort((a, b) => a.x - b.x);
    const scale = Math.min(1, IMG_H / Math.max(...items.map((s) => s.h)));
    const imgs = items.map((s) => {
      const data = fs.readFileSync(s.png).toString('base64');
      return `<figure style="margin:0;display:flex;flex-direction:column;gap:12px"><img src="data:image/png;base64,${data}" style="width:${Math.round(s.w * scale)}px;height:${Math.round(s.h * scale)}px;border-radius:${s.w < 500 ? 28 : 8}px;box-shadow:0 2px 12px rgba(0,0,0,.12)"><figcaption style="font:700 20px Nunito,system-ui,sans-serif;color:#3F4A44">${s.title}</figcaption></figure>`;
    }).join('');
    return `<section style="width:${PAGE_W}px;height:${PAGE_H}px;box-sizing:border-box;padding:48px 60px;page-break-after:always;background:#EFEBE1">` +
      `<h1 style="margin:0 0 28px;font:800 44px 'Baloo 2',sans-serif;color:#14231B">${titles[i] || ''}</h1>` +
      `<div style="display:flex;gap:40px;align-items:flex-start">${imgs}</div></section>`;
  }).join('');
  const pdfPage = await browser.newPage();
  await pdfPage.setContent(`<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@800&family=Nunito:wght@700&display=swap" rel="stylesheet"><style>@page{size:${PAGE_W}px ${PAGE_H}px;margin:0}body{margin:0}</style></head><body>${pagesHtml}</body></html>`, { waitUntil: 'networkidle' });
  await pdfPage.evaluate(() => document.fonts.ready);
  await pdfPage.pdf({ path: path.join(outDir, 'Who-Sabi-screens.pdf'), width: PAGE_W + 'px', height: PAGE_H + 'px', printBackground: true });
  await browser.close();
  console.log('done: ' + shots.length + ' screens, ' + rows.length + ' PDF pages');
})();
