<script setup lang="ts">
import type { NeoEntry, NeoPrefab, NeoPrefabLibraryFile } from '#shared/types/neo'

const props = defineProps<{ tab: LibraryTab }>()

const project = useProject()
const $t = useAppTabs()
const toast = useToast()

const schema = computed(() => project.state.value?.schema ?? null)

// The library tab only exists with an open project; make sure the record is present before editing it in place.
if (project.state.value) project.state.value.libraries[props.tab.name] ??= { prefabs: {}, colliders: {} }

const lib = computed<NeoPrefabLibraryFile>(() => project.state.value?.libraries[props.tab.name] ?? { prefabs: {}, colliders: {} })

defineShortcuts({
    meta_z: () => $t.undo(props.tab),
    meta_shift_z: () => $t.redo(props.tab),
    meta_y: () => $t.redo(props.tab),
})

const selection = computed(() => {
    const s = props.tab.selection
    return (s.kind === 'prefab' || s.kind === 'collider') && s.library === props.tab.name ? s : null
})

const selectedPrefabName = computed(() => (selection.value?.kind === 'prefab' ? selection.value.name : null))
const selectedColliderName = computed(() => (selection.value?.kind === 'collider' ? selection.value.name : null))
const selectedPrefab = computed<NeoPrefab | null>(() => (selectedPrefabName.value ? (lib.value.prefabs?.[selectedPrefabName.value] ?? null) : null))
const selectedCollider = computed(() => (selectedColliderName.value ? (lib.value.colliders?.[selectedColliderName.value] ?? null) : null))

// Writable bindings so UInputTags / InspectorEntryList / USelectMenu can edit the selected record in place.
const prefabSpecs = computed<NeoEntry[]>({
    get: () => selectedPrefab.value?.specs ?? [],
    set: v => { if (selectedPrefab.value) { $t.checkpoint(props.tab); selectedPrefab.value.specs = v } },
})
const prefabTags = computed<string[]>({
    get: () => selectedPrefab.value?.tags ?? [],
    set: v => { if (selectedPrefab.value) { $t.checkpoint(props.tab); selectedPrefab.value.tags = v } },
})
const prefabCollider = computed<string>({
    get: () => selectedPrefab.value?.collider ?? '',
    set: v => { if (selectedPrefab.value) { $t.checkpoint(props.tab); selectedPrefab.value.collider = v || undefined } },
})
const colliderSpecs = computed<NeoEntry[]>({
    get: () => selectedCollider.value?.specs ?? [],
    set: v => { if (selectedCollider.value) { $t.checkpoint(props.tab); selectedCollider.value.specs = v } },
})
const colliderTags = computed<string[]>({
    get: () => selectedCollider.value?.tags ?? [],
    set: v => { if (selectedCollider.value) { $t.checkpoint(props.tab); selectedCollider.value.tags = v } },
})

const colliderOptions = computed(() => [
    { label: 'None', value: '' },
    ...Object.keys(lib.value.colliders ?? {}).map(name => ({ label: name, value: name })),
])

// ---- lists ----
const prefabSearch = ref('')
const colliderSearch = ref('')

function matches(name: string, tags: string[] | undefined, query: string): boolean {
    const needle = query.trim().toLowerCase()
    if (!needle) return true
    return name.toLowerCase().includes(needle) || (tags ?? []).some(t => t.toLowerCase().includes(needle))
}

const prefabEntries = computed(() => Object.entries(lib.value.prefabs ?? {}))
const colliderEntries = computed(() => Object.entries(lib.value.colliders ?? {}))
const filteredPrefabs = computed(() => prefabEntries.value.filter(([n, d]) => matches(n, d.tags, prefabSearch.value)))
const filteredColliders = computed(() => colliderEntries.value.filter(([n, d]) => matches(n, d.tags, colliderSearch.value)))

function selectPrefab(name: string) {
    if (lib.value.prefabs?.[name]) props.tab.selection = { kind: 'prefab', library: props.tab.name, name }
}

function selectCollider(name: string) {
    if (lib.value.colliders?.[name]) props.tab.selection = { kind: 'collider', library: props.tab.name, name }
}

// ---- add ----
const addingPrefab = ref(false)
const addingCollider = ref(false)
const newPrefabName = ref('')
const newColliderName = ref('')

const newPrefabValid = computed(() => {
    const n = newPrefabName.value.trim()
    return !!n && !(n in (lib.value.prefabs ?? {}))
})
const newColliderValid = computed(() => {
    const n = newColliderName.value.trim()
    return !!n && !(n in (lib.value.colliders ?? {}))
})

function commitAddPrefab() {
    if (!addingPrefab.value) return
    const name = newPrefabName.value.trim()
    if (name && !(name in (lib.value.prefabs ?? {}))) {
        $t.checkpoint(props.tab)
        lib.value.prefabs ??= {}
        lib.value.prefabs[name] = { specs: [] }
        selectPrefab(name)
    }
    addingPrefab.value = false
    newPrefabName.value = ''
}

function commitAddCollider() {
    if (!addingCollider.value) return
    const name = newColliderName.value.trim()
    if (name && !(name in (lib.value.colliders ?? {}))) {
        $t.checkpoint(props.tab)
        lib.value.colliders ??= {}
        lib.value.colliders[name] = {}
        selectCollider(name)
    }
    addingCollider.value = false
    newColliderName.value = ''
}

// ---- rename ----
const renamingPrefab = ref<string | null>(null)
const renamingCollider = ref<string | null>(null)
const renamePrefabDraft = ref('')
const renameColliderDraft = ref('')
const renamePrompt = ref<{ oldName: string, newName: string } | null>(null)

function rekey<T>(record: Record<string, T>, oldName: string, newName: string): Record<string, T> | null {
    if (!(oldName in record) || newName in record || oldName === newName) return null
    const out: Record<string, T> = {}
    for (const [key, value] of Object.entries(record)) out[key === oldName ? newName : key] = value
    return out
}

function mapTabsUsingPrefab(name: string): MapTab[] {
    return $t.tabs.value.filter((t): t is MapTab =>
        t.kind === 'map'
        && t.map.libraries.includes(props.tab.name)
        && (t.map.layers.some(l => l.cells.includes(name)) || t.map.objects.some(o => o.prefab === name)),
    )
}

function startRenamePrefab(name: string) {
    renamingPrefab.value = name
    renamePrefabDraft.value = name
}

function commitRenamePrefab(oldName: string) {
    if (renamingPrefab.value !== oldName) return
    renamingPrefab.value = null
    const newName = renamePrefabDraft.value.trim()
    renamePrefabDraft.value = ''
    if (!newName || newName === oldName || newName in (lib.value.prefabs ?? {})) return
    if (mapTabsUsingPrefab(oldName).length) {
        renamePrompt.value = { oldName, newName }
        return
    }
    applyRenamePrefab(oldName, newName)
}

function applyRenamePrefab(oldName: string, newName: string) {
    const affected = mapTabsUsingPrefab(oldName)
    $t.checkpoint(props.tab)
    const rekeyed = rekey(lib.value.prefabs ?? {}, oldName, newName)
    if (rekeyed) lib.value.prefabs = rekeyed
    for (const tab of affected) {
        $t.checkpoint(tab)
        for (const layer of tab.map.layers)
            for (let i = 0; i < layer.cells.length; i++)
                if (layer.cells[i] === oldName) layer.cells[i] = newName
        for (const obj of tab.map.objects)
            if (obj.prefab === oldName) obj.prefab = newName
    }
    if (selection.value?.kind === 'prefab' && selection.value.name === oldName)
        props.tab.selection = { kind: 'prefab', library: props.tab.name, name: newName }
    toast.add({
        title: 'Prefab renamed',
        description: affected.length ? `Updated ${affected.length} open map${affected.length > 1 ? 's' : ''}.` : undefined,
        color: 'success',
        duration: 2500,
    })
}

function startRenameCollider(name: string) {
    renamingCollider.value = name
    renameColliderDraft.value = name
}

function commitRenameCollider(oldName: string) {
    if (renamingCollider.value !== oldName) return
    renamingCollider.value = null
    const newName = renameColliderDraft.value.trim()
    renameColliderDraft.value = ''
    if (!newName || newName === oldName || newName in (lib.value.colliders ?? {})) return
    $t.checkpoint(props.tab)
    const rekeyed = rekey(lib.value.colliders ?? {}, oldName, newName)
    if (rekeyed) {
        lib.value.colliders = rekeyed
        for (const def of Object.values(lib.value.prefabs ?? {}))
            if (def.collider === oldName) def.collider = newName
    }
    if (selection.value?.kind === 'collider' && selection.value.name === oldName)
        props.tab.selection = { kind: 'collider', library: props.tab.name, name: newName }
}

const renameOpen = computed({
    get: () => !!renamePrompt.value,
    set: v => { if (!v) renamePrompt.value = null },
})

const renameDescription = computed(() => {
    const p = renamePrompt.value
    if (!p) return ''
    const n = mapTabsUsingPrefab(p.oldName).length
    return `Renaming "${p.oldName}" to "${p.newName}". ${n} open map${n > 1 ? 's' : ''} reference${n === 1 ? 's' : ''} it and will be updated.`
})

function confirmRename() {
    const p = renamePrompt.value
    renamePrompt.value = null
    if (p) applyRenamePrefab(p.oldName, p.newName)
}

// ---- duplicate / delete ----
const deletePrompt = ref<{ kind: 'prefab' | 'collider', name: string } | null>(null)

function uniqueKey(record: Record<string, unknown>, base: string): string {
    let name = base
    let n = 2
    while (name in record) name = `${base}-${n++}`
    return name
}

function duplicatePrefab(name: string) {
    const def = lib.value.prefabs?.[name]
    if (!def) return
    $t.checkpoint(props.tab)
    lib.value.prefabs ??= {}
    const copy = uniqueKey(lib.value.prefabs, `${name}-copy`)
    lib.value.prefabs[copy] = deepClone(def)
    selectPrefab(copy)
}

function duplicateCollider(name: string) {
    const def = lib.value.colliders?.[name]
    if (!def) return
    $t.checkpoint(props.tab)
    lib.value.colliders ??= {}
    const copy = uniqueKey(lib.value.colliders, `${name}-copy`)
    lib.value.colliders[copy] = deepClone(def)
    selectCollider(copy)
}

function prefabUsage(name: string): number {
    let n = 0
    for (const tab of $t.tabs.value) {
        if (tab.kind !== 'map' || !tab.map.libraries.includes(props.tab.name)) continue
        for (const layer of tab.map.layers) n += layer.cells.filter(c => c === name).length
        n += tab.map.objects.filter(o => o.prefab === name).length
    }
    return n
}

function colliderUsage(name: string): number {
    return Object.values(lib.value.prefabs ?? {}).filter(d => d.collider === name).length
}

const selectedUsage = computed(() => (selectedPrefabName.value ? prefabUsage(selectedPrefabName.value) : 0))

const deleteOpen = computed({
    get: () => !!deletePrompt.value,
    set: v => { if (!v) deletePrompt.value = null },
})

const deleteDescription = computed(() => {
    const d = deletePrompt.value
    if (!d) return ''
    return d.kind === 'prefab'
        ? `"${d.name}" is used by ${prefabUsage(d.name)} cells/objects in open maps.`
        : `"${d.name}" is used by ${colliderUsage(d.name)} prefabs in this library.`
})

function confirmDelete() {
    const d = deletePrompt.value
    deletePrompt.value = null
    if (!d) return
    $t.checkpoint(props.tab)
    if (d.kind === 'prefab') {
        const prefabs = lib.value.prefabs
        if (prefabs) delete prefabs[d.name]
    }
    else {
        const colliders = lib.value.colliders
        if (colliders) {
            delete colliders[d.name]
            for (const def of Object.values(lib.value.prefabs ?? {}))
                if (def.collider === d.name) def.collider = undefined
        }
    }
    if (selection.value && ((selection.value.kind === 'prefab' && selection.value.name === d.name) || (selection.value.kind === 'collider' && selection.value.name === d.name)))
        props.tab.selection = { kind: 'map' }
}
</script>

<template>
    <div class="flex h-full min-h-0">
        <!-- list -->
        <div class="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-e border-default p-2">
            <div class="flex items-center gap-0.5">
                <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-undo-2" :disabled="!tab.undo.length" aria-label="Undo" @click="$t.undo(tab)" />
                <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-redo-2" :disabled="!tab.redo.length" aria-label="Redo" @click="$t.redo(tab)" />
            </div>
            <section class="flex flex-col gap-0.5">
                <div class="flex items-center gap-1 px-1">
                    <span class="text-xs font-medium text-muted">Prefabs</span>
                    <div class="flex-1" />
                    <UButton icon="i-lucide-plus" size="xs" variant="ghost" color="neutral" aria-label="Add prefab" @click="addingPrefab = true" />
                </div>
                <UInput v-model="prefabSearch" size="xs" icon="i-lucide-search" placeholder="Search" class="mx-1 mb-1" />
                <div v-if="addingPrefab" class="flex items-center gap-1 px-1">
                    <UInput
                        v-model="newPrefabName"
                        size="xs"
                        placeholder="Prefab name"
                        class="min-w-0 flex-1"
                        autofocus
                        @keydown.enter.prevent="commitAddPrefab"
                        @keydown.escape="addingPrefab = false; newPrefabName = ''"
                        @blur="commitAddPrefab"
                    />
                    <UButton icon="i-lucide-check" size="xs" variant="soft" color="neutral" :disabled="!newPrefabValid" aria-label="Confirm" @click="commitAddPrefab" />
                </div>
                <div
                    v-for="[name] in filteredPrefabs"
                    :key="name"
                    class="group flex items-center gap-1 rounded-md px-1 py-0.5"
                    :class="selectedPrefabName === name ? 'bg-elevated' : 'hover:bg-elevated/50'"
                    @click="selectPrefab(name)"
                >
                    <UIcon name="i-lucide-package" class="size-3.5 shrink-0 text-dimmed" />
                    <UInput
                        v-if="renamingPrefab === name"
                        v-model="renamePrefabDraft"
                        size="xs"
                        class="min-w-0 flex-1"
                        autofocus
                        @keydown.enter.prevent="commitRenamePrefab(name)"
                        @keydown.escape="renamingPrefab = null"
                        @blur="commitRenamePrefab(name)"
                    />
                    <span v-else class="min-w-0 flex-1 cursor-pointer truncate text-sm" @dblclick.prevent="startRenamePrefab(name)">{{ name }}</span>
                    <div class="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                        <UButton icon="i-lucide-pencil" size="xs" variant="ghost" color="neutral" aria-label="Rename" @click.stop="startRenamePrefab(name)" />
                        <UButton icon="i-lucide-copy" size="xs" variant="ghost" color="neutral" aria-label="Duplicate" @click.stop="duplicatePrefab(name)" />
                        <UButton icon="i-lucide-trash" size="xs" variant="ghost" color="neutral" aria-label="Delete" @click.stop="deletePrompt = { kind: 'prefab', name }" />
                    </div>
                </div>
                <div v-if="!filteredPrefabs.length" class="px-1 text-xs text-dimmed">No prefabs</div>
            </section>

            <section class="flex flex-col gap-0.5">
                <div class="flex items-center gap-1 px-1">
                    <span class="text-xs font-medium text-muted">Collider groups</span>
                    <div class="flex-1" />
                    <UButton icon="i-lucide-plus" size="xs" variant="ghost" color="neutral" aria-label="Add collider group" @click="addingCollider = true" />
                </div>
                <UInput v-model="colliderSearch" size="xs" icon="i-lucide-search" placeholder="Search" class="mx-1 mb-1" />
                <div v-if="addingCollider" class="flex items-center gap-1 px-1">
                    <UInput
                        v-model="newColliderName"
                        size="xs"
                        placeholder="Group name"
                        class="min-w-0 flex-1"
                        autofocus
                        @keydown.enter.prevent="commitAddCollider"
                        @keydown.escape="addingCollider = false; newColliderName = ''"
                        @blur="commitAddCollider"
                    />
                    <UButton icon="i-lucide-check" size="xs" variant="soft" color="neutral" :disabled="!newColliderValid" aria-label="Confirm" @click="commitAddCollider" />
                </div>
                <div
                    v-for="[name] in filteredColliders"
                    :key="name"
                    class="group flex items-center gap-1 rounded-md px-1 py-0.5"
                    :class="selectedColliderName === name ? 'bg-elevated' : 'hover:bg-elevated/50'"
                    @click="selectCollider(name)"
                >
                    <UIcon name="i-lucide-shield" class="size-3.5 shrink-0 text-dimmed" />
                    <UInput
                        v-if="renamingCollider === name"
                        v-model="renameColliderDraft"
                        size="xs"
                        class="min-w-0 flex-1"
                        autofocus
                        @keydown.enter.prevent="commitRenameCollider(name)"
                        @keydown.escape="renamingCollider = null"
                        @blur="commitRenameCollider(name)"
                    />
                    <span v-else class="min-w-0 flex-1 cursor-pointer truncate text-sm" @dblclick.prevent="startRenameCollider(name)">{{ name }}</span>
                    <div class="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                        <UButton icon="i-lucide-pencil" size="xs" variant="ghost" color="neutral" aria-label="Rename" @click.stop="startRenameCollider(name)" />
                        <UButton icon="i-lucide-copy" size="xs" variant="ghost" color="neutral" aria-label="Duplicate" @click.stop="duplicateCollider(name)" />
                        <UButton icon="i-lucide-trash" size="xs" variant="ghost" color="neutral" aria-label="Delete" @click.stop="deletePrompt = { kind: 'collider', name }" />
                    </div>
                </div>
                <div v-if="!filteredColliders.length" class="px-1 text-xs text-dimmed">No collider groups</div>
            </section>
        </div>

        <!-- detail -->
        <div class="min-w-0 flex-1 overflow-y-auto p-4">
            <template v-if="selectedPrefab">
                <div class="mb-4">
                    <h2 class="truncate text-lg font-semibold text-highlighted">{{ selectedPrefabName }}</h2>
                    <p class="mt-0.5 text-xs text-muted">Used by {{ selectedUsage }} cells/objects across open maps.</p>
                </div>
                <div class="flex flex-col gap-4">
                    <UFormField label="Tags">
                        <UInputTags v-model="prefabTags" />
                    </UFormField>
                    <UFormField label="Collider group">
                        <USelectMenu v-model="prefabCollider" :items="colliderOptions" value-key="value" />
                    </UFormField>
                    <template v-if="schema">
                        <InspectorEntryList v-model="prefabSpecs" :schema="schema" kind="spec" />
                    </template>
                    <UAlert v-else color="warning" variant="subtle" icon="i-lucide-triangle-alert" title="Schema not loaded" description="Specs can't be edited until the game is built. Name, tags and collider group stay editable." />
                </div>
            </template>

            <template v-else-if="selectedCollider">
                <div class="mb-4">
                    <h2 class="truncate text-lg font-semibold text-highlighted">{{ selectedColliderName }}</h2>
                </div>
                <div class="flex flex-col gap-4">
                    <UFormField label="Tags">
                        <UInputTags v-model="colliderTags" />
                    </UFormField>
                    <p class="text-xs text-muted">Every cell of prefabs in this group merges into box colliders; these specs land on each merged collider object.</p>
                    <template v-if="schema">
                        <InspectorEntryList v-model="colliderSpecs" :schema="schema" kind="spec" />
                    </template>
                    <UAlert v-else color="warning" variant="subtle" icon="i-lucide-triangle-alert" title="Schema not loaded" description="Specs can't be edited until the game is built. Name and tags stay editable." />
                </div>
            </template>

            <UEmpty v-else icon="i-lucide-boxes" title="Nothing selected" description="Pick a prefab or collider group to edit it." />
        </div>

        <UModal v-model:open="renameOpen" title="Rename prefab" :description="renameDescription">
            <template #footer>
                <UButton label="Cancel" color="neutral" variant="outline" @click="renamePrompt = null" />
                <UButton label="Update open maps" color="primary" @click="confirmRename" />
            </template>
        </UModal>

        <UModal v-model:open="deleteOpen" title="Delete" :description="deleteDescription">
            <template #footer>
                <UButton label="Cancel" color="neutral" variant="outline" @click="deletePrompt = null" />
                <UButton label="Delete" color="error" @click="confirmDelete" />
            </template>
        </UModal>
    </div>
</template>
