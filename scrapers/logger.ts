export interface IScrapeLogger {
    log(msg: any, ctx?: any);
    debug(msg: any, ctx?: any);
    error(err: Error, ctx?: any);
}