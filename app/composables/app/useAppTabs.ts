import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { message } from '@tauri-apps/plugin-dialog'
import type { NeoMapFile, NeoPrefab, NeoPrefabLibraryFile } from '#shared/types/neo'
import {stringify, useProject} from "~/composables/project/useProject.ts";
import {
    blockMask, clearMasked, copyBlock, deepClone, dropBlock, type EditorMap, fromMapFile, scopeLayers, type SelScope, type TileBlock, toMapFile,
} from "~/utils/mapModel.ts";
import { type Rename, rewriteEditorMap, rewriteLibraryFile, rewriteMapFile } from '~/utils/refs'

export type TabKind = 'map' | 'library'

/** Editor-local selection; the inspector and canvas both read this. */
export type Selection =
    | { kind: 'map' }
    | { kind: 'cell', col: number, row: number }
    | { kind: 'object', index: number }
    | { kind: 'prefab', library: string, name: string }
    | { kind: 'collider', library: string, name: string }

export type Tool = 'select' | 'move' | 'brush' | 'rect' | 'erase' | 'object'

/** Tiles lifted out of the map (move tool) or pasted, following the pointer until dropped. */
export type FloatingBlock = TileBlock & {
    /** lifted = the source cells were already cleared under a checkpoint, so dropping needs no new undo step */
    lifted: boolean
}

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
    showTextures: boolean
    zoom: number
    /** tile selection mask over the grid (`cols * rows`, 1 = selected); null = nothing selected */
    tileSel: number[] | null
    /** which layers copy/cut/paste/delete/move act on */
    selScope: SelScope
    floating: FloatingBlock | null
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

const reparse = <T>(json: string, edit: (file: T) => number) => {
    const file = JSON.parse(json) as T
    return edit(file) ? stringify(file) : json
}

export function useAppTabs() {
    const tabs = useState<EditorTab[]>('neo-tabs', () => [])
    const activeId = useState<string | null>('neo-active-tab', () => null)
    /** tile clipboard shared by every map tab; layers are keyed by name so paste can match them up */
    const clipboard = useState<TileBlock | null>('neo-clipboard', () => null)
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
                showGrid: true, showColliders: true, showObjects: true, showTextures: true, zoom: 1,
                tileSel: null, selScope: 'current', floating: null,
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
        if (tab.kind === 'map') dropFloating(tab)
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
        // undo while tiles float = cancel the move/paste, not the edit before it
        if (tab.kind === 'map' && tab.floating) return cancelFloating(tab)
        const prev = tab.undo.pop()
        if (prev === undefined) return
        tab.redo.push(serialize(tab))
        restore(tab, prev)
    }

    function redo(tab: EditorTab) {
        if (tab.kind === 'map') dropFloating(tab)
        const next = tab.redo.pop()
        if (next === undefined) return
        tab.undo.push(serialize(tab))
        restore(tab, next)
    }

    // ---- tile selection ----

    const selectedLayers = (tab: MapTab) => scopeLayers(tab.map, tab.selScope, tab.layer)

    function copyTiles(tab: MapTab): boolean {
        const block = copyBlock(tab.map, tab.tileSel, selectedLayers(tab))
        if (block) clipboard.value = block
        return !!block
    }

    function deleteTiles(tab: MapTab): boolean {
        dropFloating(tab)
        if (!tab.tileSel?.some(Boolean)) return false
        checkpoint(tab)
        clearMasked(tab.map, tab.tileSel, selectedLayers(tab))
        return true
    }

    const cutTiles = (tab: MapTab) => copyTiles(tab) && deleteTiles(tab)

    /**
     * Floats the clipboard at the spot it was copied from and switches to the move tool, so the next drag places it.
     * Returns the clipboard layer names this map lacks (those cells land on the active layer).
     */
    function pasteTiles(tab: MapTab): string[] | null {
        const block = clipboard.value
        if (!block) return null
        dropFloating(tab)
        tab.floating = { ...deepClone(block), lifted: false }
        tab.tileSel = blockMask(tab.map, tab.floating)
        tab.tool = 'move'
        return Object.keys(block.layers).filter(name => !tab.map.layers.some(l => l.name === name))
    }

    /** Cuts the selected cells into a floating block (one undo step together with the drop). */
    function liftTiles(tab: MapTab): boolean {
        if (tab.floating) return true
        const block = copyBlock(tab.map, tab.tileSel, selectedLayers(tab))
        if (!block) return false
        checkpoint(tab)
        clearMasked(tab.map, tab.tileSel!, selectedLayers(tab))
        tab.floating = { ...block, lifted: true }
        return true
    }

    /** Writes floating tiles where they are (clipped to the map) and selects them there. */
    function dropFloating(tab: MapTab) {
        const block = tab.floating
        if (!block) return
        if (!block.lifted) checkpoint(tab)
        dropBlock(tab.map, block, tab.layer)
        tab.tileSel = blockMask(tab.map, block)
        tab.floating = null
    }

    /** Throws floating tiles away; lifted ones go back where they came from. */
    function cancelFloating(tab: MapTab) {
        const block = tab.floating
        tab.floating = null
        if (!block?.lifted) return
        const prev = tab.undo.pop()
        if (prev !== undefined) restore(tab, prev)
    }

    function selectAllTiles(tab: MapTab) {
        dropFloating(tab)
        tab.tileSel = Array.from({ length: tab.map.cols * tab.map.rows }, () => 1)
    }

    // ---- renames ----

    /**
     * Applies a rename to every open tab: the editing model, the saved snapshot (so dirty state stays honest, since
     * the file on disk was rewritten the same way) and undo/redo history; renames the tab itself when it's the
     * renamed map or library.
     */
    async function applyRename(rename: Rename) {
        for (const tab of tabs.value) {
            if (tab.kind === 'map') {
                dropFloating(tab)
                rewriteEditorMap(tab.map, rename)
                const edit = (json: string) => reparse<NeoMapFile>(json, f => rewriteMapFile(f, rename))
                tab.saved = edit(tab.saved)
                tab.undo = tab.undo.map(edit)
                tab.redo = tab.redo.map(edit)
                const sel = tab.selection
                if (sel.kind === 'prefab' && rename.kind === 'library' && sel.library === rename.from) sel.library = rename.to
                if (rename.kind === 'prefab' && tab.map.libraries.includes(rename.library)) {
                    if (tab.prefab === rename.from) tab.prefab = rename.to
                    if (sel.kind === 'prefab' && sel.library === rename.library && sel.name === rename.from) sel.name = rename.to
                }
            }
            else {
                const edit = (json: string) => reparse<NeoPrefabLibraryFile>(json, f => rewriteLibraryFile(f, rename))
                tab.saved = edit(tab.saved)
                tab.undo = tab.undo.map(edit)
                tab.redo = tab.redo.map(edit)
            }
            if (rename.kind !== 'prefab' && tab.kind === rename.kind && tab.name === rename.from) {
                const wasActive = activeId.value === tab.id
                tab.name = rename.to
                tab.id = `${tab.kind}:${rename.to}`
                if (tab.kind === 'library' && (tab.selection.kind === 'prefab' || tab.selection.kind === 'collider')) tab.selection.library = rename.to
                if (wasActive) {
                    activeId.value = tab.id
                    await navigateTo(`/tabs/${encodeURIComponent(tab.id)}`)
                }
            }
        }
    }

    /**
     * Moves/renames a map or library on disk and rewrites every reference to it: files on disk, open tabs, library
     * state. Returns how many references changed. Callers validate `to` (names.ts) and confirm first.
     */
    async function renameItem(kind: TabKind, from: string, to: string): Promise<number> {
        const rename: Rename = { kind, from, to }
        await project.moveItem(kind, from, to)
        const refs = await project.rewriteReferences(rename)
        await applyRename(rename)
        return refs
    }

    /** Moves every map/library under `from/` to `to/` (a folder rename), then removes the old folder. */
    async function renameFolder(kind: TabKind, from: string, to: string): Promise<number> {
        const names = kind === 'map' ? project.state.value!.maps : Object.keys(project.state.value!.libraries)
        let refs = 0
        for (const name of names.filter(n => n.startsWith(from + '/')))
            refs += await renameItem(kind, name, to + name.slice(from.length))
        await project.moveFolder(kind, from, to)
        return refs
    }

    /**
     * Rewrites prefab references (layer legends, `object.prefab`) in every map that lists `library`, open or not.
     * The library's own key is renamed by the library editor.
     */
    async function renamePrefabRefs(library: string, from: string, to: string): Promise<number> {
        const rename: Rename = { kind: 'prefab', library, from, to }
        const refs = await project.rewriteReferences(rename)
        await applyRename(rename)
        return refs
    }

    /** Closes tabs of a deleted map/library without asking (the file is gone). */
    async function forget(kind: TabKind, name: string) {
        const tab = tabs.value.find(t => t.kind === kind && t.name === name)
        if (!tab) return
        tab.saved = serialize(tab)
        await close(tab.id)
    }

    return {
        tabs, activeId, active, clipboard, prefabsOf, isDirty, openMap, openLibrary, save, close, confirmDiscard, checkpoint, undo, redo,
        selectedLayers, copyTiles, cutTiles, deleteTiles, pasteTiles, liftTiles, dropFloating, cancelFloating, selectAllTiles,
        renameItem, renameFolder, renamePrefabRefs, forget,
    }
}
