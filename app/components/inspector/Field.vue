<script setup lang="ts">
import type { JsonObject, JsonValue, NeoEntry, NeoSchemaFile } from '#shared/types/neo'

const props = defineProps<{
    info: FieldInfo
    modelValue: JsonValue | undefined
    /** needed only by entry-list fields (actions/specs) */
    schema?: NeoSchemaFile
    /** override mode: this value differs from the prefab */
    overridden?: boolean
    /** the shown value is the default/prefab value, not set explicitly */
    inherited?: boolean
}>()
const emit = defineEmits<{
    /** undefined clears an optional value back to its default */
    'update:modelValue': [value: JsonValue | undefined]
    'reset': []
}>()

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v)

const field = computed(() => props.info.field)
const value = computed(() => props.modelValue === undefined ? props.info.default : props.modelValue)
// a nullable property without a schema default is null at runtime when unset
const isNull = computed(() => props.info.nullable && (value.value === null || value.value === undefined))
const missing = computed(() => props.info.required && (value.value === undefined || value.value === null || value.value === ''))

const typeLabel = computed(() => {
    const f = field.value
    switch (f.kind) {
        case 'string': return f.asset ? `asset ${f.asset}` : 'string'
        case 'number': return f.integer ? 'integer' : 'number'
        case 'vector': return f.integer ? 'point' : 'vector'
        case 'strings': return 'string[]'
        case 'actions': return 'action[]'
        case 'specs': return 'spec[]'
        default: return f.kind
    }
})
const hint = computed(() => {
    const d = props.info.default === undefined ? '' : JSON.stringify(props.info.default)
    return d && d.length <= 24 ? `${typeLabel.value} = ${d}` : typeLabel.value
})
const tooltip = computed(() => {
    const description = props.info.node.description
    return `${props.info.name}: ${hint.value}${props.info.required ? ' (required)' : ''}${typeof description === 'string' ? ` — ${description}` : ''}`
})

const numberProps = (integer: boolean) => integer
    ? { step: 1, stepSnapping: true, formatOptions: { maximumFractionDigits: 0 } }
    : { step: 0.1, stepSnapping: false, formatOptions: { maximumFractionDigits: 6 } }

const parts = computed(() => field.value.kind === 'rect'
    ? [{ key: 'x', label: 'x' }, { key: 'y', label: 'y' }, { key: 'width', label: 'w' }, { key: 'height', label: 'h' }]
    : [{ key: 'x', label: 'x' }, { key: 'y', label: 'y' }])
const partsInteger = computed(() => field.value.kind === 'vector' && field.value.integer)
const partOf = (key: string) => {
    const v = isObject(value.value) ? value.value[key] : undefined
    return typeof v === 'number' ? v : null
}

function setPart(key: string, n: number | null | undefined) {
    const next: JsonObject = {}
    for (const p of parts.value) next[p.key] = partOf(p.key) ?? 0
    next[key] = n ?? 0
    emit('update:modelValue', next)
}

const entries = computed(() => Array.isArray(value.value) ? value.value.filter(isObject) as unknown as NeoEntry[] : [])
const strings = computed(() => Array.isArray(value.value) ? value.value.map(String) : [])

function setString(s: string) {
    emit('update:modelValue', s === '' && !props.info.required ? undefined : s)
}

function toggleNull() {
    if (!isNull.value) return emit('update:modelValue', null)
    // the default of a nullable field is usually null itself; start from the type's zero value instead
    const blank = blankValue(props.info)
    emit('update:modelValue', blank === null ? blankValue({ ...props.info, default: undefined }) : blank)
}
</script>

<template>
    <UFormField
        :required="info.required"
        :error="missing ? 'Required' : false"
        :help="field.kind === 'unknown' ? 'No editor for this type; edit the JSON file directly.' : undefined"
        size="sm"
        class="border-s-2 ps-2"
        :class="[overridden ? 'border-primary' : 'border-transparent', inherited && '[&_input]:text-muted [&_button]:text-muted']"
    >
        <template #label>
            <UTooltip :text="tooltip">
                <span>{{ info.name }}</span>
            </UTooltip>
        </template>
        <template #hint>
            <span class="flex items-center gap-1">
                <span class="text-xs">{{ hint }}</span>
                <UButton
                    v-if="info.nullable"
                    label="null"
                    size="xs"
                    color="neutral"
                    :variant="isNull ? 'soft' : 'ghost'"
                    :aria-pressed="isNull"
                    @click="toggleNull"
                />
                <UTooltip v-if="overridden" text="Revert to prefab value">
                    <UButton icon="i-lucide-rotate-ccw" size="xs" color="primary" variant="ghost" aria-label="Revert to prefab value" @click="emit('reset')" />
                </UTooltip>
            </span>
        </template>

        <div v-if="isNull" class="text-sm italic text-muted">null</div>

        <UInput
            v-else-if="field.kind === 'string'"
            :model-value="typeof value === 'string' ? value : ''"
            :icon="field.asset ? 'i-lucide-image' : undefined"
            :placeholder="field.asset ? 'Content path, e.g. Sprites/wall' : (info.required ? 'required' : '')"
            class="w-full"
            @update:model-value="s => setString(String(s ?? ''))"
        />

        <UInputNumber
            v-else-if="field.kind === 'number'"
            :model-value="typeof value === 'number' ? value : null"
            v-bind="numberProps(field.integer)"
            :placeholder="info.required ? 'required' : ''"
            class="w-full"
            @update:model-value="n => emit('update:modelValue', n ?? undefined)"
        />

        <USwitch
            v-else-if="field.kind === 'boolean'"
            :model-value="value === true"
            @update:model-value="b => emit('update:modelValue', b)"
        />

        <USelect
            v-else-if="field.kind === 'enum'"
            :model-value="typeof value === 'string' ? value : undefined"
            :items="field.values"
            placeholder="Choose…"
            class="w-full"
            @update:model-value="v => emit('update:modelValue', v)"
        />

        <div v-else-if="field.kind === 'vector' || field.kind === 'rect'" class="grid grid-cols-2 gap-1">
            <UFieldGroup v-for="p in parts" :key="p.key" size="sm">
                <UBadge color="neutral" variant="subtle" :label="p.label" class="w-6 justify-center" />
                <UInputNumber
                    :model-value="partOf(p.key)"
                    v-bind="numberProps(partsInteger)"
                    :increment="false"
                    :decrement="false"
                    class="min-w-0 flex-1"
                    @update:model-value="n => setPart(p.key, n)"
                />
            </UFieldGroup>
        </div>

        <UInputTags
            v-else-if="field.kind === 'strings'"
            :model-value="strings"
            placeholder="Add…"
            add-on-blur
            class="w-full"
            @update:model-value="v => emit('update:modelValue', v.map(String))"
        />

        <InspectorEntryList
            v-else-if="schema && (field.kind === 'actions' || field.kind === 'specs')"
            :model-value="entries"
            :schema="schema"
            :kind="field.kind === 'actions' ? 'action' : 'spec'"
            @update:model-value="v => emit('update:modelValue', v as unknown as JsonValue)"
        />

        <UTextarea
            v-else
            :model-value="JSON.stringify(value, null, 2) ?? ''"
            readonly
            autoresize
            :maxrows="8"
            class="w-full font-mono"
        />
    </UFormField>
</template>
