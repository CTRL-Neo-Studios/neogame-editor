<script setup lang="ts">
import type { Problem } from '~/utils/problems'

defineProps<{ tab: MapTab, problems: Problem[], json: string, view: 'problems' | 'json' }>()
</script>

<template>
    <div class="overflow-y-auto">
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
</template>
