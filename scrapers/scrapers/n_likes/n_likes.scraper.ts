import * as cheerio from 'cheerio';
import * as _ from 'lodash';
import * as nodeFetch from 'node-fetch';
import hera from '../../../utils/hera';
import { PPHelp } from '../../../utils/pp_help';
import { PPInterceptor, PPIRequestData } from '../../../utils/pp_interceptor';
import SafeContainer from '../../../utils/safe_container';
import { IScraper } from '../../base_scraper';
import { IScrapeCollector } from '../../collector';
import { IScrapeLogger } from '../../logger';
import { IFBIdGetter } from '../../miscs/fb_id_getter';
import { IPPPageFactory } from '../../pages/page_factory';
import { IScrapeRequest } from '../../request';
import { IReaction } from './n_likes.interface';

export class FBNLikeScraper implements IScraper {
    logger: IScrapeLogger;
    likeReq: SafeContainer<{ req: PPIRequestData, qs: Map<string, any> }> = new SafeContainer(() => hera.retry(() => this.refetchLikeReq(), 5), 3 * 60 * 60 * 1000);
    collector: IScrapeCollector;
    seeds: string[]

    constructor(
        private pageFactory: IPPPageFactory,
        private idGetter: IFBIdGetter,
    ) { }

    async init() {
        await this.likeReq.acquire();
        await this.idGetter.init();
    }

    async refetchLikeReq() {
        let likeReq: PPIRequestData;

        const page = await this.pageFactory.newPage();
        await PPInterceptor.intercept(page,
            (req) => req.url().includes('/ufi/reaction/profile/dialog/'),
            (req) => {
                likeReq = req;
            },
            (req, resp) => { }
        );

        try {
            await page.setViewport({ width: 1366, height: 768 });

            const postInit = _.sample(this.seeds);
            await page.goto(postInit, { waitUntil: 'networkidle2' });

            await PPHelp.inject$(page);

            await page.evaluate(() => $('[data-testid="UFI2ReactionsCount/root"]')[0].click());
            await hera.waitFor(() => likeReq != null);
            const [url, qs] = PPHelp.extractQS(likeReq.url);

            return {
                req: likeReq,
                qs: qs
            };
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
        return req.data.type == "n_like_api" && _.isString(req.data.postId);
    }

    async scrape(req: IScrapeRequest): Promise<any> {
        const postId: string = req.data.postId;
        const collectingPromises = [];
        let reaction: IReaction = {};
        try {
            const req = await this.likeReq.acquire();

            const html = await this.reqDialog(req.req, req.qs, postId);
            reaction = this.getTotalReactions(html);

            collectingPromises.push(hera.unboxPromise(this.collector.collect({
                postId, nlikes: reaction.like.nlikes
            })));
        }
        catch (err) {
            this.logger.error(err);
        }

        if (collectingPromises.length > 0) {
            try { await Promise.all(collectingPromises) } catch (err) { this.logger.error(err) }
        }

        return {
            type: req.data.type,
            postId,
            nLike: reaction.like.nlikes
        }
    }

    private async reqDialog(likeReq: PPIRequestData, dlgQS: Map<string, any>, fid: string) {
        const url = 'https://www.facebook.com/ufi/reaction/profile/dialog/';
        const qs = new Map();

        const encodeFid = this.encodeBase64(`feedback:${fid}`);
        qs.set('ft_ent_identifier', encodeFid);
        qs.set('__req', (hera.parseInt(qs.get('__req'), 10, 0) + 1).toString(36));
        ['fb_dtsg_ag', '__asyncDialog', 'av', 'dpr', '__user', '__a', '__dyn', '__be', '__pc', '__rev', '__spin_r', '__spin_b', '__spin_t', 'ft[tn]'].forEach(f => qs.set(f, dlgQS.get(f)));

        const json = await this.reqURL(likeReq, PPHelp.urlWithQS(url, qs));
        const html = _.get(json, 'jsmods.markup.0.1.__html');
        return html;
    }

    private encodeBase64(data: string): string {
        let buff = new Buffer(data);
        let base64data = buff.toString('base64');
        return base64data;
    }

    private async reqURL(likeReq: PPIRequestData, url: string) {
        const resp = await nodeFetch.default(url, likeReq);
        const body = await resp.buffer();
        const token = 'for (;;);';
        const jsonStr = body.subarray(token.length).toString();
        try {
            const json = JSON.parse(jsonStr);
            return json;
        }
        catch (err) {
            this.logger.error(err);
            this.logger.debug(`Invalid parse JSON; Length = ${jsonStr.length}`);
            this.logger.debug(jsonStr);
        }
    }

    private getTotalReactions(html: string) {
        if (!html) return {
            like: {
                nlikes: 0
            }
        };

        const $ = cheerio.load(html);

        let nTotalLikes = hera.parseInt(hera.extractString(html, 'total_count=', '&'), 10, 0);
        if (nTotalLikes === 0) {
            const iTags = $("i[data-testid*='ufiReactionsIconsTestId']").toArray();
            nTotalLikes = iTags.length;
        }

        return {
            like: {
                nlikes: nTotalLikes
            }
        };
    }
}

export function getCircularReplacer() {
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