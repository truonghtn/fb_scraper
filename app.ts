import * as _ from 'lodash';
import * as minimist from 'minimist';
import * as path from 'path';
import { ScrapeService } from './scrapers/serv';

// Import routers

class Program {
  public static async main(): Promise<number> {
    const args = minimist(process.argv.slice(2));
    const config = 'env.json';
    if (_.isEmpty(config)) throw new Error('Config file must be specified!!');

    const serv = new ScrapeService();
    try {
      await serv.configure(require(path.resolve(process.cwd(), config)));

      await serv.start();
      console.log(`Scrape service started...`);
    }
    catch (err) {
      console.log(err);
    }

    return 0;
  }
}

Program.main();