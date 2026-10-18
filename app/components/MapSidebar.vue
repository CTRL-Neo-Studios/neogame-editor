<script setup lang="ts">
import type { NeoPrefab } from '#shared/types/neo'

const props = defineProps<{ tab: MapTab, prefabs: Record<string, NeoPrefab> }>()

const project = useProject()
const $t = useAppTabs()
const schema = computed(() => project.state.value?.schema ?? null)

// ---- layers ----
const layers = computed(() => props.tab.map.layers.map((layer, index) => ({ layer, index })).reverse())

const renamingLayer = ref<number | null>(null)
const layerNameDraft = ref('')
const addingLayer = ref(false)
const newLayerName = ref('')

const newLayerValid = computed(() => {
    const name = newLayerName.value.trim()
    return !!name && !props.tab.map.layers.some(l => l.name === name)
})

const painted = (layer: { cells: (string | null)[] }) => layer.cells.filter(Boolean).length

function startRenameLayer(index: number) {
    renamingLayer.value = index
    layerNameDraft.value = props.tab.map.layers[index]!.name
}

function commitRenameLayer(index: number) {
    if (renamingLayer.value !== index) return
    renamingLayer.value = null
    const name = layerNameDraft.value.trim()
    layerNameDraft.value = ''
    if (!name || props.tab.map.layers[index]!.name === name) return
    if (props.tab.map.layers.some((l, i) => i !== index && l.name === name)) return
    $t.checkpoint(props.tab)
    props.tab.map.layers[index]!.name = name
}

function commitAddLayer() {
    if (!addingLayer.value) return
    const name = newLayerName.value.trim()
    if (name && !props.tab.map.layers.some(l => l.name === name)) {
        $t.checkpoint(props.tab)
        props.tab.map.layers.push(newLayer(props.tab.map, name))
        props.tab.layer = props.tab.map.layers.length - 1
    }
    addingLayer.value = false
    newLayerName.value = ''
}

function deleteLayer(index: number) {
    if (props.tab.map.layers.length <= 1) return
    $t.checkpoint(props.tab)
    props.tab.map.layers.splice(index, 1)
    props.tab.layer = Math.min(props.tab.layer, props.tab.map.layers.length - 1)
}

function moveLayer(index: number, dir: 1 | -1) {
    const j = index + dir
    if (j < 0 || j >= props.tab.map.layers.length) return
    $t.checkpoint(props.tab)
    const list = props.tab.map.layers
    ;[list[index], list[j]] = [list[j]!, list[index]!]
    if (props.tab.layer === index) props.tab.layer = j
    else if (props.tab.layer === j) props.tab.layer = index
}

// ---- prefabs (grouped by library, in map.libraries order) ----
const prefabSearch = ref('')

const libraryOf = computed<Record<string, string>>(() => {
    const libs = project.state.value?.libraries ?? {}
    const out: Record<string, string> = {}
    for (const library of props.tab.map.libraries)
        for (const name of Object.keys(libs[library]?.prefabs ?? {}))
            out[name] ??= library
    return out
})

const prefabGroups = computed(() => {
    const needle = prefabSearch.value.trim().toLowerCase()
    const byLibrary = new Map<string, { name: string, def: NeoPrefab }[]>()
    for (const [name, def] of Object.entries(props.prefabs)) {
        const hit = !needle || name.toLowerCase().includes(needle) || (def.tags ?? []).some(t => t.toLowerCase().includes(needle))
        if (!hit) continue
        const library = libraryOf.value[name] ?? 'other'
        if (!byLibrary.has(library)) byLibrary.set(library, [])
        byLibrary.get(library)!.push({ name, def })
    }
    const groups: { library: string, items: { name: string, def: NeoPrefab }[] }[] = []
    for (const library of props.tab.map.libraries) {
        const items = byLibrary.get(library)
        if (items?.length) groups.push({ library, items })
        byLibrary.delete(library)
    }
    for (const [library, items] of byLibrary)
        if (items.length) groups.push({ library, items })
    return groups
})

const tagsOf = (def: NeoPrefab) => def.tags ?? []

function selectPrefab(library: string, name: string) {
    props.tab.prefab = name
    props.tab.selection = { kind: 'prefab', library, name }
}

// texture thumbnails, with a deterministic hue swatch as fallback
const thumbs = reactive<Record<string, string | null>>({})

const assetPaths = computed(() => {
    const s = schema.value
    if (!s) return {} as Record<string, string>
    const out: Record<string, string> = {}
    for (const [name, def] of Object.entries(props.prefabs)) {
        const path = previewAsset(s, def.specs)
        if (path) out[name] = path
    }
    return out
})

watch(assetPaths, (paths) => {
    for (const [name, path] of Object.entries(paths)) {
        if (name in thumbs) continue
        thumbs[name] = null
        project.assetUrl(path).then(url => { thumbs[name] = url })
    }
}, { immediate: true })

const thumbOf = (name: string) => thumbs[name] ?? ''

function hueOf(name: string): string {
    let h = 0
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    return `hsl(${h % 360} 40% 45%)`
}

// ---- objects ----
const isObjectSelected = (index: number) => props.tab.selection.kind === 'object' && props.tab.selection.index === index
</script>

<template>
    <div class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-2">
        <!-- Layers -->
        <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-1 px-1">
                <span class="text-xs font-medium text-muted">Layers</span>
                <div class="flex-1" />
                <UButton icon="i-lucide-plus" size="xs" variant="ghost" color="neutral" aria-label="Add layer" @click="addingLayer = true" />
            </div>
            <div v-if="addingLayer" class="flex items-center gap-1 px-1">
                <UInput
                    v-model="newLayerName"
                    size="xs"
                    placeholder="Layer name"
                    class="min-w-0 flex-1"
                    autofocus
                    @keydown.enter.prevent="commitAddLayer"
                    @keydown.escape="addingLayer = false; newLayerName = ''"
                    @blur="commitAddLayer"
                />
                <UButton icon="i-lucide-check" size="xs" variant="soft" color="neutral" :disabled="!newLayerValid" aria-label="Confirm" @click="commitAddLayer" />
            </div>
            <div
                v-for="item in layers"
                :key="item.index"
                class="group flex items-center gap-1 rounded-md px-1 py-0.5"
                :class="tab.layer === item.index ? 'bg-elevated' : 'hover:bg-elevated/50'"
                @click="tab.layer = item.index"
            >
                <UButton
                    :icon="item.layer.visible ? 'i-lucide-eye' : 'i-lucide-eye-off'"
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    class="shrink-0"
                    :class="item.layer.visible ? 'text-default' : 'text-dimmed'"
                    aria-label="Toggle visibility"
                    @click.stop="item.layer.visible = !item.layer.visible"
                />
                <UInput
                    v-if="renamingLayer === item.index"
                    v-model="layerNameDraft"
                    size="xs"
                    class="min-w-0 flex-1"
                    autofocus
                    @keydown.enter.prevent="commitRenameLayer(item.index)"
                    @keydown.escape="renamingLayer = null"
                    @blur="commitRenameLayer(item.index)"
                />
                <span v-else class="min-w-0 flex-1 cursor-pointer truncate text-sm" @dblclick.prevent="startRenameLayer(item.index)">{{ item.layer.name }}</span>
                <UBadge size="xs" variant="subtle" color="neutral" :label="String(painted(item.layer))" />
                <div class="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                    <UButton
                        icon="i-lucide-arrow-up"
                        size="xs"
                        variant="ghost"
                        color="neutral"
                        :disabled="item.index === tab.map.layers.length - 1"
                        aria-label="Move up"
                        @click.stop="moveLayer(item.index, 1)"
                    />
                    <UButton
                        icon="i-lucide-arrow-down"
                        size="xs"
                        variant="ghost"
                        color="neutral"
                        :disabled="item.index === 0"
                        aria-label="Move down"
                        @click.stop="moveLayer(item.index, -1)"
                    />
                    <UButton
                        icon="i-lucide-trash"
                        size="xs"
                        variant="ghost"
                        color="neutral"
                        :disabled="tab.map.layers.length <= 1"
                        aria-label="Delete layer"
                        @click.stop="deleteLayer(item.index)"
                    />
                </div>
            </div>
        </div>

        <!-- Prefabs -->
        <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-1 px-1">
                <span class="text-xs font-medium text-muted">Prefabs</span>
                <div class="flex-1" />
                <UInput v-model="prefabSearch" size="xs" icon="i-lucide-search" placeholder="Search" class="w-24" />
            </div>
            <UEmpty v-if="!tab.map.libraries.length" size="sm" icon="i-lucide-boxes" title="No libraries" description="Add a prefab library in the map settings.">
                <template #actions>
                    <UButton size="xs" variant="soft" color="neutral" label="Map settings" @click="tab.selection = { kind: 'map' }" />
                </template>
            </UEmpty>
            <template v-else>
                <div v-for="group in prefabGroups" :key="group.library" class="flex flex-col gap-0.5">
                    <div class="px-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-dimmed">{{ group.library }}</div>
                    <div
                        v-for="item in group.items"
                        :key="item.name"
                        class="group flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5"
                        :class="tab.prefab === item.name ? 'bg-elevated' : 'hover:bg-elevated/50'"
                        @click="selectPrefab(group.library, item.name)"
                    >
                        <img v-if="thumbs[item.name]" :src="thumbOf(item.name)" class="size-4 shrink-0 rounded-sm object-cover" alt="" />
                        <span v-else class="size-4 shrink-0 rounded-sm" :style="{ background: hueOf(item.name) }" />
                        <span class="min-w-0 flex-1 truncate text-sm">{{ item.name }}</span>
                        <UBadge v-if="item.def.collider" size="xs" variant="subtle" color="neutral" :label="item.def.collider" />
                        <template v-if="tagsOf(item.def).length">
                            <UBadge v-for="tag in tagsOf(item.def).slice(0, 2)" :key="tag" size="xs" variant="soft" color="neutral" :label="tag" />
                            <UBadge v-if="tagsOf(item.def).length > 2" size="xs" variant="subtle" color="neutral" :label="`+${tagsOf(item.def).length - 2}`" />
                        </template>
                    </div>
                </div>
                <div v-if="!prefabGroups.length" class="px-1 text-xs text-dimmed">No matching prefabs</div>
            </template>
        </div>

        <!-- Objects -->
        <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-1 px-1">
                <span class="text-xs font-medium text-muted">Objects ({{ tab.map.objects.length }})</span>
                <div class="flex-1" />
                <UButton icon="i-lucide-plus" size="xs" variant="ghost" color="neutral" aria-label="Object tool" @click="tab.tool = 'object'" />
            </div>
            <div
                v-for="(obj, index) in tab.map.objects"
                :key="index"
                class="group flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5"
                :class="isObjectSelected(index) ? 'bg-elevated' : 'hover:bg-elevated/50'"
                @click="tab.selection = { kind: 'object', index }"
            >
                <span class="size-3 shrink-0 rotate-45 rounded-[2px]" :style="{ background: hueOf(obj.prefab ?? '') }" />
                <span class="min-w-0 flex-1 truncate text-sm">{{ obj.name || 'Unnamed' }}</span>
                <span class="truncate text-xs text-dimmed">{{ obj.prefab }}</span>
            </div>
            <div v-if="!tab.map.objects.length" class="px-1 text-xs text-dimmed">No objects</div>
        </div>
    </div>
</template>
