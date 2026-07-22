import { open } from '@tauri-apps/plugin-dialog';
import {
  readFile,
  startAccessingSecurityScopedResource,
  stopAccessingSecurityScopedResource,
} from '@tauri-apps/plugin-fs';
import { Bold, ClipboardPaste, Copy, ImagePlus, Italic, Trash2 } from 'lucide-react';

import {
  annotationFontFamilies,
  defaultAnnotationFontId,
  maxAnnotationFontSize,
  minAnnotationFontSize,
  normalizeAnnotationFontSize,
} from '../../lib/pdf/annotationFonts';
import {
  annotationColorPalette,
  getAnnotationBorderColor,
  getAnnotationColor,
  getAnnotationFillColor,
  getDefaultAnnotationBorderColor,
  getDefaultAnnotationFillColor,
  isTransparentAnnotationColor,
  normalizeAnnotationColor,
  normalizeAnnotationPaintColor,
  transparentAnnotationColor,
} from '../../lib/pdf/annotationColors';
import {
  freehandSensitivityOptions,
  maxEraserSize,
  maxHighlightBrushSize,
  maxHighlightOpacity,
  maxPenStrokeWidth,
  minEraserSize,
  minHighlightBrushSize,
  minHighlightOpacity,
  minPenStrokeWidth,
  getAnnotationOpacity,
  getAnnotationStrokeWidth,
  isFreehandHighlightAnnotation,
  normalizeEraserSize,
  normalizeHighlightBrushSize,
  normalizeHighlightOpacity,
  normalizePenStrokeWidth,
  type FreehandSensitivity,
} from '../../lib/pdf/annotationStroke';
import type {
  PdfAnnotation,
  PdfAnnotationId,
  PdfAnnotationTool,
  PdfWorkspace,
} from '../../lib/pdf/types';

type SignatureImage = {
  bytes: number[];
  dataUrl: string;
  mimeType: 'image/png' | 'image/jpeg';
};

export type AnnotationFontPatch = {
  embeddedFontName?: string;
  fontBold?: boolean;
  fontId?: string;
  fontItalic?: boolean;
  fontSize?: number;
};

type AnnotationsPanelProps = {
  annotationBorderColor: string;
  annotationColor: string;
  annotationFillColor: string;
  annotationStrokeWidth: number;
  canCopySelectedFreehandAnnotation: boolean;
  canPasteFreehandAnnotation: boolean;
  eraserSize: number;
  freehandSensitivity: FreehandSensitivity;
  highlightBrushSize: number;
  highlightOpacity: number;
  onChangeAnnotationBorderColor: (color: string) => void;
  onChangeAnnotationColor: (color: string) => void;
  onChangeAnnotationFillColor: (color: string) => void;
  onChangeAnnotationStrokeWidth: (strokeWidth: number) => void;
  onChangeEraserSize: (eraserSize: number) => void;
  onChangeFreehandSensitivity: (sensitivity: FreehandSensitivity) => void;
  onChangeHighlightBrushSize: (brushSize: number) => void;
  onChangeHighlightOpacity: (opacity: number) => void;
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
  onDeleteAnnotation: (annotationId: PdfAnnotationId) => void;
  onCopySelectedFreehandAnnotation: () => void;
  onPasteFreehandAnnotation: () => void;
  onSetSignatureImage: (signatureImage: SignatureImage) => void;
  selectedAnnotationId: PdfAnnotationId | null;
  selectedAnnotationTool: PdfAnnotationTool;
  signatureImage: SignatureImage | null;
  workspace: PdfWorkspace | null;
};

const imageFilters = [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg'] }];

function isColorableAnnotation(annotation: PdfAnnotation | undefined): annotation is PdfAnnotation {
  return Boolean(annotation && annotation.type !== 'image' && annotation.type !== 'signature');
}

function isTextBoxAnnotation(annotation: PdfAnnotation | undefined): annotation is PdfAnnotation {
  return Boolean(
    annotation &&
    (annotation.type === 'free-text' ||
      annotation.type === 'text-note' ||
      annotation.type === 'text-edit'),
  );
}

function isPenAnnotation(annotation: PdfAnnotation | undefined): annotation is PdfAnnotation {
  return Boolean(annotation && annotation.type === 'pen');
}

function getColorInputValue(color: string, fallback: string): string {
  return isTransparentAnnotationColor(color) ? normalizeAnnotationColor(fallback) : color;
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: SignatureImage['mimeType']): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return `data:${mimeType};base64,${window.btoa(binary)}`;
}

function getMimeType(path: string): SignatureImage['mimeType'] {
  return path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
}

export function AnnotationsPanel({
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
  onChangeAnnotationBorderColor,
  onChangeAnnotationColor,
  onChangeAnnotationFillColor,
  onChangeAnnotationStrokeWidth,
  onChangeEraserSize,
  onChangeFreehandSensitivity,
  onChangeHighlightBrushSize,
  onChangeHighlightOpacity,
  onChangeSelectedAnnotationBorderColor,
  onChangeSelectedAnnotationColor,
  onChangeSelectedAnnotationFillColor,
  onChangeSelectedAnnotationFont,
  onChangeSelectedAnnotationStrokeWidth,
  onChangeSelectedAnnotationHighlightBrushSize,
  onChangeSelectedAnnotationOpacity,
  onCopySelectedFreehandAnnotation,
  onDeleteAnnotation,
  onPasteFreehandAnnotation,
  onSetSignatureImage,
  selectedAnnotationId,
  selectedAnnotationTool,
  signatureImage,
  workspace,
}: AnnotationsPanelProps) {
  const annotationCount = workspace?.annotations.length ?? 0;
  const selectedAnnotation = workspace?.annotations.find(
    (annotation) => annotation.id === selectedAnnotationId,
  );
  const selectedHighlightAnnotation =
    selectedAnnotation && isFreehandHighlightAnnotation(selectedAnnotation)
      ? selectedAnnotation
      : null;
  const canColorSelectedAnnotation = isColorableAnnotation(selectedAnnotation);
  const canStyleSelectedTextBox = isTextBoxAnnotation(selectedAnnotation);
  const canStylePen = selectedAnnotationTool === 'pen' || isPenAnnotation(selectedAnnotation);
  const canStyleEraser = selectedAnnotationTool === 'eraser';
  const canStyleHighlight =
    selectedAnnotationTool === 'highlight' || Boolean(selectedHighlightAnnotation);
  const activeColor = canColorSelectedAnnotation
    ? getAnnotationColor(selectedAnnotation)
    : normalizeAnnotationColor(annotationColor);
  const activeColorLabel = isPenAnnotation(selectedAnnotation)
    ? 'Selected pen'
    : selectedAnnotationTool === 'pen'
      ? 'New pen strokes'
      : canStyleSelectedTextBox
        ? 'Selected text'
        : canColorSelectedAnnotation
          ? 'Selected annotation'
          : 'New annotations';
  const activeFillColor = canStyleSelectedTextBox
    ? getAnnotationFillColor(selectedAnnotation)
    : normalizeAnnotationPaintColor(
        annotationFillColor,
        getDefaultAnnotationFillColor('free-text'),
      );
  const activeBorderColor = canStyleSelectedTextBox
    ? getAnnotationBorderColor(selectedAnnotation)
    : normalizeAnnotationPaintColor(
        annotationBorderColor,
        getDefaultAnnotationBorderColor('free-text'),
      );
  const activeStrokeWidth = isPenAnnotation(selectedAnnotation)
    ? getAnnotationStrokeWidth(selectedAnnotation)
    : normalizePenStrokeWidth(annotationStrokeWidth);
  const activeEraserSize = normalizeEraserSize(eraserSize);
  const activeHighlightBrushSize = selectedHighlightAnnotation
    ? getAnnotationStrokeWidth(selectedHighlightAnnotation)
    : normalizeHighlightBrushSize(highlightBrushSize);
  const activeHighlightOpacity = selectedHighlightAnnotation
    ? getAnnotationOpacity(selectedHighlightAnnotation)
    : normalizeHighlightOpacity(highlightOpacity);

  const handleUploadSignature = async () => {
    const selectedPath = await open({
      fileAccessMode: 'scoped',
      filters: imageFilters,
      multiple: false,
      title: 'Choose Image',
    });

    if (typeof selectedPath !== 'string') {
      return;
    }

    await startAccessingSecurityScopedResource(selectedPath);

    try {
      const bytes = await readFile(selectedPath);
      const mimeType = getMimeType(selectedPath);

      onSetSignatureImage({
        bytes: Array.from(bytes),
        dataUrl: bytesToDataUrl(bytes, mimeType),
        mimeType,
      });
    } finally {
      await stopAccessingSecurityScopedResource(selectedPath).catch(() => undefined);
    }
  };

  const handleChangeColor = (color: string) => {
    const nextColor = normalizeAnnotationColor(color, activeColor);

    onChangeAnnotationColor(nextColor);

    if (canColorSelectedAnnotation) {
      onChangeSelectedAnnotationColor(selectedAnnotation.id, nextColor);
    }
  };

  const handleChangeFillColor = (color: string) => {
    const nextColor = normalizeAnnotationPaintColor(color, activeFillColor);

    onChangeAnnotationFillColor(nextColor);

    if (canStyleSelectedTextBox) {
      onChangeSelectedAnnotationFillColor(selectedAnnotation.id, nextColor);
    }
  };

  const handleChangeBorderColor = (color: string) => {
    const nextColor = normalizeAnnotationPaintColor(color, activeBorderColor);

    onChangeAnnotationBorderColor(nextColor);

    if (canStyleSelectedTextBox) {
      onChangeSelectedAnnotationBorderColor(selectedAnnotation.id, nextColor);
    }
  };

  const handleChangeStrokeWidth = (strokeWidth: number) => {
    const nextStrokeWidth = normalizePenStrokeWidth(strokeWidth);

    onChangeAnnotationStrokeWidth(nextStrokeWidth);

    if (isPenAnnotation(selectedAnnotation)) {
      onChangeSelectedAnnotationStrokeWidth(selectedAnnotation.id, nextStrokeWidth);
    }
  };

  const handleChangeHighlightBrushSize = (brushSize: number) => {
    const nextBrushSize = normalizeHighlightBrushSize(brushSize);

    onChangeHighlightBrushSize(nextBrushSize);

    if (selectedHighlightAnnotation) {
      onChangeSelectedAnnotationHighlightBrushSize(selectedHighlightAnnotation.id, nextBrushSize);
    }
  };

  const handleChangeHighlightOpacity = (opacity: number) => {
    const nextOpacity = normalizeHighlightOpacity(opacity);

    onChangeHighlightOpacity(nextOpacity);

    if (selectedHighlightAnnotation) {
      onChangeSelectedAnnotationOpacity(selectedHighlightAnnotation.id, nextOpacity);
    }
  };

  return (
    <div className="tool-stack">
      <section className="tool-section">
        <h3>Color</h3>
        <div className="annotation-color-control">
          <label className="annotation-color-input">
            <span>{activeColorLabel}</span>
            <input
              aria-label="Annotation color"
              onChange={(event) => handleChangeColor(event.target.value)}
              type="color"
              value={activeColor}
            />
          </label>
          <div className="annotation-color-swatches" role="group" aria-label="Annotation colors">
            {annotationColorPalette.map((color) => (
              <button
                aria-label={`Use ${color}`}
                aria-pressed={activeColor === color}
                className="annotation-color-swatch"
                key={color}
                onClick={() => handleChangeColor(color)}
                style={{ backgroundColor: color }}
                title={color}
                type="button"
              />
            ))}
          </div>
          {selectedAnnotation && !canColorSelectedAnnotation ? (
            <p className="tool-empty-copy">Images and signatures keep their original colors.</p>
          ) : null}
        </div>
      </section>

      {canStyleHighlight ? (
        <section className="tool-section">
          <h3>Highlighter</h3>
          <label className="annotation-range-control">
            <span>
              <span>{selectedHighlightAnnotation ? 'Selected brush size' : 'New brush size'}</span>
              <strong>{activeHighlightBrushSize}px</strong>
            </span>
            <input
              aria-label="Highlighter brush size"
              max={maxHighlightBrushSize}
              min={minHighlightBrushSize}
              onChange={(event) => handleChangeHighlightBrushSize(event.target.valueAsNumber)}
              step={1}
              type="range"
              value={activeHighlightBrushSize}
            />
          </label>
          <label className="annotation-range-control">
            <span>
              <span>{selectedHighlightAnnotation ? 'Selected opacity' : 'New opacity'}</span>
              <strong>{Math.round(activeHighlightOpacity * 100)}%</strong>
            </span>
            <input
              aria-label="Highlighter opacity"
              max={maxHighlightOpacity}
              min={minHighlightOpacity}
              onChange={(event) => handleChangeHighlightOpacity(event.target.valueAsNumber)}
              step={0.01}
              type="range"
              value={activeHighlightOpacity}
            />
          </label>
        </section>
      ) : null}

      {canStylePen ? (
        <section className="tool-section">
          <h3>Pen</h3>
          <label className="annotation-range-control">
            <span>
              <span>
                {isPenAnnotation(selectedAnnotation) ? 'Selected thickness' : 'New thickness'}
              </span>
              <strong>{activeStrokeWidth}px</strong>
            </span>
            <input
              aria-label="Freehand pen thickness"
              max={maxPenStrokeWidth}
              min={minPenStrokeWidth}
              onChange={(event) => handleChangeStrokeWidth(event.target.valueAsNumber)}
              step={1}
              type="range"
              value={activeStrokeWidth}
            />
          </label>
          <div className="annotation-segmented-control">
            <span>Sensitivity</span>
            <div role="group" aria-label="Freehand sensitivity">
              {freehandSensitivityOptions.map((option) => (
                <button
                  aria-pressed={freehandSensitivity === option.id}
                  key={option.id}
                  onClick={() => onChangeFreehandSensitivity(option.id)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {canStyleEraser ? (
        <section className="tool-section">
          <h3>Eraser</h3>
          <label className="annotation-range-control">
            <span>
              <span>Size</span>
              <strong>{activeEraserSize}px</strong>
            </span>
            <input
              aria-label="Freehand eraser size"
              max={maxEraserSize}
              min={minEraserSize}
              onChange={(event) => onChangeEraserSize(event.target.valueAsNumber)}
              step={1}
              type="range"
              value={activeEraserSize}
            />
          </label>
        </section>
      ) : null}

      <section className="tool-section">
        <h3>Text box</h3>
        <div className="annotation-color-control">
          <label className="annotation-color-input">
            <span>{canStyleSelectedTextBox ? 'Selected fill' : 'New fill'}</span>
            <input
              aria-label="Text box fill color"
              onChange={(event) => handleChangeFillColor(event.target.value)}
              type="color"
              value={getColorInputValue(
                activeFillColor,
                getDefaultAnnotationFillColor('free-text'),
              )}
            />
          </label>
          <div className="annotation-color-swatches" role="group" aria-label="Text box fill colors">
            {annotationColorPalette.map((color) => (
              <button
                aria-label={`Use fill ${color}`}
                aria-pressed={activeFillColor === color}
                className="annotation-color-swatch"
                key={`fill-${color}`}
                onClick={() => handleChangeFillColor(color)}
                style={{ backgroundColor: color }}
                title={color}
                type="button"
              />
            ))}
            <button
              aria-label="Use transparent fill"
              aria-pressed={isTransparentAnnotationColor(activeFillColor)}
              className="annotation-color-swatch annotation-transparent-swatch"
              onClick={() => handleChangeFillColor(transparentAnnotationColor)}
              title="Transparent"
              type="button"
            />
          </div>
          <label className="annotation-color-input">
            <span>{canStyleSelectedTextBox ? 'Selected border' : 'New border'}</span>
            <input
              aria-label="Text box border color"
              onChange={(event) => handleChangeBorderColor(event.target.value)}
              type="color"
              value={getColorInputValue(
                activeBorderColor,
                getDefaultAnnotationBorderColor('free-text'),
              )}
            />
          </label>
          <div
            className="annotation-color-swatches"
            role="group"
            aria-label="Text box border colors"
          >
            {annotationColorPalette.map((color) => (
              <button
                aria-label={`Use border ${color}`}
                aria-pressed={activeBorderColor === color}
                className="annotation-color-swatch"
                key={`border-${color}`}
                onClick={() => handleChangeBorderColor(color)}
                style={{ backgroundColor: color }}
                title={color}
                type="button"
              />
            ))}
            <button
              aria-label="Use transparent border"
              aria-pressed={isTransparentAnnotationColor(activeBorderColor)}
              className="annotation-color-swatch annotation-transparent-swatch"
              onClick={() => handleChangeBorderColor(transparentAnnotationColor)}
              title="Transparent"
              type="button"
            />
          </div>
        </div>
      </section>

      {canStyleSelectedTextBox ? (
        <section className="tool-section">
          <h3>Font</h3>
          {selectedAnnotation.sourceFontLabel ? (
            <p className="annotation-font-detected">
              Document font: <strong>{selectedAnnotation.sourceFontLabel}</strong>
            </p>
          ) : null}
          <label className="formatter-field">
            <span>Family</span>
            <select
              aria-label="Annotation font family"
              onChange={(event) =>
                onChangeSelectedAnnotationFont(selectedAnnotation.id, {
                  fontId: event.target.value,
                })
              }
              value={selectedAnnotation.fontId ?? defaultAnnotationFontId}
            >
              {annotationFontFamilies.map((fontOption) => (
                <option key={fontOption.id} value={fontOption.id}>
                  {fontOption.detail
                    ? `${fontOption.label} — ${fontOption.detail}`
                    : fontOption.label}
                </option>
              ))}
            </select>
          </label>
          <div className="annotation-font-row">
            <label className="formatter-field annotation-font-size">
              <span>Size</span>
              <input
                aria-label="Annotation font size"
                max={maxAnnotationFontSize}
                min={minAnnotationFontSize}
                onChange={(event) =>
                  onChangeSelectedAnnotationFont(selectedAnnotation.id, {
                    fontSize: normalizeAnnotationFontSize(event.target.valueAsNumber),
                  })
                }
                step={0.5}
                type="number"
                value={selectedAnnotation.fontSize ?? 12}
              />
            </label>
            <div aria-label="Font style" className="annotation-font-toggles" role="group">
              <button
                aria-label="Bold"
                aria-pressed={Boolean(selectedAnnotation.fontBold)}
                className="viewer-icon-button"
                data-tooltip="Bold"
                onClick={() =>
                  onChangeSelectedAnnotationFont(selectedAnnotation.id, {
                    fontBold: !selectedAnnotation.fontBold,
                  })
                }
                type="button"
              >
                <Bold size={14} />
              </button>
              <button
                aria-label="Italic"
                aria-pressed={Boolean(selectedAnnotation.fontItalic)}
                className="viewer-icon-button"
                data-tooltip="Italic"
                onClick={() =>
                  onChangeSelectedAnnotationFont(selectedAnnotation.id, {
                    fontItalic: !selectedAnnotation.fontItalic,
                  })
                }
                type="button"
              >
                <Italic size={14} />
              </button>
            </div>
          </div>
          {selectedAnnotation.embeddedFontName ? (
            <p className="tool-empty-copy">
              Shown in the document's own embedded font. Choosing a family switches to that font for
              both display and export.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="tool-section">
        <h3>Annotations</h3>
        <div className="formatter-button-row">
          <button
            className="secondary-action-button"
            disabled={!workspace}
            onClick={handleUploadSignature}
            type="button"
          >
            <ImagePlus size={15} />
            <span>{signatureImage ? 'Replace image' : 'Upload image'}</span>
          </button>
          <button
            className="secondary-action-button destructive"
            disabled={!selectedAnnotationId}
            onClick={() => selectedAnnotationId && onDeleteAnnotation(selectedAnnotationId)}
            type="button"
          >
            <Trash2 size={15} />
            <span>Delete</span>
          </button>
          <button
            className="secondary-action-button"
            disabled={!canCopySelectedFreehandAnnotation}
            onClick={onCopySelectedFreehandAnnotation}
            type="button"
          >
            <Copy size={15} />
            <span>Copy</span>
          </button>
          <button
            className="secondary-action-button"
            disabled={!canPasteFreehandAnnotation}
            onClick={onPasteFreehandAnnotation}
            type="button"
          >
            <ClipboardPaste size={15} />
            <span>Paste</span>
          </button>
        </div>
      </section>

      <section className="tool-section">
        <h3>Workspace</h3>
        <p className="tool-empty-copy">
          {annotationCount} {annotationCount === 1 ? 'annotation' : 'annotations'} stored as
          exportable overlays. Upload an image, choose the Image tool, then click the page to place
          it.
        </p>
      </section>
    </div>
  );
}
