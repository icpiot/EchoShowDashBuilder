import { listAvailableCameras, HomeAssistantState } from "./camera-feeds";

export interface EchoDashboardConfig {
  title?: string;
  included_cameras?: string[];
  menu?: string[];
  kiosk_mode?: boolean;
  camera_overlays?: Record<string, { show?: boolean; horizontal?: string; vertical?: string }>;
}

export function generateEchoDashboard(config: EchoDashboardConfig, hass: HomeAssistantState) {
  const available = listAvailableCameras(hass);
  const included = new Set(config.included_cameras ?? available.map((camera) => camera.entityId));
  const cameras = available
    .filter((camera) => included.has(camera.entityId))
    .map((camera) => ({ entity: camera.entityId, label: camera.label, name_overlay: config.camera_overlays?.[camera.entityId] }));

  const menu = config.menu?.length ? config.menu : ["cameras", "lights"];
  const menuItems = menu.map((path) => ({ label: path[0].toUpperCase() + path.slice(1), path, icon: path === "cameras" ? "mdi:cctv" : path === "lights" ? "mdi:lightbulb" : "mdi:home" }));
  const menuCard = (active_path: string) => ({ type: "custom:echo-menu", items: menuItems, active_path });
  const dashboard = {
    title: config.title || "Echo Show",
    views: [
      {
        title: "Home",
        path: "home",
        cards: [
          menuCard("home"),
        ],
      },
      {
        title: "Cameras",
        path: "cameras",
        cards: [
          menuCard("cameras"),
          { type: "custom:echo-camera-wall", cameras },
        ],
      },
      {
        title: "Lights",
        path: "lights",
        cards: [
          menuCard("lights"),
        ],
      },
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
