# Review rules for preventatri-backend

Every reviewer and verifier reads this file. When a type of finding keeps turning out wrong, or a real problem keeps slipping through, add a line here in the same PR that fixes it.

## Always check

- Every new route chains `validatorMiddleware`, `aclAccessMiddleware` and `catchAsyncMiddleware`, in that order, and is documented in the folder's `docs.js`.
- Every query is scoped to the caller's active organization (`req.extra.jwtToken.user.currentActiveOrganization`). A missing scope is a Critical finding.
- Controllers stay thin: read the request, call a service, return a response factory. Database work in a controller is a finding.
- Services return `{success, ..., error}` and don't throw for expected failures.
- Multi-step writes that must succeed together run in one Prisma transaction.
- Response factories return only the fields the client needs.
- Schema changes come with a migration. A migration that drops or rewrites data needs a note on how existing rows are handled.
- Cron jobs and BullMQ workers must be safe to run twice (retries, overlapping runs).
- Dates are stored in UTC and converted with the organization's time zone through `utils/dateUtils.js`.

## Not findings

- Frontend and backend constants may differ. The API maps between them.
- Anything ESLint or Prettier reports. The commit check blocks it already.
- Controllers and middleware taking `(req, res, next)`. They are exempt from the single-object-param rule.
- Old code the PR didn't touch, unless the PR now depends on it. Put that under "Outside this diff".
