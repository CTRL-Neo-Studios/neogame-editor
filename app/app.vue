<template>
    <UApp>
        <NuxtLoadingIndicator color="var(--ui-primary)" />
        <NuxtLayout>
            <NuxtPage />
        </NuxtLayout>
    </UApp>
</template>

<style>
/* decorum's overlay titlebar sits above the page; let clicks through and drag from our own topbar instead.
   pointer-events inherits, so decorum's Windows min/max/close buttons opt back in. */
div[data-tauri-decorum-tb] {
    pointer-events: none;
    div[data-tauri-drag-region] {
        pointer-events: none;
    }
    .decorum-tb-btn {
        pointer-events: auto;
    }
}
</style>
