# Exporting PDFs

Use Export PDF from the top toolbar to save the workspace as a new local PDF.

## Full Workspace Export

Full export includes:

- Current page order.
- Deleted-page exclusions.
- Page rotations.
- Formatter overlays.
- Filled form values.
- Exportable annotations.

## Selected Pages

When pages are selected, you can export selected pages from the export modal. This is useful for extracting only part of a document.

## Page Ranges

Use page ranges to split or export specific sections. Ranges are based on the current visible workspace order, not the original source PDF order.

## Source Safety

Paperdesk does not modify original PDFs during normal editing. If you choose an export path that points to an original source PDF, Paperdesk asks for confirmation before overwriting.

## Platform Builds

Builds are created per platform:

- macOS `.dmg` builds are produced on macOS.
- Windows `.exe` or `.msi` builds are produced on Windows.

Run:

```bash
npm run build
```

Output installers are placed under:

```text
src-tauri/target/release/bundle/
```
