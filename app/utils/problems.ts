import Ajv2020 from 'ajv/dist/2020.js'
import type { ErrorObject, ValidateFunction } from 'ajv'
import type { JsonObject, NeoEntry, NeoPrefab, NeoSchemaFile } from '#shared/types/neo'
import type { MapTab, Selection } from '~/composables/app/useAppTabs'
import type { ProjectState } from '~/composables/project/useProject'

export interface Problem {
    level: 'error' | 'warning'
    message: string
    where: string
    target?: Selection
}

const DEFS = '#/$defs/'

// one Ajv per schema object; defs compile lazily since a map only touches the entry types it uses
const validators = new WeakMap<NeoSchemaFile, (defKey: string) => ValidateFunction | undefined>()

function validatorsOf(schema: NeoSchemaFile) {
    let get = validators.get(schema)
    if (!get) {
        const ajv = new Ajv2020({ strict: false, allErrors: true })
        const compiled = new Map<string, ValidateFunction | undefined>()
        get = (defKey) => {
            if (!compiled.has(defKey))
                compiled.set(defKey, schema.$defs[defKey] ? ajv.compile({ $defs: schema.$defs, $ref: DEFS + defKey }) : undefined)
            return compiled.get(defKey)
        }
        validators.set(schema, get)
    }
    return get
}

const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v)
const pointer = (p: string) => p ? p.split('/').slice(1).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~')) : []
const loc = (file: string, seg: string[]) => seg.length ? `${file} › ${seg.join('/')}` : file

// entry lists are oneOf unions over every type; their cascades are noise, so file-level validation skips them
// and entries are validated one by one against their own def
const IN_ENTRY = /\/specs\/\d+(\/|$)/

function describe(e: ErrorObject, seg: string[]): string {
    if (e.keyword === 'additionalProperties') return `unknown property '${String(e.params.additionalProperty)}'`
    if (e.keyword === 'required') return `missing required property '${String(e.params.missingProperty)}'`
    const allowed: unknown = e.params.allowedValues
    const message = e.keyword === 'enum' && Array.isArray(allowed)
        ? `must be one of ${allowed.map(v => JSON.stringify(v)).join(', ')}`
        : e.message ?? e.keyword
    return seg.length ? `${seg.at(-1)} ${message}` : message
}

interface EntryCheck {
    /** report top-level missing required properties (off for library prefabs: the object or cell using them decides) */
    required: boolean
    /** only report/recurse into these top-level fields (an object override validates only what it overrides) */
    fields?: Set<string>
    label?: string
}

/**
 * Everything NeoMap.Load/Build would throw on for this map, plus a few warnings. Mirrors NeoMap.cs: Resolve
 * (library merge), BuildLayer, BuildColliders, BuildObjects and ApplyEntries.
 */
export function mapProblems(tab: MapTab, prefabs: Record<string, NeoPrefab>, project: ProjectState): Problem[] {
    // raw objects: toMapFile structuredClones parts of the map, and ajv shouldn't walk reactive proxies
    const map = toRaw(tab.map)
    const { schema, libraries, libraryErrors } = toRaw(project)
    const out: Problem[] = []
    const push = (level: Problem['level'], message: string, where: string, target?: Selection) => out.push({ level, message, where, target })
    const validate = schema ? validatorsOf(schema) : undefined

    const owner: Record<string, string> = {}
    const colliderOwner: Record<string, string> = {}
    const prefabTarget = (name: string): Selection | undefined => {
        const library = owner[name]
        return library ? { kind: 'prefab', library, name } : undefined
    }

    function fileErrors(defRef: string | undefined, data: unknown, file: string, target: (seg: string[]) => Selection | undefined) {
        const fn = defRef && validate?.(defRef.replace(DEFS, ''))
        if (!fn || fn(data)) return
        for (const e of fn.errors ?? []) {
            if (IN_ENTRY.test(e.instancePath)) continue
            const seg = pointer(e.instancePath)
            push('error', describe(e, seg), loc(file, seg), target(seg))
        }
    }

    function checkEntry(raw: unknown, kind: 'spec' | 'action', file: string, propSeg: string[], target: Selection | undefined, check: EntryCheck, props?: JsonObject) {
        if (!schema || !validate) return
        const entry = isObject(raw) ? raw as unknown as NeoEntry : undefined
        if (!entry || typeof entry.type !== 'string' || !entry.type)
            return push('error', `${kind} entry is missing its 'type'`, loc(file, propSeg.slice(0, -1)), target)
        const defKey = kind === 'spec' ? specKey(entry.type) : actionKey(entry.type)
        const fn = validate(defKey)
        if (!fn) return push('error', `unknown ${kind} type '${entry.type}'`, loc(file, propSeg.slice(0, -1)), target)

        const data = props ?? entry.properties ?? {}
        const lists = new Map<string, 'spec' | 'action'>()
        for (const f of fieldsOf(schema, defKey))
            if (f.field.kind === 'actions' || f.field.kind === 'specs') lists.set(f.name, f.field.kind === 'actions' ? 'action' : 'spec')
        const label = check.label ?? entry.type

        if (!fn(data)) {
            for (const e of fn.errors ?? []) {
                const seg = pointer(e.instancePath)
                if (seg.length > 1 && lists.has(seg[0]!)) continue
                if (e.keyword === 'required' && !seg.length) {
                    if (check.required) push('error', `${label}: ${describe(e, seg)}`, loc(file, propSeg), target)
                    continue
                }
                const field = seg[0] ?? (e.keyword === 'additionalProperties' ? String(e.params.additionalProperty) : undefined)
                if (check.fields && (!field || !check.fields.has(field))) continue
                push('error', `${label}: ${describe(e, seg)}`, loc(file, [...propSeg, ...seg]), target)
            }
        }

        if (!isObject(data)) return
        for (const [name, itemKind] of lists) {
            const items = data[name]
            if (!Array.isArray(items) || (check.fields && !check.fields.has(name))) continue
            items.forEach((item, i) => checkEntry(item, itemKind, file, [...propSeg, name, String(i), 'properties'], target, { required: true }))
        }
    }

    if (!schema) push('error', project.schemaError ?? 'game schema not loaded', 'neo.project.json')
    const files = schema?.['x-neo-files']

    // libraries: NeoMap.Resolve merges prefabs and colliders and throws on any duplicate key
    const seen = new Set<string>()
    for (const lib of map.libraries) {
        if (seen.has(lib)) {
            push('error', `library '${lib}' is listed more than once (every prefab in it becomes a duplicate)`, loc(tab.name, ['prefabs']), { kind: 'map' })
            continue
        }
        seen.add(lib)
        const data = libraries[lib]
        if (!data) {
            const error = libraryErrors[lib]
            push('error', error ? `library '${lib}' failed to load: ${error}` : `library '${lib}' doesn't exist`, loc(tab.name, ['prefabs']), { kind: 'map' })
            continue
        }

        for (const name of Object.keys(data.prefabs ?? {})) {
            if (owner[name]) push('error', `duplicate prefab '${name}' (in '${owner[name]}' and '${lib}')`, loc(lib, ['prefabs', name]), { kind: 'prefab', library: lib, name })
            else owner[name] = lib
        }
        for (const name of Object.keys(data.colliders ?? {})) {
            if (colliderOwner[name]) push('error', `duplicate collider group '${name}' (in '${colliderOwner[name]}' and '${lib}')`, loc(lib, ['colliders', name]), { kind: 'collider', library: lib, name })
            else colliderOwner[name] = lib
        }

        fileErrors(files?.neoprefabs.$ref, data, lib, (seg) => {
            if (seg[0] === 'prefabs' && seg[1]) return { kind: 'prefab', library: lib, name: seg[1] }
            if (seg[0] === 'colliders' && seg[1]) return { kind: 'collider', library: lib, name: seg[1] }
        })
        for (const [name, prefab] of Object.entries(data.prefabs ?? {}))
            prefab.specs?.forEach((entry, i) => checkEntry(entry, 'spec', lib, ['prefabs', name, 'specs', String(i), 'properties'], { kind: 'prefab', library: lib, name }, { required: false }))
        for (const [name, group] of Object.entries(data.colliders ?? {}))
            group.specs?.forEach((entry, i) => checkEntry(entry, 'spec', lib, ['colliders', name, 'specs', String(i), 'properties'], { kind: 'collider', library: lib, name }, { required: true }))
    }

    // map file shape. NeoMap's legend is Dictionary<string,string> where null marks empty cells, which the schema types as string
    const file = toMapFile(map)
    fileErrors(files?.neomap.$ref, {
        ...file,
        layers: file.layers?.map(l => ({ ...l, legend: Object.fromEntries(Object.entries(l.legend ?? {}).filter(([, v]) => v !== null)) })),
    }, tab.name, seg => seg[0] === 'objects' && seg[1] ? { kind: 'object', index: Number(seg[1]) } : { kind: 'map' })

    if (map.cellSize.x <= 0 || map.cellSize.y <= 0) push('error', 'cellSize must be positive', loc(tab.name, ['cellSize']), { kind: 'map' })

    // painted cells, collapsed per prefab
    const painted = new Map<string, { count: number, layer: string, col: number, row: number }>()
    map.layers.forEach((layer, l) => {
        let any = false
        layer.cells.forEach((name, i) => {
            if (!name) return
            any = true
            const use = painted.get(name)
            if (use) use.count++
            else painted.set(name, { count: 1, layer: layer.name, col: i % map.cols, row: Math.floor(i / map.cols) })
        })
        if (!any) push('warning', `layer '${layer.name}' has no painted cells`, loc(tab.name, ['layers', String(l)]), { kind: 'map' })
    })

    for (const [name, use] of painted) {
        const prefab = prefabs[name]
        if (!prefab) {
            push('error', `${use.count} cell${use.count === 1 ? '' : 's'} use missing prefab '${name}'`, `${tab.name} › layer '${use.layer}' cell ${use.col},${use.row}`, { kind: 'cell', col: use.col, row: use.row })
            continue
        }
        // NeoMap.BuildColliders only looks at painted cells; objects never build their prefab's collider
        if (prefab.collider && !colliderOwner[prefab.collider])
            push('error', `prefab '${name}' uses collider group '${prefab.collider}', which no library of this map defines`, loc(owner[name] ?? tab.name, ['prefabs', name, 'collider']), prefabTarget(name))
        prefab.specs?.forEach((entry, i) => schema?.$defs[specKey(entry.type)] && checkEntry(entry, 'spec', owner[name] ?? tab.name, ['prefabs', name, 'specs', String(i), 'properties'], prefabTarget(name),
            { required: true, fields: new Set(), label: `'${name}' (painted) ${entry.type}` }))
    }

    // objects
    const names = new Set<string>()
    const width = map.cols * map.cellSize.x
    const height = map.rows * map.cellSize.y
    map.objects.forEach((obj, index) => {
        const target: Selection = { kind: 'object', index }
        const name = obj.name || `#${index}`
        const at = (...seg: string[]) => loc(tab.name, ['objects', String(index), ...seg])

        if (obj.name) {
            if (names.has(obj.name)) push('warning', `duplicate object name '${obj.name}'`, at('name'), target)
            names.add(obj.name)
        }
        const pos = obj.position ?? { x: 0, y: 0 }
        if (map.cellSize.x > 0 && map.cellSize.y > 0 && (pos.x < 0 || pos.y < 0 || pos.x > width || pos.y > height))
            push('warning', `'${name}' is outside the map (${pos.x}, ${pos.y})`, at('position'), target)

        obj.specs?.forEach((entry, i) => checkEntry(entry, 'spec', tab.name, ['objects', String(index), 'specs', String(i), 'properties'], target, { required: true }))

        const overrides = obj.overrides ?? {}
        if (!obj.prefab) {
            if (Object.keys(overrides).length) push('warning', `'${name}' has overrides but no prefab, so they are ignored`, at('overrides'), target)
            return
        }
        const prefab = prefabs[obj.prefab]
        if (!prefab) return push('error', `'${name}' references missing prefab '${obj.prefab}'`, at('prefab'), target)

        const specs = prefab.specs ?? []
        for (const [key, over] of Object.entries(overrides)) {
            if (!specs.some(e => overrideKey(e) === key)) push('error', `'${name}': override '${key}' matches no spec entry of prefab '${obj.prefab}'`, at('overrides', key), target)
            else if (over !== null && !isObject(over)) push('error', `'${name}': override '${key}' must be an object or null`, at('overrides', key), target)
        }

        for (const entry of specs) {
            if (!schema?.$defs[specKey(entry.type)]) continue // reported on the library
            const key = overrideKey(entry)
            const over = overrides[key]
            if (over !== undefined && over !== null && !isObject(over)) continue
            checkEntry(entry, 'spec', tab.name, ['objects', String(index), 'overrides', key], target,
                { required: true, fields: new Set(Object.keys(over ?? {})), label: `'${name}' ${obj.prefab}.${key}` },
                effectiveProperties(entry, obj))
        }
    })

    return out.sort((a, b) => a.level === b.level ? 0 : a.level === 'error' ? -1 : 1)
}
