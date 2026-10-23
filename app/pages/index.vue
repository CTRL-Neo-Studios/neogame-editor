<script setup lang="ts">
import {useProject} from "~/composables/project/useProject.ts";
import {useRecents} from "~/composables/io/useRecents.ts";
import { DOC_KIND_LIST } from '~/utils/documents'

const project = useProject()
const recents = useRecents()
const openProject = inject<(path?: string) => Promise<void>>('neo:openProject')!

onMounted(() => recents.refresh())

const s = computed(() => project.state.value)
const rescanning = ref(false)

async function rescan() {
    rescanning.value = true
    await Promise.all([project.rescan(), project.reloadSchema()]).finally(() => rescanning.value = false)
}
</script>

<template>
    <div class="h-full overflow-y-auto">
        <UContainer class="py-8">
            <div v-if="!s" class="mx-auto flex max-w-xl flex-col gap-8 pt-8">
                <div class="flex items-center gap-4">
                    <div class="grid size-12 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                        <UIcon name="i-lucide-gamepad-2" class="size-6" />
                    </div>
                    <div>
                        <h1 class="text-2xl font-semibold text-highlighted">NeoGame Editor</h1>
                        <p class="text-sm text-muted">Open a NeoGameLib game project — the folder that contains <code>Data/neo.project.json</code>.</p>
                    </div>
                </div>
                <UButton icon="i-lucide-folder-open" label="Open project…" size="lg" class="self-start" @click="openProject()" />
                <section v-if="recents.items.value.length" class="flex flex-col gap-1">
                    <h2 class="px-2 text-xs font-medium uppercase tracking-wide text-dimmed">Recent</h2>
                    <div v-for="r in recents.items.value" :key="r.path" class="group flex items-center gap-1">
                        <UButton variant="ghost" color="neutral" icon="i-lucide-folder" class="min-w-0 flex-1 justify-start" @click="openProject(r.path)">
                            <span class="shrink-0 font-medium">{{ r.name }}</span>
                            <span class="truncate text-xs text-dimmed">{{ r.path }}</span>
                        </UButton>
                        <UTooltip text="Forget">
                            <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-x" class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label="Forget" @click="recents.remove(r.path)" />
                        </UTooltip>
                    </div>
                </section>
            </div>

            <div v-else class="flex flex-col gap-6">
                <header class="flex flex-wrap items-start justify-between gap-4">
                    <div class="min-w-0">
                        <h1 class="truncate text-2xl font-semibold text-highlighted">{{ s.root.split(/[\\/]/).pop() }}</h1>
                        <p class="truncate text-sm text-muted">{{ s.root }}</p>
                        <UTooltip :text="s.schemaError ?? 'Reloads automatically when the game rebuilds'">
                            <div class="mt-2 inline-flex max-w-full items-center gap-1.5 text-xs" :class="s.schemaError ? 'text-warning' : 'text-muted'">
                                <UIcon :name="s.schemaError ? 'i-lucide-triangle-alert' : 'i-lucide-file-json'" class="size-3.5 shrink-0" />
                                <span v-if="s.schemaError" class="truncate">Schema not loaded: {{ s.schemaError }}</span>
                                <span v-else-if="s.schema" class="truncate">
                                    {{ s.project.schema }} · {{ s.schema['x-neo-specs']?.length ?? 0 }} specs · {{ s.schema['x-neo-actions']?.length ?? 0 }} actions
                                </span>
                                <span v-else>Loading schema…</span>
                            </div>
                        </UTooltip>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        <RefreshSpecsButton />
                        <UButton variant="soft" color="neutral" icon="i-lucide-refresh-cw" label="Rescan" :loading="rescanning" @click="rescan" />
                        <UButton variant="soft" color="neutral" icon="i-lucide-folder-open" label="Open other…" @click="openProject()" />
                    </div>
                </header>

                <div class="grid items-start gap-4 lg:grid-cols-2">
                    <HomeItemTree v-for="kind in DOC_KIND_LIST" :key="kind" :kind="kind" />
                </div>
            </div>
        </UContainer>
    </div>
</template>
