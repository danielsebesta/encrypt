<script lang="ts">
  export let shots: { id: string; src: string; label: string }[];
  export let label: string;

  let active = 0;
  const ids = shots.map((s) => `home-shot-${s.id}`);

  function onKey(e: KeyboardEvent) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    active = (active + step + shots.length) % shots.length;
    document.getElementById(`${ids[active]}-tab`)?.focus();
  }
</script>

<div class="home-app__showcase">
  <div class="home-app__phone">
    {#each shots as shot, i}
      <img
        id={ids[i]}
        class="app-shot home-app__shot"
        class:is-active={active === i}
        src={shot.src}
        alt={active === i ? shot.label : ''}
        aria-hidden={active === i ? undefined : 'true'}
        width="220"
        height="476"
        loading={i === 0 ? 'eager' : 'lazy'}
        decoding="async"
      />
    {/each}
  </div>
  <div class="home-app__chips" role="tablist" aria-label={label} tabindex="-1" on:keydown={onKey}>
    {#each shots as shot, i}
      <button
        type="button"
        role="tab"
        id={`${ids[i]}-tab`}
        class="home-app__chip"
        aria-selected={active === i}
        aria-controls={ids[i]}
        tabindex={active === i ? 0 : -1}
        on:click={() => (active = i)}
      >{shot.label}</button>
    {/each}
  </div>
</div>
