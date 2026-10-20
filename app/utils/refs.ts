import type { NeoMapFile, NeoPrefabLibraryFile } from '#shared/types/neo'
import type { EditorMap } from './mapModel'
import { WORLD_ACTIONS } from './names'

/**
 * A rename that other files reference by name. Maps are referenced by world actions, libraries by map `prefabs`
 * lists, prefabs by layer legends and `object.prefab` of maps that list their library.
 */
export type Rename =
    | { kind: 'map', from: string, to: string }
    | { kind: 'library', from: string, to: string }
    | { kind: 'prefab', library: string, from: string, to: string }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Rewrites `world` / `unload[]` of every world-action entry inside `value` (specs, nested trigger action lists,
 * override bags). Returns how many values matched `from`; pass `to === from` to only count.
 */
function rewriteWorlds(value: unknown, from: string, to: string): number {
    let n = 0
    if (Array.isArray(value)) {
        for (const item of value) n += rewriteWorlds(item, from, to)
        return n
    }
    if (!isObject(value)) return 0
    const props = value.properties
    if (typeof value.type === 'string' && WORLD_ACTIONS[value.type] && isObject(props)) {
        if (props.world === from) {
            props.world = to
            n++
        }
        if (Array.isArray(props.unload))
            props.unload = props.unload.map((u) => {
                if (u !== from) return u
                n++
                return to
            })
    }
    for (const child of Object.values(value)) n += rewriteWorlds(child, from, to)
    return n
}

/** Applies a rename to a parsed .neomap.json in place; returns the number of references changed. */
export function rewriteMapFile(file: NeoMapFile, rename: Rename): number {
    if (rename.kind === 'library') {
        let n = 0
        file.prefabs = file.prefabs?.map((l) => {
            if (l !== rename.from) return l
            n++
            return rename.to
        })
        return n
    }
    if (rename.kind === 'map') return rewriteWorlds(file.objects, rename.from, rename.to)
    if (!file.prefabs?.includes(rename.library)) return 0
    let n = 0
    for (const layer of file.layers ?? [])
        for (const [ch, prefab] of Object.entries(layer.legend ?? {}))
            if (prefab === rename.from) {
                layer.legend![ch] = rename.to
                n++
            }
    for (const o of file.objects ?? [])
        if (o.prefab === rename.from) {
            o.prefab = rename.to
            n++
        }
    return n
}

/** Applies a map rename to a parsed .neoprefabs.json (world actions nested in prefab/collider specs). */
export const rewriteLibraryFile = (file: NeoPrefabLibraryFile, rename: Rename) =>
    rename.kind === 'map' ? rewriteWorlds([file.prefabs, file.colliders], rename.from, rename.to) : 0

/** Applies a rename to an open map's editing model in place; returns the number of references changed. */
export function rewriteEditorMap(map: EditorMap, rename: Rename): number {
    if (rename.kind === 'map') return rewriteWorlds(map.objects, rename.from, rename.to)
    if (rename.kind === 'library') {
        const n = map.libraries.filter(l => l === rename.from).length
        map.libraries = map.libraries.map(l => l === rename.from ? rename.to : l)
        return n
    }
    if (!map.libraries.includes(rename.library)) return 0
    let n = 0
    for (const layer of map.layers)
        layer.cells.forEach((name, i) => {
            if (name !== rename.from) return
            layer.cells[i] = rename.to
            n++
        })
    for (const o of map.objects)
        if (o.prefab === rename.from) {
            o.prefab = rename.to
            n++
        }
    if (map.chars[rename.from] !== undefined) {
        map.chars[rename.to] ??= map.chars[rename.from]!
        delete map.chars[rename.from]
    }
    return n
}
