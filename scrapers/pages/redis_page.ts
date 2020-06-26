import * as pp from 'puppeteer';
import { ScrapeObjectProvider, IProviderRepository } from '../provider';
import { RedisClient, RedisKeySet } from 'redis-ts';
import { newAjv2 } from '../../utils/ajv2';
import { IPPPageFactory } from './page_factory';

export class RedisPuppeteerPageFactory implements IPPPageFactory {
    private browsers = new Map<string, pp.Browser>();

    constructor(
        private redisKey: RedisKeySet,
    ) {}

    async newPage(): Promise<pp.Page> {
        const conn = await this.redisKey.srandOneMember();
        if (!conn) {
            throw new Error('Cannot making web page! Browser not found!');
        }

        if (this.browsers.has(conn)) {
            const browser = this.browsers.get(conn);
            const isConnected = await this.testConnection(browser);
            if (!isConnected) {
                await this.releaseBrowser(conn, browser);
                return await this.newPage();
            }

            return browser.newPage();
        }

        try {
            const browser = await pp.connect({browserWSEndpoint: conn});
            this.browsers.set(conn, browser);
            return await browser.newPage();
        }
        catch {
            // cannot connect browser
            this.releaseBrowser(conn);
            return await this.newPage();
        }
    }

    async testConnection(browser: pp.Browser) {
        try {
            await browser.version();
            return true;
        }
        catch (err) {
            return false;
        }
    }

    async releaseBrowser(conn: string, br?: pp.Browser) {
        try {br && br.disconnect();} catch {};
        this.browsers.delete(conn);
        await this.redisKey.srem(conn);
    }
}

const ajv2 = newAjv2();

export class RedisPuppeteerPageFactoryProvider extends ScrapeObjectProvider {
    readonly type: string = "PP_PAGE_FACTORY";
    readonly name: string = "redis_browser";
    readonly configValidator = ajv2({
        'redis': {},
        '+@redis_key': 'string'
    });

    init(): Promise<any> {
        return Promise.resolve();
    }

    assertConfig(config: any): void {
        if (!this.configValidator(config)) throw new Error(this.configValidator.errors.map(e => e.message).join('\n'));        
    }

    async make(repo: IProviderRepository, config: any): Promise<any> {
        const redisConn = await repo.make<RedisClient>("REDIS", config.redis);
        const key = redisConn.child(config.redis_key);

        const pageFactory = new RedisPuppeteerPageFactory(key);
        return pageFactory;
    }
}

export const provider = new RedisPuppeteerPageFactoryProvider();
export default provider;