import { exists, mkdir, readDir, readFile, readTextFile, remove, rename, watch, writeTextFile } from '@tauri-apps/plugin-fs'
import { dirname, join } from '@tauri-apps/api/path'
import type { NeoMapFile, NeoPrefabLibraryFile, NeoProjectFile, NeoSchemaFile } from '#shared/types/neo'
import type { TabKind } from '~/composables/app/useAppTabs'
import { deepClone } from '~/utils/mapModel'
import { pathCollision, pathNameError } from '~/utils/names'
import { type Rename, rewriteLibraryFile, rewriteMapFile } from '~/utils/refs'

export const MAP_EXT = '.neomap.json'
export const LIBRARY_EXT = '.neoprefabs.json'

const EXT: Record<TabKind, string> = { map: MAP_EXT, library: LIBRARY_EXT }
const DIR: Record<TabKind, string> = { map: 'NeoMaps', library: 'NeoPrefabs' }

export interface ProjectState {
    /** absolute path of the game project root (the folder that contains Data/) */
    root: string
    dataDir: string
    project: NeoProjectFile
    schema: NeoSchemaFile | null
    schemaError: string | null
    /** `/`-separated names relative to NeoMaps, sorted */
    maps: string[]
    /** every folder under NeoMaps, empty ones included */
    mapFolders: string[]
    libraries: Record<string, NeoPrefabLibraryFile>
    libraryFolders: string[]
    /** unreadable or invalid-name libraries (those aren't loaded) */
    libraryErrors: Record<string, string>
    /** files on disk whose name the game can't load, or that differ from another only by case */
    nameErrors: { maps: Record<string, string>, libraries: Record<string, string> }
}

// non-serializable handles (watch unsubscribe) live outside useState
let stopWatching: (() => void) | null = null

// rescans and file moves run one at a time: a watcher rescan listing the folder mid-move would drop the moved
// library's (possibly unsaved) state
let queue: Promise<unknown> = Promise.resolve()
function serial<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
    return (...args: A): Promise<R> => {
        const run = queue.then(() => fn(...args))
        queue = run.catch(() => {})
        return run
    }
}

/** Every file and folder under `dir` as `/`-separated relative paths (plugin-fs readDir isn't recursive). */
async function walk(dir: string, prefix = '', out = { files: [] as string[], folders: [] as string[] }) {
    for (const entry of await readDir(dir)) {
        const rel = prefix + entry.name
        if (entry.isDirectory) {
            out.folders.push(rel)
            await walk(await join(dir, entry.name), rel + '/', out)
        }
        else if (entry.isFile) out.files.push(rel)
    }
    return out
}

function nameErrorsOf(names: string[]) {
    const out: Record<string, string> = {}
    for (const name of names) {
        const error = pathNameError(name)
        const twin = pathCollision(names, name, name)
        if (error) out[name] = `the game can't load this name: ${error}`
        else if (twin) out[name] = `'${name}' and '${twin}' differ only by case, which is one file on Windows/macOS`
    }
    return out
}

/**
 * The open game project: Data/ layout, generated schema and prefab libraries. Libraries are loaded once and
 * edited in place (the library tab writes through this state), so every open map sees the same prefabs.
 */
export function useProject() {
    const state = useState<ProjectState | null>('neo-project', () => null)

    async function open(root: string) {
        const dataDir = await join(root, 'Data')
        const projectPath = await join(dataDir, 'neo.project.json')
        if (!(await exists(projectPath)))
            throw new Error(`no Data/neo.project.json under ${root} — build the game once so NeoGameLib creates it`)

        const project = JSON.parse(await readTextFile(projectPath)) as NeoProjectFile
        state.value = {
            root, dataDir, project, schema: null, schemaError: null,
            maps: [], mapFolders: [], libraries: {}, libraryFolders: [], libraryErrors: {}, nameErrors: { maps: {}, libraries: {} },
        }
        await Promise.all([reloadSchema(), rescan()])

        stopWatching?.()
        // the game build rewrites the schema; reload it so new specs show up without reopening the project.
        // maps/libraries added or removed outside the editor show up too (loaded libraries are never reloaded)
        stopWatching = await watch(dataDir, (event) => {
            const schemaFile = state.value?.project.schema
            if (schemaFile && event.paths.some(p => p.endsWith(schemaFile))) reloadSchema()
            const t = event.type
            const listing = t === 'any' || (typeof t === 'object' && ('create' in t || 'remove' in t || ('modify' in t && t.modify.kind === 'rename')))
            if (listing && event.paths.some(p => p.endsWith(MAP_EXT) || p.endsWith(LIBRARY_EXT))) rescan()
        }, { delayMs: 300, recursive: true })
    }

    function close() {
        stopWatching?.()
        stopWatching = null
        state.value = null
    }

    async function reloadSchema() {
        const s = state.value
        if (!s) return
        if (!s.project.schema) {
            s.schemaError = 'neo.project.json has no "schema" entry — build the game once to generate it'
            return
        }
        try {
            s.schema = JSON.parse(await readTextFile(await join(s.dataDir, s.project.schema))) as NeoSchemaFile
            s.schemaError = null
        }
        catch (e) {
            s.schemaError = `could not read ${s.project.schema}: ${e instanceof Error ? e.message : String(e)}`
        }
    }

    const rootOf = (kind: TabKind) => join(state.value!.dataDir, DIR[kind])
    const pathOf = (kind: TabKind, name: string) => join(state.value!.dataDir, DIR[kind], name + EXT[kind])
    const mapPath = (name: string) => pathOf('map', name)
    const libraryPath = (name: string) => pathOf('library', name)

    async function list(kind: TabKind) {
        const dir = await rootOf(kind)
        if (!(await exists(dir))) await mkdir(dir, { recursive: true })
        const { files, folders } = await walk(dir)
        const ext = EXT[kind]
        return { names: files.filter(f => f.endsWith(ext)).map(f => f.slice(0, -ext.length)).sort(), folders: folders.sort() }
    }

    /** Re-lists both folders. Loads libraries not in state yet; state of loaded ones survives (it may hold edits). */
    async function scan() {
        const s = state.value
        if (!s) return
        const [maps, libs] = await Promise.all([list('map'), list('library')])
        s.maps = maps.names
        s.mapFolders = maps.folders
        s.libraryFolders = libs.folders
        s.nameErrors = { maps: nameErrorsOf(maps.names), libraries: nameErrorsOf(libs.names) }
        const onDisk = new Set(libs.names)
        for (const name of Object.keys(s.libraries)) if (!onDisk.has(name)) delete s.libraries[name]
        for (const name of Object.keys(s.libraryErrors)) if (!onDisk.has(name)) delete s.libraryErrors[name]
        for (const name of libs.names) if (!(name in s.libraries)) await loadLibrary(name)
    }
    const rescan = serial(scan)

    async function loadLibrary(name: string) {
        const s = state.value!
        const invalid = pathNameError(name)
        if (invalid) {
            s.libraryErrors[name] = `the game can't load this name: ${invalid}`
            return
        }
        try {
            s.libraries[name] = JSON.parse(await readTextFile(await libraryPath(name))) as NeoPrefabLibraryFile
            delete s.libraryErrors[name]
        }
        catch (e) {
            s.libraryErrors[name] = e instanceof Error ? e.message : String(e)
        }
    }

    async function saveLibrary(name: string) {
        const lib = state.value!.libraries[name]
        if (!lib) return
        // the runtime defaults `folder` to the root; keep hand-written files terse
        const prefabs = lib.prefabs && Object.fromEntries(Object.entries(lib.prefabs).map(([key, prefab]) => {
            const { folder, ...rest } = prefab
            return [key, folder ? prefab : rest]
        }))
        await writeTextFile(await libraryPath(name), stringify({ ...lib, prefabs }))
    }

    const createMap = serial(async (name: string, body: string) => {
        const path = await mapPath(name)
        await mkdir(await dirname(path), { recursive: true })
        await writeTextFile(path, body)
        await scan()
    })

    const createLibrary = serial(async (name: string) => {
        await mkdir(await dirname(await libraryPath(name)), { recursive: true })
        state.value!.libraries[name] = { prefabs: {}, colliders: {} }
        await saveLibrary(name)
        await scan()
    })

    const createFolder = serial(async (kind: TabKind, folder: string) => {
        await mkdir(await join(await rootOf(kind), folder), { recursive: true })
        await scan()
    })

    /** Moves/renames one map or library file. Tabs and references are updated by the caller (useAppTabs.renameItem). */
    const moveItem = serial(async (kind: TabKind, from: string, to: string) => {
        if (from === to) return
        const s = state.value!
        const target = await pathOf(kind, to)
        await mkdir(await dirname(target), { recursive: true })
        await rename(await pathOf(kind, from), target)
        if (kind === 'library') {
            if (from in s.libraries) s.libraries[to] = s.libraries[from]!
            delete s.libraries[from]
            delete s.libraryErrors[from]
        }
        await scan() // loads a library that was unloadable under its old name
    })

    /** Finishes a folder rename after its items were moved: recreates leftover empty subfolders, drops the old tree. */
    const moveFolder = serial(async (kind: TabKind, from: string, to: string) => {
        const root = await rootOf(kind)
        const src = await join(root, from)
        await mkdir(await join(root, to), { recursive: true })
        if (await exists(src)) {
            const { files, folders } = await walk(src)
            for (const folder of folders) await mkdir(await join(root, to, folder), { recursive: true })
            // something the rename didn't move (e.g. an invalid-name file) keeps the old folder alive
            if (!files.some(f => f.endsWith(MAP_EXT) || f.endsWith(LIBRARY_EXT))) await remove(src, { recursive: true })
        }
        await scan()
    })

    const deleteItem = serial(async (kind: TabKind, name: string) => {
        await remove(await pathOf(kind, name))
        await scan()
    })

    /** Removes a folder and everything in it; callers confirm and delete its items first. */
    const deleteFolder = serial(async (kind: TabKind, folder: string) => {
        const dir = await join(await rootOf(kind), folder)
        if (await exists(dir)) await remove(dir, { recursive: true })
        await scan()
    })

    /**
     * Applies `rename` to every map file on disk and, for map renames, every library (state and file). Open tabs
     * are not skipped: useAppTabs.applyRename rewrites their model and saved snapshot the same way. `write: false`
     * only counts. Returns the number of references.
     */
    async function references(change: Rename, write: boolean) {
        const s = state.value!
        async function rewriteFile<T>(path: string, fn: (file: T) => number) {
            let file: T
            try {
                file = JSON.parse(await readTextFile(path)) as T
            }
            catch {
                return 0 // unreadable: the game can't load it either, so it references nothing
            }
            const n = fn(file)
            if (write && n) await writeTextFile(path, stringify(file))
            return n
        }

        let total = 0
        for (const name of s.maps) total += await rewriteFile<NeoMapFile>(await mapPath(name), f => rewriteMapFile(f, change))
        if (change.kind === 'map') {
            for (const [name, lib] of Object.entries(s.libraries)) {
                // the library tab edits this state in place, so it's what gets counted; the file is rewritten to match
                total += rewriteLibraryFile(write ? lib : deepClone(lib), change)
                if (write) await rewriteFile<NeoPrefabLibraryFile>(await libraryPath(name), f => rewriteLibraryFile(f, change))
            }
        }
        return total
    }
    const rewriteReferences = (change: Rename) => references(change, true)
    const countReferences = (change: Rename) => references(change, false)

    /** Reads a content asset's source image (contentRoot is relative to Data/) as a blob URL, for canvas previews. */
    async function assetUrl(assetPath: string): Promise<string | null> {
        const s = state.value
        if (!s) return null
        const contentRoot = await join(s.dataDir, s.project.contentRoot ?? '../Content')
        // MonoGame asset names have no extension, but tolerate one typed by hand ("Sprites/door.png")
        const typed = /\.(png|jpe?g|bmp)$/i.test(assetPath)
        for (const ext of typed ? [''] : ['.png', '.jpg', '.jpeg', '.bmp']) {
            const file = await join(contentRoot, assetPath + ext)
            if (await exists(file)) return URL.createObjectURL(new Blob([await readFile(file)]))
        }
        return null
    }

    return {
        state, open, close, reloadSchema, rescan, loadLibrary, mapPath, libraryPath, saveLibrary, createMap, createLibrary, createFolder,
        moveItem, moveFolder, deleteItem, deleteFolder, rewriteReferences, countReferences, assetUrl,
    }
}

/** The on-disk JSON style: 2-space indent and a trailing newline, like the hand-written samples. */
export const stringify = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
