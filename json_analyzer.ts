import * as fs from 'fs';
import * as _ from 'lodash';

class Program {
    static async main() {
        const json = JSON.parse(fs.readFileSync('./data/fetch.json').toString());
        const require: any[][] = _.get(json, 'content.payload.jsmods.require');
        // const hasItem = require.filter(r => this.hasProp(r, 'item'));
        // console.log(JSON.stringify(hasItem));
        const hasItem = require.filter(r => r[0] == 'ReactRenderer' && r[1] == 'constructAndRenderComponent');
        console.log(JSON.stringify(hasItem));

        return 0;
    }

    static hasProp(obj: any, prop: string): boolean {
        if (!obj) return false;
        if (_.isArray(obj)) {
            return obj.find(e => this.hasProp(e, prop)) != null;
        }

        if (_.isObject(obj)) {
            if (obj[prop] !== undefined) return true;
            return _.keys(obj).find(k => this.hasProp(obj[k], prop)) != null;
        }

        return false;
    }
}

Program.main();