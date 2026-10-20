<script setup lang="ts">
/** Bottom status strip: dock toggles + problem counts; the default slot adds left-side items, `right` adds right-side ones. */
defineProps<{ errors?: number, warnings?: number }>()
const { sidebar, inspector, bottom, bottomView } = usePanels()

function show(view: 'problems' | 'json') {
    // clicking the open view again closes the panel, like Zed
    bottom.value = !(bottom.value && bottomView.value === view)
    bottomView.value = view
}

const button = { size: 'xs', color: 'neutral', variant: 'ghost', activeVariant: 'soft', ui: { leadingIcon: 'size-3.5' } } as const
</script>

<template>
    <div class="flex h-6 shrink-0 items-center gap-0.5 border-t border-default px-1 text-xs">
        <UTooltip text="Toggle sidebar">
            <UButton v-bind="button" icon="i-lucide-panel-left" :active="sidebar" aria-label="Toggle sidebar" @click="sidebar = !sidebar" />
        </UTooltip>
        <UTooltip text="Toggle bottom panel">
            <UButton v-bind="button" icon="i-lucide-panel-bottom" :active="bottom" aria-label="Toggle bottom panel" @click="bottom = !bottom" />
        </UTooltip>
        <UButton v-if="errors !== undefined" v-bind="button" :active="bottom && bottomView === 'problems'" class="gap-1.5" @click="show('problems')">
            <span class="flex items-center gap-1" :class="errors ? 'text-error' : 'text-muted'">
                <UIcon name="i-lucide-circle-x" class="size-3.5" />{{ errors }}
            </span>
            <span class="flex items-center gap-1" :class="warnings ? 'text-warning' : 'text-muted'">
                <UIcon name="i-lucide-triangle-alert" class="size-3.5" />{{ warnings ?? 0 }}
            </span>
        </UButton>
        <UButton v-bind="button" icon="i-lucide-braces" label="JSON" :active="bottom && bottomView === 'json'" @click="show('json')" />
        <slot />
        <div class="flex-1" />
        <slot name="right" />
        <UTooltip text="Toggle inspector">
            <UButton v-bind="button" icon="i-lucide-panel-right" :active="inspector" aria-label="Toggle inspector" @click="inspector = !inspector" />
        </UTooltip>
    </div>
</template>
