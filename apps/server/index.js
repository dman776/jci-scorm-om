// @ts-check
/**
 * Authoring app server. Built-in node:http only (no framework), per the
 * ship-now stack. Serves the vanilla-JS authoring UI, the JSON API, the live
 * Preview runtime (assembled from the same template used for export), the
 * Excel template + import, and the SCORM publish/download.
 *
 * The business logic all lives in the workspace packages; this file is thin
 * glue and can be replaced by Express/Fastify without touching those packages.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

import { blankWorkbook } from '@sowb/shared';
import { validateWorkbook, estimateWorstCaseSuspend, publishWorkbook, listTargets } from '@sowb/export-service';
import { assembleRuntime } from '@sowb/scorm-runtime';
import { buildTemplateXlsx, importWorkbookXlsx } from '@sowb/excel-io/workbook-xlsx.js';

import { listWorkbooks, getWorkbook, saveWorkbook, deleteWorkbook } from './store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const WEB_DIR = join(ROOT, 'apps', 'web');
const MOCK_LMS_FILE = join(ROOT, 'packages', 'mock-lms', 'index.js');

const PORT = process.env.PORT || 4173;
const HOST = process.env.HOST || '127.0.0.1';

/** In-memory workbook currently loaded into the Preview. */
let previewWorkbook = null;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = decodeURIComponent(url.pathname);
    if (path.startsWith('/api/')) return await handleApi(req, res, path, url);
    if (path.startsWith('/preview/')) return await handlePreview(req, res, path);
    return await serveStatic(res, path);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: String((err && err.message) || err) });
  }
});

// ---- API -----------------------------------------------------------------

async function handleApi(req, res, path, url) {
  if (path === '/api/workbooks' && req.method === 'GET') {
    return sendJson(res, 200, await listWorkbooks());
  }
  if (path === '/api/workbooks' && req.method === 'POST') {
    const wb = await readBodyJson(req);
    return sendJson(res, 200, await saveWorkbook(wb));
  }
  if (path === '/api/workbooks/new' && req.method === 'GET') {
    return sendJson(res, 200, blankWorkbook());
  }
  const wbMatch = /^\/api\/workbooks\/([^/]+)$/.exec(path);
  if (wbMatch) {
    const id = wbMatch[1];
    if (req.method === 'GET') {
      const wb = await getWorkbook(id);
      return wb ? sendJson(res, 200, wb) : sendJson(res, 404, { error: 'Not found' });
    }
    if (req.method === 'DELETE') {
      return sendJson(res, 200, { deleted: await deleteWorkbook(id) });
    }
  }

  if (path === '/api/validate' && req.method === 'POST') {
    const wb = await readBodyJson(req);
    const estimatedSuspendSize = estimateWorstCaseSuspend(wb);
    const report = validateWorkbook(wb, { estimatedSuspendSize });
    return sendJson(res, 200, { ...report, estimatedSuspendSize });
  }

  if (path === '/api/targets' && req.method === 'GET') {
    return sendJson(res, 200, listTargets());
  }

  // Publish -> SCORM zip (binary)
  if (path === '/api/publish' && req.method === 'POST') {
    const wb = await readBodyJson(req);
    try {
      const result = await publishWorkbook(wb, { target: url.searchParams.get('target') || 'scorm2004' });
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${result.zipName}"`,
      });
      return res.end(result.zip);
    } catch (err) {
      return sendJson(res, 400, { error: err.message, report: err.report || null });
    }
  }

  if (path === '/api/template.xlsx' && req.method === 'GET') {
    const buf = await buildTemplateXlsx();
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="observation-workbook-template.xlsx"',
    });
    return res.end(buf);
  }

  if (path === '/api/import/xlsx' && req.method === 'POST') {
    const buf = await readBodyBuffer(req);
    try {
      const { workbook, warnings } = await importWorkbookXlsx(buf);
      return sendJson(res, 200, { workbook, warnings });
    } catch (err) {
      return sendJson(res, 400, { error: 'Could not parse Excel file: ' + err.message });
    }
  }

  if (path === '/api/preview' && req.method === 'POST') {
    previewWorkbook = await readBodyJson(req);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'Unknown API route' });
}

// ---- Preview (live runtime) ---------------------------------------------

async function handlePreview(req, res, path) {
  if (path === '/preview/mock-lms.js') {
    const src = await readFile(MOCK_LMS_FILE, 'utf8');
    return sendText(res, 200, src, 'text/javascript');
  }
  const rtMatch = /^\/preview\/runtime\/(.+)$/.exec(path);
  if (rtMatch) {
    if (!previewWorkbook) return sendText(res, 409, '// No preview workbook loaded.', 'text/javascript');
    const files = await assembleRuntime(previewWorkbook, { debug: true });
    const content = files[rtMatch[1]];
    if (content == null) return sendText(res, 404, 'Not found: ' + rtMatch[1], 'text/plain');
    return sendText(res, 200, content, mimeFor(rtMatch[1]));
  }
  if (path === '/preview/harness.html') {
    const html = await readFile(join(WEB_DIR, 'preview-harness.html'), 'utf8');
    return sendText(res, 200, html, 'text/html');
  }
  return sendText(res, 404, 'Not found', 'text/plain');
}

// ---- static web UI -------------------------------------------------------

async function serveStatic(res, path) {
  let rel = path === '/' ? '/index.html' : path;
  rel = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = join(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR)) return sendText(res, 403, 'Forbidden', 'text/plain');
  try {
    return sendBuffer(res, 200, await readFile(file), mimeFor(file));
  } catch (_) {
    try {
      return sendBuffer(res, 200, await readFile(join(WEB_DIR, 'index.html')), 'text/html');
    } catch (_2) {
      return sendText(res, 404, 'Not found', 'text/plain');
    }
  }
}

// ---- helpers -------------------------------------------------------------

function mimeFor(p) {
  const ext = extname(p).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }[ext] || 'application/octet-stream';
}
function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function sendText(res, code, text, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8' });
  res.end(text);
}
function sendBuffer(res, code, buf, type) {
  res.writeHead(code, { 'Content-Type': type });
  res.end(buf);
}
function readBodyBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readBodyJson(req) {
  const buf = await readBodyBuffer(req);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}

server.listen(PORT, HOST, () => {
  console.log(`\nSCORM Observation Workbook Builder`);
  console.log(`  Authoring app:  http://${HOST}:${PORT}/`);
  console.log(`  Press Ctrl+C to stop.\n`);
});
