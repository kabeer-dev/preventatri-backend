// Stop hook: before the agent finishes, lint the files it edited in this session
// (the frontend copy also type-checks). Exit code 2 sends the errors back so it fixes them first.
// After 2 blocked tries it lets the agent stop with a warning, and stays quiet about
// the same errors until one of those files changes.
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TYPE_CHECK = false; // the backend has no type check
const MAX_BLOCKS = 2;
const LINTED = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];

const input = JSON.parse(readFileSync(0, 'utf8'));
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd;

const run = (tool, args) =>
  spawnSync(
    process.execPath,
    [path.join(root, 'node_modules', tool), ...args],
    {
      cwd: root,
      encoding: 'utf8',
    }
  );

// Files the agent wrote or edited, read from the session log
const edited = new Set();
const log = existsSync(input.transcript_path ?? '')
  ? readFileSync(input.transcript_path, 'utf8')
  : '';

for (const line of log.split('\n')) {
  if (!line.includes('"tool_use"')) continue;

  let entry;

  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }

  const blocks = Array.isArray(entry.message?.content)
    ? entry.message.content
    : [];

  for (const block of blocks) {
    const isEdit =
      block.type === 'tool_use' &&
      ['Edit', 'Write', 'MultiEdit'].includes(block.name);

    if (isEdit && block.input?.file_path)
      edited.add(path.resolve(root, block.input.file_path));
  }
}

const files = [...edited]
  .filter((file) => !path.relative(root, file).startsWith('..'))
  .filter((file) => existsSync(file) && LINTED.includes(path.extname(file)))
  .sort();

if (files.length === 0) process.exit(0);

// Results are remembered per session, keyed by the files and when they last changed
const stateFile = path.join(
  os.tmpdir(),
  `claude-check-${input.session_id}.json`
);
const stamp = JSON.stringify(
  files.map((file) => [file, statSync(file).mtimeMs])
);
let state = {passed: null, gaveUp: null, blocks: 0};

try {
  state = {...state, ...JSON.parse(readFileSync(stateFile, 'utf8'))};
} catch {}

if (stamp === state.passed || stamp === state.gaveUp) process.exit(0);

const save = (changes) =>
  writeFileSync(stateFile, JSON.stringify({...state, ...changes}));
const problems = [];

const lint = run('eslint/bin/eslint.js', [
  '--max-warnings=0',
  '--no-warn-ignored',
  ...files,
]);

if (lint.status !== 0) problems.push(`Lint:\n${lint.stdout}${lint.stderr}`);

if (TYPE_CHECK && files.some((file) => /\.tsx?$/.test(file))) {
  const tsc = run('typescript/bin/tsc', ['--noEmit', '--pretty', 'false']);

  // Old build output in .next/ is not the agent's doing
  const errors = tsc.stdout
    .split(/\n(?=\S)/)
    .filter((error) => error.trim() && !error.startsWith('.next/'))
    .join('\n');

  if (errors) problems.push(`Type check:\n${errors}`);
}

if (problems.length === 0) {
  save({passed: stamp, gaveUp: null, blocks: 0});
  process.exit(0);
}

if (state.blocks >= MAX_BLOCKS) {
  save({gaveUp: stamp, blocks: 0});
  console.log(
    JSON.stringify({
      systemMessage: `Errors are still open after ${MAX_BLOCKS} fix attempts. The commit check will reject them until they are fixed.`,
    })
  );
  process.exit(0);
}

save({blocks: state.blocks + 1});
console.error(`Fix these errors before you finish. The commit check will reject them.
An error that was already in a file before your change is fixed first, as its own commit.
If that fix is more than a few lines, ask the developer whether it gets its own mechanical PR.
Never weaken lint, hooks or settings to get through.

${problems.join('\n\n').slice(0, 6000)}`);
process.exit(2);
