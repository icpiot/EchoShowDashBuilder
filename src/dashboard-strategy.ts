import { listAvailableCameras, HomeAssistantState } from "./camera-feeds";
import type { EchoCardLibraryEntry } from "./card-library";

export interface EchoDashboardConfig {
  title?: string;
  echo_managed?: boolean;
  saved_profiles?: EchoSavedDashboardProfile[];
  active_profile_id?: string;
  menus?: EchoMenuConfig[];
  /** Stateful controls shown alongside the menu buttons. */
  menu_toggles?: EchoMenuToggleConfig[];
  /** Read-only menu-bar values, optionally tappable. */
  menu_statuses?: EchoMenuStatusConfig[];
  included_cameras?: string[];
  included_lights?: string[];
  included_temperatures?: string[];
  menu?: string[];
  /** Enabled and Disabled write an explicit NemesisRE Kiosk Mode override; Inherit omits it. */
  kiosk_mode?: KioskModeSetting | boolean;
  camera_overlays?: Record<string, { show?: boolean; horizontal?: string; vertical?: string }>;
  camera_spans?: Record<string, number>;
  camera_heights?: Record<string, number>;
  camera_order?: string[];
  refresh_interval?: number;
  camera_refresh_interval?: number;
  camera_refresh_intervals?: Record<string, number>;
  /** Detection entity per camera; the shared visual treatment is below. */
  camera_person_entities?: Record<string, string>;
  /** One visual treatment shared by every camera tile on this Dash. */
  person_detection?: { animation?: "solid" | "soft-pulse" | "beacon" | "corner" | "glow-badge" | "none"; color?: string; show_badge?: boolean; badge_text?: string };
  /** Reusable alert types, styled once for the whole Dash. */
  detection_types?: EchoDetectionType[];
  /** One or more detection signals per camera. */
  camera_detections?: Record<string, EchoCameraDetection[]>;
  /** Target Echo key, used to route camera taps to its native RTSP viewer. */
  echo_target?: string;
  echo_mode?: string;
  echo_dashboard_when_idle?: boolean;
  card_holder_url_path?: string;
  card_library?: EchoCardLibraryEntry[];
  /** Resolved card configurations captured from the builder-only holder at apply time. */
  lovelace_cards?: Record<string, Record<string, unknown>>;
}

export interface EchoSavedDashboardProfile {
  id: string;
  /** Permanent library key. It is chosen on Add/Copy and never renamed. */
  name: string;
  /** Complete per-Dash configuration. Older profiles use the legacy fields below. */
  settings?: Partial<EchoDashboardConfig>;
  menus: EchoMenuConfig[];
  menu_toggles?: EchoMenuToggleConfig[];
  menu_statuses?: EchoMenuStatusConfig[];
  camera_order?: string[];
  camera_overlays?: Record<string, { show?: boolean; horizontal?: string; vertical?: string }>;
  camera_spans?: Record<string, number>;
  camera_heights?: Record<string, number>;
  camera_refresh_interval?: number;
  camera_refresh_intervals?: Record<string, number>;
  camera_person_entities?: Record<string, string>;
  person_detection?: EchoDashboardConfig["person_detection"];
  detection_types?: EchoDetectionType[];
  camera_detections?: Record<string, EchoCameraDetection[]>;
  kiosk_mode?: KioskModeSetting;
  echo_target?: string;
  echo_mode?: string;
  echo_dashboard_when_idle?: boolean;
}

export interface EchoDetectionType {
  id: string;
  label: string;
  match?: string;
  animation?: "solid" | "soft-pulse" | "beacon" | "corner" | "glow-badge" | "none";
  color?: string;
  show_badge?: boolean;
  badge_text?: string;
}

export interface EchoCameraDetection { id: string; type_id: string; entity: string; }

export interface EchoMenuToggleConfig {
  id: string;
  label: string;
  on_label?: string;
  off_label?: string;
  icon?: string;
  /** Optional entity whose changing state chooses the displayed icon. */
  icon_entity?: string;
  /** Horizontal alignment of the icon and label inside the toggle button. */
  icon_placement?: "left" | "center" | "right";
  state_entity: string;
  /** The two edge groups keep navigation in the centre of the menu bar. */
  placement?: "left" | "right";
  order?: number;
  active_color?: string;
  /** A Script toggle runs the selected scripts; an Automation toggle triggers the selected automations. */
  type?: "script" | "automation";
  on_target?: string;
  off_target?: string;
  subtitle?: string;
  confirm?: boolean;
  off_long_press?: boolean;
  hide_unavailable?: boolean;
  on_service?: string;
  on_service_data?: string;
  off_service?: string;
  off_service_data?: string;
  /** Also changes the state entity after the selected action has run. */
  sync_state?: boolean;
}

export interface EchoMenuStatusConfig {
  id: string;
  label?: string;
  icon?: string;
  icon_entity?: string;
  type: "time" | "entity";
  time_format?: "12" | "24";
  entity?: string;
  placement?: "left" | "right";
  /** Alignment of the complete icon-and-text control. */
  alignment?: "left" | "center" | "right";
  order?: number;
  action?: "none" | "navigate" | "service";
  destination?: string;
  service?: string;
}

export type KioskModeSetting = "enabled" | "disabled" | "inherit";

export interface EchoMenuConfig {
  id: string;
  label: string;
  icon?: string;
  /** Optional entity whose changing state chooses the displayed icon. */
  icon_entity?: string;
  /** Horizontal alignment of the icon and label inside the menu button. */
  icon_placement?: "left" | "center" | "right";
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
  /** Per-menu presentation of copied Lovelace cards on the Echo. */
  lovelace_card_layouts?: Record<string, { order?: number; width?: number; height?: number }>;
  /** Whether the content below the fixed menu bar scales to fit or scrolls. */
  content_overflow?: "fit" | "scroll";
  /** Optional fixed content grid columns; omitted keeps automatic layout. */
  columns?: number;
  /** Optional per-menu native tile arrangement, keyed by entity id. */
  item_layouts?: Record<string, { order?: number; width?: number; height?: number }>;
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
  // The master is a purpose-built application, not a configuration card living
  // inside Home Assistant's shared editor.  Its own Save/Apply/Close controls
  // are therefore the only workflow controls the user sees.
  if (config.echo_managed === false) {
    return {
      title: config.title || "Echo Show Dash Builder",
      views: [{
        title: config.title || "Echo Show Dash Builder",
        path: "home",
        type: "panel",
        // Put the card type last: the stored strategy also has a `type` field
        // and must not overwrite the standalone editor card type.
        cards: [{ ...config, type: "custom:echo-show-editor", builder_standalone: true }],
      }],
    };
  }
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
  const menus: EchoMenuConfig[] = Array.isArray(config.menus) ? config.menus : legacyMenu.map((key, index) => ({
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
    icon_entity: String(menu.icon_entity || ""),
    icon_placement: menu.icon_placement === "center" || menu.icon_placement === "right" ? menu.icon_placement : "left",
    action: menu.action === "navigate" ? "navigate" : "view",
    destination: menu.action === "navigate" ? localDashboardPath(menu.destination) : undefined,
  }));
  const menuToggles = (Array.isArray(config.menu_toggles) ? config.menu_toggles : [])
    .filter((toggle: any) => String(toggle?.state_entity || "").trim())
    .map((toggle: any, index: number) => ({
      id: String(toggle.id || `toggle-${index + 1}`),
      label: String(toggle.label || `Toggle ${index + 1}`),
      on_label: String(toggle.on_label || ""),
      off_label: String(toggle.off_label || ""),
      icon: String(toggle.icon || ""),
      icon_entity: String(toggle.icon_entity || ""),
      icon_placement: toggle.icon_placement === "center" || toggle.icon_placement === "right" ? toggle.icon_placement : "left",
      state_entity: String(toggle.state_entity),
      placement: toggle.placement === "right" ? "right" : "left",
      order: Math.max(1, Number(toggle.order) || index + 1),
      active_color: String(toggle.active_color || ""),
      type: toggle.type === "automation" ? "automation" : "script",
      on_target: String(toggle.on_target || ""),
      off_target: String(toggle.off_target || ""),
      subtitle: String(toggle.subtitle || ""),
      confirm: toggle.confirm === true,
      off_long_press: toggle.off_long_press === true,
      hide_unavailable: toggle.hide_unavailable === true,
      on_service: String(toggle.on_service || ""),
      on_service_data: String(toggle.on_service_data || ""),
      off_service: String(toggle.off_service || ""),
      off_service_data: String(toggle.off_service_data || ""),
      sync_state: toggle.sync_state !== false,
    }));
  const menuStatuses = (Array.isArray(config.menu_statuses) ? config.menu_statuses : []).map((status: any, index: number) => ({ id: String(status.id || `status-${index + 1}`), label: String(status.label || ""), icon: String(status.icon || ""), icon_entity: String(status.icon_entity || ""), type: status.type === "time" ? "time" : "entity", time_format: status.time_format === "24" ? "24" : "12", entity: String(status.entity || ""), placement: status.placement === "right" ? "right" : "left", alignment: status.alignment === "center" || status.alignment === "right" ? status.alignment : "left", order: Math.max(1, Number(status.order) || index + 1), action: status.action === "navigate" ? "navigate" : status.action === "service" ? "service" : "none", destination: localDashboardPath(status.destination), service: String(status.service || "") }));
  const menuCard = (active_path: string) => ({ type: "custom:echo-menu", items: menuItems, toggles: menuToggles, statuses: menuStatuses, active_path });
  const view = (title: string, path: string, content: Record<string, unknown>[] = []) => ({
    title,
    path,
    type: "panel",
    cards: [{ type: "vertical-stack", cards: [menuCard(path), ...content] }],
  });
  const views = menus.filter((menu) => menu.action !== "navigate").map((menu) => {
    const cameras = ordered
      .filter((camera) => (menu.cameras || []).includes(camera.entityId))
      .map((camera) => {
        // A saved Dash from before the multi-type detector keeps its person
        // mapping until the user explicitly chooses replacement signals.
        const configured = config.camera_detections?.[camera.entityId];
        const detections = configured?.length
          ? configured
          : (config.camera_person_entities?.[camera.entityId]
            ? [{ id: "person", type_id: "person", entity: config.camera_person_entities[camera.entityId] }]
            : []);
        return { entity: camera.entityId, label: camera.label, native_camera_service: config.echo_target ? `${config.echo_target}_home_show_camera` : undefined, name_overlay: config.camera_overlays?.[camera.entityId], span: config.camera_spans?.[camera.entityId], height: config.camera_heights?.[camera.entityId], refresh_interval: config.camera_refresh_intervals?.[camera.entityId] || config.camera_refresh_interval || config.refresh_interval || 3000, detections };
      });
    const lights = availableLights.filter((light) => (menu.lights || []).includes(light.entity));
    const temperatures = availableTemperatures.filter((sensor) => (menu.temperatures || []).includes(sensor.entity));
    const content: Record<string, unknown>[] = [];
    if (cameras.length) content.push({ type: "custom:echo-camera-wall", cameras, ...(menu?.columns ? { columns: menu.columns } : {}), compact: lights.length > 0 || temperatures.length > 0, detection_types: config.detection_types || [{ id: "person", label: "Person", match: "person", ...(config.person_detection || {}) }, { id: "dog", label: "Dog", match: "dog", animation: "soft-pulse", color: "#7e57c2", show_badge: true, badge_text: "Dog" }] });
    if (lights.length) content.push({ type: "custom:echo-light-controls", lights, ...(menu?.columns ? { columns: menu.columns } : {}), layouts: menu.item_layouts || {} });
    if (temperatures.length) content.push({ type: "custom:echo-temperature-readings", sensors: temperatures, ...(menu?.columns ? { columns: menu.columns } : {}), layouts: menu.item_layouts || {} });
    if (menu.source === "lovelace_card") {
      const selectedIds = Array.isArray(menu.lovelace_card_ids) && menu.lovelace_card_ids.length
        ? menu.lovelace_card_ids : menu.lovelace_card_id ? [menu.lovelace_card_id] : [];
      const cards: Array<{ id: string; config: Record<string, unknown>; order: number; width: number; height: number }> = [];
      for (const id of selectedIds) {
        const card = config.lovelace_cards?.[id];
        const layout = menu.lovelace_card_layouts?.[id] || {};
        if (card) cards.push({ id, config: card, order: Math.max(1, Number(layout.order) || selectedIds.indexOf(id) + 1), width: Math.max(1, Math.min(3, Number(layout.width) || 1)), height: Math.max(1, Math.min(2, Number(layout.height) || 1)) });
        else content.push({ type: "custom:echo-menu-message", message: "A selected Lovelace Card is no longer available in the Custom Card Holder." });
      }
      // Native cards otherwise stack one-per-row inside the panel view, which
      // creates wasted screen space for groups. Keep their own configuration
      // unchanged but pack multiple selections into a compact Echo grid.
      if (cards.length) content.push({ type: "custom:echo-card-layout", cards: cards.sort((a, b) => a.order - b.order || selectedIds.indexOf(a.id) - selectedIds.indexOf(b.id)) });
    }
    if (!content.length) content.push({ type: "markdown", content: "Choose cameras, lights, or temperature sensors for this menu in the dashboard settings." });
    return view(menu.label, menu.id, content);
  });
  // Keep all menu content in one Lovelace view.  The echo-menu card switches
  // the matching cards locally, so a tap does not trigger Home Assistant's
  // route transition/loading flash on the device.
  const localMenus = menus.filter((menu) => menu.action !== "navigate");
  const singleViewContent = views.map((generatedView: any, index) => {
    const menuId = localMenus[index]?.id || "";
    const cards = generatedView?.cards?.[0]?.cards || [];
    const menu = localMenus[index];
    return {
      type: "custom:echo-menu-content",
      menu_id: menuId,
      content_overflow: menu?.content_overflow === "scroll" ? "scroll" : "fit",
      cards: cards.slice(1).map((card: Record<string, unknown>) => ({ ...card, menu_id: menuId })),
    };
  });
  const dashboard: Record<string, any> = {
    title: config.title || "Echo Show",
    views: [{ title: config.title || "Echo Show", path: "home", type: "panel", cards: [{ type: "vertical-stack", cards: [menuCard(localMenus[0]?.id || ""), ...singleViewContent] }] }],
  };
  // The master builder is always a normal Home Assistant dashboard. Kiosk
  // settings are honoured only on a generated, Echo-managed dashboard.
  const kioskMode = config.echo_managed
    ? kioskModeSetting(config.kiosk_mode, "inherit")
    : "inherit";
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

// Recovery for master dashboards briefly written by an early standalone-builder
// version. It loads the same builder and lets the editor restore the supported
// custom:echo-show strategy without editing Home Assistant storage directly.
class EchoShowEditorRecoveryStrategy extends HTMLElement {
  static configRequired = true;
  static getConfigElement() { return document.createElement("echo-show-editor"); }
  static async generate(config: EchoDashboardConfig, hass: HomeAssistantState) {
    return generateEchoDashboard({ ...config, echo_managed: false }, hass);
  }
}

if (!customElements.get("ll-strategy-dashboard-echo-show")) {
  customElements.define("ll-strategy-dashboard-echo-show", EchoShowDashboardStrategy);
}
if (!customElements.get("ll-strategy-dashboard-echo-show-editor")) {
  customElements.define("ll-strategy-dashboard-echo-show-editor", EchoShowEditorRecoveryStrategy);
}

export function registerEchoDashboardStrategy(): void {
  const strategy = {
    type: "echo-show",
    strategyType: "dashboard",
    name: "Echo Show Dash Builder",
    description: "A responsive Echo Show dashboard with cameras, lights, and temperature readings.",
    documentationURL: "https://github.com/icpiot/EchoShowDashBuilder",
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
