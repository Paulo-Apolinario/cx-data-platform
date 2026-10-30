import { randomUUID, createHash } from 'node:crypto';
import * as v from './validation.mjs';
import { isUnit } from '../public/units.js';

export function createWorkflows(ctx) {
  const {get,all,run,audit,transaction,engineer,projectFor,balance,reserved,free,quantity,workToday}=ctx;
  const fail=message=>{throw new v.HttpError(409,message);};
  function record(table,projectId,id) {
    const row=get(`SELECT * FROM ${table} WHERE id=? AND project_id=?`,id,projectId);
    if(!row)throw new v.HttpError(404,'Registro não encontrado nesta obra.');return row;
  }
  function material(projectId,id){const row=record('materials',projectId,v.text(id,'Material'));if(!isUnit(row.unit))fail('Escolha uma unidade válida no cadastro do material.');return row;}
  function photo(projectId,id,user) {
    if(!id)return null;
    const a=get("SELECT * FROM attachments WHERE id=? AND project_id=? AND kind='PHOTO'",v.text(id,'Foto'),projectId);
    if(!a||user.role==='CLIENT'&&!a.visible_to_client)throw new v.HttpError(400,'Foto não disponível nesta obra.');return a.id;
  }
  function visible(row,user){if(user.role==='CLIENT'&&row.client_id!==user.id)throw new v.HttpError(404,'Registro não encontrado.');return row;}
  function current(row,project){if(!row.client_id||row.client_id!==project.client_id)fail('O cliente destinatário não está mais vinculado à obra.');}
  function command(user,path,input,fn) {
    const key=input.request_id??randomUUID();
    if(typeof key!=='string'||!/^[a-f0-9-]{36}$/i.test(key))throw new v.HttpError(400,'Identificador inválido.');
    const fingerprint=createHash('sha256').update(JSON.stringify([user.id,path,Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b)))])).digest('hex');
    return transaction(()=>{
      const existing=get('SELECT * FROM operation_requests WHERE id=?',key);
      if(existing){if(existing.fingerprint!==fingerprint)fail('Identificador já utilizado com outros dados.');return JSON.parse(existing.result_json);}
      const result=fn(key)||{ok:true};run('INSERT INTO operation_requests(id,fingerprint,result_json) VALUES(?,?,?)',key,fingerprint,JSON.stringify(result));return result;
    });
  }
  function movement(user,mat,type,amount,delta,date,notes,reverses=null) {
    const id=randomUUID();
    run('INSERT INTO material_movements(id,material_id,type,quantity,delta,movement_date,notes,author_id,reverses_id) VALUES(?,?,?,?,?,?,?,?,?)',id,mat.id,type,amount,delta,date,notes,user.id,reverses);
    run('UPDATE materials SET quantity=? WHERE id=?',balance(mat.id),mat.id);return id;
  }
  function details(projectId,user) {
    const selections=all(`SELECT * FROM selections WHERE project_id=? ${user.role==='CLIENT'?"AND client_id=? AND status IN ('PENDING','SELECTED','REJECTED')":''} ORDER BY rowid DESC`,...user.role==='CLIENT'?[projectId,user.id]:[projectId]).map(s=>({...s,options:all('SELECT * FROM selection_options WHERE selection_id=? ORDER BY rowid',s.id).map(o=>({...o,image_id:o.image_id&&get(`SELECT id FROM attachments WHERE id=? ${user.role==='CLIENT'?'AND visible_to_client=1':''}`,o.image_id)?o.image_id:null}))}));
    const inspections=all(`SELECT * FROM inspections WHERE project_id=? ${user.role==='CLIENT'?'AND client_id=?':''} ORDER BY rowid DESC`,...user.role==='CLIENT'?[projectId,user.id]:[projectId]).map(i=>({...i,attachment_ids:JSON.parse(i.attachment_ids_json).filter(id=>get(`SELECT id FROM attachments WHERE id=? ${user.role==='CLIENT'?'AND visible_to_client=1':''}`,id)),attachment_ids_json:undefined,events:all('SELECT e.status,e.note,e.created_at,u.name author_name FROM inspection_events e JOIN users u ON u.id=e.author_id WHERE inspection_id=? ORDER BY e.id',i.id),overdue:!!i.due_date&&i.due_date<workToday()&&!['RESOLVED','CLOSED'].includes(i.status)}));
    const result={selections,inspections};
    if(user.role==='ENGINEER')Object.assign(result,{
      reservations:all('SELECT r.*,m.name material_name,m.unit,s.title stage_title FROM stock_reservations r JOIN materials m ON m.id=r.material_id LEFT JOIN stages s ON s.id=r.stage_id WHERE m.project_id=? ORDER BY r.rowid DESC',projectId),
      purchases:all('SELECT p.*,m.name material_name,m.unit FROM purchases p JOIN materials m ON m.id=p.material_id WHERE p.project_id=? ORDER BY p.rowid DESC',projectId).map(p=>({...p,quotes:all('SELECT * FROM purchase_quotes WHERE purchase_id=? ORDER BY total_cents,delivery_date,id',p.id)}))
    });return result;
  }
  async function handle({path,req,user,body,send}) {
    const m=path.match(/^\/api\/projects\/([^/]+)\/(reservations|purchases|selections|inspections|movements)(?:\/([^/]+))?(?:\/(release|consume|quotes|order|receive|complete|void|cancel|options|send|choose|reject|update|close|reopen|reverse))?$/);
    if(!m)return false;
    const [,projectId,kind,id,action]=m;
    projectFor(user,projectId);
    if(['reservations','purchases','movements'].includes(kind))engineer(user);
    if(req.method==='GET'&&!id&&kind!=='movements'){send(200,details(projectId,user)[kind]);return true;}
    if(req.method!=='POST')throw new v.HttpError(405,'Método não permitido.');
    const input=await body(req);
    // Check ownership before the idempotency lookup, including after client reassignment.
    if(id&&['selections','inspections'].includes(kind)){
      const row=visible(record(kind,projectId,id),user);
      if(user.role==='CLIENT')current(row,projectFor(user,projectId));
    }
    const result=command(user,path,input,key=>{
      const project=projectFor(user,projectId);
      if(kind==='movements') {
        if(!id||action!=='reverse')throw new v.HttpError(404,'Ação não encontrada.');
        const row=get('SELECT mm.* FROM material_movements mm JOIN materials m ON m.id=mm.material_id WHERE mm.id=? AND m.project_id=?',id,projectId);
        if(!row)throw new v.HttpError(404,'Movimento não encontrado.');
        if(!['ENTRY','CONSUMPTION','LOSS'].includes(row.type)||row.transfer_id||row.reverses_id||get('SELECT id FROM material_movements WHERE reverses_id=?',id)||get('SELECT id FROM purchases WHERE movement_id=?',id)||get('SELECT id FROM stock_reservations WHERE movement_id=?',id))fail('Este movimento não permite estorno individual.');
        const reason=v.text(input.reason,'Motivo do estorno',1000),mat=material(projectId,row.material_id);
        if(row.delta>0&&free(mat.id)<row.quantity)fail('Saldo livre insuficiente para estornar esta entrada.');
        const newId=movement(user,mat,row.delta>0?'CONSUMPTION':'ENTRY',row.quantity,-row.delta,workToday(),`Estorno: ${reason}`,row.id);audit(user,'material.reversed',id);return{id:newId};
      }
      if(kind==='reservations') {
        if(!id){
          const mat=material(projectId,input.material_id),amount=quantity(input.quantity),stage=input.stage_id||null;
          if(stage)record('stages',projectId,stage);
          if(free(mat.id)<amount)fail('Saldo livre insuficiente para reservar.');
          run('INSERT INTO stock_reservations(id,material_id,stage_id,purpose,quantity,author_id) VALUES(?,?,?,?,?,?)',key,mat.id,stage,v.text(input.purpose,'Finalidade',500),amount,user.id);audit(user,'reservation.created',key);return{id:key};
        }
        const row=get('SELECT r.* FROM stock_reservations r JOIN materials m ON m.id=r.material_id WHERE r.id=? AND m.project_id=?',id,projectId);
        if(!row)throw new v.HttpError(404,'Reserva não encontrada.');
        if(row.status!=='ACTIVE')fail('Reserva já finalizada.');
        v.choice(action,['consume','release'],'Ação');
        const mat=material(projectId,row.material_id);
        if(action==='consume'&&balance(mat.id)<row.quantity)fail('Saldo insuficiente.');
        const movementId=action==='consume'?movement(user,mat,'CONSUMPTION',row.quantity,-row.quantity,workToday(),`Uso da reserva: ${row.purpose}`):null;
        run('UPDATE stock_reservations SET status=?,movement_id=? WHERE id=?',action==='consume'?'CONSUMED':'RELEASED',movementId,id);audit(user,`reservation.${action}`,id);return{ok:true};
      }
      if(kind==='purchases') {
        if(action==='void'&&id){
          const purchase=record('purchases',projectId,id);
          if(purchase.status!=='RECEIVED'||!purchase.expense_id||!purchase.movement_id)fail('Somente compras registradas podem ser estornadas.');
          const mat=material(projectId,purchase.material_id),reason=v.text(input.reason,'Motivo do estorno',1000);
          if(free(mat.id)<purchase.quantity)fail('Parte desta compra já foi usada, transferida ou reservada. Reponha o saldo livre ou corrija essas movimentações antes do estorno.');
          const expense=record('expenses',projectId,purchase.expense_id);
          if(expense.voided_at)fail('Compra já estornada.');
          const reversal=movement(user,mat,'CONSUMPTION',purchase.quantity,-purchase.quantity,workToday(),`Estorno de compra: ${reason}`,purchase.movement_id);
          run('UPDATE expenses SET voided_at=CURRENT_TIMESTAMP,void_reason=? WHERE id=?',reason,expense.id);
          run('UPDATE expense_payments SET voided_at=CURRENT_TIMESTAMP,void_reason=? WHERE expense_id=? AND voided_at IS NULL',`Estorno da compra: ${reason}`,expense.id);
          run("UPDATE purchases SET status='CANCELLED',notes=notes||? WHERE id=?",`\nEstorno de compra: ${reason}`,id);
          audit(user,'purchase.voided',id);return{id,reversal_id:reversal};
        }

        if(action==='cancel'&&id){
          const row=record('purchases',projectId,id);
          if(!['QUOTING','ORDERED'].includes(row.status))fail('Compra já registrada ou cancelada.');
          const reason=v.text(input.reason,'Motivo',1000);
          run("UPDATE purchases SET status='CANCELLED',notes=notes||? WHERE id=?",`\nCancelamento: ${reason}`,id);audit(user,'purchase.cancelled',id);return{ok:true};
        }
        if(action||id){
          if(action!=='complete'||!id)throw new v.HttpError(409,'Cotações foram desativadas. Use Registrar compra.');
          const previous=record('purchases',projectId,id);
          if(!['QUOTING','ORDERED'].includes(previous.status))fail('Este registro já foi finalizado.');
          if(input.material_id!==previous.material_id)throw new v.HttpError(400,'Mantenha o material do registro anterior.');
        }
        const amount=quantity(input.quantity),price=v.cents(input.unit_price,'Preço unitário',.01),freight=v.cents(input.freight??0,'Frete');
        const total=Math.round(price*amount)+freight;
        if(!Number.isSafeInteger(total)||total<1||total>1e11)throw new v.HttpError(400,'Valor total inválido.');
        const date=v.date(input.purchase_date,'Data da compra'),supplier=v.text(input.supplier,'Fornecedor'),notes=v.text(input.notes,'Observações',2000,true),invoice=v.text(input.invoice_number,'Número da nota',100,true);
        const status=v.choice(input.payment_status??'PAID',['PAID','PENDING'],'Pagamento'),due=v.date(input.due_date,'Vencimento',true),method=v.text(input.method,'Forma de pagamento',100,true);
        let mat;
        if(input.material_id){if(input.new_material)throw new v.HttpError(400,'Escolha um material existente ou cadastre um novo.');mat=material(projectId,input.material_id);}
        else {
          const item=input.new_material;
          if(!item||typeof item!=='object'||Array.isArray(item))throw new v.HttpError(400,'Informe o material comprado.');
          const name=v.text(item.name,'Material'),unit=v.text(item.unit,'Unidade',30);
          if(!isUnit(unit))throw new v.HttpError(400,'Escolha a unidade na lista.');
          const existingMaterials=all('SELECT * FROM materials WHERE project_id=?',projectId),sameName=m=>m.name.trim().toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR');
          mat=existingMaterials.find(m=>m.unit===unit&&sameName(m));
          if(!mat&&existingMaterials.some(m=>sameName(m)&&!isUnit(m.unit)))fail('Este material já existe com unidade a corrigir. Escolha a unidade correta em Materiais e use o cadastro existente.');
          if(!mat){const materialId=randomUUID();run('INSERT INTO materials(id,project_id,name,unit,quantity) VALUES(?,?,?,?,0)',materialId,projectId,name,unit);mat=get('SELECT * FROM materials WHERE id=?',materialId);audit(user,'materials.created',materialId);}
        }
        const movementId=movement(user,mat,'ENTRY',amount,amount,date,`Compra registrada · ${supplier}${invoice?' · Nota '+invoice:''}`),expenseId=randomUUID();
        run("INSERT INTO expenses(id,project_id,description,category,amount_cents,expense_date,status,supplier,due_date) VALUES(?,?,?,?,?,?,?,?,?)",expenseId,projectId,`Compra de ${mat.name}`,'Materiais',total,date,status,supplier,status==='PAID'?null:due);
        if(status==='PAID')run('INSERT INTO expense_payments(id,expense_id,amount_cents,payment_date,method,notes,author_id) VALUES(?,?,?,?,?,?,?)',randomUUID(),expenseId,total,date,method,'Pagamento informado no registro da compra',user.id);
        const purchaseId=id||key;
        if(id)run("UPDATE purchases SET quantity=?,status='RECEIVED',expense_id=?,movement_id=?,purchase_date=?,supplier=?,unit_price_cents=?,freight_cents=?,total_cents=?,invoice_number=?,notes=? WHERE id=?",amount,expenseId,movementId,date,supplier,price,freight,total,invoice,notes,id);
        else run("INSERT INTO purchases(id,project_id,material_id,quantity,status,expense_id,movement_id,purchase_date,supplier,unit_price_cents,freight_cents,total_cents,invoice_number,notes) VALUES(?,?,?,?,'RECEIVED',?,?,?,?,?,?,?,?,?)",purchaseId,projectId,mat.id,amount,expenseId,movementId,date,supplier,price,freight,total,invoice,notes);
        audit(user,'purchase.registered',purchaseId);return{id:purchaseId,material_id:mat.id,expense_id:expenseId,movement_id:movementId,total_cents:total};
      }
      if(kind==='selections') {
        if(!id){engineer(user);run('INSERT INTO selections(id,project_id,title,location,deadline) VALUES(?,?,?,?,?)',key,projectId,v.text(input.title,'Título'),v.text(input.location,'Ambiente',200,true),v.date(input.deadline,'Prazo',true));audit(user,'selection.created',key);return{id:key};}
        const row=visible(record('selections',projectId,id),user);
        if(action==='options'){
          engineer(user);if(row.status!=='DRAFT')fail('Opções bloqueadas após o envio.');
          run('INSERT INTO selection_options(id,selection_id,title,description,amount_cents,image_id) VALUES(?,?,?,?,?,?)',key,id,v.text(input.title,'Opção'),v.text(input.description,'Descrição',3000,true),v.cents(input.amount??0,'Adicional'),photo(projectId,input.image_id,user));audit(user,'selection.option.added',id);return{id:key};
        }
        if(action==='send'){
          engineer(user);if(row.status!=='DRAFT')fail('Escolha já enviada.');
          if(!project.client_id)fail('Vincule o cliente antes de enviar.');
          const options=all('SELECT * FROM selection_options WHERE selection_id=?',id);if(!options.length)fail('Cadastre ao menos uma opção.');
          if(options.some(o=>o.image_id&&!get('SELECT id FROM attachments WHERE id=? AND visible_to_client=1',o.image_id)))fail('Publique as fotos das opções antes de enviar.');
          run("UPDATE selections SET status='PENDING',client_id=? WHERE id=?",project.client_id,id);audit(user,'selection.sent',id);return{ok:true};
        }
        if(action==='choose'||action==='reject'){
          if(user.role!=='CLIENT')throw new v.HttpError(403,'A escolha pertence ao cliente.');current(row,project);
          if(row.status!=='PENDING')fail('Escolha já finalizada.');
          const option=action==='choose'?get('SELECT * FROM selection_options WHERE id=? AND selection_id=?',v.text(input.option_id,'Opção'),id):null;
          if(action==='choose'&&!option)throw new v.HttpError(400,'Opção inválida.');
          run('UPDATE selections SET status=?,selected_option_id=?,decided_by=?,decided_at=CURRENT_TIMESTAMP,decision_note=? WHERE id=?',option?'SELECTED':'REJECTED',option?.id??null,user.id,v.text(input.note,'Observação',2000,true),id);audit(user,'selection.decided',id);return{ok:true};
        }
        if(action==='cancel'){engineer(user);if(!['DRAFT','PENDING'].includes(row.status))fail('Escolha já finalizada.');run("UPDATE selections SET status='CANCELLED' WHERE id=?",id);audit(user,'selection.cancelled',id);return{ok:true};}
      }
      if(kind==='inspections') {
        if(!id){
          const ids=input.attachment_ids??[];if(!Array.isArray(ids)||ids.length>10||new Set(ids).size!==ids.length)throw new v.HttpError(400,'Selecione até dez fotos.');for(const a of ids)photo(projectId,a,user);
          run('INSERT INTO inspections(id,project_id,client_id,title,description,location,attachment_ids_json,created_by) VALUES(?,?,?,?,?,?,?,?)',key,projectId,project.client_id,v.text(input.title,'Título'),v.text(input.description,'Descrição',5000),v.text(input.location,'Ambiente',200,true),JSON.stringify(ids),user.id);
          run("INSERT INTO inspection_events(inspection_id,status,note,author_id) VALUES(?,'OPEN','Pendência registrada',?)",key,user.id);audit(user,'inspection.created',key);return{id:key};
        }
        const row=visible(record('inspections',projectId,id),user);let next;
        if(action==='update'){
          engineer(user);if(row.status==='CLOSED')fail('Pendência encerrada. Reabra antes de atualizar.');
          next=v.choice(input.status,['OPEN','IN_PROGRESS','RESOLVED'],'Situação');
          run('UPDATE inspections SET responsible=?,due_date=? WHERE id=?',v.text(input.responsible,'Responsável',200,true),v.date(input.due_date,'Prazo',true),id);
        } else if(action==='close'){
          if(row.status!=='RESOLVED')fail('O engenheiro precisa marcar a correção como realizada antes do encerramento.');if(user.role==='CLIENT')current(row,project);next='CLOSED';
        } else if(action==='reopen'){
          if(!['RESOLVED','CLOSED'].includes(row.status))fail('Esta pendência ainda está em atendimento.');if(user.role==='CLIENT')current(row,project);next='OPEN';
        } else throw new v.HttpError(404,'Ação não encontrada.');
        const note=v.text(input.note,'Observação',3000);run('UPDATE inspections SET status=? WHERE id=?',next,id);run('INSERT INTO inspection_events(inspection_id,status,note,author_id) VALUES(?,?,?,?)',id,next,note,user.id);audit(user,`inspection.${action}`,id);return{ok:true};
      }
      throw new v.HttpError(404,'Ação não encontrada.');
    });send(201,result);return true;
  }
  return {details,handle};
}
