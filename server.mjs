import { readFile } from "node:fs";
import { IncomingMessage, ServerResponse, createServer } from "node:http";
import { extname, posix, resolve } from "node:path";

import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 
 * @param {ServerResponse<IncomingMessage>} response 
 * @param {String | Uint8Array} content 
 * @param {String} contentType 
 */
function sendOkResponse(response, content, contentType) {
    //
    // Headers to enable site isolation.
    // - https://fetch.spec.whatwg.org/#cross-origin-resource-policy-header
    // - https://www.w3.org/TR/post-spectre-webdev/#documents-isolated
    //
    const sameOriginPolicyHeaders = {
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff'
    };
    response.writeHead(200, Object.assign({ 'Content-Type': contentType, 'Content-Length': content.length }, sameOriginPolicyHeaders));
    response.end(content);
}

/**
 * 
 * @param {String} fileName 
 * @returns 
 */
function getContentType(fileName) {
    let contentType;
    switch (extname(fileName)) {
        case '.htm':
        case '.html': {
            contentType = 'text/html';
            break;
        }
        case '.mjs':
        case '.js': {
            contentType = 'text/javascript';
            break;
        }
        case '.css': {
            contentType = 'text/css';
            break;
        }
        case '.json': {
            contentType = 'application/json';
            break;
        }
        case '.png': {
            contentType = 'image/png';
            break;
        }
        case '.jpg': {
            contentType = 'image/jpg';
            break;
        }
        case '.gif': {
            contentType = 'image/gif';
            break;
        }
        case '.svg': {
            contentType = 'image/svg+xml';
            break;
        }
        case '.ico': {
            contentType = 'image/x-icon';
            break;
        }
        default: {
            contentType = 'application/octet-stream';
            break;
        }
    }
    return contentType;
}

/**
 * 
 * @param {IncomingMessage} request 
 * @param {ServerResponse<IncomingMessage>} response 
 * @returns 
 */
function handler(request, response) {
    if (!request.url) {
        return;
    }
    /*
    const isValidOrigin = this.checkHttpOrigin(request, response)
    if (!isValidOrigin) {
        return
    }
    */
    if (request.method === 'POST') {
        //        request.setEncoding('utf8')
        console.log(JSON.stringify(request.headers));
        request.on('data', (chunk) => {
            console.log(`BODY: ${chunk}`);
        });
        sendOkResponse(response, Buffer.from('posted'), 'text/html');
        return;
    }
    let root = __dirname;
    //
    // Prevent directory traversal attack.
    // - https://en.wikipedia.org/wiki/Directory_traversal_attack
    //
    const reqFileName = posix.resolve('/', request.url.split('?')[0]);
    const fileName = resolve(root, '.' + reqFileName);
    let contentType = getContentType(fileName);
    readFile(fileName, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                response.writeHead(404);
            }
            else {
                response.writeHead(500);
            }
            response.end();
        }
        else {
            sendOkResponse(response, content, contentType);
        }
    });
}

const httpServer = createServer((request, response) => handler(request, response));
httpServer.listen(2222, '127.0.0.1', undefined, async () => { });
