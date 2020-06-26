import { IScraper } from "../base_scraper";
import { IScrapeLogger } from "../logger";
import SafeContainer from "../../utils/safe_container";
import { PPIRequestData, PPInterceptor } from "../../utils/pp_interceptor";
import { ConsoleLogger } from "../loggers/console";
import { IScrapeCollector } from "../collector";
import { ConsoleScrapeCollector } from "../collectors/console";
import hera from "../../utils/hera";
import { IPPPageFactory } from "../pages/page_factory";
import { IFBIdGetter } from "../miscs/fb_id_getter";
import { IScrapeRequest } from "../request";
import { PPHelp } from "../../utils/pp_help";
import _ = require("lodash");
import * as nodeFetch from "node-fetch";

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

export class FBGroupPostScraper implements IScraper {
    logger: IScrapeLogger = ConsoleLogger.INST;
    fetchReq: SafeContainer<PPIRequestData> = new SafeContainer(() => hera.retry(() => this.refetchReq(), 5), 3 * 60 * 60 * 1000);
    collector: IScrapeCollector = ConsoleScrapeCollector.INST;
    
    constructor(
        private pageFactory: IPPPageFactory,
        private idGetter: IFBIdGetter,
        private fetchSize: number
    ) {}

    async init() {
        await this.fetchReq.acquire();
        await this.idGetter.init();
    }
    
    async refetchReq() {
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
            await hera.unboxPromise(this.logger.error(err, {page: page}));
            throw err;
        }
        finally {
            await page.close();
        }
    }

    isScrapeable(req: IScrapeRequest): boolean {
        return req.data.tpe == "group_post" && _.isNumber(req.data.gid);
    }

    async scrape(_req: IScrapeRequest): Promise<any> {
        const collectingPromises: Promise<void>[] = [];
        const grId = _req.data.gid;

        try {
            const req = await this.fetchReq.acquire();
            const [url, _qs] = PPHelp.extractQS(req.url);
            const grFetchQS = this.convertToGroupFetchQS(_qs);
            
            grFetchQS.data.last_view_time = 0;
            grFetchQS.data.end_cursor = undefined;
            grFetchQS.data.group_id = grId;
            grFetchQS.data.story_index = 0;
            grFetchQS.data.posts_visible = 0;
            
            const resp = await this.reqFetchGroup(req, grFetchQS);
            // fs.writeFileSync('data/testx.html', _.get(resp, 'content.payload.content.content'))
            // fs.writeFileSync('data/testx.json', JSON.stringify(resp, null, 2));
        }
        catch (err) {
            await this.logger.error(err);
        }

        if (collectingPromises) {
            try { await Promise.all(collectingPromises) } catch (err) { this.logger.error(err) }
        }

        return {};
    }

    convertToGroupFetchQS(qs: Map<string, string>): IGroupFetchQS {
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

    async reqFetchGroup(req: PPIRequestData, qs: IGroupFetchQS) {
        const url = `https://www.facebook.com/ajax/pagelet/generic.php/GroupEntstreamPagelet?${this.encodeGroupFetchQS(qs)}`;
        const resp = await nodeFetch.default(url, req);
        const body = await resp.buffer();
        const token = '/*<!-- fetch-stream -->*/';
        const jsonStrs = body.toString().split(token);
        const json = JSON.parse(jsonStrs[1]);

        return json;
    }

    encodeGroupFetchQS(qs: IGroupFetchQS) {
        const map = new Map(Object.entries(qs));
        map.set('data', encodeURIComponent(JSON.stringify(qs.data)));
        map.set('__req', `fetchstream_${qs.__req}`);
        return PPHelp.encodeURLBody(map);
    }
}