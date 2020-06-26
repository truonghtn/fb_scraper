import * as ajv from 'ajv';
import * as express from 'express';
import * as _ from 'lodash';
import * as glob from 'glob';

export type BoxedPromise<T> = T | Promise<T>;

export type ExpressAsyncRequestHandler = (req: express.Request, resp: express.Response) => Promise<any>;
export type ExpressSyncRequestHandler = (req: express.Request, resp: express.Response) => any;
export type ExpressRespHandler = (err?: any, data?: any) => void;
export type ExpressRespHandlerProvider = (req: express.Request, resp: express.Response) => ExpressRespHandler;

export interface IAppErrorResponse {
    message?: string;
    code?: string;
    params?: any;
}

export class AppApiResponse {

    constructor(success?: boolean) {
        this.success = success;
    }

    success: boolean;
    httpCode?: number;
    headers?: {[header: string]: string} = {}
    err?: IAppErrorResponse;
    data?: any;
}

export class AppLogicError extends Error {
    constructor(msg: string, public httpCode?: number, public params?: any) {
        super(msg); 
    }
}

export class Hera {
    DefaultRespHandlerProvider: ExpressRespHandlerProvider = this.defaultAppRespHandlerProvider;
    TimeTable = new Map<string, number>();

    routeAsync(reqHandler: ExpressAsyncRequestHandler, rhProvider?: ExpressRespHandlerProvider): express.RequestHandler {
        return (req, resp, next) => {
            const handler = (rhProvider || this.DefaultRespHandlerProvider)(req, resp);
            reqHandler(req, resp).then((data) => {
                if (data === undefined) {
                    next();
                }
                else {
                    handler(undefined, data);
                }
            }).catch((err) => {
                console.error(err);
                handler(err, undefined);
            });
        }
    }

    routeSync(reqHandler: ExpressSyncRequestHandler, rhProvider?: ExpressRespHandlerProvider): express.RequestHandler {
        return (req, resp, next) => {
            const handler = (rhProvider || this.DefaultRespHandlerProvider)(req, resp);
            try {
                const data = reqHandler(req, resp);
                if (data === undefined) {
                    next();
                }
                else {
                    handler(undefined, data);
                }
            }
            catch (err) {
                handler(err, undefined);
            }
        }
    }
    
    private defaultAppRespHandlerProvider(req: express.Request, resp: express.Response): ExpressRespHandler {
        return (err?: any, data?: any) => {
            let appResp = new AppApiResponse();
            if (err == undefined) {
                if (data instanceof AppApiResponse) {
                    appResp = data;
                }
                else {
                    appResp.success = true;
                    appResp.httpCode = 200;
                    appResp.data = data;
                }
            }
            else {
                appResp.success = false;
                appResp.err = {
                    message: err.message || 'Unknown error',
                    code: err.code,
                    params: err.params
                }
                appResp.httpCode = _.isNumber(err.httpCode) ? err.httpCode : 500;
                appResp.data = data;
            }

            // Remove http code from response body
            if (_.isNumber(appResp.httpCode)) {
                resp.statusCode = appResp.httpCode;
            }
            delete appResp.httpCode;

            // Remove headers from response body
            if (!_.isEmpty(appResp.headers)) {
                _.keys(appResp.headers).forEach(h => resp.setHeader(h, appResp.headers[h]));
            }
            delete appResp.headers;

            resp.send(appResp);
        };
    }

    validBody(validator: ajv.ValidateFunction): express.RequestHandler {
        return this.routeSync((req) => {
            if (!validator(req.body)) {
                throw new AppLogicError('Invalid request body!', 400, validator.errors);
            }
        });
    }

    validQuery(validator: ajv.ValidateFunction): express.RequestHandler {
        return this.routeSync((req) => {
            if (!validator(req.query)) {
                throw new AppLogicError('Invalid request query!', 400, validator.errors);
            }
        });
    }

    isValidEmailAddress(email: string) {
        var re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
        return re.test(email);
    }

    isValid(validator: ajv.ValidateFunction) {
        return (data) => {
            return !!validator(data);
        }
    }

    filterObj<V>(obj: Object, predicate: (k?: string, v?: V) => boolean) {
        return Object.keys(obj).filter(k => predicate(k, obj[k])).reduce((o, k) => {
            o[k] = obj[k];
            return o;
        }, {});
    }

    mapObj<V1, V2>(obj: Object, iterator: (k?: string, v?: V1) => V2) {
        return Object.keys(obj).reduce((o, k) => {
            o[k] = iterator(k, obj[k]);
            return o;
        }, <any>{});
    }

    notEmpty(data: any, isEmpty: (any)  => boolean = this.isEmpty, deep = false) {
        if (_.isArray(data)) {
            const filteredData = data.filter(d => !isEmpty(d));
            if (deep) {
                return filteredData.map(d => this.notEmpty(d, isEmpty, true));
            }

            return filteredData;
        }
        else if (_.isObject(data)) {
            const filteredObj = this.filterObj(data, (k, v) => !isEmpty(v));
            if (deep) {
                return this.mapObj(filteredObj, (k, v) => this.notEmpty(v, isEmpty, true));
            }

            return filteredObj;
        }

        return data;
    }

    get urlRegEx() {
        return /^([a-z]+)\:\/\/[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)$/;
    }

    isEmpty(obj?: any): boolean {
        return  ((obj == null || _.isNaN(obj) || obj === false) ||
                (_.isString(obj) && obj.length == 0) ||
                ((obj instanceof Array) && obj.length == 0) ||
                ((obj instanceof Object) && Object.keys(obj).length == 0));
    }

    isURL(s: string) {
        return s.match(this.urlRegEx).length > 0;
    }

    parseInt(val: any, radix?: number, defaultVal?: number): number {
        const n = parseInt(val, radix);
        if (isNaN(n)) {
            return defaultVal!;
        }

        return n;
    }

    parseFloat(val: any, defaultVal?: number): number {
        const x = parseFloat(val);
        if (isNaN(x)) {
            return defaultVal!;
        }

        return x;
    }

    time(label: string) {
        this.TimeTable.set(label, new Date().valueOf());
    }

    timeEnd(label: string) {
        const now = new Date().valueOf();
        const unix = this.TimeTable.get(label);
        this.TimeTable.delete(label);
        if (!unix) return;

        console.log(`${label}: ${now - unix}ms`)        
    }

    async unboxPromise<T>(val: BoxedPromise<T>) {
        return (val instanceof Promise) ? await val : val;
    }
    
    arrToMap<T, K, V>(arr: ArrayLike<T>, key: (t: T, idx?: number) => K, value: (t: T, idx?: number) => V): Map<K, V> {
        const map = new Map<K, V>();
        for (let i = 0; i < arr.length; ++i) {
            map.set(key(arr[i], i), value(arr[i], i));
        }

        return map;
    }

    sleep(timeout: number) {
        return new Promise<void>((res) => setTimeout(res, timeout));
    }

    extractString(str: string, from: string, to: string, withMarks: boolean = false) {
        if (!str) return undefined;
        
        let start = str.indexOf(from);
        if (start < 0) return undefined;

        let end = str.indexOf(to, start + from.length);
        if (end < 0) return undefined;

        if (!withMarks) {
            start = start + from.length;
            end = end - to.length;
        }
        
        return str.substr(start, end - start + 1);
    }

    async waitFor(f: () => BoxedPromise<boolean>, timeout: number = 30000, interval: number = 100) {
        const begin = new Date().valueOf();
        const timeOutAt = begin + timeout;
        while (true) {
            const result = await this.unboxPromise(f());
            if (result == true) return true;

            const now = new Date().valueOf();
            if (now >= timeOutAt) {
                throw new Error(`Waiting timed-out! ${timeout} ms passed!`);
            }

            await this.sleep(interval);
        }
    }

    glob(pattern: string): Promise<string[]> {
        return new Promise<string[]>((res, rej) => {
            glob(pattern, (err, matches) => err ? rej(err) : res(matches));
        })
    }

    async retry<T>(f: () => Promise<T>, n: number, delay: number = 0): Promise<T> {
        return this._retry(f, n, delay, []);
    }

    private async _retry<T>(f: () => Promise<T>, n: number, delay: number = 0, errs: Error[]) {
        if (n <= 0) {
            throw new Error(`Retry error! Errors:\n ${errs.map(e => `${e}`).join('\n')}`);
        }

        try {
            return await f();
        }
        catch (err) {
            await this.sleep(delay);
            errs.push(err);
            return await this._retry(f, n - 1, delay, errs);
        }
    }
}

export const hera = new Hera();
export default hera;