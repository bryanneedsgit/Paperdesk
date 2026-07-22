# In-App Feature Guide

Edit `guideContent.ts` to change the guide sections shown in Paperdesk.

Each section supports:

- `title`: sidebar and detail heading.
- `summary`: short section description.
- `steps`: ordered workflow bullets.
- `shortcuts`: optional literal keystrokes for shortcut-focused guide sections.
- `tips`: supporting notes.
- `screenshots`: carousel slides. Use an empty array for sections that should not show a carousel.

For screenshot slides, keep `label`, `caption`, and `alt`. Add `imageSrc` when a screenshot is ready. Recommended paths are under `public/guide/`, for example:

```ts
{
  label: 'Open PDF',
  caption: 'Opening the first PDF starts a local workspace.',
  alt: 'Paperdesk empty workspace with open PDF controls',
  imageSrc: '/guide/workspace-open.png',
}
```

If `imageSrc` is omitted, the app shows a neutral placeholder in the carousel. If `screenshots`
is empty, that guide section renders without a carousel.

For shortcut sections, add literal keystrokes like this:

```ts
shortcuts: [
  {
    action: 'Open PDFs',
    keystroke: 'Ctrl/Cmd + O',
  },
];
```
