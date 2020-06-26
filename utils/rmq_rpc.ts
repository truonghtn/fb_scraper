import * as rmq from 'amqplib';
import * as uuid from 'uuid/v1';

interface IRPCInfo {
  resolve: Function;

  corr: string;
  timer: NodeJS.Timer;
}

export type RMQRPCPublishOptions = rmq.Options.Publish & { timeout?: number };

export class RMQRPC {
  private initialized = false;
  private rpcs: Map<string, IRPCInfo> = new Map();
  public defaultTimeout = 50000000;

  constructor(
    private channel: rmq.Channel,
    private replyQueue: string,
    private consumerOtps?: rmq.Options.Consume
  ) { }

  public async init() {
    await this.channel.assertQueue(this.replyQueue);
    await this.channel.consume(this.replyQueue, async (msg) => {
      const rpc = this.rpcs.get(msg.properties.correlationId);
      if (!rpc) return;

      rpc.timer && clearTimeout(rpc.timer);
      this.rpcs.delete(rpc.corr);

      await this.channel.ack(msg);
      rpc.resolve(msg);
    }, this.consumerOtps);
    this.initialized = true;
  }

  public async send(queue: string, content: Buffer, opts?: RMQRPCPublishOptions) {
    if (!this.initialized) {
      await this.init();
    }
    return await new Promise<rmq.Message>((res, rej) => {
      const corr = uuid();
      const rpc: IRPCInfo = {
        resolve: res,
        corr: corr,
        timer: null
      }

      opts = opts || {};
      opts.correlationId = rpc.corr;
      opts.replyTo = this.replyQueue;

      const timeout = opts.timeout || this.defaultTimeout;
      rpc.timer = setTimeout(() => {
        this.rpcs.delete(corr);
        rej(new Error(`RMQRPC timed-out! Correlation id: ${corr}`));
      }, timeout);

      this.rpcs.set(rpc.corr, rpc);
      console.log(`Sending content ${content.toString()} into queue ${queue}`);
      this.channel.sendToQueue(queue, content, opts);
    });
  }

  static async response(ch: rmq.Channel, msg: rmq.Message, resp?: Buffer) {
    if (msg.properties.replyTo && msg.properties.correlationId) {
      await ch.sendToQueue(msg.properties.replyTo, resp, { correlationId: msg.properties.correlationId });
    }
  }
}