<script setup lang="ts">
// rendered once by the layout; any RefreshSpecsButton / failed-build toast opens it through useBuild().logOpen
const { run, running, logOpen } = useBuild()

const pre = ref<HTMLPreElement>()
const stickToBottom = ref(true)

watch(() => run.value?.lines.length, async () => {
    if (!stickToBottom.value) return
    await nextTick()
    pre.value?.scrollTo({ top: pre.value.scrollHeight })
})

function onScroll() {
    const el = pre.value
    if (el) stickToBottom.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 8
}

// dotnet prints "path(line,col): error CS1234: ..." / ": warning ..."; colour those so failures are easy to spot
const lineClass = (line: string) => / error [A-Z]+\d+:|^error|: error /i.test(line) ? 'text-error' : / warning [A-Z]+\d+:|: warning /i.test(line) ? 'text-warning' : undefined

const statusLabel = computed(() => run.value?.status === 'running' ? 'Running' : run.value?.status === 'succeeded' ? 'Succeeded' : 'Failed')
</script>

<template>
    <UModal v-model:open="logOpen" title="dotnet build" :ui="{ content: 'sm:max-w-3xl', body: 'p-0 sm:p-0' }">
        <template #description>
            <span v-if="run" class="flex items-center gap-2">
                <UBadge :color="run.status === 'failed' ? 'error' : run.status === 'succeeded' ? 'success' : 'neutral'" variant="subtle" size="sm" :label="statusLabel" />
                <span v-if="run.error" class="truncate text-error">{{ run.error }}</span>
            </span>
        </template>
        <template #body>
            <pre
                ref="pre"
                class="h-[60vh] overflow-auto whitespace-pre-wrap break-all bg-elevated/40 p-3 font-mono text-xs leading-relaxed"
                @scroll="onScroll"
            ><template v-if="run"><span v-for="(line, i) in run.lines" :key="i" :class="lineClass(line)">{{ line }}
</span></template><span v-if="running" class="text-muted">…</span></pre>
        </template>
    </UModal>
</template>
