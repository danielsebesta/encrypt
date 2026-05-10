<script lang="ts">
  import { onMount } from 'svelte';
  import { getTranslations, t } from '../../lib/i18n';

  export let locale = 'en';
  $: dict = getTranslations(locale);

  type Question = {
    text: string;
    choices: [string, string, string, string];
    correctIndex: 0 | 1 | 2 | 3;
    duration: number;
  };

  type Draft = {
    title: string;
    questions: Question[];
    savedAt: number;
  };

  const TEXT_MAX = 200;
  const CHOICE_MAX = 80;
  const TITLE_MAX = 60;
  const MAX_QUESTIONS = 50;
  const DRAFTS_KEY = 'quiz-drafts';
  const DURATIONS = [10, 15, 20, 30, 45, 60, 90];

  let mode: 'menu' | 'edit' | 'join' = 'menu';
  let title = '';
  let questions: Question[] = [];
  let drafts: Draft[] = [];
  let joinCode = '';
  let joinError = '';
  let importError = '';
  let fileInputEl: HTMLInputElement;

  type ActiveGameStub = { roomId: string; title: string; questionCount: number; updatedAt: number };
  const ACTIVE_TTL_MS = 60 * 60 * 1000;
  let activeGames: ActiveGameStub[] = [];

  function loadActiveGames() {
    if (typeof localStorage === 'undefined') return;
    const out: ActiveGameStub[] = [];
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('quiz-active-')) continue;
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (Date.now() - (parsed.updatedAt || 0) > ACTIVE_TTL_MS) {
          stale.push(key);
          continue;
        }
        if (!parsed.roomId || !parsed.title || !Array.isArray(parsed.questions)) continue;
        out.push({
          roomId: parsed.roomId,
          title: parsed.title,
          questionCount: parsed.questions.length,
          updatedAt: parsed.updatedAt || 0,
        });
      } catch {}
    }
    for (const key of stale) {
      try { localStorage.removeItem(key); } catch {}
    }
    activeGames = out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function resumeActiveGame(roomId: string) {
    const localePrefix = locale === 'en' ? '' : `/${locale}`;
    window.location.href = `${localePrefix}/quiz/${roomId}`;
  }

  function dismissActiveGame(roomId: string) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.removeItem(`quiz-active-${roomId}`); } catch {}
    activeGames = activeGames.filter(g => g.roomId !== roomId);
  }

  function blankQuestion(): Question {
    return {
      text: '',
      choices: ['', '', '', ''],
      correctIndex: 0,
      duration: 20,
    };
  }

  function loadDrafts() {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(DRAFTS_KEY);
      drafts = raw ? JSON.parse(raw) : [];
    } catch {
      drafts = [];
    }
  }

  function saveDraft() {
    if (typeof localStorage === 'undefined') return;
    if (!title.trim() || questions.length === 0) return;
    const sanitized = sanitizeQuestions(questions);
    if (!sanitized) return;
    const draft: Draft = {
      title: title.trim().slice(0, TITLE_MAX),
      questions: sanitized,
      savedAt: Date.now(),
    };
    const existing = drafts.findIndex(d => d.title.toLowerCase() === draft.title.toLowerCase());
    if (existing >= 0) drafts[existing] = draft;
    else drafts = [draft, ...drafts].slice(0, 20);
    try {
      localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
    } catch {}
  }

  function deleteDraft(idx: number) {
    drafts = drafts.filter((_, i) => i !== idx);
    try {
      localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
    } catch {}
  }

  function loadDraft(idx: number) {
    const d = drafts[idx];
    if (!d) return;
    title = d.title;
    questions = d.questions.map(q => ({
      ...q,
      choices: [...q.choices] as [string, string, string, string],
    }));
    mode = 'edit';
  }

  function newQuiz() {
    title = '';
    questions = [blankQuestion()];
    mode = 'edit';
  }

  function addQuestion() {
    if (questions.length >= MAX_QUESTIONS) return;
    questions = [...questions, blankQuestion()];
  }

  function removeQuestion(idx: number) {
    if (questions.length <= 1) return;
    questions = questions.filter((_, i) => i !== idx);
  }

  function moveQuestion(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= questions.length) return;
    const next = [...questions];
    [next[idx], next[target]] = [next[target], next[idx]];
    questions = next;
  }

  function sanitizeQuestions(qs: Question[]): Question[] | null {
    const out: Question[] = [];
    for (const q of qs) {
      const text = q.text.trim().slice(0, TEXT_MAX);
      const choices = q.choices.map(c => c.trim().slice(0, CHOICE_MAX)) as [string, string, string, string];
      if (!text || choices.some(c => !c)) return null;
      const correctIndex = (q.correctIndex >= 0 && q.correctIndex <= 3 ? q.correctIndex : 0) as 0 | 1 | 2 | 3;
      const duration = Math.max(5, Math.min(120, q.duration | 0));
      out.push({ text, choices, correctIndex, duration });
    }
    return out;
  }

  let validationError = '';

  function validate(): Question[] | null {
    validationError = '';
    if (!title.trim()) {
      validationError = t(dict, 'quiz.errorTitleRequired');
      return null;
    }
    if (questions.length === 0) {
      validationError = t(dict, 'quiz.errorNoQuestions');
      return null;
    }
    const sanitized = sanitizeQuestions(questions);
    if (!sanitized) {
      validationError = t(dict, 'quiz.errorIncompleteQuestion');
      return null;
    }
    return sanitized;
  }

  function genRoomId(): string {
    const arr = crypto.getRandomValues(new Uint8Array(3));
    const num = ((arr[0] << 16) | (arr[1] << 8) | arr[2]) % 1000000;
    return String(num).padStart(6, '0');
  }

  function genHostToken(): string {
    const arr = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  function startGame() {
    const sanitized = validate();
    if (!sanitized) return;
    saveDraft();
    const roomId = genRoomId();
    const token = genHostToken();
    sessionStorage.setItem(`quiz-host-${roomId}`, JSON.stringify({
      token,
      title: title.trim(),
      questions: sanitized,
    }));
    const localePrefix = locale === 'en' ? '' : `/${locale}`;
    window.location.href = `${localePrefix}/quiz/${roomId}`;
  }

  function exportJson() {
    const sanitized = validate();
    if (!sanitized) return;
    const data = {
      version: 1,
      title: title.trim(),
      questions: sanitized,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.title.replace(/[^a-z0-9-_ ]/gi, '').replace(/\s+/g, '_').slice(0, 40) || 'quiz'}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function handleImport(e: Event) {
    importError = '';
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) {
      importError = t(dict, 'quiz.errorImportTooLarge');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (typeof parsed.title !== 'string' || !Array.isArray(parsed.questions)) {
          importError = t(dict, 'quiz.errorImportInvalid');
          return;
        }
        const imported: Question[] = [];
        for (const q of parsed.questions.slice(0, MAX_QUESTIONS)) {
          if (
            typeof q.text !== 'string' ||
            !Array.isArray(q.choices) || q.choices.length !== 4 ||
            !q.choices.every((c: any) => typeof c === 'string') ||
            ![0, 1, 2, 3].includes(q.correctIndex)
          ) continue;
          imported.push({
            text: String(q.text).slice(0, TEXT_MAX),
            choices: [
              String(q.choices[0]).slice(0, CHOICE_MAX),
              String(q.choices[1]).slice(0, CHOICE_MAX),
              String(q.choices[2]).slice(0, CHOICE_MAX),
              String(q.choices[3]).slice(0, CHOICE_MAX),
            ],
            correctIndex: q.correctIndex,
            duration: typeof q.duration === 'number' ? Math.max(5, Math.min(120, q.duration | 0)) : 20,
          });
        }
        if (imported.length === 0) {
          importError = t(dict, 'quiz.errorImportEmpty');
          return;
        }
        title = String(parsed.title).slice(0, TITLE_MAX);
        questions = imported;
        mode = 'edit';
      } catch {
        importError = t(dict, 'quiz.errorImportInvalid');
      } finally {
        target.value = '';
      }
    };
    reader.readAsText(file);
  }

  function joinGame() {
    joinError = '';
    const code = joinCode.replace(/\D/g, '');
    if (code.length !== 6) {
      joinError = t(dict, 'quiz.errorBadCode');
      return;
    }
    const localePrefix = locale === 'en' ? '' : `/${locale}`;
    window.location.href = `${localePrefix}/quiz/${code}`;
  }

  function fmtTime(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  onMount(() => {
    loadDrafts();
    loadActiveGames();
  });
</script>

{#if mode === 'menu'}
  <div class="space-y-6">
    {#if activeGames.length > 0}
      <div>
        <h2 class="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-3">{t(dict, 'quiz.resumeAvailable')}</h2>
        <div class="space-y-2">
          {#each activeGames as game}
            <div class="qc-resume">
              <div class="flex-1 min-w-0">
                <div class="qc-resume-title">{game.title}</div>
                <div class="qc-resume-meta">{t(dict, 'quiz.resumeRoomCode')}: <code>{game.roomId}</code> · {game.questionCount} {t(dict, 'quiz.questionsShort')}</div>
              </div>
              <button class="qc-resume-go" on:click={() => resumeActiveGame(game.roomId)}>
                {t(dict, 'quiz.resume')} →
              </button>
              <button class="qc-resume-del" on:click={() => dismissActiveGame(game.roomId)} aria-label={t(dict, 'quiz.delete')}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <div class="grid gap-3 sm:grid-cols-3">
      <button class="qc-action qc-action--primary" on:click={newQuiz}>
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>{t(dict, 'quiz.menuNew')}</span>
      </button>
      <button class="qc-action" on:click={() => fileInputEl?.click()}>
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <span>{t(dict, 'quiz.menuImport')}</span>
      </button>
      <button class="qc-action" on:click={() => mode = 'join'}>
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
        <span>{t(dict, 'quiz.menuJoin')}</span>
      </button>
    </div>
    <input type="file" accept="application/json,.json" bind:this={fileInputEl} on:change={handleImport} class="sr-only" />
    {#if importError}
      <p class="text-xs text-red-500 text-center">{importError}</p>
    {/if}

    {#if drafts.length > 0}
      <div>
        <h2 class="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">{t(dict, 'quiz.savedDrafts')}</h2>
        <div class="space-y-2">
          {#each drafts as draft, i}
            <div class="qc-draft">
              <button class="qc-draft-load" on:click={() => loadDraft(i)}>
                <span class="qc-draft-title">{draft.title}</span>
                <span class="qc-draft-meta">{draft.questions.length} {t(dict, 'quiz.questionsShort')} · {fmtTime(draft.savedAt)}</span>
              </button>
              <button class="qc-draft-del" on:click={() => deleteDraft(i)} aria-label={t(dict, 'quiz.delete')}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
              </button>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <p class="qc-privacy">
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      {t(dict, 'quiz.privacyNote')}
    </p>
  </div>

{:else if mode === 'join'}
  <div class="space-y-4 max-w-sm mx-auto">
    <div class="space-y-1.5">
      <label class="label block">{t(dict, 'quiz.joinCode')}</label>
      <input
        class="input w-full text-center text-2xl tracking-[0.3em] font-mono"
        type="text"
        inputmode="numeric"
        pattern="[0-9]*"
        bind:value={joinCode}
        placeholder="123 456"
        maxlength="6"
        autocomplete="off"
        on:keydown={(e) => e.key === 'Enter' && joinGame()}
        on:input={() => { joinCode = joinCode.replace(/\D/g, '').slice(0, 6); }}
        spellcheck="false"
      />
      {#if joinError}
        <p class="text-xs text-red-500">{joinError}</p>
      {/if}
    </div>
    <div class="flex gap-2">
      <button class="btn-outline flex-1" on:click={() => mode = 'menu'}>{t(dict, 'quiz.back')}</button>
      <button class="btn flex-1" on:click={joinGame}>{t(dict, 'quiz.joinAction')}</button>
    </div>
  </div>

{:else}
  <div class="space-y-5">
    <div class="space-y-1.5">
      <label class="label block">{t(dict, 'quiz.titleLabel')}</label>
      <input
        class="input w-full"
        type="text"
        bind:value={title}
        placeholder={t(dict, 'quiz.titlePlaceholder')}
        maxlength={TITLE_MAX}
      />
    </div>

    <div class="space-y-3">
      {#each questions as q, qi (qi)}
        <div class="qc-q">
          <div class="qc-q-header">
            <span class="qc-q-num">{qi + 1}</span>
            <input
              class="input flex-1"
              type="text"
              bind:value={q.text}
              placeholder={t(dict, 'quiz.questionPlaceholder')}
              maxlength={TEXT_MAX}
            />
            <div class="qc-q-actions">
              <button on:click={() => moveQuestion(qi, -1)} disabled={qi === 0} aria-label={t(dict, 'quiz.moveUp')}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
              </button>
              <button on:click={() => moveQuestion(qi, 1)} disabled={qi === questions.length - 1} aria-label={t(dict, 'quiz.moveDown')}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <button on:click={() => removeQuestion(qi)} disabled={questions.length <= 1} aria-label={t(dict, 'quiz.delete')}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          <div class="qc-choices">
            {#each [0, 1, 2, 3] as ci}
              <label class="qc-choice qc-choice--{ci}" class:qc-choice--correct={q.correctIndex === ci}>
                <input
                  type="radio"
                  name={`correct-${qi}`}
                  checked={q.correctIndex === ci}
                  on:change={() => q.correctIndex = ci}
                />
                <input
                  type="text"
                  bind:value={q.choices[ci]}
                  placeholder={t(dict, 'quiz.choicePlaceholder')}
                  maxlength={CHOICE_MAX}
                />
              </label>
            {/each}
          </div>

          <div class="qc-q-footer">
            <label class="qc-duration">
              <span>{t(dict, 'quiz.duration')}</span>
              <select bind:value={q.duration}>
                {#each DURATIONS as d}
                  <option value={d}>{d}s</option>
                {/each}
              </select>
            </label>
          </div>
        </div>
      {/each}
    </div>

    <button class="btn-outline w-full" on:click={addQuestion} disabled={questions.length >= MAX_QUESTIONS}>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-block mr-1.5 align-text-bottom"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      {t(dict, 'quiz.addQuestion')}
    </button>

    {#if validationError}
      <p class="text-xs text-red-500 text-center">{validationError}</p>
    {/if}

    <div class="qc-edit-actions">
      <button class="btn-outline" on:click={() => mode = 'menu'}>{t(dict, 'quiz.back')}</button>
      <button class="btn-outline" on:click={exportJson}>{t(dict, 'quiz.export')}</button>
      <button class="btn flex-1" on:click={startGame}>{t(dict, 'quiz.startGame')} →</button>
    </div>
  </div>
{/if}

<style>
  .qc-action {
    display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
    padding: 1.25rem 1rem; border-radius: 0.75rem;
    border: 1px solid rgba(228, 228, 231, 0.6);
    background: rgba(255, 255, 255, 0.6);
    color: rgb(63, 63, 70); font-size: 13px; font-weight: 600;
    transition: transform 0.15s, border-color 0.15s, background 0.15s;
  }
  :global(.dark) .qc-action {
    background: rgba(24, 24, 27, 0.4);
    border-color: rgba(63, 63, 70, 0.4);
    color: rgb(212, 212, 216);
  }
  .qc-action:hover {
    transform: translateY(-1px);
    border-color: rgba(16, 185, 129, 0.4);
  }
  .qc-action--primary {
    background: rgba(16, 185, 129, 0.08);
    border-color: rgba(16, 185, 129, 0.25);
    color: rgb(5, 150, 105);
  }
  :global(.dark) .qc-action--primary {
    background: rgba(16, 185, 129, 0.12);
    border-color: rgba(16, 185, 129, 0.3);
    color: rgb(52, 211, 153);
  }
  .qc-action--primary:hover {
    background: rgba(16, 185, 129, 0.14);
  }
  .qc-draft {
    display: flex; align-items: center; gap: 0.4rem;
    border-radius: 0.6rem; overflow: hidden;
    border: 1px solid rgba(228, 228, 231, 0.5);
  }
  :global(.dark) .qc-draft {
    border-color: rgba(63, 63, 70, 0.4);
  }
  .qc-draft-load {
    flex: 1; display: flex; align-items: center; justify-content: space-between;
    padding: 0.6rem 0.8rem; text-align: left;
    background: rgba(255, 255, 255, 0.4);
    transition: background 0.15s;
  }
  :global(.dark) .qc-draft-load {
    background: rgba(24, 24, 27, 0.3);
  }
  .qc-draft-load:hover {
    background: rgba(16, 185, 129, 0.06);
  }
  .qc-draft-title {
    font-size: 13px; font-weight: 600; color: rgb(63, 63, 70);
  }
  :global(.dark) .qc-draft-title { color: rgb(212, 212, 216); }
  .qc-draft-meta {
    font-size: 11px; color: rgb(161, 161, 170);
  }
  .qc-resume {
    display: flex; align-items: center; gap: 0.4rem;
    padding: 0.65rem 0.8rem;
    border-radius: 0.6rem;
    background: rgba(16, 185, 129, 0.08);
    border: 1px solid rgba(16, 185, 129, 0.25);
  }
  :global(.dark) .qc-resume {
    background: rgba(16, 185, 129, 0.12);
    border-color: rgba(16, 185, 129, 0.3);
  }
  .qc-resume-title {
    font-size: 13px; font-weight: 700;
    color: rgb(5, 150, 105);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  :global(.dark) .qc-resume-title { color: rgb(52, 211, 153); }
  .qc-resume-meta {
    font-size: 11px; color: rgb(113, 113, 122);
  }
  .qc-resume-meta code {
    font-family: 'fira-code', monospace; font-size: 11px;
    background: rgba(255,255,255,0.6);
    padding: 1px 4px; border-radius: 3px;
  }
  :global(.dark) .qc-resume-meta code {
    background: rgba(0,0,0,0.3);
  }
  .qc-resume-go {
    padding: 0.4rem 0.7rem; border-radius: 0.4rem;
    background: rgb(16, 185, 129); color: white;
    font-size: 12px; font-weight: 700;
  }
  .qc-resume-go:hover { background: rgb(5, 150, 105); }
  .qc-resume-del {
    padding: 0.4rem; color: rgb(161, 161, 170);
    transition: color 0.15s;
  }
  .qc-resume-del:hover { color: rgb(239, 68, 68); }
  .qc-draft-del {
    padding: 0.6rem 0.7rem; color: rgb(161, 161, 170);
    transition: color 0.15s, background 0.15s;
  }
  .qc-draft-del:hover {
    color: rgb(239, 68, 68);
    background: rgba(239, 68, 68, 0.08);
  }
  .qc-privacy {
    display: flex; align-items: center; justify-content: center; gap: 0.4rem;
    font-size: 11px; color: rgb(113, 113, 122);
    text-align: center;
  }
  :global(.dark) .qc-privacy { color: rgb(161, 161, 170); }
  .qc-q {
    border-radius: 0.75rem;
    border: 1px solid rgba(228, 228, 231, 0.5);
    background: rgba(255, 255, 255, 0.5);
    padding: 0.85rem;
    display: flex; flex-direction: column; gap: 0.6rem;
  }
  :global(.dark) .qc-q {
    border-color: rgba(63, 63, 70, 0.4);
    background: rgba(24, 24, 27, 0.35);
  }
  .qc-q-header {
    display: flex; align-items: center; gap: 0.5rem;
  }
  .qc-q-num {
    flex-shrink: 0; width: 24px; height: 24px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 9999px;
    background: rgba(16, 185, 129, 0.1);
    color: rgb(16, 185, 129);
    font-size: 11px; font-weight: 700;
  }
  .qc-q-actions {
    display: flex; gap: 0.15rem;
  }
  .qc-q-actions button {
    padding: 0.35rem; border-radius: 0.4rem;
    color: rgb(161, 161, 170); transition: color 0.15s, background 0.15s;
  }
  .qc-q-actions button:hover:not(:disabled) {
    color: rgb(16, 185, 129);
    background: rgba(16, 185, 129, 0.08);
  }
  .qc-q-actions button:disabled { opacity: 0.3; }
  .qc-choices {
    display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem;
  }
  .qc-choice {
    display: flex; align-items: center; gap: 0.4rem;
    padding: 0.5rem 0.6rem; border-radius: 0.55rem;
    border: 2px solid transparent;
    background: rgba(244, 244, 245, 0.7);
    transition: border-color 0.15s, background 0.15s;
  }
  :global(.dark) .qc-choice {
    background: rgba(39, 39, 42, 0.5);
  }
  .qc-choice input[type="radio"] {
    width: 14px; height: 14px; accent-color: rgb(16, 185, 129);
    flex-shrink: 0;
  }
  .qc-choice input[type="text"] {
    flex: 1; background: transparent; border: none; outline: none;
    font-size: 13px; color: rgb(63, 63, 70); min-width: 0;
  }
  :global(.dark) .qc-choice input[type="text"] { color: rgb(212, 212, 216); }
  .qc-choice input[type="text"]::placeholder { color: rgb(161, 161, 170); }
  .qc-choice--0 { border-left: 4px solid rgb(16, 185, 129); }
  .qc-choice--1 { border-left: 4px solid rgb(217, 70, 239); }
  .qc-choice--2 { border-left: 4px solid rgb(34, 211, 238); }
  .qc-choice--3 { border-left: 4px solid rgb(251, 191, 36); }
  .qc-choice--correct {
    background: rgba(16, 185, 129, 0.08);
    border-color: rgba(16, 185, 129, 0.4) !important;
  }
  :global(.dark) .qc-choice--correct {
    background: rgba(16, 185, 129, 0.12);
  }
  .qc-q-footer {
    display: flex; justify-content: flex-end;
  }
  .qc-duration {
    display: flex; align-items: center; gap: 0.5rem;
    font-size: 11px; color: rgb(113, 113, 122);
  }
  .qc-duration select {
    background: rgba(244, 244, 245, 0.6);
    padding: 0.2rem 0.4rem; border-radius: 0.35rem;
    font-size: 12px; color: rgb(63, 63, 70);
    border: 1px solid rgba(228, 228, 231, 0.5);
  }
  :global(.dark) .qc-duration select {
    background: rgba(39, 39, 42, 0.5);
    color: rgb(212, 212, 216);
    border-color: rgba(63, 63, 70, 0.4);
  }
  .qc-edit-actions {
    display: flex; gap: 0.5rem; flex-wrap: wrap;
  }
</style>
