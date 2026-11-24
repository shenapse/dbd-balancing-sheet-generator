/**
 * Dev-only parity harness: runs the legacy JS sheet generators and this
 * rewrite over the same inputs and reports differences (failures, file sets,
 * dimensions, pixel diff %). Never exits non-zero unless the harness crashes.
 *
 *   npx tsx scripts/compare-legacy.ts [--arena <dir>] [--out <dir>]
 *     [--only perks,addons,items,builds] [--new-cmd tsx|docker] [--image <tag>]
 *     [--all-composites] [--concurrency <n>]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { load } from 'js-yaml';

type Tool = 'perks' | 'addons' | 'items' | 'builds';
const ALL_TOOLS: Tool[] = ['perks', 'addons', 'items', 'builds'];
const LEGACY_ROOT = '/home/shenadillo/project/balancing-tool';
const LEGACY_SCRIPT: Record<Tool, string> = {
  perks: 'utilities/perk-sheet-generator/perk-sheet-generator.js',
  addons: 'utilities/addon-sheet-generator/addon-sheet-generator.js',
  items: 'utilities/item-sheet-generator/item-sheet-generator.js',
  builds: 'utilities/build-sheet-generator/build-sheet-generator.js',
};
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIFF_THRESHOLD = 32;
const COMPOSITE_MIN_DIFF = 0.02;

interface CaseDef { name: string; tool: Tool; input: string; rules?: string }
interface RunResult { code: number | null; stderr: string; files: string[]; warnings: string[] }
interface PairResult {
  file: string;
  oldSize?: [number, number];
  newSize?: [number, number];
  diffPct?: number;
  composite?: string;
  error?: string;
}
interface CaseResult {
  name: string; tool: Tool; input: string; rules?: string;
  old: RunResult; new: RunResult;
  category: 'ok' | 'new-failure' | 'old-failure' | 'both-failed' | 'unsupported-by-design';
  missing: string[]; extra: string[]; pairs: PairResult[];
}

const { values: opt } = parseArgs({
  options: {
    arena: { type: 'string', default: '/home/shenadillo/project/dbd-arena-web/src/data/balancing' },
    out: { type: 'string' },
    only: { type: 'string' },
    'new-cmd': { type: 'string', default: 'tsx' },
    image: { type: 'string', default: 'bsg:dev' },
    'all-composites': { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '4' },
  },
});
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.resolve(opt.out ?? `/tmp/claude-1000/-home-shenadillo-project-balancing-sheet-generator/7e6691c9-19e7-4dbb-ab36-8c012665d423/scratchpad/parity/${stamp}`);
const tools = (opt.only ? opt.only.split(',').map((s) => s.trim()) : ALL_TOOLS).filter((t): t is Tool =>
  (ALL_TOOLS as string[]).includes(t));
const docker = opt['new-cmd'] === 'docker';

// ---------- discovery ----------
function isBuildFile(file: string): boolean {
  try {
    const doc = load(fs.readFileSync(file, 'utf8'));
    return typeof doc === 'object' && doc !== null && ('builds' in doc || 'survivors' in doc);
  } catch { return false; }
}

function discover(arena: string): CaseDef[] {
  const cases: CaseDef[] = [];
  for (const format of fs.readdirSync(arena, { withFileTypes: true })) {
    if (!format.isDirectory() || format.name === 'universes' || format.name === 'template') continue;
    for (const killer of fs.readdirSync(path.join(arena, format.name), { withFileTypes: true })) {
      if (!killer.isDirectory() || killer.name === 'template') continue;
      const dir = path.join(arena, format.name, killer.name);
      const base = `${format.name}__${killer.name}`;
      const allow = [`${killer.name}-build.yaml`, '1v1-build.yaml'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
      for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.yaml')).sort()) {
        const full = path.join(dir, f);
        if (full === allow) {
          for (const tool of ['perks', 'addons', 'items'] as const) cases.push({ name: `${base}__${tool}`, tool, input: full });
        } else if (isBuildFile(full)) {
          cases.push({ name: `${base}__builds__${f.replace(/\.yaml$/, '')}`, tool: 'builds', input: full, ...(allow ? { rules: allow } : {}) });
        }
      }
    }
  }
  const fx = path.join(REPO, 'test/fixtures');
  const rules = path.join(fx, 'rules/the-trapper.yaml');
  for (const tool of ALL_TOOLS) {
    const d = path.join(fx, tool);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((n) => n.endsWith('.yaml')).sort()) {
      cases.push({ name: `fixture__${tool}__${f.replace(/\.yaml$/, '')}`, tool, input: path.join(d, f), ...(tool === 'builds' ? { rules } : {}) });
    }
  }
  return cases.filter((c) => tools.includes(c.tool));
}

// ---------- running ----------
function exec(cmd: string, args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, env: process.env });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d: Buffer) => { stdout += d; });
    p.stderr.on('data', (d: Buffer) => { stderr += d; });
    p.on('error', (e) => resolve({ code: -1, stdout, stderr: stderr + String(e) }));
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function listPngs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.png'))
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name))).sort();
}

async function runOld(c: CaseDef, outDir: string): Promise<RunResult> {
  const args = [LEGACY_SCRIPT[c.tool], c.input, '--out', outDir, ...(c.rules ? ['--rules', c.rules] : [])];
  const r = await exec('node', args, LEGACY_ROOT);
  const warnings = r.stderr.split('\n').filter((l) => /warn|unknown|not found|unresolved/i.test(l));
  return { code: r.code, stderr: r.stderr.trim(), files: listPngs(outDir), warnings };
}

async function runNew(c: CaseDef, outDir: string): Promise<RunResult> {
  const args = [c.tool, c.input, '--out', outDir, '--json', ...(c.rules ? ['--rules', c.rules] : [])];
  let r;
  if (docker) {
    const m = (a: string): string => (a.startsWith('/') ? `/host${a}` : a);
    const uid = `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;
    r = await exec('docker', ['run', '--rm', '--user', uid, '-v', '/:/host', '-w', `/host${process.cwd()}`, opt.image ?? 'bsg:dev', ...args.map(m)], process.cwd());
  } else {
    r = await exec('npx', ['tsx', path.join(REPO, 'src/cli.ts'), ...args], REPO);
  }
  let warnings: string[] = [];
  try {
    const j = JSON.parse(r.stdout) as { warnings: string[]; files: { warnings: string[] }[] };
    warnings = [...j.warnings, ...j.files.flatMap((f) => f.warnings)];
  } catch { /* failed run: no summary */ }
  return { code: r.code, stderr: r.stderr.trim(), files: listPngs(outDir), warnings };
}

// ---------- image comparison ----------
async function comparePair(name: string, caseName: string, oldP: string, newP: string): Promise<PairResult> {
  const res: PairResult = { file: name };
  try {
    const [a, b] = await Promise.all([loadImage(oldP), loadImage(newP)]);
    res.oldSize = [a.width, a.height];
    res.newSize = [b.width, b.height];
    const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
    const px = (img: typeof a): Uint8ClampedArray => {
      const cv = createCanvas(w, h); const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, w, h).data;
    };
    const da = px(a), db = px(b);
    let diff = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i]! - db[i]!), Math.abs(da[i + 1]! - db[i + 1]!), Math.abs(da[i + 2]! - db[i + 2]!), Math.abs(da[i + 3]! - db[i + 3]!));
      if (d > DIFF_THRESHOLD) diff++;
    }
    res.diffPct = w * h === 0 ? 100 : (diff / (w * h)) * 100;
    if (opt['all-composites'] || res.diffPct / 100 > COMPOSITE_MIN_DIFF || a.height !== b.height) {
      const top = 28, gap = 8, H = Math.max(a.height, b.height);
      const cv = createCanvas(a.width + b.width + gap, H + top); const ctx = cv.getContext('2d');
      ctx.fillStyle = '#222'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#fff'; ctx.font = '18px sans-serif';
      ctx.fillText(`OLD ${a.width}x${a.height}`, 6, 20);
      ctx.fillText(`NEW ${b.width}x${b.height}`, a.width + gap + 6, 20);
      ctx.drawImage(a, 0, top); ctx.drawImage(b, a.width + gap, top);
      const rel = `sidebyside/${caseName}__${name.replace(/[\\/]/g, '_')}`;
      fs.mkdirSync(path.join(OUT, 'sidebyside'), { recursive: true });
      fs.writeFileSync(path.join(OUT, rel), cv.toBuffer('image/png'));
      res.composite = rel;
    }
  } catch (e) { res.error = String(e); }
  return res;
}

async function runCase(c: CaseDef): Promise<CaseResult> {
  const oldDir = path.join(OUT, 'old', c.name), newDir = path.join(OUT, 'new', c.name);
  fs.mkdirSync(oldDir, { recursive: true }); fs.mkdirSync(newDir, { recursive: true });
  const [o, n] = await Promise.all([runOld(c, oldDir), runNew(c, newDir)]);
  const oldOk = o.code === 0, newOk = n.code === 0;
  let category: CaseResult['category'] = 'ok';
  if (!oldOk && !newOk) category = 'both-failed';
  else if (!newOk) category = /exhaustion selectors are no longer supported/i.test(n.stderr) ? 'unsupported-by-design' : 'new-failure';
  else if (!oldOk) category = 'old-failure';
  const missing = o.files.filter((f) => !n.files.includes(f));
  const extra = n.files.filter((f) => !o.files.includes(f));
  const pairs: PairResult[] = [];
  for (const f of o.files.filter((x) => n.files.includes(x))) {
    pairs.push(await comparePair(f, c.name, path.join(oldDir, f), path.join(newDir, f)));
  }
  return { ...c, old: o, new: n, category, missing, extra, pairs };
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
      process.stderr.write(`\r${++done}/${items.length} `);
    }
  }));
  process.stderr.write('\n');
  return out;
}

// ---------- report ----------
const tail = (s: string): string => s.split('\n').filter(Boolean).slice(0, 2).join(' | ').slice(0, 300);
const dimStr = (s?: [number, number]): string => (s ? `${s[0]}x${s[1]}` : '-');

function writeReport(results: CaseResult[]): void {
  const L: string[] = [];
  const cnt = (cat: CaseResult['category']): number => results.filter((r) => r.category === cat).length;
  L.push('# Legacy parity report', '', `Generated ${new Date().toISOString()} | new-cmd: ${opt['new-cmd']} | tools: ${tools.join(',')} | arena: ${opt.arena}`, '');
  L.push('## Summary', '', '| Tool | Cases | ok | new-failure | unsupported-by-design | old-failure | both-failed |', '|---|---|---|---|---|---|---|');
  for (const t of tools) {
    const rs = results.filter((r) => r.tool === t);
    const k = (cat: string): number => rs.filter((r) => r.category === cat).length;
    L.push(`| ${t} | ${rs.length} | ${k('ok')} | ${k('new-failure')} | ${k('unsupported-by-design')} | ${k('old-failure')} | ${k('both-failed')} |`);
  }
  L.push(`| **all** | ${results.length} | ${cnt('ok')} | ${cnt('new-failure')} | ${cnt('unsupported-by-design')} | ${cnt('old-failure')} | ${cnt('both-failed')} |`, '');

  const sec = (title: string, rows: string[]): void => { L.push(`## ${title}`, '', ...(rows.length ? rows : ['_none_']), ''); };
  const err = (r: CaseResult, side: 'old' | 'new'): string => `exit ${r[side].code}: ${tail(r[side].stderr)}`;
  sec('New-side failures (regressions: new fails, old succeeded)', results.filter((r) => r.category === 'new-failure').map((r) => `- **${r.name}** (${r.input}): ${err(r, 'new')}`));
  sec('Unsupported by design', results.filter((r) => r.category === 'unsupported-by-design').map((r) => `- ${r.name}: ${tail(r.new.stderr)}`));
  sec('Old-side failures (new succeeded)', results.filter((r) => r.category === 'old-failure').map((r) => `- ${r.name}: ${err(r, 'old')}`));
  sec('Both failed', results.filter((r) => r.category === 'both-failed').map((r) => `- ${r.name}: old ${err(r, 'old')} // new ${err(r, 'new')}`));
  sec('New warnings where old was clean', results.filter((r) => r.new.code === 0 && r.new.warnings.length && !r.old.warnings.length)
    .map((r) => `- ${r.name}: ${r.new.warnings.slice(0, 3).join(' ; ').slice(0, 300)}`));
  sec('Missing / extra output files', results.filter((r) => r.old.code === 0 && r.new.code === 0 && (r.missing.length || r.extra.length))
    .map((r) => `- ${r.name}: missing in new [${r.missing.join(', ')}], extra in new [${r.extra.join(', ')}]`));

  const all = results.flatMap((r) => r.pairs.map((p) => ({ r, p })));
  const dims = all.filter(({ p }) => p.oldSize && p.newSize && (p.oldSize[0] !== p.newSize[0] || p.oldSize[1] !== p.newSize[1]))
    .sort((x, y) => Math.abs(y.p.oldSize![1] - y.p.newSize![1]) - Math.abs(x.p.oldSize![1] - x.p.newSize![1])
      || Math.abs(y.p.oldSize![0] - y.p.newSize![0]) - Math.abs(x.p.oldSize![0] - x.p.newSize![0]));
  sec(`Dimension mismatches (${dims.length}; sorted by height difference, heights should match)`,
    dims.length ? ['| Case | File | Old | New | dH | dW |', '|---|---|---|---|---|---|', ...dims.slice(0, 100).map(({ r, p }) =>
      `| ${r.name} | ${p.file} | ${dimStr(p.oldSize)} | ${dimStr(p.newSize)} | ${p.newSize![1] - p.oldSize![1]} | ${p.newSize![0] - p.oldSize![0]} |`)] : []);
  const top = all.filter(({ p }) => p.diffPct !== undefined).sort((x, y) => y.p.diffPct! - x.p.diffPct!).slice(0, 30);
  sec('Top pixel diff % (channel delta > 32 over overlapping area)',
    top.length ? ['| Case | File | Diff % | Old | New | Composite |', '|---|---|---|---|---|---|', ...top.map(({ r, p }) =>
      `| ${r.name} | ${p.file} | ${p.diffPct!.toFixed(2)} | ${dimStr(p.oldSize)} | ${dimStr(p.newSize)} | ${p.composite ?? ''} |`)] : []);
  sec('Image compare errors', all.filter(({ p }) => p.error).map(({ r, p }) => `- ${r.name}/${p.file}: ${p.error}`));
  fs.writeFileSync(path.join(OUT, 'report.md'), L.join('\n'));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ out: OUT, tools, results }, null, 2));
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const cases = discover(opt.arena ?? '');
  console.error(`${cases.length} cases -> ${OUT} (cpus: ${os.cpus().length})`);
  const results = await pool(cases, Math.max(1, Number(opt.concurrency)), runCase);
  writeReport(results);
  console.log(path.join(OUT, 'report.md'));
}

main().catch((e) => { console.error(e); process.exit(2); });
