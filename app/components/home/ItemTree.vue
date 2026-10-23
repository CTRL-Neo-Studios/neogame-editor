<script setup lang="ts">
import type { ContextMenuItem, TreeItem } from '@nuxt/ui'
import { useProject } from '~/composables/project/useProject'
import { useAppTabs } from '~/composables/app/useAppTabs'
import { DOC_KINDS, type DocKind } from '~/utils/documents'

// One home-page panel: one document kind's files (maps, prefab libraries, ...) as a folder tree, with create/move/delete.

const props = defineProps<{ kind: DocKind }>()

const project = useProject()
const $t = useAppTabs()
const toast = useToast()

const text = computed(() => DOC_KINDS[props.kind])
// USelect items can't have an empty-string value
const ROOT = '/'

interface Node extends TreeItem {
    /** full `/`-separated name of the item or folder */
    path: string
    folder: boolean
    error?: string
    count?: number
    children?: Node[]
}

const s = computed(() => project.state.value!)
const listing = computed(() => s.value.files[props.kind])
const names = computed(() => listing.value.names)
const folders = computed(() => [...new Set([...listing.value.folders, ...foldersOf(names.value)])].sort())
// unreadable libraries are listed but can't be opened
const loadError = (name: string) => props.kind === 'library' ? s.value.libraryErrors[name] : undefined
const errorOf = (name: string) => listing.value.nameErrors[name] ?? loadError(name)
const itemsIn = (folder: string) => names.value.filter(n => n.startsWith(folder + '/'))
const tabsOf = (list: string[]) => $t.tabs.value.filter(t => t.kind === props.kind && list.includes(t.name))
const plural = (n: number, word: string, many = word + 's') => `${n} ${n === 1 ? word : many}`

// ---- tree ----
const search = ref('')
const query = computed(() => search.value.trim().toLowerCase())
const shown = computed(() => query.value ? names.value.filter(n => n.toLowerCase().includes(query.value)) : names.value)
// while searching only the folder chains of matches are shown
const shownFolders = computed(() => query.value ? foldersOf(shown.value) : folders.value)
/** highlighted folder ('' = root): where new items go by default */
const current = ref('')

function build(prefix: string): Node[] {
    const subfolders: Node[] = shownFolders.value.filter(f => splitName(f)[0] === prefix).map((f) => {
        const children = build(f)
        return {
            label: splitName(f)[1], path: f, folder: true, children,
            // non-empty folders get UTree's open/closed folder icons
            icon: children.length ? undefined : 'i-lucide-folder',
            class: dropTarget.value === f ? DROP_CLASS : undefined,
            onSelect: () => current.value = f,
        }
    })
    const leaves: Node[] = shown.value.filter(n => splitName(n)[0] === prefix).map(n => ({
        label: splitName(n)[1], path: n, folder: false, icon: text.value.icon, error: errorOf(n),
        count: props.kind === 'library' && s.value.libraries[n] ? Object.keys(s.value.libraries[n].prefabs ?? {}).length : undefined,
        onSelect: () => {
            current.value = prefix
            open(n)
        },
    }))
    return [...subfolders, ...leaves]
}
const tree = computed(() => build(''))
const getKey = (n: Node) => n.folder ? n.path + '/' : n.path
/** the row under a DOM event, by the key its label marker carries */
const nodeAt = (e: Event): { path: string, folder: boolean } | null => {
    const key = treeKeyAt(e)
    return key === null ? null : key.endsWith('/') ? { path: key.slice(0, -1), folder: true } : { path: key, folder: false }
}

const stored = useLocalStorage<string[]>(`neo-home-expanded-${props.kind}`, [])
const expanded = computed({
    get: () => query.value ? shownFolders.value.map(f => f + '/') : stored.value,
    set: (v: string[]) => {
        if (!query.value) stored.value = v
    },
})
/** expands every folder above `path` so it's visible */
const reveal = (path: string) => stored.value = [...new Set([...stored.value, ...foldersOf([path]).map(f => f + '/')])]

/** Runs `fn`, turning a thrown fs error into a toast. true = it worked. */
async function attempt(title: string, fn: () => Promise<unknown>) {
    try {
        await fn()
        return true
    }
    catch (e) {
        toast.add({ title, description: e instanceof Error ? e.message : String(e), color: 'error' })
        return false
    }
}

function open(name: string) {
    if (loadError(name)) return toast.add({ title: `Can't open '${name}'`, description: errorOf(name), color: 'error' })
    return attempt(`Could not open ${text.value.noun}`, () => $t.open(props.kind, name))
}

async function countRefs(list: string[]) {
    let n = 0
    for (const name of list) n += await project.countReferences({ kind: props.kind, from: name, to: name })
    return n
}

// ---- name dialog: create / rename / move ----
interface NameForm {
    title: string
    confirm: string
    /** ROOT or a folder */
    folder: string
    leaf: string
    /** folder choices */
    folders: string[]
    /** names the result can't collide with (case-insensitive) */
    taken: string[]
    /** the name being renamed */
    self?: string
    note?: string
    /** extra rule on the full name */
    check?: (full: string) => string | null
    submit: (full: string) => Promise<unknown>
}
const form = ref<NameForm | null>(null)
const formOpen = computed({ get: () => !!form.value, set: (v) => {
    if (!v) form.value = null
} })
const busy = ref(false)
const formFull = computed(() => form.value ? joinName(form.value.folder === ROOT ? '' : form.value.folder, form.value.leaf.trim()) : '')
const formError = computed(() => {
    const f = form.value
    if (!f) return null
    if (!f.leaf.trim()) return 'name is required'
    const collision = pathCollision(f.taken, formFull.value, f.self)
    return pathNameError(formFull.value) ?? (collision ? `already exists as '${collision}'` : null) ?? f.check?.(formFull.value) ?? null
})
const folderItems = computed(() => [{ label: '/ (root)', value: ROOT }, ...(form.value?.folders ?? []).map(f => ({ label: f, value: f }))])
const startFolder = () => folders.value.includes(current.value) ? current.value : ROOT

async function submitForm() {
    const f = form.value
    if (!f || formError.value || formFull.value === f.self || busy.value) return
    busy.value = true
    if (await attempt(`${f.title} failed`, () => f.submit(formFull.value))) form.value = null
    busy.value = false
}

const refsNote = (refs: number) => refs
    ? `${plural(refs, 'reference')} in other files will be rewritten to the new name.`
    : 'No other files reference it.'

function newItem() {
    form.value = {
        title: `New ${text.value.noun}`, confirm: 'Create', folder: startFolder(), leaf: '', folders: folders.value, taken: names.value,
        submit: async (name) => {
            await project.createItem(props.kind, name)
            reveal(name)
            await open(name)
        },
    }
}

function newFolder() {
    form.value = {
        title: 'New folder', confirm: 'Create', folder: startFolder(), leaf: '', folders: folders.value, taken: folders.value,
        submit: async (folder) => {
            await project.createFolder(props.kind, folder)
            reveal(folder)
            current.value = folder
        },
    }
}

/** `into` opens the dialog with that folder picked (a drop); confirming does the move. */
async function moveItem(name: string, into?: string) {
    const refs = await countRefs([name])
    const dirty = tabsOf([name]).some($t.isDirty)
    const [folder, leaf] = splitName(name)
    form.value = {
        title: `Rename / move ${text.value.noun}`, confirm: 'Move', folder: (into ?? folder) || ROOT, leaf, folders: folders.value, taken: names.value, self: name,
        note: refsNote(refs) + (dirty ? ' Its open tab has unsaved changes; they will be saved first.' : ''),
        submit: async (to) => {
            for (const tab of tabsOf([name])) if ($t.isDirty(tab)) await $t.save(tab)
            const n = await $t.renameItem(props.kind, name, to)
            reveal(to)
            toast.add({ title: `Moved — updated ${plural(n, 'reference')}`, color: 'success' })
        },
    }
}

async function moveFolder(from: string, into?: string) {
    const items = itemsIn(from)
    const refs = await countRefs(items)
    const dirty = tabsOf(items).some($t.isDirty)
    const [parent, leaf] = splitName(from)
    form.value = {
        title: 'Rename / move folder', confirm: 'Move', folder: (into ?? parent) || ROOT, leaf, self: from, taken: folders.value,
        folders: folders.value.filter(f => f !== from && !f.startsWith(from + '/')),
        check: to => to.startsWith(from + '/') ? 'can\'t move a folder into itself' : null,
        note: `${plural(items.length, text.value.noun, text.value.nouns)} move with it. ${refsNote(refs)}`
            + (dirty ? ' Open tabs with unsaved changes will be saved first.' : ''),
        submit: async (to) => {
            for (const tab of tabsOf(items)) if ($t.isDirty(tab)) await $t.save(tab)
            const n = await $t.renameFolder(props.kind, from, to)
            reveal(to)
            if (current.value === from) current.value = to
            toast.add({ title: `Moved — updated ${plural(n, 'reference')}`, color: 'success' })
        },
    }
}

// ---- confirm dialog: delete ----
interface ConfirmForm { title: string, description: string, submit: () => Promise<unknown> }
const confirm = ref<ConfirmForm | null>(null)
const confirmOpen = computed({ get: () => !!confirm.value, set: (v) => {
    if (!v) confirm.value = null
} })

async function submitConfirm() {
    const c = confirm.value
    if (!c || busy.value) return
    busy.value = true
    if (await attempt('Delete failed', c.submit)) confirm.value = null
    busy.value = false
}

async function deleteItem(name: string) {
    const refs = await countRefs([name])
    const hasTab = tabsOf([name]).length > 0
    confirm.value = {
        title: `Delete ${text.value.noun} '${name}'?`,
        description: `${refs ? `${plural(refs, 'reference')} in other files will break.` : 'No other files reference it.'} The file is deleted from disk${hasTab ? ' and its tab closed without saving' : ''}.`,
        submit: async () => {
            await project.deleteItem(props.kind, name)
            await $t.forget(props.kind, name)
        },
    }
}

function deleteFolder(folder: string) {
    confirm.value = {
        title: `Delete folder '${folder}'?`,
        description: 'The empty folder (and any empty subfolders) is removed from disk.',
        submit: async () => {
            await project.deleteFolder(props.kind, folder)
            if (current.value === folder || current.value.startsWith(folder + '/')) current.value = ''
        },
    }
}

// ---- drag a row onto a folder (or the panel's empty space = root): opens the move dialog, nothing moves before confirm ----
const DROP_CLASS = 'ring-2 ring-primary bg-primary/10 rounded-md'
const dragged = ref<{ path: string, folder: boolean } | null>(null)
/** folder the pointer would drop into ('' = root) */
const dropTarget = ref<string | null>(null)

/** Where a drop at `e` lands: the folder row under it (an item row means its folder), else the root. null = not allowed. */
function dropFolderAt(e: DragEvent): string | null {
    const d = dragged.value
    if (!d) return null
    const at = nodeAt(e)
    const to = at ? (at.folder ? at.path : splitName(at.path)[0]) : ''
    if (splitName(d.path)[0] === to) return null // already there
    if (d.folder && (to === d.path || to.startsWith(d.path + '/'))) return null // into itself
    return to
}

function onDragStart(e: DragEvent) {
    const at = nodeAt(e)
    if (!at) return e.preventDefault()
    dragged.value = at
    e.dataTransfer!.effectAllowed = 'move'
    e.dataTransfer!.setData('text/plain', at.path)
}

function onDragOver(e: DragEvent) {
    dropTarget.value = dropFolderAt(e)
    if (dropTarget.value === null) return
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'
}

function onDrop(e: DragEvent) {
    const d = dragged.value
    const to = dropFolderAt(e)
    onDragEnd()
    if (!d || to === null) return
    attempt('Could not count references', () => d.folder ? moveFolder(d.path, to || ROOT) : moveItem(d.path, to || ROOT))
}

function onDragEnd() {
    dragged.value = null
    dropTarget.value = null
}

// ---- right-click menus ----
const menu = useContextTarget<{ path: string, folder: boolean } | 'panel'>((t): ContextMenuItem[][] => {
    if (!t) return []
    const inFolder = (folder: string, create: () => void) => () => {
        current.value = folder
        create()
    }
    const create = (folder: string): ContextMenuItem[] => [
        { label: `New ${text.value.noun}${folder ? ' here' : ''}`, icon: 'i-lucide-plus', onSelect: inFolder(folder, newItem) },
        { label: `New folder${folder ? ' inside' : ''}`, icon: 'i-lucide-folder-plus', onSelect: inFolder(folder, newFolder) },
    ]
    if (t === 'panel') return [create('')]
    const move = () => attempt('Could not count references', () => t.folder ? moveFolder(t.path) : moveItem(t.path))
    if (t.folder) {
        const n = itemsIn(t.path).length
        return [create(t.path), [
            { label: 'Rename / move…', icon: 'i-lucide-pencil', onSelect: move },
            { label: n ? `Delete folder (move its ${plural(n, text.value.noun, text.value.nouns)} first)` : 'Delete folder', icon: 'i-lucide-trash-2', color: 'error', disabled: n > 0, onSelect: () => deleteFolder(t.path) },
        ]]
    }
    return [
        [{ label: 'Open', icon: 'i-lucide-square-arrow-out-up-right', disabled: !!loadError(t.path), onSelect: () => open(t.path) }],
        [{ label: 'Rename / move…', icon: 'i-lucide-pencil', onSelect: move }],
        [{ label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => attempt('Could not count references', () => deleteItem(t.path)) }],
    ]
})
</script>

<template>
    <section class="flex flex-col rounded-lg border border-default bg-elevated/25">
        <header class="flex items-center gap-2 border-b border-default px-3 py-2">
            <UIcon :name="text.icon" class="size-4 text-muted" />
            <h2 class="text-sm font-medium text-highlighted">{{ text.title }}</h2>
            <UBadge color="neutral" variant="subtle" size="sm" :label="String(names.length)" />
            <div class="ms-auto flex gap-1">
                <UButton icon="i-lucide-folder-plus" label="New folder" size="xs" color="neutral" variant="ghost" @click="newFolder" />
                <UButton icon="i-lucide-plus" :label="`New ${text.noun}`" size="xs" variant="soft" @click="newItem" />
            </div>
        </header>

        <UContextMenu :items="menu.items" :content="menu.content">
        <div
            class="flex min-h-24 flex-1 flex-col gap-2 p-2"
            :class="dropTarget === '' && DROP_CLASS"
            data-context-menu
            @contextmenu.capture="menu.reset"
            @contextmenu="(e: MouseEvent) => { const at = nodeAt(e); menu.set(at ?? 'panel'); menu.settle(e) }"
            @dragstart="onDragStart"
            @dragover="onDragOver"
            @drop.prevent="onDrop"
            @dragend="onDragEnd"
        >
            <UInput
                v-if="names.length"
                v-model="search"
                icon="i-lucide-search"
                :placeholder="`Filter ${text.title.toLowerCase()}…`"
                size="sm"
                class="w-full"
                :ui="{ trailing: 'pe-1' }"
            >
                <template v-if="search" #trailing>
                    <UButton icon="i-lucide-x" size="xs" color="neutral" variant="link" aria-label="Clear filter" @click="search = ''" />
                </template>
            </UInput>

            <!-- link: 'div' because the rows hold action buttons (no buttons inside buttons) -->
            <UTree
                v-if="tree.length"
                v-model:expanded="expanded"
                :items="tree"
                :get-key="getKey"
                :as="{ link: 'div' }"
                size="sm"
                color="neutral"
                :ui="{ link: 'cursor-pointer' }"
            >
                <template #item-label="{ item }">
                    <!-- marks the row for drag, drop and right-click -->
                    <span :data-tree-key="getKey(item)" draggable="true" :class="item.error && 'text-error'">{{ item.label }}</span>
                </template>
                <template #item-trailing="{ item, ui }">
                    <UTooltip v-if="item.error" :text="item.error">
                        <UBadge color="error" variant="subtle" size="sm" icon="i-lucide-circle-alert" label="error" />
                    </UTooltip>
                    <span v-if="item.count !== undefined" class="text-xs text-dimmed">{{ plural(item.count, 'prefab') }}</span>
                    <!-- stop: a click here must not also open/toggle the row -->
                    <span class="invisible flex gap-0.5 group-hover:visible group-focus-visible:visible" @click.stop>
                        <UTooltip text="Rename / move">
                            <UButton
                                icon="i-lucide-pencil"
                                size="xs"
                                color="neutral"
                                variant="ghost"
                                aria-label="Rename / move"
                                @click="attempt('Could not count references', () => item.folder ? moveFolder(item.path) : moveItem(item.path))"
                            />
                        </UTooltip>
                        <UTooltip v-if="item.folder" :text="itemsIn(item.path).length ? `Move or delete its ${plural(itemsIn(item.path).length, text.noun, text.nouns)} first` : 'Delete folder'">
                            <span>
                                <UButton
                                    icon="i-lucide-trash-2"
                                    size="xs"
                                    color="error"
                                    variant="ghost"
                                    aria-label="Delete folder"
                                    :disabled="itemsIn(item.path).length > 0"
                                    @click="deleteFolder(item.path)"
                                />
                            </span>
                        </UTooltip>
                        <UTooltip v-else text="Delete">
                            <UButton
                                icon="i-lucide-trash-2"
                                size="xs"
                                color="error"
                                variant="ghost"
                                aria-label="Delete"
                                @click="attempt('Could not count references', () => deleteItem(item.path))"
                            />
                        </UTooltip>
                    </span>
                    <UIcon v-if="item.children?.length" name="i-lucide-chevron-down" :class="ui.linkTrailingIcon()" />
                </template>
            </UTree>

            <UEmpty v-else-if="query" icon="i-lucide-search-x" :title="`Nothing matches '${search.trim()}'`" size="sm" variant="naked" />
            <UEmpty
                v-else
                :icon="text.icon"
                :title="`No ${text.title.toLowerCase()} yet`"
                :description="text.empty"
                :actions="[{ label: `New ${text.noun}`, icon: 'i-lucide-plus', variant: 'soft', onClick: newItem }]"
                size="sm"
                variant="naked"
            />
        </div>
        </UContextMenu>

        <UModal v-model:open="formOpen" :title="form?.title" :ui="{ footer: 'justify-end' }">
            <template #body>
                <form v-if="form" class="flex flex-col gap-3" @submit.prevent="submitForm">
                    <UFormField label="Folder">
                        <USelect v-model="form.folder" :items="folderItems" icon="i-lucide-folder" class="w-full" />
                    </UFormField>
                    <UFormField label="Name" :error="form.leaf.trim() ? formError ?? false : false" :help="formError ? undefined : formFull">
                        <UInput v-model="form.leaf" autofocus class="w-full" />
                    </UFormField>
                    <p v-if="form.note" class="text-sm text-muted">{{ form.note }}</p>
                </form>
            </template>
            <template #footer>
                <UButton label="Cancel" color="neutral" variant="outline" @click="form = null" />
                <UButton :label="form?.confirm" :loading="busy" :disabled="!!formError || formFull === form?.self" @click="submitForm" />
            </template>
        </UModal>

        <UModal v-model:open="confirmOpen" :title="confirm?.title" :description="confirm?.description" :ui="{ footer: 'justify-end' }">
            <template #footer>
                <UButton label="Cancel" color="neutral" variant="outline" @click="confirm = null" />
                <UButton label="Delete" color="error" :loading="busy" @click="submitConfirm" />
            </template>
        </UModal>
    </section>
</template>
