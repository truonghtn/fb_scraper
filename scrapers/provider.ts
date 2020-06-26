import * as _ from 'lodash';

export interface IProviderRepository {
  getProvider(type: string, name?: string): ScrapeObjectProvider;
  make<T>(type: string, config?: any): Promise<T>;
}

export abstract class ScrapeObjectProvider {

  abstract get type(): string;
  abstract get name(): string;
  abstract init(): Promise<void>;
  abstract assertConfig(config: any): void;
  abstract make(repo: IProviderRepository, config: any): Promise<any>;
}

type ProviderCollection = Map<string, ScrapeObjectProvider>;

export class ScrapeProviderRepository implements IProviderRepository {
  static readonly DEFAULT_TOKEN = '$default';
  private providers = new Map<string, ProviderCollection>();

  private getProviderCollection(type: string) {
    type = type.toUpperCase();
    const coll = this.providers.get(type);
    if (!coll) {
      const newColl = new Map<string, ScrapeObjectProvider>();
      this.providers.set(type, newColl);
      return newColl;
    }

    return coll;
  }

  addProvider(provider: ScrapeObjectProvider): this {
    if (!provider) throw new Error('Cannot add empty provider!');
    this.getProviderCollection(provider.type.toUpperCase()).set(provider.name.toLowerCase(), provider);
    return this;
  }

  getProvider(type: string, name?: string): ScrapeObjectProvider {
    if (!type) return null;
    const coll = this.getProviderCollection(type);

    if (name === undefined) { // return default provider
      if (coll.has(ScrapeProviderRepository.DEFAULT_TOKEN)) return coll.get(ScrapeProviderRepository.DEFAULT_TOKEN);
      if (coll.size > 0) return coll.values().next().value;

      return null;
    }

    name = name && name.toLowerCase();
    return coll.get(name);
  }

  make<T>(type: string, config?: any): Promise<T> {
    if (!type) throw new Error(`Cannot make scrape object. Invalid config, Object's \`type\` (${type}) not found`);
    const name: string = config && (_.isString(config) ? config : config.type); // `type` field in config indicates the provider name

    const provider = !_.isEmpty(name) ? this.getProvider(type, name) : this.getProvider(type, undefined);
    if (!provider) throw new Error(`Cannot make scrape object. Invalid config, provider for (${type}, ${name}) not found.`);
    // if (!provider.assertConfig(config)) throw new Error('Cannot make scrape object. Invalid config, config assertion error.');
    provider.assertConfig(config);

    return provider.make(this, config);
  }
}

export class SimpleProvider<T> extends ScrapeObjectProvider {
  readonly type: string;
  readonly name: string;
  readonly object: T;

  constructor(type: string, name: string, obj: T) {
    super();
    this.type = type;
    this.name = name;
    this.object = obj;
  }

  init() {
    return Promise.resolve();
  }

  assertConfig(config: any): void {
  }

  make(repo: IProviderRepository, config: any): Promise<any> {
    return Promise.resolve(this.object);
  }
}