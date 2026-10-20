<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'

// one place for "dotnet build": home header, the no-schema states and the File menu all use this button or useBuild()
withDefaults(defineProps<{ size?: ButtonProps['size'], variant?: ButtonProps['variant'] }>(), { size: 'md', variant: 'soft' })

const { run, running, logOpen, build } = useBuild()
const project = useProject()

const lastRun = computed(() => {
    const r = run.value
    if (!r || r.status === 'running') return 'Runs dotnet build in the project root so new specs show up'
    const seconds = (((r.finishedAt ?? r.startedAt) - r.startedAt) / 1000).toFixed(1)
    return r.status === 'succeeded' ? `Last build succeeded in ${seconds}s` : `Last build failed: ${r.error}`
})
</script>

<template>
    <UFieldGroup :size="size">
        <UTooltip :text="lastRun">
            <UButton
                :variant="variant"
                color="neutral"
                icon="i-lucide-hammer"
                :label="running ? 'Building…' : 'Refresh specs'"
                :loading="running"
                :disabled="!project.state.value"
                @click="build"
            />
        </UTooltip>
        <UTooltip text="Build log">
            <UButton
                :variant="variant"
                :color="run?.status === 'failed' ? 'error' : 'neutral'"
                icon="i-lucide-scroll-text"
                aria-label="Build log"
                :disabled="!run"
                @click="logOpen = true"
            />
        </UTooltip>
    </UFieldGroup>
</template>
