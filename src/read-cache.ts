export function createReadCache<T>(ttlMilliseconds: number, capacity: number) {
  const entries = new Map<string, { value: T; expiresAt: number }>();
  return {
    async read(key: string, load: () => Promise<T>): Promise<T> {
      const entry = entries.get(key);
      if (entry && entry.expiresAt > Date.now()) return entry.value;
      entries.delete(key);
      const value = await load();
      if (entries.size >= capacity) entries.delete(entries.keys().next().value!);
      entries.set(key, { value, expiresAt: Date.now() + ttlMilliseconds });
      return value;
    }
  };
}
