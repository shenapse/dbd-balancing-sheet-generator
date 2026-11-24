import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GlobalFonts } from '@napi-rs/canvas';

// Sheet colours.
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
/** Other greys; call sites decide their role. */
export const GREY_AAA = '#aaaaaa';
export const GREY_BBB = '#bbbbbb';
export const GREY_DDD = '#dddddd';
export const GREY_888 = '#888888';
/** Translucent row panel (build sheet). */
export const PANEL_COLOR = '#25233380';
/** Violation red: outlines, markers (build sheet). Same as the whole-team scope colour. */
export const VIOLATION_COLOR = '#e5484d';
/** OK / bad status tints (build sheet / perk sheet). */
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
 * @napi-rs/canvas ignores the weight when two files share one family name (the last registered
 * file wins), so each weight is registered under its own family and {@link font} picks it.
 */
export const FONT_FAMILIES = { normal: 'Noto Sans Regular', bold: 'Noto Sans Bold' } as const;

/**
 * CSS font string. `font(28, 'bold')` => `bold 28px "Noto Sans"`. For point sizes use
 * {@link fontPt} (12pt = 16px).
 */
export function font(sizePx: number, weight: 'normal' | 'bold' | number = 'normal'): string {
  const bold = weight === 'bold' || (typeof weight === 'number' && weight >= 600);
  return `${sizePx}px "${bold ? FONT_FAMILIES.bold : FONT_FAMILIES.normal}"`;
}

/** `Npt` font size in px (96 dpi): 12pt = 16px. */
export const pt = (n: number): number => (n * 4) / 3;

/** CSS font string for a point size: `fontPt(12, 'bold')` => font(16, 'bold'). */
export const fontPt = (sizePt: number, weight: 'normal' | 'bold' | number = 'normal'): string => font(pt(sizePt), weight);

/** Outer margin shared by the perk / add-on / item sheets. */
export const SHEET_MARGIN = 32;

/** Package root (fonts/ lives there); same relative depth from src/render and dist/render. */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FONTS_DIR = path.join(PACKAGE_ROOT, 'fonts');

let fontsRegistered = false;

/** Register fonts/NotoSans-{Regular,Bold}.ttf under {@link FONT_FAMILIES}. Idempotent. */
export function registerFonts(): void {
  if (fontsRegistered) return;
  for (const [f, family] of [
    ['NotoSans-Regular.ttf', FONT_FAMILIES.normal],
    ['NotoSans-Bold.ttf', FONT_FAMILIES.bold],
  ] as const) {
    if (!GlobalFonts.registerFromPath(path.join(FONTS_DIR, f), family)) {
      throw new Error(`Failed to register font ${f} from ${FONTS_DIR}`);
    }
  }
  fontsRegistered = true;
}
