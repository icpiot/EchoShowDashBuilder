# Echo Show HTML Dash

Frontend-only Home Assistant dashboard plugin for Echo Show displays. The **Echo Show Dash HTML Builder** is the editable master dashboard: it stores named Dash setups, previews them on a PC, and applies a chosen setup to an Echo. Each Echo receives its own dashboard; the builder itself stays editable.

## Using the builder

1. Open **Echo Show Dash HTML Builder** in the Home Assistant sidebar.
2. Under **Dash Library**, select a named Dash, choose **Add Dash** for a blank setup, or **Copy Dash** to start from an existing one. A Dash name is permanent; each named Dash has its own settings.
3. Under **Menus**, choose the content and order for each menu. A menu can contain cameras, lights, temperature sensors, and custom Lovelace cards. The area filter narrows entity choices while editing; it does not restrict what a menu can contain.
4. Under **Menu-bar controls**, configure optional clock or entity status displays and stateful toggles.
5. Under **Echo Assignment and Deployment**, choose the Echo, presentation, idle behavior, and kiosk setting. **Save Dash** saves the named setup in the library. **Apply Dash to Echo** saves that setup and attaches its generated dashboard to the selected Echo. A later apply replaces the previous builder-created dashboard for that Echo.

To assign an existing, ordinary Home Assistant dashboard instead, expand **Apply a standard Home Assistant dashboard**, select the dashboard, and apply it. This uses its dashboard path and leaves that dashboard's configuration unchanged. The standard-dashboard action does not add a kiosk override.

Use **Delete Dash** in the library only when you intend to remove a saved setup. The builder is the source of truth for future builder-generated deployments.

## Development

```sh
npm install
npm run typecheck
npm run build
```

The bundle is generated at `dist/echo-dashboard-card.js`. Run `npm test` for the focused tests. Generated bundles and `node_modules/` are not committed.

## Home Assistant installation

Install the repository as a HACS Dashboard plugin. HACS loads the bundled module as a dashboard resource. For manual testing, copy `dist/echo-dashboard-card.js` to `/config/www/echo-dashboard-card.js`, then add `/local/echo-dashboard-card.js` as a JavaScript module under Settings → Dashboards → Resources.

The bundle registers the `echo-show` dashboard strategy, `custom:echo-menu`, and `custom:echo-camera-wall`. Menus can show Echo content or navigate to an existing local Home Assistant dashboard/view path. Camera images request a server-side target size through Home Assistant's camera proxy and are swapped only after the replacement image loads.

Each generated dashboard has an independent **Kiosk Mode** setting: Enabled writes the NemesisRE dashboard override `{ kiosk: true }`, Disabled writes `{ kiosk: false }`, and Inherit emits no dashboard-level override. It never changes global kiosk settings or destination dashboards.

For the HA111 development instance, follow [the permanent development deployment procedure](docs/PERMANENT_DEV_DEPLOYMENT.md). Update the one existing development resource when its bundle changes; do not register a duplicate. Avoid applying a test setup to a different Echo.
