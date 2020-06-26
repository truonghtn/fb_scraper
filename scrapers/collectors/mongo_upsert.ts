import * as mongodb from 'mongodb';
import * as _ from 'lodash';
import { IScrapeCollector } from '../collector';
import { ScrapeObjectProvider, IProviderRepository } from '../provider';
import { newAjv2 } from '../../utils/ajv2';

type UpdateCriteria = Map<string, string>;

export class MongoDBUpsertCollector implements IScrapeCollector {
  constructor(
    private collection: mongodb.Collection,
    private updateCriteria: UpdateCriteria
  ) { }

  async collect(...data: any[]): Promise<void> {
    if (data.length <= 0) return;
    // if (data.length == 1) {
    //     await this.collection.findOneAndUpdate(this.buildUpdateQuery(data[0]), data[0], {upsert: true});
    //     return;
    // }

    const bulk = this.collection.initializeUnorderedBulkOp();
    data.forEach(d => bulk.find(this.buildUpdateQuery(d)).upsert().updateOne(d));
    await bulk.execute();
  }

  buildUpdateQuery(data: any) {
    const query = {};
    for (const [k, v] of this.updateCriteria) {
      query[k] = _.get(data, v);
    }

    return query;
  }
}

const ajv2 = newAjv2();

export class MongoDBUpsertCollectorProvider extends ScrapeObjectProvider {
  readonly type = "COLLECTOR";
  readonly name = "mongo_upsert";
  private readonly configValidator = ajv2({
    '+mongo': {},
    '+@db': 'string',
    '+@collection': 'string',
    'db_opts': {},
    '+@update': {}
  });

  init(): Promise<void> {
    return Promise.resolve();
  }

  assertConfig(config: any): void {
    if (!this.configValidator(config)) throw new Error(this.configValidator.errors.map(e => e.message).join('\n'));
    if (!_.isPlainObject(config.update)) throw new Error('Mongo upsert config assertion error. `update` must be object of string -> string');
    if (Object.keys(config.update).length == 0) throw new Error('Mongo upsert config assertion error. `update` must be set');
    if (Object.values(config.update).find(v => !_.isString(v)) != null) throw new Error('Mongo upsert config assertion error. `update` value must be string');
  }

  async make(repo: IProviderRepository, config: any): Promise<any> {
    const mongoClient = await repo.make<mongodb.MongoClient>('MONGO', config.mongo);
    if (!mongoClient) throw new Error('Making mongo collector error! Cannot make mongodb connection');

    const db = mongoClient.db(config.db, config.db_opts);
    const collection = db.collection(config.collection);

    const updateCriteria = new Map<string, string>();
    for (const k in config.update) {
      updateCriteria.set(k, config.update[k]);
    }

    return new MongoDBUpsertCollector(collection, updateCriteria);
  }
}

export const provider = new MongoDBUpsertCollectorProvider();
export default provider;