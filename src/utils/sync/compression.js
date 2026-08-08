/**
 * Gzip compression utilities for sync payloads.
 *
 * Uses the browser's CompressionStream API (available in all modern browsers
 * and Tauri's webview) for compression/decompression. Falls back to no-op
 * if CompressionStream is unavailable.
 */

const hasCompressionStream = typeof CompressionStream !== 'undefined';
const hasDecompressionStream = typeof DecompressionStream !== 'undefined';

/**
 * Compress data using gzip.
 * @param {string|Uint8Array} data
 * @returns {Promise<Uint8Array>} compressed data
 */
export async function compress(data) {
  if (!hasCompressionStream) return data;

  const input = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : data;

  const stream = new Response(input).body.pipeThrough(
    new CompressionStream('gzip')
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Decompress gzip data.
 * @param {Uint8Array} data
 * @returns {Promise<Uint8Array>} decompressed data
 */
export async function decompress(data) {
  if (!hasDecompressionStream) return data;

  const stream = new Response(data).body.pipeThrough(
    new DecompressionStream('gzip')
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Compress a base64 string to gzip binary.
 * @param {string} base64Data
 * @returns {Promise<Uint8Array>} compressed binary
 */
export async function compressBase64(base64Data) {
  return compress(base64Data);
}

/**
 * Decompress gzip binary to a string.
 * @param {Uint8Array} compressed
 * @returns {Promise<string>} decompressed string
 */
export async function decompressToString(compressed) {
  const result = await decompress(compressed);
  return new TextDecoder().decode(result);
}
