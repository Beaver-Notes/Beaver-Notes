export class Transport {
  async pull() {
    throw new Error('Transport#pull not implemented');
  }

  async push(_opts = {}) {
    throw new Error('Transport#push not implemented');
  }

  async seedOnce() {
    // default no-op
  }

  async compact() {
    // default no-op
  }
}
