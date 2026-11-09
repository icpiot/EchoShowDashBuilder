import { listAvailableCameras, HomeAssistantState } from "./camera-feeds";
import type { EchoCardLibraryEntry } from "./card-library";

export interface EchoDashboardConfig {
  title?: string;
  echo_managed?: boolean;
  saved_profiles?: EchoSavedDashboardProfile[];
  active_profile_id?: string;
  menus?: EchoMenuConfig[];
  included_cameras?: string[];
  included_lights?: string[];
  included_temperatures?: string[];
  menu?: string[];
  /** Enabled and Disabled write an explicit NemesisRE Kiosk Mode override; Inherit omits it. */
  kiosk_mode?: KioskModeSetting | boolean;
  camera_overlays?: Record<string, { show?: boolean; horizontal?: string; vertical?: string }>;
  camera_spans?: Record<string, number>;
  camera_order?: string[];
  refresh_interval?: number;
  camera_refresh_interval?: number;
  camera_refresh_intervals?: Record<string, number>;
  card_holder_url_path?: string;
  card_library?: EchoCardLibraryEntry[];
  /** Resolved card configurations captured from the builder-only holder at apply time. */
  lovelace_cards?: Record<string, Record<string, unknown>>;
}

export interface EchoSavedDashboardProfile {
  id: string;
  name: string;
  menus: EchoMenuConfig[];
  camera_order?: string[];
  camera_overlays?: Record<string, { show?: boolean; horizontal?: string; vertical?: string }>;
  camera_spans?: Record<string, number>;
  camera_refresh_interval?: number;
  camera_refresh_intervals?: Record<string, number>;
  kiosk_mode?: KioskModeSetting;
}

export type KioskModeSetting = "enabled" | "disabled" | "inherit";

export interface EchoMenuConfig {
  id: string;
  label: string;
  icon?: string;
  cameras?: string[];
  lights?: string[];
  temperatures?: string[];
  action?: "view" | "navigate";
  destination?: string;
  source?: "menu" | "lovelace_card";
  /** Multiple native cards may share one Echo menu. */
  lovelace_card_ids?: string[];
  /** @deprecated Kept so existing saved menus load unchanged. */
  lovelace_card_id?: string;
}

export function kioskModeSetting(value: unknown, defaultValue: KioskModeSetting = "inherit"): KioskModeSetting {
  if (value === true || value === "enabled") return "enabled";
  if (value === false || value === "disabled") return "disabled";
  return defaultValue;
}

/** Only allow an in-app Home Assistant path, never an external URL or protocol-relative URL. */
export function localDashboardPath(value: unknown): string | undefined {
  const path = String(value ?? "").trim();
  if (!path || !path.startsWith("/") || path.startsWith("//") || /[\\\\\u0000-\u001f]/.test(path)) return undefined;
  try {
    const parsed = new URL(path, "http://home-assistant.local");
    if (parsed.origin !== "http://home-assistant.local" || parsed.pathname.split("/").includes("..")) return undefined;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { return undefined; }
}

export function generateEchoDashboard(config: EchoDashboardConfig, hass: HomeAssistantState) {
  const available = listAvailableCameras(hass);
  const configuredOrder = Array.isArray(config.camera_order) ? config.camera_order : [];
  const cameraOrder = [...configuredOrder.filter((entity) => available.some((camera) => camera.entityId === entity)), ...available.filter((camera) => !configuredOrder.includes(camera.entityId)).map((camera) => camera.entityId)];
  const ordered = [...available].sort((a, b) => {
    const order = cameraOrder;
    const ai = order.indexOf(a.entityId);
    const bi = order.indexOf(b.entityId);
    return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi) || a.label.localeCompare(b.label);
  });
  const availableLights = Object.values(hass.states)
    .filter((state: any) => String(state.entity_id).startsWith("light."))
    .map((state: any) => ({ entity: state.entity_id, label: state.attributes?.friendly_name || state.entity_id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const availableTemperatures = Object.values(hass.states)
    .filter((state: any) => {
      const entity = String(state.entity_id || "");
      const name = String(state.attributes?.friendly_name || "");
      const searchableName = `${entity} ${name}`.replace(/[_-]+/g, " ");
      const hasTemperatureWord = /(^|\s)temperature(\s|$)/i.test(searchableName);
      const hasTempWord = /(^|\s)temp(\s|$)/i.test(searchableName);
      const looksLikeCompanionSensor = /(^|\s)(battery|humidity|voltage|time|attempted)(\s|$)/i.test(searchableName);
      return entity.startsWith("sensor.") && (state.attributes?.device_class === "temperature" || hasTemperatureWord || (hasTempWord && !looksLikeCompanionSensor));
    })
    .map((state: any) => ({ entity: state.entity_id, label: state.attributes?.friendly_name || state.entity_id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const legacyMenu = config.menu?.length ? config.menu : ["cameras"];
  const menus: EchoMenuConfig[] = Array.isArray(config.menus) && config.menus.length ? config.menus : legacyMenu.map((key, index) => ({
    id: key || `menu-${index + 1}`,
    label: key ? key[0].toUpperCase() + key.slice(1) : `Menu ${index + 1}`,
    icon: key === "cameras" ? "mdi:cctv" : key === "lights" ? "mdi:lightbulb" : "mdi:home",
    cameras: key === "cameras" ? (config.included_cameras ?? available.map((camera) => camera.entityId)) : [],
    lights: key === "lights" ? (config.included_lights ?? availableLights.map((light) => light.entity)) : [],
    temperatures: key === "temperature" ? (config.included_temperatures ?? availableTemperatures.map((sensor) => sensor.entity)) : [],
  }));
  const menuItems = menus.map((menu) => ({
    label: menu.label,
    path: menu.id,
    icon: menu.icon,
    action: menu.action === "navigate" ? "navigate" : "view",
    destination: menu.action === "navigate" ? localDashboardPath(menu.destination) : undefined,
  }));
  const menuCard = (active_path: string) => ({ type: "custom:echo-menu", items: menuItems, active_path });
  const view = (title: string, path: string, content: Record<string, unknown>[] = []) => ({
    title,
    path,
    type: "panel",
    cards: [{ type: "vertical-stack", cards: [menuCard(path), ...content] }],
  });
  const views = menus.filter((menu) => menu.action !== "navigate").map((menu) => {
    const cameras = ordered
      .filter((camera) => (menu.cameras || []).includes(camera.entityId))
      .map((camera) => ({ entity: camera.entityId, label: camera.label, name_overlay: config.camera_overlays?.[camera.entityId], span: config.camera_spans?.[camera.entityId], refresh_interval: config.camera_refresh_intervals?.[camera.entityId] || config.camera_refresh_interval || config.refresh_interval || 3000 }));
    const lights = availableLights.filter((light) => (menu.lights || []).includes(light.entity));
    const temperatures = availableTemperatures.filter((sensor) => (menu.temperatures || []).includes(sensor.entity));
    const content: Record<string, unknown>[] = [];
    if (cameras.length) content.push({ type: "custom:echo-camera-wall", cameras, compact: lights.length > 0 || temperatures.length > 0 });
    if (lights.length) content.push({ type: "custom:echo-light-controls", lights });
    if (temperatures.length) content.push({ type: "custom:echo-temperature-readings", sensors: temperatures });
    if (menu.source === "lovelace_card") {
      const selectedIds = Array.isArray(menu.lovelace_card_ids) && menu.lovelace_card_ids.length
        ? menu.lovelace_card_ids : menu.lovelace_card_id ? [menu.lovelace_card_id] : [];
      for (const id of selectedIds) {
        const card = config.lovelace_cards?.[id];
        if (card) content.push(card);
        else content.push({ type: "markdown", content: "A selected Lovelace Card is no longer available in the Custom Card Holder." });
      }
    }
    if (!content.length) content.push({ type: "markdown", content: "Choose cameras, lights, or temperature sensors for this menu in the dashboard settings." });
    return view(menu.label, menu.id, content);
  });
  const dashboard: Record<string, any> = { title: config.title || "Echo Show", views };
  const kioskMode = kioskModeSetting(config.kiosk_mode, config.echo_managed ? "enabled" : "inherit");
  // NemesisRE Kiosk Mode reads this dashboard-level object.  Leaving it absent
  // is intentionally distinct from an explicit { kiosk: false } override.
  if (kioskMode === "enabled") dashboard.kiosk_mode = { kiosk: true };
  if (kioskMode === "disabled") dashboard.kiosk_mode = { kiosk: false };
  return dashboard;
}

class EchoShowDashboardStrategy extends HTMLElement {
  static configRequired = true;
  static getConfigElement() { return document.createElement("echo-show-editor"); }
  static async generate(config: EchoDashboardConfig, hass: HomeAssistantState) {
    return generateEchoDashboard(config, hass);
  }
}

if (!customElements.get("ll-strategy-dashboard-echo-show")) {
  customElements.define("ll-strategy-dashboard-echo-show", EchoShowDashboardStrategy);
}

export function registerEchoDashboardStrategy(): void {
  const strategy = {
    type: "echo-show",
    strategyType: "dashboard",
    name: "Echo Show HTML Dash",
    description: "A responsive Echo Show dashboard with cameras, lights, and temperature readings.",
    documentationURL: "https://github.com/echo-show-html-dash/echo-show-html-dash",
    configRequired: true,
  };
  window.customStrategies = window.customStrategies || [];
  window.customStrategies.push(strategy);
}


declare global {
  interface Window {
    customStrategies?: Array<Record<string, unknown>>;
  }
}
