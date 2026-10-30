import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.mjs';
import { hashPassword, verifyPassword, sessionToken, tokenHash, publicUser, fileType } from './security.mjs';
import * as v from './validation.mjs';
import { createOperations } from './operations.mjs';

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const MAX_FILE = 8 * 1024 * 1024;
const MAX_BODY = 12 * 1024 * 1024;
const SESSION_MS = 8 * 60 * 60 * 1000;
const dummyHash = hashPassword('unused-dummy-password');
const resources = new Set(['workers']);

async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new v.HttpError(413, 'Arquivo ou solicitação muito grande.');
    chunks.push(chunk);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString());
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new v.HttpError(400, 'Envie um objeto JSON válido.'); }
}

export function createApp({ dataDir = resolve('data'), origin = 'http://localhost:3000', production = false } = {}) {
  const configuredOrigin = new URL(origin);
  if (origin !== configuredOrigin.origin || (production && configuredOrigin.protocol !== 'https:')) {
    throw new Error('APP_ORIGIN deve ser uma origem sem caminho; em produção, use HTTPS.');
  }
  const db = openDatabase(dataDir);
  const uploads = resolve(dataDir, 'uploads');
  mkdirSync(uploads, { recursive: true, mode: 0o700 });
  const attempts = new Map();
  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const audit = (user, action, id) => run('INSERT INTO audit_log(user_id,action,entity_id) VALUES (?,?,?)', user.id, action, id);
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function engineer(user) {
    if (user.role !== 'ENGINEER') throw new v.HttpError(403, 'Ação disponível apenas para o engenheiro.');
  }
  function projectFor(user, id) {
    const project = get('SELECT * FROM projects WHERE id = ?', id);
    if (!project || (user.role === 'CLIENT' && project.client_id !== user.id)) throw new v.HttpError(404, 'Obra não encontrada.');
    return project;
  }
  const operations = createOperations({ db, get, all, run, audit, transaction, engineer, projectFor });
  function projectView(project, user) {
    const counts = get(`SELECT COUNT(*) total, COALESCE(SUM(status = 'COMPLETED'),0) completed FROM stages WHERE project_id = ?`, project.id);
    const result = {
      id: project.id, name: project.name, address: project.address, description: project.description,
      start_date: project.start_date, end_date: project.end_date, status: project.status,
      stage_count: counts.total, completed_stages: counts.completed,
      ...operations.summary(project.id)
    };
    if (user.role === 'ENGINEER') {
      const client = get('SELECT name,email FROM users WHERE id = ?', project.client_id);
      Object.assign(result, { client_id: project.client_id, client_name: client?.name || null, client_email: client?.email || null,
        budget_cents: project.budget_cents,
        ...operations.finance(project.id) });
    }
    return result;
  }
  function validateProject(input) {
    const start = v.date(input.start_date, 'Início', true);
    const end = v.date(input.end_date, 'Previsão de entrega', true);
    v.dates(start, end);
    const client = input.client_id || null;
    if (client && (typeof client !== 'string' || !get("SELECT id FROM users WHERE id = ? AND role='CLIENT' AND active=1", client))) throw new v.HttpError(400, 'Cliente inválido.');
    return [v.text(input.name, 'Nome da obra'), v.text(input.address, 'Endereço', 400, true),
      v.text(input.description, 'Descrição', 4000, true), client, start, end,
      v.cents(input.budget ?? 0, 'Orçamento'), v.choice(input.status ?? 'ACTIVE', ['ACTIVE', 'PAUSED', 'COMPLETED'], 'Situação')];
  }
  function valuesFor(resource, input) {
    return [v.text(input.name, 'Nome'), v.text(input.job_title, 'Função', 100), v.text(input.phone, 'Telefone', 40, true), v.boolean(input.active ?? true)];
  }
  const columns = { workers: ['name','job_title','phone','active'] };
  const cookie = (token, maxAge) => `obras_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${production ? '; Secure' : ''}`;
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('Cache-Control', 'no-store');
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, origin);
      const path = url.pathname;
      if (['POST','PATCH','DELETE'].includes(req.method) && req.headers.origin !== origin) throw new v.HttpError(403, 'Origem da solicitação não autorizada.');
      if (['POST','PATCH'].includes(req.method) && !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new v.HttpError(415, 'Use Content-Type application/json.');
      if (path === '/api/health' && req.method === 'GET') return send(200, { status: 'ok' });
      if (path === '/api/auth/login' && req.method === 'POST') {
        const now = Date.now(), ip = req.socket.remoteAddress;
        for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
        const entry = attempts.get(ip) || { count: 0, until: now + 15 * 60 * 1000 };
        if (entry.count >= 10) throw new v.HttpError(429, 'Muitas tentativas. Aguarde 15 minutos.');
        entry.count++; attempts.set(ip, entry);
        const input = await body(req);
        const login = v.email(input.email);
        if (typeof input.password !== 'string' || !input.password.length || input.password.length > 128) throw new v.HttpError(400, 'Informe sua senha.');
        const pass = input.password;
        const user = get('SELECT * FROM users WHERE email = ? AND active = 1', login);
        const valid = verifyPassword(pass, user?.password_hash || dummyHash);
        if (!user || !valid) throw new v.HttpError(401, 'E-mail ou senha incorretos.');
        attempts.delete(ip);
        const token = sessionToken();
        transaction(() => {
          run('DELETE FROM sessions WHERE expires_at <= ?', now);
          run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)', tokenHash(token), user.id, now + SESSION_MS);
        });
        res.setHeader('Set-Cookie', cookie(token, SESSION_MS / 1000));
        return send(200, publicUser(user));
      }
      const token = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('obras_session='))?.slice(14) || '';
      const user = get('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at > ? AND u.active=1', tokenHash(token), Date.now());
      if (path.startsWith('/api/')) {
        if (!user) throw new v.HttpError(401, 'Entre na sua conta para continuar.');
        if (await operations.handle({ path, req, user, body, send })) return;
        if (path === '/api/auth/me' && req.method === 'GET') return send(200, publicUser(user));
        if (path === '/api/auth/logout' && req.method === 'POST') {
          run('DELETE FROM sessions WHERE token_hash = ?', tokenHash(token));
          res.setHeader('Set-Cookie', cookie('', 0)); return send(200, { ok: true });
        }
        if (path === '/api/auth/password' && req.method === 'POST') {
          const input = await body(req);
          if (typeof input.current_password !== 'string' || input.current_password.length > 128 || !verifyPassword(input.current_password, user.password_hash)) throw new v.HttpError(400, 'Senha atual incorreta.');
          const hash = hashPassword(v.password(input.password));
          transaction(() => { run('UPDATE users SET password_hash=? WHERE id=?', hash, user.id); run('DELETE FROM sessions WHERE user_id=?', user.id); audit(user, 'password.changed', user.id); });
          res.setHeader('Set-Cookie', cookie('', 0)); return send(200, { ok: true });
        }
        if (path === '/api/clients') {
          engineer(user);
          if (req.method === 'GET') return send(200, all("SELECT id,name,email FROM users WHERE role='CLIENT' ORDER BY name"));
          if (req.method === 'POST') {
            const input = await body(req), id = randomUUID();
            const name = v.text(input.name, 'Nome'), mail = v.email(input.email), hash = hashPassword(v.password(input.password));
            if (get('SELECT id FROM users WHERE email=?', mail)) throw new v.HttpError(409, 'Este e-mail já está cadastrado.');
            transaction(() => { run("INSERT INTO users(id,name,email,password_hash,role) VALUES (?,?,?,?,'CLIENT')", id, name, mail, hash); audit(user, 'client.created', id); });
            return send(201, { id, name, email: mail });
          }
        }
        if (path === '/api/projects') {
          if (req.method === 'GET') {
            const projects = user.role === 'ENGINEER' ? all('SELECT * FROM projects ORDER BY created_at DESC, name') : all('SELECT * FROM projects WHERE client_id=? ORDER BY created_at DESC, name', user.id);
            return send(200, projects.map(p => projectView(p, user)));
          }
          if (req.method === 'POST') {
            engineer(user); const input = await body(req), id = randomUUID(), values = validateProject(input);
            transaction(() => { run('INSERT INTO projects(id,name,address,description,client_id,start_date,end_date,budget_cents,status) VALUES (?,?,?,?,?,?,?,?,?)', id, ...values); audit(user, 'project.created', id); });
            return send(201, projectView(projectFor(user, id), user));
          }
        }
        let match = path.match(/^\/api\/projects\/([^/]+)$/);
        if (match) {
          const project = projectFor(user, match[1]);
          if (req.method === 'GET') {
            const attachments = user.role === 'ENGINEER' ? all('SELECT * FROM attachments WHERE project_id=? ORDER BY record_date DESC, created_at DESC', project.id) : all('SELECT * FROM attachments WHERE project_id=? AND visible_to_client=1 ORDER BY record_date DESC, created_at DESC', project.id);
            const result = { project: projectView(project, user), stages: all('SELECT * FROM stages WHERE project_id=? ORDER BY COALESCE(start_date,\'9999\'),created_at,id', project.id), attachments };
            if (user.role === 'ENGINEER') result.workers = all('SELECT * FROM workers WHERE project_id=? ORDER BY name', project.id);
            Object.assign(result, operations.details(project.id,user));
            return send(200, result);
          }
          if (req.method === 'PATCH') {
            engineer(user); const values = validateProject(await body(req));
            transaction(() => { run('UPDATE projects SET name=?,address=?,description=?,client_id=?,start_date=?,end_date=?,budget_cents=?,status=? WHERE id=?', ...values, project.id); audit(user, 'project.updated', project.id); });
            return send(200, projectView(projectFor(user, project.id), user));
          }
        }
        match = path.match(/^\/api\/projects\/([^/]+)\/client$/);
        if (match && req.method === 'PATCH') {
          engineer(user);
          const project = projectFor(user, match[1]), input = await body(req);
          // Require an explicit choice: an omitted property must not revoke client access.
          if (!Object.hasOwn(input, 'client_id')) throw new v.HttpError(400, 'Selecione o cliente da obra.');
          const clientId = input.client_id === '' ? null : input.client_id;
          if (clientId !== null && (typeof clientId !== 'string' || !get("SELECT id FROM users WHERE id=? AND role='CLIENT' AND active=1", clientId))) throw new v.HttpError(400, 'Cliente inválido.');
          transaction(() => { run('UPDATE projects SET client_id=? WHERE id=?', clientId, project.id); audit(user, 'project.client.updated', project.id); });
          return send(200, projectView(projectFor(user, project.id), user));
        }
        match = path.match(/^\/api\/projects\/([^/]+)\/(workers)(?:\/([^/]+))?$/);
        if (match) {
          engineer(user); const [, projectId, resource, id] = match;
          projectFor(user, projectId);
          if (!resources.has(resource)) throw new v.HttpError(404, 'Recurso não encontrado.');
          if (id && !get(`SELECT id FROM ${resource} WHERE id=? AND project_id=?`, id, projectId)) throw new v.HttpError(404, 'Registro não encontrado.');
          if (req.method === 'POST' && !id) {
            const values = valuesFor(resource, await body(req)), newId = randomUUID();
            transaction(() => { run(`INSERT INTO ${resource}(id,project_id,${columns[resource].join(',')}) VALUES (${Array(values.length + 2).fill('?').join(',')})`, newId, projectId, ...values); audit(user, `${resource}.created`, newId); });
            return send(201, { id: newId });
          }
          if (req.method === 'PATCH' && id) {
            const values = valuesFor(resource, await body(req));
            transaction(() => { run(`UPDATE ${resource} SET ${columns[resource].map(c => `${c}=?`).join(',')} WHERE id=? AND project_id=?`, ...values, id, projectId); audit(user, `${resource}.updated`, id); });
            return send(200, { id });
          }
          if (req.method === 'DELETE' && id) {
            transaction(() => { run(`DELETE FROM ${resource} WHERE id=? AND project_id=?`, id, projectId); audit(user, `${resource}.deleted`, id); });
            return send(200, { ok: true });
          }
        }
        match = path.match(/^\/api\/projects\/([^/]+)\/attachments$/);
        if (match && req.method === 'POST') {
          engineer(user); const projectId = match[1]; projectFor(user, projectId);
          const input = await body(req), id = randomUUID();
          const kind = v.choice(input.kind, ['PHOTO','DOCUMENT'], 'Tipo');
          const title = v.text(input.title, 'Título'), description = v.text(input.description, 'Descrição', 4000, true), location = v.text(input.location, 'Ambiente', 200, true);
          const recordDate = v.date(input.record_date, 'Data do registro'), visible = v.boolean(input.visible_to_client ?? false);
          const fileName = v.text(input.file_name, 'Nome do arquivo', 200).replace(/[\\/\x00-\x1f\x7f]/g, '_');
          const stageId = input.stage_id || null;
          if (stageId && (typeof stageId !== 'string' || !get('SELECT id FROM stages WHERE id=? AND project_id=?', stageId, projectId))) throw new v.HttpError(400, 'Etapa inválida para esta obra.');
          if (typeof input.file_base64 !== 'string' || input.file_base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.file_base64)) throw new v.HttpError(400, 'Arquivo inválido.');
          const bytes = Buffer.from(input.file_base64, 'base64'), mime = fileType(bytes);
          if (!bytes.length || bytes.length > MAX_FILE) throw new v.HttpError(400, 'O arquivo deve ter até 8 MB.');
          if (!mime || (kind === 'PHOTO' && !mime.startsWith('image/'))) throw new v.HttpError(400, 'Use JPG, PNG ou WebP para fotos; documentos também aceitam PDF.');
          writeFileSync(resolve(uploads, id), bytes, { flag: 'wx', mode: 0o600 });
          try {
            transaction(() => { run('INSERT INTO attachments(id,project_id,stage_id,kind,title,description,location,record_date,visible_to_client,file_name,mime_type,size) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', id, projectId, stageId, kind, title, description, location, recordDate, visible, fileName, mime, bytes.length); audit(user, 'attachment.created', id); });
          } catch (error) { unlinkSync(resolve(uploads, id)); throw error; }
          return send(201, { id });
        }
        match = path.match(/^\/api\/attachments\/([^/]+)(\/file)?$/);
        if (match) {
          const attachment = get('SELECT * FROM attachments WHERE id=?', match[1]);
          if (!attachment) throw new v.HttpError(404, 'Arquivo não encontrado.');
          projectFor(user, attachment.project_id);
          if (user.role === 'CLIENT' && !attachment.visible_to_client) throw new v.HttpError(404, 'Arquivo não encontrado.');
          if (match[2] && req.method === 'GET') {
            const bytes = readFileSync(resolve(uploads, attachment.id));
            const disposition = url.searchParams.has('download') || attachment.mime_type === 'application/pdf' ? 'attachment' : 'inline';
            res.writeHead(200, { 'Content-Type': attachment.mime_type, 'Content-Length': bytes.length,
              'Content-Disposition': `${disposition}; filename="arquivo"; filename*=UTF-8''${encodeURIComponent(attachment.file_name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16))}` });
            return res.end(bytes);
          }
          if (!match[2] && req.method === 'PATCH') {
            engineer(user); const input = await body(req), visible = v.boolean(input.visible_to_client);
            transaction(() => { run('UPDATE attachments SET visible_to_client=? WHERE id=?', visible, attachment.id); audit(user, visible ? 'attachment.published' : 'attachment.unpublished', attachment.id); });
            return send(200, { ok: true });
          }
          if (!match[2] && req.method === 'DELETE') {
            engineer(user);
            if (get('SELECT id FROM expense_payments WHERE receipt_id=?', attachment.id) || get('SELECT d.id FROM diary_entries d, json_each(d.attachment_ids_json) j WHERE j.value=?', attachment.id) || get("SELECT r.id FROM diary_revisions r, json_each(json_extract(r.snapshot_json,'$.attachment_ids_json')) j WHERE j.value=?", attachment.id)) throw new v.HttpError(409, 'Arquivo vinculado a diário ou pagamento. Preserve o histórico.');
            transaction(() => { run('DELETE FROM attachments WHERE id=?', attachment.id); audit(user, 'attachment.deleted', attachment.id); });
            try { unlinkSync(resolve(uploads, attachment.id)); } catch (error) { console.error('Limpeza de arquivo:', error.code); }
            return send(200, { ok: true });
          }
        }
        throw new v.HttpError(404, 'Recurso não encontrado.');
      }
      const staticFiles = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/visuals.js': ['visuals.js', 'text/javascript'], '/operations-ui.js': ['operations-ui.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
      if (req.method !== 'GET' || !staticFiles[path]) throw new v.HttpError(404, 'Página não encontrada.');
      const [file, type] = staticFiles[path];
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(readFileSync(resolve(PUBLIC, file)));
    } catch (error) {
      if (!error.status) console.error('Erro na solicitação:', error.code || error.message);
      if (!res.headersSent) send(error.status || 500, { error: error.status ? error.message : 'Não foi possível concluir. Tente novamente.' });
      else res.end();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return { server, db };
}
