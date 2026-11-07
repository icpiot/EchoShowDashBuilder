import { listAvailableCameras, HomeAssistantState } from "./camera-feeds";

export interface EchoDashboardConfig {
  title?: string;
  included_cameras?: string[];
  included_lights?: string[];
  menu?: string[];
  kiosk_mode?: boolean;
  camera_overlays?: Record<string, { show?: boolean; horizontal?: string; vertical?: string }>;
  camera_spans?: Record<string, number>;
  camera_order?: string[];
}

export function generateEchoDashboard(config: EchoDashboardConfig, hass: HomeAssistantState) {
  const available = listAvailableCameras(hass);
  const included = new Set(config.included_cameras ?? available.map((camera) => camera.entityId));
  const configuredOrder = Array.isArray(config.camera_order) ? config.camera_order : [];
  const cameraOrder = [...configuredOrder.filter((entity) => available.some((camera) => camera.entityId === entity)), ...available.filter((camera) => !configuredOrder.includes(camera.entityId)).map((camera) => camera.entityId)];
  const ordered = [...available].sort((a, b) => {
    const order = cameraOrder;
    const ai = order.indexOf(a.entityId);
    const bi = order.indexOf(b.entityId);
    return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi) || a.label.localeCompare(b.label);
  });
  const cameras = ordered
    .filter((camera) => included.has(camera.entityId))
    .map((camera) => ({ entity: camera.entityId, label: camera.label, name_overlay: config.camera_overlays?.[camera.entityId], span: config.camera_spans?.[camera.entityId] }));

  const lights = Object.values(hass.states)
    .filter((state: any) => String(state.entity_id).startsWith("light."))
    .filter((state: any) => !config.included_lights || config.included_lights.includes(state.entity_id))
    .map((state: any) => ({ entity: state.entity_id, label: state.attributes?.friendly_name || state.entity_id }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const menu = config.menu?.length ? config.menu : ["home", "cameras", "lights"];
  const menuItems = menu.map((path) => ({ label: path[0].toUpperCase() + path.slice(1), path, icon: path === "cameras" ? "mdi:cctv" : path === "lights" ? "mdi:lightbulb" : "mdi:home" }));
  const menuCard = (active_path: string) => ({ type: "custom:echo-menu", items: menuItems, active_path });
  const view = (title: string, path: string, content: Record<string, unknown>[] = []) => ({
    title,
    path,
    type: "panel",
    cards: [{ type: "vertical-stack", cards: [menuCard(path), ...content] }],
  });
  const dashboard = {
    title: config.title || "Echo Show",
    views: [
      view("Home", "home"),
      view("Cameras", "cameras", [{ type: "custom:echo-camera-wall", cameras }]),
      view("Lights", "lights", [{ type: "custom:echo-light-controls", lights }]),
    ],
  };
  Object.assign(dashboard, { kiosk_mode: { kiosk: Boolean(config.kiosk_mode) } });
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
    description: "A responsive Echo Show dashboard with Cameras and Lights views.",
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
