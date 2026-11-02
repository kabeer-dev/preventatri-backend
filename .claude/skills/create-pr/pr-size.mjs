// Counts the lines a reviewer reads (added + deleted, generated files skipped) and prints the size.
// With --pr it also sets the size label on that PR.
//   node .claude/skills/create-pr/pr-size.mjs --base <branch>   size of local commits
//   node .claude/skills/create-pr/pr-size.mjs --pr <number>     size and label of an open PR
import {execFileSync} from 'node:child_process';

// [label, lines below, color]
const SIZES = [
  ['size/xs', 15, '3cbf00'],
  ['size/sm', 30, '5d9801'],
  ['size/md', 100, 'b8a400'],
  ['size/lg', 400, 'e09c00'],
  ['size/xl', 1001, 'e05d00'],
  ['size/xxl', Infinity, 'd01010'],
];

// Written by tools, not people: lock files, the Prisma client, migration SQL, snapshots, build output
const GENERATED =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|^generated\/|^prisma\/migrations\/|\.snap$|^\.next\//;

const sh = (command, args) => execFileSync(command, args, {encoding: 'utf8'});

const option = (name) => {
  const index = process.argv.indexOf(name);

  return index === -1 ? null : process.argv[index + 1];
};

const pr = option('--pr');
const base = option('--base');

if (!pr && !base) {
  console.error('Usage: pr-size.mjs --pr <number> | --base <branch>');
  process.exit(1);
}

const files = pr
  ? JSON.parse(sh('gh', ['pr', 'view', pr, '--json', 'files'])).files.map(
      (file) => ({
        path: file.path,
        lines: file.additions + file.deletions,
      })
    )
  : sh('git', ['diff', '--numstat', `${base}...HEAD`])
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((row) => {
        const [added, deleted, path] = row.split('\t');

        // Binary files show "-" instead of a count
        return {path, lines: (Number(added) || 0) + (Number(deleted) || 0)};
      });

const counted = files.filter((file) => !GENERATED.test(file.path));
const lines = counted.reduce((total, file) => total + file.lines, 0);
const [label, , color] = SIZES.find(([, below]) => lines < below);

if (pr) {
  sh('gh', ['label', 'create', label, '--color', color, '--force']);

  const oldSizes = JSON.parse(sh('gh', ['pr', 'view', pr, '--json', 'labels']))
    .labels.map((entry) => entry.name)
    .filter((name) => name.startsWith('size/') && name !== label);

  const remove =
    oldSizes.length > 0 ? ['--remove-label', oldSizes.join(',')] : [];

  sh('gh', ['pr', 'edit', pr, '--add-label', label, ...remove]);
}

console.log(
  `${label}: ${lines} lines in ${counted.length} files (${files.length - counted.length} generated files skipped)`
);
