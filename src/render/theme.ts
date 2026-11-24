import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GlobalFonts } from '@napi-rs/canvas';

// Colours gathered from the legacy generators in balancing-tool/utilities/*-sheet-generator.
/** Sheet background (all four generators). */
export const BG_COLOR = '#100f16';
/** Primary text (all four). */
export const TEXT_COLOR = '#ffffff';
/** Missing-image placeholder fill (all four). */
export const PLACEHOLDER_COLOR = '#333333';
/** Section divider lines (perk/item sheets). */
export const DIVIDER_COLOR = '#2a2833';
/** Section subtitle / secondary text (perk/item/build sheets). */
export const SUBTEXT_COLOR = '#999999';
/** Rule sentences, names under icons (perk/item sheets). */
export const RULE_TEXT_COLOR = '#cccccc';
/** Other greys used by the legacy files; call sites decide their role. */
export const GREY_AAA = '#aaaaaa';
export const GREY_BBB = '#bbbbbb';
export const GREY_DDD = '#dddddd';
export const GREY_888 = '#888888';
/** Translucent row panel (build sheet). */
export const PANEL_COLOR = '#25233380';
/** Violation red: outlines, markers (build sheet). Same as the whole-team scope colour. */
export const VIOLATION_COLOR = '#e5484d';
/** Legacy debug-ish tints (build sheet / perk sheet). */
export const OK_TEXT_COLOR = '#80ff80';
export const BAD_TEXT_COLOR = '#ff8080';

/** Scope chip colours (perk/item sheets). */
export const SCOPE_COLORS = {
  survivor: '#f0b429',
  duo: '#e8823a',
  team: '#e5484d',
  build: '#8a8f98',
} as const;

export const FONT_FAMILY = 'Noto Sans';

/**
 * CSS font string. `font(28, 'bold')` => `bold 28px "Noto Sans"`, replacing legacy
 * `'bold 28px sans-serif'`. Legacy `12pt` sizes: use `font(16, ...)` (12pt = 16px).
 */
export function font(sizePx: number, weight: 'normal' | 'bold' | number = 'normal'): string {
  return `${weight} ${sizePx}px "${FONT_FAMILY}"`;
}

/** Package root (fonts/ lives there); same relative depth from src/render and dist/render. */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FONTS_DIR = path.join(PACKAGE_ROOT, 'fonts');

let fontsRegistered = false;

/** Register fonts/NotoSans-{Regular,Bold}.ttf under family "Noto Sans". Idempotent. */
export function registerFonts(): void {
  if (fontsRegistered) return;
  for (const f of ['NotoSans-Regular.ttf', 'NotoSans-Bold.ttf']) {
    if (!GlobalFonts.registerFromPath(path.join(FONTS_DIR, f), FONT_FAMILY)) {
      throw new Error(`Failed to register font ${f} from ${FONTS_DIR}`);
    }
  }
  fontsRegistered = true;
}
