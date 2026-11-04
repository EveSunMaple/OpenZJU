/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_REPOSITORY_URL?: string;
  readonly SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
