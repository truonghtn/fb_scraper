import * as nodeFetch from 'node-fetch';
import * as https from 'https';
import * as http from 'http';
import * as pp from 'puppeteer';
import { hera, BoxedPromise } from './hera';

const agent = new https.Agent({
    rejectUnauthorized: false
});

export interface URLFilter {
    (req: pp.Request): BoxedPromise<boolean>;
}

export interface PPIResponseData {
    body: Buffer;
    headers: any;
    status: number
}

export type PPIRequestData = nodeFetch.RequestInit & {url: string};

export interface RequestInterceptor {
    (req: PPIRequestData);
}

export interface ResponseInterceptor {
    (req: PPIRequestData, resp: PPIResponseData);
}

export class PPInterceptor {
    static async intercept(page: pp.Page, urlFilter: URLFilter, reqHook: RequestInterceptor, respHook: ResponseInterceptor) {
        const intercept = async (req: pp.Request, urlFilter: URLFilter, reqHook: RequestInterceptor, respHook: ResponseInterceptor) => {
    
            const isAccepted = await hera.unboxPromise(urlFilter(req));
            if (isAccepted) {
                try {
                    const cookiesList = await page.cookies(req.url());
                    const cookies = cookiesList.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
                    const headers = Object.assign(req.headers(), { cookie: cookies });
                    const init: PPIRequestData = {
                        url: req.url(),
                        headers: headers,
                        body: req.postData(),
                        method: req.method(),
                        follow: 20,
                        agent
                    };
        
                    reqHook(init);
                    const result = await nodeFetch.default(init.url, init);
        
                    const buffer = await result.buffer();
                    let cleanedHeaders = (<any>result.headers)._headers || {};
                    cleanedHeaders['content-security-policy'] = '';
                    const respData: PPIResponseData = {
                        body: buffer,
                        headers: cleanedHeaders,
                        status: result.status
                    };
                    respHook(init, respData);
                    await req.respond(respData);
                }
                catch (err) {
                    // ignore
                }
            } else {
                req.continue();
            }
        };
    
        await page.setRequestInterception(true);
        page.on('request', req => {
            intercept(req, urlFilter, reqHook, respHook);
        });

        return intercept;
    }
}