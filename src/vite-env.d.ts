/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PAPERDESK_TEXT_DEBUG?: string;
}

declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export * from 'pdfjs-dist';
}
