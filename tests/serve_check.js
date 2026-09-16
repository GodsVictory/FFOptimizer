/**
 * HTTP server verification test: checks that index.html and all assets load with 200 OK.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 0; // Dynamic ephemeral port to prevent collisions
const ROOT = path.join(__dirname, '..');

const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json'
};

const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/') reqPath = '/index.html';

    const filePath = path.join(ROOT, reqPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end('Not Found');
        return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, async () => {
    const actualPort = server.address().port;
    console.log(`[+] Static test server listening on http://localhost:${actualPort}`);

    const assetsToTest = [
        '/',
        '/index.html',
        '/css/app.css',
        '/js/config.js',
        '/js/playerMatcher.js',
        '/js/services/fantasyProsService.js',
        '/js/services/sleeperService.js',
        '/js/services/espnService.js',
        '/js/services/yahooService.js',
        '/js/services/optimizerService.js',
        '/js/app.js',
        '/data/lastUpdatedAt.json',
        '/data/HALF-DST.json',
        '/data/HALF-FLX.json',
        '/data/HALF-QB.json',
        '/data/ROS-HALF-DST.json',
        '/data/ROS-HALF-FLX.json',
        '/data/ROS-PPR-QB.json'
    ];

    let allOk = true;
    for (const asset of assetsToTest) {
        await new Promise(resolve => {
            http.get(`http://localhost:${actualPort}${asset}`, (resp) => {
                if (resp.statusCode === 200) {
                    console.log(`    [200 OK] ${asset}`);
                } else {
                    console.error(`    [FAIL ${resp.statusCode}] ${asset}`);
                    allOk = false;
                }
                resp.resume();
                resolve();
            }).on('error', (e) => {
                console.error(`    [ERROR] ${asset}: ${e.message}`);
                allOk = false;
                resolve();
            });
        });
    }

    server.close(() => {
        console.log(`[+] Server closed.`);
        if (!allOk) {
            console.error('[-] Some assets failed to load!');
            process.exit(1);
        } else {
            console.log('[+] All assets loaded successfully with 200 OK!');
            process.exit(0);
        }
    });
});
