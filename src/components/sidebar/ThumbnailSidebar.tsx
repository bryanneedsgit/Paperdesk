import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  RotateCw,
  Trash2,
} from 'lucide-react';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { renderPdfThumbnailToDataUrl } from '../../lib/pdf/pdfRenderer';
import { isGeneratedPageItem, isSourcePageItem } from '../../lib/pdf/pdfWorkspace';
import type {
  PdfDocumentSource,
  PdfPageId,
  PdfPageItem,
  PdfRotationDirection,
  PdfWorkspace,
} from '../../lib/pdf/types';

type DropPosition = 'before' | 'after';

type ThumbnailContextMenu = {
  pageId: PdfPageId;
  x: number;
  y: number;
};

type ThumbnailSidebarProps = {
  onActivatePage: (pageId: PdfPageId) => void;
  onClearSelection: () => void;
  onDeletePages: (pageIds: PdfPageId[]) => void;
  onMovePage: (pageId: PdfPageId, direction: -1 | 1) => void;
  onReorderPages: (activePageId: PdfPageId, overPageId: PdfPageId) => void;
  onRotatePages: (pageIds: PdfPageId[], direction: PdfRotationDirection) => void;
  onSelectAllPages: () => void;
  onSelectPage: (pageId: PdfPageId) => void;
  onSetSelectedPages: (pageIds: PdfPageId[]) => void;
  onThumbnailRendered: (pageId: PdfPageId, thumbnailDataUrl: string) => void;
  onTogglePageSelection: (pageId: PdfPageId, selected: boolean) => void;
  onToggleCollapsed: () => void;
  selectedPageIds: PdfPageId[];
  workspace: PdfWorkspace | null;
};

type PageThumbnailProps = {
  canMoveDown: boolean;
  canMoveUp: boolean;
  dropPosition?: DropPosition;
  isActive: boolean;
  isDraggingGroupMember: boolean;
  isDropTarget: boolean;
  isSelected: boolean;
  onActivatePage: (pageId: PdfPageId) => void;
  onDeletePages: (pageIds: PdfPageId[]) => void;
  onMovePage: (pageId: PdfPageId, direction: -1 | 1) => void;
  onOpenContextMenu: (pageId: PdfPageId, event: MouseEvent<HTMLDivElement>) => void;
  onRotatePages: (pageIds: PdfPageId[], direction: PdfRotationDirection) => void;
  onSelectPage: (pageId: PdfPageId) => void;
  onSetSelectedPages: (pageIds: PdfPageId[]) => void;
  onThumbnailRendered: (pageId: PdfPageId, thumbnailDataUrl: string) => void;
  onTogglePageSelection: (pageId: PdfPageId, selected: boolean) => void;
  page: PdfPageItem;
  pageIndex: number;
  pages: PdfPageItem[];
  pageNumber: number;
  selectedPageIds: PdfPageId[];
  showSourceLabel: boolean;
  sourceDocument?: PdfDocumentSource;
};

function ThumbnailActionButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="thumbnail-action-button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function PageThumbnail({
  canMoveDown,
  canMoveUp,
  dropPosition,
  isActive,
  isDraggingGroupMember,
  isDropTarget,
  isSelected,
  onActivatePage,
  onDeletePages,
  onMovePage,
  onOpenContextMenu,
  onRotatePages,
  onSelectPage,
  onSetSelectedPages,
  onThumbnailRendered,
  onTogglePageSelection,
  page,
  pageIndex,
  pages,
  pageNumber,
  selectedPageIds,
  showSourceLabel,
  sourceDocument,
}: PageThumbnailProps) {
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState(page.thumbnailDataUrl ?? null);
  const [renderFailed, setRenderFailed] = useState(false);
  const [isThumbnailVisible, setIsThumbnailVisible] = useState(Boolean(page.thumbnailDataUrl));
  const cardRef = useRef<HTMLDivElement | null>(null);
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: page.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const setCardNodeRef = useCallback(
    (node: HTMLDivElement | null) => {
      cardRef.current = node;
      setNodeRef(node);
    },
    [setNodeRef],
  );

  useEffect(() => {
    const element = cardRef.current;

    if (!element || page.thumbnailDataUrl || isGeneratedPageItem(page)) {
      setIsThumbnailVisible(true);
      return undefined;
    }

    if (typeof IntersectionObserver === 'undefined') {
      setIsThumbnailVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsThumbnailVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px 0px' },
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [page]);

  useEffect(() => {
    let isStale = false;

    if (page.thumbnailDataUrl) {
      setThumbnailDataUrl(page.thumbnailDataUrl);
      setRenderFailed(false);
      return undefined;
    }

    if (!isThumbnailVisible) {
      return undefined;
    }

    if (isGeneratedPageItem(page)) {
      setRenderFailed(false);
      return undefined;
    }

    if (!sourceDocument) {
      setRenderFailed(true);
      return undefined;
    }

    setRenderFailed(false);

    renderPdfThumbnailToDataUrl({
      page,
      sourceDocument,
    })
      .then((result) => {
        if (isStale) {
          return;
        }

        setThumbnailDataUrl(result.dataUrl);
        onThumbnailRendered(page.id, result.dataUrl);
      })
      .catch(() => {
        if (!isStale) {
          setRenderFailed(true);
        }
      });

    return () => {
      isStale = true;
    };
  }, [isThumbnailVisible, onThumbnailRendered, page, sourceDocument]);

  const handlePageClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.shiftKey && selectedPageIds.length) {
      const lastSelectedPageId = selectedPageIds[selectedPageIds.length - 1];
      const lastSelectedIndex = pages.findIndex(
        (candidatePage) => candidatePage.id === lastSelectedPageId,
      );
      const rangeStart = Math.min(
        lastSelectedIndex >= 0 ? lastSelectedIndex : pageIndex,
        pageIndex,
      );
      const rangeEnd = Math.max(lastSelectedIndex >= 0 ? lastSelectedIndex : pageIndex, pageIndex);
      const rangePageIds = pages
        .slice(rangeStart, rangeEnd + 1)
        .map((candidatePage) => candidatePage.id);

      onSetSelectedPages(rangePageIds);
      onActivatePage(page.id);
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      onTogglePageSelection(page.id, !isSelected);
      onActivatePage(page.id);
      return;
    }

    onSelectPage(page.id);
  };

  const getActionPageIds = () => (isSelected ? selectedPageIds : [page.id]);

  return (
    <div
      ref={setCardNodeRef}
      aria-current={isActive ? 'page' : undefined}
      className="thumbnail-page-card"
      data-drag-group={isDraggingGroupMember && !isDragging ? 'true' : undefined}
      data-dragging={isDragging ? 'true' : undefined}
      data-drop-position={isDropTarget ? dropPosition : undefined}
      data-selected={isSelected ? 'true' : undefined}
      onContextMenu={(event) => onOpenContextMenu(page.id, event)}
      role="listitem"
      style={style}
    >
      <button
        {...attributes}
        {...listeners}
        ref={setActivatorNodeRef}
        aria-label={`Drag page ${pageNumber}`}
        className="thumbnail-drag-handle"
        title={`Drag page ${pageNumber}`}
        type="button"
      >
        <GripVertical size={15} />
      </button>

      <label className="thumbnail-select-control">
        <input
          aria-label={`Select page ${pageNumber}`}
          checked={isSelected}
          onChange={(event) => onTogglePageSelection(page.id, event.target.checked)}
          type="checkbox"
        />
      </label>

      <button
        aria-label={`Open page ${pageNumber}`}
        className="thumbnail-page-select"
        onClick={handlePageClick}
        type="button"
      >
        <span className="thumbnail-page-surface" aria-hidden="true">
          {thumbnailDataUrl ? (
            <img alt="" className="thumbnail-image" src={thumbnailDataUrl} />
          ) : isGeneratedPageItem(page) ? (
            <span className="thumbnail-placeholder generated-thumbnail" />
          ) : (
            <span
              className="thumbnail-placeholder"
              data-error={renderFailed ? 'true' : undefined}
            />
          )}
        </span>
      </button>

      <div className="thumbnail-page-meta">
        <span className="thumbnail-page-label">Page {pageNumber}</span>
        {showSourceLabel ? (
          <span
            className="thumbnail-source-label"
            title={isSourcePageItem(page) ? page.sourceFileName : 'Generated page'}
          >
            {isSourcePageItem(page) ? page.sourceFileName : 'Generated page'}
          </span>
        ) : null}
        {page.rotation ? (
          <span className="thumbnail-rotation-badge" title={`Rotated ${page.rotation} degrees`}>
            {page.rotation}°
          </span>
        ) : null}
      </div>

      <div className="thumbnail-actions" aria-label={`Page ${pageNumber} actions`}>
        <ThumbnailActionButton
          disabled={!canMoveUp}
          label={`Move page ${pageNumber} up`}
          onClick={() => onMovePage(page.id, -1)}
        >
          <ArrowUp size={14} />
        </ThumbnailActionButton>
        <ThumbnailActionButton
          disabled={!canMoveDown}
          label={`Move page ${pageNumber} down`}
          onClick={() => onMovePage(page.id, 1)}
        >
          <ArrowDown size={14} />
        </ThumbnailActionButton>
        <ThumbnailActionButton
          label={`Rotate page ${pageNumber} left`}
          onClick={() => onRotatePages(getActionPageIds(), 'counterclockwise')}
        >
          <RotateCcw size={14} />
        </ThumbnailActionButton>
        <ThumbnailActionButton
          label={`Rotate page ${pageNumber} right`}
          onClick={() => onRotatePages(getActionPageIds(), 'clockwise')}
        >
          <RotateCw size={14} />
        </ThumbnailActionButton>
        <ThumbnailActionButton
          label={`Delete page ${pageNumber}`}
          onClick={() => onDeletePages(getActionPageIds())}
        >
          <Trash2 size={14} />
        </ThumbnailActionButton>
      </div>
    </div>
  );
}

function ThumbnailDragOverlay({
  page,
  selectedPageCount,
  showSourceLabel,
}: {
  page: PdfPageItem;
  selectedPageCount: number;
  showSourceLabel: boolean;
}) {
  return (
    <div className="thumbnail-drag-overlay">
      <span className="thumbnail-drag-overlay-surface" aria-hidden="true">
        {page.thumbnailDataUrl ? (
          <img alt="" className="thumbnail-image" src={page.thumbnailDataUrl} />
        ) : (
          <span className="thumbnail-placeholder" />
        )}
      </span>
      <span className="thumbnail-drag-overlay-label">
        {selectedPageCount > 1 ? `${selectedPageCount} pages` : `Page ${page.displayIndex}`}
      </span>
      {showSourceLabel ? (
        <span
          className="thumbnail-source-label"
          title={isSourcePageItem(page) ? page.sourceFileName : 'Generated page'}
        >
          {isSourcePageItem(page) ? page.sourceFileName : 'Generated page'}
        </span>
      ) : null}
    </div>
  );
}

export function ThumbnailSidebar({
  onActivatePage,
  onClearSelection,
  onDeletePages,
  onMovePage,
  onReorderPages,
  onRotatePages,
  onSelectAllPages,
  onSelectPage,
  onSetSelectedPages,
  onThumbnailRendered,
  onTogglePageSelection,
  onToggleCollapsed,
  selectedPageIds,
  workspace,
}: ThumbnailSidebarProps) {
  const [draggedPageId, setDraggedPageId] = useState<PdfPageId | null>(null);
  const [dropTargetPageId, setDropTargetPageId] = useState<PdfPageId | null>(null);
  const [contextMenu, setContextMenu] = useState<ThumbnailContextMenu | null>(null);
  const pages = useMemo(
    () => workspace?.pages.filter((page) => !page.deleted) ?? [],
    [workspace?.pages],
  );
  const pageIds = useMemo(() => pages.map((page) => page.id), [pages]);
  const selectedPageIdSet = useMemo(() => new Set(selectedPageIds), [selectedPageIds]);
  const showSourceLabels = (workspace?.documents.length ?? 0) > 1;
  const documentsById = useMemo(() => {
    return new Map(workspace?.documents.map((document) => [document.id, document]) ?? []);
  }, [workspace?.documents]);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const selectedDragPageIds = useMemo(() => {
    if (!draggedPageId) {
      return new Set<PdfPageId>();
    }

    if (!selectedPageIdSet.has(draggedPageId)) {
      return new Set<PdfPageId>([draggedPageId]);
    }

    const visiblePageIds = new Set(pageIds);
    return new Set(selectedPageIds.filter((pageId) => visiblePageIds.has(pageId)));
  }, [draggedPageId, pageIds, selectedPageIdSet, selectedPageIds]);
  const activeDragPage = draggedPageId
    ? pages.find((page) => page.id === draggedPageId)
    : undefined;
  const dropPosition = useMemo<DropPosition | undefined>(() => {
    if (!draggedPageId || !dropTargetPageId || draggedPageId === dropTargetPageId) {
      return undefined;
    }

    const draggedPageIndex = pages.findIndex((page) => page.id === draggedPageId);
    const targetPageIndex = pages.findIndex((page) => page.id === dropTargetPageId);

    if (draggedPageIndex < 0 || targetPageIndex < 0) {
      return undefined;
    }

    return draggedPageIndex < targetPageIndex ? 'after' : 'before';
  }, [draggedPageId, dropTargetPageId, pages]);
  const deleteLabel = selectedPageIds.length === 1 ? 'Delete Page' : 'Delete Pages';

  const getActionPageIds = (pageId: PdfPageId) => {
    if (!selectedPageIdSet.has(pageId)) {
      return [pageId];
    }

    const visiblePageIds = new Set(pageIds);
    return selectedPageIds.filter((selectedPageId) => visiblePageIds.has(selectedPageId));
  };

  const closeContextMenu = () => setContextMenu(null);

  const handleOpenContextMenu = (pageId: PdfPageId, event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setContextMenu({
      pageId,
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 150),
    });
  };

  const handleContextMenuRotate = (direction: PdfRotationDirection) => {
    if (!contextMenu) {
      return;
    }

    onRotatePages(getActionPageIds(contextMenu.pageId), direction);
    closeContextMenu();
  };

  const handleContextMenuDelete = () => {
    if (!contextMenu) {
      return;
    }

    onDeletePages(getActionPageIds(contextMenu.pageId));
    closeContextMenu();
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
  }, [contextMenu]);

  const handleDragStart = (event: DragStartEvent) => {
    closeContextMenu();
    setDraggedPageId(String(event.active.id));
  };

  const handleDragOver = (event: DragOverEvent) => {
    const overPageId = event.over?.id ? String(event.over.id) : null;
    setDropTargetPageId(overPageId && overPageId !== draggedPageId ? overPageId : null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const activePageId = String(event.active.id);
    const overPageId = event.over?.id ? String(event.over.id) : null;

    setDraggedPageId(null);
    setDropTargetPageId(null);

    if (overPageId && activePageId !== overPageId) {
      onReorderPages(activePageId, overPageId);
    }
  };

  const handleDragCancel = () => {
    setDraggedPageId(null);
    setDropTargetPageId(null);
  };

  return (
    <aside
      className="thumbnail-sidebar"
      aria-label="Page thumbnails"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
          event.preventDefault();
          onSelectAllPages();
          return;
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          onClearSelection();
        }
      }}
      tabIndex={0}
    >
      <div className="panel-header thumbnail-panel-header">
        <div>
          <h2>Pages</h2>
          {selectedPageIds.length ? (
            <span className="selection-count">{selectedPageIds.length} selected</span>
          ) : null}
        </div>
        <button
          aria-label="Collapse page thumbnails"
          className="panel-icon-button"
          onClick={onToggleCollapsed}
          title="Collapse page thumbnails"
          type="button"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      <div className="thumbnail-selection-toolbar">
        <button
          className="sidebar-action-button destructive"
          disabled={!selectedPageIds.length}
          onClick={() => onDeletePages(selectedPageIds)}
          type="button"
        >
          <Trash2 size={14} />
          <span>{deleteLabel}</span>
        </button>
        <button
          className="sidebar-action-button"
          disabled={!selectedPageIds.length}
          onClick={onClearSelection}
          type="button"
        >
          Clear
        </button>
      </div>

      {workspace && pages.length ? (
        <DndContext
          collisionDetection={closestCenter}
          onDragCancel={handleDragCancel}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDragStart={handleDragStart}
          sensors={sensors}
        >
          <SortableContext items={pageIds} strategy={verticalListSortingStrategy}>
            <div className="thumbnail-list has-pages" aria-label="Page list" role="list">
              {pages.map((page, pageIndex) => (
                <PageThumbnail
                  canMoveDown={pageIndex < pages.length - 1}
                  canMoveUp={pageIndex > 0}
                  dropPosition={dropPosition}
                  isActive={workspace.activePageId === page.id}
                  isDraggingGroupMember={selectedDragPageIds.has(page.id)}
                  isDropTarget={dropTargetPageId === page.id}
                  isSelected={selectedPageIdSet.has(page.id)}
                  key={page.id}
                  onActivatePage={onActivatePage}
                  onDeletePages={onDeletePages}
                  onMovePage={onMovePage}
                  onOpenContextMenu={handleOpenContextMenu}
                  onRotatePages={onRotatePages}
                  onSelectPage={onSelectPage}
                  onSetSelectedPages={onSetSelectedPages}
                  onThumbnailRendered={onThumbnailRendered}
                  onTogglePageSelection={onTogglePageSelection}
                  page={page}
                  pageIndex={pageIndex}
                  pages={pages}
                  pageNumber={page.displayIndex}
                  selectedPageIds={selectedPageIds}
                  showSourceLabel={showSourceLabels}
                  sourceDocument={
                    isSourcePageItem(page) ? documentsById.get(page.sourceDocumentId) : undefined
                  }
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay adjustScale={false}>
            {activeDragPage ? (
              <ThumbnailDragOverlay
                page={activeDragPage}
                selectedPageCount={Math.max(1, selectedDragPageIds.size)}
                showSourceLabel={showSourceLabels}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : workspace ? (
        <div className="thumbnail-list" aria-label="No page thumbnails">
          <div className="thumbnail-placeholder" />
          <p>No pages</p>
        </div>
      ) : (
        <div className="thumbnail-list" aria-label="No page thumbnails">
          <div className="thumbnail-placeholder" />
          <p>No pages</p>
        </div>
      )}

      {contextMenu ? (
        <div
          className="thumbnail-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => handleContextMenuRotate('counterclockwise')}
            role="menuitem"
            type="button"
          >
            <RotateCcw size={14} />
            <span>Rotate left</span>
          </button>
          <button
            onClick={() => handleContextMenuRotate('clockwise')}
            role="menuitem"
            type="button"
          >
            <RotateCw size={14} />
            <span>Rotate right</span>
          </button>
          <button
            className="destructive"
            onClick={handleContextMenuDelete}
            role="menuitem"
            type="button"
          >
            <Trash2 size={14} />
            <span>Delete</span>
          </button>
        </div>
      ) : null}
    </aside>
  );
}

export function CollapsedThumbnailSidebar({
  onToggleCollapsed,
}: {
  onToggleCollapsed: () => void;
}) {
  return (
    <aside
      aria-label="Collapsed page thumbnails"
      className="thumbnail-sidebar thumbnail-sidebar-collapsed"
    >
      <button
        aria-label="Expand page thumbnails"
        className="panel-icon-button"
        onClick={onToggleCollapsed}
        title="Expand page thumbnails"
        type="button"
      >
        <PanelLeftOpen size={16} />
      </button>
    </aside>
  );
}
