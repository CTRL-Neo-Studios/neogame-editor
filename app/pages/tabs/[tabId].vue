<script setup lang="ts">
const route = useRoute()
const $t = useAppTabs()

const tab = computed(() => $t.tabs.value.find(t => t.id === decodeURIComponent(String(route.params.tabId))) ?? null)

watchEffect(() => {
    if (tab.value) $t.activeId.value = tab.value.id
})
</script>

<template>
    <MapEditor v-if="tab?.kind === 'map'" :key="tab.id" :tab="tab" />
    <LibraryEditor v-else-if="tab?.kind === 'library'" :key="tab.id" :tab="tab" />
    <div v-else class="flex h-full items-center justify-center">
        <UEmpty icon="i-lucide-file-question" title="Tab not open" description="Open a map or library from the project page.">
            <template #actions>
                <UButton to="/" label="Project" icon="i-lucide-house" />
            </template>
        </UEmpty>
    </div>
</template>
