<script setup lang="ts">
import type { ContextMenuItem } from '@nuxt/ui'
import type { NeoMapObjectFile, NeoPrefab, NeoSchemaFile, Vec2 } from '#shared/types/neo'
import type { NeoColor } from '~/utils/schema'

// Plain Canvas 2D, same approach as the reference mockup: one draw() renders everything under a single
// world->screen transform, so selection, hover and previews always follow pan/zoom.

const props = defineProps<{ tab: MapTab, prefabs: Record<string, NeoPrefab>, schema: NeoSchemaFile }>()
// selection/hover outline color; MapToolbar edits the same key
const highlight = useLocalStorage('neo-highlight', '#ffffff')

const $tabs = useAppTabs()
const commands = inject<AppCommand[]>('neo:commands', [])
const project = useProject()
const toast = useToast()

const VIEW_BG = '#2b2d33'
const MAP_BG = '#1f2126'
const OTHER_LAYER_ALPHA = 0.6
const OUT_OF_SCOPE_ALPHA = 0.3
const TRIGGER = 'rgb(45,212,191)'
// prefab/object colliders (not a group)
const ENTITY = 'rgb(255,92,122)'

const container = ref<HTMLDivElement>()
const canvas = ref<HTMLCanvasElement>()
const size = { w: 0, h: 0 }
const pan = { x: 0, y: 0 }
let appliedZoom = props.tab.zoom
let fitted = false
let spaceDown = false

const hoverCell = ref<{ c: number, r: number } | null>(null)
const hoverWorld = ref<Vec2 | null>(null)
const contextTarget = ref<{ kind: 'object', index: number } | { kind: 'tiles' } | null>(null)

type Drag =
    | { kind: 'pan', x: number, y: number }
    | { kind: 'paint', value: string | null, last: Vec2 }
    | { kind: 'rect', c0: number, r0: number, c1: number, r1: number, erase: boolean }
    | { kind: 'object', index: number, dx: number, dy: number }
    // select tool rubber band; `inside` = started on a map cell (a click outside clears the selection)
    | { kind: 'area', c0: number, r0: number, c1: number, r1: number, mode: 'set' | 'add' | 'remove', moved: boolean, inside: boolean }
    // move tool: dragging tab.floating, last pointer cell
    | { kind: 'block', c: number, r: number }
let drag: Drag | null = null
// one undo step per gesture, taken lazily so clicks that change nothing don't pollute history
let checkpointed = false
function touch() {
    if (checkpointed) return
    $tabs.checkpoint(props.tab)
    checkpointed = true
}

const map = () => props.tab.map
const cs = () => props.tab.map.cellSize

const colliderGroups = computed(() => $tabs.collidersOf(props.tab))
const colliderBoxes = computed(() => mergeColliders(props.tab.map, props.prefabs, colliderGroups.value))
const groupColor = computed(() => $tabs.groupColor.value)
// legend: only the groups this map actually paints, in color order
const usedGroups = computed(() => {
    const used = new Set(colliderBoxes.value.map(b => b.group))
    return Object.keys(colliderGroups.value).filter(g => used.has(g))
})
const selBounds = computed(() => {
    const f = props.tab.floating
    return f ? { col: f.x, row: f.y, cols: f.cols, rows: f.rows } : maskBounds(props.tab.map, props.tab.tileSel)
})
const legends = computed(() => {
    try { return layerLegends(props.tab.map) }
    catch { return [] }
})
const looks = computed(() => new Map(Object.entries(props.prefabs).map(([name, prefab]) => {
    const look = previewLook(props.schema, prefab.specs)
    const key = look?.texture ?? null
    return [name, { key, tint: look?.tint ?? null, color: colorOf(name, key) }]
})))

// ---- textures: content images as blob URLs; null = loading or no preview ----
const textures = new Map<string, HTMLImageElement | null>()
const blobUrls: string[] = []
let unmounted = false
// bumped when an image finishes loading, so sprite collider sizes recompute
const texturesLoaded = ref(0)

function texture(key: string): HTMLImageElement | null {
    if (textures.has(key)) return textures.get(key) ?? null
    textures.set(key, null)
    project.assetUrl(key).then((url) => {
        if (!url || unmounted) return
        blobUrls.push(url)
        const img = new Image()
        img.onload = () => {
            textures.set(key, img)
            texturesLoaded.value++
            schedule()
        }
        img.src = url
    })
    return null
}

// SpriteSpec color: tinted copies per texture + rgb, built once the texture has loaded
const tinted = new Map<string, HTMLCanvasElement | null>()
type Look = { key: string | null, tint: NeoColor | null }
function drawLook(ctx: CanvasRenderingContext2D, look: Look | undefined, x: number, y: number, w: number, h: number): boolean {
    const img = look?.key && props.tab.showTextures ? texture(look.key) : null
    if (!img) return false
    const tint = look!.tint
    let source: CanvasImageSource = img
    if (tint) {
        const id = `${look!.key}|${tint.r},${tint.g},${tint.b}`
        if (!tinted.has(id)) tinted.set(id, tintImage(img, tint))
        source = tinted.get(id) ?? img
    }
    const alpha = ctx.globalAlpha
    if (tint) ctx.globalAlpha = alpha * tint.a / 255
    ctx.drawImage(source, x, y, w, h)
    ctx.globalAlpha = alpha
    return true
}

const colliderSpecs = computed(() => {
    void texturesLoaded.value
    return colliderShapes(props.tab.map, props.prefabs, (key) => {
        const img = texture(key)
        return img ? { w: img.naturalWidth, h: img.naturalHeight } : null
    })
})

// ---- drawing ----
let frame = 0
function schedule() {
    if (!frame) frame = requestAnimationFrame(() => {
        frame = 0
        draw()
    })
}

function drawTile(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, w: number, h: number) {
    const look = looks.value.get(name)
    if (!look) {
        ctx.fillStyle = '#ff00ff'
        ctx.fillRect(x, y, w, h)
        return
    }
    if (!drawLook(ctx, look, x, y, w, h)) {
        ctx.fillStyle = look.color
        ctx.fillRect(x, y, w, h)
    }
}

function draw() {
    const cv = canvas.value
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    const dpr = window.devicePixelRatio || 1
    const m = map()
    const z = props.tab.zoom
    const { x: cw, y: ch } = m.cellSize
    const W = m.cols * cw
    const H = m.rows * ch
    const px = 1 / z // one screen pixel in world units

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = VIEW_BG
    ctx.fillRect(0, 0, cv.width, cv.height)
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * pan.x, dpr * pan.y)
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = MAP_BG
    ctx.fillRect(0, 0, W, H)

    // tiles; layers other than the current one are dimmed, layers outside a custom/all selection scope more so
    const scoped = (props.tab.tool === 'select' || props.tab.tool === 'move') && props.tab.selScope !== 'current' ? $tabs.selectedLayers(props.tab) : null
    m.layers.forEach((layer, li) => {
        if (!layer.visible) return
        ctx.globalAlpha = scoped && !scoped.includes(li) ? OUT_OF_SCOPE_ALPHA : li === props.tab.layer ? 1 : OTHER_LAYER_ALPHA
        for (let r = 0; r < m.rows; r++)
            for (let c = 0; c < m.cols; c++) {
                const name = layer.cells[r * m.cols + c]
                if (name) drawTile(ctx, name, c * cw, r * ch, cw, ch)
            }
    })
    ctx.globalAlpha = 1

    // legend characters of the current layer, as the file will store them
    const current = m.layers[props.tab.layer]
    const legend = legends.value[props.tab.layer]
    if (current?.visible && legend && Math.min(cw, ch) * z >= 14) {
        ctx.font = `${Math.min(cw, ch) * 0.45}px ui-monospace, Consolas, monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.lineWidth = 3 * px
        ctx.strokeStyle = 'rgba(0,0,0,.6)'
        ctx.fillStyle = 'rgba(255,255,255,.75)'
        for (let r = 0; r < m.rows; r++)
            for (let c = 0; c < m.cols; c++) {
                const name = current.cells[r * m.cols + c]
                if (!name) continue
                const ch2 = legend.get(name) ?? '?'
                ctx.strokeText(ch2, c * cw + cw / 2, r * ch + ch / 2)
                ctx.fillText(ch2, c * cw + cw / 2, r * ch + ch / 2)
            }
    }

    // lifted / pasted tiles follow the move tool until dropped
    const f = props.tab.floating
    if (f) {
        ctx.globalAlpha = 0.8
        for (const cells of Object.values(f.layers))
            for (let r = 0; r < f.rows; r++)
                for (let c = 0; c < f.cols; c++) {
                    const name = f.mask[r * f.cols + c] ? cells[r * f.cols + c] : null
                    if (name) drawTile(ctx, name, (f.x + c) * cw, (f.y + r) * ch, cw, ch)
                }
        ctx.globalAlpha = 1
    }

    if (props.tab.showGrid) {
        ctx.beginPath()
        for (let c = 0; c <= m.cols; c++) { ctx.moveTo(c * cw, 0); ctx.lineTo(c * cw, H) }
        for (let r = 0; r <= m.rows; r++) { ctx.moveTo(0, r * ch); ctx.lineTo(W, r * ch) }
        ctx.lineWidth = px
        ctx.strokeStyle = 'rgba(255,255,255,.08)'
        ctx.stroke()
    }
    ctx.lineWidth = px
    ctx.strokeStyle = 'rgba(255,255,255,.2)'
    ctx.strokeRect(0, 0, W, H)

    if (props.tab.showColliders) {
        ctx.lineWidth = 2 * px
        const box = (s: ColliderShape, color: string) => {
            ctx.setLineDash(s.trigger ? [5 * px, 3 * px] : [])
            ctx.fillStyle = ctx.strokeStyle = color
            ctx.globalAlpha = s.trigger ? .08 : .14
            ctx.fillRect(s.x, s.y, s.w, s.h)
            ctx.globalAlpha = .9
            ctx.strokeRect(s.x + px, s.y + px, s.w - 2 * px, s.h - 2 * px)
        }
        // group runs in their group's color; triggers dashed teal so they don't read as walls; per-entity colliders red
        for (const b of colliderBoxes.value)
            for (const s of b.shapes) box(s, s.trigger ? TRIGGER : groupColor.value[b.group] ?? ENTITY)
        for (const s of colliderSpecs.value) box(s, s.trigger ? TRIGGER : ENTITY)
        ctx.globalAlpha = 1
        ctx.setLineDash([])
    }

    if (props.tab.showObjects) {
        const rad = Math.min(cw, ch) * 0.32
        m.objects.forEach((o, i) => {
            const x = (o.position?.x ?? 0) + cw / 2
            const y = (o.position?.y ?? 0) + ch / 2
            const selected = props.tab.selection.kind === 'object' && props.tab.selection.index === i
            const look = o.prefab ? looks.value.get(o.prefab) : undefined
            drawLook(ctx, look, x - cw / 2, y - ch / 2, cw, ch)

            ctx.beginPath()
            ctx.moveTo(x, y - rad); ctx.lineTo(x + rad, y); ctx.lineTo(x, y + rad); ctx.lineTo(x - rad, y); ctx.closePath()
            ctx.fillStyle = look?.color ?? '#ff00ff'
            ctx.fill()
            ctx.lineWidth = (selected ? 3 : 1.5) * px
            ctx.strokeStyle = selected ? highlight.value : '#ffffff'
            ctx.stroke()
            if (selected) {
                const halo = rad + 5 * px
                ctx.beginPath()
                ctx.moveTo(x, y - halo); ctx.lineTo(x + halo, y); ctx.lineTo(x, y + halo); ctx.lineTo(x - halo, y); ctx.closePath()
                ctx.lineWidth = 1.5 * px
                ctx.stroke()
            }

            // labels stay 11 screen px at every zoom
            ctx.font = `${11 * px}px system-ui, sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'top'
            const label = o.name || `#${i}`
            const tw = ctx.measureText(label).width + 8 * px
            ctx.fillStyle = 'rgba(0,0,0,.7)'
            ctx.fillRect(x - tw / 2, y + rad + 3 * px, tw, 15 * px)
            ctx.fillStyle = selected ? highlight.value : '#dddddd'
            ctx.fillText(label, x, y + rad + 5 * px)
        })
    }

    // tile selection (or the floating block): faint fill + two-tone dashed outer edges
    const b = selBounds.value
    if (b) {
        const mask = props.tab.tileSel
        const on = f
            ? (c: number, r: number) => c >= f.x && r >= f.y && c < f.x + f.cols && r < f.y + f.rows && !!f.mask[(r - f.y) * f.cols + c - f.x]
            : (c: number, r: number) => inBounds(m, c, r) && !!mask![r * m.cols + c]
        ctx.beginPath()
        ctx.globalAlpha = 0.12
        ctx.fillStyle = highlight.value
        for (let r = b.row; r < b.row + b.rows; r++)
            for (let c = b.col; c < b.col + b.cols; c++) {
                if (!on(c, r)) continue
                const x = c * cw
                const y = r * ch
                ctx.fillRect(x, y, cw, ch)
                if (!on(c, r - 1)) { ctx.moveTo(x, y); ctx.lineTo(x + cw, y) }
                if (!on(c, r + 1)) { ctx.moveTo(x, y + ch); ctx.lineTo(x + cw, y + ch) }
                if (!on(c - 1, r)) { ctx.moveTo(x, y); ctx.lineTo(x, y + ch) }
                if (!on(c + 1, r)) { ctx.moveTo(x + cw, y); ctx.lineTo(x + cw, y + ch) }
            }
        ctx.globalAlpha = 1
        ctx.lineWidth = 2 * px
        ctx.strokeStyle = 'rgba(0,0,0,.7)'
        ctx.stroke()
        ctx.setLineDash([4 * px, 4 * px])
        ctx.strokeStyle = highlight.value
        ctx.stroke()
        ctx.setLineDash([])
    }

    ctx.strokeStyle = highlight.value
    if (drag?.kind === 'rect' || drag?.kind === 'area') {
        const { c0, r0, c1, r1 } = drag
        ctx.setLineDash([6 * px, 4 * px])
        ctx.lineWidth = 2 * px
        ctx.strokeStyle = (drag.kind === 'rect' ? drag.erase : drag.mode === 'remove') ? '#ff6b6b' : highlight.value
        ctx.strokeRect(Math.min(c0, c1) * cw + px, Math.min(r0, r1) * ch + px, (Math.abs(c1 - c0) + 1) * cw - 2 * px, (Math.abs(r1 - r0) + 1) * ch - 2 * px)
        ctx.setLineDash([])
    }
    else if (hoverCell.value && props.tab.tool !== 'select') {
        ctx.lineWidth = 1.5 * px
        ctx.strokeRect(hoverCell.value.c * cw + px, hoverCell.value.r * ch + px, cw - 2 * px, ch - 2 * px)
    }
    const sel = props.tab.selection
    if (sel.kind === 'cell' && inBounds(m, sel.col, sel.row) && !props.tab.tileSel?.[cellIndex(m, sel.col, sel.row)]) {
        ctx.setLineDash([4 * px, 3 * px])
        ctx.lineWidth = 2 * px
        ctx.strokeStyle = highlight.value
        ctx.strokeRect(sel.col * cw + px, sel.row * ch + px, cw - 2 * px, ch - 2 * px)
        ctx.setLineDash([])
    }

    // rulers last, in screen space; a live rubber band shows its extents instead of the current selection
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const a = drag?.kind === 'area' ? drag : null
    drawRulers(ctx, {
        width: size.w, height: size.h, zoom: z, pan, cellSize: m.cellSize, cols: m.cols, rows: m.rows,
        selection: a ? { col: Math.min(a.c0, a.c1), row: Math.min(a.r0, a.r1), cols: Math.abs(a.c1 - a.c0) + 1, rows: Math.abs(a.r1 - a.r0) + 1 } : b,
        hover: hoverCell.value,
        colors: { bg: '#24262b', tick: 'rgba(255,255,255,.25)', text: 'rgba(255,255,255,.6)', accent: highlight.value },
    })
}

// ---- camera ----
function zoomAround(sx: number, sy: number, from: number, to: number) {
    pan.x = sx - (sx - pan.x) / from * to
    pan.y = sy - (sy - pan.y) / from * to
    appliedZoom = to
}

function zoomAt(sx: number, sy: number, factor: number) {
    const to = Math.min(8, Math.max(0.1, props.tab.zoom * factor))
    zoomAround(sx, sy, props.tab.zoom, to)
    props.tab.zoom = to
}

// toolbar zoom buttons change tab.zoom directly; keep the view centre fixed for those
watch(() => props.tab.zoom, (to, from) => {
    if (to !== appliedZoom) zoomAround(size.w / 2, size.h / 2, from, to)
    schedule()
})

// leaves the ruler strips (top/left) out of the fitted area
function fit() {
    const { x: cw, y: ch } = cs()
    const w = size.w - RULER
    const h = size.h - RULER
    const z = Math.min(8, Math.max(0.1, Math.min((w - 96) / (map().cols * cw), (h - 96) / (map().rows * ch))))
    pan.x = RULER + (w - map().cols * cw * z) / 2
    pan.y = RULER + (h - map().rows * ch * z) / 2
    appliedZoom = z
    props.tab.zoom = z
}

useResizeObserver(container, ([entry]) => {
    const cv = canvas.value
    if (!entry || !cv) return
    const dpr = window.devicePixelRatio || 1
    size.w = entry.contentRect.width
    size.h = entry.contentRect.height
    cv.width = Math.round(size.w * dpr)
    cv.height = Math.round(size.h * dpr)
    if (!fitted && size.w > 0 && size.h > 0) {
        fitted = true
        fit()
    }
    draw()
})

// ---- input ----
function local(e: MouseEvent): Vec2 {
    const rect = canvas.value!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}
const toWorld = (p: Vec2): Vec2 => ({ x: (p.x - pan.x) / props.tab.zoom, y: (p.y - pan.y) / props.tab.zoom })
const cellOf = (w: Vec2) => ({ c: Math.floor(w.x / cs().x), r: Math.floor(w.y / cs().y) })
const clampCol = (c: number) => Math.max(0, Math.min(map().cols - 1, c))
const clampRow = (r: number) => Math.max(0, Math.min(map().rows - 1, r))

function hitObject(w: Vec2): number {
    if (!props.tab.showObjects) return -1
    const { x: cw, y: ch } = cs()
    const radius = Math.min(cw, ch) * 0.45
    for (let i = map().objects.length - 1; i >= 0; i--) {
        const o = map().objects[i]!
        if (Math.hypot(w.x - ((o.position?.x ?? 0) + cw / 2), w.y - ((o.position?.y ?? 0) + ch / 2)) < radius) return i
    }
    return -1
}

function requirePrefab(): boolean {
    if (props.tab.prefab) return true
    toast.add({ title: 'Pick a prefab first', description: 'Choose a prefab in the sidebar, then paint or place it.', color: 'warning', icon: 'i-lucide-paintbrush', duration: 2500 })
    return false
}

function setCell(c: number, r: number, value: string | null) {
    const layer = map().layers[props.tab.layer]
    if (!layer || !inBounds(map(), c, r)) return
    const i = r * map().cols + c
    if (layer.cells[i] === value) return
    touch()
    layer.cells[i] = value
}

function pickCell(c: number, r: number) {
    for (let i = map().layers.length - 1; i >= 0; i--) {
        const layer = map().layers[i]!
        const name = layer.visible ? layer.cells[r * map().cols + c] : null
        if (name) {
            props.tab.prefab = name
            props.tab.layer = i
            return
        }
    }
}

function placeObject(c: number, r: number) {
    if (!inBounds(map(), c, r) || !requirePrefab()) return
    touch()
    const object: NeoMapObjectFile = {
        name: uniqueObjectName(map(), props.tab.prefab!),
        prefab: props.tab.prefab!,
        position: { x: c * cs().x, y: r * cs().y },
    }
    map().objects.push(object)
    props.tab.selection = { kind: 'object', index: map().objects.length - 1 }
}

const onRuler = (p: Vec2) => p.x < RULER || p.y < RULER

function onPointerDown(e: PointerEvent) {
    const p = local(e)
    if (onRuler(p)) return
    canvas.value!.setPointerCapture(e.pointerId)
    checkpointed = false
    const w = toWorld(p)
    const { c, r } = cellOf(w)
    const tool = props.tab.tool

    if (e.button === 1 || (e.button === 0 && spaceDown)) {
        drag = { kind: 'pan', x: p.x, y: p.y }
        return
    }

    // move tool: drag the floating block, or lift the selection when grabbing one of its cells
    if (tool === 'move') {
        if (e.button !== 0) return
        const f = props.tab.floating
        const sel = props.tab.tileSel
        const grab = f
            ? c >= f.x && r >= f.y && c < f.x + f.cols && r < f.y + f.rows
            : inBounds(map(), c, r) && sel?.length === map().cols * map().rows && !!sel[cellIndex(map(), c, r)]
        if (grab) drag = { kind: 'block', c, r }
        return
    }

    // select and object tools: clicking an existing object selects/drags it; object tool places on empty space
    if (tool === 'select' || tool === 'object') {
        if (e.button !== 0) return
        if (tool === 'select') $tabs.dropFloating(props.tab)
        const hit = hitObject(w)
        if (hit >= 0) {
            const pos = map().objects[hit]!.position ?? { x: 0, y: 0 }
            props.tab.selection = { kind: 'object', index: hit }
            drag = { kind: 'object', index: hit, dx: w.x - pos.x, dy: w.y - pos.y }
        }
        else if (tool === 'object') placeObject(c, r)
        else {
            const mode = e.ctrlKey || e.metaKey ? 'remove' : e.shiftKey ? 'add' : 'set'
            const cc = clampCol(c)
            const rr = clampRow(r)
            drag = { kind: 'area', c0: cc, r0: rr, c1: cc, r1: rr, mode, moved: false, inside: inBounds(map(), c, r) }
        }
        schedule()
        return
    }

    if (e.altKey && e.button === 0) {
        if (inBounds(map(), c, r)) pickCell(c, r)
        return
    }
    const erase = tool === 'erase' || e.button === 2 || (tool === 'rect' && e.shiftKey)
    if (!erase && !requirePrefab()) return
    if (tool === 'rect') drag = { kind: 'rect', c0: c, r0: r, c1: c, r1: r, erase }
    else {
        drag = { kind: 'paint', value: erase ? null : props.tab.prefab, last: w }
        setCell(c, r, drag.value)
    }
    schedule()
}

function onPointerMove(e: PointerEvent) {
    const p = local(e)
    const w = toWorld(p)
    const cell = cellOf(w)
    hoverCell.value = inBounds(map(), cell.c, cell.r) && (drag || !onRuler(p)) ? cell : null
    hoverWorld.value = { x: Math.round(w.x), y: Math.round(w.y) }

    if (drag?.kind === 'pan') {
        pan.x += p.x - drag.x
        pan.y += p.y - drag.y
        drag.x = p.x
        drag.y = p.y
    }
    else if (drag?.kind === 'paint') {
        for (const { c, r } of cellsAlongLine(drag.last, w, cs())) setCell(c, r, drag.value)
        drag.last = w
    }
    else if (drag?.kind === 'rect') {
        drag.c1 = clampCol(cell.c)
        drag.r1 = clampRow(cell.r)
    }
    else if (drag?.kind === 'area') {
        drag.c1 = clampCol(cell.c)
        drag.r1 = clampRow(cell.r)
        drag.moved ||= drag.c1 !== drag.c0 || drag.r1 !== drag.r0
    }
    else if (drag?.kind === 'block') {
        const dc = cell.c - drag.c
        const dr = cell.r - drag.r
        // lift lazily, so a click on the selection without moving changes nothing
        if ((dc || dr) && (props.tab.floating || $tabs.liftTiles(props.tab))) {
            props.tab.floating!.x += dc
            props.tab.floating!.y += dr
            drag.c = cell.c
            drag.r = cell.r
        }
    }
    else if (drag?.kind === 'object') {
        const o = map().objects[drag.index]
        if (o) {
            const { x: cw, y: ch } = cs()
            const x = e.shiftKey ? Math.round(w.x - drag.dx) : Math.round((w.x - drag.dx) / cw) * cw
            const y = e.shiftKey ? Math.round(w.y - drag.dy) : Math.round((w.y - drag.dy) / ch) * ch
            if (x !== (o.position?.x ?? 0) || y !== (o.position?.y ?? 0)) {
                touch()
                o.position = { x, y }
            }
        }
    }
    schedule()
}

function onPointerUp() {
    if (drag?.kind === 'rect') {
        const layer = map().layers[props.tab.layer]
        if (layer) {
            touch()
            fillRect(map(), layer, drag.c0, drag.r0, drag.c1, drag.r1, drag.erase ? null : props.tab.prefab)
        }
    }
    else if (drag?.kind === 'area') {
        const { c0, r0, c1, r1, mode } = drag
        if (!drag.moved && !drag.inside) {
            // click outside the map: plain click clears, modified clicks change nothing
            if (mode === 'set') {
                props.tab.tileSel = null
                props.tab.selection = { kind: 'map' }
            }
        }
        else {
            const mask = maskRect(map(), mode === 'set' ? null : props.tab.tileSel, c0, r0, c1, r1, mode === 'remove' ? 0 : 1)
            props.tab.tileSel = mask.some(Boolean) ? mask : null
            if (!drag.moved) props.tab.selection = { kind: 'cell', col: c0, row: r0 }
        }
    }
    else if (drag?.kind === 'block') $tabs.dropFloating(props.tab)
    drag = null
    schedule()
}

function onPointerLeave() {
    hoverCell.value = null
    hoverWorld.value = null
    schedule()
}

function onWheel(e: WheelEvent) {
    const p = local(e)
    if (e.ctrlKey || e.metaKey) zoomAt(p.x, p.y, e.deltaY < 0 ? 1.2 : 1 / 1.2)
    else {
        pan.x -= e.shiftKey ? (e.deltaX || e.deltaY) : e.deltaX
        pan.y -= e.shiftKey ? 0 : e.deltaY
        schedule()
    }
}

// right-click: object menu over an object, tile menu over the tile selection (select/move tools); paint tools erase
// on pointerdown instead, so they get no menu
function onContextMenu(e: MouseEvent) {
    const p = local(e)
    const tool = props.tab.tool
    const w = toWorld(p)
    const hit = !onRuler(p) && (tool === 'select' || tool === 'object') ? hitObject(w) : -1
    if (hit >= 0) {
        contextTarget.value = { kind: 'object', index: hit }
        props.tab.selection = { kind: 'object', index: hit }
    }
    else contextTarget.value = !onRuler(p) && (tool === 'select' || tool === 'move') ? { kind: 'tiles' } : null
    if (!contextTarget.value) e.preventDefault()
}

defineShortcuts({
    escape: () => {
        if (props.tab.tool !== 'select' && props.tab.tool !== 'move') return
        if (props.tab.floating) $tabs.cancelFloating(props.tab)
        else props.tab.tileSel = null
    },
    enter: () => $tabs.dropFloating(props.tab),
})

// floating tiles land when the user moves on to another tool or layer (paste switches *to* move, so keep those)
watch(() => props.tab.tool, tool => tool !== 'move' && $tabs.dropFloating(props.tab))
watch(() => props.tab.layer, () => $tabs.dropFloating(props.tab))

const contextItems = computed<ContextMenuItem[][]>(() => {
    const t = contextTarget.value
    if (t?.kind === 'object') return [[
        { label: 'Duplicate', icon: 'i-lucide-copy', onSelect: () => $tabs.duplicateObject(props.tab, t.index) },
        { label: 'Delete', icon: 'i-lucide-trash', color: 'error', kbds: ['delete'], onSelect: () => $tabs.deleteObject(props.tab, t.index) },
    ]]
    if (t?.kind !== 'tiles') return []
    const item = (id: string, icon: string): ContextMenuItem => {
        const cmd = commands.find(c => c.id === id)!
        return { label: cmd.label, icon, kbds: cmd.kbds, disabled: !(cmd.enabled?.() ?? true), onSelect: () => cmd.run() }
    }
    const sel = !!props.tab.tileSel?.some(Boolean) || !!props.tab.floating
    return [
        [item('cut', 'i-lucide-scissors'), item('copy', 'i-lucide-copy'), item('paste', 'i-lucide-clipboard-paste'), { ...item('delete', 'i-lucide-trash'), color: 'error' }],
        [
            item('selectAll', 'i-lucide-scan'),
            { label: 'Clear selection', icon: 'i-lucide-x', kbds: ['escape'], disabled: !sel, onSelect: () => props.tab.floating ? $tabs.cancelFloating(props.tab) : props.tab.tileSel = null },
        ],
    ]
})

useEventListener(window, 'keydown', (e: KeyboardEvent) => {
    if (e.code !== 'Space' || isTyping()) return
    e.preventDefault()
    spaceDown = true
})
useEventListener(window, 'keyup', (e: KeyboardEvent) => {
    if (e.code === 'Space') spaceDown = false
})

watch(() => [props.tab, props.prefabs, highlight.value, legends.value, colliderBoxes.value, colliderSpecs.value, looks.value], schedule, { deep: true })

onBeforeUnmount(() => {
    unmounted = true
    cancelAnimationFrame(frame)
    for (const url of blobUrls) URL.revokeObjectURL(url)
})

const layerName = computed(() => props.tab.map.layers[props.tab.layer]?.name ?? '—')
</script>

<template>
    <div ref="container" class="overflow-hidden">
        <UContextMenu :items="contextItems">
            <div class="absolute inset-0">
                <canvas
                    ref="canvas"
                    class="block size-full touch-none select-none"
                    :style="{ cursor: tab.tool === 'select' ? 'default' : tab.tool === 'move' ? 'move' : 'crosshair' }"
                    @pointerdown="onPointerDown"
                    @pointermove="onPointerMove"
                    @pointerup="onPointerUp"
                    @pointercancel="onPointerUp"
                    @pointerleave="onPointerLeave"
                    @wheel.prevent="onWheel"
                    @contextmenu="onContextMenu"
                />
            </div>
        </UContextMenu>

        <div class="pointer-events-none absolute bottom-2 left-2 rounded-md bg-elevated/80 px-2 py-1 text-[11px] leading-tight text-muted shadow-sm backdrop-blur-sm">
            <span v-if="hoverCell">cell ({{ hoverCell.c }}, {{ hoverCell.r }})</span>
            <span v-else-if="tab.selection.kind === 'cell'">cell ({{ tab.selection.col }}, {{ tab.selection.row }})</span>
            <span v-else>—</span>
            <span v-if="hoverWorld"> · {{ hoverWorld.x }}, {{ hoverWorld.y }} px</span>
            <span> · {{ tab.tool }}</span>
            <span> · layer {{ layerName }}</span>
            <span> · prefab {{ tab.prefab ?? 'none' }}</span>
            <span> · {{ colliderBoxes.reduce((n, b) => n + b.shapes.length, 0) + colliderSpecs.length }} colliders</span>
            <span v-if="selBounds"> · {{ selBounds.cols }}×{{ selBounds.rows }} cells · {{ selBounds.cols * tab.map.cellSize.x }}×{{ selBounds.rows * tab.map.cellSize.y }} px</span>
            <div v-if="tab.showColliders && usedGroups.length" class="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5">
                <span v-for="g in usedGroups" :key="g" class="flex items-center gap-1">
                    <span class="size-2 rounded-full" :style="{ background: groupColor[g] }" />{{ g }}
                </span>
            </div>
        </div>
    </div>
</template>
