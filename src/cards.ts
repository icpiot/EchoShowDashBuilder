type Hass = { states: Record<string, any>; hassUrl?: string; callWS?: (msg: any) => Promise<any>; callService?: (domain: string, service: string, data: Record<string, unknown>) => Promise<unknown> };

const styles = `:host{display:block;color:var(--primary-text-color,#fff);font-family:var(--paper-font-body1_-_font-family,Arial,sans-serif)}*{box-sizing:border-box}.menu{display:flex;gap:6px;overflow:hidden;max-width:490px;margin:0 auto 8px}.menu button{flex:1;min-width:0;border:0;border-radius:10px;padding:10px 8px;background:var(--ha-card-background,#20252b);color:#f5f7fa;font:inherit;font-size:clamp(12px,2vw,18px);white-space:nowrap;cursor:pointer}.menu button.active{background:var(--primary-color,#03a9f4);color:#fff}.wall{display:grid;grid-template-columns:repeat(var(--cols,2),minmax(0,1fr));gap:var(--gap,6px)}.wall.compact .tile{max-width:var(--tile-max-width);margin-inline:auto}.tile{min-width:0;width:100%;position:relative;background:#090b0d;border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;aspect-ratio:16/9;height:var(--tile-height,auto)}.tile img{display:block;width:100%;height:100%;object-fit:contain}.label{position:absolute;left:0;right:0;color:#fff;padding:5px 8px;background:linear-gradient(transparent,rgba(0,0,0,.8));font-size:clamp(11px,1.6vw,15px);text-shadow:0 1px 2px #000}.label.top{top:0;bottom:auto;background:linear-gradient(rgba(0,0,0,.8),transparent)}.label.bottom{bottom:0}.label.left{text-align:left}.label.center{text-align:center}.label.right{text-align:right}.label[hidden]{display:none}.empty{padding:16px;text-align:center;opacity:.7}`;

const escapeAttribute = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const localPath = (value: unknown): string | undefined => {
  const path = String(value ?? "").trim();
  if (!path || !path.startsWith("/") || path.startsWith("//") || /[\\\\\u0000-\u001f]/.test(path)) return undefined;
  try { const parsed = new URL(path, window.location.origin); return parsed.origin === window.location.origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : undefined; } catch { return undefined; }
};

class EchoMenu extends HTMLElement {
  private config: any = {}; private _hass?: Hass;
  setConfig(config: any) { this.config = config || {}; this.render(); }
  set hass(value: Hass) { this._hass = value; }
  connectedCallback() { this.render(); }
  private render() {
    const items = Array.isArray(this.config.items) ? this.config.items : [];
    const root = this.shadowRoot ?? this.attachShadow({mode:'open'});
    root.innerHTML = `<style>${styles}</style><nav class="menu" aria-label="Dashboard navigation">${items.map((item:any) => `<button type="button" data-path="${escapeAttribute(item.path)}" data-action="${item.action === "navigate" ? "navigate" : "view"}" data-destination="${escapeAttribute(item.destination)}" class="${item.action !== "navigate" && item.path === this.config.active_path ? 'active' : ''}">${item.icon ? `<ha-icon icon="${escapeAttribute(item.icon)}"></ha-icon> ` : ''}${item.label || item.path}</button>`).join('')}</nav>`;
    root.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
      const element = button as HTMLElement;
      const path = element.dataset.path || '';
      const destination = element.dataset.action === "navigate"
        ? localPath(element.dataset.destination)
        : undefined;
      if (element.dataset.action === "navigate" && !destination) return;
      const segments = window.location.pathname.split('/').filter(Boolean);
      const dashboardBase = segments.length > 1 ? `/${segments.slice(0, -1).join('/')}` : window.location.pathname.replace(/\/$/, '');
      const navigationPath = destination || `${dashboardBase}/${encodeURIComponent(path)}`;
      // Use Home Assistant's in-app location change, rather than a full page
      // load.  The custom event is retained for hosts that consume it; the
      // history event is the reliable frontend route mechanism in a card.
      this.dispatchEvent(new CustomEvent('hass-navigate', {bubbles:true, composed:true, detail:{navigation_path:navigationPath}}));
      if (window.location.pathname + window.location.search + window.location.hash !== navigationPath) {
        window.history.pushState(null, "", navigationPath);
        window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
      }
    }));
  }
}

class EchoCameraWall extends HTMLElement {
  private config: any = {}; private _hass?: Hass; private timer?: number; private observer?: ResizeObserver; private lastRefreshByEntity = new Map<string, number>();
  private onWindowResize = () => this.updateLayout();
  setConfig(config: any) { this.config = config || {}; this.render(); }
  set hass(value: Hass) { const first = !this._hass; this._hass = value; if (first) this.refresh(); }
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
      tile.innerHTML = `<img alt="${camera.label || camera.entity}"><span class="label ${vertical} ${horizontal}" ${overlay.show === false ? 'hidden' : ''}>${camera.label || camera.entity}</span>`;
      tile.addEventListener('click', () => this.dispatchEvent(new CustomEvent('hass-more-info',{bubbles:true,composed:true,detail:{entityId:camera.entity}})));
      wall.appendChild(tile);
    }
    if (!this.cameras().length) wall.innerHTML='<div class="empty">No cameras are configured.</div>';
    this.updateLayout(); this.refresh();
    if (this.timer) window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.refresh(), 1000);
  }
  private updateLayout() {
    const wall = this.shadowRoot?.querySelector('.wall') as HTMLElement | null;
    if (!wall) return;
    const width = this.clientWidth || 600;
    const count = this.cameras().length;
    const compact = Boolean(this.config.compact);
    wall.classList.toggle('compact', compact);
    const gap = 6;
    const minimumWidth = Number(this.config.min_tile_width || 180);
    const maxColumns = Math.min(count, Math.max(1, Math.floor((width + gap) / (minimumWidth + gap))));
    const availableHeight = window.innerHeight - wall.getBoundingClientRect().top - 8;
    const layoutHeight = compact ? Math.min(availableHeight, window.innerHeight * 0.44) : availableHeight;
    let best: { columns: number; height: number; score: number } | undefined;
    for (let columns = 1; columns <= maxColumns; columns++) {
      const rows = Math.ceil(count / columns);
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
      return;
    }
    wall.style.setProperty('--cols', String(best.columns));
    wall.style.setProperty('--tile-height', `${Math.floor(best.height)}px`);
    if (compact) wall.style.setProperty('--tile-max-width', `${Math.floor(best.height * 16 / 9)}px`);
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
      const refreshInterval = Math.max(1000, Number(camera?.refresh_interval || this.config.refresh_interval || 5000));
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
  setConfig(config: any) { this.config = config || {}; this.render(); }
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
  setConfig(config: any) { this.config = config || {}; this.render(); }
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
