/** DOM overlay on top of the 3D view. M0: just a banner with the dev shortcuts. */
export class Hud {
  constructor(root: HTMLElement) {
    const banner = document.createElement('div')
    banner.className = 'hud-banner'
    banner.innerHTML = `
      <strong>LITTLEBIRD</strong> · M0 scaffold<br />
      Drag to orbit · wheel to zoom · <kbd>F3</kbd> debug · <kbd>F11</kbd> fullscreen
    `
    root.appendChild(banner)
  }
}
