# Isolated development deployment plan

This plan is for an isolated development test only. Existing dashboards and resources remain unchanged.

## Proposed names

- Local bundle: `echo-dashboard-card-dev-4830996.js`
- Home Assistant resource: `/local/echo-dashboard-card-dev-4830996.js`
- Resource type: `JavaScript module`
- Test dashboard title: `Echo Show Dash Builder Dev`
- Test dashboard URL path: `echo-show-dash-builder-dev`

Choose a resource name that does not conflict with the Home Assistant instance's current resource list.

## Deployment sequence

1. Copy the generated bundle to the test Home Assistant instance's `/config/www/` directory under the proposed filename.
2. Add the proposed `/local/` URL as a JavaScript module resource.
3. Open the dashboard creation flow and select the `Echo Show Dash Builder` strategy.
4. Create the dashboard with kiosk mode disabled for PC testing.
5. Configure a test profile and select existing camera entities.
6. Validate the generated dashboard without editing any existing dashboard.

## Rollback

1. Remove only the development resource `/local/echo-dashboard-card-dev-4830996.js`.
2. Delete only the `Echo Show Dash Builder Dev` dashboard if it was created.
3. Reload dashboard resources and the browser.
4. Leave `/al-office-show-8`, `/al-office-show-8-edit`, Show 8 Menu5, and all existing resources untouched.

No production dashboard or existing resource is a deployment target in this test.
