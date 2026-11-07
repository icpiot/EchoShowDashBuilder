import { listAvailableCameras } from "./camera-feeds";

type Hass = { states: Record<string, any>; callService?: (domain: string, service: string, data: Record<string, unknown>) => Promise<unknown> };

type EchoTarget = {
  key: string;
  label: string;
  dashboard: string;
  dashboardToShow: string;
  idle: string;
};

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

class EchoShowEditor extends HTMLElement {
  private config: any = {};
  private _hass?: Hass;
  setConfig(config: any) { this.config = { ...config }; this.render(); }
  set hass(value: Hass) { this._hass = value; this.render(); }
  connectedCallback() { this.render(); }
  private emit(patch: Record<string, unknown>) {
    this.config = { ...this.config, ...patch };
    this.dispatchEvent(new CustomEvent("config-changed", { bubbles: true, composed: true, detail: { config: this.config } }));
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
    const cameras = this._hass ? listAvailableCameras(this._hass) : [];
    const lights = Object.values(this._hass?.states || {}).filter((state: any) => String(state.entity_id).startsWith("light.")).sort((a: any, b: any) => String(a.attributes?.friendly_name || a.entity_id).localeCompare(String(b.attributes?.friendly_name || b.entity_id)));
    const included = new Set<string>(this.config.included_cameras || cameras.map((camera) => camera.entityId));
    const includedLights = new Set<string>(this.config.included_lights || lights.map((light: any) => light.entity_id));
    const overlays = this.config.camera_overlays || {};
    const spans = this.config.camera_spans || {};
    const configuredOrder: string[] = Array.isArray(this.config.camera_order) ? this.config.camera_order : [];
    const cameraOrder = [...configuredOrder.filter((entity) => cameras.some((camera) => camera.entityId === entity)), ...cameras.filter((camera) => !configuredOrder.includes(camera.entityId)).map((camera) => camera.entityId)];
    const orderedCameras = [...cameras].sort((a, b) => cameraOrder.indexOf(a.entityId) - cameraOrder.indexOf(b.entityId));
    const menu = Array.isArray(this.config.menu) ? this.config.menu : ["home", "cameras", "lights"];
    const targets = this.targets();
    const selectedTarget = String(this.config.echo_target || "");
    const selectedDashboard = String(this.config.echo_dashboard || this.config.title || "Echo Show HTML Dash Dev");
    const activeTarget = targets.find((target) => target.key === selectedTarget);
    const dashboardOptions = Array.isArray(this._hass?.states[activeTarget?.dashboardToShow || ""]?.attributes?.options)
      ? this._hass?.states[activeTarget?.dashboardToShow || ""]?.attributes?.options as string[] : [];
    const dashboardSelect = dashboardOptions.length
      ? dashboardOptions.map((option) => `<option value="${String(option).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")}" ${option === selectedDashboard ? "selected" : ""}>${String(option).replace(/</g, "&lt;")}</option>`).join("")
      : `<option value="${selectedDashboard.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")}" selected>No dashboard options reported</option>`;
    const selectedMode = String(this.config.echo_mode || "Streamed");
    const selectedIdle = Boolean(this.config.echo_dashboard_when_idle);
    root.innerHTML = `<style>:host{display:block;font-family:Arial,sans-serif;padding:12px}.row{display:flex;gap:10px;align-items:center;margin:10px 0}.section{margin:18px 0}.section h3{margin:0 0 8px}.camera{display:flex;gap:8px;padding:6px 0}input[type=text]{width:100%;padding:8px}label{cursor:pointer}.hint{opacity:.7;font-size:.9em}</style>
      <div class="section"><h3>Echo Show profile</h3><div class="row"><label for="title">Profile name</label><input id="title" type="text" value="${String(this.config.title || "Echo Show").replace(/"/g, "&quot;")}"></div><div class="row"><input id="kiosk" type="checkbox" ${this.config.kiosk_mode ? "checked" : ""}><label for="kiosk">Kiosk mode</label></div></div>
      <div class="section"><h3>Menu items</h3><div class="hint">Choose the destinations shown on this Echo Show, in this order.</div>${["home", "cameras", "lights"].map((item) => `<label class="camera"><input type="checkbox" data-menu="${item}" ${menu.includes(item) ? "checked" : ""}>${item[0].toUpperCase() + item.slice(1)}</label>`).join("")}</div>
      <div class="section"><h3>Included cameras</h3>${orderedCameras.length ? orderedCameras.map((camera) => { const o=overlays[camera.entityId] || {}; const span=Math.max(1,Math.min(3,Number(spans[camera.entityId])||1)); const position=cameraOrder.indexOf(camera.entityId)+1; return `<div class="camera"><label><input type="checkbox" data-camera="${camera.entityId}" ${included.has(camera.entityId) ? "checked" : ""}>${camera.label}</label><label>Order <select data-order="${camera.entityId}">${orderedCameras.map((_,i)=>`<option value="${i+1}" ${position===i+1?"selected":""}>${i+1}</option>`).join("")}</select></label><label>Show name <input type="checkbox" data-overlay-show="${camera.entityId}" ${o.show !== false ? "checked" : ""}></label><select data-overlay-h="${camera.entityId}"><option value="left" ${o.horizontal === "left" || !o.horizontal ? "selected" : ""}>Left</option><option value="center" ${o.horizontal === "center" ? "selected" : ""}>Centre</option><option value="right" ${o.horizontal === "right" ? "selected" : ""}>Right</option></select><select data-overlay-v="${camera.entityId}"><option value="top" ${o.vertical === "top" ? "selected" : ""}>Top</option><option value="bottom" ${o.vertical !== "top" ? "selected" : ""}>Bottom</option></select><label>Tile width <select data-span="${camera.entityId}"><option value="1" ${span === 1 ? "selected" : ""}>1 box</option><option value="2" ${span === 2 ? "selected" : ""}>2 boxes</option><option value="3" ${span === 3 ? "selected" : ""}>3 boxes</option></select></label></div>`; }).join("") : `<div class="hint">Camera entities will appear when Home Assistant provides state.</div>`}</div>
      <div class="section"><h3>Included lights</h3><div class="hint">Choose which lights appear on this dashboard.</div>${lights.length ? lights.map((light: any) => `<label class="camera"><input type="checkbox" data-light="${light.entity_id}" ${includedLights.has(light.entity_id) ? "checked" : ""}>${light.attributes?.friendly_name || light.entity_id}</label>`).join("") : `<div class="hint">No light entities are available.</div>`}</div>
      <div class="section"><h3>Apply to Echo Show</h3><div class="hint">Uses the TECHO5 device controls already exposed by Home Assistant. Applying changes affects only the selected device.</div>
        <div class="row"><label for="echo-target">Echo Show</label><select id="echo-target" size="${Math.min(Math.max(targets.length + 1, 2), 5)}">${targets.length ? `<option value="">Select a device</option>${targets.map((target) => `<option value="${target.key}" ${target.key === selectedTarget ? "selected" : ""}>${target.label}</option>`).join("")}` : `<option value="">No TECHO5 devices discovered</option>`}</select></div>
        <div class="row"><label for="echo-dashboard">Dashboard</label><select id="echo-dashboard" size="${Math.min(Math.max(dashboardOptions.length, 2), 6)}">${dashboardSelect}</select></div>
        <div class="hint">Current assignment: ${activeTarget ? `${String(this._hass?.states[activeTarget.dashboard]?.state || "unknown")} / ${String(this._hass?.states[activeTarget.dashboardToShow]?.state || "unknown")} / idle ${String(this._hass?.states[activeTarget.idle]?.state || "unknown")}` : "Select a device to read its current settings."}</div>
        <div class="row"><label for="echo-mode">Presentation</label><select id="echo-mode"><option ${selectedMode === "Streamed" ? "selected" : ""}>Streamed</option><option ${selectedMode === "Drawn on the device" ? "selected" : ""}>Drawn on the device</option></select></div>
        <div class="row"><input id="echo-idle" type="checkbox" ${selectedIdle ? "checked" : ""}><label for="echo-idle">Dashboard when idle</label></div>
        <button id="echo-apply" type="button">Apply to Echo Show</button><span id="echo-status" class="hint"></span>
      </div>`;
    root.querySelector<HTMLInputElement>("#title")?.addEventListener("change", (event) => this.emit({ title: (event.target as HTMLInputElement).value }));
    root.querySelector<HTMLInputElement>("#kiosk")?.addEventListener("change", (event) => this.emit({ kiosk_mode: (event.target as HTMLInputElement).checked }));
    root.querySelectorAll<HTMLInputElement>("[data-menu]").forEach((input) => input.addEventListener("change", () => {
      const next = Array.from(root.querySelectorAll<HTMLInputElement>("[data-menu]:checked")).map((item) => item.dataset.menu);
      this.emit({ menu: next });
    }));
    root.querySelectorAll<HTMLInputElement>("[data-camera]").forEach((input) => input.addEventListener("change", () => {
      const next = Array.from(root.querySelectorAll<HTMLInputElement>("[data-camera]:checked")).map((item) => item.dataset.camera);
      this.emit({ included_cameras: next });
    }));
    root.querySelectorAll<HTMLInputElement>("[data-light]").forEach((input) => input.addEventListener("change", () => {
      const next = Array.from(root.querySelectorAll<HTMLInputElement>("[data-light]:checked")).map((item) => item.dataset.light);
      this.emit({ included_lights: next });
    }));
    const updateOverlay = (entity: string) => {
      const next = { ...(this.config.camera_overlays || {}) };
      next[entity] = { show: root.querySelector<HTMLInputElement>(`[data-overlay-show="${entity}"]`)?.checked !== false, horizontal: root.querySelector<HTMLSelectElement>(`[data-overlay-h="${entity}"]`)?.value || "left", vertical: root.querySelector<HTMLSelectElement>(`[data-overlay-v="${entity}"]`)?.value || "bottom" };
      this.emit({ camera_overlays: next });
    };
    root.querySelectorAll<HTMLInputElement>("[data-overlay-show]").forEach((input) => input.addEventListener("change", () => updateOverlay(input.dataset.overlayShow || "")));
    root.querySelectorAll<HTMLSelectElement>("[data-overlay-h], [data-overlay-v]").forEach((input) => input.addEventListener("change", () => updateOverlay((input.dataset.overlayH || input.dataset.overlayV || ""))));
    root.querySelectorAll<HTMLSelectElement>("[data-span]").forEach((input) => input.addEventListener("change", () => {
      const next = { ...(this.config.camera_spans || {}) };
      next[input.dataset.span || ""] = Number(input.value);
      this.emit({ camera_spans: next });
    }));
    root.querySelectorAll<HTMLSelectElement>("[data-order]").forEach((input) => input.addEventListener("change", () => {
      const entity = input.dataset.order || "";
      this.emit({ camera_order: moveCameraToPosition(cameraOrder, entity, Number(input.value) - 1) });
    }));
    root.querySelector<HTMLSelectElement>("#echo-target")?.addEventListener("change", (event) => {
      const key = (event.target as HTMLSelectElement).value;
      const target = targets.find((item) => item.key === key);
      const options = target ? this._hass?.states[target.dashboardToShow]?.attributes?.options : [];
      this.emit({ echo_target: key, echo_dashboard: Array.isArray(options) && options.length ? options[0] : "" });
    });
    root.querySelector<HTMLSelectElement>("#echo-dashboard")?.addEventListener("change", (event) => this.emit({ echo_dashboard: (event.target as HTMLSelectElement).value }));
    root.querySelector<HTMLSelectElement>("#echo-mode")?.addEventListener("change", (event) => this.emit({ echo_mode: (event.target as HTMLSelectElement).value }));
    root.querySelector<HTMLInputElement>("#echo-idle")?.addEventListener("change", (event) => this.emit({ echo_dashboard_when_idle: (event.target as HTMLInputElement).checked }));
    root.querySelector<HTMLButtonElement>("#echo-apply")?.addEventListener("click", async () => {
      const target = targets.find((item) => item.key === (root.querySelector<HTMLSelectElement>("#echo-target")?.value || ""));
      const status = root.querySelector<HTMLElement>("#echo-status");
      if (!target || !this._hass?.callService) { if (status) status.textContent = "Select a device and ensure Home Assistant service access is available."; return; }
      const dashboard = root.querySelector<HTMLSelectElement>("#echo-dashboard")?.value || "";
      const mode = root.querySelector<HTMLSelectElement>("#echo-mode")?.value || "Streamed";
      const idle = root.querySelector<HTMLInputElement>("#echo-idle")?.checked || false;
      try {
        const options = this._hass.states[target.dashboardToShow]?.attributes?.options;
        if (!Array.isArray(options) || !options.includes(dashboard)) {
          if (status) status.textContent = "That device does not expose the selected dashboard.";
          return;
        }
        if (!window.confirm(`Apply ${mode} / ${dashboard} / idle ${idle ? "on" : "off"} to ${target.label}?`)) {
          if (status) status.textContent = "Apply cancelled.";
          return;
        }
        await this._hass.callService("select", "select_option", { entity_id: target.dashboard, option: mode });
        await this._hass.callService("select", "select_option", { entity_id: target.dashboardToShow, option: dashboard });
        await this._hass.callService("switch", idle ? "turn_on" : "turn_off", { entity_id: target.idle });
        const current = this._hass.states[target.dashboardToShow]?.state;
        if (status) status.textContent = current === dashboard ? "Applied and verified." : `Applied; waiting for device state to report ${dashboard}.`;
      } catch (error) { if (status) status.textContent = `Apply failed: ${String(error)}`; }
    });
  }
}

if (!customElements.get("echo-show-editor")) customElements.define("echo-show-editor", EchoShowEditor);
