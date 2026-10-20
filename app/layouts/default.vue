<script setup lang="ts">
import { platform } from '@tauri-apps/plugin-os'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

const $t = useAppTabs()
const { commands, nativeMenu, openProject, saveActive } = useAppCommands()
const { menus } = useAppMenu(commands, nativeMenu)

// room for the native window controls decorum draws over our topbar: macOS traffic lights sit top-left
// (inset 12/16 in window_effects.rs), decorum's Windows min/max/close (3 x 58px) and Linux buttons top-right
const os = isTauri() ? platform() : null
const headerInset = os === 'macos' ? { paddingLeft: '76px' } : os === 'windows' ? { paddingRight: '180px' } : os === 'linux' ? { paddingRight: '96px' } : undefined

// quitting with unsaved tabs asks first, like closing a single tab does
if (isTauri()) {
    getCurrentWindow().onCloseRequested(async (event) => {
        if (!(await $t.confirmDiscard($t.tabs.value))) event.preventDefault()
    })
}

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
        <header class="flex h-10 shrink-0 items-center gap-1 border-b border-default px-2" :style="headerInset" data-tauri-drag-region>
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
            <template v-if="!nativeMenu">
                <UDropdownMenu v-for="menu in menus" :key="menu.label" :items="menu.items" :content="{ align: 'start' }" :ui="{ content: 'min-w-56' }">
                    <UButton variant="ghost" color="neutral" size="sm" :label="menu.label" class="px-2" />
                </UDropdownMenu>
            </template>
            <USeparator orientation="vertical" class="mx-1 h-5" />
            <div class="flex min-w-0 flex-1 items-center gap-0.5 self-stretch overflow-x-auto" data-tauri-drag-region>
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
        <BuildLog />
    </div>
</template>
