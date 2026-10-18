import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { message } from '@tauri-apps/plugin-dialog'
import type { NeoMapFile, NeoPrefab, NeoPrefabLibraryFile } from '#shared/types/neo'
import {stringify, useProject} from "~/composables/project/useProject.ts";
import {type EditorMap, fromMapFile, toMapFile} from "~/utils/mapModel.ts";

export type TabKind = 'map' | 'library'

/** Editor-local selection; the inspector and canvas both read this. */
export type Selection =
    | { kind: 'map' }
    | { kind: 'cell', col: number, row: number }
    | { kind: 'object', index: number }
    | { kind: 'prefab', library: string, name: string }
    | { kind: 'collider', library: string, name: string }

export type Tool = 'select' | 'brush' | 'rect' | 'erase' | 'object'

export interface MapTab {
    id: string
    kind: 'map'
    name: string
    map: EditorMap
    /** JSON of the last saved/loaded state; dirty = current serialization differs */
    saved: string
    undo: string[]
    redo: string[]
    selection: Selection
    tool: Tool
    layer: number
    prefab: string | null
    showGrid: boolean
    showColliders: boolean
    showObjects: boolean
    zoom: number
}

export interface LibraryTab {
    id: string
    kind: 'library'
    name: string
    saved: string
    undo: string[]
    redo: string[]
    selection: Selection
}

export type EditorTab = MapTab | LibraryTab

const HISTORY_LIMIT = 200

export function useAppTabs() {
    const tabs = useState<EditorTab[]>('neo-tabs', () => [])
    const activeId = useState<string | null>('neo-active-tab', () => null)
    const project = useProject()

    const active = computed(() => tabs.value.find(t => t.id === activeId.value) ?? null)

    /** All prefabs a map can see: every library it lists, merged in order (later duplicates are a problem, not an override). */
    function prefabsOf(tab: MapTab): Record<string, NeoPrefab> {
        const libs = project.state.value?.libraries ?? {}
        const merged: Record<string, NeoPrefab> = {}
        for (const name of tab.map.libraries)
            for (const [prefab, def] of Object.entries(libs[name]?.prefabs ?? {}))
                merged[prefab] ??= def
        return merged
    }

    function serialize(tab: EditorTab): string {
        if (tab.kind === 'map') return stringify(toMapFile(tab.map))
        return stringify(project.state.value?.libraries[tab.name] ?? {})
    }

    const isDirty = (tab: EditorTab) => serialize(tab) !== tab.saved

    async function openMap(name: string) {
        const id = `map:${name}`
        if (!tabs.value.some(t => t.id === id)) {
            const file = JSON.parse(await readTextFile(await project.mapPath(name))) as NeoMapFile
            const map = fromMapFile(file)
            const tab: MapTab = {
                id, kind: 'map', name, map, saved: '', undo: [], redo: [],
                selection: { kind: 'map' }, tool: 'brush', layer: Math.max(0, map.layers.length - 1), prefab: null,
                showGrid: true, showColliders: true, showObjects: true, zoom: 1,
            }
            tab.saved = serialize(tab)
            tabs.value.push(tab)
        }
        activeId.value = id
        await navigateTo(`/tabs/${encodeURIComponent(id)}`)
    }

    async function openLibrary(name: string) {
        const id = `library:${name}`
        if (!tabs.value.some(t => t.id === id)) {
            const tab: LibraryTab = { id, kind: 'library', name, saved: '', undo: [], redo: [], selection: { kind: 'map' } }
            tab.saved = serialize(tab)
            tabs.value.push(tab)
        }
        activeId.value = id
        await navigateTo(`/tabs/${encodeURIComponent(id)}`)
    }

    async function save(tab: EditorTab) {
        const body = serialize(tab)
        if (tab.kind === 'map') await writeTextFile(await project.mapPath(tab.name), body)
        else await project.saveLibrary(tab.name)
        tab.saved = body
    }

    /** Asks once before throwing away unsaved tabs. true = go ahead. */
    async function confirmDiscard(list: EditorTab[]): Promise<boolean> {
        const dirty = list.filter(isDirty)
        if (!dirty.length) return true
        const answer = await message(`Unsaved changes in ${dirty.map(t => t.name).join(', ')}.`, {
            title: 'Save changes?',
            kind: 'warning',
            buttons: { yes: 'Save', no: "Don't save", cancel: 'Cancel' },
        })
        if (answer === 'Save') {
            for (const tab of dirty) await save(tab)
            return true
        }
        return answer === "Don't save"
    }

    async function close(id: string) {
        const index = tabs.value.findIndex(t => t.id === id)
        const tab = tabs.value[index]
        if (!tab || !(await confirmDiscard([tab]))) return
        tabs.value.splice(tabs.value.indexOf(tab), 1)
        if (activeId.value === id) {
            const next = tabs.value[Math.min(index, tabs.value.length - 1)]
            activeId.value = next?.id ?? null
            await navigateTo(next ? `/tabs/${encodeURIComponent(next.id)}` : '/')
        }
    }

    /**
     * Snapshot before a mutation so undo restores it. Snapshots are whole-file serializations: maps here are
     * school-assignment sized (a few hundred cells), so this costs less than diff bookkeeping would.
     */
    function checkpoint(tab: EditorTab) {
        tab.undo.push(serialize(tab))
        if (tab.undo.length > HISTORY_LIMIT) tab.undo.shift()
        tab.redo.length = 0
    }

    function restore(tab: EditorTab, json: string) {
        if (tab.kind === 'library') {
            const state = project.state.value
            if (state) state.libraries[tab.name] = JSON.parse(json) as NeoPrefabLibraryFile
            const s = tab.selection
            const lib = state?.libraries[tab.name]
            if ((s.kind === 'prefab' && !lib?.prefabs?.[s.name]) || (s.kind === 'collider' && !lib?.colliders?.[s.name])) tab.selection = { kind: 'map' }
            return
        }
        const visibility = tab.map.layers.map(l => l.visible)
        tab.map = fromMapFile(JSON.parse(json) as NeoMapFile)
        tab.map.layers.forEach((l, i) => l.visible = visibility[i] ?? true)
        tab.layer = Math.min(tab.layer, tab.map.layers.length - 1)
        if (tab.selection.kind === 'object' && !tab.map.objects[tab.selection.index]) tab.selection = { kind: 'map' }
    }

    function undo(tab: EditorTab) {
        const prev = tab.undo.pop()
        if (prev === undefined) return
        tab.redo.push(serialize(tab))
        restore(tab, prev)
    }

    function redo(tab: EditorTab) {
        const next = tab.redo.pop()
        if (next === undefined) return
        tab.undo.push(serialize(tab))
        restore(tab, next)
    }

    return { tabs, activeId, active, prefabsOf, isDirty, openMap, openLibrary, save, close, confirmDiscard, checkpoint, undo, redo }
}
