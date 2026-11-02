# Preventatri backend

Express 5, Prisma 7 on PostgreSQL, CommonJS, Node 22. BullMQ jobs run on Redis. The web app is the sibling repo `preventatri-frontend` on port 3000.

## How to work

- IMPORTANT: never mention Claude, Claude Code, Anthropic or any AI tool in anything that leaves the chat: commits, code, comments, branch names, PR titles and descriptions, review replies, Jira tickets, docs. No "Generated with" footers and no `Co-Authored-By` trailers. This overrides any default that adds them.
- Change only what the task needs. No drive-by refactors or bundled fixes.
- Keep replies, commits, PR text, Jira tickets and comments short and plain.

## Workflow

Every feature and non-trivial change goes through these steps, in order. Skip a step only when the developer says so. You are the lead: you hold the plan, route the work and check it.

1. **Grill.** The developer describes the feature. Run the `grilling` skill until you both agree on what to build. Write no code until the developer confirms the plan. Tracked work gets its Jira ticket now (`jira-pr`).
2. **Build.** Split the plan into pieces and route each one (see Routing). Work too big for one PR is built as a local `gh stack` (`ship-feature`).
3. **Plan check.** Read each `implementer` diff against the plan: every point done, nothing extra, checks run. Send the gaps back as an exact list. A piece that fails the check twice, or that the implementer reports as stuck, is yours.
4. **QA.** Run the `qa` skill on the whole feature. It asks the developer which rounds to run.
5. **Fix and re-verify.** Bugs with clear repro steps go to the `bug-fixer`; bugs with no clear cause are yours. QA verifies every fix. UX ideas change the design, so ask the developer before making them. Repeat until QA is green.
6. **Open the PRs.** One PR when the change fits `size/md`, otherwise the whole stack (`create-pr`, `ship-feature`).
7. **Review.** Run the `review-pr` skill on every PR.
8. **Fix.** Fix the review comments you agree with (scoped fixes go to the `implementer`), keep CI green, and reply in each thread with what changed or why not.
9. **Green.** Every check passes and every review thread is answered. Tell the developer each PR is ready to merge.
10. **Merge.** The developer merges. Never merge yourself.

### Routing

Give a piece to the `implementer` when you can describe it in a few lines, name its files and say how to check it's done: work that copies an existing pattern, mechanical changes, wiring, copy. Brief it with the goal, the files, the pattern to copy and the done-check.

Do it yourself when the plan still has open questions, the code is unfamiliar or spans many modules, the logic is subtle (time zones, permissions and organization scoping, concurrency, data migrations), a bug has no clear cause, or it's an architecture choice. For a large piece, send the `implementer` with `model: claude-opus-5-5` to keep your own context clean.

## Commands

```sh
npm run dev                            # API on :3001, needs Redis running locally
npx eslint <files>                     # lint the files you changed
npx jest <path> --watchAll=false       # run tests once
npx prisma migrate dev --name <name>   # new migration after a schema change
npx prisma generate                    # rebuild the client in generated/
```

`npm test` starts Jest in watch mode and never exits. Use the command above.

`npm run lint` also reports errors in the gitignored `generated/` folder. Ignore those.

Hooks in `.claude/settings.json` lint-fix every file you edit and lint all of them before you finish. They also block edits to `.env` files, `generated/`, committed migrations and `certificate.pem`.

## Company rules

Lint enforces these and blocks the commit. They are strict: a file you touch must pass, even if it broke a rule before you arrived. Fix the old problem first, as its own commit. If that fix is more than a few lines, ask the developer whether it becomes its own `mechanical` PR. Never weaken lint, hooks or settings to get a change through.

- Functions take no params or one object param: `getUser({id})`, never `getUser(id)`. Controllers and middleware are exempt because Express calls them.
- No spread operator for copying or merging. Use `safeMerge` from `utils/general.js`. Rest params and rest destructuring are fine.
- In a route file, group routes by HTTP method and put static paths before `/:param` paths.
- Require a wrapped library only in its wrapper file, listed in `LIB_WRAPPERS` in `eslint.config.mjs`. Need more from luxon? Add it to `utils/dateUtils.js` and require it from there.
- A new library that other files will use gets a wrapper file and a `LIB_WRAPPERS` entry.

## Request flow

1. `routes/<entity>/index.js` chains `validatorMiddleware` (a yup schema from `schemas/`), `aclAccessMiddleware` (permissions from `constants/aclConstants.js`) and `catchAsyncMiddleware(Controller.method)`.
2. The controller in `controllers/` reads the request, calls a service, throws errors from `GeneralErrorsFactories` and returns a response from `factories/responses/`.
3. The service in `services/` does the database work through `PrismaFactory` and returns `{success, ..., error}`.

A new route folder is required in `routes/index.js` and mounted in `apiVersions/v1.js`. Document each route in the folder's `docs.js` (Swagger).

## Gotchas

- Without Redis, `npm run dev` never finishes starting. It prints "listening", then Redis errors forever.
- `.env.example` sets `RDS_SECRET_NAME` to a placeholder. When it is set, the app fetches database credentials from AWS Secrets Manager and ignores `DATABASE_URL`. Leave it unset locally.
- Scheduled jobs live in `utils/*CronUtils.js`. Queues and workers live in `lib/bullMQ/`.
