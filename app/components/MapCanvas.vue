<script setup lang="ts">
import type { ContextMenuItem } from '@nuxt/ui'
import type { NeoMapObjectFile, NeoPrefab, NeoSchemaFile, Vec2 } from '#shared/types/neo'

// Plain Canvas 2D, same approach as the reference mockup: one draw() renders everything under a single
// world->screen transform, so selection, hover and previews always follow pan/zoom.

const props = defineProps<{ tab: MapTab, prefabs: Record<string, NeoPrefab>, schema: NeoSchemaFile, highlight: string }>()

const $tabs = useAppTabs()
const project = useProject()
const toast = useToast()

const VIEW_BG = '#2b2d33'
const MAP_BG = '#1f2126'
const OTHER_LAYER_ALPHA = 0.6

const container = ref<HTMLDivElement>()
const canvas = ref<HTMLCanvasElement>()
const size = { w: 0, h: 0 }
const pan = { x: 0, y: 0 }
let appliedZoom = props.tab.zoom
let fitted = false
let spaceDown = false

const hoverCell = ref<{ c: number, r: number } | null>(null)
const hoverWorld = ref<Vec2 | null>(null)
const contextTarget = ref<number | null>(null)

type Drag =
    | { kind: 'pan', x: number, y: number }
    | { kind: 'paint', value: string | null, last: Vec2 }
    | { kind: 'rect', c0: number, r0: number, c1: number, r1: number, erase: boolean }
    | { kind: 'object', index: number, dx: number, dy: number }
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

const colliderBoxes = computed(() => mergeColliders(props.tab.map, props.prefabs))
const legends = computed(() => {
    try { return layerLegends(props.tab.map) }
    catch { return [] }
})
const looks = computed(() => new Map(Object.entries(props.prefabs).map(([name, prefab]) => {
    const key = previewAsset(props.schema, prefab.specs) ?? null
    return [name, { key, color: colorOf(name, key) }]
})))

// ---- textures: content images as blob URLs; null = loading or no preview ----
const textures = new Map<string, HTMLImageElement | null>()
const blobUrls: string[] = []
let unmounted = false

function texture(key: string): HTMLImageElement | null {
    if (textures.has(key)) return textures.get(key) ?? null
    textures.set(key, null)
    project.assetUrl(key).then((url) => {
        if (!url || unmounted) return
        blobUrls.push(url)
        const img = new Image()
        img.onload = () => {
            textures.set(key, img)
            schedule()
        }
        img.src = url
    })
    return null
}

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
    const img = look.key ? texture(look.key) : null
    if (img) ctx.drawImage(img, x, y, w, h)
    else {
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

    // tiles; layers other than the current one are dimmed
    m.layers.forEach((layer, li) => {
        if (!layer.visible) return
        ctx.globalAlpha = li === props.tab.layer ? 1 : OTHER_LAYER_ALPHA
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
        ctx.fillStyle = 'rgba(255,92,122,.12)'
        ctx.strokeStyle = 'rgba(255,92,122,.85)'
        for (const b of colliderBoxes.value) {
            ctx.fillRect(b.col * cw, b.row * ch, b.width * cw, b.height * ch)
            ctx.strokeRect(b.col * cw + px, b.row * ch + px, b.width * cw - 2 * px, b.height * ch - 2 * px)
        }
    }

    if (props.tab.showObjects) {
        const rad = Math.min(cw, ch) * 0.32
        m.objects.forEach((o, i) => {
            const x = (o.position?.x ?? 0) + cw / 2
            const y = (o.position?.y ?? 0) + ch / 2
            const selected = props.tab.selection.kind === 'object' && props.tab.selection.index === i
            const look = o.prefab ? looks.value.get(o.prefab) : undefined
            const img = look?.key ? texture(look.key) : null
            if (img) ctx.drawImage(img, x - cw / 2, y - ch / 2, cw, ch)

            ctx.beginPath()
            ctx.moveTo(x, y - rad); ctx.lineTo(x + rad, y); ctx.lineTo(x, y + rad); ctx.lineTo(x - rad, y); ctx.closePath()
            ctx.fillStyle = look?.color ?? '#ff00ff'
            ctx.fill()
            ctx.lineWidth = (selected ? 3 : 1.5) * px
            ctx.strokeStyle = selected ? props.highlight : '#ffffff'
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
            ctx.fillStyle = selected ? props.highlight : '#dddddd'
            ctx.fillText(label, x, y + rad + 5 * px)
        })
    }

    ctx.strokeStyle = props.highlight
    if (drag?.kind === 'rect') {
        const { c0, r0, c1, r1, erase } = drag
        ctx.setLineDash([6 * px, 4 * px])
        ctx.lineWidth = 2 * px
        ctx.strokeStyle = erase ? '#ff6b6b' : props.highlight
        ctx.strokeRect(Math.min(c0, c1) * cw + px, Math.min(r0, r1) * ch + px, (Math.abs(c1 - c0) + 1) * cw - 2 * px, (Math.abs(r1 - r0) + 1) * ch - 2 * px)
        ctx.setLineDash([])
    }
    else if (hoverCell.value && props.tab.tool !== 'select') {
        ctx.lineWidth = 1.5 * px
        ctx.strokeRect(hoverCell.value.c * cw + px, hoverCell.value.r * ch + px, cw - 2 * px, ch - 2 * px)
    }
    const sel = props.tab.selection
    if (sel.kind === 'cell' && inBounds(m, sel.col, sel.row)) {
        ctx.setLineDash([4 * px, 3 * px])
        ctx.lineWidth = 2 * px
        ctx.strokeStyle = props.highlight
        ctx.strokeRect(sel.col * cw + px, sel.row * ch + px, cw - 2 * px, ch - 2 * px)
        ctx.setLineDash([])
    }
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

function fit() {
    const { x: cw, y: ch } = cs()
    const z = Math.min(8, Math.max(0.1, Math.min((size.w - 96) / (map().cols * cw), (size.h - 96) / (map().rows * ch))))
    pan.x = (size.w - map().cols * cw * z) / 2
    pan.y = (size.h - map().rows * ch * z) / 2
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

function onPointerDown(e: PointerEvent) {
    canvas.value!.setPointerCapture(e.pointerId)
    checkpointed = false
    const p = local(e)
    const w = toWorld(p)
    const { c, r } = cellOf(w)
    const tool = props.tab.tool

    if (e.button === 1 || (e.button === 0 && spaceDown)) {
        drag = { kind: 'pan', x: p.x, y: p.y }
        return
    }

    // select and object tools: clicking an existing object selects/drags it; object tool places on empty space
    if (tool === 'select' || tool === 'object') {
        if (e.button !== 0) return
        const hit = hitObject(w)
        if (hit >= 0) {
            const pos = map().objects[hit]!.position ?? { x: 0, y: 0 }
            props.tab.selection = { kind: 'object', index: hit }
            drag = { kind: 'object', index: hit, dx: w.x - pos.x, dy: w.y - pos.y }
        }
        else if (tool === 'object') placeObject(c, r)
        else props.tab.selection = inBounds(map(), c, r) ? { kind: 'cell', col: c, row: r } : { kind: 'map' }
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
    hoverCell.value = inBounds(map(), cell.c, cell.r) ? cell : null
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
        drag.c1 = Math.max(0, Math.min(map().cols - 1, cell.c))
        drag.r1 = Math.max(0, Math.min(map().rows - 1, cell.r))
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

// right-click: object menu in select/object tools, erase in paint tools (handled on pointerdown)
function onContextMenu(e: MouseEvent) {
    const hit = props.tab.tool === 'select' || props.tab.tool === 'object' ? hitObject(toWorld(local(e))) : -1
    contextTarget.value = hit >= 0 ? hit : null
    if (hit >= 0) props.tab.selection = { kind: 'object', index: hit }
    else e.preventDefault()
}

function duplicateObject(index: number) {
    const source = map().objects[index]
    if (!source) return
    $tabs.checkpoint(props.tab)
    const clone = deepClone(source)
    clone.name = uniqueObjectName(map(), clone.prefab ?? 'Object')
    map().objects.splice(index + 1, 0, clone)
    props.tab.selection = { kind: 'object', index: index + 1 }
}

function deleteObject(index: number) {
    if (!map().objects[index]) return
    $tabs.checkpoint(props.tab)
    map().objects.splice(index, 1)
    props.tab.selection = { kind: 'map' }
}

defineShortcuts({
    delete: () => props.tab.selection.kind === 'object' && deleteObject(props.tab.selection.index),
    backspace: () => props.tab.selection.kind === 'object' && deleteObject(props.tab.selection.index),
})

const contextItems = computed<ContextMenuItem[]>(() => {
    const index = contextTarget.value
    if (index === null) return []
    return [
        { label: 'Duplicate', icon: 'i-lucide-copy', onSelect: () => duplicateObject(index) },
        { label: 'Delete', icon: 'i-lucide-trash', color: 'error', onSelect: () => deleteObject(index) },
    ]
})

const isTyping = () => {
    const el = document.activeElement
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)
}
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
    if (e.code !== 'Space' || isTyping()) return
    e.preventDefault()
    spaceDown = true
})
useEventListener(window, 'keyup', (e: KeyboardEvent) => {
    if (e.code === 'Space') spaceDown = false
})

watch(() => [props.tab, props.prefabs, props.highlight, legends.value, colliderBoxes.value, looks.value], schedule, { deep: true })

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
                    :style="{ cursor: tab.tool === 'select' ? 'default' : 'crosshair' }"
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
            <span> · {{ colliderBoxes.length }} colliders</span>
        </div>
    </div>
</template>
