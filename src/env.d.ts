/// <reference types="astro/client" />
/// <reference types="vite/client" />

declare interface ImportMeta {
  readonly env: Record<string, string | undefined>;
}
