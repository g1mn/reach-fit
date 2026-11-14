/// <reference types="vite/client" />
/// <reference types="@iwsdk/vite-plugin-dev/client" />

interface ImportMetaEnv {
  /** '1' only for the frame-stepped capture build (capture/run-*.sh). */
  readonly VITE_CAPTURE?: string;
}
