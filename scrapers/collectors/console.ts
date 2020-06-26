import { IScrapeCollector } from "../collector";
import { BoxedPromise } from "../../utils/hera";
import { ScrapeObjectProvider, IProviderRepository } from "../provider";


export class ConsoleScrapeCollector implements IScrapeCollector {
    static readonly INST: IScrapeCollector = new ConsoleScrapeCollector();

    collect(...data: any[]): BoxedPromise<void> {
        data.forEach(d => console.log(d));
    }
}

export class ConsoleScrapeCollectorProvider extends ScrapeObjectProvider {
    readonly type: string = "COLLECTOR";
    readonly name: string = "console";

    init(): Promise<void> {
        return Promise.resolve();
    }

    assertConfig(config: any): void {
    }

    make(repo: IProviderRepository, config: any): Promise<any> {
        return Promise.resolve(ConsoleScrapeCollector.INST);
    }
}

export const provider = new ConsoleScrapeCollectorProvider();
export default provider;