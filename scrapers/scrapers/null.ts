import { IScraper } from "../base_scraper";
import { IScrapeLogger } from "../logger";
import { IScrapeRequest } from "../request";
import { ScrapeObjectProvider, IProviderRepository } from "../provider";

export class NullScraper implements IScraper {
    logger?: IScrapeLogger;
    async init(): Promise<void> {
    }

    isScrapeable(req: IScrapeRequest): boolean {
        return false;
    }

    async scrape(req: IScrapeRequest): Promise<any> {
    }
}

export class NullScraperProvider extends ScrapeObjectProvider {
    type: string = "SCRAPER";
    name: string = "null";

    async init(): Promise<void> {
    }
    assertConfig(config: any): void {
    }
    make(repo: IProviderRepository, config: any): Promise<any> {
        return Promise.resolve(new NullScraper());
    }
}

export const provider = new NullScraperProvider();
export default provider;