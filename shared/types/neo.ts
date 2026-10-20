// On-disk shapes of NeoGameLib data files. These mirror the generated <Game>.neoschema.json
// (camelCase members, MonoGame vectors as { x, y }); the schema stays the source of truth for
// spec/action property shapes, which is why those are plain records here.

export interface Vec2 { x: number, y: number }

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

/** A spec or action entry: `{ type, id?, properties }`. Actions never carry an id. */
export interface NeoEntry {
    type: string
    id?: string | null
    properties?: JsonObject
}

export interface NeoPrefab {
    tags?: string[]
    specs?: NeoEntry[]
    collider?: string
    /** editor-only grouping, `/`-separated key segments; "" or absent = library root. Not part of the prefab's name. */
    folder?: string
}

export interface NeoColliderGroup {
    tags?: string[]
    specs?: NeoEntry[]
}

export interface NeoPrefabLibraryFile {
    prefabs?: Record<string, NeoPrefab>
    colliders?: Record<string, NeoColliderGroup>
}

export interface NeoMapLayerFile {
    name?: string
    legend?: Record<string, string | null>
    rows?: string[]
}

export interface NeoMapObjectFile {
    name?: string
    prefab?: string
    tags?: string[]
    specs?: NeoEntry[]
    position?: Vec2
    rotation?: number
    scale?: Vec2
    /** keyed by entry id, or spec type when the entry has no id; null resets the entry to spec defaults */
    overrides?: Record<string, JsonObject | null>
}

export interface NeoMapFile {
    cellSize?: Vec2
    origin?: Vec2
    prefabs?: string[]
    layers?: NeoMapLayerFile[]
    objects?: NeoMapObjectFile[]
}

/** Data/neo.project.json. Unknown top-level sections must survive a load/save round-trip. */
export interface NeoProjectFile {
    version?: number
    schema?: string
    contentRoot?: string
    [section: string]: JsonValue | undefined
}

/** A JSON Schema node as emitted by NeoSchema (draft 2020-12 subset). */
export interface SchemaNode {
    $ref?: string
    type?: string | string[]
    properties?: Record<string, SchemaNode>
    required?: string[]
    additionalProperties?: boolean | SchemaNode
    items?: SchemaNode
    enum?: JsonValue[]
    const?: JsonValue
    default?: JsonValue
    anyOf?: SchemaNode[]
    oneOf?: SchemaNode[]
    allOf?: SchemaNode[]
    'x-neo-asset'?: string
    [key: string]: unknown
}

export interface NeoSchemaFile extends SchemaNode {
    $id?: string
    $defs: Record<string, SchemaNode>
    'x-neo-schema-version'?: number
    'x-neo-specs'?: string[]
    'x-neo-actions'?: string[]
    'x-neo-files'?: { neomap: SchemaNode, neoprefabs: SchemaNode, project: SchemaNode }
}
