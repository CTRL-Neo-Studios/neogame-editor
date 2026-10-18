<script setup lang="ts">
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import {useProject} from "~/composables/project/useProject.ts";
import {useRecents} from "~/composables/io/useRecents.ts";
import {useAppTabs} from "~/composables/app/useAppTabs.ts";

const project = useProject()
const recents = useRecents()
const $t = useAppTabs()
const toast = useToast()

async function openProject(path?: string) {
    const root = path ?? await openDialog({ directory: true, title: 'Open game project (folder with Data/)' })
    if (typeof root !== 'string') return
    try {
        await project.open(root)
        await recents.add(root)
        $t.tabs.value = []
        $t.activeId.value = null
        await navigateTo('/')
    }
    catch (e) {
        toast.add({ title: 'Could not open project', description: e instanceof Error ? e.message : String(e), color: 'error', icon: 'i-lucide-folder-x' })
    }
}

async function saveActive() {
    const tab = $t.active.value
    if (!tab) return
    try {
        await $t.save(tab)
        toast.add({ title: `Saved ${tab.name}`, color: 'success', icon: 'i-lucide-check', duration: 1500 })
    }
    catch (e) {
        toast.add({ title: 'Save failed', description: e instanceof Error ? e.message : String(e), color: 'error' })
    }
}

defineShortcuts({
    meta_s: saveActive,
    meta_o: () => openProject(),
    meta_w: () => $t.activeId.value && $t.close($t.activeId.value),
})

provide('neo:openProject', openProject)

const tabItems = computed(() => $t.tabs.value.map(t => ({
    id: t.id,
    label: t.name,
    icon: t.kind === 'map' ? 'i-lucide-map' : 'i-lucide-boxes',
    dirty: $t.isDirty(t),
})))

function selectTab(id: string) {
    $t.activeId.value = id
    navigateTo(`/tabs/${encodeURIComponent(id)}`)
}
</script>

<template>
    <div class="fixed inset-0 flex flex-col bg-default">
        <header class="flex h-10 shrink-0 items-center gap-1 border-b border-default px-2">
            <UButton
                to="/"
                variant="ghost"
                color="neutral"
                size="sm"
                icon="i-lucide-house"
                :active="!$t.activeId.value"
                active-variant="soft"
                aria-label="Project"
            />
            <USeparator orientation="vertical" class="mx-1 h-5" />
            <div class="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
                <div
                    v-for="item in tabItems"
                    :key="item.id"
                    class="group flex shrink-0 items-center rounded-md"
                    :class="item.id === $t.activeId.value ? 'bg-elevated' : 'hover:bg-elevated/50'"
                >
                    <UButton
                        variant="link"
                        color="neutral"
                        size="sm"
                        :icon="item.icon"
                        :label="item.label"
                        class="pe-1"
                        :class="item.id === $t.activeId.value ? 'text-highlighted' : 'text-muted'"
                        @click="selectTab(item.id)"
                    />
                    <UButton
                        variant="link"
                        color="neutral"
                        size="xs"
                        :icon="item.dirty ? 'i-lucide-circle' : 'i-lucide-x'"
                        :class="item.dirty ? 'text-warning' : 'opacity-0 group-hover:opacity-100'"
                        :aria-label="`Close ${item.label}`"
                        @click="$t.close(item.id)"
                    />
                </div>
            </div>
            <UTooltip text="Save (Ctrl+S)">
                <UButton
                    variant="ghost"
                    color="neutral"
                    size="sm"
                    icon="i-lucide-save"
                    :disabled="!$t.active.value || !$t.isDirty($t.active.value)"
                    aria-label="Save"
                    @click="saveActive"
                />
            </UTooltip>
            <UColorModeButton size="sm" />
        </header>
        <div class="relative min-h-0 flex-1">
            <slot />
        </div>
    </div>
</template>
