export type FeatureGuideScreenshot = {
  alt: string;
  caption: string;
  imageSrc?: string;
  label: string;
};

export type FeatureGuideShortcut = {
  action: string;
  keystroke: string;
};

export type FeatureGuideSection = {
  id: string;
  title: string;
  summary: string;
  steps: string[];
  shortcuts?: FeatureGuideShortcut[];
  tips: string[];
  screenshots: FeatureGuideScreenshot[];
};

export const featureGuideSections: FeatureGuideSection[] = [
  {
    id: 'workspace',
    title: 'Workspace',
    summary: 'Open PDFs, add files to a workspace, and keep separate jobs organized in tabs.',
    steps: [
      'Open one or more PDFs from the top toolbar.',
      'Use tabs to switch between active workspaces.',
      'Drop more PDFs into the app when you want to add or open another workspace.',
    ],
    tips: [
      'Recent files and autosave can be managed in Settings.',
      'If a recovered source file is missing, relink it from the recovery prompt.',
    ],
    screenshots: [
      {
        alt: 'Paperdesk empty workspace with open PDF controls',
        caption: 'Opening the first PDF starts a local workspace.',
        label: 'Open PDF',
      },
      {
        alt: 'Paperdesk workspace tabs with multiple documents',
        caption: 'Tabs keep separate PDF jobs in one window.',
        label: 'Tabs',
      },
      {
        alt: 'Paperdesk import dialog for choosing where PDFs open',
        caption: 'Choose whether dropped PDFs join a workspace or open separately.',
        label: 'Import routing',
      },
    ],
  },
  {
    id: 'pages',
    title: 'Pages',
    summary:
      'Scan, bookmark, reorder, delete, rotate, and navigate document pages from the viewer.',
    steps: [
      'Use the left thumbnail sidebar to select pages.',
      'Open Page overview beside the page controls to scan the active PDF in a scrollable four-column thumbnail grid.',
      'Bookmark the active page from the viewer toolbar, then open Bookmarks in the sidebar to jump back to it.',
      'Drag thumbnails to reorder pages before export.',
      'Rotate or delete selected pages from the sidebar or viewer toolbar.',
    ],
    tips: [
      'The page number field jumps directly to a page.',
      'Bookmarked thumbnails show a filled Saved badge in Page overview, where bookmarks can also be toggled.',
      'Bookmarks are saved with workspace autosave and follow pages when they are reordered.',
      'Undo is available for major page edits.',
    ],
    screenshots: [
      {
        alt: 'Paperdesk thumbnail sidebar with selected pages',
        caption: 'The thumbnail sidebar is the main page management surface.',
        label: 'Selection',
      },
      {
        alt: 'Paperdesk drag reorder state in the thumbnail list',
        caption: 'Drag selected thumbnails to arrange the export order.',
        label: 'Reorder',
      },
      {
        alt: 'Paperdesk page rotation controls',
        caption: 'Rotation tools apply to selected pages.',
        label: 'Rotate',
      },
    ],
  },
  {
    id: 'formatting',
    title: 'Formatting',
    summary: 'Add page numbers, headers, footers, watermarks, cover pages, and crop settings.',
    steps: [
      'Open the Formatter panel from the right tool rail.',
      'Choose whether formatting applies to all pages or selected pages.',
      'Preview formatting in the viewer before exporting.',
    ],
    tips: [
      'Inserted blank and cover pages become part of the workspace.',
      'Resize and crop settings are applied during export.',
    ],
    screenshots: [
      {
        alt: 'Paperdesk Formatter panel with page number settings',
        caption: 'Page numbering and text overlays live in Formatter.',
        label: 'Page numbers',
      },
      {
        alt: 'Paperdesk watermark controls in the Formatter panel',
        caption: 'Watermarks can be tuned before export.',
        label: 'Watermark',
      },
      {
        alt: 'Paperdesk insert page controls for blank and cover pages',
        caption: 'Insert blank or cover pages without leaving the workspace.',
        label: 'Insert pages',
      },
    ],
  },
  {
    id: 'forms',
    title: 'Forms',
    summary:
      'Fill PDF form fields directly on the page, import JSON form data, and flatten forms on export.',
    steps: [
      'Open a PDF that contains supported AcroForm fields.',
      'Click a highlighted field on the page to type, toggle, or pick a value in place.',
      'Use the Forms panel to review all values, or import and export them as JSON.',
      'Choose whether fields should remain editable or flatten into the exported PDF.',
    ],
    tips: [
      'On-page edits and Forms panel edits stay in sync automatically.',
      'Unsupported field types are preserved where possible.',
      'Imported JSON should match the field names shown in the Forms panel.',
    ],
    screenshots: [
      {
        alt: 'Paperdesk Forms panel with detected PDF fields',
        caption: 'Detected fields appear with their current values.',
        label: 'Detected fields',
      },
      {
        alt: 'Paperdesk form import controls',
        caption: 'Import prepared field values from JSON.',
        label: 'Import data',
      },
      {
        alt: 'Paperdesk form flatten option',
        caption: 'Flatten fields when the final PDF should not be editable.',
        label: 'Flatten',
      },
    ],
  },
  {
    id: 'annotations',
    title: 'Annotations',
    summary: 'Add exportable comments, text boxes, highlights, shapes, pen marks, and signatures.',
    steps: [
      'Enable Annotate mode in the viewer toolbar.',
      'Pick an annotation tool and place it on the active page.',
      'Edit colors and selected annotation properties from the Annotations panel.',
    ],
    tips: [
      'For comments, select text and right-click the selection.',
      'Double-click a word with the highlight tool to highlight just that word.',
      'Press Shift+Enter or Ctrl/Cmd+Enter to finish editing a text box.',
      'Upload a signature image before using the signature tool.',
    ],
    screenshots: [
      {
        alt: 'Paperdesk annotation toolbar with tools visible',
        caption: 'Annotate mode reveals the tool strip.',
        label: 'Tool strip',
      },
      {
        alt: 'Paperdesk text highlight and comment on a PDF page',
        caption: 'Highlights and comments export with the final PDF.',
        label: 'Comments',
      },
      {
        alt: 'Paperdesk annotation color controls',
        caption: 'Use the Annotations panel to adjust selected annotation styling.',
        label: 'Styling',
      },
    ],
  },
  {
    id: 'shortcuts',
    title: 'Shortcuts',
    summary:
      'Use keyboard shortcuts for repeated open, export, navigation, undo, and delete actions.',
    steps: [],
    shortcuts: [
      {
        action: 'Open PDFs',
        keystroke: 'Ctrl/Cmd + O',
      },
      {
        action: 'Export the current workspace',
        keystroke: 'Ctrl/Cmd + S',
      },
      {
        action: 'Open document search',
        keystroke: 'Ctrl/Cmd + F',
      },
      {
        action: 'Redo the last workspace edit',
        keystroke: 'Ctrl/Cmd + Shift + Z',
      },
      {
        action: 'Remove selected pages or annotations',
        keystroke: 'Delete / Backspace',
      },
    ],
    tips: [
      'Keyboard shortcuts follow the same action availability as the toolbar buttons.',
      'Delete and Backspace act on the current page or annotation selection.',
    ],
    screenshots: [],
  },
];
