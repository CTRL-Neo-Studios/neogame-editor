import type { JsonObject, JsonValue, NeoEntry, NeoPrefab, Vec2 } from '#shared/types/neo'
import { type EditorMap, effectiveProperties } from '~/utils/mapModel'

/** Canvas world space: map top-left = (0,0), cell (c,r) center = (c*cw + cw/2, r*ch + ch/2). */
export interface ColliderShape { x: number, y: number, w: number, h: number, trigger: boolean }

const num = (v: JsonValue | undefined, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const vec = (v: JsonValue | undefined, d: number): Vec2 => {
    const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {}
    return { x: num(o.x, d), y: num(o.y, d) }
}

/**
 * Per-entity colliders as the runtime builds them (NEOGAMELIB-PARITY §2). Group colliders (`prefab.collider`)
 * are excluded — MapCanvas draws those merged. `props` resolves an entry's properties (overrides for objects).
 */
function pushEntity(out: ColliderShape[], specs: NeoEntry[], props: (e: NeoEntry) => JsonObject,
    cx: number, cy: number, scale: Vec2, cell: Vec2, textureSize: (key: string) => { w: number, h: number } | null) {
    const sx = Math.abs(scale.x), sy = Math.abs(scale.y)
    for (const e of specs) {
        if (e.type === 'BoxColliderSpec' || e.type === 'TriggerSpec') {
            const p = props(e)
            const size = vec(p.size, 0), off = vec(p.offset, 0)
            const w = size.x * sx, h = size.y * sy
            out.push({ x: cx + off.x * scale.x - w / 2, y: cy + off.y * scale.y - h / 2, w, h,
                trigger: e.type === 'TriggerSpec' || p.isTrigger === true })
        }
        else if (e.type === 'SpriteColliderSpec') {
            const sprite = specs.find(s => s.type === 'SpriteSpec')
            const p = sprite ? props(sprite) : {}
            const src = p.source && typeof p.source === 'object' && !Array.isArray(p.source) ? p.source : null
            const tex = typeof p.texture === 'string' && p.texture ? textureSize(p.texture) : null
            const fw = src ? num(src.width, 0) : tex ? tex.w : cell.x
            const fh = src ? num(src.height, 0) : tex ? tex.h : cell.y
            const anchor = vec(p.anchor, 0.5)
            const w = fw * sx, h = fh * sy
            out.push({ x: cx - anchor.x * w, y: cy - anchor.y * h, w, h, trigger: false })
        }
    }
}

export function colliderShapes(map: EditorMap, prefabs: Record<string, NeoPrefab>,
    textureSize: (key: string) => { w: number, h: number } | null): ColliderShape[] {
    const out: ColliderShape[] = []
    const cw = map.cellSize.x, ch = map.cellSize.y
    const one = { x: 1, y: 1 }
    const raw = (e: NeoEntry) => e.properties ?? {}
    for (const layer of map.layers) {
        // hidden layers are editor-only, but skip them so the overlay matches what the user sees
        if (layer.visible === false) continue
        for (let i = 0; i < layer.cells.length; i++) {
            const name = layer.cells[i]
            const specs = name ? prefabs[name]?.specs : undefined
            if (!specs?.length) continue
            const c = i % map.cols, r = (i - c) / map.cols
            pushEntity(out, specs, raw, c * cw + cw / 2, r * ch + ch / 2, one, map.cellSize, textureSize)
        }
    }
    for (const o of map.objects) {
        // rotation is ignored: boxes are drawn axis-aligned (unverified against the runtime for rotated objects)
        const cx = num(o.position?.x, 0) + cw / 2, cy = num(o.position?.y, 0) + ch / 2
        const scale = { x: num(o.scale?.x, 1), y: num(o.scale?.y, 1) }
        const prefabSpecs = o.prefab ? prefabs[o.prefab]?.specs : undefined
        if (prefabSpecs?.length) pushEntity(out, prefabSpecs, e => effectiveProperties(e, o), cx, cy, scale, map.cellSize, textureSize)
        if (o.specs?.length) pushEntity(out, o.specs, raw, cx, cy, scale, map.cellSize, textureSize)
    }
    return out
}
