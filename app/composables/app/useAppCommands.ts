import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

export interface AppCommand {
    id: string
    label: string
    group: 'file' | 'edit' | 'view' | 'help'
    /** Tauri accelerator (native macOS menu + window keydown elsewhere), e.g. 'CmdOrCtrl+S' */
    accel?: string
    /** extra accelerators only the keydown listener handles (a native item holds one) */
    alt?: string[]
    /** shown in the HTML menus, UKbd notation */
    kbds?: string[]
    /** false = while a text field has focus the keys belong to it */
    whileTyping: boolean
    run(): unknown
    enabled?(): boolean
    checked?(): boolean
    /** starts a new section in its menu */
    separator?: true
}

const MAC = typeof navigator !== 'undefined' && navigator.userAgent.includes('Macintosh')

function matches(accel: string, e: KeyboardEvent) {
    const parts = accel.split('+')
    const key = parts.pop()!.toLowerCase()
    const mod = parts.includes('CmdOrCtrl')
    return e.key.toLowerCase() === key
        && (MAC ? e.metaKey : e.ctrlKey) === mod && !(MAC ? e.ctrlKey : e.metaKey)
        && e.shiftKey === parts.includes('Shift') && e.altKey === parts.includes('Alt')
}

/**
 * Every app-wide command (menus + Ctrl/Cmd keys). Call once, from the layout: it registers the window keydown listener.
 * On macOS in Tauri the native menu (useAppMenu) owns `accel`; the listener then only handles `alt`.
 */
export function useAppCommands() {
    const project = useProject()
    const recents = useRecents()
    const $t = useAppTabs()
    const toast = useToast()
    const { sidebar, inspector, bottom } = usePanels()
    const { running: building, logOpen, build, run: buildRun } = useBuild()
    const nativeMenu = isTauri() && platform() === 'macos'

    async function openProject(path?: string) {
        const root = path ?? await openDialog({ directory: true, title: 'Open game project (folder with Data/)' })
        if (typeof root !== 'string') return
        if (!(await $t.confirmDiscard($t.tabs.value))) return
        try {
            await project.open(root)
            await recents.add(root)
            $t.tabs.value = []
            $t.activeId.value = null
            await navigateTo('/')
        }
        catch (e) {
            toast.add({ title: 'Could not open project', description: e instanceof Error ? e.message : String(e), color: 'error', icon: 'i-lucide-folder-x' })
        }
    }

    async function saveActive() {
        const tab = $t.active.value
        if (!tab) return
        try {
            await $t.save(tab)
            toast.add({ title: `Saved ${tab.name}`, color: 'success', icon: 'i-lucide-check', duration: 1500 })
        }
        catch (e) {
            toast.add({ title: 'Save failed', description: e instanceof Error ? e.message : String(e), color: 'error' })
        }
    }

    const mapTab = () => $t.active.value?.kind === 'map' ? $t.active.value : null
    const hasTileSel = () => !!mapTab()?.tileSel?.some(Boolean) || !!mapTab()?.floating

    function paste() {
        const tab = mapTab()!
        const missing = $t.pasteTiles(tab)
        if (!missing?.length) return
        const target = tab.map.layers[tab.layer]?.name ?? ''
        toast.add({
            title: `Pasted ${missing.length} layer${missing.length === 1 ? '' : 's'} onto '${target}'`,
            description: `No layer named ${missing.map(n => `'${n}'`).join(', ')}`,
            color: 'warning',
            icon: 'i-lucide-layers',
        })
    }

    function remove() {
        const tab = mapTab()!
        if ($t.deleteTiles(tab) || tab.selection.kind !== 'object') return
        const index = tab.selection.index
        if (!tab.map.objects[index]) return
        $t.checkpoint(tab)
        tab.map.objects.splice(index, 1)
        tab.selection = { kind: 'map' }
    }

    const display = (id: string, label: string, key: 'showGrid' | 'showColliders' | 'showObjects' | 'showTextures', kbd?: string, separator?: true): AppCommand => ({
        id, label, group: 'view', kbds: kbd ? [kbd] : undefined, whileTyping: false, separator,
        run: () => { const tab = mapTab(); if (tab) tab[key] = !tab[key] },
        enabled: () => !!mapTab(),
        checked: () => !!mapTab()?.[key],
    })

    const commands: AppCommand[] = [
        { id: 'open', label: 'Open project…', group: 'file', accel: 'CmdOrCtrl+O', kbds: ['meta', 'o'], whileTyping: true, run: () => openProject() },
        { id: 'save', label: 'Save', group: 'file', accel: 'CmdOrCtrl+S', kbds: ['meta', 's'], whileTyping: true, run: saveActive, enabled: () => !!$t.active.value, separator: true },
        {
            id: 'refreshSpecs', label: 'Refresh specs (dotnet build)', group: 'file', accel: 'CmdOrCtrl+Shift+B', kbds: ['meta', 'shift', 'b'], whileTyping: true,
            run: build, enabled: () => !!project.state.value && !building.value, separator: true,
        },
        { id: 'buildLog', label: 'Show build log', group: 'file', whileTyping: true, run: () => logOpen.value = true, enabled: () => !!buildRun.value },
        {
            id: 'close', label: 'Close tab', group: 'file', accel: 'CmdOrCtrl+W', kbds: ['meta', 'w'], whileTyping: true,
            run: () => $t.activeId.value && $t.close($t.activeId.value), enabled: () => !!$t.activeId.value,
        },
        // window close, so the close-requested unsaved prompt in the layout runs
        {
            id: 'quit', label: 'Quit', group: 'file', accel: 'CmdOrCtrl+Q', kbds: ['meta', 'q'], whileTyping: true,
            run: () => getCurrentWindow().close(), enabled: isTauri, separator: true,
        },

        {
            id: 'undo', label: 'Undo', group: 'edit', accel: 'CmdOrCtrl+Z', kbds: ['meta', 'z'], whileTyping: false,
            run: () => $t.active.value && $t.undo($t.active.value),
            enabled: () => !!$t.active.value?.undo.length || !!mapTab()?.floating,
        },
        {
            id: 'redo', label: 'Redo', group: 'edit', accel: 'CmdOrCtrl+Shift+Z', alt: ['CmdOrCtrl+Y'], kbds: ['meta', 'shift', 'z'], whileTyping: false,
            run: () => $t.active.value && $t.redo($t.active.value),
            enabled: () => !!$t.active.value?.redo.length,
        },
        { id: 'cut', label: 'Cut tiles', group: 'edit', accel: 'CmdOrCtrl+X', kbds: ['meta', 'x'], whileTyping: false, run: () => $t.cutTiles(mapTab()!), enabled: hasTileSel, separator: true },
        { id: 'copy', label: 'Copy tiles', group: 'edit', accel: 'CmdOrCtrl+C', kbds: ['meta', 'c'], whileTyping: false, run: () => $t.copyTiles(mapTab()!), enabled: hasTileSel },
        { id: 'paste', label: 'Paste tiles', group: 'edit', accel: 'CmdOrCtrl+V', kbds: ['meta', 'v'], whileTyping: false, run: paste, enabled: () => !!mapTab() && !!$t.clipboard.value },
        {
            id: 'delete', label: 'Delete', group: 'edit', accel: 'Delete', alt: ['Backspace'], kbds: ['delete'], whileTyping: false, run: remove,
            enabled: () => hasTileSel() || mapTab()?.selection.kind === 'object',
        },
        {
            id: 'selectAll', label: 'Select all tiles', group: 'edit', accel: 'CmdOrCtrl+A', kbds: ['meta', 'a'], whileTyping: false,
            run: () => $t.selectAllTiles(mapTab()!), enabled: () => !!mapTab(), separator: true,
        },

        { id: 'sidebar', label: 'Sidebar', group: 'view', whileTyping: false, run: () => sidebar.value = !sidebar.value, checked: () => sidebar.value },
        { id: 'inspector', label: 'Inspector', group: 'view', whileTyping: false, run: () => inspector.value = !inspector.value, checked: () => inspector.value },
        { id: 'bottom', label: 'Bottom panel', group: 'view', whileTyping: false, run: () => bottom.value = !bottom.value, checked: () => bottom.value },
        display('grid', 'Grid', 'showGrid', 'g', true),
        display('colliders', 'Colliders', 'showColliders', 'c'),
        display('objects', 'Objects', 'showObjects'),
        display('textures', 'Textures', 'showTextures', 't'),

        { id: 'about', label: 'About NeoMap Editor', group: 'help', whileTyping: true, run: openAboutWindow },
    ]

    useEventListener(window, 'keydown', (e: KeyboardEvent) => {
        if (e.isComposing) return
        const cmd = commands.find(c => [...(c.accel && !nativeMenu ? [c.accel] : []), ...(c.alt ?? [])].some(a => matches(a, e)))
        if (!cmd) return
        const enabled = cmd.enabled?.() ?? true
        // edit keys fall through to the browser in text fields and when there's nothing of ours to act on (copying page text)
        if (!cmd.whileTyping && (isTyping() || !enabled)) return
        e.preventDefault()
        if (enabled) cmd.run()
    })

    return { commands, nativeMenu, openProject, saveActive }
}
