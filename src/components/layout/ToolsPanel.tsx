import {
  FilePlus2,
  ListChecks,
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
  onImportFormData: (formData: PdfFormDataJson) => void;
  onOpenRecentFile: (filePath: string) => void;
  onPasteFreehandAnnotation: () => void;
  onSetSignatureImage: (signatureImage: SignatureImage) => void;
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
  'isAddingPdfs' | 'onAddPdfs' | 'onOpenRecentFile' | 'recentFiles' | 'workspace'
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
  onAddPdfs,
  onOpenRecentFile,
  recentFiles,
  workspace,
}: DocumentPanelProps) {
  const includedPageCounts = workspace ? getIncludedPageCountByDocument(workspace) : new Map();

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
                  <span className="source-file-name" title={document.fileName}>
                    {document.fileName}
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
  onImportFormData,
  onOpenRecentFile,
  onPasteFreehandAnnotation,
  onSetSignatureImage,
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
              onAddPdfs={onAddPdfs}
              onOpenRecentFile={onOpenRecentFile}
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
