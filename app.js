import './commons/JExtensions';
import ms from 'ms';
import http from 'http';
import path from 'path';
import moment from 'moment';
import mkdirp from 'mkdirp';
import log4js from 'log4js';
import config from './config';
import express from 'express';
import socketIO from 'socket.io';
import Utils from './commons/Utils';
import { handleSocketConnection, registerSocketRequestHendler } from './app/request';

import { ready as mailReady } from './controllers/mail';
import { ready as authReady } from './controllers/auth';
import { ready as regionReady } from './controllers/region';
import { ready as subscrReady } from './controllers/subscr';
import { ready as settingsReady } from './controllers/settings';
import * as routes from './controllers/routes';
import * as ourMiddlewares from './controllers/middleware';

import connectDb from './controllers/connection';
import './models/_initValues';
import './controllers/systemjs';
// import './basepatch/v1.3.0.6';

export async function configure(startStamp) {
    const {
        env,
        logPath,
        storePath,
        manualGarbageCollect,
        listen: {
            hostname
        },
        core: {
            hostname: coreHostname,
            port: corePort
        }
    } = config;

    mkdirp.sync(path.join(storePath, 'incoming'));
    mkdirp.sync(path.join(storePath, 'private'));
    mkdirp.sync(path.join(storePath, 'protected/photos'));
    mkdirp.sync(path.join(storePath, 'public/avatars'));
    mkdirp.sync(path.join(storePath, 'public/photos'));

    const logger = log4js.getLogger('app');
    const logger404 = log4js.getLogger('404.js');

    logger.info('Application Hash: ' + config.hash);

    await connectDb({
        redis: config.redis,
        mongo: { uri: config.mongo.connection, poolSize: config.mongo.pool },
        logger
    });

    const status404Text = http.STATUS_CODES[404];
    const static404 = ({ url, method, headers: { useragent, referer } = {} }, res) => {
        logger404.error(JSON.stringify({ url, method, useragent, referer }));

        res.statusCode = 404;
        res.end(status404Text); // Finish with 'end' instead of 'send', that there is no additional operations (etag)
    };

    moment.locale(config.lang); // Set global language for momentjs

    const app = express();
    app.disable('x-powered-by'); // Disable default X-Powered-By
    app.set('query parser', 'extended'); // Parse query with 'qs' module
    app.set('views', 'views');
    app.set('view engine', 'jade');

    // If we need user ip through req.ips(), it will return array from X-Forwarded-For with specified length.
    // https://github.com/visionmedia/express/blob/master/History.md#430--2014-05-21
    app.set('trust proxy', true);

    // Etag ('weak' by default), so browser will be able to specify it for request.
    // Thus if browser is allowed to cache with Cache-Control header, it'll send etag in request header,
    // and if generated response have same etag, server will return 304 without content (browser will get it from cache)
    app.set('etag', 'weak');

    // Enable chache of temlates in production
    // It reduce rendering time (and correspondingly 'waiting' time of client request) dramatically
    if (env === 'development') {
        app.disable('view cache'); // In dev disable this, so we able to edit jade templates without server reload
    } else {
        app.enable('view cache');
    }

    // Set an object which properties will be available from all jade-templates as global variables
    Object.assign(app.locals, {
        pretty: false, // Adds whitespace to the resulting html to make it easier for a human to read
        compileDebug: false, // Include the function source in the compiled template for better error messages
        debug: false, // If set to true, the tokens and function body is logged to stdoutl (in development).
        config
    });

    // Alias for photos with cid from root. /5 -> /p/5
    app.get(/^\/(\d{1,7})$/, function (req, res) {
        res.redirect(303, '/p/' + req.params[0]);
    });

    app.use(ourMiddlewares.responseHeaderHook());

    if (config.gzip) {
        app.use(require('compression')());
    }

    if (config.servePublic) {
        const pub = path.resolve('./public');

        if (env === 'development') {
            const lessMiddleware = require('less-middleware');
            app.use('/style', lessMiddleware(path.join(pub, 'style'), {
                force: true,
                once: false,
                debug: false,
                compiler: {
                    compress: false,
                    yuicompress: false,
                    sourceMap: true,
                    sourceMapRootpath: '/',
                    sourceMapBasepath: pub
                },
                parser: { dumpLineNumbers: 0, optimization: 0 }
            }));
        }

        // Favicon need to be placed before static, because it will written from disc once and will be cached
        // It would be served even on next step (at static), but in this case it would be written from disc on every req
        app.use(require('serve-favicon')(
            path.join(pub, 'favicon.ico'), { maxAge: ms(env === 'development' ? '1s' : '2d') })
        );

        app.use(express.static(pub, { maxAge: ms(env === 'development' ? '1s' : '2d'), etag: false }));

        // Seal static paths, ie request that achieve this handler will receive 404
        app.get(/^\/(?:img|js|style)(?:\/.*)$/, static404);
    }
    if (config.serveStore) {
        app.use('/_a/', ourMiddlewares.serveImages(path.join(storePath, 'public/avatars/'), { maxAge: ms('2d') }));
        app.use('/_p/', ourMiddlewares.serveImages(path.join(storePath, 'public/photos/'), { maxAge: ms('7d') }));
        app.use('/_pr/', ourMiddlewares.serveImages(path.join(storePath, 'protected/photos/'), { maxAge: ms('7d') }));

        // Replace unfound avatars with default one
        app.get('/_a/d/*', function (req, res) {
            res.redirect(302, '/img/caps/avatar.png');
        });
        app.get('/_a/h/*', function (req, res) {
            res.redirect(302, '/img/caps/avatarth.png');
        });

        // Seal store paths, ie request that achieve this handler will receive 404
        app.get(/^\/(?:_a|_p)(?:\/.*)$/, static404);
    }
    if (config.serveProtected) {
        const imageServer = ourMiddlewares.serveImages(path.join(storePath, 'protected/photos/'), { maxAge: ms('1d') });
        app.use('/_pr/', function (req, res, next) {
            //imageServer
        }, ourMiddlewares.serveImages(path.join(storePath, 'protected/photos/'), { maxAge: ms('1d') }));

        // Seal store paths, ie request that achieve this handler will receive 404
        app.get(/^\/(?:_pr)(?:\/.*)$/, static404);
    }


    await Promise.all([authReady, settingsReady, regionReady, subscrReady, mailReady]);

    const httpServer = http.createServer(app);
    const io = socketIO(httpServer, {
        transports: ['websocket', 'polling'],
        path: '/socket.io',
        serveClient: false
    });

    // Set zero for unlimited listeners
    // http://nodejs.org/docs/latest/api/events.html#events_emitter_setmaxlisteners_n
    httpServer.setMaxListeners(0);
    io.sockets.setMaxListeners(0);
    process.setMaxListeners(0);

    io.use(handleSocketConnection); // Handler for esteblishing websocket connection
    registerSocketRequestHendler(io); // Register router for socket.io events

    if (env === 'development') {
        require('./controllers/tpl').loadController(app);
    }

    if (config.serveLog) {
        app.use(
            '/nodelog',
            require('basic-auth-connect')(config.serveLogAuth.user, config.serveLogAuth.pass),
            require('serve-index')(logPath, { icons: true }),
            express.static(logPath, { maxAge: 0, etag: false })
        );
    }

    // Handle appliaction routes
    routes.bindRoutes(app);

    // Handle route (express) errors
    routes.bindErrorHandler(app);

    const CoreServer = require('./controllers/coreadapter').Server;

    const manualGC = manualGarbageCollect && global.gc;

    if (manualGC) {
        // Call the garbage collector after a certain time
        logger.info(`Manual garbage collection every ${manualGarbageCollect / 1000}s`);
    }

    const scheduleMemInfo = (function () {
        const INTERVAL = manualGC ? manualGarbageCollect : ms('30s');

        function memInfo() {
            let memory = process.memoryUsage();
            let elapsedMs = Date.now() - startStamp;
            let elapsedDays = Math.floor(elapsedMs / Utils.times.msDay);

            if (elapsedDays) {
                elapsedMs -= elapsedDays * Utils.times.msDay;
            }

            logger.info(
                `+${elapsedDays}.${Utils.hh_mm_ss(elapsedMs, true)} `,
                `rss: ${Utils.format.fileSize(memory.rss)}`,
                `heapUsed: ${Utils.format.fileSize(memory.heapUsed)},`,
                `heapTotal: ${Utils.format.fileSize(memory.heapTotal)}`,
                manualGC ? '-> Starting GC' : ''
            );

            if (manualGC) {
                const start = Date.now();

                global.gc(); // Вызываем gc

                memory = process.memoryUsage();
                elapsedMs = Date.now() - startStamp;
                elapsedDays = Math.floor(elapsedMs / Utils.times.msDay);

                logger.info(
                    `+${elapsedDays}.${Utils.hh_mm_ss(elapsedMs, true)} `,
                    `rss: ${Utils.format.fileSize(memory.rss)}`,
                    `heapUsed: ${Utils.format.fileSize(memory.heapUsed)},`,
                    `heapTotal: ${Utils.format.fileSize(memory.heapTotal)}`,
                    `Garbage collected in ${(Date.now() - start) / 1000}s`
                );
            }

            scheduleMemInfo();
        }

        return function (delta = 0) {
            setTimeout(memInfo, INTERVAL + delta);
        };
    }());

    new CoreServer(corePort, coreHostname, function () {
        httpServer.listen(config.listen.port, hostname, function () {
            logger.info(`servePublic: ${config.servePublic}, serveStore ${config.serveStore}`);
            logger.info(`Host for users: [${config.client.host}]`);
            logger.info(`Core server listening [${coreHostname || '*'}:${corePort}]`);
            logger.info(
                `HTTP server started up in ${(Date.now() - startStamp) / 1000}s`,
                `and listening [${hostname || '*'}:${config.listen.port}]`,
                config.gzip ? `with gzip` : '',
                '\n'
            );

            scheduleMemInfo(startStamp - Date.now());
        });
    });
};