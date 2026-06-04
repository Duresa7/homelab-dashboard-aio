/// <reference types="vite/client" />

// Side-effect-only CSS packages (self-hosted variable fonts). They ship no type
// declarations; TypeScript 6 flags unchecked side-effect imports without them.
declare module '@fontsource-variable/*';
