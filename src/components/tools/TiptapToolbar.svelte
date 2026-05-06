<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import type * as Y from 'yjs';
  import { t } from '../../lib/i18n';

  export let editor: Editor | null = null;
  export let undoMgr: Y.UndoManager | null = null;
  export let dict: Record<string, string> = {};
  // bumped externally on every editor selection/transaction so the
  // active-state of buttons stays in sync.
  export let selectionVersion = 0;

  const FONT_FAMILIES = [
    { label: 'Default', value: '' },
    { label: 'Arial', value: 'Arial, sans-serif' },
    { label: 'Helvetica', value: 'Helvetica, sans-serif' },
    { label: 'Inter', value: 'Inter, sans-serif' },
    { label: 'Roboto', value: 'Roboto, sans-serif' },
    { label: 'Times New Roman', value: '"Times New Roman", serif' },
    { label: 'Georgia', value: 'Georgia, serif' },
    { label: 'Courier New', value: '"Courier New", monospace' },
    { label: 'Fira Code', value: '"Fira Code", monospace' },
    { label: 'Verdana', value: 'Verdana, sans-serif' },
  ];
  const FONT_SIZES = ['10px','11px','12px','13px','14px','16px','18px','20px','24px','28px','32px','36px','48px'];
  // No literal black at the start of the palette — that becomes invisible in
  // dark mode. The first swatch is an "Auto" entry that simply unsets the
  // color attribute, so the editor inherits the theme-aware default color.
  const TEXT_COLORS = ['#404040','#737373','#dc2626','#ea580c','#ca8a04','#16a34a','#0891b2','#2563eb','#7c3aed','#db2777','#a3a3a3'];
  const HIGHLIGHT_COLORS = ['#fef08a','#fed7aa','#fecaca','#bbf7d0','#bae6fd','#ddd6fe','#fbcfe8','#e7e5e4'];

  function isActive(name: string, attrs?: any): boolean {
    selectionVersion;
    return !!(editor && editor.isActive(name, attrs));
  }
  function getAttr(name: string, attr: string): string {
    selectionVersion;
    return editor?.getAttributes(name)?.[attr] ?? '';
  }
  function activeHeading(): string {
    if (isActive('heading', { level: 1 })) return '1';
    if (isActive('heading', { level: 2 })) return '2';
    if (isActive('heading', { level: 3 })) return '3';
    return '0';
  }
  function activeAlign(value: string): boolean {
    if (!editor) return false;
    if (value === 'left') {
      return editor.isActive({ textAlign: 'left' }) ||
        (!editor.isActive({ textAlign: 'center' }) && !editor.isActive({ textAlign: 'right' }) && !editor.isActive({ textAlign: 'justify' }));
    }
    return editor.isActive({ textAlign: value });
  }

  function tbUndo() { undoMgr?.undo(); }
  function tbRedo() { undoMgr?.redo(); }
  function tbToggleBold() { editor?.chain().focus().toggleBold().run(); }
  function tbToggleItalic() { editor?.chain().focus().toggleItalic().run(); }
  function tbToggleUnderline() { editor?.chain().focus().toggleUnderline().run(); }
  function tbToggleStrike() { editor?.chain().focus().toggleStrike().run(); }
  function tbToggleCode() { editor?.chain().focus().toggleCode().run(); }
  function tbToggleBulletList() { editor?.chain().focus().toggleBulletList().run(); }
  function tbToggleOrderedList() { editor?.chain().focus().toggleOrderedList().run(); }
  function tbToggleQuote() { editor?.chain().focus().toggleBlockquote().run(); }
  function tbToggleCodeBlock() { editor?.chain().focus().toggleCodeBlock().run(); }
  function tbHr() { editor?.chain().focus().setHorizontalRule().run(); }
  function tbAlign(value: 'left'|'center'|'right'|'justify') {
    editor?.chain().focus().setTextAlign(value).run();
  }
  function tbHeading(level: '0'|'1'|'2'|'3') {
    if (!editor) return;
    if (level === '0') editor.chain().focus().setParagraph().run();
    else editor.chain().focus().toggleHeading({ level: parseInt(level, 10) as 1 | 2 | 3 }).run();
  }
  function tbFontFamily(value: string) {
    if (!editor) return;
    if (!value) (editor.chain() as any).focus().unsetFontFamily().run();
    else (editor.chain() as any).focus().setFontFamily(value).run();
  }
  function tbFontSize(value: string) {
    if (!editor) return;
    if (!value) (editor.chain() as any).focus().unsetFontSize().run();
    else (editor.chain() as any).focus().setFontSize(value).run();
  }
  function tbColor(value: string) {
    if (!value) (editor?.chain() as any).focus().unsetColor().run();
    else (editor?.chain() as any).focus().setColor(value).run();
  }
  function tbHighlight(value: string) {
    if (!editor) return;
    if (!value) editor.chain().focus().unsetHighlight().run();
    else editor.chain().focus().toggleHighlight({ color: value }).run();
  }
  function tbLink() {
    const url = window.prompt(t(dict, 'memo.linkPrompt'));
    if (url === null) return;
    if (url === '') {
      editor?.chain().focus().unsetLink().run();
      return;
    }
    editor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }
  function tbClearFormatting() {
    editor?.chain().focus().clearNodes().unsetAllMarks().run();
  }
</script>

<div class="memo-toolbar">
  <button class="mt-btn" on:click={tbUndo} title={t(dict, 'memo.undo')} aria-label={t(dict, 'memo.undo')}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
  </button>
  <button class="mt-btn" on:click={tbRedo} title={t(dict, 'memo.redo')} aria-label={t(dict, 'memo.redo')}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>
  </button>

  <span class="mt-divider"></span>

  <select class="mt-select" value={activeHeading()} on:change={(e) => tbHeading((e.currentTarget as HTMLSelectElement).value as any)} title={t(dict, 'memo.heading')}>
    <option value="0">{t(dict, 'memo.normal')}</option>
    <option value="1">H1</option>
    <option value="2">H2</option>
    <option value="3">H3</option>
  </select>

  <select class="mt-select mt-select--wide" value={getAttr('textStyle','fontFamily')} on:change={(e) => tbFontFamily((e.currentTarget as HTMLSelectElement).value)} title={t(dict, 'memo.font')}>
    {#each FONT_FAMILIES as f}
      <option value={f.value} style={f.value ? `font-family: ${f.value}` : ''}>{f.label}</option>
    {/each}
  </select>

  <select class="mt-select" value={getAttr('textStyle','fontSize')} on:change={(e) => tbFontSize((e.currentTarget as HTMLSelectElement).value)} title={t(dict, 'memo.fontSize')}>
    <option value="">--</option>
    {#each FONT_SIZES as s}
      <option value={s}>{s.replace('px','')}</option>
    {/each}
  </select>

  <span class="mt-divider"></span>

  <button class="mt-btn" class:mt-btn--active={isActive('bold')} on:click={tbToggleBold} title={t(dict, 'memo.bold')} aria-label={t(dict, 'memo.bold')}><b>B</b></button>
  <button class="mt-btn" class:mt-btn--active={isActive('italic')} on:click={tbToggleItalic} title={t(dict, 'memo.italic')} aria-label={t(dict, 'memo.italic')}><i>I</i></button>
  <button class="mt-btn" class:mt-btn--active={isActive('underline')} on:click={tbToggleUnderline} title={t(dict, 'memo.underline')} aria-label={t(dict, 'memo.underline')}><u>U</u></button>
  <button class="mt-btn" class:mt-btn--active={isActive('strike')} on:click={tbToggleStrike} title={t(dict, 'memo.strike')} aria-label={t(dict, 'memo.strike')}><s>S</s></button>

  <span class="mt-divider"></span>

  <div class="mt-popover">
    <button class="mt-btn" title={t(dict, 'memo.textColor')} aria-label={t(dict, 'memo.textColor')}>
      <span class="mt-color-icon">A</span>
      <span class="mt-color-bar" style={getAttr('textStyle','color') ? `background: ${getAttr('textStyle','color')}` : ''}></span>
    </button>
    <div class="mt-pop">
      <div class="mt-pop-grid">
        <button class="mt-color-cell mt-color-cell--auto" on:click={() => tbColor('')} aria-label={t(dict, 'memo.autoColor')} title={t(dict, 'memo.autoColor')}></button>
        {#each TEXT_COLORS as c}
          <button class="mt-color-cell" style="background: {c}" on:click={() => tbColor(c)} aria-label={c}></button>
        {/each}
      </div>
      <button class="mt-pop-clear" on:click={() => tbColor('')}>{t(dict, 'memo.removeColor')}</button>
    </div>
  </div>

  <div class="mt-popover">
    <button class="mt-btn" title={t(dict, 'memo.highlight')} aria-label={t(dict, 'memo.highlight')}>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l-6 6v3h9l3-3"/><path d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>
      <span class="mt-color-bar" style={getAttr('highlight','color') ? `background: ${getAttr('highlight','color')}` : ''}></span>
    </button>
    <div class="mt-pop">
      <div class="mt-pop-grid">
        <button class="mt-color-cell mt-color-cell--auto" on:click={() => tbHighlight('')} aria-label={t(dict, 'memo.autoColor')} title={t(dict, 'memo.autoColor')}></button>
        {#each HIGHLIGHT_COLORS as c}
          <button class="mt-color-cell" style="background: {c}" on:click={() => tbHighlight(c)} aria-label={c}></button>
        {/each}
      </div>
      <button class="mt-pop-clear" on:click={() => tbHighlight('')}>{t(dict, 'memo.removeHighlight')}</button>
    </div>
  </div>

  <span class="mt-divider"></span>

  <button class="mt-btn" class:mt-btn--active={activeAlign('left')} on:click={() => tbAlign('left')} title={t(dict, 'memo.alignLeft')} aria-label={t(dict, 'memo.alignLeft')}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>
  </button>
  <button class="mt-btn" class:mt-btn--active={activeAlign('center')} on:click={() => tbAlign('center')} title={t(dict, 'memo.alignCenter')} aria-label={t(dict, 'memo.alignCenter')}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="10" x2="6" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="18" y1="18" x2="6" y2="18"/></svg>
  </button>
  <button class="mt-btn" class:mt-btn--active={activeAlign('right')} on:click={() => tbAlign('right')} title={t(dict, 'memo.alignRight')} aria-label={t(dict, 'memo.alignRight')}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="10" x2="7" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="7" y2="18"/></svg>
  </button>
  <button class="mt-btn" class:mt-btn--active={activeAlign('justify')} on:click={() => tbAlign('justify')} title={t(dict, 'memo.alignJustify')} aria-label={t(dict, 'memo.alignJustify')}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="3" y2="18"/></svg>
  </button>

  <span class="mt-divider"></span>

  <button class="mt-btn" class:mt-btn--active={isActive('bulletList')} on:click={tbToggleBulletList} title={t(dict, 'memo.bulletList')} aria-label={t(dict, 'memo.bulletList')}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>
  </button>
  <button class="mt-btn" class:mt-btn--active={isActive('orderedList')} on:click={tbToggleOrderedList} title={t(dict, 'memo.orderedList')} aria-label={t(dict, 'memo.orderedList')}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>
  </button>
  <button class="mt-btn" class:mt-btn--active={isActive('blockquote')} on:click={tbToggleQuote} title={t(dict, 'memo.quote')} aria-label={t(dict, 'memo.quote')}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1-1-2-2-2H4c-1 0-2 1-2 2v6c0 1 1 2 2 2h3"/><path d="M14 21c3 0 7-1 7-8V5c0-1-1-2-2-2h-4c-1 0-2 1-2 2v6c0 1 1 2 2 2h3"/></svg>
  </button>

  <span class="mt-divider"></span>

  <button class="mt-btn" class:mt-btn--active={isActive('code')} on:click={tbToggleCode} title={t(dict, 'memo.inlineCode')} aria-label={t(dict, 'memo.inlineCode')}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
  </button>
  <button class="mt-btn" class:mt-btn--active={isActive('codeBlock')} on:click={tbToggleCodeBlock} title={t(dict, 'memo.codeBlock')} aria-label={t(dict, 'memo.codeBlock')}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="14 4 4 14 14 14 4 24"/><rect x="2" y="2" width="20" height="20" rx="2"/></svg>
  </button>
  <button class="mt-btn" on:click={tbHr} title={t(dict, 'memo.hr')} aria-label={t(dict, 'memo.hr')}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
  </button>
  <button class="mt-btn" class:mt-btn--active={isActive('link')} on:click={tbLink} title={t(dict, 'memo.link')} aria-label={t(dict, 'memo.link')}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
  </button>

  <span class="mt-divider"></span>

  <button class="mt-btn" on:click={tbClearFormatting} title={t(dict, 'memo.clearFormat')} aria-label={t(dict, 'memo.clearFormat')}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M5 20h6"/><path d="M13 4 8 20"/><path d="m15 15 5 5"/><path d="m20 15-5 5"/></svg>
  </button>
</div>

<style>
  .memo-toolbar {
    display: flex; align-items: center; gap: 0.25rem;
    padding: 0.4rem 0.75rem;
    border-bottom: 1px solid rgba(228, 228, 231, 0.5);
    background: rgba(244, 244, 245, 0.5);
    flex-wrap: wrap;
  }
  :global(.dark) .memo-toolbar {
    border-bottom-color: rgba(39, 39, 42, 0.4);
    background: rgba(24, 24, 27, 0.4);
  }
  .mt-btn {
    min-width: 28px; height: 28px; padding: 0 6px;
    border-radius: 0.4rem;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 600;
    color: rgb(82, 82, 91);
    transition: background 0.12s, color 0.12s;
    position: relative;
  }
  :global(.dark) .mt-btn { color: rgb(212, 212, 216); }
  .mt-btn:hover { background: rgba(16, 185, 129, 0.1); color: rgb(16, 185, 129); }
  .mt-btn--active { background: rgba(16, 185, 129, 0.16); color: rgb(16, 185, 129); }
  .mt-divider {
    width: 1px; height: 18px;
    background: rgba(228, 228, 231, 0.7);
    margin: 0 0.2rem;
  }
  :global(.dark) .mt-divider { background: rgba(63, 63, 70, 0.5); }
  .mt-select {
    height: 28px;
    padding: 0 0.4rem;
    border-radius: 0.4rem;
    background: white;
    color: rgb(63, 63, 70);
    border: 1px solid rgba(228, 228, 231, 0.7);
    font-size: 12px;
    cursor: pointer;
    max-width: 130px;
  }
  .mt-select--wide { max-width: 160px; }
  :global(.dark) .mt-select {
    background: rgb(39, 39, 42);
    color: rgb(212, 212, 216);
    border-color: rgba(63, 63, 70, 0.6);
  }
  .mt-color-icon { font-weight: 800; line-height: 1; font-size: 13px; }
  .mt-color-bar {
    display: block; width: 16px; height: 3px; border-radius: 1px; margin-left: 3px;
    /* When no inline background is set (= no explicit color), use currentColor
       which naturally tracks the toolbar's theme-aware text color. */
    background: currentColor;
  }
  .mt-color-cell--auto {
    background: linear-gradient(135deg, #0a0a0a 0%, #0a0a0a 49%, #fafafa 51%, #fafafa 100%) !important;
    position: relative;
  }
  .mt-color-cell--auto::after {
    content: 'A';
    position: absolute;
    inset: 0;
    display: flex; align-items: center; justify-content: center;
    color: rgb(16, 185, 129);
    font-weight: 800; font-size: 10px;
    text-shadow: 0 0 2px rgba(255,255,255,0.7);
  }

  .mt-popover { position: relative; }
  .mt-popover .mt-pop {
    position: absolute;
    top: calc(100% + 4px); left: 0;
    background: white;
    border: 1px solid rgba(228, 228, 231, 0.7);
    border-radius: 0.5rem;
    padding: 0.5rem;
    box-shadow: 0 6px 20px rgba(0,0,0,0.08);
    opacity: 0; transform: translateY(-4px);
    pointer-events: none;
    transition: opacity 0.15s, transform 0.15s;
    z-index: 30;
    min-width: 180px;
  }
  :global(.dark) .mt-popover .mt-pop {
    background: rgb(39, 39, 42);
    border-color: rgba(63, 63, 70, 0.6);
  }
  .mt-popover:hover .mt-pop,
  .mt-popover:focus-within .mt-pop {
    opacity: 1; transform: translateY(0);
    pointer-events: auto;
  }
  .mt-pop-grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 4px;
  }
  .mt-color-cell {
    width: 18px; height: 18px;
    border-radius: 4px;
    border: 1px solid rgba(0,0,0,0.1);
    transition: transform 0.1s;
  }
  .mt-color-cell:hover { transform: scale(1.15); }
  .mt-pop-clear {
    margin-top: 6px;
    width: 100%;
    padding: 4px;
    font-size: 11px; font-weight: 600;
    color: rgb(113, 113, 122);
    border-top: 1px solid rgba(228, 228, 231, 0.6);
    padding-top: 6px;
  }
  :global(.dark) .mt-pop-clear { border-top-color: rgba(63, 63, 70, 0.5); color: rgb(161, 161, 170); }
  .mt-pop-clear:hover { color: rgb(16, 185, 129); }
</style>
