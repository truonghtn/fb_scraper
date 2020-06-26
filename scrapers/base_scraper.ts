import { IScrapeLogger } from "./logger";
import { IScrapeRequest } from "./request";

export interface IScraper {
  logger?: IScrapeLogger;

  // configure(config: any): Promise<void>;
  init(): Promise<void>;

  isScrapeable(req: IScrapeRequest): boolean;
  scrape(req: IScrapeRequest): Promise<any>;
}