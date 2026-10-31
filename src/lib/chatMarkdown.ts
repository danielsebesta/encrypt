function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function parseMarkdown(text: string): string {
  let html = esc(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, code) =>
    `<pre class="chat-code-block"><code>${code.trim()}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, '<code class="chat-code-inline">$1</code>');
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, '<em>$1</em>');
  html = html.replace(/(?<!\w)_(.+?)_(?!\w)/g, '<em>$1</em>');
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
  // Spoiler clicks are delegated through a Svelte action, so chat text never injects handlers.
  html = html.replace(/\|\|(.+?)\|\|/g, '<span class="chat-spoiler" data-chat-spoiler role="button" tabindex="0">$1</span>');
  html = html.replace(/(^|\n)&gt; (.+)/g, '$1<blockquote class="chat-quote">$2</blockquote>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

/** One line of plain text for quoting a message: markup removed and spoilers kept hidden. */
export function plainSnippet(text: string, max = 140): string {
  const plain = text
    .replace(/\|\|(.+?)\|\|/gs, '•••')
    .replace(/```\w*\n?/g, '')
    .replace(/(\*\*\*|___|\*\*|__|~~|`)/g, '')
    .replace(/(^|\n)> /g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

export function revealSpoilers(node: HTMLElement) {
  function toggleSpoiler(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    const spoiler = target.closest<HTMLElement>('[data-chat-spoiler]');
    if (!spoiler || !node.contains(spoiler)) return false;
    spoiler.classList.toggle('revealed');
    return true;
  }

  function handleClick(event: MouseEvent) {
    toggleSpoiler(event.target);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (toggleSpoiler(event.target)) event.preventDefault();
  }

  node.addEventListener('click', handleClick);
  node.addEventListener('keydown', handleKeydown);
  return {
    destroy() {
      node.removeEventListener('click', handleClick);
      node.removeEventListener('keydown', handleKeydown);
    },
  };
}
