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
