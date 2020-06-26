import * as moment from 'moment';
import * as pp from 'puppeteer';
import { IScrapeLogger } from "../logger";
import _ = require('lodash');
import * as path from 'path';
import { ScrapeObjectProvider, IProviderRepository } from '../provider';
import { newAjv2 } from '../../utils/ajv2';

export class PPScreenshotLogger implements IScrapeLogger {
    constructor(
        private textLogger: IScrapeLogger,
        private logDir: string,
        private debugDir: string,
        private errorDir: string
    ) {
        if (!this.debugDir) {this.debugDir = this.logDir};
        if (!this.errorDir) {this.errorDir = this.logDir};
    }

    log(msg: any, ctx?: any) {
        this.textLogger.log(msg);
        ctx && this.screenshotToDir(this.logDir, ctx);
    }

    debug(msg: any, ctx?: any) {
        this.textLogger.debug(msg);
        ctx && this.screenshotToDir(this.logDir, ctx);
    }

    error(err: Error, ctx?: any) {
        this.textLogger.error(err);
        ctx && this.screenshotToDir(this.logDir, ctx);
    }

    private screenshotToDir(dir: string, ctx: any) {
        const now = moment();
        const page = ctx && ctx.page;
        
        if (page && _.isFunction(page.screenshot)) {
            const _page = page as pp.Page;
            const _path = path.resolve(this.logDir, `${now.format('YYMMDD HH:mm:ss.SS')}.png`);
            _page.screenshot({path: _path});
            this.textLogger.log(`Taken screen shot to ${_path}`);
        }
    }
}

const ajv2 = newAjv2();

export class PPPageScreenshotLoggerProvider extends ScrapeObjectProvider {
    readonly type: string = "LOGGER";
    readonly name: string = "pp_screenshot";
    private readonly configValidator = ajv2({
        'text_logger': {},
        '+@logDir': 'string',
        '@debugDir': 'string',
        '@errorDir': 'string'
    });

    init(): Promise<void> {
        return Promise.resolve();
    }

    assertConfig(config: any): void {
        if (!this.configValidator(config)) throw new Error(this.configValidator.errors.map(e => e.message).join('\n'));
    }

    async make(repo: IProviderRepository, config: any): Promise<any> {
        const textLogger = await repo.make<IScrapeLogger>("LOGGER", config.text_logger);
        return new PPScreenshotLogger(textLogger, config.logDir, config.debugDir, config.errorDir);
    }
}

export const provider = new PPPageScreenshotLoggerProvider();
export default provider;