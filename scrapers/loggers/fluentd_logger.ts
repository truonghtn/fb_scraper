import newAjv2 from '../../utils/ajv2';
import * as fluentd from 'fluent-logger';

import { IScrapeLogger } from "../logger";
import { ScrapeObjectProvider, IProviderRepository } from "../provider";
import { hera } from '../../utils/hera';

const ajv2 = newAjv2();

export class FluentdLogger implements IScrapeLogger {
  constructor(
    private fluentdLogger: any,
    private tag: string
  ) { }

  private getCircularReplacer = () => {
    const seen = new WeakSet();
    return (key, value) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) {
          return;
        }
        seen.add(value);
      }
      return value;
    };
  }

  log(msg: any) {
    this.fluentdLogger.emit(this.tag, { msg: JSON.stringify(msg, this.getCircularReplacer()) });
  }
  debug(msg: any) {
    this.fluentdLogger.emit(this.tag, { msg: JSON.stringify(msg, this.getCircularReplacer()) });
  }
  error(err: Error) {
    this.fluentdLogger.emit(this.tag, { err: JSON.stringify(err) });
  }
}

export class FluentdLoggerProvider extends ScrapeObjectProvider {
  readonly type = "LOGGER";
  readonly name: string = "fluentd";
  readonly configValidator = ajv2({
    '@host': 'string',
    '@port': 'integer|>0',
    '+@tag': 'string',
    '@timeout': 'number|>0',
    '@reconnectInterval': 'integer|>0'
  });

  init(): Promise<any> {
    return Promise.resolve();
  }

  assertConfig(config: any): void {
    if (!this.configValidator(config)) throw new Error(this.configValidator.errors.map(e => e.message).join('\n'));
  }

  async make(repo: IProviderRepository, config: any): Promise<IScrapeLogger> {
    config.host = config.host || 'localhost';
    config.port = hera.parseInt(config.port, 10, 24224);
    config.timeout = hera.parseFloat(config.timeout, 3);
    config.reconnectInterval = hera.parseInt(config.reconnectInterval, 10, 300000);

    const fluentLogger = fluentd.createFluentSender(null, config);
    const logger = new FluentdLogger(fluentLogger, config.tag);

    return Promise.resolve(logger);
  }
}

export const provider = new FluentdLoggerProvider();
export default provider;