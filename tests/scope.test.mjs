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

test('serviços contratados determinam avanço físico, etapas apenas organizam',async t=>{
 const f=await fixture(),{req,project:p,target:q,db}=f,base=`/projects/${p}`,date=workToday();let foundation,walls,paint,record;
 try{
  await t.test('rascunho é interno e não converte etapas antigas em execução real',async()=>{
   await req(base+'/stages','POST',{title:'Comprar cimento',status:'COMPLETED'});
   foundation=(await req(base+'/services','POST',{title:'Fundação',mode:'PERCENT',share:30})).data.id;
   walls=(await req(base+'/services','POST',{title:'Alvenaria',mode:'QUANTITY',unit:'m²',quantity:200,share:40})).data.id;
   paint=(await req(base+'/services','POST',{title:'Pintura',mode:'QUANTITY',unit:'m²',quantity:300,share:30})).data.id;
   const d=(await req(base)).data;assert.equal(d.project.progress,0);assert.equal(d.project.progress_configured,false);assert.equal(d.project.completed_stages,1);
   assert.equal((await req(base,'GET',undefined,'client')).data.services.length,0);
   assert.equal((await req(`${base}/services/${walls}/records`,'POST',{quantity:1,work_date:date,note:'Sem confirmar'})).status,409);
   assert.equal((await req(base+'/services','POST',{title:'Proibido',mode:'PERCENT',share:10},'client')).status,403);
  });
  await t.test('contratação confirmada trava cadastro e exige soma das participações em 100%',async()=>{
   await req(`${base}/services/${paint}`,'PATCH',{title:'Pintura',mode:'QUANTITY',unit:'m²',quantity:300,share:20});
   assert.equal((await req(base+'/scope','POST',{version:0,reason:'Contrato'})).status,400);
   await req(`${base}/services/${paint}`,'PATCH',{title:'Pintura',mode:'QUANTITY',unit:'m²',quantity:300,share:30});
   const data={version:0,reason:'Fundação, paredes e pintura contratadas',request_id:randomUUID()};
   for(let i=0;i<2;i++)assert.equal((await req(base+'/scope','POST',data)).status,200);
   assert.equal((await req(`${base}/services/${walls}`,'PATCH',{title:'Mudar',mode:'PERCENT',share:40})).status,409);
   assert.equal((await req(`${base}/services/${paint}`,'DELETE',{})).status,409);
   assert.equal((await req(base,'GET',undefined,'client')).data.services.length,3);
  });
  await t.test('100% da fundação e 100 de 200m² de paredes somam 50% da obra',async()=>{
   assert.equal((await req(`${base}/services/${foundation}/records`,'POST',{quantity:100,work_date:date,note:'Fundação pronta'})).status,200);
   const data={quantity:100,work_date:date,note:'Paredes executadas',request_id:randomUUID()};
   for(let i=0;i<2;i++){const r=await req(`${base}/services/${walls}/records`,'POST',data);assert.equal(r.status,200);record=r.data.id;}
   let d=(await req(base)).data;assert.equal(d.project.progress,50);assert.equal(d.services.find(s=>s.id===walls).executed_quantity,100);assert.equal(d.service_records.length,2);
   await req(base+'/stages','POST',{title:'Marcação',status:'COMPLETED',service_id:walls});
   await req(base+'/stages','POST',{title:'Conferência',status:'PLANNED',service_id:walls});
   assert.equal((await req(base)).data.project.progress,50);
   assert.equal((await req(`/projects/${q}/stages`,'POST',{title:'Outra obra',service_id:walls})).status,400);
  });
  await t.test('medição respeita contratado, propriedade, fotos e correção auditável',async()=>{
   assert.equal((await req(`${base}/services/${walls}/records`,'POST',{quantity:101,work_date:date,note:'Excesso'})).status,409);
   assert.equal((await req(`/projects/${q}/services/${walls}/records`,'POST',{quantity:1,work_date:date,note:'Outra obra'})).status,409);
   assert.equal((await req(`${base}/services/${walls}/records`,'POST',{quantity:1,work_date:date,note:'Inválido',attachment_ids:['outra-obra']})).status,400);
   assert.equal((await req(`${base}/execution/${record}/void`,'POST',{reason:'Correção'},'client')).status,403);
   assert.equal((await req(`${base}/execution/${record}/void`,'POST',{reason:'Quantidade duplicada'})).status,200);
   assert.equal((await req(base)).data.project.progress,30);
   assert.equal((await req(`${base}/execution/${record}/void`,'POST',{reason:'Repetir'})).status,409);
   await req(`${base}/services/${walls}/records`,'POST',{quantity:100,work_date:date,note:'Quantidade correta'});
  });
  await t.test('aditivo registra versão e impacto sem alterar orçamento; impede redução abaixo do realizado',async()=>{
   let rows=(await req(base)).data.services.map(s=>({id:s.id,title:s.title,mode:s.mode,unit:s.unit,quantity:s.quantity,share:s.share}));
   const invalid=rows.map(s=>s.id===walls?{...s,quantity:50}:s);
   assert.equal((await req(base+'/scope/revise','POST',{version:1,reason:'Reduzir',services:invalid})).status,409);
   rows=rows.map(s=>s.id===walls?{...s,quantity:300}:s);
   const input={version:1,reason:'Mais 100m² de alvenaria contratados',services:rows,request_id:randomUUID()};
   for(let i=0;i<2;i++)assert.equal((await req(base+'/scope/revise','POST',input)).status,200);
   const d=(await req(base)).data;assert.equal(d.project.progress,43);assert.equal(d.project.budget_cents,500000);assert.equal(d.project.expense_cents,0);assert.equal(d.scope_revisions[0].progress_before,50);assert.equal(d.scope_revisions[0].progress_after,43);
   assert.equal((await req(base+'/scope/revise','POST',{...input,request_id:randomUUID()})).status,409);
  });
  await t.test('duas execuções simultâneas não ultrapassam saldo contratado e 100% exige conclusão real',async()=>{
   const result=await Promise.all([1,2].map(()=>req(`${base}/services/${walls}/records`,'POST',{quantity:150,work_date:date,note:'Avanço'})));assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);
   await req(`${base}/services/${walls}/records`,'POST',{quantity:50,work_date:date,note:'Final das paredes'});
   await req(`${base}/services/${paint}/records`,'POST',{quantity:300,work_date:date,note:'Pintura concluída'});
   const d=(await req(base,'GET',undefined,'client')).data;assert.equal(d.project.progress,100);assert.equal(d.project.completed_stages,2);assert.equal(d.project.stage_count,3);
   assert.equal((await req(base,'GET',undefined,'other')).status,404);assert.ok(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='service.execution'").get().n>3);
  });
 }finally{await f.close();}
});
