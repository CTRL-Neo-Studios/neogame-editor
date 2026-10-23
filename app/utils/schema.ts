import { deepClone } from './mapModel'
import type { JsonObject, JsonValue, NeoSchemaFile, SchemaNode } from '#shared/types/neo'

const DEFS = '#/$defs/'

/** What a property editor needs to know about one schema node, with $ref and nullable anyOf already unwrapped. */
export type FieldKind =
    | { kind: 'string', asset?: string }
    | { kind: 'number', integer: boolean }
    | { kind: 'boolean' }
    | { kind: 'enum', values: string[] }
    | { kind: 'vector', integer: boolean }
    | { kind: 'rect' }
    | { kind: 'color' }
    | { kind: 'strings' }
    | { kind: 'actions' }
    | { kind: 'specs' }
    | { kind: 'unknown' }

export interface FieldInfo {
    name: string
    field: FieldKind
    nullable: boolean
    required: boolean
    default: JsonValue | undefined
    node: SchemaNode
}

export const specKey = (name: string) => `spec:${name}`
export const actionKey = (name: string) => `action:${name}`

export function deref(schema: NeoSchemaFile, node: SchemaNode | undefined): SchemaNode | undefined {
    let current = node
    for (let guard = 0; current?.$ref && guard < 16; guard++)
        current = schema.$defs[current.$ref.replace(DEFS, '')]
    return current
}

// NeoSchema writes nullable values as anyOf [T, { type: null }]; editors want T plus a flag.
// annotations (x-neo-asset, description, default) sit on the anyOf wrapper, not on T, so carry them over
function unwrapNullable(node: SchemaNode): { node: SchemaNode, nullable: boolean } {
    const { anyOf: options, ...annotations } = node
    if (!options || options.length !== 2) return { node, nullable: false }
    const other = options.find(o => o.type !== 'null')
    return other && options.some(o => o.type === 'null') ? { node: { ...other, ...annotations }, nullable: true } : { node, nullable: false }
}

// an array of spec/action entries is the one shape that needs its own editor; recognise it by the entry def it points at
function entryListKind(node: SchemaNode | undefined): FieldKind | undefined {
    const ref = node?.$ref?.replace(DEFS, '')
    if (ref === 'entry:action') return { kind: 'actions' }
    if (ref === 'entry:spec') return { kind: 'specs' }
}

function classify(schema: NeoSchemaFile, raw: SchemaNode): FieldKind {
    const entries = entryListKind(raw)
    if (entries) return entries

    const node = deref(schema, raw) ?? raw
    if (node.enum) return { kind: 'enum', values: node.enum.map(String) }

    switch (node.type) {
        case 'string': return { kind: 'string', asset: node['x-neo-asset'] }
        case 'integer': return { kind: 'number', integer: true }
        case 'number': return { kind: 'number', integer: false }
        case 'boolean': return { kind: 'boolean' }
        case 'array': {
            // items are nullable too (anyOf [T, null]), e.g. TriggerSpec.onEnter items, SwitchWorldAction.unload items
            const items = unwrapNullable(node.items ?? {}).node
            const itemEntries = entryListKind(items)
            if (itemEntries) return itemEntries
            return deref(schema, items)?.type === 'string' ? { kind: 'strings' } : { kind: 'unknown' }
        }
        case 'object': {
            const keys = Object.keys(node.properties ?? {})
            if (keys.length === 2 && keys.includes('x') && keys.includes('y'))
                return { kind: 'vector', integer: node.properties!.x!.type === 'integer' }
            if (['x', 'y', 'width', 'height'].every(k => keys.includes(k))) return { kind: 'rect' }
            // NeoColor: { r, g, b, a? } channels 0-255
            if (keys.length === 4 && ['r', 'g', 'b', 'a'].every(k => keys.includes(k))) return { kind: 'color' }
            return { kind: 'unknown' }
        }
        default: return { kind: 'unknown' }
    }
}

/** Ordered field list for a spec/action definition (`spec:SpriteSpec`, `action:LoadWorldAction`). */
export function fieldsOf(schema: NeoSchemaFile, defKey: string): FieldInfo[] {
    const def = deref(schema, schema.$defs[defKey])
    if (!def?.properties) return []
    const required = new Set(def.required ?? [])
    return Object.entries(def.properties).map(([name, raw]) => {
        const { node, nullable } = unwrapNullable(raw)
        return {
            name,
            field: classify(schema, node),
            nullable,
            required: required.has(name),
            default: raw.default ?? node.default,
            node,
        }
    })
}

export function specNames(schema: NeoSchemaFile): string[] {
    return schema['x-neo-specs'] ?? Object.keys(schema.$defs).filter(k => k.startsWith('spec:')).map(k => k.slice(5))
}

export function actionNames(schema: NeoSchemaFile): string[] {
    return schema['x-neo-actions'] ?? Object.keys(schema.$defs).filter(k => k.startsWith('action:')).map(k => k.slice(7))
}

export interface NeoColor { r: number, g: number, b: number, a: number }

/** A NeoColor value with channels clamped to 0-255 (`a` defaults to 255), or null when unset/not a color. */
export function colorValue(v: JsonValue | undefined): NeoColor | null {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
    const ch = (x: JsonValue | undefined, d: number) => typeof x === 'number' && Number.isFinite(x) ? Math.min(255, Math.max(0, Math.round(x))) : d
    return { r: ch(v.r, 0), g: ch(v.g, 0), b: ch(v.b, 0), a: ch(v.a, 255) }
}

/** The file form of a color: `a` omitted when opaque, like the runtime default. */
export function colorJson(c: NeoColor): JsonObject {
    return c.a === 255 ? { r: c.r, g: c.g, b: c.b } : { r: c.r, g: c.g, b: c.b, a: c.a }
}

/** The first texture-like asset of an entry list, with that entry's color tint, for canvas previews. */
export function previewLook(schema: NeoSchemaFile, entries: { type: string, properties?: JsonObject }[] | undefined): { texture: string, tint: NeoColor | null } | undefined {
    for (const entry of entries ?? []) {
        const fields = fieldsOf(schema, specKey(entry.type))
        for (const f of fields) {
            if (f.field.kind === 'string' && f.field.asset === 'Texture2D') {
                const value = entry.properties?.[f.name]
                if (typeof value !== 'string' || !value) continue
                const colorField = fields.find(c => c.field.kind === 'color')
                return { texture: value, tint: colorField ? colorValue(entry.properties?.[colorField.name]) : null }
            }
        }
    }
}

/** The first texture-like asset property of an entry list, for thumbnails. */
export function previewAsset(schema: NeoSchemaFile, entries: { type: string, properties?: JsonObject }[] | undefined): string | undefined {
    return previewLook(schema, entries)?.texture
}

/** A blank value for a newly added field/entry: the schema default, else the type's zero value. */
export function blankValue(info: FieldInfo): JsonValue {
    // deepClone: the schema lives in reactive state, and structuredClone throws on proxies
    if (info.default !== undefined) return deepClone(info.default)
    switch (info.field.kind) {
        case 'string': return ''
        case 'number': return 0
        case 'boolean': return false
        case 'enum': return info.field.values[0] ?? ''
        case 'vector': return { x: 0, y: 0 }
        case 'rect': return { x: 0, y: 0, width: 0, height: 0 }
        case 'color': return { r: 255, g: 255, b: 255 }
        case 'strings':
        case 'actions':
        case 'specs': return []
        default: return null
    }
}

/** Properties a new entry starts with: only the required ones, so defaults stay implicit like hand-written files. */
export function blankProperties(schema: NeoSchemaFile, defKey: string): JsonObject {
    const props: JsonObject = {}
    for (const f of fieldsOf(schema, defKey))
        if (f.required) props[f.name] = blankValue(f)
    return props
}
