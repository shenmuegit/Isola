import { useLayoutEffect, useRef, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import '@isola/plugin/styles.css';

export type StackProps = { gap?: CSSProperties['gap']; children: ReactNode };
export type ColumnsProps = { gap?: CSSProperties['gap']; children: ReactNode };
export type PaneProps = { label: string; flexBasis?: CSSProperties['flexBasis']; flexGrow?: number; children: ReactNode };
export type ListDetailProps = { list: ReactNode; detail: ReactNode; hasSelection: boolean; onBack: () => void };

export function Stack({ children, gap }: StackProps): ReactElement {
  return <div className="isola-stack" style={{ gap }}>{children}</div>;
}

export function Columns({ children, gap }: ColumnsProps): ReactElement {
  return <div className="isola-columns" style={{ gap }}>{children}</div>;
}

export function Pane({ children, label, flexBasis, flexGrow = 1 }: PaneProps): ReactElement {
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const resize = () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && root.current?.contains(active)) active.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  return <section ref={root} className="isola-pane" aria-label={label} style={{ flexBasis, flexGrow: Number.isFinite(flexGrow) && flexGrow >= 0 ? flexGrow : undefined }}>{children}</section>;
}

export function ListDetail({ list, detail, hasSelection, onBack }: ListDetailProps): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  const listPane = useRef<HTMLElement>(null);
  const detailPane = useRef<HTMLElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const narrow = getComputedStyle(back.current!).display !== 'none';
      const listElement = listPane.current!;
      const detailElement = detailPane.current!;
      const previousHidden = listElement.inert ? listElement : detailElement.inert ? detailElement : null;
      listElement.inert = narrow && hasSelection;
      detailElement.inert = narrow && !hasSelection;
      const visible = hasSelection ? detailElement : listElement;
      const active = document.activeElement === document.body ? lastFocused.current : document.activeElement;
      if (narrow && (previousHidden === visible || listElement.contains(active) && listElement.inert || detailElement.contains(active) && detailElement.inert)) {
        visible.focus();
        visible.querySelector<HTMLElement>('textarea:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), button:not(:disabled):not(.isola-back), a[href], [tabindex="0"]')?.focus();
      }
      if (active instanceof HTMLElement && visible.contains(active)) active.scrollIntoView({ block: 'nearest' });
    };
    const observer = new ResizeObserver(update);
    observer.observe(root.current!);
    update();
    return () => observer.disconnect();
  }, [hasSelection]);

  return <div ref={root} className="isola-list-detail" data-selected={hasSelection} onFocusCapture={event => { lastFocused.current = event.target as HTMLElement; }}>
    <div className="isola-list-detail-panes">
      <section ref={listPane} className="isola-list" aria-label="列表" tabIndex={-1}>{list}</section>
      <section ref={detailPane} className="isola-detail" aria-label="详情" tabIndex={-1}>
        <button type="button" ref={back} className="isola-back" onClick={onBack}>返回</button>{detail}
      </section>
    </div>
  </div>;
}
