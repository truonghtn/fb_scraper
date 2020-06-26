import * as _ from 'lodash';
import { IPPPageFactory } from "../pages/page_factory";
import { PPIRequestData, PPInterceptor } from "../../utils/pp_interceptor";
import { IScrapeLogger } from "../logger";
import { ConsoleLogger } from "../loggers/console";
import SafeContainer from "../../utils/safe_container";
import hera from "../../utils/hera";
import * as nodeFetch from 'node-fetch';

export interface IFBIdGetter {
    init(): Promise<void>;
    getId(url: string): Promise<string>;
}

export class PPFBIdGetter implements IFBIdGetter {
    logger: IScrapeLogger = ConsoleLogger.INST;
    fbReq: SafeContainer<PPIRequestData> = new SafeContainer(() => hera.retry(() => this.refetchReq(), 5), 3 * 60 * 60 * 1000);

    constructor(
        private pageFactory: IPPPageFactory,
    ) {}

    async init() {
        await this.fbReq.acquire();
    }

    async refetchReq() {
        const postURI = '/ngatngay.cuoisay/posts/2065617307099105';
        const url = `https://mbasic.facebook.com${postURI}`;
        let fbReq: PPIRequestData;
        const page = await this.pageFactory.newPage();

        await PPInterceptor.intercept(page, (req) => req.url().includes(postURI),
        (req) => {
            fbReq = req;
        }, (req, resp) => {
        });

        try {
            await page.goto(url, {waitUntil: 'load'});
            await hera.waitFor(() => fbReq != null);
            return fbReq;
        }
        catch (err) {
            this.logger.error(err);
            throw err;
        }
        finally {
            await page.close();
        }
    }

    async getId(url: string): Promise<string> {
        if (!url.includes('facebook.com')) return undefined;

        const regex = /\/(\d+)\/?/g;
        const ids = url.match(regex);
        if (ids.length == 1) return ids[0].replace(/\//g, '');

        const req = await this.fbReq.acquire();
        const mbasicURL = _.first(url.split('?')).replace(/(www\.)?facebook\.com/i, 'mbasic.facebook.com');
        const resp = await nodeFetch.default(mbasicURL, req);
        const respBuffer = await resp.buffer();
        const respStr = respBuffer.toString();

        return hera.extractString(respStr, 'ft_ent_identifier=', '&');
    }
}