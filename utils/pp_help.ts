import * as pp from 'puppeteer';
import hera from './hera';

export class PPHelp {
    static inject$(page: pp.Page) {
        return page.addScriptTag({path: require.resolve('jquery')});        
    }
    
    static parseURLEncodedBody(body: any) {
        const fieldsData: string[] = body.toString().split('&');
        const fields = fieldsData.map(f => f.split('='));
        return hera.arrToMap(fields, f => f[0], f => f[1]);
    }

    static encodeURLBody(body: Map<string, any>) {
        const fields = [];
        for (const [k, v] of body) {
            fields.push([k, v].filter(e => !hera.isEmpty(e)).join('='));
        }

        return fields.join('&');
    }

    static extractQS(urlWithQS: string): [string, Map<string, any>] {
        const [url, _qs] = urlWithQS.split('?');
        return [url, this.parseURLEncodedBody(_qs)];
    }

    static urlWithQS(url: string, qs: Map<string, any>) {
        return [url, this.encodeURLBody(qs)].join('?');
    }
}