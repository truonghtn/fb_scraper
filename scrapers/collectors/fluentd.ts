import { IScrapeCollector } from '../collector';
import { ScrapeObjectProvider, IProviderRepository } from '../provider';
import { newAjv2 } from '../../utils/ajv2';
import hera from '../../utils/hera';
import * as fluentd from 'fluent-logger';

export class FluentdCollector implements IScrapeCollector {
    constructor(
        private logger: any,
        private label: string
    ) {}

    async collect(...data: any[]): Promise<void> {
        await Promise.all(data.map(d => new Promise((res, rej) => this.logger.emit(this.label, d, undefined, (err) => err ? rej(err) : res()))));
    }
}

const ajv2 = newAjv2();

export class FluentdCollectorProvider extends ScrapeObjectProvider {
    readonly type: string = "COLLECTOR";
    readonly name: string = "fluentd";
    readonly configValidator = ajv2({
        '@host': 'string',
        '@port': 'integer|>0',
        '+@tag': 'string',
        '@timeout': 'number|>0',
        '@reconnectInterval': 'integer|>0'
    });

    init(): Promise<void> {
        return Promise.resolve();
    }

    assertConfig(config: any): void {
        if (!this.configValidator(config)) throw new Error(this.configValidator.errors.map(e => e.message).join('\n'));
    }

    make(repo: IProviderRepository, config: any): Promise<any> {
        config.host = config.host || 'localhost';
        config.port = hera.parseInt(config.port, 10, 24224);
        config.timeout = hera.parseFloat(config.timeout, 3);
        config.reconnectInterval = hera.parseInt(config.reconnectInterval, 10, 300000);

        const fluentLogger = fluentd.createFluentSender(null, config);
        const collector = new FluentdCollector(fluentLogger, config.tag);

        return Promise.resolve(collector);
    }
}

export const provider = new FluentdCollectorProvider();
export default provider;