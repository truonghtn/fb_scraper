import { IScrapeLogger } from "../logger";
import { ScrapeObjectProvider, IProviderRepository } from "../provider";

export class ConsoleLogger implements IScrapeLogger {
    static readonly INST = new ConsoleLogger();

    log(msg: any) {
        console.log(msg);
    }

    debug(msg: any) {
        console.debug(msg)
    }

    error(err: Error) {
        console.error(err);
    }
}


export class ConsoleScrapeLoggerProvider extends ScrapeObjectProvider {
    readonly type: string = "LOGGER";
    readonly name: string = "console";

    init(): Promise<void> {
        return Promise.resolve();
    }

    assertConfig(config: any): void {
    }

    make(repo: IProviderRepository, config: any): Promise<any> {
        return Promise.resolve(ConsoleLogger.INST);
    }
}

export const provider = new ConsoleScrapeLoggerProvider();
export default provider;