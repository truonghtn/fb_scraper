import { newAjv2 } from '../../utils/ajv2';
import { IScrapeEngine, IScrapeEngineConsumer } from "../engine";
import { IProviderRepository, ScrapeObjectProvider } from '../provider';
import { IScrapeRequest } from '../request';

const ajv2 = newAjv2();

export class NullEngine implements IScrapeEngine {

  constructor(
  ) { }

  async init(): Promise<void> {
  }

  async consume(consumer: IScrapeEngineConsumer): Promise<any> {
  }

  async ack(req: IScrapeRequest): Promise<any> {
  }

  async response(req: IScrapeRequest, resp: any): Promise<void> {
  }
}

export class NullEngineProvider extends ScrapeObjectProvider {
  readonly type = "ENGINE";
  readonly name: string = "null";

  init(): Promise<any> {
    return Promise.resolve();
  }

  assertConfig(config: any): void {
  }

  async make(repo: IProviderRepository, config: any): Promise<IScrapeEngine> {
    return new NullEngine();
  }
}

export const provider = new NullEngineProvider();
export default provider;