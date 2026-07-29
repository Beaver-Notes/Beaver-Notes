export function mergeCursorDelta(cursors, delta) {
  let changed = false;
  for (const [key, val] of Object.entries(delta)) {
    const prev = cursors[key];
    const prevTs = prev?.ts ?? 0;
    const prevSeq = prev?.seq ?? 0;
    if (val.ts > prevTs || (val.ts === prevTs && val.seq > prevSeq)) {
      cursors[key] = { ts: val.ts, seq: val.seq };
      changed = true;
    }
  }
  return changed;
}

export class Transport {
  async pull(_cursors) {
    throw new Error('Transport#pull not implemented');
  }

  async push(_cursors, _opts = {}) {
    throw new Error('Transport#push not implemented');
  }

  async seedOnce() {
    // default no-op
  }

  async compact() {
    // default no-op
  }
}
