/// <reference types="vite/client" />

/** Markdown imported as a string, so docs/ stays the single source of truth. */
declare module '*.md?raw' {
  const content: string;
  export default content;
}
