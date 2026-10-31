// Vector icons and a CSS 3D architectural illustration; no external assets or requests.
export function icon(name, className = '') {
  const paths = {
    building: '<path d="M3 21h18M5 21V7l7-4v18m0-13h7v13M8 9v1m0 3v1m0 3v1m7-7h1m-1 4h1m-1 4h1"/>',
    overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    projects: '<path d="M4 21V4h10v17m0-12h6v12M2 21h20M7 7h4m-4 4h4m-4 4h4m6-3h1m-1 4h1"/>',
    users: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3"/>',
    pin: '<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    link: '<path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',
    wallet: '<path d="M20 8V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v12H6a3 3 0 0 1-3-3V6m17 7h-5v4h5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    rotateLeft: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
    rotateRight: '<path d="M21 10a9 9 0 1 0-2 8m2-14v6h-6"/>'
  };
  return `<svg class="icon ${className}" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.building}</svg>`;
}

export function buildingScene({ compact = false, controls = false } = {}) {
  const block = name => `<div class="volume ${name}"><div class="face front"></div><div class="face back"></div><div class="face left"></div><div class="face right"></div><div class="face roof"></div></div>`;
  return `<div class="architectural-scene ${compact ? 'compact-scene' : ''}">
    <div class="scene-view" aria-hidden="true"><div class="scene-orbit" data-angle="0">
      <div class="site-base"><div class="site-surface"><span class="site-path"></span><span class="site-lawn lawn-one"></span><span class="site-lawn lawn-two"></span><span class="site-pool"></span><span class="plot-line line-one"></span><span class="plot-line line-two"></span></div></div>
      ${block('main-volume')}${block('upper-volume')}${block('side-volume')}
      <div class="model-tree tree-one"><span></span></div><div class="model-tree tree-two"><span></span></div>
    </div></div>
    ${!compact ? '<span class="scene-label">ESTUDO VOLUMÉTRICO · ILUSTRATIVO</span>' : ''}
    ${controls ? `<div class="scene-controls"><span>Explorar volume</span><button type="button" class="scene-control" data-action="rotate-model" data-step="-1" aria-label="Girar ilustração 3D para a esquerda">${icon('rotateLeft')}</button><button type="button" class="scene-control" data-action="rotate-model" data-step="1" aria-label="Girar ilustração 3D para a direita">${icon('rotateRight')}</button><span class="sr-only" data-rotation-status role="status"></span></div>` : ''}
  </div>`;
}
