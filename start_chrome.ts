import * as path from 'path';
import * as pp from 'puppeteer';
import * as minimist from 'minimist';
import { hera } from './utils/hera';
import { RedisClient } from 'redis-ts';

class Program {
    static async main() {
        const args = minimist(process.argv.slice(2));
        const configFile = args.config;
        if (!configFile) throw new Error('Config file must be set!');

        const config = require(path.resolve(process.cwd(), configFile));
        const username: string = config.username;
        const password: string = config.password;

        if (hera.isEmpty(username) || hera.isEmpty(password)) {
            throw new Error('Cannot start browser! FB accoutn must be set');
        }

        const redisKey = config.redisKey;
        if (hera.isEmpty(redisKey)) {
            throw new Error('Cannot start browser! Redis key must be set');
        }

        const redisConnStr = config.redis;
        const redis = new RedisClient(redisConnStr);
        const key = redis.child(redisKey);
        await key.scard(); // ping test
    
        const browser = await pp.launch(config.puppeteer);
        console.log(browser.wsEndpoint());

        const page = await browser.newPage();
        try {
            await this.login(page, username, password);
            console.log('Facebook login successfully!!');
        }
        catch (err) {
            console.error(err);
            console.log(`Facebook login failed!`);
        }

        await page.screenshot({path: __dirname + '/../data/fb_login_debug.png'});
        await page.close();

        const ret = await key.sadd(browser.wsEndpoint());
        console.log(`Browser connection is already added into key ${key.key} - ${ret}`);
    }

    static async login(page: pp.Page, username: string, pass: string) {
        console.log(`${username}: ${pass}`);
        await page.goto('https://facebook.com', {waitUntil: 'networkidle2'});
        await page.addScriptTag({path: require.resolve('jquery')});
        
        await page.focus('#email');
        await page.type('#email', `${username}`);
        await page.focus('#pass');
        await page.type('#pass', `${pass}`);
        await page.click('#loginbutton input');

        await page.waitForNavigation({waitUntil: 'load'});
        await page.waitFor(500);

        try {
            await page.waitForSelector('#pagelet_navigation', {timeout: 3000});
        }
        catch (err) {
            throw new Error('Login failed')!
        }
    }
}

Program.main();