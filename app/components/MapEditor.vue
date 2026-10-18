<script setup lang="ts">
const props = defineProps<{ tab: MapTab }>()
const $t = useAppTabs()
const project = useProject()

const schema = computed(() => project.state.value?.schema ?? null)
const prefabs = computed(() => $t.prefabsOf(props.tab))
const bottomOpen = ref(true)

const tools: { tool: Tool, icon: string, label: string, key: string }[] = [
    { tool: 'select', icon: 'i-lucide-mouse-pointer-2', label: 'Select / move', key: 'V' },
    { tool: 'brush', icon: 'i-lucide-paintbrush', label: 'Brush — right-click erases, Alt+click picks', key: 'B' },
    { tool: 'rect', icon: 'i-lucide-square-dashed', label: 'Rectangle fill — Shift erases', key: 'R' },
    { tool: 'erase', icon: 'i-lucide-eraser', label: 'Erase', key: 'E' },
    { tool: 'object', icon: 'i-lucide-diamond-plus', label: 'Place object of the selected prefab', key: 'O' },
]

const setTool = (tool: Tool) => props.tab.tool = tool
const zoomBy = (factor: number) => props.tab.zoom = Math.min(8, Math.max(0.25, props.tab.zoom * factor))

defineShortcuts({
    v: () => setTool('select'),
    b: () => setTool('brush'),
    r: () => setTool('rect'),
    e: () => setTool('erase'),
    o: () => setTool('object'),
    g: () => props.tab.showGrid = !props.tab.showGrid,
    c: () => props.tab.showColliders = !props.tab.showColliders,
    meta_z: () => $t.undo(props.tab),
    meta_shift_z: () => $t.redo(props.tab),
    meta_y: () => $t.redo(props.tab),
})
</script>

<template>
    <div class="flex h-full min-h-0">
        <MapSidebar :tab="tab" :prefabs="prefabs" class="w-60 shrink-0 border-e border-default" />

        <div class="flex min-w-0 flex-1 flex-col">
            <div class="flex h-10 shrink-0 items-center gap-1 border-b border-default px-2">
                <UTooltip v-for="t in tools" :key="t.tool" :text="t.label" :kbds="[t.key]">
                    <UButton
                        :icon="t.icon"
                        size="sm"
                        color="neutral"
                        :variant="tab.tool === t.tool ? 'soft' : 'ghost'"
                        :aria-label="t.label"
                        @click="setTool(t.tool)"
                    />
                </UTooltip>
                <USeparator orientation="vertical" class="mx-1 h-5" />
                <UButton size="sm" color="neutral" :variant="tab.showGrid ? 'soft' : 'ghost'" icon="i-lucide-grid-3x3" label="Grid" @click="tab.showGrid = !tab.showGrid" />
                <UButton size="sm" color="neutral" :variant="tab.showColliders ? 'soft' : 'ghost'" icon="i-lucide-box-select" label="Colliders" @click="tab.showColliders = !tab.showColliders" />
                <UButton size="sm" color="neutral" :variant="tab.showObjects ? 'soft' : 'ghost'" icon="i-lucide-diamond" label="Objects" @click="tab.showObjects = !tab.showObjects" />
                <USeparator orientation="vertical" class="mx-1 h-5" />
                <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-undo-2" :disabled="!tab.undo.length" aria-label="Undo" @click="$t.undo(tab)" />
                <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-redo-2" :disabled="!tab.redo.length" aria-label="Redo" @click="$t.redo(tab)" />
                <div class="flex-1" />
                <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-minus" aria-label="Zoom out" @click="zoomBy(0.8)" />
                <span class="w-12 text-center text-xs tabular-nums text-muted">{{ Math.round(tab.zoom * 100) }}%</span>
                <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-plus" aria-label="Zoom in" @click="zoomBy(1.25)" />
            </div>

            <div class="relative min-h-0 flex-1">
                <MapCanvas v-if="schema" :tab="tab" :prefabs="prefabs" :schema="schema" class="absolute inset-0" />
                <div v-else class="flex h-full items-center justify-center">
                    <UEmpty icon="i-lucide-file-x" title="No schema" description="Build the game once so NeoGameLib writes Data/<Game>.neoschema.json." />
                </div>
            </div>

            <ProblemsPanel v-model:open="bottomOpen" :tab="tab" :prefabs="prefabs" class="shrink-0 border-t border-default" />
        </div>

        <MapInspector :tab="tab" :prefabs="prefabs" class="w-80 shrink-0 border-s border-default" />
    </div>
</template>
