import { listAvailableCameras } from "./camera-feeds";
import { kioskModeSetting, localDashboardPath, type EchoMenuConfig, type EchoSavedDashboardProfile } from "./dashboard-strategy";
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

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function getMenuProfiles(config: any, cameras: Array<{ entityId: string }>, lights: any[], temperatures: any[] = []): EchoMenuConfig[] {
  if (Array.isArray(config.menus) && config.menus.length) {
    return config.menus.map((menu: any, index: number) => ({
      id: String(menu.id || `menu-${index + 1}`),
      label: String(menu.label || `Menu ${index + 1}`),
      icon: String(menu.icon || "mdi:view-dashboard"),
      cameras: Array.isArray(menu.cameras) ? menu.cameras : [],
      lights: Array.isArray(menu.lights) ? menu.lights : [],
      temperatures: Array.isArray(menu.temperatures) ? menu.temperatures : [],
      action: menu.action === "navigate" ? "navigate" : "view",
      destination: String(menu.destination || ""),
      source: menu.source === "lovelace_card" ? "lovelace_card" : "menu",
      lovelace_card_ids: Array.isArray(menu.lovelace_card_ids) ? menu.lovelace_card_ids.map(String) : menu.lovelace_card_id ? [String(menu.lovelace_card_id)] : [],
      lovelace_card_id: String(menu.lovelace_card_id || ""),
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
  setConfig(config: any) { this.config = { ...config }; this.render(); }
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
        icon: card.querySelector<HTMLInputElement>("[data-menu-icon]")?.value.trim() || "mdi:view-dashboard",
        cameras: selected("[data-menu-camera]", existing?.cameras),
        lights: selected("[data-menu-light]", existing?.lights),
        temperatures: selected("[data-menu-temperature]", existing?.temperatures),
        action: card.querySelector<HTMLSelectElement>("[data-menu-action]")?.value === "navigate" ? "navigate" : "view",
        destination: card.querySelector<HTMLSelectElement>("[data-menu-destination]")?.value === "__custom__"
          ? card.querySelector<HTMLInputElement>("[data-menu-custom-destination]")?.value.trim() || ""
          : card.querySelector<HTMLSelectElement>("[data-menu-destination]")?.value || "",
        source: card.querySelector<HTMLSelectElement>("[data-menu-source]")?.value === "lovelace_card" ? "lovelace_card" : "menu",
        lovelace_card_ids: Array.from(card.querySelectorAll<HTMLInputElement>("[data-menu-lovelace-card]:checked"), (input) => input.value),
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
    return {
      ...this.config,
      menus,
      camera_order: cameraOrder,
      camera_overlays: cameraOverlays,
      camera_spans: cameraSpans,
      camera_refresh_interval: Math.max(100, Number(root.querySelector<HTMLSelectElement>("#camera-refresh-default")?.value || this.config.camera_refresh_interval || 3000)),
      camera_refresh_intervals: cameraRefreshIntervals,
      echo_target: root.querySelector<HTMLSelectElement>("#echo-target")?.value || "",
      echo_mode: root.querySelector<HTMLSelectElement>("#echo-mode")?.value || "Streamed",
      echo_dashboard_when_idle: root.querySelector<HTMLInputElement>("#echo-idle")?.checked || false,
      kiosk_mode: kioskModeSetting(root.querySelector<HTMLSelectElement>("#kiosk-mode")?.value, this.config.echo_managed ? "enabled" : "inherit"),
    };
  }
  getConfigForSave(): any {
    const config = this.getCurrentConfig();
    const name = this.shadowRoot?.querySelector<HTMLInputElement>("#profile-name")?.value.trim() || "";
    if (!name) return config;
    const id = this.selectedProfileId || `setup-${Date.now()}`;
    const profile: EchoSavedDashboardProfile = {
      id,
      name,
      menus: config.menus,
      camera_order: config.camera_order,
      camera_overlays: config.camera_overlays,
      camera_spans: config.camera_spans,
      camera_refresh_interval: config.camera_refresh_interval,
      camera_refresh_intervals: config.camera_refresh_intervals,
      kiosk_mode: kioskModeSetting(config.kiosk_mode, this.config.echo_managed ? "enabled" : "inherit"),
    };
    return {
      ...config,
      saved_profiles: [...(this.config.saved_profiles || []).filter((item: any) => item.id !== id), profile],
      active_profile_id: id,
    };
  }
  set hass(value: Hass) {
    const firstHass = !this._hass;
    this._hass = value;
    if (firstHass && !this.shadowRoot?.querySelector("[data-menu-card]")) this.render();
    if (!this.managedDashboardsLoaded && !this.managedDashboardsLoading) void this.loadManagedDashboards();
    if (!this.dashboardDestinationsLoaded && !this.dashboardDestinationsLoading) void this.loadDashboardDestinations();
    if (!this.areaRegistryLoaded && !this.areaRegistryLoading) void this.loadAreaRegistry();
  }
  connectedCallback() { this.render(); }
  private emit(patch: Record<string, unknown>, rerender = true) {
    this.config = { ...this.config, ...patch };
    this.dispatchEvent(new CustomEvent("config-changed", { bubbles: true, composed: true, detail: { config: this.config } }));
    if (rerender) this.render();
  }
  private emitCurrentConfig() {
    this.config = this.getCurrentConfig();
    this.dispatchEvent(new CustomEvent("config-changed", { bubbles: true, composed: true, detail: { config: this.config } }));
  }
  private callWS(message: Record<string, unknown>): Promise<any> {
    if (this._hass?.callWS) return this._hass.callWS(message);
    if (this._hass?.connection?.sendMessagePromise) return this._hass.connection.sendMessagePromise(message);
    return Promise.reject(new Error("Home Assistant dashboard management is unavailable."));
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
    const savedProfiles: EchoSavedDashboardProfile[] = Array.isArray(this.config.saved_profiles) ? this.config.saved_profiles : [];
    const overlays = this.config.camera_overlays || {};
    const spans = this.config.camera_spans || {};
    const cameraRefreshIntervals = this.config.camera_refresh_intervals || {};
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
      const settingsOpen = EchoShowEditor.openCameraSettings[stateKey] ?? true;
      return `<details class="camera-appearance" data-camera-appearance="${escapeHtml(stateKey)}" ${settingsOpen ? "open" : ""}>
        <summary>Camera size, order &amp; overlay</summary>
        <div class="camera-settings-row"><label>Order <select data-order="${escapeHtml(camera.entityId)}">${orderedCameras.map((_, i) => `<option value="${i + 1}" ${position === i + 1 ? "selected" : ""}>${i + 1}</option>`).join("")}</select></label>
        <label>Show name <input type="checkbox" data-overlay-show="${escapeHtml(camera.entityId)}" ${o.show !== false ? "checked" : ""}></label>
        <label>Name position <select data-overlay-h="${escapeHtml(camera.entityId)}"><option value="left" ${o.horizontal === "left" || !o.horizontal ? "selected" : ""}>Left</option><option value="center" ${o.horizontal === "center" ? "selected" : ""}>Centre</option><option value="right" ${o.horizontal === "right" ? "selected" : ""}>Right</option></select></label>
        <label>Vertical position <select data-overlay-v="${escapeHtml(camera.entityId)}"><option value="top" ${o.vertical === "top" ? "selected" : ""}>Top</option><option value="bottom" ${o.vertical !== "top" ? "selected" : ""}>Bottom</option></select></label>
        <label>Tile width <select data-span="${escapeHtml(camera.entityId)}"><option value="1" ${span === 1 ? "selected" : ""}>1 box</option><option value="2" ${span === 2 ? "selected" : ""}>2 boxes</option><option value="3" ${span === 3 ? "selected" : ""}>3 boxes</option></select></label>
        <label>Image refresh <select data-camera-refresh="${escapeHtml(camera.entityId)}"><option value="0" ${refreshOverride === 0 ? "selected" : ""}>Use default (${cameraRefreshInterval < 1000 ? `${cameraRefreshInterval} ms` : `${cameraRefreshInterval / 1000}s`})</option>${[100, 250, 500, 1000, 2000, 3000, 5000, 10000, 15000].map((value) => `<option value="${value}" ${refreshOverride === value ? "selected" : ""}>${value === 100 ? "100 ms (10 fps, maximum load)" : value === 250 ? "250 ms (4 fps, high load)" : value === 500 ? "500 ms (2 fps)" : `${value / 1000}s`}</option>`).join("")}</select></label></div>
        <div class="hint">These settings apply wherever this camera is used.</div></details>`;
    };
    const targets = this.targets();
    const selectedTarget = String(this.config.echo_target || "");
    const selectedProfileId = String(this.selectedProfileId || this.config.active_profile_id || "");
    const activeTarget = targets.find((target) => target.key === selectedTarget);
    const selectedMode = String(this.config.echo_mode || (activeTarget ? this._hass?.states[activeTarget.dashboard]?.state : "") || "Streamed");
    const selectedIdle = this.config.echo_dashboard_when_idle === undefined
      ? Boolean(activeTarget && this._hass?.states[activeTarget.idle]?.state === "on")
      : Boolean(this.config.echo_dashboard_when_idle);
    const selectedKioskMode = kioskModeSetting(this.config.kiosk_mode, this.config.echo_managed ? "enabled" : "inherit");
    const cardLibrary: EchoCardLibraryEntry[] = Array.isArray(this.config.card_library) ? this.config.card_library : [];
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
      const sourcePicker = menu.action === "navigate" ? "" : `<div class="row"><label>Button source <select data-menu-source><option value="menu" ${menu.source === "lovelace_card" ? "" : "selected"}>Menu content</option><option value="lovelace_card" ${menu.source === "lovelace_card" ? "selected" : ""}>Lovelace Cards</option></select></label></div>${menu.source === "lovelace_card" ? `<div class="card-picker"><strong>Cards in this menu</strong>${lovelaceCards.map((card) => `<label class="camera"><input type="checkbox" data-menu-lovelace-card value="${escapeHtml(card.id)}" ${selectedCards.has(card.id) ? "checked" : ""}>${escapeHtml(card.name)} — ${escapeHtml(card.card_type)}</label>`).join("") || `<div class="hint">No cards are available. Open the Custom Card Holder and Sync card library.</div>`}</div><div class="hint">Tick one or more cards. They are copied unchanged into this Echo menu when you apply the setup; their native actions remain available there.</div>` : ""}`;
      const menuOpen = EchoShowEditor.openMenuCards[menu.id] ?? (index === 0 || isLightsMenu);
      return `<details class="menu-config" data-menu-card="${escapeHtml(menu.id)}" ${menuOpen ? "open" : ""}>
      <summary>Menu ${index + 1}: ${escapeHtml(menu.label)}</summary>
      <div class="row"><label>Menu order <select data-menu-order>${menuProfiles.map((_, optionIndex) => `<option value="${optionIndex + 1}" ${index === optionIndex ? "selected" : ""}>${optionIndex + 1}</option>`).join("")}</select></label><label>Menu name <input type="text" data-menu-label value="${escapeHtml(menu.label)}"></label><label>Icon <input type="text" data-menu-icon value="${escapeHtml(menu.icon || "mdi:view-dashboard")}" placeholder="mdi:home"></label></div>
      <div class="row"><label>Action <select data-menu-action><option value="view" ${menu.action === "navigate" ? "" : "selected"}>Show this menu</option><option value="navigate" ${menu.action === "navigate" ? "selected" : ""}>Navigate to Dashboard</option></select></label>${menu.action === "navigate" ? `${destinationSelect}${customDestination}` : ""}</div>${menu.action === "navigate" ? `<div class="hint">Choose any available Home Assistant dashboard or view. Custom paths are limited to this Home Assistant instance and open in the current session without changing the Echo assignment.</div>${this.dashboardDestinationsLoading ? `<div class="hint">Loading dashboards and views…</div>` : ""}${this.dashboardDestinationsError ? `<div class="hint">Could not load the dashboard list: ${escapeHtml(this.dashboardDestinationsError)}</div>` : ""}` : ""}
      ${sourcePicker}
      <div class="row">${areaSelect}</div>${this.areaRegistryError ? `<div class="hint">Area filters are unavailable: ${escapeHtml(this.areaRegistryError)}</div>` : this.areaRegistryLoading ? `<div class="hint">Loading Home Assistant areas…</div>` : `<div class="hint">Choose an area to narrow the camera, light, and temperature lists for this menu, then tick the entities you want to show.</div>`}
      ${menu.action === "navigate" ? "" : `<details class="content-picker" ${(pickerOpen[0] ?? (menu.cameras || []).length > 0) ? "open" : ""}><summary>Cameras · ${(menu.cameras || []).length} selected</summary>${menuCameras.length ? menuCameras.map((camera) => `<div class="camera-choice"><label class="camera"><input type="checkbox" data-menu-camera value="${escapeHtml(camera.entityId)}" ${(menu.cameras || []).includes(camera.entityId) ? "checked" : ""}>${escapeHtml(camera.label)}</label>${(menu.cameras || []).includes(camera.entityId) ? cameraAppearance(camera, menu.id) : ""}</div>`).join("") : `<div class="hint">No cameras are available in this area.</div>`}</details>
      <details class="content-picker" ${(pickerOpen[1] ?? isLightsMenu) ? "open" : ""}><summary>Choose lights · ${(menu.lights || []).length} selected</summary>${menuLights.length ? menuLights.map((light: any) => `<label class="camera"><input type="checkbox" data-menu-light value="${escapeHtml(light.entity_id)}" ${(menu.lights || []).includes(light.entity_id) ? "checked" : ""}>${escapeHtml(light.attributes?.friendly_name || light.entity_id)}</label>`).join("") : `<div class="hint">No lights are available in this area.</div>`}</details>
      <details class="content-picker" ${(pickerOpen[2] ?? false) ? "open" : ""}><summary>Temperature sensors · ${(menu.temperatures || []).length} selected</summary>${menuTemperatures.length ? menuTemperatures.map((sensor: any) => `<label class="camera"><input type="checkbox" data-menu-temperature value="${escapeHtml(sensor.entity_id)}" ${(menu.temperatures || []).includes(sensor.entity_id) ? "checked" : ""}>${escapeHtml(sensor.attributes?.friendly_name || sensor.entity_id)}</label>`).join("") : `<div class="hint">No temperature sensors are available in this area.</div>`}</details>`}
      <button type="button" data-remove-menu ${menuProfiles.length <= 1 ? "disabled" : ""}>Remove menu</button>
    </details>`;
    }).join("");
    const managedDashboardList = this.managedDashboards.length
      ? `<ul>${this.managedDashboards.map((dashboard) => `<li class="camera"><span>${escapeHtml(dashboard.title)}${dashboard.target ? ` — ${escapeHtml(targets.find((target) => target.key === dashboard.target)?.label || dashboard.target)}` : ""}</span><button type="button" data-delete-managed="${escapeHtml(dashboard.id)}">Remove</button></li>`).join("")}</ul>`
      : `<div class="hint">${this.managedDashboardsError ? `Could not load managed dashboards: ${escapeHtml(this.managedDashboardsError)}` : "Dashboards created here will appear in this list."}</div>`;
    root.innerHTML = `<style>
      :host{display:block;font-family:Arial,sans-serif;padding:16px;box-sizing:border-box;color:var(--primary-text-color);--builder-line:var(--divider-color,rgba(127,127,127,.35))}
      .section{margin:0;padding:22px 0 24px;border-top:2px solid var(--builder-line)}.section:first-of-type{border-top:0;padding-top:4px}
      .section h3{margin:0 0 10px;font-size:1.18rem;line-height:1.3}
      .row{display:flex;gap:12px;align-items:center;margin:12px 0;flex-wrap:wrap}
      .row>label{flex:1 1 220px}.row button{min-height:40px}
      input[type=text],select{max-width:100%;box-sizing:border-box;padding:9px;border:1px solid var(--builder-line);border-radius:6px;background:var(--card-background-color,var(--primary-background-color));color:inherit}
      input[type=text]{width:100%}label{cursor:pointer}.hint{opacity:.78;font-size:.92em;line-height:1.45;max-width:75ch;margin:4px 0 10px}
      .menu-config{border:1px solid var(--builder-line);border-radius:8px;padding:12px 14px;margin:12px 0;background:var(--card-background-color,rgba(127,127,127,.04))}
      .menu-config>summary,.content-picker>summary{cursor:pointer;font-weight:600;min-height:30px;display:flex;align-items:center}
      .content-picker{margin:10px 0;padding:8px 10px;border-top:1px solid var(--builder-line)}
      .content-picker[open]{background:color-mix(in srgb,var(--primary-color,#03a9f4) 5%,transparent);border-radius:6px}
      .menu-config .row label{flex:1 1 180px}.camera{display:flex;gap:10px;padding:8px 4px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--builder-line)}
      .camera:last-child{border-bottom:0}.camera strong{flex:1 1 180px}.camera label{display:flex;gap:6px;align-items:center}
      .camera-choice{border-bottom:1px solid var(--builder-line);padding:3px 0}.camera-choice:last-child{border-bottom:0}.camera-choice>.camera{border:0}
      .camera-appearance{margin:0 8px 10px;padding:8px 10px;border-top:1px solid var(--builder-line);background:color-mix(in srgb,var(--primary-color,#03a9f4) 4%,transparent);border-radius:6px}
      .camera-appearance>summary{cursor:pointer;font-weight:600;min-height:30px;display:flex;align-items:center}
      .camera-settings-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.camera-settings-row>label{display:flex;gap:6px;align-items:center;flex:1 1 150px}.camera-settings-row select{min-width:82px}
      #echo-create-status,#managed-delete-status{display:block;margin:8px 0}
    </style>
      <div class="section"><h3>Saved dashboard setups (${savedProfiles.length})</h3><div class="hint">Save a setup here once. Selecting it loads its settings so you can create it for any Echo whenever you’re ready. These setups stay in this master dashboard.</div>
        <div class="row"><label for="saved-profile">Saved setup</label><select id="saved-profile"><option value="">Current setup (not saved)</option>${savedProfiles.map((profile: any) => `<option value="${escapeHtml(profile.id)}" ${profile.id === selectedProfileId ? "selected" : ""}>${escapeHtml(profile.name)}</option>`).join("")}</select></div>
        <div class="row"><label for="profile-name">Setup name</label><input id="profile-name" type="text" value="${escapeHtml(savedProfiles.find((profile: any) => profile.id === selectedProfileId)?.name || "")}" placeholder="e.g. Front cameras"></div>
        <div class="row"><button id="remove-profile" type="button" ${selectedProfileId ? "" : "disabled"}>Remove saved setup</button></div>
        <div class="hint">Use Save setup at the bottom when you want to add or update this reusable setup. It keeps this editor open.</div></div>
      <div class="section"><h3>Kiosk Mode</h3><div class="hint">This setting belongs to this Echo dashboard only. It does not change Home Assistant globally or alter any dashboard you navigate to.</div><div class="row"><label for="kiosk-mode">Kiosk Mode <select id="kiosk-mode"><option value="enabled" ${selectedKioskMode === "enabled" ? "selected" : ""}>Enabled</option><option value="disabled" ${selectedKioskMode === "disabled" ? "selected" : ""}>Disabled</option><option value="inherit" ${selectedKioskMode === "inherit" ? "selected" : ""}>Inherit</option></select></label></div><div class="hint">Enabled and Disabled explicitly configure NemesisRE Kiosk Mode. Inherit leaves this dashboard without an override, so any existing Home Assistant or user-level rule can apply.</div></div>
      <div class="section"><h3>Custom Card Holder</h3><div class="hint">A separate, genuine Home Assistant Lovelace dashboard for native Copy Card and Paste Card. It is builder-only: it never becomes an Echo menu or is exported to an Echo dashboard.</div><div class="row"><button id="open-card-holder" type="button">Open Custom Card Holder</button><button id="sync-card-holder" type="button" ${this.config.card_holder_url_path ? "" : "disabled"}>Sync card library</button></div><div id="card-holder-status" class="hint" aria-live="polite"></div>${cardLibrary.length ? `<ul>${cardLibrary.map((card) => `<li class="camera"><span>${escapeHtml(card.name)} — ${escapeHtml(card.card_type)} — ${escapeHtml(card.id)}${card.missing ? " (missing from holder)" : ""}</span><label>Display name <input type="text" data-card-library-name="${escapeHtml(card.id)}" value="${escapeHtml(card.name)}"></label></li>`).join("")}</ul><div class="hint">Names are builder metadata; they do not change the original Lovelace card. Missing cards retain their ID so references cannot redirect.</div>` : `<div class="hint">No cards have been discovered yet. Paste cards into the holder, save them normally, then Sync card library.</div>`}</div>
      <div class="section"><h3>Menus (${menuProfiles.length})</h3><div class="hint">Each menu becomes a button on the Echo. Expand a menu, then choose cameras, lights, or temperature sensors. Each selected camera has its own size, order, overlay, and refresh setting.</div><div class="row"><label for="camera-refresh-default">Default camera image refresh</label><select id="camera-refresh-default">${[100, 250, 500, 1000, 2000, 3000, 5000, 10000, 15000].map((value) => `<option value="${value}" ${cameraRefreshInterval === value ? "selected" : ""}>${value === 100 ? "Every 100 ms (10 fps, maximum load)" : value === 250 ? "Every 250 ms (4 fps, high load)" : value === 500 ? "Every 500 ms (2 fps)" : `Every ${value / 1000} seconds`}</option>`).join("")}</select></div><div class="hint">Use the fast settings on one or two important cameras. 10 fps requests ten images per second for every visible camera, so start with a per-camera override rather than changing the default for the whole wall.</div>${menuEditors}<button id="add-menu" type="button">Add menu</button></div>
      <div class="section"><h3>Apply setup to Echo Show</h3><div class="hint">Your setups are saved in this builder and previewed here. Applying one creates its Echo dashboard; the previous dashboard made here for that Echo is removed after the new one is attached. The builder stays available for editing and preview.</div>
        <div class="row"><label for="echo-target">Echo Show</label><select id="echo-target" size="${Math.min(Math.max(targets.length + 1, 2), 5)}">${targets.length ? `<option value="">Select a device</option>${targets.map((target) => `<option value="${target.key}" ${target.key === selectedTarget ? "selected" : ""}>${target.label}</option>`).join("")}` : `<option value="">No TECHO5 devices discovered</option>`}</select></div>
        <div class="row"><label for="echo-mode">Presentation</label><select id="echo-mode"><option ${selectedMode === "Streamed" ? "selected" : ""}>Streamed</option><option ${selectedMode === "Drawn on the device" ? "selected" : ""}>Drawn on the device</option></select></div>
        <div class="row"><input id="echo-idle" type="checkbox" ${selectedIdle ? "checked" : ""}><label for="echo-idle">Dashboard when idle</label></div>
        <div class="row"><button id="echo-load-attached" type="button" ${activeTarget ? "" : "disabled"}>Load current Echo setup into builder</button><button id="echo-create-dashboard" type="button" ${activeTarget ? "" : "disabled"}>Apply setup to Echo</button></div><div id="echo-create-status" class="hint" aria-live="polite"></div>
        <div class="hint">Load current Echo setup is for recovering an already-applied setup into this builder. It does not change the Echo.</div>
        <div class="hint">Current assignment: ${activeTarget ? `${String(this._hass?.states[activeTarget.dashboard]?.state || "unknown")} / ${String(this._hass?.states[activeTarget.dashboardToShow]?.state || "unknown")} / idle ${String(this._hass?.states[activeTarget.idle]?.state || "unknown")}` : "Select a device to read its current settings."}</div>
      </div>
      <div class="section"><h3>Echo dashboards applied from this builder</h3><div class="hint">The list shows dashboards created by this builder. Applying a new setup replaces the previous builder dashboard for that same Echo; setups saved above are kept.</div>${managedDashboardList}<div id="managed-delete-status" class="hint" aria-live="polite"></div></div>
      <div class="section"><h3>Save setup</h3><div class="hint">Saves this named reusable setup and keeps the editor open.</div><button id="save-profile" type="button">Save setup</button><div id="save-profile-status" class="hint" aria-live="polite"></div></div>`;
    root.querySelectorAll<HTMLButtonElement>("[data-delete-managed]").forEach((button) => button.addEventListener("click", async () => {
      const dashboard = this.managedDashboards.find((item) => item.id === button.dataset.deleteManaged);
      if (!dashboard || !window.confirm(`Remove the dashboard “${dashboard.title}” (${dashboard.url_path})? This does not remove the Echo device.`)) return;
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
        icon: card.querySelector<HTMLInputElement>("[data-menu-icon]")?.value.trim() || "mdi:view-dashboard",
        cameras: readSelection("[data-menu-camera]", existing?.cameras),
        lights: readSelection("[data-menu-light]", existing?.lights),
        temperatures: readSelection("[data-menu-temperature]", existing?.temperatures),
        action: card.querySelector<HTMLSelectElement>("[data-menu-action]")?.value === "navigate" ? "navigate" : "view",
        destination: card.querySelector<HTMLSelectElement>("[data-menu-destination]")?.value === "__custom__"
          ? card.querySelector<HTMLInputElement>("[data-menu-custom-destination]")?.value.trim() || ""
          : card.querySelector<HTMLSelectElement>("[data-menu-destination]")?.value || "",
        source: card.querySelector<HTMLSelectElement>("[data-menu-source]")?.value === "lovelace_card" ? "lovelace_card" : "menu",
        lovelace_card_ids: Array.from(card.querySelectorAll<HTMLInputElement>("[data-menu-lovelace-card]:checked"), (input) => input.value),
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
      const profile: any = savedProfiles.find((item) => item.id === this.selectedProfileId);
      if (profile) {
        this.emit({ menus: profile.menus, camera_order: profile.camera_order || [], camera_overlays: profile.camera_overlays || {}, camera_spans: profile.camera_spans || {}, camera_refresh_interval: profile.camera_refresh_interval || 3000, camera_refresh_intervals: profile.camera_refresh_intervals || {}, kiosk_mode: kioskModeSetting(profile.kiosk_mode, "enabled"), active_profile_id: profile.id }, true);
      } else {
        this.emit({ active_profile_id: "" }, true);
      }
    });
    root.querySelector<HTMLButtonElement>("#remove-profile")?.addEventListener("click", () => {
      const profile: any = savedProfiles.find((item: any) => item.id === selectedProfileId);
      if (!profile || !window.confirm(`Remove the saved setup “${profile.name}” from this master dashboard? Existing Echo dashboards will not be changed.`)) return;
      const next = savedProfiles.filter((item: any) => item.id !== profile.id);
      this.selectedProfileId = "";
      this.emit({ saved_profiles: next, active_profile_id: "" }, true);
    });
    root.querySelector<HTMLButtonElement>("#save-profile")?.addEventListener("click", () => {
      const name = root.querySelector<HTMLInputElement>("#profile-name")?.value.trim() || "";
      const status = root.querySelector<HTMLElement>("#save-profile-status");
      if (!name) { if (status) status.textContent = "Enter a setup name first."; return; }
      const id = selectedProfileId || `setup-${Date.now()}`;
      const profile: EchoSavedDashboardProfile = {
        id,
        name,
        menus: readMenuProfiles(),
        camera_order: [...cameraOrder],
        camera_overlays: { ...(this.config.camera_overlays || {}) },
        camera_spans: { ...(this.config.camera_spans || {}) },
        camera_refresh_interval: cameraRefreshInterval,
        camera_refresh_intervals: { ...(this.config.camera_refresh_intervals || {}) },
        kiosk_mode: kioskModeSetting(root.querySelector<HTMLSelectElement>("#kiosk-mode")?.value, "enabled"),
      };
      this.selectedProfileId = id;
      this.emit({ saved_profiles: [...savedProfiles.filter((item) => item.id !== id), profile], active_profile_id: id }, true);
    });
    // Text fields commit on change (blur/Enter), not every keystroke.  Emitting
    // config-changed while typing makes Home Assistant recreate this editor and
    // returns its scroll position to the top.
    root.querySelectorAll<HTMLInputElement>("[data-menu-camera], [data-menu-light], [data-menu-temperature], [data-menu-lovelace-card], [data-overlay-show]").forEach((input) => input.addEventListener("change", () => this.emitCurrentConfig()));
    root.querySelectorAll<HTMLSelectElement>("[data-menu-order], [data-menu-action], [data-menu-destination], [data-menu-source], [data-order], [data-overlay-h], [data-overlay-v], [data-span], [data-camera-refresh], #camera-refresh-default, #kiosk-mode").forEach((input) => input.addEventListener("change", () => this.emitCurrentConfig()));
    const updateMenus = (rerender = false) => {
      this.emit({ menus: readMenuProfiles() }, rerender);
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
    root.querySelectorAll<HTMLInputElement>("[data-menu-label], [data-menu-icon], [data-menu-custom-destination]").forEach((input) => input.addEventListener("change", () => {
      const card = input.closest<HTMLElement>("[data-menu-card]");
      const index = Array.from(root.querySelectorAll("[data-menu-card]")).indexOf(card!);
      const label = card?.querySelector<HTMLInputElement>("[data-menu-label]")?.value.trim() || `Menu ${index + 1}`;
      if (card) card.querySelector("summary")!.textContent = `Menu ${index + 1}: ${label}`;
      updateMenus();
    }));
    root.querySelectorAll<HTMLSelectElement>("[data-menu-action]").forEach((select) => select.addEventListener("change", () => {
      this.emit({ menus: readMenuProfiles() }, true);
    }));
    root.querySelectorAll<HTMLSelectElement>("[data-menu-source]").forEach((select) => select.addEventListener("change", () => {
      this.emit({ menus: readMenuProfiles() }, true);
    }));
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
      updateMenus();
    }));
    root.querySelectorAll<HTMLButtonElement>("[data-remove-menu]").forEach((button) => button.addEventListener("click", () => {
      const next = readMenuProfiles().filter((menu) => menu.id !== button.closest<HTMLElement>("[data-menu-card]")?.dataset.menuCard);
      if (next.length) this.emit({ menus: next }, true);
    }));
    root.querySelector<HTMLButtonElement>("#add-menu")?.addEventListener("click", () => {
      const next = readMenuProfiles();
      let index = next.length + 1;
      while (next.some((menu) => menu.id === `menu-${index}`)) index += 1;
      next.push({ id: `menu-${index}`, label: `Menu ${index}`, icon: "mdi:view-dashboard", cameras: [], lights: [], temperatures: [], action: "view", destination: "" });
      this.emit({ menus: next }, true);
    });
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
    root.querySelector<HTMLButtonElement>("#echo-load-attached")?.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      let status = root.querySelector<HTMLElement>("#echo-create-status");
      const target = targets.find((item) => item.key === (root.querySelector<HTMLSelectElement>("#echo-target")?.value || ""));
      const managed = target && this.managedDashboards.find((dashboard) => dashboard.target === target.key);
      if (!target || !managed) { if (status) status.textContent = "There is no builder dashboard currently applied to that Echo Show."; return; }
      button.disabled = true;
      if (status) status.textContent = "Loading the current Echo setup into this builder…";
      try {
        const applied = await this.callWS({ type: "lovelace/config", url_path: managed.url_path });
        const strategy = applied?.strategy;
        if (strategy?.type !== "custom:echo-show" || strategy.echo_managed !== true) throw new Error("The selected dashboard is not a dashboard created by this builder.");
        const restored = {
          ...this.config,
          menus: strategy.menus || [],
          included_cameras: strategy.included_cameras,
          included_lights: strategy.included_lights,
          included_temperatures: strategy.included_temperatures,
          menu: strategy.menu,
          camera_overlays: strategy.camera_overlays || {},
          camera_spans: strategy.camera_spans || {},
          camera_order: strategy.camera_order || [],
          camera_refresh_interval: strategy.camera_refresh_interval || 3000,
          camera_refresh_intervals: strategy.camera_refresh_intervals || {},
          echo_target: target.key,
          echo_mode: strategy.echo_mode || "Streamed",
          echo_dashboard_when_idle: Boolean(strategy.echo_dashboard_when_idle),
          echo_managed: false,
        };
        await this.persistBuilderConfig(restored);
        this.config = restored;
        this.render();
        status = this.shadowRoot?.querySelector<HTMLElement>("#echo-create-status") || null;
        if (status) status.textContent = `Loaded and saved the current ${target.label} setup in this builder. The Echo was not changed.`;
      } catch (error) {
        if (status) status.textContent = `Could not load the current Echo setup: ${String(error)}`;
      } finally {
        const currentButton = this.shadowRoot?.querySelector<HTMLButtonElement>("#echo-load-attached");
        if (currentButton) currentButton.disabled = false;
      }
    });
    root.querySelector<HTMLButtonElement>("#echo-create-dashboard")?.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      let status = root.querySelector<HTMLElement>("#echo-create-status");
      const target = targets.find((item) => item.key === (root.querySelector<HTMLSelectElement>("#echo-target")?.value || ""));
      if (!target) { if (status) status.textContent = "Select an Echo Show first."; return; }
      button.disabled = true;
      if (status) status.textContent = "Applying this setup…";
      let created: any;
      let reusedExisting = false;
      let attached = false;
      let priorManagedDashboards: Array<{ id: string; title: string; url_path: string; target: string }> = [];
      try {
        // Applying is also the point at which the working builder setup becomes
        // durable.  Without this, the generated Echo dashboard could contain
        // newer menus than the builder the user returns to edit.
        const currentConfig = this.getCurrentConfig();
        const configuredMenus = getMenuProfiles(currentConfig, cameras, lights, temperatures);
        const invalidNavigation = configuredMenus.find((menu) => menu.action === "navigate" && !localDashboardPath(menu.destination));
        if (invalidNavigation) throw new Error(`Menu “${invalidNavigation.label}” needs a valid Home Assistant destination path, such as /lovelace/0.`);
        const lovelaceCards = await this.resolveLovelaceCards(currentConfig, configuredMenus);
        if (!this.config.echo_managed) {
          await this.persistBuilderConfig(currentConfig);
          this.config = { ...currentConfig, echo_managed: false };
        }
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
        const usedPaths = new Set<string>(storageDashboards.map((item: any) => String(item.url_path || "")));
        const savedProfile: any = savedProfiles.find((item: any) => item.id === selectedProfileId);
        const profileName = savedProfile?.name || "";
        const baseTitle = [target.label.trim() || "Echo Show", profileName].filter(Boolean).join(" — ");
        const slug = baseTitle.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "echo-show";
        let urlPath = slug;
        let suffix = 2;
        while (usedPaths.has(urlPath)) urlPath = `${slug}-${suffix++}`;
        let title = suffix === 2 ? baseTitle : `${baseTitle} ${suffix - 1}`;
        // A device has one managed dashboard. Updating it in place keeps its
        // registered title valid for TECHO5 and avoids creating history.
        const currentManaged = priorManagedDashboards[0];
        if (currentManaged) {
          reusedExisting = true;
          urlPath = currentManaged.url_path;
          title = currentManaged.title;
          created = { id: currentManaged.id, url_path: urlPath, title };
        } else {
          created = await this.callWS({ type: "lovelace/dashboards/create", url_path: urlPath, title, show_in_sidebar: true, require_admin: false });
        }
        const menus = configuredMenus;
        const strategyConfig = {
          type: "custom:echo-show",
          title,
          menus,
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
        // TECHO5 chooses from Home Assistant dashboard titles.  A raw Lovelace
        // page path is not a dashboard and makes the device show its error page.
        const availableDashboardTitles = async (): Promise<string[]> => {
          const states = await this.callWS({ type: "get_states" });
          const dashboardState = Array.isArray(states)
            ? states.find((state: any) => state?.entity_id === target.dashboardToShow)
            : undefined;
          const options = dashboardState?.attributes?.options;
          return Array.isArray(options) ? options.map((option: unknown) => String(option)) : [];
        };
        let dashboardAvailable = reusedExisting;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          if ((await availableDashboardTitles()).includes(title)) {
            dashboardAvailable = true;
            break;
          }
          await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
        }
        if (!dashboardAvailable) {
          throw new Error(`Home Assistant did not make “${title}” available to ${target.label}.`);
        }
        const currentDashboardTitles = await this.callWS({ type: "get_states" });
        const currentDashboardState = Array.isArray(currentDashboardTitles)
          ? currentDashboardTitles.find((state: any) => state?.entity_id === target.dashboardToShow)
          : undefined;
        if (currentDashboardState?.state !== title) {
          await this._hass.callService("select", "select_option", { entity_id: target.dashboardToShow, option: title });
        }
        let dashboardSelected = false;
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const states = await this.callWS({ type: "get_states" });
          const dashboardState = Array.isArray(states)
            ? states.find((state: any) => state?.entity_id === target.dashboardToShow)
            : undefined;
          if (dashboardState?.state === title) {
            dashboardSelected = true;
            break;
          }
          await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
        }
        if (!dashboardSelected) {
          throw new Error(`Home Assistant did not confirm “${title}” on ${target.label}.`);
        }
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
          status.textContent = removalErrors.length
            ? `Applied the setup to ${target.label}. Home Assistant could not remove every previous builder dashboard, so those are still listed for removal: ${removalErrors.join("; ")}`
            : priorManagedDashboards.length
              ? `Applied the setup to ${target.label}; its previous builder dashboard${priorManagedDashboards.length === 1 ? " was" : "s were"} replaced. Your saved setups and builder preview remain.`
              : `Applied the setup to ${target.label}. Your saved setups and builder preview remain.`;
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
