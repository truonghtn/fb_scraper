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
import { IPPPageFactory } from '../../pages/page_factory';
import { IScrapeRequest } from '../../request';
import { IScrapeStore } from '../../store';
import { IVariables } from './posts.interface';

export class FBPostsScraper implements IScraper {
    logger: IScrapeLogger;
    postReq: SafeContainer<PPIRequestData> = new SafeContainer(() => hera.retry(() => this.refetchLikeReq(), 5), 3 * 60 * 60 * 1000);
    collector: IScrapeCollector;
    seeds: string[]
    dataStore: IScrapeStore;

    constructor(
        private pageFactory: IPPPageFactory
    ) { }

    async init() {
        await this.postReq.acquire();
    }

    async refetchLikeReq() {
        let postReq: PPIRequestData;

        const page = await this.pageFactory.newPage();
        await PPInterceptor.intercept(page,
            (req) => {
                if (req.url().includes('/api/graphql')) {
                    const postDataStr = PPHelp.parseURLEncodedBody(req.postData());
                    const variables = JSON.parse(decodeURIComponent(postDataStr.get("variables")))
                    if (!_.isEmpty(variables) && !_.isEmpty(variables["UFI2CommentsProvider_commentsKey"])) {
                        return req.url().includes('/api/graphql');
                    }
                }
            },
            (req) => {
                postReq = req;
            },
            (req, resp) => { }
        );

        try {
            await page.setViewport({ width: 1366, height: 768 });
            const postInit = _.sample(this.seeds);
            await page.goto(postInit, { waitUntil: 'networkidle2' });
            await PPHelp.inject$(page);
            await hera.waitFor(() => postReq != null);
            return postReq;
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
        return req.data.type == "fb_posts_api" && _.isString(req.data.postId);
    }

    async scrape(req: IScrapeRequest): Promise<any> {
        const groupId = req.data.postId;
        const limit = req.data.limit;
        let dataCrawl;

        try {
            let lastCursor = await this.dataStore.get(`LAST_CURSOR_OF_POST_OF_GROUP_${groupId}`);

            try {
                if (lastCursor) {
                    dataCrawl = await this.watchingPage(this.postReq, lastCursor, limit);
                } else {
                    dataCrawl = await this.initPage(this.postReq);
                }
            } catch (err) {
                await hera.unboxPromise(this.logger.error(err));
            }

            const postIds = dataCrawl.postIds
            lastCursor = dataCrawl.lastCursor

            if (postIds) {
                const dataSaving = _.uniq(postIds).map(p => {
                    return {
                        groupId: groupId,
                        postId: p
                    }
                })
                await hera.unboxPromise(this.collector.collect(...dataSaving));
            }
            if (lastCursor) {
                await this.dataStore.set(`LAST_CURSOR_OF_POST_OF_GROUP_${groupId}`, lastCursor);
            }

            return {
                type: req.data.type,
                groupId,
            }
        }
        catch (err) {
            this.logger.error(err);
        }
    }

    async watchingPage(req, lastPostId: string, limit: number = 10) {
        let postIds: string[] = [];
        let lastCursor = lastPostId;
        let lastestPosts = [];

        do {
            const postReq = await req.acquire();
            const postReqBody = await this.parseReqBody(postReq.body, lastCursor);
            const firstReqResp = await this.requestWithBody(postReq, postReqBody)
            const posts = _.get(firstReqResp, 'data.node.group_feed.edges')

            const lastPost = _.last(posts);
            lastCursor = _.get(lastPost, 'cursor');
            const newPostIds: string[] = posts.map(p => {
                const url: string = _.get(p, 'node.comet_sections.feedback.story.url')
                return _.last(url.match(/([^/]+)/g))
            })

            if (_.isEqual(newPostIds.sort(), lastestPosts.sort())) break;
            lastestPosts = newPostIds
            postIds.push(...newPostIds)

            if (postIds.length >= limit) break;
        } while (true)

        return {
            lastCursor,
            postIds
        };
    }

    async initPage(req) {
        const postReq = await req.acquire();
        const postReqBody = await this.parseReqBody(postReq.body, null);
        const firstReqResp = await this.requestWithBody(postReq, postReqBody)
        const posts = _.get(firstReqResp, 'data.node.group_feed.edges')

        const lastPost = _.last(posts);
        const lastCursor = _.get(lastPost, 'cursor');
        const postIds = posts.map(p => {
            const url: string = _.get(p, 'node.comet_sections.feedback.story.url')
            return _.last(url.match(/([^/]+)/g))
        })

        return {
            lastCursor,
            postIds
        }
    }

    async requestWithBody(postReq, reqBody) {
        postReq.body = await this.encodeReqBody(reqBody);
        const resp = await nodeFetch.default(postReq.url, postReq);
        const body = await resp.buffer();
        const respString = body.toString();
        const respArray = respString.match(/([^\n]+)/g)
        const data = JSON.parse(respArray[0]);
        return data;
    }

    async encodeReqBody(req) {
        const map = new Map(Object.entries(req));
        map.set('__req', req.__req.toString(36));
        return PPHelp.encodeURLBody(map);
    }

    async parseReqBody(reqBody: nodeFetch.BodyInit, lastCursor: string) {
        const urlBody = PPHelp.parseURLEncodedBody(reqBody);
        const body = <any>{}
        for (const [k, v] of urlBody) {
            body[k] = v;
        }
        const variables: IVariables = JSON.parse(decodeURIComponent(body.variables))
        variables.count = 3;
        if (!_.isEmpty(lastCursor)) {
            variables.cursor = lastCursor;
        }

        body.variables = encodeURIComponent(JSON.stringify(variables));
        return body;
    }
}
