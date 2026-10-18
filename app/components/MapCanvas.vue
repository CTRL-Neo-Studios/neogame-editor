<script setup lang="ts">
import { Application, Assets, Container, Graphics, Sprite, Text, loadTextures } from 'pixi.js'
import type { Texture } from 'pixi.js'
import type { ContextMenuItem } from '@nuxt/ui'

const props = defineProps<{ tab: MapTab, prefabs: Record<string, NeoPrefab>, schema: NeoSchemaFile }>()

const $tabs = useAppTabs()
const project = useProject()
const colorMode = useColorMode()
const toast = useToast()

const container = ref<HTMLDivElement>()
let app: Application | null = null
let destroyed = false

// Camera. World coordinates are map pixels (col * cellSize); screen = world * zoom + pan.
const pan = { x: 0, y: 0 }
let world: Container | null = null
let layerContainers: Container[] = []
let gridG: Graphics | null = null
let collidersG: Graphics | null = null
let objectsC: Container | null = null
let overlayG: Graphics | null = null

let primaryColor = 0xffffff

// Interaction state (mirrors the mockup's `ui` object).
let downButton = -1
let lastSample: { x: number, y: number } | null = null
let lastPainted = -1
let rect: { c0: number, r0: number, c1: number, r1: number, erase: boolean } | null = null
let panStart: { x: number, y: number } | null = null
let dragObject = -1
let dragOffset: { x: number, y: number } = { x: 0, y: 0 }
let spaceDown = false

const hoverCell = ref<{ c: number, r: number } | null>(null)
const hoverWorld = ref<{ x: number, y: number } | null>(null)
const colliderBoxes = ref<ColliderBox[]>([])
const contextTarget = ref<number | null>(null)
const menuOpen = ref(false)

// Texture cache keyed by asset path; null caches "no preview available" so we don't re-request every rebuild.
const textureCache = new Map<string, Texture | null>()
const blobUrls = new Set<string>()

const cellX = () => props.tab.map.cellSize.x
const cellY = () => props.tab.map.cellSize.y

function colorFor(prefabName: string): string {
    const prefab = props.prefabs[prefabName]
    if (!prefab) return '#ff00ff'
    return colorOf(prefabName, previewAsset(props.schema, prefab.specs) ?? null)
}

function textureKeyOf(prefabName: string): string | null {
    const prefab = props.prefabs[prefabName]
    return prefab ? previewAsset(props.schema, prefab.specs) ?? null : null
}

async function ensureTexture(key: string): Promise<Texture | null> {
    if (textureCache.has(key)) return textureCache.get(key) ?? null
    const url = await project.assetUrl(key)
    if (url) blobUrls.add(url)
    try {
        const texture = url ? await Assets.load<Texture>({ src: url, loadParser: 'loadTextures' }) : null
        const valid = texture && texture.width > 0 && texture.height > 0 ? texture : null
        textureCache.set(key, valid)
        if (valid) scheduleRebuild()
        return valid
    }
    catch {
        textureCache.set(key, null)
        return null
    }
}

function buildCell(prefabName: string, c: number, r: number): Container {
    const key = textureKeyOf(prefabName)
    const texture = key ? textureCache.get(key) : undefined
    if (texture) return buildSprite(texture, c * cellX(), r * cellY())
    const cell = new Container()
    const g = new Graphics()
    if (!props.prefabs[prefabName]) {
        g.rect(1, 1, cellX() - 2, cellY() - 2).fill('#ff00ff').stroke({ width: 1, color: '#ff88ff' })
    }
    else {
        g.rect(0, 0, cellX(), cellY()).fill(colorFor(prefabName))
        g.rect(0.5, 0.5, cellX() - 1, cellY() - 1).stroke({ width: 1, color: 0xffffff, alpha: 0.12 })
    }
    cell.addChild(g)
    cell.position.set(c * cellX(), r * cellY())
    if (key && !textureCache.has(key)) void ensureTexture(key)
    return cell
}

function buildSprite(texture: Texture, x: number, y: number): Container {
    const holder = new Container()
    const sprite = new Sprite(texture)
    sprite.scale.set(cellX() / texture.width, cellY() / texture.height)
    holder.addChild(sprite)
    holder.position.set(x, y)
    return holder
}

function buildLayer(layer: EditorLayer): Container {
    const holder = new Container()
    const cells = layer.cells
    for (let r = 0; r < props.tab.map.rows; r++) {
        for (let c = 0; c < props.tab.map.cols; c++) {
            const name = cells[r * props.tab.map.cols + c]
            if (name) holder.addChild(buildCell(name, c, r))
        }
    }
    holder.visible = layer.visible
    return holder
}

function drawGrid() {
    gridG?.clear()
    if (!gridG) return
    const cols = props.tab.map.cols
    const rows = props.tab.map.rows
    const w = cols * cellX()
    const h = rows * cellY()
    const g = gridG
    for (let c = 0; c <= cols; c++) {
        const x = c * cellX() + 0.5
        g.moveTo(x, 0).lineTo(x, h)
    }
    for (let r = 0; r <= rows; r++) {
        const y = r * cellY() + 0.5
        g.moveTo(0, y).lineTo(w, y)
    }
    g.stroke({ width: 1 / (props.tab.zoom || 1), color: 0xffffff, alpha: 0.06 })
}

function drawColliders() {
    collidersG?.clear()
    if (!collidersG) return
    for (const box of colliderBoxes.value) {
        const x = box.col * cellX()
        const y = box.row * cellY()
        const w = box.width * cellX()
        const h = box.height * cellY()
        collidersG.rect(x, y, w, h).fill({ color: 0xff5c7a, alpha: 0.12 })
        collidersG.rect(x + 1, y + 1, w - 2, h - 2).stroke({ width: 2 / (props.tab.zoom || 1), color: 0xff5c7a, alpha: 0.85 })
    }
}

function buildObjectDiamond(index: number): Container {
    const object = props.tab.map.objects[index]!
    const x = (object.position?.x ?? 0) + cellX() / 2
    const y = (object.position?.y ?? 0) + cellY() / 2
    const rad = Math.min(cellX(), cellY()) * 0.32

    const holder = new Container()

    const key = object.prefab ? textureKeyOf(object.prefab) : null
    const texture = key ? textureCache.get(key) : undefined
    if (texture) {
        const sprite = new Sprite(texture)
        sprite.scale.set(cellX() / texture.width, cellY() / texture.height)
        holder.addChild(sprite)
    }

    const diamond = new Graphics()
    diamond.moveTo(x, y - rad).lineTo(x + rad, y).lineTo(x, y + rad).lineTo(x - rad, y).closePath()
    const selected = props.tab.selection.kind === 'object' && props.tab.selection.index === index
    diamond.fill(colorFor(object.prefab ?? ''))
    if (selected) {
        diamond.stroke({ width: 3 / (props.tab.zoom || 1), color: primaryColor })
        const halo = new Graphics()
        halo.moveTo(x, y - rad - 4).lineTo(x + rad + 4, y).lineTo(x, y + rad + 4).lineTo(x - rad - 4, y).closePath()
        halo.stroke({ width: 1.5 / (props.tab.zoom || 1), color: primaryColor, alpha: 0.5 })
        holder.addChild(halo)
    }
    else {
        diamond.stroke({ width: 1.5 / (props.tab.zoom || 1), color: 0xffffff })
    }
    holder.addChild(diamond)

    const name = object.name ?? `Object-${index + 1}`
    const label = new Text({ text: name, style: { fontSize: 9, fill: 0xdddddd, fontFamily: 'Segoe UI, system-ui, sans-serif' } })
    label.anchor.set(0.5, 0)
    label.position.set(x, y + rad + 4)
    const bg = new Graphics()
    bg.roundRect(label.x - label.width / 2 - 4, label.y, label.width + 8, label.height + 2, 3).fill({ color: 0x000000, alpha: 0.7 })
    holder.addChild(bg)
    holder.addChild(label)

    if (key && !textureCache.has(key)) void ensureTexture(key)
    return holder
}

function redrawObjects() {
    if (!objectsC) return
    for (const child of objectsC.removeChildren()) child.destroy({ children: true })
    for (let i = 0; i < props.tab.map.objects.length; i++) objectsC.addChild(buildObjectDiamond(i))
    objectsC.visible = props.tab.showObjects
}

function drawOverlay() {
    overlayG?.clear()
    if (!overlayG) return
    const g = overlayG
    const csx = cellX()
    const csy = cellY()

    if (props.tab.tool !== 'select' && hoverCell.value && inBounds(props.tab.map, hoverCell.value.c, hoverCell.value.r)) {
        g.rect(hoverCell.value.c * csx + 1, hoverCell.value.r * csy + 1, csx - 2, csy - 2)
            .stroke({ width: 1, color: primaryColor, alpha: 0.9 })
    }

    if (rect) {
        const x0 = Math.min(rect.c0, rect.c1) * csx + 1
        const y0 = Math.min(rect.r0, rect.r1) * csy + 1
        const w = (Math.abs(rect.c1 - rect.c0) + 1) * csx - 2
        const h = (Math.abs(rect.r1 - rect.r0) + 1) * csy - 2
        g.setStrokeStyle({ width: 2, color: rect.erase ? 0xff6b6b : primaryColor, alpha: 0.9 })
        g.rect(x0, y0, w, h).stroke()
        g.setStrokeStyle({ width: 2, color: 0xffffff })
    }

    if (props.tab.selection.kind === 'cell') {
        const { col, row } = props.tab.selection
        if (inBounds(props.tab.map, col, row)) {
            g.setStrokeStyle({ width: 1.5, color: 0xffffff, alpha: 0.9 })
            g.rect(col * csx + 1, row * csy + 1, csx - 2, csy - 2).stroke()
            g.setStrokeStyle({ width: 1.5, color: 0xffffff })
        }
    }
}

function rebuildLayer(index: number) {
    const holder = layerContainers[index]
    if (!holder) return
    for (const child of holder.removeChildren()) child.destroy({ children: true })
    const built = buildLayer(props.tab.map.layers[index]!)
    for (const child of [...built.children]) holder.addChild(child)
    built.destroy()
    holder.visible = props.tab.map.layers[index]!.visible
}

// Full rebuild of every painted layer per change. Maps are a few hundred cells, so this is comfortably cheap;
// ponytail: if maps grow into the thousands of cells, dirty-cell diffing is the upgrade path.
function rebuildMap() {
    if (destroyed || !app) return
    colliderBoxes.value = mergeColliders(props.tab.map, props.prefabs)
    drawGrid()
    drawColliders()
    for (let i = 0; i < layerContainers.length; i++) rebuildLayer(i)
    redrawObjects()
    drawOverlay()
}

function applyTransform() {
    if (!world) return
    world.scale.set(props.tab.zoom)
    world.position.set(pan.x, pan.y)
    drawGrid()
    drawColliders()
    redrawObjects()
    drawOverlay()
}

function zoomToCenter(oldZoom: number, newZoom: number) {
    if (!app) return
    const z = Math.min(8, Math.max(0.1, newZoom))
    const cx = app.screen.width / 2
    const cy = app.screen.height / 2
    const wx = (cx - pan.x) / oldZoom
    const wy = (cy - pan.y) / oldZoom
    pan.x = cx - wx * z
    pan.y = cy - wy * z
    skipZoomWatch = true
    props.tab.zoom = z
    applyTransform()
}

function zoomAt(screenX: number, screenY: number, factor: number) {
    if (!app) return
    const z = Math.min(8, Math.max(0.1, props.tab.zoom * factor))
    const wx = (screenX - pan.x) / props.tab.zoom
    const wy = (screenY - pan.y) / props.tab.zoom
    pan.x = screenX - wx * z
    pan.y = screenY - wy * z
    skipZoomWatch = true
    props.tab.zoom = z
    applyTransform()
}

function fitMap() {
    if (!app || app.screen.width <= 0 || app.screen.height <= 0) return
    const pad = 48
    const aw = Math.max(1, app.screen.width - pad * 2)
    const ah = Math.max(1, app.screen.height - pad * 2)
    const z = Math.min(8, Math.max(0.1, Math.min(aw / (props.tab.map.cols * cellX()), ah / (props.tab.map.rows * cellY()))))
    pan.x = (app.screen.width - props.tab.map.cols * cellX() * z) / 2
    pan.y = (app.screen.height - props.tab.map.rows * cellY() * z) / 2
    skipZoomWatch = true
    props.tab.zoom = z
    applyTransform()
}

let skipZoomWatch = false

function scheduleRebuild() {
    if (raPending || destroyed) return
    raPending = true
    requestAnimationFrame(() => {
        raPending = false
        rebuildMap()
    })
}

let raPending = false

function applyBackground() {
    if (!app || !container.value) return
    const css = getComputedStyle(container.value).getPropertyValue('--ui-bg-muted').trim()
    const color = css ? parseHexColor(css) : 0x111318
    primaryColor = parseHexColor(getComputedStyle(container.value).getPropertyValue('--ui-primary').trim() || '#ffffff')
    app.renderer.background.color = color
    app.renderer.background.alpha = 1
}

function screenPoint(e: MouseEvent): { x: number, y: number } {
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function cellAt(e: MouseEvent): { c: number, r: number } {
    const p = screenPoint(e)
    return { c: Math.floor((p.x - pan.x) / (props.tab.zoom * cellX())), r: Math.floor((p.y - pan.y) / (props.tab.zoom * cellY())) }
}

function hitObjectAt(e: MouseEvent): number {
    if (!props.tab.showObjects) return -1
    const p = screenPoint(e)
    const threshold = props.tab.zoom * Math.min(cellX(), cellY()) * 0.4
    for (let i = props.tab.map.objects.length - 1; i >= 0; i--) {
        const o = props.tab.map.objects[i]!
        const cx = ((o.position?.x ?? 0) + cellX() / 2) * props.tab.zoom + pan.x
        const cy = ((o.position?.y ?? 0) + cellY() / 2) * props.tab.zoom + pan.y
        if (Math.hypot(p.x - cx, p.y - cy) < threshold) return i
    }
    return -1
}

function requirePrefab(): boolean {
    if (props.tab.prefab) return true
    toast.add({ title: 'Pick a prefab first', description: 'Choose a prefab in the sidebar, then paint or place it.', color: 'warning', icon: 'i-lucide-paintbrush', duration: 2500 })
    return false
}

function paintCell(c: number, r: number, value: string | null) {
    if (!inBounds(props.tab.map, c, r)) return
    const layer = props.tab.map.layers[props.tab.layer]
    if (!layer) return
    layer.cells[r * props.tab.map.cols + c] = value
}

function paintSample(sx: number, sy: number) {
    const c = Math.floor((sx - pan.x) / (props.tab.zoom * cellX()))
    const r = Math.floor((sy - pan.y) / (props.tab.zoom * cellY()))
    const value = (props.tab.tool === 'erase' || downButton === 2) ? null : props.tab.prefab
    paintCell(c, r, value)
    lastPainted = r * props.tab.map.cols + c
}

function paintAlong(a: { x: number, y: number }, b: { x: number, y: number }) {
    const cells = cellsAlongLine(a, b, { x: props.tab.zoom * cellX(), y: props.tab.zoom * cellY() })
    const value = (props.tab.tool === 'erase' || downButton === 2) ? null : props.tab.prefab
    for (const cell of cells) {
        const idx = cell.r * props.tab.map.cols + cell.c
        if (idx === lastPainted) continue
        paintCell(cell.c, cell.r, value)
        lastPainted = idx
    }
}

function pickCell(c: number, r: number) {
    for (let i = props.tab.map.layers.length - 1; i >= 0; i--) {
        const layer = props.tab.map.layers[i]!
        if (!layer.visible) continue
        const name = layer.cells[r * props.tab.map.cols + c]
        if (name) {
            props.tab.prefab = name
            props.tab.layer = i
            return
        }
    }
}

function updateHover(e: MouseEvent) {
    const p = screenPoint(e)
    const c = Math.floor((p.x - pan.x) / (props.tab.zoom * cellX()))
    const r = Math.floor((p.y - pan.y) / (props.tab.zoom * cellY()))
    hoverCell.value = inBounds(props.tab.map, c, r) ? { c, r } : null
    hoverWorld.value = { x: Math.round((p.x - pan.x) / props.tab.zoom), y: Math.round((p.y - pan.y) / props.tab.zoom) }
}

function onPointerDown(e: PointerEvent) {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    downButton = e.button
    const p = screenPoint(e)

    if (e.button === 1 || (e.button === 0 && spaceDown)) {
        panStart = { x: p.x, y: p.y }
        return
    }

    const cell = cellAt(e)

    if (props.tab.tool === 'select') {
        if (e.button === 2) return
        const hit = hitObjectAt(e)
        if (hit >= 0) {
            dragObject = hit
            const o = props.tab.map.objects[hit]!
            const wx = (p.x - pan.x) / props.tab.zoom
            const wy = (p.y - pan.y) / props.tab.zoom
            dragOffset = { x: wx - (o.position?.x ?? 0), y: wy - (o.position?.y ?? 0) }
            props.tab.selection = { kind: 'object', index: hit }
            $tabs.checkpoint(props.tab)
        }
        else if (inBounds(props.tab.map, cell.c, cell.r)) {
            props.tab.selection = { kind: 'cell', col: cell.c, row: cell.r }
        }
        else {
            props.tab.selection = { kind: 'map' }
        }
        drawOverlay()
        redrawObjects()
        return
    }

    if (props.tab.tool === 'brush' || props.tab.tool === 'erase') {
        if (e.altKey && e.button === 0) {
            if (inBounds(props.tab.map, cell.c, cell.r)) pickCell(cell.c, cell.r)
            return
        }
        if (e.button !== 2 && !requirePrefab()) return
        $tabs.checkpoint(props.tab)
        lastSample = p
        lastPainted = -1
        paintSample(p.x, p.y)
        scheduleRebuild()
        return
    }

    if (props.tab.tool === 'rect') {
        if (!requirePrefab()) return
        $tabs.checkpoint(props.tab)
        rect = { c0: cell.c, r0: cell.r, c1: cell.c, r1: cell.r, erase: e.shiftKey || e.button === 2 }
        drawOverlay()
        return
    }

    if (props.tab.tool === 'object') {
        if (!requirePrefab()) return
        if (!inBounds(props.tab.map, cell.c, cell.r)) return
        $tabs.checkpoint(props.tab)
        const object: NeoMapObjectFile = {
            name: uniqueObjectName(props.tab.map, props.tab.prefab!),
            prefab: props.tab.prefab!,
            position: { x: cell.c * cellX(), y: cell.r * cellY() },
        }
        props.tab.map.objects.push(object)
        props.tab.selection = { kind: 'object', index: props.tab.map.objects.length - 1 }
        redrawObjects()
        return
    }
}

function onPointerMove(e: PointerEvent) {
    const p = screenPoint(e)
    updateHover(e)

    if (panStart) {
        pan.x += p.x - panStart.x
        pan.y += p.y - panStart.y
        panStart = p
        applyTransform()
        return
    }

    if (props.tab.tool === 'brush' || props.tab.tool === 'erase') {
        if (downButton >= 0 && lastSample) {
            paintAlong(lastSample, p)
            lastSample = p
            scheduleRebuild()
        }
    }
    else if (rect && downButton >= 0) {
        const cell = cellAt(e)
        rect.c1 = Math.max(0, Math.min(props.tab.map.cols - 1, cell.c))
        rect.r1 = Math.max(0, Math.min(props.tab.map.rows - 1, cell.r))
        drawOverlay()
    }
    else if (dragObject >= 0 && downButton === 0) {
        const o = props.tab.map.objects[dragObject]!
        const wx = (p.x - pan.x) / props.tab.zoom
        const wy = (p.y - pan.y) / props.tab.zoom
        let nx = wx - dragOffset.x
        let ny = wy - dragOffset.y
        if (!e.shiftKey) {
            nx = Math.round(nx / cellX()) * cellX()
            ny = Math.round(ny / cellY()) * cellY()
        }
        else {
            nx = Math.round(nx)
            ny = Math.round(ny)
        }
        o.position = { x: nx, y: ny }
        redrawObjects()
        drawOverlay()
    }
    else {
        drawOverlay()
    }
}

function onPointerUp(e: PointerEvent) {
    if (downButton < 0) return
    if (rect) {
        const layer = props.tab.map.layers[props.tab.layer]
        if (layer) fillRect(props.tab.map, layer, rect.c0, rect.r0, rect.c1, rect.r1, rect.erase ? null : props.tab.prefab)
        rect = null
        scheduleRebuild()
    }
    downButton = -1
    dragObject = -1
    panStart = null
    lastSample = null
    lastPainted = -1
    drawOverlay()
}

function onPointerLeave() {
    hoverCell.value = null
    hoverWorld.value = null
    drawOverlay()
}

function onWheel(e: WheelEvent) {
    e.preventDefault()
    const p = screenPoint(e)
    if (e.ctrlKey || e.metaKey) {
        zoomAt(p.x, p.y, e.deltaY < 0 ? 1.2 : 1 / 1.2)
    }
    else {
        const dx = e.shiftKey ? (e.deltaX || e.deltaY) : e.deltaX
        const dy = e.shiftKey ? 0 : e.deltaY
        pan.x += dx
        pan.y += dy
        applyTransform()
    }
}

function onContextMenu(e: MouseEvent) {
    if (props.tab.tool === 'select') {
        const hit = hitObjectAt(e)
        contextTarget.value = hit >= 0 ? hit : null
        if (hit >= 0) return
    }
    else {
        contextTarget.value = null
    }
    e.preventDefault()
}

function duplicateObject() {
    const index = contextTarget.value
    if (index === null || !props.tab.map.objects[index]) return
    $tabs.checkpoint(props.tab)
    const clone = structuredClone(props.tab.map.objects[index]!)
    clone.name = uniqueObjectName(props.tab.map, clone.prefab ?? 'Object')
    props.tab.map.objects.splice(index + 1, 0, clone)
    props.tab.selection = { kind: 'object', index: index + 1 }
    redrawObjects()
}

function deleteObject(index: number) {
    const object = props.tab.map.objects[index]
    if (!object) return
    $tabs.checkpoint(props.tab)
    props.tab.map.objects.splice(index, 1)
    props.tab.selection = { kind: 'map' }
    redrawObjects()
}

function removeSelectedObject() {
    const active = document.activeElement
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.getAttribute('contenteditable') === 'true')) return
    if (props.tab.selection.kind !== 'object') return
    deleteObject(props.tab.selection.index)
}

defineShortcuts({
    delete: removeSelectedObject,
    backspace: removeSelectedObject,
})

const contextItems = computed<ContextMenuItem[]>(() => {
    if (contextTarget.value === null) return []
    return [
        { label: 'Duplicate', icon: 'i-lucide-copy', onSelect: duplicateObject },
        { label: 'Delete', icon: 'i-lucide-trash', color: 'error', onSelect: () => deleteObject(contextTarget.value!) },
    ]
})

watch(() => props.tab.zoom, (zoom, oldZoom) => {
    if (skipZoomWatch) { skipZoomWatch = false; return }
    zoomToCenter(oldZoom, zoom)
})

watch(() => colorMode.value, () => {
    applyBackground()
    redrawObjects()
    drawOverlay()
})

watch(() => [props.tab.map.layers, props.tab.map.cols, props.tab.map.rows, props.tab.map.cellSize, props.prefabs], () => {
    scheduleRebuild()
}, { deep: true })

watch(() => props.tab.map.objects, () => {
    scheduleRebuild()
}, { deep: true })

watch(() => props.tab.showGrid, (v) => { if (gridG) gridG.visible = v })

watch(() => props.tab.showColliders, (v) => { if (collidersG) collidersG.visible = v })

watch(() => props.tab.showObjects, (v) => { if (objectsC) objectsC.visible = v })

watch(() => props.tab.selection, () => {
    redrawObjects()
    drawOverlay()
}, { deep: true })

function onKeyDown(e: KeyboardEvent) {
    if (e.code !== 'Space' || spaceDown) return
    const active = document.activeElement
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.getAttribute('contenteditable') === 'true')) return
    e.preventDefault()
    spaceDown = true
}

function onKeyUp(e: KeyboardEvent) {
    if (e.code === 'Space') spaceDown = false
}

function setupPixi(appInstance: Application) {
    app = appInstance
    app.canvas.className = 'absolute inset-0 block h-full w-full touch-none select-none'
    app.canvas.style.cursor = 'crosshair'
    container.value!.appendChild(app.canvas)

    world = new Container()
    app.stage.addChild(world)

    const cols = props.tab.map.cols
    const rows = props.tab.map.rows

    const bg = new Graphics()
    bg.rect(0, 0, cols * cellX(), rows * cellY()).fill(0x0d0f13)
    world.addChild(bg)

    layerContainers = props.tab.map.layers.map(() => {
        const c = new Container()
        world!.addChild(c)
        return c
    })

    gridG = new Graphics()
    gridG.visible = props.tab.showGrid
    world.addChild(gridG)

    collidersG = new Graphics()
    collidersG.visible = props.tab.showColliders
    world.addChild(collidersG)

    objectsC = new Container()
    objectsC.visible = props.tab.showObjects
    world.addChild(objectsC)

    overlayG = new Graphics()
    app.stage.addChild(overlayG)

    app.canvas.addEventListener('pointerdown', onPointerDown)
    app.canvas.addEventListener('pointermove', onPointerMove)
    app.canvas.addEventListener('pointerup', onPointerUp)
    app.canvas.addEventListener('pointerleave', onPointerLeave)
    app.canvas.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    applyBackground()
    fitMap()
    rebuildMap()
}

onMounted(async () => {
    const el = container.value
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
    const appInstance = new Application()
    try {
        await appInstance.init({ resizeTo: el, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1, background: 0x111318 })
    }
    catch {
        // The container was likely removed before the app finished initialising.
        appInstance.destroy()
        return
    }
    if (destroyed || !el.isConnected) {
        appInstance.destroy()
        return
    }
    setupPixi(appInstance)
})

onBeforeUnmount(() => {
    destroyed = true
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    for (const url of blobUrls) URL.revokeObjectURL(url)
    blobUrls.clear()
    textureCache.clear()
    app?.destroy(true, { children: true, texture: false })
    app = null
})

const layerName = computed(() => props.tab.map.layers[props.tab.layer]?.name ?? `layer${props.tab.layer + 1}`)
</script>

<template>
    <div>
        <UContextMenu v-model:open="menuOpen" :items="contextItems">
            <div ref="container" class="absolute inset-0 overflow-hidden" />
        </UContextMenu>

        <div class="pointer-events-none absolute bottom-2 left-2 rounded-md bg-elevated/80 px-2 py-1 text-[11px] leading-tight text-muted shadow-sm backdrop-blur-sm">
            <span v-if="hoverCell">cell ({{ hoverCell.c }}, {{ hoverCell.r }})</span>
            <span v-else-if="tab.selection.kind === 'cell'">cell ({{ tab.selection.col }}, {{ tab.selection.row }})</span>
            <span v-else>—</span>
            <span v-if="hoverWorld"> · {{ hoverWorld.x }}, {{ hoverWorld.y }} px</span>
            <span> · {{ tab.tool }}</span>
            <span> · {{ layerName }}</span>
            <span> · {{ colliderBoxes.length }} colliders</span>
        </div>
    </div>
</template>
