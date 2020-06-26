import { BoxedPromise } from "../utils/hera";

export interface IScrapeCollector {
    collect(...data: any[]): BoxedPromise<void>;
}