export function bytesToHex(buf) {
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    b[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return b;
}
