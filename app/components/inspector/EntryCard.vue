<script setup lang="ts">
import type { JsonObject, JsonValue, NeoEntry, NeoSchemaFile } from '#shared/types/neo'
import { isWorldField } from '~/utils/names'

const props = defineProps<{
    entry: NeoEntry
    schema: NeoSchemaFile
    kind: 'spec' | 'action'
    /** override mode: the prefab's properties for this entry */
    base?: JsonObject
    /** override mode: the object's override bag for this entry (undefined = none, null = reset to spec defaults) */
    overrides?: JsonObject | null
    removable?: boolean
    movable?: { up: boolean, down: boolean }
}>()
const emit = defineEmits<{
    'remove': []
    'move': [dir: -1 | 1]
    'update:entry': [entry: NeoEntry]
    /** undefined = remove the override key entirely, null = reset to spec defaults */
    'update:overrides': [next: JsonObject | null | undefined]
}>()

const open = ref(true)
const defKey = computed(() => props.kind === 'spec' ? specKey(props.entry.type) : actionKey(props.entry.type))
const known = computed(() => defKey.value in props.schema.$defs)
const fields = computed(() => fieldsOf(props.schema, defKey.value))
const overrideMode = computed(() => props.base !== undefined)

// NeoMap.ApplyEntries: a null override builds the entry from spec defaults, an object shallow-merges over the prefab
const values = computed<JsonObject>(() => {
    if (!overrideMode.value) return props.entry.properties ?? {}
    if (props.overrides === null) return {}
    return { ...props.base, ...props.overrides }
})
const unknownKeys = computed(() => known.value ? Object.keys(values.value).filter(k => !fields.value.some(f => f.name === k)) : [])

const isOverridden = (name: string) => props.overrides === null || (!!props.overrides && name in props.overrides)

function setProperty(name: string, value: JsonValue | undefined) {
    const properties = { ...props.entry.properties }
    if (value === undefined) delete properties[name]
    else properties[name] = deepClone(value)
    emit('update:entry', { ...props.entry, properties })
}

function setOverride(name: string, value: JsonValue | undefined) {
    // a null bag can't be partially edited (merge can't remove prefab keys), so spell out the defaults that differ from the prefab first
    const bag: JsonObject = props.overrides === null ? {} : { ...props.overrides }
    if (props.overrides === null) {
        for (const f of fields.value) {
            if (!(f.name in (props.base ?? {}))) continue
            const fallback = f.default !== undefined ? deepClone(f.default) : f.nullable ? null : blankValue(f)
            if (JSON.stringify(fallback) !== JSON.stringify(props.base?.[f.name])) bag[f.name] = fallback
        }
    }
    if (value === undefined || JSON.stringify(value) === JSON.stringify(props.base?.[name])) delete bag[name]
    else bag[name] = deepClone(value)
    emit('update:overrides', Object.keys(bag).length ? bag : undefined)
}

const set = (name: string, value: JsonValue | undefined) => overrideMode.value ? setOverride(name, value) : setProperty(name, value)

function setId(id: string) {
    const next = { ...props.entry }
    if (id) next.id = id
    else delete next.id
    emit('update:entry', next)
}

function removeUnknown() {
    const properties = { ...props.entry.properties }
    for (const k of unknownKeys.value) delete properties[k]
    emit('update:entry', { ...props.entry, properties })
}
</script>

<template>
    <div class="rounded-md border border-default">
        <div class="flex items-center gap-1 rounded-t-md bg-elevated px-1 py-0.5">
            <UButton
                :icon="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                size="xs"
                color="neutral"
                variant="ghost"
                :aria-label="open ? 'Collapse' : 'Expand'"
                @click="open = !open"
            />
            <span class="truncate text-sm font-medium">{{ entry.type }}</span>
            <UBadge v-if="kind === 'spec' && entry.id" :label="`#${entry.id}`" size="sm" color="neutral" variant="subtle" />
            <UBadge v-if="overrides === null" label="defaults" size="sm" color="primary" variant="subtle" />
            <UBadge v-else-if="overrides" label="overridden" size="sm" color="primary" variant="subtle" />
            <div class="flex-1" />
            <template v-if="overrideMode">
                <UTooltip v-if="overrides !== null" text="Reset to spec defaults (null override)">
                    <UButton icon="i-lucide-eraser" size="xs" color="neutral" variant="ghost" aria-label="Reset to spec defaults" @click="emit('update:overrides', null)" />
                </UTooltip>
                <UTooltip v-if="overrides !== undefined" text="Use prefab values (remove override)">
                    <UButton icon="i-lucide-rotate-ccw" size="xs" color="primary" variant="ghost" aria-label="Remove override" @click="emit('update:overrides', undefined)" />
                </UTooltip>
            </template>
            <template v-if="movable">
                <UButton icon="i-lucide-arrow-up" size="xs" color="neutral" variant="ghost" :disabled="!movable.up" aria-label="Move up" @click="emit('move', -1)" />
                <UButton icon="i-lucide-arrow-down" size="xs" color="neutral" variant="ghost" :disabled="!movable.down" aria-label="Move down" @click="emit('move', 1)" />
            </template>
            <UButton v-if="removable" icon="i-lucide-x" size="xs" color="neutral" variant="ghost" :aria-label="`Remove ${entry.type}`" @click="emit('remove')" />
        </div>

        <UCollapsible v-model:open="open">
            <template #content>
                <div class="flex flex-col gap-2 p-2">
                    <template v-if="!known">
                        <UAlert
                            icon="i-lucide-circle-help"
                            color="warning"
                            variant="subtle"
                            :title="`not in schema (unregistered ${kind})`"
                            description="Rebuild the game to regenerate the schema, or fix the type name."
                        />
                        <UTextarea :model-value="JSON.stringify(values, null, 2)" readonly autoresize :maxrows="8" class="w-full font-mono" />
                    </template>
                    <template v-else>
                        <UFormField v-if="kind === 'spec' && !overrideMode" label="id" hint="override key" size="sm" class="ps-2">
                            <UInput
                                :model-value="entry.id ?? ''"
                                :placeholder="entry.type"
                                class="w-full"
                                @update:model-value="s => setId(String(s ?? ''))"
                            />
                        </UFormField>
                        <InspectorField
                            v-for="f in fields"
                            :key="f.name"
                            :info="f"
                            :schema="schema"
                            :model-value="values[f.name]"
                            :overridden="overrideMode && isOverridden(f.name)"
                            :inherited="overrideMode ? !isOverridden(f.name) : !(f.name in values)"
                            :world="kind === 'action' && isWorldField(entry.type, f.name)"
                            @update:model-value="v => set(f.name, v)"
                            @reset="setOverride(f.name, undefined)"
                        />
                        <p v-if="!fields.length" class="text-xs text-muted">Tag {{ kind }}, no properties.</p>
                        <UAlert
                            v-if="unknownKeys.length"
                            icon="i-lucide-triangle-alert"
                            color="error"
                            variant="subtle"
                            :title="`Unknown properties: ${unknownKeys.join(', ')}`"
                            description="The game throws on properties its schema does not declare."
                            :actions="overrideMode ? [] : [{ label: 'Remove', color: 'error', variant: 'outline', onClick: removeUnknown }]"
                        />
                    </template>
                </div>
            </template>
        </UCollapsible>
    </div>
</template>
