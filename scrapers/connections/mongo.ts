import { ScrapeObjectProvider, IProviderRepository, ScrapeProviderRepository } from "../provider";
import * as mongodb from 'mongodb';
import * as hasher from 'object-hash';
import * as _ from 'lodash';
import { newAjv2 } from "../../utils/ajv2";

const ajv2 = newAjv2();

export class MongoDBConnectionProvider extends ScrapeObjectProvider {
    readonly type = "MONGO";
    readonly name = ScrapeProviderRepository.DEFAULT_TOKEN;
    private readonly configValidator = ajv2({
        '+@connection': 'string'
    });
    private connections = new Map<string, mongodb.MongoClient>();

    init(): Promise<void> {
        return Promise.resolve();
    }

    assertConfig(config: any): void {
        if (_.isString(config)) return;
        if (!this.configValidator(config)) throw new Error(this.configValidator.errors.map(e => e.message).join('\n'));
    }

    async make(repo: IProviderRepository, config: any): Promise<any> {
        const hash = hasher.sha1(config);
        if (this.connections.has(hash)) return this.connections.get(hash);

        const conn: string = _.isString(config) ? config : config.connection;
        const client: mongodb.MongoClient = await mongodb.MongoClient.connect(conn, <mongodb.MongoClientOptions> config);
        this.connections.set(hash, client);
        return client;
    }
}

export const provider = new MongoDBConnectionProvider();
export default provider;