/** Build identifier (commit), set in vite.config.ts. */
declare const __BUILD_ID__: string;

interface ImportMetaEnv {
  readonly VITE_NET_URL?: string;
  readonly VITE_ONLINE?: string;
}
