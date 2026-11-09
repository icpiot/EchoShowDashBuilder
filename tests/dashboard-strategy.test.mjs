import test from "node:test";
import assert from "node:assert/strict";

globalThis.HTMLElement = class {};
globalThis.customElements = { get: () => undefined, define: () => {} };
globalThis.window = { customStrategies: [] };

const { generateEchoDashboard, kioskModeSetting, localDashboardPath } = await import("../dist/echo-dashboard-card.js");

const hass = { states: {
  "camera.front": { entity_id: "camera.front", attributes: { friendly_name: "Front" } },
  "light.kitchen": { entity_id: "light.kitchen", attributes: { friendly_name: "Kitchen" } },
  "sensor.kitchen_temperature": { entity_id: "sensor.kitchen_temperature", state: "21", attributes: { friendly_name: "Kitchen Temperature", device_class: "temperature" } },
} };

test("accepts only local Home Assistant dashboard paths", () => {
  assert.equal(localDashboardPath("/lovelace/0"), "/lovelace/0");
  assert.equal(localDashboardPath("/dashboard-security/0?foo=bar"), "/dashboard-security/0?foo=bar");
  assert.equal(localDashboardPath("https://example.com"), undefined);
  assert.equal(localDashboardPath("//example.com"), undefined);
  assert.equal(localDashboardPath("dashboard-security/0"), undefined);
});

test("keeps navigate menu items but does not make a local view for them", () => {
  const dashboard = generateEchoDashboard({
    menus: [
      { id: "cameras", label: "Cameras", cameras: ["camera.front"] },
      { id: "main", label: "Main Dashboard", action: "navigate", destination: "/lovelace/0" },
    ],
    kiosk_mode: "inherit",
  }, hass);
  assert.deepEqual(dashboard.views.map((view) => view.path), ["cameras"]);
  assert.equal(dashboard.views[0].cards[0].cards[0].items[1].destination, "/lovelace/0");
  assert.equal("kiosk_mode" in dashboard, false);
});

test("writes distinct explicit kiosk overrides and preserves legacy booleans", () => {
  assert.equal(kioskModeSetting(true), "enabled");
  assert.equal(kioskModeSetting(false), "disabled");
  assert.equal(kioskModeSetting(undefined), "inherit");
  assert.deepEqual(generateEchoDashboard({ kiosk_mode: "enabled" }, hass).kiosk_mode, { kiosk: true });
  assert.deepEqual(generateEchoDashboard({ kiosk_mode: "disabled" }, hass).kiosk_mode, { kiosk: false });
  assert.equal("kiosk_mode" in generateEchoDashboard({ kiosk_mode: "inherit" }, hass), false);
});

test("renders the resolved Lovelace card unchanged for a selected menu reference", () => {
  const card = { type: "custom:button-card", name: "Office Lamp", entity: "light.office_lamp", tap_action: { action: "toggle" } };
  const dashboard = generateEchoDashboard({
    menus: [{ id: "cards", label: "Cards", source: "lovelace_card", lovelace_card_id: "office-lamp" }],
    lovelace_cards: { "office-lamp": card },
  }, hass);
  assert.deepEqual(dashboard.views[0].cards[0].cards[1], card);
});
