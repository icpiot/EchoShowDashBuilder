# Permanent HA111 development deployment

Build the current Git revision with `npm run typecheck` and `npm run build`. Copy
`dist/echo-dashboard-card.js` to the HA `/config/www/` share as
`echo-dashboard-card-dev.js`, then verify the local and uploaded SHA-256 hashes
match.

Home Assistant must contain exactly one JavaScript module resource for this
project:

`/local/echo-dashboard-card-dev.js?v=<short-git-revision>`

Update that existing resource's URL after each build; do not add another
EchoShowHTMLDash resource. Keep older files in `/config/www/` only as rollback
artifacts, and do not register them. Reload the development dashboard in a
fresh browser context after changing the resource URL.

Rollback is performed by checking out a known-good Git commit, rebuilding,
copying the resulting bundle over `echo-dashboard-card-dev.js`, and updating
the existing resource query parameter. Do not edit Home Assistant internal
storage directly.
