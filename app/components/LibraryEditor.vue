<script setup lang="ts">
import type { TabsItem, TreeItem } from '@nuxt/ui'
import type { NeoColliderGroup, NeoEntry, NeoPrefab, NeoPrefabLibraryFile } from '#shared/types/neo'
import { splitName } from '~/utils/names'

const props = defineProps<{ tab: LibraryTab }>()

const project = useProject()
const $t = useAppTabs()
const toast = useToast()

const schema = computed(() => project.state.value?.schema ?? null)

// The library tab only exists with an open project; make sure the record is present before editing it in place.
if (project.state.value) project.state.value.libraries[props.tab.name] ??= { prefabs: {}, colliders: {} }

const lib = computed<NeoPrefabLibraryFile>(() => project.state.value?.libraries[props.tab.name] ?? { prefabs: {}, colliders: {} })

type Kind = 'prefab' | 'collider'

const selection = computed(() => {
    const s = props.tab.selection
    return (s.kind === 'prefab' || s.kind === 'collider') && s.library === props.tab.name ? s : null
})

const selectedPrefabName = computed(() => (selection.value?.kind === 'prefab' ? selection.value.name : null))
const selectedColliderName = computed(() => (selection.value?.kind === 'collider' ? selection.value.name : null))
const selectedPrefab = computed<NeoPrefab | null>(() => (selectedPrefabName.value ? (lib.value.prefabs?.[selectedPrefabName.value] ?? null) : null))
const selectedCollider = computed(() => (selectedColliderName.value ? (lib.value.colliders?.[selectedColliderName.value] ?? null) : null))

function select(kind: Kind, name: string) {
    props.tab.selection = { kind, library: props.tab.name, name }
}

// read-only view of a record; writers create it with ??= so reading never makes the library dirty
const recordOf = (kind: Kind): Record<string, unknown> => (kind === 'prefab' ? lib.value.prefabs : lib.value.colliders) ?? {}

/** Why `name` can't be a prefab/collider-group key here (`self` = the name being renamed), or null. */
const keyError = (kind: Kind, name: string, self?: string) =>
    keyNameError(name) ?? (name !== self && name in recordOf(kind) ? `'${name}' already exists` : null)

// ---- panes ----
const left = reactive(useResizable('neo-library-tree', { side: 'left', minSize: 180, maxSize: 480, defaultSize: 240, unit: 'px', storage: 'local' }))
const right = reactive(useResizable('neo-library-detail', { side: 'right', minSize: 300, maxSize: 1000, defaultSize: 420, unit: 'px', storage: 'local' }))

const views: TabsItem[] = [
    { label: 'Prefabs', value: 'prefabs', icon: 'i-lucide-package' },
    { label: 'Collider groups', value: 'colliders', icon: 'i-lucide-shield' },
]
const view = ref<'prefabs' | 'colliders'>(selection.value?.kind === 'collider' ? 'colliders' : 'prefabs')

// ---- folders ----
// Folders exist while a prefab has them (parity: the file has no place for an empty one). Empty folders the user
// creates live in localStorage until a prefab moves in; they aren't promised to survive anything else.
const emptyStore = useLocalStorage<Record<string, string[]>>('neo-library-empty-folders', {})
const emptyFolders = computed({
    get: () => emptyStore.value[props.tab.name] ?? [],
    set: (v: string[]) => { emptyStore.value[props.tab.name] = [...new Set(v)].filter(Boolean) },
})

const prefabFolders = computed(() => [...new Set(Object.values(lib.value.prefabs ?? {}).map(d => d.folder ?? '').filter(Boolean))])

// trailing '/' makes foldersOf include the folder itself, not only its parents
const allFolders = computed(() => foldersOf([...prefabFolders.value, ...emptyFolders.value].map(f => f + '/')))

const inOrBelow = (f: string, folder: string) => f === folder || f.startsWith(folder + '/')

// once a prefab moves into an empty folder (or below it), the file carries it
watch(prefabFolders, (used) => {
    const kept = emptyFolders.value.filter(e => !used.some(f => inOrBelow(f, e)))
    if (kept.length !== emptyFolders.value.length) emptyFolders.value = kept
}, { immediate: true })

/** `f` after the folder `from` became `to` (`to` = "" dissolves it into the root). */
const relocate = (f: string, from: string, to: string) => (inOrBelow(f, from) ? (f === from ? to : joinName(to, f.slice(from.length + 1))) : f)

function setFolder(def: NeoPrefab, folder: string) {
    // parity: omit `folder` at the root
    if (folder) def.folder = folder
    else delete def.folder
}

const folder = ref(selectedPrefab.value?.folder ?? '')
watch(allFolders, (list) => { if (folder.value && !list.includes(folder.value)) folder.value = '' })

// prefabs in a folder and everything below it (a parent with only subfolders isn't "empty"); '' = whole library
const countIn = computed(() => {
    const out: Record<string, number> = {}
    for (const def of Object.values(lib.value.prefabs ?? {})) {
        const parts = (def.folder ?? '').split('/').filter(Boolean)
        for (let i = 0; i <= parts.length; i++) {
            const key = parts.slice(0, i).join('/')
            out[key] = (out[key] ?? 0) + 1
        }
    }
    return out
})

type FolderItem = TreeItem & { value: string, folder: string, children?: FolderItem[] }

const ROOT_KEY = '/' // folder paths never start with '/', so this can't collide

const treeItems = computed<FolderItem[]>(() => {
    const nodes: Record<string, FolderItem> = {}
    const top: FolderItem[] = []
    for (const f of allFolders.value) { // sorted: parents come before their children
        const [parent, leaf] = splitName(f)
        const node: FolderItem = { label: leaf, value: f, folder: f, icon: 'i-lucide-folder' }
        nodes[f] = node
        const p = nodes[parent]
        if (p) {
            (p.children ??= []).push(node)
            p.icon = undefined // parents get the tree's open/closed folder icon
        }
        else top.push(node)
    }
    return [{ label: 'Library root', value: ROOT_KEY, folder: '', icon: 'i-lucide-library' }, ...top]
})

// UTree matches the selected item by getKey, so a stand-in with the same value is enough
const treeValue = computed<FolderItem>(() => ({ value: folder.value || ROOT_KEY, folder: folder.value }))

const expandedStore = useLocalStorage<Record<string, string[]>>('neo-library-expanded', {})
const expanded = computed({
    get: () => expandedStore.value[props.tab.name] ?? [],
    set: (v: string[]) => { expandedStore.value[props.tab.name] = v },
})

function openFolder(f: string) {
    folder.value = f
    view.value = 'prefabs'
    expanded.value = [...new Set([...expanded.value, ...foldersOf([f])])]
}

const crumbs = computed(() => folder.value
    ? folder.value.split('/').map((label, i, all) => ({ label, folder: all.slice(0, i + 1).join('/') }))
    : [])

/** Why `f` can't be a (new or renamed) folder, or null. `self` = the folder being renamed. */
function folderNameError(f: string, self?: string): string | null {
    if (!f) return 'name is required'
    if (self && f.startsWith(self + '/')) return 'can\'t move a folder into itself'
    return folderError(f) ?? (f !== self && allFolders.value.includes(f) ? 'folder already exists' : null)
}

function newFolder() {
    const parent = folder.value
    openPrompt({
        title: 'New folder',
        description: parent ? `Inside ${parent}` : 'At the library root',
        initial: '',
        placeholder: 'Folder name',
        help: 'Use / to nest. An empty folder only lives in the editor until a prefab is moved into it.',
        confirm: 'Create',
        validate: n => n ? folderNameError(joinName(parent, n)) : 'name is required',
        submit: (n) => {
            const f = joinName(parent, n)
            emptyFolders.value = [...emptyFolders.value, f]
            openFolder(f)
        },
    })
}

function renameFolder(from: string) {
    openPrompt({
        title: 'Rename folder',
        description: 'Moves every prefab in it and its subfolders. Prefab names (and so map references) stay the same.',
        initial: from,
        help: 'Full path; use / to nest.',
        confirm: 'Rename',
        validate: n => folderNameError(n, from),
        submit: to => moveFolder(from, to),
    })
}

/** Re-homes every prefab/empty folder in or below `from` to `to` ("" = dissolve into the parent's place). */
function moveFolder(from: string, to: string) {
    const affected = Object.values(lib.value.prefabs ?? {}).filter(d => d.folder && inOrBelow(d.folder, from))
    if (affected.length) $t.checkpoint(props.tab)
    for (const def of affected) setFolder(def, relocate(def.folder!, from, to))
    emptyFolders.value = emptyFolders.value.map(f => relocate(f, from, to))
    expanded.value = expanded.value.map(k => relocate(k, from, to))
    folder.value = relocate(folder.value, from, to)
}

function deleteFolder(f: string) {
    const count = Object.values(lib.value.prefabs ?? {}).filter(d => d.folder && inOrBelow(d.folder, f)).length
    if (!count) {
        emptyFolders.value = emptyFolders.value.filter(e => !inOrBelow(e, f))
        folder.value = splitName(f)[0]
        return
    }
    const parent = splitName(f)[0]
    confirmBox.value = {
        title: 'Delete folder',
        description: `"${f}" holds ${count} prefab${count === 1 ? '' : 's'} (subfolders included). They move to ${parent || 'the library root'}; nothing is deleted or renamed.`,
        confirm: 'Move prefabs and delete',
        color: 'error',
        run: () => moveFolder(f, parent),
    }
}

// ---- grid ----
const query = ref('')
const flatten = useLocalStorage('neo-library-all-folders', false)
const sortDesc = useLocalStorage('neo-library-sort-desc', false)

function matches(name: string, def: { tags?: string[], folder?: string }): boolean {
    const needle = query.value.trim().toLowerCase()
    return !needle || name.toLowerCase().includes(needle) || (def.folder ?? '').toLowerCase().includes(needle)
        || (def.tags ?? []).some(t => t.toLowerCase().includes(needle))
}

function sorted<T>(list: [string, T][]): [string, T][] {
    list.sort(([a], [b]) => a.localeCompare(b))
    return sortDesc.value ? list.reverse() : list
}

const visiblePrefabs = computed(() => sorted(Object.entries(lib.value.prefabs ?? {})
    .filter(([name, def]) => (flatten.value || (def.folder ?? '') === folder.value) && matches(name, def))))

const subfolders = computed(() => {
    if (flatten.value) return []
    const needle = query.value.trim().toLowerCase()
    return allFolders.value.filter(f => splitName(f)[0] === folder.value && (!needle || f.toLowerCase().includes(needle)))
})

const visibleColliders = computed(() => sorted(Object.entries(lib.value.colliders ?? {}).filter(([name, def]) => matches(name, def))))

// texture thumbnails keyed by asset path (survive renames), with the canvas's deterministic swatch as fallback
const thumbs = reactive<Record<string, string | null>>({})

const assetPaths = computed(() => {
    const s = schema.value
    const out: Record<string, string> = {}
    if (!s) return out
    for (const [name, def] of Object.entries(lib.value.prefabs ?? {})) {
        const path = previewAsset(s, def.specs)
        if (path) out[name] = path
    }
    return out
})

watch(assetPaths, (paths) => {
    for (const path of Object.values(paths)) {
        if (path in thumbs) continue
        thumbs[path] = null
        project.assetUrl(path).then(url => { thumbs[path] = url })
    }
}, { immediate: true })

const thumbOf = (name: string) => thumbs[assetPaths.value[name] ?? ''] ?? null
const swatchOf = (name: string) => colorOf(name, assetPaths.value[name] ?? null)

// ---- detail bindings: v-model setters are the commit points, so they checkpoint first ----
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
const prefabFolder = computed<string>({
    get: () => selectedPrefab.value?.folder ?? '',
    set: v => { if (selectedPrefab.value) { $t.checkpoint(props.tab); setFolder(selectedPrefab.value, v) } },
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

const folderOptions = computed(() => [
    { label: 'Library root', value: '', icon: 'i-lucide-library' },
    ...allFolders.value.map(f => ({ label: f, value: f, icon: 'i-lucide-folder' })),
])

// ---- usage ----
function mapTabsUsingPrefab(name: string): MapTab[] {
    return $t.tabs.value.filter((t): t is MapTab =>
        t.kind === 'map'
        && t.map.libraries.includes(props.tab.name)
        && (t.map.layers.some(l => l.cells.includes(name)) || t.map.objects.some(o => o.prefab === name)),
    )
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

const colliderUsage = computed(() => {
    const out: Record<string, number> = {}
    for (const def of Object.values(lib.value.prefabs ?? {})) if (def.collider) out[def.collider] = (out[def.collider] ?? 0) + 1
    return out
})

const selectedUsage = computed(() => (selectedPrefabName.value ? prefabUsage(selectedPrefabName.value) : 0))

// ---- name prompt (create / folder rename) and confirm modal ----
interface Prompt {
    title: string
    description?: string
    initial: string
    placeholder?: string
    help?: string
    confirm: string
    validate: (name: string) => string | null
    submit: (name: string) => void
}
const prompt = ref<Prompt | null>(null)
const promptKey = ref(0)
function openPrompt(p: Prompt) {
    prompt.value = p
    promptKey.value++ // fresh draft every time
}
const promptOpen = computed({ get: () => !!prompt.value, set: (v) => { if (!v) prompt.value = null } })

function submitPrompt(name: string) {
    const p = prompt.value
    prompt.value = null
    p?.submit(name)
}

interface Confirm { title: string, description: string, confirm: string, color: 'primary' | 'error', run: () => void | Promise<void> }
const confirmBox = ref<Confirm | null>(null)
const busy = ref(false)
const confirmOpen = computed({ get: () => !!confirmBox.value, set: (v) => { if (!v && !busy.value) confirmBox.value = null } })

async function runConfirm() {
    const c = confirmBox.value
    if (!c) return
    busy.value = true
    try { await c.run() }
    finally {
        busy.value = false
        confirmBox.value = null
    }
}

const fail = (title: string, e: unknown) => toast.add({ title, description: e instanceof Error ? e.message : String(e), color: 'error' })

// ---- add ----
function newEntry(kind: Kind) {
    const where = folder.value
    openPrompt({
        title: kind === 'prefab' ? 'New prefab' : 'New collider group',
        description: kind === 'prefab' ? (where ? `In ${where}` : 'At the library root') : undefined,
        initial: '',
        placeholder: kind === 'prefab' ? 'Prefab name' : 'Group name',
        confirm: 'Create',
        validate: n => keyError(kind, n),
        submit: (name) => {
            $t.checkpoint(props.tab)
            if (kind === 'prefab') (lib.value.prefabs ??= {})[name] = where ? { folder: where, specs: [] } : { specs: [] }
            else (lib.value.colliders ??= {})[name] = {}
            select(kind, name)
        },
    })
}

// ---- rename ----
const renaming = ref<{ kind: Kind, name: string, where: 'card' | 'detail' } | null>(null)
const isRenaming = (kind: Kind, name: string, where: 'card' | 'detail') =>
    renaming.value?.kind === kind && renaming.value.name === name && renaming.value.where === where

function rekey<T>(record: Record<string, T>, from: string, to: string): Record<string, T> {
    const out: Record<string, T> = {}
    for (const [key, value] of Object.entries(record)) out[key === from ? to : key] = value
    return out
}

/** Renames the key in the library (keeping its position) and every in-library reference to it. */
function rekeyEntry(kind: Kind, from: string, to: string) {
    if (kind === 'prefab') lib.value.prefabs = rekey(lib.value.prefabs ?? {}, from, to)
    else {
        lib.value.colliders = rekey(lib.value.colliders ?? {}, from, to)
        for (const def of Object.values(lib.value.prefabs ?? {}))
            if (def.collider === from) def.collider = to
    }
    if (selection.value?.kind === kind && selection.value.name === from) select(kind, to)
}

function submitRename(kind: Kind, from: string, to: string) {
    renaming.value = null
    if (kind === 'prefab') return renamePrefab(from, to)
    $t.checkpoint(props.tab)
    rekeyEntry('collider', from, to)
}

async function renamePrefab(from: string, to: string) {
    let refs: number
    try { refs = await project.countReferences({ kind: 'prefab', library: props.tab.name, from, to }) }
    catch (e) { return fail('Rename failed', e) }
    const open = mapTabsUsingPrefab(from).length
    if (!refs && !open) {
        $t.checkpoint(props.tab)
        rekeyEntry('prefab', from, to)
        return
    }
    confirmBox.value = {
        title: 'Rename prefab',
        description: `Renaming "${from}" to "${to}". ${refs} reference${refs === 1 ? '' : 's'} in saved maps${open ? ` and ${open} open map${open === 1 ? '' : 's'}` : ''} will be rewritten and this library will be saved.`,
        confirm: 'Rename and save',
        color: 'primary',
        run: async () => {
            try {
                $t.checkpoint(props.tab) // lets the user undo the in-memory re-key if a write below fails
                rekeyEntry('prefab', from, to)
                // save first: maps rewritten on disk must never point at a key the saved library doesn't have yet
                await $t.save(props.tab)
                const changed = await $t.renamePrefabRefs(props.tab.name, from, to)
                // undo/redo snapshots from before a cross-file rename hold the old key while the maps on disk now use
                // the new one; restoring any of them would break those maps, so the history ends here
                props.tab.undo.length = 0
                props.tab.redo.length = 0
                toast.add({ title: 'Prefab renamed', description: `${changed} map reference${changed === 1 ? '' : 's'} rewritten.`, color: 'success', duration: 2500 })
            }
            catch (e) { fail('Rename failed', e) }
        },
    }
}

// ---- duplicate / delete ----
function uniqueKey(record: Record<string, unknown>, base: string): string {
    let name = base
    let n = 2
    while (name in record) name = `${base}-${n++}`
    return name
}

function duplicate(kind: Kind, name: string) {
    const def = recordOf(kind)[name]
    if (!def) return
    const copy = uniqueKey(recordOf(kind), `${name}-copy`)
    const error = keyError(kind, copy)
    if (error) return toast.add({ title: 'Can\'t duplicate', description: `"${copy}": ${error}`, color: 'error' })
    $t.checkpoint(props.tab)
    if (kind === 'prefab') (lib.value.prefabs ??= {})[copy] = deepClone(def as NeoPrefab)
    else (lib.value.colliders ??= {})[copy] = deepClone(def as NeoColliderGroup)
    select(kind, copy)
}

function askDelete(kind: Kind, name: string) {
    const used = kind === 'prefab' ? prefabUsage(name) : (colliderUsage.value[name] ?? 0)
    confirmBox.value = {
        title: kind === 'prefab' ? 'Delete prefab' : 'Delete collider group',
        description: kind === 'prefab'
            ? `"${name}" is used by ${used} cells/objects in open maps.`
            : `"${name}" is used by ${used} prefab${used === 1 ? '' : 's'} in this library; they lose their group.`,
        confirm: 'Delete',
        color: 'error',
        run: () => {
            $t.checkpoint(props.tab)
            if (kind === 'prefab') delete lib.value.prefabs?.[name]
            else {
                delete lib.value.colliders?.[name]
                for (const def of Object.values(lib.value.prefabs ?? {}))
                    if (def.collider === name) def.collider = undefined
            }
            if (selection.value?.kind === kind && selection.value.name === name) props.tab.selection = { kind: 'map' }
        },
    }
}

const tagsOf = (def: { tags?: string[] }) => def.tags ?? []
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
</script>

<template>
    <div class="flex h-full min-h-0">
        <!-- left: folders / collider groups -->
        <div :ref="el => left.el = el as HTMLElement" class="relative flex shrink-0 flex-col border-e border-default bg-elevated/25" :style="{ width: `${left.size}px` }">
            <div class="flex flex-col gap-2 border-b border-default p-2">
                <div class="flex items-center gap-2 px-1 pt-0.5">
                    <UIcon name="i-lucide-library-big" class="size-4 shrink-0 text-primary" />
                    <span class="min-w-0 flex-1 truncate text-sm font-semibold text-highlighted" :title="tab.name">{{ tab.name }}</span>
                </div>
                <UTabs v-model="view" :items="views" :content="false" size="xs" class="w-full" />
            </div>

            <template v-if="view === 'prefabs'">
                <div class="flex items-center gap-0.5 px-2 pt-2">
                    <span class="flex-1 px-1 text-xs font-medium text-muted">Folders</span>
                    <UTooltip text="New folder">
                        <UButton icon="i-lucide-folder-plus" size="xs" variant="ghost" color="neutral" aria-label="New folder" @click="newFolder" />
                    </UTooltip>
                    <UTooltip text="Rename folder">
                        <UButton icon="i-lucide-pencil" size="xs" variant="ghost" color="neutral" :disabled="!folder" aria-label="Rename folder" @click="renameFolder(folder)" />
                    </UTooltip>
                    <UTooltip text="Delete folder">
                        <UButton icon="i-lucide-folder-x" size="xs" variant="ghost" color="neutral" :disabled="!folder" aria-label="Delete folder" @click="deleteFolder(folder)" />
                    </UTooltip>
                </div>
                <UTree
                    v-model:expanded="expanded"
                    :model-value="treeValue"
                    :items="treeItems"
                    :get-key="(i: FolderItem) => i.value"
                    selection-behavior="replace"
                    color="neutral"
                    size="sm"
                    class="min-h-0 flex-1 overflow-y-auto p-2"
                    @update:model-value="(i: FolderItem | undefined) => i && openFolder(i.folder)"
                >
                    <template #item-trailing="{ item }">
                        <span class="text-xs tabular-nums text-dimmed">{{ countIn[item.folder] ?? 0 }}</span>
                        <UIcon v-if="item.children?.length" name="i-lucide-chevron-down" class="size-4 shrink-0 transition-transform duration-200 group-data-expanded:rotate-180" />
                    </template>
                </UTree>
            </template>

            <div v-else class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
                <div class="flex items-center gap-0.5">
                    <span class="flex-1 px-1 text-xs font-medium text-muted">Groups</span>
                    <UTooltip text="New collider group">
                        <UButton icon="i-lucide-plus" size="xs" variant="ghost" color="neutral" aria-label="New collider group" @click="newEntry('collider')" />
                    </UTooltip>
                </div>
                <button
                    v-for="[name] in visibleColliders"
                    :key="name"
                    type="button"
                    class="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm"
                    :class="selectedColliderName === name ? 'bg-elevated text-highlighted' : 'hover:bg-elevated/50'"
                    @click="select('collider', name)"
                >
                    <UIcon name="i-lucide-shield" class="size-4 shrink-0 text-muted" />
                    <span class="min-w-0 flex-1 truncate text-start">{{ name }}</span>
                    <span class="text-xs tabular-nums text-dimmed">{{ colliderUsage[name] ?? 0 }}</span>
                </button>
                <p class="px-1 pt-2 text-xs text-dimmed">Prefabs in a group merge their cells into shared box colliders.</p>
            </div>

            <div
                role="separator"
                class="group absolute inset-y-0 -end-0.5 z-10 flex w-1 cursor-col-resize justify-center"
                @mousedown="left.onMouseDown"
                @touchstart="left.onTouchStart"
                @dblclick="left.onDoubleClick"
            >
                <div class="w-px transition-colors group-hover:bg-primary" :class="left.isDragging && 'bg-primary'" />
            </div>
        </div>

        <!-- center: asset grid -->
        <div class="flex min-w-0 flex-1 flex-col">
            <div class="flex flex-wrap items-center gap-2 border-b border-default px-3 py-2">
                <nav v-if="view === 'prefabs'" class="flex min-w-0 items-center gap-0.5 text-sm" aria-label="Folder">
                    <UButton :label="flatten ? 'All folders' : 'Root'" icon="i-lucide-library" size="xs" variant="ghost" :color="folder || flatten ? 'neutral' : 'primary'" @click="openFolder('')" />
                    <template v-if="!flatten">
                        <template v-for="c in crumbs" :key="c.folder">
                            <UIcon name="i-lucide-chevron-right" class="size-3.5 shrink-0 text-dimmed" />
                            <UButton :label="c.label" size="xs" variant="ghost" :color="c.folder === folder ? 'primary' : 'neutral'" class="min-w-0" @click="openFolder(c.folder)" />
                        </template>
                    </template>
                </nav>
                <span v-else class="px-1 text-sm font-medium text-highlighted">Collider groups</span>
                <div class="flex-1" />
                <UInput v-model="query" icon="i-lucide-search" size="sm" :placeholder="view === 'prefabs' ? 'Search names, tags, folders' : 'Search groups'" class="w-56">
                    <template v-if="query" #trailing>
                        <UButton icon="i-lucide-x" size="xs" variant="link" color="neutral" aria-label="Clear search" @click="query = ''" />
                    </template>
                </UInput>
                <UTooltip v-if="view === 'prefabs'" text="Show prefabs from every folder">
                    <UButton icon="i-lucide-layers" label="All folders" size="sm" color="neutral" :variant="flatten ? 'soft' : 'ghost'" :aria-pressed="flatten" @click="flatten = !flatten" />
                </UTooltip>
                <UTooltip :text="sortDesc ? 'Name, Z to A' : 'Name, A to Z'">
                    <UButton :icon="sortDesc ? 'i-lucide-arrow-down-z-a' : 'i-lucide-arrow-down-a-z'" size="sm" color="neutral" variant="ghost" aria-label="Sort by name" @click="sortDesc = !sortDesc" />
                </UTooltip>
                <div class="flex items-center">
                    <UButton icon="i-lucide-undo-2" size="sm" color="neutral" variant="ghost" :disabled="!tab.undo.length" aria-label="Undo" @click="$t.undo(tab)" />
                    <UButton icon="i-lucide-redo-2" size="sm" color="neutral" variant="ghost" :disabled="!tab.redo.length" aria-label="Redo" @click="$t.redo(tab)" />
                </div>
                <UButton v-if="view === 'prefabs'" icon="i-lucide-plus" label="New prefab" size="sm" @click="newEntry('prefab')" />
                <UButton v-else icon="i-lucide-plus" label="New group" size="sm" @click="newEntry('collider')" />
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto p-3" @click.self="tab.selection = { kind: 'map' }">
                <template v-if="view === 'prefabs'">
                    <div v-if="subfolders.length || visiblePrefabs.length" class="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
                        <button
                            v-for="f in subfolders"
                            :key="`folder:${f}`"
                            type="button"
                            class="group flex flex-col overflow-hidden rounded-lg border border-default bg-default text-start transition-colors hover:border-accented hover:bg-elevated/40"
                            :title="f"
                            @click="openFolder(f)"
                        >
                            <div class="flex aspect-square items-center justify-center bg-elevated/40">
                                <UIcon name="i-lucide-folder" class="size-14 text-muted transition-colors group-hover:text-primary" />
                            </div>
                            <div class="flex flex-col gap-0.5 p-2">
                                <span class="truncate text-sm font-medium text-highlighted">{{ splitName(f)[1] }}</span>
                                <span class="text-xs text-dimmed">{{ plural(countIn[f] ?? 0, 'prefab') }}</span>
                            </div>
                        </button>

                        <div
                            v-for="[name, def] in visiblePrefabs"
                            :key="name"
                            class="group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-default transition-colors"
                            :class="selectedPrefabName === name ? 'border-primary ring-2 ring-primary/40' : 'border-default hover:border-accented'"
                            @click="select('prefab', name)"
                        >
                            <div class="relative aspect-square bg-[repeating-conic-gradient(var(--ui-bg-elevated)_0_25%,var(--ui-bg)_0_50%)] bg-[length:16px_16px]">
                                <img v-if="thumbOf(name)" :src="thumbOf(name)!" alt="" class="size-full object-contain p-2 [image-rendering:pixelated]">
                                <div v-else class="flex size-full items-center justify-center" :style="{ background: swatchOf(name) }">
                                    <UIcon name="i-lucide-package" class="size-8 text-white/60" />
                                </div>
                                <UBadge v-if="def.collider" :label="def.collider" icon="i-lucide-shield" size="xs" color="neutral" variant="solid" class="absolute bottom-1.5 start-1.5 max-w-[calc(100%-0.75rem)]" />
                                <div class="absolute end-1 top-1 hidden items-center gap-0.5 rounded-md bg-default/90 p-0.5 shadow-sm ring ring-default group-hover:flex">
                                    <UButton icon="i-lucide-pencil" size="xs" variant="ghost" color="neutral" aria-label="Rename" @click.stop="renaming = { kind: 'prefab', name, where: 'card' }" />
                                    <UButton icon="i-lucide-copy" size="xs" variant="ghost" color="neutral" aria-label="Duplicate" @click.stop="duplicate('prefab', name)" />
                                    <UButton icon="i-lucide-trash" size="xs" variant="ghost" color="error" aria-label="Delete" @click.stop="askDelete('prefab', name)" />
                                </div>
                            </div>
                            <div class="flex min-w-0 flex-col gap-1 p-2">
                                <LibraryNameField
                                    v-if="isRenaming('prefab', name, 'card')"
                                    :initial="name"
                                    :validate="n => keyError('prefab', n, name)"
                                    commit-on-blur
                                    size="xs"
                                    @submit="to => submitRename('prefab', name, to)"
                                    @cancel="renaming = null"
                                />
                                <span v-else class="truncate text-sm font-medium text-highlighted" :title="name" @dblclick.stop="renaming = { kind: 'prefab', name, where: 'card' }">{{ name }}</span>
                                <span v-if="flatten" class="flex items-center gap-1 truncate text-xs text-dimmed">
                                    <UIcon :name="def.folder ? 'i-lucide-folder' : 'i-lucide-library'" class="size-3 shrink-0" />{{ def.folder || 'root' }}
                                </span>
                                <div v-if="tagsOf(def).length" class="flex min-w-0 gap-1 overflow-hidden">
                                    <UBadge v-for="tag in tagsOf(def).slice(0, 2)" :key="tag" :label="tag" size="xs" variant="soft" color="neutral" class="min-w-0" />
                                    <UBadge v-if="tagsOf(def).length > 2" :label="`+${tagsOf(def).length - 2}`" size="xs" variant="subtle" color="neutral" />
                                </div>
                            </div>
                        </div>
                    </div>
                    <UEmpty
                        v-else
                        :icon="query ? 'i-lucide-search-x' : 'i-lucide-package-open'"
                        :title="query ? 'No matching prefabs' : 'This folder is empty'"
                        :description="query ? 'Try another search, or turn on All folders.' : 'Create a prefab here, or move one in from its folder picker.'"
                        class="h-full"
                    >
                        <template v-if="!query" #actions>
                            <UButton icon="i-lucide-plus" label="New prefab" size="sm" @click="newEntry('prefab')" />
                        </template>
                    </UEmpty>
                </template>

                <template v-else>
                    <div v-if="visibleColliders.length" class="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
                        <div
                            v-for="[name, def] in visibleColliders"
                            :key="name"
                            class="group relative flex cursor-pointer items-center gap-3 rounded-lg border bg-default p-3 transition-colors"
                            :class="selectedColliderName === name ? 'border-primary ring-2 ring-primary/40' : 'border-default hover:border-accented'"
                            @click="select('collider', name)"
                        >
                            <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-elevated">
                                <UIcon name="i-lucide-shield" class="size-5 text-muted" />
                            </div>
                            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                                <LibraryNameField
                                    v-if="isRenaming('collider', name, 'card')"
                                    :initial="name"
                                    :validate="n => keyError('collider', n, name)"
                                    commit-on-blur
                                    size="xs"
                                    @submit="to => submitRename('collider', name, to)"
                                    @cancel="renaming = null"
                                />
                                <span v-else class="truncate text-sm font-medium text-highlighted" :title="name" @dblclick.stop="renaming = { kind: 'collider', name, where: 'card' }">{{ name }}</span>
                                <span class="text-xs text-dimmed">{{ plural(colliderUsage[name] ?? 0, 'prefab') }} · {{ plural(def.specs?.length ?? 0, 'spec') }}</span>
                                <div v-if="tagsOf(def).length" class="flex min-w-0 gap-1 overflow-hidden">
                                    <UBadge v-for="tag in tagsOf(def).slice(0, 2)" :key="tag" :label="tag" size="xs" variant="soft" color="neutral" class="min-w-0" />
                                    <UBadge v-if="tagsOf(def).length > 2" :label="`+${tagsOf(def).length - 2}`" size="xs" variant="subtle" color="neutral" />
                                </div>
                            </div>
                            <div class="absolute end-1 top-1 hidden items-center gap-0.5 rounded-md bg-default/90 p-0.5 shadow-sm ring ring-default group-hover:flex">
                                <UButton icon="i-lucide-pencil" size="xs" variant="ghost" color="neutral" aria-label="Rename" @click.stop="renaming = { kind: 'collider', name, where: 'card' }" />
                                <UButton icon="i-lucide-copy" size="xs" variant="ghost" color="neutral" aria-label="Duplicate" @click.stop="duplicate('collider', name)" />
                                <UButton icon="i-lucide-trash" size="xs" variant="ghost" color="error" aria-label="Delete" @click.stop="askDelete('collider', name)" />
                            </div>
                        </div>
                    </div>
                    <UEmpty
                        v-else
                        :icon="query ? 'i-lucide-search-x' : 'i-lucide-shield'"
                        :title="query ? 'No matching groups' : 'No collider groups'"
                        description="A collider group merges the cells of every prefab in it into as few box colliders as possible."
                        class="h-full"
                    >
                        <template v-if="!query" #actions>
                            <UButton icon="i-lucide-plus" label="New group" size="sm" @click="newEntry('collider')" />
                        </template>
                    </UEmpty>
                </template>
            </div>
        </div>

        <!-- right: detail -->
        <div :ref="el => right.el = el as HTMLElement" class="relative flex shrink-0 flex-col border-s border-default" :style="{ width: `${right.size}px` }">
            <div
                role="separator"
                class="group absolute inset-y-0 -start-0.5 z-10 flex w-1 cursor-col-resize justify-center"
                @mousedown="right.onMouseDown"
                @touchstart="right.onTouchStart"
                @dblclick="right.onDoubleClick"
            >
                <div class="w-px transition-colors group-hover:bg-primary" :class="right.isDragging && 'bg-primary'" />
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto">
                <template v-if="selectedPrefab && selectedPrefabName">
                    <div class="flex items-start gap-3 border-b border-default p-4">
                        <div class="size-16 shrink-0 overflow-hidden rounded-md border border-default bg-[repeating-conic-gradient(var(--ui-bg-elevated)_0_25%,var(--ui-bg)_0_50%)] bg-[length:12px_12px]">
                            <img v-if="thumbOf(selectedPrefabName)" :src="thumbOf(selectedPrefabName)!" alt="" class="size-full object-contain p-1 [image-rendering:pixelated]">
                            <div v-else class="size-full" :style="{ background: swatchOf(selectedPrefabName) }" />
                        </div>
                        <div class="flex min-w-0 flex-1 flex-col gap-1">
                            <LibraryNameField
                                v-if="isRenaming('prefab', selectedPrefabName, 'detail')"
                                :key="selectedPrefabName"
                                :initial="selectedPrefabName"
                                :validate="n => keyError('prefab', n, selectedPrefabName!)"
                                commit-on-blur
                                size="sm"
                                @submit="to => submitRename('prefab', selectedPrefabName!, to)"
                                @cancel="renaming = null"
                            />
                            <h2
                                v-else
                                class="cursor-text truncate text-lg font-semibold text-highlighted"
                                :title="`${selectedPrefabName} · double-click to rename`"
                                @dblclick="renaming = { kind: 'prefab', name: selectedPrefabName, where: 'detail' }"
                            >
                                {{ selectedPrefabName }}
                            </h2>
                            <p class="text-xs text-muted">Used by {{ selectedUsage }} cells/objects across open maps.</p>
                        </div>
                        <div class="flex shrink-0 items-center gap-0.5">
                            <UButton icon="i-lucide-pencil" size="xs" variant="ghost" color="neutral" aria-label="Rename" @click="renaming = { kind: 'prefab', name: selectedPrefabName, where: 'detail' }" />
                            <UButton icon="i-lucide-copy" size="xs" variant="ghost" color="neutral" aria-label="Duplicate" @click="duplicate('prefab', selectedPrefabName)" />
                            <UButton icon="i-lucide-trash" size="xs" variant="ghost" color="error" aria-label="Delete" @click="askDelete('prefab', selectedPrefabName)" />
                        </div>
                    </div>
                    <div class="flex flex-col gap-4 p-4">
                        <div class="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
                            <UFormField label="Folder" help="Editor grouping only; the name stays the same.">
                                <USelectMenu v-model="prefabFolder" :items="folderOptions" value-key="value" icon="i-lucide-folder" class="w-full" />
                            </UFormField>
                            <UFormField label="Collider group">
                                <USelectMenu v-model="prefabCollider" :items="colliderOptions" value-key="value" icon="i-lucide-shield" class="w-full" />
                            </UFormField>
                        </div>
                        <UFormField label="Tags">
                            <UInputTags v-model="prefabTags" class="w-full" />
                        </UFormField>
                        <div class="flex items-center gap-2 border-t border-default pt-4">
                            <span class="text-sm font-medium text-highlighted">Specs</span>
                            <UBadge :label="String(prefabSpecs.length)" size="xs" variant="subtle" color="neutral" />
                        </div>
                        <InspectorEntryList v-if="schema" v-model="prefabSpecs" :schema="schema" kind="spec" columns="auto" />
                        <UAlert v-else color="warning" variant="subtle" icon="i-lucide-triangle-alert" title="Schema not loaded" description="Specs can't be edited until the game is built. Name, folder, tags and collider group stay editable.">
                            <template #actions>
                                <RefreshSpecsButton size="xs" variant="outline" />
                            </template>
                        </UAlert>
                    </div>
                </template>

                <template v-else-if="selectedCollider && selectedColliderName">
                    <div class="flex items-start gap-3 border-b border-default p-4">
                        <div class="flex size-16 shrink-0 items-center justify-center rounded-md border border-default bg-elevated">
                            <UIcon name="i-lucide-shield" class="size-7 text-muted" />
                        </div>
                        <div class="flex min-w-0 flex-1 flex-col gap-1">
                            <LibraryNameField
                                v-if="isRenaming('collider', selectedColliderName, 'detail')"
                                :key="selectedColliderName"
                                :initial="selectedColliderName"
                                :validate="n => keyError('collider', n, selectedColliderName!)"
                                commit-on-blur
                                size="sm"
                                @submit="to => submitRename('collider', selectedColliderName!, to)"
                                @cancel="renaming = null"
                            />
                            <h2
                                v-else
                                class="cursor-text truncate text-lg font-semibold text-highlighted"
                                :title="`${selectedColliderName} · double-click to rename`"
                                @dblclick="renaming = { kind: 'collider', name: selectedColliderName, where: 'detail' }"
                            >
                                {{ selectedColliderName }}
                            </h2>
                            <p class="text-xs text-muted">Used by {{ plural(colliderUsage[selectedColliderName] ?? 0, 'prefab') }} in this library.</p>
                        </div>
                        <div class="flex shrink-0 items-center gap-0.5">
                            <UButton icon="i-lucide-pencil" size="xs" variant="ghost" color="neutral" aria-label="Rename" @click="renaming = { kind: 'collider', name: selectedColliderName, where: 'detail' }" />
                            <UButton icon="i-lucide-copy" size="xs" variant="ghost" color="neutral" aria-label="Duplicate" @click="duplicate('collider', selectedColliderName)" />
                            <UButton icon="i-lucide-trash" size="xs" variant="ghost" color="error" aria-label="Delete" @click="askDelete('collider', selectedColliderName)" />
                        </div>
                    </div>
                    <div class="flex flex-col gap-4 p-4">
                        <UFormField label="Tags">
                            <UInputTags v-model="colliderTags" class="w-full" />
                        </UFormField>
                        <p class="text-xs text-muted">Every cell of prefabs in this group merges into box colliders; these specs land on each merged collider object.</p>
                        <div class="flex items-center gap-2 border-t border-default pt-4">
                            <span class="text-sm font-medium text-highlighted">Specs</span>
                            <UBadge :label="String(colliderSpecs.length)" size="xs" variant="subtle" color="neutral" />
                        </div>
                        <InspectorEntryList v-if="schema" v-model="colliderSpecs" :schema="schema" kind="spec" columns="auto" />
                        <UAlert v-else color="warning" variant="subtle" icon="i-lucide-triangle-alert" title="Schema not loaded" description="Specs can't be edited until the game is built. Name and tags stay editable.">
                            <template #actions>
                                <RefreshSpecsButton size="xs" variant="outline" />
                            </template>
                        </UAlert>
                    </div>
                </template>

                <UEmpty v-else icon="i-lucide-mouse-pointer-click" title="Nothing selected" description="Pick a prefab or collider group to edit it." class="h-full" />
            </div>
        </div>

        <UModal v-model:open="promptOpen" :title="prompt?.title" :description="prompt?.description">
            <template #body>
                <LibraryNameField
                    v-if="prompt"
                    :key="promptKey"
                    :initial="prompt.initial"
                    :validate="prompt.validate"
                    :placeholder="prompt.placeholder"
                    :help="prompt.help"
                    :confirm="prompt.confirm"
                    @submit="submitPrompt"
                    @cancel="prompt = null"
                />
            </template>
        </UModal>

        <UModal v-model:open="confirmOpen" :title="confirmBox?.title" :description="confirmBox?.description" :dismissible="!busy">
            <template #footer>
                <UButton label="Cancel" color="neutral" variant="outline" :disabled="busy" @click="confirmBox = null" />
                <UButton :label="confirmBox?.confirm" :color="confirmBox?.color" :loading="busy" @click="runConfirm" />
            </template>
        </UModal>
    </div>
</template>
