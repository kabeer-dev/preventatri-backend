---
name: qa
description: Test a feature the way real people use it, in the browser, to find bugs, missing states and UX problems before a PR. Use at workflow step 4, once a feature is built, and whenever the developer asks for QA or testing.
---

# QA a feature

QA uses the running app like real people do: careful, rushed, confused, and trying to break it. It writes no test scripts and never edits code. Bugs get fixed and re-checked; UX ideas wait for the developer.

## 1. Scope and ask

List what changed: screens, forms, flows, and the roles that use them. Then ask with AskUserQuestion, in one call:

- which flows to test (multiSelect)
- which roles to use (multiSelect)
- which database the servers use: local, dev, or staging/production

Run nothing until the developer answers. On staging or production, stop: QA creates and deletes records and saves screenshots, which must never hold real patient data.

## 2. Preflight

1. Both servers answer: `http://localhost:3000` and `http://localhost:3001/awake`. If not, ask the developer to start them.
2. Each role has a saved login in `.claude/qa/sessions/<role>.json`. If one is missing, ask the developer to run this once and log in in the window that opens. Agents never type passwords.

   ```sh
   npx playwright open --channel=chrome --save-storage=.claude/qa/sessions/<role>.json http://localhost:3000/auth/login
   ```

3. Data: every record QA creates is named `QA-<short id>`. QA changes or deletes only its own records and deletes them at the end.

## 3. Test

Dispatch one `qa-tester` with the scope, the roles and their session files, the data rules, the output folder `.claude/qa/output/<date>-<slug>/`, and this checklist:

- The happy path, end to end, first. If it fails, report a Blocker and stop.
- Inputs: empty, spaces only, too long, emoji and other scripts, bad emails, HTML-looking text (it must show as plain text).
- Duplicates, and near duplicates (the same email in another case or with a trailing space).
- Double-click submit. Slow the API, then submit and click around:
  `browser_run_code_unsafe` with `async (page) => { await page.route('**/api/**', async (route) => { await new Promise((r) => setTimeout(r, 4000)); await route.continue(); }); }`, removed afterwards with `browser_unroute`.
- Go offline mid-submit (`browser_network_state_set`), refresh mid-submit, press back after submitting.
- States: loading, empty, error (`browser_route` with `status: 500`), success, submit disabled while it runs. No `undefined`, `NaN` or `Invalid Date` on screen.
- Roles: each role in scope. A role without access is refused on the direct URL. Swapping an id in the URL never shows another organization's data.
- Only for layout changes: 375, 768 and 1440 pixels wide. No horizontal scroll, nothing cut off, tap targets at least 44 pixels.
- After each flow: no console errors, and no failed request the user wasn't told about.

## 4. Report and fix

Show two lists in chat: **bugs**, ranked Blocker, Major, Minor, Trivial, each with steps, expected, actual and evidence; and **UX ideas**, each with why it matters and a suggestion. Then:

1. Fix every bug. A bug with clear repro steps goes to the `bug-fixer` agent. The lead agent keeps a bug with no clear cause.
2. Send the `qa-tester` back to repeat each fixed bug's steps and confirm it's gone.
3. Ask with AskUserQuestion (multiSelect) which UX ideas to make. Make only those, then have QA check them.

QA is green when no bug is open and the developer has decided on every UX idea.
