import type { DropdownMenuItem } from '@nuxt/ui'
import { CheckMenuItem, Menu, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu'
import { readText } from '@tauri-apps/plugin-clipboard-manager'
import type { AppCommand } from './useAppCommands'

const GROUPS: Record<AppCommand['group'], string> = { file: 'File', edit: 'Edit', view: 'View', help: 'Help' }

// a native accelerator swallows its key even inside text fields, so the menu action does the field's job itself
const TEXT_ACTIONS: Record<string, () => unknown> = {
    undo: () => document.execCommand('undo'),
    redo: () => document.execCommand('redo'),
    cut: () => document.execCommand('cut'),
    copy: () => document.execCommand('copy'),
    paste: async () => document.execCommand('insertText', false, await readText()),
    selectAll: () => document.execCommand('selectAll'),
    delete: () => document.execCommand('forwardDelete'),
}

/**
 * macOS (Tauri): builds the native app menu once. Elsewhere decorum hides the native menu bar, so the layout renders
 * `menus` as dropdown buttons instead.
 */
export function useAppMenu(commands: AppCommand[], nativeMenu: boolean) {
    const menus = computed(() => (Object.keys(GROUPS) as AppCommand['group'][]).map((group) => {
        const sections: DropdownMenuItem[][] = [[]]
        for (const cmd of commands.filter(c => c.group === group)) {
            if (cmd.separator) sections.push([])
            sections.at(-1)!.push({
                label: cmd.label,
                kbds: cmd.kbds,
                disabled: !(cmd.enabled?.() ?? true),
                ...cmd.checked
                    ? { type: 'checkbox' as const, checked: cmd.checked(), onUpdateChecked: () => cmd.run() }
                    : { onSelect: () => cmd.run() },
            })
        }
        return { label: GROUPS[group], items: sections }
    }))

    onMounted(async () => {
        if (!nativeMenu) return
        const run = (cmd: AppCommand) => {
            const text = TEXT_ACTIONS[cmd.id]
            if (text && !cmd.whileTyping && isTyping()) return text()
            if (cmd.enabled?.() ?? true) return cmd.run()
            // nothing of ours to act on (no tile selection): copy/select page text like the keys would
            return text?.()
        }
        const quit = commands.find(c => c.id === 'quit')!
        const about = commands.find(c => c.id === 'about')!
        // macOS puts About in the app menu, so the native menu has no Help submenu
        const groups = (Object.keys(GROUPS) as AppCommand['group'][]).filter(g => g !== 'help')
        const submenus = await Promise.all(groups.map(async (group) => {
            const items = []
            for (const cmd of commands.filter(c => c.group === group && c !== quit)) {
                if (cmd.separator && items.length) items.push(await PredefinedMenuItem.new({ item: 'Separator' }))
                const opts = { id: cmd.id, text: cmd.label, accelerator: cmd.accel, action: () => run(cmd) }
                if (!cmd.checked) {
                    items.push(opts)
                    continue
                }
                const check: CheckMenuItem = await CheckMenuItem.new({
                    ...opts,
                    checked: cmd.checked(),
                    // native check items flip themselves on click, even when the command did nothing (no map tab)
                    action: () => { run(cmd); check.setChecked(cmd.checked!()) },
                })
                // tab switches and the status bar change the state too
                watchEffect(() => check.setChecked(cmd.checked!()))
                items.push(check)
            }
            return Submenu.new({ text: GROUPS[group], items })
        }))
        const app = await Submenu.new({
            text: 'NeoMap Editor',
            items: [
                // our window (the predefined About item shows the bare system panel)
                { id: about.id, text: about.label, action: () => about.run() },
                { item: 'Separator' },
                { item: 'Hide' },
                { item: 'HideOthers' },
                { item: 'ShowAll' },
                { item: 'Separator' },
                // our Quit, not the predefined one, so the unsaved-changes prompt on window close runs
                { id: quit.id, text: 'Quit NeoMap Editor', accelerator: quit.accel, action: () => quit.run() },
            ],
        })
        await (await Menu.new({ items: [app, ...submenus] })).setAsAppMenu()
    })

    return { menus }
}
