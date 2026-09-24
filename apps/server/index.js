// @ts-check
/**
 * Authoring app server. Built-in node:http only (no framework), per the
 * ship-now stack. Serves the vanilla-JS authoring UI, the JSON API, the live
 * Preview runtime (assembled from the same template used for export), the
 * Excel template + import, the rating scale library, and SCORM publish.
 *
 * Business logic lives in the workspace packages; this file is thin glue and
 * could be replaced by Express/Fastify without touching them.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

import { blankWorkbook } from '@sowb/shared';
import { inlineScales } from '@sowb/shared/scales.js';
import { validateWorkbook, estimateWorstCaseSuspend, publishWorkbook, listTargets } from '@sowb/export-service';
import { assembleRuntime } from '@sowb/scorm-runtime';
import { buildTemplateXlsx, importWorkbookXlsx } from '@sowb/excel-io/workbook-xlsx.js';

import { listWorkbooks, readAllWorkbooks, getWorkbook, saveWorkbook, deleteWorkbook } from './store.js';
import { listCustomScales, listAllScales, saveScale, deleteScale, findScaleUsage } from './scales-store.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB_DIR = join(ROOT, 'apps', 'web');
const MOCK_LMS_FILE = join(ROOT, 'packages', 'mock-lms', 'index.js');
const PORT = process.env.PORT || 4173;
const HOST = process.env.HOST || '127.0.0.1';
/** App version, from the root package.json: the single source of truth. */
const APP_VERSION = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version;

/** In-memory workbook currently loaded into the Preview (scales already inlined). */
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
  // ---- workbooks ----
  if (path === '/api/workbooks' && req.method === 'GET') return sendJson(res, 200, await listWorkbooks());
  if (path === '/api/workbooks' && req.method === 'POST') return sendJson(res, 200, await saveWorkbook(await readBodyJson(req)));
  if (path === '/api/workbooks/new' && req.method === 'GET') return sendJson(res, 200, blankWorkbook());

  const wbMatch = /^\/api\/workbooks\/([^/]+)$/.exec(path);
  if (wbMatch) {
    const id = wbMatch[1];
    if (req.method === 'GET') {
      const wb = await getWorkbook(id);
      return wb ? sendJson(res, 200, wb) : sendJson(res, 404, { error: 'Not found' });
    }
    if (req.method === 'DELETE') return sendJson(res, 200, { deleted: await deleteWorkbook(id) });
  }

  // ---- rating scales ----
  if (path === '/api/scales' && req.method === 'GET') return sendJson(res, 200, await listAllScales());
  if (path === '/api/scales' && req.method === 'POST') {
    try {
      return sendJson(res, 200, await saveScale(await readBodyJson(req)));
    } catch (err) {
      return sendJson(res, 400, { error: err.message, errors: err.errors || [err.message] });
    }
  }
  const usageMatch = /^\/api\/scales\/([^/]+)\/usage$/.exec(path);
  if (usageMatch && req.method === 'GET') {
    return sendJson(res, 200, findScaleUsage(usageMatch[1], await readAllWorkbooks()));
  }
  const scaleMatch = /^\/api\/scales\/([^/]+)$/.exec(path);
  if (scaleMatch && req.method === 'DELETE') {
    return sendJson(res, 200, { deleted: await deleteScale(scaleMatch[1]) });
  }

  // ---- validation ----
  if (path === '/api/validate' && req.method === 'POST') {
    const wb = await readBodyJson(req);
    const customScales = await listCustomScales();
    const estimatedSuspendSize = estimateWorstCaseSuspend(wb, customScales);
    return sendJson(res, 200, { ...validateWorkbook(wb, { estimatedSuspendSize, customScales }), estimatedSuspendSize });
  }

  if (path === '/api/targets' && req.method === 'GET') return sendJson(res, 200, listTargets());
  if (path === '/api/version' && req.method === 'GET') return sendJson(res, 200, { version: APP_VERSION });

  // ---- publish ----
  if (path === '/api/publish' && req.method === 'POST') {
    const wb = await readBodyJson(req);
    try {
      const result = await publishWorkbook(wb, {
        target: url.searchParams.get('target') || 'scorm2004',
        customScales: await listCustomScales(),
      });
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${result.zipName}"`,
      });
      return res.end(result.zip);
    } catch (err) {
      return sendJson(res, 400, { error: err.message, report: err.report || null });
    }
  }

  // ---- excel ----
  if (path === '/api/template.xlsx' && req.method === 'GET') {
    const buf = await buildTemplateXlsx();
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="observation-workbook-template.xlsx"',
    });
    return res.end(buf);
  }
  if (path === '/api/import/xlsx' && req.method === 'POST') {
    try {
      const { workbook, warnings } = await importWorkbookXlsx(await readBodyBuffer(req), {
        customScales: await listCustomScales(),
      });
      return sendJson(res, 200, { workbook, warnings });
    } catch (err) {
      return sendJson(res, 400, { error: 'Could not parse Excel file: ' + err.message });
    }
  }

  // ---- preview ----
  if (path === '/api/preview' && req.method === 'POST') {
    // Resolve scales here too, so Preview renders exactly what the exported
    // package will: the runtime never looks a scale up by id.
    previewWorkbook = inlineScales(await readBodyJson(req), await listCustomScales());
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'Unknown API route' });
}

// ---- Preview (live runtime) ---------------------------------------------

async function handlePreview(req, res, path) {
  if (path === '/preview/mock-lms.js') {
    return sendText(res, 200, await readFile(MOCK_LMS_FILE, 'utf8'), 'text/javascript');
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
    return sendText(res, 200, await readFile(join(WEB_DIR, 'preview-harness.html'), 'utf8'), 'text/html');
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
    try { return sendBuffer(res, 200, await readFile(join(WEB_DIR, 'index.html')), 'text/html'); }
    catch (_2) { return sendText(res, 404, 'Not found', 'text/plain'); }
  }
}

// ---- helpers -------------------------------------------------------------

function mimeFor(p) {
  return {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.ico': 'image/x-icon',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }[extname(p).toLowerCase()] || 'application/octet-stream';
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
  return buf.length ? JSON.parse(buf.toString('utf8')) : {};
}

server.listen(PORT, HOST, () => {
  console.log(`\nSOWB-It · SCORM Observation Workbook Builder Internal Tool`);
  console.log(`  Authoring app:  http://${HOST}:${PORT}/`);
  console.log(`  Press Ctrl+C to stop.\n`);
});
