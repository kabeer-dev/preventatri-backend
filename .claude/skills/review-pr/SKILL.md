---
name: review-pr
description: Review a pull request with one reviewer agent and post its findings as inline comments with evidence, a real-life example and fix steps. Use right after opening a PR, for every PR in a stack, and when asked to review a PR or branch.
argument-hint: <pr-number>
---

# Review a PR

## 1. Gate

```sh
gh pr view <n> --json number,title,baseRefName,headRefOid,isDraft,state,author
gh pr diff <n>
gh api user --jq .login
```

- Stop if the PR is closed or merged. For a draft, ask first.
- Your own PR gets its comments posted without asking. Someone else's PR gets its findings shown to the developer first.
- From the diff, list the lines you may comment on: for each file, the new-side line numbers inside its hunks.

## 2. Review

Dispatch one `reviewer` agent with the PR number, the diff and [rules.md](rules.md). In a stack, it reviews only that layer's diff.

## 3. Post

Each inline comment is two lines, plus a code suggestion only for a small change:

````markdown
**High:** <what goes wrong, with `path:line`>
Fix: <one sentence>

```suggestion
<replacement for the commented lines>
```
````

Findings on lines outside the diff go in the review body in the same two-line form. Design questions go there too, one line each. The body opens with one line: the number of findings. Write the review to a JSON file, never in the shell:

```json
{
  "commit_id": "<headRefOid>",
  "body": "<n> findings. <design questions and findings outside the diff>",
  "comments": [
    {"path": "src/a.ts", "line": 42, "side": "RIGHT", "body": "<comment>"}
  ]
}
```

```sh
node .claude/skills/review-pr/post-review.mjs --pr <n> --file review.json
```

- The script always posts a plain comment review, never an approval.
- On a 422 error, move the comment whose line is outside the diff into the body and post again.
- Someone else's PR: show the findings in chat and ask with AskUserQuestion before posting.
- No findings: post nothing and say so in chat.
- Never mention Claude or any AI tool.

## 4. After

On your own PR: fix the comments you agree with (scoped fixes can go to the `implementer`), push, and reply in each thread with what changed or why you didn't change it.
