<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { NeoPrefab } from '#shared/types/neo'

const props = defineProps<{ tab: MapTab, prefabs: Record<string, NeoPrefab> }>()
const $t = useAppTabs()
// selection/hover outline color on the canvas; white reads on every tile palette
const highlight = useLocalStorage('neo-highlight', '#ffffff')

const tools: { tool: Tool, icon: string, label: string, key: string }[] = [
    { tool: 'select', icon: 'i-lucide-square-dashed-mouse-pointer', label: 'Select tiles / objects — Shift adds, Ctrl removes', key: 'V' },
    { tool: 'move', icon: 'i-lucide-move', label: 'Move selected tiles', key: 'M' },
    { tool: 'brush', icon: 'i-lucide-paintbrush', label: 'Brush — right-click erases, Alt+click picks', key: 'B' },
    { tool: 'rect', icon: 'i-lucide-square', label: 'Rectangle fill — Shift erases', key: 'R' },
    { tool: 'erase', icon: 'i-lucide-eraser', label: 'Erase', key: 'E' },
    { tool: 'object', icon: 'i-lucide-diamond-plus', label: 'Place object of the selected prefab', key: 'O' },
]

const setTool = (tool: Tool) => props.tab.tool = tool
const zoomBy = (factor: number) => props.tab.zoom = Math.min(8, Math.max(0.25, props.tab.zoom * factor))

defineShortcuts({
    v: () => setTool('select'),
    m: () => setTool('move'),
    b: () => setTool('brush'),
    r: () => setTool('rect'),
    e: () => setTool('erase'),
    o: () => setTool('object'),
    g: () => props.tab.showGrid = !props.tab.showGrid,
    c: () => props.tab.showColliders = !props.tab.showColliders,
    t: () => props.tab.showTextures = !props.tab.showTextures,
})

const scopeLabel = computed(() => {
    const s = props.tab.selScope
    if (s === 'current') return 'Current layer'
    if (s === 'all') return 'All layers'
    return `${s.length} layer${s.length === 1 ? '' : 's'}`
})

// checkbox items stand in for radios (DropdownMenu has no radio type); preventDefault keeps the menu open
const keepOpen = (e: Event) => e.preventDefault()
const scopeItems = computed<DropdownMenuItem[][]>(() => {
    const s = props.tab.selScope
    const custom = Array.isArray(s) ? s : null
    const groups: DropdownMenuItem[][] = [[
        { type: 'checkbox', label: 'Current layer', checked: s === 'current', onSelect: keepOpen, onUpdateChecked: () => props.tab.selScope = 'current' },
        { type: 'checkbox', label: 'All layers', checked: s === 'all', onSelect: keepOpen, onUpdateChecked: () => props.tab.selScope = 'all' },
        {
            type: 'checkbox', label: 'Custom', checked: !!custom, onSelect: keepOpen,
            onUpdateChecked: () => props.tab.selScope = custom ?? props.tab.map.layers.filter((_, i) => i === props.tab.layer).map(l => l.name),
        },
    ]]
    if (custom) groups.push(props.tab.map.layers.map(layer => ({
        type: 'checkbox' as const,
        label: layer.name,
        checked: custom.includes(layer.name),
        onSelect: keepOpen,
        onUpdateChecked: (on: boolean) => props.tab.selScope = on ? [...custom, layer.name] : custom.filter(n => n !== layer.name),
    })))
    return groups
})

const selSize = computed(() => {
    const f = props.tab.floating
    if (f) return { cols: f.cols, rows: f.rows }
    return maskBounds(props.tab.map, props.tab.tileSel)
})
</script>

<template>
    <div class="flex h-10 shrink-0 items-center gap-1 border-b border-default px-2">
        <UTooltip v-for="t in tools" :key="t.tool" :text="t.label" :kbds="[t.key]">
            <UButton
                :icon="t.icon"
                size="sm"
                color="neutral"
                :variant="tab.tool === t.tool ? 'solid' : 'ghost'"
                :aria-label="t.label"
                @click="setTool(t.tool)"
            />
        </UTooltip>
        <template v-if="tab.tool === 'select' || tab.tool === 'move'">
            <USeparator orientation="vertical" class="mx-1 h-5" />
            <UDropdownMenu :items="scopeItems" :content="{ align: 'start' }">
                <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-layers" trailing-icon="i-lucide-chevron-down" :label="scopeLabel" />
            </UDropdownMenu>
            <span v-if="selSize" class="text-xs tabular-nums text-muted">{{ selSize.cols }}×{{ selSize.rows }}</span>
        </template>
        <USeparator orientation="vertical" class="mx-1 h-5" />
        <UButton size="sm" color="neutral" :variant="tab.showGrid ? 'subtle' : 'ghost'" icon="i-lucide-grid-3x3" label="Grid" @click="tab.showGrid = !tab.showGrid" />
        <UButton size="sm" color="neutral" :variant="tab.showColliders ? 'subtle' : 'ghost'" icon="i-lucide-box-select" label="Colliders" @click="tab.showColliders = !tab.showColliders" />
        <UButton size="sm" color="neutral" :variant="tab.showObjects ? 'subtle' : 'ghost'" icon="i-lucide-diamond" label="Objects" @click="tab.showObjects = !tab.showObjects" />
        <UTooltip text="Draw prefab textures; off shows colour swatches" :kbds="['T']">
            <UButton size="sm" color="neutral" :variant="tab.showTextures ? 'subtle' : 'ghost'" icon="i-lucide-image" label="Textures" @click="tab.showTextures = !tab.showTextures" />
        </UTooltip>
        <USeparator orientation="vertical" class="mx-1 h-5" />
        <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-undo-2" :disabled="!tab.undo.length && !tab.floating" aria-label="Undo" @click="$t.undo(tab)" />
        <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-redo-2" :disabled="!tab.redo.length" aria-label="Redo" @click="$t.redo(tab)" />
        <div class="flex-1" />
        <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-minus" aria-label="Zoom out" @click="zoomBy(0.8)" />
        <span class="w-12 text-center text-xs tabular-nums text-muted">{{ Math.round(tab.zoom * 100) }}%</span>
        <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-plus" aria-label="Zoom in" @click="zoomBy(1.25)" />
        <USeparator orientation="vertical" class="mx-1 h-5" />
        <UTooltip text="Highlight color">
            <input v-model="highlight" type="color" aria-label="Highlight color" class="size-6 cursor-pointer rounded border border-default bg-transparent p-0.5">
        </UTooltip>
    </div>
</template>
