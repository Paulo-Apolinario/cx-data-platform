import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.mjs';
import { hashPassword } from '../server/security.mjs';
import { openDatabase } from '../server/db.mjs';
import { workToday } from '../server/operations.mjs';

async function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'operations-')),origin='http://localhost:3000';
  const {server,db}=createApp({dataDir:dir,origin});
  for(const [id,role] of [['engineer','ENGINEER'],['client','CLIENT'],['other','CLIENT']]) db.prepare('INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)').run(id,id,`${id}@test.com`,hashPassword('password-123456'),role);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  async function request(path,{method='GET',data,cookie}={}) {
    const r=await fetch(base+'/api'+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(data!==undefined?{body:JSON.stringify(data)}:{})});
    const result=r.headers.get('content-type')?.includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer());
    return {status:r.status,data:result,cookie:r.headers.get('set-cookie')?.split(';')[0]};
  }
  const cookies={};for(const id of ['engineer','client','other'])cookies[id]=(await request('/auth/login',{method:'POST',data:{email:`${id}@test.com`,password:'password-123456'}})).cookie;
  const req=(path,method='GET',data,user='engineer')=>request(path,{method,data,cookie:cookies[user]});
  const project=(await req('/projects','POST',{name:'Obra A',client_id:'client',budget:5000})).data.id;
  const target=(await req('/projects','POST',{name:'Obra B',client_id:'other'})).data.id;
  return {db,req,project,target,async close(){server.close();await once(server,'close');db.close();rmSync(dir,{recursive:true,force:true});}};
}

test('operações de obra: saldos, pagamentos, diário, medição e aceite',async t=>{
  const f=await fixture(),{db,req,project:p,target:q}=f;
  const base=`/projects/${p}`,other=`/projects/${q}`;
  let source,destination,expense,receipt,diary,photoPublic,photoPrivate,worker,approval;
  const date=workToday();
  try {
    await t.test('tarefas antigas e alertas não definem avanço físico sem contratação',async()=>{
      assert.equal((await req(base+'/stages','POST',{title:'Fundação',status:'COMPLETED',weight:1})).status,201);
      assert.equal((await req(base+'/stages','POST',{title:'Estrutura',status:'IN_PROGRESS',progress_percent:50,weight:3,end_date:'2000-01-01',responsible:'Engenheiro'})).status,201);
      const detail=(await req(base)).data;
      assert.equal(detail.project.progress,0);assert.equal(detail.project.progress_configured,false);assert.equal(detail.project.completed_stages,1);assert.equal(detail.project.overdue_stages,1);
      assert.equal(detail.stages.find(s=>s.title==='Estrutura').overdue,true);
      for(const data of [{title:'Inválida',status:'PLANNED',progress_percent:10},{title:'Inválida',weight:0},{title:'Inválida',status:'COMPLETED',progress_percent:90},{title:'Inválida',status:'IN_PROGRESS',actual_end:date},{title:'Não iniciada com data real',status:'PLANNED',actual_start:date}])assert.equal((await req(base+'/stages','POST',data)).status,400);
      assert.equal((await req(base+'/stages','POST',{title:'Proibida'},'client')).status,403);
    });
    await t.test('entrada idempotente, consumo, perdas e proteção de saldo',async()=>{
      source=(await req(base+'/materials','POST',{name:'Cimento',unit:'saco',quantity:10})).data.id;
      destination=(await req(other+'/materials','POST',{name:'Cimento',unit:'saco',quantity:0})).data.id;
      const movement={type:'ENTRY',quantity:5,movement_date:date,supplier:'Fornecedor',request_id:randomUUID()};
      for(let i=0;i<2;i++)assert.equal((await req(`${base}/materials/${source}/movements`,'POST',movement)).status,201);
      assert.equal((await req(base)).data.materials[0].quantity,15);
      assert.equal((await req(`${base}/materials/${source}/movements`,'POST',{...movement,quantity:6})).status,409);
      for(const [type,quantity] of [['CONSUMPTION',4],['LOSS',1]])assert.equal((await req(`${base}/materials/${source}/movements`,'POST',{type,quantity,movement_date:date})).status,201);
      assert.equal((await req(`${base}/materials/${source}/movements`,'POST',{type:'LOSS',quantity:11,movement_date:date})).status,409);
      assert.equal((await req(`${base}/materials/${source}/movements`,'POST',{type:'ENTRY',quantity:.0001,movement_date:date})).status,400);
      assert.equal((await req(base)).data.materials[0].quantity,10);
      assert.equal((await req(base+'/materials','GET',undefined,'client')).status,403);
    });
    await t.test('transferência atômica entre obras sem duplicação',async()=>{
      const transfer={type:'TRANSFER_OUT',quantity:3,movement_date:date,target_material_id:destination,request_id:randomUUID()};
      for(let i=0;i<2;i++)assert.equal((await req(`${base}/materials/${source}/movements`,'POST',transfer)).status,201);
      assert.equal((await req(base)).data.materials[0].quantity,7);assert.equal((await req(other)).data.materials[0].quantity,3);
      const rows=db.prepare("SELECT * FROM material_movements WHERE type LIKE 'TRANSFER_%'").all();assert.equal(rows.length,2);assert.equal(rows[0].transfer_id,rows[1].transfer_id);
      assert.equal((await req(`${base}/materials/${source}/movements`,'POST',{...transfer,request_id:randomUUID(),quantity:8})).status,409);
      assert.equal((await req(other)).data.materials[0].quantity,3);
      const wrong=(await req(other+'/materials','POST',{name:'Outro',unit:'kg',quantity:0})).data.id;
      assert.equal((await req(`${base}/materials/${source}/movements`,'POST',{...transfer,request_id:randomUUID(),target_material_id:wrong})).status,400);
    });
    await t.test('histórico de material não pode ser apagado ou reescrito pelo cadastro',async()=>{
      assert.equal((await req(`${base}/materials/${source}`,'PATCH',{name:'Cimento',unit:'saco',quantity:99})).status,409);
      assert.equal((await req(`${base}/materials/${source}`,'PATCH',{name:'Cimento',unit:'kg',quantity:7})).status,409);
      assert.equal((await req(`${base}/materials/${source}`,'DELETE')).status,409);
      assert.equal((await req(`${base}/materials/${source}`,'PATCH',{name:'Cimento CP II',unit:'saco',quantity:7,notes:'Organizado'})).status,200);
    });
    await t.test('pagamento parcial e comprovante protegidos contra duplicação e excesso',async()=>{
      expense=(await req(base+'/expenses','POST',{description:'Materiais',category:'Compras',supplier:'Loja',amount:1000,expense_date:date,due_date:'2000-01-01'})).data.id;
      const uploaded=await req(base+'/attachments','POST',{kind:'DOCUMENT',title:'Comprovante',record_date:date,file_name:'nota.pdf',file_base64:Buffer.from('%PDF-1.4\n%%EOF').toString('base64')});receipt=uploaded.data.id;
      const payment={amount:300,payment_date:date,method:'PIX',receipt_id:receipt,request_id:randomUUID()};
      for(let i=0;i<2;i++)assert.equal((await req(`${base}/expenses/${expense}/payments`,'POST',payment)).status,201);
      const detail=(await req(base)).data;
      assert.equal(detail.expenses[0].payment_state,'PARTIAL');assert.equal(detail.expenses[0].outstanding_cents,70000);
      assert.equal(detail.project.paid_cents,30000);assert.equal(detail.project.overdue_cents,70000);assert.equal(detail.payments.length,1);
      assert.equal((await req(`${base}/expenses/${expense}/payments`,'POST',{amount:800,payment_date:date})).status,409);
      assert.equal((await req(`${base}/expenses/${expense}/payments`,'POST',{...payment,amount:301})).status,409);
      assert.equal((await req(`${other}/expenses/${expense}/payments`,'POST',{amount:10,payment_date:date})).status,404);
      assert.equal((await req(`${base}/expenses/${expense}/payments`,'POST',{amount:10,payment_date:date},'client')).status,403);
      assert.equal((await req(`/attachments/${receipt}`,'DELETE')).status,409);
    });
    await t.test('pagamentos concorrentes não ultrapassam saldo e estornos preservam histórico',async()=>{
      const results=await Promise.all([req(`${base}/expenses/${expense}/payments`,'POST',{amount:700,payment_date:date}),req(`${base}/expenses/${expense}/payments`,'POST',{amount:700,payment_date:date})]);
      assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
      assert.equal((await req(base)).data.expenses[0].payment_state,'PAID');
      const payment=(await req(base)).data.payments.find(p=>p.amount_cents===30000);
      const reversals=await Promise.all([req(`${base}/expenses/${expense}/payments/${payment.id}/void`,'POST',{reason:'Registro incorreto'}),req(`${base}/expenses/${expense}/payments/${payment.id}/void`,'POST',{reason:'Segunda tentativa'})]);
      assert.deepEqual(reversals.map(r=>r.status).sort(),[200,409]);
      assert.equal((await req(`${base}/expenses/${expense}/payments/${payment.id}/void`,'POST',{reason:'Outra tentativa'})).status,409);
      const detail=(await req(base)).data;assert.equal(detail.expenses[0].outstanding_cents,30000);assert.equal(detail.payments.length,2);
      assert.equal((await req(`${base}/expenses/${expense}`,'PATCH',{description:'Materiais',category:'Compras',amount:600,expense_date:date})).status,409);
      assert.equal((await req(`${base}/expenses/${expense}`,'DELETE')).status,409);
      const client=(await req(base,'GET',undefined,'client')).data;assert.equal(client.payments,undefined);assert.equal(client.expenses,undefined);assert.equal(client.project.paid_cents,undefined);
    });
    const tiny='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW2kAAAAASUVORK5CYII=';
    await t.test('diário mantém equipe e notas internas fora do portal e respeita fotos publicadas',async()=>{
      worker=(await req(base+'/workers','POST',{name:'José',job_title:'Pedreiro'})).data.id;
      for(const visible of [true,false]){const id=(await req(base+'/attachments','POST',{kind:'PHOTO',title:'Foto',record_date:date,file_name:'foto.png',file_base64:tiny,visible_to_client:visible})).data.id;if(visible)photoPublic=id;else photoPrivate=id;}
      const input={work_date:date,services:'Concretagem',weather:'Ensolarado',occurrences:'Execução normal',internal_notes:'Informação privada',worker_ids:[worker],attachment_ids:[photoPublic,photoPrivate]};
      diary=(await req(base+'/diary','POST',input)).data.id;
      assert.equal((await req(base,'GET',undefined,'client')).data.diary.length,0);
      assert.equal((await req(`${base}/diary/${diary}`,'GET',undefined,'client')).status,404);
      assert.equal((await req(`${base}/diary/${diary}`,'PATCH',{...input,visible_to_client:true,version:1})).status,200);
      const client=(await req(base,'GET',undefined,'client')).data.diary[0];assert.equal(client.internal_notes,undefined);assert.equal(client.workforce,undefined);assert.equal(client.workforce_count,1);assert.deepEqual(client.attachment_ids,[photoPublic]);
      assert.equal((await req(`${base}/diary/${diary}/revisions`,'GET',undefined,'client')).status,403);
      assert.equal((await req(`${base}/diary/${diary}`,'GET',undefined,'other')).status,404);
      assert.equal((await req(base+'/diary','POST',{...input,worker_ids:['other']})).status,404);
      assert.equal((await req(base+'/diary','POST',{...input,attachment_ids:[receipt]})).status,400);
      assert.equal((await req(`/attachments/${photoPublic}`,'DELETE')).status,409);
    });
    await t.test('edições simultâneas do diário exigem revisão atual e preservam revisões',async()=>{
      const input={work_date:date,services:'Concretagem revisada',version:2,visible_to_client:true};
      const results=await Promise.all([req(`${base}/diary/${diary}`,'PATCH',input),req(`${base}/diary/${diary}`,'PATCH',input)]);
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
      assert.equal((await req(`${base}/diary/${diary}`)).data.version,3);
      const history=await req(`${base}/diary/${diary}/revisions`);assert.equal(history.data.length,2);assert.equal(history.data[0].snapshot.services,'Concretagem');
      assert.equal((await req(`/attachments/${photoPublic}`,'DELETE')).status,409);
      assert.equal((await req(`${base}/diary/${diary}`,'DELETE')).status,200);
      assert.equal((await req(base,'GET',undefined,'client')).data.diary.length,0);
      assert.equal(db.prepare('SELECT archived FROM diary_entries WHERE id=?').get(diary).archived,1);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM diary_revisions WHERE diary_id=?').get(diary).n,2);
    });
    await t.test('propostas são rascunhos privados até envio e não podem mudar após envio',async()=>{
      approval=(await req(base+'/approvals','POST',{title:'Alteração de acabamento',description:'Trocar revestimento da cozinha',amount:250})).data.id;
      assert.equal((await req(base,'GET',undefined,'client')).data.approvals.length,0);
      assert.equal((await req(`${base}/approvals/${approval}/send`,'POST',{})).status,200);
      assert.equal((await req(`${base}/approvals/${approval}`,'PATCH',{title:'Outro',description:'Mudança',amount:999})).status,409);
      assert.equal((await req(base,'GET',undefined,'client')).data.approvals[0].amount_cents,25000);
      assert.equal((await req(`${base}/approvals/${approval}/decision`,'POST',{status:'APPROVED'})).status,403);
      assert.equal((await req(`${base}/approvals/${approval}/decision`,'POST',{status:'APPROVED'},'other')).status,404);
    });
    await t.test('aceite é único, auditável e não cria cobrança ou modifica orçamento',async()=>{
      const before=(await req(base)).data;
      const decisions=await Promise.all([req(`${base}/approvals/${approval}/decision`,'POST',{status:'APPROVED',note:'De acordo'},'client'),req(`${base}/approvals/${approval}/decision`,'POST',{status:'REJECTED'},'client')]);
      assert.deepEqual(decisions.map(r=>r.status).sort(),[200,409]);
      const detail=(await req(base)).data,a=detail.approvals.find(a=>a.id===approval);
      assert.ok(['APPROVED','REJECTED'].includes(a.status));assert.equal(a.decided_by,'client');assert.ok(a.decided_at);
      assert.equal(detail.project.budget_cents,before.project.budget_cents);assert.equal(detail.project.expense_cents,before.project.expense_cents);
      assert.equal((await req(`${base}/approvals/${approval}/cancel`,'POST',{})).status,409);
    });
    await t.test('trocar titular não entrega proposta antiga ao novo cliente',async()=>{
      const id=(await req(base+'/approvals','POST',{title:'Outra proposta',description:'Aguardando resposta'})).data.id;
      await req(`${base}/approvals/${id}/send`,'POST',{});
      await req(`${base}/client`,'PATCH',{client_id:'other'});
      assert.equal((await req(`${base}/approvals/${id}/decision`,'POST',{status:'APPROVED'},'client')).status,404);
      assert.equal((await req(`${base}/approvals/${id}`,'GET',undefined,'other')).status,404);
      assert.equal((await req(`${base}/approvals/${id}/cancel`,'POST',{})).status,200);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_log').get().n>20,true);
    });
  } finally {await f.close();}
});

test('perguntas: histórico, isolamento, reenvio seguro e troca de titular',async()=>{
  const f=await fixture(),{req,project:p,target:q,db}=f,base=`/projects/${p}/questions`;
  try {
    const input={title:'Prazo da fundação',message:'Quando começa?',request_id:randomUUID()};
    assert.equal((await req(base,'POST',input)).status,403);
    assert.equal((await req(base,'POST',input,'other')).status,404);
    assert.equal((await req(base,'POST',{...input,message:'  '},'client')).status,400);
    for(let i=0;i<2;i++)assert.equal((await req(base,'POST',input,'client')).status,201);
    assert.equal((await req(base,'POST',{...input,message:'Mudou'},'client')).status,409);
    let list=(await req(base)).data;assert.equal(list.length,1);assert.equal(list[0].messages.length,1);assert.equal(list[0].awaiting,'ENGINEER');
    const id=list[0].id,reply={message:'Na próxima segunda-feira.',request_id:randomUUID()};
    for(let i=0;i<2;i++)assert.equal((await req(`${base}/${id}/messages`,'POST',reply)).status,201);
    list=(await req(base,'GET',undefined,'client')).data;assert.equal(list[0].awaiting,'CLIENT');assert.equal(list[0].messages.length,2);assert.equal(list[0].messages[1].author_role,'ENGINEER');
    assert.equal((await req(`${base}/${id}/messages`,'POST',{message:'Outra dúvida'},'other')).status,404);
    assert.equal((await req(`/projects/${q}/questions/${id}/messages`,'POST',{message:'Obra errada'})).status,404);
    assert.equal((await req(`${base}/${id}/messages`,'POST',{message:'Qual horário?'},'client')).status,201);
    assert.equal((await req(`/projects/${p}`)).data.questions[0].awaiting,'ENGINEER');
    await req(`/projects/${p}/client`,'PATCH',{client_id:'other'});
    assert.equal((await req(base,'GET',undefined,'client')).status,404);
    assert.deepEqual((await req(base,'GET',undefined,'other')).data,[]);
    assert.equal((await req(`${base}/${id}/messages`,'POST',{message:'Espiar'},'other')).status,404);
    assert.equal((await req(`${base}/${id}/messages`,'POST',{message:'Resposta antiga'})).status,409);
    assert.equal((await req(base)).data[0].messages.length,3);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action LIKE 'question.%'").get().n,3);
  } finally {await f.close();}
});

test('unidades numéricas são rejeitadas e legado pode ser corrigido sem mudar saldo',async()=>{
  const f=await fixture(),{req,project:p,db}=f,base=`/projects/${p}/materials`;
  try {
    for(const unit of ['150','1000','1,5'])assert.equal((await req(base,'POST',{name:'Cimento',unit,quantity:3})).status,400);
    const id=(await req(base,'POST',{name:'Cimento',unit:'saco',quantity:3})).data.id;
    db.prepare('UPDATE materials SET unit=? WHERE id=?').run('150',id);
    assert.equal((await req(`${base}/${id}`,'PATCH',{name:'Cimento',unit:'saco',quantity:150})).status,409);
    assert.equal((await req(`${base}/${id}`,'PATCH',{name:'Cimento',unit:'saco',quantity:3})).status,200);
    const detail=(await req(`/projects/${p}`)).data;
    assert.equal(detail.materials[0].quantity,3);assert.equal(detail.movements[0].unit,'saco');assert.equal(detail.movements[0].delta,3);
    assert.equal((await req(`${base}/${id}`,'PATCH',{name:'Cimento',unit:'kg',quantity:3})).status,409);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action LIKE 'material.unit.corrected:%'").get().n,1);
  } finally {await f.close();}
});

test('migração v1 preserva saldos, pagamentos e medições sem duplicar em reinício',()=>{
  const dir=mkdtempSync(join(tmpdir(),'migration-')),file=join(dir,'obras.sqlite');
  let db=new DatabaseSync(file);
  try {
    db.exec(readFileSync(new URL('./fixtures/schema-v1.sql',import.meta.url),'utf8'));
    db.prepare("INSERT INTO projects(id,name) VALUES('p','Legado')").run();
    db.prepare("INSERT INTO materials(id,project_id,name,unit,quantity) VALUES('m','p','Cimento','saco',12.5)").run();
    db.prepare("INSERT INTO expenses(id,project_id,description,category,amount_cents,expense_date,status) VALUES('e','p','Compra','Material',12345,'2026-01-01','PAID')").run();
    db.prepare("INSERT INTO stages(id,project_id,title,status) VALUES('s','p','Etapa','COMPLETED')").run();
    db.close();db=openDatabase(dir);
    assert.equal(db.prepare('SELECT SUM(delta) n FROM material_movements').get().n,12.5);
    assert.equal(db.prepare('SELECT SUM(amount_cents) n FROM expense_payments').get().n,12345);
    assert.equal(db.prepare('SELECT progress_percent FROM stages').get().progress_percent,100);
    db.close();db=openDatabase(dir);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM material_movements').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM expense_payments').get().n,1);
    assert.deepEqual(db.prepare('SELECT version FROM migrations ORDER BY version').all().map(r=>r.version),[1,2,3,4,5,6,7]);
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});
