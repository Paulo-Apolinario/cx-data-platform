import { randomUUID } from 'node:crypto';
import * as v from './validation.mjs';

export const workToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const error = message => { throw new v.HttpError(409, message); };
function list(value, label, max = 100) {
  if (!Array.isArray(value) || value.length > max || value.some(id => typeof id !== 'string') || new Set(value).size !== value.length) throw new v.HttpError(400, `${label}: lista inválida.`);
  return value;
}
function requestId(input) {
  if (input.request_id === undefined) return randomUUID();
  if (typeof input.request_id !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.request_id)) throw new v.HttpError(400, 'Identificador de solicitação inválido.');
  return input.request_id;
}
function quantity(value) {
  const n = v.number(value, 'Quantidade', .001);
  if (Math.abs(n * 1000 - Math.round(n * 1000)) > .00001) throw new v.HttpError(400, 'Use até três casas decimais na quantidade.');
  return n;
}
export function createOperations({ db, get, all, run, audit, transaction, engineer, projectFor }) {
  const paid = id => get('SELECT COALESCE(SUM(amount_cents),0) total FROM expense_payments WHERE expense_id=? AND voided_at IS NULL', id).total;
  const balance = id => get('SELECT ROUND(COALESCE(SUM(delta),0),3) total FROM material_movements WHERE material_id=?', id).total;
  function record(table, projectId, id) {
    const row = get(`SELECT * FROM ${table} WHERE id=? AND project_id=?`, id, projectId);
    if (!row) throw new v.HttpError(404, 'Registro não encontrado nesta obra.');
    return row;
  }
  function expenseView(row) {
    const paidCents = paid(row.id), outstanding = row.amount_cents - paidCents;
    return { ...row, paid_cents: paidCents, outstanding_cents: outstanding,
      payment_state: outstanding === 0 ? 'PAID' : paidCents > 0 ? 'PARTIAL' : 'PENDING',
      overdue: outstanding > 0 && !!row.due_date && row.due_date < workToday() };
  }
  function stageView(row) {
    return { ...row, overdue: row.status !== 'COMPLETED' && !!row.end_date && row.end_date < workToday(),
      planned_days: row.start_date && row.end_date ? Math.round((Date.parse(row.end_date)-Date.parse(row.start_date))/86400000)+1 : null };
  }
  function summary(projectId) {
    const stages = all('SELECT * FROM stages WHERE project_id=?', projectId);
    const weight = stages.reduce((sum,s) => sum + s.weight,0);
    return { progress: weight ? Math.round(stages.reduce((sum,s) => sum + s.weight*s.progress_percent,0)/weight) : 0,
      overdue_stages: stages.filter(s => stageView(s).overdue).length };
  }
  function finance(projectId) {
    const expenses = all('SELECT * FROM expenses WHERE project_id=?', projectId).map(expenseView);
    return { expense_cents: expenses.reduce((sum,e)=>sum+e.amount_cents,0), paid_cents:expenses.reduce((sum,e)=>sum+e.paid_cents,0),
      overdue_cents:expenses.filter(e=>e.overdue).reduce((sum,e)=>sum+e.outstanding_cents,0),
      approved_additional_cents:get("SELECT COALESCE(SUM(amount_cents),0) total FROM approvals WHERE project_id=? AND status='APPROVED'",projectId).total };
  }
  function diaryView(row, user) {
    const workforce = JSON.parse(row.workforce_json);
    const photoIds = JSON.parse(row.attachment_ids_json).filter(id => get(`SELECT id FROM attachments WHERE id=? AND project_id=? ${user.role==='CLIENT'?'AND visible_to_client=1':''}`, id, row.project_id));
    const result = { id:row.id, project_id:row.project_id, work_date:row.work_date, weather:row.weather, services:row.services,
      occurrences:row.occurrences, workforce_count:workforce.length, attachment_ids:photoIds, version:row.version,
      visible_to_client:row.visible_to_client, created_at:row.created_at, updated_at:row.updated_at };
    if (user.role==='ENGINEER') Object.assign(result,{internal_notes:row.internal_notes,workforce,author_name:get('SELECT name FROM users WHERE id=?',row.author_id)?.name});
    return result;
  }
  function details(projectId, user) {
    const result = {
      stages:all('SELECT * FROM stages WHERE project_id=? ORDER BY COALESCE(start_date,\'9999\'),created_at,id',projectId).map(stageView),
      diary:all(`SELECT * FROM diary_entries WHERE project_id=? AND archived=0 ${user.role==='CLIENT'?'AND visible_to_client=1':''} ORDER BY work_date DESC,created_at DESC`,projectId).map(row=>diaryView(row,user)),
      approvals:all(`SELECT a.*, u.name decision_author FROM approvals a LEFT JOIN users u ON u.id=a.decided_by WHERE a.project_id=? ${user.role==='CLIENT'?"AND a.client_id=? AND a.status IN ('PENDING','APPROVED','REJECTED')":''} ORDER BY a.created_at DESC,a.id`,...user.role==='CLIENT'?[projectId,user.id]:[projectId])
    };
    if(user.role==='ENGINEER') Object.assign(result,{
      materials:all('SELECT * FROM materials WHERE project_id=? ORDER BY name',projectId).map(row=>({...row,quantity:balance(row.id)})),
      movements:all('SELECT mm.*,m.name material_name,m.unit,u.name author_name FROM material_movements mm JOIN materials m ON m.id=mm.material_id LEFT JOIN users u ON u.id=mm.author_id WHERE m.project_id=? ORDER BY mm.created_at DESC,mm.id',projectId),
      expenses:all('SELECT * FROM expenses WHERE project_id=? ORDER BY COALESCE(due_date,expense_date),created_at',projectId).map(expenseView),
      payments:all('SELECT p.*,e.description expense_description FROM expense_payments p JOIN expenses e ON e.id=p.expense_id WHERE e.project_id=? ORDER BY p.created_at DESC,p.id',projectId)
    });
    return result;
  }
  function receiptFor(id, projectId) {
    if(id === undefined || id === null || id === '')return null;
    if(typeof id!=='string' || !get("SELECT id FROM attachments WHERE id=? AND project_id=? AND kind='DOCUMENT'",id,projectId)) throw new v.HttpError(400,'Comprovante inválido para esta obra.');
    return id;
  }
  function syncExpense(id) { const row=get('SELECT * FROM expenses WHERE id=?',id); run('UPDATE expenses SET status=? WHERE id=?',paid(id)===row.amount_cents?'PAID':'PENDING',id); }
  const finish = (send,status,data) => { send(status,data);return true; };
  async function handle({ path, req, user, body, send }) {
    let m=path.match(/^\/api\/projects\/([^/]+)\/expenses\/([^/]+)\/payments\/([^/]+)\/void$/);
    if(m && req.method==='POST') {
      engineer(user); projectFor(user,m[1]);const expense=record('expenses',m[1],m[2]);
      const payment=get('SELECT * FROM expense_payments WHERE id=? AND expense_id=?',m[3],expense.id);
      if(!payment)throw new v.HttpError(404,'Pagamento não encontrado.');
      const input=await body(req), reason=v.text(input.reason,'Motivo do estorno',1000);
      transaction(()=>{const updated=run('UPDATE expense_payments SET voided_at=CURRENT_TIMESTAMP,void_reason=? WHERE id=? AND voided_at IS NULL',reason,payment.id);if(!updated.changes)error('Pagamento já estornado.');syncExpense(expense.id);audit(user,'payment.voided',payment.id);});
      return finish(send,200,{ok:true});
    }
    m=path.match(/^\/api\/projects\/([^/]+)\/(diary|materials|expenses|stages|approvals)(?:\/([^/]+))?(?:\/(movements|payments|decision|send|cancel|revisions))?$/);
    if(!m)return false;
    const [,projectId,kind,id,action]=m;
    const project=projectFor(user,projectId), method=req.method;
    if(user.role!=='ENGINEER' && !(kind==='diary'&&method==='GET') && !(kind==='approvals'&&(method==='GET'||action==='decision'&&method==='POST')) && !(kind==='stages'&&method==='GET'))engineer(user);
    if(method==='GET'&&!id){const data=details(projectId,user);return finish(send,200,data[kind]||[]);}
    if(kind==='diary') {
      const row=id?record('diary_entries',projectId,id):null;
      if(row?.archived || row && user.role==='CLIENT'&&!row.visible_to_client)throw new v.HttpError(404,'Registro não encontrado.');
      if(method==='GET'&&row&&action==='revisions'){engineer(user);return finish(send,200,all('SELECT r.*,u.name author_name FROM diary_revisions r JOIN users u ON u.id=r.author_id WHERE r.diary_id=? ORDER BY r.version DESC',id).map(r=>({version:r.version,created_at:r.created_at,author_name:r.author_name,snapshot:JSON.parse(r.snapshot_json)})));}
      if(method==='GET'&&row)return finish(send,200,diaryView(row,user));
      engineer(user);
      if(method==='DELETE'&&row){transaction(()=>{run('UPDATE diary_entries SET archived=1 WHERE id=?',id);audit(user,'diary.archived',id);});return finish(send,200,{ok:true});}
      if((method==='POST'&&!id)||(method==='PATCH'&&row)) {
        const input=await body(req), workers=list(input.worker_ids??[],'Equipe'), photos=list(input.attachment_ids??[],'Fotos',30);
        const workforce=workers.map(workerId=>{const w=record('workers',projectId,workerId);return{id:w.id,name:w.name,job_title:w.job_title};});
        for(const photoId of photos)if(!get("SELECT id FROM attachments WHERE id=? AND project_id=? AND kind='PHOTO'",photoId,projectId))throw new v.HttpError(400,'Selecione fotos desta obra.');
        const values=[v.date(input.work_date,'Data'),v.text(input.weather,'Condição do tempo',100,true),v.text(input.services,'Serviços executados',10000),v.text(input.occurrences,'Ocorrências',5000,true),v.text(input.internal_notes,'Anotações internas',5000,true),JSON.stringify(workforce),JSON.stringify(photos),v.boolean(input.visible_to_client??false)];
        const newId=id||randomUUID();
        transaction(()=>{
          if(row){const current=get('SELECT * FROM diary_entries WHERE id=?',id);if(current.archived||input.version!==current.version)error('O diário foi alterado. Atualize a página antes de salvar.');run('INSERT INTO diary_revisions(diary_id,version,snapshot_json,author_id) VALUES(?,?,?,?)',id,current.version,JSON.stringify(current),user.id);run('UPDATE diary_entries SET work_date=?,weather=?,services=?,occurrences=?,internal_notes=?,workforce_json=?,attachment_ids_json=?,visible_to_client=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?',...values,id);}
          else run('INSERT INTO diary_entries(id,project_id,work_date,weather,services,occurrences,internal_notes,workforce_json,attachment_ids_json,visible_to_client,author_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',newId,projectId,...values,user.id);
          audit(user,row?'diary.updated':'diary.created',newId);
        });
        return finish(send,row?200:201,{id:newId});
      }
    }
    if(kind==='stages') {
      engineer(user);const row=id?record('stages',projectId,id):null;
      if(method==='DELETE'&&row){transaction(()=>{run('DELETE FROM stages WHERE id=?',id);audit(user,'stages.deleted',id);});return finish(send,200,{ok:true});}
      if((method==='POST'&&!id)||(method==='PATCH'&&row)){
        const input=await body(req), status=v.choice(input.status??'PLANNED',['PLANNED','IN_PROGRESS','COMPLETED'],'Situação');
        const start=v.date(input.start_date,'Início previsto',true),end=v.date(input.end_date,'Fim previsto',true),actualStart=v.date(input.actual_start,'Início real',true),actualEnd=v.date(input.actual_end,'Fim real',true);
        v.dates(start,end);v.dates(actualStart,actualEnd);
        const progress=v.number(input.progress_percent??(status==='COMPLETED'?100:0),'Medição',0,100);
        if(status==='COMPLETED'&&progress!==100||status==='PLANNED'&&progress!==0||status==='IN_PROGRESS'&&progress===100)throw new v.HttpError(400,'Situação e medição devem ser compatíveis (planejada 0%, concluída 100%).');
        if(actualEnd&&(!actualStart||status!=='COMPLETED'))throw new v.HttpError(400,'Informe o início real e conclua a etapa antes de registrar o fim real.');
        const values=[v.text(input.title,'Etapa'),start,end,status,v.number(input.weight??1,'Peso',.001,1000),progress,v.text(input.responsible,'Responsável',200,true),actualStart,actualEnd],newId=id||randomUUID();
        transaction(()=>{if(row)run('UPDATE stages SET title=?,start_date=?,end_date=?,status=?,weight=?,progress_percent=?,responsible=?,actual_start=?,actual_end=? WHERE id=?',...values,id);else run('INSERT INTO stages(id,project_id,title,start_date,end_date,status,weight,progress_percent,responsible,actual_start,actual_end) VALUES(?,?,?,?,?,?,?,?,?,?,?)',newId,projectId,...values);audit(user,row?'stages.updated':'stages.created',newId);});
        return finish(send,row?200:201,{id:newId});
      }
    }
    if(kind==='materials') {
      engineer(user);const row=id?record('materials',projectId,id):null;
      if(action==='movements'&&row&&method==='POST'){
        const input=await body(req),type=v.choice(input.type,['ENTRY','CONSUMPTION','LOSS','TRANSFER_OUT'],'Movimento'),amount=quantity(input.quantity),date=v.date(input.movement_date,'Data'),supplier=v.text(input.supplier,'Fornecedor',200,true),notes=v.text(input.notes,'Observações',2000,true),newId=requestId(input);
        const target=type==='TRANSFER_OUT'?get('SELECT * FROM materials WHERE id=?',v.text(input.target_material_id,'Material de destino')):null;
        if(type==='TRANSFER_OUT'&&(!target||target.project_id===projectId||target.unit.toLowerCase()!==row.unit.toLowerCase()))throw new v.HttpError(400,'Selecione material de outra obra com a mesma unidade.');
        transaction(()=>{
          const existing=get('SELECT * FROM material_movements WHERE id=?',newId);
          if(existing){const peer=existing.transfer_id?get("SELECT material_id FROM material_movements WHERE transfer_id=? AND type='TRANSFER_IN'",existing.transfer_id):null;if(existing.material_id!==id||existing.type!==type||existing.quantity!==amount||existing.movement_date!==date||existing.supplier!==supplier||existing.notes!==notes||peer?.material_id!==target?.id)error('Identificador já utilizado em outro movimento.');return;}
          if(type!=='ENTRY'&&balance(id)<amount)error('Saldo insuficiente para este movimento.');
          const delta=type==='ENTRY'?amount:-amount,transferId=target?randomUUID():null;
          run('INSERT INTO material_movements(id,material_id,type,quantity,delta,movement_date,supplier,notes,transfer_id,author_id) VALUES(?,?,?,?,?,?,?,?,?,?)',newId,id,type,amount,delta,date,supplier,notes,transferId,user.id);
          run('UPDATE materials SET quantity=? WHERE id=?',balance(id),id);
          if(target){projectFor(user,target.project_id);run("INSERT INTO material_movements(id,material_id,type,quantity,delta,movement_date,notes,transfer_id,author_id) VALUES(?,?,'TRANSFER_IN',?,?,?,?,?,?)",randomUUID(),target.id,amount,amount,date,notes,transferId,user.id);run('UPDATE materials SET quantity=? WHERE id=?',balance(target.id),target.id);audit(user,'material.transfer.received',target.id);}
          audit(user,'material.moved',newId);
        });
        return finish(send,201,{id:newId,quantity:balance(id)});
      }
      if(method==='DELETE'&&row){if(get('SELECT id FROM material_movements WHERE material_id=?',id))error('Material com histórico não pode ser excluído.');transaction(()=>{run('DELETE FROM materials WHERE id=?',id);audit(user,'materials.deleted',id);});return finish(send,200,{ok:true});}
      if((method==='POST'&&!id)||(method==='PATCH'&&row)){
        const input=await body(req),name=v.text(input.name,'Material'),unit=v.text(input.unit,'Unidade',30),notes=v.text(input.notes,'Observações',2000,true),amount=v.number(input.quantity??row?.quantity??0,'Quantidade');
        if(amount&&quantity(amount)!==amount)throw new v.HttpError(400,'Quantidade inválida.');
        if(row&&(amount!==balance(id)||unit!==row.unit))error('Saldo e unidade são preservados. Registre entradas, consumo, perdas ou transferência.');
        const newId=id||randomUUID();
        transaction(()=>{if(row)run('UPDATE materials SET name=?,notes=? WHERE id=?',name,notes,id);else{run('INSERT INTO materials(id,project_id,name,unit,quantity,notes) VALUES(?,?,?,?,?,?)',newId,projectId,name,unit,amount,notes);if(amount)run("INSERT INTO material_movements(id,material_id,type,quantity,delta,movement_date,notes,author_id) VALUES(?,?,'OPENING',?,?,?,?,?)",randomUUID(),newId,amount,amount,workToday(),'Saldo inicial',user.id);}audit(user,row?'materials.updated':'materials.created',newId);});
        return finish(send,row?200:201,{id:newId});
      }
    }
    if(kind==='expenses') {
      engineer(user);const row=id?record('expenses',projectId,id):null;
      if(action==='payments'&&row&&method==='POST'){
        const input=await body(req),amount=v.cents(input.amount,'Valor pago',.01),date=v.date(input.payment_date,'Data do pagamento'),receipt=receiptFor(input.receipt_id,projectId),method=v.text(input.method,'Forma de pagamento',100,true),notes=v.text(input.notes,'Observações',2000,true),newId=requestId(input);
        transaction(()=>{const existing=get('SELECT * FROM expense_payments WHERE id=?',newId);if(existing){if(existing.expense_id!==id||existing.amount_cents!==amount||existing.payment_date!==date||existing.receipt_id!==receipt||existing.method!==method||existing.notes!==notes||existing.voided_at)error('Identificador já utilizado em outro pagamento.');return;}if(paid(id)+amount>get('SELECT amount_cents FROM expenses WHERE id=?',id).amount_cents)error('O pagamento ultrapassa o saldo da despesa.');run('INSERT INTO expense_payments(id,expense_id,amount_cents,payment_date,method,notes,receipt_id,author_id) VALUES(?,?,?,?,?,?,?,?)',newId,id,amount,date,method,notes,receipt,user.id);syncExpense(id);audit(user,'payment.created',newId);});
        return finish(send,201,{id:newId});
      }
      if(method==='DELETE'&&row){if(get('SELECT id FROM expense_payments WHERE expense_id=?',id))error('Despesa com histórico de pagamentos não pode ser excluída.');transaction(()=>{run('DELETE FROM expenses WHERE id=?',id);audit(user,'expenses.deleted',id);});return finish(send,200,{ok:true});}
      if((method==='POST'&&!id)||(method==='PATCH'&&row)){
        const input=await body(req),amount=v.cents(input.amount,'Valor',.01),date=v.date(input.expense_date,'Data da despesa'),due=v.date(input.due_date,'Vencimento',true),supplier=v.text(input.supplier,'Fornecedor',200,true),description=v.text(input.description,'Descrição'),category=v.text(input.category,'Categoria',100);
        const status=v.choice(input.status??row?.status??'PENDING',['PENDING','PAID'],'Situação');
        if(row&&(amount<paid(id)||status!==row.status))error('Use os pagamentos para mudar a quitação. O valor não pode ser menor que o total pago.');
        const newId=id||randomUUID();
        transaction(()=>{if(row){run('UPDATE expenses SET description=?,category=?,amount_cents=?,expense_date=?,supplier=?,due_date=? WHERE id=?',description,category,amount,date,supplier,due,id);syncExpense(id);}else{run('INSERT INTO expenses(id,project_id,description,category,amount_cents,expense_date,status,supplier,due_date) VALUES(?,?,?,?,?,?,?,?,?)',newId,projectId,description,category,amount,date,status,supplier,due);if(status==='PAID')run('INSERT INTO expense_payments(id,expense_id,amount_cents,payment_date,notes,author_id) VALUES(?,?,?,?,?,?)',randomUUID(),newId,amount,date,'Quitação no cadastro',user.id);}audit(user,row?'expenses.updated':'expenses.created',newId);});
        return finish(send,row?200:201,{id:newId});
      }
    }
    if(kind==='approvals') {
      const row=id?record('approvals',projectId,id):null;
      if(user.role==='CLIENT'&&row&&(row.client_id!==user.id||!['PENDING','APPROVED','REJECTED'].includes(row.status)))throw new v.HttpError(404,'Solicitação não encontrada.');
      if(method==='GET'&&row)return finish(send,200,row);
      if(action==='decision'&&method==='POST'&&row){
        if(user.role!=='CLIENT'||project.client_id!==user.id||row.client_id!==user.id)throw new v.HttpError(403,'Apenas o cliente destinatário pode decidir.');
        const input=await body(req),status=v.choice(input.status,['APPROVED','REJECTED'],'Decisão'),note=v.text(input.note,'Observações',3000,true);
        transaction(()=>{projectFor(user,projectId);if(row.status!=='PENDING')error('Esta solicitação já foi decidida ou encerrada.');const changed=run("UPDATE approvals SET status=?,decision_note=?,decided_by=?,decided_at=CURRENT_TIMESTAMP WHERE id=? AND status='PENDING'",status,note,user.id,id);if(!changed.changes)error('A solicitação foi alterada. Atualize a página.');audit(user,`approval.${status.toLowerCase()}`,id);});
        return finish(send,200,{ok:true});
      }
      engineer(user);
      if(action==='send'&&row&&method==='POST'){
        if(row.status!=='DRAFT')error('Somente rascunhos podem ser enviados.');
        if(!project.client_id)throw new v.HttpError(400,'Vincule um cliente à obra antes de enviar.');
        transaction(()=>{run("UPDATE approvals SET status='PENDING',client_id=?,sent_at=CURRENT_TIMESTAMP WHERE id=?",project.client_id,id);audit(user,'approval.sent',id);});return finish(send,200,{ok:true});
      }
      if(action==='cancel'&&row&&method==='POST'){if(!['DRAFT','PENDING'].includes(row.status))error('Uma decisão registrada não pode ser cancelada.');transaction(()=>{run("UPDATE approvals SET status='CANCELLED' WHERE id=?",id);audit(user,'approval.cancelled',id);});return finish(send,200,{ok:true});}
      if((method==='POST'&&!id)||(method==='PATCH'&&row)){
        if(row&&row.status!=='DRAFT')error('Solicitação enviada não pode ser editada. Crie uma nova proposta.');
        const input=await body(req),values=[v.text(input.title,'Título'),v.text(input.description,'Descrição',10000),v.cents(input.amount??0,'Valor adicional'),v.date(input.deadline,'Prazo de resposta',true)],newId=id||randomUUID();
        transaction(()=>{if(row){if(get('SELECT status FROM approvals WHERE id=?',id).status!=='DRAFT')error('Solicitação já enviada. Atualize a página.');run('UPDATE approvals SET title=?,description=?,amount_cents=?,deadline=? WHERE id=?',...values,id);}else run('INSERT INTO approvals(id,project_id,title,description,amount_cents,deadline,created_by) VALUES(?,?,?,?,?,?,?)',newId,projectId,...values,user.id);audit(user,row?'approval.updated':'approval.created',newId);});return finish(send,row?200:201,{id:newId});
      }
    }
    throw new v.HttpError(404,'Operação não encontrada.');
  }
  return { handle, details, summary, finance };
}
