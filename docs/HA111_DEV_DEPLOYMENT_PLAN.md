# HA111 development deployment plan

This plan is for an isolated development test only. Existing dashboards and resources remain unchanged.

## Proposed names

- Local bundle: `echo-dashboard-card-dev-4830996.js`
- Home Assistant resource: `/local/echo-dashboard-card-dev-4830996.js`
- Resource type: `JavaScript module`
- Test dashboard title: `Echo Show HTML Dash Dev`
- Test dashboard URL path: `echo-show-html-dash-dev`

The resource name is unique and is not present in the current HA111 resource list.

## Deployment sequence

1. Copy the generated bundle to HA111's `/config/www/` directory under the proposed filename.
2. Add the proposed `/local/` URL as a JavaScript module resource.
3. Open the dashboard creation flow and select the `Echo Show HTML Dash` strategy.
4. Create the dashboard with kiosk mode disabled for PC testing.
5. Configure a test profile and select existing camera entities.
6. Validate the generated dashboard without editing any existing dashboard.

## Rollback

1. Remove only the development resource `/local/echo-dashboard-card-dev-4830996.js`.
2. Delete only the `Echo Show HTML Dash Dev` dashboard if it was created.
3. Reload dashboard resources and the browser.
4. Leave `/al-office-show-8`, `/al-office-show-8-edit`, Show 8 Menu5, and all existing resources untouched.

No production dashboard or existing resource is a deployment target in this test.
