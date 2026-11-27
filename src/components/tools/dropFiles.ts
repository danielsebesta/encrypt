export function dropFiles(node: HTMLElement) {
  const input = () => node.querySelector<HTMLInputElement>('input[type=file]');
  const over = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    node.classList.add('dropzone--dragging');
  };
  const leave = () => node.classList.remove('dropzone--dragging');
  const drop = (e: DragEvent) => {
    leave();
    const files = e.dataTransfer?.files;
    const el = input();
    if (!files?.length || !el) return;
    e.preventDefault();
    const accepted = new DataTransfer();
    for (const file of el.multiple ? Array.from(files) : [files[0]]) accepted.items.add(file);
    el.files = accepted.files;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  node.addEventListener('dragover', over);
  node.addEventListener('dragleave', leave);
  node.addEventListener('drop', drop);
  return {
    destroy() {
      node.removeEventListener('dragover', over);
      node.removeEventListener('dragleave', leave);
      node.removeEventListener('drop', drop);
    },
  };
}
