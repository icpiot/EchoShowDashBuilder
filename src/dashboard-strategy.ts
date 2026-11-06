import { listAvailableCameras, HomeAssistantState } from "./camera-feeds";

export interface EchoDashboardConfig {
  title?: string;
  included_cameras?: string[];
}

export function generateEchoDashboard(config: EchoDashboardConfig, hass: HomeAssistantState) {
  const available = listAvailableCameras(hass);
  const included = new Set(config.included_cameras ?? available.map((camera) => camera.entityId));
  const cameras = available
    .filter((camera) => included.has(camera.entityId))
    .map((camera) => ({ entity: camera.entityId, label: camera.label }));

  return {
    title: config.title || "Echo Show",
    views: [
      {
        title: "Home",
        path: "home",
        cards: [
          { type: "custom:echo-menu", items: [
            { label: "Cameras", path: "cameras", icon: "mdi:cctv" },
            { label: "Lights", path: "lights", icon: "mdi:lightbulb" },
          ], active_path: "home" },
        ],
      },
      {
        title: "Cameras",
        path: "cameras",
        cards: [
          { type: "custom:echo-menu", items: [
            { label: "Cameras", path: "cameras", icon: "mdi:cctv" },
            { label: "Lights", path: "lights", icon: "mdi:lightbulb" },
          ], active_path: "cameras" },
          { type: "custom:echo-camera-wall", cameras },
        ],
      },
      {
        title: "Lights",
        path: "lights",
        cards: [
          { type: "custom:echo-menu", items: [
            { label: "Cameras", path: "cameras", icon: "mdi:cctv" },
            { label: "Lights", path: "lights", icon: "mdi:lightbulb" },
          ], active_path: "lights" },
        ],
      },
    ],
  };
}

export function registerEchoDashboardStrategy(): void {
  const strategy = {
    type: "echo-show",
    strategyType: "dashboard",
    name: "Echo Show HTML Dash",
    description: "A responsive Echo Show dashboard with Cameras and Lights views.",
    documentationURL: "https://github.com/echo-show-html-dash/echo-show-html-dash",
  };
  window.customStrategies = window.customStrategies || [];
  window.customStrategies.push(strategy);
}

declare global {
  interface Window {
    customStrategies?: Array<Record<string, unknown>>;
  }
}
