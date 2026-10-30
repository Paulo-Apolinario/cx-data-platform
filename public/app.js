import { icon, buildingScene } from './visuals.js';
import { units, isUnit } from './units.js';
import { createOperationsUI } from './operations-ui.js';

const $ = selector => document.querySelector(selector);
const state = { user: null, projects: [], clients: [], page: 'overview', projectId: null, detail: null, tab: 'stages', search: '', attachmentSearch: '', attachmentStage: '', attachmentVisibility: 'all' };
const labels = { ACTIVE: 'Em andamento', PAUSED: 'Pausada', COMPLETED: 'Concluída', PLANNED: 'Planejada', IN_PROGRESS: 'Em execução', PAID: 'Pago', PENDING: 'Pendente' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = cents => ((cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const day = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR') : 'Não informada';
const today = () => new Date().toLocaleDateString('sv-SE');
const isEngineer = () => state.user?.role === 'ENGINEER';
const badge = status => `<span class="badge ${esc(status.toLowerCase())}">${esc(labels[status] || status)}</span>`;
const empty = (title, description) => `<div class="empty"><span class="empty-icon">${icon('plus')}</span><h3>${title}</h3><p>${description}</p></div>`;
const button = (action, title, extra = '', cls = 'primary') => `<button class="${cls}" data-action="${action}" ${extra}>${title.replace(/^＋\s*/, icon('plus'))}</button>`;

const operationsUI = createOperationsUI({ state, api, esc, money, day, today, isEngineer, button, field, modal, refresh, notice, badge, render });

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || 'Não foi possível concluir.'); error.status = response.status; throw error; }
  return result;
}
let noticeTimer;
function notice(message, error = false) {
  $('#notice').textContent = message; $('#notice').className = error ? 'error' : ''; $('#notice').hidden = false;
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, 6500);
}
function handleError(error) {
  if (error.status === 401) { projectRequest++;state.user=null;state.detail=null;state.projects=[];state.clients=[];$('#modal').close();$('#modal').replaceChildren();$('#print-report')?.remove();render(); }
  notice(error.message, true);
}
async function refresh() {
  const userId=state.user?.id,projectId=state.projectId;
  const [projects, clients] = await Promise.all([api('/projects'), isEngineer() ? api('/clients') : Promise.resolve([])]);
  let detail = null;
  if (state.projectId) detail = await api(`/projects/${state.projectId}`);
  if (detail && state.attachmentStage && !detail.stages.some(s => s.id === state.attachmentStage)) state.attachmentStage = '';
  if(state.user?.id!==userId||state.projectId!==projectId)return;
  Object.assign(state, { projects, clients, detail }); render();
}
function render() {
  document.title = `${state.detail?.project.name || 'Gestão de Obras'} · Gestão de Obras`;
  if (!state.user) {
    $('#app').innerHTML = `<main class="login"><section class="login-story"><div class="brand"><span class="brand-icon">${icon('building')}</span> Gestão de Obras</div><div><span class="eyebrow">DO PLANEJAMENTO À ENTREGA</span><h1>Cada obra.<br>Cada detalhe.<br>Tudo conectado.</h1><p>Organize a execução e compartilhe o progresso com quem está construindo junto.</p>${buildingScene({ compact: true })}<div class="story-line"><span>01 &nbsp; Planejar</span><span>02 &nbsp; Executar</span><span>03 &nbsp; Acompanhar</span></div></div><small>Seu espaço de trabalho e acompanhamento de obras.</small></section><section class="login-panel"><form id="login-form"><span class="eyebrow">BEM-VINDO</span><h2>Acesse sua conta</h2><p>Entre como engenheiro ou cliente.</p><label>E-mail<input name="email" type="email" autocomplete="username" required maxlength="254"></label><label>Senha<input name="password" type="password" autocomplete="current-password" required maxlength="128"></label><p class="form-error" role="alert"></p><button class="primary wide" type="submit">Entrar no espaço de trabalho</button><small>Seu acesso é pessoal. Cada cliente acompanha somente suas obras.</small></form></section></main>`;
    return;
  }
  const nav = [['overview','overview','Visão geral'],['projects','projects','Minhas obras'], ...(isEngineer() ? [['clients','users','Clientes']] : [])];
  $('#app').innerHTML = `<div class="shell"><aside class="sidebar"><a class="brand" href="#"><span class="brand-icon">${icon('building')}</span><span>Gestão<br><b>de Obras</b></span></a><div class="workspace">${isEngineer() ? 'ESPAÇO DO ENGENHEIRO' : 'PORTAL DO CLIENTE'}</div><nav aria-label="Principal">${nav.map(([page,symbol,label]) => `<button data-action="navigate" data-page="${page}" class="nav-link ${state.page === page ? 'selected' : ''}">${icon(symbol)}${label}</button>`).join('')}</nav><div class="sidebar-note"><span class="eyebrow">CADA DETALHE CONTA</span><p>${isEngineer() ? 'Uma visão organizada para conduzir suas obras.' : 'Mais perto de cada etapa da sua obra.'}</p></div><div class="account"><span class="avatar">${esc(state.user.name.slice(0,1).toUpperCase())}</span><div><strong>${esc(state.user.name)}</strong><small>${isEngineer() ? 'Engenheiro' : 'Cliente'}</small></div></div><div class="account-actions">${button('password','Trocar senha','','text-button')}${button('logout','Sair','','text-button')}</div></aside><main class="main"><header class="topbar"><span>Gestão de Obras <span class="muted">/ ${state.detail ? esc(state.detail.project.name) : state.page === 'clients' ? 'Clientes' : state.page === 'projects' ? 'Minhas obras' : 'Visão geral'}</span></span><span class="today">${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</span></header><div class="content">${state.detail ? projectDetail() : state.page === 'clients' ? clientsPage() : projectsPage()}</div><footer>Gestão de Obras <span>Planejamento, execução e transparência.</span></footer></main></div>`;
  const tabs=$('.tabs'),active=tabs?.querySelector('[aria-selected=true]');
  if(active)tabs.scrollLeft=Math.max(0,active.offsetLeft-tabs.clientWidth/2+active.offsetWidth/2);
}
function projectsPage() {
  const total = state.projects.length;
  const active = state.projects.filter(p => p.status === 'ACTIVE').length;
  const expenses = state.projects.reduce((sum, p) => sum + (p.expense_cents || 0), 0);
  const completed = state.projects.filter(p => p.status === 'COMPLETED').length;
  return `
    <div class="page-heading">
      <div><span class="eyebrow">${isEngineer() ? 'SEU ESCRITÓRIO DIGITAL' : 'PORTAL DO CLIENTE'}</span>
        <h1>${state.page === 'projects' ? 'Minhas obras' : 'Cada obra, sob sua visão.'}</h1>
        <p>${isEngineer() ? 'Planejamento, pessoas e execução. Uma gestão conectada em cada etapa.' : 'Acompanhe as etapas e os registros compartilhados pelo engenheiro.'}</p>
      </div>${isEngineer() ? button('new-project', `${icon('plus')} Nova obra`) : ''}
    </div>
    ${state.page === 'overview' ? `<section class="perspective-hero" aria-labelledby="perspective-title">
      <div class="perspective-copy"><span class="hero-kicker"><span></span> DA PRIMEIRA ETAPA À ENTREGA</span>
        <h2 id="perspective-title">O próximo capítulo<br>da sua construção.</h2>
        <p>${isEngineer() ? 'Transforme os registros do dia a dia em uma visão clara do andamento de cada empreendimento.' : 'Veja sua obra ganhar forma, com informações e registros em um só lugar.'}</p>
        <div class="hero-facts"><span>${icon('projects')} <strong>${active}</strong> em andamento</span><span>${icon('check')} <strong>${completed}</strong> concluída(s)</span></div>
      </div>${buildingScene({ controls: true })}
    </section>` : ''}
    <div class="stats">
      <article><div class="stat-label">Obras cadastradas${icon('projects')}</div><strong>${String(total).padStart(2, '0')}</strong><small>Seu portfólio de empreendimentos</small></article>
      <article><div class="stat-label">Em andamento${icon('calendar')}</div><strong>${String(active).padStart(2, '0')}</strong><small>Execução e acompanhamento</small></article>
      <article><div class="stat-label">${isEngineer() ? 'Despesas registradas' : 'Obras concluídas'}${icon(isEngineer() ? 'wallet' : 'check')}</div><strong>${isEngineer() ? money(expenses) : String(completed).padStart(2, '0')}</strong><small>${isEngineer() ? 'Valores pagos e pendentes' : 'Empreendimentos entregues'}</small></article>
    </div>
    ${state.page==='overview'?attentionPanel():''}
    <section class="section"><div class="section-heading"><div><span class="eyebrow">PORTFÓLIO</span><h2>Seus empreendimentos</h2><p>Entre em uma obra para acompanhar cada detalhe.</p></div>
      <label class="search-label">${icon('search')}<span class="sr-only">Buscar obra, endereço ou cliente</span><input id="project-search" type="search" placeholder="Buscar obra${isEngineer() ? ' ou cliente' : ''}…" value="${esc(state.search)}"></label></div>
      <div id="project-grid" class="project-grid">${projectCards()}</div>
    </section>`;
}

function attentionPanel(){
  const items=[];
  for(const p of state.projects){
    const add=(count,label,tab)=>{if(count)items.push({id:p.id,name:p.name,label,tab});};
    if(isEngineer()){
      add(p.overdue_stages,`${p.overdue_stages} etapa(s) com prazo vencido`,'schedule');
      add(p.overdue_cents,`${money(p.overdue_cents)} em contas vencidas`,'expenses');
      add(p.low_stock_count,`${p.low_stock_count} material(is) com estoque baixo`,'materials');
      add(p.questions_waiting,`${p.questions_waiting} pergunta(s) sem resposta`,'questions');
      add(p.inspections_overdue,`${p.inspections_overdue} pendência(s) de vistoria atrasada(s)`,'inspections');
    } else {
      add(p.decisions_pending,`${p.decisions_pending} solicitação(ões) para decidir`,'approvals');
      add(p.selections_pending,`${p.selections_pending} escolha(s) de acabamento pendente(s)`,'selections');
    }
  }
  return `<section class="attention-panel" aria-labelledby="attention-title"><div class="section-heading"><div><span class="eyebrow">PRÓXIMAS AÇÕES</span><h2 id="attention-title">${isEngineer()?'O que precisa de atenção':'Suas decisões pendentes'}</h2><p>Com base nos registros atuais das suas obras.</p></div>${button('refresh-dashboard','Atualizar','','secondary')}</div>${items.length?`<div class="attention-list">${items.map(i=>`<button class="attention-item" data-action="attention-open" data-id="${i.id}" data-tab="${i.tab}"><strong>${esc(i.name)}</strong><span>${esc(i.label)} →</span></button>`).join('')}</div>`:'<p class="module-note">Nenhuma pendência identificada nestes indicadores.</p>'}</section>`;
}
function projectCards() {
  const search = state.search.toLocaleLowerCase('pt-BR');
  const projects = state.projects.filter(p => `${p.name} ${p.address} ${p.client_name || ''}`.toLocaleLowerCase('pt-BR').includes(search));
  if (!projects.length) return empty(state.projects.length ? 'Nenhuma obra encontrada' : 'Seu próximo projeto começa aqui', state.projects.length ? 'Tente buscar por outro nome, cliente ou endereço.' : isEngineer() ? 'Cadastre a primeira obra e organize todas as etapas em um só lugar.' : 'As obras vinculadas à sua conta aparecerão aqui.');
  return projects.map(p => `
    <article class="project-card">
      <div class="project-cover">${buildingScene({ compact: true })}<div class="cover-status">${badge(p.status)}</div><span class="cover-caption">VOLUME ILUSTRATIVO</span></div>
      <div class="project-card-body"><h3>${esc(p.name)}</h3><p class="address">${icon('pin')}${esc(p.address || 'Endereço ainda não informado')}</p>
        <div class="progress-caption"><span>Avanço da obra</span><strong>${p.progress}%</strong></div><progress value="${p.progress}" max="100">${p.progress}%</progress>
        ${isEngineer() ? `<div class="card-client ${p.client_id ? '' : 'unassigned'}"><span class="client-avatar">${icon('users')}</span><div><small>CLIENTE DA OBRA</small><strong>${esc(p.client_name || 'Vincule o cliente desta obra')}</strong></div><button class="icon-button" data-action="assign-client" data-id="${p.id}" aria-label="${esc(p.client_id ? `Alterar cliente de ${p.name}` : `Vincular cliente a ${p.name}`)}">${icon(p.client_id ? 'link' : 'plus')}</button></div>` : ''}
        <div class="card-facts"><div><small>PREVISÃO DE ENTREGA</small><span>${day(p.end_date)}</span></div><div><small>ETAPAS</small><span>${p.completed_stages} de ${p.stage_count}</span></div></div>
        <a class="card-open" href="#obra=${p.id}" data-action="open-project" data-id="${p.id}" aria-label="Acompanhar obra: ${esc(p.name)}">Acompanhar obra ${icon('arrow')}</a>
      </div>
    </article>`).join('');
}

function clientsPage() {
  return `<div class="page-heading"><div><span class="eyebrow">RELACIONAMENTO</span><h1>Clientes</h1><p>Cadastre o acesso do cliente e vincule suas obras.</p></div>${button('new-client','＋ Novo cliente')}</div><section class="panel">${state.clients.length ? `<div class="table-wrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Obras vinculadas</th></tr></thead><tbody>${state.clients.map(c => `<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.email)}</td><td>${state.projects.filter(p => p.client_id === c.id).length}</td></tr>`).join('')}</tbody></table></div>` : empty('Ainda não há clientes', 'Crie uma conta e vincule-a no cadastro da obra.')}</section>`;
}
function projectDetail() {
  const { project: p } = state.detail;
  const tabs = [['stages','Quadro de obra'],['diary','Diário de obra'],['schedule','Cronograma'],['approvals','Aprovações'],['photos','Mapa fotográfico'],['documents','Documentos'], ...(isEngineer() ? [['materials','Materiais'],['purchases','Compras'],['expenses','Despesas'],['workers','Equipe']] : []),['questions','Perguntas'],['selections','Acabamentos'],['inspections','Vistoria e pós-obra']];
  return `
    <button class="back text-button" data-action="back">← Todas as obras</button>
    <section class="project-heading-panel"><div class="project-heading-copy"><span class="eyebrow">ACOMPANHAMENTO DA OBRA</span><h1 data-project-heading tabindex="-1">${esc(p.name)}</h1><p class="detail-address">${icon('pin')}${esc(p.address || 'Endereço não informado')}</p><div class="heading-actions">${badge(p.status)}${isEngineer() ? button('edit-project','Editar obra','','secondary') : ''}</div>${p.description ? `<p class="project-description">${esc(p.description)}</p>` : ''}</div>${buildingScene({ controls: true })}</section>
    ${isEngineer() ? `<section class="client-association ${p.client_id ? '' : 'unassigned'}" aria-labelledby="client-association-title"><span class="client-avatar">${icon('users')}</span><div class="client-association-copy"><span class="eyebrow" id="client-association-title">CLIENTE DA OBRA</span><h2>${esc(p.client_name || 'Esta obra ainda não tem cliente vinculado')}</h2><p>${p.client_id ? esc(p.client_email) : 'Vincule um cadastro existente ou crie o cliente aqui mesmo.'}</p><small>${p.client_id ? 'Acesso às etapas e aos arquivos publicados desta obra.' : 'O vínculo libera o acompanhamento no portal do cliente.'}</small></div>${button('assign-client', `${icon('link')} ${p.client_id ? 'Alterar cliente' : 'Vincular cliente'}`, `data-id="${p.id}"`, p.client_id ? 'secondary' : 'primary')}</section>` : ''}
    <div class="project-summary"><div><small>INÍCIO</small><strong>${day(p.start_date)}</strong></div><div><small>PREVISÃO DE ENTREGA</small><strong>${day(p.end_date)}</strong></div><div><small>ETAPAS CONCLUÍDAS</small><strong>${p.completed_stages} de ${p.stage_count}</strong><small>AVANÇO DA OBRA · ${p.progress}%</small></div>${isEngineer() ? `<div><small>ORÇAMENTO PREVISTO</small><strong>${money(p.budget_cents)}</strong></div>` : ''}</div>
    <p class="progress-note">O avanço mostra quanto da obra foi executado. As etapas têm a mesma participação, salvo ajuste do engenheiro.</p>
    <div class="tabs" role="tablist" aria-label="Informações da obra">${tabs.map(([tab,label]) => `<button id="tab-${tab}" role="tab" aria-selected="${state.tab === tab}" aria-controls="detail-panel" tabindex="${state.tab === tab ? 0 : -1}" class="${state.tab === tab ? 'active' : ''}" data-action="tab" data-tab="${tab}">${label}</button>`).join('')}</div>
    <section id="detail-panel" class="tab-content" role="tabpanel" aria-labelledby="tab-${state.tab}">${tabContent()}</section>`;
}

function tabContent() {
  const operationPanel = operationsUI.panel(state.tab);
  if (operationPanel !== null) return operationPanel;
  if (state.tab === 'stages') {
    return `<div class="section-heading"><div><h2>Quadro de obra</h2><p>Do planejamento à conclusão de cada etapa.</p></div>${isEngineer() ? button('tab','Gerenciar no cronograma','data-tab="schedule"','secondary') : ''}</div><div class="board">${['PLANNED','IN_PROGRESS','COMPLETED'].map(status => {
      const stages = state.detail.stages.filter(s => s.status === status);
      return `<div class="board-column"><h3><span class="status-dot ${status.toLowerCase()}"></span>${labels[status]} <small>${stages.length}</small></h3>${stages.length ? stages.map(s => `<article class="stage-card"><h4>${esc(s.title)}</h4><p>${day(s.start_date)} → ${day(s.end_date)}</p><p>${esc(s.responsible || 'Sem responsável')} · ${s.progress_percent}% concluído</p>${s.overdue ? '<small class="overdue-label">Prazo vencido</small>' : ''}<small>${state.detail.attachments.filter(a => a.stage_id === s.id).length} anexo(s)</small>${isEngineer() ? `<div class="row-actions">${button('edit-stage','Editar',`data-id="${s.id}"`,'text-button')}${button('delete-resource','Excluir',`data-resource="stages" data-id="${s.id}"`,'text-button danger')}</div>` : ''}</article>`).join('') : '<p class="column-empty">Nenhuma etapa nesta situação.</p>'}</div>`;
    }).join('')}</div>`;
  }
  if (['photos','documents'].includes(state.tab)) return attachmentsPanel();
  if (state.tab === 'materials') return resourceTable('materials','Materiais','Controle inicial das quantidades registradas na obra.','Novo material', ['Material','Quantidade','Unidade','Observações'], m => [esc(m.name), m.quantity.toLocaleString('pt-BR'), esc(m.unit), esc(m.notes)]);
  if (state.tab === 'workers') return resourceTable('workers','Equipe da obra','Profissionais vinculados a este empreendimento.','Novo profissional', ['Nome','Função','Telefone','Situação'], w => [esc(w.name), esc(w.job_title), esc(w.phone), w.active ? 'Ativo' : 'Inativo']);
  const p = state.detail.project;
  return `<div class="finance-summary"><span>Registrado <strong>${money(p.expense_cents)}</strong></span><span>Pago <strong>${money(p.paid_cents)}</strong></span><span>Pendente <strong>${money(p.expense_cents - p.paid_cents)}</strong></span><span>Saldo do orçamento <strong>${money(p.budget_cents - p.expense_cents)}</strong></span></div>${resourceTable('expenses','Despesas','Acompanhamento financeiro interno da obra.','Nova despesa',['Descrição','Categoria','Data','Valor','Situação'], e => [esc(e.description),esc(e.category),day(e.expense_date),money(e.amount_cents),badge(e.status)])}`;
}
function attachmentItems() {
  const kind = state.tab === 'photos' ? 'PHOTO' : 'DOCUMENT';
  return state.detail.attachments.filter(a => a.kind === kind);
}
function filteredAttachments() {
  const search = state.attachmentSearch.toLocaleLowerCase('pt-BR');
  return attachmentItems().filter(a => {
    const stage = state.detail.stages.find(s => s.id === a.stage_id);
    return `${a.title} ${a.description} ${a.location} ${a.file_name} ${stage?.title || ''}`.toLocaleLowerCase('pt-BR').includes(search)
      && (!state.attachmentStage || a.stage_id === state.attachmentStage)
      && (!isEngineer() || state.attachmentVisibility === 'all' || Boolean(a.visible_to_client) === (state.attachmentVisibility === 'published'));
  });
}
const fileSize = bytes => bytes >= 1024*1024 ? `${(bytes/(1024*1024)).toLocaleString('pt-BR',{maximumFractionDigits:1})} MB` : `${Math.max(1,Math.round(bytes/1024))} KB`;
const fileLabel = a => a.mime_type === 'application/pdf' ? 'PDF' : a.mime_type.split('/')[1].toUpperCase();
function attachmentActions(a) {
  return `<div class="row-actions attachment-actions">${a.mime_type.startsWith('image/') ? button('preview-attachment','Visualizar',`data-id="${a.id}"`,'text-button') : ''}<a class="text-button" href="/api/attachments/${a.id}/file?download=1" aria-label="Baixar ${esc(a.title)}">Baixar</a>${isEngineer() ? `${button('visibility',a.visible_to_client ? 'Tornar interno' : 'Publicar',`data-id="${a.id}" data-visible="${!a.visible_to_client}"`,'text-button')}${button('delete-attachment','Excluir',`data-id="${a.id}"`,'text-button danger')}` : ''}</div>`;
}
function attachmentResults() {
  const items = filteredAttachments(), photo = state.tab === 'photos';
  if (!items.length) return empty(attachmentItems().length ? 'Nenhum registro encontrado' : photo ? 'Registre a evolução da obra' : 'Documentos organizados desde o início', attachmentItems().length ? 'Ajuste a busca ou os filtros para encontrar os registros.' : isEngineer() ? 'Adicione arquivos e escolha quais compartilhar com o cliente.' : 'Os arquivos publicados pelo engenheiro aparecerão aqui.');
  if (!photo) return `<div class="panel document-list"><div class="table-wrap"><table><thead><tr><th>Documento</th><th>Registro / etapa</th><th>Arquivo</th>${isEngineer() ? '<th>Visibilidade</th>' : ''}<th>Ações</th></tr></thead><tbody>${items.map(a => `<tr><td><div class="document-title"><span class="file-emblem">${icon('projects')}<small>${fileLabel(a)}</small></span><div><strong>${esc(a.title)}</strong><span>${esc(a.description || a.file_name)}</span>${a.location ? `<small>${esc(a.location)}</small>` : ''}</div></div></td><td><span>${day(a.record_date)}</span><small class="cell-secondary">${esc(state.detail.stages.find(s => s.id === a.stage_id)?.title || 'Sem etapa vinculada')}</small></td><td><span>${fileLabel(a)}</span><small class="cell-secondary">${fileSize(a.size)}</small></td>${isEngineer() ? `<td><span class="visibility ${a.visible_to_client ? 'published' : ''}">${a.visible_to_client ? 'Publicado' : 'Interno'}</span></td>` : ''}<td>${attachmentActions(a)}</td></tr>`).join('')}</tbody></table></div></div>`;
  return `<div class="attachment-grid">${items.map(a => `<article class="attachment-card"><button class="photo-open" data-action="preview-attachment" data-id="${a.id}" aria-label="Ampliar foto: ${esc(a.title)}"><img src="/api/attachments/${a.id}/file" alt="${esc(a.title)}" loading="lazy"><span>Ampliar registro ↗</span></button><div class="attachment-info"><div class="attachment-meta"><span>${day(a.record_date)}</span>${isEngineer() ? `<span class="visibility ${a.visible_to_client ? 'published' : ''}">${a.visible_to_client ? 'Publicado' : 'Interno'}</span>` : ''}</div><h3>${esc(a.title)}</h3><p>${esc(a.description)}</p><small>${esc([a.location,state.detail.stages.find(s => s.id === a.stage_id)?.title].filter(Boolean).join(' · ') || a.file_name)} · ${fileSize(a.size)}</small>${attachmentActions(a)}</div></article>`).join('')}</div>`;
}
function attachmentsPanel() {
  const items = attachmentItems(), photo = state.tab === 'photos';
  const totalSize = items.reduce((sum,a) => sum + a.size,0);
  return `<div class="section-heading"><div><span class="eyebrow">${photo ? 'EVOLUÇÃO VISUAL' : 'ACERVO DA OBRA'}</span><h2>${photo ? 'Mapa fotográfico' : 'Documentos da obra'}</h2><p>${photo ? 'Inspecione registros por etapa, ambiente ou descrição.' : 'Projetos, notas e comprovantes com acesso organizado.'}</p></div>${isEngineer() ? button('new-attachment',photo ? '＋ Adicionar foto' : '＋ Adicionar documento',`data-kind="${photo ? 'PHOTO' : 'DOCUMENT'}"`) : ''}</div>
  <div class="archive-summary"><span><strong>${items.length}</strong> ${photo ? 'foto(s)' : 'documento(s)'}</span>${isEngineer() ? `<span><strong>${items.filter(a=>a.visible_to_client).length}</strong> publicado(s)</span><span><strong>${items.filter(a=>!a.visible_to_client).length}</strong> interno(s)</span>` : ''}<span><strong>${items.length ? fileSize(totalSize) : '0 KB'}</strong> em arquivos</span></div>
  <div class="archive-toolbar"><label class="search-label">${icon('search')}<span class="sr-only">Buscar registros</span><input id="attachment-search" type="search" placeholder="Buscar título, ambiente ou arquivo…" value="${esc(state.attachmentSearch)}"></label><label><span class="sr-only">Filtrar por etapa</span><select id="attachment-stage" aria-label="Filtrar por etapa"><option value="">Todas as etapas</option>${state.detail.stages.map(s=>`<option value="${s.id}" ${state.attachmentStage===s.id?'selected':''}>${esc(s.title)}</option>`).join('')}</select></label>${isEngineer() ? `<label><span class="sr-only">Filtrar por visibilidade</span><select id="attachment-visibility" aria-label="Filtrar por visibilidade">${[['all','Todas as visibilidades'],['published','Publicados'],['internal','Internos']].map(([id,label])=>`<option value="${id}" ${state.attachmentVisibility===id?'selected':''}>${label}</option>`).join('')}</select></label>` : ''}</div>
  <p id="attachment-count" class="result-count" role="status">${filteredAttachments().length} de ${items.length} registro(s)</p><div id="attachment-results">${attachmentResults()}</div>`;
}
function updateAttachmentResults() {
  $('#attachment-results').innerHTML = attachmentResults();
  $('#attachment-count').textContent = `${filteredAttachments().length} de ${attachmentItems().length} registro(s)`;
}
function previewAttachment(id) {
  const a = state.detail.attachments.find(a => a.id === id);
  if (!a || !a.mime_type.startsWith('image/')) return;
  const dialog = $('#modal');
  dialog.innerHTML = `<div class="modal-heading"><h2 id="dialog-title">${esc(a.title)}</h2><button type="button" data-action="close-modal" class="icon-button" aria-label="Fechar">×</button></div><figure class="photo-preview"><img src="/api/attachments/${a.id}/file" alt="${esc(a.title)}"><figcaption>${day(a.record_date)}${a.location ? ` · ${esc(a.location)}` : ''}</figcaption></figure><p class="preview-description">${esc(a.description)}</p><div class="modal-footer"><a class="primary" href="/api/attachments/${a.id}/file?download=1">Baixar arquivo</a><button type="button" class="secondary" data-action="close-modal">Fechar</button></div>`;
  dialog.showModal();
}
function routeProjectId() {
  const id = new URLSearchParams(location.hash.slice(1)).get('obra');
  return id && /^[a-f0-9-]{36}$/.test(id) ? id : null;
}
let projectRequest = 0;
async function openProject(id, changeHistory = true) {
  const request = ++projectRequest;
  const detail = await api(`/projects/${id}`);
  if (request !== projectRequest) return;
  Object.assign(state,{projectId:id,detail,page:'projects',tab:'stages',attachmentSearch:'',attachmentStage:'',attachmentVisibility:'all',diaryFrom:'',diaryTo:'',materialSearch:'',materialFilter:'all',materialHistoryId:''});
  if (changeHistory) history.pushState(null,'',`#obra=${id}`);
  render(); window.scrollTo(0,0); $('[data-project-heading]').focus({preventScroll:true});
}
function resourceTable(resource,title,description,add,headers,cells) {
  const items = state.detail[resource] || [];
  return `<div class="section-heading"><div><h2>${title}</h2><p>${description}</p></div>${button('new-resource',`＋ ${add}`,`data-resource="${resource}"`)}</div><div class="panel">${items.length ? `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}<th>Ações</th></tr></thead><tbody>${items.map(item=>`<tr>${cells(item).map(c=>`<td>${c}</td>`).join('')}<td class="row-actions">${button('edit-resource','Editar',`data-resource="${resource}" data-id="${item.id}"`,'text-button')}${button('delete-resource','Excluir',`data-resource="${resource}" data-id="${item.id}"`,'text-button danger')}</td></tr>`).join('')}</tbody></table></div>` : empty('Nenhum registro por enquanto', 'Adicione o primeiro registro desta obra.')}</div>`;
}

function field(name, label, value = '', type = 'text', options = {}) {
  if (type === 'select') return `<label>${label}<select name="${name}" aria-label="${esc(label)}">${options.choices.map(([id,title])=>`<option value="${esc(id)}" ${String(value) === String(id) ? 'selected' : ''}>${esc(title)}</option>`).join('')}</select></label>`;
  if (type === 'textarea') return `<label class="full">${label}<textarea name="${name}" aria-label="${esc(label)}" rows="3" maxlength="${options.max || 4000}">${esc(value)}</textarea></label>`;
  if (type === 'checkbox') return `<label class="checkbox full"><input type="checkbox" name="${name}" ${value ? 'checked' : ''}>${label}</label>`;
  return `<label ${options.full ? 'class="full"' : ''}>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${options.optional ? '' : 'required'} ${options.readonly ? 'readonly' : ''} ${type === 'number' ? `min="${options.min??0}" max="${options.max??1000000000}" step="${options.step??0.01}"` : ''} ${type === 'password' ? 'minlength="12" maxlength="128" autocomplete="new-password"' : ''} ${['text','email'].includes(type) ? `maxlength="${options.max || 200}"` : ''}></label>`;
}
function modal(title, content, submit, help = '', onSave = null) {
  const dialog = $('#modal');
  dialog.innerHTML = `<form id="modal-form"><div class="modal-heading"><h2 id="dialog-title">${esc(title)}</h2><button type="button" data-action="close-modal" class="icon-button" aria-label="Fechar">×</button></div>${help ? `<p class="modal-help">${esc(help)}</p>` : ''}<div class="form-grid">${content}</div><p class="form-error" role="alert"></p><div class="modal-footer"><button type="button" class="secondary" data-action="close-modal">Cancelar</button><button class="primary" type="submit">${submit}</button></div></form>`;
  dialog.showModal();
  $('#modal-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget, submitButton = form.querySelector('[type=submit]'); submitButton.disabled = true;
    try { await onSave(new FormData(form), form); dialog.close(); notice('Alterações salvas.'); }
    catch (error) { if (error.status === 401) handleError(error); else form.querySelector('.form-error').textContent = error.message; }
    finally { submitButton.disabled = false; }
  });
}
const selectStatus = (value, choices) => field('status','Situação',value,'select',{ choices: choices.map(s=>[s,labels[s]]) });
function clientPicker(currentId = '') {
  return `<fieldset class="client-picker full"><legend>${icon('users')} Cliente da obra</legend><p>Selecione o responsável que terá acesso ao portal desta obra.</p>
    ${field('client_id','Cliente cadastrado',currentId || '','select',{choices:[['','Sem cliente vinculado'],...state.clients.map(c => [c.id, `${c.name} — ${c.email}`])]})}
    ${!state.clients.length ? '<p class="picker-hint">Você ainda não cadastrou clientes. Use a opção abaixo para criar o primeiro.</p>' : ''}
    <button type="button" class="inline-client-toggle text-button" data-action="inline-client" aria-expanded="false">+ Cadastrar cliente aqui</button>
    <div class="inline-client-fields" data-inline-client hidden>
      <p>Crie o acesso e vincule o cliente ao salvar.</p>
      <label>Nome do novo cliente<input name="new_client_name" maxlength="200" autocomplete="off" disabled></label>
      <label>E-mail do novo cliente<input name="new_client_email" type="email" maxlength="254" autocomplete="off" disabled></label>
      <label>Senha inicial do novo cliente<input name="new_client_password" type="password" minlength="12" maxlength="128" autocomplete="new-password" disabled></label>
      <small>Use pelo menos 12 caracteres e compartilhe a senha por um canal privado.</small>
    </div>
  </fieldset>`;
}
function toggleInlineClient(form, open) {
  const panel = form.querySelector('[data-inline-client]');
  panel.hidden = !open;
  panel.querySelectorAll('input').forEach(input => { input.disabled = !open; input.required = open; if (!open) input.value = ''; });
  form.querySelector('[name=client_id]').disabled = open;
  const trigger = form.querySelector('[data-action=inline-client]');
  trigger.setAttribute('aria-expanded', String(open));
  trigger.textContent = open ? '← Selecionar cliente já cadastrado' : '+ Cadastrar cliente aqui';
  if (open) panel.querySelector('input').focus();
}
async function resolveClient(data, form) {
  if (!form.querySelector('[data-inline-client]').hidden) {
    const client = await api('/clients', { method: 'POST', body: { name: data.get('new_client_name'), email: data.get('new_client_email'), password: data.get('new_client_password') } });
    state.clients.push(client);
    const select = form.querySelector('[name=client_id]');
    select.add(new Option(`${client.name} — ${client.email}`, client.id));
    select.value = client.id;
    toggleInlineClient(form, false);
    data.set('client_id', client.id);
  }
  for (const key of ['new_client_name','new_client_email','new_client_password']) data.delete(key);
  return data.get('client_id') || null;
}
function clientAssignmentForm(projectId) {
  const p = state.projects.find(project => project.id === projectId);
  if (!p) return;
  modal('Cliente da obra', `<p class="assignment-project full">${icon('projects')} ${esc(p.name)}</p>${clientPicker(p.client_id)}`, 'Salvar vínculo', 'Ao trocar o cliente, o acesso à obra passa para a nova conta. Os registros da obra são preservados.', async (data, form) => {
    const clientId = await resolveClient(data, form);
    await api(`/projects/${p.id}/client`, { method: 'PATCH', body: { client_id: clientId } });
    await refresh();
  });
}
function projectForm(edit = false) {
  const p = edit ? state.detail.project : {};
  const fields = field('name','Nome da obra',p.name)
    + field('address','Endereço',p.address,'text',{ optional:true,max:400 })
    + clientPicker(p.client_id)
    + field('budget','Orçamento previsto (R$)',(p.budget_cents || 0)/100,'number')
    + selectStatus(p.status || 'ACTIVE',['ACTIVE','PAUSED','COMPLETED'])
    + field('start_date','Data de início',p.start_date,'date',{optional:true})
    + field('end_date','Previsão de entrega',p.end_date,'date',{optional:true})
    + field('description','Descrição compartilhada com o cliente',p.description,'textarea');
  modal(edit ? 'Editar obra' : 'Nova obra', fields, 'Salvar obra', 'Organize os dados do empreendimento e vincule o cliente que acompanhará a execução.', async (data, form) => {
    // Validate the range before creating an inline client account.
    if (data.get('start_date') && data.get('end_date') && data.get('start_date') > data.get('end_date')) throw new Error('A previsão de entrega deve ser igual ou posterior à data de início.');
    const clientId = await resolveClient(data, form);
    const input = Object.fromEntries(data); input.client_id = clientId; input.budget = Number(input.budget);
    await api(edit ? `/projects/${p.id}` : '/projects', {method:edit?'PATCH':'POST',body:input});
    await refresh();
  });
}

function stageForm(id) {
  const s = state.detail.stages.find(s=>s.id===id) || {};
  const fields = field('title','Nome da etapa',s.title) + selectStatus(s.status || 'PLANNED',['PLANNED','IN_PROGRESS','COMPLETED'])
    + field('progress_percent','Etapa concluída (%)',s.progress_percent ?? 0,'number',{max:100}) + `<details class="full advanced-settings"><summary>Avançado: participação no avanço total</summary><p>Por padrão, todas as etapas contam igualmente (valor 1). Valor 2 faz esta etapa contar o dobro de uma etapa com valor 1. Isso não representa quantidade de material nem valor financeiro.</p>${field('weight','Participação relativa',s.weight ?? 1,'number',{min:.001,max:1000,step:.001})}</details>`
    + field('responsible','Responsável',s.responsible,'text',{optional:true})
    + field('start_date','Início previsto',s.start_date,'date',{optional:true}) + field('end_date','Conclusão prevista',s.end_date,'date',{optional:true})
    + field('actual_start','Início real',s.actual_start,'date',{optional:true}) + field('actual_end','Conclusão real',s.actual_end,'date',{optional:true});
  modal(id ? 'Editar etapa' : 'Nova etapa', fields, 'Salvar etapa', 'Informe quanto desta etapa já foi executado: 0% = não iniciada; 50% = metade pronta; 100% = concluída. A situação acompanha o percentual.', async data => {
    const input=Object.fromEntries(data); input.weight=Number(input.weight);input.progress_percent=Number(input.progress_percent);
    await api(`/projects/${state.projectId}/stages${id?`/${id}`:''}`,{method:id?'PATCH':'POST',body:input}); await refresh();
  });
  $('#modal-form [name=progress_percent]').addEventListener('input',event=>{const n=Number(event.target.value);$('#modal-form [name=status]').value=n===100?'COMPLETED':n>0?'IN_PROGRESS':'PLANNED';});
  $('#modal-form [name=status]').addEventListener('change',event=>{const progress=$('#modal-form [name=progress_percent]');if(event.target.value==='COMPLETED')progress.value=100;else if(event.target.value==='PLANNED'||Number(progress.value)===100)progress.value=0;});
}
function resourceForm(resource, id) {
  const item = state.detail[resource].find(i=>i.id===id) || {};
  let fields;
  if (resource === 'materials') {
    const fixed=!!id&&isUnit(item.unit);
    const unitPicker=`<label>Unidade de medida<select name="unit" aria-label="Unidade de medida" required ${fixed?'disabled':''}><option value="">Selecione a unidade</option>${units.map(([value,label])=>`<option value="${esc(value)}" ${item.unit===value?'selected':''}>${esc(label)}</option>`).join('')}</select></label>${fixed?`<input type="hidden" name="unit" value="${esc(item.unit)}">`:''}`;
    fields=field('name','Material',item.name)+unitPicker+(id?`<p class="full module-note">Saldo registrado: ${item.quantity.toLocaleString('pt-BR')}${fixed?' '+esc(item.unit):'. Escolha a unidade correta acima; as quantidades não serão convertidas.'}. Para corrigir lançamentos, use Estornar no histórico.</p>`:field('quantity','Quantidade que já existe na obra',0,'number',{step:.001}))+field('minimum_quantity','Estoque mínimo para alerta',item.minimum_quantity??0,'number',{step:.001})+field('notes','Observações',item.notes,'textarea',{max:2000});
  }
  if (resource === 'workers') fields = field('name','Nome',item.name) + field('job_title','Função',item.job_title,'text',{max:100}) + field('phone','Telefone',item.phone,'text',{optional:true,max:40}) + field('active','Profissional ativo nesta obra',item.active ?? true,'checkbox');
  if (resource === 'expenses') fields = field('description','Descrição',item.description) + field('category','Categoria',item.category,'text',{max:100}) + field('amount','Valor (R$)',(item.amount_cents||0)/100,'number',{readonly:state.detail.purchases.some(p=>p.expense_id===id)}) + field('expense_date','Data da despesa',item.expense_date || today(),'date') + field('supplier','Fornecedor',item.supplier,'text',{optional:true}) + field('due_date','Vencimento',item.due_date,'date',{optional:true}) + (id ? '<p class="full module-note">A quitação é controlada pelo histórico de pagamentos.</p>' : selectStatus('PENDING',['PENDING','PAID']));
  modal(`${id ? 'Editar' : 'Adicionar'} ${resource==='materials'?'material':resource==='workers'?'profissional':'despesa'}`, fields, 'Salvar registro', resource==='materials'?'Cadastre aqui apenas o estoque que já existe. Para uma nova compra com custo, use Registrar compra.':'Registro interno, disponível apenas para o engenheiro.', async data => {
    const input = Object.fromEntries(data);
    if (resource==='materials') {input.quantity = id ? item.quantity : Number(input.quantity);input.minimum_quantity=Number(input.minimum_quantity);}
    if (resource==='expenses') { input.amount = Number(input.amount); if(id) input.status=item.status; }
    if (resource==='workers') input.active = data.has('active');
    await api(`/projects/${state.projectId}/${resource}${id?`/${id}`:''}`,{method:id?'PATCH':'POST',body:input}); await refresh();
  });
}
function attachmentForm(kind) {
  const photo = kind === 'PHOTO';
  modal(photo ? 'Adicionar registro fotográfico' : 'Adicionar documento', field('title','Título') + field('record_date','Data do registro',today(),'date') + field('location','Ambiente / local','','text',{optional:true}) + field('stage_id','Etapa vinculada','','select',{choices:[['','Sem etapa'],...state.detail.stages.map(s=>[s.id,s.title])]}) + field('description','Descrição','','textarea') + `<label class="full">Arquivo (até 8 MB)<input type="file" name="file" accept="image/jpeg,image/png,image/webp${photo?'':',application/pdf'}" required></label>` + field('visible_to_client','Publicar para o cliente',false,'checkbox'), 'Salvar anexo', 'Arquivos começam como internos. Publique somente o que deseja compartilhar.', async data => {
    const file = data.get('file');
    if (!file.size || file.size > 8*1024*1024) throw new Error('Selecione um arquivo de até 8 MB.');
    const base64 = await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Não foi possível ler o arquivo.'));reader.readAsDataURL(file);});
    const input = Object.fromEntries(data); delete input.file;
    Object.assign(input,{kind,file_name:file.name,file_base64:base64,visible_to_client:data.has('visible_to_client')});
    await api(`/projects/${state.projectId}/attachments`,{method:'POST',body:input}); await refresh();
  });
}
function confirmDelete(path, message) {
  modal('Excluir registro', `<p class="full">${esc(message)}</p>`, 'Excluir', 'Esta ação não pode ser desfeita.', async () => { await api(path,{method:'DELETE'}); await refresh(); });
}
document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]'); if (!target) return;
  const { action, id, resource } = target.dataset;
  try {
    if (operationsUI.handles(action)) { event.preventDefault(); await operationsUI.action(action,target); return; }
    if(action==='refresh-dashboard')return refresh();
    if(action==='attention-open'){await openProject(id);if(state.projectId!==id)return;state.tab=target.dataset.tab;render();return;}
    if (action==='close-modal') return $('#modal').close();
    if (action==='navigate' || action==='back') { projectRequest++; state.page=target.dataset.page || 'projects'; state.projectId=null; state.detail=null; history.pushState(null,'',`#${state.page}`); render(); window.scrollTo(0,0); return; }
    if (action==='logout') { projectRequest++;await api('/auth/logout',{method:'POST',body:{}});state.clients=[];$('#modal').close();$('#modal').replaceChildren();$('#print-report')?.remove(); state.user=null; state.projects=[]; state.detail=null; state.projectId=null; history.replaceState(null,'','#overview'); render(); return; }
    if (action==='open-project') { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return; event.preventDefault(); await openProject(id); return; }
    if (action==='preview-attachment') return previewAttachment(id);
    if (action==='tab') { state.tab=target.dataset.tab;state.attachmentSearch='';state.attachmentStage='';state.attachmentVisibility='all'; render(); return; }
    if (action==='assign-client') return clientAssignmentForm(id);
    if (action==='inline-client') { const form = target.closest('form'); toggleInlineClient(form, form.querySelector('[data-inline-client]').hidden); return; }
    if (action==='rotate-model') {
      const scene = target.closest('.architectural-scene'), orbit = scene.querySelector('.scene-orbit');
      const angle = (Number(orbit.dataset.angle) + Number(target.dataset.step) + 8) % 8;
      orbit.dataset.angle = String(angle);
      scene.querySelector('[data-rotation-status]').textContent = `Ilustração girada. Vista ${angle + 1} de 8.`;
      return;
    }
    if (action==='new-project' || action==='edit-project') return projectForm(action==='edit-project');
    if (action==='new-stage' || action==='edit-stage') return stageForm(id);
    if (action==='new-resource' || action==='edit-resource') return resourceForm(resource,id);
    if (action==='new-attachment') return attachmentForm(target.dataset.kind);
    if (action==='delete-resource') return confirmDelete(`/projects/${state.projectId}/${resource}/${id}`,resource==='stages'?'Excluir esta etapa? Os anexos serão mantidos sem vínculo com a etapa.':'Excluir este registro da obra?');
    if (action==='delete-attachment') return confirmDelete(`/attachments/${id}`,'Excluir este anexo e seu arquivo?');
    if (action==='visibility') { target.disabled=true; await api(`/attachments/${id}`,{method:'PATCH',body:{visible_to_client:target.dataset.visible==='true'}}); await refresh(); notice('Visibilidade atualizada.'); return; }
    if (action==='new-client') return modal('Novo cliente', field('name','Nome') + field('email','E-mail','','email',{max:254}) + field('password','Senha inicial (mínimo 12 caracteres)','','password'), 'Cadastrar cliente', 'Entregue a senha por um canal privado. O cliente poderá alterá-la após entrar. Depois, vincule-o à obra.', async data=>{await api('/clients',{method:'POST',body:Object.fromEntries(data)});await refresh();});
    if (action==='password') return modal('Trocar senha', '<label>Senha atual<input name="current_password" type="password" autocomplete="current-password" required maxlength="128"></label>' + field('password','Nova senha','','password') + field('confirmation','Repita a nova senha','','password'), 'Alterar senha', 'Você precisará entrar novamente após a alteração.', async data=>{if(data.get('password')!==data.get('confirmation'))throw new Error('As senhas não coincidem.');await api('/auth/password',{method:'POST',body:Object.fromEntries(data)});state.user=null;state.detail=null;state.projectId=null;render();});
  } catch(error) { handleError(error); }
  finally { target.disabled=false; }
});
document.addEventListener('input', event=>{
  if(event.target.id==='project-search'){state.search=event.target.value;$('#project-grid').innerHTML=projectCards();}
  if(event.target.id==='attachment-search'){state.attachmentSearch=event.target.value;updateAttachmentResults();}
});
document.addEventListener('change', event=>{
  if(event.target.id==='attachment-stage'){state.attachmentStage=event.target.value;updateAttachmentResults();}
  if(event.target.id==='attachment-visibility'){state.attachmentVisibility=event.target.value;updateAttachmentResults();}
});
window.addEventListener('popstate',async()=>{
  if(!state.user)return;
  try {
    const id=routeProjectId();
    if(id)await openProject(id,false);
    else{projectRequest++;state.projectId=null;state.detail=null;state.page=location.hash==='#clients'&&isEngineer()?'clients':location.hash==='#overview'?'overview':'projects';render();}
  }catch(error){handleError(error);}
});
document.addEventListener('submit', async event=>{
  if(event.target.id!=='login-form') return;
  event.preventDefault();const form=event.target, submit=form.querySelector('[type=submit]');submit.disabled=true;
  try { state.user=await api('/auth/login',{method:'POST',body:Object.fromEntries(new FormData(form))}); state.projectId=null;state.detail=null;state.page='overview';state.search='';await refresh();const id=routeProjectId();if(id){try{await openProject(id,false);}catch(error){handleError(error);}} }
  catch(error){form.querySelector('.form-error').textContent=error.message;}
  finally{submit.disabled=false;}
});
try { state.user=await api('/auth/me');await refresh(); const id=routeProjectId();if(id){try{await openProject(id,false);}catch(error){handleError(error);}} }
catch(error){if(error.status!==401)notice(error.message,true);state.user=null;render();}

// Keyboard navigation follows the tab pattern without requiring pointer input.
document.addEventListener('keydown', event => {
  if (!event.target.matches('[role=tab]') || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  const tabs = [...event.target.closest('[role=tablist]').querySelectorAll('[role=tab]')];
  let next = tabs.indexOf(event.target);
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = tabs.length - 1;
  else next = (next + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault(); state.tab = tabs[next].dataset.tab; render();
  document.querySelector(`[data-tab="${state.tab}"]`).focus();
});
