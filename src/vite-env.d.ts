/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME: string;
  readonly VITE_COMPANY_NAME: string;
  readonly VITE_DB_NAME: string;
  readonly VITE_STORAGE_MODE: 'local';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
