type Hass = { states: Record<string, any>; hassUrl?: string; callWS?: (msg: any) => Promise<any>; callService?: (domain: string, service: string, data: Record<string, unknown>) => Promise<unknown> };

const styles = `:host{display:block;color:var(--primary-text-color,#fff);font-family:var(--paper-font-body1_-_font-family,Arial,sans-serif)}*{box-sizing:border-box}.menu-bar{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,1.25fr) minmax(0,1fr);gap:6px;align-items:stretch;max-width:100%;margin:0 auto 4px;padding:0 4px}.menu,.toggle-group{display:flex;gap:6px;min-width:0}.menu{display:grid;grid-template-columns:repeat(var(--menu-count,1),minmax(0,1fr));min-width:0}.toggle-group{min-width:0}.toggle-group.right{justify-content:flex-start}.menu button,.toggle-group button{display:flex;align-items:center;gap:6px;min-width:0;min-height:46px;border:0;border-radius:10px;padding:8px 10px;background:var(--ha-card-background,#20252b);color:#f5f7fa;font:inherit;font-size:clamp(12px,2vw,18px);white-space:nowrap;cursor:pointer}.menu button{width:100%}.menu button.icon-left,.toggle-group button.icon-left{justify-content:flex-start}.menu button.icon-center,.toggle-group button.icon-center{justify-content:center}.menu button.icon-right,.toggle-group button.icon-right{justify-content:flex-end}.menu button.active{background:var(--primary-color,#03a9f4);color:#fff}.toggle-group button.active{background:var(--toggle-active,var(--success-color,#4caf50));color:#fff}.toggle-group button{flex:1 1 0;max-width:none;overflow:hidden;text-overflow:ellipsis}.toggle-group button span{display:grid;gap:1px;line-height:1.1;min-width:0;overflow:hidden;text-overflow:ellipsis}.toggle-group button small{font-size:.68em;opacity:.82}@media(max-width:700px){.menu-bar{grid-template-columns:1fr 1fr}.menu{grid-column:1/-1;order:-1}.toggle-group{min-width:0}}@media(max-width:420px){.menu-bar{grid-template-columns:1fr}.menu{grid-column:auto}.toggle-group{width:100%}}.wall{display:grid;grid-template-columns:repeat(var(--cols,2),minmax(0,1fr));gap:var(--gap,6px)}.wall.compact .tile{max-width:var(--tile-max-width);margin-inline:auto}.tile{min-width:0;width:100%;position:relative;background:#090b0d;border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;aspect-ratio:16/9;height:var(--tile-height,auto);cursor:pointer}.tile img{display:block;width:100%;height:100%;object-fit:contain}.tile.person-detected{outline:3px solid var(--person-glow,#ffc107);outline-offset:-3px;box-shadow:0 0 16px 3px var(--person-glow,#ffc107);z-index:1}.tile[data-detection-animation="soft-pulse"].person-detected{animation:echo-person-pulse 1.8s ease-in-out infinite}.tile[data-detection-animation="beacon"].person-detected{animation:echo-person-pulse .75s ease-in-out infinite}.tile[data-detection-animation="corner"].person-detected{outline:none;box-shadow:none}.person-badge{position:absolute;top:7px;right:7px;padding:3px 7px;border-radius:999px;background:var(--person-glow,#ffc107);color:#111;font-size:clamp(10px,1.3vw,13px);font-weight:700;box-shadow:0 1px 4px #0008}.person-badge[hidden]{display:none}@keyframes echo-person-pulse{50%{outline-color:color-mix(in srgb,var(--person-glow,#ffc107) 35%,transparent);box-shadow:0 0 6px 1px var(--person-glow,#ffc107)}}.label{position:absolute;left:0;right:0;color:#fff;padding:5px 8px;background:linear-gradient(transparent,rgba(0,0,0,.8));font-size:clamp(11px,1.6vw,15px);text-shadow:0 1px 2px #000}.label.top{top:0;bottom:auto;background:linear-gradient(rgba(0,0,0,.8),transparent)}.label.bottom{bottom:0}.label.left{text-align:left}.label.center{text-align:center}.label.right{text-align:right}.label[hidden]{display:none}.empty{padding:16px;text-align:center;opacity:.7}`;

const escapeAttribute = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const localPath = (value: unknown): string | undefined => {
  const path = String(value ?? "").trim();
  if (!path || !path.startsWith("/") || path.startsWith("//") || /[\\\\\u0000-\u001f]/.test(path)) return undefined;
  try { const parsed = new URL(path, window.location.origin); return parsed.origin === window.location.origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : undefined; } catch { return undefined; }
};
const stateIcon = (fallback: unknown, entity: unknown, hass?: Hass) => {
  const source = hass?.states?.[String(entity || "")];
  if (!source) return String(fallback || "");
  const supplied = String(source.attributes?.icon || "");
  if (supplied.startsWith("mdi:")) return supplied;
  const weather: Record<string, string> = { sunny: "mdi:weather-sunny", clear: "mdi:weather-sunny", partlycloudy: "mdi:weather-partly-cloudy", cloudy: "mdi:weather-cloudy", rainy: "mdi:weather-rainy", pouring: "mdi:weather-pouring", lightning: "mdi:weather-lightning", lightning_rainy: "mdi:weather-lightning-rainy", snowy: "mdi:weather-snowy", fog: "mdi:weather-fog", windy: "mdi:weather-windy", exceptional: "mdi:weather-hurricane" };
  return weather[String(source.state || "").toLowerCase()] || String(fallback || "");
};
const setMenuVisibility = (element: HTMLElement, config: any) => {
  const menuId = String(config?.menu_id || "");
  if (!menuId) return;
  const apply = (selected = String((window as any).__echoShowActiveMenu || "")) => {
    element.style.display = !selected || selected === menuId ? "" : "none";
  };
  const previous = (element as any).__echoMenuListener;
  if (previous) window.removeEventListener("echo-show-menu-change", previous);
  const listener = (event: Event) => apply(String((event as CustomEvent).detail?.id || ""));
  (element as any).__echoMenuListener = listener;
  window.addEventListener("echo-show-menu-change", listener);
  apply();
};

class EchoMenu extends HTMLElement {
  private config: any = {}; private _hass?: Hass; private running = new Set<string>(); private holdTimers = new Map<string, number>();
  setConfig(config: any) {
    this.config = config || {};
    const items = Array.isArray(this.config.items) ? this.config.items : [];
    if (!items.some((item: any) => item.path === (window as any).__echoShowActiveMenu)) {
      const initialPath = this.config.active_path || this.config.items?.find((item: any) => item.action !== "navigate")?.path || "";
      (window as any).__echoShowActiveMenu = initialPath;
      window.dispatchEvent(new CustomEvent("echo-show-menu-change", { detail: { id: initialPath } }));
    }
    this.render();
  }
  set hass(value: Hass) { this._hass = value; this.render(); }
  connectedCallback() { this.render(); }
  private render() {
    const items = Array.isArray(this.config.items) ? this.config.items : [];
    const root = this.shadowRoot ?? this.attachShadow({mode:'open'});
    const toggles = Array.isArray(this.config.toggles) ? this.config.toggles : [];
    const statuses = Array.isArray(this.config.statuses) ? this.config.statuses : [];
    const toggleMarkup = (placement: string) => toggles.filter((toggle: any) => (toggle.placement === "right" ? "right" : "left") === placement).sort((a: any, b: any) => Number(a.order || 0) - Number(b.order || 0)).map((toggle: any) => {
      const state = this._hass?.states?.[toggle.state_entity];
      if (toggle.hide_unavailable && (!state || ["unavailable", "unknown"].includes(String(state.state)))) return "";
      const active = ["on", "true", "home", "open", "active"].includes(String(this._hass?.states?.[toggle.state_entity]?.state || "").toLowerCase());
      const label = active ? (toggle.on_label || toggle.label) : (toggle.off_label || toggle.label);
      const running = this.running.has(String(toggle.id));
      const iconPlacement = toggle.icon_placement === "center" || toggle.icon_placement === "right" ? toggle.icon_placement : "left";
      const icon = stateIcon(toggle.icon, toggle.icon_entity, this._hass);
      return `<button type="button" data-toggle-id="${escapeAttribute(toggle.id)}" class="${active ? "active " : ""}icon-${iconPlacement}" aria-pressed="${active}" ${running ? "disabled" : ""} style="--toggle-active:${escapeAttribute(toggle.active_color || "var(--success-color,#4caf50)")}" title="${escapeAttribute(toggle.last_status || "")}">${icon ? `<ha-icon icon="${escapeAttribute(icon)}"></ha-icon>` : ""}<span>${escapeAttribute(running ? "Working…" : label)}${toggle.subtitle ? `<small>${escapeAttribute(toggle.subtitle)}</small>` : ""}</span></button>`;
    }).join("");
    const statusMarkup = (placement: string) => statuses.filter((status: any) => (status.placement === "right" ? "right" : "left") === placement).sort((a: any,b:any)=>Number(a.order||0)-Number(b.order||0)).map((status:any) => { const value=status.type === "time" ? new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Perth",hour:"numeric",minute:"2-digit",hour12:status.time_format !== "24"}).format(new Date()) : String(this._hass?.states?.[status.entity]?.state || "—"); const unit=status.type === "entity" ? String(this._hass?.states?.[status.entity]?.attributes?.unit_of_measurement || "") : ""; const icon=stateIcon(status.icon,status.icon_entity,this._hass); const alignment=status.alignment === "center" || status.alignment === "right" ? status.alignment : "left"; return `<button type="button" class="echo-status icon-${alignment}" data-status-id="${escapeAttribute(status.id)}" data-status-action="${escapeAttribute(status.action)}" data-destination="${escapeAttribute(status.destination)}" data-service="${escapeAttribute(status.service)}">${icon ? `<ha-icon icon="${escapeAttribute(icon)}"></ha-icon>` : ""}<span>${escapeAttribute(status.label ? `${status.label} ` : "")}${escapeAttribute(value)}${unit ? ` ${escapeAttribute(unit)}` : ""}</span></button>`; }).join("");
    root.innerHTML = `<style>${styles}</style><div class="menu-bar"><div class="toggle-group left">${statusMarkup("left")}${toggleMarkup("left")}</div><nav class="menu" style="--menu-count:${Math.max(items.length, 1)}" aria-label="Dashboard navigation">${items.map((item:any) => { const iconPlacement = item.icon_placement === "center" || item.icon_placement === "right" ? item.icon_placement : "left"; const icon=stateIcon(item.icon,item.icon_entity,this._hass); return `<button type="button" data-path="${escapeAttribute(item.path)}" data-action="${item.action === "navigate" ? "navigate" : "view"}" data-destination="${escapeAttribute(item.destination)}" class="${item.action !== "navigate" && item.path === this.config.active_path ? "active " : ""}icon-${iconPlacement}">${icon ? `<ha-icon icon="${escapeAttribute(icon)}"></ha-icon>` : ""}<span>${escapeAttribute(item.label || item.path)}</span></button>`; }).join("")}</nav><div class="toggle-group right">${toggleMarkup("right")}${statusMarkup("right")}</div></div>`;
    root.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
      const element = button as HTMLElement;
      const toggle = toggles.find((item: any) => String(item.id) === String(element.dataset.toggleId || ""));
      if (toggle) {
        const active = ["on", "true", "home", "open", "active"].includes(String(this._hass?.states?.[toggle.state_entity]?.state || "").toLowerCase());
        if (active && toggle.off_long_press) return;
        void this.runToggle(toggle, active); return;
      }
      if (element.dataset.statusAction === "navigate") { const destination=localPath(element.dataset.destination); if(destination) window.location.assign(destination); return; }
      if (element.dataset.statusAction === "service") { const [domain,service]=String(element.dataset.service||"").split("."); if(domain&&service) void this._hass?.callService?.(domain,service,{}); return; }
      const path = element.dataset.path || '';
      const destination = element.dataset.action === "navigate"
        ? localPath(element.dataset.destination)
        : undefined;
      if (element.dataset.action === "navigate" && !destination) return;
      if (destination) { window.location.assign(destination); return; }
      // Echo menus are a local card switch, not a Lovelace view navigation.
      // Keeping the Home Assistant route unchanged avoids the visible view
      // transition (and its occasional loading flash) on the Echo display.
      (window as any).__echoShowActiveMenu = path;
      window.dispatchEvent(new CustomEvent("echo-show-menu-change", { detail: { id: path } }));
      this.config = { ...this.config, active_path: path };
      this.render();
    }));
    root.querySelectorAll<HTMLElement>("[data-toggle-id]").forEach((button) => {
      button.addEventListener("pointerdown", () => {
        const toggle = toggles.find((item: any) => String(item.id) === String(button.dataset.toggleId || ""));
        const active = ["on", "true", "home", "open", "active"].includes(String(this._hass?.states?.[toggle?.state_entity]?.state || "").toLowerCase());
        if (!toggle?.off_long_press || !active) return;
        const id = String(toggle.id);
        this.holdTimers.set(id, window.setTimeout(() => { this.holdTimers.delete(id); void this.runToggle(toggle, true); }, 700));
      });
      ["pointerup", "pointerleave", "pointercancel"].forEach((event) => button.addEventListener(event, () => {
        const id = String(button.dataset.toggleId || ""); const timer = this.holdTimers.get(id); if (timer) window.clearTimeout(timer); this.holdTimers.delete(id);
      }));
    });
  }
  private async runToggle(toggle: any, active: boolean) {
    const id = String(toggle.id || "");
    if (this.running.has(id)) return;
    if (toggle.confirm && !window.confirm(`${active ? "Turn off" : "Turn on"} ${toggle.label || "this control"}?`)) return;
    this.running.add(id); this.render();
    try {
      const target = String(active ? toggle.off_target : toggle.on_target || "").trim();
      if (target) await this._hass?.callService?.(toggle.type === "automation" ? "automation" : "script", toggle.type === "automation" ? "trigger" : "turn_on", { entity_id: target });
      if (toggle.sync_state !== false && toggle.state_entity) {
      const [domain] = String(toggle.state_entity).split(".", 1);
      if (domain) await this._hass?.callService?.(domain, active ? "turn_off" : "turn_on", { entity_id: toggle.state_entity });
      }
      toggle.last_status = active ? "Turned off" : "Turned on";
    } catch (error) {
      toggle.last_status = `Action failed: ${String(error)}`;
    } finally {
      this.running.delete(id); this.render();
    }
  }
}

class EchoCameraWall extends HTMLElement {
  private config: any = {}; private _hass?: Hass; private timer?: number; private observer?: ResizeObserver; private lastRefreshByEntity = new Map<string, number>();
  private onWindowResize = () => this.updateLayout();
  setConfig(config: any) { this.config = config || {}; this.render(); setMenuVisibility(this, this.config); }
  set hass(value: Hass) { const first = !this._hass; this._hass = value; this.updateDetectionStates(); if (first) this.refresh(); }
  connectedCallback() { if (!this.shadowRoot) this.render(); this.observer = new ResizeObserver(() => this.updateLayout()); this.observer.observe(this); window.addEventListener('resize', this.onWindowResize); }
  disconnectedCallback() { if (this.timer) window.clearInterval(this.timer); this.observer?.disconnect(); window.removeEventListener('resize', this.onWindowResize); }
  private cameras() { return Array.isArray(this.config.cameras) ? this.config.cameras : []; }
  private render() {
    const root = this.shadowRoot ?? this.attachShadow({mode:'open'});
    root.innerHTML = `<style>${styles}</style><section class="wall" aria-label="Camera wall"></section>`;
    const wall = root.querySelector('.wall')!;
    for (const camera of this.cameras()) {
      const tile = document.createElement('article'); tile.className='tile'; tile.dataset.entity=camera.entity;
      const span = Math.max(1, Math.min(3, Number(camera.span) || 1));
      if (span > 1) tile.style.gridColumn = `span ${span}`;
      const overlay = camera.name_overlay || {};
      const horizontal = overlay.horizontal === 'center' ? 'center' : overlay.horizontal === 'right' ? 'right' : 'left';
      const vertical = overlay.vertical === 'top' ? 'top' : 'bottom';
      tile.innerHTML = `<img alt="${camera.label || camera.entity}"><span class="person-badge" hidden></span><span class="label ${vertical} ${horizontal}" ${overlay.show === false ? 'hidden' : ''}>${camera.label || camera.entity}</span>`;
      tile.addEventListener('click', () => this.openNativeFeed(camera));
      wall.appendChild(tile);
    }
    if (!this.cameras().length) wall.innerHTML='<div class="empty">No cameras are configured.</div>';
    this.updateDetectionStates(); this.updateLayout(); this.refresh();
    if (this.timer) window.clearInterval(this.timer);
    // The per-camera interval below determines whether a particular image is
    // requested.  Poll more often so the optional 100/250/500 ms settings can be
    // honoured without requesting every image at that rate.
    this.timer = window.setInterval(() => this.refresh(), 100);
  }
  private updateDetectionStates() {
    const wall = this.shadowRoot?.querySelector<HTMLElement>('.wall');
    if (!wall) return;
    const types = Array.isArray(this.config.detection_types) ? this.config.detection_types : [];
    for (const tile of Array.from(wall.querySelectorAll<HTMLElement>('.tile'))) {
      const camera = this.cameras().find((item: any) => item.entity === tile.dataset.entity);
      const detection = (Array.isArray(camera?.detections) ? camera.detections : []).find((candidate: any) => {
        const state = this._hass?.states?.[candidate.entity]?.state;
        const numericState = Number(state);
        return state === 'on' || (Number.isFinite(numericState) && numericState > 0);
      });
      const appearance = types.find((type: any) => type.id === detection?.type_id) || {};
      const animation = ["solid", "soft-pulse", "beacon", "corner", "glow-badge", "none"].includes(appearance.animation) ? appearance.animation : "soft-pulse";
      const detected = Boolean(detection);
      tile.dataset.detectionAnimation = animation;
      tile.style.setProperty('--person-glow', /^#[0-9a-f]{6}$/i.test(String(appearance.color || "")) ? String(appearance.color) : '#ffc107');
      tile.classList.toggle('person-detected', detected && animation !== 'none');
      const badge = tile.querySelector<HTMLElement>('.person-badge');
      const showBadge = detected && (appearance.show_badge === true || animation === 'corner' || animation === 'glow-badge');
      if (badge) { badge.hidden = !showBadge; badge.textContent = String(appearance.badge_text || appearance.label || 'Detection'); }
    }
  }
  private openNativeFeed(camera: any) {
    const service = String(camera?.native_camera_service || '');
    if (!service || !camera?.entity) return;
    void this._hass?.callService?.('esphome', service, { entity: camera.entity, seconds: 30 });
  }
  private updateLayout() {
    const wall = this.shadowRoot?.querySelector('.wall') as HTMLElement | null;
    if (!wall) return;
    const width = Number(this.config.preview_width) > 0 ? Number(this.config.preview_width) : (this.clientWidth || 600);
    const count = this.cameras().length;
    const compact = Boolean(this.config.compact);
    wall.classList.toggle('compact', compact);
    const gap = 6;
    const minimumWidth = Number(this.config.min_tile_width || 180);
    const maxColumns = Math.min(count, Math.max(1, Math.floor((width + gap) / (minimumWidth + gap))));
    const availableHeight = Number(this.config.preview_height) > 0
      ? Number(this.config.preview_height)
      : window.innerHeight - wall.getBoundingClientRect().top - 8;
    const layoutHeight = compact ? Math.min(availableHeight, window.innerHeight * 0.44) : availableHeight;
    const spansFor = (columns: number) => {
      const spans = this.cameras().map((camera: any) => Math.min(columns, Math.max(1, Number(camera?.span) || 1)));
      let occupied = 0;
      for (const span of spans) {
        if (occupied + span > columns) occupied = 0;
        occupied += span;
        if (occupied === columns) occupied = 0;
      }
      // Fit mode uses the remaining cell for the last camera rather than
      // leaving a black gap beside it. Explicitly wide cameras are unchanged.
      if (!compact && occupied > 0 && spans.length) spans[spans.length - 1] += columns - occupied;
      return spans;
    };
    let best: { columns: number; height: number; score: number } | undefined;
    for (let columns = 1; columns <= maxColumns; columns++) {
      // CSS grid moves a wide camera to a new row when it cannot fit in the
      // remaining cells. Count those occupied cells too; dividing camera count
      // by columns underestimates rendered rows and leaves a blank band.
      const spans = spansFor(columns);
      let rows = 0;
      let occupied = 0;
      for (const span of spans) {
        if (occupied + span > columns) { rows += 1; occupied = 0; }
        occupied += span;
        if (occupied === columns) { rows += 1; occupied = 0; }
      }
      if (occupied > 0) rows += 1;
      rows = Math.max(1, rows);
      const tileWidth = (width - gap * (columns - 1)) / columns;
      const tileHeight = (layoutHeight - gap * (rows - 1)) / rows;
      if (tileHeight < 100) continue;
      const imageWidth = Math.min(tileWidth, tileHeight * 16 / 9);
      const imageHeight = Math.min(tileHeight, tileWidth * 9 / 16);
      const score = imageWidth * imageHeight;
      if (!best || score > best.score) best = { columns, height: tileHeight, score };
    }
    if (!best) {
      wall.style.setProperty('--cols', String(Math.max(1, maxColumns)));
      wall.style.removeProperty('--tile-height');
      wall.style.removeProperty('--gap');
      return;
    }
    // Preview walls are laid out in a virtual Show 8 canvas (1280px wide),
    // then rendered inside the smaller editor preview. Scale the calculated
    // row height and gap to the actual wall width so the complete virtual
    // layout remains visible instead of clipping its lower rows.
    const virtualWidth = Number(this.config.preview_width) > 0 ? Number(this.config.preview_width) : 0;
    const renderScale = virtualWidth > 0 ? Math.min(1, (this.clientWidth || virtualWidth) / virtualWidth) : 1;
    wall.style.setProperty('--cols', String(best.columns));
    wall.style.setProperty('--gap', `${Math.max(1, Math.floor(gap * renderScale))}px`);
    wall.style.setProperty('--tile-height', `${Math.max(1, Math.floor(best.height * renderScale))}px`);
    const finalSpans = spansFor(best.columns);
    Array.from(wall.querySelectorAll<HTMLElement>('.tile')).forEach((tile, index) => {
      const span = finalSpans[index] || 1;
      tile.style.gridColumn = span > 1 ? `span ${span}` : '';
    });
    if (compact) wall.style.setProperty('--tile-max-width', `${Math.floor(best.height * 16 / 9 * renderScale)}px`);
    else wall.style.removeProperty('--tile-max-width');
  }
  private refresh() {
    if (!this._hass || !this.shadowRoot) return;
    for (const tile of Array.from(this.shadowRoot.querySelectorAll<HTMLElement>('.tile'))) {
      const entity = tile.dataset.entity;
      if (!entity) continue;
      const img = tile.querySelector('img');
      if (!img || img.dataset.loading === '1') continue;
      const camera = this.cameras().find((item: any) => item.entity === entity);
      const refreshInterval = Math.max(100, Number(camera?.refresh_interval || this.config.refresh_interval || 5000));
      const now = Date.now();
      if (now - (this.lastRefreshByEntity.get(entity) || 0) < refreshInterval) continue;
      this.lastRefreshByEntity.set(entity, now);
      const source = this._hass.states[entity]?.attributes?.entity_picture;
      if (!source) continue;
      const width = Math.max(240, Math.round(tile.clientWidth * Math.min(window.devicePixelRatio || 1, 2)));
      const url = new URL(source, window.location.origin);
      url.searchParams.set('width', String(width));
      url.searchParams.set('_', String(Date.now()));
      img.dataset.loading = '1';
      const next = new Image();
      next.onload = () => {
        img.src = next.src;
        delete tile.dataset.imageError;
        img.dataset.loading = '0';
      };
      next.onerror = () => {
        tile.dataset.imageError = '1';
        img.dataset.loading = '0';
      };
      next.src = url.toString();
    }
  }
}

if (!customElements.get('echo-menu')) customElements.define('echo-menu', EchoMenu);
if (!customElements.get('echo-camera-wall')) customElements.define('echo-camera-wall', EchoCameraWall);

class EchoLightControls extends HTMLElement {
  private config: any = {}; private _hass?: Hass;
  setConfig(config: any) { this.config = config || {}; this.render(); setMenuVisibility(this, this.config); }
  set hass(value: Hass) { this._hass = value; this.render(); }
  connectedCallback() { this.render(); }
  private render() {
    const root = this.shadowRoot ?? this.attachShadow({mode:'open'});
    const lights = Array.isArray(this.config.lights) ? this.config.lights : [];
    root.innerHTML = `<style>${styles}.light-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:8px}.light{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:12px;border-radius:10px;background:var(--ha-card-background,#20252b);color:#f5f7fa}.light-name{font-size:clamp(14px,2vw,20px)}.light-state{opacity:.82;font-size:.85em}.light button{border:0;border-radius:8px;padding:10px 16px;background:var(--primary-color,#03a9f4);color:#fff;font:inherit;cursor:pointer}.light button[aria-pressed=true]{background:var(--success-color,#4caf50)}.brightness{grid-column:1/-1;display:flex;gap:10px;align-items:center}.brightness input{flex:1;min-width:80px}</style><section class="light-list" aria-label="Light controls"></section>`;
    const list = root.querySelector('.light-list')!;
    if (!lights.length) { list.innerHTML = '<div class="empty">No lights are configured.</div>'; return; }
    for (const light of lights) {
      const state = this._hass?.states[light.entity];
      const on = state?.state === 'on';
      const brightness = Number(state?.attributes?.brightness);
      const supportsBrightness = Number.isFinite(brightness) && brightness >= 0;
      const tile = document.createElement('article'); tile.className = 'light';
      tile.innerHTML = `<div><div class="light-name">${light.label || light.entity}</div><div class="light-state">${on ? 'On' : 'Off'}</div></div><button type="button" aria-pressed="${on}">${on ? 'Turn off' : 'Turn on'}</button>${supportsBrightness ? `<label class="brightness">Brightness <input type="range" min="1" max="100" value="${Math.max(1, Math.round(brightness / 255 * 100))}" aria-label="${light.label || light.entity} brightness"><span>${Math.round(brightness / 255 * 100)}%</span></label>` : ''}`;
      tile.querySelector('button')?.addEventListener('click', async () => {
        await this._hass?.callService?.('light', on ? 'turn_off' : 'turn_on', { entity_id: light.entity });
      });
      tile.querySelector<HTMLInputElement>('input[type=range]')?.addEventListener('change', async (event) => {
        const value = Number((event.currentTarget as HTMLInputElement).value);
        await this._hass?.callService?.('light', 'turn_on', { entity_id: light.entity, brightness_pct: value });
      });
      list.appendChild(tile);
    }
  }
}
if (!customElements.get('echo-light-controls')) customElements.define('echo-light-controls', EchoLightControls);

class EchoTemperatureReadings extends HTMLElement {
  private config: any = {}; private _hass?: Hass;
  setConfig(config: any) { this.config = config || {}; this.render(); setMenuVisibility(this, this.config); }
  set hass(value: Hass) { this._hass = value; this.render(); }
  connectedCallback() { this.render(); }
  private render() {
    const root = this.shadowRoot ?? this.attachShadow({mode:'open'});
    const sensors = Array.isArray(this.config.sensors) ? this.config.sensors : [];
    root.innerHTML = `<style>${styles}.temperature-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:8px}.temperature{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 16px;border-radius:10px;background:var(--ha-card-background,#20252b);color:#f5f7fa}.temperature-name{font-size:clamp(14px,2vw,19px)}.temperature-value{font-size:clamp(22px,3.4vw,34px);font-weight:600;white-space:nowrap}</style><section class="temperature-list" aria-label="Temperature readings"></section>`;
    const list = root.querySelector('.temperature-list')!;
    if (!sensors.length) { list.innerHTML = '<div class="empty">No temperature sensors are configured.</div>'; return; }
    for (const sensor of sensors) {
      const state = this._hass?.states[sensor.entity];
      const tile = document.createElement('article'); tile.className = 'temperature';
      const name = document.createElement('span'); name.className = 'temperature-name'; name.textContent = sensor.label || sensor.entity;
      const value = document.createElement('strong'); value.className = 'temperature-value';
      const current = state?.state;
      value.textContent = current === undefined || current === 'unavailable' || current === 'unknown'
        ? '—'
        : `${current}${state?.attributes?.unit_of_measurement ? ` ${state.attributes.unit_of_measurement}` : ''}`;
      tile.append(name, value);
      tile.addEventListener('click', () => this.dispatchEvent(new CustomEvent('hass-more-info',{bubbles:true,composed:true,detail:{entityId:sensor.entity}})));
      list.appendChild(tile);
    }
  }
}
if (!customElements.get('echo-temperature-readings')) customElements.define('echo-temperature-readings', EchoTemperatureReadings);

/** Renders saved Lovelace cards in an adaptive Echo-sized grid without changing their configurations. */
class EchoCardLayout extends HTMLElement {
  private config: any = {}; private _hass?: Hass;
  setConfig(config: any) { this.config = config || {}; this.render(); setMenuVisibility(this, this.config); }
  set hass(value: Hass) { this._hass = value; this.shadowRoot?.querySelectorAll<any>('[data-echo-card]').forEach((card) => { card.hass = value; }); }
  connectedCallback() { this.render(); }
  private async render() {
    const root = this.shadowRoot ?? this.attachShadow({mode:'open'});
    const cards = Array.isArray(this.config.cards) ? this.config.cards : [];
    root.innerHTML = `<style>:host{display:block}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:minmax(104px,auto);gap:8px}.item{min-width:0;min-height:0;overflow:hidden}.item>*{display:block;height:100%;min-height:100%}@media(max-width:600px){.grid{grid-template-columns:repeat(2,minmax(0,1fr));}}</style><section class="grid" aria-label="Custom cards"></section>`;
    const grid = root.querySelector('.grid')!;
    if (!cards.length) return;
    try {
      const helpers = await (window as any).loadCardHelpers?.();
      if (!helpers?.createCardElement) throw new Error('Card helpers unavailable');
      for (const item of cards) {
        if (!item?.config) continue;
        const wrapper = document.createElement('div');
        wrapper.className = 'item';
        wrapper.style.gridColumn = `span ${Math.max(1, Math.min(3, Number(item.width) || 1))}`;
        wrapper.style.gridRow = `span ${Math.max(1, Math.min(2, Number(item.height) || 1))}`;
        // Button Card needs its card surface explicitly stretched; otherwise a
        // multi-row grid item grows while the card remains one row high.  Give
        // copied cards a predictable icon size too: source dashboard cards can
        // contain percentage-based icon styling which becomes a tiny dot after
        // being placed in an Echo grid cell.
        // Echo screens are viewed from further away than the desktop preview.
        // Use a deliberately larger, touch-screen-readable icon scale.
        const iconSize = Number(item.width) >= 2 || Number(item.height) >= 2 ? '80px' : '64px';
        const config = item.config?.type === 'custom:button-card'
          ? {
              ...item.config,
              styles: {
                ...(item.config.styles || {}),
                card: [...(Array.isArray(item.config.styles?.card) ? item.config.styles.card : []), { height: '100%' }],
                icon: [...(Array.isArray(item.config.styles?.icon) ? item.config.styles.icon : []), { width: `${iconSize} !important`, height: `${iconSize} !important`, 'min-width': `${iconSize} !important`, 'min-height': `${iconSize} !important` }],
                // Some source cards also constrain the icon container itself.
                // Stretch it with the icon so the graphic cannot be cropped to
                // a thin strip in the Echo grid.
                img_cell: [...(Array.isArray(item.config.styles?.img_cell) ? item.config.styles.img_cell : []), { width: `${iconSize} !important`, height: `${iconSize} !important`, 'min-width': `${iconSize} !important`, 'min-height': `${iconSize} !important`, overflow: 'visible !important' }],
              },
            }
          : item.config;
        const card = helpers.createCardElement(config) as any;
        card.dataset.echoCard = String(item.id || '');
        card.style.height = '100%';
        card.style.minHeight = '100%';
        if (this._hass) card.hass = this._hass;
        wrapper.appendChild(card); grid.appendChild(wrapper);
      }
    } catch {
      grid.innerHTML = '<div class="empty">Custom cards could not be loaded.</div>';
    }
  }
}

class EchoMenuMessage extends HTMLElement {
  private config: any = {};
  setConfig(config: any) { this.config = config || {}; this.render(); setMenuVisibility(this, this.config); }
  connectedCallback() { this.render(); setMenuVisibility(this, this.config); }
  private render() { this.textContent = String(this.config.message || ""); }
}

/** Keeps the menu bar outside the responsive, optionally-scrollable content area. */
class EchoMenuContent extends HTMLElement {
  private config: any = {}; private _hass?: Hass; private observer?: ResizeObserver; private contentObserver?: ResizeObserver; private layoutQueued = false;
  private onResize = () => this.queueLayout();
  setConfig(config: any) { this.config = config || {}; this.render(); setMenuVisibility(this, this.config); }
  set hass(value: Hass) { this._hass = value; this.shadowRoot?.querySelectorAll<any>("[data-echo-content-card]").forEach((card) => { card.hass = value; }); }
  connectedCallback() { this.observer = new ResizeObserver(this.onResize); this.observer.observe(this); window.addEventListener("resize", this.onResize); }
  disconnectedCallback() { this.observer?.disconnect(); this.contentObserver?.disconnect(); window.removeEventListener("resize", this.onResize); }
  /**
   * Camera walls finish choosing their rows after the menu content is first
   * painted.  A fit calculation made before that leaves its initial scale in
   * place and creates a blank strip at the bottom.  Observe the actual content
   * size and coalesce the follow-up calculation into the next animation frame.
   */
  private queueLayout() {
    if (this.layoutQueued) return;
    this.layoutQueued = true;
    requestAnimationFrame(() => { this.layoutQueued = false; this.updateLayout(); });
  }
  private updateLayout() {
    const shell = this.shadowRoot?.querySelector<HTMLElement>(".shell");
    const content = this.shadowRoot?.querySelector<HTMLElement>(".content");
    if (!shell || !content || this.style.display === "none") return;
    const available = Math.max(80, Math.floor(window.innerHeight - this.getBoundingClientRect().top - 6));
    shell.style.height = `${available}px`;
    content.style.transform = "";
    content.style.width = "";
    if (this.config.content_overflow === "scroll") return;
    const naturalHeight = content.scrollHeight;
    const scale = naturalHeight > available ? Math.max(0.35, available / naturalHeight) : 1;
    if (scale < 1) {
      content.style.transform = `scale(${scale})`;
      content.style.transformOrigin = "top left";
      content.style.width = `${100 / scale}%`;
    }
  }
  private async render() {
    const root = this.shadowRoot ?? this.attachShadow({mode:"open"});
    const scrolling = this.config.content_overflow === "scroll";
    root.innerHTML = `<style>:host{display:block;min-height:0}.shell{position:relative;min-height:80px;overflow:${scrolling ? "auto" : "hidden"};overscroll-behavior:contain}.content{display:grid;gap:6px;padding:0 4px 4px}.content>*{min-width:0}</style><section class="shell" aria-label="Menu content"><div class="content"></div></section>`;
    const content = root.querySelector<HTMLElement>(".content")!;
    this.contentObserver?.disconnect();
    this.contentObserver = new ResizeObserver(() => this.queueLayout());
    this.contentObserver.observe(content);
    const cards = Array.isArray(this.config.cards) ? this.config.cards : [];
    try {
      const helpers = await (window as any).loadCardHelpers?.();
      if (!helpers?.createCardElement) throw new Error("Card helpers unavailable");
      for (const config of cards) {
        if (!config || typeof config !== "object") continue;
        const card = helpers.createCardElement(config) as any;
        card.dataset.echoContentCard = "";
        if (this._hass) card.hass = this._hass;
        content.appendChild(card);
      }
    } catch {
      content.innerHTML = '<div class="empty">Menu content could not be loaded.</div>';
    }
    // The first pass establishes the menu height; the second catches cards
    // (notably camera walls) that derive their own grid after insertion.
    requestAnimationFrame(() => { this.updateLayout(); requestAnimationFrame(() => this.updateLayout()); });
  }
}
if (!customElements.get('echo-card-layout')) customElements.define('echo-card-layout', EchoCardLayout);
if (!customElements.get('echo-menu-message')) customElements.define('echo-menu-message', EchoMenuMessage);
if (!customElements.get('echo-menu-content')) customElements.define('echo-menu-content', EchoMenuContent);
