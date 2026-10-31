import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { hashPassword, verifyPassword } from '../server/security.mjs';
import { openDatabase } from '../server/db.mjs';

test('fluxo de gestão de obras e autorização de ponta a ponta', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'obras-test-'));
  const origin = 'http://localhost:3000';
  const { server, db } = createApp({ dataDir: dir, origin });
  db.prepare("INSERT INTO users(id,name,email,password_hash,role) VALUES (?,?,?,?,'ENGINEER')").run('engineer','Engenheiro','engineer@example.com',hashPassword('Engineer-pass-123'));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method='GET', data, cookie, requestOrigin=origin } = {}) {
    const response = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type':'application/json', Origin:requestOrigin, ...(cookie ? {Cookie:cookie} : {}) }, ...(data !== undefined ? {body:JSON.stringify(data)} : {}) });
    const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status:response.status, data:result, cookie:response.headers.get('set-cookie')?.split(';')[0], headers:response.headers };
  }
  let engineer, client, outsider, clientId, projectId, otherProjectId, stageId, attachmentId;
  try {
    await t.test('login, cookie e bloqueio de acesso anônimo', async () => {
      assert.equal((await request('/projects')).status,401);
      assert.equal((await request('/auth/login',{method:'POST',data:{email:'engineer@example.com',password:'wrong'}})).status,401);
      const login = await request('/auth/login',{method:'POST',data:{email:'engineer@example.com',password:'Engineer-pass-123'}});
      assert.equal(login.status,200); engineer=login.cookie;
      assert.match(login.headers.get('set-cookie'),/HttpOnly/); assert.match(login.headers.get('set-cookie'),/SameSite=Strict/);
      assert.equal(login.data.password_hash,undefined);
      assert.equal((await request('/auth/logout',{method:'POST',cookie:engineer,data:{},requestOrigin:'https://foreign.test'})).status,403);
    });
    await t.test('contas de clientes sem elevação de privilégio e e-mail duplicado', async () => {
      const created=await request('/clients',{method:'POST',cookie:engineer,data:{name:'Cliente A',email:'a@example.com',password:'Client-A-pass-123',role:'ENGINEER'}});
      assert.equal(created.status,201); clientId=created.data.id;
      assert.equal(db.prepare('SELECT role FROM users WHERE id=?').get(clientId).role,'CLIENT');
      assert.equal((await request('/clients',{method:'POST',cookie:engineer,data:{name:'Duplicado',email:'A@EXAMPLE.COM',password:'Client-A-pass-123'}})).status,409);
      assert.equal((await request('/clients',{method:'POST',cookie:engineer,data:{name:'Cliente B',email:'b@example.com',password:'Client-B-pass-123'}})).status,201);
      client=(await request('/auth/login',{method:'POST',data:{email:'a@example.com',password:'Client-A-pass-123'}})).cookie;
      outsider=(await request('/auth/login',{method:'POST',data:{email:'b@example.com',password:'Client-B-pass-123'}})).cookie;
      assert.equal((await request('/clients',{cookie:client})).status,403);
      assert.equal((await request('/projects',{method:'POST',cookie:client,data:{name:'Não permitida'}})).status,403);
    });
    await t.test('cadastro e isolamento das obras, sem exposição de orçamento', async () => {
      const created=await request('/projects',{method:'POST',cookie:engineer,data:{name:'Casa A',client_id:clientId,budget:100000,start_date:'2026-10-01',end_date:'2027-04-30'}});
      assert.equal(created.status,201);projectId=created.data.id;
      otherProjectId=(await request('/projects',{method:'POST',cookie:engineer,data:{name:'Interna'}})).data.id;
      assert.equal((await request('/projects',{cookie:client})).data.length,1);
      assert.equal((await request('/projects',{cookie:outsider})).data.length,0);
      const own=await request(`/projects/${projectId}`,{cookie:client});
      assert.equal(own.status,200);assert.equal(own.data.project.budget_cents,undefined);
      for (const key of ['expenses','materials','workers']) assert.equal(own.data[key],undefined);
      assert.equal((await request(`/projects/${projectId}`,{cookie:outsider})).status,404);
      assert.equal((await request(`/projects/${otherProjectId}`,{cookie:client})).status,404);
    });
    await t.test('vínculo dedicado preserva dados da obra e informa cliente ao engenheiro', async () => {
      const linked = await request(`/projects/${otherProjectId}/client`, { method:'PATCH', cookie:engineer, data:{client_id:clientId, name:'Não deve alterar', budget:99} });
      assert.equal(linked.status,200);
      assert.equal(linked.data.client_name,'Cliente A');
      assert.equal(linked.data.client_email,'a@example.com');
      assert.equal(linked.data.name,'Interna');
      assert.equal(linked.data.budget_cents,0);
      assert.equal((await request(`/projects/${otherProjectId}`,{cookie:client})).status,200);
      assert.equal((await request(`/projects/${otherProjectId}`,{cookie:client})).data.project.client_email,undefined);
      assert.equal((await request(`/projects/${otherProjectId}/client`,{method:'PATCH',cookie:engineer,data:{client_id:null}})).status,200);
      assert.equal((await request(`/projects/${otherProjectId}`,{cookie:client})).status,404);
    });
    await t.test('cliente não pode modificar vínculos e escolha omitida não remove acesso', async () => {
      assert.equal((await request(`/projects/${projectId}/client`,{method:'PATCH',cookie:client,data:{client_id:null}})).status,403);
      assert.equal((await request(`/projects/${projectId}/client`,{method:'PATCH',cookie:engineer,data:{}})).status,400);
      for (const client_id of ['engineer','inexistente',{},[]]) {
        assert.equal((await request(`/projects/${projectId}/client`,{method:'PATCH',cookie:engineer,data:{client_id}})).status,400);
      }
      assert.equal((await request(`/projects/${projectId}`,{cookie:client})).status,200);
    });
    await t.test('datas, valores e clientes inválidos são rejeitados', async () => {
      for (const fields of [{start_date:'2026-02-30'},{start_date:'2027-01-01',end_date:'2026-01-01'},{budget:-1},{budget:0.001},{client_id:'inexistente'}]) {
        assert.equal((await request('/projects',{method:'POST',cookie:engineer,data:{name:'Inválida',...fields}})).status,400);
      }
    });
    await t.test('etapas, atualização e progresso calculado', async () => {
      const created=await request(`/projects/${projectId}/stages`,{method:'POST',cookie:engineer,data:{title:'Fundação'}});
      assert.equal(created.status,201);stageId=created.data.id;
      assert.equal((await request(`/projects/${projectId}/stages/${stageId}`,{method:'PATCH',cookie:engineer,data:{title:'Fundação',status:'COMPLETED'}})).status,200);
      assert.equal((await request(`/projects/${projectId}`,{cookie:client})).data.project.progress,0);
      assert.equal((await request(`/projects/${otherProjectId}/stages/${stageId}`,{method:'DELETE',cookie:engineer})).status,404);
    });
    await t.test('materiais, despesas e equipe persistidos e editáveis', async () => {
      const fixtures=[['materials',{name:'Cimento',unit:'saco',quantity:20}],['expenses',{description:'Compra de cimento',category:'Material',amount:100.35,expense_date:'2026-10-29',status:'PAID'}],['workers',{name:'José',job_title:'Pedreiro',active:true}]];
      for (const [resource,data] of fixtures) {
        const added=await request(`/projects/${projectId}/${resource}`,{method:'POST',cookie:engineer,data});assert.equal(added.status,201);
        assert.equal((await request(`/projects/${projectId}/${resource}/${added.data.id}`,{method:'PATCH',cookie:engineer,data})).status,200);
        assert.equal((await request(`/projects/${projectId}/${resource}/${added.data.id}`,{method:'DELETE',cookie:client})).status,403);
      }
      const own=(await request(`/projects/${projectId}`,{cookie:engineer})).data;
      assert.equal(own.materials[0].quantity,20);assert.equal(own.workers.length,1);
      assert.equal(own.project.expense_cents,10035);assert.equal(own.project.paid_cents,10035);
      assert.equal((await request(`/projects/${projectId}/expenses`,{method:'POST',cookie:engineer,data:{description:'Zero',category:'Outro',amount:0,expense_date:'2026-10-29'}})).status,400);
    });
    const photo={kind:'PHOTO',title:'Fundação em execução',record_date:'2026-10-29',file_name:'foto.png',file_base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW2kAAAAASUVORK5CYII='};
    await t.test('upload privado por padrão e bloqueio por vínculo/visibilidade', async () => {
      const uploaded=await request(`/projects/${projectId}/attachments`,{method:'POST',cookie:engineer,data:{...photo,stage_id:stageId}});
      assert.equal(uploaded.status,201);attachmentId=uploaded.data.id;
      assert.equal((await request(`/projects/${projectId}`,{cookie:client})).data.attachments.length,0);
      assert.equal((await request(`/attachments/${attachmentId}/file`,{cookie:client})).status,404);
      assert.equal((await request(`/attachments/${attachmentId}/file`)).status,401);
      assert.equal((await request(`/attachments/${attachmentId}/file`,{cookie:engineer})).status,200);
      assert.equal((await request(`/attachments/${attachmentId}`,{method:'PATCH',cookie:client,data:{visible_to_client:true}})).status,404);
    });
    await t.test('publicar, baixar e retirar publicação aplica autorização a cada pedido', async () => {
      assert.equal((await request(`/attachments/${attachmentId}`,{method:'PATCH',cookie:engineer,data:{visible_to_client:true}})).status,200);
      assert.equal((await request(`/projects/${projectId}`,{cookie:client})).data.attachments.length,1);
      const file=await request(`/attachments/${attachmentId}/file?download=1`,{cookie:client});
      assert.equal(file.status,200);assert.equal(file.headers.get('content-type'),'image/png');assert.match(file.headers.get('content-disposition'),/^attachment/);
      assert.equal((await request(`/attachments/${attachmentId}/file`,{cookie:outsider})).status,404);
      assert.equal((await request(`/attachments/${attachmentId}`,{method:'PATCH',cookie:client,data:{visible_to_client:false}})).status,403);
      assert.equal((await request(`/attachments/${attachmentId}`,{method:'PATCH',cookie:engineer,data:{visible_to_client:false}})).status,200);
      assert.equal((await request(`/attachments/${attachmentId}/file`,{cookie:client})).status,404);
    });
    await t.test('formato, tamanho e etapa de outra obra são rejeitados nos anexos', async () => {
      for (const input of [{...photo,file_base64:Buffer.from('<script>alert(1)</script>').toString('base64')},{...photo,file_base64:Buffer.alloc(8*1024*1024+1,65).toString('base64')},{...photo,stage_id:'inexistente'}]) {
        assert.equal((await request(`/projects/${projectId}/attachments`,{method:'POST',cookie:engineer,data:input})).status,400);
      }
      assert.equal((await request(`/projects/${otherProjectId}/attachments`,{method:'POST',cookie:engineer,data:{...photo,stage_id:stageId}})).status,400);
      const document=await request(`/projects/${projectId}/attachments`,{method:'POST',cookie:engineer,data:{...photo,kind:'DOCUMENT',file_name:'nota.pdf',file_base64:Buffer.from('%PDF-1.4\n%%EOF').toString('base64'),visible_to_client:true}});
      assert.equal(document.status,201);
      assert.match((await request(`/attachments/${document.data.id}/file`,{cookie:client})).headers.get('content-disposition'),/^attachment/);
    });
    await t.test('excluir etapa preserva arquivo e excluir anexo revoga download', async () => {
      assert.equal((await request(`/projects/${projectId}/stages/${stageId}`,{method:'DELETE',cookie:engineer})).status,200);
      assert.equal(db.prepare('SELECT stage_id FROM attachments WHERE id=?').get(attachmentId).stage_id,null);
      assert.equal((await request(`/attachments/${attachmentId}`,{method:'DELETE',cookie:engineer})).status,200);
      assert.equal((await request(`/attachments/${attachmentId}/file`,{cookie:engineer})).status,404);
      assert.ok(db.prepare('SELECT COUNT(*) n FROM audit_log').get().n > 10);
    });
    await t.test('troca de cliente titular retira o acesso do cliente anterior', async () => {
      const update=await request(`/projects/${projectId}`,{method:'PATCH',cookie:engineer,data:{name:'Casa A atualizada',client_id:null,budget:90000,status:'PAUSED'}});
      assert.equal(update.status,200);
      assert.equal((await request(`/projects/${projectId}`,{cookie:client})).status,404);
      assert.equal((await request('/projects',{cookie:client})).data.length,0);
    });
    await t.test('troca de senha invalida sessões e aceita senha literal sem trim', async () => {
      const updated=await request('/auth/password',{method:'POST',cookie:client,data:{current_password:'Client-A-pass-123',password:' Nova-senha-123 '}});
      assert.equal(updated.status,200);assert.equal((await request('/auth/me',{cookie:client})).status,401);
      assert.equal((await request('/auth/login',{method:'POST',data:{email:'a@example.com',password:'Client-A-pass-123'}})).status,401);
      const login=await request('/auth/login',{method:'POST',data:{email:'a@example.com',password:' Nova-senha-123 '}});
      assert.equal(login.status,200);
      assert.equal((await request('/auth/logout',{method:'POST',cookie:login.cookie,data:{}})).status,200);
      assert.equal((await request('/auth/me',{cookie:login.cookie})).status,401);
    });
    await t.test('limite de tentativas e cabeçalhos de segurança', async () => {
      let result;
      for(let i=0;i<11;i++) result=await request('/auth/login',{method:'POST',data:{email:'none@example.com',password:'wrong'}});
      assert.equal(result.status,429);
      const page=await fetch(base);assert.equal(page.status,200);
      assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
      assert.equal((await fetch(`${base}/data/obras.sqlite`)).status,404);
      assert.equal((await fetch(`${base}/.env`)).status,404);
    });
  } finally {
    server.close(); await once(server,'close'); db.close();
    const reopened=openDatabase(dir);
    try { assert.equal(reopened.prepare('SELECT name FROM projects WHERE id=?').get(projectId).name,'Casa A atualizada');assert.equal(reopened.prepare('SELECT COUNT(*) n FROM migrations').get().n,7); }
    finally { reopened.close();rmSync(dir,{recursive:true,force:true}); }
  }
});

test('hash individual de senha e configuração segura de produção', () => {
  const a=hashPassword('password-123456'),b=hashPassword('password-123456');
  assert.notEqual(a,b);assert.ok(verifyPassword('password-123456',a));assert.ok(!verifyPassword('incorrect',a));
  assert.throws(()=>createApp({origin:'http://example.com',production:true}),/HTTPS/);
  assert.throws(()=>createApp({origin:'https://example.com/path',production:true}),/origem/);
});
