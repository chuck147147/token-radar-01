/** Node 22 entry point: sealed input to deterministic board, dashboard data and dossier. */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

function argument(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${name}`);
  if (index !== -1) {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${name} requires a path`);
    return value;
  }
  return args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
}
/** Copy ordinary files recursively in stable order, omitting hidden entries. */
function copyDirectory(source: string, destination: string): string[] {
  mkdirSync(destination, { recursive: true });
  if (!existsSync(source)) return [];
  const copied: string[] = [];
  for (const name of readdirSync(source).sort()) {
    if (name.startsWith('.')) continue;
    const from = join(source, name);
    const to = join(destination, name);
    const info = lstatSync(from);
    if (info.isDirectory()) copied.push(...copyDirectory(from, to).map(p => `${name}/${p}`));
    else if (info.isFile()) { copyFileSync(from, to); copied.push(name); }
    else throw new Error(`Cannot copy non-regular entry ${from}`);
  }
  return copied;
}
function run(): void {
  const input = argument('input', '/input');
  const inputFile = input.endsWith('.json') ? input : join(input, 'snapshot.json');
  const output = argument('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) throw new Error(`Board self-check failed: ${issue}`);
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(output, 'data.js'), dataScript(radar));
  const root = fileURLToPath(new URL('.', import.meta.url));
  copyDirectory(join(root, 'dashboard'), join(output, 'dashboard'));
  const shots = copyDirectory(join(root, 'screenshots'), join(output, 'screenshots'));
  if (shots.length < 3) throw new Error(`At least 3 screenshots required; found ${shots.length}`);
  if (shots.some(name => !/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(name))) throw new Error('Invalid screenshot filename');
  // This must be the final output write: the vendored builder checks the dossier caps.
  writeFileSync(join(output, 'dossier.json'), buildDossier(output, {
    text_max_bytes: 65536, screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  }));
  process.stdout.write(`token radar: ${board.length} rows; ${JSON.stringify(radar.methodology)}\n`);
}
try { run(); } catch (error) {
  process.stderr.write(`token radar: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
