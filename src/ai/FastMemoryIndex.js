function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class FastMemoryIndex {
  constructor(maxSize = 5000) {
    this.maxSize = maxSize;
    this.store = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(userId) {
    const key = String(userId);
    const value = this.store.get(key);
    if (!value) {
      this.misses += 1;
      return null;
    }

    this.hits += 1;
    this.store.delete(key);
    this.store.set(key, value);
    return clone(value);
  }

  set(userId, value) {
    const key = String(userId);
    if (this.store.has(key)) {
      this.store.delete(key);
    }
    this.store.set(key, clone(value));

    if (this.store.size > this.maxSize) {
      const oldestKey = this.store.keys().next().value;
      this.store.delete(oldestKey);
    }
  }

  delete(userId) {
    this.store.delete(String(userId));
  }

  stats() {
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses
    };
  }
}
