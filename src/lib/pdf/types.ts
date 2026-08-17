export type PdfDocumentId = string;
export type PdfPageId = string;
export type PdfWorkspaceId = string;
export type PdfAnnotationId = string;
export type PdfRotation = 0 | 90 | 180 | 270;
export type PdfRotationDirection = 'clockwise' | 'counterclockwise';
export type PdfAnnotationTool =
  | 'select'
  | 'highlight'
  | 'edit-text'
  | 'text-note'
  | 'free-text'
  | 'pen'
  | 'eraser'
  | 'rectangle'
  | 'signature'
  | 'image';
export type PdfPageNumberPosition = 'bottom-center' | 'bottom-right' | 'bottom-left';
export type PdfFormatterApplyScope = 'all' | 'selected';
export type PdfResizePageSize =
  | 'keep-original'
  | 'a4-portrait'
  | 'a4-landscape'
  | 'letter-portrait'
  | 'letter-landscape';
export type PdfFormatterFont =
  | 'helvetica'
  | 'times-roman'
  | 'courier'
  | 'liberation-sans'
  | 'liberation-serif'
  | 'liberation-mono'
  | 'carlito'
  | 'caladea';
export type PdfFormFieldType =
  | 'text'
  | 'checkbox'
  | 'radio'
  | 'dropdown'
  | 'option-list'
  | 'button'
  | 'signature'
  | 'unknown';
export type PdfFormFieldValue = string | boolean | string[];
export type PdfFormFieldValuesByName = Record<string, PdfFormFieldValue>;
export type PdfFormFieldValuesByDocument = Record<PdfDocumentId, PdfFormFieldValuesByName>;

export type PdfFormField = {
  id: string;
  name: string;
  type: PdfFormFieldType;
  value: PdfFormFieldValue;
  multiline?: boolean;
  options?: string[];
  pageNumbers?: number[];
  supported: boolean;
};

export type PdfFormSettings = {
  flattenOnExport: boolean;
};

export type PdfDocumentSource = {
  id: PdfDocumentId;
  fileName: string;
  filePath?: string;
  bytes: Uint8Array;
  pageCount: number;
  loadedAt: string;
  formFields?: PdfFormField[];
  security?: {
    wasEncrypted: true;
  };
};

export type DocumentModel = PdfDocumentSource;

export type PdfCropMargins = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export type FormatterSettings = {
  applyScope: PdfFormatterApplyScope;
  coverDate: string;
  coverSubtitle: string;
  coverTitle: string;
  cropMargins: PdfCropMargins;
  footerText: string;
  fontFamily: PdfFormatterFont;
  headerText: string;
  pageNumberPosition: PdfPageNumberPosition;
  pageNumbersEnabled: boolean;
  resizePageSize: PdfResizePageSize;
  startNumber: number;
  watermarkOpacity: number;
  watermarkText: string;
};

export type BasePdfPageItem = {
  id: PdfPageId;
  displayIndex: number;
  rotation: PdfRotation;
  deleted: boolean;
  thumbnailDataUrl?: string;
  width?: number;
  height?: number;
};

export type SourcePdfPageItem = BasePdfPageItem & {
  kind?: 'source';
  sourceDocumentId: PdfDocumentId;
  sourceFileName: string;
  sourcePageIndex: number;
};

export type GeneratedPageItem = BasePdfPageItem & {
  kind: 'generated';
  generatedPageType: 'blank' | 'cover';
  coverDate?: string;
  coverSubtitle?: string;
  coverTitle?: string;
};

export type PdfPageItem = SourcePdfPageItem | GeneratedPageItem;

export type PdfFormatterSettings = FormatterSettings & {
  zoom: number;
  fitMode: 'page' | 'width' | 'actual-size';
};

export type PdfAnnotationPoint = {
  x: number;
  y: number;
};

export type PdfAnnotationType =
  | 'highlight'
  | 'text-edit'
  | 'text-note'
  | 'free-text'
  | 'pen'
  | 'rectangle'
  | 'signature'
  | 'image';

export type PdfAnnotation = {
  id: PdfAnnotationId;
  pageItemId: PdfPageId;
  type: PdfAnnotationType;
  x: number;
  y: number;
  width: number;
  height: number;
  // Degrees, clockwise in display space, rotating the rect about its (x, y)
  // corner. Set on highlights snapped to rotated embedded text.
  rotation?: number;
  color?: string;
  fillColor?: string;
  borderColor?: string;
  content?: string;
  fontId?: string;
  fontSize?: number;
  fontBold?: boolean;
  fontItalic?: boolean;
  lineHeight?: number;
  embeddedFontName?: string;
  sourceFontLabel?: string;
  linkedCommentId?: PdfAnnotationId;
  points?: PdfAnnotationPoint[];
  strokeWidth?: number;
  // 0-1. Ink transparency for freehand highlighter strokes.
  opacity?: number;
  imageBytes?: number[];
  imageDataUrl?: string;
  imageMimeType?: 'image/png' | 'image/jpeg';
  createdAt: string;
};

export type PdfAnnotationEraseSegment = Pick<
  PdfAnnotation,
  'height' | 'points' | 'width' | 'x' | 'y'
>;

export type PdfAnnotationEraseReplacement = {
  originalAnnotation: PdfAnnotation;
  segments: PdfAnnotationEraseSegment[];
};

export type PdfAnnotationPasteTarget = {
  pageItemId: PdfPageId;
  point: PdfAnnotationPoint;
};

export type PdfWorkspace = {
  id: PdfWorkspaceId;
  name: string;
  documents: PdfDocumentSource[];
  pages: PdfPageItem[];
  selectedPageIds: PdfPageId[];
  activePageId?: PdfPageId;
  formatterSettings: PdfFormatterSettings;
  formFieldValues: PdfFormFieldValuesByDocument;
  formSettings: PdfFormSettings;
  annotations: PdfAnnotation[];
};
