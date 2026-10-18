import { load } from '@tauri-apps/plugin-store'

export interface RecentProject {
    name: string
    path: string
    openedAt: number
}

const MAX_RECENTS = 12

/** Recently opened game projects, persisted with tauri-plugin-store. */
export function useRecents() {
    const items = useState<RecentProject[]>('neo-recents', () => [])

    const store = () => load('recents.json', { autoSave: true, defaults: { projects: [] } })

    async function refresh() {
        items.value = (await (await store()).get<RecentProject[]>('projects')) ?? []
    }

    async function add(path: string) {
        const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path
        items.value = [{ name, path, openedAt: Date.now() }, ...items.value.filter(r => r.path !== path)].slice(0, MAX_RECENTS)
        await (await store()).set('projects', items.value)
    }

    async function remove(path: string) {
        items.value = items.value.filter(r => r.path !== path)
        await (await store()).set('projects', items.value)
    }

    return { items, refresh, add, remove }
}
