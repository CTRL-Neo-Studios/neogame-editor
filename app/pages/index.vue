<script setup lang="ts">
import {useRecents} from "~/composables/io/useRecents.ts";
import {useAppEditorOpener} from "~/composables/app/useAppEditorOpener.ts";

const $r = useRecents()
const $o = useAppEditorOpener()

</script>

<template>
    <div class="flex flex-col items-center justify-center gap-4 h-screen">
        <div class="grid grid-cols-2 gap-3">
            <div class="flex flex-col justify-center">

            </div>
            <UScrollArea
                v-slot="{ item, index }"
                :items="$r.items"
            >
                <UButton variant="ghost" :label="item.name" @click="$o.open(item.path)"/>
            </UScrollArea>
        </div>
    </div>
</template>
