import { isTauri } from '@tauri-apps/api/core'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { getCurrentWindow } from '@tauri-apps/api/window'

const LABEL = 'about'

/** Opens (or focuses) the About NeoMap Editor window: a small fixed-size window, like macOS "About <App>" panels. */
export async function openAboutWindow() {
    if (!isTauri()) return navigateTo('/about')
    const existing = await WebviewWindow.getByLabel(LABEL)
    if (existing) {
        await existing.unminimize()
        await existing.setFocus()
        return
    }
    new WebviewWindow(LABEL, {
        url: '/about',
        title: 'About NeoMap Editor',
        width: 340,
        height: 420,
        resizable: false,
        maximizable: false,
        minimizable: false,
        center: true,
        focus: true,
        parent: getCurrentWindow(),
    })
}
