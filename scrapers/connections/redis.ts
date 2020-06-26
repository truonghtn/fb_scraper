import { ScrapeObjectProvider, IProviderRepository } from "../provider";
import { RedisClient } from 'redis-ts';
import * as hasher from 'object-hash';
import * as _ from 'lodash';
import { newAjv2 } from "../../utils/ajv2";

const ajv2 = newAjv2();

export class RedisConnectionProvider extends ScrapeObjectProvider {
    readonly type = "REDIS";
    readonly name = "redis-ts";
    private readonly configValidator = ajv2({
        '@host': 'string',
        '@port': 'integer|>0'
    });
    private connections = new Map<string, RedisClient>();

    init(): Promise<void> {
        return Promise.resolve();
    }

    assertConfig(config: any): void {
        if (!config || _.isString(config)) return;
        if (!this.configValidator(config)) throw new Error(this.configValidator.errors.map(e => e.message).join('\n'));
    }

    async make(repo: IProviderRepository, config: any): Promise<any> {
        const configDesc = (config != null) ? config : '$$undefined';
        const hash = hasher.sha1(configDesc);
        if (this.connections.has(hash)) return this.connections.get(hash);

        const client = new RedisClient(config);
        this.connections.set(hash, client);
        return client;
    }
}

export const provider = new RedisConnectionProvider();
export default provider;