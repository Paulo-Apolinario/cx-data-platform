import {randomUUID,createHash} from 'node:crypto';
import * as v from './validation.mjs';
import {isUnit} from '../public/units.js';
export function createScope({get,all,run,transaction,audit,engineer,projectFor}) {
 const fail=message=>{throw new v.HttpError(409,message);};
 const executed=id=>get('SELECT ROUND(COALESCE(SUM(quantity),0),3) n FROM service_execution WHERE service_id=? AND voided_at IS NULL',id).n;
 const services=p=>all('SELECT * FROM contracted_services WHERE project_id=? AND archived=0 ORDER BY rowid',p);
 function summary(p){const project=get('SELECT scope_version FROM projects WHERE id=?',p),rows=services(p);if(!project.scope_version)return {progress:0,scope_version:0,progress_configured:false};const raw=rows.reduce((n,s)=>n+s.share*Math.min(1,executed(s.id)/s.quantity),0),complete=rows.length&&rows.every(s=>executed(s.id)>=s.quantity);return {progress:complete?100:Math.min(99,Math.round(raw)),scope_version:project.scope_version,progress_configured:true};}
 function details(p,user){const configured=get('SELECT scope_version FROM projects WHERE id=?',p).scope_version;
  if(user.role==='CLIENT'&&!configured)return {services:[],service_records:[],scope_revisions:[]};
  return {services:services(p).map(s=>({...s,executed_quantity:executed(s.id),remaining_quantity:Math.max(0,Math.round((s.quantity-executed(s.id))*1000)/1000),progress_percent:executed(s.id)>=s.quantity?100:Math.min(99.99,Math.round(executed(s.id)/s.quantity*10000)/100)})),
   service_records:all('SELECT e.*,s.title service_title,s.unit FROM service_execution e JOIN contracted_services s ON s.id=e.service_id WHERE s.project_id=? ORDER BY e.work_date DESC,e.rowid DESC',p).map(e=>{const result={...e,attachment_ids:JSON.parse(e.attachment_ids_json).filter(id=>get(`SELECT id FROM attachments WHERE id=? AND project_id=? ${user.role==='CLIENT'?'AND visible_to_client=1':''}`,id,p))};delete result.attachment_ids_json;if(user.role==='CLIENT')delete result.author_id;return result;}),
   scope_revisions:all('SELECT version,reason,progress_before,progress_after,created_at,snapshot_json FROM scope_revisions WHERE project_id=? ORDER BY version DESC',p).map(r=>({...r,services:JSON.parse(r.snapshot_json),snapshot_json:undefined}))};
 }
 function amount(n,label){v.number(n,label,.001,1e9);if(Math.abs(n*1000-Math.round(n*1000))>.00001)throw new v.HttpError(400,`${label}: use até três casas decimais.`);return n;}
 function inputService(input,p){if(!input||typeof input!=='object'||Array.isArray(input)||input.id!==undefined&&(typeof input.id!=='string'||!/^[a-f0-9-]{36}$/i.test(input.id)))throw new v.HttpError(400,'Serviço inválido.');const mode=v.choice(input.mode,['QUANTITY','PERCENT'],'Forma de acompanhamento'),share=v.number(input.share,'Participação (%)',.01,100);if(Math.abs(share*100-Math.round(share*100))>.00001)throw new v.HttpError(400,'Participação: use até duas casas decimais.');const unit=mode==='PERCENT'?'%':v.text(input.unit,'Unidade',30);if(mode==='QUANTITY'&&!isUnit(unit))throw new v.HttpError(400,'Escolha uma unidade na lista.');return {id:input.id||randomUUID(),project_id:p,title:v.text(input.title,'Serviço'),mode,unit,quantity:mode==='PERCENT'?100:amount(input.quantity,'Quantidade contratada'),share};}
 async function handle({path,req,user,body,send}){
  const m=path.match(/^\/api\/projects\/([^/]+)\/(services|scope|execution)(?:\/([^/]+))?(?:\/(records|void))?$/);if(!m)return false;
  const [,p,kind,id,action]=m;projectFor(user,p);
  if(req.method==='GET'&&!id){send(200,kind==='scope'?summary(p):details(p,user)[kind==='services'?'services':'service_records']);return true;}
  engineer(user);const input=await body(req),key=input.request_id||randomUUID();if(typeof key!=='string'||!/^[a-f0-9-]{36}$/i.test(key))throw new v.HttpError(400,'Identificador inválido.');
  const hash=createHash('sha256').update(JSON.stringify([user.id,path,req.method,input])).digest('hex');
  const result=transaction(()=>{const project=projectFor(user,p),prior=get('SELECT * FROM operation_requests WHERE id=?',key);if(prior){if(prior.fingerprint!==hash)fail('Solicitação já usada com outros dados.');return JSON.parse(prior.result_json);}let result;
   if(kind==='scope'&&req.method==='POST'&&(!id||id==='revise')&&!action){
    if(input.version!==project.scope_version)fail('O escopo mudou. Atualize a obra.');
    const reason=v.text(input.reason,'Descrição da contratação ou alteração',2000);
    let rows;
    if(!project.scope_version){if(id)fail('Confirme primeiro o escopo inicial.');rows=services(p);}else{
     if(id!=='revise'||!Array.isArray(input.services)||input.services.length>100)throw new v.HttpError(400,'Informe os serviços da revisão.');
     const old=services(p);rows=input.services.map(row=>inputService(row,p));if(new Set(rows.map(s=>s.id)).size!==rows.length)throw new v.HttpError(400,'Serviços repetidos.');
     for(const s of rows){const existing=get('SELECT * FROM contracted_services WHERE id=?',s.id);if(existing&&(existing.project_id!==p||existing.archived))throw new v.HttpError(400,'Serviço inválido nesta obra.');if(existing){if(s.quantity<executed(s.id))fail('A quantidade contratada não pode ser menor que a executada.');if(get('SELECT id FROM service_execution WHERE service_id=?',s.id)&&(s.mode!==existing.mode||s.unit!==existing.unit))fail('Preserve a unidade e a forma de acompanhamento de serviços com histórico.');}}
     for(const s of old)if(!rows.some(row=>row.id===s.id)&&(executed(s.id)>0||get('SELECT id FROM stages WHERE service_id=?',s.id)))fail('Não remova serviço com execução ou etapas vinculadas.');
    }
    if(!rows.length||rows.length>100||Math.abs(rows.reduce((n,s)=>n+s.share,0)-100)>.000001)throw new v.HttpError(400,'A participação dos serviços deve somar exatamente 100%.');
    const before=project.scope_version?summary(p).progress:null;
    if(project.scope_version){run('UPDATE contracted_services SET archived=1 WHERE project_id=?',p);for(const s of rows){if(get('SELECT id FROM contracted_services WHERE id=?',s.id))run('UPDATE contracted_services SET title=?,mode=?,unit=?,quantity=?,share=?,archived=0 WHERE id=?',s.title,s.mode,s.unit,s.quantity,s.share,s.id);else run('INSERT INTO contracted_services(id,project_id,title,mode,unit,quantity,share) VALUES(?,?,?,?,?,?,?)',s.id,p,s.title,s.mode,s.unit,s.quantity,s.share);}}
    run('UPDATE projects SET scope_version=scope_version+1 WHERE id=?',p);const after=summary(p).progress;
    run('INSERT INTO scope_revisions(project_id,version,reason,snapshot_json,progress_before,progress_after,author_id) VALUES(?,?,?,?,?,?,?)',p,project.scope_version+1,reason,JSON.stringify(rows),before,after,user.id);audit(user,'scope.confirmed',p);result={version:project.scope_version+1,progress:after};
   }else if(kind==='services'&&action==='records'&&id&&req.method==='POST'){
    if(!project.scope_version)fail('Confirme os serviços contratados antes de registrar execução.');const service=get('SELECT * FROM contracted_services WHERE id=? AND project_id=? AND archived=0',id,p);if(!service)throw new v.HttpError(404,'Serviço não encontrado.');const n=amount(input.quantity,service.mode==='PERCENT'?'Avanço adicional':'Quantidade realizada');if(Math.round((executed(id)+n)*1000)>Math.round(service.quantity*1000))fail('A execução ultrapassa a quantidade contratada. Revise o escopo se houve serviço adicional.');
    const photos=input.attachment_ids||[];if(!Array.isArray(photos)||photos.length>20||new Set(photos).size!==photos.length)throw new v.HttpError(400,'Fotos inválidas.');for(const photo of photos)if(!get("SELECT id FROM attachments WHERE id=? AND project_id=? AND kind='PHOTO'",photo,p))throw new v.HttpError(400,'Escolha fotos desta obra.');
    run('INSERT INTO service_execution(id,service_id,quantity,work_date,note,attachment_ids_json,author_id) VALUES(?,?,?,?,?,?,?)',key,id,n,v.date(input.work_date,'Data da execução'),v.text(input.note,'Descrição compartilhada',3000),JSON.stringify(photos),user.id);audit(user,'service.execution',key);result={id:key,progress:summary(p).progress};
   }else if(kind==='execution'&&id&&action==='void'&&req.method==='POST'){
    const record=get('SELECT e.* FROM service_execution e JOIN contracted_services s ON s.id=e.service_id WHERE e.id=? AND s.project_id=?',id,p);if(!record)throw new v.HttpError(404,'Registro não encontrado.');if(record.voided_at)fail('Registro já corrigido.');run('UPDATE service_execution SET voided_at=CURRENT_TIMESTAMP,void_reason=? WHERE id=?',v.text(input.reason,'Motivo da correção',2000),id);audit(user,'service.execution.void',id);result={ok:true};
   }else if(kind==='services'&&!action&&['POST','PATCH','DELETE'].includes(req.method)){
    if(project.scope_version)fail('Escopo confirmado. Use Revisar escopo para alterar o contratado.');const old=id?get('SELECT * FROM contracted_services WHERE id=? AND project_id=? AND archived=0',id,p):null;if(id&&!old)throw new v.HttpError(404,'Serviço não encontrado.');
    if(req.method==='DELETE'&&old){if(get('SELECT id FROM stages WHERE service_id=?',id))fail('Serviço tem etapas vinculadas.');run('DELETE FROM contracted_services WHERE id=?',id);result={ok:true};}
    else {if(req.method==='PATCH'&&!id||req.method==='POST'&&id)throw new v.HttpError(405,'Método inválido.');const s=inputService({...input,id:id||key},p);if(old)run('UPDATE contracted_services SET title=?,mode=?,unit=?,quantity=?,share=? WHERE id=?',s.title,s.mode,s.unit,s.quantity,s.share,id);else{if(services(p).length>=100)fail('Limite de cem serviços por obra.');run('INSERT INTO contracted_services(id,project_id,title,mode,unit,quantity,share) VALUES(?,?,?,?,?,?,?)',s.id,p,s.title,s.mode,s.unit,s.quantity,s.share);}result={id:s.id};}audit(user,'service.draft.updated',id||key);
   }else throw new v.HttpError(404,'Operação não encontrada.');
   run('INSERT INTO operation_requests(id,fingerprint,result_json) VALUES(?,?,?)',key,hash,JSON.stringify(result));return result;
  });send(200,result);return true;
 }
 return {summary,details,handle};
}
