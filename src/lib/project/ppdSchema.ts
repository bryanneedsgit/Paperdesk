import { z } from 'zod';

const id = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !['__proto__', 'prototype', 'constructor'].includes(value));
const finite = z.number().finite();
const text = z.string();
const point = z.object({ x: finite, y: finite });
const pageBase = {
  id,
  displayIndex: z.number().int().nonnegative(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  deleted: z.boolean(),
  width: finite.positive().optional(),
  height: finite.positive().optional(),
};
const page = z.union([
  z.object({
    ...pageBase,
    kind: z.literal('source').optional(),
    sourceDocumentId: id,
    sourceFileName: text,
    sourcePageIndex: z.number().int().nonnegative(),
  }),
  z.object({
    ...pageBase,
    kind: z.literal('generated'),
    generatedPageType: z.enum(['blank', 'cover']),
    coverDate: text.optional(),
    coverSubtitle: text.optional(),
    coverTitle: text.optional(),
  }),
]);
const annotation = z.object({
  id,
  pageItemId: id,
  type: z.enum([
    'highlight',
    'text-edit',
    'text-note',
    'free-text',
    'pen',
    'rectangle',
    'signature',
    'image',
  ]),
  x: finite,
  y: finite,
  width: finite.nonnegative(),
  height: finite.nonnegative(),
  rotation: finite.optional(),
  color: text.optional(),
  fillColor: text.optional(),
  borderColor: text.optional(),
  content: text.optional(),
  fontId: text.optional(),
  fontSize: finite.positive().optional(),
  fontBold: z.boolean().optional(),
  fontItalic: z.boolean().optional(),
  lineHeight: finite.positive().optional(),
  embeddedFontName: text.optional(),
  sourceFontLabel: text.optional(),
  linkedCommentId: id.optional(),
  points: z.array(point).optional(),
  strokeWidth: finite.nonnegative().optional(),
  opacity: finite.min(0).max(1).optional(),
  imageBytes: z.array(z.number().int().min(0).max(255)).optional(),
  imageDataUrl: text.regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/).optional(),
  imageMimeType: z.enum(['image/png', 'image/jpeg']).optional(),
  createdAt: text,
});
const note = z.object({
  version: z.literal(1),
  blocks: z.array(
    z.object({
      type: z.enum(['paragraph', 'bullet', 'number']),
      runs: z.array(
        z.object({
          text,
          bold: z.boolean().optional(),
          italic: z.boolean().optional(),
          href: text.optional(),
        }),
      ),
    }),
  ),
});
export const ppdManifestSchema = z.object({
  format: z.literal('paperdesk'),
  version: z.literal(1),
  workspace: z.object({
    id,
    name: text,
    documents: z
      .array(
        z.object({
          id,
          fileName: text,
          pageCount: z.number().int().positive(),
          entry: text.regex(/^sources\/\d+\.pdf$/),
        }),
      )
      .max(1024),
    pages: z.array(page),
    bookmarkedPageIds: z.array(id),
    selectedPageIds: z.array(id),
    activePageId: id.optional(),
    annotations: z.array(annotation),
    pageNotes: z.record(id, note),
    formFieldValues: z.record(id, z.record(id, z.union([text, z.boolean(), z.array(text)]))),
    formSettings: z.object({ flattenOnExport: z.boolean() }),
    formatterSettings: z.object({
      applyScope: z.enum(['all', 'selected']),
      coverDate: text,
      coverSubtitle: text,
      coverTitle: text,
      cropMargins: z.object({
        bottom: finite.nonnegative(),
        left: finite.nonnegative(),
        right: finite.nonnegative(),
        top: finite.nonnegative(),
      }),
      footerText: text,
      fontFamily: z.enum([
        'helvetica',
        'times-roman',
        'courier',
        'liberation-sans',
        'liberation-serif',
        'liberation-mono',
        'carlito',
        'caladea',
      ]),
      headerText: text,
      pageNumberPosition: z.enum(['bottom-center', 'bottom-right', 'bottom-left']),
      pageNumbersEnabled: z.boolean(),
      resizePageSize: z.enum([
        'keep-original',
        'a4-portrait',
        'a4-landscape',
        'letter-portrait',
        'letter-landscape',
      ]),
      startNumber: z.number().int(),
      watermarkOpacity: finite.min(0).max(1),
      watermarkText: text,
      zoom: finite.positive(),
      fitMode: z.enum(['page', 'width', 'actual-size']),
    }),
  }),
});
export type PpdManifest = z.infer<typeof ppdManifestSchema>;
