import {
  Edit3,
  Eraser,
  Highlighter,
  ImagePlus,
  MessageSquareText,
  MousePointer2,
  PenLine,
  RectangleHorizontal,
  TextCursorInput,
  Type,
} from 'lucide-react';
import type { ReactNode } from 'react';

import type { PdfAnnotationTool } from '../../lib/pdf/types';

type AnnotationToolbarProps = {
  activeTool: PdfAnnotationTool;
  disabled?: boolean;
  hasSignatureImage: boolean;
  isAnnotating: boolean;
  onSelectTool: (tool: PdfAnnotationTool) => void;
  onToggleAnnotating: () => void;
};

const tools: Array<{
  icon: ReactNode;
  id: PdfAnnotationTool;
  label: string;
  requiresSignature?: boolean;
}> = [
  { id: 'select', label: 'Select annotation', icon: <MousePointer2 size={15} /> },
  { id: 'highlight', label: 'Highlighter', icon: <Highlighter size={15} /> },
  { id: 'text-note', label: 'Comment', icon: <MessageSquareText size={15} /> },
  { id: 'edit-text', label: 'Edit embedded text', icon: <TextCursorInput size={15} /> },
  { id: 'free-text', label: 'Add text box', icon: <Type size={15} /> },
  { id: 'pen', label: 'Freehand pen', icon: <PenLine size={15} /> },
  { id: 'eraser', label: 'Erase freehand', icon: <Eraser size={15} /> },
  { id: 'rectangle', label: 'Rectangle shape', icon: <RectangleHorizontal size={15} /> },
  {
    id: 'signature',
    label: 'Signature image',
    icon: <ImagePlus size={15} />,
    requiresSignature: true,
  },
];

export function AnnotationToolbar({
  activeTool,
  disabled,
  hasSignatureImage,
  isAnnotating,
  onSelectTool,
  onToggleAnnotating,
}: AnnotationToolbarProps) {
  return (
    <div className="annotation-toolbar" aria-label="Annotation tools">
      <button
        aria-pressed={isAnnotating}
        className="viewer-icon-button annotation-mode-button"
        data-tooltip="Annotate mode"
        disabled={disabled}
        onClick={onToggleAnnotating}
        type="button"
      >
        <Edit3 size={15} />
      </button>

      {isAnnotating
        ? tools.map((tool) => {
            const toolDisabled = disabled || (tool.requiresSignature && !hasSignatureImage);

            return (
              <button
                aria-label={tool.label}
                aria-pressed={activeTool === tool.id}
                className="viewer-icon-button annotation-tool-button"
                data-tooltip={tool.label}
                disabled={toolDisabled}
                key={tool.id}
                onClick={() => onSelectTool(tool.id)}
                type="button"
              >
                {tool.icon}
              </button>
            );
          })
        : null}
    </div>
  );
}
