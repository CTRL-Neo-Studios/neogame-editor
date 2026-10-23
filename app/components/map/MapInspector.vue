<script setup lang="ts">
import type { JsonObject, JsonValue, NeoEntry, NeoMapObjectFile, NeoPrefab, Vec2 } from '#shared/types/neo'
import { overrideKey, resizeMap } from '~/utils/mapModel'

const props = defineProps<{ tab: MapTab, prefabs: Record<string, NeoPrefab> }>()
const $t = useAppTabs()
const project = useProject()

const schema = computed(() => project.state.value?.schema ?? null)
const libraries = computed(() => project.state.value?.libraries ?? {})
const map = computed(() => props.tab.map)
const sel = computed(() => props.tab.selection)

// One undo step per edit, not per keystroke: the first change after the selection, the edited field or the focus
// changes checkpoints; later changes to the same field merge into it. token null = always checkpoint (discrete actions).
let dirtyToken: string | null = null
watch([() => JSON.stringify(props.tab.selection), () => props.tab.map], () => dirtyToken = null)

function commit(token: string | null, mutate: () => void) {
    const key = token && `${JSON.stringify(props.tab.selection)}|${token}`
    if (!key || key !== dirtyToken) $t.checkpoint(props.tab)
    dirtyToken = key
    mutate()
}

// Vec2 is an interface, so it isn't assignable to JsonObject's index signature without a copy
const vecJson = (v: Vec2): JsonObject => ({ x: v.x, y: v.y })
const vecInfo = (name: string, integer: boolean, fallback: Vec2): FieldInfo =>
    ({ name, field: { kind: 'vector', integer }, nullable: false, required: false, default: vecJson(fallback), node: {} })
const asVec = (v: JsonValue | undefined): Vec2 | null =>
    v && typeof v === 'object' && !Array.isArray(v) && typeof v.x === 'number' && typeof v.y === 'number' ? { x: v.x, y: v.y } : null

const libraryOf = (prefab: string) => map.value.libraries.find(l => libraries.value[l]?.prefabs?.[prefab])

// ---- map ----
const libraryItems = computed(() => [...new Set([...Object.keys(libraries.value), ...map.value.libraries])])

function setCellSize(v: JsonValue | undefined) {
    const size = asVec(v)
    if (size && size.x > 0 && size.y > 0) commit('cellSize', () => map.value.cellSize = { x: Math.round(size.x), y: Math.round(size.y) })
}

const shortcuts: { keys: string[], label: string }[] = [
    { keys: ['V'], label: 'Select tiles / objects' },
    { keys: ['M'], label: 'Move selection' },
    { keys: ['B'], label: 'Brush' },
    { keys: ['R'], label: 'Rectangle fill' },
    { keys: ['E'], label: 'Erase' },
    { keys: ['O'], label: 'Place object' },
    { keys: ['G'], label: 'Toggle grid' },
    { keys: ['C'], label: 'Toggle colliders' },
    { keys: ['T'], label: 'Toggle textures' },
    { keys: ['meta', 'C'], label: 'Copy tiles' },
    { keys: ['meta', 'X'], label: 'Cut tiles' },
    { keys: ['meta', 'V'], label: 'Paste tiles' },
    { keys: ['Del'], label: 'Delete selection' },
    { keys: ['Esc'], label: 'Clear selection / cancel move' },
    { keys: ['shift', 'drag'], label: 'Add to selection' },
    { keys: ['meta', 'drag'], label: 'Remove from selection' },
    { keys: ['meta', 'wheel'], label: 'Zoom' },
    { keys: ['alt', 'click'], label: 'Pick top tile' },
    { keys: ['right-click'], label: 'Erase' },
    { keys: ['shift'], label: 'Drag object without snapping' },
]

// ---- cell ----
const cellStack = computed(() => {
    const s = sel.value
    if (s.kind !== 'cell') return []
    return map.value.layers.map((layer, i) => ({ layer, i, prefab: layer.cells[cellIndex(map.value, s.col, s.row)] ?? null })).reverse()
})
const cellObjects = computed(() => {
    const s = sel.value
    if (s.kind !== 'cell') return []
    const { x: w, y: h } = map.value.cellSize
    return map.value.objects
        .map((o, index) => ({ o, index }))
        .filter(({ o }) => Math.floor((o.position?.x ?? 0) / w) === s.col && Math.floor((o.position?.y ?? 0) / h) === s.row)
})

function selectPrefab(name: string) {
    const library = libraryOf(name)
    if (library) props.tab.selection = { kind: 'prefab', library, name }
}

// ---- object ----
const objectIndex = computed(() => sel.value.kind === 'object' ? sel.value.index : -1)
const object = computed(() => map.value.objects[objectIndex.value])
const objectPrefab = computed(() => object.value?.prefab ? props.prefabs[object.value.prefab] : undefined)

const nameDraft = ref('')
watch([objectIndex, () => object.value?.name], () => nameDraft.value = object.value?.name ?? '', { immediate: true })
const nameError = computed(() => {
    if (!nameDraft.value) return 'Name is required'
    return map.value.objects.some((o, i) => i !== objectIndex.value && o.name === nameDraft.value) ? 'Another object already has this name' : undefined
})
function setName(name: string) {
    nameDraft.value = name
    if (!nameError.value) commit('name', () => object.value!.name = name)
}

const pendingPrefab = ref<string | null>(null)
function requestPrefab(name: string | undefined) {
    const o = object.value
    if (!o || !name || name === o.prefab) return
    if (o.overrides && Object.keys(o.overrides).length) pendingPrefab.value = name
    else applyPrefab(name)
}
function applyPrefab(name: string) {
    commit(null, () => {
        object.value!.prefab = name
        delete object.value!.overrides
    })
    pendingPrefab.value = null
}

function setOverride(entry: NeoEntry, next: JsonObject | null | undefined) {
    const o = object.value
    if (!o) return
    const key = overrideKey(entry)
    commit(`override:${key}`, () => {
        const bag = { ...o.overrides }
        if (next === undefined) delete bag[key]
        else bag[key] = next && deepClone(next)
        if (Object.keys(bag).length) o.overrides = bag
        else delete o.overrides
    })
}

// keys that match no prefab entry make NeoMap.Build throw, so surface them where they can be fixed
const orphanOverrides = computed(() => {
    const keys = new Set((objectPrefab.value?.specs ?? []).map(overrideKey))
    return Object.keys(object.value?.overrides ?? {}).filter(k => !keys.has(k))
})
function removeOrphans() {
    commit(null, () => {
        const o = object.value!
        const bag = { ...o.overrides }
        for (const k of orphanOverrides.value) delete bag[k]
        if (Object.keys(bag).length) o.overrides = bag
        else delete o.overrides
    })
}

// empty lists are dropped so saved objects stay terse, like compactObject does
function setList<K extends 'tags' | 'specs'>(key: K, token: string | null, value: NonNullable<NeoMapObjectFile[K]>) {
    commit(token, () => {
        if (value.length) object.value![key] = value
        else delete object.value![key]
    })
}

function setRotation(n: number | null | undefined) {
    commit('rotation', () => {
        if (n) object.value!.rotation = n
        else delete object.value!.rotation
    })
}

function deleteObject() {
    const index = objectIndex.value
    commit(null, () => map.value.objects.splice(index, 1))
    props.tab.selection = { kind: 'map' }
}

// ---- prefab / collider (read-only here) ----
const summary = computed(() => {
    const s = sel.value
    if (s.kind === 'prefab') {
        const p = libraries.value[s.library]?.prefabs?.[s.name]
        return p && { tags: p.tags ?? [], specs: p.specs ?? [], collider: p.collider }
    }
    if (s.kind === 'collider') {
        const c = libraries.value[s.library]?.colliders?.[s.name]
        return c && { tags: c.tags ?? [], specs: c.specs ?? [], collider: undefined }
    }
    return undefined
})
const usage = computed(() => {
    const s = sel.value
    if (s.kind !== 'prefab') return ''
    const cells = map.value.layers.reduce((n, l) => n + l.cells.filter(c => c === s.name).length, 0)
    return `${cells} cells · ${map.value.objects.filter(o => o.prefab === s.name).length} objects in this map`
})

const header = computed(() => {
    const s = sel.value
    switch (s.kind) {
        case 'map': return { title: 'Map', sub: `${props.tab.name} · ${map.value.cols}×${map.value.rows}` }
        case 'cell': {
            const { cellSize: cs, origin } = map.value
            return { title: `Cell (${s.col}, ${s.row})`, sub: `world (${origin.x + s.col * cs.x}, ${origin.y + s.row * cs.y})` }
        }
        case 'object': return { title: `Object · ${object.value?.name ?? '?'}`, sub: object.value ? `instance of ${object.value.prefab || '(no prefab)'} · highlighted = overridden` : 'missing object' }
        case 'prefab': return { title: `Prefab · ${s.name}`, sub: `${s.library} · ${usage.value}` }
        case 'collider': return { title: `Collider · ${s.name}`, sub: s.library }
    }
})
</script>

<template>
    <div class="flex flex-col gap-3 overflow-y-auto p-3" @focusout="dirtyToken = null">
        <div>
            <h2 class="truncate font-semibold text-highlighted">{{ header.title }}</h2>
            <p class="truncate text-xs text-muted">{{ header.sub }}</p>
        </div>

        <!-- map settings -->
        <template v-if="sel.kind === 'map'">
            <UCard :ui="{ body: 'p-3 sm:p-3 flex flex-col gap-3' }">
                <InspectorField :info="vecInfo('cell size', true, { x: 32, y: 32 })" :model-value="vecJson(map.cellSize)" @update:model-value="setCellSize" />
                <InspectorField
                    :info="vecInfo('origin', false, { x: 0, y: 0 })"
                    :model-value="vecJson(map.origin)"
                    @update:model-value="v => { const o = asVec(v); if (o) commit('origin', () => map.origin = o) }"
                />
                <div class="grid grid-cols-2 gap-2">
                    <UFormField label="columns" size="sm">
                        <UInputNumber :model-value="map.cols" :min="1" :step="1" class="w-full" @update:model-value="n => n && commit('size', () => resizeMap(map, n, map.rows))" />
                    </UFormField>
                    <UFormField label="rows" size="sm">
                        <UInputNumber :model-value="map.rows" :min="1" :step="1" class="w-full" @update:model-value="n => n && commit('size', () => resizeMap(map, map.cols, n))" />
                    </UFormField>
                </div>
                <UFormField label="prefab libraries" hint="Data/NeoPrefabs" size="sm">
                    <USelectMenu
                        :model-value="map.libraries"
                        :items="libraryItems"
                        multiple
                        placeholder="None"
                        icon="i-lucide-library"
                        class="w-full"
                        @update:model-value="v => commit(null, () => map.libraries = [...v])"
                    />
                </UFormField>
            </UCard>
            <UCard :ui="{ body: 'p-3 sm:p-3' }">
                <p class="mb-2 text-xs font-medium text-muted">Shortcuts</p>
                <ul class="flex flex-col gap-1 text-xs">
                    <li v-for="s in shortcuts" :key="s.label + s.keys.join()" class="flex items-center justify-between gap-2">
                        <span class="text-muted">{{ s.label }}</span>
                        <span class="flex gap-0.5"><UKbd v-for="k in s.keys" :key="k" :value="k" size="sm" /></span>
                    </li>
                </ul>
            </UCard>
        </template>

        <!-- cell -->
        <template v-else-if="sel.kind === 'cell'">
            <UCard :ui="{ body: 'p-2 sm:p-2 flex flex-col gap-0.5' }">
                <p class="px-1 pb-1 text-xs font-medium text-muted">Stack, top to bottom</p>
                <UButton
                    v-for="c in cellStack"
                    :key="c.i"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :disabled="!c.prefab"
                    class="justify-start"
                    @click="c.prefab && selectPrefab(c.prefab)"
                >
                    <span class="w-20 truncate text-start text-muted">{{ c.layer.name }}</span>
                    <span :class="c.prefab ? '' : 'italic text-dimmed'">{{ c.prefab ?? 'empty' }}</span>
                </UButton>
            </UCard>
            <UCard :ui="{ body: 'p-2 sm:p-2 flex flex-col gap-0.5' }">
                <p class="px-1 pb-1 text-xs font-medium text-muted">Objects here</p>
                <UButton
                    v-for="c in cellObjects"
                    :key="c.index"
                    icon="i-lucide-diamond"
                    :label="c.o.name || '(unnamed)'"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    class="justify-start"
                    @click="tab.selection = { kind: 'object', index: c.index }"
                />
                <p v-if="!cellObjects.length" class="px-1 text-xs italic text-dimmed">none</p>
            </UCard>
            <p class="text-xs text-muted">Alt+click with a paint tool picks the top tile.</p>
        </template>

        <!-- object -->
        <template v-else-if="sel.kind === 'object'">
            <UEmpty v-if="!object" icon="i-lucide-circle-off" title="Object no longer exists" />
            <template v-else>
                <UCard :ui="{ body: 'p-3 sm:p-3 flex flex-col gap-3' }">
                    <UFormField label="name" required :error="nameError" size="sm">
                        <UInput :model-value="nameDraft" class="w-full" @update:model-value="s => setName(String(s ?? ''))" />
                    </UFormField>
                    <UFormField label="prefab" size="sm" :error="object.prefab && !objectPrefab ? `'${object.prefab}' is not in this map's libraries` : false">
                        <USelectMenu
                            :model-value="object.prefab"
                            :items="Object.keys(prefabs)"
                            icon="i-lucide-box"
                            placeholder="Choose prefab…"
                            class="w-full"
                            @update:model-value="requestPrefab"
                        />
                    </UFormField>
                    <UFormField label="tags" hint="added to the prefab's tags" size="sm">
                        <UInputTags
                            :model-value="object.tags ?? []"
                            placeholder="Add…"
                            add-on-blur
                            class="w-full"
                            @update:model-value="v => setList('tags', null, v.map(String))"
                        />
                    </UFormField>
                    <InspectorField
                        :info="vecInfo('position', false, { x: 0, y: 0 })"
                        :model-value="object.position && vecJson(object.position)"
                        :inherited="!object.position"
                        @update:model-value="v => { const p = asVec(v); if (p) commit('position', () => object!.position = p) }"
                    />
                    <InspectorField
                        :info="vecInfo('scale', false, { x: 1, y: 1 })"
                        :model-value="object.scale && vecJson(object.scale)"
                        :inherited="!object.scale"
                        @update:model-value="v => { const p = asVec(v); if (p) commit('scale', () => object!.scale = p) }"
                    />
                    <UFormField label="rotation" hint="radians" :help="`${((object.rotation ?? 0) * 180 / Math.PI).toFixed(1)}°`" size="sm">
                        <UInputNumber
                            :model-value="object.rotation ?? 0"
                            :step="0.05"
                            :format-options="{ maximumFractionDigits: 4 }"
                            class="w-full"
                            @update:model-value="setRotation"
                        />
                    </UFormField>
                </UCard>

                <template v-if="schema">
                    <UAlert
                        v-if="orphanOverrides.length"
                        icon="i-lucide-triangle-alert"
                        color="error"
                        variant="subtle"
                        :title="`Overrides match no prefab spec: ${orphanOverrides.join(', ')}`"
                        description="The game throws when building this object."
                        :actions="[{ label: 'Remove', color: 'error', variant: 'outline', onClick: removeOrphans }]"
                    />
                    <template v-if="objectPrefab?.specs?.length">
                        <p class="text-xs font-medium text-muted">Prefab specs</p>
                        <InspectorEntryCard
                            v-for="(entry, i) in objectPrefab.specs"
                            :key="`${i}:${overrideKey(entry)}`"
                            :entry="entry"
                            :schema="schema"
                            kind="spec"
                            :base="entry.properties ?? {}"
                            :overrides="object.overrides?.[overrideKey(entry)]"
                            @update:overrides="next => setOverride(entry, next)"
                        />
                    </template>
                    <p class="text-xs font-medium text-muted">Additional specs</p>
                    <InspectorEntryList
                        :model-value="object.specs ?? []"
                        :schema="schema"
                        kind="spec"
                        @update:model-value="v => setList('specs', 'specs', v)"
                    />
                </template>
                <UAlert v-else icon="i-lucide-file-x" color="warning" variant="subtle" title="No schema loaded" description="Spec editing needs Data/<Game>.neoschema.json.">
                    <template #actions>
                        <RefreshSpecsButton size="xs" variant="outline" />
                    </template>
                </UAlert>

                <UButton icon="i-lucide-trash-2" label="Delete object" color="error" variant="soft" block @click="deleteObject" />

                <UModal
                    :open="pendingPrefab !== null"
                    title="Change prefab?"
                    :description="`This object's overrides belong to '${object.prefab}' and will be cleared.`"
                    @update:open="o => !o && (pendingPrefab = null)"
                >
                    <template #footer>
                        <div class="flex w-full justify-end gap-2">
                            <UButton label="Cancel" color="neutral" variant="ghost" @click="pendingPrefab = null" />
                            <UButton label="Change and clear overrides" color="error" @click="pendingPrefab && applyPrefab(pendingPrefab)" />
                        </div>
                    </template>
                </UModal>
            </template>
        </template>

        <!-- prefab / collider: edited in the library tab -->
        <template v-else>
            <UEmpty v-if="!summary" icon="i-lucide-circle-off" title="Not found in library" />
            <UCard v-else :ui="{ body: 'p-3 sm:p-3 flex flex-col gap-2 text-sm' }">
                <div class="flex flex-wrap items-center gap-1">
                    <span class="w-16 text-xs text-muted">tags</span>
                    <UBadge v-for="t in summary.tags" :key="t" :label="t" size="sm" color="neutral" variant="subtle" />
                    <span v-if="!summary.tags.length" class="text-xs italic text-dimmed">none</span>
                </div>
                <div v-if="sel.kind === 'prefab'" class="flex items-center gap-1">
                    <span class="w-16 text-xs text-muted">collider</span>
                    <span :class="summary.collider ? '' : 'text-xs italic text-dimmed'">{{ summary.collider ?? 'none' }}</span>
                </div>
                <div class="flex flex-col gap-1">
                    <span class="text-xs text-muted">specs</span>
                    <div v-for="(s, i) in summary.specs" :key="i" class="flex items-center gap-1">
                        <UIcon name="i-lucide-puzzle" class="size-3.5 text-muted" />
                        <span>{{ s.type }}</span>
                        <UBadge v-if="s.id" :label="`#${s.id}`" size="sm" color="neutral" variant="subtle" />
                    </div>
                    <span v-if="!summary.specs.length" class="text-xs italic text-dimmed">none</span>
                </div>
            </UCard>
            <UButton
                v-if="sel.kind === 'prefab' || sel.kind === 'collider'"
                icon="i-lucide-square-pen"
                label="Edit in library"
                color="neutral"
                variant="soft"
                block
                @click="$t.open('library', sel.library, sel)"
            />
        </template>
    </div>
</template>
