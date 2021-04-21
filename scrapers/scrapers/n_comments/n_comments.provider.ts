import { newAjv2 } from '../../../utils/ajv2';
import { IScrapeCollector } from '../../collector';
import { IScrapeLogger } from '../../logger';
import { PPFBIdGetter } from '../../miscs/fb_id_getter';
import { IPPPageFactory } from '../../pages/page_factory';
import { IProviderRepository, ScrapeObjectProvider } from '../../provider';
import { FBNCommentAPIScraper } from './n_comments.scraper';

const ajv2 = newAjv2();

export class FBNCommentAPIScraperProvider extends ScrapeObjectProvider {
    readonly type = "SCRAPER";
    readonly name = "fb_n_comment_api";
    private readonly configValidator = ajv2({
        '+browser': {},
        '+n_comment_collector': {},
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
        const fbIdGetter = new PPFBIdGetter(pageFactory);
        const scraper = new FBNCommentAPIScraper(pageFactory, fbIdGetter);
        scraper.logger = await repo.make<IScrapeLogger>("LOGGER", config && config.logger);
        scraper.commentCollector = await repo.make<IScrapeCollector>("COLLECTOR", config && config.comment_collector);
        scraper.seeds = config.seeds;

        return scraper;
    }
}

export const provider = new FBNCommentAPIScraperProvider();
export default provider;