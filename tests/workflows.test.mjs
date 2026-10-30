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

test('estoque: retiradas subtraem, reservas protegem saldo e estornos são auditáveis',async t=>{
 const f=await fixture(),{req,db,project:p,target:q}=f,base=`/projects/${p}`,other=`/projects/${q}`,date=workToday();
 try {
  let material,entry,consume,reservation;
  await t.test('lista fechada de unidades impede número e texto combinado; legado é corrigível',async()=>{
   for(const unit of ['1000','1000 un','150 sacos','m2','unidade'])assert.equal((await req(base+'/materials','POST',{name:'Tijolos',unit,quantity:1000})).status,400);
   material=(await req(base+'/materials','POST',{name:'Tijolos',unit:'un',quantity:1000,minimum_quantity:600})).data.id;
   db.prepare('UPDATE materials SET unit=? WHERE id=?').run('1000 un',material);
   assert.equal((await req(`${base}/materials/${material}/movements`,'POST',{type:'ENTRY',quantity:1,movement_date:date})).status,409);
   assert.equal((await req(`${base}/materials/${material}`,'PATCH',{name:'Tijolos',unit:'un',quantity:1000})).status,200);
  });
  await t.test('1000 menos 400 e 100 deixa exatamente 500; entradas têm sinal contrário',async()=>{
   for(const quantity of [400,100]){const r=await req(`${base}/materials/${material}/movements`,'POST',{type:'CONSUMPTION',quantity,movement_date:date});assert.equal(r.status,201);consume=r.data.id;}
   let m=(await req(base)).data.materials[0];assert.equal(m.quantity,500);assert.equal(m.available_quantity,500);assert.equal(m.low_stock,true);
   entry=(await req(`${base}/materials/${material}/movements`,'POST',{type:'ENTRY',quantity:100,movement_date:date})).data.id;
   assert.equal((await req(base)).data.materials[0].quantity,600);
  });
  await t.test('estorno desfaz somente o movimento e rejeita repetição e referências de outra obra',async()=>{
   const data={reason:'Entrada incorreta',request_id:randomUUID()};
   assert.equal((await req(`${other}/movements/${entry}/reverse`,'POST',data)).status,404);
   assert.equal((await req(`${base}/movements/${entry}/reverse`,'POST',data,'client')).status,403);
   for(let i=0;i<2;i++)assert.equal((await req(`${base}/movements/${entry}/reverse`,'POST',data)).status,201);
   assert.equal((await req(base)).data.materials[0].quantity,500);
   assert.equal((await req(`${base}/movements/${entry}/reverse`,'POST',{reason:'Outra tentativa'})).status,409);
   const reversal=db.prepare('SELECT id FROM material_movements WHERE reverses_id=?').get(entry);
   assert.equal((await req(`${base}/movements/${reversal.id}/reverse`,'POST',{reason:'Ciclo'})).status,409);
   assert.equal((await req(`${base}/movements/${consume}/reverse`,'POST',{reason:'Retirada incorreta'})).status,201);
   assert.equal((await req(base)).data.materials[0].quantity,600);
  });
  await t.test('reserva reduz livre, não o saldo físico, e impede saídas/transferências excessivas',async()=>{
   const stage=(await req(base+'/stages','POST',{title:'Alvenaria'})).data.id;
   reservation=(await req(base+'/reservations','POST',{material_id:material,quantity:200,purpose:'Paredes',stage_id:stage})).data.id;
   const detail=(await req(base)).data;assert.equal(detail.materials[0].quantity,600);assert.equal(detail.materials[0].reserved_quantity,200);assert.equal(detail.materials[0].available_quantity,400);
   assert.equal((await req(`${base}/materials/${material}/movements`,'POST',{type:'CONSUMPTION',quantity:401,movement_date:date})).status,409);
   assert.equal((await req(`${base}/stages/${stage}`,'DELETE')).status,409);
   const target=(await req(other+'/materials','POST',{name:'Tijolos',unit:'un',quantity:0})).data.id;
   assert.equal((await req(`${base}/materials/${material}/movements`,'POST',{type:'TRANSFER_OUT',quantity:401,movement_date:date,target_material_id:target})).status,409);
   assert.equal((await req(base+'/reservations','POST',{material_id:target,quantity:1,purpose:'Outra obra'})).status,404);
   assert.equal((await req(base+'/reservations','GET',undefined,'client')).status,403);
  });
  await t.test('uso reservado dá baixa uma vez; liberar reserva não cria entrada',async()=>{
   const key=randomUUID();for(let i=0;i<2;i++)assert.equal((await req(`${base}/reservations/${reservation}/consume`,'POST',{request_id:key})).status,201);
   assert.equal((await req(`${base}/reservations/${reservation}/release`,'POST',{})).status,409);
   let m=(await req(base)).data.materials[0];assert.equal(m.quantity,400);assert.equal(m.reserved_quantity,0);
   const id=(await req(base+'/reservations','POST',{material_id:material,quantity:100,purpose:'Reserva temporária'})).data.id;
   assert.equal((await req(`${base}/reservations/${id}/release`,'POST',{})).status,201);m=(await req(base)).data.materials[0];assert.equal(m.quantity,400);assert.equal(m.available_quantity,400);
   const used=db.prepare('SELECT movement_id FROM stock_reservations WHERE id=?').get(reservation).movement_id;
   assert.equal((await req(`${base}/movements/${used}/reverse`,'POST',{reason:'Uso vinculado'})).status,409);
  });
  await t.test('duas reservas simultâneas nunca comprometem mais material que existe',async()=>{
   const results=await Promise.all([1,2].map(()=>req(base+'/reservations','POST',{material_id:material,quantity:300,purpose:'Concorrência'})));assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
   const detail=(await req(base,'GET',undefined,'client')).data;for(const key of ['materials','movements','reservations','purchases'])assert.equal(detail[key],undefined);
  });
 }finally{await f.close();}
});

test('compras diretas: registro único cria material, baixa orçamento e informa pagamento',async t=>{
 const f=await fixture(),{req,db,project:p,target:q}=f,base=`/projects/${p}`,date=workToday();let material,purchase;
 try {
  await t.test('compra paga cadastra material, estoque, despesa e pagamento atomicamente',async()=>{
   const input={new_material:{name:'Tijolos',unit:'un'},quantity:1000,unit_price:.5,freight:20,supplier:'Depósito A',purchase_date:date,payment_status:'PAID',method:'PIX',invoice_number:'NF-12',request_id:randomUUID()};
   for(let i=0;i<2;i++){const r=await req(base+'/purchases','POST',input);assert.equal(r.status,201);material=r.data.material_id;purchase=r.data.id;}
   const d=(await req(base)).data;assert.equal(d.materials.length,1);assert.equal(d.materials[0].quantity,1000);assert.equal(d.movements.length,1);assert.equal(d.expenses.length,1);assert.equal(d.payments.length,1);
   assert.equal(d.project.expense_cents,52000);assert.equal(d.project.paid_cents,52000);assert.equal(d.project.budget_cents-d.project.expense_cents,448000);assert.equal(d.purchases[0].invoice_number,'NF-12');
   assert.equal((await req(`${base}/purchases/${purchase}/receive`,'POST',{received_date:date})).status,409);
   assert.equal((await req(base+'/purchases','POST',{...input,quantity:999})).status,409);
  });
  await t.test('compra a prazo soma ao material existente sem duplicar e não registra pagamento',async()=>{
   const r=await req(base+'/purchases','POST',{material_id:material,quantity:100,unit_price:.6,freight:0,supplier:'Loja B',purchase_date:date,payment_status:'PENDING',due_date:date});assert.equal(r.status,201);
   const d=(await req(base)).data;assert.equal(d.materials.length,1);assert.equal(d.materials[0].quantity,1100);assert.equal(d.project.expense_cents,58000);assert.equal(d.project.paid_cents,52000);assert.equal(d.payments.length,1);
   assert.equal((await req(`${base}/expenses/${r.data.expense_id}`,'DELETE')).status,409);
   assert.equal((await req(`${base}/movements/${r.data.movement_id}/reverse`,'POST',{reason:'Compra vinculada'})).status,409);
   assert.equal((await req(`${base}/expenses/${r.data.expense_id}`,'PATCH',{description:'Compra',category:'Materiais',amount:10,expense_date:date})).status,409);
  });
  await t.test('novo material com mesmo nome/unidade reutiliza cadastro e permite saldo negativo no orçamento real',async()=>{
   const r=await req(base+'/purchases','POST',{new_material:{name:' tijolos ',unit:'un'},quantity:10,unit_price:1000,supplier:'Loja C',purchase_date:date});assert.equal(r.status,201);assert.equal(r.data.material_id,material);
   const d=(await req(base)).data;assert.equal(d.materials.length,1);assert.equal(d.materials[0].quantity,1110);assert.ok(d.project.budget_cents-d.project.expense_cents<0);
  });
  await t.test('validação, isolamento e cotação desativada não deixam registros parciais',async()=>{
   const input={new_material:{name:'Não criar',unit:'kg'},quantity:10,unit_price:10,supplier:'Loja',purchase_date:date,payment_status:'PENDING',due_date:'inválida'};
   const before=(await req(base)).data;
   assert.equal((await req(base+'/purchases','POST',input)).status,400);
   assert.equal((await req(base+'/purchases','POST',{...input,due_date:date,new_material:{name:'Não criar',unit:'1000 un'}})).status,400);
   assert.equal((await req(`/projects/${q}/purchases`,'POST',{material_id:material,quantity:10,unit_price:10,supplier:'Loja',purchase_date:date})).status,404);
   assert.equal((await req(base+'/purchases','POST',{...input,due_date:date},'client')).status,403);
   assert.equal((await req(`${base}/purchases/${purchase}/quotes`,'POST',{supplier:'Loja',unit_price:10})).status,409);
   db.prepare('UPDATE materials SET unit=? WHERE id=?').run('1000 un',material);
   assert.equal((await req(base+'/purchases','POST',{new_material:{name:'Tijolos',unit:'un'},quantity:1,unit_price:1,supplier:'Loja',purchase_date:date})).status,409);
   db.prepare('UPDATE materials SET unit=? WHERE id=?').run('un',material);
   const after=(await req(base)).data;assert.equal(after.materials.length,before.materials.length);assert.equal(after.expenses.length,before.expenses.length);assert.equal(after.movements.length,before.movements.length);
   assert.equal((await req(base,'GET',undefined,'client')).data.purchases,undefined);
  });
  await t.test('registro antigo pendente só entra no estoque e orçamento quando confirmado',async()=>{
   const old=randomUUID();db.prepare("INSERT INTO purchases(id,project_id,material_id,quantity) VALUES(?,?,?,500)").run(old,p,material);
   const before=(await req(base)).data;
   const input={material_id:material,quantity:500,unit_price:.5,supplier:'Compra anterior',purchase_date:date,payment_status:'PENDING',request_id:randomUUID()};
   for(let i=0;i<2;i++)assert.equal((await req(`${base}/purchases/${old}/complete`,'POST',input)).status,201);
   const after=(await req(base)).data;assert.equal(after.materials[0].quantity,before.materials[0].quantity+500);assert.equal(after.project.expense_cents,before.project.expense_cents+25000);assert.equal(after.purchases.find(p=>p.id===old).status,'RECEIVED');
   assert.equal((await req(`${base}/purchases/${old}/complete`,'POST',{...input,request_id:randomUUID()})).status,409);
  });
 }finally{await f.close();}
});

test('acabamentos e pós-obra: decisões, fotos e histórico isolados por titular',async t=>{
 const f=await fixture(),{req,project:p,target:q}=f,base=`/projects/${p}`,date=workToday();
 const tiny='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW2kAAAAASUVORK5CYII=';
 let selection,option,photo,inspection;
 try {
  await t.test('escolhas ficam em rascunho e fotos internas precisam ser publicadas',async()=>{
   photo=(await req(base+'/attachments','POST',{kind:'PHOTO',title:'Piso',record_date:date,file_name:'foto.png',file_base64:tiny})).data.id;
   selection=(await req(base+'/selections','POST',{title:'Piso da cozinha',location:'Cozinha'})).data.id;
   option=(await req(`${base}/selections/${selection}/options`,'POST',{title:'Porcelanato',amount:300,image_id:photo})).data.id;
   assert.equal((await req(base,'GET',undefined,'client')).data.selections.length,0);
   assert.equal((await req(`${base}/selections/${selection}/send`,'POST',{})).status,409);
   await req(`/attachments/${photo}`,'PATCH',{visible_to_client:true});
   assert.equal((await req(`${base}/selections/${selection}/send`,'POST',{})).status,201);
   assert.equal((await req(`${base}/selections/${selection}/options`,'POST',{title:'Modificar'})).status,409);
   assert.equal((await req(`/attachments/${photo}`,'DELETE')).status,409);
  });
  await t.test('escolha do cliente é única, exige opção da mesma seleção e preserva orçamento',async()=>{
   const before=(await req(base)).data.project;
   assert.equal((await req(`${base}/selections/${selection}/choose`,'POST',{option_id:option})).status,403);
   assert.equal((await req(`${base}/selections/${selection}/choose`,'POST',{option_id:option},'other')).status,404);
   assert.equal((await req(`${base}/selections/${selection}/choose`,'POST',{option_id:'errada'},'client')).status,400);
   const data={option_id:option,note:'Gostei dessa.',request_id:randomUUID()};for(let i=0;i<2;i++)assert.equal((await req(`${base}/selections/${selection}/choose`,'POST',data,'client')).status,201);
   assert.equal((await req(`${base}/selections/${selection}/reject`,'POST',{},'client')).status,409);
   const detail=(await req(base)).data;assert.equal(detail.project.budget_cents,before.budget_cents);assert.equal(detail.project.expense_cents,0);assert.equal(detail.selections[0].selected_option_id,option);
  });
  await t.test('cliente abre pendência e envia foto, sem acesso a outra obra nem arquivos arbitrários',async()=>{
   inspection=(await req(base+'/inspections','POST',{title:'Trinca na parede',description:'Perto da porta',location:'Sala'},'client')).data.id;
   const input={file_name:'trinca.png',file_base64:tiny,request_id:randomUUID()};
   assert.equal((await req(`${base}/inspections/${inspection}/photo`,'POST',input,'other')).status,404);
   assert.equal((await req(`${base}/inspections/${inspection}/photo`,'POST',{...input,file_name:'arquivo.svg',file_base64:Buffer.from('<svg/>').toString('base64')},'client')).status,400);
   for(let i=0;i<2;i++)assert.equal((await req(`${base}/inspections/${inspection}/photo`,'POST',input,'client')).status,201);
   const d=(await req(base,'GET',undefined,'client')).data;assert.equal(d.inspections[0].attachment_ids.length,1);
   assert.equal((await req(`/attachments/${input.request_id}/file`,'GET',undefined,'client')).status,200);
   assert.equal((await req(`/attachments/${input.request_id}`,'DELETE')).status,409);
  });
  await t.test('engenheiro atende e cliente confere; reabertura exige justificativa',async()=>{
   assert.equal((await req(`${base}/inspections/${inspection}/update`,'POST',{status:'RESOLVED',note:'Falso'},'client')).status,403);
   assert.equal((await req(`${base}/inspections/${inspection}/close`,'POST',{note:'Ainda aberta'},'client')).status,409);
   assert.equal((await req(`${base}/inspections/${inspection}/update`,'POST',{status:'IN_PROGRESS',responsible:'José',due_date:date,note:'Agendado reparo'})).status,201);
   assert.equal((await req(`${base}/inspections/${inspection}/update`,'POST',{status:'RESOLVED',responsible:'José',note:'Reparo concluído'})).status,201);
   assert.equal((await req(`${base}/inspections/${inspection}/close`,'POST',{note:'Conferido no local'},'client')).status,201);
   assert.equal((await req(`${base}/inspections/${inspection}/reopen`,'POST',{note:' '},'client')).status,400);
   assert.equal((await req(`${base}/inspections/${inspection}/reopen`,'POST',{note:'A trinca reapareceu'},'client')).status,201);
   const ticket=(await req(base)).data.inspections[0];assert.equal(ticket.status,'OPEN');assert.equal(ticket.events.length,5);
  });
  await t.test('novo titular não herda conversas, escolhas ou chamados anteriores',async()=>{
   await req(`${base}/client`,'PATCH',{client_id:'other'});
   const d=(await req(base,'GET',undefined,'other')).data;assert.equal(d.inspections.length,0);assert.equal(d.selections.length,0);
   assert.equal((await req(`${base}/inspections/${inspection}/reopen`,'POST',{note:'Espiar'},'other')).status,404);
   assert.equal((await req(`${base}/selections/${selection}/choose`,'POST',{option_id:option},'client')).status,404);
   assert.equal((await req(base)).data.inspections.length,1);
  });
 }finally{await f.close();}
});

test('migração 5 preserva compras antigas e não lança estoque ou despesa novamente',()=>{
 const dir=mkdtempSync(join(tmpdir(),'purchases-migration-'));let db=openDatabase(dir);
 try {
  db.prepare("INSERT INTO projects(id,name) VALUES('p','Obra anterior')").run();
  db.prepare("INSERT INTO materials(id,project_id,name,unit,quantity) VALUES('m','p','Cimento','saco',10)").run();
  db.prepare("INSERT INTO material_movements(id,material_id,type,quantity,delta,movement_date) VALUES('move','m','ENTRY',10,10,'2026-10-01')").run();
  db.prepare("INSERT INTO expenses(id,project_id,description,category,amount_cents,expense_date,status) VALUES('e','p','Compra','Materiais',32000,'2026-10-01','PENDING')").run();
  db.prepare("INSERT INTO purchases(id,project_id,material_id,quantity) VALUES('old','p','m',10)").run();
  db.prepare("INSERT INTO purchase_quotes(id,purchase_id,supplier,unit_price_cents,freight_cents,total_cents) VALUES('quote','old','Fornecedor antigo',3000,2000,32000)").run();
  db.prepare("UPDATE purchases SET status='RECEIVED',selected_quote_id='quote',expense_id='e',movement_id='move' WHERE id='old'").run();
  db.prepare("INSERT INTO purchases(id,project_id,material_id,quantity) VALUES('pending','p','m',500)").run();
  db.exec('DELETE FROM migrations WHERE version=5');
  for(const column of ['purchase_date','supplier','unit_price_cents','freight_cents','total_cents','invoice_number'])db.exec(`ALTER TABLE purchases DROP COLUMN ${column}`);
  db.close();db=openDatabase(dir);
  const p=db.prepare("SELECT * FROM purchases WHERE id='old'").get();assert.equal(p.total_cents,32000);assert.equal(p.freight_cents,2000);assert.equal(p.supplier,'Fornecedor antigo');assert.equal(p.purchase_date,'2026-10-01');
  assert.equal(db.prepare("SELECT total_cents FROM purchases WHERE id='pending'").get().total_cents,null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM expenses').get().n,1);assert.equal(db.prepare('SELECT SUM(delta) n FROM material_movements').get().n,10);
  db.close();db=openDatabase(dir);assert.equal(db.prepare('SELECT COUNT(*) n FROM expenses').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM material_movements').get().n,1);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
