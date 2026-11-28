<script lang="ts">
  import PassphraseField from '../PassphraseField.svelte';
  import PasswordChecklist from '../PasswordChecklist.svelte';
  import { generatePassphrase } from '../../lib/passphrase';
  import { checkRoomPassword } from '../../lib/chatRoomSettings';
  import { t } from '../../lib/t';

  export let dict: Record<string, string>;
  export let id: string;
  export let label: string;
  export let hint = '';
  export let value = '';
  export let attempted = false;

  $: checks = checkRoomPassword(value, '');
  $: rules = [
    { ok: checks.length, label: t(dict, 'common.passwordRuleLength') },
    { ok: checks.variety, label: t(dict, 'common.passwordRuleVariety') },
    { ok: checks.strength, label: t(dict, 'common.passwordRuleStrength') },
  ];
  $: error = attempted ? (!value ? t(dict, 'common.fieldRequired') : !checks.length || !checks.variety || !checks.strength ? t(dict, 'common.passwordWeak') : '') : '';
  $: describedby = [error && `${id}-error`, `${id}-rules`, hint && `${id}-hint`].filter(Boolean).join(' ');
</script>

<div class="field">
  <label class="label" for={id}>{label}<span class="label__required" aria-hidden="true">*</span></label>
  <PassphraseField {dict} {id} bind:value {describedby} invalid={!!error} required generate={generatePassphrase} />
  {#if error}
    <p id="{id}-error" class="field-error" role="alert">{error}</p>
  {/if}
  <PasswordChecklist id="{id}-rules" label={t(dict, 'common.passwordRules')} {rules} {dict} invalid={!!error} />
  {#if hint}
    <p id="{id}-hint" class="hint">{hint}</p>
  {/if}
</div>
