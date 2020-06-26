import * as mongodb from 'mongodb';
import { IScrapeCollector } from '../collector';
import { ScrapeObjectProvider, IProviderRepository } from '../provider';
import { newAjv2 } from '../../utils/ajv2';

export class MongoDBCollector implements IScrapeCollector {
    constructor(
        private collection: mongodb.Collection
    ) { }

    async collect(...data: any[]): Promise<void> {
        const opts: mongodb.CollectionInsertManyOptions = { ordered: false }
        try {
            if (data.length > 0) {
                await this.collection.insertMany(data, opts);
            }
        }
        catch (err) {
            console.log(err);
            // ignore this problem
        }
    }
}

const ajv2 = newAjv2();

export class MongoDBCollectorProvider extends ScrapeObjectProvider {
    readonly type = "COLLECTOR";
    readonly name = "mongo";
    private readonly configValidator = ajv2({
        '+mongo': {},
        '+@db': 'string',
        '+@collection': 'string',
        'db_opts': {}
    });

    init(): Promise<void> {
        return Promise.resolve();
    }

    assertConfig(config: any): void {
        if (!this.configValidator(config)) throw new Error(this.configValidator.errors.map(e => e.message).join('\n'));
    }

    async make(repo: IProviderRepository, config: any): Promise<any> {
        const mongoClient = await repo.make<mongodb.MongoClient>('MONGO', config.mongo);
        if (!mongoClient) throw new Error('Making mongo collector error! Cannot make mongodb connection');

        const db = mongoClient.db(config.db, config.db_opts);
        const collection = db.collection(config.collection);

        return new MongoDBCollector(collection);
    }
}

export const provider = new MongoDBCollectorProvider();
export default provider;