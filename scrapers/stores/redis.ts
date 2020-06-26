import { RedisClient, RedisKeySet, RedisKeyHash } from '../../node_modules/redis-ts';
import { newAjv2 } from '../../utils/ajv2';
import { IProviderRepository, ScrapeObjectProvider } from '../provider';
import { IScrapeStore } from '../store';

export class RedisStore implements IScrapeStore {
    constructor(
        private redisKey: RedisKeyHash
    ) { }

    async get(field: string): Promise<any> {
        try {
            return await this.redisKey.hget(field);
        } catch (err) {
            console.log(err);
            // ignore this problem
        }
    }

    async set(field: string, value: string): Promise<Boolean> {
        try {
            return await this.redisKey.hset(field, value);
        } catch (err) {
            console.log(err);
            // ignore this problem
        }
    }
}

const ajv2 = newAjv2();

export class RedisStoreProvider extends ScrapeObjectProvider {
    readonly type = "STORE";
    readonly name = "redis";
    private readonly configValidator = ajv2({
        '@type': 'string',
        '+redis': {
            '@host': 'string',
            '@port': 'integer|>0',
            '@redis_key': 'string',
        },
        '@redis_key': 'string'
    });

    init(): Promise<void> {
        return Promise.resolve();
    }

    assertConfig(config: any): void {
        if (!this.configValidator(config)) throw new Error(this.configValidator.errors.map(e => e.message).join('\n'));
    }

    async make(repo: IProviderRepository, config: any): Promise<any> {
        const redisConn = await repo.make<RedisClient>('REDIS', config.redis);
        if (!redisConn) throw new Error('Making redis error! Cannot make redis client');

        const key = redisConn.child(config.redis_key);

        return new RedisStore(key);
    }
}

export const provider = new RedisStoreProvider();
export default provider;