# Echo Show HTML Dash

Frontend-only Home Assistant dashboard plugin for Echo Show displays.

## Development

```sh
npm install
npm run typecheck
npm run build
```

The release bundle is generated at `dist/echo-dashboard-card.js`.

## Home Assistant installation

Install the repository as a HACS Dashboard plugin. HACS loads the bundled module as a dashboard resource. For manual testing, copy `dist/echo-dashboard-card.js` to `/config/www/echo-dashboard-card.js`, then add `/local/echo-dashboard-card.js` as a JavaScript module under Settings → Dashboards → Resources.

The bundle registers the `echo-show` dashboard strategy, `custom:echo-menu`, and `custom:echo-camera-wall`. The strategy creates Home, Cameras, and Lights views. Camera images request a server-side target size through Home Assistant's camera proxy and are swapped only after the replacement image loads.

The project uses separate development and production dashboard targets: test with kiosk mode off on a PC, then apply an approved configuration to the Echo Show replica with kiosk mode on.
