import { IScrapeRequest } from "./request";

export interface IScrapeEngineConsumer {
    (req: IScrapeRequest): Promise<void>;
}

export interface IScrapeEngine {
    init(): Promise<void>;
    consume(consumer: IScrapeEngineConsumer): Promise<any>;
    ack(req: IScrapeRequest): Promise<any>;
    response(req: IScrapeRequest, resp: any): Promise<void>;
}