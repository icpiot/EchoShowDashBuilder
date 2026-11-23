# Developer setup

The project developer or maintainer runs these commands when changing the source code. People using a finished installation do not run them. These steps build the JavaScript module from source; they are not a complete first-time Home Assistant installation because the builder dashboard must also be created and configured in Home Assistant.

```sh
npm install
npm run typecheck
npm test
npm run build
```

The build writes `dist/echo-dashboard-card.js`. For a manual development setup, copy that file to `/config/www/echo-dashboard-card.js` in Home Assistant, then register `/local/echo-dashboard-card.js` as a **JavaScript module** under **Settings → Dashboards → Resources**. Register the resource once; update that registration when the file URL changes.

For the development resource and cache procedure, see [Permanent development deployment](PERMANENT_DEV_DEPLOYMENT.md).
