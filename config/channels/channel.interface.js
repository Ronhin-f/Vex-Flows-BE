export class Channel {
  constructor(opts = {}) { this.opts = opts; }
  async send(_msg) { throw new Error('send() not implemented'); }
}
