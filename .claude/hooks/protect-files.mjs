// PreToolUse hook: blocks agent edits to secrets and generated files,
// and asks the developer before an agent edits the project's own checks.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8'));
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd;
const target = path.resolve(root, input.tool_input?.file_path ?? '');
const file = path.relative(root, target).split(path.sep).join('/');

// A migration that is already committed has run on some database; new ones stay editable
const isCommitted = (name) =>
  spawnSync('git', ['ls-files', '--error-unmatch', name], {cwd: root})
    .status === 0;

const BLOCKED = [
  [
    /(^|\/)\.env(\.(?!example$).+)?$/.test(file),
    'holds secrets. Ask the developer to change it.',
  ],
  [file === 'package-lock.json', 'is written by npm. Run npm install instead.'],
  [
    file.startsWith('generated/'),
    'is the generated Prisma client. Change prisma/schema.prisma and run npx prisma generate.',
  ],
  [
    file.startsWith('prisma/migrations/') && isCommitted(file),
    'is a committed migration. Create a new one with npx prisma migrate dev.',
  ],
  [
    file === 'certificate.pem',
    'is a certificate. Ask the developer to change it.',
  ],
  [
    file.startsWith('.claude/qa/sessions/'),
    'holds saved logins. Ask the developer to log in again.',
  ],
];

const ASK_FIRST =
  /^(eslint\.config\.mjs|\.prettierrc\.js|package\.json|\.mcp\.json|\.claude\/settings\.json|eslint-rules\/|\.husky\/|\.claude\/hooks\/)/;

const blocked = BLOCKED.find(([matches]) => matches);

if (blocked) {
  console.error(`Blocked: ${file} ${blocked[1]}`);
  process.exit(2);
}

if (ASK_FIRST.test(file)) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: `${file} controls the project's checks. The developer approves every change to it.`,
      },
    })
  );
}
