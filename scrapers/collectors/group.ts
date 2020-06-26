import * as _ from 'lodash';
import { ScrapeObjectProvider, IProviderRepository } from "../provider";
import { ICollector } from './collector';

class GroupCollector implements ICollector {
  constructor(
    private collectors: ICollector[]
  ) { }

  collect(...data: any[]): Promise<void> {
    if (this.collectors.length == 0) return Promise.resolve();
    if (this.collectors.length == 1) return this.collectors[0].collect(...data);
    return <Promise<any>>Promise.all(this.collectors.map(c => c.collect(...data)));
  }
}

export class GroupCollectorProvider extends ScrapeObjectProvider {
  readonly type: string = "COLLECTOR";
  readonly name: string = "group";

  init(): Promise<void> {
    return Promise.resolve();
  }

  assertConfig(config: any): void {
    if (!_.isArray(config.collectors) || config.collectors.length == 0) {
      throw new Error('Group collector! `collectors` must be an array (and not empty)');
    }
  }

  async make(repo: IProviderRepository, config: any): Promise<any> {
    const collectors = await Promise.all((<any[]>config.collectors).map(c => repo.make<ICollector>("COLLECTOR", c)));
    return new GroupCollector(collectors);
  }
}

const provider = new GroupCollectorProvider();
export default provider;