export function bindViewport(element: HTMLElement): () => void {
  const viewport = window.visualViewport;
  const update = () => {
    element.style.height = `${viewport?.height ?? window.innerHeight}px`;
    element.style.width = `${viewport?.width ?? window.innerWidth}px`;
    element.style.top = `${viewport?.offsetTop ?? 0}px`;
    element.style.left = `${viewport?.offsetLeft ?? 0}px`;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.matches('input, textarea, select')) active.scrollIntoView({ block: 'nearest' });
  };
  update();
  window.addEventListener('resize', update);
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  return () => {
    window.removeEventListener('resize', update);
    viewport?.removeEventListener('resize', update);
    viewport?.removeEventListener('scroll', update);
  };
}
