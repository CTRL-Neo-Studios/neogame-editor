import type { JsonObject, NeoEntry, NeoMapFile, NeoMapObjectFile, NeoPrefab, Vec2 } from '#shared/types/neo'

// Deep clone that survives Vue reactivity: toRaw() only unwraps the OUTER proxy, and copy-on-write
// editors (entry lists, overrides) emit containers holding reactive entries inside. JSON round-trips
// read through every proxy level, and all of this data is JSON by definition.
export function deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

// In-memory editing model of a .neomap.json. Layers are dense prefab-name grids (null = empty);
// legend characters are a file-format detail, regenerated on save. Everything else stays in file shape.

export interface EditorLayer {
    name: string
    visible: boolean
    cells: (string | null)[]
}

export interface EditorMap {
    cellSize: Vec2
    origin: Vec2
    libraries: string[]
    cols: number
    rows: number
    layers: EditorLayer[]
    objects: NeoMapObjectFile[]
    /** legend character each prefab used when loaded, kept stable across saves to avoid noisy diffs */
    chars: Record<string, string>
}

export const cellIndex = (map: EditorMap, col: number, row: number) => row * map.cols + col
export const inBounds = (map: EditorMap, col: number, row: number) => col >= 0 && row >= 0 && col < map.cols && row < map.rows

export function newLayer(map: Pick<EditorMap, 'cols' | 'rows'>, name: string): EditorLayer {
    return { name, visible: true, cells: Array.from({ length: map.cols * map.rows }, () => null) }
}

export function fromMapFile(file: NeoMapFile): EditorMap {
    const layersIn = file.layers ?? []
    const rows = Math.max(1, ...layersIn.map(l => l.rows?.length ?? 0))
    const cols = Math.max(1, ...layersIn.flatMap(l => (l.rows ?? []).map(r => r.length)))
    const chars: Record<string, string> = {}

    const layers = layersIn.map((l, i) => {
        const layer = newLayer({ cols, rows }, l.name || `layer${i + 1}`)
        const legend = l.legend ?? {}
        ;(l.rows ?? []).forEach((line, r) => {
            for (let c = 0; c < line.length; c++) {
                const prefab = legend[line[c]!]
                if (!prefab) continue
                layer.cells[r * cols + c] = prefab
                chars[prefab] ??= line[c]!
            }
        })
        return layer
    })

    return {
        cellSize: { x: file.cellSize?.x ?? 32, y: file.cellSize?.y ?? 32 },
        origin: { x: file.origin?.x ?? 0, y: file.origin?.y ?? 0 },
        libraries: [...(file.prefabs ?? [])],
        cols,
        rows,
        layers: layers.length ? layers : [newLayer({ cols, rows }, 'main')],
        objects: deepClone(file.objects ?? []),
        chars,
    }
}

const CHAR_POOL = [...'#.,~=+*%&@$!?abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_:;<>^()[]{}|/\\']

/** Serialize back to the file shape. Legend characters are per layer; a prefab keeps the char it was loaded with. */
export function toMapFile(map: EditorMap): NeoMapFile {
    const layers = map.layers.map((layer) => {
        const legend: Record<string, string | null> = {}
        const charOf = new Map<string, string>()
        const taken = new Set<string>([' '])

        const assign = (prefab: string) => {
            let ch = charOf.get(prefab)
            if (ch) return ch
            const preferred = map.chars[prefab]
            ch = preferred && !taken.has(preferred) ? preferred : CHAR_POOL.find(c => !taken.has(c))
            if (!ch) throw new Error(`layer '${layer.name}' uses more prefabs than available legend characters`)
            taken.add(ch)
            charOf.set(prefab, ch)
            legend[ch] = prefab
            map.chars[prefab] ??= ch
            return ch
        }

        let hasEmpty = false
        const rows: string[] = []
        for (let r = 0; r < map.rows; r++) {
            let line = ''
            for (let c = 0; c < map.cols; c++) {
                const prefab = layer.cells[r * map.cols + c]
                if (prefab) line += assign(prefab)
                else { line += ' '; hasEmpty = true }
            }
            rows.push(line)
        }
        if (hasEmpty) legend[' '] = null
        return { name: layer.name, legend, rows }
    })

    const out: NeoMapFile = { cellSize: { ...map.cellSize } }
    if (map.origin.x || map.origin.y) out.origin = { ...map.origin }
    out.prefabs = [...map.libraries]
    out.layers = layers
    out.objects = map.objects.map(compactObject)
    return out
}

// drop members equal to their runtime defaults so saved files stay as terse as hand-written ones.
// deepClone, not structuredClone: reactive proxies throw DataCloneError.
function compactObject(o: NeoMapObjectFile): NeoMapObjectFile {
    const out: NeoMapObjectFile = { name: o.name ?? '' }
    if (o.prefab) out.prefab = o.prefab
    if (o.tags?.length) out.tags = [...o.tags]
    if (o.specs?.length) out.specs = deepClone(o.specs)
    if (o.position && (o.position.x || o.position.y)) out.position = { ...o.position }
    if (o.rotation) out.rotation = o.rotation
    if (o.scale && (o.scale.x !== 1 || o.scale.y !== 1)) out.scale = { ...o.scale }
    if (o.overrides && Object.keys(o.overrides).length) out.overrides = deepClone(o.overrides)
    return out
}

export function resizeMap(map: EditorMap, cols: number, rows: number) {
    cols = Math.max(1, Math.floor(cols))
    rows = Math.max(1, Math.floor(rows))
    for (const layer of map.layers) {
        const cells: (string | null)[] = Array.from({ length: cols * rows }, () => null)
        for (let r = 0; r < Math.min(rows, map.rows); r++)
            for (let c = 0; c < Math.min(cols, map.cols); c++)
                cells[r * cols + c] = layer.cells[r * map.cols + c] ?? null
        layer.cells = cells
    }
    map.cols = cols
    map.rows = rows
}

export function fillRect(map: EditorMap, layer: EditorLayer, c0: number, r0: number, c1: number, r1: number, value: string | null) {
    for (let r = Math.max(0, Math.min(r0, r1)); r <= Math.min(map.rows - 1, Math.max(r0, r1)); r++)
        for (let c = Math.max(0, Math.min(c0, c1)); c <= Math.min(map.cols - 1, Math.max(c0, c1)); c++)
            layer.cells[r * map.cols + c] = value
}

export interface ColliderBox { group: string, col: number, row: number, width: number, height: number }

/**
 * The exact greedy merge NeoMap.BuildColliders runs: per collider group, across all layers, take the longest
 * horizontal run of cells, then grow it downward while the rows below match. Uses all layers regardless of
 * editor visibility, since visibility is an editor-only concept.
 */
export function mergeColliders(map: EditorMap, prefabs: Record<string, NeoPrefab>): ColliderBox[] {
    const masks = new Map<string, Uint8Array>()
    for (const layer of map.layers) {
        layer.cells.forEach((name, i) => {
            const group = name ? prefabs[name]?.collider : undefined
            if (!group) return
            let mask = masks.get(group)
            if (!mask) masks.set(group, mask = new Uint8Array(map.cols * map.rows))
            mask[i] = 1
        })
    }

    const boxes: ColliderBox[] = []
    for (const [group, mask] of masks) {
        const covered = new Uint8Array(mask.length)
        const free = (c: number, r: number) => !covered[r * map.cols + c] && mask[r * map.cols + c]
        for (let r = 0; r < map.rows; r++) {
            for (let c = 0; c < map.cols; c++) {
                if (!free(c, r)) continue
                let width = 1
                while (c + width < map.cols && free(c + width, r)) width++
                let height = 1
                grow: while (r + height < map.rows) {
                    for (let k = 0; k < width; k++) if (!free(c + k, r + height)) break grow
                    height++
                }
                for (let rr = r; rr < r + height; rr++)
                    for (let cc = c; cc < c + width; cc++) covered[rr * map.cols + cc] = 1
                boxes.push({ group, col: c, row: r, width, height })
            }
        }
    }
    return boxes
}

/** Key an override uses for an entry: its id, else its spec type (NeoMap.ApplyEntries). */
export const overrideKey = (entry: NeoEntry) => entry.id || entry.type

/** Properties an object actually builds a prefab entry with: prefab values shallow-merged with the object's override. */
export function effectiveProperties(entry: NeoEntry, object: NeoMapObjectFile): JsonObject {
    const key = overrideKey(entry)
    if (!object.overrides || !(key in object.overrides)) return entry.properties ?? {}
    const over = object.overrides[key]
    return over === null ? {} : { ...(entry.properties ?? {}), ...over }
}

export function uniqueObjectName(map: EditorMap, base: string): string {
    const stem = base ? base[0]!.toUpperCase() + base.slice(1) : 'Object'
    let n = 1
    while (map.objects.some(o => o.name === `${stem}-${n}`)) n++
    return `${stem}-${n}`
}
