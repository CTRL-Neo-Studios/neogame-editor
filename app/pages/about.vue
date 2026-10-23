<script setup lang="ts">
import { getName, getTauriVersion, getVersion } from '@tauri-apps/api/app'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { arch, platform, version as osVersion } from '@tauri-apps/plugin-os'
import { openUrl } from '@tauri-apps/plugin-opener'
import icon from '~~/src-tauri/icons/128x128@2x.png'

// standalone page for the About window: no app layout (header, tabs, menus, shortcuts)
definePageMeta({ layout: false })

const REPO = 'https://github.com/CTRL-Neo-Studios/neomap-editor'
const LIB = 'https://github.com/CTRL-Neo-Studios/NeoGameLib'

const info = ref({ name: 'NeoGame Editor', version: '', tauri: '', os: '' })

onMounted(async () => {
    if (!isTauri()) return
    const [name, version, tauri] = await Promise.all([getName(), getVersion(), getTauriVersion()])
    info.value = { name, version, tauri, os: `${platform()} ${osVersion()} · ${arch()}` }
})

const open = (url: string) => isTauri() ? openUrl(url) : window.open(url, '_blank')

defineShortcuts({ escape: () => isTauri() && getCurrentWindow().close() })
</script>

<template>
    <div class="flex h-screen select-none flex-col items-center justify-center gap-5 bg-default px-8 text-center" data-tauri-drag-region>
        <img :src="icon" alt="" class="pointer-events-none size-24 drop-shadow-lg" draggable="false">
        <div class="flex flex-col gap-1" data-tauri-drag-region>
            <h1 class="text-lg font-semibold text-highlighted">{{ info.name }}</h1>
            <p v-if="info.version" class="text-sm text-muted">Version {{ info.version }}</p>
        </div>
        <p class="text-xs text-muted">A map and prefab editor for <span class="text-default">NeoGameLib</span> MonoGame projects.</p>
        <div class="flex gap-2">
            <UButton size="xs" variant="soft" color="neutral" icon="i-simple-icons-github" label="Source" @click="open(REPO)" />
            <UButton size="xs" variant="soft" color="neutral" icon="i-lucide-book-open" label="NeoGameLib" @click="open(LIB)" />
        </div>
        <div class="flex flex-col gap-0.5 text-[11px] text-dimmed">
            <span v-if="info.tauri">Tauri {{ info.tauri }}</span>
            <span v-if="info.os">{{ info.os }}</span>
            <span>© CTRL Neo Studios</span>
        </div>
    </div>
</template>
