---
name: jira-pr
description: Track a change in Jira from ticket to QA. Use when starting tracked work (ticket and branch), writing commits, linking a PR to its ticket, or moving a ticket toward QA.
---

# Jira and PR flow

Work in this repo is tracked in Jira project `PREVENT` on `https://desolint.atlassian.net` (cloudId `0f811768-d58b-4b00-b9cd-a5e25d30c946`), through the Atlassian MCP server. If that server is not connected, say so and stop. Never work around a missing ticket.

## 1. Ticket, before any code

- Look up the developer with `atlassianUserInfo` and assign the ticket to them.
- Pick the type. A bug fix is a **Bug**, a feature or change is a **Story** or **Task**, several stories are an **Epic**. Skip the ticket for tiny changes QA can't test (a typo, a rename).
- Write in the future tense: what will be done and why. Plain words a QA can act on without asking.
  - **Bug**: impact (who sees it, what breaks), expected, actual, steps to reproduce, cause and fix once known.
  - **Story / Task**: the problem, what will change, acceptance criteria as a short checklist.
- Name the screen or URL when there is one. Priority is Medium unless the work says otherwise.

## 2. Branch

`PREVENT-<n>-short-description`, cut from the branch the work belongs to. That is usually `triage-engine-module`. Ask when it is not clear.

## 3. Commits

Match `git log`: `type(scope): summary` with type `feat`, `fix`, `refactor`, `chore` or `docs`, for example `feat(alerts): show live timers on unresolved alerts`. One logical change per commit. No AI tool footers or co-author trailers.

## 4. Pull request

Open it with the `create-pr` skill. A feature too big for one PR goes through `ship-feature`. Then put the PR link on the Jira ticket.

## 5. Move the ticket

The board: To Do → Started → In Progress → Sent for initial approval → Waiting for Initial Approval → Waiting for Final Approval → PR Approved → **Waiting for QA Testing** → Test by QA → Approved by QA → Done. `Blocked` sits beside In Progress.

- Call `getTransitionsForJiraIssue` before every move and take a transition it offers. Never guess a name.
- Stop at **Waiting for QA Testing**. Everything after it belongs to QA.
- When an approval gate needs someone else, leave the ticket there and tell the developer.
- When the scope changes, update the ticket description first. QA tests against it.
