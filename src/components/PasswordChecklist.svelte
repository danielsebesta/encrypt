<script lang="ts" module>
  export interface PasswordRule {
    ok: boolean;
    label: string;
    /** Shown as advice only: the form submits without it, so it never turns danger. */
    recommended?: boolean;
  }
</script>

<script lang="ts">
  import Icon from './Icon.svelte';
  import { t } from '../lib/t';

  interface Props {
    id: string;
    label: string;
    rules: PasswordRule[];
    dict: Record<string, string>;
    /** A submit was refused: required rules that are still unmet turn danger. */
    invalid?: boolean;
  }

  let { id, label, rules, dict, invalid = false }: Props = $props();
</script>

<ul {id} class="password-rules" aria-label={label}>
  {#each rules as rule}
    {@const failed = invalid && !rule.ok && !rule.recommended}
    <li class="password-rules__rule" class:password-rules__rule--met={rule.ok} class:password-rules__rule--failed={failed}>
      <span class="password-rules__icon" aria-hidden="true">
        <Icon name={rule.ok ? 'check' : failed ? 'x' : 'circle'} />
      </span>
      <span>
        <span class="sr-only">{t(dict, rule.ok ? 'common.rule.met' : 'common.rule.unmet')}:</span>
        {rule.label}
        {#if rule.recommended}<span class="password-rules__tag">{t(dict, 'common.rule.recommended')}</span>{/if}
      </span>
    </li>
  {/each}
</ul>

<style>
  .password-rules {
    display: grid;
    gap: 0.25rem;
    margin-top: 0.25rem;
    font-size: 0.875rem;
    line-height: 1.375;
    color: var(--muted);
  }
  .password-rules__rule {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    transition: color 100ms;
  }
  .password-rules__icon {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    height: 1.25rem;
  }
  .password-rules__rule--met {
    color: var(--text);
  }
  .password-rules__rule--met .password-rules__icon {
    color: var(--accent);
  }
  .password-rules__rule--failed,
  .password-rules__rule--failed .password-rules__icon {
    color: var(--danger);
  }
  .password-rules__tag {
    color: var(--muted);
  }
  @media (prefers-reduced-motion: reduce) {
    .password-rules__rule {
      transition: none;
    }
  }
</style>
