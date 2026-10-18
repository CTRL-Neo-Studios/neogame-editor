import { exists, mkdir, readDir, readFile, readTextFile, watch, writeTextFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import type { NeoPrefabLibraryFile, NeoProjectFile, NeoSchemaFile } from '#shared/types/neo'

export const MAP_EXT = '.neomap.json'
export const LIBRARY_EXT = '.neoprefabs.json'

export interface ProjectState {
    /** absolute path of the game project root (the folder that contains Data/) */
    root: string
    dataDir: string
    project: NeoProjectFile
    schema: NeoSchemaFile | null
    schemaError: string | null
    maps: string[]
    libraries: Record<string, NeoPrefabLibraryFile>
    libraryErrors: Record<string, string>
}

// non-serializable handles (watch unsubscribe) live outside useState
let stopWatching: (() => void) | null = null

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
        state.value = { root, dataDir, project, schema: null, schemaError: null, maps: [], libraries: {}, libraryErrors: {} }
        await Promise.all([reloadSchema(), rescan()])

        stopWatching?.()
        // the game build rewrites the schema; reload it so new specs show up without reopening the project
        stopWatching = await watch(dataDir, (event) => {
            const schemaFile = state.value?.project.schema
            if (schemaFile && event.paths.some(p => p.endsWith(schemaFile))) reloadSchema()
        }, { delayMs: 300 })
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

    async function listNames(dir: string, ext: string) {
        if (!(await exists(dir))) await mkdir(dir, { recursive: true })
        return (await readDir(dir))
            .filter(e => e.isFile && e.name.endsWith(ext))
            .map(e => e.name.slice(0, -ext.length))
            .sort()
    }

    async function rescan() {
        const s = state.value
        if (!s) return
        const [maps, libs] = await Promise.all([
            listNames(await join(s.dataDir, 'NeoMaps'), MAP_EXT),
            listNames(await join(s.dataDir, 'NeoPrefabs'), LIBRARY_EXT),
        ])
        s.maps = maps
        for (const name of libs) if (!(name in s.libraries)) await loadLibrary(name)
    }

    async function loadLibrary(name: string) {
        const s = state.value!
        try {
            s.libraries[name] = JSON.parse(await readTextFile(await libraryPath(name))) as NeoPrefabLibraryFile
            delete s.libraryErrors[name]
        }
        catch (e) {
            s.libraryErrors[name] = e instanceof Error ? e.message : String(e)
        }
    }

    const mapPath = async (name: string) => join(state.value!.dataDir, 'NeoMaps', name + MAP_EXT)
    const libraryPath = async (name: string) => join(state.value!.dataDir, 'NeoPrefabs', name + LIBRARY_EXT)

    async function saveLibrary(name: string) {
        const lib = state.value!.libraries[name]
        if (lib) await writeTextFile(await libraryPath(name), stringify(lib))
    }

    async function createMap(name: string, body: string) {
        await writeTextFile(await mapPath(name), body)
        await rescan()
    }

    async function createLibrary(name: string) {
        state.value!.libraries[name] = { prefabs: {}, colliders: {} }
        await saveLibrary(name)
        await rescan()
    }

    /** Reads a content asset's source image (contentRoot is relative to Data/) as a blob URL, for canvas previews. */
    async function assetUrl(assetPath: string): Promise<string | null> {
        const s = state.value
        if (!s) return null
        const contentRoot = await join(s.dataDir, s.project.contentRoot ?? '../Content')
        for (const ext of ['.png', '.jpg', '.jpeg', '.bmp']) {
            const file = await join(contentRoot, assetPath + ext)
            if (await exists(file)) return URL.createObjectURL(new Blob([await readFile(file)]))
        }
        return null
    }

    return { state, open, close, reloadSchema, rescan, loadLibrary, mapPath, libraryPath, saveLibrary, createMap, createLibrary, assetUrl }
}

/** The on-disk JSON style: 2-space indent and a trailing newline, like the hand-written samples. */
export const stringify = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
