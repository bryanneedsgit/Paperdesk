import {
  Download,
  HelpCircle,
  Info,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Redo2,
  Settings,
  Undo2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import type { PdfWorkspace } from '../../lib/pdf/types';

type TopToolbarProps = {
  canExportPdf: boolean;
  canRedo: boolean;
  canUndo: boolean;
  canUseWorkspaceControls: boolean;
  isAddingPdfs: boolean;
  isExportingPdf: boolean;
  isOpeningPdf: boolean;
  isFullscreen: boolean;
  onAbout: () => void;
  onExportPdf: () => void;
  onHelp: () => void;
  onRedo: () => void;
  onSettings: () => void;
  onToggleFullscreen: () => void;
  onUndo: () => void;
  onZoomPercentChange: (zoomPercent: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  workspace: PdfWorkspace | null;
  zoomPercent: number;
};

function getWorkspaceTitle(workspace: PdfWorkspace): string {
  if (workspace.documents.length > 1) {
    return 'Merged document';
  }

  return workspace.name;
}

function getWorkspaceMeta(workspace: PdfWorkspace): string {
  const pageCount = workspace.pages.filter((page) => !page.deleted).length;
  const documentCount = workspace.documents.length;
  const pageLabel = pageCount === 1 ? 'page' : 'pages';
  const documentLabel = documentCount === 1 ? 'PDF' : 'PDFs';

  if (documentCount > 1) {
    return `${pageCount} ${pageLabel} from ${documentCount} ${documentLabel}`;
  }

  return `Paperdesk - ${pageCount} ${pageLabel}`;
}

function IconToolbarButton({
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
      className="toolbar-icon-button"
      data-tooltip={label}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

export function TopToolbar({
  canExportPdf,
  canRedo,
  canUndo,
  canUseWorkspaceControls,
  isAddingPdfs,
  isExportingPdf,
  isOpeningPdf,
  isFullscreen,
  onAbout,
  onExportPdf,
  onHelp,
  onRedo,
  onSettings,
  onToggleFullscreen,
  onUndo,
  onZoomPercentChange,
  onZoomIn,
  onZoomOut,
  workspace,
  zoomPercent,
}: TopToolbarProps) {
  const isBusy = isOpeningPdf || isAddingPdfs || isExportingPdf;
  const [zoomInput, setZoomInput] = useState(String(zoomPercent));

  useEffect(() => {
    setZoomInput(String(zoomPercent));
  }, [zoomPercent]);

  const commitZoomInput = () => {
    const nextZoomPercent = Number.parseInt(zoomInput, 10);

    if (!Number.isFinite(nextZoomPercent)) {
      setZoomInput(String(zoomPercent));
      return;
    }

    onZoomPercentChange(nextZoomPercent);
  };

  return (
    <header className="top-toolbar">
      <div className="toolbar-identity">
        <div className="brand-mark" aria-hidden="true" />

        <div className="toolbar-title">
          <h1>{workspace ? getWorkspaceTitle(workspace) : 'Paperdesk'}</h1>
          <p>{workspace ? getWorkspaceMeta(workspace) : 'Offline PDF editor'}</p>
        </div>
      </div>

      <div className="toolbar-control-strip">
        <nav className="toolbar-control-group toolbar-actions" aria-label="Document actions">
          <button
            aria-busy={isExportingPdf}
            aria-label="Export PDF"
            className="toolbar-icon-button"
            data-tooltip="Export PDF"
            disabled={isBusy || !canExportPdf}
            onClick={onExportPdf}
            type="button"
          >
            <Download size={16} />
          </button>
          <span className="toolbar-separator" aria-hidden="true" />
          <IconToolbarButton disabled={isBusy || !canUndo} label="Undo" onClick={onUndo}>
            <Undo2 size={16} />
          </IconToolbarButton>
          <IconToolbarButton disabled={isBusy || !canRedo} label="Redo" onClick={onRedo}>
            <Redo2 size={16} />
          </IconToolbarButton>
        </nav>

        <div className="toolbar-control-group toolbar-zoom-group" aria-label="Zoom controls">
          <IconToolbarButton
            disabled={!canUseWorkspaceControls}
            label="Zoom out"
            onClick={onZoomOut}
          >
            <Minus size={15} />
          </IconToolbarButton>
          <label className="toolbar-zoom-input">
            <span className="sr-only">Zoom percentage</span>
            <input
              aria-label="Zoom percentage"
              disabled={!canUseWorkspaceControls}
              inputMode="numeric"
              max={400}
              min={25}
              onBlur={commitZoomInput}
              onChange={(event) => setZoomInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }

                if (event.key === 'Escape') {
                  setZoomInput(String(zoomPercent));
                  event.currentTarget.blur();
                }
              }}
              type="number"
              value={zoomInput}
            />
            <span aria-hidden="true">%</span>
          </label>
          <IconToolbarButton disabled={!canUseWorkspaceControls} label="Zoom in" onClick={onZoomIn}>
            <Plus size={15} />
          </IconToolbarButton>
          <span className="toolbar-separator" aria-hidden="true" />
          <IconToolbarButton
            label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            onClick={onToggleFullscreen}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </IconToolbarButton>
        </div>

        <div className="toolbar-control-group toolbar-utility-group" aria-label="App controls">
          <IconToolbarButton label="Feature guide" onClick={onHelp}>
            <HelpCircle size={16} />
          </IconToolbarButton>
          <IconToolbarButton label="Settings" onClick={onSettings}>
            <Settings size={16} />
          </IconToolbarButton>
          <IconToolbarButton label="About Paperdesk" onClick={onAbout}>
            <Info size={16} />
          </IconToolbarButton>
        </div>
      </div>
    </header>
  );
}
