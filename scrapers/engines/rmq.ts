import * as rmq from 'amqplib';
import * as _ from 'lodash';
import { IScrapeEngine, IScrapeEngineConsumer } from "../engine";
import { IScrapeRequest } from '../request';
import { ScrapeObjectProvider, IProviderRepository } from '../provider';
import { newAjv2 } from '../../utils/ajv2';
import { RMQRPC } from '../../utils/rmq_rpc';

const ajv2 = newAjv2();

export class RMQEngine implements IScrapeEngine {

    constructor(
        private channel: rmq.Channel,
        private listentQueue: string,
        private listenOpts?: rmq.Options.Consume,
        private assertOpts?: rmq.Options.AssertQueue
    ) { }

    async init(): Promise<void> {
        await this.channel.assertQueue(this.listentQueue, this.assertOpts);
    }

    async consume(consumer: IScrapeEngineConsumer): Promise<any> {
        return await this.channel.consume(this.listentQueue, (msg) => {
            const req: IScrapeRequest = {
                id: msg.fields.deliveryTag,
                data: msg.content && JSON.parse(msg.content.toString()),
                meta: { msg: msg }
            };

            consumer(req);
        }, this.listenOpts);
    }

    ack(req: IScrapeRequest): Promise<any> {
        this.channel.ack(req.meta.msg);
        return Promise.resolve();
    }

    async response(req: IScrapeRequest, resp: any): Promise<void> {
        const msg: rmq.Message = req.meta && req.meta.msg;
        if (msg && msg.properties && msg.properties.replyTo) {
            const respBuffer = (_.isBuffer(resp) || _.isString(resp)) ? Buffer.from(resp) : Buffer.from(JSON.stringify(resp));
            await this.channel.sendToQueue(msg.properties.replyTo, respBuffer);
        }
    }
}

export class RMQEngineProvider extends ScrapeObjectProvider {
    readonly type = "ENGINE";
    readonly name: string = "rmq";
    private configValidator = ajv2({
        '@connection': 'string',
        '+@queue': 'string',
        'listenOpts': {},
        'assertopts': {}
    });

    init(): Promise<any> {
        return Promise.resolve();
    }

    assertConfig(config: any): void {
        if (!this.configValidator(config)) throw new Error(this.configValidator.errors.map(e => e.message).join('\n'));
    }

    async make(repo: IProviderRepository, config: any): Promise<IScrapeEngine> {
        config.connection = config.connection || 'amqp://localhost';
        const rmqConn = await rmq.connect(config.connection);
        const channel = await rmqConn.createChannel();

        return new RMQEngine(channel, config.queue, config.listenOpts, config.assertOpts);
    }
}

export const provider = new RMQEngineProvider();
export default provider;