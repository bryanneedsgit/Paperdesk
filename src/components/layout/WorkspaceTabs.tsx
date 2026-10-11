import { FilePlus2, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';

export type WorkspaceTabItem = {
  color: string;
  documentCount: number;
  fontFamily: string;
  id: string;
  isEdited: boolean;
  name: string;
  pageCount: number;
};

type WorkspaceTabsProps = {
  activeWorkspaceId: string | null;
  isBusy: boolean;
  onChangeWorkspaceColor: (workspaceId: string, color: string) => void;
  onChangeWorkspaceFont: (workspaceId: string, fontFamily: string) => void;
  onCloseWorkspace: (workspaceId: string) => void;
  onOpenPdf: () => void;
  onMoveTabs: (ids: string[], newWindow?: boolean, position?: { x: number; y: number }) => void;
  onRenameWorkspace: (workspaceId: string, name: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  tabs: WorkspaceTabItem[];
};

const tabColorOptions = [
  '#2f5f73',
  '#2563eb',
  '#4f46e5',
  '#7c3aed',
  '#9333ea',
  '#be123c',
  '#dc2626',
  '#ea580c',
  '#b45309',
  '#ca8a04',
  '#65a30d',
  '#047857',
  '#059669',
  '#0891b2',
  '#0f766e',
  '#475569',
  '#111827',
  '#6b7280',
];

const tabFontOptions = [
  { label: 'Montserrat', value: 'Montserrat, var(--font-ui)' },
  { label: 'System Sans', value: 'var(--font-ui)' },
  { label: 'Segoe UI', value: "'Segoe UI', var(--font-ui)" },
  { label: 'Arial', value: 'Arial, var(--font-ui)' },
  { label: 'Verdana', value: 'Verdana, var(--font-ui)' },
  { label: 'Tahoma', value: 'Tahoma, var(--font-ui)' },
  { label: 'Trebuchet', value: "'Trebuchet MS', var(--font-ui)" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier', value: "'Courier New', monospace" },
];

type WorkspaceTabContextMenu = {
  draftName: string;
  tabId: string;
  x: number;
  y: number;
};

function getTabMeta(tab: WorkspaceTabItem): string {
  const pageLabel = tab.pageCount === 1 ? 'page' : 'pages';
  const documentLabel = tab.documentCount === 1 ? 'PDF' : 'PDFs';

  return `${tab.pageCount} ${pageLabel} / ${tab.documentCount} ${documentLabel}`;
}

export function WorkspaceTabs({
  activeWorkspaceId,
  isBusy,
  onChangeWorkspaceColor,
  onChangeWorkspaceFont,
  onCloseWorkspace,
  onOpenPdf,
  onMoveTabs,
  onRenameWorkspace,
  onSelectWorkspace,
  tabs,
}: WorkspaceTabsProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number; count: number } | null>(
    null,
  );
  const anchor = useRef<string | null>(null);
  const drag = useRef<{ x: number; y: number; ids: string[]; started: boolean } | null>(null);
  const suppressClick = useRef(false);
  const selection = selectedIds.filter((id) => tabs.some((tab) => tab.id === id));
  const selected = selection.length ? selection : activeWorkspaceId ? [activeWorkspaceId] : [];

  const selectTab = (id: string, event: MouseEvent<HTMLButtonElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const rangeAnchor = anchor.current ?? activeWorkspaceId;
    if (event.shiftKey && rangeAnchor) {
      const first = tabs.findIndex((tab) => tab.id === rangeAnchor);
      const last = tabs.findIndex((tab) => tab.id === id);
      setSelectedIds(
        tabs
          .slice(Math.max(0, Math.min(first, last)), Math.max(first, last) + 1)
          .map((tab) => tab.id),
      );
    } else if (event.metaKey || event.ctrlKey) {
      setSelectedIds(
        selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id],
      );
      anchor.current = id;
    } else {
      setSelectedIds([id]);
      anchor.current = id;
    }
    onSelectWorkspace(id);
  };

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (drag.current?.started) suppressClick.current = true;
        drag.current = null;
        setDragPreview(null);
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);

  const [contextMenu, setContextMenu] = useState<WorkspaceTabContextMenu | null>(null);

  const commitContextMenuName = useCallback(
    (menu: WorkspaceTabContextMenu | null) => {
      if (!menu) {
        return;
      }

      onRenameWorkspace(menu.tabId, menu.draftName);
    },
    [onRenameWorkspace],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu((currentMenu) => {
      commitContextMenuName(currentMenu);
      return null;
    });
  }, [commitContextMenuName]);

  const openContextMenu = (tab: WorkspaceTabItem, event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setContextMenu({
      draftName: tab.name,
      tabId: tab.id,
      x: Math.min(event.clientX, window.innerWidth - 246),
      y: Math.min(event.clientY, window.innerHeight - 178),
    });
  };

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }

    const handleWindowClick = () => closeContextMenu();
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu();
      }
    };

    window.addEventListener('click', handleWindowClick);
    window.addEventListener('keydown', handleWindowKeyDown);

    return () => {
      window.removeEventListener('click', handleWindowClick);
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [closeContextMenu, contextMenu]);

  const contextMenuTab = contextMenu ? tabs.find((tab) => tab.id === contextMenu.tabId) : undefined;

  return (
    <nav className="workspace-tabs" aria-label="Open workspaces">
      <div className="workspace-tab-list" role="tablist" aria-label="Workspace tabs">
        {tabs.length ? (
          tabs.map((tab) => {
            const isActive = tab.id === activeWorkspaceId;

            return (
              <div
                className="workspace-tab-item"
                data-active={isActive ? 'true' : undefined}
                data-selected={selected.includes(tab.id) ? 'true' : undefined}
                key={tab.id}
                onContextMenu={(event) => openContextMenu(tab, event)}
                style={
                  {
                    '--workspace-tab-color': tab.color,
                    '--workspace-tab-font': tab.fontFamily,
                  } as CSSProperties
                }
              >
                <button
                  aria-selected={isActive}
                  className="workspace-tab-button"
                  disabled={isBusy}
                  onClick={(event) => selectTab(tab.id, event)}
                  onPointerDown={(event) => {
                    if (isBusy || event.button !== 0) return;
                    suppressClick.current = false;
                    drag.current = {
                      x: event.clientX,
                      y: event.clientY,
                      ids: selected.includes(tab.id) ? selected : [tab.id],
                      started: false,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    const current = drag.current;
                    if (!current) return;
                    if (
                      !current.started &&
                      Math.hypot(event.clientX - current.x, event.clientY - current.y) < 8
                    )
                      return;
                    current.started = true;
                    setSelectedIds(current.ids);
                    setDragPreview({
                      x: event.clientX,
                      y: event.clientY,
                      count: current.ids.length,
                    });
                  }}
                  onPointerUp={(event) => {
                    const current = drag.current;
                    drag.current = null;
                    setDragPreview(null);
                    if (!current?.started) return;
                    suppressClick.current = true;
                    if (
                      event.clientX < 0 ||
                      event.clientY < 0 ||
                      event.clientX >= window.innerWidth ||
                      event.clientY >= window.innerHeight
                    ) {
                      onMoveTabs(current.ids, false, { x: event.clientX, y: event.clientY });
                    }
                  }}
                  onLostPointerCapture={() => {
                    drag.current = null;
                    setDragPreview(null);
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                    setDragPreview(null);
                  }}
                  role="tab"
                  title={`${tab.name} - ${getTabMeta(tab)}. Drag outside this window to move. Ctrl/Cmd-click or Shift-click to select multiple tabs.`}
                  type="button"
                >
                  <span className="workspace-tab-title">
                    {tab.name}
                    {tab.isEdited ? (
                      <span className="workspace-tab-edited" aria-label="edited" />
                    ) : null}
                  </span>
                  <span className="workspace-tab-meta">{getTabMeta(tab)}</span>
                </button>
                <button
                  aria-label={`Close ${tab.name}`}
                  className="workspace-tab-close"
                  onClick={() => onCloseWorkspace(tab.id)}
                  title={`Close ${tab.name}`}
                  type="button"
                >
                  <X size={12} strokeWidth={2.1} />
                </button>
              </div>
            );
          })
        ) : (
          <span className="workspace-tabs-empty">No workspace open</span>
        )}
      </div>
      {dragPreview ? (
        <div
          className="workspace-tab-drag-preview"
          role="status"
          style={{ left: dragPreview.x + 12, top: dragPreview.y + 12 }}
        >
          {dragPreview.count} {dragPreview.count === 1 ? 'tab' : 'tabs'} · Drag outside this window
          to move
        </div>
      ) : null}
      {contextMenu && contextMenuTab ? (
        <section
          aria-label={`Edit ${contextMenuTab.name} tab`}
          className="workspace-tab-menu"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          role="dialog"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            className="workspace-tab-move"
            disabled={isBusy}
            onClick={() => {
              const ids = selected.includes(contextMenuTab.id) ? selected : [contextMenuTab.id];
              closeContextMenu();
              onMoveTabs(ids, true);
            }}
          >
            Move{' '}
            {selected.includes(contextMenuTab.id) && selected.length > 1
              ? `${selected.length} tabs`
              : 'tab'}{' '}
            to new window
          </button>
          <label>
            <span>Name</span>
            <input
              autoFocus
              onBlur={() => commitContextMenuName(contextMenu)}
              onChange={(event) =>
                setContextMenu((currentMenu) =>
                  currentMenu ? { ...currentMenu, draftName: event.target.value } : currentMenu,
                )
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  closeContextMenu();
                }
              }}
              value={contextMenu.draftName}
            />
          </label>
          <div className="workspace-tab-color-list" aria-label="Tab colour">
            <label className="workspace-tab-custom-color">
              <span>Custom colour</span>
              <input
                aria-label="Custom tab colour"
                onChange={(event) => onChangeWorkspaceColor(contextMenuTab.id, event.target.value)}
                type="color"
                value={contextMenuTab.color}
              />
            </label>
            {tabColorOptions.map((color) => (
              <button
                aria-label={`Set tab colour ${color}`}
                aria-pressed={contextMenuTab.color === color}
                className="workspace-tab-color-button"
                key={color}
                onClick={() => onChangeWorkspaceColor(contextMenuTab.id, color)}
                style={{ '--workspace-tab-color-option': color } as CSSProperties}
                type="button"
              />
            ))}
          </div>
          <label>
            <span>Font</span>
            <select
              onChange={(event) => onChangeWorkspaceFont(contextMenuTab.id, event.target.value)}
              value={contextMenuTab.fontFamily}
            >
              {tabFontOptions.map((font) => (
                <option key={font.value} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
          </label>
        </section>
      ) : null}
      <button
        className="workspace-tab-new"
        disabled={isBusy}
        onClick={onOpenPdf}
        title="Open PDF or PaperDesk document"
        type="button"
      >
        <FilePlus2 size={15} />
        <span>Open document</span>
      </button>
    </nav>
  );
}
