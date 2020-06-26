import * as _ from 'lodash';
import * as path from 'path';
import { newAjv2 } from '../utils/ajv2';
import { hera } from '../utils/hera';
import { IScraper } from './base_scraper';
import { IScrapeEngine } from './engine';
import { IScrapeLogger } from './logger';
import { ConsoleLogger } from './loggers/console';
import { ScrapeObjectProvider, ScrapeProviderRepository, SimpleProvider } from './provider';

const ajv2 = newAjv2();

export class ScrapeService {
  private static configValidator = ajv2({
    '+import': { 'type': 'array', '@items': 'string' },
    '+engine': {},
    'logger': {},
    '+scrapers': { 'type': 'array', 'items': {} }
  });

  providerRepo = new ScrapeProviderRepository();

  engine: IScrapeEngine;
  defaultLogger: IScrapeLogger = ConsoleLogger.INST;
  scrapers: IScraper[] = [];

  private assertConfig(config: any): void {
    if (!ScrapeService.configValidator(config)) throw new Error(<any>ScrapeService.configValidator.errors);
  }

  private async importPaths(paths: string[]): Promise<void> {
    for (const _path of paths) {
      const matches = await hera.glob(_path);
      for (const match of matches) {
        try {
          const provider = match && this.requireProvider(path.resolve(process.cwd(), match.toLowerCase()));
          if (!provider || this.providerRepo.getProvider(provider.type, provider.name)) {
            continue; // duplicated
          }

          await provider.init();
          this.providerRepo.addProvider(provider);
        }
        catch (err) {
          this.defaultLogger.error(err);
        }
      }
    }
  }

  private requireProvider(path: string) {
    const provider = require(path);
    if (this.isScrapeObjectProvider(provider)) return provider;

    const def = _.get(provider, 'default');
    if (this.isScrapeObjectProvider(def)) return def;

    return null;
  }

  private isScrapeObjectProvider(p: any) {
    if (typeof p != 'object') return false;

    if (p instanceof ScrapeObjectProvider) return true;

    let proto = Object.getPrototypeOf(p).constructor;
    while (proto) {
      const className = proto.name;
      if (!className) return false;

      if (className == 'ScrapeObjectProvider') {
        if ((_.isString(p.type) && _.isString(p.name) && _.isFunction(p.init) && _.isFunction(p.assertConfig) && _.isFunction(p.make))) {
          return true;
        }
      }

      proto = proto.__proto__;
    }

    return undefined;
  }

  async configure(config: any) {
    this.assertConfig(config);

    await this.importPaths(config.import);

    if (!_.isEmpty(config.logger)) {
      this.defaultLogger = await this.providerRepo.make<IScrapeLogger>('LOGGER', config.logger);
    }
    this.providerRepo.addProvider(new SimpleProvider('LOGGER', ScrapeProviderRepository.DEFAULT_TOKEN, this.defaultLogger));

    this.engine = await this.providerRepo.make<IScrapeEngine>('ENGINE', config.engine);
    this.engine.init();

    const scrapersConfig = config.scrapers;
    if (_.isArray(scrapersConfig) && scrapersConfig.length > 0) {
      const scrapers: IScraper[] = await Promise.all(scrapersConfig.map(scConfig => this.providerRepo.make<IScraper>('SCRAPER', scConfig)));
      this.scrapers.push(...scrapers);
      for (const scraper of scrapers) {
        await scraper.init();
      }
    }
  }

  async start() {
    await this.engine.init();

    await this.engine.consume(async (req) => {
      if (!req) return;

      let resp: any = null;
      try {
        this.defaultLogger.log(`Got request: `);
        this.defaultLogger.log(JSON.stringify(req.data, null, 2));
        const scraper = this.scrapers.find(sc => sc.isScrapeable(req));
        if (!scraper) {
          throw new Error(`Invalid request! Scraper not available`);
        }

        resp = await scraper.scrape(req);
      }
      catch (err) {
        await hera.unboxPromise(this.defaultLogger.error(err));
      }
      finally {
        // release things
      }

      this.engine.ack(req);
      if (!_.isEmpty(resp)) {
        this.engine.response(req, resp);
      }
    });
  }
}