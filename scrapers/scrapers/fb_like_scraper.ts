import * as pp from 'puppeteer';
import * as _ from 'lodash';
import * as nodeFetch from 'node-fetch';
import * as moment from 'moment';
import hera from '../../utils/hera';
import * as cheerio from 'cheerio';

import { IScraper } from '../base_scraper';
import { IScrapeRequest } from '../request';
import { PPInterceptor, PPIRequestData } from '../../utils/pp_interceptor';
import { PPHelp } from '../../utils/pp_help';
import { IPPPageFactory } from '../pages/page_factory';
import { IScrapeLogger } from '../logger';
import { IScrapeCollector } from '../collector';
import { ScrapeObjectProvider, IProviderRepository } from '../provider';
import { newAjv2 } from '../../utils/ajv2';
import { ConsoleScrapeCollector } from '../collectors/console';
import { ConsoleLogger } from '../loggers/console';
import SafeContainer from '../../utils/safe_container';
import { IFBIdGetter, PPFBIdGetter } from '../miscs/fb_id_getter';

// https://www.facebook.com/gorgeous.side/posts/1931629513525582
export class FBLikeScraper implements IScraper {
	logger: IScrapeLogger = ConsoleLogger.INST;
	likeReq: SafeContainer<{ req: PPIRequestData, qs: Map<string, any> }> = new SafeContainer(() => hera.retry(() => this.refetchLikeReq(), 5), 3 * 60 * 60 * 1000);
	collector: IScrapeCollector = ConsoleScrapeCollector.INST;
	seeds: string[]

	constructor(
		private pageFactory: IPPPageFactory,
		private idGetter: IFBIdGetter,
		private fetchSize: number
	) { }

	async init() {
		await this.likeReq.acquire();
		await this.idGetter.init();
	}

	async refetchLikeReq() {
		let likeReq: PPIRequestData;

		const page = await this.pageFactory.newPage();
		await PPInterceptor.intercept(page,
			(req) => req.url().includes('/ufi/reaction/profile/dialog/'),
			(req) => {
				likeReq = req;
			},
			(req, resp) => { }
		);

		try {
			await page.setViewport({ width: 1366, height: 768 });
			await page.goto(_.sample(this.seeds), { waitUntil: 'networkidle2' });
			await PPHelp.inject$(page);

			await page.evaluate(() => $(`a[href*='/ufi'][rel=ignore]`)[0].click());
			await hera.waitFor(() => likeReq != null);
			const [url, qs] = PPHelp.extractQS(likeReq.url);
			return {
				req: likeReq,
				qs: qs
			};
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
		return req.data.type == "likes" && (_.isString(req.data.fid) || hera.isURL(req.data.url));
	}

	async scrape(req: IScrapeRequest): Promise<any> {
		const fid: string = _.isString(req.data.fid) ? req.data.fid : await this.idGetter.getId(req.data.url);
		const collectingPromises = [];
		const shownIds: string[] = [];
		// const ids = new Set<string>();

		try {
			const req = await this.likeReq.acquire();

			const html = await this.reqDialog(req.req, req.qs, fid);
			const dlgLikes = this.parseHTML(html);

			collectingPromises.push(hera.unboxPromise(this.collector.collect(...dlgLikes.profiles)));
			shownIds.push(...dlgLikes.profiles.map(p => p.id));
			// dlgLikes.profiles.forEach(p => ids.add(p.id));

			if (dlgLikes.total == 0) return {
				fid, nProfiles: shownIds.length
			};


			while (true) {
				const html = await this.reqFetch(req.req, req.qs, fid, shownIds, dlgLikes.total, this.fetchSize);
				const fetchedLikes = this.parseHTML(html);

				if (fetchedLikes.profiles.length <= 0) break;

				// const lastSize = ids.size;
				collectingPromises.push(hera.unboxPromise(this.collector.collect(...fetchedLikes.profiles)));
				shownIds.push(...fetchedLikes.profiles.map(p => p.id));
				// fetchedLikes.profiles.forEach(p => ids.add(p.id));

				this.logger.debug(`Fetched: ${fetchedLikes.profiles.length} likers (${shownIds.length} / ${dlgLikes.total})`);
				// this.logger.debug(`Duplicated: ${fetchedLikes.profiles.length - (ids.size - lastSize)}`);
			}
		}
		catch (err) {
			this.logger.error(err);
		}

		if (collectingPromises.length > 0) {
			try { await Promise.all(collectingPromises) } catch (err) { this.logger.error(err) }
		}

		return {
			fid, nProfiles: shownIds.length
		}
	}

	private async reqDialog(likeReq: PPIRequestData, dlgQS: Map<string, any>, fid: string) {
		const url = 'https://www.facebook.com/ufi/reaction/profile/dialog/';
		const qs = new Map();

		qs.set('ft_ent_identifier', fid);
		qs.set('__req', (hera.parseInt(qs.get('__req'), 10, 0) + 1).toString(36));
		['__asyncDialog', 'av', 'dpr', '__user', '__a', '__dyn', '__be', '__pc', '__rev', '__spin_r', '__spin_b', '__spin_t', 'ft[tn]'].forEach(f => qs.set(f, dlgQS.get(f)));

		const json = await this.reqURL(likeReq, PPHelp.urlWithQS(url, qs));
		const html = _.get(json, 'jsmods.markup.0.1.__html');
		return html;
		// if (!html) {
		//     return {profiles: [], total_count: 0};
		// }

		// return html;
	}

	private async reqFetch(likeReq: PPIRequestData, dlgQS: Map<string, any>, fid: string, shownIds: string[], totalLikes: number, nFetch: number) {
		const url = 'https://www.facebook.com/ufi/reaction/profile/browser/fetch/';
		const qs = new Map<string, any>();
		qs.set('limit', nFetch);
		qs.set('shown_ids', decodeURIComponent(shownIds.join(',')));
		qs.set('total_count', totalLikes);
		qs.set('ft_ent_identifier', fid);
		qs.set('ft[tn]', '-a');
		qs.set('__req', (hera.parseInt(qs.get('__req'), 10, 0) + 1).toString(36));
		['dpr', '__user', '__a', '__dyn', '__be', '__pc', '__rev', '__spin_r', '__spin_b', '__spin_t'].forEach(f => qs.set(f, dlgQS.get(f)));

		const json = await this.reqURL(likeReq, PPHelp.urlWithQS(url, qs));
		const html = _.get(json, 'domops.0.3.__html');
		return html;
	}

	private async reqURL(likeReq: PPIRequestData, url: string) {
		const resp = await nodeFetch.default(url, likeReq);
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

	private parseHTML(html: string) {
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

const ajv2 = newAjv2();

export class FBLikeScraperProvider extends ScrapeObjectProvider {
	readonly type = "SCRAPER";
	readonly name = "fb_likes";
	private readonly configValidator = ajv2({
		'+browser': {},
		'+collector': {},
		'@fetch_size': 'integer|>0',
        '+seeds': {
            'type': 'array',
            '@items': 'string',
            'minItems': 1
        }
	});

	init(): Promise<void> {
		return Promise.resolve();
	}

	assertConfig(config: any): void {
		if (!this.configValidator(config)) throw new Error(this.configValidator.errors.map(e => e.message).join('\n'));
	}

	async make(repo: IProviderRepository, config: any): Promise<any> {
		const pageFactory = await repo.make<IPPPageFactory>("PP_PAGE_FACTORY", config && config.browser);
		const fbIdGetter = new PPFBIdGetter(pageFactory);
		const fetchSize = hera.parseInt(config.fetch_size, 10, 100);
		const scraper = new FBLikeScraper(pageFactory, fbIdGetter, fetchSize);
		scraper.logger = await repo.make<IScrapeLogger>("LOGGER", config && config.logger);
		scraper.collector = await repo.make<IScrapeCollector>("COLLECTOR", config && config.collector);
		scraper.seeds = config.seeds;

		return scraper;
	}
}

export const provider = new FBLikeScraperProvider();
export default provider;