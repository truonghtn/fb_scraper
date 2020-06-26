import { BoxedPromise } from "../utils/hera";

export interface IScrapeStore {
    get(key: string): BoxedPromise<any>;
    set(key: string, value: string): BoxedPromise<Boolean>

}