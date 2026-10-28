/**
 * Pictures for sharing (TRD FR-SOC-4): Satori lays out a tree of boxes and text as SVG with the
 * game's own fonts, and resvg turns it into a PNG. Link previews are 1200×630 (WhatsApp wants
 * them under 300 KB); share cards for WhatsApp Status are 1080×1920. Recent pictures are kept in
 * memory, so a link pasted into a busy group is drawn once.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';

export interface Node {
  type: string;
  props: Record<string, unknown> & { style?: Record<string, unknown>; children?: unknown };
}

/** `h('div', { display: 'flex' }, 'text', h(...))`: a box with a style and children. */
export function h(
  type: string,
  style: Record<string, unknown>,
  ...children: Array<Node | string | null>
): Node {
  const kids = children.filter((c): c is Node | string => c !== null);
  // Satori reads an empty list as "has children", which needs display: flex.
  const content = kids.length === 0 ? undefined : kids.length === 1 ? kids[0] : kids;
  return { type, props: { style, children: content } };
}

export function img(src: string, width: number, height: number, style: Record<string, unknown> = {}): Node {
  return { type: 'img', props: { src, width, height, style } };
}

type Font = { name: string; data: Buffer; weight: 700 | 800; style: 'normal' };
let fonts: Promise<Font[]> | null = null;

/** The game's fonts (SIL Open Font Licence, copies in assets/fonts), read once. */
function loadFonts(dir = path.resolve(process.cwd(), 'assets/fonts')): Promise<Font[]> {
  fonts ??= Promise.all([
    readFile(path.join(dir, 'Nunito_700Bold.ttf')).then((data) => ({
      name: 'Nunito',
      data,
      weight: 700 as const,
      style: 'normal' as const,
    })),
    readFile(path.join(dir, 'Nunito_800ExtraBold.ttf')).then((data) => ({
      name: 'Nunito',
      data,
      weight: 800 as const,
      style: 'normal' as const,
    })),
    readFile(path.join(dir, 'Baloo2_800ExtraBold.ttf')).then((data) => ({
      name: 'Baloo',
      data,
      weight: 800 as const,
      style: 'normal' as const,
    })),
  ]);
  return fonts;
}

const cache = new Map<string, Buffer>();
const CACHE_SIZE = 200;

/** Draws `node` at the given size, reusing a recent picture with the same key. */
export async function renderPng(key: string, node: Node, width: number, height: number): Promise<Buffer> {
  const hit = cache.get(key);
  if (hit) {
    // Most recently used goes last, so the oldest is first out.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const svg = await satori(node as unknown as Parameters<typeof satori>[0], {
    width,
    height,
    fonts: await loadFonts(),
  });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
  cache.set(key, png);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return png;
}
