import * as pp from 'puppeteer';
import * as _ from 'lodash';
import * as nodeFetch from 'node-fetch';
import * as moment from 'moment';
import { IScraper } from '../base_scraper';
import { IScrapeRequest } from '../request';
import { PPInterceptor, PPIRequestData } from '../../utils/pp_interceptor';
import hera from '../../utils/hera';
import { PPHelp } from '../../utils/pp_help';
import { IPPPageFactory } from '../pages/page_factory';
import { IScrapeLogger } from '../logger';
import { IScrapeCollector } from '../collector';
import { ScrapeObjectProvider, IProviderRepository } from '../provider';
import { newAjv2 } from '../../utils/ajv2';
import { ConsoleScrapeCollector } from '../collectors/console';
import { ConsoleLogger } from '../loggers/console';
import SafeContainer from '../../utils/safe_container';
import { IFBIdGetter, PPFBIdGetter } from '../miscs/fb_id_getter';

// https://www.facebook.com/tinhyeucuatoi.vo/videos/1567353580053927/
interface IFBCommentReqBody {
    ft_ent_identifier: string;
    offset: number;
    length: number;
    numpagerclicks: number;
    __req: number;
}

export class FBCommentAPIScraper implements IScraper {
    logger: IScrapeLogger = ConsoleLogger.INST;
    commentCollector: IScrapeCollector = ConsoleScrapeCollector.INST;
    profileCollector: IScrapeCollector = ConsoleScrapeCollector.INST;
    cmReq: SafeContainer<PPIRequestData> = new SafeContainer(() => hera.retry(() => this.refetchCommentReq(), 5), 3 * 60 * 60 * 1000);
    seeds: string[]

    constructor(
        private pageFactory: IPPPageFactory,
        private idGetter: IFBIdGetter
    ) { }

    async init() {
        await this.cmReq.acquire();
        await this.idGetter.init();
    }

    async refetchCommentReq() {
        let cmReq: PPIRequestData;
        const page = await this.pageFactory.newPage();
        await page.setViewport({ width: 1024, height: 768 });
        await PPInterceptor.intercept(page, (req) => req.url().includes('/ajax/ufi/comment_fetch.php'),
            (req) => {
                cmReq = req;
            }, (req, resp) => {
            });
        try {
            await page.goto(_.sample(this.seeds), { waitUntil: 'networkidle2' });
            await PPHelp.inject$(page);

            await page.waitFor(() => $('.UFIRow.UFILikeSentence div.uiPopover > a[role=button]').length > 0);
            await page.evaluate(() => $('.UFIRow.UFILikeSentence div.uiPopover > a[role=button]').first()[0].click());
            await page.waitFor(() => $('ul[role=menu] li a').length > 0);
            await page.evaluate(() => {
                const items = $('ul[role=menu] li a');
                for (let i = 0; i < items.length; ++i) {
                    const text = items.eq(i).text().toLowerCase();
                    if (text.startsWith('mới')) {
                        items[i].click();
                        return;
                    }
                }
            });
            await hera.waitFor(() => cmReq != null, 10000);

            this.logger.debug(cmReq);
            return cmReq;
        }
        catch (err) {
            await hera.unboxPromise(this.logger.error(err, { page: page }));
            throw err;
        }
        finally {
            await hera.sleep(1000);
            await page.close();
        }
    }

    isScrapeable(req: IScrapeRequest): boolean {
        return req.data.type == "comment_api" && (_.isString(req.data.fid) || hera.isURL(req.data.url));
    }

    async scrape(req: IScrapeRequest): Promise<any> {
        const DEFAULT_LENGTH = 50;
        const fid: string = _.isString(req.data.fid) ? req.data.fid : await this.idGetter.getId(req.data.url);
        let nComments = 0;

        const collectingPromises = [];
        try {
            const cmReq = await this.cmReq.acquire();
            const cmReqBody: IFBCommentReqBody = this.parseReqBody(cmReq.body);
            cmReqBody.ft_ent_identifier = fid;

            cmReqBody.offset = 0;
            cmReqBody.length = 1;
            const firstReqResp = await this.requestWithBody(cmReqBody)
            const commentData = _.get(firstReqResp, `jsmods.require.0.3.1.commentlists.comments.${fid}`) || {};
            const cmCount = _.keys(commentData).map(k => hera.parseInt(_.get(commentData, `${k}.count`), 10, 0)).find(n => n > 0) || 0;
            if (cmCount == 0) {
                return { fid, nComments };
            }

            cmReqBody.length = Math.min(cmCount, DEFAULT_LENGTH);
            cmReqBody.offset = Math.max(cmCount - cmReqBody.length, 0);

            while (true) {
                const data = await this.requestWithBody(cmReqBody);

                const commentData: any[] = _.get(data, 'jsmods.require.0.3.1.comments') || [];
                const profiles = _.get(data, 'jsmods.require.0.3.1.profiles') || {};

                const comments = commentData.map(cm => ({
                    id: cm.id,
                    fentid: cm.ftentidentifier,
                    time: cm.timestamp.time,
                    content: cm.body.text,
                    author: cm.author,
                    // authorProfile: profiles[cm.author]
                }));

                nComments += comments.length;
                collectingPromises.push(hera.unboxPromise(this.commentCollector.collect(..._.reverse(comments))));
                collectingPromises.push(hera.unboxPromise(this.profileCollector.collect(..._.values(profiles))));
                this.logger.log(`${moment().format('HH:mm:ss')} -- Fetched: ${comments.length} comments of ${fid}`);

                if (cmReqBody.offset <= 0) break;

                cmReqBody.length = Math.min(cmReqBody.offset, cmReqBody.length);
                cmReqBody.offset = Math.max(cmReqBody.offset - cmReqBody.length, 0);
                cmReqBody.numpagerclicks++;
                cmReqBody.__req++;
            }
        }
        catch (err) {
            await hera.unboxPromise(this.logger.error(err));
        }

        if (collectingPromises.length > 0) {
            try { await Promise.all(collectingPromises) } catch (err) { this.logger.error(err) }
        }

        return {
            fid,
            nComments
        }
    }

    async requestWithBody(reqBody: IFBCommentReqBody) {
        const cmReq = await this.cmReq.acquire();
        cmReq.body = this.encodeReqBody(reqBody);
        const resp = await nodeFetch.default(cmReq.url, cmReq);
        const body = await resp.buffer();
        const token = 'for (;;);';
        const respString = body.subarray(token.length).toString();
        const data = JSON.parse(respString);
        return data;
    }

    parseReqBody(reqBody: nodeFetch.BodyInit) {
        const urlBody = PPHelp.parseURLEncodedBody(reqBody);
        const body: IFBCommentReqBody = <any>{}
        for (const [k, v] of urlBody) {
            body[k] = v;
        }

        body.offset = hera.parseInt(body.offset, 10, 0);
        body.length = hera.parseInt(body.length, 10, 50);
        body.numpagerclicks = hera.parseInt(body.numpagerclicks, 10, 0);
        body.__req = hera.parseInt(body.__req, 36, 0);

        return body;
    }

    encodeReqBody(req: IFBCommentReqBody) {
        const map = new Map(Object.entries(req));
        map.set('__req', req.__req.toString(36));
        return PPHelp.encodeURLBody(map);
    }
}

const ajv2 = newAjv2();

export class FBCommentAPIScraperProvider extends ScrapeObjectProvider {
    readonly type = "SCRAPER";
    readonly name = "fb_comment_api";
    private readonly configValidator = ajv2({
        '+browser': {},
        '+comment_collector': {},
        '+profile_collector': {},
        '+seeds': {
            'type': 'array',
            '@items': 'string',
            'minItems': 1
        }
    });

    init(): Promise<void> {
        return Promise.resolve();
    }

    assertConfig(config: any): void {
        if (!this.configValidator(config)) throw new Error(this.configValidator.errors.map(e => e.message).join('\n'));
    }

    async make(repo: IProviderRepository, config: any): Promise<any> {
        const pageFactory = await repo.make<IPPPageFactory>("PP_PAGE_FACTORY", config && config.browser);
        const fbIdGetter = new PPFBIdGetter(pageFactory);
        const scraper = new FBCommentAPIScraper(pageFactory, fbIdGetter);
        scraper.logger = await repo.make<IScrapeLogger>("LOGGER", config && config.logger);
        scraper.commentCollector = await repo.make<IScrapeCollector>("COLLECTOR", config && config.comment_collector);
        scraper.profileCollector = await repo.make<IScrapeCollector>("COLLECTOR", config && config.profile_collector);
        scraper.seeds = config.seeds

        return scraper;
    }
}

export const provider = new FBCommentAPIScraperProvider();
export default provider;