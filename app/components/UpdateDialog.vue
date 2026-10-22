<script setup lang="ts">
import { getVersion } from '@tauri-apps/api/app'

// rendered once by the layout; Help › Check for updates and the startup toast open it through useUpdater().dialogOpen
const $t = useAppTabs()
const { settings, phase, available, progress, error, dialogOpen, saveSettings, checkNow, install } = useUpdater()

const current = ref('')
const draft = ref({ channel: settings.value.channel, token: settings.value.token })

watch(dialogOpen, async (open) => {
    if (!open) return
    draft.value = { ...settings.value }
    current.value ||= await getVersion()
})

// public channels are always offered; restricted ones need a token from the studio (bun run apps:access in prism)
const CHANNELS = [
    { label: 'Stable', value: 'stable' },
    { label: 'Beta', value: 'beta' },
    { label: 'Insider (token)', value: 'insider' },
    { label: 'Team (token)', value: 'team' },
]

const changed = computed(() => draft.value.channel !== settings.value.channel || draft.value.token.trim() !== settings.value.token)
const busy = computed(() => phase.value === 'checking' || phase.value === 'downloading')

async function applyAndCheck() {
    if (changed.value) await saveSettings(draft.value)
    await checkNow()
}
</script>

<template>
    <UModal v-model:open="dialogOpen" title="Updates" :dismissible="phase !== 'downloading'" :ui="{ footer: 'justify-end' }">
        <template #description>
            <span v-if="current">You're on version {{ current }}.</span>
        </template>
        <template #body>
            <div class="flex flex-col gap-4">
                <UFormField label="Channel" help="Switching back to an older channel waits until it catches up; installed versions never go down.">
                    <USelect v-model="draft.channel" :items="CHANNELS" class="w-full" :disabled="busy" />
                </UFormField>
                <UFormField label="Access token" help="Only for restricted channels. Ask the studio for one.">
                    <UInput v-model="draft.token" type="password" autocomplete="off" placeholder="neo_…" class="w-full" :disabled="busy" />
                </UFormField>

                <UAlert v-if="phase === 'error' && error" color="error" variant="subtle" icon="i-lucide-circle-x" title="Couldn't check for updates" :description="error" />
                <UAlert
                    v-else-if="available"
                    color="primary"
                    variant="subtle"
                    icon="i-lucide-download"
                    :title="`Version ${available.version} is available`"
                    :description="available.notes || undefined"
                />
                <p v-else-if="phase === 'idle' && !changed" class="text-sm text-muted">No update on this channel.</p>

                <UProgress v-if="phase === 'downloading'" :model-value="progress" />
            </div>
        </template>
        <template #footer>
            <UButton label="Close" color="neutral" variant="outline" :disabled="phase === 'downloading'" @click="dialogOpen = false" />
            <UButton
                v-if="available && !changed"
                :label="phase === 'downloading' ? 'Installing…' : 'Install and restart'"
                icon="i-lucide-download"
                :loading="phase === 'downloading'"
                @click="install(() => $t.confirmDiscard($t.tabs.value))"
            />
            <UButton v-else :label="changed ? 'Save and check' : 'Check now'" icon="i-lucide-refresh-cw" :loading="phase === 'checking'" :disabled="busy" @click="applyAndCheck" />
        </template>
    </UModal>
</template>
