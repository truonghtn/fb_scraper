import * as path from 'path';
import * as express from 'express';
import * as bodyParser from 'body-parser';
import * as mongodb from 'mongodb';
import * as moment from 'moment';
import * as _ from 'lodash';
import * as rmq from 'amqplib';
import * as minimist from 'minimist';

import { hera, AppLogicError } from './utils/hera';
import { RMQRPC } from './utils/rmq_rpc';
import { HC } from './glob/hc';


class Program {
  public static async main(): Promise<number> {
    const args = minimist(process.argv.slice(2));
    const configFile = args.config;
    if (!configFile) throw new Error('Config file must be set');

    const config = require(path.resolve(process.cwd(), configFile));
    const port = hera.parseInt(config.port, 10, 3816);
    const amqp = config.rmq || 'amqp://127.0.0.1';
    const queue = config.queue || 'scraper_reqs';
    const mongo = config.mongo || 'mongodb://localhost:27017';

    const server = express();
    server.use(bodyParser.json());

    const rmqConn = await rmq.connect({
      hostname: '127.0.0.1'
    });
    const channel = await rmqConn.createChannel();
    const rpc = new RMQRPC(channel, `http_rpc_${port}`);
    rpc.defaultTimeout = 5 * 60 * 1000; // 5 mins
    await rpc.init();
    await channel.checkQueue(queue);

    const mongoClient = await mongodb.MongoClient.connect(mongo);
    const db = mongoClient.db('fb_scrapers');

    server.all('*', (req, resp, next) => {
      console.log(`${req.method} ${req.url}`);
      if (req.body) {
        console.log(JSON.stringify(req.body, null, 2));
      }

      next();
    });

    server.post('/scrapes/fb_comment', hera.routeAsync(async (req) => {
      const comments: any[] = req.body.comments;
      comments.map(fid => {
        // if (!hera.isURL(url) || !url.includes('facebook')) throw new AppLogicError('Cannot scrape fb like! Invalid URL', 400);
        const msg = {
          type: "comment_api",
          fid
        };
        rpc.send(queue, Buffer.from(JSON.stringify(msg)));
      })

      return HC.SUCCESS;
    }));

    server.post('/scrapes/fb_like', hera.routeAsync(async (req) => {
      const likes: any[] = req.body.likes;

      likes.map(fid => {
        // if (!hera.isURL(url) || !url.includes('facebook')) throw new AppLogicError('Cannot scrape fb like! Invalid URL', 400);
        const msg = {
          type: "fb_n_like_api",
          postId: fid
        };
        rpc.send(queue, Buffer.from(JSON.stringify(msg)));
      })

      return HC.SUCCESS
    }));

    server.post('/scrapes/fb_post', hera.routeAsync(async (req) => {
      const posts: any[] = req.body.posts;
      posts.map(pageId => {
        const msg = {
          type: "ad_api",
          pageId
        };
        rpc.send(queue, Buffer.from(JSON.stringify(msg)));
      })

      return HC.SUCCESS
    }));

    server.get('/comments/:fid', hera.routeAsync(async (req) => {
      const fid = req.params.fid;
      const commentColl = db.collection('comment');
      const comments = await commentColl.find({ fentid: fid }).toArray();
      return comments;
    }))

    server.get('/posts/:pageid', hera.routeAsync(async (req) => {
      const fid = req.params.pageid;
      const postsColl = db.collection('posts');
      const likesColl = db.collection('likes');
      const commentsColl = db.collection('comments');

      const posts = await postsColl.find({}).toArray();
      const postsData = await Promise.all(posts.map(async (p) => {
        const like = await likesColl.findOne({ pid: p.pid });
        const comment = await commentsColl.findOne({ pid: p.pid })

        return {
          pid: p.pid,
          content: p.content,
          nlikes: _.get(like, 'nlikes'),
          ncomments: _.get(comment, 'nComments')
        }
      }))
      return postsData;
    }))

    server.get('/profiles/:fids', hera.routeAsync(async (req) => {
      const fids: string[] = req.params.fids.split(',');
      const profileColl = db.collection('profile');
      const profiles = await profileColl.find({ id: { $in: fids } }).toArray();
      return profiles;
    }));

    server.post('/scrapes/reqs', hera.routeAsync(async (req) => {
      req.setTimeout(10 * 60 * 1000, undefined);
      const msg = req.body;

      const resp = await rpc.send(queue, Buffer.from(JSON.stringify(msg)));
      return JSON.parse(resp.content.toString());
    }));

    // Start server
    server.listen(port, function () {
      console.log(`Listening on port ${port}...`);
    });

    return 0;
  }
}

Program.main().then(() => console.log('FINISHED')).catch(err => console.error(err));