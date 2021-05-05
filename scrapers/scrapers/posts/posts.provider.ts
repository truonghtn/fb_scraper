import { newAjv2 } from '../../../utils/ajv2';
import { IScrapeCollector } from '../../collector';
import { IScrapeLogger } from '../../logger';
import { PPFBIdGetter } from '../../miscs/fb_id_getter';
import { IPPPageFactory } from '../../pages/page_factory';
import { IProviderRepository, ScrapeObjectProvider } from '../../provider';
import { IScrapeStore } from '../../store';
import { FBPostsScraper } from './posts.scraper';


const ajv2 = newAjv2();

export class FBPostsScraperProvider extends ScrapeObjectProvider {
    readonly type = "SCRAPER";
    readonly name = "fb_posts_api";
    private readonly configValidator = ajv2({
        '+browser': {},
        '+posts_collector': {},
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
        // const fbIdGetter = new PPFBIdGetter(pageFactory);
        const scraper = new FBPostsScraper(pageFactory);
        scraper.logger = await repo.make<IScrapeLogger>("LOGGER", config && config.logger);
        scraper.collector = await repo.make<IScrapeCollector>("COLLECTOR", config && config.posts_collector);
        scraper.dataStore = await repo.make<IScrapeStore>("STORE", config && config.store);
        scraper.seeds = config.seeds;

        return scraper;
    }
}

export const provider = new FBPostsScraperProvider();
export default provider;