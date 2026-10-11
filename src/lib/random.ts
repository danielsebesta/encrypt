export function randomIndex(length: number): number {
  if (!Number.isSafeInteger(length) || length <= 0 || length > 0x100000000) throw new Error('Invalid range');
  const limit = Math.floor(0x100000000 / length) * length;
  const value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] >= limit);
  return value[0] % length;
}
