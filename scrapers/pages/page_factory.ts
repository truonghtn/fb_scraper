import * as pp from 'puppeteer';

export interface IPPPageFactory {
    newPage(): Promise<pp.Page>;
}