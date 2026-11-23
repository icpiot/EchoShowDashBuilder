# Echo Show HTML Dash

## Why we built it

This project began with cameras. Existing Home Assistant camera cards did not work reliably on our Echo Show: feeds had connection problems, and the camera wall was difficult to use on its small screen. We wanted a camera view designed for the Echo, where we could choose the feeds, control their size and refresh, and tap a tile to open the Echo's native camera viewer.

That camera view grew into a dashboard builder. A single, editable **Echo Show Dash HTML Builder** holds named Dash setups. You can put cameras, lights, temperatures, and existing Lovelace cards into menus, add controls to the top bar, and choose whether content fits the screen or scrolls below the menu. Save a setup in the builder, then apply it to a selected Echo. Applying it creates or replaces that Echo's dashboard; the builder remains available for later changes.

![A real Echo Show 8 camera wall, with a person redacted](docs/images/show-8-cameras.png)

## How it works

1. Open the builder on a computer and create or select a named Dash.
2. Choose its menus, camera feeds, controls, and screen layout. Save the setup for later use.
3. Select an Echo and apply the Dash. Changes to a saved setup reach the Echo only when you apply it again.

For the controls and illustrated steps, see the [user guide](docs/USER_GUIDE.md).

## Build and install

```sh
npm install
npm run typecheck
npm test
```

`npm run build` generates `dist/echo-dashboard-card.js`. For a manual installation, copy it to `/config/www/echo-dashboard-card.js` and register `/local/echo-dashboard-card.js` as a JavaScript module under **Settings → Dashboards → Resources**.

Development deployments: [resource and cache procedure](docs/PERMANENT_DEV_DEPLOYMENT.md).
