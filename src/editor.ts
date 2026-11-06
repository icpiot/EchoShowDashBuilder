import { listAvailableCameras } from "./camera-feeds";

type Hass = { states: Record<string, any> };

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
  private render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const root = this.shadowRoot!;
    const cameras = this._hass ? listAvailableCameras(this._hass) : [];
    const included = new Set<string>(this.config.included_cameras || cameras.map((camera) => camera.entityId));
    const menu = Array.isArray(this.config.menu) ? this.config.menu : ["cameras", "lights"];
    root.innerHTML = `<style>:host{display:block;font-family:Arial,sans-serif;padding:12px}.row{display:flex;gap:10px;align-items:center;margin:10px 0}.section{margin:18px 0}.section h3{margin:0 0 8px}.camera{display:flex;gap:8px;padding:6px 0}input[type=text]{width:100%;padding:8px}label{cursor:pointer}.hint{opacity:.7;font-size:.9em}</style>
      <div class="section"><h3>Echo Show profile</h3><div class="row"><label for="title">Profile name</label><input id="title" type="text" value="${String(this.config.title || "Echo Show").replace(/"/g, "&quot;")}"></div><div class="row"><input id="kiosk" type="checkbox" ${this.config.kiosk_mode ? "checked" : ""}><label for="kiosk">Kiosk mode</label></div></div>
      <div class="section"><h3>Menu items</h3><div class="hint">Choose the destinations shown on this Echo Show, in this order.</div>${["home", "cameras", "lights"].map((item) => `<label class="camera"><input type="checkbox" data-menu="${item}" ${menu.includes(item) ? "checked" : ""}>${item[0].toUpperCase() + item.slice(1)}</label>`).join("")}</div>
      <div class="section"><h3>Included cameras</h3>${cameras.length ? cameras.map((camera) => `<label class="camera"><input type="checkbox" data-camera="${camera.entityId}" ${included.has(camera.entityId) ? "checked" : ""}>${camera.label}</label>`).join("") : `<div class="hint">Camera entities will appear when Home Assistant provides state.</div>`}</div>`;
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
  }
}

if (!customElements.get("echo-show-editor")) customElements.define("echo-show-editor", EchoShowEditor);
