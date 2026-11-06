<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { t } from '../../lib/t';
  import { EMOJI_ICONS } from '../../lib/emoji/icons';
  import {
    applySkinTone,
    detectEmojiSupport,
    emojiName,
    getRecentEmoji,
    getSkinTone,
    loadEmojiData,
    loadEmojiNames,
    prepareSearch,
    recordEmojiUse,
    searchEmoji,
    setSkinTone,
    SKIN_TONES,
    visibleGroups,
    type EmojiGroup,
    type EmojiNames,
    type SkinTone,
  } from '../../lib/emoji';

  type Skin = 'web' | 'ios' | 'material';
  type Section = { id: string; items: string[] };
  type Cursor = { s: string; i: number };

  let {
    locale = 'en',
    dict,
    skin = 'web',
    mode = 'insert',
    autofocus = false,
    onpick,
    onclose,
  }: {
    locale?: string;
    dict: Record<string, string>;
    skin?: Skin;
    mode?: 'insert' | 'reaction';
    autofocus?: boolean;
    onpick: (emoji: string) => void;
    onclose?: () => void;
  } = $props();

  const TONE_KEYS = ['default', 'light', 'mediumLight', 'medium', 'mediumDark', 'dark'];
  const TONE_COLORS = ['#ffc93a', '#f7d7c4', '#e5b48f', '#c68e62', '#9e6a43', '#5c4033'];
  const CELL: Record<Skin, number> = { web: 38, ios: 44, material: 48 };
  const PAD: Record<Skin, number> = { web: 6, ios: 8, material: 8 };
  const uid = `ep-${Math.random().toString(36).slice(2, 8)}`;

  let groups = $state<EmojiGroup[] | null>(null);
  let popular = $state<string[]>([]);
  let names = $state<EmojiNames | null>(null);
  let fallbackNames = $state<EmojiNames | null>(null);
  let failed = $state(false);
  let query = $state('');
  let tone = $state<SkinTone>(getSkinTone());
  let toneOpen = $state(false);
  let recents = $state<string[]>(getRecentEmoji());
  let active = $state('');
  let tabsEl = $state<HTMLElement | null>(null);
  let rendered = $state<Record<string, boolean>>({});
  let cols = $state(8);

  let scrollEl = $state<HTMLDivElement>();
  let searchEl = $state<HTMLInputElement>();
  let toneBtnEl = $state<HTMLButtonElement>();
  let tonesEl = $state<HTMLDivElement>();
  const sectionEls: Record<string, HTMLElement> = {};
  let tabStop: HTMLElement | null = null;
  let io: IntersectionObserver | undefined;
  let idleHandle = 0;
  let scrollFrame = 0;
  let savedTop = 0;

  const cell = $derived(CELL[skin]);
  const searching = $derived(query.trim().length > 0);
  const withTone = (emoji: string, tones: boolean) => (tones && tone ? applySkinTone(emoji, tone) : emoji);

  const sections = $derived.by<Section[]>(() => {
    if (!groups) return [];
    const list = groups.map((g) => ({ id: g.id, items: g.entries.map((e) => withTone(e.emoji, e.tones)) }));
    return recents.length ? [{ id: 'recent', items: recents }, ...list] : list;
  });
  const candidates = $derived(groups ? groups.flatMap((g) => g.entries.map((e) => e.emoji)) : []);
  const toneable = $derived(new Set(groups ? groups.flatMap((g) => g.entries.filter((e) => e.tones).map((e) => e.emoji)) : []));
  const results = $derived(searching && groups ? searchEmoji(query, candidates, [names, fallbackNames], 120, popular).map((e) => withTone(e, toneable.has(e))) : []);
  const visible = $derived<Section[]>(searching ? [{ id: 'search', items: results }] : sections);
  const tabs = $derived(sections.map((s) => s.id));

  const label = (emoji: string) => emojiName(emoji, names, fallbackNames) ?? emoji;
  const toneName = (v: SkinTone) => t(dict, `emoji.tone.${TONE_KEYS[v]}`);
  const sectionTitle = (id: string) => (id === 'search' ? t(dict, 'emoji.searchResults') : t(dict, `emoji.category.${id}`));
  const rows = (n: number) => Math.ceil(n / cols);

  onMount(() => {
    let cancelled = false;
    loadEmojiData()
      .then(async (data) => {
        if (cancelled) return;
        popular = data.popular;
        groups = visibleGroups(data, detectEmojiSupport(data.probes));
        if (sections[0]) rendered[sections[0].id] = true;
        active = sections[0]?.id ?? '';
        await tick();
        fillIdle();
      })
      .catch(() => {
        if (!cancelled) failed = true;
      });
    if (autofocus) searchEl?.focus({ preventScroll: true });
    const ro = new ResizeObserver(measure);
    if (scrollEl) ro.observe(scrollEl);
    measure();
    return () => {
      cancelled = true;
      ro.disconnect();
      io?.disconnect();
      cancelIdle();
      cancelAnimationFrame(scrollFrame);
    };
  });

  $effect(() => {
    const wanted = locale;
    let cancelled = false;
    loadEmojiNames(wanted).then((n) => {
      if (cancelled) return;
      names = n;
      schedule(() => prepareSearch(n));
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    if (!searching || fallbackNames || locale === 'en') return;
    loadEmojiNames('en').then((n) => (fallbackNames = n)).catch(() => {});
  });

  $effect(() => {
    void visible;
    tick().then(() => {
      if (!tabStop?.isConnected || searching) setTabStop(scrollEl?.querySelector<HTMLElement>('.ep__cell') ?? null);
    });
  });

  $effect(() => {
    const row = tabsEl;
    const tab = row?.querySelector<HTMLElement>(`.ep__tab:nth-child(${tabs.indexOf(active) + 1})`);
    if (!row || !tab || row.scrollWidth <= row.clientWidth) return;
    const left = tab.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft;
    if (left < row.scrollLeft) row.scrollLeft = left;
    else if (left + tab.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left + tab.offsetWidth - row.clientWidth;
  });

  function measure() {
    if (!scrollEl) return;
    const width = scrollEl.clientWidth - PAD[skin] * 2;
    if (width > 0) cols = Math.max(5, Math.floor(width / cell));
  }

  const schedule = (fn: () => void): number =>
    typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 400 }) : window.setTimeout(fn, 40);

  function cancelIdle() {
    if (!idleHandle) return;
    if (typeof cancelIdleCallback === 'function') cancelIdleCallback(idleHandle);
    else clearTimeout(idleHandle);
    idleHandle = 0;
  }

  function fillIdle() {
    cancelIdle();
    const next = sections.find((s) => !rendered[s.id]);
    if (!next) return;
    idleHandle = schedule(() => {
      idleHandle = 0;
      rendered[next.id] = true;
      fillIdle();
    });
  }

  function track(node: HTMLElement, id: string) {
    sectionEls[id] = node;
    const forget = () => {
      if (sectionEls[id] === node) delete sectionEls[id];
    };
    if (rendered[id] || id === 'search') return { destroy: forget };
    io ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const sid = (entry.target as HTMLElement).dataset.section;
          if (sid) rendered[sid] = true;
          io?.unobserve(entry.target);
        }
      },
      { root: scrollEl, rootMargin: '300px 0px' },
    );
    io.observe(node);
    return {
      destroy() {
        io?.unobserve(node);
        forget();
      },
    };
  }

  function setTabStop(el: HTMLElement | null) {
    if (tabStop && tabStop !== el && tabStop.isConnected) tabStop.tabIndex = -1;
    tabStop = el;
    if (el) el.tabIndex = 0;
  }

  function setQuery(value: string) {
    const was = searching;
    query = value;
    const now = value.trim().length > 0;
    if (!scrollEl || was === now) {
      if (now && scrollEl) scrollEl.scrollTop = 0;
      return;
    }
    if (now) {
      savedTop = scrollEl.scrollTop;
      scrollEl.scrollTop = 0;
    } else {
      tick().then(() => {
        if (scrollEl) scrollEl.scrollTop = savedTop;
        syncActive();
      });
    }
  }

  function pick(emoji: string, keepOpen: boolean) {
    recordEmojiUse(emoji);
    onpick(emoji);
    if (!(keepOpen && mode === 'insert')) onclose?.();
  }

  function cellFrom(target: EventTarget | null): { el: HTMLElement; s: string; i: number } | null {
    const el = (target as HTMLElement | null)?.closest?.<HTMLElement>('.ep__cell');
    if (!el?.dataset.s) return null;
    return { el, s: el.dataset.s, i: Number(el.dataset.i) };
  }

  function onGridClick(e: MouseEvent) {
    const hit = cellFrom(e.target);
    if (!hit) return;
    const emoji = visible.find((s) => s.id === hit.s)?.items[hit.i];
    if (!emoji) return;
    setTabStop(hit.el);
    pick(emoji, e.shiftKey);
  }

  function step(idx: number, i: number, d: 1 | -1): Cursor | null {
    const sec = visible[idx];
    const j = i + d;
    if (j >= 0 && j < sec.items.length) return { s: sec.id, i: j };
    const other = visible[idx + d];
    return other ? { s: other.id, i: d > 0 ? 0 : other.items.length - 1 } : null;
  }

  function vertical(idx: number, i: number, d: 1 | -1): Cursor | null {
    const sec = visible[idx];
    const col = i % cols;
    const j = i + d * cols;
    if (d > 0) {
      if (j < sec.items.length) return { s: sec.id, i: j };
      if (i < Math.floor((sec.items.length - 1) / cols) * cols) return { s: sec.id, i: sec.items.length - 1 };
      const other = visible[idx + 1];
      return other ? { s: other.id, i: Math.min(col, other.items.length - 1) } : null;
    }
    if (j >= 0) return { s: sec.id, i: j };
    const other = visible[idx - 1];
    if (!other) return null;
    return { s: other.id, i: Math.min(Math.floor((other.items.length - 1) / cols) * cols + col, other.items.length - 1) };
  }

  async function moveTo(next: Cursor) {
    if (!rendered[next.s] && next.s !== 'search') {
      rendered[next.s] = true;
      await tick();
    }
    const el = scrollEl?.querySelector<HTMLElement>(`.ep__cell[data-s="${next.s}"][data-i="${next.i}"]`);
    if (!el) return;
    setTabStop(el);
    el.focus({ preventScroll: true });
    reveal(el);
  }

  function reveal(el: HTMLElement) {
    if (!scrollEl) return;
    const box = scrollEl.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const head = (el.closest('.ep__section')?.querySelector('.ep__head') as HTMLElement | null)?.offsetHeight ?? 0;
    if (r.top < box.top + head) scrollEl.scrollTop -= box.top + head - r.top;
    else if (r.bottom > box.bottom) scrollEl.scrollTop += r.bottom - box.bottom;
  }

  function onGridKey(e: KeyboardEvent) {
    const hit = cellFrom(e.target);
    if (!hit) return;
    const idx = visible.findIndex((s) => s.id === hit.s);
    if (idx < 0) return;
    const len = visible[idx].items.length;
    const rowStart = hit.i - (hit.i % cols);
    let next: Cursor | null = null;
    switch (e.key) {
      case 'ArrowRight':
        next = step(idx, hit.i, 1);
        break;
      case 'ArrowLeft':
        next = step(idx, hit.i, -1);
        break;
      case 'ArrowDown':
        next = vertical(idx, hit.i, 1);
        break;
      case 'ArrowUp':
        next = vertical(idx, hit.i, -1);
        if (!next) {
          e.preventDefault();
          searchEl?.focus();
          return;
        }
        break;
      case 'Home':
        next = e.ctrlKey ? { s: visible[0].id, i: 0 } : { s: hit.s, i: rowStart };
        break;
      case 'End':
        next = e.ctrlKey
          ? { s: visible[visible.length - 1].id, i: visible[visible.length - 1].items.length - 1 }
          : { s: hit.s, i: Math.min(rowStart + cols - 1, len - 1) };
        break;
      default:
        if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) searchEl?.focus();
        return;
    }
    e.preventDefault();
    if (next) moveTo(next);
  }

  function onSearchKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' && visible[0]?.items.length) {
      e.preventDefault();
      moveTo(searching ? { s: 'search', i: 0 } : { s: visible[0].id, i: 0 });
    } else if (e.key === 'Enter' && searching && results[0]) {
      e.preventDefault();
      pick(results[0], e.shiftKey);
    } else if (e.key === 'Escape' && query) {
      e.preventDefault();
      e.stopPropagation();
      setQuery('');
    }
  }

  function onRootKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (toneOpen) closeTones();
    else onclose?.();
  }

  async function jump(id: string) {
    if (searching) {
      query = '';
      await tick();
    }
    rendered[id] = true;
    await tick();
    const el = sectionEls[id];
    if (!scrollEl || !el) return;
    scrollEl.scrollTop = el.offsetTop;
    active = id;
    const first = el.querySelector<HTMLElement>('.ep__cell');
    if (first) setTabStop(first);
  }

  function onTabsKey(e: KeyboardEvent) {
    const buttons = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('.ep__tab')];
    const at = buttons.indexOf(e.target as HTMLButtonElement);
    if (at < 0) return;
    const to = e.key === 'ArrowRight' ? (at + 1) % buttons.length
      : e.key === 'ArrowLeft' ? (at - 1 + buttons.length) % buttons.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? buttons.length - 1
      : -1;
    if (to < 0) return;
    e.preventDefault();
    buttons.forEach((b, n) => (b.tabIndex = n === to ? 0 : -1));
    buttons[to].focus();
  }

  function onScroll() {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      syncActive();
    });
  }

  function syncActive() {
    if (!scrollEl || searching) return;
    const top = scrollEl.scrollTop + 4;
    let current = sections[0]?.id ?? '';
    for (const s of sections) {
      const el = sectionEls[s.id];
      if (el && el.offsetTop <= top) current = s.id;
      else break;
    }
    if (scrollEl.scrollTop > 0 && scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 2) current = sections[sections.length - 1]?.id ?? current;
    active = current;
  }

  async function openTones() {
    toneOpen = true;
    await tick();
    tonesEl?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }

  async function closeTones() {
    toneOpen = false;
    await tick();
    toneBtnEl?.focus();
  }

  function chooseTone(v: SkinTone) {
    tone = v;
    setSkinTone(v);
  }

  function onTonesKey(e: KeyboardEvent) {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const v = ((tone + d + SKIN_TONES.length) % SKIN_TONES.length) as SkinTone;
    chooseTone(v);
    tick().then(() => tonesEl?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  }
</script>

{#snippet block(section: Section)}
  <section class="ep__section" data-section={section.id} style="--rows: {rows(section.items.length)}" use:track={section.id}>
    <div class="ep__head" id="{uid}-{section.id}">{sectionTitle(section.id)}</div>
    {#if rendered[section.id] || section.id === 'search'}
      <div class="ep__grid" role="group" aria-labelledby="{uid}-{section.id}">
        {#each section.items as emoji, i}
          <button type="button" class="ep__cell" tabindex="-1" data-s={section.id} data-i={i} aria-label={label(emoji)}>{emoji}</button>
        {/each}
      </div>
    {:else}
      <div class="ep__placeholder"></div>
    {/if}
  </section>
{/snippet}

<div
  class="ep ep--{skin}"
  role="group"
  aria-label={t(dict, 'emoji.label')}
  style="--cols: {cols}; --cell: {cell}px; --pad: {PAD[skin]}px"
  onkeydown={onRootKey}
>
  <div class="ep__top">
    {#if toneOpen}
      <!-- svelte-ignore a11y_interactive_supports_focus -->
      <div class="ep__tones" role="radiogroup" aria-label={t(dict, 'emoji.skinTone')} bind:this={tonesEl} onkeydown={onTonesKey}>
        {#each SKIN_TONES as v (v)}
          <button
            type="button"
            role="radio"
            class="ep__swatch"
            aria-checked={tone === v}
            aria-label={toneName(v)}
            title={toneName(v)}
            tabindex={tone === v ? 0 : -1}
            style="--swatch: {TONE_COLORS[v]}"
            onclick={() => {
              chooseTone(v);
              closeTones();
            }}
          ></button>
        {/each}
      </div>
    {:else}
      <div class="ep__search">
        <svg class="ep__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html EMOJI_ICONS.search}</svg>
        <input
          bind:this={searchEl}
          class="ep__input"
          class:input={skin === 'web'}
          type="search"
          inputmode="search"
          enterkeyhint="search"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder={t(dict, 'emoji.searchPlaceholder')}
          aria-label={t(dict, 'emoji.search')}
          aria-controls="{uid}-grid"
          value={query}
          oninput={(e) => setQuery(e.currentTarget.value)}
          onkeydown={onSearchKey}
        />
        {#if query}
          <button
            type="button"
            class="ep__clear"
            aria-label={t(dict, 'emoji.clearSearch')}
            onclick={() => {
              setQuery('');
              searchEl?.focus();
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html EMOJI_ICONS.clear}</svg>
          </button>
        {/if}
      </div>
    {/if}
    <button
      bind:this={toneBtnEl}
      type="button"
      class="ep__tone-toggle"
      aria-expanded={toneOpen}
      aria-label={t(dict, 'emoji.skinToneCurrent').replace('{tone}', toneName(tone))}
      title={t(dict, 'emoji.skinTone')}
      onclick={() => (toneOpen ? closeTones() : openTones())}
    >
      <span class="ep__dot" style="--swatch: {TONE_COLORS[tone]}"></span>
    </button>
  </div>

  {#if tabs.length}
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <div class="ep__tabs" bind:this={tabsEl} role="toolbar" aria-label={t(dict, 'emoji.categories')} onkeydown={onTabsKey}>
      {#each tabs as id (id)}
        <button
          type="button"
          class="ep__tab"
          aria-label={sectionTitle(id)}
          title={sectionTitle(id)}
          aria-current={!searching && active === id ? 'true' : undefined}
          tabindex={active === id ? 0 : -1}
          onclick={() => jump(id)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html EMOJI_ICONS[id]}</svg>
        </button>
      {/each}
    </div>
  {/if}

  <div class="ep__scroll" id="{uid}-grid" bind:this={scrollEl} onscroll={onScroll} onclick={onGridClick} onkeydown={onGridKey}>
    {#if failed}
      <div class="ep__empty">{t(dict, 'emoji.noResults')}</div>
    {:else if !groups}
      <div class="ep__skeleton" aria-busy="true" aria-label={t(dict, 'emoji.loading')}>
        <span class="ep__skeleton-head"></span>
        <div class="ep__grid">
          {#each { length: cols * 4 } as _, n (n)}
            <span class="ep__skeleton-cell"></span>
          {/each}
        </div>
      </div>
    {:else}
      {#if searching}
        {#if results.length}
          {@render block({ id: 'search', items: results })}
        {:else}
          <div class="ep__empty" role="status">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html EMOJI_ICONS.search}</svg>
            <span>{t(dict, 'emoji.noResults')}</span>
          </div>
        {/if}
      {/if}
      <div hidden={searching}>
        {#each sections as section (section.id)}
          {@render block(section)}
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .ep {
    --emoji-font: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
    height: var(--emoji-picker-h, 360px);
    background: var(--ep-bg);
    color: var(--ep-text);
    overflow: hidden;
  }

  .ep--web {
    --ep-bg: var(--bg);
    --ep-text: var(--text);
    --ep-muted: var(--muted);
    --ep-line: var(--line-soft);
    --ep-hover: var(--surface-2);
    --ep-press: color-mix(in srgb, var(--surface-2), var(--text) 8%);
    --ep-accent: var(--accent);
    --ep-emoji: 1.5rem;
    --ep-radius: 0.5rem;
  }

  .ep--ios {
    --ep-bg: var(--app-sheet, var(--app-bg));
    --ep-text: var(--app-label);
    --ep-muted: var(--app-label-2);
    --ep-line: var(--app-separator);
    --ep-field: var(--app-fill);
    --ep-hover: var(--app-fill);
    --ep-press: var(--app-fill-2);
    --ep-accent: var(--app-tint);
    --ep-emoji: 2rem;
    --ep-radius: 0.625rem;
    font-family: var(--font-sans);
  }

  .ep--material {
    --ep-bg: var(--app-surface-2);
    --ep-text: var(--app-label);
    --ep-muted: var(--app-label-2);
    --ep-line: var(--app-separator);
    --ep-field: var(--app-surface-3);
    --ep-hover: color-mix(in srgb, var(--app-label) 8%, transparent);
    --ep-press: color-mix(in srgb, var(--app-label) 12%, transparent);
    --ep-accent: var(--app-tint);
    --ep-emoji: 1.875rem;
    --ep-radius: 999px;
    font-family: var(--font-sans);
  }

  .ep button {
    -webkit-tap-highlight-color: transparent;
  }

  .ep__top {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem var(--pad) 0.375rem;
    flex: none;
  }

  .ep--ios .ep__top {
    padding: 0.625rem 0.75rem 0.375rem;
    gap: 0.5rem;
  }

  .ep--material .ep__top {
    padding: 0.75rem 0.75rem 0.5rem;
    gap: 0.5rem;
  }

  .ep__search {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
  }

  .ep__search-icon {
    position: absolute;
    left: 0.75rem;
    width: 1.0625rem;
    height: 1.0625rem;
    color: var(--ep-muted);
    pointer-events: none;
  }

  .ep__input {
    width: 100%;
    min-width: 0;
    font-size: 1rem;
    color: var(--ep-text);
    appearance: none;
  }

  .ep__input::-webkit-search-cancel-button,
  .ep__input::-webkit-search-decoration {
    appearance: none;
  }

  .ep__input::placeholder {
    color: var(--ep-muted);
    opacity: 1;
  }

  .ep--web .ep__input {
    min-height: 2.5rem;
    padding: 0.375rem 2.25rem 0.375rem 2.25rem;
  }

  .ep--ios .ep__input,
  .ep--material .ep__input {
    border: 0;
    background: var(--ep-field);
    outline: none;
  }

  .ep--ios .ep__input {
    height: 2.25rem;
    padding: 0 2rem 0 2.0625rem;
    border-radius: 0.625rem;
    font-size: 1.0625rem;
    letter-spacing: -0.01em;
  }

  .ep--ios .ep__search-icon {
    left: 0.5rem;
    width: 1.125rem;
    height: 1.125rem;
    stroke-width: 2.4;
  }

  .ep--material .ep__input {
    height: 3rem;
    padding: 0 3rem 0 3.25rem;
    border-radius: 999px;
  }

  .ep--material .ep__search-icon {
    left: 1rem;
    width: 1.375rem;
    height: 1.375rem;
    color: var(--app-label);
  }

  .ep__clear {
    position: absolute;
    right: 0.25rem;
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--ep-muted);
    cursor: pointer;
  }

  .ep__clear svg {
    width: 1rem;
    height: 1rem;
  }

  .ep--web .ep__clear:hover,
  .ep--material .ep__clear:hover {
    background: var(--ep-hover);
    color: var(--ep-text);
  }

  .ep--ios .ep__clear {
    right: 0.25rem;
    width: 1.75rem;
    height: 1.75rem;
  }

  .ep--ios .ep__clear svg {
    width: 1.0625rem;
    height: 1.0625rem;
    padding: 0.1875rem;
    border-radius: 999px;
    background: var(--app-label-3);
    color: var(--ep-bg);
    stroke-width: 3.4;
  }

  .ep--material .ep__clear {
    right: 0.5rem;
    width: 2.5rem;
    height: 2.5rem;
    color: var(--app-label);
  }

  .ep--material .ep__clear svg {
    width: 1.375rem;
    height: 1.375rem;
  }

  .ep__tone-toggle {
    flex: none;
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    border: 0;
    border-radius: var(--ep-radius);
    background: transparent;
    cursor: pointer;
  }

  .ep--web .ep__tone-toggle {
    border: 1px solid var(--line);
    border-radius: 0.5rem;
  }

  .ep--ios .ep__tone-toggle {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 999px;
    background: var(--ep-field);
  }

  .ep--material .ep__tone-toggle {
    width: 3rem;
    height: 3rem;
    border-radius: 999px;
    background: var(--ep-field);
  }

  .ep__tone-toggle[aria-expanded="true"] {
    background: var(--ep-hover);
  }

  .ep--web .ep__tone-toggle:hover {
    border-color: var(--accent);
    background: var(--accent-weak);
  }

  .ep--material .ep__tone-toggle:hover {
    background: color-mix(in srgb, var(--app-label) 8%, var(--ep-field));
  }

  .ep__dot {
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 999px;
    background: var(--swatch);
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.14);
  }

  .ep__tones {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.25rem;
    min-height: 2.5rem;
  }

  .ep--material .ep__tones {
    min-height: 3rem;
  }

  .ep__swatch {
    display: grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    cursor: pointer;
  }

  .ep--ios .ep__swatch,
  .ep--material .ep__swatch {
    width: 2.5rem;
    height: 2.5rem;
  }

  .ep__swatch::before {
    content: "";
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 999px;
    background: var(--swatch);
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.14);
  }

  .ep__swatch[aria-checked="true"]::before {
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.14), 0 0 0 2px var(--ep-bg), 0 0 0 4px var(--ep-accent);
  }

  .ep__swatch:focus-visible {
    outline-offset: -1px;
  }

  .ep__tabs {
    flex: none;
    display: flex;
    padding: 0 calc(var(--pad) - 2px);
    border-bottom: 1px solid var(--ep-line);
  }

  .ep__tab {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    display: grid;
    place-items: center;
    height: 2.25rem;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ep-muted);
    cursor: pointer;
    transition: color var(--duration-fast, 150ms) var(--ease-out, ease);
  }

  .ep__tab svg {
    width: 1.125rem;
    height: 1.125rem;
  }

  .ep__tab:focus-visible {
    outline-offset: -2px;
  }

  .ep--web .ep__tab:hover {
    color: var(--text);
  }

  .ep__tab[aria-current="true"] {
    color: var(--ep-accent);
  }

  .ep--web .ep__tab[aria-current="true"]::after,
  .ep--material .ep__tab[aria-current="true"]::after {
    content: "";
    position: absolute;
    bottom: -1px;
    left: 50%;
    height: 2px;
    width: min(1.5rem, 70%);
    translate: -50% 0;
    border-radius: 2px 2px 0 0;
    background: var(--ep-accent);
  }

  .ep--ios .ep__tabs,
  .ep--material .ep__tabs {
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    touch-action: pan-x;
  }

  .ep--ios .ep__tabs::-webkit-scrollbar,
  .ep--material .ep__tabs::-webkit-scrollbar {
    display: none;
  }

  .ep--material .ep__tabs {
    padding: 0 0.25rem;
  }

  .ep--material .ep__tab {
    flex: 1 0 3rem;
    height: 3rem;
    color: var(--app-label-2);
  }

  .ep--material .ep__tab svg {
    width: 1.375rem;
    height: 1.375rem;
  }

  .ep--material .ep__tab::before {
    content: "";
    position: absolute;
    inset: 0.25rem 0;
    border-radius: 999px;
    background: transparent;
    transition: background-color var(--duration-fast, 150ms) var(--ease-out, ease);
  }

  .ep--material .ep__tab[aria-current="true"] {
    color: var(--ep-accent);
  }

  .ep--material .ep__tab[aria-current="true"]::after {
    bottom: 0;
    height: 3px;
    border-radius: 3px 3px 0 0;
  }

  .ep--ios .ep__tabs {
    order: 3;
    padding: 0.25rem 0.375rem calc(0.25rem + env(safe-area-inset-bottom, 0px));
    border-bottom: 0;
    border-top: 0.5px solid var(--ep-line);
  }

  .ep--ios .ep__tab {
    flex: 1 0 2.75rem;
    height: 2.75rem;
    color: var(--app-label-2);
  }

  .ep--ios .ep__tab svg {
    position: relative;
    width: 1.25rem;
    height: 1.25rem;
    stroke-width: 1.9;
  }

  .ep--ios .ep__tab::before {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 2rem;
    height: 2rem;
    translate: -50% -50%;
    border-radius: 999px;
    background: transparent;
  }

  .ep--ios .ep__tab[aria-current="true"] {
    color: var(--app-label);
  }

  .ep--ios .ep__tab[aria-current="true"]::before {
    background: var(--app-fill);
  }

  .ep__scroll {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 var(--pad) 0.5rem;
    scrollbar-width: thin;
    scrollbar-color: var(--ep-line) transparent;
    touch-action: pan-y;
  }

  .ep__section {
    content-visibility: auto;
    contain-intrinsic-block-size: auto calc(var(--rows) * var(--cell) + 2rem);
  }

  .ep__head {
    position: sticky;
    top: 0;
    z-index: 1;
    margin: 0 calc(var(--pad) * -1);
    padding: 0.5rem calc(var(--pad) + 0.375rem) 0.25rem;
    background: var(--ep-bg);
    color: var(--ep-muted);
    font-family: var(--font-sans);
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1.25rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ep--ios .ep__head {
    padding-top: 0.625rem;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--app-label-2);
  }

  .ep--material .ep__head {
    padding: 0.75rem calc(var(--pad) + 0.5rem) 0.25rem;
    font-size: 0.875rem;
    font-weight: 500;
    letter-spacing: 0.006em;
    color: var(--app-label-2);
  }

  .ep__grid {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    grid-auto-rows: var(--cell);
  }

  .ep__placeholder {
    height: calc(var(--rows) * var(--cell));
  }

  .ep__cell {
    display: grid;
    place-items: center;
    min-width: 0;
    height: var(--cell);
    padding: 0;
    border: 0;
    border-radius: var(--ep-radius);
    background: transparent;
    font-family: var(--emoji-font);
    font-size: var(--ep-emoji);
    line-height: 1;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  .ep--material .ep__cell {
    width: var(--cell);
    justify-self: center;
  }

  @media (hover: hover) {
    .ep__cell:hover {
      background: var(--ep-hover);
    }

    .ep--material .ep__tab:hover::before {
      background: var(--ep-hover);
    }
  }

  .ep__cell:active {
    background: var(--ep-press);
  }

  .ep--material .ep__tab:active::before {
    background: var(--ep-press);
  }

  .ep__cell:focus-visible {
    outline: 2px solid var(--ep-accent);
    outline-offset: -2px;
  }

  .ep__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    height: 100%;
    min-height: 8rem;
    padding: 1.5rem 1rem;
    text-align: center;
    color: var(--ep-muted);
    font-size: 0.9375rem;
  }

  .ep__empty svg {
    width: 2rem;
    height: 2rem;
    opacity: 0.7;
  }

  .ep__skeleton-head {
    display: block;
    width: 6rem;
    height: 0.625rem;
    margin: 0.875rem 0.375rem 0.5rem;
    border-radius: 999px;
    background: var(--ep-hover);
  }

  .ep__skeleton-cell {
    display: block;
    width: 60%;
    height: 60%;
    margin: auto;
    border-radius: 999px;
    background: var(--ep-hover);
  }

  .ep--material .ep__skeleton-head,
  .ep--material .ep__skeleton-cell {
    background: var(--ep-field);
  }
</style>
