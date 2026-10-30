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

test('revisão: compra incorreta, estoque, pagamentos e saldo permanecem coerentes',async t=>{
 const f=await fixture(),{req,project:p,target:q,db}=f,base=`/projects/${p}`,date=workToday();let purchase,material,expense;
 try{
  await t.test('registro e pagamento parcial não duplicam custo no orçamento',async()=>{
   const r=await req(base+'/purchases','POST',{new_material:{name:'Cimento',unit:'saco'},quantity:10,unit_price:30,supplier:'Loja',purchase_date:date,payment_status:'PENDING'});assert.equal(r.status,201);purchase=r.data.id;material=r.data.material_id;expense=r.data.expense_id;
   assert.equal((await req(`${base}/expenses/${expense}/payments`,'POST',{amount:100,payment_date:date})).status,201);
   const d=(await req(base)).data;assert.equal(d.project.expense_cents,30000);assert.equal(d.project.paid_cents,10000);assert.equal(d.project.budget_cents-d.project.expense_cents,470000);
  });
  await t.test('uso ou reserva impede estorno integral; correção exige recompor saldo livre',async()=>{
   const move=(await req(`${base}/materials/${material}/movements`,'POST',{type:'CONSUMPTION',quantity:2,movement_date:date})).data.id;
   assert.equal((await req(`${base}/purchases/${purchase}/void`,'POST',{reason:'Quantidade errada'})).status,409);
   await req(`${base}/movements/${move}/reverse`,'POST',{reason:'Retirada equivocada'});
   const reserve=(await req(base+'/reservations','POST',{material_id:material,quantity:1,purpose:'Serviço'})).data.id;
   assert.equal((await req(`${base}/purchases/${purchase}/void`,'POST',{reason:'Quantidade errada'})).status,409);
   await req(`${base}/reservations/${reserve}/release`,'POST',{});
  });
  await t.test('estorno autorizado reverte estoque, custo e pagamentos uma única vez e mantém histórico',async()=>{
   const input={reason:'Compra lançada em duplicidade',request_id:randomUUID()};
   assert.equal((await req(`${base}/purchases/${purchase}/void`,'POST',input,'client')).status,403);
   assert.equal((await req(`/projects/${q}/purchases/${purchase}/void`,'POST',input)).status,404);
   assert.equal((await req(`${base}/purchases/${purchase}/void`,'POST',{reason:' '})).status,400);
   for(let i=0;i<2;i++)assert.equal((await req(`${base}/purchases/${purchase}/void`,'POST',input)).status,201);
   const d=(await req(base)).data;assert.equal(d.materials[0].quantity,0);assert.equal(d.project.expense_cents,0);assert.equal(d.project.paid_cents,0);assert.equal(d.project.budget_cents,500000);assert.equal(d.expenses[0].payment_state,'CANCELLED');assert.equal(d.expenses[0].outstanding_cents,0);assert.ok(d.payments[0].voided_at);assert.equal(d.purchases[0].status,'CANCELLED');
   assert.equal((await req(`${base}/purchases/${purchase}/void`,'POST',{reason:'Repetir'})).status,409);
   assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='purchase.voided'").get().n,1);
  });
  await t.test('despesa cancelada não pode receber pagamento ou ser reescrita; nova compra correta funciona',async()=>{
   assert.equal((await req(`${base}/expenses/${expense}/payments`,'POST',{amount:1,payment_date:date})).status,409);
   assert.equal((await req(`${base}/expenses/${expense}`,'PATCH',{description:'Alterar',category:'Materiais',amount:30,expense_date:date})).status,409);
   const r=await req(base+'/purchases','POST',{material_id:material,quantity:5,unit_price:30,supplier:'Loja',purchase_date:date});assert.equal(r.status,201);
   const d=(await req(base)).data;assert.equal(d.materials[0].quantity,5);assert.equal(d.project.expense_cents,15000);assert.equal(d.project.paid_cents,15000);assert.equal(d.expenses.length,2);
  });
  await t.test('pagamento simultâneo ao estorno não reabre despesa cancelada',async()=>{
   const purchase=(await req(base+'/purchases','POST',{material_id:material,quantity:10,unit_price:1,supplier:'Loja',purchase_date:date,payment_status:'PENDING'})).data;
   const results=await Promise.all([req(`${base}/purchases/${purchase.id}/void`,'POST',{reason:'Duplicada'}),req(`${base}/expenses/${purchase.expense_id}/payments`,'POST',{amount:5,payment_date:date})]);
   assert.equal(results[0].status,201);assert.ok([201,409].includes(results[1].status));
   assert.equal(db.prepare('SELECT COUNT(*) n FROM expense_payments WHERE expense_id=? AND voided_at IS NULL').get(purchase.expense_id).n,0);
   assert.equal((await req(base)).data.expenses.find(e=>e.id===purchase.expense_id).payment_state,'CANCELLED');
  });
 }finally{await f.close();}
});

test('revisão: avanço, cadastro duplicado, equipe histórica e rotas',async t=>{
 const f=await fixture(),{req,project:p,db}=f,base=`/projects/${p}`,date=workToday();
 try{
  await t.test('etapa em 99,9% não faz a obra aparecer concluída',async()=>{
   const id=(await req(base+'/stages','POST',{title:'Fundação',status:'IN_PROGRESS',progress_percent:99.9})).data.id;
   assert.equal((await req(base)).data.project.progress,99);
   await req(`${base}/stages/${id}`,'PATCH',{title:'Fundação',status:'COMPLETED',progress_percent:100});assert.equal((await req(base)).data.project.progress,100);
   assert.equal((await req(`${base}/stages/${id}/payments`,'DELETE')).status,404);assert.equal(db.prepare('SELECT COUNT(*) n FROM stages').get().n,1);
  });
  await t.test('cadastro inicial repetido e renomear para outro material são bloqueados',async()=>{
   const id=(await req(base+'/materials','POST',{name:'Cimento',unit:'saco',quantity:10})).data.id;
   assert.equal((await req(base+'/materials','POST',{name:' cimento ',unit:'saco',quantity:10})).status,409);
   const second=(await req(base+'/materials','POST',{name:'Areia',unit:'saco',quantity:2})).data.id;
   assert.equal((await req(`${base}/materials/${second}`,'PATCH',{name:'Cimento',unit:'saco',quantity:2})).status,409);
   assert.equal(db.prepare('SELECT quantity FROM materials WHERE id=?').get(id).quantity,10);
  });
  await t.test('equipe presente no diário não pode ser excluída, mas pode ser inativada',async()=>{
   const worker=(await req(base+'/workers','POST',{name:'José',job_title:'Pedreiro'})).data.id;
   const diary=(await req(base+'/diary','POST',{work_date:date,services:'Alvenaria',worker_ids:[worker]})).data.id;
   assert.equal((await req(`${base}/workers/${worker}`,'DELETE')).status,409);
   assert.equal((await req(`${base}/workers/${worker}`,'PATCH',{name:'José',job_title:'Pedreiro',active:false})).status,200);
   const d=(await req(base)).data;assert.equal(d.diary[0].workforce[0].name,'José');assert.equal(d.workers[0].active,0);
   await req(`${base}/diary/${diary}`,'PATCH',{work_date:date,services:'Alvenaria corrigida',worker_ids:[],version:1});
   assert.equal((await req(`${base}/workers/${worker}`,'DELETE')).status,409);
  });
 }finally{await f.close();}
});

test('revisão: atenção por obra filtra dados internos e decisões do cliente',async()=>{
 const f=await fixture(),{req,project:p}=f,base=`/projects/${p}`,date=workToday();
 try{
  await req(base+'/materials','POST',{name:'Cimento',unit:'saco',quantity:1,minimum_quantity:2});
  await req(base+'/expenses','POST',{description:'Mão de obra',category:'Serviços',amount:100,expense_date:date,due_date:'2000-01-01'});
  await req(base+'/questions','POST',{title:'Dúvida',message:'Qual o prazo?'},'client');
  const approval=(await req(base+'/approvals','POST',{title:'Alteração',description:'Revestimento'})).data.id;await req(`${base}/approvals/${approval}/send`,'POST',{});
  let engineer=(await req('/projects')).data.find(p=>p.id===f.project),client=(await req('/projects','GET',undefined,'client')).data[0];
  assert.equal(engineer.questions_waiting,1);assert.equal(engineer.low_stock_count,1);assert.equal(engineer.overdue_cents,10000);assert.equal(client.decisions_pending,1);
  for(const key of ['low_stock_count','questions_waiting','overdue_cents','expense_cents'])assert.equal(client[key],undefined);
  await req(`${base}/approvals/${approval}/decision`,'POST',{status:'APPROVED'},'client');
  assert.equal((await req('/projects','GET',undefined,'client')).data[0].decisions_pending,0);
  await req(`${base}/client`,'PATCH',{client_id:'other'});assert.equal((await req('/projects')).data.find(p=>p.id===f.project).questions_waiting,0);
 }finally{await f.close();}
});
