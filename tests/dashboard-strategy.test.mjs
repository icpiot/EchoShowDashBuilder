import test from "node:test";
import assert from "node:assert/strict";

globalThis.HTMLElement = class {};
globalThis.customElements = { get: () => undefined, define: () => {} };
globalThis.window = { customStrategies: [] };

const { generateEchoDashboard, kioskModeSetting, localDashboardPath } = await import("../dist/echo-dashboard-card.js");

const hass = { states: {
  "camera.front": { entity_id: "camera.front", attributes: { friendly_name: "Front" } },
  "camera.garage": { entity_id: "camera.garage", attributes: { friendly_name: "Garage" } },
  "light.kitchen": { entity_id: "light.kitchen", attributes: { friendly_name: "Kitchen" } },
  "sensor.kitchen_temperature": { entity_id: "sensor.kitchen_temperature", state: "21", attributes: { friendly_name: "Kitchen Temperature", device_class: "temperature" } },
} };

const menuContent = (dashboard, index = 0) => dashboard.views[0].cards[0].cards[index + 1];

test("accepts only local Home Assistant dashboard paths", () => {
  assert.equal(localDashboardPath("/lovelace/0"), "/lovelace/0");
  assert.equal(localDashboardPath("/dashboard-security/0?foo=bar"), "/dashboard-security/0?foo=bar");
  assert.equal(localDashboardPath("https://example.com"), undefined);
  assert.equal(localDashboardPath("//example.com"), undefined);
  assert.equal(localDashboardPath("dashboard-security/0"), undefined);
});

test("keeps navigate menu items while placing local content in one stable view", () => {
  const dashboard = generateEchoDashboard({
    menus: [
      { id: "cameras", label: "Cameras", cameras: ["camera.front"] },
      { id: "main", label: "Main Dashboard", action: "navigate", destination: "/lovelace/0" },
    ],
    kiosk_mode: "inherit",
  }, hass);
  assert.deepEqual(dashboard.views.map((view) => view.path), ["home"]);
  assert.equal(dashboard.views[0].cards[0].cards[0].items[1].destination, "/lovelace/0");
  assert.equal(menuContent(dashboard).cards[0].cameras[0].native_camera_service, undefined);
  assert.equal(menuContent(dashboard).menu_id, "cameras");
  assert.equal(menuContent(dashboard).content_overflow, "fit");
  assert.equal("kiosk_mode" in dashboard, false);
});

test("routes selected camera taps to the target Echo native RTSP viewer", () => {
  const dashboard = generateEchoDashboard({
    echo_target: "al_office_echo_8",
    menus: [{ id: "cameras", label: "Cameras", cameras: ["camera.front"] }],
  }, hass);
  assert.equal(menuContent(dashboard).cards[0].cameras[0].native_camera_service, "al_office_echo_8_home_show_camera");
});

test("uses each camera's configured detection types and preserves legacy person mappings", () => {
  const dashboard = generateEchoDashboard({
    menus: [{ id: "cameras", label: "Cameras", cameras: ["camera.front", "camera.garage"] }],
    detection_types: [{ id: "person", label: "Person", color: "#ffc107" }, { id: "dog", label: "Dog", color: "#7e57c2" }],
    camera_detections: { "camera.front": [{ id: "front-dog", type_id: "dog", entity: "sensor.front_dog_active_count" }] },
    camera_person_entities: { "camera.garage": "binary_sensor.garage_person" },
  }, hass);
  const wall = menuContent(dashboard).cards[0];
  assert.deepEqual(wall.detection_types.map((type) => type.id), ["person", "dog"]);
  assert.deepEqual(wall.cameras[0].detections, [{ id: "front-dog", type_id: "dog", entity: "sensor.front_dog_active_count" }]);
  assert.deepEqual(wall.cameras[1].detections, [{ id: "person", type_id: "person", entity: "binary_sensor.garage_person" }]);
});

test("writes kiosk overrides only for Echo-managed dashboards", () => {
  assert.equal(kioskModeSetting(true), "enabled");
  assert.equal(kioskModeSetting(false), "disabled");
  assert.equal(kioskModeSetting(undefined), "inherit");
  assert.equal("kiosk_mode" in generateEchoDashboard({ kiosk_mode: "enabled" }, hass), false);
  assert.deepEqual(generateEchoDashboard({ echo_managed: true, kiosk_mode: "enabled" }, hass).kiosk_mode, { kiosk: true });
  assert.deepEqual(generateEchoDashboard({ echo_managed: true, kiosk_mode: "disabled" }, hass).kiosk_mode, { kiosk: false });
  assert.equal("kiosk_mode" in generateEchoDashboard({ echo_managed: true, kiosk_mode: "inherit" }, hass), false);
});

test("wraps a selected Lovelace card in the adaptive Echo layout", () => {
  const card = { type: "custom:button-card", name: "Office Lamp", entity: "light.office_lamp", tap_action: { action: "toggle" } };
  const dashboard = generateEchoDashboard({
    menus: [{ id: "cards", label: "Cards", source: "lovelace_card", lovelace_card_id: "office-lamp" }],
    lovelace_cards: { "office-lamp": card },
  }, hass);
  assert.deepEqual(menuContent(dashboard), { type: "custom:echo-menu-content", menu_id: "cards", content_overflow: "fit", cards: [{ type: "custom:echo-card-layout", menu_id: "cards", cards: [{ id: "office-lamp", config: card, order: 1, width: 1, height: 1 }] }] });
});

test("packs every selected Lovelace card into one compact menu grid", () => {
  const first = { type: "custom:button-card", name: "Office Lamp" };
  const second = { type: "custom:button-card", name: "Living Room" };
  const dashboard = generateEchoDashboard({
    menus: [{ id: "cards", label: "Cards", source: "lovelace_card", lovelace_card_ids: ["office", "living"] }],
    lovelace_cards: { office: first, living: second },
  }, hass);
  assert.deepEqual(menuContent(dashboard), { type: "custom:echo-menu-content", menu_id: "cards", content_overflow: "fit", cards: [{ type: "custom:echo-card-layout", menu_id: "cards", cards: [{ id: "office", config: first, order: 1, width: 1, height: 1 }, { id: "living", config: second, order: 2, width: 1, height: 1 }] }] });
});

test("honours each custom card's chosen sequence and size", () => {
  const dashboard = generateEchoDashboard({
    menus: [{ id: "cards", label: "Cards", source: "lovelace_card", lovelace_card_ids: ["office", "living"], lovelace_card_layouts: { office: { order: 2, width: 2, height: 1 }, living: { order: 1, width: 1, height: 2 } } }],
    lovelace_cards: { office: { type: "markdown", content: "Office" }, living: { type: "markdown", content: "Living" } },
  }, hass);
  assert.deepEqual(menuContent(dashboard).cards[0].cards.map((card) => [card.id, card.order, card.width, card.height]), [["living", 1, 1, 2], ["office", 2, 2, 1]]);
});

test("normalises duplicate custom card order values into a stable sequence", () => {
  const dashboard = generateEchoDashboard({
    menus: [{ id: "cards", label: "Cards", source: "lovelace_card", lovelace_card_ids: ["office", "living"], lovelace_card_layouts: { office: { order: 2 }, living: { order: 1 } } }],
    lovelace_cards: { office: { type: "markdown", content: "Office" }, living: { type: "markdown", content: "Living" } },
  }, hass);
  assert.deepEqual(menuContent(dashboard).cards[0].cards.map((card) => card.id), ["living", "office"]);
});

test("keeps the menu fixed while allowing selected content to scroll", () => {
  const dashboard = generateEchoDashboard({
    menus: [{ id: "cameras", label: "Cameras", cameras: ["camera.front"], content_overflow: "scroll" }],
  }, hass);
  assert.equal(menuContent(dashboard).content_overflow, "scroll");
});

test("renders the non-managed master as a standalone builder", () => {
  const dashboard = generateEchoDashboard({ title: "Echo Show Dash HTML Builder", echo_managed: false, menus: [] }, hass);
  assert.equal(dashboard.views[0].cards[0].type, "custom:echo-show-editor");
  assert.equal(dashboard.views[0].type, "panel");
});
