---
name: create-pr
description: Open a pull request a human can review in minutes. One purpose, small, a short description with a picture of the change, before-and-after evidence, merge danger, and a size label. Use whenever you open a PR or write a PR body, including every PR in a stack.
---

# Create a PR

A reviewer should get the point in one minute and finish in fifteen. Every step below serves that.

## 1. Keep it one small thing

- One purpose per PR. If the title needs "and", split it.
- Measure it: `node .claude/skills/create-pr/pr-size.mjs --base <base-branch>`.
- A PR with logic stays at `size/md` or below (under 100 lines).
- A mechanical PR (rename, move, formatting, generated code) may be bigger, but holds no logic. Add the `mechanical` label.
- Too big? Stop and use the `ship-feature` skill to split it.

## 2. Check QA ran

QA comes before any PR (workflow steps 4 and 5). If users can see the change, or an endpoint behaves differently, and QA didn't run or isn't green, stop and run the `qa` skill first. Copy, config and refactors skip QA.

## 3. Collect evidence, before and after

Evidence shows the change works. Media is only for changes you can see.

- **UI** (best): a screenshot of each changed screen before and after, at the size that matters. Use a short video when the change is a flow or a state change (loading, error, success). Capture with Playwright MCP (`browser_take_screenshot`, `browser_start_video`, `browser_stop_video`) into `.claude/qa/output/`.
- **Backend**: the request and the response before and after (the `curl` command, the status and a trimmed body), or the database row before and after.
- **Logic or refactor**: the test that failed before and passes now, written as short pseudocode, with its output. For a refactor, the output that shows nothing changed.

Never stage or fake evidence. If you couldn't check something, say so under Notes.

Media needs gh 2.99 or newer (`gh --version`). Attach with `--attach <file>` and reference the file in the body as `![what it shows](./path.png)`. gh uploads it and rewrites the link. An image you don't reference goes at the end; give it alt text with `--attach 'path.png#what it shows'`. A video must sit alone in its own paragraph. On an older gh, ask the developer to run `brew upgrade gh`, or to drag the files into the PR by hand.

## 4. Title and description

Title: `PREVENT-<n> <what changes, sentence case>`.

Write the body to a file:

```markdown
#### [PREVENT-<n> <ticket title>](https://desolint.atlassian.net/browse/PREVENT-<n>)

## Summary

<One or two sentences: what changes for the user or the system, and why.>

<The smallest picture of the change: pseudocode, a call tree, a component tree, a file tree, a Mermaid diagram or a diff sketch. How to pick one: pr-body.md.>

## Evidence

- **Before:** <screenshot, response or failing test>
  **After:** <screenshot, response or passing test>

## Merge danger

**Door:** <one-way or two-way>. <one line on why, when it isn't obvious>

**Blast radius:** <one word>. <what else could break: other screens, API consumers, phone layout, stored data>

## How to test

1. <step>
2. <step>

## Notes

<Only when needed: limitations, follow-ups, what to review first. In a stack: "Layer 3 of 8, builds on #123.">
```

- Skip preambles and keep prose short. Use the product's words (caregiver, checklist, red flag), not code names.
- **Door**: two-way when a revert undoes everything. One-way when it can't be undone by a revert: a migration that drops or rewrites data, a removed field or endpoint other clients use, a backfill, sent emails or notifications.
- No checklists, file lists or commit lists. GitHub already shows files and commits. Never mention Claude or any AI tool.

## 5. Open it

1. Base: the branch this one was cut from (`git merge-base`, `git reflog`). Never assume `main` or `staging`. In a stack, `gh stack submit` opens the PRs (see `ship-feature`); then set each title and body with `gh pr edit`.
2. `git push -u origin <branch>`
3. `gh pr create --base <base> --title "<title>" --body-file <file> --assignee @me`, plus one `--attach <file>` per media file.
4. Labels: `Need Review`, plus the developer's name label from `gh label list` (for example `Muneeb`, `kabeer`, `hamza ashfaq`). If you can't tell which name label is theirs, ask once.
5. Size label: `node .claude/skills/create-pr/pr-size.mjs --pr <number>`.
6. Put the PR link on the Jira ticket (`jira-pr` skill).

## 6. Hand off

Run the `review-pr` skill on the new PR. The team agreed it starts without asking.
