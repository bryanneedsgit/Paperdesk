import {
  FilePlus2,
  ListChecks,
  LockKeyhole,
  LockOpen,
  PanelRightClose,
  PanelRightOpen,
  PenLine,
  Type,
} from 'lucide-react';
import type { ReactNode } from 'react';

import type { PdfFormDataJson } from '../../lib/pdf/pdfForms';
import type { FreehandSensitivity } from '../../lib/pdf/annotationStroke';
import { getIncludedPageCountByDocument } from '../../lib/pdf/pdfWorkspace';
import type {
  FormatterSettings,
  PdfAnnotationId,
  PdfFormFieldValue,
  PdfFormSettings,
  PdfAnnotationTool,
  PdfWorkspace,
} from '../../lib/pdf/types';
import type { RecentPdfFile } from '../../lib/storage/recentFilesStorage';
import { AnnotationsPanel, type AnnotationFontPatch } from '../annotations/AnnotationsPanel';
import { FormPanel } from '../forms/FormPanel';
import { FormatterPanel } from '../formatter/FormatterPanel';

export type ToolPanelId = 'document' | 'format' | 'forms' | 'annotations';

type SignatureImage = {
  bytes: number[];
  dataUrl: string;
  mimeType: 'image/png' | 'image/jpeg';
};

type ToolsPanelProps = {
  activePanel: ToolPanelId;
  annotationBorderColor: string;
  isCollapsed: boolean;
  isAddingPdfs: boolean;
  isPdfSecurityBusy: boolean;
  onAddPdfs: () => void;
  annotationColor: string;
  annotationFillColor: string;
  annotationStrokeWidth: number;
  canCopySelectedFreehandAnnotation: boolean;
  canPasteFreehandAnnotation: boolean;
  eraserSize: number;
  freehandSensitivity: FreehandSensitivity;
  highlightBrushSize: number;
  highlightOpacity: number;
  onChangeAnnotationColor: (color: string) => void;
  onChangeAnnotationBorderColor: (color: string) => void;
  onChangeAnnotationFillColor: (color: string) => void;
  onChangeAnnotationStrokeWidth: (strokeWidth: number) => void;
  onChangeEraserSize: (eraserSize: number) => void;
  onChangeFreehandSensitivity: (sensitivity: FreehandSensitivity) => void;
  onChangeHighlightBrushSize: (brushSize: number) => void;
  onChangeHighlightOpacity: (opacity: number) => void;
  onChangeFormatterSettings: (settings: Partial<FormatterSettings>) => void;
  onChangeFormFieldValue: (
    sourceDocumentId: string,
    fieldName: string,
    value: PdfFormFieldValue,
  ) => void;
  onChangeFormSettings: (settings: Partial<PdfFormSettings>) => void;
  onChangeSelectedAnnotationBorderColor: (annotationId: PdfAnnotationId, color: string) => void;
  onChangeSelectedAnnotationColor: (annotationId: PdfAnnotationId, color: string) => void;
  onChangeSelectedAnnotationFillColor: (annotationId: PdfAnnotationId, color: string) => void;
  onChangeSelectedAnnotationFont: (
    annotationId: PdfAnnotationId,
    patch: AnnotationFontPatch,
  ) => void;
  onChangeSelectedAnnotationStrokeWidth: (
    annotationId: PdfAnnotationId,
    strokeWidth: number,
  ) => void;
  onChangeSelectedAnnotationHighlightBrushSize: (
    annotationId: PdfAnnotationId,
    brushSize: number,
  ) => void;
  onChangeSelectedAnnotationOpacity: (annotationId: PdfAnnotationId, opacity: number) => void;
  onCopySelectedFreehandAnnotation: () => void;
  onDeleteAnnotation: (annotationId: PdfAnnotationId) => void;
  onInsertBlankPage: () => void;
  onInsertCoverPage: () => void;
  onLockPdf: () => void;
  onImportFormData: (formData: PdfFormDataJson) => void;
  onOpenRecentFile: (filePath: string) => void;
  onPasteFreehandAnnotation: () => void;
  onSetSignatureImage: (signatureImage: SignatureImage) => void;
  onSaveUnlockedPdf: () => void;
  onToggleCollapsed: () => void;
  recentFiles: RecentPdfFile[];
  selectedAnnotationId: PdfAnnotationId | null;
  selectedAnnotationTool: PdfAnnotationTool;
  setActivePanel: (panelId: ToolPanelId) => void;
  signatureImage: SignatureImage | null;
  workspace: PdfWorkspace | null;
};

type DocumentPanelProps = Pick<
  ToolsPanelProps,
  | 'isAddingPdfs'
  | 'isPdfSecurityBusy'
  | 'onAddPdfs'
  | 'onLockPdf'
  | 'onOpenRecentFile'
  | 'onSaveUnlockedPdf'
  | 'recentFiles'
  | 'workspace'
>;

const toolPanels: Array<{
  id: ToolPanelId;
  label: string;
  icon: ReactNode;
}> = [
  { id: 'document', label: 'Document', icon: <FilePlus2 size={16} /> },
  { id: 'format', label: 'Formatter', icon: <Type size={16} /> },
  { id: 'forms', label: 'Forms', icon: <ListChecks size={16} /> },
  { id: 'annotations', label: 'Annotations', icon: <PenLine size={16} /> },
];

function DocumentPanel({
  isAddingPdfs,
  isPdfSecurityBusy,
  onAddPdfs,
  onLockPdf,
  onOpenRecentFile,
  onSaveUnlockedPdf,
  recentFiles,
  workspace,
}: DocumentPanelProps) {
  const includedPageCounts = workspace ? getIncludedPageCountByDocument(workspace) : new Map();
  const protectedDocumentCount =
    workspace?.documents.filter((document) => document.security?.wasEncrypted).length ?? 0;

  return (
    <div className="tool-stack document-panel">
      <section className="tool-section">
        <div className="source-list-header">
          <h3>Sources</h3>
          <button
            className="secondary-action-button"
            disabled={isAddingPdfs}
            onClick={onAddPdfs}
            type="button"
          >
            <FilePlus2 size={15} />
            <span>{isAddingPdfs ? 'Adding...' : 'Add PDFs'}</span>
          </button>
        </div>

        {workspace ? (
          <div className="source-list" role="list">
            {workspace.documents.map((document) => {
              const includedPageCount = includedPageCounts.get(document.id) ?? 0;

              return (
                <div className="source-list-item" key={document.id} role="listitem">
                  <span className="source-file-heading">
                    {document.security?.wasEncrypted ? (
                      <span
                        aria-label="Password-protected source"
                        className="source-security-icon"
                        title="Opened from a password-protected PDF"
                      >
                        <LockKeyhole size={12} />
                      </span>
                    ) : null}
                    <span className="source-file-name" title={document.fileName}>
                      {document.fileName}
                    </span>
                  </span>
                  <span className="source-file-meta">
                    {includedPageCount} included / {document.pageCount} total
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="source-list-empty">Open or add PDFs to begin.</p>
        )}
      </section>

      <section className="tool-section" aria-labelledby="document-security-title">
        <div className="document-security-summary">
          <h3 id="document-security-title">Protection</h3>
          <span
            className="document-security-status"
            data-protected={protectedDocumentCount > 0 ? 'true' : undefined}
          >
            {protectedDocumentCount > 0 ? <LockKeyhole size={13} /> : <LockOpen size={13} />}
            {protectedDocumentCount > 0
              ? `${protectedDocumentCount} protected ${protectedDocumentCount === 1 ? 'source' : 'sources'}`
              : 'No password'}
          </span>
        </div>
        <p className="document-security-copy">
          {protectedDocumentCount > 0
            ? 'Protected sources are unlocked only for this session. Export can keep or remove protection.'
            : 'Create an AES-256 encrypted copy that requires a password to open.'}
        </p>
        <div className="document-security-actions">
          <button
            className="secondary-action-button"
            disabled={!workspace || isPdfSecurityBusy}
            onClick={onLockPdf}
            type="button"
          >
            <LockKeyhole size={14} />
            <span>{isPdfSecurityBusy ? 'Working...' : 'Lock PDF copy'}</span>
          </button>
          {protectedDocumentCount > 0 ? (
            <button
              className="secondary-action-button"
              disabled={!workspace || isPdfSecurityBusy}
              onClick={onSaveUnlockedPdf}
              type="button"
            >
              <LockOpen size={14} />
              <span>Save unlocked copy</span>
            </button>
          ) : null}
        </div>
      </section>

      {recentFiles.length ? (
        <section className="tool-section recent-file-list" aria-label="Recent files">
          <h3>Recent</h3>
          {recentFiles.map((file) => (
            <button
              className="recent-file-button"
              key={file.filePath}
              onClick={() => onOpenRecentFile(file.filePath)}
              title={file.filePath}
              type="button"
            >
              {file.fileName}
            </button>
          ))}
        </section>
      ) : null}
    </div>
  );
}

export function ToolsPanel({
  activePanel,
  annotationBorderColor,
  annotationColor,
  annotationFillColor,
  annotationStrokeWidth,
  canCopySelectedFreehandAnnotation,
  canPasteFreehandAnnotation,
  eraserSize,
  freehandSensitivity,
  highlightBrushSize,
  highlightOpacity,
  isCollapsed,
  isAddingPdfs,
  isPdfSecurityBusy,
  onAddPdfs,
  onChangeAnnotationBorderColor,
  onChangeAnnotationColor,
  onChangeAnnotationFillColor,
  onChangeAnnotationStrokeWidth,
  onChangeEraserSize,
  onChangeFreehandSensitivity,
  onChangeHighlightBrushSize,
  onChangeHighlightOpacity,
  onChangeFormatterSettings,
  onChangeFormFieldValue,
  onChangeFormSettings,
  onChangeSelectedAnnotationBorderColor,
  onChangeSelectedAnnotationColor,
  onChangeSelectedAnnotationFillColor,
  onChangeSelectedAnnotationFont,
  onChangeSelectedAnnotationStrokeWidth,
  onChangeSelectedAnnotationHighlightBrushSize,
  onChangeSelectedAnnotationOpacity,
  onCopySelectedFreehandAnnotation,
  onDeleteAnnotation,
  onInsertBlankPage,
  onInsertCoverPage,
  onLockPdf,
  onImportFormData,
  onOpenRecentFile,
  onPasteFreehandAnnotation,
  onSetSignatureImage,
  onSaveUnlockedPdf,
  onToggleCollapsed,
  recentFiles,
  selectedAnnotationId,
  selectedAnnotationTool,
  setActivePanel,
  signatureImage,
  workspace,
}: ToolsPanelProps) {
  return (
    <aside
      className="tools-panel"
      aria-label="Tools panel"
      data-collapsed={isCollapsed ? 'true' : undefined}
    >
      <div className="panel-header">
        <h2>{isCollapsed ? <span className="sr-only">Tools</span> : 'Tools'}</h2>
        <button
          aria-label={isCollapsed ? 'Expand tools panel' : 'Collapse tools panel'}
          className="panel-icon-button"
          data-tooltip={isCollapsed ? 'Expand tools panel' : 'Collapse tools panel'}
          data-tooltip-placement="left"
          onClick={onToggleCollapsed}
          type="button"
        >
          {isCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
        </button>
      </div>

      <div className="tool-tabs" role="tablist" aria-label="Tool groups">
        {toolPanels.map((panel) => (
          <button
            aria-selected={activePanel === panel.id}
            className="tool-tab"
            data-tooltip={panel.label}
            data-tooltip-placement="left"
            key={panel.id}
            onClick={() => setActivePanel(panel.id)}
            role="tab"
            type="button"
          >
            <span aria-hidden="true">{panel.icon}</span>
            <span className="sr-only">{panel.label}</span>
          </button>
        ))}
      </div>

      {!isCollapsed ? (
        <div className="tool-panel-body" role="tabpanel">
          {activePanel === 'document' ? (
            <DocumentPanel
              isAddingPdfs={isAddingPdfs}
              isPdfSecurityBusy={isPdfSecurityBusy}
              onAddPdfs={onAddPdfs}
              onLockPdf={onLockPdf}
              onOpenRecentFile={onOpenRecentFile}
              onSaveUnlockedPdf={onSaveUnlockedPdf}
              recentFiles={recentFiles}
              workspace={workspace}
            />
          ) : null}
          {activePanel === 'format' ? (
            <FormatterPanel
              onChangeSettings={onChangeFormatterSettings}
              onInsertBlankPage={onInsertBlankPage}
              onInsertCoverPage={onInsertCoverPage}
              workspace={workspace}
            />
          ) : null}
          {activePanel === 'forms' ? (
            <FormPanel
              onChangeFieldValue={onChangeFormFieldValue}
              onChangeFormSettings={onChangeFormSettings}
              onImportFormData={onImportFormData}
              workspace={workspace}
            />
          ) : null}
          {activePanel === 'annotations' ? (
            <AnnotationsPanel
              annotationBorderColor={annotationBorderColor}
              annotationColor={annotationColor}
              annotationFillColor={annotationFillColor}
              annotationStrokeWidth={annotationStrokeWidth}
              canCopySelectedFreehandAnnotation={canCopySelectedFreehandAnnotation}
              canPasteFreehandAnnotation={canPasteFreehandAnnotation}
              eraserSize={eraserSize}
              freehandSensitivity={freehandSensitivity}
              highlightBrushSize={highlightBrushSize}
              highlightOpacity={highlightOpacity}
              onChangeAnnotationBorderColor={onChangeAnnotationBorderColor}
              onChangeAnnotationColor={onChangeAnnotationColor}
              onChangeAnnotationFillColor={onChangeAnnotationFillColor}
              onChangeAnnotationStrokeWidth={onChangeAnnotationStrokeWidth}
              onChangeEraserSize={onChangeEraserSize}
              onChangeFreehandSensitivity={onChangeFreehandSensitivity}
              onChangeHighlightBrushSize={onChangeHighlightBrushSize}
              onChangeHighlightOpacity={onChangeHighlightOpacity}
              onChangeSelectedAnnotationBorderColor={onChangeSelectedAnnotationBorderColor}
              onChangeSelectedAnnotationColor={onChangeSelectedAnnotationColor}
              onChangeSelectedAnnotationFillColor={onChangeSelectedAnnotationFillColor}
              onChangeSelectedAnnotationFont={onChangeSelectedAnnotationFont}
              onChangeSelectedAnnotationStrokeWidth={onChangeSelectedAnnotationStrokeWidth}
              onChangeSelectedAnnotationHighlightBrushSize={
                onChangeSelectedAnnotationHighlightBrushSize
              }
              onChangeSelectedAnnotationOpacity={onChangeSelectedAnnotationOpacity}
              onCopySelectedFreehandAnnotation={onCopySelectedFreehandAnnotation}
              onDeleteAnnotation={onDeleteAnnotation}
              onPasteFreehandAnnotation={onPasteFreehandAnnotation}
              onSetSignatureImage={onSetSignatureImage}
              selectedAnnotationId={selectedAnnotationId}
              selectedAnnotationTool={selectedAnnotationTool}
              signatureImage={signatureImage}
              workspace={workspace}
            />
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
