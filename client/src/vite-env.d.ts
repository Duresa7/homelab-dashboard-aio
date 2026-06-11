declare module '@fontsource-variable/*';
declare module '*.css';

interface ImportMetaEnv {
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
