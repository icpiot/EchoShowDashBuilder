import { listAvailableCameras } from "./camera-feeds";
import { kioskModeSetting, localDashboardPath, type EchoDashboardConfig, type EchoMenuConfig, type EchoMenuToggleConfig, type EchoMenuStatusConfig, type EchoSavedDashboardProfile } from "./dashboard-strategy";
import { cardFingerprint, reconcileCardLibrary, type EchoCardLibraryEntry, type HolderCard } from "./card-library";

type Hass = {
  states: Record<string, any>;
  callService?: (domain: string, service: string, data: Record<string, unknown>) => Promise<unknown>;
  callWS?: (message: Record<string, unknown>) => Promise<any>;
  connection?: { sendMessagePromise?: (message: Record<string, unknown>) => Promise<any> };
};

type EchoTarget = {
  key: string;
  label: string;
  dashboard: string;
  dashboardToShow: string;
  idle: string;
};

type DashboardDestination = { path: string; label: string };

const MENU_ICON_CHOICES: Array<[string, string]> = [
  ["", "No icon"],
  ["mdi:view-dashboard", "Dashboard"],
  ["mdi:home", "Home"],
  ["mdi:cctv", "Cameras"],
  ["mdi:camera", "Camera"],
  ["mdi:lightbulb", "Lights"],
  ["mdi:thermometer", "Temperature"],
  ["mdi:sofa", "Living room"],
  ["mdi:food-fork-drink", "Kitchen"],
  ["mdi:bed", "Bedroom"],
  ["mdi:garage", "Garage"],
  ["mdi:door", "Door"],
  ["mdi:floor-plan", "Rooms"],
  ["mdi:shield-home", "Security"],
  ["mdi:television", "Media"],
  ["mdi:weather-sunny", "Weather"],
  ["mdi:dots-grid", "More"],
];

function moveCameraToPosition(order: string[], entity: string, requestedPosition: number): string[] {
  const next = [...order];
  const from = next.indexOf(entity);
  if (from < 0 || !Number.isFinite(requestedPosition)) return next;
  const to = Math.max(0, Math.min(next.length - 1, Math.trunc(requestedPosition)));
  if (from === to) return next;

  // Shift every camera in the crossed range by one so positions stay contiguous.
  if (from < to) {
    for (let index = from; index < to; index += 1) next[index] = next[index + 1];
  } else {
    for (let index = from; index > to; index -= 1) next[index] = next[index - 1];
  }
  next[to] = entity;
  return next;
}

function moveMenuToPosition(menus: EchoMenuConfig[], menuId: string, requestedPosition: number): EchoMenuConfig[] {
  const next = [...menus];
  const from = next.findIndex((menu) => menu.id === menuId);
  if (from < 0 || !Number.isFinite(requestedPosition)) return next;
  const to = Math.max(0, Math.min(next.length - 1, Math.trunc(requestedPosition)));
  if (from === to) return next;
  const [menu] = next.splice(from, 1);
  next.splice(to, 0, menu);
  return next;
}

function moveCardToPosition(ids: string[], cardId: string, requestedPosition: number): string[] {
  const next = [...ids];
  const from = next.indexOf(cardId);
  if (from < 0 || !Number.isFinite(requestedPosition)) return next;
  const to = Math.max(0, Math.min(next.length - 1, Math.trunc(requestedPosition)));
  if (from === to) return next;
  const [card] = next.splice(from, 1);
  next.splice(to, 0, card);
  return next;
}

function moveToggleToPosition(toggles: EchoMenuToggleConfig[], toggleId: string, placement: "left" | "right", requestedPosition: number): EchoMenuToggleConfig[] {
  const group = toggles.filter((toggle) => (toggle.placement === "right" ? "right" : "left") === placement).sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const from = group.findIndex((toggle) => toggle.id === toggleId);
  if (from < 0 || !Number.isFinite(requestedPosition)) return toggles;
  const to = Math.max(0, Math.min(group.length - 1, Math.trunc(requestedPosition)));
  const [moved] = group.splice(from, 1);
  group.splice(to, 0, moved);
  const orders = new Map(group.map((toggle, index) => [toggle.id, index + 1]));
  return toggles.map((toggle) => (toggle.placement === "right" ? "right" : "left") === placement ? { ...toggle, placement, order: orders.get(toggle.id) || 1 } : toggle);
}

function normaliseMenuToggles(value: unknown): EchoMenuToggleConfig[] {
  const toggles = Array.isArray(value) ? value : [];
  const groups: Record<string, number> = { left: 0, right: 0 };
  return toggles.map((toggle: any, index) => {
    const placement = toggle?.placement === "right" ? "right" : "left";
    groups[placement] += 1;
    return {
      id: String(toggle?.id || `toggle-${index + 1}`), label: String(toggle?.label || `Toggle ${index + 1}`),
      on_label: String(toggle?.on_label || ""), off_label: String(toggle?.off_label || ""), icon: String(toggle?.icon || ""), icon_entity: String(toggle?.icon_entity || ""),
      icon_placement: toggle?.icon_placement === "center" || toggle?.icon_placement === "right" ? toggle.icon_placement : "left",
      state_entity: String(toggle?.state_entity || ""), placement, order: groups[placement],
      active_color: String(toggle?.active_color || "#2e9d5b"), on_service: String(toggle?.on_service || ""), on_service_data: String(toggle?.on_service_data || ""),
      off_service: String(toggle?.off_service || ""), off_service_data: String(toggle?.off_service_data || ""), sync_state: toggle?.sync_state !== false,
      type: toggle?.type === "automation" ? "automation" : "script", on_target: String(toggle?.on_target || ""), off_target: String(toggle?.off_target || ""),
      subtitle: String(toggle?.subtitle || ""), confirm: toggle?.confirm === true, off_long_press: toggle?.off_long_press === true, hide_unavailable: toggle?.hide_unavailable === true,
    };
  });
}

const profileSettings = (profile: EchoSavedDashboardProfile): Partial<EchoDashboardConfig> => profile.settings || {
  menus: profile.menus || [],
  menu_toggles: profile.menu_toggles || [],
  menu_statuses: profile.menu_statuses || [],
  camera_order: profile.camera_order || [],
  camera_overlays: profile.camera_overlays || {},
  camera_spans: profile.camera_spans || {},
  camera_refresh_interval: profile.camera_refresh_interval || 3000,
  camera_refresh_intervals: profile.camera_refresh_intervals || {},
  camera_person_entities: profile.camera_person_entities || {},
  person_detection: profile.person_detection || {},
  detection_types: profile.detection_types || [],
  camera_detections: profile.camera_detections || {},
  kiosk_mode: profile.kiosk_mode || "inherit",
  echo_target: profile.echo_target || "",
  echo_mode: profile.echo_mode || "Streamed",
  echo_dashboard_when_idle: Boolean(profile.echo_dashboard_when_idle),
};

const dashSettings = (config: EchoDashboardConfig): Partial<EchoDashboardConfig> => ({
  menus: config.menus || [],
  menu_toggles: config.menu_toggles || [],
  menu_statuses: config.menu_statuses || [],
  camera_order: config.camera_order || [],
  camera_overlays: config.camera_overlays || {},
  camera_spans: config.camera_spans || {},
  camera_refresh_interval: config.camera_refresh_interval || 3000,
  camera_refresh_intervals: config.camera_refresh_intervals || {},
  camera_person_entities: config.camera_person_entities || {},
  person_detection: config.person_detection || {},
  detection_types: config.detection_types || [],
  camera_detections: config.camera_detections || {},
  kiosk_mode: kioskModeSetting(config.kiosk_mode, "inherit"),
  echo_target: config.echo_target || "",
  echo_mode: config.echo_mode || "Streamed",
  echo_dashboard_when_idle: Boolean(config.echo_dashboard_when_idle),
});

function cardLayoutsFor(ids: string[], existing: Record<string, any> | undefined): Record<string, { order: number; width: number; height: number }> {
  return ids.reduce((layouts, id, index) => {
    const current = existing?.[id] || {};
    layouts[id] = {
      order: Math.max(1, Math.min(ids.length, Number(current.order) || index + 1)),
      width: Math.max(1, Math.min(3, Number(current.width) || 1)),
      height: Math.max(1, Math.min(2, Number(current.height) || 1)),
    };
    return layouts;
  }, {} as Record<string, { order: number; width: number; height: number }>);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function iconChoiceMarkup(value: string, label: string): string {
  return `<button type="button" data-menu-icon-choice="${escapeHtml(value)}" title="${escapeHtml(label)}">${value ? `<ha-icon icon="${escapeHtml(value)}"></ha-icon>` : `<span class="no-icon-mark">×</span>`}<span>${escapeHtml(label)}</span></button>`;
}

function toggleIconChoiceMarkup(value: string, label: string): string {
  return `<button type="button" data-toggle-icon-choice="${escapeHtml(value)}" title="${escapeHtml(label)}">${value ? `<ha-icon icon="${escapeHtml(value)}"></ha-icon>` : `<span class="no-icon-mark">×</span>`}<span>${escapeHtml(label)}</span></button>`;
}

function getMenuProfiles(config: any, cameras: Array<{ entityId: string }>, lights: any[], temperatures: any[] = []): EchoMenuConfig[] {
  if (Array.isArray(config.menus)) {
    return config.menus.map((menu: any, index: number) => ({
      id: String(menu.id || `menu-${index + 1}`),
      label: String(menu.label || `Menu ${index + 1}`),
      // Old setups with no icon field keep their familiar default. A blank
      // icon field is intentional and must remain blank when the editor saves.
      icon: Object.prototype.hasOwnProperty.call(menu, "icon") ? String(menu.icon || "") : "mdi:view-dashboard",
      icon_placement: menu.icon_placement === "center" || menu.icon_placement === "right" ? menu.icon_placement : "left",
      cameras: Array.isArray(menu.cameras) ? menu.cameras : [],
      lights: Array.isArray(menu.lights) ? menu.lights : [],
      temperatures: Array.isArray(menu.temperatures) ? menu.temperatures : [],
      action: menu.action === "navigate" ? "navigate" : "view",
      destination: String(menu.destination || ""),
      source: menu.source === "lovelace_card" ? "lovelace_card" : "menu",
      lovelace_card_ids: Array.isArray(menu.lovelace_card_ids) ? menu.lovelace_card_ids.map(String) : menu.lovelace_card_id ? [String(menu.lovelace_card_id)] : [],
      lovelace_card_id: String(menu.lovelace_card_id || ""),
      lovelace_card_layouts: cardLayoutsFor(Array.isArray(menu.lovelace_card_ids) ? menu.lovelace_card_ids.map(String) : menu.lovelace_card_id ? [String(menu.lovelace_card_id)] : [], menu.lovelace_card_layouts),
      content_overflow: menu.content_overflow === "scroll" ? "scroll" : "fit",
    }));
  }
  const legacy = Array.isArray(config.menu) && config.menu.length ? config.menu : ["cameras"];
  return legacy.map((key: string, index: number) => ({
    id: key || `menu-${index + 1}`,
    label: key ? key[0].toUpperCase() + key.slice(1) : `Menu ${index + 1}`,
    icon: key === "cameras" ? "mdi:cctv" : key === "lights" ? "mdi:lightbulb" : "mdi:home",
    cameras: key === "cameras" ? (config.included_cameras || cameras.map((camera) => camera.entityId)) : [],
    lights: key === "lights" ? (config.included_lights || lights.map((light) => light.entity_id)) : [],
    temperatures: key === "temperature" ? (config.included_temperatures || temperatures.map((sensor) => sensor.entity_id)) : [],
    action: "view",
    destination: "",
  }));
}

class EchoShowEditor extends HTMLElement {
  private static openMenuPickers: Record<string, boolean[]> = {};
  private static openMenuCards: Record<string, boolean> = {};
  private static openCameraSettings: Record<string, boolean> = {};
  private config: any = {};
  private _hass?: Hass;
  private managedDashboards: Array<{ id: string; title: string; url_path: string; target?: string }> = [];
  private managedDashboardsLoaded = false;
  private managedDashboardsLoading = false;
  private managedDashboardsError = "";
  private dashboardDestinations: DashboardDestination[] = [{ path: "/lovelace/0", label: "Overview — /lovelace/0" }];
  private standardDashboards: Array<{ title: string; url_path: string }> = [{ title: "Overview", url_path: "lovelace" }];
  private dashboardDestinationsLoaded = false;
  private dashboardDestinationsLoading = false;
  private dashboardDestinationsError = "";
  private areas: Array<{ area_id: string; name: string }> = [];
  private entityAreas: Record<string, string> = {};
  private areaRegistryLoaded = false;
  private areaRegistryLoading = false;
  private areaRegistryError = "";
  private menuAreaFilters: Record<string, string> = {};
  private selectedProfileId = "";
  private mdiIconNames: string[] = [];
  private mdiIconLoad?: Promise<string[]>;
  private builderTitleChecked = false;
  private hasUnsavedChanges = false;
  private activeWorkspacePage = "overview";
  private selectedMenuId = "";
  /** Prevent Home Assistant's echo of a normal Save Dash from redrawing this editor. */
  private preserveEditorOnNextConfig = false;
  setConfig(config: any) {
    const preserveEditor = this.preserveEditorOnNextConfig;
    this.preserveEditorOnNextConfig = false;
    this.config = { ...config };
    if (!this.selectedProfileId && this.config.active_profile_id) this.selectedProfileId = String(this.config.active_profile_id);
    this.hasUnsavedChanges = false;
    if (!preserveEditor) this.render();
  }
  getCurrentConfig(): any {
    const root = this.shadowRoot;
    if (!root) return this.config;
    const menus = Array.from(root.querySelectorAll<HTMLElement>("[data-menu-card]")).map((card, index) => {
      const id = card.dataset.menuCard || `menu-${index + 1}`;
      const existing = (this.config.menus || []).find((menu: any) => menu.id === id);
      const selected = (selector: string, previous: string[] = []) => {
        const inputs = Array.from(card.querySelectorAll<HTMLInputElement>(selector));
        const visibleIds = new Set(inputs.map((input) => input.value));
        return [...previous.filter((entity) => !visibleIds.has(entity)), ...inputs.filter((input) => input.checked).map((input) => input.value)];
      };
      return {
        id,
        label: card.querySelector<HTMLInputElement>("[data-menu-label]")?.value.trim() || `Menu ${index + 1}`,
        icon: card.querySelector<HTMLInputElement>("[data-menu-icon]")?.value.trim() || "",
        icon_entity: card.querySelector<HTMLInputElement>("[data-menu-icon-entity]")?.value.trim() || "",
        icon_placement: card.querySelector<HTMLSelectElement>("[data-menu-icon-placement]")?.value === "center" ? "center" : card.querySelector<HTMLSelectElement>("[data-menu-icon-placement]")?.value === "right" ? "right" : "left",
        cameras: selected("[data-menu-camera]", existing?.cameras),
        lights: selected("[data-menu-light]", existing?.lights),
        temperatures: selected("[data-menu-temperature]", existing?.temperatures),
        action: card.querySelector<HTMLSelectElement>("[data-menu-action]")?.value === "navigate" ? "navigate" : "view",
        destination: card.querySelector<HTMLSelectElement>("[data-menu-destination]")?.value === "__custom__"
          ? card.querySelector<HTMLInputElement>("[data-menu-custom-destination]")?.value.trim() || ""
          : card.querySelector<HTMLSelectElement>("[data-menu-destination]")?.value || "",
        source: card.querySelector<HTMLSelectElement>("[data-menu-source]")?.value === "lovelace_card" ? "lovelace_card" : "menu",
        lovelace_card_ids: Array.from(card.querySelectorAll<HTMLInputElement>("[data-menu-lovelace-card]:checked"), (input) => input.value),
        lovelace_card_layouts: existing?.lovelace_card_layouts || {},
        content_overflow: card.querySelector<HTMLSelectElement>("[data-menu-content-overflow]")?.value === "scroll" ? "scroll" : "fit",
      };
    });
    const cameraOrder = Array.from(root.querySelectorAll<HTMLSelectElement>("[data-order]"))
      .sort((a, b) => Number(a.value) - Number(b.value)).map((select) => select.dataset.order || "");
    const cameraOverlays = { ...(this.config.camera_overlays || {}) };
    root.querySelectorAll<HTMLInputElement>("[data-overlay-show]").forEach((input) => {
      const entity = input.dataset.overlayShow || "";
      cameraOverlays[entity] = {
        show: input.checked,
        horizontal: root.querySelector<HTMLSelectElement>(`[data-overlay-h="${entity}"]`)?.value || "left",
        vertical: root.querySelector<HTMLSelectElement>(`[data-overlay-v="${entity}"]`)?.value || "bottom",
      };
    });
    const cameraSpans = { ...(this.config.camera_spans || {}) };
    root.querySelectorAll<HTMLSelectElement>("[data-span]").forEach((select) => { cameraSpans[select.dataset.span || ""] = Number(select.value); });
    const cameraRefreshIntervals = { ...(this.config.camera_refresh_intervals || {}) };
    root.querySelectorAll<HTMLSelectElement>("[data-camera-refresh]").forEach((select) => {
      const entity = select.dataset.cameraRefresh || "";
      if (Number(select.value) > 0) cameraRefreshIntervals[entity] = Number(select.value);
      else delete cameraRefreshIntervals[entity];
    });
    const detectionTypes = Array.from(root.querySelectorAll<HTMLElement>("[data-detection-type]")).map((card, index) => ({
      id: card.dataset.detectionType || `detection-${index + 1}`,
      label: card.querySelector<HTMLInputElement>("[data-detection-label]")?.value.trim() || `Detection ${index + 1}`,
      match: card.querySelector<HTMLInputElement>("[data-detection-match]")?.value.trim() || "",
      animation: card.querySelector<HTMLSelectElement>("[data-detection-animation]")?.value || "soft-pulse",
      color: card.querySelector<HTMLInputElement>("[data-detection-color]")?.value || "#ffc107",
      show_badge: card.querySelector<HTMLInputElement>("[data-detection-badge]")?.checked === true,
      badge_text: card.querySelector<HTMLInputElement>("[data-detection-badge-text]")?.value.trim() || "",
    }));
    const cameraDetections: Record<string, any[]> = {};
    root.querySelectorAll<HTMLSelectElement>("[data-camera-detection]").forEach((select) => {
      if (!select.value) return;
      const [camera, typeId] = String(select.dataset.cameraDetection || "").split("::");
      if (!camera || !typeId) return;
      (cameraDetections[camera] ||= []).push({ id: typeId, type_id: typeId, entity: select.value });
    });
    const menuToggles = Array.from(root.querySelectorAll<HTMLElement>("[data-toggle-card]")).map((card, index) => ({
      id: card.dataset.toggleCard || `toggle-${index + 1}`,
      label: card.querySelector<HTMLInputElement>("[data-toggle-label]")?.value.trim() || `Toggle ${index + 1}`,
      on_label: card.querySelector<HTMLInputElement>("[data-toggle-on-label]")?.value.trim() || "",
      off_label: card.querySelector<HTMLInputElement>("[data-toggle-off-label]")?.value.trim() || "",
      icon: card.querySelector<HTMLInputElement>("[data-toggle-icon]")?.value.trim() || "",
      icon_entity: card.querySelector<HTMLInputElement>("[data-toggle-icon-entity]")?.value.trim() || "",
      icon_placement: card.querySelector<HTMLSelectElement>("[data-toggle-icon-placement]")?.value === "center" ? "center" : card.querySelector<HTMLSelectElement>("[data-toggle-icon-placement]")?.value === "right" ? "right" : "left",
      state_entity: card.querySelector<HTMLSelectElement>("[data-toggle-state]")?.value || "",
      placement: card.querySelector<HTMLSelectElement>("[data-toggle-placement]")?.value === "right" ? "right" : "left",
      order: Number(card.querySelector<HTMLSelectElement>("[data-toggle-order]")?.value || index + 1),
      active_color: card.querySelector<HTMLInputElement>("[data-toggle-color]")?.value.trim() || "#2e9d5b",
      type: card.querySelector<HTMLSelectElement>("[data-toggle-type]")?.value === "automation" ? "automation" : "script",
      on_target: card.querySelector<HTMLSelectElement>("[data-toggle-on-target]")?.value || "",
      off_target: card.querySelector<HTMLSelectElement>("[data-toggle-off-target]")?.value || "",
      subtitle: card.querySelector<HTMLInputElement>("[data-toggle-subtitle]")?.value.trim() || "",
      confirm: card.querySelector<HTMLInputElement>("[data-toggle-confirm]")?.checked === true,
      off_long_press: card.querySelector<HTMLInputElement>("[data-toggle-long-press]")?.checked === true,
      hide_unavailable: card.querySelector<HTMLInputElement>("[data-toggle-hide-unavailable]")?.checked === true,
      on_service: card.querySelector<HTMLInputElement>("[data-toggle-on-service]")?.value.trim() || "",
      on_service_data: card.querySelector<HTMLInputElement>("[data-toggle-on-data]")?.value.trim() || "",
      off_service: card.querySelector<HTMLInputElement>("[data-toggle-off-service]")?.value.trim() || "",
      off_service_data: card.querySelector<HTMLInputElement>("[data-toggle-off-data]")?.value.trim() || "",
      sync_state: card.querySelector<HTMLInputElement>("[data-toggle-sync]")?.checked !== false,
    }));
    const menuStatuses = Array.from(root.querySelectorAll<HTMLElement>("[data-status-card]")).map((card, index) => ({
      id: card.dataset.statusCard || `status-${index + 1}`,
      label: card.querySelector<HTMLInputElement>("[data-status-label]")?.value.trim() || "",
      icon: card.querySelector<HTMLInputElement>("[data-status-icon]")?.value.trim() || "",
      icon_entity: card.querySelector<HTMLInputElement>("[data-status-icon-entity]")?.value.trim() || "",
      type: card.querySelector<HTMLSelectElement>("[data-status-type]")?.value === "time" ? "time" : "entity",
      time_format: card.querySelector<HTMLSelectElement>("[data-status-time-format]")?.value === "24" ? "24" : "12",
      entity: card.querySelector<HTMLSelectElement>("[data-status-entity]")?.value || "",
      placement: card.querySelector<HTMLSelectElement>("[data-status-placement]")?.value === "right" ? "right" : "left",
      alignment: card.querySelector<HTMLSelectElement>("[data-status-alignment]")?.value === "center" ? "center" : card.querySelector<HTMLSelectElement>("[data-status-alignment]")?.value === "right" ? "right" : "left",
      order: Number(card.querySelector<HTMLSelectElement>("[data-status-order]")?.value || index + 1),
      action: card.querySelector<HTMLSelectElement>("[data-status-action]")?.value === "navigate" ? "navigate" : card.querySelector<HTMLSelectElement>("[data-status-action]")?.value === "service" ? "service" : "none",
      destination: card.querySelector<HTMLInputElement>("[data-status-destination]")?.value.trim() || "",
      service: card.querySelector<HTMLInputElement>("[data-status-service]")?.value.trim() || "",
    }));
    return {
      ...this.config,
      menus,
      menu_toggles: normaliseMenuToggles(menuToggles),
      menu_statuses: menuStatuses,
      camera_order: cameraOrder,
      camera_overlays: cameraOverlays,
      camera_spans: cameraSpans,
      camera_refresh_interval: Math.max(100, Number(root.querySelector<HTMLSelectElement>("#camera-refresh-default")?.value || this.config.camera_refresh_interval || 3000)),
      camera_refresh_intervals: cameraRefreshIntervals,
      detection_types: detectionTypes,
      camera_detections: cameraDetections,
      echo_target: root.querySelector<HTMLSelectElement>("#echo-target")?.value || "",
      echo_mode: root.querySelector<HTMLSelectElement>("#echo-mode")?.value || "Streamed",
      echo_dashboard_when_idle: root.querySelector<HTMLInputElement>("#echo-idle")?.checked || false,
      kiosk_mode: kioskModeSetting(root.querySelector<HTMLSelectElement>("#kiosk-mode")?.value, this.config.echo_managed ? "enabled" : "inherit"),
    };
  }
  getConfigForSave(): any {
    const config = this.getCurrentConfig();
    const previous = (this.config.saved_profiles || []).find((profile: EchoSavedDashboardProfile) => profile.id === this.selectedProfileId);
    if (!previous) return config;
    const profile: EchoSavedDashboardProfile = {
      ...previous,
      menus: config.menus || [],
      settings: dashSettings(config),
    };
    return {
      ...config,
      saved_profiles: [...(this.config.saved_profiles || []).filter((item: any) => item.id !== profile.id), profile],
      active_profile_id: profile.id,
    };
  }
  set hass(value: Hass) {
    const firstHass = !this._hass;
    this._hass = value;
    if (firstHass && !this.shadowRoot?.querySelector("[data-menu-card]")) this.render();
    if (!this.managedDashboardsLoaded && !this.managedDashboardsLoading) void this.loadManagedDashboards();
    if (!this.dashboardDestinationsLoaded && !this.dashboardDestinationsLoading) void this.loadDashboardDestinations();
    if (!this.areaRegistryLoaded && !this.areaRegistryLoading) void this.loadAreaRegistry();
    if (!this.builderTitleChecked) void this.ensureBuilderTitle();
  }
  connectedCallback() { this.render(); }
  private emit(patch: Record<string, unknown>, rerender = true) {
    this.config = { ...this.config, ...patch };
    this.hasUnsavedChanges = true;
    // When rendered as the master builder page, persistence is handled by the
    // builder's own WebSocket save. Sending Home Assistant's editor event here
    // makes it try to reinterpret this card as a dashboard strategy.
    if (!this.config.builder_standalone) this.dispatchEvent(new CustomEvent("config-changed", { bubbles: true, composed: true, detail: { config: this.config } }));
    if (rerender) this.render();
  }
  private emitCurrentConfig() {
    this.config = this.getCurrentConfig();
    this.hasUnsavedChanges = true;
    if (!this.config.builder_standalone) this.dispatchEvent(new CustomEvent("config-changed", { bubbles: true, composed: true, detail: { config: this.config } }));
  }
  private callWS(message: Record<string, unknown>): Promise<any> {
    if (this._hass?.callWS) return this._hass.callWS(message);
    if (this._hass?.connection?.sendMessagePromise) return this._hass.connection.sendMessagePromise(message);
    return Promise.reject(new Error("Home Assistant dashboard management is unavailable."));
  }
  private async ensureBuilderTitle() {
    this.builderTitleChecked = true;
    const urlPath = window.location.pathname.split("/").filter(Boolean)[0];
    const wantedBuilderPath = "echo-show-dash-builder";
    const legacyBuilderPath = "echo-show-html-dash-builder";
    if (urlPath === legacyBuilderPath) {
      try {
        const dashboards = await this.callWS({ type: "lovelace/dashboards/list" });
        if (!Array.isArray(dashboards)) return;
        if (!dashboards.some((item: any) => String(item.url_path) === wantedBuilderPath)) {
          const source = await this.callWS({ type: "lovelace/config", url_path: legacyBuilderPath });
          await this.callWS({ type: "lovelace/dashboards/create", url_path: wantedBuilderPath, title: "Echo Show Dash Builder", show_in_sidebar: true, require_admin: false });
          await this.callWS({ type: "lovelace/config/save", url_path: wantedBuilderPath, config: source });
        }
        const old = dashboards.find((item: any) => String(item.url_path) === legacyBuilderPath);
        if (old?.id) await this.callWS({ type: "lovelace/dashboards/delete", dashboard_id: old.id });
        window.location.assign(`/${wantedBuilderPath}/home`);
      } catch {
        // The manual move control remains available if this session cannot delete dashboards.
      }
      return;
    }
    if (urlPath !== wantedBuilderPath) return;
    const title = "Echo Show Dash Builder";
    try {
      const dashboards = await this.callWS({ type: "lovelace/dashboards/list" });
      const dashboard = Array.isArray(dashboards) ? dashboards.find((item: any) => String(item.url_path) === urlPath) : undefined;
      if (dashboard?.id && dashboard.title !== title) {
        await this.callWS({ type: "lovelace/dashboards/update", dashboard_id: dashboard.id, title, icon: dashboard.icon || null, show_in_sidebar: dashboard.show_in_sidebar !== false, require_admin: dashboard.require_admin === true });
      }
      const config = await this.callWS({ type: "lovelace/config", url_path: urlPath });
      if ((config?.strategy?.type === "custom:echo-show" || config?.strategy?.type === "custom:echo-show-editor") && (config.strategy.title !== title || config.strategy.type !== "custom:echo-show" || config.strategy.echo_managed !== false)) {
        await this.callWS({ type: "lovelace/config/save", url_path: urlPath, config: { strategy: { ...config.strategy, type: "custom:echo-show", title, echo_managed: false } } });
      }
    } catch {
      // The editor remains usable if the title can only be changed by an admin.
    }
  }
  private async persistBuilderConfig(config: any): Promise<void> {
    const masterUrlPath = window.location.pathname.split("/").filter(Boolean)[0];
    if (!masterUrlPath) throw new Error("Could not identify this builder dashboard to save the current setup.");
    const masterDashboard = await this.callWS({ type: "lovelace/config", url_path: masterUrlPath });
    if (masterDashboard?.strategy?.type !== "custom:echo-show" || masterDashboard.strategy.echo_managed) {
      throw new Error("This setup can only be saved from the Echo dashboard builder.");
    }
    await this.callWS({
      type: "lovelace/config/save",
      url_path: masterUrlPath,
      config: { strategy: { ...masterDashboard.strategy, ...config, echo_managed: false } },
    });
  }
  private newCardId(): string {
    return typeof crypto?.randomUUID === "function"
      ? `lovelace-${crypto.randomUUID()}`
      : `lovelace-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  private async createCardHolder(): Promise<string> {
    const current = String(this.config.card_holder_url_path || "");
    const dashboards = await this.callWS({ type: "lovelace/dashboards/list" });
    const existing = Array.isArray(dashboards) ? dashboards.find((item: any) => item.url_path === current || item.url_path === "echo-show-custom-card-holder") : undefined;
    if (existing?.url_path) return String(existing.url_path);
    const urlPath = "echo-show-custom-card-holder";
    const created = await this.callWS({ type: "lovelace/dashboards/create", url_path: urlPath, title: "Echo Show Custom Card Holder", show_in_sidebar: false, require_admin: false });
    await this.callWS({ type: "lovelace/config/save", url_path: String(created.url_path || urlPath), config: {
      title: "Echo Show Custom Card Holder",
      views: [{ title: "Cards", path: "cards", cards: [] }],
    } });
    return String(created.url_path || urlPath);
  }
  private async syncCardLibrary(holderPath: string): Promise<EchoCardLibraryEntry[]> {
    const holder = await this.callWS({ type: "lovelace/config", url_path: holderPath });
    const cards: HolderCard[] = [];
    (Array.isArray(holder?.views) ? holder.views : []).forEach((view: any, viewIndex: number) => {
      (Array.isArray(view?.cards) ? view.cards : []).forEach((config: any, position: number) => {
        if (config && typeof config === "object") cards.push({ config, view_path: String(view.path || viewIndex), position });
      });
    });
    return reconcileCardLibrary(Array.isArray(this.config.card_library) ? this.config.card_library : [], cards, holderPath, () => this.newCardId());
  }
  private async resolveLovelaceCards(config: any, menus: EchoMenuConfig[]): Promise<Record<string, Record<string, unknown>>> {
    const selectedIds = new Set(menus.flatMap((menu) => menu.source === "lovelace_card"
      ? (Array.isArray(menu.lovelace_card_ids) && menu.lovelace_card_ids.length ? menu.lovelace_card_ids : menu.lovelace_card_id ? [menu.lovelace_card_id] : []) : []).map(String));
    if (!selectedIds.size) return {};
    const holderPath = String(config.card_holder_url_path || "");
    if (!holderPath) throw new Error("Open the Custom Card Holder and sync its card library before applying this setup.");
    const holder = await this.callWS({ type: "lovelace/config", url_path: holderPath });
    const cards: Record<string, unknown>[] = [];
    (Array.isArray(holder?.views) ? holder.views : []).forEach((view: any) => (Array.isArray(view?.cards) ? view.cards : []).forEach((card: any) => {
      if (card && typeof card === "object") cards.push(card);
    }));
    const library: EchoCardLibraryEntry[] = Array.isArray(config.card_library) ? config.card_library : [];
    const resolved: Record<string, Record<string, unknown>> = {};
    for (const id of selectedIds) {
      const entry = library.find((item) => item.id === id);
      const card = entry && cards.find((item) => cardFingerprint(item) === entry.fingerprint);
      if (!entry || entry.missing || !card) throw new Error(`The selected Lovelace Card (${entry?.name || id}) is missing from the Custom Card Holder.`);
      resolved[id] = card;
    }
    return resolved;
  }
  private async loadManagedDashboards() {
    this.managedDashboardsLoading = true;
    try {
      const dashboards = await this.callWS({ type: "lovelace/dashboards/list" });
      const storageDashboards = (Array.isArray(dashboards) ? dashboards : []).filter((dashboard: any) => dashboard.mode === "storage" && dashboard.id && dashboard.url_path);
      const managed = await Promise.all(storageDashboards.map(async (dashboard: any) => {
        try {
          const saved = await this.callWS({ type: "lovelace/config", url_path: dashboard.url_path });
          const strategy = saved?.strategy;
          return strategy?.type === "custom:echo-show" && strategy.echo_managed === true
            ? { id: String(dashboard.id), title: String(dashboard.title || dashboard.url_path), url_path: String(dashboard.url_path), target: String(strategy.echo_target || "") }
            : null;
        } catch { return null; }
      }));
      this.managedDashboards = managed.filter((dashboard): dashboard is { id: string; title: string; url_path: string; target: string } => Boolean(dashboard));
      this.managedDashboardsLoaded = true;
      this.managedDashboardsError = "";
    } catch (error) {
      this.managedDashboardsError = String(error);
    } finally {
      this.managedDashboardsLoading = false;
    }
    this.render();
  }
  private async loadDashboardDestinations() {
    this.dashboardDestinationsLoading = true;
    try {
      const dashboards = await this.callWS({ type: "lovelace/dashboards/list" });
      const listed = Array.isArray(dashboards) ? dashboards : [];
      this.standardDashboards = [{ title: "Overview", url_path: "lovelace" }, ...listed
        .filter((dashboard: any) => dashboard?.url_path && String(dashboard.url_path) !== "echo-show-dash-builder")
        .map((dashboard: any) => ({ title: String(dashboard.title || dashboard.url_path), url_path: String(dashboard.url_path) }))]
        .filter((dashboard, index, array) => array.findIndex((item) => item.title === dashboard.title) === index)
        .sort((a, b) => a.title.localeCompare(b.title));
      const destinations: DashboardDestination[] = [{ path: "/lovelace/0", label: "Overview — /lovelace/0" }];
      for (const dashboard of listed) {
        const urlPath = String(dashboard?.url_path || "").trim();
        if (!urlPath) continue;
        const title = String(dashboard?.title || urlPath);
        try {
          const config = await this.callWS({ type: "lovelace/config", url_path: urlPath });
          const views = Array.isArray(config?.views) ? config.views : [];
          if (views.length) {
            views.forEach((view: any, index: number) => {
              const viewPath = String(view?.path || index);
              destinations.push({ path: `/${urlPath}/${viewPath}`, label: `${title} — ${String(view?.title || viewPath)} — /${urlPath}/${viewPath}` });
            });
          } else {
            destinations.push({ path: `/${urlPath}/0`, label: `${title} — /${urlPath}/0` });
          }
        } catch {
          destinations.push({ path: `/${urlPath}/0`, label: `${title} — /${urlPath}/0` });
        }
      }
      this.dashboardDestinations = Array.from(new Map(destinations.map((item) => [item.path, item])).values())
        .sort((a, b) => a.label.localeCompare(b.label));
      this.dashboardDestinationsError = "";
    } catch (error) {
      this.dashboardDestinationsError = String(error);
    } finally {
      this.dashboardDestinationsLoading = false;
      this.dashboardDestinationsLoaded = true;
    }
    this.render();
  }
  private async loadAreaRegistry() {
    this.areaRegistryLoading = true;
    try {
      const [areas, entities, devices] = await Promise.all([
        this.callWS({ type: "config/area_registry/list" }),
        this.callWS({ type: "config/entity_registry/list" }),
        this.callWS({ type: "config/device_registry/list" }),
      ]);
      this.areas = (Array.isArray(areas) ? areas : [])
        .filter((area: any) => area?.area_id)
        .map((area: any) => ({ area_id: String(area.area_id), name: String(area.name || area.area_id) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const deviceAreas = new Map<string, string>();
      for (const device of Array.isArray(devices) ? devices : []) {
        if (device?.id && device?.area_id) deviceAreas.set(String(device.id), String(device.area_id));
      }
      this.entityAreas = {};
      for (const entity of Array.isArray(entities) ? entities : []) {
        if (!entity?.entity_id) continue;
        const areaId = entity.area_id || (entity.device_id ? deviceAreas.get(String(entity.device_id)) : "");
        if (areaId) this.entityAreas[String(entity.entity_id)] = String(areaId);
      }
      this.areaRegistryLoaded = true;
      this.areaRegistryError = "";
    } catch (error) {
      this.areaRegistryError = String(error);
    } finally {
      this.areaRegistryLoading = false;
    }
    this.render();
  }
  private targets(): EchoTarget[] {
    const states = this._hass?.states || {};
    const dashboardEntities = Object.keys(states).filter((entity) => entity.startsWith("select.") && entity.endsWith("_dashboard_to_show"));
    return dashboardEntities.map((dashboardToShow) => {
      const key = dashboardToShow.slice("select.".length, -"_dashboard_to_show".length);
      const dashboard = `select.${key}_dashboard`;
      const idle = `switch.${key}_dashboard_when_idle`;
      const friendly = String(states[dashboardToShow]?.attributes?.friendly_name || key.replace(/_/g, " "));
      return { key, label: friendly.replace(/ dashboard to show$/i, ""), dashboard, dashboardToShow, idle };
    }).filter((target) => states[target.dashboard] || states[target.dashboardToShow]);
  }
  private async loadMdiIconNames(): Promise<string[]> {
    if (this.mdiIconNames.length) return this.mdiIconNames;
    if (!this.mdiIconLoad) this.mdiIconLoad = fetch("https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.css")
      .then((response) => response.ok ? response.text() : "")
      .then((css) => Array.from(css.matchAll(/\.mdi-([a-z0-9-]+)::?before/g), (match) => `mdi:${match[1]}`))
      .then((names) => [...new Set(names)].sort())
      .catch(() => []);
    this.mdiIconNames = await this.mdiIconLoad;
    return this.mdiIconNames;
  }
  private render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const root = this.shadowRoot!;
    const currentConfig = this.getCurrentConfig();
    root.querySelectorAll<HTMLElement>("[data-menu-card]").forEach((card) => {
      const id = card.dataset.menuCard || "";
      EchoShowEditor.openMenuCards[id] = card.hasAttribute("open");
      EchoShowEditor.openMenuPickers[id] = Array.from(card.querySelectorAll<HTMLDetailsElement>("details.content-picker"), (picker) => picker.open);
      card.querySelectorAll<HTMLDetailsElement>("details[data-camera-appearance]").forEach((settings) => {
        EchoShowEditor.openCameraSettings[settings.dataset.cameraAppearance || ""] = settings.open;
      });
    });
    const cameras = this._hass ? listAvailableCameras(this._hass) : [];
    const lights = Object.values(this._hass?.states || {}).filter((state: any) => String(state.entity_id).startsWith("light.")).sort((a: any, b: any) => String(a.attributes?.friendly_name || a.entity_id).localeCompare(String(b.attributes?.friendly_name || b.entity_id)));
    const temperatures = Object.values(this._hass?.states || {}).filter((state: any) => {
      const entity = String(state.entity_id || "");
      const name = String(state.attributes?.friendly_name || "");
      const searchableName = `${entity} ${name}`.replace(/[_-]+/g, " ");
      const hasTemperatureWord = /(^|\s)temperature(\s|$)/i.test(searchableName);
      const hasTempWord = /(^|\s)temp(\s|$)/i.test(searchableName);
      const looksLikeCompanionSensor = /(^|\s)(battery|humidity|voltage|time|attempted)(\s|$)/i.test(searchableName);
      return entity.startsWith("sensor.") && (state.attributes?.device_class === "temperature" || hasTemperatureWord || (hasTempWord && !looksLikeCompanionSensor));
    }).sort((a: any, b: any) => String(a.attributes?.friendly_name || a.entity_id).localeCompare(String(b.attributes?.friendly_name || b.entity_id)));
    const menuProfiles = getMenuProfiles(this.config, cameras, lights, temperatures);
    const menuToggles = normaliseMenuToggles(this.config.menu_toggles);
    const menuStatuses: EchoMenuStatusConfig[] = Array.isArray(this.config.menu_statuses) ? this.config.menu_statuses : [];
    const toggleEntities = Object.values(this._hass?.states || {}).filter((state: any) => /^(input_boolean|switch)\./.test(String(state.entity_id || ""))).sort((a: any, b: any) => String(a.attributes?.friendly_name || a.entity_id).localeCompare(String(b.attributes?.friendly_name || b.entity_id)));
    const scripts = Object.values(this._hass?.states || {}).filter((state: any) => String(state.entity_id || "").startsWith("script.")).sort((a: any, b: any) => String(a.attributes?.friendly_name || a.entity_id).localeCompare(String(b.attributes?.friendly_name || b.entity_id)));
    const automations = Object.values(this._hass?.states || {}).filter((state: any) => String(state.entity_id || "").startsWith("automation.")).sort((a: any, b: any) => String(a.attributes?.friendly_name || a.entity_id).localeCompare(String(b.attributes?.friendly_name || b.entity_id)));
    const savedProfiles: EchoSavedDashboardProfile[] = Array.isArray(this.config.saved_profiles) ? this.config.saved_profiles : [];
    const overlays = this.config.camera_overlays || {};
    const spans = this.config.camera_spans || {};
    const cameraRefreshIntervals = this.config.camera_refresh_intervals || {};
    const detectionTypes: Array<any> = Array.isArray(this.config.detection_types) && this.config.detection_types.length ? this.config.detection_types : [
      { id: "person", label: "Person", match: "person", animation: "soft-pulse", color: "#ffc107", show_badge: false, badge_text: "Person" },
      { id: "dog", label: "Dog", match: "dog", animation: "soft-pulse", color: "#7e57c2", show_badge: true, badge_text: "Dog" },
    ];
    // Preserve earlier per-camera person selections while presenting the new
    // multi-type editor. Saving without touching them must not remove alerts.
    const cameraDetections = { ...(this.config.camera_detections || {}) } as Record<string, any[]>;
    for (const [camera, entity] of Object.entries(this.config.camera_person_entities || {})) {
      if (!cameraDetections[camera]?.length && entity) cameraDetections[camera] = [{ id: "person", type_id: "person", entity }];
    }
    const entityOptionLabel = (state: any) => {
      const name = String(state?.attributes?.friendly_name || state?.entity_id || "");
      const value = String(state?.state ?? "unknown");
      const unit = String(state?.attributes?.unit_of_measurement || "").trim();
      return `${name} — ${value}${unit ? ` ${unit}` : ""} — ${String(state?.entity_id || "")}`;
    };
    const cameraRefreshInterval = Math.max(100, Number(this.config.camera_refresh_interval || this.config.refresh_interval || 3000));
    const configuredOrder: string[] = Array.isArray(this.config.camera_order) ? this.config.camera_order : [];
    const cameraOrder = [...configuredOrder.filter((entity) => cameras.some((camera) => camera.entityId === entity)), ...cameras.filter((camera) => !configuredOrder.includes(camera.entityId)).map((camera) => camera.entityId)];
    const orderedCameras = [...cameras].sort((a, b) => cameraOrder.indexOf(a.entityId) - cameraOrder.indexOf(b.entityId));
    const cameraAppearance = (camera: { entityId: string; label: string }, menuId: string) => {
      const o = overlays[camera.entityId] || {};
      const span = Math.max(1, Math.min(3, Number(spans[camera.entityId]) || 1));
      const refreshOverride = Number(cameraRefreshIntervals[camera.entityId]) || 0;
      const position = cameraOrder.indexOf(camera.entityId) + 1;
      const stateKey = `${menuId}::${camera.entityId}`;
      const settingsOpen = EchoShowEditor.openCameraSettings[stateKey] ?? false;
      const cameraArea = this.entityAreas[camera.entityId] || "";
      const cameraWords = `${camera.entityId} ${camera.label}`.toLowerCase().replace(/[_-]+/g, " ").split(/\s+/).filter((word) => word.length > 2 && !["camera"].includes(word));
      const detectionOptions = (type: any) => Object.values(this._hass?.states || {}).filter((state: any) => {
        const entity = String(state.entity_id || "");
        const text = `${entity} ${state.attributes?.friendly_name || ""}`.toLowerCase().replace(/[_-]+/g, " ");
        const typeWords = String(type.match || type.label || "").toLowerCase().replace(/[_-]+/g, " ").split(/\s+/).filter(Boolean);
        const supportedSignal = entity.startsWith("binary_sensor.") || (entity.startsWith("sensor.") && /(active\s+)?count|occupancy/i.test(text));
        return supportedSignal && typeWords.some((word) => text.includes(word)) && (cameraArea ? this.entityAreas[entity] === cameraArea : cameraWords.some((word) => text.includes(word)));
      }).sort((a: any, b: any) => String(a.attributes?.friendly_name || a.entity_id).localeCompare(String(b.attributes?.friendly_name || b.entity_id)));
      const detectionRows = detectionTypes.map((type) => {
        const choices = detectionOptions(type); const current = (cameraDetections[camera.entityId] || []).find((item: any) => item.type_id === type.id)?.entity || "";
        return `<label>${escapeHtml(type.label)} entity <select data-camera-detection="${escapeHtml(`${camera.entityId}::${type.id}`)}"><option value="">No ${escapeHtml(type.label)} alert</option>${choices.map((state: any) => `<option value="${escapeHtml(state.entity_id)}" ${state.entity_id === current ? "selected" : ""}>${escapeHtml(entityOptionLabel(state))}</option>`).join("")}</select></label>`;
      }).join("");
      return `<details class="camera-appearance" data-camera-appearance="${escapeHtml(stateKey)}" ${settingsOpen ? "open" : ""}>
        <summary>Camera size, order &amp; overlay</summary>
        <div class="camera-settings-row"><label>Order <select data-order="${escapeHtml(camera.entityId)}">${orderedCameras.map((_, i) => `<option value="${i + 1}" ${position === i + 1 ? "selected" : ""}>${i + 1}</option>`).join("")}</select></label>
        <label>Show name <input type="checkbox" data-overlay-show="${escapeHtml(camera.entityId)}" ${o.show !== false ? "checked" : ""}></label>
        <label>Name position <select data-overlay-h="${escapeHtml(camera.entityId)}"><option value="left" ${o.horizontal === "left" || !o.horizontal ? "selected" : ""}>Left</option><option value="center" ${o.horizontal === "center" ? "selected" : ""}>Centre</option><option value="right" ${o.horizontal === "right" ? "selected" : ""}>Right</option></select></label>
        <label>Vertical position <select data-overlay-v="${escapeHtml(camera.entityId)}"><option value="top" ${o.vertical === "top" ? "selected" : ""}>Top</option><option value="bottom" ${o.vertical !== "top" ? "selected" : ""}>Bottom</option></select></label>
        <label>Tile width <select data-span="${escapeHtml(camera.entityId)}"><option value="1" ${span === 1 ? "selected" : ""}>1 box</option><option value="2" ${span === 2 ? "selected" : ""}>2 boxes</option><option value="3" ${span === 3 ? "selected" : ""}>3 boxes</option></select></label>
        <label>Image refresh <select data-camera-refresh="${escapeHtml(camera.entityId)}"><option value="0" ${refreshOverride === 0 ? "selected" : ""}>Use default (${cameraRefreshInterval < 1000 ? `${cameraRefreshInterval} ms` : `${cameraRefreshInterval / 1000}s`})</option>${[100, 250, 500, 1000, 2000, 3000, 5000, 10000, 15000].map((value) => `<option value="${value}" ${refreshOverride === value ? "selected" : ""}>${value === 100 ? "100 ms (10 fps, maximum load)" : value === 250 ? "250 ms (4 fps, high load)" : value === 500 ? "500 ms (2 fps)" : `${value / 1000}s`}</option>`).join("")}</select></label>${detectionRows}</div>
        <div class="hint">These settings apply wherever this camera is used.</div></details>`;
    };
    const targets = this.targets();
    const selectedTarget = String(this.config.echo_target || "");
    const selectedProfileId = String(this.selectedProfileId || this.config.active_profile_id || "");
    const cardLibrary: EchoCardLibraryEntry[] = Array.isArray(this.config.card_library) ? this.config.card_library : [];
    const dependencyIssues = cardLibrary.filter((card) => card.missing).map((card) => `${card.name} (${card.card_type})`);
    const readinessItems = [
      { label: "Dash selected", ok: Boolean(selectedProfileId) },
      { label: "Echo selected", ok: Boolean(selectedTarget) },
      { label: "Menus configured", ok: menuProfiles.length > 0 },
      { label: "Card library ready", ok: dependencyIssues.length === 0 },
    ];
    const activeTarget = targets.find((target) => target.key === selectedTarget);
    const selectedMode = String(this.config.echo_mode || (activeTarget ? this._hass?.states[activeTarget.dashboard]?.state : "") || "Streamed");
    const selectedIdle = this.config.echo_dashboard_when_idle === undefined
      ? Boolean(activeTarget && this._hass?.states[activeTarget.idle]?.state === "on")
      : Boolean(this.config.echo_dashboard_when_idle);
    const selectedKioskMode = kioskModeSetting(this.config.kiosk_mode, this.config.echo_managed ? "enabled" : "inherit");
    const builderPath = window.location.pathname.split("/").filter(Boolean)[0] || "";
    const wantedBuilderPath = "echo-show-dash-builder";
    const toggleEditors = menuToggles.map((toggle) => {
      const placement = toggle.placement === "right" ? "right" : "left";
      const group = menuToggles.filter((item) => (item.placement === "right" ? "right" : "left") === placement);
      const position = group.findIndex((item) => item.id === toggle.id) + 1;
      const kind = toggle.type === "automation" ? "automation" : "script";
      const actionTargets = kind === "automation" ? automations : scripts;
      const actionName = kind === "automation" ? "automation" : "script";
      const targetOptions = (selected: string, placeholder: string) => `<option value="">${placeholder}</option>${actionTargets.map((state: any) => `<option value="${escapeHtml(state.entity_id)}" ${state.entity_id === selected ? "selected" : ""}>${escapeHtml(entityOptionLabel(state))}</option>`).join("")}`;
      const iconPlacement = toggle.icon_placement === "center" || toggle.icon_placement === "right" ? toggle.icon_placement : "left";
      return `<details class="toggle-config" data-toggle-card="${escapeHtml(toggle.id)}"><summary>${escapeHtml(toggle.label)} toggle</summary>
        <div class="row"><label>Button text <input type="text" data-toggle-label value="${escapeHtml(toggle.label)}"></label><label>Text when on <input type="text" data-toggle-on-label value="${escapeHtml(toggle.on_label)}" placeholder="Meeting mode on"></label><label>Text when off <input type="text" data-toggle-off-label value="${escapeHtml(toggle.off_label)}" placeholder="Meeting mode"></label></div>
        <div class="row"><label class="icon-field">Icon (optional)<span class="icon-control"><span class="icon-preview" data-toggle-icon-preview>${toggle.icon ? `<ha-icon icon="${escapeHtml(toggle.icon)}"></ha-icon>` : "No icon"}</span><input type="text" data-toggle-icon value="${escapeHtml(toggle.icon)}" placeholder="Leave blank for no icon"><details class="icon-picker"><summary>Choose icon</summary><input type="search" data-toggle-icon-search placeholder="Search all Material Design icons"><div class="icon-options">${MENU_ICON_CHOICES.map(([value, label]) => toggleIconChoiceMarkup(value, label)).join("")}</div><div class="icon-search-status hint"></div></details></span></label><label>Icon follows state (optional)<input type="text" data-toggle-icon-entity value="${escapeHtml(toggle.icon_entity || "")}" placeholder="weather.home"></label><label class="state-field">State entity <select data-toggle-state><option value="">Select a toggle/helper</option>${toggleEntities.map((state: any) => `<option value="${escapeHtml(state.entity_id)}" ${state.entity_id === toggle.state_entity ? "selected" : ""}>${escapeHtml(entityOptionLabel(state))}</option>`).join("")}</select></label><label class="colour-field">On colour <input type="color" data-toggle-color value="${escapeHtml(/^#[0-9a-f]{6}$/i.test(toggle.active_color || "") ? toggle.active_color : "#2e9d5b")}"></label><label>Subtitle (optional) <input type="text" data-toggle-subtitle value="${escapeHtml(toggle.subtitle)}" placeholder="Lights dimmed"></label></div>
        <div class="row"><label>Button placement <select data-toggle-placement><option value="left" ${placement === "left" ? "selected" : ""}>Left of menus</option><option value="right" ${placement === "right" ? "selected" : ""}>Right of menus</option></select></label><label>Icon placement <select data-toggle-icon-placement><option value="left" ${iconPlacement === "left" ? "selected" : ""}>Left</option><option value="center" ${iconPlacement === "center" ? "selected" : ""}>Middle</option><option value="right" ${iconPlacement === "right" ? "selected" : ""}>Right</option></select></label><label>Order <select data-toggle-order>${group.map((_, index) => `<option value="${index + 1}" ${position === index + 1 ? "selected" : ""}>${index + 1}</option>`).join("")}</select></label><label class="toggle-sync"><input type="checkbox" data-toggle-sync ${toggle.sync_state !== false ? "checked" : ""}> Update the state entity after the action</label></div>
        <div class="toggle-actions"><strong>Actions</strong><div class="row"><label>Button type <select data-toggle-type><option value="script" ${kind === "script" ? "selected" : ""}>Script toggle</option><option value="automation" ${kind === "automation" ? "selected" : ""}>Automation toggle</option></select></label><label>When turning on <select data-toggle-on-target>${targetOptions(toggle.on_target || "", `Select ${actionName}`)}</select></label><label>When turning off <select data-toggle-off-target>${targetOptions(toggle.off_target || "", `Select ${actionName}`)}</select></label></div><div class="row"><label class="toggle-sync"><input type="checkbox" data-toggle-confirm ${toggle.confirm ? "checked" : ""}> Confirm before changing</label><label class="toggle-sync"><input type="checkbox" data-toggle-long-press ${toggle.off_long_press ? "checked" : ""}> Hold 0.7s to turn off</label><label class="toggle-sync"><input type="checkbox" data-toggle-hide-unavailable ${toggle.hide_unavailable ? "checked" : ""}> Hide if the state entity is unavailable</label></div><div class="hint">Scripts run with <code>script.turn_on</code>; automations run with <code>automation.trigger</code>. The state entity controls the label and colour.</div></div>
        <button type="button" data-remove-toggle="${escapeHtml(toggle.id)}">Remove toggle</button>
      </details>`;
    }).join("");
    const statusEntities = Object.values(this._hass?.states || {}).sort((a:any,b:any)=>String(a.attributes?.friendly_name||a.entity_id).localeCompare(String(b.attributes?.friendly_name||b.entity_id)));
    const statusEditors = menuStatuses.map((status, index) => `<details class="toggle-config" data-status-card="${escapeHtml(status.id)}"><summary>${escapeHtml(status.label || (status.type === "time" ? "Time" : "Status display"))} status display</summary><div class="row"><label>Label <input type="text" data-status-label value="${escapeHtml(status.label || "")}" placeholder="Kitchen"></label><label>Icon <input type="text" data-status-icon value="${escapeHtml(status.icon || "")}" placeholder="mdi:thermometer"></label><label>Icon follows state (optional)<input type="text" data-status-icon-entity value="${escapeHtml(status.icon_entity || "")}" placeholder="weather.home"></label><label>Value type <select data-status-type><option value="time" ${status.type === "time" ? "selected" : ""}>Current time</option><option value="entity" ${status.type === "entity" ? "selected" : ""}>Entity state</option></select></label><label>Time display <select data-status-time-format ${status.type === "time" ? "" : "disabled"}><option value="12" ${status.time_format !== "24" ? "selected" : ""}>12-hour (Perth)</option><option value="24" ${status.time_format === "24" ? "selected" : ""}>24-hour (Perth)</option></select></label><label>Find entity <input type="search" data-status-entity-search placeholder="Type to filter by name"></label><label>Entity <select data-status-entity ${status.type === "time" ? "disabled" : ""}><option value="">Select an entity</option>${statusEntities.map((state:any)=>`<option value="${escapeHtml(state.entity_id)}" ${state.entity_id === status.entity ? "selected" : ""}>${escapeHtml(state.attributes?.friendly_name || state.entity_id)} — ${escapeHtml(state.entity_id)}</option>`).join("")}</select></label></div><div class="row"><label>Placement <select data-status-placement><option value="left" ${status.placement !== "right" ? "selected" : ""}>Left</option><option value="right" ${status.placement === "right" ? "selected" : ""}>Right</option></select></label><label>Order <select data-status-order><option value="${index + 1}" selected>${index + 1}</option></select></label><label>Tap action <select data-status-action><option value="none" ${!status.action || status.action === "none" ? "selected" : ""}>No action</option><option value="navigate" ${status.action === "navigate" ? "selected" : ""}>Navigate</option><option value="service" ${status.action === "service" ? "selected" : ""}>Run service</option></select></label><label>Destination / service <input type="text" data-status-destination value="${escapeHtml(status.destination || status.service || "")}" placeholder="/dashboard-home or script.example"></label></div><button type="button" data-remove-status="${escapeHtml(status.id)}">Remove status display</button></details>`).join("");
    const detectionEditors = detectionTypes.map((type: any) => `<details class="toggle-config" data-detection-type="${escapeHtml(type.id)}"><summary>${escapeHtml(type.label)} detection style</summary><div class="row"><label>Type name <input type="text" data-detection-label value="${escapeHtml(type.label)}"></label><label>Match words <input type="text" data-detection-match value="${escapeHtml(type.match || type.label)}" placeholder="person, dog, car"></label><label>Animation <select data-detection-animation><option value="solid" ${type.animation === "solid" ? "selected" : ""}>Solid glow</option><option value="soft-pulse" ${!type.animation || type.animation === "soft-pulse" ? "selected" : ""}>Soft pulse</option><option value="beacon" ${type.animation === "beacon" ? "selected" : ""}>Beacon pulse</option><option value="corner" ${type.animation === "corner" ? "selected" : ""}>Corner indicator</option><option value="glow-badge" ${type.animation === "glow-badge" ? "selected" : ""}>Glow plus badge</option><option value="none" ${type.animation === "none" ? "selected" : ""}>None</option></select></label><label class="colour-field">Glow colour <input type="color" data-detection-color value="${escapeHtml(/^#[0-9a-f]{6}$/i.test(type.color || "") ? type.color : "#ffc107")}"></label><label class="toggle-sync"><input type="checkbox" data-detection-badge ${type.show_badge ? "checked" : ""}> Show badge</label><label>Badge text <input type="text" data-detection-badge-text value="${escapeHtml(type.badge_text || type.label)}"></label></div><button type="button" data-remove-detection-type="${escapeHtml(type.id)}">Remove type</button></details>`).join("");
    const rememberedOpenMenuId = menuProfiles.find((menu) => EchoShowEditor.openMenuCards[menu.id])?.id || "";
    const menuEditors = menuProfiles.map((menu, index) => {
      const isLightsMenu = /lights?/i.test(menu.label);
      const pickerOpen = EchoShowEditor.openMenuPickers[menu.id] || [];
      const currentArea = this.menuAreaFilters[menu.id] || "";
      const matchesArea = (entityId: string) => currentArea === ""
        ? true
        : currentArea === "__no_area__"
          ? !this.entityAreas[entityId]
          : this.entityAreas[entityId] === currentArea;
      const menuCameras = cameras.filter((camera) => matchesArea(camera.entityId));
      const menuLights = lights.filter((light: any) => matchesArea(String(light.entity_id)));
      const menuTemperatures = temperatures.filter((sensor: any) => matchesArea(String(sensor.entity_id)));
      const areaSelect = `<label class="area-filter">Area filter <select data-menu-area><option value="" ${currentArea === "" ? "selected" : ""}>All areas</option><option value="__no_area__" ${currentArea === "__no_area__" ? "selected" : ""}>No area assigned</option>${this.areas.map((area) => `<option value="${escapeHtml(area.area_id)}" ${currentArea === area.area_id ? "selected" : ""}>${escapeHtml(area.name)}</option>`).join("")}</select></label>`;
      const destination = String(menu.destination || "");
      const destinationIsListed = this.dashboardDestinations.some((item) => item.path === destination);
      const destinationSelect = `<label>Dashboard/view <select data-menu-destination><option value="">Select a dashboard or view</option>${this.dashboardDestinations.map((item) => `<option value="${escapeHtml(item.path)}" ${item.path === destination ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}<option value="__custom__" ${destination && !destinationIsListed ? "selected" : ""}>Custom path…</option></select></label>`;
      const customDestination = destination && !destinationIsListed ? `<label>Custom path <input type="text" data-menu-custom-destination value="${escapeHtml(destination)}" placeholder="/lovelace/0"></label>` : "";
      const lovelaceCards = cardLibrary.filter((card) => !card.missing);
      const selectedCards = new Set(Array.isArray(menu.lovelace_card_ids) && menu.lovelace_card_ids.length ? menu.lovelace_card_ids : menu.lovelace_card_id ? [menu.lovelace_card_id] : []);
      const selectedCardIds = Array.from(selectedCards);
      const cardLayouts = cardLayoutsFor(selectedCardIds, menu.lovelace_card_layouts);
      const visualLayout = menu.source === "lovelace_card" && selectedCardIds.length ? `<div class="visual-layout" data-visual-layout-menu="${escapeHtml(menu.id)}"><strong>Arrange cards on the Echo</strong><p class="hint">Drag a card to move it. Use the buttons on a card to resize it. The preview uses the Echo grid and saves the layout immediately.</p><div class="visual-layout-grid">${[...selectedCardIds].sort((a, b) => (cardLayouts[a]?.order || 0) - (cardLayouts[b]?.order || 0)).map((id) => { const card = lovelaceCards.find((item) => item.id === id); const layout = cardLayouts[id] || { order: 1, width: 1, height: 1 }; return `<article class="visual-layout-item span-${layout.width} row-${layout.height}" draggable="true" data-layout-drag="${escapeHtml(id)}" title="Drag to move ${escapeHtml(card?.name || id)}"><span class="visual-layout-name">${escapeHtml(card?.name || id)}</span><span class="visual-layout-size">${layout.width} wide · ${layout.height} high</span><div class="visual-layout-actions"><button type="button" data-layout-resize="narrower" data-layout-card="${escapeHtml(id)}" aria-label="Make ${escapeHtml(card?.name || id)} narrower">−</button><button type="button" data-layout-resize="wider" data-layout-card="${escapeHtml(id)}" aria-label="Make ${escapeHtml(card?.name || id)} wider">+</button><button type="button" data-layout-resize="shorter" data-layout-card="${escapeHtml(id)}" aria-label="Make ${escapeHtml(card?.name || id)} shorter">−</button><button type="button" data-layout-resize="taller" data-layout-card="${escapeHtml(id)}" aria-label="Make ${escapeHtml(card?.name || id)} taller">+</button></div></article>`; }).join("")}</div><div class="hint">Width: −/+ · Height: −/+ · Drag cards to change their order.</div></div>` : "";
      const sourcePicker = menu.action === "navigate" ? "" : `<div class="row"><label>Button source <select data-menu-source><option value="menu" ${menu.source === "lovelace_card" ? "" : "selected"}>Menu content</option><option value="lovelace_card" ${menu.source === "lovelace_card" ? "selected" : ""}>Lovelace Cards</option></select></label></div>${menu.source === "lovelace_card" ? `<div class="card-picker"><strong>Cards in this menu</strong>${lovelaceCards.map((card) => {
        const selected = selectedCards.has(card.id);
        const layout = cardLayouts[card.id] || { order: selectedCardIds.length + 1, width: 1, height: 1 };
        const orderOptions = selected ? selectedCardIds.map((_, index) => `<option value="${index + 1}" ${layout.order === index + 1 ? "selected" : ""}>${index + 1}</option>`).join("") : `<option value="1">1</option>`;
        const disabled = selected ? "" : "disabled";
        return `<div class="custom-card-choice" data-card-layout="${escapeHtml(card.id)}"><label class="camera"><input type="checkbox" data-menu-lovelace-card value="${escapeHtml(card.id)}" ${selected ? "checked" : ""}>${escapeHtml(card.name)} — ${escapeHtml(card.card_type)}</label><div class="card-layout-inline" ${selected ? "" : "aria-disabled=\"true\""}><label>Order <select data-card-order="${escapeHtml(card.id)}" ${disabled}>${orderOptions}</select></label><label>Width <select data-card-width="${escapeHtml(card.id)}" ${disabled}><option value="1" ${layout.width === 1 ? "selected" : ""}>1 wide</option><option value="2" ${layout.width === 2 ? "selected" : ""}>2 wide</option><option value="3" ${layout.width === 3 ? "selected" : ""}>3 wide</option></select></label><label>Height <select data-card-height="${escapeHtml(card.id)}" ${disabled}><option value="1" ${layout.height === 1 ? "selected" : ""}>1 high</option><option value="2" ${layout.height === 2 ? "selected" : ""}>2 high</option></select></label></div></div>`;
      }).join("") || `<div class="hint">No cards are available. Open the Custom Card Holder and Sync card library.</div>`}</div><div class="hint">Tick a card, then set its order and Echo size on the same line. Changing an order shifts the others so there are never duplicate positions.</div>` : ""}`;
      const menuOpen = rememberedOpenMenuId === menu.id;
      return `<details class="menu-config" data-menu-card="${escapeHtml(menu.id)}" ${menuOpen ? "open" : ""}>
      <summary>Menu ${index + 1}: ${escapeHtml(menu.label)}<span class="menu-summary">${menu.action === "navigate" ? "Navigation" : menu.source === "lovelace_card" ? `${selectedCardIds.length} custom card${selectedCardIds.length === 1 ? "" : "s"}` : `${(menu.cameras || []).length + (menu.lights || []).length + (menu.temperatures || []).length} selected`} · Order ${index + 1}</span></summary>
      <div class="row"><label class="order-field">Menu order <select data-menu-order>${menuProfiles.map((_, optionIndex) => `<option value="${optionIndex + 1}" ${index === optionIndex ? "selected" : ""}>${optionIndex + 1}</option>`).join("")}</select></label><label>Menu name <input type="text" data-menu-label value="${escapeHtml(menu.label)}"></label><label class="icon-field">Icon (optional)<span class="icon-control"><span class="icon-preview" data-icon-preview>${menu.icon ? `<ha-icon icon="${escapeHtml(menu.icon)}"></ha-icon>` : "No icon"}</span><input type="text" data-menu-icon value="${escapeHtml(menu.icon)}" placeholder="Leave blank for no icon"><details class="icon-picker"><summary>Choose icon</summary><input type="search" data-icon-search placeholder="Search all Material Design icons"><div class="icon-options">${MENU_ICON_CHOICES.map(([value, label]) => iconChoiceMarkup(value, label)).join("")}</div><div class="icon-search-status hint"></div></details></span></label><label class="placement-field">Icon placement <select data-menu-icon-placement><option value="left" ${menu.icon_placement === "left" ? "selected" : ""}>Left</option><option value="center" ${menu.icon_placement === "center" ? "selected" : ""}>Middle</option><option value="right" ${menu.icon_placement === "right" ? "selected" : ""}>Right</option></select></label></div>
      <div class="row"><label>Action <select data-menu-action><option value="view" ${menu.action === "navigate" ? "" : "selected"}>Show this menu</option><option value="navigate" ${menu.action === "navigate" ? "selected" : ""}>Navigate to Dashboard</option></select></label><label>Icon follows state (optional)<input type="text" data-menu-icon-entity value="${escapeHtml(menu.icon_entity || "")}" placeholder="weather.home"></label>${menu.action === "navigate" ? `${destinationSelect}${customDestination}` : ""}</div>${menu.action === "navigate" ? `<div class="hint">Choose any available Home Assistant dashboard or view. Custom paths are limited to this Home Assistant instance and open in the current session without changing the Echo assignment.</div>${this.dashboardDestinationsLoading ? `<div class="hint">Loading dashboards and views…</div>` : ""}${this.dashboardDestinationsError ? `<div class="hint">Could not load the dashboard list: ${escapeHtml(this.dashboardDestinationsError)}</div>` : ""}` : `<div class="row"><label>Content below menu <select data-menu-content-overflow><option value="fit" ${menu.content_overflow === "scroll" ? "" : "selected"}>Fit to remaining area</option><option value="scroll" ${menu.content_overflow === "scroll" ? "selected" : ""}>Scrollable below menu</option></select></label></div><div class="hint">The menu bar remains fixed. Fit to remaining area responsively scales the content below it; Scrollable below menu keeps its selected size and scrolls only that area.</div>`}
       ${sourcePicker}${visualLayout}
      <div class="row">${areaSelect}</div>${this.areaRegistryError ? `<div class="hint">Area filters are unavailable: ${escapeHtml(this.areaRegistryError)}</div>` : this.areaRegistryLoading ? `<div class="hint">Loading Home Assistant areas…</div>` : `<div class="hint">Choose an area to narrow the camera, light, and temperature lists for this menu, then tick the entities you want to show.</div>`}
      ${menu.action === "navigate" ? "" : `<details class="content-picker" ${(pickerOpen[0] ?? false) ? "open" : ""}><summary>Cameras · ${(menu.cameras || []).length} selected</summary>${menuCameras.length ? menuCameras.map((camera) => `<div class="camera-choice"><label class="camera"><input type="checkbox" data-menu-camera value="${escapeHtml(camera.entityId)}" ${(menu.cameras || []).includes(camera.entityId) ? "checked" : ""}>${escapeHtml(camera.label)}</label>${(menu.cameras || []).includes(camera.entityId) ? cameraAppearance(camera, menu.id) : ""}</div>`).join("") : `<div class="hint">No cameras are available in this area.</div>`}</details>
      <details class="content-picker" ${(pickerOpen[1] ?? false) ? "open" : ""}><summary>Choose lights · ${(menu.lights || []).length} selected</summary>${menuLights.length ? menuLights.map((light: any) => `<label class="camera"><input type="checkbox" data-menu-light value="${escapeHtml(light.entity_id)}" ${(menu.lights || []).includes(light.entity_id) ? "checked" : ""}>${escapeHtml(light.attributes?.friendly_name || light.entity_id)}</label>`).join("") : `<div class="hint">No lights are available in this area.</div>`}</details>
      <details class="content-picker" ${(pickerOpen[2] ?? false) ? "open" : ""}><summary>Temperature sensors · ${(menu.temperatures || []).length} selected</summary>${menuTemperatures.length ? menuTemperatures.map((sensor: any) => `<label class="camera"><input type="checkbox" data-menu-temperature value="${escapeHtml(sensor.entity_id)}" ${(menu.temperatures || []).includes(sensor.entity_id) ? "checked" : ""}>${escapeHtml(sensor.attributes?.friendly_name || sensor.entity_id)}</label>`).join("") : `<div class="hint">No temperature sensors are available in this area.</div>`}</details>`}
      <button type="button" data-remove-menu ${menuProfiles.length <= 1 ? "disabled" : ""}>Remove menu</button>
    </details>`;
    }).join("");
    const managedDashboardList = this.managedDashboards.length
      ? `<ul>${this.managedDashboards.map((dashboard) => `<li class="camera"><span>${escapeHtml(dashboard.title)}${dashboard.target ? ` — ${escapeHtml(targets.find((target) => target.key === dashboard.target)?.label || dashboard.target)}` : ""}</span><button type="button" data-delete-managed="${escapeHtml(dashboard.id)}">Remove</button></li>`).join("")}</ul>`
      : `<div class="hint">${this.managedDashboardsError ? `Could not load managed dashboards: ${escapeHtml(this.managedDashboardsError)}` : "Dashboards created here will appear in this list."}</div>`;
    const selectedMenu = menuProfiles.find((menu) => menu.id === this.selectedMenuId) || menuProfiles[0];
    if (selectedMenu) this.selectedMenuId = selectedMenu.id;
    const menuWorkspaceList = `<aside class="menu-workspace-list"><div class="panel-heading"><div><span class="eyebrow">STRUCTURE</span><h4>Dashboard menus <em>${menuProfiles.length}</em></h4></div></div><p class="hint">Choose a menu to edit its content.</p><ol>${menuProfiles.map((menu, index) => `<li><button type="button" data-menu-focus="${escapeHtml(menu.id)}" class="${menu.id === this.selectedMenuId ? "selected" : ""}" ${menu.id === this.selectedMenuId ? 'aria-current="true"' : ""}><span class="menu-number">${index + 1}</span><span class="menu-list-copy"><strong>${escapeHtml(menu.label)}</strong><small>${menu.action === "navigate" ? "Navigation" : menu.source === "lovelace_card" ? `${menu.lovelace_card_ids?.length || 0} cards` : `${(menu.cameras?.length || 0) + (menu.lights?.length || 0) + (menu.temperatures?.length || 0)} items`}</small></span></button></li>`).join("")}</ol><button type="button" id="add-menu" class="secondary-action">＋ Add menu</button></aside>`;
    const orderedMenuCameras = (menu?: EchoMenuConfig) => [...(menu?.cameras || [])].sort((a, b) => {
      const aIndex = cameraOrder.indexOf(a);
      const bIndex = cameraOrder.indexOf(b);
      return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex);
    });
    const menuPreviewMarkup = (menu?: EchoMenuConfig) => {
      const selectedCameras = orderedMenuCameras(menu).filter((id) => cameras.some((camera) => camera.entityId === id));
      const tiles = menu?.action === "navigate" ? [{ label: "Opens another dashboard", span: 2, kind: "navigation" as const }] : menu?.source === "lovelace_card"
        ? (menu.lovelace_card_ids || []).map((id) => ({ label: cardLibrary.find((card) => card.id === id)?.name || id, span: 1, kind: "card" as const }))
        : [...selectedCameras.map((id) => ({ label: cameras.find((camera) => camera.entityId === id)?.label || id, image: String(this._hass?.states[id]?.attributes?.entity_picture || ""), span: Math.max(1, Math.min(3, Number(this.config.camera_spans?.[id]) || 1)), kind: "camera" as const })), ...(menu?.lights || []).map((id) => ({ label: String(this._hass?.states[id]?.attributes?.friendly_name || id), span: 1, kind: "light" as const })), ...(menu?.temperatures || []).map((id) => ({ label: String(this._hass?.states[id]?.attributes?.friendly_name || id), span: 1, kind: "temperature" as const }))];
      const leftControl = menuStatuses[0]?.label || "";
      const rightControl = menuToggles[0]?.label || "";
      const columns = Math.min(3, Math.max(1, tiles.length));
      return `<div class="echo-preview-screen"><div class="echo-preview-nav"><span class="preview-control">${escapeHtml(leftControl || "—")}</span><div class="echo-preview-menu-buttons">${menuProfiles.map((item) => `<span class="${item.id === menu?.id ? "active" : ""}">${escapeHtml(item.label)}</span>`).join("")}</div><span class="preview-control">${escapeHtml(rightControl || "—")}</span></div><div class="echo-preview-content"><strong>${escapeHtml(menu?.label || "No menu selected")}</strong><div class="echo-preview-tiles preview-cols-${columns}">${tiles.map((tile) => `<span class="${tile.span > 1 ? `span-${tile.span}` : ""} preview-tile-${tile.kind}">${tile.kind === "camera" && tile.image ? `<img src="${escapeHtml(tile.image)}" alt="">` : ""}<b>${escapeHtml(tile.label)}</b></span>`).join("") || `<span>No content selected</span>`}</div>${tiles.length ? `<small class="preview-scroll-hint">${tiles.length > 4 ? `Scroll to see all ${tiles.length} items` : "All configured items shown"}</small>` : ""}</div></div>`;
    };
    const includedItemsMarkup = (menu?: EchoMenuConfig) => {
      const ids = menu?.source === "lovelace_card" ? menu.lovelace_card_ids || [] : orderedMenuCameras(menu).concat(menu?.lights || [], menu?.temperatures || []);
      const labelFor = (id: string) => cardLibrary.find((card) => card.id === id)?.name || cameras.find((camera) => camera.entityId === id)?.label || String(this._hass?.states[id]?.attributes?.friendly_name || id);
      return `<div class="included-items-panel"><div class="panel-heading"><div><span class="eyebrow">CONTENT</span><h4>Included items <em>${ids.length}</em></h4></div></div>${ids.length ? `<ol>${ids.slice(0, 12).map((id, index) => `<li><span class="item-order">${index + 1}</span><strong>${escapeHtml(labelFor(id))}</strong><small>${id.startsWith("camera.") ? cameras.some((camera) => camera.entityId === id) ? "Camera" : "Unavailable camera" : id.startsWith("light.") ? "Light" : id.startsWith("sensor.") ? "Sensor" : "Card"}</small></li>`).join("")}</ol>${ids.length > 12 ? `<div class="hint">+${ids.length - 12} more items</div>` : ""}` : `<p class="hint">Choose content for this menu in the editor above.</p>`}</div>`;
    };
    const managedPreview = this.managedDashboards.find((dashboard) => dashboard.target === selectedTarget);
    root.innerHTML = `<style>
      :host{display:block;font-family:Arial,sans-serif;padding:16px;box-sizing:border-box;color:var(--primary-text-color);--builder-line:var(--divider-color,rgba(127,127,127,.35))}
      .section-nav{position:sticky;top:8px;z-index:5;float:left;width:170px;display:flex;flex-direction:column;gap:6px;margin:0 18px 18px 0;padding:8px;background:var(--card-background-color,var(--primary-background-color));border:1px solid var(--builder-line);border-radius:10px}.section-nav button{text-align:left;padding:9px 10px;border:1px solid transparent;border-radius:7px;background:transparent;color:inherit;cursor:pointer;font-size:.9em}.section-nav button:hover,.section-nav button:focus{border-color:var(--primary-color,#03a9f4);background:color-mix(in srgb,var(--primary-color,#03a9f4) 9%,transparent);outline:none}.section{margin-left:200px}.quick-start{border:1px solid var(--builder-line);border-radius:10px}.quick-steps{display:flex;gap:8px;flex-wrap:wrap;padding-left:24px}.quick-steps button{padding:7px 9px;border:1px solid var(--builder-line);border-radius:7px;background:var(--card-background-color,var(--primary-background-color));color:inherit;cursor:pointer}.readiness-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px;margin-top:10px}.readiness{padding:7px 9px;border-radius:7px;font-size:.88em}.readiness.ready{background:color-mix(in srgb,#2e9d5b 14%,transparent);color:#19733d}.readiness.needs-attention{background:color-mix(in srgb,#f39c12 15%,transparent);color:#8a5500}.dependency-warning{margin-top:10px;padding:9px 10px;border-left:3px solid #f39c12;background:color-mix(in srgb,#f39c12 10%,transparent)}@media(max-width:700px){.section-nav{float:none;width:auto;position:sticky;top:0;flex-direction:row;overflow:auto;margin:0 0 10px;border-radius:0}.section-nav button{white-space:nowrap}.section{margin-left:0}.quick-steps{display:block}.quick-steps li{margin:6px 0}}
      .section{margin-left:200px;padding:22px 0 24px;border-top:2px solid var(--builder-line)}.section:first-of-type{border-top:0;padding-top:4px}.section[hidden]{display:none}.section-nav button.active{background:color-mix(in srgb,var(--primary-color,#6750d8) 15%,transparent);color:var(--primary-color,#6750d8);font-weight:700}.overview-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:12px 0 18px}.overview-card{padding:16px;border:1px solid var(--builder-line);border-radius:12px;background:var(--card-background-color,var(--primary-background-color));min-width:0}.overview-card span{font-size:.8em;opacity:.72}.overview-card strong{display:block;margin-top:6px;font-size:1.05em;overflow-wrap:anywhere}.quick-start{background:color-mix(in srgb,var(--primary-color,#6750d8) 3%,var(--card-background-color,var(--primary-background-color)))}@media(max-width:700px){.section{margin-left:0}}
      .overview-panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px;margin-top:18px}.overview-panel{padding:14px;border:1px solid var(--builder-line);border-radius:10px;background:var(--card-background-color,var(--primary-background-color))}.overview-panel-heading{display:flex;justify-content:space-between;align-items:center;gap:8px}.overview-panel h4{margin:0}.overview-panel ul{list-style:none;margin:10px 0 0;padding:0}.overview-panel li{display:flex;justify-content:space-between;gap:10px;padding:9px 2px;border-top:1px solid var(--builder-line)}.overview-panel small{opacity:.7;white-space:nowrap}.overview-panel button{cursor:pointer}
      /* Workspace polish: keep the editor visually calm and scannable. */
      .section-nav{float:left;width:190px;position:sticky;top:8px;display:flex;flex-direction:column;gap:5px;margin:0 22px 18px 0;padding:8px;background:color-mix(in srgb,var(--card-background-color,var(--primary-background-color)) 94%,var(--primary-color,#6750d8) 6%);box-shadow:0 2px 8px rgba(0,0,0,.08);border-radius:12px}.section-nav button{width:100%;text-align:left;font-weight:600;white-space:nowrap}.section{margin-left:212px;padding:18px 0 22px;border-top:1px solid var(--builder-line)}.section:first-of-type{padding-top:0}.section>h3{margin:0 0 6px;font-size:1.18em}.section>.hint{max-width:78ch;line-height:1.45}.quick-start{padding:16px;border:1px solid var(--builder-line);box-shadow:0 1px 3px rgba(0,0,0,.05)}.overview-card{padding:13px;border-radius:10px}.overview-cards{gap:8px;margin:12px 0 16px}.menu-config,.toggle-config{box-shadow:0 1px 3px rgba(0,0,0,.04)}
      @media(max-width:700px){.section-nav{float:none;width:auto;position:sticky;top:0;flex-direction:row;overflow:auto;margin:0 0 10px;border-radius:0}.section-nav button{width:auto;flex:0 0 auto;text-align:center}.section{margin-left:0;padding-top:14px}}
      .section h3{margin:0 0 10px;font-size:1.18rem;line-height:1.3}
      details.custom-card-holder{padding-bottom:0}details.custom-card-holder>summary{display:flex;align-items:center;justify-content:space-between;cursor:pointer;font-size:1.18rem;font-weight:700;list-style:none}details.custom-card-holder>summary::-webkit-details-marker{display:none}details.custom-card-holder>summary::after{content:"⌄";font-size:1.1em}details.custom-card-holder:not([open])>summary::after{content:"›"}details.custom-card-holder>.holder-content{padding-top:14px}
      .row{display:flex;gap:8px;align-items:end;margin:8px 0;flex-wrap:wrap}
      .row>label{flex:1 1 170px}.row button{min-height:34px}
      input[type=text],select{max-width:100%;box-sizing:border-box;padding:7px 8px;min-height:34px;border:1px solid var(--builder-line);border-radius:6px;background:var(--card-background-color,var(--primary-background-color));color:inherit}
      input[type=text]{width:100%}label{cursor:pointer}.hint{opacity:.78;font-size:.92em;line-height:1.45;max-width:75ch;margin:4px 0 10px}
      .icon-control{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:6px;align-items:center;margin-top:5px;position:relative}.icon-preview{display:grid;place-items:center;width:34px;height:34px;border:1px solid var(--builder-line);border-radius:6px;color:var(--primary-text-color);font-size:.68em;text-align:center}.icon-preview ha-icon{--mdc-icon-size:22px}.icon-picker{position:relative;z-index:20;min-width:0}.icon-picker>summary{cursor:pointer;font-weight:600;white-space:nowrap;padding:7px 8px;border:1px solid var(--builder-line);border-radius:6px;background:var(--card-background-color,var(--primary-background-color));list-style:none}.icon-picker>summary::-webkit-details-marker{display:none}.icon-picker[open]{position:absolute;top:calc(100% + 5px);right:0;width:min(440px,calc(100vw - 32px));padding:8px;border:1px solid var(--builder-line);border-radius:8px;background:var(--card-background-color,var(--primary-background-color));box-shadow:0 6px 18px rgba(0,0,0,.22)}.icon-picker[open]>summary{padding:3px 0 8px;border:0;border-radius:0;background:transparent}.icon-picker input[type=search]{width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--builder-line);border-radius:6px;background:var(--card-background-color,var(--primary-background-color));color:inherit}.icon-options{display:grid;grid-template-columns:repeat(auto-fill,minmax(86px,1fr));gap:6px;margin-top:8px;max-height:320px;overflow:auto}.icon-options button{display:grid;place-items:center;gap:3px;min-height:66px;padding:6px;border:1px solid var(--builder-line);border-radius:6px;background:var(--card-background-color,var(--primary-background-color));color:inherit;cursor:pointer}.icon-options button:hover{border-color:var(--primary-color,#03a9f4);background:color-mix(in srgb,var(--primary-color,#03a9f4) 8%,transparent)}.icon-options ha-icon{--mdc-icon-size:28px}.icon-options button span:last-child{font-size:.78em}.no-icon-mark{font-size:28px;line-height:28px}
      .menu-config{border:1px solid var(--builder-line);border-radius:8px;padding:9px 11px;margin:8px 0;background:var(--card-background-color,rgba(127,127,127,.04))}
      .menu-toggles{margin-top:14px;padding-top:12px;border-top:2px solid var(--builder-line)}.menu-toggles h4{margin:0 0 6px}.toggle-config{margin:8px 0;padding:8px 10px;border:1px solid var(--builder-line);border-radius:8px;background:color-mix(in srgb,var(--primary-color,#03a9f4) 4%,transparent)}.toggle-actions{margin:8px 0;padding:8px;border-top:1px solid var(--builder-line);border-radius:6px;background:var(--card-background-color,rgba(127,127,127,.04))}.toggle-sync{display:flex;gap:6px;align-items:center}input[type=color]{height:34px;min-width:46px;padding:3px;border:1px solid var(--builder-line);border-radius:6px;background:transparent}
      .menu-config>summary,.content-picker>summary,.toggle-config>summary{cursor:pointer;font-weight:600;min-height:28px;display:flex;align-items:center;gap:6px;list-style:none}.menu-config>summary::-webkit-details-marker,.content-picker>summary::-webkit-details-marker,.toggle-config>summary::-webkit-details-marker{display:none}.menu-config>summary::after,.content-picker>summary::after,.toggle-config>summary::after{content:"⌄";margin-left:auto;font-size:1.15em;transition:transform .15s ease}.menu-config[open]>summary::after,.content-picker[open]>summary::after,.toggle-config[open]>summary::after{transform:rotate(180deg)}
      .content-picker{margin:10px 0;padding:8px 10px;border-top:1px solid var(--builder-line)}
      .content-picker[open]{background:color-mix(in srgb,var(--primary-color,#03a9f4) 5%,transparent);border-radius:6px}
      .menu-config .row label{flex:1 1 145px}.menu-config .row .order-field,.menu-config .row .placement-field{flex:0 1 118px}.menu-config .row .icon-field,.toggle-config .row .icon-field{flex:0 1 185px}.toggle-config .row .state-field{flex:0 1 310px}.toggle-config .row .colour-field{flex:0 1 74px}.camera{display:flex;gap:10px;padding:8px 4px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--builder-line)}
      .camera:last-child{border-bottom:0}.camera strong{flex:1 1 180px}.camera label{display:flex;gap:6px;align-items:center}
      .camera-choice{border-bottom:1px solid var(--builder-line);padding:3px 0}.camera-choice:last-child{border-bottom:0}.camera-choice>.camera{border:0}
      .camera-appearance{margin:0 8px 10px;padding:8px 10px;border-top:1px solid var(--builder-line);background:color-mix(in srgb,var(--primary-color,#03a9f4) 4%,transparent);border-radius:6px}
      .camera-appearance>summary{cursor:pointer;font-weight:600;min-height:30px;display:flex;align-items:center}
      .camera-settings-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.camera-settings-row>label{display:flex;gap:6px;align-items:center;flex:1 1 150px}.camera-settings-row select{min-width:82px}
      .custom-card-choice{display:flex;gap:10px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--builder-line);padding:5px 4px}.custom-card-choice:last-child{border-bottom:0}.custom-card-choice>.camera{border:0;flex:1 1 260px}.card-layout-inline{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:5px 8px;background:color-mix(in srgb,var(--primary-color,#03a9f4) 4%,transparent);border-radius:6px}.card-layout-inline[aria-disabled=true]{opacity:.5;background:transparent}.card-layout-inline>label{display:flex;gap:6px;align-items:center}
      .deployment-actions{align-items:center;min-height:42px}.deployment-actions .action-feedback{flex:1 1 300px;min-height:20px;margin:0;display:flex;align-items:center}.deployment-actions .action-feedback:empty{visibility:hidden}#managed-delete-status{display:block;margin:8px 0}
      .save-explainer{padding:9px 10px;border-left:3px solid var(--primary-color,#03a9f4);background:color-mix(in srgb,var(--primary-color,#03a9f4) 7%,transparent);font-size:.92em;line-height:1.4}.menu-summary{opacity:.75;font-weight:400;font-size:.9em;margin-left:8px}.visual-layout{margin:10px 0;padding:12px;border:1px solid var(--builder-line);border-radius:8px;background:color-mix(in srgb,var(--primary-color,#03a9f4) 5%,transparent)}.visual-layout p{margin:4px 0 10px}.visual-layout-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:58px;gap:6px;min-height:64px;padding:6px;border:1px dashed var(--builder-line);background:var(--card-background-color,var(--primary-background-color));border-radius:6px}.visual-layout-item{grid-column:span 1;grid-row:span 1;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:2px;padding:5px;border:2px solid var(--primary-color,#03a9f4);border-radius:6px;background:color-mix(in srgb,var(--primary-color,#03a9f4) 15%,transparent);cursor:grab;user-select:none;min-width:0}.visual-layout-item.span-2{grid-column:span 2}.visual-layout-item.span-3{grid-column:span 3}.visual-layout-item.row-2{grid-row:span 2}.visual-layout-item:active{cursor:grabbing}.visual-layout-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}.visual-layout-size{font-size:.75em;opacity:.75}.visual-layout-actions{display:flex;gap:3px}.visual-layout-actions button{min-width:22px;height:22px;padding:0;line-height:1}.visual-layout-actions button:nth-child(3){margin-left:5px}@media(max-width:600px){.section-nav{margin:0 -4px}.section-nav a{font-size:.8em}.row>label{flex-basis:100%}.visual-layout-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      .menus-workspace{display:grid;grid-template-columns:minmax(170px,220px) minmax(0,1fr);gap:14px;align-items:start}.menu-workspace-list,.menu-secondary-settings,.deployment-history-panel{padding:12px;border:1px solid var(--builder-line);border-radius:10px;background:var(--card-background-color,var(--primary-background-color))}.menu-workspace-list{position:sticky;top:8px}.menu-workspace-list h4{margin:0 0 4px}.menu-workspace-list ol{list-style:none;margin:10px 0;padding:0}.menu-workspace-list li+li{border-top:1px solid var(--builder-line)}.menu-workspace-list button[data-menu-focus]{display:flex;gap:8px;width:100%;padding:9px 4px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.menu-workspace-list button[data-menu-focus] span{opacity:.65;min-width:18px}.menu-workspace-list button[data-menu-focus]:hover{color:var(--primary-color,#03a9f4)}.menu-workspace-editor{min-width:0}.menu-secondary-settings{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:12px}.menu-secondary-settings strong{flex-basis:100%}.menu-secondary-settings label{display:flex;align-items:center;gap:8px}.deployment-history-panel{display:grid;gap:10px}@media(max-width:700px){.menus-workspace{grid-template-columns:1fr}.menu-workspace-list{position:static}}
      .menu-workspace-list button[data-menu-focus].selected{background:color-mix(in srgb,var(--primary-color,#03a9f4) 14%,transparent);color:var(--primary-color,#03a9f4);font-weight:700;border-left:3px solid var(--primary-color,#03a9f4);padding-left:7px}.menu-workspace-list button[data-menu-focus].selected span{opacity:1}.deployment-panel{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;padding:12px;border:1px solid var(--builder-line);border-radius:10px;background:var(--card-background-color,var(--primary-background-color))}#echo-deployment>.row{padding:10px;border:1px solid var(--builder-line);border-radius:8px;background:color-mix(in srgb,var(--primary-color,#03a9f4) 3%,transparent)}#echo-deployment>.save-explainer{margin:8px 0}
      .menu-secondary-settings{display:block;margin-top:14px}.menu-secondary-settings>summary{cursor:pointer;font-weight:700}.menu-secondary-settings .menu-toggles{margin-top:12px}.deployment-layout{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px;margin:16px 0}.deployment-settings-panel,.deployment-publish-panel{padding:16px;border:1px solid var(--builder-line);border-radius:10px;background:var(--card-background-color,var(--primary-background-color));min-width:0}.deployment-layout h4{margin:0 0 12px}.deployment-readiness{list-style:none;margin:0 0 14px;padding:0}.deployment-readiness li{padding:8px 0;border-bottom:1px solid var(--builder-line)}.deployment-readiness .ready{color:#19733d}.deployment-readiness .needs-attention{color:#8a5500}
      :host{--builder-line:#e1e5f2;--builder-purple:#523bd7;--builder-ink:#20243a;--builder-muted:#66708c;--builder-surface:#fff;display:block;padding:0 0 32px;background:linear-gradient(135deg,#fafbff 0%,#f3f5fc 68%,#f8f7ff 100%);color:var(--builder-ink);font-family:Inter,"Segoe UI",Arial,sans-serif;min-height:100vh}
      .builder-app-header{display:flex;align-items:center;gap:12px;min-height:76px;padding:12px 28px;background:#fff;border-bottom:1px solid #e6e8f3;box-shadow:0 1px 6px #25305d0b}.brand-mark{display:flex;gap:3px;width:34px;height:28px}.brand-mark span{display:block;flex:1;border-radius:4px;background:linear-gradient(145deg,#7862f0,#4d32d5)}.brand-mark span:first-child{opacity:.77}.brand-copy{display:grid;gap:1px}.brand-copy strong{font-size:1.12rem;letter-spacing:-.02em}.brand-copy small{font-size:.75rem;color:var(--builder-muted)}.header-spacer{flex:1}.header-dash-name{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--builder-muted);font-size:.88rem}.primary-action{padding:11px 18px;border:0;border-radius:9px;background:linear-gradient(135deg,#664ce2,#4931c7);color:#fff;font-weight:700;box-shadow:0 5px 12px #4c37cb30;cursor:pointer}
      .section-nav{float:left;width:190px;top:22px;margin:22px 22px 0 20px;padding:10px;background:#fff;border:1px solid #e6e8f3;border-radius:14px;box-shadow:0 8px 24px #26305a0a}.section-nav button{min-height:46px;padding:11px 12px;border-radius:9px;color:#404962;font-size:.91rem}.section-nav button.active{background:#efecff;color:#422bc3;box-shadow:inset 3px 0 #5f45dd}.section-nav button:hover{background:#f4f2ff;color:#422bc3}
      .section{margin-left:232px;margin-right:24px;padding:0 0 24px;border:0}.section>h3{font-size:1.45rem;letter-spacing:-.025em;margin:4px 0 5px}.section>.hint{color:var(--builder-muted);font-size:.9rem}.section[hidden]{display:none}.section .hint{line-height:1.45;color:var(--builder-muted)}
      .quick-start{padding:0;background:transparent;border:0;box-shadow:none}.overview-hero{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:16px}.overview-hero h2{margin:5px 0;font-size:2rem;letter-spacing:-.04em;line-height:1.1}.overview-hero p{margin:0;color:var(--builder-muted);font-size:.9rem}.eyebrow{font-size:.7rem;font-weight:800;letter-spacing:.12em;color:#6a58cb}.hero-state{padding:9px 13px;border-radius:999px;background:#fff2e2;color:#925c0d;font-size:.82rem;font-weight:700;white-space:nowrap}.hero-state.ready{background:#e8f8ee;color:#147a3a}
      .overview-cards{grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:12px;margin:0 0 16px}.overview-card{padding:17px 18px;border:1px solid #e1e5f2;border-radius:13px;background:#fff;box-shadow:0 5px 17px #26305a0b}.overview-card span{color:var(--builder-muted);font-weight:600}.overview-card strong{font-size:1.07rem}.quick-start>h3{margin-top:20px}.quick-steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0;padding:0;list-style:none;counter-reset:step}.quick-steps li{counter-increment:step}.quick-steps button{width:100%;min-height:74px;padding:12px;text-align:left;background:#fff;border:1px solid #e1e5f2;border-radius:11px;box-shadow:0 3px 10px #26305a08;font-weight:650}.quick-steps button::before{content:counter(step);display:inline-grid;place-items:center;width:24px;height:24px;margin-right:8px;border-radius:7px;background:#efecff;color:#5139d2;font-size:.8rem;font-weight:800}.readiness-grid{gap:10px}.readiness{border-radius:9px;font-weight:650}.overview-panels{gap:14px}.overview-panel,#setup-library,.menu-workspace-list,.menu-preview-panel,.deployment-settings-panel,.deployment-publish-panel,.deployment-history-panel,#menu-controls>.menu-toggles{background:#fff;border:1px solid #e1e5f2;border-radius:14px;box-shadow:0 6px 20px #26305a0b}.overview-panel{padding:18px}.overview-panel h4{font-size:1.08rem}.overview-panel li{align-items:center}.overview-panel small{padding:5px 8px;background:#f0f1f7;border-radius:8px;color:#45506c;opacity:1}.overview-panel button{padding:7px 10px;border:1px solid #d8dcee;border-radius:8px;background:#fff;color:#5038ce;font-weight:700}
      #setup-library{padding:20px;margin-top:16px}#setup-library h3{font-size:1.12rem}#setup-library .row{gap:10px}#setup-library select{min-width:240px}button{font-family:inherit}button:not(.primary-action):not([data-menu-focus]){cursor:pointer}input:not([type=checkbox]):not([type=color]),select{min-height:38px;padding:7px 10px;border:1px solid #d7dcec;border-radius:8px;background:#fff;color:var(--builder-ink);box-sizing:border-box}input:focus-visible,select:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid #684fe1;outline-offset:2px}
      .menus-workspace{grid-template-columns:minmax(180px,215px) minmax(320px,1fr) minmax(235px,275px);gap:14px;margin-top:16px}.menu-workspace-list,.menu-preview-panel{padding:18px;min-width:0}.menu-workspace-list{top:18px}.panel-heading{display:flex;justify-content:space-between;align-items:center}.panel-heading h4{margin:4px 0 0;font-size:1.1rem}.panel-heading em{padding:3px 7px;margin-left:5px;border-radius:7px;background:#efecff;color:#5038ce;font-style:normal;font-size:.74rem}.menu-workspace-list .hint,.menu-preview-panel .hint{font-size:.83rem}.menu-workspace-list li+li{border-top:0}.menu-workspace-list button[data-menu-focus]{align-items:center;gap:10px;padding:10px;margin:3px 0;border-radius:9px}.menu-number{display:grid;place-items:center;width:26px;height:26px;flex:none;border-radius:7px;background:#f0effa;color:#594aa8;font-size:.82rem;font-weight:800;opacity:1}.menu-list-copy{display:grid;gap:3px}.menu-list-copy strong{font-size:.9rem}.menu-list-copy small{font-size:.72rem;color:var(--builder-muted)}.menu-workspace-list button[data-menu-focus].selected{border-left:0;padding-left:10px;background:#efecff;box-shadow:inset 3px 0 #5e43dc}.menu-workspace-list button[data-menu-focus].selected .menu-number{background:#5e43dc;color:#fff}.secondary-action{width:100%;padding:10px;border:1px dashed #9c90e4;border-radius:9px;background:#f8f7ff;color:#5038ce;font-weight:750}
      .menu-workspace-editor>.menu-config{display:block;margin-bottom:10px;background:#fff;border:1px solid #e1e5f2;border-radius:12px;box-shadow:0 5px 18px #26305a0a}.menu-config>summary{padding:15px 16px;font-weight:750}.menu-config[open]{border-color:#ab9df0}.menu-config[open]>summary{border-bottom:1px solid #e5e7f1;color:#4f35cf}.menu-config>.row,.menu-config>.hint,.menu-config>.content-picker,.menu-config>.card-picker,.menu-config>.visual-layout{margin-left:16px;margin-right:16px}.menu-secondary-settings{padding:15px 17px;background:#fff;border-radius:12px}.menu-secondary-settings>summary{color:#5542bd}.menu-preview-panel{position:sticky;top:18px}.echo-preview-screen{overflow:hidden;margin:16px 0 12px;border:9px solid #252937;border-radius:22px;min-height:240px;background:linear-gradient(135deg,#d8e9fb,#ebe8fc);box-shadow:0 12px 20px #1319312d}.echo-preview-nav{display:grid;grid-template-columns:1fr 1.25fr 1fr;gap:3px;padding:8px 6px;background:#283048;color:#fff;align-items:center}.echo-preview-menu-buttons{display:flex;gap:3px;min-width:0;justify-content:center}.echo-preview-nav span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5px 3px;text-align:center;font-size:.6rem;border-radius:5px}.echo-preview-menu-buttons span{flex:1;min-width:0}.echo-preview-nav span.active{background:#6248df}.preview-control{opacity:.7;text-align:center}.echo-preview-content{padding:12px}.echo-preview-content>strong{font-size:.9rem}.echo-preview-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:10px}.echo-preview-tiles span{display:grid;place-items:center;min-height:46px;padding:5px;border:1px solid #fff;background:#ffffffde;border-radius:7px;text-align:center;font-size:.67rem;overflow-wrap:anywhere}.echo-preview-content small{display:block;margin-top:6px;color:#59647e}.preview-note{padding:10px;border-radius:8px;background:#f1f3ff;color:#4e5980;font-size:.76rem;line-height:1.4}
      .menu-config[hidden]{display:none}
      #menu-controls:not([hidden]){display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}#menu-controls>h3,#menu-controls>.hint{grid-column:1/-1}#menu-controls>.menu-toggles{padding:18px;min-width:0}#menu-controls h4{margin-top:0}.deployment-layout{gap:16px}.deployment-settings-panel,.deployment-publish-panel,.deployment-history-panel{padding:20px}.deployment-layout h4{font-size:1.12rem}.deployment-readiness li{font-weight:650}.deployment-actions button{padding:10px 14px;border-radius:8px}.deployment-actions #echo-create-dashboard{border:0;background:#543bd3;color:#fff;font-weight:750}.deployment-history-panel{margin-top:8px}
      @media(max-width:1380px){.menus-workspace{grid-template-columns:minmax(180px,220px) minmax(0,1fr)}.menu-preview-panel{grid-column:1/-1;position:static}.echo-preview-screen{max-width:430px}}
      @media(max-width:900px){.builder-app-header{padding:10px 16px}.header-dash-name{display:none}.section-nav{float:none;width:auto;position:sticky;top:0;z-index:10;flex-direction:row;overflow:auto;margin:0 0 16px;padding:8px;border-radius:0}.section-nav button{width:auto;white-space:nowrap}.section{margin:0 16px}.menus-workspace{grid-template-columns:1fr}.menu-workspace-list{position:static}.menu-preview-panel{grid-column:auto}#menu-controls:not([hidden]){grid-template-columns:1fr}.quick-steps{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:560px){.brand-copy small{display:none}.primary-action{padding:9px 10px;font-size:.76rem}.overview-hero{align-items:flex-start;flex-direction:column}.overview-hero h2{font-size:1.55rem}.quick-steps{grid-template-columns:1fr}.deployment-layout{grid-template-columns:1fr}.section{margin:0 12px}}
      .builder-app-header button:not(.primary-action){padding:9px 13px;border:1px solid #dce0ef;border-radius:8px;background:#fff;color:#29314b;font-weight:650}.builder-app-header button:disabled{opacity:.45;cursor:not-allowed}.overview-main{min-width:0}.quick-start:not([hidden]){display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:16px;align-items:start}.overview-rail{display:grid;gap:14px}.rail-card{padding:18px;border:1px solid #e1e5f2;border-radius:14px;background:#fff;box-shadow:0 6px 20px #26305a0b}.rail-card h4{margin:4px 0 12px;font-size:1.04rem}.rail-card dl{margin:0}.rail-card dl>div{padding:9px 0;border-bottom:1px solid #edf0f7}.rail-card dt{font-size:.75rem;color:var(--builder-muted)}.rail-card dd{margin:4px 0 0;font-size:.89rem;font-weight:700;overflow-wrap:anywhere}.rail-card button{margin-top:13px;padding:8px 10px;border:1px solid #d9dcf0;border-radius:8px;background:#f8f7ff;color:#4f38c9;font-weight:700}.rail-card p{font-size:.82rem;line-height:1.45;color:var(--builder-muted)}.rail-status{padding:11px 12px;border-radius:9px;font-weight:750}.rail-status.ready{background:#e6f7eb;color:#188044}.rail-status.draft{background:#fff2e3;color:#915a0b}
      .quick-steps{position:relative;gap:0;padding:16px 4px;border:1px solid #e1e5f2;border-radius:13px;background:#fff;box-shadow:0 5px 17px #26305a0b}.quick-steps li{position:relative;min-width:0;text-align:center}.quick-steps li:not(:last-child)::after{content:"";position:absolute;top:15px;left:calc(50% + 20px);right:calc(-50% + 20px);height:2px;background:#d9dded}.quick-steps li.complete:not(:last-child)::after{background:#6b55db}.quick-steps button{display:grid;justify-items:center;align-content:start;gap:7px;width:100%;min-height:65px;padding:0 4px;border:0;background:transparent;box-shadow:none;text-align:center;color:#48506b;font-size:.77rem;line-height:1.25}.quick-steps button::before{display:grid;width:30px;height:30px;margin:0;border-radius:9px;background:#eff0f7;color:#636b84;font-size:.88rem}.quick-steps .complete button::before{content:"✓";background:#ddf5e6;color:#118043}.quick-steps .complete button{color:#29334b;font-weight:750}
      .dash-library-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:11px;margin:16px 0}.dash-library-tile{display:flex;align-items:center;gap:9px;min-height:74px;padding:12px;border:1px solid #dce1ef;border-radius:10px;background:#fff;color:#25304b;text-align:left}.dash-library-tile strong{font-size:.83rem;line-height:1.25;overflow-wrap:anywhere}.dash-library-tile small{margin-left:auto;padding:4px 6px;border-radius:6px;background:#ebe7ff;color:#5239d0;font-size:.68rem}.dash-library-tile.current{border-color:#765be7;background:#f5f2ff;box-shadow:0 0 0 1px #765be7}.dash-tile-icon{display:grid;place-items:center;width:30px;height:30px;flex:none;border-radius:7px;background:#eeebff;color:#573ddb;font-size:1rem}.dash-library-tile.add-tile{justify-content:center;border-style:dashed;color:#513bcc}.dash-library-tile.add-tile span{font-size:1.2rem}
      .selected-menu-heading,.included-items-panel{padding:16px 18px;border:1px solid #e1e5f2;border-radius:12px;background:#fff;box-shadow:0 5px 18px #26305a0a}.selected-menu-heading{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px}.selected-menu-heading h4{margin:4px 0;font-size:1.15rem}.selected-menu-heading p{margin:0;color:var(--builder-muted);font-size:.78rem}.editing-badge{padding:6px 9px;border-radius:7px;background:#efeaff;color:#5038ce;font-size:.72rem;font-weight:800}.included-items-panel{margin:12px 0}.included-items-panel h4{margin:4px 0;font-size:1rem}.included-items-panel h4 em{margin-left:5px;padding:3px 7px;border-radius:7px;background:#eeebff;color:#5239d0;font-size:.74rem;font-style:normal}.included-items-panel ol{list-style:none;margin:12px 0 0;padding:0}.included-items-panel li{display:flex;align-items:center;gap:10px;min-height:37px;padding:5px 0;border-top:1px solid #edf0f7}.included-items-panel li strong{flex:1;font-size:.82rem}.included-items-panel li small{padding:4px 7px;border-radius:7px;background:#f0f1f6;color:#58617b;font-size:.69rem}.item-order{font-size:.75rem;color:#7560d8;font-weight:800}
      .deployment-layout{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}.deployment-layout>.section{margin:0;padding:0;border:0}.deployment-layout>.section>h3{display:none}.deployment-preview-panel{padding:20px;border:1px solid #e1e5f2;border-radius:14px;background:#fff;box-shadow:0 6px 20px #26305a0b;min-width:0}.deployment-preview-panel h4{margin:4px 0}.deployment-device-frame{max-width:520px;margin:20px auto;padding:13px;border:8px solid #292b31;border-radius:32px;background:#17191f;box-shadow:0 18px 28px #151a3450}.deployment-device-screen{overflow:hidden;min-height:265px;padding:18px;border-radius:16px;background:linear-gradient(135deg,#b8cbf6,#9078dc 55%,#e5c7e9);color:#fff}.device-topline{display:flex;justify-content:space-between;gap:10px;font-size:.8rem}.device-menu-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:24px 0}.device-menu-grid>div{display:grid;gap:4px;min-height:58px;padding:11px;border-radius:10px;background:#ffffffe6;color:#252944;box-shadow:0 4px 8px #312c6a26}.device-menu-grid strong{font-size:.8rem}.device-menu-grid small{font-size:.69rem;color:#5f6784}.device-bottom-nav{display:flex;gap:3px;padding:7px;border-radius:10px;background:#ffffffd9;color:#3c3e62}.device-bottom-nav span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;font-size:.58rem}.deployment-preview-panel>#open-applied-preview{padding:9px 12px;border:1px solid #d8dcef;border-radius:8px;background:#fff;color:#4f36cd;font-weight:700}
      @media(min-width:1101px){.menus-workspace{grid-template-columns:minmax(170px,195px) minmax(0,1fr) minmax(210px,250px)}.menu-preview-panel{grid-column:auto;position:sticky}}
      @media(max-width:1220px){.quick-start:not([hidden]){grid-template-columns:1fr}.overview-rail{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:900px){.deployment-layout{grid-template-columns:1fr}.overview-rail{grid-template-columns:1fr}.quick-steps{grid-template-columns:repeat(5,minmax(0,1fr))}}
      @media(max-width:560px){.builder-app-header button:not(.primary-action){display:none}.quick-steps{grid-template-columns:1fr;gap:6px}.quick-steps li:not(:last-child)::after{display:none}.quick-steps button{display:flex;align-items:center;text-align:left;min-height:40px}.dash-library-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      .publish-summary{margin:14px 0;padding:14px;border:1px solid #e7e9f2;border-radius:10px;background:#fafbff}.publish-summary>strong{font-size:.9rem}.publish-summary dl{margin:8px 0 0}.publish-summary dl>div{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid #ebedf5}.publish-summary dt{font-size:.76rem;color:var(--builder-muted)}.publish-summary dd{margin:0;text-align:right;font-size:.78rem;font-weight:700}
      /* A single visual system for editor actions and fields. */
      .menu-workspace-editor,.menu-config,.menu-config .row,.menu-config label,.camera-choice,.camera-appearance,.camera-settings-row,.camera-settings-row>label,#setup-library{min-width:0;max-width:100%;box-sizing:border-box}
      .menu-config input:not([type=checkbox]):not([type=color]),.menu-config select,.menu-config .icon-control,#setup-library select{min-width:0;max-width:100%;box-sizing:border-box}
      .camera-settings-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 14px;align-items:start}
      .camera-settings-row>label{display:grid;grid-template-columns:minmax(0,1fr);gap:5px;align-items:start;min-width:0;overflow-wrap:anywhere;font-size:.8rem;font-weight:650;color:#45506c}
      .camera-settings-row select{width:100%;min-width:0;max-width:100%;font-size:.82rem;font-weight:500;color:var(--builder-ink)}
      .camera-settings-row input[type=checkbox]{justify-self:start;margin:8px 0}
      .camera-appearance{margin:5px 0 12px;padding:12px;border:1px solid #e1e6f3;border-radius:10px;background:#f7f9fd}
      .camera-appearance>summary{color:#353b63;font-size:.83rem}
      .echo-preview-tiles .wide{grid-column:span 2}
      .menu-config button:not(.visual-layout-actions button),#setup-library .row button,.menu-secondary-settings button,.deployment-history-panel button{min-height:38px;padding:8px 12px;border:1px solid #d7dcef;border-radius:8px;background:#fff;color:#5038ce;font:inherit;font-size:.82rem;font-weight:700;box-shadow:none}
      .menu-config button:not(.visual-layout-actions button):hover,#setup-library .row button:hover,.menu-secondary-settings button:hover{border-color:#8e7de6;background:#f5f2ff}
      .menu-config [data-remove-menu],#remove-profile{color:#a23b53!important;border-color:#efd1d9!important;background:#fff9fa!important}
      #setup-library .row:has(#saved-profile){display:grid;grid-template-columns:1fr;gap:6px}
      #setup-library .row:has(#add-profile){display:flex;align-items:center;gap:9px}
      #setup-library .row select{min-width:0;width:100%}
      #setup-library .row button{white-space:nowrap}
      @media(min-width:1101px) and (max-width:1450px){.section-nav{width:154px;margin-left:14px;margin-right:16px}.section{margin-left:188px;margin-right:16px}.menus-workspace{grid-template-columns:minmax(145px,160px) minmax(0,1fr) minmax(180px,200px);gap:10px}.menu-workspace-list,.menu-preview-panel{padding:13px}.menu-config{padding:8px}.menu-config>.row,.menu-config>.hint,.menu-config>.content-picker,.menu-config>.card-picker,.menu-config>.visual-layout{margin-left:9px;margin-right:9px}}
      @media(max-width:1100px){.menus-workspace{grid-template-columns:minmax(155px,190px) minmax(0,1fr)}.menu-preview-panel{grid-column:1/-1;position:static}}
      .menu-workspace-list>.custom-card-holder{display:block;position:static;margin:14px 0 0;padding:12px;width:auto}.menu-workspace-list>.custom-card-holder[open]{padding-bottom:12px}
      @media(max-width:900px){.section{margin:0 16px}.menus-workspace{grid-template-columns:1fr}.menu-preview-panel{grid-column:auto}}
      @media(max-width:560px){.camera-settings-row{grid-template-columns:1fr}#setup-library .row button{white-space:normal}}
      .quick-steps{grid-template-columns:repeat(5,minmax(0,1fr))}
      .quick-steps li:not(:last-child)::after{right:calc(-50% + 20px)}
      #menu-controls button:not(.icon-options button),#echo-deployment button,.custom-card-holder .row button{min-height:38px;padding:8px 12px;border:1px solid #d7dcef;border-radius:8px;background:#fff;color:#5038ce;font:inherit;font-size:.82rem;font-weight:700;box-shadow:none}
      #menu-controls button:not(.icon-options button):hover,#echo-deployment button:hover,.custom-card-holder .row button:hover{border-color:#8e7de6;background:#f5f2ff}
      #menu-controls [data-remove-toggle],#menu-controls [data-remove-status],.menu-secondary-settings [data-remove-detection-type]{color:#a23b53!important;border-color:#efd1d9!important;background:#fff9fa!important}
      #echo-deployment #echo-create-dashboard{background:#523bd7;color:#fff;border-color:#523bd7;box-shadow:0 4px 10px #523bd726}
      #echo-deployment #echo-create-dashboard:hover{background:#422bc3;border-color:#422bc3}
      #menu-controls .toggle-config .row label,#menu-controls .toggle-config select,#menu-controls .toggle-config .icon-control{min-width:0;max-width:100%;box-sizing:border-box}
      #menu-controls .toggle-config select{width:100%}
      @media(max-width:900px){.quick-steps{grid-template-columns:repeat(5,minmax(0,1fr))}}
      @media(max-width:560px){.quick-steps{grid-template-columns:1fr}.quick-steps li:not(:last-child)::after{display:none}}
      .echo-preview-screen{aspect-ratio:16/10;min-height:0;box-sizing:border-box;display:flex;flex-direction:column}
      .echo-preview-nav{flex:none;padding:5px 6px}
      .echo-preview-nav span{padding:4px 2px}
      .echo-preview-content{min-height:0;flex:1;padding:8px;overflow:auto}.echo-preview-content::-webkit-scrollbar{width:7px}.echo-preview-content{scrollbar-width:thin}.preview-scroll-hint{display:block;position:sticky;bottom:0;padding:4px 6px;border-radius:5px;background:#eef0ff;color:#4e5980}
      .echo-preview-content>strong{font-size:.78rem}
      .echo-preview-tiles{grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin-top:5px}
      .echo-preview-tiles.preview-cols-1{grid-template-columns:1fr}.echo-preview-tiles.preview-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.echo-preview-tiles span{min-height:0;aspect-ratio:16/9;padding:3px;font-size:.58rem;position:relative}.echo-preview-tiles span.span-2{grid-column:span 2}.echo-preview-tiles span.span-3{grid-column:span 3}.echo-preview-tiles span img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#090b0d;opacity:.72}.echo-preview-tiles span b{position:relative;z-index:1;padding:2px 4px;border-radius:3px;background:#0009;color:#fff;font-size:.58rem}
      .echo-preview-content small{margin-top:4px;font-size:.62rem}
      .deployment-device-screen{aspect-ratio:16/10;min-height:0;box-sizing:border-box;padding:clamp(8px,2vw,18px)}
      .device-menu-grid{gap:7px;margin:12px 0}
      .device-menu-grid>div{min-height:0;padding:7px}
      @media(min-width:1101px) and (max-width:1450px){.menus-workspace{grid-template-columns:minmax(125px,145px) minmax(0,1fr) minmax(220px,235px)}}
      .icon-preview:not(:has(ha-icon)){font-size:0}
      .icon-preview:not(:has(ha-icon))::after{content:"—";font-size:1rem;color:#8790aa}
      @media(max-width:900px){.section-nav{scrollbar-width:none}.section-nav::-webkit-scrollbar{display:none}}
      .builder-dialog[hidden]{display:none}.builder-dialog{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:20px;background:#1c214766}.builder-dialog-card{width:min(420px,100%);padding:22px;border:1px solid #dfe3f0;border-radius:14px;background:#fff;box-shadow:0 20px 60px #20264a40}.builder-dialog-card h3{margin:0 0 8px}.builder-dialog-card p{margin:0 0 14px;color:var(--builder-muted);line-height:1.45}.builder-dialog-card input{width:100%;margin:4px 0 6px}.builder-dialog-error{min-height:20px;color:#a23b53;font-size:.82rem}.builder-dialog-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:14px}.builder-dialog-actions button{min-height:38px;padding:8px 13px;border:1px solid #d7dcef;border-radius:8px;background:#fff;color:#5038ce;font:inherit;font-weight:700}.builder-dialog-actions button:last-child{border-color:#523bd7;background:#523bd7;color:#fff}
    </style>
      <nav class="section-nav" aria-label="Builder workspace"><button type="button" data-section-target="overview">Overview</button><button type="button" data-section-target="menus">Menus &amp; Content</button><button type="button" data-section-target="controls">Controls &amp; Status</button><button type="button" data-section-target="deployment">Deployment</button></nav>
      <div class="section quick-start" id="quick-start"><h3>Overview</h3><div class="hint">Choose a saved Dash, arrange its menus and controls, then apply it to an Echo.</div><ol class="quick-steps"><li><button type="button" data-section-target="overview">Choose or add a Dash</button></li><li><button type="button" data-section-target="menus">Choose menus, entities and navigation</button></li><li><button type="button" data-section-target="controls">Add clock, temperature or actions</button></li><li><button type="button" data-section-target="deployment">Save and apply to one Echo</button></li></ol><div class="readiness-grid">${readinessItems.map((item) => `<span class="readiness ${item.ok ? "ready" : "needs-attention"}">${item.ok ? "✓" : "!"} ${escapeHtml(item.label)}</span>`).join("")}</div>${dependencyIssues.length ? `<div class="dependency-warning"><strong>Missing card dependencies:</strong> ${escapeHtml(dependencyIssues.join(", "))}. Sync the Content Library after installing those cards before applying this Dash.</div>` : `<div class="hint readiness-ok">No missing card dependencies detected.</div>`}</div>
      ${builderPath !== wantedBuilderPath ? `<div class="section"><h3>Builder dashboard address</h3><div class="hint">Move this master builder to /${wantedBuilderPath}. Its saved setups and preview are kept; Echo dashboards are not changed.</div><button id="move-builder-path" type="button">Use builder address</button><div id="move-builder-status" class="hint" aria-live="polite"></div></div>` : ""}
      <div class="section" id="setup-library"><h3>Dash Library (${savedProfiles.length})</h3><div class="hint">A Dash name is permanent. Select it to edit its own settings, add a blank Dash, or copy the selected Dash under a new name.</div>
        <div class="row"><label for="saved-profile">Dash name</label><select id="saved-profile"><option value="">Select a Dash</option>${savedProfiles.map((profile: any) => `<option value="${escapeHtml(profile.id)}" ${profile.id === selectedProfileId ? "selected" : ""}>${escapeHtml(profile.name)}</option>`).join("")}</select></div>
        <div class="row"><button id="add-profile" type="button">Add Dash</button><button id="copy-profile" type="button" ${selectedProfileId ? "" : "disabled"}>Copy Dash</button><button id="remove-profile" type="button" ${selectedProfileId ? "" : "disabled"}>Delete Dash</button></div><div id="dash-library-status" class="hint" aria-live="polite"></div></div>
      <div id="builder-dialog" class="builder-dialog" hidden role="dialog" aria-modal="true" aria-labelledby="builder-dialog-title"><div class="builder-dialog-card"><h3 id="builder-dialog-title"></h3><p id="builder-dialog-message"></p><label id="builder-dialog-input-label" for="builder-dialog-input">Name</label><input id="builder-dialog-input" type="text" autocomplete="off"><div id="builder-dialog-error" class="builder-dialog-error" aria-live="polite"></div><div class="builder-dialog-actions"><button id="builder-dialog-cancel" type="button">Cancel</button><button id="builder-dialog-confirm" type="button">Continue</button></div></div></div>
      <details class="section custom-card-holder"><summary>Custom Card Holder</summary><div class="holder-content"><div class="hint">A separate, genuine Home Assistant Lovelace dashboard for native Copy Card and Paste Card. It is builder-only: it never becomes an Echo menu or is exported to an Echo dashboard.</div><div class="row"><button id="open-card-holder" type="button">Open Custom Card Holder</button><button id="sync-card-holder" type="button" ${this.config.card_holder_url_path ? "" : "disabled"}>Sync card library</button></div><div id="card-holder-status" class="hint" aria-live="polite"></div>${cardLibrary.length ? `<ul>${cardLibrary.map((card) => `<li class="camera"><span>${escapeHtml(card.name)} — ${escapeHtml(card.card_type)} — ${escapeHtml(card.id)}${card.missing ? " (missing from holder)" : ""}</span><label>Display name <input type="text" data-card-library-name="${escapeHtml(card.id)}" value="${escapeHtml(card.name)}"></label></li>`).join("")}</ul><div class="hint">Names are builder metadata; they do not change the original Lovelace card. Missing cards retain their ID so references cannot redirect.</div>` : `<div class="hint">No cards have been discovered yet. Paste cards into the holder, save them normally, then Sync card library.</div>`}</div></details>
      <div class="section" id="dashboard-content"><h3>Dashboard Content and Menus (${menuProfiles.length})</h3><div class="hint">Choose a menu from the list, then edit its content in the panel beside it.</div><div class="menus-workspace">${menuWorkspaceList}<div class="menu-workspace-editor">${menuEditors}<details class="menu-secondary-settings"><summary>Camera and detection defaults</summary><div class="row"><label>Default camera image refresh <select id="camera-refresh-default">${[100, 250, 500, 1000, 2000, 3000, 5000, 10000, 15000].map((value) => `<option value="${value}" ${cameraRefreshInterval === value ? "selected" : ""}>${value === 100 ? "Every 100 ms (10 fps, maximum load)" : value === 250 ? "Every 250 ms (4 fps, high load)" : value === 500 ? "Every 500 ms (2 fps)" : `Every ${value / 1000} seconds`}</option>`).join("")}</select></label></div><div class="hint">Per-camera overrides remain inside each camera.</div><div class="menu-toggles"><h4>Detection styles (${detectionTypes.length})</h4><div class="hint">Types are discovered from matching entity names.</div>${detectionEditors}<button id="add-detection-type" type="button">Add detection type</button></div></details></div></div></div>
      <div class="section" id="menu-controls"><h3>Menu-Bar Controls</h3><div class="hint">These controls apply across the dashboard, rather than to one menu.</div><div class="menu-toggles"><h4>Status displays (${menuStatuses.length})</h4><div class="hint">Show live time or an entity value, such as a room temperature. A display can optionally be tapped to navigate or run a service.</div>${statusEditors}<button id="add-menu-status" type="button">Add status display</button></div><div class="menu-toggles"><h4>Menu-bar toggles (${menuToggles.length})</h4><div class="hint">Add stateful controls such as Meeting mode. Their colour and text follow the chosen helper or switch, and you can run separate actions when turning on and off.</div>${toggleEditors}<button id="add-menu-toggle" type="button">Add toggle</button></div></div>
      <div class="section" id="echo-deployment"><h3>Echo Assignment and Deployment</h3><div class="save-explainer">Save Dash stores this named Dash in the library. Apply Dash to Echo saves it, creates or replaces the selected Echo dashboard, and attaches it to that device.</div><div class="hint">Your setups are saved in this builder and previewed here. Applying one creates its Echo dashboard; the previous dashboard made here for that Echo is removed after the new one is attached. The builder stays available for editing and preview.</div>
        <div class="deployment-layout"><div class="deployment-settings-panel"><h4>Device &amp; presentation</h4>
        <div class="row"><label for="echo-target">Echo Show</label><select id="echo-target" size="${Math.min(Math.max(targets.length + 1, 2), 5)}">${targets.length ? `<option value="">Select a device</option>${targets.map((target) => `<option value="${target.key}" ${target.key === selectedTarget ? "selected" : ""}>${target.label}</option>`).join("")}` : `<option value="">No TECHO5 devices discovered</option>`}</select></div>
        <div class="row"><label for="echo-mode">Presentation</label><select id="echo-mode"><option ${selectedMode === "Streamed" ? "selected" : ""}>Streamed</option><option ${selectedMode === "Drawn on the device" ? "selected" : ""}>Drawn on the device</option></select></div>
        <div class="row"><input id="echo-idle" type="checkbox" ${selectedIdle ? "checked" : ""}><label for="echo-idle">Dashboard when idle</label></div>
        <div class="row"><label for="kiosk-mode">Kiosk on this Echo</label><select id="kiosk-mode"><option value="enabled" ${selectedKioskMode === "enabled" ? "selected" : ""}>Enabled</option><option value="disabled" ${selectedKioskMode === "disabled" ? "selected" : ""}>Disabled</option><option value="inherit" ${selectedKioskMode === "inherit" ? "selected" : ""}>Inherit</option></select></div><div class="hint">This setting is used only when applying this Dash to an Echo. It never changes the builder dashboard.</div></div><div class="deployment-publish-panel"><h4>Readiness &amp; publish</h4><ul class="deployment-readiness">${readinessItems.map((item) => `<li class="${item.ok ? "ready" : "needs-attention"}">${item.ok ? "✓" : "!"} ${escapeHtml(item.label)}</li>`).join("")}</ul>
        <div class="row deployment-actions"><button id="save-profile" type="button" ${selectedProfileId ? "" : "disabled"}>Save Dash</button><button id="echo-create-dashboard" type="button" ${activeTarget && selectedProfileId ? "" : "disabled"}>Apply Dash to Echo</button><div class="action-feedback hint" aria-live="polite"><span id="save-profile-status"></span><span id="echo-create-status"></span></div></div>
        <div class="save-explainer">Save Dash updates the selected Dash in the library. Apply Dash to Echo saves that Dash, then creates or replaces the selected Echo dashboard.</div></div></div>
        <details class="menu-toggles"><summary>Apply a standard Home Assistant dashboard</summary><div class="hint">This assigns an existing dashboard without changing it or adding a kiosk override.</div><div class="row"><label>Dashboard <select id="standard-dashboard">${this.standardDashboards.map((dashboard) => `<option value="${escapeHtml(dashboard.title)}">${escapeHtml(dashboard.title)}</option>`).join("")}</select></label><button id="echo-apply-standard" type="button" ${activeTarget ? "" : "disabled"}>Apply standard dashboard</button></div><div id="standard-dashboard-status" class="hint" aria-live="polite"></div></details>
        <div class="hint">Current assignment: ${activeTarget ? `${String(this._hass?.states[activeTarget.dashboard]?.state || "unknown")} / ${String(this._hass?.states[activeTarget.dashboardToShow]?.state || "unknown")} / idle ${String(this._hass?.states[activeTarget.idle]?.state || "unknown")}` : "Select a device to read its current settings."}</div>
      </div>
      <div class="section"><h3>Echo dashboards applied from this builder</h3><div class="deployment-history-panel"><div><strong>Deployment history</strong><div class="hint">Applying a new setup replaces the previous builder dashboard for that same Echo.</div></div>${managedDashboardList}<div id="managed-delete-status" class="hint" aria-live="polite"></div></div></div>
      `;
      root.querySelector(".section-nav")?.insertAdjacentHTML("beforebegin", `<header class="builder-app-header"><div class="brand-mark" aria-hidden="true"><span></span><span></span></div><div class="brand-copy"><strong>Echo Dash Builder</strong><small>Dashboard workspace</small></div><div class="header-spacer"></div><span class="header-dash-name">${escapeHtml(savedProfiles.find((profile) => profile.id === selectedProfileId)?.name || "Choose a Dash")}</span><button type="button" id="header-save-profile" ${selectedProfileId ? "" : "disabled"}>Save Draft</button><button type="button" data-section-target="menus">Edit menus</button><button type="button" data-section-target="deployment" class="primary-action">Review deployment <span aria-hidden="true">↗</span></button></header>`);
    const menuSection = root.querySelector<HTMLElement>("#dashboard-content");
    menuSection?.querySelector(".menus-workspace")?.insertAdjacentHTML("beforeend", `<aside class="menu-preview-panel"><div class="panel-heading"><div><span class="eyebrow">PREVIEW</span><h4>Menu layout</h4></div></div><p class="hint">A layout guide for the selected menu.</p><div data-menu-preview>${menuPreviewMarkup(selectedMenu)}</div><div class="preview-note">The Echo uses the selected device and its available entities when this Dash is applied.</div></aside>`);
    menuSection?.querySelectorAll<HTMLDetailsElement>("[data-menu-card]").forEach((card) => {
      card.hidden = card.dataset.menuCard !== this.selectedMenuId;
      if (!card.hidden) card.open = true;
    });
    const menuEditor = menuSection?.querySelector<HTMLElement>(".menu-workspace-editor");
    menuEditor?.insertAdjacentHTML("afterbegin", `<div class="selected-menu-heading" data-selected-menu-heading><div><span class="eyebrow">EDITING MENU</span><h4>${escapeHtml(selectedMenu?.label || "Choose a menu")}</h4><p>Configure the button and the content it shows on the Echo.</p></div><span class="editing-badge">Editing</span></div>`);
    const selectedMenuCard = menuEditor?.querySelector<HTMLDetailsElement>(`[data-menu-card="${CSS.escape(this.selectedMenuId)}"]`);
    selectedMenuCard?.insertAdjacentHTML("afterend", `<div data-included-items>${includedItemsMarkup(selectedMenu)}</div>`);
    const includedItems = menuEditor?.querySelector<HTMLElement>("[data-included-items]");
    if (includedItems) (selectedMenuCard?.querySelector(".content-picker") || selectedMenuCard)?.before(includedItems);
    const cardLibrarySection = root.querySelector<HTMLElement>(".custom-card-holder");
    if (menuSection && cardLibrarySection) menuSection.querySelector(".menu-workspace-list")?.append(cardLibrarySection);
    const libraryHeading = cardLibrarySection?.querySelector("summary");
    if (libraryHeading) libraryHeading.textContent = `Content Library (${cardLibrary.length})`;
    const menuHeading = menuSection?.querySelector("h3");
    if (menuHeading) menuHeading.textContent = `Menus & Content (${menuProfiles.length})`;
    const controlsHeading = root.querySelector<HTMLElement>("#menu-controls h3");
    if (controlsHeading) controlsHeading.textContent = "Controls & Status";
    const deploymentHeading = root.querySelector<HTMLElement>("#echo-deployment h3");
    if (deploymentHeading) deploymentHeading.textContent = "Deployment";
    root.querySelector<HTMLElement>(".deployment-publish-panel")?.insertAdjacentHTML("beforebegin", `<aside class="deployment-preview-panel"><div class="panel-heading"><div><span class="eyebrow">DEVICE PREVIEW</span><h4>${escapeHtml(activeTarget?.label || "Echo Show")}</h4></div></div><p class="hint">A layout guide for this saved Dash.</p><div class="deployment-device-frame"><div class="deployment-device-screen"><div class="device-topline"><strong>${escapeHtml(savedProfiles.find((profile) => profile.id === selectedProfileId)?.name || "Echo dashboard")}</strong><span>Echo layout</span></div><div class="device-menu-grid">${menuProfiles.slice(0, 4).map((menu) => `<div><strong>${escapeHtml(menu.label)}</strong><small>${menu.action === "navigate" ? "Navigation" : menu.source === "lovelace_card" ? `${menu.lovelace_card_ids?.length || 0} cards` : `${(menu.cameras?.length || 0) + (menu.lights?.length || 0) + (menu.temperatures?.length || 0)} items`}</small></div>`).join("")}</div><div class="device-bottom-nav">${menuProfiles.slice(0, 5).map((menu) => `<span>${escapeHtml(menu.label)}</span>`).join("")}</div></div></div><div class="preview-note">This preview shows the configured structure. Camera images and live states appear on the actual dashboard.</div>${managedPreview ? `<button type="button" id="open-applied-preview" data-dashboard-path="/${escapeHtml(managedPreview.url_path)}/home">Open applied dashboard</button>` : ""}</aside>`);
    root.querySelector<HTMLElement>(".deployment-readiness")?.insertAdjacentHTML("afterend", `<div class="publish-summary"><strong>Publish summary</strong><dl><div><dt>Saved Dash</dt><dd>${escapeHtml(savedProfiles.find((profile) => profile.id === selectedProfileId)?.name || "None selected")}</dd></div><div><dt>Target Echo</dt><dd>${escapeHtml(activeTarget?.label || "None selected")}</dd></div><div><dt>Menus</dt><dd>${menuProfiles.length}</dd></div><div><dt>Device dashboard</dt><dd>${managedPreview ? "Replace current builder dashboard" : "Create new dashboard"}</dd></div></dl></div>`);
    const managedHistorySection = root.querySelector<HTMLElement>("#managed-delete-status")?.closest<HTMLElement>(".section");
    const deploymentLayout = root.querySelector<HTMLElement>(".deployment-layout");
    if (managedHistorySection && deploymentLayout) deploymentLayout.appendChild(managedHistorySection);
    const overview = root.querySelector<HTMLElement>("#quick-start");
    if (overview && !overview.querySelector(".overview-cards")) {
      overview.insertAdjacentHTML("afterbegin", `<div class="overview-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:8px 0 14px"><div class="overview-card" style="padding:10px;border:1px solid var(--builder-line);border-radius:8px"><span>Dash</span><strong style="display:block;margin-top:4px">${escapeHtml(savedProfiles.find((profile: any) => profile.id === selectedProfileId)?.name || "Not selected")}</strong></div><div class="overview-card" style="padding:10px;border:1px solid var(--builder-line);border-radius:8px"><span>Echo target</span><strong style="display:block;margin-top:4px">${escapeHtml(activeTarget?.label || "Not selected")}</strong></div><div class="overview-card" style="padding:10px;border:1px solid var(--builder-line);border-radius:8px"><span>Menus</span><strong style="display:block;margin-top:4px">${menuProfiles.length}</strong></div><div class="overview-card" style="padding:10px;border:1px solid var(--builder-line);border-radius:8px"><span>Controls &amp; status</span><strong style="display:block;margin-top:4px">${menuToggles.length + menuStatuses.length}</strong></div><div class="overview-card" style="padding:10px;border:1px solid var(--builder-line);border-radius:8px"><span>Deployment</span><strong style="display:block;margin-top:4px">${selectedProfileId && selectedTarget && !dependencyIssues.length ? "Ready" : "Needs setup"}</strong></div></div>`);
      overview.insertAdjacentHTML("beforeend", `<div class="overview-panels"><div class="overview-panel"><div class="overview-panel-heading"><h4>Dashboard structure</h4><button type="button" data-section-target="menus">Edit menus</button></div>${menuProfiles.length ? `<ul>${menuProfiles.map((menu, index) => `<li><span>${index + 1}. ${escapeHtml(menu.label)}</span><small>${menu.action === "navigate" ? "Navigation" : menu.source === "lovelace_card" ? `${menu.lovelace_card_ids?.length || 0} cards` : `${(menu.cameras?.length || 0) + (menu.lights?.length || 0) + (menu.temperatures?.length || 0)} items`}</small></li>`).join("")}</ul>` : `<p class="hint">No menus configured yet.</p>`}</div><div class="overview-panel"><div class="overview-panel-heading"><h4>Controls &amp; status</h4><button type="button" data-section-target="controls">Manage</button></div><ul><li><span>Menu-bar toggles</span><small>${menuToggles.length}</small></li><li><span>Status displays</span><small>${menuStatuses.length}</small></li></ul></div></div>`);
      overview.querySelectorAll<HTMLElement>(".overview-cards, .overview-card, .overview-card strong").forEach((item) => item.removeAttribute("style"));
      overview.insertAdjacentHTML("afterbegin", `<div class="overview-hero"><div><span class="eyebrow">OVERVIEW</span><h2>${escapeHtml(savedProfiles.find((profile) => profile.id === selectedProfileId)?.name || "Build your Echo dashboard")}</h2><p>${escapeHtml(activeTarget?.label || "No Echo selected")} · ${menuProfiles.length} menus · ${menuToggles.length + menuStatuses.length} controls and status displays</p></div><span class="hero-state ${selectedProfileId && selectedTarget && !dependencyIssues.length ? "ready" : "draft"}">${selectedProfileId && selectedTarget && !dependencyIssues.length ? "Ready to apply" : "Setup in progress"}</span></div>`);
      const quickSteps = overview.querySelector<HTMLElement>(".quick-steps");
      if (quickSteps) quickSteps.innerHTML = [
        ["Choose Dash", "overview", Boolean(selectedProfileId)],
        ["Add menus & content", "menus", menuProfiles.length > 0],
        ["Set controls", "controls", menuToggles.length + menuStatuses.length > 0],
        ["Assign Echo", "deployment", Boolean(selectedTarget)],
        ["Apply to Echo", "deployment", Boolean(managedPreview)],
      ].map(([label, page, complete]) => `<li class="${complete ? "complete" : ""}"><button type="button" data-section-target="${page}">${label}</button></li>`).join("");
      const main = document.createElement("div");
      main.className = "overview-main";
      while (overview.firstChild) main.appendChild(overview.firstChild);
      overview.appendChild(main);
      overview.insertAdjacentHTML("beforeend", `<aside class="overview-rail"><div class="rail-card"><div class="panel-heading"><div><span class="eyebrow">DEVICE</span><h4>Device &amp; presentation</h4></div></div><dl><div><dt>Echo assignment</dt><dd>${escapeHtml(activeTarget?.label || "No device selected")}</dd></div><div><dt>Presentation</dt><dd>${escapeHtml(selectedMode)}</dd></div><div><dt>Kiosk mode</dt><dd>${escapeHtml(selectedKioskMode)}</dd></div></dl><button type="button" data-section-target="deployment">Configure device →</button></div><div class="rail-card"><div class="panel-heading"><div><span class="eyebrow">PUBLISH</span><h4>Publish status</h4></div></div><div class="rail-status ${selectedProfileId && selectedTarget && !dependencyIssues.length ? "ready" : "draft"}">${selectedProfileId && selectedTarget && !dependencyIssues.length ? "Ready to apply" : "Needs setup"}</div><p>${selectedProfileId && selectedTarget ? "Your saved Dash can be applied to the selected Echo." : "Choose a Dash and Echo to prepare a deployment."}</p><button type="button" data-section-target="deployment">Review deployment →</button></div></aside>`);
    }
    root.querySelector<HTMLElement>("#setup-library h3")?.insertAdjacentHTML("afterend", `<div class="dash-library-grid">${savedProfiles.map((profile) => `<button type="button" data-profile-tile="${escapeHtml(profile.id)}" class="dash-library-tile ${profile.id === selectedProfileId ? "current" : ""}"><span class="dash-tile-icon">▣</span><strong>${escapeHtml(profile.name)}</strong>${profile.id === selectedProfileId ? `<small>Current</small>` : ""}</button>`).join("")}<button type="button" id="new-dash-tile" class="dash-library-tile add-tile"><span>＋</span><strong>New Dash</strong></button></div>`);
    root.querySelectorAll<HTMLDetailsElement>("[data-menu-card]").forEach((card) => card.addEventListener("toggle", () => {
      const id = card.dataset.menuCard || "";
      if (card.open) {
        root.querySelectorAll<HTMLDetailsElement>("[data-menu-card]").forEach((other) => {
          if (other !== card && other.open) other.open = false;
          if (other !== card) EchoShowEditor.openMenuCards[other.dataset.menuCard || ""] = false;
        });
      }
      EchoShowEditor.openMenuCards[id] = card.open;
    }));
    // Status displays use the same complete icon-and-text alignment control as
    // menu buttons and toggles.  Add it beside their placement/order controls.
    root.querySelectorAll<HTMLElement>("[data-status-card]").forEach((card) => {
      const status = menuStatuses.find((item) => item.id === card.dataset.statusCard);
      const row = card.querySelector("[data-status-placement]")?.closest(".row");
      if (!row) return;
      const alignment = status?.alignment === "center" || status?.alignment === "right" ? status.alignment : "left";
      row.insertAdjacentHTML("beforeend", `<label>Content alignment <select data-status-alignment><option value="left" ${alignment === "left" ? "selected" : ""}>Left</option><option value="center" ${alignment === "center" ? "selected" : ""}>Centre</option><option value="right" ${alignment === "right" ? "selected" : ""}>Right</option></select></label>`);
    });
    root.querySelectorAll<HTMLSelectElement>("[data-menu-icon-placement], [data-toggle-icon-placement]").forEach((select) => {
      const label = select.closest("label");
      if (label?.firstChild?.nodeType === Node.TEXT_NODE) label.firstChild.textContent = "Content alignment ";
    });
    const pageSections: Record<string, string[]> = {
      overview: ["quick-start", "setup-library"],
      menus: ["dashboard-content"],
      controls: ["menu-controls"],
      deployment: ["echo-deployment"],
    };
    const selectPage = (page: string, scroll = false) => {
      if (!pageSections[page]) return;
      this.activeWorkspacePage = page;
      root.querySelectorAll<HTMLElement>(".section").forEach((section) => {
        const isLibrary = section.matches(".custom-card-holder");
        const isManaged = Boolean(section.querySelector("#managed-delete-status"));
        const isAddress = Boolean(section.querySelector("#move-builder-path"));
        section.hidden = !(pageSections[page].includes(section.id) ||
          (page === "menus" && isLibrary) ||
          (page === "deployment" && isManaged) ||
          (page === "overview" && isAddress));
      });
      root.querySelectorAll<HTMLButtonElement>(".section-nav [data-section-target]").forEach((item) => {
        const active = item.dataset.sectionTarget === page;
        item.classList.toggle("active", active);
        if (active) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
      });
      if (scroll) root.querySelector<HTMLElement>(`#${pageSections[page][0]}`)?.scrollIntoView({ block: "start" });
    };
    root.querySelectorAll<HTMLButtonElement>("[data-section-target]").forEach((button) => button.addEventListener("click", () => selectPage(button.dataset.sectionTarget || "", true)));
    root.querySelector<HTMLButtonElement>("#header-save-profile")?.addEventListener("click", () => root.querySelector<HTMLButtonElement>("#save-profile")?.click());
    root.querySelectorAll<HTMLButtonElement>("[data-profile-tile]").forEach((button) => button.addEventListener("click", () => {
      const select = root.querySelector<HTMLSelectElement>("#saved-profile");
      if (select) { select.value = button.dataset.profileTile || ""; select.dispatchEvent(new Event("change", { bubbles: true })); }
    }));
    root.querySelector<HTMLButtonElement>("#new-dash-tile")?.addEventListener("click", () => root.querySelector<HTMLButtonElement>("#add-profile")?.click());
    root.querySelector<HTMLButtonElement>("#open-applied-preview")?.addEventListener("click", (event) => {
      const path = localDashboardPath((event.currentTarget as HTMLButtonElement).dataset.dashboardPath);
      if (path) window.open(path, "_blank", "noopener");
    });
    root.querySelectorAll<HTMLButtonElement>("[data-menu-focus]").forEach((button) => button.addEventListener("click", () => {
      const card = root.querySelector<HTMLDetailsElement>(`[data-menu-card="${CSS.escape(button.dataset.menuFocus || "")}"]`);
      this.selectedMenuId = button.dataset.menuFocus || "";
      root.querySelectorAll<HTMLButtonElement>("[data-menu-focus]").forEach((item) => {
        item.classList.toggle("selected", item === button);
        if (item === button) item.setAttribute("aria-current", "true");
        else item.removeAttribute("aria-current");
      });
      const preview = root.querySelector<HTMLElement>("[data-menu-preview]");
      const currentMenu = menuProfiles.find((menu) => menu.id === this.selectedMenuId);
      if (preview) preview.innerHTML = menuPreviewMarkup(currentMenu);
      const selectedHeading = root.querySelector<HTMLElement>("[data-selected-menu-heading] h4");
      if (selectedHeading) selectedHeading.textContent = currentMenu?.label || "Choose a menu";
      const included = root.querySelector<HTMLElement>("[data-included-items]");
      if (included) {
        included.innerHTML = includedItemsMarkup(currentMenu);
        (card?.querySelector(".content-picker") || card)?.before(included);
      }
      root.querySelectorAll<HTMLDetailsElement>("[data-menu-card]").forEach((item) => {
        item.hidden = item !== card;
        if (item !== card) item.open = false;
      });
      if (card) { card.open = true; card.scrollIntoView({ behavior: "smooth", block: "start" }); }
    }));
    selectPage(this.activeWorkspacePage);
    root.querySelectorAll<HTMLButtonElement>("[data-delete-managed]").forEach((button) => button.addEventListener("click", async () => {
      const dashboard = this.managedDashboards.find((item) => item.id === button.dataset.deleteManaged);
      if (!dashboard || await openBuilderDialog({ title: `Remove “${dashboard.title}”?`, message: `This removes the managed dashboard at ${dashboard.url_path}. It does not remove the Echo device.`, kind: "confirm", confirmLabel: "Remove dashboard" }) !== true) return;
      try {
        await this.callWS({ type: "lovelace/dashboards/delete", dashboard_id: dashboard.id });
        this.managedDashboards = this.managedDashboards.filter((item) => item.id !== dashboard.id);
        this.render();
        const message = this.shadowRoot?.querySelector<HTMLElement>("#managed-delete-status");
        if (message) message.textContent = `Removed “${dashboard.title}”.`;
      } catch (error) {
        const message = this.shadowRoot?.querySelector<HTMLElement>("#managed-delete-status");
        if (message) message.textContent = `Could not remove “${dashboard.title}”: ${String(error)}`;
      }
    }));
    root.querySelector<HTMLButtonElement>("#move-builder-path")?.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const status = root.querySelector<HTMLElement>("#move-builder-status");
      button.disabled = true;
      if (status) status.textContent = "Moving the builder dashboard…";
      try {
        const dashboards = await this.callWS({ type: "lovelace/dashboards/list" });
        if (!Array.isArray(dashboards)) throw new Error("Home Assistant did not return the dashboard list.");
        if (dashboards.some((dashboard: any) => String(dashboard.url_path) === wantedBuilderPath)) throw new Error(`/${wantedBuilderPath} is already in use.`);
        const source = await this.callWS({ type: "lovelace/config", url_path: builderPath });
        const created = await this.callWS({ type: "lovelace/dashboards/create", url_path: wantedBuilderPath, title: "Echo Show Dash Builder", show_in_sidebar: true, require_admin: false });
        await this.callWS({ type: "lovelace/config/save", url_path: wantedBuilderPath, config: source });
        const old = dashboards.find((dashboard: any) => String(dashboard.url_path) === builderPath);
        if (old?.id) await this.callWS({ type: "lovelace/dashboards/delete", dashboard_id: old.id });
        window.location.assign(`/${wantedBuilderPath}/home`);
      } catch (error) {
        if (status) status.textContent = `Could not move the builder address: ${String(error)}`;
        button.disabled = false;
      }
    });
    const readMenuProfiles = (): EchoMenuConfig[] => Array.from(root.querySelectorAll<HTMLElement>("[data-menu-card]")).map((card, index) => {
      const id = card.dataset.menuCard || `menu-${index + 1}`;
      const existing = menuProfiles.find((menu) => menu.id === id);
      const readSelection = (selector: string, previous: string[] = []) => {
        const visible = Array.from(card.querySelectorAll<HTMLInputElement>(selector));
        const visibleIds = new Set(visible.map((input) => input.value));
        return [
          ...previous.filter((entity) => !visibleIds.has(entity)),
          ...visible.filter((input) => input.checked).map((input) => input.value),
        ];
      };
      return {
        id,
        label: card.querySelector<HTMLInputElement>("[data-menu-label]")?.value.trim() || `Menu ${index + 1}`,
        icon: card.querySelector<HTMLInputElement>("[data-menu-icon]")?.value.trim() || "",
        icon_placement: card.querySelector<HTMLSelectElement>("[data-menu-icon-placement]")?.value === "center" ? "center" : card.querySelector<HTMLSelectElement>("[data-menu-icon-placement]")?.value === "right" ? "right" : "left",
        cameras: readSelection("[data-menu-camera]", existing?.cameras),
        lights: readSelection("[data-menu-light]", existing?.lights),
        temperatures: readSelection("[data-menu-temperature]", existing?.temperatures),
        action: card.querySelector<HTMLSelectElement>("[data-menu-action]")?.value === "navigate" ? "navigate" : "view",
        destination: card.querySelector<HTMLSelectElement>("[data-menu-destination]")?.value === "__custom__"
          ? card.querySelector<HTMLInputElement>("[data-menu-custom-destination]")?.value.trim() || ""
          : card.querySelector<HTMLSelectElement>("[data-menu-destination]")?.value || "",
        source: card.querySelector<HTMLSelectElement>("[data-menu-source]")?.value === "lovelace_card" ? "lovelace_card" : "menu",
        lovelace_card_ids: Array.from(card.querySelectorAll<HTMLInputElement>("[data-menu-lovelace-card]:checked"), (input) => input.value),
        lovelace_card_layouts: existing?.lovelace_card_layouts || {},
      };
    });
    const rememberOpenPickers = () => {
      root.querySelectorAll<HTMLElement>("[data-menu-card]").forEach((card) => {
        const id = card.dataset.menuCard || "";
        EchoShowEditor.openMenuPickers[id] = Array.from(card.querySelectorAll<HTMLDetailsElement>("details.content-picker"), (picker) => picker.open);
      });
    };
    root.querySelector<HTMLSelectElement>("#saved-profile")?.addEventListener("change", (event) => {
      this.selectedProfileId = (event.target as HTMLSelectElement).value;
      const profile = savedProfiles.find((item) => item.id === this.selectedProfileId);
      if (profile) {
        this.emit({ ...profileSettings(profile), active_profile_id: profile.id }, true);
      } else {
        this.emit({ active_profile_id: "" }, true);
      }
    });
    const builderDialog = root.querySelector<HTMLElement>("#builder-dialog");
    const dialogTitle = root.querySelector<HTMLElement>("#builder-dialog-title");
    const dialogMessage = root.querySelector<HTMLElement>("#builder-dialog-message");
    const dialogInput = root.querySelector<HTMLInputElement>("#builder-dialog-input");
    const dialogInputLabel = root.querySelector<HTMLElement>("#builder-dialog-input-label");
    const dialogError = root.querySelector<HTMLElement>("#builder-dialog-error");
    const dialogConfirm = root.querySelector<HTMLButtonElement>("#builder-dialog-confirm");
    const dialogCancel = root.querySelector<HTMLButtonElement>("#builder-dialog-cancel");
    let resolveDialog: ((value: string | boolean | undefined) => void) | undefined;
    let dialogTrigger: HTMLElement | null = null;
    const closeBuilderDialog = (value: string | boolean | undefined) => {
      if (!builderDialog) return;
      builderDialog.hidden = true;
      const resolve = resolveDialog;
      resolveDialog = undefined;
      resolve?.(value);
      dialogTrigger?.focus();
      dialogTrigger = null;
    };
    const openBuilderDialog = (options: { title: string; message: string; kind: "name" | "confirm"; initial?: string; confirmLabel?: string }) => new Promise<string | boolean | undefined>((resolve) => {
      if (!builderDialog || !dialogTitle || !dialogMessage || !dialogConfirm || !dialogInput || !dialogInputLabel) { resolve(undefined); return; }
      resolveDialog = resolve;
      const shadowActive = this.shadowRoot?.activeElement;
      dialogTrigger = shadowActive instanceof HTMLElement ? shadowActive : (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      dialogTitle.textContent = options.title;
      dialogMessage.textContent = options.message;
      dialogConfirm.textContent = options.confirmLabel || (options.kind === "name" ? "Continue" : "Confirm");
      dialogInputLabel.hidden = options.kind !== "name";
      dialogInput.hidden = options.kind !== "name";
      dialogInput.value = options.initial || "";
      if (dialogError) dialogError.textContent = "";
      builderDialog.hidden = false;
      (options.kind === "name" ? dialogInput : dialogConfirm).focus();
    });
    dialogCancel?.addEventListener("click", () => closeBuilderDialog(undefined));
    dialogConfirm?.addEventListener("click", () => {
      if (dialogInput && !dialogInput.hidden) {
        const value = dialogInput.value.trim();
        if (!value) { if (dialogError) dialogError.textContent = "Enter a name to continue."; dialogInput.focus(); return; }
        if (savedProfiles.some((profile) => profile.name.localeCompare(value, undefined, { sensitivity: "accent" }) === 0)) {
          if (dialogError) dialogError.textContent = `A Dash named “${value}” already exists. Names must be unique.`;
          dialogInput.focus();
          return;
        }
        closeBuilderDialog(value);
        return;
      }
      closeBuilderDialog(true);
    });
    builderDialog?.addEventListener("click", (event) => { if (event.target === builderDialog) closeBuilderDialog(undefined); });
    builderDialog?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); closeBuilderDialog(undefined); return; }
      if (event.key === "Tab") {
        const focusables: HTMLElement[] = [dialogInput, dialogCancel, dialogConfirm].filter((item): item is HTMLInputElement | HTMLButtonElement => Boolean(item && !item.hidden && !item.disabled));
        if (!focusables.length) return;
        const active = this.shadowRoot?.activeElement || document.activeElement;
        const index = focusables.indexOf(active as HTMLElement);
        const next = focusables[(index + (event.shiftKey ? -1 : 1) + focusables.length) % focusables.length];
        event.preventDefault();
        next?.focus();
        return;
      }
      if (event.key === "Enter" && (event.target === dialogInput || this.shadowRoot?.activeElement === dialogInput)) { event.preventDefault(); dialogConfirm?.click(); }
    });
    const requestDashName = async (title: string, message: string): Promise<string | undefined> => {
      const result = await openBuilderDialog({ title, message, kind: "name", confirmLabel: "Use name" });
      if (typeof result !== "string" || !result) return undefined;
      return result;
    };
    root.querySelector<HTMLButtonElement>("#add-profile")?.addEventListener("click", async () => {
      const name = await requestDashName("Create a new Dash", "Choose a permanent name for this blank Dash.");
      if (!name) return;
      const id = `dash-${Date.now()}`;
      const profile: EchoSavedDashboardProfile = { id, name, menus: [], settings: { menus: [], menu_toggles: [], menu_statuses: [], camera_order: [], camera_overlays: {}, camera_spans: {}, camera_refresh_interval: 3000, camera_refresh_intervals: {}, camera_person_entities: {}, person_detection: { animation: "soft-pulse", color: "#ffc107", show_badge: false, badge_text: "Person" }, detection_types: [{ id: "person", label: "Person", match: "person", animation: "soft-pulse", color: "#ffc107", show_badge: false, badge_text: "Person" }, { id: "dog", label: "Dog", match: "dog", animation: "soft-pulse", color: "#7e57c2", show_badge: true, badge_text: "Dog" }], camera_detections: {}, kiosk_mode: "inherit", echo_target: "", echo_mode: "Streamed", echo_dashboard_when_idle: false } };
      this.selectedProfileId = id;
      this.emit({ ...profileSettings(profile), saved_profiles: [...savedProfiles, profile], active_profile_id: id }, true);
    });
    root.querySelector<HTMLButtonElement>("#copy-profile")?.addEventListener("click", async () => {
      const source = savedProfiles.find((profile) => profile.id === selectedProfileId);
      if (!source) return;
      const name = await requestDashName(`Copy “${source.name}”`, "Choose a new permanent name for the copied Dash.");
      if (!name) return;
      const id = `dash-${Date.now()}`;
      const copied: EchoSavedDashboardProfile = { ...JSON.parse(JSON.stringify(source)), id, name };
      this.selectedProfileId = id;
      this.emit({ ...profileSettings(copied), saved_profiles: [...savedProfiles, copied], active_profile_id: id }, true);
    });
    root.querySelector<HTMLButtonElement>("#remove-profile")?.addEventListener("click", async () => {
      const profile = savedProfiles.find((item) => item.id === selectedProfileId);
      if (!profile || await openBuilderDialog({ title: `Delete Dash “${profile.name}”?`, message: "This removes it from the builder library. Existing Echo dashboards will not be changed.", kind: "confirm", confirmLabel: "Delete Dash" }) !== true) return;
      const next = savedProfiles.filter((item: any) => item.id !== profile.id);
      this.selectedProfileId = "";
      this.emit({ saved_profiles: next, active_profile_id: "" }, true);
    });
    root.querySelector<HTMLButtonElement>("#save-profile")?.addEventListener("click", () => {
      const previous = savedProfiles.find((profile) => profile.id === selectedProfileId);
      const status = root.querySelector<HTMLElement>("#save-profile-status");
      if (!previous) { if (status) status.textContent = "Select or add a Dash first."; return; }
      const current = this.getCurrentConfig();
      const profile: EchoSavedDashboardProfile = {
        ...previous,
        menus: current.menus || [],
        settings: dashSettings(current),
      };
      const next = { ...current, saved_profiles: [...savedProfiles.filter((item) => item.id !== profile.id), profile], active_profile_id: profile.id };
      // Save Dash is the durable, intentional save point for the builder
      // library.  It must not depend on Home Assistant's generic editor footer.
      // Home Assistant sends this stored configuration straight back through
      // setConfig(). It is already on screen, so retain the current DOM for
      // this ordinary save instead of rebuilding the entire editor.
      this.preserveEditorOnNextConfig = true;
      void this.persistBuilderConfig(next).then(() => {
        this.config = next;
        this.selectedProfileId = profile.id;
        this.hasUnsavedChanges = false;
        // Saving persists the already-visible Dash.  Rebuilding the whole
        // editor here made every section re-measure and visibly jump.
        // Structural actions (add/copy/delete) still deliberately render.
        if (status) status.textContent = `Saved Dash “${profile.name}”.`;
      }).catch((error) => {
        this.preserveEditorOnNextConfig = false;
        if (status) status.textContent = `Could not save this Dash: ${String(error)}`;
      });
    });
    // Text fields commit on change (blur/Enter), not every keystroke.  Emitting
    // config-changed while typing makes Home Assistant recreate this editor and
    // returns its scroll position to the top.
    root.querySelectorAll<HTMLInputElement>("[data-overlay-show]").forEach((input) => input.addEventListener("change", () => this.emitCurrentConfig()));
    root.querySelectorAll<HTMLSelectElement>("[data-menu-order], [data-menu-action], [data-menu-destination], [data-menu-source], [data-menu-icon-placement], [data-menu-content-overflow], [data-order], [data-overlay-h], [data-overlay-v], [data-span], [data-camera-refresh], #camera-refresh-default, #kiosk-mode").forEach((input) => input.addEventListener("change", () => this.emitCurrentConfig()));
    const updateMenus = (rerender = false, persist = true) => {
      if (persist) this.emit({ menus: readMenuProfiles() }, rerender);
      if (!rerender) {
        root.querySelectorAll<HTMLElement>("[data-menu-card]").forEach((card, index) => {
          const menu = readMenuProfiles()[index];
          if (!menu) return;
          const counts: Array<[string, number]> = [
            ["[data-menu-camera]", menu.cameras?.length || 0],
            ["[data-menu-light]", menu.lights?.length || 0],
            ["[data-menu-temperature]", menu.temperatures?.length || 0],
          ];
          card.querySelectorAll<HTMLElement>("details.content-picker").forEach((picker, pickerIndex) => {
            const [selector, count] = counts[pickerIndex];
            const title = picker.querySelector<HTMLElement>("summary");
            if (title) {
              const name = selector === "[data-menu-camera]" ? "Cameras" : selector === "[data-menu-light]" ? "Choose lights" : "Temperature sensors";
              title.textContent = `${name} · ${count} selected`;
            }
          });
        });
      }
    };
    root.querySelectorAll<HTMLInputElement>("[data-menu-label], [data-menu-icon], [data-menu-icon-entity], [data-menu-custom-destination]").forEach((input) => input.addEventListener("change", () => {
      const card = input.closest<HTMLElement>("[data-menu-card]");
      const index = Array.from(root.querySelectorAll("[data-menu-card]")).indexOf(card!);
      const label = card?.querySelector<HTMLInputElement>("[data-menu-label]")?.value.trim() || `Menu ${index + 1}`;
      if (card) card.querySelector("summary")!.textContent = `Menu ${index + 1}: ${label}`;
      updateMenus();
    }));
    // The icon search is a floating panel.  It must never trap the editor:
    // Escape or clicking anywhere outside it closes it, even on narrow screens.
    root.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape") root.querySelectorAll<HTMLDetailsElement>(".icon-picker[open]").forEach((picker) => picker.removeAttribute("open"));
    });
    root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".icon-picker")) root.querySelectorAll<HTMLDetailsElement>(".icon-picker[open]").forEach((picker) => picker.removeAttribute("open"));
    });
    const showMenuIcon = (card: HTMLElement, icon: string) => {
      const preview = card.querySelector<HTMLElement>("[data-icon-preview]");
      if (preview) preview.innerHTML = icon ? `<ha-icon icon="${escapeHtml(icon)}"></ha-icon>` : "No icon";
    };
    // Keep the visual preview responsive without emitting changes while a user
    // types.  This avoids the editor jumping back to the top of the page.
    root.querySelectorAll<HTMLInputElement>("[data-menu-icon]").forEach((input) => input.addEventListener("input", () => {
      const card = input.closest<HTMLElement>("[data-menu-card]");
      if (card) showMenuIcon(card, input.value.trim());
    }));
    const bindIconChoice = (button: HTMLButtonElement) => button.addEventListener("click", () => {
      const card = button.closest<HTMLElement>("[data-menu-card]");
      const input = card?.querySelector<HTMLInputElement>("[data-menu-icon]");
      if (!card || !input) return;
      input.value = button.dataset.menuIconChoice || "";
      showMenuIcon(card, input.value);
      card.querySelector<HTMLDetailsElement>(".icon-picker")?.removeAttribute("open");
      updateMenus();
    });
    root.querySelectorAll<HTMLButtonElement>("[data-menu-icon-choice]").forEach(bindIconChoice);
    root.querySelectorAll<HTMLInputElement>("[data-icon-search]").forEach((input) => input.addEventListener("input", async () => {
      const picker = input.closest<HTMLElement>(".icon-picker");
      const options = picker?.querySelector<HTMLElement>(".icon-options");
      const status = picker?.querySelector<HTMLElement>(".icon-search-status");
      const query = input.value.trim().toLowerCase();
      if (!options || !status) return;
      if (!query) {
        options.innerHTML = MENU_ICON_CHOICES.map(([value, label]) => iconChoiceMarkup(value, label)).join("");
        status.textContent = "";
        options.querySelectorAll<HTMLButtonElement>("[data-menu-icon-choice]").forEach(bindIconChoice);
        return;
      }
      status.textContent = "Searching the Material Design icon library…";
      const names = await this.loadMdiIconNames();
      // Ignore an older request after the user has continued typing.
      if (input.value.trim().toLowerCase() !== query) return;
      const matches = names.filter((name) => name.includes(query)).slice(0, 48);
      options.innerHTML = matches.map((name) => iconChoiceMarkup(name, name.slice(4))).join("");
      status.textContent = matches.length ? `${matches.length} matching icons shown.` : names.length ? "No matching icons found." : "The full icon library could not be loaded; common choices remain available.";
      options.querySelectorAll<HTMLButtonElement>("[data-menu-icon-choice]").forEach(bindIconChoice);
    }));
    const showToggleIcon = (card: HTMLElement, icon: string) => {
      const preview = card.querySelector<HTMLElement>("[data-toggle-icon-preview]");
      if (preview) preview.innerHTML = icon ? `<ha-icon icon="${escapeHtml(icon)}"></ha-icon>` : "No icon";
    };
    root.querySelectorAll<HTMLInputElement>("[data-toggle-icon]").forEach((input) => input.addEventListener("input", () => {
      const card = input.closest<HTMLElement>("[data-toggle-card]");
      if (card) showToggleIcon(card, input.value.trim());
    }));
    const bindToggleIconChoice = (button: HTMLButtonElement) => button.addEventListener("click", () => {
      const card = button.closest<HTMLElement>("[data-toggle-card]");
      const input = card?.querySelector<HTMLInputElement>("[data-toggle-icon]");
      if (!card || !input) return;
      input.value = button.dataset.toggleIconChoice || "";
      showToggleIcon(card, input.value);
      card.querySelector<HTMLDetailsElement>(".icon-picker")?.removeAttribute("open");
      this.emit({ menu_toggles: readMenuToggles() }, false);
    });
    root.querySelectorAll<HTMLButtonElement>("[data-toggle-icon-choice]").forEach(bindToggleIconChoice);
    root.querySelectorAll<HTMLInputElement>("[data-toggle-icon-search]").forEach((input) => input.addEventListener("input", async () => {
      const picker = input.closest<HTMLElement>(".icon-picker");
      const options = picker?.querySelector<HTMLElement>(".icon-options");
      const status = picker?.querySelector<HTMLElement>(".icon-search-status");
      const query = input.value.trim().toLowerCase();
      if (!options || !status) return;
      if (!query) {
        options.innerHTML = MENU_ICON_CHOICES.map(([value, label]) => toggleIconChoiceMarkup(value, label)).join("");
        status.textContent = "";
        options.querySelectorAll<HTMLButtonElement>("[data-toggle-icon-choice]").forEach(bindToggleIconChoice);
        return;
      }
      status.textContent = "Searching the Material Design icon library…";
      const names = await this.loadMdiIconNames();
      if (input.value.trim().toLowerCase() !== query) return;
      const matches = names.filter((name) => name.includes(query)).slice(0, 48);
      options.innerHTML = matches.map((name) => toggleIconChoiceMarkup(name, name.slice(4))).join("");
      status.textContent = matches.length ? `${matches.length} matching icons shown.` : names.length ? "No matching icons found." : "The full icon library could not be loaded; common choices remain available.";
      options.querySelectorAll<HTMLButtonElement>("[data-toggle-icon-choice]").forEach(bindToggleIconChoice);
    }));
    root.querySelectorAll<HTMLSelectElement>("[data-menu-action]").forEach((select) => select.addEventListener("change", () => {
      this.emit({ menus: readMenuProfiles() }, true);
    }));
    root.querySelectorAll<HTMLSelectElement>("[data-menu-source]").forEach((select) => select.addEventListener("change", () => {
      this.emit({ menus: readMenuProfiles() }, true);
    }));
    root.querySelectorAll<HTMLInputElement>("[data-menu-lovelace-card]").forEach((input) => input.addEventListener("change", () => {
      const card = input.closest<HTMLElement>("[data-menu-card]");
      const id = card?.dataset.menuCard || "";
      const current = readMenuProfiles();
      const menu = current.find((item) => item.id === id);
      if (!menu) return;
      const selected = menu.lovelace_card_ids || [];
      menu.lovelace_card_layouts = cardLayoutsFor(selected, (menuProfiles.find((item) => item.id === id)?.lovelace_card_layouts || {}));
      // Selection changes must not make Home Assistant recreate the editor.
      // Keep this menu and its picker open, just as camera/light selection does.
      this.config = { ...this.config, menus: current };
      this.hasUnsavedChanges = true;
      this.render();
    }));
    root.querySelectorAll<HTMLSelectElement>("[data-card-order], [data-card-width], [data-card-height]").forEach((select) => select.addEventListener("change", () => {
      const menuCard = select.closest<HTMLElement>("[data-menu-card]");
      const menuId = menuCard?.dataset.menuCard || "";
      const cardId = select.dataset.cardOrder || select.dataset.cardWidth || select.dataset.cardHeight || "";
      const current = readMenuProfiles();
      const menu = current.find((item) => item.id === menuId);
      if (!menu || !cardId) return;
      const ids = menu.lovelace_card_ids || [];
      const layouts = cardLayoutsFor(ids, menuProfiles.find((item) => item.id === menuId)?.lovelace_card_layouts);
      if (select.dataset.cardOrder) {
        const reordered = moveCardToPosition([...ids].sort((a, b) => layouts[a].order - layouts[b].order), cardId, Number(select.value) - 1);
        menu.lovelace_card_ids = reordered;
        // A move is positional: rebuild every ordinal from the new sequence.
        // Keeping the prior values would make the visual list snap back.
        menu.lovelace_card_layouts = reordered.reduce((next, id, index) => {
          next[id] = { ...layouts[id], order: index + 1 };
          return next;
        }, {} as Record<string, { order: number; width: number; height: number }>);
      } else {
        layouts[cardId] = { ...layouts[cardId], [select.dataset.cardWidth ? "width" : "height"]: Number(select.value) };
        menu.lovelace_card_layouts = layouts;
      }
      // Layout controls are in the selected card's row; preserve the current
      // editor view while recalculating the self-healing order.
      this.config = { ...this.config, menus: current };
      this.hasUnsavedChanges = true;
      this.render();
    }));
    const changeVisualCard = (card: HTMLElement, change: (layout: { order: number; width: number; height: number }, ids: string[]) => void) => {
      const menuId = card.closest<HTMLElement>("[data-menu-card]")?.dataset.menuCard || "";
      const cardId = card.dataset.layoutCard || card.dataset.layoutDrag || "";
      if (!menuId || !cardId) return;
      const current = readMenuProfiles();
      const menu = current.find((item) => item.id === menuId);
      if (!menu) return;
      const ids = menu.lovelace_card_ids || [];
      const layouts = cardLayoutsFor(ids, menu.lovelace_card_layouts);
      change(layouts[cardId], ids);
      menu.lovelace_card_layouts = layouts;
      this.config = { ...this.config, menus: current };
      this.hasUnsavedChanges = true;
      this.render();
    };
    root.querySelectorAll<HTMLButtonElement>("[data-layout-resize]").forEach((button) => button.addEventListener("click", () => {
      const card = button.closest<HTMLElement>("[data-layout-card]");
      if (!card) return;
      const direction = button.dataset.layoutResize;
      changeVisualCard(card, (layout) => {
        if (direction === "wider") layout.width = Math.min(3, layout.width + 1);
        if (direction === "narrower") layout.width = Math.max(1, layout.width - 1);
        if (direction === "taller") layout.height = Math.min(2, layout.height + 1);
        if (direction === "shorter") layout.height = Math.max(1, layout.height - 1);
      });
    }));
    root.querySelectorAll<HTMLElement>("[data-layout-drag]").forEach((item) => {
      item.addEventListener("dragstart", (event) => { event.dataTransfer?.setData("text/plain", item.dataset.layoutDrag || ""); if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"; });
      item.addEventListener("dragover", (event) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "move"; });
      item.addEventListener("drop", (event) => {
        event.preventDefault();
        const draggedId = event.dataTransfer?.getData("text/plain") || "";
        const targetId = item.dataset.layoutDrag || "";
        if (!draggedId || !targetId || draggedId === targetId) return;
        const menuId = item.closest<HTMLElement>("[data-menu-card]")?.dataset.menuCard || "";
        const current = readMenuProfiles();
        const menu = current.find((entry) => entry.id === menuId);
        if (!menu) return;
        const ids = menu.lovelace_card_ids || [];
        const layouts = cardLayoutsFor(ids, menu.lovelace_card_layouts);
        const ordered = [...ids].sort((a, b) => layouts[a].order - layouts[b].order);
        const reordered = moveCardToPosition(ordered, draggedId, Math.max(0, ordered.indexOf(targetId)));
        menu.lovelace_card_ids = reordered;
        menu.lovelace_card_layouts = reordered.reduce((next, id, index) => { next[id] = { ...layouts[id], order: index + 1 }; return next; }, {} as Record<string, { order: number; width: number; height: number }>);
        this.config = { ...this.config, menus: current };
        this.hasUnsavedChanges = true;
        this.render();
      });
    });
    root.querySelectorAll<HTMLSelectElement>("[data-menu-destination]").forEach((select) => select.addEventListener("change", () => {
      this.emit({ menus: readMenuProfiles() }, true);
    }));
    root.querySelectorAll<HTMLSelectElement>("[data-menu-order]").forEach((select) => select.addEventListener("change", () => {
      const menuId = select.closest<HTMLElement>("[data-menu-card]")?.dataset.menuCard || "";
      if (!menuId) return;
      this.emit({ menus: moveMenuToPosition(readMenuProfiles(), menuId, Number(select.value) - 1) }, true);
    }));
    root.querySelectorAll<HTMLSelectElement>("[data-menu-area]").forEach((select) => select.addEventListener("change", () => {
      const card = select.closest<HTMLElement>("[data-menu-card]");
      const menuId = card?.dataset.menuCard;
      if (!menuId) return;
      rememberOpenPickers();
      this.menuAreaFilters[menuId] = select.value;
      this.render();
    }));
    root.querySelectorAll<HTMLInputElement>("[data-card-library-name]").forEach((input) => input.addEventListener("change", async () => {
      const id = input.dataset.cardLibraryName || "";
      const name = input.value.trim();
      if (!id || !name) return;
      const nextLibrary = cardLibrary.map((card) => card.id === id ? { ...card, name } : card);
      const status = root.querySelector<HTMLElement>("#card-holder-status");
      try {
        await this.persistBuilderConfig({ ...this.getCurrentConfig(), card_library: nextLibrary });
        this.config = { ...this.config, card_library: nextLibrary };
        if (status) status.textContent = `Saved the display name for ${name}.`;
      } catch (error) { if (status) status.textContent = `Could not save that card name: ${String(error)}`; }
    }));
    root.querySelector<HTMLButtonElement>("#open-card-holder")?.addEventListener("click", async () => {
      const status = root.querySelector<HTMLElement>("#card-holder-status");
      try {
        if (status) status.textContent = "Opening the native Lovelace card holder…";
        const holderPath = await this.createCardHolder();
        const next = { ...this.getCurrentConfig(), card_holder_url_path: holderPath };
        await this.persistBuilderConfig(next);
        window.location.assign(`/${holderPath}/cards`);
      } catch (error) { if (status) status.textContent = `Could not open the card holder: ${String(error)}`; }
    });
    root.querySelector<HTMLButtonElement>("#sync-card-holder")?.addEventListener("click", async () => {
      const status = root.querySelector<HTMLElement>("#card-holder-status");
      const holderPath = String(this.config.card_holder_url_path || "");
      if (!holderPath) return;
      try {
        if (status) status.textContent = "Syncing cards saved in the native Lovelace holder…";
        const card_library = await this.syncCardLibrary(holderPath);
        const next = { ...this.getCurrentConfig(), card_library };
        await this.persistBuilderConfig(next);
        this.config = next;
        this.render();
        const nextStatus = this.shadowRoot?.querySelector<HTMLElement>("#card-holder-status");
        if (nextStatus) nextStatus.textContent = `Synced ${card_library.filter((card) => !card.missing).length} cards.`;
      } catch (error) { if (status) status.textContent = `Could not sync the card library: ${String(error)}`; }
    });
    root.querySelectorAll<HTMLInputElement>("[data-menu-camera], [data-menu-light], [data-menu-temperature]").forEach((input) => input.addEventListener("change", () => {
      rememberOpenPickers();
      // Rebuild locally so a newly selected camera immediately gains its
      // name/overlay, size and refresh controls. Do not emit a Home Assistant
      // config change here: that recreates the parent editor and collapses the
      // picker the user is working in. The remembered picker state restores it.
      this.config = { ...this.config, menus: readMenuProfiles() };
      this.hasUnsavedChanges = true;
      this.render();
    }));
    root.querySelectorAll<HTMLButtonElement>("[data-remove-menu]").forEach((button) => button.addEventListener("click", () => {
      const next = readMenuProfiles().filter((menu) => menu.id !== button.closest<HTMLElement>("[data-menu-card]")?.dataset.menuCard);
      if (next.length) { this.selectedMenuId = next[0].id; this.emit({ menus: next }, true); }
    }));
    root.querySelector<HTMLButtonElement>("#add-menu")?.addEventListener("click", () => {
      const next = readMenuProfiles();
      let index = next.length + 1;
      while (next.some((menu) => menu.id === `menu-${index}`)) index += 1;
      next.push({ id: `menu-${index}`, label: `Menu ${index}`, icon: "mdi:view-dashboard", cameras: [], lights: [], temperatures: [], action: "view", destination: "" });
      this.selectedMenuId = `menu-${index}`;
      this.emit({ menus: next }, true);
    });
    const readMenuToggles = () => normaliseMenuToggles(this.getCurrentConfig().menu_toggles);
    const readMenuStatuses = () => this.getCurrentConfig().menu_statuses || [];
    root.querySelector<HTMLButtonElement>("#add-menu-status")?.addEventListener("click", () => {
      const next = readMenuStatuses(); const temperature = temperatures[0];
      if (!next.length) next.push({ id: "status-time", label: "", icon: "mdi:clock-outline", type: "time", placement: "left", order: 1, action: "none" });
      else next.push({ id: `status-${next.length + 1}`, label: temperature ? String(temperature.attributes?.friendly_name || "Temperature") : "Temperature", icon: "mdi:thermometer", type: "entity", entity: temperature?.entity_id || "", placement: "right", order: next.length + 1, action: "none" });
      this.emit({ menu_statuses: next }, true);
    });
    root.querySelectorAll<HTMLButtonElement>("[data-remove-status]").forEach((button) => button.addEventListener("click", () => this.emit({ menu_statuses: readMenuStatuses().filter((status: any) => status.id !== button.dataset.removeStatus) }, true)));
    root.querySelectorAll<HTMLInputElement>("[data-status-label], [data-status-icon], [data-status-icon-entity], [data-status-destination]").forEach((input) => input.addEventListener("change", () => this.emit({ menu_statuses: readMenuStatuses() }, false)));
    root.querySelectorAll<HTMLInputElement>("[data-status-entity-search]").forEach((input) => input.addEventListener("input", () => { const card=input.closest<HTMLElement>("[data-status-card]"); const select=card?.querySelector<HTMLSelectElement>("[data-status-entity]"); const query=input.value.trim().toLowerCase(); if(select) Array.from(select.options).forEach((option,index)=>{ option.hidden=index>0 && query.length>0 && !option.text.toLowerCase().includes(query); }); }));
    root.querySelectorAll<HTMLSelectElement>("[data-status-type], [data-status-time-format], [data-status-entity], [data-status-placement], [data-status-alignment], [data-status-order], [data-status-action]").forEach((input) => input.addEventListener("change", () => this.emit({ menu_statuses: readMenuStatuses() }, input.matches("[data-status-type]"))));
    root.querySelector<HTMLButtonElement>("#add-menu-toggle")?.addEventListener("click", () => {
      const next = readMenuToggles();
      let index = next.length + 1;
      while (next.some((toggle) => toggle.id === `toggle-${index}`)) index += 1;
      const leftOrder = next.filter((toggle) => toggle.placement !== "right").length + 1;
      next.push({ id: `toggle-${index}`, label: `Toggle ${index}`, on_label: "", off_label: "", icon: "mdi:toggle-switch", state_entity: "", placement: "left", order: leftOrder, active_color: "#2e9d5b", type: "script", on_target: "", off_target: "", subtitle: "", confirm: false, off_long_press: false, hide_unavailable: false, sync_state: true });
      this.emit({ menu_toggles: next }, true);
    });
    root.querySelectorAll<HTMLButtonElement>("[data-remove-toggle]").forEach((button) => button.addEventListener("click", () => {
      this.emit({ menu_toggles: readMenuToggles().filter((toggle) => toggle.id !== button.dataset.removeToggle) }, true);
    }));
    root.querySelectorAll<HTMLInputElement>("[data-toggle-label], [data-toggle-on-label], [data-toggle-off-label], [data-toggle-icon], [data-toggle-icon-entity], [data-toggle-color], [data-toggle-subtitle], [data-toggle-sync], [data-toggle-confirm], [data-toggle-long-press], [data-toggle-hide-unavailable]").forEach((input) => input.addEventListener("change", () => this.emit({ menu_toggles: readMenuToggles() }, false)));
    root.querySelectorAll<HTMLSelectElement>("[data-toggle-state], [data-toggle-icon-placement], [data-toggle-on-target], [data-toggle-off-target]").forEach((input) => input.addEventListener("change", () => this.emit({ menu_toggles: readMenuToggles() }, false)));
    root.querySelectorAll<HTMLSelectElement>("[data-toggle-type]").forEach((input) => input.addEventListener("change", () => this.emit({ menu_toggles: readMenuToggles() }, true)));
    root.querySelectorAll<HTMLSelectElement>("[data-toggle-placement]").forEach((select) => select.addEventListener("change", () => {
      const id = select.closest<HTMLElement>("[data-toggle-card]")?.dataset.toggleCard || "";
      const placement = select.value === "right" ? "right" : "left";
      const next = readMenuToggles().map((toggle) => toggle.id === id ? { ...toggle, placement } : toggle);
      this.emit({ menu_toggles: normaliseMenuToggles(next) }, true);
    }));
    root.querySelectorAll<HTMLSelectElement>("[data-toggle-order]").forEach((select) => select.addEventListener("change", () => {
      const card = select.closest<HTMLElement>("[data-toggle-card]");
      const id = card?.dataset.toggleCard || "";
      const placement = card?.querySelector<HTMLSelectElement>("[data-toggle-placement]")?.value === "right" ? "right" : "left";
      this.emit({ menu_toggles: moveToggleToPosition(readMenuToggles(), id, placement, Number(select.value) - 1) }, true);
    }));
    const updateOverlay = (entity: string) => {
      const next = { ...(this.config.camera_overlays || {}) };
      next[entity] = { show: root.querySelector<HTMLInputElement>(`[data-overlay-show="${entity}"]`)?.checked !== false, horizontal: root.querySelector<HTMLSelectElement>(`[data-overlay-h="${entity}"]`)?.value || "left", vertical: root.querySelector<HTMLSelectElement>(`[data-overlay-v="${entity}"]`)?.value || "bottom" };
      this.emit({ camera_overlays: next }, false);
    };
    root.querySelectorAll<HTMLInputElement>("[data-overlay-show]").forEach((input) => input.addEventListener("change", () => updateOverlay(input.dataset.overlayShow || "")));
    root.querySelectorAll<HTMLSelectElement>("[data-overlay-h], [data-overlay-v]").forEach((input) => input.addEventListener("change", () => updateOverlay((input.dataset.overlayH || input.dataset.overlayV || ""))));
    root.querySelectorAll<HTMLSelectElement>("[data-span]").forEach((input) => input.addEventListener("change", () => {
      const next = { ...(this.config.camera_spans || {}) };
      next[input.dataset.span || ""] = Number(input.value);
      this.emit({ camera_spans: next }, false);
      const preview = root.querySelector<HTMLElement>("[data-menu-preview]");
      if (preview) preview.innerHTML = menuPreviewMarkup(this.getCurrentConfig().menus.find((menu: EchoMenuConfig) => menu.id === this.selectedMenuId));
    }));
    root.querySelectorAll<HTMLSelectElement>("[data-camera-refresh]").forEach((input) => input.addEventListener("change", () => {
      const next = { ...(this.config.camera_refresh_intervals || {}) };
      const entity = input.dataset.cameraRefresh || "";
      if (Number(input.value) > 0) next[entity] = Number(input.value);
      else delete next[entity];
      this.emit({ camera_refresh_intervals: next }, false);
    }));
    root.querySelector<HTMLSelectElement>("#camera-refresh-default")?.addEventListener("change", (event) => {
        this.emit({ camera_refresh_interval: Math.max(100, Number((event.target as HTMLSelectElement).value)) }, false);
    });
    const updateDetections = () => { const current = this.getCurrentConfig(); this.emit({ detection_types: current.detection_types, camera_detections: current.camera_detections }, false); };
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-detection-label], [data-detection-match], [data-detection-animation], [data-detection-color], [data-detection-badge], [data-detection-badge-text], [data-camera-detection]").forEach((input) => input.addEventListener("change", updateDetections));
    root.querySelector<HTMLButtonElement>("#add-detection-type")?.addEventListener("click", () => {
      const next = this.getCurrentConfig().detection_types || [];
      let index = next.length + 1; while (next.some((type: any) => type.id === `detection-${index}`)) index += 1;
      this.emit({ detection_types: [...next, { id: `detection-${index}`, label: `Detection ${index}`, match: "", animation: "soft-pulse", color: "#03a9f4", show_badge: true, badge_text: `Detection ${index}` }] }, true);
    });
    root.querySelectorAll<HTMLButtonElement>("[data-remove-detection-type]").forEach((button) => button.addEventListener("click", () => {
      const id = button.dataset.removeDetectionType || "";
      this.emit({ detection_types: (this.getCurrentConfig().detection_types || []).filter((type: any) => type.id !== id) }, true);
    }));
    root.querySelectorAll<HTMLSelectElement>("[data-order]").forEach((input) => input.addEventListener("change", () => {
      const entity = input.dataset.order || "";
      this.emit({ camera_order: moveCameraToPosition(cameraOrder, entity, Number(input.value) - 1) });
    }));
    root.querySelector<HTMLSelectElement>("#echo-target")?.addEventListener("change", (event) => {
      const key = (event.target as HTMLSelectElement).value;
      const target = targets.find((item) => item.key === key);
      this.emit({
        echo_target: key,
        echo_mode: target ? String(this._hass?.states[target.dashboard]?.state || "Streamed") : "Streamed",
        echo_dashboard_when_idle: Boolean(target && this._hass?.states[target.idle]?.state === "on"),
      });
    });
    root.querySelector<HTMLButtonElement>("#echo-apply-standard")?.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const status = root.querySelector<HTMLElement>("#standard-dashboard-status");
      const target = targets.find((item) => item.key === (root.querySelector<HTMLSelectElement>("#echo-target")?.value || ""));
      const title = root.querySelector<HTMLSelectElement>("#standard-dashboard")?.value || "";
      if (!target || !title) { if (status) status.textContent = "Select an Echo Show and a dashboard first."; return; }
      button.disabled = true;
      if (status) status.textContent = "Assigning the standard dashboard…";
      try {
        const dashboard = this.standardDashboards.find((item) => item.title === title);
        if (!dashboard?.url_path) throw new Error(`The selected dashboard “${title}” no longer exists.`);
        const mode = root.querySelector<HTMLSelectElement>("#echo-mode")?.value || "Streamed";
        const idle = root.querySelector<HTMLInputElement>("#echo-idle")?.checked || false;
        await this._hass?.callService?.("select", "select_option", { entity_id: target.dashboard, option: mode });
        await this._hass?.callService?.("switch", idle ? "turn_on" : "turn_off", { entity_id: target.idle });
        // Show 5 exposes its Dashboard-to-show selector as “Automatic”, so a
        // title cannot be selected there. TECHO5's path command works for both
        // standard dashboards and builder-created ones.
        await this._hass?.callService?.("esphome", `${target.key}_dashboard_path`, { path: `/${dashboard.url_path}` });
        await this._hass?.callService?.("esphome", `${target.key}_dashboard_show`, {});
        if (status) status.textContent = `Applied standard dashboard “${title}” to ${target.label}.`;
      } catch (error) {
        if (status) status.textContent = `Could not apply the standard dashboard: ${String(error)}`;
      } finally { button.disabled = false; }
    });
    root.querySelector<HTMLButtonElement>("#echo-create-dashboard")?.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      let status = root.querySelector<HTMLElement>("#echo-create-status");
      const target = targets.find((item) => item.key === (root.querySelector<HTMLSelectElement>("#echo-target")?.value || ""));
      if (!target) { if (status) status.textContent = "Select an Echo Show first."; return; }
      if (!selectedProfileId || !savedProfiles.some((profile) => profile.id === selectedProfileId)) { if (status) status.textContent = "Select a Dash from the Dash Library before applying it to an Echo."; return; }
      button.disabled = true;
      if (status) status.textContent = "Applying this setup…";
      let created: any;
      let reusedExisting = false;
      let attached = false;
      let showError = "";
      let priorManagedDashboards: Array<{ id: string; title: string; url_path: string; target: string }> = [];
      try {
        // Applying is also the point at which the working builder setup becomes
        // durable.  Without this, the generated Echo dashboard could contain
        // newer menus than the builder the user returns to edit.
        const workingConfig = this.getCurrentConfig();
        const selectedDash = savedProfiles.find((profile) => profile.id === selectedProfileId)!;
        const savedDash: EchoSavedDashboardProfile = { ...selectedDash, menus: workingConfig.menus || [], settings: dashSettings(workingConfig) };
        const currentConfig = {
          ...workingConfig,
          saved_profiles: [...savedProfiles.filter((profile) => profile.id !== savedDash.id), savedDash],
          active_profile_id: savedDash.id,
        };
        const configuredMenus = getMenuProfiles(currentConfig, cameras, lights, temperatures);
        const invalidNavigation = configuredMenus.find((menu) => menu.action === "navigate" && !localDashboardPath(menu.destination));
        if (invalidNavigation) throw new Error(`Menu “${invalidNavigation.label}” needs a valid Home Assistant destination path, such as /lovelace/0.`);
        const lovelaceCards = await this.resolveLovelaceCards(currentConfig, configuredMenus);
        await this.persistBuilderConfig(currentConfig);
        this.config = { ...currentConfig, echo_managed: false };
        const existing = await this.callWS({ type: "lovelace/dashboards/list" });
        const storageDashboards = (Array.isArray(existing) ? existing : []).filter((item: any) => item.mode === "storage" && item.id && item.url_path);
        const managedForTarget = await Promise.all(storageDashboards.map(async (dashboard: any) => {
          const saved = await this.callWS({ type: "lovelace/config", url_path: dashboard.url_path });
          const strategy = saved?.strategy;
          return strategy?.type === "custom:echo-show" && strategy.echo_managed === true && String(strategy.echo_target || "") === target.key
            ? { id: String(dashboard.id), title: String(dashboard.title || dashboard.url_path), url_path: String(dashboard.url_path), target: target.key }
            : null;
        }));
        priorManagedDashboards = managedForTarget.filter((dashboard): dashboard is { id: string; title: string; url_path: string; target: string } => Boolean(dashboard));
        const savedProfile: any = savedProfiles.find((item: any) => item.id === selectedProfileId);
        const profileName = savedProfile?.name || "";
        const baseTitle = [target.label.trim() || "Echo Show", profileName].filter(Boolean).join(" — ");
        const slug = baseTitle.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "echo-show";
        // A device owns one builder-managed dashboard.  Reuse it instead of
        // creating a replacement: a failed attach must never leave a second
        // dashboard behind.  If legacy duplicates exist, keep the dashboard
        // currently selected on the device and remove the stale one only after
        // the updated configuration has been attached successfully.
        const selectedDashboardTitle = String(this._hass?.states[target.dashboardToShow]?.state || "");
        const existingForTarget = priorManagedDashboards.find((dashboard) => dashboard.title === selectedDashboardTitle) || priorManagedDashboards[0];
        let urlPath: string;
        let title: string;
        if (existingForTarget) {
          created = existingForTarget;
          reusedExisting = true;
          urlPath = existingForTarget.url_path;
          title = existingForTarget.title;
        } else {
          const usedPaths = new Set<string>(storageDashboards.map((item: any) => String(item.url_path || "")));
          urlPath = slug;
          let suffix = 2;
          while (usedPaths.has(urlPath)) urlPath = `${slug}-${suffix++}`;
          title = suffix === 2 ? baseTitle : `${baseTitle} ${suffix - 1}`;
          created = await this.callWS({ type: "lovelace/dashboards/create", url_path: urlPath, title, show_in_sidebar: true, require_admin: false });
        }
        const menus = configuredMenus;
        const strategyConfig = {
          type: "custom:echo-show",
          title,
          menus,
          menu_toggles: currentConfig.menu_toggles,
          menu_statuses: currentConfig.menu_statuses,
          echo_managed: true,
          included_cameras: currentConfig.included_cameras,
          included_lights: currentConfig.included_lights,
          menu: currentConfig.menu,
          lovelace_cards: lovelaceCards,
          kiosk_mode: kioskModeSetting(currentConfig.kiosk_mode, "enabled"),
          camera_overlays: currentConfig.camera_overlays,
          camera_spans: currentConfig.camera_spans,
          camera_order: currentConfig.camera_order,
          camera_refresh_interval: currentConfig.camera_refresh_interval,
          camera_refresh_intervals: currentConfig.camera_refresh_intervals,
          camera_person_entities: currentConfig.camera_person_entities,
          person_detection: currentConfig.person_detection,
          detection_types: currentConfig.detection_types,
          camera_detections: currentConfig.camera_detections,
          echo_target: target.key,
          echo_dashboard: title,
          echo_mode: currentConfig.echo_mode || "Streamed",
          echo_dashboard_when_idle: currentConfig.echo_dashboard_when_idle,
        };
        await this.callWS({ type: "lovelace/config/save", url_path: urlPath, config: { strategy: strategyConfig } });
        const mode = root.querySelector<HTMLSelectElement>("#echo-mode")?.value || "Streamed";
        const idle = root.querySelector<HTMLInputElement>("#echo-idle")?.checked || false;
        if (!this._hass?.callService) throw new Error("Home Assistant device controls are unavailable.");
        await this._hass.callService("select", "select_option", { entity_id: target.dashboard, option: mode });
        await this._hass.callService("switch", idle ? "turn_on" : "turn_off", { entity_id: target.idle });
        // TECHO5 can show a dashboard directly by its Lovelace path. This is
        // essential for devices such as Show 5 whose Dashboard-to-show selector
        // deliberately contains only “Automatic”; waiting for a title there
        // leaves a newly created dashboard unattached.
        await this._hass.callService("esphome", `${target.key}_dashboard_path`, { path: `/${urlPath}` });
        await this._hass.callService("esphome", `${target.key}_dashboard_show`, {});
        attached = true;
        const retained: Array<{ id: string; title: string; url_path: string; target: string }> = [];
        const removalErrors: string[] = [];
        for (const previous of priorManagedDashboards) {
          if (previous.id === String(created.id)) continue;
          try {
            await this.callWS({ type: "lovelace/dashboards/delete", dashboard_id: previous.id });
          } catch (error) {
            retained.push(previous);
            removalErrors.push(`${previous.title}: ${String(error)}`);
          }
        }
        this.managedDashboards = [
          ...this.managedDashboards.filter((dashboard) => dashboard.target !== target.key),
          ...retained,
          { id: String(created.id), title, url_path: urlPath, target: target.key },
        ];
        this.managedDashboardsLoaded = true;
        this.render();
        status = this.shadowRoot?.querySelector<HTMLElement>("#echo-create-status") || null;
        if (status) {
          status.textContent = (removalErrors.length
            ? `Applied the setup to ${target.label}. Home Assistant could not remove every previous builder dashboard, so those are still listed for removal: ${removalErrors.join("; ")}`
            : priorManagedDashboards.length
              ? `Applied the setup to ${target.label}; its previous builder dashboard${priorManagedDashboards.length === 1 ? " was" : "s were"} replaced. Your saved setups and builder preview remain.`
              : `Applied the setup to ${target.label}. Your saved setups and builder preview remain.`)
            + (showError ? ` The dashboard was attached, but could not be shown immediately: ${showError}` : "");
        }
      } catch (error) {
        if (created?.id && !attached && !reusedExisting) {
          try {
            await this.callWS({ type: "lovelace/dashboards/delete", dashboard_id: created.id });
            if (status) status.textContent = `Could not apply the dashboard to ${target.label}; the unattached dashboard was removed. ${String(error)}`;
          } catch (cleanupError) {
            this.managedDashboards.push({ id: String(created.id), title: String(created.title || target.label), url_path: String(created.url_path || ""), target: target.key });
            this.managedDashboardsLoaded = true;
            this.render();
            status = this.shadowRoot?.querySelector<HTMLElement>("#echo-create-status") || null;
            if (status) status.textContent = `The dashboard could not be attached, and Home Assistant could not remove it. It is listed below so you can remove it. ${String(error)} (${String(cleanupError)})`;
          }
        } else if (created?.id && attached) {
          this.managedDashboards = [
            ...this.managedDashboards.filter((dashboard) => dashboard.target !== target.key),
            ...priorManagedDashboards,
            { id: String(created.id), title: String(created.title || target.label), url_path: String(created.url_path || ""), target: target.key },
          ];
          this.managedDashboardsLoaded = true;
          this.render();
          status = this.shadowRoot?.querySelector<HTMLElement>("#echo-create-status") || null;
          if (status) status.textContent = `The dashboard was attached to ${target.label}, but its status could not be refreshed: ${String(error)}`;
        } else if (status) status.textContent = `Could not create the dashboard: ${String(error)}`;
      } finally {
        const currentButton = this.shadowRoot?.querySelector<HTMLButtonElement>("#echo-create-dashboard");
        if (currentButton) currentButton.disabled = false;
      }
    });
    root.querySelector<HTMLSelectElement>("#echo-mode")?.addEventListener("change", (event) => this.emit({ echo_mode: (event.target as HTMLSelectElement).value }));
    root.querySelector<HTMLInputElement>("#echo-idle")?.addEventListener("change", (event) => this.emit({ echo_dashboard_when_idle: (event.target as HTMLInputElement).checked }));
  }
}

if (!customElements.get("echo-show-editor")) customElements.define("echo-show-editor", EchoShowEditor);
