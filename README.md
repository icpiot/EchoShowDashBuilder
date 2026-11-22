# Echo Show HTML Dash

A Home Assistant dashboard builder for Echo Show displays. Create named Dash setups on a computer, choose menus and controls, then apply one to a selected Echo.

**Start here:** [Detailed user guide with pictures](docs/USER_GUIDE.md).

## Build

```sh
npm install
npm run typecheck
npm test
```

`npm run build` generates `dist/echo-dashboard-card.js`. For a manual installation, copy it to `/config/www/echo-dashboard-card.js` and register `/local/echo-dashboard-card.js` as a JavaScript module under **Settings → Dashboards → Resources**.

Development deployments: [resource and cache procedure](docs/PERMANENT_DEV_DEPLOYMENT.md).
