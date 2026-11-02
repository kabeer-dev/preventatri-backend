// PostToolUse hook: lint-fixes and formats the file the agent just edited.
// Exit code 2 shows the lint errors that --fix couldn't solve, so the agent fixes them now.
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';

const LINTED = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
const FORMATTED = [...LINTED, '.json', '.md', '.css', '.scss'];

const input = JSON.parse(readFileSync(0, 'utf8'));
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd;
const file = path.resolve(root, input.tool_input?.file_path ?? '');
const name = path.relative(root, file);
const ext = path.extname(file);

if (name.startsWith('..') || !existsSync(file) || !FORMATTED.includes(ext)) {
  process.exit(0);
}

const run = (tool, args) =>
  spawnSync(
    process.execPath,
    [path.join(root, 'node_modules', tool), ...args, file],
    {
      cwd: root,
      encoding: 'utf8',
    }
  );

const lint = LINTED.includes(ext)
  ? run('eslint/bin/eslint.js', [
      '--fix',
      '--max-warnings=0',
      '--no-warn-ignored',
    ])
  : null;

run('prettier/bin/prettier.cjs', [
  '--write',
  '--ignore-unknown',
  '--log-level',
  'warn',
]);

if (lint && lint.status !== 0) {
  console.error(
    `Lint errors left in ${name} after auto-fix. Fix them now:\n${lint.stdout}${lint.stderr}`
  );
  process.exit(2);
}
