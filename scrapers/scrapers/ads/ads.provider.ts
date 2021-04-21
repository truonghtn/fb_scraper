import { newAjv2 } from '../../../utils/ajv2';
import { IScrapeCollector } from '../../collector';
import { IScrapeLogger } from '../../logger';
import { IPPPageFactory } from '../../pages/page_factory';
import { IProviderRepository, ScrapeObjectProvider } from '../../provider';
import { FBAdAPIScraper } from './ads.scraper';
import { IScrapeStore } from '../../store';

const ajv2 = newAjv2();
export class FBAdAPIScraperProvider extends ScrapeObjectProvider {
    readonly type = "SCRAPER";
    readonly name = "fb_ad_api";
    private readonly configValidator = ajv2({
        '+browser': {},
        '+adCollector': {},
        '+store': {},
        '+seeds': {
            'type': 'array',
            '@items': 'string',
            'minItems': 1
        }
    });

    init(): Promise<void> {
        return Promise.resolve();
    }

    assertConfig(config: any): void {
        if (!this.configValidator(config)) throw new Error(this.configValidator.errors.map(e => e.message).join('\n'));
    }

    async make(repo: IProviderRepository, config: any): Promise<any> {
        const pageFactory = await repo.make<IPPPageFactory>("PP_PAGE_FACTORY", config && config.browser);
        const scraper = new FBAdAPIScraper(pageFactory);
        scraper.logger = await repo.make<IScrapeLogger>("LOGGER", config && config.logger);
        scraper.adCollector = await repo.make<IScrapeCollector>("COLLECTOR", config && config.adCollector);
        scraper.dataStore = await repo.make<IScrapeStore>("STORE", config && config.store);
        scraper.seeds = config.seeds;
        return scraper;
    }
}

export const provider = new FBAdAPIScraperProvider();
export default provider;