---
name: ship-feature
description: Ship a large feature as one GitHub stack of small PRs on an integration branch. Use when a feature is too big for one PR (more than about 100 lines of logic, or several parts), or when the developer asks to ship, split or stack a feature.
---

# Ship a feature as a GitHub stack

A big feature ships as a stack of small PRs that humans can review, built with GitHub's official stacked pull requests and the `gh stack` extension. A chain of branches that only point at each other doesn't count as a stack.

GitHub docs. Read them when a command surprises you:

- [About stacked PRs](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs)
- [Quickstart](https://docs.github.com/en/pull-requests/get-started/stacked-prs-quickstart)
- [CLI commands](https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands)
- [Managing a stack](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/managing-stacked-pull-requests)
- [Merging a stack](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-stacked-pull-requests)

## What a GitHub stack is

- A chain of PRs in one repository. Each PR targets the branch of the PR below it. The bottom PR targets the stack's base, which here is the integration branch.
- Every PR shows a stack map, so reviewers see where a layer sits and review only that layer's diff.
- CI and branch protection run on every layer, not only the bottom one.
- Merging goes bottom-up. Merging a PR also merges every PR below it. After the bottom merges, GitHub rebases the rest so the next PR targets the base.
- It's in public preview. It works in one repository only (no forks) and not in GitHub Desktop.
- Setup, once per machine: `gh extension install github/gh-stack`. Check with `gh stack --help`.

## 1. Plan before any code

1. Run the `grilling` skill on the feature.
2. Split it into layers, bottom to top:
   - **Layer 1 is the common ground** every later layer needs: types, constants, schema and migrations, shared helpers, API client code. It lives there once. No later layer duplicates it.
   - **One purpose per layer after that.** Order the layers so each one builds and passes lint and type-check on its own.
   - **Mechanical changes get their own layer** (renames, moves, formatting), labelled `mechanical`, never mixed with logic.
   - **Logic layers stay small**: `size/xs` to `size/md`, under 100 lines. A feature may need 15 or 20 layers. That's fine.
3. Show the layer plan with AskUserQuestion: each layer's purpose and estimated size. Build only after the developer confirms.

## 2. Create the integration branch

Name it `integration/PREVENT-<n>-<slug>`. Cut it from where the feature ships: `staging`, or `triage-engine-module` for triage work.

```sh
git fetch origin
git switch -c integration/PREVENT-<n>-<slug> origin/<target>
git push -u origin integration/PREVENT-<n>-<slug>
```

## 3. Build the stack

```sh
gh stack init --base integration/PREVENT-<n>-<slug> PREVENT-<n>-<layer-1-slug>
# write layer 1, let the hooks pass, then commit it and open layer 2 in one step:
gh stack add -Am "feat(scope): <layer 1 change>" PREVENT-<n>-<layer-2-slug>
# write layer 2, then:
gh stack add -Am "feat(scope): <layer 2 change>" PREVENT-<n>-<layer-3-slug>
# the last layer: commit it with plain git
git add -A && git commit -m "feat(scope): <last layer change>"
```

- Each layer is one piece of work. Route it as `AGENTS.md` says (the `implementer` or yourself), and run the plan check on it before you start the next layer.
- Check a layer's size before you move on: `node .claude/skills/create-pr/pr-size.mjs --base <branch below>`.
- `gh stack view --short` shows where you are. `gh stack up`, `down`, `top` and `bottom` move between layers.

## 4. QA, then open the PRs

The stack stays local until QA is green (workflow steps 4 and 5). Check out the top layer, which holds the whole feature, and run the `qa` skill. Fix each bug in the layer that introduced it, then restack with `gh stack rebase --upstack` and have QA verify again.

When QA is green:

```sh
gh stack submit --auto
```

This pushes every branch and opens the PRs as drafts, linked as one stack on GitHub. Then for each PR, follow the `create-pr` skill for the title, body, proof and size label (`gh pr edit <n> --title ... --body-file ...`). Mark it ready with `gh pr ready <n>`.

## 5. Review and fix

- Run the `review-pr` skill on every layer. Each review covers that layer's own diff.
- Fix the comments you agree with in the layer they point at, and reply in each thread.
- A fix that belongs in a lower layer goes in that layer. Switch to it, commit, then restack and push:

```sh
gh stack checkout <branch>
# fix and commit
gh stack rebase --upstack   # on conflict: fix, then gh stack rebase --continue
gh stack push
```

- `gh stack sync` pulls merges from GitHub, rebases the stack and pushes, in one step.

## 6. Merge

The developer merges; never merge yourself. When a layer's checks pass and no review thread is waiting, tell the developer it's ready. Stacks merge bottom-up, from the PR's merge box or with:

```sh
gh stack merge <pr-url>   # merges this PR and every PR below it; a bare number may be read as a stack number
```

After each merge, run `gh stack sync --prune` to restack what's left and delete the merged local branches.

## 7. The final PR

When every layer is in the integration branch:

1. QA already ran before the stack opened. If review fixes changed how the feature behaves, offer a second QA pass on the integration branch (`qa` skill).
2. Open `integration/PREVENT-<n>-<slug>` into its target with the `create-pr` skill. Its Notes list every stacked PR.
3. It gets the full `review-pr` pass and its fixes, like any other PR, even though every layer was already reviewed.
