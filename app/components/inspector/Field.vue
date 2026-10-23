<script setup lang="ts">
import type { JsonObject, JsonValue, NeoEntry, NeoSchemaFile } from '#shared/types/neo'
import type { NeoColor } from '~/utils/schema'
import {useProject} from "~/composables/project/useProject.ts";

const props = defineProps<{
    info: FieldInfo
    modelValue: JsonValue | undefined
    /** needed only by entry-list fields (actions/specs) */
    schema?: NeoSchemaFile
    /** override mode: this value differs from the prefab */
    overridden?: boolean
    /** the shown value is the default/prefab value, not set explicitly */
    inherited?: boolean
    /** the value names maps (world actions' `world` / `unload[]`) */
    world?: boolean
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

// ---- color: NeoColor { r, g, b, a? }; the picker edits rgb as hex, `a` is its own input (straight alpha) ----
const color = computed(() => colorValue(value.value) ?? { r: 255, g: 255, b: 255, a: 255 })
const hex = computed(() => '#' + [color.value.r, color.value.g, color.value.b].map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase())
const rgba = computed(() => `rgba(${color.value.r}, ${color.value.g}, ${color.value.b}, ${color.value.a / 255})`)
function setColor(part: Partial<NeoColor>) {
    emit('update:modelValue', colorJson({ ...color.value, ...part }))
}
function setHex(s: string | undefined) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(s ?? '')
    if (m) setColor({ r: parseInt(m[1]!, 16), g: parseInt(m[2]!, 16), b: parseInt(m[3]!, 16) })
}

function setString(s: string) {
    emit('update:modelValue', s === '' && !props.info.required ? undefined : s)
}

// a value to start editing from when the field is null: the schema default, else the type's zero value
function setFromNull() {
    const blank = blankValue(props.info)
    emit('update:modelValue', blank === null ? blankValue({ ...props.info, default: undefined }) : blank)
}

// ---- world fields: map names, checked against the project's maps (code-registered worlds are fine too) ----
const project = useProject()
const worldNames = computed(() => !props.world ? [] : field.value.kind === 'strings' ? strings.value : typeof value.value === 'string' && value.value ? [value.value] : [])
const worldError = computed(() => {
    for (const name of worldNames.value) {
        const error = pathNameError(name)
        if (error) return worldNames.value.length > 1 ? `'${name}': ${error}` : error
    }
    return null
})
const unknownWorlds = computed(() => worldNames.value.filter(n => !project.state.value?.files.map.names.includes(n)))

// ---- Texture2D preview: resolve the Content path the same way the canvas does ----
const texturePath = computed(() => field.value.kind === 'string' && field.value.asset === 'Texture2D' && typeof value.value === 'string'
    ? value.value.trim()
    : '')
const preview = ref<{ url: string | null, missing: boolean, size: string }>({ url: null, missing: false, size: '' })

function revokePreview() {
    if (preview.value.url) URL.revokeObjectURL(preview.value.url)
    preview.value = { url: null, missing: false, size: '' }
}

watch(texturePath, (path, _, onCleanup) => {
    revokePreview()
    if (!path) return
    let stale = false
    // debounced: the path is typed one character at a time
    const timer = setTimeout(async () => {
        const url = await project.assetUrl(path)
        if (stale) {
            if (url) URL.revokeObjectURL(url)
            return
        }
        preview.value = { url, missing: !url, size: '' }
    }, 200)
    onCleanup(() => {
        stale = true
        clearTimeout(timer)
    })
}, { immediate: true })
onBeforeUnmount(revokePreview)

function onPreviewLoad(e: Event) {
    const img = e.target as HTMLImageElement
    preview.value.size = `${img.naturalWidth}×${img.naturalHeight}`
}
</script>

<template>
    <UFormField
        :required="info.required"
        :error="missing ? 'Required' : worldError ?? false"
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
        <template v-if="unknownWorlds.length" #help>
            <span class="text-warning">no map named {{ unknownWorlds.map(n => `'${n}'`).join(', ') }} (ok if registered in code)</span>
        </template>
        <template #hint>
            <span class="flex items-center gap-1">
                <span class="text-xs">{{ hint }}</span>
                <UTooltip v-if="info.nullable && !isNull" text="Set to null">
                    <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" aria-label="Set to null" @click="emit('update:modelValue', null)" />
                </UTooltip>
                <UTooltip v-if="overridden" text="Revert to prefab value">
                    <UButton icon="i-lucide-rotate-ccw" size="xs" color="primary" variant="ghost" aria-label="Revert to prefab value" @click="emit('reset')" />
                </UTooltip>
            </span>
        </template>

        <!-- strings stay editable while null: typing simply replaces the null -->
        <UButton
            v-if="isNull && field.kind !== 'string'"
            icon="i-lucide-plus"
            :label="`null — set ${typeLabel}`"
            size="sm"
            color="neutral"
            variant="outline"
            class="w-full justify-start italic text-muted"
            @click="setFromNull"
        />

        <div v-else-if="field.kind === 'string'" class="space-y-1">
            <UInputMenu
                v-if="world"
                mode="autocomplete"
                :model-value="typeof value === 'string' ? value : ''"
                :items="project.state.value?.files.map.names ?? []"
                icon="i-lucide-map"
                :placeholder="isNull ? 'null' : 'map name, e.g. forest/level1'"
                class="w-full"
                @update:model-value="s => setString(String(s ?? ''))"
            />
            <UInput
                v-else
                :model-value="typeof value === 'string' ? value : ''"
                :icon="field.asset ? 'i-lucide-image' : undefined"
                :placeholder="isNull ? 'null' : field.asset ? 'Content path, e.g. Sprites/wall' : (info.required ? 'required' : '')"
                class="w-full"
                @update:model-value="s => setString(String(s ?? ''))"
            />
            <div v-if="texturePath" class="flex items-center gap-2">
                <div
                    class="grid size-16 shrink-0 place-items-center overflow-hidden rounded border border-default"
                    style="background: repeating-conic-gradient(#3a3d44 0 25%, #2b2d33 0 50%) 0 0 / 8px 8px"
                >
                    <img
                        v-if="preview.url"
                        :src="preview.url"
                        :alt="texturePath"
                        class="size-full object-contain [image-rendering:pixelated]"
                        @load="onPreviewLoad"
                    >
                    <UIcon v-else :name="preview.missing ? 'i-lucide-image-off' : 'i-lucide-loader-circle'" class="size-5 text-muted" :class="!preview.missing && 'animate-spin'" />
                </div>
                <span class="min-w-0 text-xs" :class="preview.missing ? 'text-error' : 'text-muted'">
                    {{ preview.missing ? 'Not found in Content (.png/.jpg/.jpeg/.bmp)' : preview.size || 'Loading…' }}
                </span>
            </div>
        </div>

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

        <div v-else-if="field.kind === 'color'" class="flex gap-1">
            <UPopover>
                <UButton color="neutral" variant="outline" size="sm" class="min-w-0 flex-1 justify-start font-mono" :aria-label="`${info.name}: ${hex}`">
                    <template #leading>
                        <span
                            class="size-4 shrink-0 rounded-sm border border-default"
                            style="background: repeating-conic-gradient(#888 0 25%, #ccc 0 50%) 0 0 / 8px 8px"
                        >
                            <span class="block size-full rounded-sm" :style="{ background: rgba }" />
                        </span>
                    </template>
                    {{ hex }}
                </UButton>
                <template #content>
                    <UColorPicker :model-value="hex" class="p-2" @update:model-value="setHex" />
                </template>
            </UPopover>
            <UFieldGroup size="sm" class="w-24 shrink-0">
                <UBadge color="neutral" variant="subtle" label="a" class="w-6 justify-center" />
                <UInputNumber
                    :model-value="color.a"
                    :min="0"
                    :max="255"
                    v-bind="numberProps(true)"
                    :increment="false"
                    :decrement="false"
                    class="min-w-0 flex-1"
                    @update:model-value="n => setColor({ a: n ?? 255 })"
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
