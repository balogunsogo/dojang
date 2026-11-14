let cached: boolean | null = null;

/**
 * Can this browser create a WebGL context? Checked once and cached: every
 * check creates a context, and browsers drop the OLDEST live context when
 * too many exist, which is the game's own canvas. The test context is
 * released at once.
 */
export function webglAvailable(): boolean {
  if (cached !== null) return cached;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    cached = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    cached = false;
  }
  return cached;
}
