export interface DesktopBridge {
  pickRepository(): Promise<string | null>
  openPath(path: string): Promise<void>
}

class BrowserBridge implements DesktopBridge {
  async pickRepository(): Promise<string | null> {
    return null
  }

  async openPath(path: string): Promise<void> {
    window.open(path, '_blank', 'noopener,noreferrer')
  }
}

export const desktopBridge: DesktopBridge = new BrowserBridge()
