<script setup lang="ts">
import type { ContextMenuItem } from '@nuxt/ui'
import { platform } from '@tauri-apps/plugin-os'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {useAppCommands} from "~/composables/app/useAppCommands.ts";
import { DOC_KINDS } from '~/utils/documents'
import {useAppMenu} from "~/composables/app/useAppMenu.ts";

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

// one quiet check per launch: a toast only when something newer exists, errors stay silent (offline, no token yet)
const updater = useUpdater()
const toast = useToast()
onMounted(async () => {
    if (!updater.supported || import.meta.dev) return
    await updater.loadSettings()
    const found = await updater.checkNow()
    if (found) toast.add({
        title: `NeoGame Editor ${found.version} is available`,
        icon: 'i-lucide-download',
        duration: 0,
        actions: [{ label: 'View', onClick: () => { updater.dialogOpen.value = true } }],
    })
})

provide('neo:openProject', openProject)
// context menus run the same commands as the menus and keys (paste warns about missing layers, etc.)
provide('neo:commands', commands)

// production: the webview's own menu (Reload, Inspect) only stays in text fields; our areas open their own menus
if (!import.meta.dev) useEventListener(window, 'contextmenu', (e: MouseEvent) => {
    if (!(e.target as Element).closest('input, textarea, [contenteditable="true"], [data-context-menu]')) e.preventDefault()
})

const tabMenu = useContextTarget<string>((id): ContextMenuItem[][] => {
    const all = $t.tabs.value.map(t => t.id)
    const index = id ? all.indexOf(id) : -1
    if (index < 0) return []
    return [
        [{ label: 'Close', icon: 'i-lucide-x', kbds: ['meta', 'w'], onSelect: () => $t.close(id!) }],
        [
            { label: 'Close others', disabled: all.length < 2, onSelect: () => $t.close(...all.filter(t => t !== id)) },
            { label: 'Close to the right', disabled: index === all.length - 1, onSelect: () => $t.close(...all.slice(index + 1)) },
            { label: 'Close saved', disabled: !$t.tabs.value.some(t => !$t.isDirty(t)), onSelect: () => $t.close(...$t.tabs.value.filter(t => !$t.isDirty(t)).map(t => t.id)) },
            { label: 'Close all', onSelect: () => $t.close(...all) },
        ],
    ]
})

const tabItems = computed(() => $t.tabs.value.map(t => ({
    id: t.id,
    label: t.name,
    icon: DOC_KINDS[t.kind].icon,
    dirty: $t.isDirty(t),
})))

function selectTab(id: string) {
    $t.activeId.value = id
    navigateTo(tabRoute(id))
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
            <UContextMenu :items="tabMenu.items" :content="tabMenu.content">
                <div class="flex min-w-0 flex-1 items-center gap-0.5 self-stretch overflow-x-auto" data-tauri-drag-region data-context-menu @contextmenu.capture="tabMenu.reset" @contextmenu="tabMenu.settle">
                    <div
                        v-for="item in tabItems"
                        :key="item.id"
                        class="group flex shrink-0 items-center rounded-md"
                        :class="item.id === $t.activeId.value ? 'bg-elevated' : 'hover:bg-elevated/50'"
                        @contextmenu="tabMenu.set(item.id)"
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
            </UContextMenu>
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
        <UpdateDialog />
    </div>
</template>
