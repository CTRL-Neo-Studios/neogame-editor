<script setup lang="ts">
import type { ContextMenuItem } from '@nuxt/ui'
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

type PrefabItem = { name: string, def: NeoPrefab }

const prefabGroups = computed(() => {
    const needle = prefabSearch.value.trim().toLowerCase()
    const byLibrary = new Map<string, PrefabItem[]>()
    for (const [name, def] of Object.entries(props.prefabs)) {
        const hit = !needle || name.toLowerCase().includes(needle) || (def.folder ?? '').toLowerCase().includes(needle)
            || (def.tags ?? []).some(t => t.toLowerCase().includes(needle))
        if (!hit) continue
        const library = libraryOf.value[name] ?? 'other'
        if (!byLibrary.has(library)) byLibrary.set(library, [])
        byLibrary.get(library)!.push({ name, def })
    }
    // root prefabs first, then one sub-group per folder path
    const byFolder = (items: PrefabItem[]) => {
        const out: Record<string, PrefabItem[]> = {}
        for (const item of items) (out[item.def.folder ?? ''] ??= []).push(item)
        return Object.keys(out).sort().map(folder => ({ folder, items: out[folder]! }))
    }
    const groups: { library: string, folders: { folder: string, items: PrefabItem[] }[] }[] = []
    for (const library of props.tab.map.libraries) {
        const items = byLibrary.get(library)
        if (items?.length) groups.push({ library, folders: byFolder(items) })
        byLibrary.delete(library)
    }
    for (const [library, items] of byLibrary)
        if (items.length) groups.push({ library, folders: byFolder(items) })
    return groups
})

const folderOpen = useLocalStorage<Record<string, boolean>>('neo-sidebar-folders', {})
// searching shows every hit, whatever is collapsed
const isFolderOpen = (library: string, folder: string) => !!prefabSearch.value.trim() || (folderOpen.value[`${library}:${folder}`] ?? true)
const toggleFolder = (library: string, folder: string) => folderOpen.value[`${library}:${folder}`] = !isFolderOpen(library, folder)

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

// ---- objects ----
const isObjectSelected = (index: number) => props.tab.selection.kind === 'object' && props.tab.selection.index === index

// ---- hierarchy: each layer's legend, i.e. the char every painted prefab gets in the saved file ----
const legendRows = computed(() => {
    let legends: Map<string, string>[] = []
    try { legends = layerLegends(props.tab.map) }
    catch { /* too many prefabs for the char pool; ProblemsPanel reports it */ }
    return props.tab.map.layers.map((layer, i) => {
        const counts: Record<string, number> = {}
        for (const name of layer.cells) if (name) counts[name] = (counts[name] ?? 0) + 1
        return [...(legends[i] ?? [])].map(([prefab, ch]) => ({ prefab, ch, count: counts[prefab] ?? 0 }))
    })
})
const expanded = useLocalStorage<Record<string, boolean>>('neo-sidebar-expanded', {})
const isExpanded = (index: number) => expanded.value[`${props.tab.id}:${index}`] ?? index === props.tab.layer
const toggleExpanded = (index: number) => expanded.value[`${props.tab.id}:${index}`] = !isExpanded(index)
const openSections = useLocalStorage('neo-sidebar-sections', { prefabs: true, objects: true })

// same deterministic swatch the canvas paints when a texture is missing, so the two always match
const swatchOf = (name: string | null | undefined) => colorOf(name ?? null, (name && assetPaths.value[name]) || null)
function pickLegend(name: string, layer: number) {
    props.tab.layer = layer
    const library = libraryOf.value[name]
    if (library) selectPrefab(library, name)
    else props.tab.prefab = name
}

// ---- right-click menus ----
type MenuTarget = { kind: 'layer', index: number } | { kind: 'prefab', library: string, name: string } | { kind: 'object', index: number }

const menu = useContextTarget<MenuTarget>((t): ContextMenuItem[][] => {
    if (t?.kind === 'layer') {
        const layer = props.tab.map.layers[t.index]
        if (!layer) return []
        return [
            [
                { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => startRenameLayer(t.index) },
                { label: layer.visible ? 'Hide' : 'Show', icon: layer.visible ? 'i-lucide-eye-off' : 'i-lucide-eye', onSelect: () => layer.visible = !layer.visible },
            ],
            [
                { label: 'Move up', icon: 'i-lucide-arrow-up', disabled: t.index === props.tab.map.layers.length - 1, onSelect: () => moveLayer(t.index, 1) },
                { label: 'Move down', icon: 'i-lucide-arrow-down', disabled: t.index === 0, onSelect: () => moveLayer(t.index, -1) },
            ],
            [{ label: 'Delete layer', icon: 'i-lucide-trash', color: 'error', disabled: props.tab.map.layers.length <= 1, onSelect: () => deleteLayer(t.index) }],
        ]
    }
    if (t?.kind === 'prefab') return [[
        { label: 'Use as brush', icon: 'i-lucide-paintbrush', onSelect: () => { selectPrefab(t.library, t.name); props.tab.tool = 'brush' } },
        { label: 'Place as object', icon: 'i-lucide-diamond-plus', onSelect: () => { selectPrefab(t.library, t.name); props.tab.tool = 'object' } },
    ], [
        { label: 'Edit in library', icon: 'i-lucide-square-pen', onSelect: () => $t.openLibrary(t.library, { kind: 'prefab', library: t.library, name: t.name }) },
    ]]
    if (t?.kind === 'object') return [[
        { label: 'Duplicate', icon: 'i-lucide-copy', onSelect: () => $t.duplicateObject(props.tab, t.index) },
        { label: 'Delete', icon: 'i-lucide-trash', color: 'error', onSelect: () => $t.deleteObject(props.tab, t.index) },
    ]]
    return []
})
</script>

<template>
    <UContextMenu :items="menu.items" :content="menu.content">
    <div class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-2" data-context-menu @contextmenu.capture="menu.reset" @contextmenu="menu.settle">
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
            <template v-for="item in layers" :key="item.index">
            <div
                class="group flex items-center gap-1 rounded-md px-1 py-0.5"
                :class="tab.layer === item.index ? 'bg-elevated' : 'hover:bg-elevated/50'"
                @click="tab.layer = item.index"
                @contextmenu="menu.set({ kind: 'layer', index: item.index })"
            >
                <UButton
                    :icon="isExpanded(item.index) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                    size="xs"
                    variant="link"
                    color="neutral"
                    class="shrink-0 px-0"
                    :aria-label="isExpanded(item.index) ? 'Collapse legend' : 'Expand legend'"
                    @click.stop="toggleExpanded(item.index)"
                />
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
            <div v-if="isExpanded(item.index)" class="ms-5 flex flex-col border-s border-default ps-1">
                <div
                    v-for="row in legendRows[item.index]"
                    :key="row.prefab"
                    class="flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-xs"
                    :class="tab.prefab === row.prefab && tab.layer === item.index ? 'bg-elevated' : 'hover:bg-elevated/50'"
                    :title="`'${row.ch}' = ${row.prefab} · click to paint it on this layer`"
                    @click="pickLegend(row.prefab, item.index)"
                >
                    <code class="w-4 text-center font-mono text-muted">{{ row.ch }}</code>
                    <span class="size-3 shrink-0 rounded-sm" :style="{ background: swatchOf(row.prefab) }" />
                    <span class="min-w-0 flex-1 truncate" :class="prefabs[row.prefab] ? '' : 'text-error'">{{ row.prefab }}</span>
                    <span class="tabular-nums text-dimmed">{{ row.count }}</span>
                </div>
                <div v-if="!legendRows[item.index]?.length" class="px-1 py-0.5 text-xs italic text-dimmed">empty</div>
            </div>
            </template>
        </div>

        <!-- Prefabs -->
        <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-1 px-1">
                <UButton
                    :icon="openSections.prefabs ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                    label="Prefabs"
                    size="xs"
                    variant="link"
                    color="neutral"
                    class="px-0 text-xs font-medium text-muted"
                    @click="openSections.prefabs = !openSections.prefabs"
                />
                <div class="flex-1" />
                <UInput v-if="openSections.prefabs" v-model="prefabSearch" size="xs" icon="i-lucide-search" placeholder="Search" class="w-24" />
            </div>
            <template v-if="openSections.prefabs">
            <UEmpty v-if="!tab.map.libraries.length" size="sm" icon="i-lucide-boxes" title="No libraries" description="Add a prefab library in the map settings.">
                <template #actions>
                    <UButton size="xs" variant="soft" color="neutral" label="Map settings" @click="tab.selection = { kind: 'map' }" />
                </template>
            </UEmpty>
            <template v-else>
                <div v-for="group in prefabGroups" :key="group.library" class="flex flex-col gap-0.5">
                    <div class="px-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-dimmed">{{ group.library }}</div>
                    <template v-for="sub in group.folders" :key="sub.folder">
                        <button
                            v-if="sub.folder"
                            type="button"
                            class="flex items-center gap-1 rounded-md px-1 py-0.5 text-xs text-muted hover:bg-elevated/50"
                            @click="toggleFolder(group.library, sub.folder)"
                        >
                            <UIcon :name="isFolderOpen(group.library, sub.folder) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3 shrink-0" />
                            <UIcon :name="isFolderOpen(group.library, sub.folder) ? 'i-lucide-folder-open' : 'i-lucide-folder'" class="size-3.5 shrink-0" />
                            <span class="min-w-0 flex-1 truncate text-start">{{ sub.folder }}</span>
                            <span class="tabular-nums text-dimmed">{{ sub.items.length }}</span>
                        </button>
                        <div v-if="!sub.folder || isFolderOpen(group.library, sub.folder)" class="flex flex-col gap-0.5" :class="sub.folder && 'ms-2.5 border-s border-default ps-1'">
                            <div
                                v-for="item in sub.items"
                                :key="item.name"
                                class="group flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5"
                                :class="tab.prefab === item.name ? 'bg-elevated ring-primary/50 ring' : 'hover:bg-elevated/50'"
                                @click="selectPrefab(group.library, item.name)"
                                @contextmenu="menu.set({ kind: 'prefab', library: group.library, name: item.name })"
                            >
                                <img v-if="thumbs[item.name]" :src="thumbOf(item.name)" class="size-4 shrink-0 rounded-sm object-cover" alt="" />
                                <span v-else class="size-4 shrink-0 rounded-sm" :style="{ background: swatchOf(item.name) }" />
                                <span class="min-w-0 flex-1 truncate text-sm">{{ item.name }}</span>
                                <UBadge v-if="item.def.collider" size="xs" variant="subtle" color="neutral" :label="item.def.collider">
                                    <template #leading>
                                        <span class="size-1.5 shrink-0 rounded-full" :style="{ background: $t.groupColor.value[item.def.collider] ?? 'var(--ui-text-dimmed)' }" />
                                    </template>
                                </UBadge>
                                <template v-if="tagsOf(item.def).length">
                                    <UBadge v-for="tag in tagsOf(item.def).slice(0, 2)" :key="tag" size="xs" variant="soft" color="neutral" :label="tag" />
                                    <UBadge v-if="tagsOf(item.def).length > 2" size="xs" variant="subtle" color="neutral" :label="`+${tagsOf(item.def).length - 2}`" />
                                </template>
                            </div>
                        </div>
                    </template>
                </div>
                <div v-if="!prefabGroups.length" class="px-1 text-xs text-dimmed">No matching prefabs</div>
            </template>
            </template>
        </div>

        <!-- Objects -->
        <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-1 px-1">
                <UButton
                    :icon="openSections.objects ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                    :label="`Objects (${tab.map.objects.length})`"
                    size="xs"
                    variant="link"
                    color="neutral"
                    class="px-0 text-xs font-medium text-muted"
                    @click="openSections.objects = !openSections.objects"
                />
                <div class="flex-1" />
                <UButton icon="i-lucide-plus" size="xs" variant="ghost" color="neutral" aria-label="Object tool" @click="tab.tool = 'object'" />
            </div>
            <template v-if="openSections.objects">
            <div
                v-for="(obj, index) in tab.map.objects"
                :key="index"
                class="group flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5"
                :class="isObjectSelected(index) ? 'bg-elevated' : 'hover:bg-elevated/50'"
                @click="tab.selection = { kind: 'object', index }"
                @contextmenu="menu.set({ kind: 'object', index }); tab.selection = { kind: 'object', index }"
            >
                <span class="size-3 shrink-0 rotate-45 rounded-[2px]" :style="{ background: swatchOf(obj.prefab) }" />
                <span class="min-w-0 flex-1 truncate text-sm">{{ obj.name || 'Unnamed' }}</span>
                <span class="truncate text-xs text-dimmed">{{ obj.prefab }}</span>
            </div>
            <div v-if="!tab.map.objects.length" class="px-1 text-xs text-dimmed">No objects</div>
            </template>
        </div>
    </div>
    </UContextMenu>
</template>
