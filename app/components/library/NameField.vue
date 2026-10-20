<script setup lang="ts">
// One name input for every create/rename in the library editor: inline error from the validator, confirm disabled
// while it fails. Unchanged = cancel, so callers only ever see real changes.
const props = defineProps<{
    initial: string
    validate: (name: string) => string | null
    /** button label; icon-only check when absent (inline use) */
    confirm?: string
    placeholder?: string
    help?: string
    /** inline editors commit (or cancel when invalid) on blur; prompts don't */
    commitOnBlur?: boolean
    size?: 'xs' | 'sm' | 'md'
}>()
const emit = defineEmits<{ submit: [name: string], cancel: [] }>()
const draft = ref(props.initial)
const error = computed(() => props.validate(draft.value))

// Enter/click unmounts the field, and some engines fire blur on removal: answer only once
let done = false
function finish(name: string | null) {
    if (done) return
    done = true
    if (name === null || name === props.initial) emit('cancel')
    else emit('submit', name)
}

function submit() {
    if (!error.value) finish(draft.value)
}

function blur() {
    if (props.commitOnBlur) finish(error.value ? null : draft.value)
}
</script>

<template>
    <UFormField :error="draft !== initial && error ? error : false" :help="help" :size="size">
        <div class="flex items-center gap-1">
            <UInput
                v-model="draft"
                :size="size"
                :placeholder="placeholder"
                class="min-w-0 flex-1"
                autofocus
                @keydown.enter.prevent="submit"
                @keydown.escape="finish(null)"
                @blur="blur"
                @click.stop
                @dblclick.stop
            />
            <!-- mousedown.prevent keeps focus in the input, so blur can't race the click -->
            <UButton
                :icon="confirm ? undefined : 'i-lucide-check'"
                :label="confirm"
                :size="size"
                :variant="confirm ? 'solid' : 'soft'"
                :color="confirm ? 'primary' : 'neutral'"
                :disabled="!!error"
                aria-label="Confirm"
                @mousedown.prevent
                @click.stop="submit"
            />
        </div>
    </UFormField>
</template>
