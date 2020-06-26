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
import { IFBNCommentReqBody } from './n_comments.interface';

// const POST_SEEDS = [
//     "https://www.facebook.com/Giaohangtietkiem.vn/posts/2221520331242875/",
//     "https://www.facebook.com/tiki.vn/posts/10157196694412769/",
//     "https://www.facebook.com/AhaMoveVietNam/posts/421862215042247/",
//     "https://www.facebook.com/sieuchosendo/posts/2449766178402524/",
//     "https://www.facebook.com/sieuthivinmart/posts/1091692731021567/"
// ]
export class FBNCommentAPIScraper implements IScraper {
    logger: IScrapeLogger;
    commentCollector: IScrapeCollector;
    cmReq: SafeContainer<PPIRequestData> = new SafeContainer(() => hera.retry(() => this.refetchCommentReq(), 5), 3 * 60 * 60 * 1000);
    seeds: string[] = []

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
            const postInit = _.sample(this.seeds);
            console.log('==> Use page:', postInit);
            await page.goto(postInit, { waitUntil: 'networkidle2' });
            await PPHelp.inject$(page);

            await page.waitFor(() => $('a[data-channel-caller=channel_view_from_page_video_tab]').length > 0);
            await page.evaluate(() => $('a[data-channel-caller=channel_view_from_page_video_tab]').first()[0].click());

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
        return req.data.type == "n_comment_api" && _.isString(req.data.postId);
    }

    async scrape(req: IScrapeRequest): Promise<any> {
        const postId: string = req.data.postId;
        let nComment = 0;

        const collectingPromises = [];
        try {
            const cmReq = await this.cmReq.acquire();
            const cmReqBody: IFBNCommentReqBody = this.parseReqBody(cmReq.body);
            cmReqBody.ft_ent_identifier = postId;

            cmReqBody.offset = 0;
            cmReqBody.length = 1;
            const firstReqResp = await this.requestWithBody(cmReqBody)
            const commentData = _.get(firstReqResp, `jsmods.require.0.3.1.commentlists.comments.${postId}`) || {};
            const cmCount = _.keys(commentData).map(k => hera.parseInt(_.get(commentData, `${k}.count`), 10, 0)).find(n => n > 0) || 0;

            nComment = cmCount
            collectingPromises.push(hera.unboxPromise(this.commentCollector.collect({
                postId, nComment
            })));
        }
        catch (err) {
            await hera.unboxPromise(this.logger.error(err));
        }

        if (collectingPromises.length > 0) {
            try { await Promise.all(collectingPromises) } catch (err) { this.logger.error(err) }
        }

        return {
            type: req.data.type,
            postId,
            nComment
        }
    }

    async requestWithBody(reqBody: IFBNCommentReqBody) {
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
        const body: IFBNCommentReqBody = <any>{}
        for (const [k, v] of urlBody) {
            body[k] = v;
        }

        body.offset = hera.parseInt(body.offset, 10, 0);
        body.length = hera.parseInt(body.length, 10, 50);
        body.numpagerclicks = hera.parseInt(body.numpagerclicks, 10, 0);
        body.__req = hera.parseInt(body.__req, 36, 0);

        return body;
    }

    encodeReqBody(req: IFBNCommentReqBody) {
        const map = new Map(Object.entries(req));
        map.set('__req', req.__req.toString(36));
        return PPHelp.encodeURLBody(map);
    }
}