# Release Checklist

Use this checklist before publishing a Paperdesk build.

## Core Workflows

- [ ] Open PDF
- [ ] Merge multiple PDFs
- [ ] Delete pages after merge
- [ ] Rearrange pages after merge
- [ ] Rotate pages
- [ ] Export final PDF
- [ ] Form field read/fill
- [ ] Page numbers
- [ ] Header/footer
- [ ] Watermark
- [ ] Annotation export

## Platform Builds

- [ ] Mac build
- [ ] Signed Windows build
- [ ] Windows signing certificate configured (`PAPERDESK_SIGN_CERT_SHA1` or `PAPERDESK_SIGN_CERT_PATH`)
- [ ] Signed Windows installer built with `npm run build:windows:signed`
- [ ] Signed Windows installer verified with `signtool verify /pa /v <installer>`
- [ ] Unsigned Windows installers removed or clearly excluded from distribution

## Printing (macOS and Windows)

- [ ] Toolbar, File menu, and Ctrl/Cmd+P open one native dialog; duplicate requests are ignored.
- [ ] Current page, selected thumbnails, and custom ranges follow the edited document order.
- [ ] Range 2–7 + Odd prints 3, 5, 7; Reverse prints 7, 5, 3. Empty/invalid selections cannot submit.
- [ ] macOS preview refreshes when page selection, parity, order, or annotation inclusion changes.
- [ ] PDF output preserves filled forms, rotations, crops, numbering, generated pages, and the annotation toggle.
- [ ] Cancel, unavailable printer, and printer errors leave the workspace unchanged and allow another attempt.
- [ ] Physical printing and PDF-printer output: copies, collation, duplex, paper sizes/orientation, scaling, and large documents.
- [ ] Windows build and native dialog verified on Windows (not covered by macOS checks).

Native regression commands on macOS:

```sh
c++ -std=c++17 -Wall -Wextra -Werror src-tauri/native/print_selection_test.cpp -o /tmp/paperdesk-print-selection-test
/tmp/paperdesk-print-selection-test
c++ -std=c++17 -fobjc-arc -framework AppKit -framework PDFKit -framework CoreText src-tauri/native/print_mac_test.mm -o /tmp/paperdesk-print-mac-test
/tmp/paperdesk-print-mac-test
```

The rendering regression creates a uniquely named temporary PDF and removes it afterward; it never submits a printer job.
