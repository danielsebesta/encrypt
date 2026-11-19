<script lang="ts" module>
  export interface FieldControl {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': 'true' | undefined;
    'aria-errormessage': string | undefined;
    required: boolean | undefined;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    hint?: string;
    /** Shown under the control and linked through aria-errormessage; also marks the control invalid. */
    error?: string;
    required?: boolean;
    /** Visually hides the label while keeping it as the accessible name. */
    hideLabel?: boolean;
    id?: string;
    class?: string;
    /** Extra content on the label row, such as a counter or a link. */
    aside?: Snippet;
    children: Snippet<[FieldControl]>;
  }

  let { label, hint = '', error = '', required = false, hideLabel = false, id, class: className = '', aside, children }: Props = $props();

  const autoId = $props.id();
  const controlId = $derived(id ?? `field-${autoId}`);
  const hintId = $derived(`${controlId}-hint`);
  const errorId = $derived(`${controlId}-error`);

  const control = $derived<FieldControl>({
    id: controlId,
    'aria-describedby': [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined,
    'aria-invalid': error ? 'true' : undefined,
    'aria-errormessage': error ? errorId : undefined,
    required: required || undefined,
  });
</script>

<div class="field {className}">
  {#if aside}
    <div class="flex items-center justify-between gap-2">
      <label class="label" class:sr-only={hideLabel} for={controlId}>{label}{#if required}<span class="label__required" aria-hidden="true">*</span>{/if}</label>
      {@render aside()}
    </div>
  {:else}
    <label class="label" class:sr-only={hideLabel} for={controlId}>{label}{#if required}<span class="label__required" aria-hidden="true">*</span>{/if}</label>
  {/if}
  {@render children(control)}
  {#if hint}<p id={hintId} class="hint">{hint}</p>{/if}
  {#if error}<p id={errorId} class="field-error" role="alert">{error}</p>{/if}
</div>
