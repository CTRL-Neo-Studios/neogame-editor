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

/**
 * Legend char of every prefab, per layer, exactly as toMapFile writes them: a prefab keeps the char it was loaded
 * with, new prefabs take the first free pool char. Pure, so the sidebar and canvas can show what a save will write.
 */
export function layerLegends(map: EditorMap): Map<string, string>[] {
    const chars = { ...map.chars }
    return map.layers.map((layer) => {
        const charOf = new Map<string, string>()
        const taken = new Set<string>([' '])
        for (const prefab of layer.cells) {
            if (!prefab || charOf.has(prefab)) continue
            const preferred = chars[prefab]
            const ch = preferred && !taken.has(preferred) ? preferred : CHAR_POOL.find(c => !taken.has(c))
            if (!ch) throw new Error(`layer '${layer.name}' uses more prefabs than available legend characters`)
            taken.add(ch)
            charOf.set(prefab, ch)
            chars[prefab] ??= ch
        }
        return charOf
    })
}

/** Serialize back to the file shape. Legend characters are per layer; a prefab keeps the char it was loaded with. */
export function toMapFile(map: EditorMap): NeoMapFile {
    const legends = layerLegends(map)
    const layers = map.layers.map((layer, i) => {
        const charOf = legends[i]!
        const legend: Record<string, string | null> = {}
        for (const [prefab, ch] of charOf) {
            legend[ch] = prefab
            map.chars[prefab] ??= ch
        }

        let hasEmpty = false
        const rows: string[] = []
        for (let r = 0; r < map.rows; r++) {
            let line = ''
            for (let c = 0; c < map.cols; c++) {
                const prefab = layer.cells[r * map.cols + c]
                if (prefab) line += charOf.get(prefab)
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

// ---- tile selection: one cell mask over the grid, applied to a scope of layers ----

/** Which layers tile-selection operations touch: the active layer, every layer, or the named layers. */
export type SelScope = 'current' | 'all' | string[]

/** A masked block of cells per layer, positioned at `x,y` (cells): lifted tiles, a paste, or the clipboard. */
export interface TileBlock {
    x: number
    y: number
    cols: number
    rows: number
    /** 1 = the cell belongs to the block; unmasked cells inside the bounds are left untouched on drop */
    mask: number[]
    /** `cols * rows` cells per layer name */
    layers: Record<string, (string | null)[]>
}

export function scopeLayers(map: EditorMap, scope: SelScope, current: number): number[] {
    if (scope === 'all') return map.layers.map((_, i) => i)
    if (scope === 'current') return map.layers[current] ? [current] : []
    return map.layers.flatMap((layer, i) => scope.includes(layer.name) ? [i] : [])
}

/** A copy of `mask` (or an empty one when it's missing or sized for another grid) with a rectangle set to `value`. */
export function maskRect(map: EditorMap, mask: number[] | null, c0: number, r0: number, c1: number, r1: number, value: 0 | 1): number[] {
    const out = mask?.length === map.cols * map.rows ? [...mask] : Array.from({ length: map.cols * map.rows }, () => 0)
    for (let r = Math.max(0, Math.min(r0, r1)); r <= Math.min(map.rows - 1, Math.max(r0, r1)); r++)
        for (let c = Math.max(0, Math.min(c0, c1)); c <= Math.min(map.cols - 1, Math.max(c0, c1)); c++)
            out[r * map.cols + c] = value
    return out
}

/** Bounding box of the set cells, or null when the mask is empty or sized for another grid. */
export function maskBounds(map: EditorMap, mask: number[] | null): { col: number, row: number, cols: number, rows: number } | null {
    if (mask?.length !== map.cols * map.rows) return null
    let c0 = Infinity, r0 = Infinity, c1 = -1, r1 = -1
    mask.forEach((v, i) => {
        if (!v) return
        const c = i % map.cols
        const r = Math.floor(i / map.cols)
        c0 = Math.min(c0, c); r0 = Math.min(r0, r); c1 = Math.max(c1, c); r1 = Math.max(r1, r)
    })
    return c1 < 0 ? null : { col: c0, row: r0, cols: c1 - c0 + 1, rows: r1 - r0 + 1 }
}

/** The masked cells of the given layers as a block at the mask's bounds; null when nothing is selected. */
export function copyBlock(map: EditorMap, mask: number[] | null, layers: number[]): TileBlock | null {
    const b = maskBounds(map, mask)
    if (!b || !layers.length) return null
    const block: TileBlock = { x: b.col, y: b.row, cols: b.cols, rows: b.rows, mask: [], layers: {} }
    for (let r = 0; r < b.rows; r++)
        for (let c = 0; c < b.cols; c++) block.mask.push(mask![(b.row + r) * map.cols + b.col + c]!)
    for (const i of layers) {
        const layer = map.layers[i]!
        const cells: (string | null)[] = []
        for (let r = 0; r < b.rows; r++)
            for (let c = 0; c < b.cols; c++) cells.push(layer.cells[(b.row + r) * map.cols + b.col + c] ?? null)
        block.layers[layer.name] = cells
    }
    return block
}

/** Empties the masked cells of the given layers. */
export function clearMasked(map: EditorMap, mask: number[], layers: number[]) {
    for (const i of layers) {
        const cells = map.layers[i]!.cells
        mask.forEach((v, j) => { if (v) cells[j] = null })
    }
}

/**
 * Writes a block into the map, clipped to its bounds. Each block layer lands on the same-named map layer, else on
 * `fallback`; returns the block layer names that had no match.
 */
export function dropBlock(map: EditorMap, block: TileBlock, fallback: number): string[] {
    const missing: string[] = []
    for (const [name, cells] of Object.entries(block.layers)) {
        let layer = map.layers.find(l => l.name === name)
        if (!layer) {
            missing.push(name)
            layer = map.layers[fallback]
            if (!layer) continue
        }
        for (let r = 0; r < block.rows; r++)
            for (let c = 0; c < block.cols; c++) {
                const col = block.x + c
                const row = block.y + r
                if (block.mask[r * block.cols + c] && inBounds(map, col, row)) layer.cells[row * map.cols + col] = cells[r * block.cols + c] ?? null
            }
    }
    return missing
}

/** The grid mask a block covers at its current position, clipped to the map. */
export function blockMask(map: EditorMap, block: TileBlock): number[] {
    const out = Array.from({ length: map.cols * map.rows }, () => 0)
    for (let r = 0; r < block.rows; r++)
        for (let c = 0; c < block.cols; c++)
            if (block.mask[r * block.cols + c] && inBounds(map, block.x + c, block.y + r)) out[(block.y + r) * map.cols + block.x + c] = 1
    return out
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
