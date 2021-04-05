import * as cheerio from 'cheerio';
import * as _ from 'lodash';
import * as nodeFetch from 'node-fetch';
import { scrollPageToBottom } from 'puppeteer-autoscroll-down';
import * as querystring from 'querystring';
import * as url from 'url';
import { IScrapeLogger } from '../../logger';
import { IScrapeCollector } from '../../collector';
import { PPIRequestData, PPInterceptor } from '../../../utils/pp_interceptor';
import SafeContainer from '../../../utils/safe_container';
import { IScraper } from '../../base_scraper';
import hera from '../../../utils/hera';
import { IPPPageFactory } from '../../pages/page_factory';
import { IScrapeRequest } from '../../request';
import { PPHelp } from '../../../utils/pp_help';
import { POST_TYPE, IPost, ICursorAds } from './ads.interface';
import { RedisClient } from '../../../node_modules/redis-ts';
import { IScrapeStore } from '../../store';

// const PAGE_SEEDS = [
//     "https://www.facebook.com/pg/go.viet.hello/ads/?ref=page_internal",
//     "https://www.facebook.com/pg/begroupvn/ads/?ref=page_internal",
//     "https://www.facebook.com/pg/GHNExpress/ads/?ref=page_internal",
//     "https://www.facebook.com/pg/Giaohangtietkiem.vn/ads/?ref=page_internal",
//     "https://www.facebook.com/pg/AhaMoveVietNam/ads/?ref=page_internal"
// ]

export class FBAdAPIScraper implements IScraper {
    logger: IScrapeLogger;
    adCollector: IScrapeCollector;
    adReq: SafeContainer<PPIRequestData> = new SafeContainer(() => hera.retry(() => this.refetchAdsReq(), 5), 3 * 60 * 60 * 1000);
    seeds: string[]
    dataStore: IScrapeStore;

    constructor(
        private pageFactory: IPPPageFactory,
    ) { }

    async init() {
        await this.adReq.acquire();
    }

    async refetchAdsReq() {
        let adReq: PPIRequestData;
        const page = await this.pageFactory.newPage();
        await page.setViewport({ width: 1024, height: 768 });
        await PPInterceptor.intercept(page, (req) => req.url().includes('facebook.com/pages_reaction_units/more'),
            (req) => {
                adReq = req;
            }, (req, resp) => {
            });
        try {
            const pageInit = _.sample(this.seeds);
            await page.goto(pageInit, { waitUntil: 'networkidle2' });
            await PPHelp.inject$(page);
            await scrollPageToBottom(page)
            await hera.waitFor(() => adReq != null, 10000);

            // this.logger.debug(adReq);
            return adReq;
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
        return req.data.type == "ad_api" && (_.isString(req.data.pageId)) && (_.isNumber(req.data.country_code));
    }

    async scrape(req: IScrapeRequest): Promise<any> {
        let ads = [];
        const pageId = req.data.pageId;
        const countryCode: number = req.data.country_code;

        const lastPostId = await this.dataStore.get(`LAST_POST_OF_PAGE_${pageId}`);
        const adReq = await this.adReq.acquire();
        try {
            if (lastPostId) {
                // Update new post
                ads = await this.watchingPage({ pageId, countryCode }, adReq, lastPostId);
            } else {
                // Init page
                ads = await this.initPage({ pageId, countryCode }, adReq, 50);
            }
        }
        catch (err) {
            await hera.unboxPromise(this.logger.error(err));
        }
        await hera.unboxPromise(this.adCollector.collect(...ads));
        // Update last post 
        if (!_.isEmpty(ads)) {
            const lastPost = _.last(_.sortBy(ads, ['pid']))
            await this.dataStore.set(`LAST_POST_OF_PAGE_${pageId}`, lastPost.pid);
        }

        return {
            type: req.data.type,
            pageId,
        }
    }

    private async initPage({ pageId, countryCode }, adReq, limit) {
        let unit_count = 0;
        let cursor = { "card_id": "page_composer_card", "has_next_page": true }
        const ads = [];
        while (unit_count < limit) {
            const { url, adReqParams } = this.parseReqUrl(adReq.url);
            adReqParams.set('unit_count', 8);
            adReqParams.set('page_id', pageId);
            // adReqParams.set('country', countryCode);
            adReqParams.set('cursor', encodeURIComponent(JSON.stringify(cursor)));

            const firstReqResp = await this.reqURL(adReq, PPHelp.urlWithQS(url, adReqParams));
            const html = _.get(firstReqResp, `domops.0.3.__html`) || {};

            const contents = this.getContentPosts2(html);
            this.logger.log(contents);

            cursor = this.getCursor(html);

            const dataAds = this.parseDataPostAd(contents, pageId);
            if (_.isEmpty(dataAds)) break;
            ads.push(...dataAds);

            unit_count += 8;
        }
        return ads;
    }

    private async watchingPage({ pageId, countryCode }, adReq, lastPostId) {
        const ads = [];
        let cursor = { "card_id": "page_composer_card", "has_next_page": true }

        do {
            const { url, adReqParams } = this.parseReqUrl(adReq.url);
            adReqParams.set('unit_count', 8);
            adReqParams.set('page_id', pageId);
            // adReqParams.set('country', countryCode);
            adReqParams.set('cursor', encodeURIComponent(JSON.stringify(cursor)));

            const firstReqResp = await this.reqURL(adReq, PPHelp.urlWithQS(url, adReqParams));
            const html = _.get(firstReqResp, `domops.0.3.__html`) || {};

            const contents = this.getContentPosts2(html);
            this.logger.log(contents);
            const dataAds = this.parseDataPostAd(contents, pageId);

            cursor = this.getCursor(html);

            const newAds = _.filter(dataAds, (ad: IPost) => ad.pid > lastPostId);
            if (_.isEmpty(newAds)) break;

            ads.push(...newAds);
        } while (true)

        return ads;
    }

    private parseDataPostAd(data: any[], pageId: string): IPost[] {
        if (_.isEmpty(data)) return;
        const dataOk = _.filter(data, d => !_.isEmpty(d.pid))
        return (dataOk || []).map(({ pid, content, imgUrls }) => {
            return {
                pid: pid,
                img_urls: imgUrls,
                type: POST_TYPE.Ad,
                page_id: pageId,
                content
            }
        })
    }

    //extra string
    private getContentPosts2(html: string) {
        if (!html) return [];

        const $ = cheerio.load(html);
        const divContents = $('.userContentWrapper').toArray();

        const posts = divContents.map(div => {
            const $content = cheerio.load(div);

            const pidRaw = $content("div[data-testid*='story-subtitle']").attr('id');
            let pid = hera.extractString(pidRaw, ';', ';');
            if (_.isEmpty(pid)) {
                pid = hera.extractString(pidRaw, 'feed_subtitle_', ':')
            }

            const photoUrlRaws = [];
            $content('img').each(function (index, element) {
                photoUrlRaws.push($(element).attr('src'));
            });

            const content = $content("div[data-testid='post_message']").text()

            return {
                pid,
                imgUrls: photoUrlRaws,
                content
            }
        })


        return posts;
    }

    private getCursor(html: string) {
        if (!html) return null;

        const $content = cheerio.load(html);
        const cursorRaw = $content("a[rel='ajaxify']").attr('ajaxify');
        const cursor = hera.extractString(cursorRaw, 'cursor=', '&');
        const strCursor = decodeURIComponent(cursor);
        return JSON.parse(strCursor);
    }

    private async reqURL(adReq: PPIRequestData, url: string) {
        const resp = await nodeFetch.default(url, adReq);
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

    private parseReqUrl(rawUrl: string) {
        const parsedUrl = url.parse(rawUrl);
        const urlString = `https://${parsedUrl.hostname}${parsedUrl.pathname}`;
        const params = querystring.parse(parsedUrl.query);

        const mapParams = new Map();
        Object.keys(params).forEach(key => {
            mapParams.set(key, params[key]);
        });
        return {
            url: urlString,
            adReqParams: mapParams
        }
    }
}