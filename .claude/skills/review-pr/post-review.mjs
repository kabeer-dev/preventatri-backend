// Posts one review with its inline comments from a JSON file. It always posts a plain
// comment review: it never approves and never requests changes.
//   node .claude/skills/review-pr/post-review.mjs --pr <n> --file review.json
// review.json: {"commit_id": "<head sha>", "body": "...", "comments": [{path, line, side, body}]}
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const option = (name) => {
  const index = process.argv.indexOf(name);

  return index === -1 ? null : process.argv[index + 1];
};

const pr = option('--pr');
const file = option('--file');

if (!/^\d+$/.test(pr ?? '') || !file) {
  console.error('Usage: post-review.mjs --pr <n> --file review.json');
  process.exit(1);
}

const review = JSON.parse(readFileSync(file, 'utf8'));

if (!review.commit_id) {
  console.error('review.json needs commit_id (the head sha you reviewed)');
  process.exit(1);
}

const payload = path.join(
  mkdtempSync(path.join(os.tmpdir(), 'review-')),
  'payload.json'
);

writeFileSync(
  payload,
  JSON.stringify({
    commit_id: review.commit_id,
    event: 'COMMENT',
    body: review.body ?? '',
    comments: review.comments ?? [],
  })
);

const gh = (args) => execFileSync('gh', args, {encoding: 'utf8'});
const {owner, name} = JSON.parse(gh(['repo', 'view', '--json', 'owner,name']));

// A 422 error means a comment points at a line outside the diff; the message names it
const response = JSON.parse(
  gh([
    'api',
    `repos/${owner.login}/${name}/pulls/${pr}/reviews`,
    '--method',
    'POST',
    '--input',
    payload,
  ])
);

console.log(response.html_url);
