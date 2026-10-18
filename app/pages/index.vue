<script setup lang="ts">
import {stringify, useProject} from "~/composables/project/useProject.ts";
import {useRecents} from "~/composables/io/useRecents.ts";
import {useAppTabs} from "~/composables/app/useAppTabs.ts";

const project = useProject()
const recents = useRecents()
const $t = useAppTabs()
const toast = useToast()
const openProject = inject<(path?: string) => Promise<void>>('neo:openProject')!

onMounted(() => recents.refresh())

const s = computed(() => project.state.value)
const newMapName = ref('')
const newLibraryName = ref('')
const validName = (n: string) => /^[A-Za-z0-9_-]+$/.test(n)

async function createMap() {
    const name = newMapName.value.trim()
    if (!validName(name) || s.value?.maps.includes(name)) return
    const libraries = Object.keys(s.value?.libraries ?? {})
    const body = stringify({ cellSize: { x: 32, y: 32 }, prefabs: libraries.slice(0, 1), layers: [{ name: 'main', legend: { ' ': null }, rows: Array.from({ length: 12 }, () => ' '.repeat(16)) }], objects: [] })
    try {
        await project.createMap(name, body)
        newMapName.value = ''
        await $t.openMap(name)
    }
    catch (e) {
        toast.add({ title: 'Could not create map', description: String(e), color: 'error' })
    }
}

async function createLibrary() {
    const name = newLibraryName.value.trim()
    if (!validName(name) || name in (s.value?.libraries ?? {})) return
    await project.createLibrary(name)
    newLibraryName.value = ''
    await $t.openLibrary(name)
}
</script>

<template>
    <div class="h-full overflow-y-auto">
        <UContainer class="py-10">
            <div v-if="!s" class="mx-auto flex max-w-xl flex-col gap-6">
                <div>
                    <h1 class="text-2xl font-semibold text-highlighted">NeoMap Editor</h1>
                    <p class="text-muted">Open a NeoGameLib game project — the folder that contains <code>Data/neo.project.json</code>.</p>
                </div>
                <UButton icon="i-lucide-folder-open" label="Open project…" size="lg" class="self-start" @click="openProject()" />
                <div v-if="recents.items.value.length" class="flex flex-col gap-1">
                    <h2 class="text-sm font-medium text-muted">Recent</h2>
                    <div v-for="r in recents.items.value" :key="r.path" class="group flex items-center gap-2">
                        <UButton variant="ghost" color="neutral" icon="i-lucide-folder" :label="r.name" class="min-w-0 flex-1 justify-start" @click="openProject(r.path)">
                            <template #trailing>
                                <span class="truncate text-xs text-dimmed">{{ r.path }}</span>
                            </template>
                        </UButton>
                        <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-x" class="opacity-0 group-hover:opacity-100" aria-label="Forget" @click="recents.remove(r.path)" />
                    </div>
                </div>
            </div>

            <div v-else class="flex flex-col gap-6">
                <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0">
                        <h1 class="truncate text-2xl font-semibold text-highlighted">{{ s.root.split(/[\\/]/).pop() }}</h1>
                        <p class="truncate text-sm text-muted">{{ s.root }}</p>
                    </div>
                    <div class="flex gap-2">
                        <UButton variant="soft" color="neutral" icon="i-lucide-refresh-cw" label="Rescan" @click="project.rescan(); project.reloadSchema()" />
                        <UButton variant="soft" color="neutral" icon="i-lucide-folder-open" label="Open other…" @click="openProject()" />
                    </div>
                </div>

                <UAlert v-if="s.schemaError" color="warning" variant="subtle" icon="i-lucide-triangle-alert" title="Schema not loaded" :description="s.schemaError" />
                <UAlert
                    v-else-if="s.schema"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-file-json"
                    :title="s.project.schema"
                    :description="`${s.schema['x-neo-specs']?.length ?? 0} specs · ${s.schema['x-neo-actions']?.length ?? 0} actions — reloads automatically when the game rebuilds`"
                />

                <div class="grid gap-6 md:grid-cols-2">
                    <UCard>
                        <template #header>
                            <div class="flex items-center gap-2">
                                <UIcon name="i-lucide-map" class="size-5" />
                                <h2 class="font-medium">Maps</h2>
                                <UBadge color="neutral" variant="subtle" :label="String(s.maps.length)" />
                            </div>
                        </template>
                        <div class="flex flex-col gap-1">
                            <UButton v-for="m in s.maps" :key="m" variant="ghost" color="neutral" icon="i-lucide-file" :label="m" class="justify-start" @click="$t.openMap(m)" />
                            <UEmpty v-if="!s.maps.length" icon="i-lucide-map" title="No maps yet" size="sm" />
                        </div>
                        <template #footer>
                            <UFieldGroup class="w-full">
                                <UInput v-model="newMapName" placeholder="new map name" class="flex-1" @keydown.enter="createMap" />
                                <UButton icon="i-lucide-plus" label="Create" :disabled="!validName(newMapName.trim())" @click="createMap" />
                            </UFieldGroup>
                        </template>
                    </UCard>

                    <UCard>
                        <template #header>
                            <div class="flex items-center gap-2">
                                <UIcon name="i-lucide-boxes" class="size-5" />
                                <h2 class="font-medium">Prefab libraries</h2>
                                <UBadge color="neutral" variant="subtle" :label="String(Object.keys(s.libraries).length)" />
                            </div>
                        </template>
                        <div class="flex flex-col gap-1">
                            <UButton
                                v-for="(lib, name) in s.libraries"
                                :key="name"
                                variant="ghost"
                                color="neutral"
                                icon="i-lucide-package"
                                :label="String(name)"
                                class="justify-start"
                                @click="$t.openLibrary(String(name))"
                            >
                                <template #trailing>
                                    <span class="ms-auto text-xs text-dimmed">{{ Object.keys(lib.prefabs ?? {}).length }} prefabs</span>
                                </template>
                            </UButton>
                            <UAlert v-for="(err, name) in s.libraryErrors" :key="name" color="error" variant="subtle" :title="`${name}: unreadable`" :description="err" />
                            <UEmpty v-if="!Object.keys(s.libraries).length" icon="i-lucide-boxes" title="No libraries yet" size="sm" />
                        </div>
                        <template #footer>
                            <UFieldGroup class="w-full">
                                <UInput v-model="newLibraryName" placeholder="new library name" class="flex-1" @keydown.enter="createLibrary" />
                                <UButton icon="i-lucide-plus" label="Create" :disabled="!validName(newLibraryName.trim())" @click="createLibrary" />
                            </UFieldGroup>
                        </template>
                    </UCard>
                </div>
            </div>
        </UContainer>
    </div>
</template>
