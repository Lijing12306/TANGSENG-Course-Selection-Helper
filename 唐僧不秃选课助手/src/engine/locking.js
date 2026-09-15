export class KeyedLock {
  constructor() { this.inflight = new Map(); }

  async run(key, fn) {
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = (async () => {
      try { return await fn(); } finally { this.inflight.delete(key); }
    })();
    this.inflight.set(key, p);
    return p;
  }

  isBusy(key) { return this.inflight.has(key); }

  size() { return this.inflight.size; }
}

export class Dedupe {
  constructor(windowMs = 10000) {
    this.windowMs = windowMs;
    this.seen = new Map();
  }

  check(key) {
    const now = Date.now();
    for (const [k, t] of this.seen) if (now - t > this.windowMs * 4) this.seen.delete(k);
    const last = this.seen.get(key);
    if (last && now - last < this.windowMs) return false;
    this.seen.set(key, now);
    return true;
  }

  reset(key) { if (key) this.seen.delete(key); else this.seen.clear(); }
}
