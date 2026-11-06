type Hass = { states: Record<string, any>; callWS?: (msg: any) => Promise<any> };

const styles = `:host{display:block;color:var(--primary-text-color,#fff);font-family:var(--paper-font-body1_-_font-family,Arial,sans-serif)}*{box-sizing:border-box}.menu{display:flex;gap:6px;overflow:hidden}.menu button{flex:1;min-width:0;border:0;border-radius:10px;padding:10px 8px;background:var(--ha-card-background,#20252b);color:inherit;font:inherit;font-size:clamp(12px,2vw,18px);white-space:nowrap;cursor:pointer}.menu button.active{background:var(--primary-color,#03a9f4);color:#fff}.wall{display:grid;grid-template-columns:repeat(var(--cols,2),minmax(0,1fr));gap:var(--gap,6px)}.tile{min-width:0;position:relative;background:#090b0d;border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;aspect-ratio:var(--ratio,16/9)}.tile img{display:block;width:100%;height:100%;object-fit:contain}.label{position:absolute;left:0;right:0;bottom:0;padding:5px 8px;background:linear-gradient(transparent,rgba(0,0,0,.8));font-size:clamp(11px,1.6vw,15px);text-shadow:0 1px 2px #000}.empty{padding:16px;text-align:center;opacity:.7}`;

class EchoMenu extends HTMLElement {
  private config: any = {}; private hass?: Hass;
  setConfig(config: any) { this.config = config || {}; this.render(); }
  set hass(value: Hass) { this.hass = value; }
  connectedCallback() { this.render(); }
  private render() {
    const items = Array.isArray(this.config.items) ? this.config.items : [];
    this.shadowRoot ??= this.attachShadow({mode:'open'});
    this.shadowRoot.innerHTML = `<style>${styles}</style><nav class="menu" aria-label="Dashboard navigation">${items.map((item:any) => `<button data-path="${String(item.path || '').replace(/"/g,'&quot;')}" class="${item.path === this.config.active_path ? 'active' : ''}">${item.icon ? `<ha-icon icon="${item.icon}"></ha-icon> ` : ''}${item.label || item.path}</button>`).join('')}</nav>`;
    this.shadowRoot.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
      const path = (button as HTMLElement).dataset.path || '';
      this.dispatchEvent(new CustomEvent('hass-more-info', {bubbles:true, composed:true, detail:{entityId:path}}));
      this.dispatchEvent(new CustomEvent('location-changed', {bubbles:true, composed:true, detail:{replace:false}}));
      window.history.pushState({}, '', `${window.location.pathname.replace(/\/[^/]*$/, '')}/${path}`);
    }));
  }
}

class EchoCameraWall extends HTMLElement {
  private config: any = {}; private hass?: Hass; private timer?: number; private observer?: ResizeObserver;
  setConfig(config: any) { this.config = config || {}; this.render(); }
  set hass(value: Hass) { this.hass = value; this.refresh(); }
  connectedCallback() { this.render(); this.observer = new ResizeObserver(() => this.layout()); this.observer.observe(this); }
  disconnectedCallback() { if (this.timer) window.clearInterval(this.timer); this.observer?.disconnect(); }
  private cameras() { return Array.isArray(this.config.cameras) ? this.config.cameras : []; }
  private render() {
    this.shadowRoot ??= this.attachShadow({mode:'open'});
    this.shadowRoot.innerHTML = `<style>${styles}</style><section class="wall" aria-label="Camera wall"></section>`;
    const wall = this.shadowRoot.querySelector('.wall')!;
    for (const camera of this.cameras()) {
      const tile = document.createElement('article'); tile.className='tile'; tile.dataset.entity=camera.entity;
      tile.innerHTML = `<img alt="${camera.label || camera.entity}"><span class="label">${camera.label || camera.entity}</span>`;
      tile.addEventListener('click', () => this.dispatchEvent(new CustomEvent('hass-more-info',{bubbles:true,composed:true,detail:{entityId:camera.entity}})));
      wall.appendChild(tile);
    }
    if (!this.cameras().length) wall.innerHTML='<div class="empty">No cameras are configured.</div>';
    this.layout(); this.refresh();
    if (this.timer) window.clearInterval(this.timer);
    const interval = Math.max(1000, Number(this.config.refresh_interval || 5000)); this.timer = window.setInterval(() => this.refresh(), interval);
  }
  private layout() { const wall = this.shadowRoot?.querySelector('.wall') as HTMLElement | null; if (!wall) return; const width=this.clientWidth || 600; const min=Number(this.config.min_tile_width || 180); wall.style.setProperty('--cols', String(Math.max(1, Math.floor(width / min)))); }
  private refresh() { if (!this.hass || !this.shadowRoot) return; for (const tile of Array.from(this.shadowRoot.querySelectorAll<HTMLElement>('.tile'))) { const entity=tile.dataset.entity; if (!entity) continue; const img=tile.querySelector('img'); if (!img || img.dataset.loading==='1') continue; const width=Math.max(240, Math.round(tile.clientWidth * Math.min(window.devicePixelRatio || 1, 2))); const height=Math.max(135, Math.round(width * 9 / 16)); const next=new Image(); next.dataset.loading='1'; next.onload=()=>{ img.src=next.src; img.style.aspectRatio=`${next.naturalWidth}/${next.naturalHeight}`; next.dataset.loading='0'; }; next.onerror=()=>{next.dataset.loading='0'}; next.src=`/api/camera_proxy/${encodeURIComponent(entity)}?width=${width}&height=${height}&_=${Date.now()}`; } }
}

if (!customElements.get('echo-menu')) customElements.define('echo-menu', EchoMenu);
if (!customElements.get('echo-camera-wall')) customElements.define('echo-camera-wall', EchoCameraWall);
