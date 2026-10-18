<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'
import type { NeoPrefab } from '#shared/types/neo'
import type { Problem } from '~/utils/problems'

const props = defineProps<{ tab: MapTab, prefabs: Record<string, NeoPrefab> }>()
const open = defineModel<boolean>('open', { required: true })
const project = useProject()

const view = ref<'problems' | 'json'>('problems')
const views: TabsItem[] = [
    { label: 'Problems', value: 'problems', icon: 'i-lucide-list-checks' },
    { label: 'JSON', value: 'json', icon: 'i-lucide-braces' },
]

const problems = ref<Problem[]>([])
const json = ref('')

// validation compiles and walks the whole map, so batch rapid edits (a brush stroke) into one pass
watchDebounced(() => [props.tab.map, props.prefabs, project.state.value], () => {
    const state = project.state.value
    try {
        json.value = stringify(toMapFile(props.tab.map))
        problems.value = state ? mapProblems(props.tab, props.prefabs, state) : []
    }
    catch (e) {
        problems.value = [{ level: 'error', message: e instanceof Error ? e.message : String(e), where: props.tab.name, target: { kind: 'map' } }]
    }
}, { debounce: 250, deep: true, immediate: true })

const errors = computed(() => problems.value.filter(p => p.level === 'error').length)
const warnings = computed(() => problems.value.length - errors.value)

function select(value: string | number) {
    view.value = value === 'json' ? 'json' : 'problems'
    open.value = true
}
</script>

<template>
    <div class="flex flex-col">
        <div class="flex h-8 shrink-0 items-center gap-2 px-2">
            <UTabs
                :model-value="view"
                :items="views"
                :content="false"
                variant="link"
                size="xs"
                :ui="{ list: 'p-0' }"
                @update:model-value="select"
            />
            <UBadge v-if="errors" color="error" variant="subtle" size="sm" icon="i-lucide-circle-x" :label="String(errors)" />
            <UBadge v-if="warnings" color="warning" variant="subtle" size="sm" icon="i-lucide-triangle-alert" :label="String(warnings)" />
            <div class="flex-1" />
            <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                :icon="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-up'"
                :aria-label="open ? 'Collapse panel' : 'Expand panel'"
                @click="open = !open"
            />
        </div>

        <div v-if="open" class="h-48 overflow-y-auto border-t border-default">
            <pre v-if="view === 'json'" class="p-2 font-mono text-xs text-default">{{ json }}</pre>

            <div v-else-if="!problems.length" class="flex h-full items-center justify-center gap-2 text-sm text-muted">
                <UIcon name="i-lucide-circle-check" class="size-4 text-success" />
                No problems
            </div>

            <ul v-else class="py-1">
                <li v-for="(p, i) in problems" :key="i">
                    <button
                        type="button"
                        class="flex w-full items-start gap-2 px-2 py-1 text-start text-sm hover:bg-elevated disabled:cursor-default disabled:hover:bg-transparent"
                        :disabled="!p.target"
                        @click="p.target && (tab.selection = p.target)"
                    >
                        <UIcon
                            :name="p.level === 'error' ? 'i-lucide-circle-x' : 'i-lucide-triangle-alert'"
                            class="mt-0.5 size-4 shrink-0"
                            :class="p.level === 'error' ? 'text-error' : 'text-warning'"
                        />
                        <span class="min-w-0 flex-1 break-words">{{ p.message }}</span>
                        <span class="shrink-0 truncate text-xs text-muted">{{ p.where }}</span>
                    </button>
                </li>
            </ul>
        </div>
    </div>
</template>
