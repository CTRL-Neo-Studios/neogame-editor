<script setup lang="ts">
import type { NeoEntry, NeoSchemaFile } from '#shared/types/neo'

const props = defineProps<{
    modelValue: NeoEntry[]
    schema: NeoSchemaFile
    kind: 'spec' | 'action'
}>()
const emit = defineEmits<{ 'update:modelValue': [entries: NeoEntry[]] }>()

const BUILT_IN = {
    spec: new Set(['BoxColliderSpec', 'CameraSpec', 'SpriteColliderSpec', 'SpriteSpec', 'TextSpec', 'TriggerSpec']),
    action: new Set(['DestroyAction', 'LoadWorldAction', 'SetEnabledAction', 'SwitchWorldAction', 'UnloadWorldAction']),
}

const addItems = computed(() => {
    const names = props.kind === 'spec' ? specNames(props.schema) : actionNames(props.schema)
    const builtIn = BUILT_IN[props.kind]
    const group = (label: string, list: string[]) => list.length ? [{ type: 'label' as const, label }, ...list.map(name => ({ label: name }))] : []
    return [
        ...group('NeoGameLib', names.filter(n => builtIn.has(n))),
        ...group('Game', names.filter(n => !builtIn.has(n))),
    ]
})

// writes go through a copy so parents can checkpoint before their data changes (v-model setter = commit point)
const commit = (next: NeoEntry[]) => emit('update:modelValue', next)

// remounting the add menu clears its (uncontrolled) selection so it always reads "Add …"
const addKey = ref(0)

function add(item: { label: string } | undefined) {
    if (!item) return
    const defKey = props.kind === 'spec' ? specKey(item.label) : actionKey(item.label)
    commit([...props.modelValue, { type: item.label, properties: blankProperties(props.schema, defKey) }])
    addKey.value++
}

function replace(index: number, entry: NeoEntry) {
    const next = [...props.modelValue]
    next[index] = entry
    commit(next)
}

function move(index: number, dir: -1 | 1) {
    const next = [...props.modelValue]
    const [entry] = next.splice(index, 1)
    next.splice(index + dir, 0, entry!)
    commit(next)
}
</script>

<template>
    <div class="flex flex-col gap-2">
        <InspectorEntryCard
            v-for="(entry, i) in modelValue"
            :key="`${i}:${entry.type}`"
            :entry="entry"
            :schema="schema"
            :kind="kind"
            removable
            :movable="{ up: i > 0, down: i < modelValue.length - 1 }"
            @update:entry="e => replace(i, e)"
            @remove="commit(modelValue.filter((_, j) => j !== i))"
            @move="dir => move(i, dir)"
        />
        <USelectMenu
            :key="addKey"
            :items="addItems"
            :placeholder="kind === 'spec' ? 'Add spec…' : 'Add action…'"
            :search-input="{ placeholder: 'Search…' }"
            icon="i-lucide-plus"
            size="sm"
            class="w-full"
            @update:model-value="add"
        />
    </div>
</template>
