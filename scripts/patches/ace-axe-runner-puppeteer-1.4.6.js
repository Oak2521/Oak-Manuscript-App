'use strict';

// Oak Manuscript controlled replacement for
// @daisy/ace-axe-runner-puppeteer@1.4.6/lib/index.js.
//
// The replacement is staged only after the upstream file hash is verified. It
// keeps the public runner API while isolating author XHTML from executable
// author code and from paths/protocols outside the extracted EPUB directory.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fileURLToPath } = require('node:url');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const puppeteer = require('puppeteer');
const utils = require('@daisy/puppeteer-utils');

const CHROMIUM_SECURITY_ARGS = Object.freeze([
    '--disable-background-networking',
    '--disable-breakpad',
    '--disable-client-side-phishing-detection',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-domain-reliability',
    '--disable-extensions',
    '--disable-sync',
    '--host-resolver-rules=MAP * ~NOTFOUND',
    '--metrics-recording-only',
    '--no-first-run',
    '--no-pings',
    '--safebrowsing-disable-auto-update',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
]);
const ALLOWED_NON_FILE_PROTOCOLS = new Set(['about:', 'blob:', 'data:']);
const DANGEROUS_ELEMENT_NAMES = new Set([
    'base',
    'embed',
    'iframe',
    'object',
    'script',
]);
const DANGEROUS_URL_PROTOCOL_PATTERN = /^\s*(?:javascript|vbscript)\s*:/i;
const AUTHOR_DOCUMENT_CSP = [
    "default-src 'none'",
    "base-uri 'none'",
    "connect-src 'none'",
    "font-src file: data:",
    "form-action 'none'",
    "frame-src 'none'",
    "img-src file: data: blob:",
    "media-src file: data: blob:",
    "object-src 'none'",
    "script-src 'unsafe-inline' file:",
    "style-src 'unsafe-inline' file: data:",
].join('; ');

let browser;

const isDev = process && process.env
    && (process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true');

function positiveIntegerEnvironment(name, fallback) {
    const raw = process && process.env ? process.env[name] : undefined;
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const MILLISECONDS_TIMEOUT_INITIAL = positiveIntegerEnvironment('ACE_TIMEOUT_INITIAL', 5000);
const MILLISECONDS_TIMEOUT_EXTENSION = positiveIntegerEnvironment('ACE_TIMEOUT_EXTENSION', 240000);
let cliOptionMillisecondsTimeoutExtension;

function nodeLocalName(node) {
    return String(node.localName || node.nodeName || '')
        .replace(/^.*:/, '')
        .toLowerCase();
}

function attributeLocalName(attribute) {
    return String(attribute.localName || attribute.name || '')
        .replace(/^.*:/, '')
        .toLowerCase();
}

function isBlockedMetaDirective(element) {
    if (nodeLocalName(element) !== 'meta') return false;
    for (let index = 0; index < element.attributes.length; index += 1) {
        const attribute = element.attributes.item(index);
        if (attributeLocalName(attribute) === 'http-equiv') {
            const directive = String(attribute.value || '').trim().toLowerCase();
            return directive === 'refresh' || directive === 'content-security-policy';
        }
    }
    return false;
}

function sanitizeAuthorDocument(source) {
    const parser = new DOMParser({
        onError(level, message) {
            if (level === 'error' || level === 'fatalError') {
                throw new Error(`Author XHTML parse failure: ${message}`);
            }
        },
    });
    const document = parser.parseFromString(String(source), 'application/xhtml+xml');
    if (!document || !document.documentElement) {
        throw new Error('Author XHTML parse failure: missing document element');
    }

    const elements = [];
    const allElements = document.getElementsByTagName('*');
    for (let index = 0; index < allElements.length; index += 1) {
        elements.push(allElements.item(index));
    }
    for (const element of elements) {
        if (!element || !element.parentNode) continue;
        if (DANGEROUS_ELEMENT_NAMES.has(nodeLocalName(element))
            || isBlockedMetaDirective(element)) {
            element.parentNode.removeChild(element);
            continue;
        }
        for (let index = element.attributes.length - 1; index >= 0; index -= 1) {
            const attribute = element.attributes.item(index);
            const name = attributeLocalName(attribute);
            const value = String(attribute.value || '');
            if (name.startsWith('on') || DANGEROUS_URL_PROTOCOL_PATTERN.test(value)) {
                element.removeAttributeNode(attribute);
            }
        }
    }
    // XSLT processing instructions can synthesize executable DOM after this
    // sanitizer. EPUB XHTML does not need processing instructions at runtime.
    const processingInstructions = [];
    const pendingNodes = [document];
    while (pendingNodes.length > 0) {
        const node = pendingNodes.pop();
        for (let child = node.firstChild; child; child = child.nextSibling) {
            if (child.nodeType === 7) processingInstructions.push(child);
            else pendingNodes.push(child);
        }
    }
    for (const instruction of processingInstructions) {
        if (instruction.parentNode) instruction.parentNode.removeChild(instruction);
    }
    return new XMLSerializer().serializeToString(document);
}

function isPathWithin(base, candidate) {
    const relative = path.relative(base, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveAllowedFileUrl(rawUrl, canonicalBaseDirectory) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch (_error) {
        return null;
    }
    if (parsed.protocol !== 'file:') return null;
    let lexicalCandidate;
    try {
        lexicalCandidate = path.resolve(fileURLToPath(parsed));
    } catch (_error) {
        return null;
    }
    // Reject lexical escapes before touching the filesystem. In particular,
    // never call realpath on an attacker-controlled UNC/network path.
    if (!isPathWithin(canonicalBaseDirectory, lexicalCandidate)) return null;
    let candidate;
    try {
        candidate = fs.realpathSync(lexicalCandidate);
    } catch (_error) {
        return null;
    }
    return isPathWithin(canonicalBaseDirectory, candidate) ? candidate : null;
}

function allowedNonFileProtocol(rawUrl) {
    try {
        return ALLOWED_NON_FILE_PROTOCOLS.has(new URL(rawUrl).protocol);
    } catch (_error) {
        return false;
    }
}

async function settleIntercept(request, action, options) {
    try {
        if (request.isInterceptResolutionHandled && request.isInterceptResolutionHandled()) return;
        await request[action](options);
    } catch (error) {
        if (isDev) console.log(`Ace request ${action} failed: ${error.message}`);
    }
}

async function handleRequest(request, canonicalBaseDirectory) {
    const requestUrl = request.url();
    const allowedFile = resolveAllowedFileUrl(requestUrl, canonicalBaseDirectory);
    if (allowedFile) {
        if (request.resourceType() !== 'document') {
            await settleIntercept(request, 'continue');
            return;
        }
        try {
            const source = await fs.promises.readFile(allowedFile, 'utf8');
            const sanitized = sanitizeAuthorDocument(source);
            await settleIntercept(request, 'respond', {
                status: 200,
                contentType: 'application/xhtml+xml',
                headers: {
                    'Cache-Control': 'no-store',
                    'Content-Security-Policy': AUTHOR_DOCUMENT_CSP,
                },
                body: sanitized,
            });
        } catch (error) {
            if (isDev) console.log(`Ace author document rejected: ${error.message}`);
            await settleIntercept(request, 'abort', 'blockedbyclient');
        }
        return;
    }
    if (allowedNonFileProtocol(requestUrl)) {
        await settleIntercept(request, 'continue');
        return;
    }
    if (isDev) console.log(`Ace request blocked (${request.resourceType()}): ${requestUrl}`);
    await settleIntercept(request, 'abort', 'blockedbyclient');
}

module.exports = {
    setTimeout(ms) {
        const parsed = Number.parseInt(ms, 10);
        if (Number.isSafeInteger(parsed) && parsed > 0) {
            cliOptionMillisecondsTimeoutExtension = parsed;
        }
    },
    concurrency: 4,
    async launch() {
        const args = [...CHROMIUM_SECURITY_ARGS];
        // Windows and macOS retain Chromium's sandbox. Unsupported Unix hosts
        // keep upstream compatibility; formal builds remain Windows/macOS only.
        if (os.platform() !== 'win32' && os.platform() !== 'darwin') {
            args.push('--no-sandbox');
            args.push('--disable-setuid-sandbox');
        }
        browser = await puppeteer.launch({
            args,
            headless: true,
            timeout: MILLISECONDS_TIMEOUT_INITIAL,
            protocolTimeout: cliOptionMillisecondsTimeoutExtension
                || MILLISECONDS_TIMEOUT_EXTENSION,
        });
    },
    async close() {
        if (browser) await browser.close();
        browser = undefined;
    },
    async run(url, scripts, scriptContents, basedir) {
        if (!browser) throw new Error('Ace browser is not running');
        const canonicalBaseDirectory = fs.realpathSync(basedir);
        if (!fs.statSync(canonicalBaseDirectory).isDirectory()) {
            throw new Error('Ace basedir is not a directory');
        }
        if (!resolveAllowedFileUrl(url, canonicalBaseDirectory)) {
            throw new Error('Ace document URL escapes the controlled EPUB directory');
        }

        const page = await browser.newPage();
        try {
            if (isDev) page.on('console', message => console.log(message.text()));
            await page.setBypassServiceWorker(true);
            await page.setJavaScriptEnabled(false);
            await page.setRequestInterception(true);
            page.on('request', request => {
                void handleRequest(request, canonicalBaseDirectory).catch(async error => {
                    if (isDev) console.log(`Ace request handler rejected: ${error.message}`);
                    await settleIntercept(request, 'abort', 'blockedbyclient');
                });
            });

            await page.goto(url, { waitUntil: 'load' });
            await page.setJavaScriptEnabled(true);
            await utils.addScriptContents(scriptContents, page);
            await utils.addScripts(scripts, page);

            try {
                return await page.evaluate(() => new Promise((resolve, reject) => {
                    /* eslint-disable */
                    try {
                        window.tryAceAxe = () => {
                            if (!window.daisy || !window.daisy.ace || !window.daisy.ace.run
                                || !window.daisy.ace.createReport || !window.axe) {
                                window.tryAceAxeN++;
                                if (window.tryAceAxeN < 15) {
                                    setTimeout(window.tryAceAxe, 400);
                                    return;
                                }
                                reject('window.tryAceAxe ' + window.tryAceAxeN);
                                return;
                            }
                            window.daisy.ace.run((error, result) => {
                                if (error) {
                                    reject(error);
                                    return;
                                }
                                resolve(result);
                            });
                        };
                        window.tryAceAxeN = 0;
                        window.tryAceAxe();
                    } catch (error) {
                        reject(error);
                    }
                    /* eslint-enable */
                }));
            } catch (error) {
                if (error && error.toString
                    && error.toString().includes('protocolTimeout')) {
                    throw new Error(`Timeout :( ${cliOptionMillisecondsTimeoutExtension
                        || MILLISECONDS_TIMEOUT_EXTENSION}ms`);
                }
                throw error;
            }
        } finally {
            await page.close();
        }
    },
    __oakSecurity: Object.freeze({
        ALLOWED_NON_FILE_PROTOCOLS,
        CHROMIUM_SECURITY_ARGS,
        allowedNonFileProtocol,
        handleRequest,
        isPathWithin,
        resolveAllowedFileUrl,
        sanitizeAuthorDocument,
    }),
};
