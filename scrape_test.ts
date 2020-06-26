import * as path from 'path';
import * as moment from 'moment';
import * as pp from 'puppeteer';
import * as _ from 'lodash';
import * as minimist from 'minimist';
import * as jquery from 'jquery';
import * as fs from 'fs';
import { hera } from './utils/hera';
import { PPInterceptor, PPIRequestData } from './utils/pp_interceptor';
import * as cheerio from 'cheerio';
import * as nodeFetch from 'node-fetch';
import * as rmq from 'amqplib';
import { PPHelp } from './utils/pp_help';
import { ScrapeService } from './scrapers/serv';
import { IScraper } from './scrapers/base_scraper';
import { IPPPageFactory } from './scrapers/pages/page_factory';
import SafeContainer from './utils/safe_container';
import { IScrapeLogger } from './scrapers/logger';
import { IFBIdGetter, PPFBIdGetter } from './scrapers/miscs/fb_id_getter';

interface IGroupFetchQS {
    dpr?: number;
    ajaxpipe?: number;
    ajaxpipe_token?: string;
    ajaxpipe_fetch_stream?: number;
    no_script_path?: number;
    data: {
        last_view_time: number;
        is_file_history: any;
        is_first_story_seen: boolean;
        story_index: number;
        end_cursor: string;
        group_id: number;
        has_cards: boolean;
        multi_permalinks: string[];
        posts_visible: number;
        sorting_setting: any;
    };
    __user?: number;
    __a?: number;
    __dyn?: string;
    __req?: number;
    __be?: number;
    __pc?: string;
    __rev?: number;
    __spin_r?: number;
    __spin_b?: string;
    __spin_t?: string;
    __adt?: number;
}

class Program {
    static pageFactory: IPPPageFactory;
    static logger: IScrapeLogger;
    static grFetchReq: SafeContainer<PPIRequestData> = new SafeContainer(() => hera.retry(() => Program.refetchGroupFetchReq(), 5), 3 * 60 * 60 * 1000);

    static async refetchGroupFetchReq() {
        const page = await this.pageFactory.newPage();
        let fetchReq: PPIRequestData;
        
        try {
            PPInterceptor.intercept(page,
                (req) => req.url().includes('/ajax/pagelet/generic.php/GroupEntstreamPagelet'),
                (req) => {
                    fetchReq = req;                    
                },
                (req, resp) => {}
            );
    
            await page.goto('https://www.facebook.com/groups/thuenhaphongtrotphcm', {waitUntil: 'networkidle2'});
            await PPHelp.inject$(page);
            
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });
    
            await page.waitFor(() => $('.async_saving > div[data-testid=fbfeed_placeholder_story]').length == 0);
    
            await hera.waitFor(() => fetchReq != null);

            return fetchReq;
        }
        catch (err) {
            this.logger.error(err);
            throw err;
        }
        finally {
            await page.close();
        }
    }

    public static async main(): Promise<number> {
        const args = minimist(process.argv.slice(2));
        const config = args.config;
        if (_.isEmpty(config)) throw new Error('Config file must be specified!!');

        const serv = new ScrapeService();
        try {
            await serv.configure(require(path.resolve(process.cwd(), config)));
    
            const repo = serv.providerRepo;
            this.pageFactory = await repo.make<IPPPageFactory>("PP_PAGE_FACTORY", {
                type: "redis_browser",
                redis_key: "scraper:fb"
            });
            this.logger = await repo.make<IScrapeLogger>("LOGGER", "$default");

            const fbIdGetter = new PPFBIdGetter(this.pageFactory);
            await fbIdGetter.init();

            this.grFetchReq.acquire();

            const grId = 500755169973527;
            const time = 30;
            const begin = moment();
            const end = begin.clone().add(time, 's');
            let lastPostId = '0';
            let i = 1;
            while (true) {
                this.logger.debug(`Fetch ${i} - last post ${lastPostId}`);

                const now = moment();
                const req = await this.grFetchReq.acquire();
                const [url, _qs] = PPHelp.extractQS(req.url);
                const grFetchQS = this.convertToGroupFetchQS(_qs);
                ++grFetchQS.__req;
                ++grFetchQS.__adt;
                grFetchQS.data.last_view_time = 0;
                grFetchQS.data.end_cursor = Buffer.from(`${now.unix()}:${lastPostId}:${lastPostId},0:7:`).toString('base64');
                grFetchQS.data.group_id = grId;
                grFetchQS.data.story_index = 0;
                grFetchQS.data.posts_visible = 0;
                
                const resp = await this.reqFetchGroup(req, grFetchQS);
                fs.writeFileSync(`data/test_${i}.json`, JSON.stringify(resp, null, 2));
                const html = _.get(resp, 'content.payload.content.content');
                fs.writeFileSync(`data/test_${i}.html`, html);

                if (now.isAfter(end)) {
                    break;
                }
                const $ = cheerio.load(html);
                const a = $('a > abbr > span.timestampContent').last().parent().parent();
                const href = a.attr('href');
                const postURL = `https://www.facebook.com${href}`;
                lastPostId = await fbIdGetter.getId(postURL);
                ++i;
            }
        }
        catch (err) {
            console.error(err);
        }

        console.log('FINISHED');
        return 0;
    }

    static convertToGroupFetchQS(qs: Map<string, string>): IGroupFetchQS {
        const gFetchQS: IGroupFetchQS = {
            dpr: hera.parseInt(qs.get('dpr'), 10, null),
            ajaxpipe: hera.parseInt(qs.get('ajaxpipe'), 10, null),
            ajaxpipe_token: qs.get('ajaxpipe_token'),
            ajaxpipe_fetch_stream: hera.parseInt(qs.get('ajaxpipe_fetch_stream'), 10, null),
            no_script_path: hera.parseInt(qs.get('no_script_path'), 10, null),
            data: JSON.parse(decodeURIComponent(qs.get('data'))),
            __user: hera.parseInt(qs.get('__user'), 10, null),
            __a: hera.parseInt(qs.get('__a'), 10, null),
            __dyn: qs.get('__dyn'),
            __req: hera.parseInt(qs.get('__req').split('_')[1], 10, 0),
            __be: hera.parseInt(qs.get('__be'), 10, null),
            __pc: qs.get('__pc'),
            __rev: hera.parseInt(qs.get('__rev'), 10, null),
            __spin_r: hera.parseInt(qs.get('__spin_r'), 10, null),
            __spin_b: qs.get('__spin_b'),
            __spin_t: qs.get('__spin_t'),
            __adt: hera.parseInt(qs.get('__adt'), 10, null)
        }

        return gFetchQS;
    }

    static async reqFetchGroup(req: PPIRequestData, qs: IGroupFetchQS) {
        const url = `https://www.facebook.com/ajax/pagelet/generic.php/GroupEntstreamPagelet?${this.encodeGroupFetchQS(qs)}`;
        hera.time('REQ');
        const resp = await nodeFetch.default(url, req);
        hera.timeEnd('REQ');
        const body = await resp.buffer();
        console.log(`REQ Body: ${body.length}`);
        const token = '/*<!-- fetch-stream -->*/';
        const jsonStrs = body.toString().split(token);
        const json = JSON.parse(jsonStrs[1]);

        return json;
    }

    static encodeGroupFetchQS(qs: IGroupFetchQS) {
        const map = new Map(Object.entries(qs));
        map.set('data', encodeURIComponent(JSON.stringify(qs.data)));
        map.set('__req', `fetchstream_${qs.__req}`);
        return PPHelp.encodeURLBody(map);
    }

    static parseHTML(html: string) {
        if (!html) return {
            profiles: [],
            total: 0
        };
        
        const $ = cheerio.load(html);
        const aTags = $('li > div a[data-gt]').toArray();
        const profiles = aTags.map(a => {
            const $a = $(a);
            const gt = JSON.parse($a.attr('data-gt'));
            return {
                id: _.get(gt, 'engagement.eng_tid'),
                url: $a.attr('href'),
                name: $a.text()
            };
        })

        const href = $('#reaction_profile_pager > div > a').attr('href');
        const nTotalLikes = hera.parseInt(hera.extractString(href, 'total_count=', '&'), 10, 0);

        return {
            profiles,
            total: nTotalLikes
        };
    }
}

Program.main();