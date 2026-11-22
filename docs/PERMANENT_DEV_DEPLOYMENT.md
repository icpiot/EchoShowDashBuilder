# Permanent HA111 development deployment

Build the current Git revision with `npm run typecheck` and `npm run build`. Copy
`dist/echo-dashboard-card.js` to the HA `/config/www/` share as
`echo-dashboard-card-dev.js`, then verify the local and uploaded SHA-256 hashes
match.

Home Assistant must contain exactly one JavaScript module resource for this
development project:

`/local/echo-dashboard-card-dev.js?v=<first-eight-characters-of-bundle-SHA256>`

Update that existing resource's URL after each changed bundle; do not add another
EchoShowHTMLDash resource. Keep older files in `/config/www/` only as rollback
artifacts, and do not register them. Reload the development dashboard in a
fresh browser context after changing the resource URL.

Rollback uses a known-good bundle, copied over `echo-dashboard-card-dev.js`,
followed by updating the same resource query parameter to that bundle's hash.
Do not edit Home Assistant internal storage directly. Updating the resource
does not itself save a Dash or apply it to a device.
