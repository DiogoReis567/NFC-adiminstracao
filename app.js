/* ---------- Config ---------- */
const KEY = 'gestao-nfc-v1';
const USER = 'Diogo Reis';
const PASS = 'DiogoReis202618';

/* ---------- Utilidades ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = v => (+v || 0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
const money = v => (+v || 0) < 0 ? `<span class="neg">${fmt(v)}</span>` : fmt(v);
const sum = (a, f) => a.reduce((t, x) => t + (f(x) || 0), 0);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const dBR = d => d ? d.split('-').reverse().join('/') : '';
const linkOk = u => /^https?:\/\//i.test(u || '');
const badge = (t, c) => `<span class="b ${c || ''}">${esc(t)}</span>`;
function toast(m, undo) {
  const t = $('#toast'); t.textContent = m;
  if (undo) { const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost'; b.textContent = 'Desfazer'; b.onclick = () => { clearTimeout(toast.h); t.style.display = 'none'; undo(); }; t.appendChild(b); }
  t.style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = 'none', undo ? 7000 : 2600);
}

/* ---------- Dados ---------- */
const BASE = [['tag', 'Tag NFC', 'Kit', 10], ['display', 'Display (suporte)', 'Unitário', 1], ['embalagem', 'Embalagem', 'Unitário', 1], ['cartao', 'Cartão de agradecimento', 'Unitário', 1]];
const empty = () => ({clientes:[], pedidos:[], estoque:[], compras:[], financeiro:[], metas:{geral:0, mensal:{}}, config:{empresa:'', ig:'', pp:59.9, ps:79.9, som:true, vinil:0}, notifs:[], nk:{}});
/* garante o formato novo (itens antigos viram "Unitário"; compras sempre é uma lista) */
function norm(x) {
  if (!Array.isArray(x.compras)) x.compras = [];
  x.config = Object.assign({empresa:'', ig:'', pp:59.9, ps:79.9, som:true, vinil:0}, x.config);
  delete x.config.kit; delete x.mov;
  if (!Array.isArray(x.notifs)) x.notifs = [];
  if (!x.nk || typeof x.nk !== 'object') x.nk = {};
  let mx = Math.max(0, ...x.pedidos.map(p => +p.num || 0)); x.pedidos.forEach(p => { if (!p.num) p.num = ++mx; });
  x.estoque.forEach(e => { if (!e.tipo) { e.tipo = 'Unitário'; e.upk = 1; } });
  /* os 4 produtos fixos existem sempre */
  BASE.forEach(([b, nome, tipo, upk]) => { if (!x.estoque.some(e => e.base === b)) x.estoque.unshift({id: uid(), base: b, nome, tipo, upk, qtd: 0, min: 5}); });
  x.pedidos.forEach(p => {
    if (p.status === 'Em produção' || p.status === 'Pronto') p.status = 'Vendido';
    if (p.status !== 'Orçamento' && p.status !== 'Cancelado' && p.cons === undefined) { p.cons = 0; p.semBaixa = true; } /* pedido antigo: não mexe no estoque */
    delete p.feitas; delete p.custoProd; delete p.baixa;
    if (p.status === 'Orçamento') { p.pago = 'Orçamento'; p.sinal = 0; }
    else if (p.status === 'Cancelado') { if (!p.reemb) p.reemb = p.pago === 'Pago' || +p.sinal > 0 ? 'Devolver ao cliente' : 'Pagamento não ocorreu'; p.pago = 'Cancelado'; }
    else if (p.pago === 'Orçamento' || p.pago === 'Cancelado') p.pago = 'Pago';
    if (ativo(p.status) && p.pago === 'Pendente' && +p.valor > 0 && +p.sinal >= +p.valor) p.pago = 'Pago'; /* entrada já cobre o total */
  });
  return x;
}
function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY)); if (d) { const x = Object.assign(empty(), d); x.metas = Object.assign({geral:0, mensal:{}}, d.metas); return norm(x); } } catch (e) {}
  return norm(empty());
}
let db = load();
function persist() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast('Não foi possível salvar no navegador'); } }
function save() { persist(); if (logado) checar(); }
const nomeCli = id => (db.clientes.find(c => c.id === id) || {}).empresa || '—';

/* ---------- Esquema dos cadastros ---------- */
const S = {
  clientes: {um:'Cliente', campos:[
    ['empresa','Nome da empresa','text',1],['segmento','Segmento / ramo (ex.: padaria, clínica)','text'],['endereco','Endereço comercial (da empresa)','text'],['cidade','Cidade','text'],
    ['contato','Nome do contato','text'],['tel','WhatsApp da empresa (com DDD)','tel'],['email','E-mail da empresa','email'],
    ['site','Site da empresa','url'],['ig','Instagram da empresa','text'],['link','Link de avaliação do Google','url'],
    ['origem','Como conheceu a gente','opts:Não informado,Indicação,Instagram,Visita,Google,Outro']]},
  pedidos: {um:'Pedido', campos:[
    ['cliente','Cliente','select:clientes',1],['data','Data do pedido','date',1],['tipoPl','Tipo de plaquinha','opts:Padrão,Personalizada,Padrão + Personalizada'],['qp','Quantidade de plaquinhas padrão','number'],['qs','Quantidade de plaquinhas personalizadas','number'],
    ['descTipo','Tipo de desconto','opts:Sem desconto,Valor (R$),Porcentagem (%)'],['descV','Quanto de desconto (R$ ou %, conforme o tipo)','number'],['frete','Frete cobrado do cliente (R$, opcional)','number'],
    ['pagto','Forma de pagamento','opts:Pix,Cartão,Dinheiro,Outro'],['status','Status do pedido','opts:Orçamento,Vendido,Entregue,Cancelado'],['pago','Pagamento (acompanha o status)','opts:Orçamento,Pendente,Pago,Cancelado'],['sinal','Entrada já recebida (R$)','number'],['venc','Vencimento do pagamento (opcional)','date'],['reemb','Pagamento do pedido cancelado','opts:Pagamento não ocorreu,Devolver ao cliente,Já devolvi ao cliente'],['prev','Previsão de entrega (opcional)','date'],['obs','Observações','textarea']]},
  estoque: {um:'Produto', campos:[
    ['nome','Nome do produto','text',1],['tipo','Vem em','opts:Unitário,Kit'],['upk','Quantas unidades vêm em cada kit','number'],
    ['qtd','Quantidade em estoque (em unidades)','number'],['min','Avisar quando chegar em (unidades)','number'],['link','Link para comprar mais','url']]},
  compras: {um:'Compra', campos:[
    ['item','Produto','select:estoque',1],['data','Data','date',1],['qtd','Quantidade comprada (unidades ou kits, conforme o item)','number',1],
    ['valor','Valor por unidade ou por kit (R$)','number',1],['pago','Pagamento','opts:A pagar,Pago']]},
  financeiro: {um:'Lançamento', campos:[
    ['data','Data','date',1],['tipo','Tipo','opts:Despesa,Capital,Outro'],['desc','Descrição','text'],['valor','Valor (R$)','number']]}
};

/* ---------- Cálculos ---------- */
const r2 = x => Math.round((+x || 0) * 100) / 100;
const mult = it => it && it.tipo === 'Kit' ? Math.max(1, +it.upk || 1) : 1;
const totCompra = c => (+c.qtd || 0) * (+c.valor || 0);
function custoUn(it) {
  /* custo médio ponderado de todas as compras do item (valor total ÷ unidades); sem compra, usa o custo antigo do cadastro */
  const cs = db.compras.filter(c => c.item === it.id), un = c => +c.unid > 0 ? +c.unid : (+c.qtd || 0) * mult(it);
  const u = sum(cs, un);
  return u > 0 ? sum(cs, totCompra) / u : (+it.custo || 0);
}
const ativo = s => s !== 'Orçamento' && s !== 'Cancelado';
const PEND = ['Vendido'];
const STS = ['Orçamento', 'Vendido', 'Entregue', 'Cancelado'];
/* pagamento: "Pago" quita tudo; senão vale a entrada (sinal) já recebida */
const recP = p => p.pago === 'Pago' ? (+p.valor || 0) : Math.min(+p.sinal || 0, +p.valor || 0);
const faltaP = p => r2((+p.valor || 0) - recP(p));
/* unidades de um item que vieram de compras ainda não pagas */
/* cada plaquinha vendida usa 1 de cada um dos 4 produtos fixos; o vinil é um custo fixo por plaquinha */
const pecas = () => BASE.map(b => db.estoque.find(e => e.base === b[0])).filter(Boolean);
const vinilUn = () => +db.config.vinil || 0;
const custoUnPlaq = () => r2(sum(pecas(), custoUn));
function capac() {
  const L = pecas(); if (!L.length) return {n:0, lim:'', ok:false};
  let n = Infinity, lim = ''; L.forEach(e => { const q = Math.max(0, +e.qtd || 0); if (q < n) { n = q; lim = e.nome; } });
  return {n, lim, ok:true};
}
const custoPed = p => ativo(p.status) && p.cons ? r2((+p.custoMat || 0) + (+p.vinil || 0)) : r2((+p.qtd || 0) * (custoUnPlaq() + vinilUn()));
const temCusto = p => ativo(p.status) && p.cons ? (+p.custoMat || 0) + (+p.vinil || 0) > 0 : custoUnPlaq() + vinilUn() > 0;
const lucroPed = p => r2((+p.valor || 0) - custoPed(p));
function calc(r) {
  r = r || {};
  const ok = d => (!r.de || (d || '') >= r.de) && (!r.ate || (d || '') <= r.ate);
  const vend = db.pedidos.filter(p => ativo(p.status) && ok(p.data));
  const desp = db.financeiro.filter(f => f.tipo === 'Despesa' && ok(f.data));
  const cps = db.compras.filter(c => ok(c.data));
  const bruto = r2(sum(vend, p => +p.valor));
  const recebido = r2(sum(vend, recP));
  const compras = r2(sum(cps, totCompra));
  const aPagar = r2(sum(cps.filter(c => c.pago !== 'Pago'), totCompra));
  const outras = r2(sum(desp, f => +f.valor));
  const capital = r2(sum(db.financeiro.filter(f => f.tipo === 'Capital' && ok(f.data)), f => +f.valor));
  const vinil = r2(sum(vend, p => +p.vinil || 0));
  const despesa = r2(compras + outras + vinil);
  /* resumo mensal: mesma base dos totais (a soma dos meses fecha com os totais) */
  const m = {};
  const mes = d => { const k = (d || '').slice(0, 7) || 'sem-data'; return m[k] || (m[k] = {k, bruto:0, comp:0, desp:0, vin:0, rec:0}); };
  vend.forEach(p => { const x = mes(p.data); x.bruto += +p.valor || 0; x.rec += recP(p); x.vin += +p.vinil || 0; });
  cps.forEach(c => { mes(c.data).comp += totCompra(c); });
  desp.forEach(f => { mes(f.data).desp += +f.valor || 0; });
  const meses = Object.values(m).sort((a, b) => b.k.localeCompare(a.k)).map(x => ({...x, bruto:r2(x.bruto), comp:r2(x.comp), desp:r2(x.desp), vin:r2(x.vin), rec:r2(x.rec), liq:r2(x.bruto - x.comp - x.desp - x.vin)}));
  const cv = vend.filter(temCusto), lucroP = r2(sum(cv, lucroPed)), brutoC = sum(cv, p => +p.valor || 0);
  return {vend, bruto, recebido, aReceber: r2(bruto - recebido), compras, aPagar, outras, vinil, capital, despesa, liquido: r2(bruto - despesa), meses, lucroP, margem: brutoC > 0 ? lucroP / brutoC * 100 : null};
}

/* ---------- Tabelas ---------- */
const PG = 15, pgS = {}, srtS = {};
/* cols: [titulo, fn, classe, fnOrdenar]; sid liga ordenação e paginação (15 por página) */
function tabela(ent, cols, rows, ro, sid) {
  let all = rows, pager = '';
  if (sid) {
    const s = srtS[sid];
    if (s && cols[s.c] && cols[s.c][3]) { const f = cols[s.c][3]; all = [...rows].sort((a, b) => { const x = f(a), y = f(b); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR')) * s.d; }); }
    const n = all.length, pgs = Math.max(1, Math.ceil(n / PG)), pa = pgS[sid] = Math.min(Math.max(1, pgS[sid] || 1), pgs);
    all = all.slice((pa - 1) * PG, pa * PG);
    if (n > PG) pager = `<div class="pager"><span>${n} registros · página ${pa} de ${pgs}</span><span><button type="button" class="ghost" data-act="pg" data-t="${sid}" data-n="${pa - 1}"${pa <= 1 ? ' disabled' : ''}>‹ Anterior</button><button type="button" class="ghost" data-act="pg" data-t="${sid}" data-n="${pa + 1}"${pa >= pgs ? ' disabled' : ''}>Próxima ›</button></span></div>`;
  }
  const head = cols.map((c, i) => { const so = sid && c[3], s = srtS[sid], ar = so && s && s.c === i ? (s.d > 0 ? ' ▲' : ' ▼') : '', cl = [c[2], so ? 'srt' : ''].filter(Boolean).join(' ');
    return `<th${cl ? ` class="${cl}"` : ''}${so ? ` data-act="sort" data-t="${sid}" data-c="${i}" title="Ordenar"` : ''}>${c[0]}${ar}</th>`; }).join('') + (ro ? '' : '<th></th>');
  const body = all.length ? all.map(r => `<tr>${cols.map(c => `<td data-l="${esc(c[0])}"${c[2] ? ` class="${c[2]}"` : ''}>${c[1](r)}</td>`).join('')}${ro ? '' :
    `<td class="act"><button class="ghost" data-act="edit" data-ent="${ent}" data-id="${esc(r.id)}">Editar</button>${ent === 'pedidos' ? extraPed(r) : ent === 'clientes' ? extraCli(r) : ent === 'estoque' ? extraEst(r) : ''}</td>`}</tr>`).join('')
    : `<tr><td class="vazio" colspan="${cols.length + (ro ? 0 : 1)}">Nada por aqui ainda.</td></tr>`;
  return `<div class="card tw"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>` + pager;
}
const stPed = s => badge(s, corPed(s));
const stPag = s => badge(s || 'Pendente', s === 'Pago' ? 'ok' : s === 'Cancelado' ? 'err' : s === 'Orçamento' ? '' : 'warn');
const selPed = (p, campo, ops, cor) => `<select class="sel ${cor(p[campo] || ops[0])}" data-chg="${campo}" data-id="${esc(p.id)}" aria-label="${campo === 'pago' ? 'Pagamento' : 'Status'} do pedido">${ops.map(o => `<option ${o === (p[campo] || ops[0]) ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
const corPed = s => ({'Entregue':'ok', 'Vendido':'blue', 'Cancelado':'err'})[s] || '';
const corPag = s => s === 'Pago' ? 'ok' : s === 'Cancelado' ? 'err' : s === 'Orçamento' ? '' : 'warn';
const opsPago = st => st === 'Orçamento' ? ['Orçamento', 'Pago'] : st === 'Cancelado' ? ['Cancelado'] : ['Pago', 'Pendente'];
const REEMB = ['Pagamento não ocorreu', 'Devolver ao cliente', 'Já devolvi ao cliente'];
const corReemb = r => r === 'Devolver ao cliente' ? 'warn' : r === 'Já devolvi ao cliente' ? 'ok' : '';
const reembTxt = (p, ro) => p.status !== 'Cancelado' || !p.reemb ? '' : ro ? `<span class="vc${p.reemb === 'Devolver ao cliente' ? ' late' : ''}">${esc(p.reemb)}</span>`
  : `<select class="sel rb ${corReemb(p.reemb)}" data-chg="reemb" data-id="${esc(p.id)}" aria-label="Situação do pagamento do pedido cancelado">${REEMB.map(o => `<option ${o === p.reemb ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
const entTxt = p => { if (!p.prev || !PEND.includes(p.status)) return ''; const atr = p.prev < today(); return `<span class="vc${atr ? ' late' : ''}">${atr ? 'Atrasada · ' : 'Entrega '}${dBR(p.prev).slice(0, 5)}</span>`; };
const sinalTxt = p => ativo(p.status) && p.pago !== 'Pago' && +p.sinal > 0 ? `<span class="vc">Falta ${fmt(faltaP(p))}</span>` : '';
const lucroTxt = p => p.status === 'Cancelado' || !temCusto(p) ? '<span class="mut">—</span>' : (l => `<span class="${l < 0 ? 'neg' : ''}">${fmt(l)}</span>`)(lucroPed(p));
const colsPed = ro => [
  ['Cliente e pedido', p => `<b>${esc(nomeCli(p.cliente))}</b><span class="vc nw">Nº ${nn(p.num)} · ${dBR(p.data)}</span>` + (p.obs ? `<span class="vc">${esc(p.obs)}</span>` : ''), 'clc', p => nomeCli(p.cliente)],
  ['Plaquinhas', p => esc(itensTxt(p)), 'plc'],
  ['Valor', p => `<b>${fmt(p.valor)}</b>` + (+p.desc > 0 ? `<span class="vc">desconto −${fmt(p.desc)}</span>` : '') + (+p.frete > 0 ? `<span class="vc">frete +${fmt(p.frete)}</span>` : ''), 'm', p => +p.valor || 0],
  ['Lucro estimado', lucroTxt, 'm', p => p.status === 'Cancelado' || !temCusto(p) ? -1e12 : lucroPed(p)],
  ['Pagamento', p => (ro || p.status === 'Cancelado' ? stPag(p.pago) : selPed(p, 'pago', opsPago(p.status), corPag)) + reembTxt(p, ro) + (ativo(p.status) && p.pagto ? `<span class="vc">${esc(p.pagto)}</span>` : '') + vencTxt(p) + sinalTxt(p), 'pgc'],
  ['Status', p => (ro ? stPed(p.status) : selPed(p, 'status', STS, corPed)) + entTxt(p), 'stc', p => p.status]
];
const SUBS = {clientes:'As empresas que compram de você. Clique em Ficha para ver o histórico de compras de cada uma.', pedidos:'Cada linha é um pedido. O lucro estimado é o valor do pedido menos o custo das peças e do vinil (veja em Estoque).', estoque:'Os 4 produtos que entram em toda plaquinha. Cada plaquinha vendida usa 1 de cada.'};
const NOVO = {clientes:'+ Novo cliente', pedidos:'+ Novo pedido'};
const ph = (t, s, a) => `<div class="ph"><div><h2>${t}</h2><p>${s}</p></div>${a || ''}</div>`;
/* cartão de número: cor só quando significa algo (laranja = tem valor em aberto) */
const kpi = (ic, k, v, s) => `<div class="card stat"><div class="lb">${k}</div><div class="sn ${/[1-9]/.test(String(v)) ? (ic === 'clock' ? 'warn' : ic === 'check' ? 'ok' : '') : ''}">${v}</div>${s ? `<div class="k">${s}</div>` : ''}</div>`;
const spark = v => {
  if (v.length < 2) return '';
  const w = 150, h = 46, mn = Math.min(...v), rg = (Math.max(...v) - mn) || 1;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${v.map((y, i) => (2 + i / (v.length - 1) * (w - 4)).toFixed(1) + ',' + (h - 4 - (y - mn) / rg * (h - 8)).toFixed(1)).join(' ')}"/></svg>`;
};
/* métrica principal: lucro líquido grande + tendência dos últimos meses */
function heroHtml(c) {
  const mm = c.meses.filter(m => m.k !== 'sem-data'), ls = [];
  if (mm.length) { /* 6 meses seguidos até o mais recente; mês sem movimento conta 0 */
    const [ya, ma] = mm[0].k.split('-').map(Number), mp = {}; mm.forEach(m => mp[m.k] = m.liq);
    const ini = mm[mm.length - 1].k;
    for (let i = 5; i >= 0; i--) { const d = new Date(ya, ma - 1 - i, 1), k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); if (k >= ini) ls.push(mp[k] || 0); }
  }
  return `<div class="card hero acc${c.liquido < 0 ? ' neg' : ''}"><div><div class="lb">Lucro líquido</div><div class="hn ${c.liquido < 0 ? 'neg' : ''}">${fmt(c.liquido)}</div><div class="k">${fmt(c.bruto)} vendido − ${fmt(c.despesa)} de despesas</div></div>${ls.length > 1 ? `<div class="hs">${spark(ls)}<div class="k">líquido por mês (${ls.length} meses)</div></div>` : ''}</div>`;
}
const mini = (k, v, tom, sub, go) => `<button type="button" class="card mini" data-act="gof" ${go || ''}><div class="lb">${k}</div><div class="mn ${tom || ''}">${v}</div><div class="k">${sub || ''}</div><span class="go">Ver pedidos ›</span></button>`;
const head = (t, ent, csv) => ph(t, SUBS[ent], `<div class="btns" style="margin:0">${csv ? `<button type="button" data-act="${csv}">Exportar CSV</button>` : ''}${NOVO[ent] ? `<button class="pri" data-act="add" data-ent="${ent}">${NOVO[ent]}</button>` : ''}</div>`);
const sec = (t, ajuda, btn) => `<div class="sec"><div><h3>${t}</h3>${ajuda ? `<p>${ajuda}</p>` : ''}</div>${btn || ''}</div>`;

/* ---------- Telas ---------- */
function prodCard() {
  const cp = capac(), baixos = db.estoque.filter(e => (+e.qtd || 0) <= (+e.min || 0)).length;
  return `<div class="card acc" style="margin-bottom:14px${cp.n === 0 ? ';border-left-color:var(--err)' : ''}"><div class="top"><span class="lb">Estoque</span><button type="button" class="lnk" data-go="estoque">Ver estoque ›</button></div>
  <div class="stats"><div><span class="k">Dá para fazer agora</span><b>${cp.n} plaquinha(s)</b></div><div><span class="k">${cp.n === 0 ? 'O que está faltando' : 'O que limita'}</span><b>${esc(cp.lim || '—')}</b></div><div><span class="k">Produtos para repor</span><b>${baixos}</b></div></div></div>`;
}
function vDash() {
  const c = calc(), ym = today().slice(0, 7);
  const mesVend = sum(c.vend.filter(p => (p.data || '').startsWith(ym)), p => +p.valor);
  const mG = +db.metas.geral || 0, mM = +db.metas.mensal[ym] || 0;
  const meta = (tit, atual, alvo, id, dica) => { const bate = alvo > 0 && atual >= alvo; return `<div class="card acc${bate ? ' ok' : ''}"><div class="top"><span class="lb">${tit}</span>
    <label class="inl">Meta R$ <input id="${id}" type="number" min="0" step="0.01" value="${alvo || ''}" placeholder="${dica || ''}"></label></div>
    <div class="big">${fmt(atual)} <small>${alvo ? 'de ' + fmt(alvo) + ' (' + Math.min(100, Math.round(atual / alvo * 100)) + '%)' : 'defina uma meta'}</small></div>
    <div class="bar"><i class="${bate ? 'ok' : ''}" style="width:${alvo ? Math.min(100, atual / alvo * 100) : 0}%"></i></div></div>`; };
  const orcs = db.pedidos.filter(p => p.status === 'Orçamento').length, aEnt = db.pedidos.filter(p => PEND.includes(p.status)).length;
  const emAnd = db.pedidos.filter(p => p.status === 'Orçamento' || PEND.includes(p.status));
  const rec = db.pedidos.filter(p => ativo(p.status) && faltaP(p) > 0), recV = r2(sum(rec, faltaP));
  const ent = db.pedidos.filter(p => p.status === 'Entregue').length, canc = db.pedidos.filter(p => p.status === 'Cancelado').length, dev = db.pedidos.filter(p => p.status === 'Cancelado' && p.reemb === 'Devolver ao cliente').length;
  const por = {};
  c.vend.forEach(p => por[p.cliente] = (por[p.cliente] || 0) + (+p.valor || 0));
  const top = Object.entries(por).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const baixo = db.estoque.filter(e => (+e.qtd || 0) <= (+e.min || 0));
  /* meta mensal: cada mês tem a sua (chave AAAA-MM), então o mês novo começa zerado e sem meta */
  const ymL = ym.split('-').reverse().join('/');
  const kAnt = Object.keys(db.metas.mensal).filter(k => k < ym && +db.metas.mensal[k] > 0).sort().pop();
  const dica = kAnt ? 'ant. ' + db.metas.mensal[kAnt] : '';
  return `${ph('Dashboard', 'Veja o que precisa da sua atenção: o que entregar, o que receber, o estoque e as metas.')}
  ${avisoBackup()}
  ${heroHtml(c)}
  <div class="minis">${mini('Orçamentos', orcs, orcs ? 'warn' : '', 'esperando o cliente aprovar', 'data-st="Orçamento"')}${mini('A entregar', aEnt, aEnt ? 'warn' : '', 'vendidos, ainda não entregues', 'data-esp="ent"')}${mini('A receber', fmt(recV), rec.length ? 'warn' : '', rec.length + ' pedido(s) com pagamento pendente', 'data-esp="rec"')}${mini('Entregues', ent, '', 'pedidos concluídos', 'data-st="Entregue"')}${mini('Cancelados', canc, canc ? 'err' : '', 'pedidos cancelados' + (dev ? ' · ' + dev + ' a devolver' : ''), 'data-st="Cancelado"')}</div>
  ${prodCard()}
  <div class="grid two">${meta('Meta geral (total vendido)', c.bruto, mG, 'metaG')}${meta(`<button type="button" class="lnk" data-act="hmeta">Meta do mês (${ymL}) ›</button>`, mesVend, mM, 'metaM', dica)}</div>
  <div class="grid two">
    <div class="card list andam"><h3>Pedidos em andamento</h3><p class="k" style="margin:-4px 0 8px">Orçamentos e vendas ainda não entregues.</p>${emAnd.length ? `<div class="arow ah"><span>Cliente</span><span>Valor</span><span>Situação</span></div>` + emAnd.slice(0, 8).map(p => `<div class="arow"><span><b>${esc(nomeCli(p.cliente))}</b><small>${dBR(p.data).slice(0, 5)}${p.prev && PEND.includes(p.status) ? ' · ' + (p.prev < today() ? 'atrasada' : 'entrega ' + dBR(p.prev).slice(0, 5)) : ''}</small></span><b class="m">${fmt(p.valor)}</b><span class="bg">${stPed(p.status)}${p.status !== 'Orçamento' ? (faltaP(p) <= 0 ? badge('Pago', 'ok') : badge('Falta ' + fmt(faltaP(p)), 'warn')) : ''}</span></div>`).join('') + (emAnd.length > 8 ? `<div class="arow"><button type="button" class="lnk" data-act="gof" data-st="">Ver todos os pedidos (${emAnd.length} em andamento) ›</button></div>` : '') : '<span class="mut">Nenhum pedido em andamento.</span>'}</div>
    <div class="card list"><h3>Clientes que mais compraram</h3>${top.length ? top.map(([id, v]) => `<div><span>${esc(nomeCli(id))}</span><b class="m">${fmt(v)}</b></div>`).join('') : '<span class="mut">Sem vendas ainda.</span>'}</div>
    <div class="card list"><h3>Estoque para repor</h3>${baixo.length ? baixo.map(e => `<div><span>${esc(e.nome)} (${esc(e.qtd || 0)})</span>${linkOk(e.link) ? `<a href="${esc(e.link)}" target="_blank" rel="noopener">Comprar</a>` : ''}</div>`).join('') : '<span class="mut">Tudo em dia.</span>'}</div>
  </div>
  <div class="card" style="margin-top:14px">
    <div class="top" style="flex-wrap:wrap"><div><h3 style="margin:0">Vendas por mês</h3><span class="k">Últimos 6 meses, sem orçamentos</span></div>
    <div class="seg"><button class="${chartMode === 'linha' ? 'on' : ''}" data-act="chart" data-mode="linha">Linha</button><button class="${chartMode === 'colunas' ? 'on' : ''}" data-act="chart" data-mode="colunas">Colunas</button></div></div>
    <div id="chart"></div>
  </div>`;
}

/* busca e filtros (a lista é redesenhada sem perder o foco do campo) */
let flt = {q:'', mes:'', st:'', pg:'', esp:''}, cq = '', fh = {q:'', mes:'', st:''};
const norm1 = x => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const porData = (a, b) => (b.data || '').localeCompare(a.data || '');
const ESP = {rec:'a receber (vendidos ou entregues com pagamento pendente)', ent:'a entregar (vendidos, ainda não entregues)'};
const espOk = (p, e) => e === 'rec' ? ativo(p.status) && faltaP(p) > 0 : e === 'ent' ? PEND.includes(p.status) : true;
function cliStats(id) {
  const ps = db.pedidos.filter(p => p.cliente === id), v = ps.filter(p => ativo(p.status)), cv = v.filter(temCusto);
  const total = r2(sum(v, p => +p.valor));
  return {n: ps.length, total, ticket: v.length ? r2(total / v.length) : 0, ultima: v.reduce((m, p) => (p.data || '') > m ? p.data : m, ''), falta: r2(sum(v, faltaP)), lucro: r2(sum(cv, lucroPed)), temLucro: cv.length > 0};
}
const cliFilt = () => { const q = norm1(cq); return db.clientes.filter(c => !q || norm1([c.empresa, c.contato, c.email, c.tel, c.segmento, c.cidade].join(' ')).includes(q)); };
const tabCli = () => tabela('clientes', [
    ['Empresa', c => { const l = [c.segmento, c.cidade].filter(Boolean).map(esc).join(' · '); return `<b>${esc(c.empresa)}</b>` + (l ? `<span class="vc">${l}</span>` : ''); }, '', c => norm1(c.empresa)],
    ['Contato', c => (c.contato ? esc(c.contato) : '<span class="mut">—</span>') + (c.tel ? `<span class="vc">${telCell(c.tel)}</span>` : '')],
    ['Pedidos', c => cliStats(c.id).n, 'm', c => cliStats(c.id).n],
    ['Total comprado', c => fmt(cliStats(c.id).total), 'm', c => cliStats(c.id).total],
    ['Avaliação Google', c => linkOk(c.link) ? `<a href="${esc(c.link)}" target="_blank" rel="noopener">Abrir link</a>` : '<span class="mut">—</span>']
  ], cliFilt(), false, 'clientes');
const pedFilt = () => { const q = norm1(flt.q); return db.pedidos
  .filter(p => (!flt.mes || (p.data || '').startsWith(flt.mes)) && (!flt.st || p.status === flt.st) && (!flt.pg || (p.pago || 'Pendente') === flt.pg) && espOk(p, flt.esp) && (!q || norm1(nomeCli(p.cliente) + ' ' + (p.obs || '')).includes(q)))
  .sort(porData); };
const tabPed = () => tabela('pedidos', colsPed(false), pedFilt(), false, 'pedidos');
const extraCli = r => `<button class="ghost" data-act="ficha" data-id="${esc(r.id)}" title="Ficha do cliente" aria-label="Ficha do cliente"><span class="ic">${ico(IC.clientes)}</span><span>Ficha</span></button>`;
function vClientes() {
  return head('Clientes', 'clientes', 'csvcli') + `<div class="fb"><input type="search" data-f="cq" placeholder="Buscar por empresa, segmento, cidade ou contato" value="${esc(cq)}" aria-label="Buscar cliente"></div><div id="lista">${tabCli()}</div>`;
}
function abrirFicha(id) {
  const c = db.clientes.find(x => x.id === id); if (!c) return;
  const st = cliStats(id), lk = (u, t) => linkOk(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>` : '';
  const ig = c.ig ? `<a href="https://www.instagram.com/${esc(c.ig)}" target="_blank" rel="noopener">@${esc(c.ig)}</a>` : '';
  const li = (k, v) => v ? `<div><span>${k}</span><span>${v}</span></div>` : '';
  const sb = (k, v) => `<div><span class="k">${k}</span><b>${v}</b></div>`;
  const peds = db.pedidos.filter(p => p.cliente === id).sort(porData).slice(0, 10);
  $('#ficha').innerHTML = `<h3>${esc(c.empresa)}</h3><p class="k">${[c.segmento, c.cidade].filter(Boolean).map(esc).join(' · ') || 'Segmento não informado'}</p>
  <div class="stats">${sb('Pedidos', st.n)}${sb('Total comprado', fmt(st.total))}${sb('Ticket médio', st.ticket ? fmt(st.ticket) : '—')}${sb('Última compra', st.ultima ? dBR(st.ultima) : '—')}${sb('A receber', fmt(st.falta))}${sb('Lucro estimado', st.temLucro ? fmt(st.lucro) : '—')}</div>
  <div class="card list" style="margin-bottom:14px">${li('Endereço comercial', esc(c.endereco))}${li('WhatsApp', telCell(c.tel))}${li('Contato', esc(c.contato))}${li('E-mail', esc(c.email))}${li('Site', lk(c.site, c.site))}${li('Instagram', ig)}${li('Avaliação Google', lk(c.link, 'Abrir link'))}${li('Como conheceu', c.origem && c.origem !== 'Não informado' ? esc(c.origem) : '')}</div>
  <h3>Últimos pedidos</h3>` + tabela('x', [['Data', p => dBR(p.data)], ['Itens', p => esc(itensTxt(p))], ['Valor', p => fmt(p.valor), 'm'], ['Status', p => stPed(p.status)]], peds, true) +
  `<div class="row" style="margin-top:14px"><button type="button" data-act="fechad" data-d="ficha">Fechar</button><button type="button" data-act="fichaedit" data-id="${esc(id)}">Editar</button><button type="button" class="pri" data-act="fichanovo" data-id="${esc(id)}">Novo pedido</button></div>`;
  $('#ficha').showModal();
}

function vPedidos() {
  const ms = [...new Set(db.pedidos.map(p => (p.data || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  if (flt.mes && !ms.includes(flt.mes)) flt.mes = '';
  const op = (v, l, cur) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`;
  return head('Pedidos', 'pedidos', 'csvped') + (flt.esp ? `<div class="note"><span>Mostrando só os pedidos <b>${ESP[flt.esp]}</b>.</span><span class="nb"><button type="button" class="ghost" data-act="limpaab">Mostrar todos</button></span></div>` : '') + `<div class="fb"><input type="search" data-f="q" placeholder="Buscar por cliente ou observação" value="${esc(flt.q)}" aria-label="Buscar pedidos">
    <select data-f="mes" aria-label="Filtrar por mês">${op('', 'Todos os meses', flt.mes)}${ms.map(m => op(m, m.split('-').reverse().join('/'), flt.mes)).join('')}</select>
    <select data-f="st" aria-label="Filtrar por status">${op('', 'Todos os status', flt.st)}${STS.map(o => op(o, o, flt.st)).join('')}</select>
    <select data-f="pg" aria-label="Filtrar por pagamento">${op('', 'Todos os pagamentos', flt.pg)}${op('Orçamento', 'Orçamento', flt.pg)}${op('Pendente', 'Pendente', flt.pg)}${op('Pago', 'Pago', flt.pg)}${op('Cancelado', 'Cancelado', flt.pg)}</select></div><div id="lista">${tabPed()}</div>`;
}

/* exportar CSV (respeita a busca e os filtros da tela) */
function csvDe(nome, linhas) {
  const q = v => { v = String(v ?? ''); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  salvarArquivo('﻿' + linhas.map(r => r.map(q).join(';')).join('\r\n'), nome + '-' + today() + '.csv', 'text/csv;charset=utf-8');
  toast('CSV baixado');
}
const nBR = v => (+v || 0).toFixed(2).replace('.', ',');
function csvPedidos() {
  csvDe('pedidos', [['Nº', 'Data', 'Cliente', 'Itens', 'Subtotal', 'Desconto', 'Frete', 'Total', 'Recebido', 'Falta receber', 'Forma de pagamento', 'Pagamento', 'Status', 'Previsão de entrega', 'Plaquinhas', 'Lucro estimado']]
    .concat(pedFilt().map(p => [nn(p.num), dBR(p.data), nomeCli(p.cliente), itensTxt(p), nBR(p.sub || p.valor), nBR(p.desc), nBR(p.frete), nBR(p.valor), nBR(recP(p)), nBR(faltaP(p)), p.pagto || '', (p.pago || 'Pendente') + (p.reemb && p.status === 'Cancelado' ? ' - ' + p.reemb : ''), p.status, dBR(p.prev), +p.qtd || 0, p.status !== 'Cancelado' && temCusto(p) ? nBR(lucroPed(p)) : ''])));
}
function csvClientes() {
  csvDe('clientes', [['Empresa', 'Segmento', 'Cidade', 'Endereço comercial', 'Contato', 'WhatsApp', 'E-mail', 'Site', 'Instagram', 'Como conheceu', 'Pedidos', 'Total comprado']]
    .concat(cliFilt().map(c => { const st = cliStats(c.id); return [c.empresa, c.segmento, c.cidade, c.endereco, c.contato, c.tel, c.email, c.site, c.ig ? '@' + c.ig : '', c.origem, st.n, nBR(st.total)]; })));
}

const stc = (k, v, s, tom) => `<div class="card mini"><div class="lb">${k}</div><div class="mn ${tom || ''}">${v}</div><div class="k">${s || ''}</div></div>`;
const estCols = () => [
  ['Produto', e => `<b>${esc(e.nome)}</b>${e.tipo === 'Kit' ? `<span class="vc">vem em kit com ${esc(e.upk)} un.</span>` : ''}`],
  ['Em estoque', e => `<b>${+e.qtd || 0}</b> un.<span class="vc">avisar em: ${+e.min || 0}</span>`, 'm', e => +e.qtd || 0],
  ['Custo por unidade', e => custoUn(e) > 0 ? fmt(custoUn(e)) : badge('Sem custo', 'warn') + '<span class="vc">registre uma compra</span>', 'm'],
  ['Situação', e => (+e.qtd || 0) <= (+e.min || 0) ? badge('Repor', 'warn') + (linkOk(e.link) ? `<a class="vc" href="${esc(e.link)}" target="_blank" rel="noopener">Comprar ›</a>` : '') : badge('OK', 'ok')]
];
function vEstoque() {
  const cp = capac(), cu = custoUnPlaq(), vu = vinilUn(), lista = [...pecas(), ...db.estoque.filter(e => !e.base)];
  return ph('Estoque', SUBS.estoque)
    + `<div class="minis">` + stc('Dá para fazer agora', cp.n + ' plaquinha(s)', cp.n === 0 ? 'falta: ' + esc(cp.lim) : 'o que limita: ' + esc(cp.lim), cp.n === 0 ? 'err' : '')
    + stc('Custo por plaquinha', fmt(cu + vu), 'peças ' + fmt(cu) + ' + vinil ' + fmt(vu)) + `</div>`
    + sec('Produtos', 'Para repor, clique em Registrar compra: a quantidade sobe e a compra vira despesa.')
    + tabela('estoque', estCols(), lista, false)
    + `<div class="card" style="margin-top:14px"><h3>Vinil (não é estoque)</h3><p class="k">É um custo fixo por plaquinha: o valor da impressão do vinil. Ele entra no lucro de cada plaquinha vendida.</p>
    <label>Custo do vinil por plaquinha (R$)<input id="cfVin" type="number" min="0" step="0.01" value="${vu || ''}" placeholder="Ex.: 2,50"></label>
    <div class="btns" style="margin:0"><button type="button" class="pri" data-act="vinilsave">Salvar vinil</button></div></div>`
    + `<p class="hint" style="margin-top:14px"><b>Como funciona:</b> quando um pedido vira <b>Vendido</b>, o sistema tira 1 de cada produto (tag, display, embalagem e cartão) por plaquinha. Se o pedido for cancelado ou voltar para orçamento, tudo volta para o estoque. A tag NFC vem em kit: ajuste em Editar quantas vêm em cada kit.</p>`;
}

let finF = {de:'', ate:''};
const inPer = d => (!finF.de || (d || '') >= finF.de) && (!finF.ate || (d || '') <= finF.ate);
function periodo(p) {
  const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10), n = new Date();
  if (p === 'tudo') finF = {de:'', ate:''};
  else { const a = p === 'mes' ? 0 : 1; finF = {de: iso(new Date(n.getFullYear(), n.getMonth() - a, 1)), ate: iso(new Date(n.getFullYear(), n.getMonth() - a + 1, 0))}; }
  render();
}
function vFin() {
  const c = calc(finF);
  const mesNome = k => k === 'sem-data' ? 'Sem data' : (([a, m]) => m + '/' + a)(k.split('-'));
  const linhas = c.meses.map(m => ({...m, nome: mesNome(m.k)}));
  if (linhas.length) linhas.push({nome:'Total', bruto:c.bruto, comp:c.compras, desp:c.outras, vin:c.vinil, rec:c.recebido, liq:c.liquido, tot:true});
  const cps = db.compras.filter(k => inPer(k.data)), lanc = db.financeiro.filter(f => inPer(f.data));
  const grp = {};
  cps.forEach(k => { const n = (db.estoque.find(e => e.id === k.item) || {}).nome || 'Item removido'; grp[n] = (grp[n] || 0) + totCompra(k); });
  lanc.filter(f => f.tipo === 'Despesa').forEach(f => { const n = f.desc || 'Outras despesas'; grp[n] = (grp[n] || 0) + (+f.valor || 0); });
  if (c.vinil > 0) grp['Vinil'] = c.vinil;
  const gs = Object.entries(grp).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8), mx = gs.length ? gs[0][1] : 1;
  const per = finF.de || finF.ate ? `Período: ${finF.de ? dBR(finF.de) : 'início'} a ${finF.ate ? dBR(finF.ate) : 'hoje'}.` : 'Período: todo o histórico.';
  return `${ph('Financeiro', 'Tudo é calculado a partir dos seus pedidos, do estoque e dos lançamentos.')}
  <div class="fp"><label>De<input type="date" id="fde" value="${esc(finF.de)}"></label><label>Até<input type="date" id="fate" value="${esc(finF.ate)}"></label>
    <button type="button" data-act="fper" data-p="mes">Este mês</button><button type="button" data-act="fper" data-p="ant">Mês passado</button><button type="button" data-act="fper" data-p="tudo">Tudo</button></div>
  ${heroHtml(c)}
  <div class="grid">${kpi('fin', 'Valor bruto', fmt(c.bruto), 'vendas (sem orçamentos), com frete e já com desconto')}
  ${kpi('down', 'Despesa total', fmt(c.despesa), 'estoque ' + fmt(c.compras) + ' + vinil ' + fmt(c.vinil) + ' + lançamentos ' + fmt(c.outras))}
  ${kpi('check', 'Valor recebido', fmt(c.recebido), 'pedidos pagos + entradas recebidas')}${kpi('clock', 'A receber', fmt(c.aReceber), 'bruto − recebido')}${kpi('wallet', 'Capital investido', fmt(c.capital), 'não entra no líquido')}${kpi('clock', 'A pagar', fmt(c.aPagar), 'compras de estoque em aberto')}
  ${kpi('up', 'Lucro dos pedidos', c.margem === null ? '—' : fmt(c.lucroP), 'estimado: vendido − peças e vinil')}</div>
  <p class="fm">${per} <b>Líquido</b> = vendido − despesas (compras de estoque + vinil das plaquinhas vendidas + lançamentos do tipo Despesa). A compra vira despesa assim que é registrada, mesmo a pagar. Orçamentos, Capital e Outro não entram. O <b>lucro dos pedidos</b> considera só o custo das peças e do vinil de cada plaquinha vendida (não o que você ainda tem parado em estoque), por isso é diferente do líquido.</p>
  ${sec('Resumo por mês', 'Quanto você vendeu, gastou e lucrou em cada mês do período escolhido.', '<div class="btns" style="margin:0"><button type="button" data-act="csv">Exportar CSV</button><button type="button" data-act="print">Imprimir</button></div>')}` +
  tabela('x', [['Mês', m => m.tot ? 'Total' : m.nome], ['Bruto', m => fmt(m.bruto), 'm'], ['Compras de estoque', m => fmt(m.comp), 'm'], ['Vinil', m => fmt(m.vin), 'm'], ['Outras despesas', m => fmt(m.desp), 'm'], ['Líquido', m => money(m.liq), 'm'], ['Recebido', m => fmt(m.rec), 'm']], linhas, true)
    .replace(/<tr>(<td data-l="Mês">Total<\/td>)/, '<tr class="tot">$1') +
  (gs.length ? sec('Despesas por categoria', 'Onde o dinheiro foi, do maior gasto para o menor.') + `<div class="card">${gs.map(([n, v]) => `<div class="dbar"><span>${esc(n)}</span><div class="bar"><i style="width:${Math.max(3, v / mx * 100)}%"></i></div><b class="m">${fmt(v)}</b></div>`).join('')}</div>` : '') +
  sec('Compras de estoque', 'Tudo o que você comprou para o estoque. Cada compra vira despesa na hora em que é registrada.', '<button class="pri" data-act="add" data-ent="compras">+ Nova compra</button>') +
  tabela('compras', [['Data', k => dBR(k.data)], ['Item', k => esc((db.estoque.find(e => e.id === k.item) || {}).nome || '—')],
    ['Quantidade', k => { const it = db.estoque.find(e => e.id === k.item); return esc(k.qtd) + (it && it.tipo === 'Kit' ? ' kit(s)' : ' un.'); }],
    ['Valor cada', k => fmt(k.valor), 'm'], ['Total', k => fmt(totCompra(k)), 'm'],
    ['Pagamento', k => `<select class="sel ${k.pago === 'Pago' ? 'ok' : 'warn'}" data-chgc="1" data-id="${esc(k.id)}" aria-label="Pagamento da compra">${['A pagar', 'Pago'].map(o => `<option ${o === (k.pago || 'A pagar') ? 'selected' : ''}>${o}</option>`).join('')}</select>`]],
    [...cps].sort((a, b) => (b.data || '').localeCompare(a.data || ''))) +
  sec('Lançamentos', 'Outras entradas e saídas: despesas (entram no líquido), capital investido e outros.', '<button class="pri" data-act="add" data-ent="financeiro">+ Novo lançamento</button>') +
  tabela('financeiro', [['Data', f => dBR(f.data)], ['Tipo', f => badge(f.tipo, f.tipo === 'Despesa' ? 'err' : f.tipo === 'Capital' ? 'blue' : '')], ['Descrição', f => esc(f.desc)], ['Valor', f => fmt(f.valor), 'm']],
    [...lanc].sort((a, b) => (b.data || '').localeCompare(a.data || '')));
}

const histRows = () => { const q = norm1(fh.q); return db.pedidos.filter(p => (!fh.mes || (p.data || '').startsWith(fh.mes)) && (!fh.st || p.status === fh.st) && (!q || norm1(nomeCli(p.cliente) + ' ' + (p.obs || '')).includes(q))).sort(porData); };
const tabHist = () => tabela('pedidos', colsPed(true), histRows(), true, 'hist');
function vHist() {
  const ms = [...new Set(db.pedidos.map(p => (p.data || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  if (fh.mes && !ms.includes(fh.mes)) fh.mes = '';
  const op = (v, l, cur) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`;
  return ph('Histórico', 'Todos os pedidos registrados, do mais recente ao mais antigo. Clique no título de uma coluna para ordenar.') + `<div class="fb"><input type="search" data-fh="q" placeholder="Buscar por cliente ou observação" value="${esc(fh.q)}" aria-label="Buscar no histórico">
    <select data-fh="mes" aria-label="Filtrar por mês">${op('', 'Todos os meses', fh.mes)}${ms.map(m => op(m, m.split('-').reverse().join('/'), fh.mes)).join('')}</select>
    <select data-fh="st" aria-label="Filtrar por status">${op('', 'Todos os status', fh.st)}${STS.map(o => op(o, o, fh.st)).join('')}</select></div><div id="lista">${tabHist()}</div>`;
}

function vBackup() {
  return `${ph('Backup', 'Salve ou restaure os seus dados.')}
  <div class="card"><p class="mut">Os dados ficam só neste navegador. Exporte o backup com frequência: a cada exportação você escolhe uma senha e o arquivo sai criptografado, então só abre com ela. O sistema não guarda a senha. Se você esquecer, ninguém recupera o arquivo.</p>
  <div class="btns">
    <button class="pri" data-act="export">Exportar backup (com senha)</button>
    <button data-act="import" data-modo="sobrepor">Importar e sobrepor</button>
    <button data-act="import" data-modo="mesclar">Importar e mesclar</button>
    <button class="dng" data-act="clear">Apagar tudo</button>
    <button data-act="sair">Sair da conta</button>
  </div>
  <p class="k"><b>Sobrepor</b> apaga os dados atuais e usa o arquivo. <b>Mesclar</b> só soma o que ainda não existe. Ao importar, o sistema pede a senha do arquivo; depois de 3 erros, bloqueia por 1 minuto.</p></div>`;
}

const ico = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const IC = {
  dash: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  clientes: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  pedidos: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 12h6M9 16h6"/>',
  estoque: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3.3 7L12 12l8.7-5"/><path d="M12 22V12"/>',
  fin: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5"/><path d="M12 6v2M12 16v2"/>',
  hist: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  backup: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  nfc: '<path d="M6 8.5a6.5 6.5 0 0 1 0 7"/><path d="M10 6a10.5 10.5 0 0 1 0 12"/><path d="M14 3.5a14.5 14.5 0 0 1 0 17"/>'
};
Object.assign(IC, {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  dup: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  close: '<path d="M11 17l-5-5 5-5"/><path d="M18 17l-5-5 5-5"/>',
  open: '<path d="M13 17l5-5-5-5"/><path d="M6 17l5-5-5-5"/>',
  up: '<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  down: '<path d="M22 17l-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
  check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  wallet: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>'
});
Object.assign(IC, {
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  cfg: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  receipt: '<path d="M4 2v20l3-2 2.5 2L12 20l2.5 2L17 20l3 2V2l-3 2-2.5-2L12 4 9.5 2 7 4z"/><path d="M8 9h8M8 13h8"/>',
  xc: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>'
});
IC.prod = '<path d="M3 21h18"/><path d="M5 21V10l5 3v-3l5 3V6h4v15"/>';
let navMin = false;
try { navMin = localStorage.getItem('nfc-nav') === '1'; } catch (e) {}
const VIEWS = {dash:['Dashboard', vDash, 'Início'], clientes:['Clientes', vClientes, 'Clientes'], pedidos:['Pedidos', vPedidos, 'Pedidos'],
  estoque:['Estoque', vEstoque, 'Estoque'], fin:['Financeiro', vFin, 'Caixa'], hist:['Histórico', vHist, 'Histórico'], cfg:['Configurações', vCfg, 'Config.'], backup:['Backup', vBackup, 'Backup']};
let cur = 'dash';

let chartMode = 'linha';
try { chartMode = localStorage.getItem('nfc-chart') || 'linha'; } catch (e) {}
function drawChart() {
  const el = $('#chart'); if (!el) return;
  const vend = calc().vend, now = new Date(), meses = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const l = d.toLocaleDateString('pt-BR', {month: 'short'}).replace('.', '');
    const full = d.toLocaleDateString('pt-BR', {month: 'long', year: 'numeric'});
    meses.push({k: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), l: l.charAt(0).toUpperCase() + l.slice(1), full: full.charAt(0).toUpperCase() + full.slice(1)});
  }
  const dm = meses.map(m => vend.filter(p => (p.data || '').startsWith(m.k)));
  const vals = dm.map(a => r2(sum(a, p => +p.valor)));
  if (!vals.some(v => v > 0)) { el.innerHTML = '<div class="vazio">Sem vendas nos últimos 6 meses ainda.</div>'; return; }
  const W = Math.max(280, el.clientWidth), H = 260, pd = {l: 46, r: 12, t: 14, b: 30};
  const raw = Math.max(...vals) / 4, pow = 10 ** Math.floor(Math.log10(raw)), f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow, top = step * 4;
  const iw = W - pd.l - pd.r, ih = H - pd.t - pd.b, slot = iw / 6;
  const X = i => pd.l + slot * (i + .5), Y = v => pd.t + ih * (1 - v / top);
  const kfmt = v => v >= 1000 ? (v / 1000).toLocaleString('pt-BR', {maximumFractionDigits: 1}) + 'k' : String(Math.round(v));
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Vendas por mês">`;
  for (let g = 0; g <= 4; g++) {
    const y = Y(step * g);
    s += `<line class="cg" x1="${pd.l}" x2="${W - pd.r}" y1="${y}" y2="${y}"/><text class="ct" x="${pd.l - 8}" y="${y + 4}" text-anchor="end">${kfmt(step * g)}</text>`;
  }
  meses.forEach((m, i) => s += `<text class="ct" x="${X(i)}" y="${H - 9}" text-anchor="middle">${m.l}</text>`);
  if (chartMode === 'colunas') {
    const bw = Math.min(46, slot * .55);
    vals.forEach((v, i) => s += `<rect class="cb" data-i="${i}" x="${X(i) - bw / 2}" y="${Y(v)}" width="${bw}" height="${ih * v / top}" rx="5"></rect>`);
  } else {
    const pts = vals.map((v, i) => `${X(i)},${Y(v)}`);
    s += `<path class="ca" d="M${X(0)},${Y(0)} L${pts.join(' L')} L${X(5)},${Y(0)}Z"/><polyline class="cl" points="${pts.join(' ')}"/>`;
    vals.forEach((v, i) => s += `<circle class="cd" data-i="${i}" cx="${X(i)}" cy="${Y(v)}" r="4.5"/>`);
  }
  s += `<line id="gl" class="cg" y1="${pd.t}" y2="${H - pd.b}" stroke-dasharray="4 4" style="display:none"/>`;
  meses.forEach((m, i) => s += `<rect class="hit" data-i="${i}" x="${pd.l + slot * i}" y="${pd.t}" width="${slot}" height="${ih}"/>`);
  el.innerHTML = s + '</svg><div class="tip" id="tip"></div>';
  const tip = $('#tip'), gl = $('#gl');
  const fora = () => { tip.style.display = 'none'; gl.style.display = 'none'; el.querySelectorAll('.hv').forEach(n => n.classList.remove('hv')); };
  const dentro = (ev) => {
    const h = ev.target.closest('.hit'); if (!h) return fora();
    const i = +h.dataset.i, n = dm[i].length, v = vals[i];
    el.querySelectorAll('.hv').forEach(n => n.classList.remove('hv'));
    el.querySelectorAll(`[data-i="${i}"].cd,[data-i="${i}"].cb`).forEach(n => n.classList.add('hv'));
    gl.setAttribute('x1', X(i)); gl.setAttribute('x2', X(i)); gl.style.display = '';
    tip.innerHTML = `<b>${meses[i].full}</b><span>Vendido:</span> ${fmt(v)}<br><span>Pedidos:</span> ${n}<br><span>Ticket médio:</span> ${n ? fmt(v / n) : '—'}`;
    tip.style.display = 'block';
    const b = el.getBoundingClientRect();
    let x = ev.clientX - b.left + 14, y = ev.clientY - b.top - tip.offsetHeight - 10;
    if (x + tip.offsetWidth > b.width) x = ev.clientX - b.left - tip.offsetWidth - 14;
    tip.style.left = Math.max(0, x) + 'px'; tip.style.top = Math.max(0, y) + 'px';
  };
  el.querySelector('svg').addEventListener('mousemove', dentro);
  el.querySelector('svg').addEventListener('click', dentro);
  el.querySelector('svg').addEventListener('mouseleave', fora);
}

/* mini-widget da meta do mês: só existe no Dashboard */
function widgetMeta() {
  const ym = today().slice(0, 7), v = sum(calc().vend.filter(p => (p.data || '').startsWith(ym)), p => +p.valor), m = +db.metas.mensal[ym] || 0;
  const pct = m ? Math.round(v / m * 100) : 0;
  return `<button type="button" id="mw" class="${m && v >= m ? 'ok' : ''}" data-act="hmeta" aria-label="Meta do mês: abrir histórico de metas"><span class="mwt"><span class="mwl">Meta do mês</span><span class="mwv">${fmt(v)} <small>${m ? '(' + pct + '%)' : 'sem meta'}</small></span></span><span class="mwb"><i style="width:${Math.min(100, pct)}%"></i></span></button>`;
}
function render(anim) {
  document.body.classList.toggle('min', navMin);
  $('#burger').innerHTML = ico(IC.menu);
  $('#tbt').textContent = VIEWS[cur][0];
  const it = (k, v) => `<button class="${k === cur ? 'on' : ''}" data-go="${k}" title="${v[0]}" aria-label="${v[0]}"><span class="ic">${ico(IC[k])}</span><span class="lg">${v[0]}</span></button>`;
  $('#nav').innerHTML = `<h1><span class="logo">${ico(IC.nfc)}</span><span class="nm">Gestão NFC</span></h1>` +
    Object.entries(VIEWS).map(([k, v]) => it(k, v)).join('') +
    `<div class="sp"></div><button class="tg" data-act="nav" title="${navMin ? 'Expandir menu' : 'Recolher menu'}" aria-label="Recolher ou expandir menu"><span class="ic">${ico(navMin ? IC.open : IC.close)}</span><span class="lg">Recolher menu</span></button>` +
    `<button class="sair" data-act="sair" title="Sair"><span class="ic">${ico(IC.sair)}</span><span class="lg">Sair</span></button>`;
  const m = $('#main');
  m.innerHTML = VIEWS[cur][1]();
  m.classList.toggle('dash', cur === 'dash');
  $('#mwbox').innerHTML = cur === 'dash' ? widgetMeta() : '';
  if (cur === 'dash') drawChart();
  if (anim) { m.classList.remove('anim'); void m.offsetWidth; m.classList.add('anim'); window.scrollTo(0, 0); }
}

/* ---------- Confirmação própria (confirm() é bloqueado em previews) ---------- */
let cfmRes = null;
function ask(m) { return new Promise(res => { cfmRes = res; $('#cfmq').textContent = m; $('#cfm').showModal(); }); }
$('#cfm').addEventListener('close', () => { if (cfmRes) { cfmRes(false); cfmRes = null; } });

/* ---------- Telefone: (DD) 9XXXX-XXXX ---------- */
function maskTel(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  d = d.slice(0, 11);
  if (!d) return '';
  if (d.length <= 2) return '(' + d;
  const dd = '(' + d.slice(0, 2) + ') ';
  if (d.length <= 6) return dd + d.slice(2);
  if (d.length <= 10) return dd + d.slice(2, 6) + '-' + d.slice(6);
  return dd + d.slice(2, 7) + '-' + d.slice(7);
}
const telCell = t => { const d = String(t || '').replace(/\D/g, ''); if (!d) return '';
  const w = d.length <= 11 ? '55' + d : d;
  return `<a href="https://wa.me/${w}" target="_blank" rel="noopener" title="Abrir no WhatsApp">${esc(maskTel(t))}</a>`; };

/* ---------- Formulário (cadastro / edição) ---------- */
const GRP = {pedidos:{cliente:'Pedido', tipoPl:'Plaquinhas', descTipo:'Valores', pagto:'Pagamento', status:'Andamento'}, clientes:{empresa:'Dados da empresa', contato:'Contato', site:'Na internet'}};
const camposDe = (ent, id) => S[ent].campos;
function abrir(ent, id, pre) {
  if (ent === 'pedidos' && !db.clientes.length) return toast('Cadastre um cliente primeiro');
  if (ent === 'compras' && !db.estoque.length) return toast('Cadastre um item de estoque primeiro');
  const s = S[ent]; let reg = id ? db[ent].find(x => x.id === id) : (pre || {});
  if (ent === 'pedidos') reg = Object.assign({tipoPl:'Padrão', qp:1, qs:0}, reg, id ? plDe(reg) : {});
  const f = $('#form');
  f.innerHTML = `<h3>${id ? 'Editar' : 'Novo'} · ${s.um}</h3>` + (ent === 'clientes' ? '<p class="hint">Cadastre só dados públicos da empresa. Não coloque CPF, endereço de casa nem dados pessoais.</p>' : '') + camposDe(ent, id).map(([k, l, t, req]) => {
    const v = reg[k] ?? (k === 'data' || k === 'cdata' ? today() : '');
    let inp;
    if (t.startsWith('opts:')) {
      const o = t.slice(5).split(',');
      inp = `<select name="${k}">${o.map(x => `<option ${x === (v || o[0]) ? 'selected' : ''}>${x}</option>`).join('')}</select>`;
    } else if (t.startsWith('select:')) {
      const src = t.slice(7), lab = src === 'clientes' ? 'empresa' : 'nome';
      inp = `<select name="${k}" ${req ? 'required' : ''}><option value="">${req ? 'Escolha…' : 'Nenhum'}</option>${db[src].map(o => `<option value="${esc(o.id)}" ${o.id === v ? 'selected' : ''}>${esc(o[lab])}</option>`).join('')}</select>`;
    } else if (t === 'textarea') inp = `<textarea name="${k}" rows="2">${esc(v)}</textarea>`;
    else inp = `<input name="${k}" type="${t}" value="${esc(v)}" ${t === 'number' ? (ent === 'pedidos' && (k === 'qp' || k === 'qs') ? 'step="1" min="0" inputmode="numeric"' : 'step="0.01" min="0"') : ''} ${t === 'tel' ? 'inputmode="numeric" maxlength="16" placeholder="(11) 91234-5678" autocomplete="off"' : ''} ${req ? 'required' : ''}>`;
    return (GRP[ent] && GRP[ent][k] ? `<div class="fg">${GRP[ent][k]}</div>` : '') + `<label>${l}${inp}</label>` + (ent === 'pedidos' && k === 'frete' ? '<div id="ptot" class="ptot"></div>' : '');
  }).join('') + `<div id="ferr" role="alert" style="color:var(--err);font-size:13px;min-height:18px"></div><div class="row">${id ? `${ent === 'estoque' && reg.base ? '<span style="margin-right:auto"></span>' : `<button type="button" class="ghost err" data-act="del" data-ent="${ent}" data-id="${esc(id)}" style="margin-right:auto">Excluir</button>`}${ent === 'pedidos' ? `<button type="button" class="ghost" data-act="dup" data-id="${esc(id)}">Duplicar pedido</button>` : ''}` : ''}<button type="button" class="ghost" data-act="fechar">Cancelar</button><button type="button" class="pri" data-act="salvar">Salvar</button></div>`;
  const tl = f.querySelector('[name=tel]');
  if (tl) { tl.value = maskTel(tl.value); tl.addEventListener('input', () => { tl.value = maskTel(tl.value); }); }
  const tp = f.querySelector('[name=tipo]'), up = f.querySelector('[name=upk]');
  if (tp && up) { const lb = up.closest('label'), sync = () => { lb.style.display = tp.value === 'Kit' ? '' : 'none'; }; tp.addEventListener('change', sync); sync(); }
  if (ent === 'pedidos') iniPedido(f, reg);
  f.dataset.ent = ent; f.dataset.id = id || '';
  $('#dlg').showModal();
}

$('#form').onsubmit = e => { e.preventDefault(); salvarForm(); };
$('#form').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); salvarForm(); } });
function salvarForm() {
  const f = $('#form'), ent = f.dataset.ent, id = f.dataset.id, d = Object.fromEntries(new FormData(f));
  const erro = m => { $('#ferr').textContent = m; };
  for (const k in d) if (typeof d[k] === 'string') d[k] = d[k].trim();
  const cs = camposDe(ent, id);
  const obrig = cs.find(c => c[3] && !d[c[0]]);
  if (obrig) return erro('Preencha: ' + obrig[1]);
  const neg = cs.find(c => c[2] === 'number' && d[c[0]] !== '' && !(+d[c[0]] >= 0));
  if (neg) return erro('Valor inválido em: ' + neg[1]);
  if (d.link && !linkOk(d.link)) return erro('O link deve começar com http:// ou https://');
  if (d.site && !linkOk(d.site)) return erro('O site deve começar com http:// ou https://');
  if (ent === 'clientes' && d.ig !== undefined) { d.ig = igHandle(d.ig); if (d.ig && !igOk(d.ig)) return erro('Instagram inválido. Use @usuario ou o link do perfil.'); }
  if (d.tel !== undefined) {
    d.tel = maskTel(d.tel);
    const dg = d.tel.replace(/\D/g, '');
    if (dg && (dg.length < 10 || +dg.slice(0, 2) < 11)) return erro('WhatsApp inválido. Use o formato (11) 91234-5678.');
  }
  const reg = id ? db[ent].find(x => x.id === id) : null;
  if (ent === 'estoque') {
    if (d.tipo === 'Kit' && !(+d.upk >= 1)) return erro('Informe quantas unidades vêm em cada kit.');
    d.upk = d.tipo === 'Kit' ? +d.upk : 1;
    if (!Number.isInteger(+d.upk) || !Number.isInteger(+d.qtd || 0) || !Number.isInteger(+d.min || 0)) return erro('Estoque, aviso e unidades por kit devem ser números inteiros.');
    Object.assign(reg, d);
  } else if (ent === 'compras') {
    const novo = Object.assign({}, reg || {}, d), it = db.estoque.find(x => x.id === novo.item);
    if (!(+novo.qtd > 0)) return erro('A quantidade comprada deve ser maior que zero.');
    const un = r2(+novo.qtd * mult(it));
    if (!Number.isInteger(un)) return erro('A quantidade em unidades precisa ser um número inteiro (ex.: 0,5 kit de 10 = 5 un.).');
    if (reg) {
      const old = db.estoque.find(x => x.id === reg.item), ru = +reg.unid || 0;
      if ((+old.qtd || 0) - ru + (old === it ? un : 0) < 0) return erro('Parte dessa compra já foi vendida. Não dá para reduzir abaixo do que já foi usado.');
      old.qtd = (+old.qtd || 0) - ru;
    }
    it.qtd = (+it.qtd || 0) + un; novo.unid = un;
    if (reg) Object.assign(reg, novo); else { novo.id = uid(); db.compras.push(novo); add('estoque', 'Compra de estoque registrada', it.nome + ': ' + fmt(totCompra(novo)) + '.', 'fin'); }
  } else if (ent === 'pedidos') {
    const ni = v => Number.isInteger(+v || 0);
    if (!ni(d.qp) || !ni(d.qs)) return erro('A quantidade de plaquinhas deve ser um número inteiro.');
    let qp = +d.qp || 0, qs = +d.qs || 0;
    if (d.tipoPl === 'Padrão') qs = 0; else if (d.tipoPl === 'Personalizada') qp = 0;
    if (d.tipoPl === 'Padrão + Personalizada' && (qp < 1 || qs < 1)) return erro('Informe a quantidade de cada tipo de plaquinha.');
    if (qp + qs < 1) return erro('Informe a quantidade de plaquinhas.');
    Object.assign(d, {qp, qs, pp: +f.dataset.pp, ps: +f.dataset.ps, qtd: qp + qs});
    const sub = r2(qp * d.pp + qs * d.ps), dv = +d.descV || 0;
    if (d.descTipo === 'Porcentagem (%)' && dv > 100) return erro('O desconto em porcentagem não pode passar de 100%.');
    if (d.descTipo === 'Valor (R$)' && dv > sub) return erro('O desconto não pode ser maior que o subtotal do pedido.');
    const dR = descCalc(sub, d.descTipo, dv), fr = r2(+d.frete || 0);
    Object.assign(d, {sub, desc: dR, descV: d.descTipo === 'Sem desconto' ? 0 : dv, frete: fr});
    d.valor = r2(sub - dR + fr);
    if (d.pago !== 'Pendente') d.sinal = 0;
    if ((+d.sinal || 0) > d.valor) return erro('A entrada não pode ser maior que o total do pedido.');
    if (d.pago === 'Pendente' && d.valor > 0 && (+d.sinal || 0) >= d.valor) return erro('A entrada já cobre o total do pedido: marque o pagamento como Pago.');
    d.sinal = r2(+d.sinal || 0);
    avReg = regras(d, reg && reg.status !== d.status ? 'status' : 'pago');
    if (d.status !== 'Cancelado') d.reemb = ''; else if (!d.reemb) d.reemb = reembPadrao(Object.assign({}, reg || {}, d));
    /* baixa automática no estoque: pedidos ativos (não orçamento, não cancelado) consomem o item escolhido */
    const novo = Object.assign({}, reg || {}, d), prev = reg ? {status: reg.status, pago: reg.pago || 'Pendente'} : null;
    const e = checaEstoque(reg, novo); if (e) return erro(e);
    /* mesma quantidade em pedido que já deu baixa: mantém o custo congelado (não reprecifica com preço atual) */
    const manter = !!reg && +reg.cons > 0 && ativo(d.status) && +reg.cons === +d.qtd;
    if (reg && !manter) estornar(reg);
    Object.assign(reg || novo, d);
    if (!reg) { novo.id = uid(); novo.num = proxNum(); db.pedidos.push(novo); }
    if (!manter) baixar(reg || novo);
    if (reg) avisaMudanca(prev, reg);
    else add('pedido', novo.status === 'Orçamento' ? 'Novo orçamento' : 'Novo pedido', 'Nº ' + nn(novo.num) + ': ' + nomeCli(novo.cliente) + ', ' + resumoItens(novo) + ', ' + fmt(novo.valor) + '.', 'pedidos');
  } else if (reg) Object.assign(reg, d);
  else { d.id = uid(); db[ent].push(d);
    if (ent === 'clientes') add('sis', 'Novo cliente', d.empresa + ' foi cadastrado.', 'clientes');
    if (ent === 'financeiro') add('sis', 'Novo lançamento', d.tipo + ': ' + fmt(d.valor) + (d.desc ? ' (' + d.desc + ')' : ''), 'fin'); }
  save(); $('#dlg').close(); render(); toast(avReg || (id ? 'Alterações salvas' : 'Cadastrado com sucesso')); avReg = '';
}
function estornar(p) {
  if (!p.cons) return;
  pecas().forEach(e => { e.qtd = (+e.qtd || 0) + p.cons; });
  p.cons = 0; p.custoMat = 0; p.vinil = 0;
}
function baixar(p) {
  if (!ativo(p.status)) { delete p.semBaixa; return; }
  if (p.semBaixa || !(+p.qtd > 0)) return;
  const q = +p.qtd;
  p.custoMat = r2(q * custoUnPlaq()); p.vinil = r2(q * vinilUn()); p.cons = q;
  pecas().forEach(e => { e.qtd = (+e.qtd || 0) - q; });
}
/* devolve texto de erro se o estoque não comporta o pedido `novo` no lugar de `reg` */
function checaEstoque(reg, novo) {
  if (!ativo(novo.status) || !(+novo.qtd > 0) || (reg && reg.semBaixa)) return '';
  const dev = reg && reg.cons ? reg.cons : 0;
  for (const e of pecas()) { const disp = (+e.qtd || 0) + dev; if (+novo.qtd > disp) return 'Estoque insuficiente de ' + e.nome + ': tem ' + disp + ' un. e o pedido usa ' + novo.qtd + '.'; }
  return '';
}
const descCalc = (sub, tipo, v) => r2(Math.min(sub, tipo === 'Valor (R$)' ? +v || 0 : tipo === 'Porcentagem (%)' ? sub * Math.min(100, +v || 0) / 100 : 0));
/* troca status/pagamento direto na tabela */
/* pagamento e status andam juntos:
   Orçamento -> pagamento "Orçamento"; Vendido/Entregue -> "Pago" (ou "Pendente" se vender fiado); Cancelado -> "Cancelado" */
let avReg = '';
function regras(p, campo) {
  if (campo === 'pago') {
    if (p.pago === 'Cancelado') p.status = 'Cancelado';
    else if (p.pago === 'Orçamento') p.status = 'Orçamento';
    else if (p.status === 'Orçamento' || p.status === 'Cancelado') { p.status = 'Vendido'; return p.pago === 'Pago' ? 'Pagamento recebido: o pedido virou Vendido' : ''; }
  }
  if (p.status === 'Orçamento') { p.pago = 'Orçamento'; p.sinal = 0; }
  else if (p.status === 'Cancelado') p.pago = 'Cancelado';
  else if (p.pago !== 'Pendente') p.pago = 'Pago';
  return '';
}
const reembPadrao = p => p.pago === 'Pago' || +p.sinal > 0 ? 'Devolver ao cliente' : 'Pagamento não ocorreu';
function mudarPedido(id, campo, valor) {
  const reg = db.pedidos.find(x => x.id === id); if (!reg) return;
  if (campo === 'reemb') { reg.reemb = valor; save(); render(); return toast('Pedido cancelado · ' + valor); }
  if (campo === 'status' && valor === 'Cancelado' && reg.status !== 'Cancelado') return abrirCanc(id);
  const novo = Object.assign({}, reg, {[campo]: valor}), av = regras(novo, campo);
  const e = checaEstoque(reg, novo);
  if (e) { render(); return toast(e); }
  const a = {status: reg.status, pago: reg.pago || 'Pendente'}, manter = +reg.cons > 0 && ativo(reg.status) && ativo(novo.status); /* já deu baixa e continua ativo: custo congelado */
  if (!manter) estornar(reg); Object.assign(reg, {status: novo.status, pago: novo.pago, sinal: novo.sinal}); if (!manter) baixar(reg); avisaMudanca(a, reg);
  save(); render(); toast(av || (campo === 'pago' ? 'Pagamento: ' + novo.pago : 'Status: ' + novo.status + ' · pagamento: ' + novo.pago));
}
/* cancelar pede o destino do pagamento */
function abrirCanc(id) {
  const p = db.pedidos.find(x => x.id === id); if (!p) return;
  const sug = reembPadrao(p);
  $('#canc').innerHTML = `<h3>Cancelar pedido Nº ${nn(p.num)} · ${esc(nomeCli(p.cliente))}</h3>
  <p class="k" style="margin-bottom:12px">O estoque volta e o pagamento fica como "Cancelado". Marque o que aconteceu com o dinheiro:</p>
  <label>Pagamento do pedido cancelado<select id="reembSel">${['Pagamento não ocorreu', 'Devolver ao cliente', 'Já devolvi ao cliente'].map(o => `<option ${o === sug ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
  <div class="row"><button type="button" data-act="fechad" data-d="canc">Voltar</button><button type="button" class="pri" data-act="cancok" data-id="${esc(id)}">Cancelar pedido</button></div>`;
  $('#canc').showModal();
}
function cancOk(id) {
  const reg = db.pedidos.find(x => x.id === id); if (!reg) return;
  const a = {status: reg.status, pago: reg.pago || 'Pendente'}, r = $('#reembSel').value;
  estornar(reg); Object.assign(reg, {status: 'Cancelado', pago: 'Cancelado', reemb: r}); baixar(reg); avisaMudanca(a, reg);
  save(); $('#canc').close(); render(); toast('Pedido cancelado · ' + r);
}

/* ---------- Backup (criptografado com senha) ---------- */
let modo = 'sobrepor';
const ITER = 600000; /* PBKDF2 lento de propósito: cada tentativa de adivinhar a senha custa caro */
const temCripto = () => !!(window.crypto && crypto.subtle);
const b64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
async function chave(senha, salt, it) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations: it, hash:'SHA-256'}, base, {name:'AES-GCM', length:256}, false, ['encrypt', 'decrypt']);
}
async function cifrar(texto, senha) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await chave(senha, salt, ITER);
  const ct = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv}, k, new TextEncoder().encode(texto)));
  return JSON.stringify({app:'gestao-nfc', v:2, enc:'AES-GCM-256', kdf:'PBKDF2-SHA256', it:ITER, salt:b64(salt), iv:b64(iv), data:b64(ct)});
}
/* senha errada => erro "OperationError"; arquivo estranho => outro erro */
async function decifrar(env, senha) {
  const it = +env.it;
  if (!(it >= 100000 && it <= 2000000) || typeof env.salt !== 'string' || typeof env.iv !== 'string' || typeof env.data !== 'string') throw new Error('formato');
  const salt = unb64(env.salt), iv = unb64(env.iv);
  if (salt.length !== 16 || iv.length !== 12) throw new Error('formato');
  const k = await chave(senha, salt, it);
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM', iv}, k, unb64(env.data)));
}
function salvarArquivo(texto, nome, tipo) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], {type: tipo || 'application/json'}));
  a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

/* bloqueio: 3 senhas erradas => 1 minuto sem poder tentar (guardado no navegador, sobrevive a recarregar a página) */
const LK = 'nfc-lock';
const lockGet = () => { try { return Object.assign({n:0, until:0}, JSON.parse(localStorage.getItem(LK))); } catch (e) { return {n:0, until:0}; } };
const lockSet = o => { try { localStorage.setItem(LK, JSON.stringify(o)); } catch (e) {} };
const lockLeft = () => Math.max(0, Math.ceil((lockGet().until - Date.now()) / 1000));
function lockFail() { const l = lockGet(); l.n = (+l.n || 0) + 1; if (l.n >= 3) { l.until = Date.now() + 60000; l.n = 0; } lockSet(l); }
const lockOk = () => lockSet({n:0, until:0});

/* janela de senha (serve para exportar e para importar) */
let pwCfg = null, pwRes = null, pwOk = false, pwBusy = false, lockT = null;
const pwErro = m => { $('#pwe').textContent = m || ''; };
function lockUi() {
  clearInterval(lockT);
  const tick = () => {
    const w = lockLeft(), b = $('#pwok');
    if (w > 0) { b.disabled = true; pwErro('Muitas tentativas erradas. Tente de novo em ' + w + 's.'); $('#pwe').dataset.lock = '1'; }
    else { clearInterval(lockT); if (!pwBusy) b.disabled = false; if ($('#pwe').dataset.lock) { pwErro(''); delete $('#pwe').dataset.lock; } }
  };
  tick(); if (lockLeft() > 0) lockT = setInterval(tick, 500);
}
function abrirSenha(cfg) {
  pwCfg = cfg; pwOk = false; pwBusy = false;
  $('#pwt').textContent = cfg.titulo; $('#pwdesc').textContent = cfg.desc;
  $('#pw2l').style.display = cfg.repetir ? '' : 'none';
  ['#pw1', '#pw2'].forEach(s => { $(s).value = ''; $(s).type = 'password'; });
  $('#pw1').autocomplete = cfg.repetir ? 'new-password' : 'current-password';
  $('#pweye').innerHTML = EYE; $('#pweye').title = $('#pweye').ariaLabel = 'Mostrar senha';
  pwErro(''); $('#pwa').textContent = ''; delete $('#pwe').dataset.lock;
  $('#pwok').disabled = false; $('#pwok').textContent = 'Confirmar';
  return new Promise(res => { pwRes = res; $('#pwdlg').showModal(); $('#pw1').focus(); if (cfg.lock) lockUi(); });
}
$('#pwdlg').addEventListener('cancel', e => { if (pwBusy) e.preventDefault(); });
$('#pwdlg').addEventListener('close', () => {
  clearInterval(lockT); $('#pw1').value = ''; $('#pw2').value = '';
  const r = pwRes; pwRes = null; if (r) r(pwOk);
});
/* aviso discreto (não bloqueia): só ao criar a senha */
function pwAviso() {
  const n = [...$('#pw1').value].length;
  $('#pwa').textContent = pwCfg && pwCfg.repetir && n > 0 && n < 8 ? 'Senha curta é mais fácil de descobrir.' : '';
}
async function confirmarSenha() {
  if (pwBusy || !pwCfg) return;
  const s = $('#pw1').value;
  if (!s) return pwErro('Digite a senha.');
  if (pwCfg.repetir && s !== $('#pw2').value) return pwErro('As duas senhas não são iguais.');
  if (pwCfg.lock && lockLeft() > 0) return lockUi();
  pwBusy = true; $('#pwok').disabled = true; $('#pwok').textContent = 'Aguarde…'; pwErro('');
  let erro = null;
  try { erro = await pwCfg.onOk(s); } catch (x) { erro = 'Algo deu errado. Tente de novo.'; }
  pwBusy = false; $('#pwok').textContent = 'Confirmar'; $('#pwok').disabled = false;
  if (erro) { pwErro(erro); $('#pw1').select(); if (pwCfg.lock && lockLeft() > 0) lockUi(); }
  else { pwOk = true; $('#pwdlg').close(); }
}
/* sem <form>/submit: botão com click e Enter por keydown, como no login */
$('#pwok').addEventListener('click', confirmarSenha);
['#pw1', '#pw2'].forEach(q => $(q).addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); confirmarSenha(); } }));
$('#pw1').addEventListener('input', pwAviso);

function exportar() {
  if (!temCripto()) return toast('Criptografia indisponível neste navegador ou endereço.');
  abrirSenha({
    titulo: 'Proteger o backup com senha', repetir: true,
    desc: 'Escolha a senha que quiser, com qualquer tamanho e caracteres. O sistema não guarda essa senha: se você esquecer, ninguém consegue abrir o arquivo.',
    onOk: async s => { salvarArquivo(await cifrar(JSON.stringify(db), s), 'backup-gestao-nfc-' + today() + '.json'); return null; }
  }).then(ok => { if (ok) { lsSet(LB, Date.now()); add('sis', 'Backup salvo', 'Backup criptografado baixado.', 'backup'); persist(); toast('Backup criptografado baixado'); } });
}

/* aplica os dados (já abertos) conforme o modo escolhido: sobrepor ou mesclar */
async function aplicar(d) {
  try {
    const ks = ['clientes', 'pedidos', 'estoque', 'financeiro'];
    if (!d || !ks.every(k => Array.isArray(d[k]))) throw 0;
    if (modo === 'sobrepor') {
      if (!(await ask('Isso troca TODOS os dados atuais pelos do arquivo. Continuar?'))) return;
      const cf = db.config; db = Object.assign(empty(), d); db.metas = Object.assign({geral:0, mensal:{}}, d.metas); if (!d.config) db.config = cf; norm(db);
    } else {
      /* produtos fixos: casa pelo campo base (os IDs diferem entre bancos) e religa as compras ao produto existente */
      const mapa = {}, novos = ['pedidos', 'compras'].some(k => Array.isArray(d[k]) && d[k].some(x => !db[k].some(y => y.id === x.id)));
      d.estoque.forEach(x => { const m = x.base && db.estoque.find(e => e.base === x.base); if (m && m.id !== x.id) { mapa[x.id] = m.id; if (novos) m.qtd = (+m.qtd || 0) + (+x.qtd || 0); } });
      if (Array.isArray(d.compras)) d.compras.forEach(c => { if (mapa[c.item]) c.item = mapa[c.item]; });
      d.estoque = d.estoque.filter(x => !mapa[x.id]);
      [...ks, 'compras'].forEach(k => { if (!Array.isArray(d[k])) return; const ids = new Set(db[k].map(x => x.id)); d[k].forEach(x => { if (ids.has(x.id)) return; if (k === 'pedidos' && db.pedidos.some(y => y.num && y.num === x.num)) x.num = proxNum(); db[k].push(x); }); });
      if (d.metas) { db.metas.mensal = Object.assign({}, d.metas.mensal, db.metas.mensal); if (!db.metas.geral) db.metas.geral = +d.metas.geral || 0; }
    }
    norm(db); save(); toast('Backup importado'); render();
  } catch (e) { toast('Arquivo inválido'); }
}
function importar(file) {
  const r = new FileReader();
  r.onload = async () => {
    let d; try { d = JSON.parse(r.result); } catch (e) { return toast('Arquivo inválido'); }
    if (!(d && d.enc)) return aplicar(d); /* backup antigo, sem senha */
    if (!temCripto()) return toast('Criptografia indisponível neste navegador ou endereço.');
    let pend = null;
    const ok = await abrirSenha({
      titulo: 'Senha do backup', repetir: false, lock: true,
      desc: 'Digite a senha escolhida quando este backup foi exportado.',
      onOk: async s => {
        let txt;
        try { txt = await decifrar(d, s); }
        catch (e) {
          if (e && e.name === 'OperationError') {
            lockFail(); const w = lockLeft();
            return w > 0 ? 'Senha incorreta. Aguarde ' + w + 's para tentar de novo.' : 'Senha incorreta. Restam ' + (3 - lockGet().n) + ' tentativa(s) antes do bloqueio.';
          }
          return 'Arquivo inválido ou corrompido.';
        }
        try { pend = JSON.parse(txt); } catch (e) { return 'Arquivo corrompido.'; }
        lockOk(); return null;
      }
    });
    if (ok && pend) aplicar(pend);
  };
  r.readAsText(file);
}
$('#file').onchange = e => { if (e.target.files[0]) importar(e.target.files[0]); e.target.value = ''; };

/* histórico das metas mensais */
function abrirHistMeta() {
  const ym = today().slice(0, 7), mensal = db.metas.mensal || {}, vm = {};
  calc().vend.forEach(p => { const k = (p.data || '').slice(0, 7); if (k) vm[k] = (vm[k] || 0) + (+p.valor || 0); });
  const ks = [...new Set([...Object.keys(mensal), ...Object.keys(vm), ym])].filter(k => /^\d{4}-\d{2}$/.test(k)).sort().reverse();
  const rows = ks.map(k => {
    const meta = +mensal[k] || 0, v = r2(vm[k] || 0), bateu = meta > 0 && v >= meta;
    const st = bateu ? ['Batida', 'ok'] : k > ym ? ['Futuro', ''] : k === ym ? ['Em andamento', 'blue'] : meta ? ['Não batida', 'err'] : ['Sem meta', ''];
    return {id: k, mes: k.split('-').reverse().join('/'), meta, v, pct: meta ? Math.round(v / meta * 100) : null, st, bateu};
  });
  const comMeta = rows.filter(r => r.meta > 0 && r.id <= ym);
  const resumo = comMeta.length ? comMeta.filter(r => r.bateu).length + ' de ' + comMeta.length + ' meses com meta batida.' : 'Nenhuma meta mensal definida ainda.';
  $('#hm').innerHTML = `<h3>Histórico de metas mensais</h3><p class="k" style="margin-bottom:12px">${resumo} Cada mês começa do zero.</p>` +
    tabela('x', [['Mês', r => r.mes], ['Meta', r => r.meta ? fmt(r.meta) : '—', 'm'], ['Vendido', r => fmt(r.v), 'm'], ['Atingido', r => r.pct === null ? '—' : r.pct + '%'], ['Situação', r => badge(r.st[0], r.st[1])]], rows, true) +
    `<div class="row" style="margin-top:14px"><button type="button" class="pri" data-act="fechahm">Fechar</button></div>`;
  $('#hm').showModal();
}

/* ---------- Mensagens, duplicar, orçamento, CSV, lembrete de backup ---------- */
const LB = 'nfc-lastbk', SZ = 'nfc-bk-snooze';
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
function avisoBackup() {
  if (!db.pedidos.length && !db.clientes.length) return '';
  if (lsGet(SZ) === today()) return '';
  const u = +lsGet(LB) || 0, dias = u ? Math.floor((Date.now() - u) / 864e5) : 0;
  if (u && dias < 7) return '';
  return `<div class="note"><span>${u ? 'Seu último backup foi há ' + dias + ' dias.' : 'Não há registro de backup recente neste navegador.'} Os dados ficam só aqui.</span><span class="nb"><button type="button" class="pri" data-go="backup">Fazer backup</button><button type="button" class="ghost" data-act="snooze">Lembrar amanhã</button></span></div>`;
}
const vencTxt = p => {
  if (!p.venc || p.pago === 'Pago' || !ativo(p.status)) return '';
  const atr = p.venc < today();
  return ` <span class="vc${atr ? ' late' : ''}">${atr ? 'Venceu' : 'Vence'} ${dBR(p.venc).slice(0, 5)}</span>`;
};
const cliDe = p => db.clientes.find(x => x.id === p.cliente) || {};
function tiposMsg(p) {
  if (p.status === 'Cancelado') return [];
  if (p.status === 'Orçamento') return ['Orçamento'];
  const t = ['Agradecimento']; if (p.status === 'Vendido') t.unshift('Pronto'); if (faltaP(p) > 0) t.push('Cobrança');
  if (p.status === 'Entregue' && linkOk(cliDe(p).link)) t.push('Avaliação');
  return t;
}
const extraPed = r => `<button class="ghost" data-act="nota" data-id="${esc(r.id)}" title="Ver e baixar a nota" aria-label="Nota"><span class="ic">${ico(IC.receipt)}</span><span class="ac-l">Nota</span></button>`
  + (tiposMsg(r).length ? `<button class="ghost" data-act="msg" data-id="${esc(r.id)}" title="Enviar mensagem no WhatsApp" aria-label="Mensagem no WhatsApp"><span class="ic">${ico(IC.msg)}</span><span class="ac-l">WhatsApp</span></button>` : '');
const extraEst = e => `<button class="ghost" data-act="repor" data-id="${esc(e.id)}">Registrar compra</button>`;
function textoMsg(t, p, cli) {
  const nome = cli.contato || cli.empresa || '', igl = db.config.ig ? ' Siga a gente no Instagram: https://www.instagram.com/' + db.config.ig : '';
  if (t === 'Pronto') return `Olá, ${nome}! Seu pedido (${resumoItens(p)}) está pronto! Vamos combinar a entrega ou a retirada?`;
  if (t === 'Agradecimento') return `Olá, ${nome}! Muito obrigado pela sua compra (${resumoItens(p)})! Foi um prazer atender você. Qualquer dúvida é só me chamar.${db.config.ig ? ' Para nos ajudar, siga-nos no Instagram: https://www.instagram.com/' + db.config.ig : ''}`;
  if (t === 'Avaliação') return `Olá, ${nome}! Obrigado por escolher a gente. Se puder, deixe sua avaliação no Google, leva 1 minuto: ${cli.link}${igl}`;
  if (t === 'Cobrança') {
    const dt = dBR(p.data), hoje = today(), f = fmt(faltaP(p));
    const ctx = p.venc && p.venc < hoje ? `Notei que o pagamento do pedido de ${dt} venceu em ${dBR(p.venc)} e ainda consta em aberto.`
      : p.venc === hoje ? `Passando para lembrar que o pagamento do pedido de ${dt} vence hoje.`
      : p.venc ? `Passando para lembrar do pagamento do pedido de ${dt}, com vencimento em ${dBR(p.venc)}.`
      : `Passando para lembrar do pagamento do pedido de ${dt}.`;
    const val = +p.sinal > 0 ? ` Já recebi a entrada de ${fmt(p.sinal)}; falta ${f}.` : ` O valor em aberto é ${f}.`;
    return `Olá, ${nome}, tudo certo? ${ctx}${val} Segue abaixo a nota do pagamento pendente. Se já pagou, é só me enviar o comprovante. Obrigado!`;
  }
  return `Olá, ${nome}! Segue o orçamento de ${resumoItens(p)}: ${fmt(p.valor)}. Qualquer dúvida é só me chamar.`;
}
function waLink(cli, txt) {
  const d = String(cli.tel || '').replace(/\D/g, ''); if (!d) return '';
  return 'https://wa.me/' + (d.length <= 11 ? '55' + d : d) + '?text=' + encodeURIComponent(txt);
}
let mc = null;
function drawMsg() {
  const {p, cli, tipos, t, txt} = mc;
  $('#msg').innerHTML = `<h3>Mensagem · ${esc(cli.empresa || '')}</h3>`
    + (tipos.length > 1 ? `<div class="seg" style="margin-bottom:12px">${tipos.map(x => `<button type="button" class="${x === t ? 'on' : ''}" data-act="mtype" data-t="${x}">${x}</button>`).join('')}</div>` : '')
    + `<label>Texto<textarea id="mtxt" rows="6">${esc(txt)}</textarea></label>`
    + (t === 'Agradecimento' && !db.config.ig ? '<p class="k" style="margin:-4px 0 12px">Dica: cadastre o Instagram em Configurações para ele entrar na mensagem.</p>' : '') + (cli.tel ? '' : '<p class="k" style="margin:-4px 0 12px">Este cliente não tem WhatsApp cadastrado. Adicione em Clientes para enviar.</p>')
    + (t === 'Cobrança' ? '<p class="k" style="margin:-4px 0 12px">A nota em PDF vai logo abaixo da mensagem: no celular o compartilhamento já leva o arquivo junto; no computador o PDF é baixado e você anexa na conversa.</p>' : '')
    + `<div class="row"><button type="button" data-act="fechamsg">Fechar</button><button type="button" data-act="nota" data-id="${esc(p.id)}">Ver nota</button>${cli.tel ? (t === 'Cobrança' ? '<button type="button" class="pri" data-act="mnota">Enviar com a nota (PDF)</button>' : '') + `<a class="bt" id="mwa" target="_blank" rel="noopener" href="${esc(waLink(cli, txt))}">${t === 'Cobrança' ? 'Só texto' : 'Abrir no WhatsApp'}</a>` : ''}</div>`;
}
function abrirMsg(id) {
  const p = db.pedidos.find(x => x.id === id); if (!p) return;
  const tipos = tiposMsg(p); if (!tipos.length) return;
  const cli = cliDe(p);
  mc = {p, cli, tipos, t: tipos[0], txt: textoMsg(tipos[0], p, cli)};
  drawMsg(); $('#msg').showModal();
}
function duplicar(id) {
  const q = db.pedidos.find(x => x.id === id); if (!q) return;
  abrir('pedidos', null, {cliente: q.cliente, tipoPl: plDe(q).tipoPl, qp: plDe(q).qp, qs: plDe(q).qs, pagto: q.pagto, obs: q.obs, status: 'Vendido', pago: 'Pendente'});
}
window.addEventListener('afterprint', () => document.body.classList.remove('orc'));
function exportarCsv() {
  const c = calc(finF), n = v => (+v || 0).toFixed(2).replace('.', ','), nm = k => k === 'sem-data' ? 'Sem data' : k.split('-').reverse().join('/');
  const L = [['Mês', 'Bruto', 'Compras de estoque', 'Vinil', 'Outras despesas', 'Líquido', 'Recebido'],
    ...c.meses.map(m => [nm(m.k), n(m.bruto), n(m.comp), n(m.vin), n(m.desp), n(m.liq), n(m.rec)]),
    ['Total', n(c.bruto), n(c.compras), n(c.vinil), n(c.outras), n(c.liquido), n(c.recebido)]];
  salvarArquivo('﻿' + L.map(r => r.join(';')).join('\r\n'), 'financeiro-' + today() + '.csv', 'text/csv;charset=utf-8');
  toast('CSV baixado');
}
function desfazer(snap) { db = norm(Object.assign(empty(), JSON.parse(snap))); save(); bellUpdate(); render(); toast('Exclusão desfeita'); }

/* ---------- Plaquinhas (padrão / personalizada) ---------- */
const nn = n => n ? String(n).padStart(4, '0') : '----';
const proxNum = () => Math.max(0, ...db.pedidos.map(p => +p.num || 0)) + 1;
function plDe(p) {
  const c = db.config;
  if (p.qp !== undefined || p.qs !== undefined) { const qp = +p.qp || 0, qs = +p.qs || 0; return {tipoPl: p.tipoPl || (qp && qs ? 'Padrão + Personalizada' : qs ? 'Personalizada' : 'Padrão'), qp, qs, pp: +p.pp || c.pp, ps: +p.ps || c.ps}; }
  const q = +p.qtd || 0; /* pedido antigo: só quantidade + valor total */
  return {tipoPl: 'Padrão', qp: q, qs: 0, pp: q ? (+p.valor || 0) / q : c.pp, ps: c.ps, legado: true};
}
const itensTxt = p => { const x = plDe(p); if (x.legado) return x.qp ? x.qp + ' placa' + (x.qp > 1 ? 's' : '') : '-'; return [x.qp ? x.qp + ' padrão' : '', x.qs ? x.qs + ' personalizada' + (x.qs > 1 ? 's' : '') : ''].filter(Boolean).join(' + '); };
const resumoItens = p => { const x = plDe(p), s = n => n > 1 ? 's' : ''; if (x.legado) return (x.qp || '') + ' plaquinha' + s(x.qp) + ' NFC'; if (x.qp && x.qs) return `${x.qp} plaquinha${s(x.qp)} padrão e ${x.qs} personalizada${s(x.qs)}`; return x.qs ? `${x.qs} plaquinha${s(x.qs)} personalizada${s(x.qs)}` : `${x.qp} plaquinha${s(x.qp)} padrão`; };
function iniPedido(f, b) {
  f.dataset.pp = b.pp ?? db.config.pp; f.dataset.ps = b.ps ?? db.config.ps;
  const g = n => f.querySelector('[name=' + n + ']'), tp = g('tipoPl'), qp = g('qp'), qs = g('qs'), dt = g('descTipo'), dv = g('descV'), fr = g('frete');
  tp.addEventListener('change', () => {
    if (tp.value === 'Padrão') { qs.value = 0; if (!+qp.value) qp.value = 1; }
    else if (tp.value === 'Personalizada') { qp.value = 0; if (!+qs.value) qs.value = 1; }
    else { if (!+qp.value) qp.value = 1; if (!+qs.value) qs.value = 1; }
    atualizaTotal(f);
  });
  [qp, qs, dv, fr].forEach(i => i.addEventListener('input', () => atualizaTotal(f)));
  dt.addEventListener('change', () => { if (dt.value === 'Sem desconto') dv.value = ''; atualizaTotal(f); });
  const stS = g('status'), pgS2 = g('pago'), sn = g('sinal'), vc = g('venc'), rb = g('reemb');
  const mostra = () => {
    const ver = (el, on) => { el.closest('label').style.display = on ? '' : 'none'; };
    ver(sn, pgS2.value === 'Pendente'); ver(vc, pgS2.value === 'Pendente'); ver(rb, stS.value === 'Cancelado');
  };
  const sync = campo => {
    const ant = {pago: pgS2.value, sinal: sn.value}, o = {status: stS.value, pago: pgS2.value, sinal: sn.value}; regras(o, campo);
    stS.value = o.status; pgS2.value = o.pago; if (o.status === 'Orçamento') sn.value = '';
    if (o.status === 'Cancelado' && campo) rb.value = reembPadrao({pago: b.pago === 'Cancelado' ? '' : (b.pago || ant.pago), sinal: b.sinal || ant.sinal});
    mostra();
  };
  stS.addEventListener('change', () => sync('status')); pgS2.addEventListener('change', () => sync('pago'));
  if (b.reemb) rb.value = b.reemb;
  mostra();
  atualizaTotal(f);
}
function atualizaTotal(f) {
  const g = n => f.querySelector('[name=' + n + ']'), t = g('tipoPl').value, pp = +f.dataset.pp, ps = +f.dataset.ps;
  g('qp').closest('label').style.display = t === 'Personalizada' ? 'none' : '';
  g('qs').closest('label').style.display = t === 'Padrão' ? 'none' : '';
  const dt = g('descTipo').value; g('descV').closest('label').style.display = dt === 'Sem desconto' ? 'none' : '';
  g('descV').placeholder = dt === 'Porcentagem (%)' ? 'Ex.: 10 (%)' : 'Ex.: 15,00 (R$)';
  const qp = t === 'Personalizada' ? 0 : Math.max(0, +g('qp').value || 0), qs = t === 'Padrão' ? 0 : Math.max(0, +g('qs').value || 0);
  const sub = r2(qp * pp + qs * ps), dR = descCalc(sub, dt, +g('descV').value), fr = r2(Math.max(0, +g('frete').value || 0)), total = r2(sub - dR + fr);
  const ln = (n, q, u) => q > 0 ? `<div class="top"><span>${q} × ${n} (${fmt(u)})</span><b>${fmt(q * u)}</b></div>` : '';
  const ck = r2(custoUnPlaq() + vinilUn()), custo = r2((qp + qs) * ck), lucro = r2(total - custo);
  $('#ptot').innerHTML = ln('padrão', qp, pp) + ln('personalizada', qs, ps)
    + (dR > 0 ? `<div class="top"><span>Desconto</span><b>−${fmt(dR)}</b></div>` : '') + (fr > 0 ? `<div class="top"><span>Frete</span><b>${fmt(fr)}</b></div>` : '')
    + `<div class="top tt"><span>Total</span><b>${fmt(total)}</b></div>`
    + (ck > 0 ? `<div class="top k" style="margin-top:8px"><span>Custo das peças e do vinil (estimado)</span><span>${fmt(custo)}</span></div><div class="top"><span class="k">Lucro estimado</span><b class="${lucro < 0 ? 'neg' : 'pos'}">${fmt(lucro)}</b></div>` : '');
}

/* ---------- Som, notificações e sino ---------- */
let logado = false, chk = false, somT = null, actx = null;
function audioCtx() { try { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; if (!actx) actx = new C(); if (actx.state === 'suspended') actx.resume(); return actx; } catch (e) { return null; } }
function tocar(forca) {
  if (!forca && !db.config.som) return;
  const a = audioCtx(); if (!a) return; const t = a.currentTime;
  [[880, 0], [1318.5, .15]].forEach(([fr, dl]) => { const o = a.createOscillator(), g = a.createGain(); o.type = 'sine'; o.frequency.value = fr; o.connect(g); g.connect(a.destination);
    g.gain.setValueAtTime(.0001, t + dl); g.gain.exponentialRampToValueAtTime(.28, t + dl + .02); g.gain.exponentialRampToValueAtTime(.0001, t + dl + .7); o.start(t + dl); o.stop(t + dl + .75); });
}
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => audioCtx(), {once: true}));
const NI = {pedido:'pedidos', pagto:'wallet', estoque:'estoque', meta:'check', alerta:'clock', cancel:'xc', sis:'dash'};
const NC = {pedido:'blue', pagto:'ok', estoque:'warn', meta:'ok', alerta:'warn', cancel:'err', sis:''};
function add(tipo, titulo, texto, go) {
  db.notifs.unshift({id: uid(), t: Date.now(), tipo, titulo, texto: texto || '', go: go || '', lida: false});
  if (db.notifs.length > 150) db.notifs.length = 150;
  bellUpdate(true); if (!somT) somT = setTimeout(() => { somT = null; tocar(); }, 40);
}
function avisaMudanca(a, p) {
  const d = 'Nº ' + nn(p.num) + ': ' + nomeCli(p.cliente) + ', ' + fmt(p.valor) + '.';
  if (a.status !== p.status) {
    if (p.status === 'Cancelado') add('cancel', 'Pedido cancelado', d + (p.reemb === 'Devolver ao cliente' ? ' Lembrete: devolver o pagamento ao cliente.' : ''), 'pedidos');
    else if (p.status === 'Entregue') add('pedido', 'Pedido entregue', d, 'pedidos');
    else if (p.status === 'Vendido' && a.status === 'Orçamento') add('pedido', 'Orçamento virou venda', d, 'pedidos');
  }
  if ((a.pago || 'Pendente') !== (p.pago || 'Pendente') && p.pago === 'Pago' && ativo(p.status)) add('pagto', 'Pagamento recebido', d, 'pedidos');
}
const ago = t => { const m = Math.floor((Date.now() - t) / 6e4); return m < 1 ? 'agora' : m < 60 ? 'há ' + m + ' min' : m < 1440 ? 'há ' + Math.floor(m / 60) + ' h' : new Date(t).toLocaleDateString('pt-BR'); };
function bellUpdate(ring) {
  const n = db.notifs.filter(x => !x.lida).length, d = $('#bdot'), b = $('#bell'); if (!d) return;
  d.hidden = !n; d.textContent = n > 9 ? '9+' : n;
  b.setAttribute('aria-label', n ? 'Notificações: ' + n + ' não lidas' : 'Notificações');
  document.title = (n ? '(' + n + ') ' : '') + 'Gestão NFC';
  if (ring && n) { b.classList.remove('ring'); d.classList.remove('pop'); void b.offsetWidth; b.classList.add('ring'); d.classList.add('pop'); }
  if (!$('#npanel').hidden) desenhaPainel();
}
function fechaPainel() { const p = $('#npanel'); if (p && !p.hidden) { p.hidden = true; $('#bell').setAttribute('aria-expanded', 'false'); } }
function desenhaPainel() {
  const L = db.notifs, n = L.filter(x => !x.lida).length;
  $('#npanel').innerHTML = `<div class="nh"><b>Notificações</b><span><button type="button" class="ghost" data-act="nall"${n ? '' : ' disabled'}>Ler tudo</button><button type="button" class="ghost err" data-act="nclear"${L.length ? '' : ' disabled'}>Apagar todas</button></span></div>`
    + `<div class="nl">${L.length ? L.map(x => `<div class="ni${x.lida ? '' : ' un'}"><button type="button" class="nib" data-act="nopen" data-id="${esc(x.id)}" data-to="${esc(x.go)}"><span class="nic ${NC[x.tipo] || ''}">${ico(IC[NI[x.tipo]] || IC.bell)}</span><span class="nt"><b>${esc(x.titulo)}</b><span>${esc(x.texto)}</span><small>${ago(x.t)}</small></span></button><button type="button" class="ghost nx" data-act="ndel" data-id="${esc(x.id)}" aria-label="Apagar notificação">${ico(IC.x)}</button></div>`).join('') : '<div class="vazio">Nenhuma notificação por enquanto. Pedidos, pagamentos, estoque e metas avisam aqui.</div>'}</div>`
    + `<div class="nf"><label class="inl" style="margin:0"><input type="checkbox" data-act="nsom"${db.config.som ? ' checked' : ''}> Tocar som</label></div>`;
}
/* avisos automáticos (estoque, vencimentos, metas, backup): cada um chega uma vez */
function checar() {
  if (chk) return; chk = true; let n = 0;
  try {
    const nk = db.nk, hoje = today(), ym = hoje.slice(0, 7), amanha = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4 + 864e5).toISOString().slice(0, 10);
    const um = (k, ...a) => { if (nk[k]) return; nk[k] = 1; add(...a); n++; };
    Object.keys(nk).forEach(k => { if (k.startsWith('bk:') && k !== 'bk:' + hoje) delete nk[k]; });
    db.estoque.forEach(e => {
      const q = +e.qtd || 0, mn = +e.min || 0, k = 'est:' + e.id, k0 = 'est0:' + e.id;
      if (q > mn) { delete nk[k]; delete nk[k0]; return; }
      if (q > 0) delete nk[k0];
      if (q <= 0) { if (!nk[k0]) { nk[k0] = nk[k] = 1; add('estoque', 'Estoque zerado', e.nome + ' acabou. Hora de repor.', 'estoque'); n++; } }
      else um(k, 'estoque', 'Estoque baixo', e.nome + ': restam ' + q + ' un. (aviso em ' + mn + ').', 'estoque');
    });
    db.pedidos.forEach(p => {
      if (!p.venc || p.pago === 'Pago' || !ativo(p.status)) return;
      const d = 'Nº ' + nn(p.num) + ': ' + nomeCli(p.cliente) + ', ' + fmt(p.valor);
      if (p.venc < hoje) um('vl:' + p.id + p.venc, 'alerta', 'Pagamento atrasado', d + ' (venceu em ' + dBR(p.venc) + ').', 'pedidos');
      else if (p.venc === hoje) um('vh:' + p.id + p.venc, 'alerta', 'Pagamento vence hoje', d + '.', 'pedidos');
      else if (p.venc === amanha) um('va:' + p.id + p.venc, 'alerta', 'Pagamento vence amanhã', d + '.', 'pedidos');
    });
    db.pedidos.forEach(p => {
      if (!p.prev || !PEND.includes(p.status)) return;
      const d = 'Nº ' + nn(p.num) + ': ' + nomeCli(p.cliente) + ', ' + resumoItens(p);
      if (p.prev < hoje) um('el:' + p.id + p.prev, 'alerta', 'Entrega atrasada', d + ' (prevista para ' + dBR(p.prev) + ').', 'pedidos');
      else if (p.prev === hoje) um('eh:' + p.id + p.prev, 'alerta', 'Entrega é hoje', d + '.', 'pedidos');
    });
    const c = calc(), mv = sum(c.vend.filter(p => (p.data || '').startsWith(ym)), p => +p.valor), mM = +db.metas.mensal[ym] || 0, mG = +db.metas.geral || 0;
    if (mM > 0 && mv >= mM) um('meta:' + ym + ':' + mM, 'meta', 'Meta do mês batida', 'Você vendeu ' + fmt(mv) + ' de ' + fmt(mM) + '. Parabéns!', 'dash');
    if (mG > 0 && c.bruto >= mG) um('metaG:' + mG, 'meta', 'Meta geral batida', 'Você vendeu ' + fmt(c.bruto) + ' de ' + fmt(mG) + '. Parabéns!', 'dash');
    const u = +lsGet(LB) || 0, dias = u ? Math.floor((Date.now() - u) / 864e5) : 0;
    if ((db.pedidos.length || db.clientes.length) && (!u || dias >= 7)) um('bk:' + hoje, 'sis', 'Faça um backup', u ? 'Seu último backup foi há ' + dias + ' dias.' : 'Ainda não há backup registrado neste navegador.', 'backup');
  } finally { chk = false; }
  if (n) persist();
}

/* ---------- Configurações ---------- */
const igHandle = v => String(v || '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^(www\.)?instagram\.com\//i, '').split(/[\/?#]/)[0].replace(/^@/, '');
const igOk = h => /^[A-Za-z0-9._]{1,30}$/.test(h);
function vCfg() {
  const c = db.config;
  return `${ph('Configurações', 'Preços das plaquinhas, Instagram da empresa e avisos.')}
  <div class="grid two"><div class="card"><h3>Empresa</h3>
    <label>Nome da empresa (aparece na nota)<input id="cfEmp" value="${esc(c.empresa)}" placeholder="Ex.: Minha Empresa NFC"></label>
    <label>Instagram da empresa<input id="cfIg" value="${esc(c.ig ? '@' + c.ig : '')}" placeholder="@seuinstagram ou link do perfil" autocapitalize="none" autocomplete="off"></label>
    <p class="k">Entra automaticamente na mensagem de agradecimento, na de avaliação e na nota.</p></div>
  <div class="card"><h3>Preços</h3>
    <label>Plaquinha padrão (R$)<input id="cfPp" type="number" min="0" step="0.01" value="${c.pp}"></label>
    <label>Plaquinha personalizada (R$)<input id="cfPs" type="number" min="0" step="0.01" value="${c.ps}"></label>
    <p class="k">Vale para os pedidos novos. Pedidos já registrados mantêm o preço da época.</p></div></div>
  <div class="card" style="margin-top:14px"><h3>Notificações</h3>
    <label class="inl" style="margin:0 0 12px"><input id="cfSom" type="checkbox" ${c.som ? 'checked' : ''}> Tocar som quando chegar notificação</label>
    <div class="btns" style="margin:0"><button type="button" data-act="somtest">Testar som</button></div></div>
  <div class="row" style="margin-top:14px;justify-content:flex-start"><button type="button" class="pri" data-act="cfgsave">Salvar configurações</button></div>`;
}
function salvarCfg() {
  const ig = igHandle($('#cfIg').value), pp = +$('#cfPp').value, ps = +$('#cfPs').value;
  if (ig && !igOk(ig)) return toast('Instagram inválido. Use @usuario ou o link do perfil.');
  if (!(pp > 0) || !(ps > 0)) return toast('Informe um preço maior que zero para os dois tipos.');
  const mud = r2(pp) !== db.config.pp || r2(ps) !== db.config.ps;
  Object.assign(db.config, {empresa: $('#cfEmp').value.trim(), ig, pp: r2(pp), ps: r2(ps), som: $('#cfSom').checked});
  if (mud) add('sis', 'Preços atualizados', 'Padrão ' + fmt(db.config.pp) + ' e personalizada ' + fmt(db.config.ps) + '.', 'cfg');
  save(); render(); toast('Configurações salvas');
}

/* ---------- Nota (preview, PDF, compartilhar, imprimir) ---------- */
let nc = null;
function dadosNota(p) {
  const c = db.config, x = plDe(p), L = [];
  if (x.legado) L.push({d: 'Plaquinhas NFC', q: x.qp || '', u: x.qp ? (+p.valor || 0) / x.qp : +p.valor || 0, s: +p.valor || 0});
  else { if (x.qp > 0) L.push({d: 'Plaquinha NFC padrão', q: x.qp, u: x.pp, s: r2(x.qp * x.pp)}); if (x.qs > 0) L.push({d: 'Plaquinha NFC personalizada', q: x.qs, u: x.ps, s: r2(x.qs * x.ps)}); }
  return {cli: cliDe(p), L, sub: x.legado ? +p.valor || 0 : r2(x.qp * x.pp + x.qs * x.ps), desc: +p.desc || 0, frete: +p.frete || 0, num: nn(p.num), tit: p.status === 'Orçamento' ? 'Orçamento' : p.status === 'Cancelado' ? 'Pedido cancelado' : 'Nota de compra', emp: c.empresa || 'Plaquinhas NFC', ig: c.ig ? '@' + c.ig : '',
    total: +p.valor || 0, pg: ativo(p.status) ? (p.pagto ? p.pagto + ', ' : '') + (p.pago === 'Pago' ? 'pago' : 'pendente' + (+p.sinal > 0 ? ', entrada ' + fmt(p.sinal) + ', falta ' + fmt(faltaP(p)) : '')) : '', obs: p.obs || '', data: dBR(p.data)};
}
const extraNota = d => (d.desc > 0 || d.frete > 0 ? `<p>Subtotal: ${fmt(d.sub)}</p>` : '') + (d.desc > 0 ? `<p>Desconto: −${fmt(d.desc)}</p>` : '') + (d.frete > 0 ? `<p>Frete: ${fmt(d.frete)}</p>` : '');
const notaHtml = d => `<div class="np"><div class="nph"><div><b>${esc(d.emp)}</b>${d.ig ? '<span>' + esc(d.ig) + '</span>' : ''}</div><div class="npr"><b>${esc(d.tit)}</b><span>Nº ${d.num} - ${d.data}</span></div></div>
<div class="npc"><small>Cliente</small><b>${esc(d.cli.empresa || '')}</b>${d.cli.contato ? '<span>' + esc(d.cli.contato) + '</span>' : ''}${d.cli.tel ? '<span>' + esc(maskTel(d.cli.tel)) + '</span>' : ''}</div>
<table><thead><tr><th>Item</th><th>Qtd</th><th>Unitário</th><th>Subtotal</th></tr></thead><tbody>${d.L.map(l => `<tr><td>${esc(l.d)}</td><td>${esc(l.q)}</td><td>${fmt(l.u)}</td><td>${fmt(l.s)}</td></tr>`).join('')}</tbody></table>
${extraNota(d)}<div class="npt"><span>Total</span><b>${fmt(d.total)}</b></div>${d.pg ? `<p>Pagamento: ${esc(d.pg)}</p>` : ''}${d.obs ? `<p>Obs.: ${esc(d.obs)}</p>` : ''}
<div class="npf">Obrigado pela preferência!${d.ig ? '<br>Siga a gente no Instagram: ' + esc(d.ig) : ''}</div></div>`;
function abrirNota(id) {
  const p = db.pedidos.find(x => x.id === id); if (!p) return; nc = p;
  $('#nota').innerHTML = notaHtml(dadosNota(p)) + `<div class="row" style="margin-top:14px"><button type="button" data-act="fechanota">Fechar</button><button type="button" data-act="notaprint">Imprimir</button>${navigator.canShare ? '<button type="button" data-act="notashare">Compartilhar</button>' : ''}<button type="button" class="pri" data-act="notapdf">Baixar PDF</button></div>`;
  $('#nota').showModal();
}
const nomePdf = d => 'nota-' + d.num + '-' + (norm1(d.cli.empresa).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cliente') + '.pdf';
function imprimirNota(p) { $('#orc').innerHTML = notaHtml(dadosNota(p)); document.body.classList.add('orc'); try { window.print(); } catch (e) { toast('Impressão indisponível aqui'); } }
/* cobrança: texto + nota (PDF) juntos. Celular: compartilhar leva o arquivo; computador: baixa o PDF e abre o WhatsApp com o texto */
async function enviaComNota() {
  if (!mc) return;
  const d = dadosNota(mc.p), f = new File([pdfNota(d)], nomePdf(d), {type: 'application/pdf'}), txt = $('#mtxt').value;
  try {
    if (navigator.canShare && navigator.canShare({files: [f]})) return await navigator.share({files: [f], text: txt, title: 'Nota ' + d.num});
  } catch (e) { if (e && e.name === 'AbortError') return; }
  salvarArquivo(f, f.name, 'application/pdf'); window.open(waLink(mc.cli, txt), '_blank', 'noopener');
  toast('PDF baixado. Anexe na conversa, logo abaixo da mensagem.');
}
async function compartilharNota(p) {
  const d = dadosNota(p), f = new File([pdfNota(d)], nomePdf(d), {type: 'application/pdf'});
  try { if (navigator.canShare && navigator.canShare({files: [f]})) await navigator.share({files: [f], title: d.tit + ' ' + d.num}); else { salvarArquivo(f, f.name, 'application/pdf'); toast('PDF baixado. Anexe na conversa do cliente.'); } } catch (e) {}
}
/* PDF gerado aqui mesmo (sem internet e sem biblioteca): Helvetica padrão, folha A5 */
const HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
function pdfNota(d) {
  const W = 420, H = 595, M = 32; let o = '';
  const L1 = t => String(t).replace(/\u00a0/g, ' ').replace(/[—–]/g, '-').replace(/[^\x20-\xff]/g, '?');
  const tw = (t, z, b) => { let w = 0; for (const ch of L1(t)) { const c = ch.normalize('NFD').charCodeAt(0); w += c >= 32 && c <= 126 ? HW[c - 32] : 556; } return w * z / 1000 * (b ? 1.06 : 1); };
  const rg = h => [1, 3, 5].map(i => (parseInt(h.substr(i, 2), 16) / 255).toFixed(3)).join(' ');
  const T = (t, x, y, z, b, c, al) => { const w = tw(t, z, b); if (al === 'r') x -= w; else if (al === 'c') x -= w / 2; o += `BT /F${b ? 2 : 1} ${z} Tf ${rg(c || '#111827')} rg ${x.toFixed(1)} ${(H - y).toFixed(1)} Td (${L1(t).replace(/[\\()]/g, m => '\\' + m)}) Tj ET\n`; };
  const R = (x, y, w, h, c) => { o += `${rg(c)} rg ${x} ${H - y - h} ${w} ${h} re f\n`; };
  const Ln = (y, c) => { o += `${rg(c)} RG 0.6 w ${M} ${H - y} m ${W - M} ${H - y} l S\n`; };
  R(0, 0, W, 84, '#1d4ed8'); T(d.emp, M, 38, 18, 1, '#ffffff'); if (d.ig) T(d.ig, M, 57, 10, 0, '#dbeafe');
  T(d.tit, W - M, 36, 11, 1, '#ffffff', 'r'); T('Nº ' + d.num + '  ' + d.data, W - M, 54, 10, 0, '#dbeafe', 'r');
  let y = 112; T('Cliente', M, y, 8, 0, '#6b7280'); y += 16; T(d.cli.empresa || '-', M, y, 13, 1);
  if (d.cli.contato) { y += 15; T(d.cli.contato, M, y, 10, 0, '#374151'); } if (d.cli.tel) { y += 14; T(maskTel(d.cli.tel), M, y, 10, 0, '#374151'); }
  y += 22; R(M, y, W - 2 * M, 22, '#f1f5f9'); T('Item', M + 8, y + 15, 8.5, 1, '#6b7280'); T('Qtd', 250, y + 15, 8.5, 1, '#6b7280', 'r'); T('Unitário', 330, y + 15, 8.5, 1, '#6b7280', 'r'); T('Subtotal', W - M - 8, y + 15, 8.5, 1, '#6b7280', 'r'); y += 22;
  d.L.forEach(l => { y += 22; T(l.d, M + 8, y, 10); T(String(l.q), 250, y, 10, 0, '', 'r'); T(fmt(l.u), 330, y, 10, 0, '', 'r'); T(fmt(l.s), W - M - 8, y, 10, 1, '', 'r'); Ln(y + 9, '#e5e7eb'); });
  [d.desc > 0 || d.frete > 0 ? ['Subtotal', fmt(d.sub)] : null, d.desc > 0 ? ['Desconto', '-' + fmt(d.desc)] : null, d.frete > 0 ? ['Frete', fmt(d.frete)] : null].filter(Boolean).forEach(([a, b2]) => { y += 16; T(a, M + 8, y, 10, 0, '#374151'); T(b2, W - M - 8, y, 10, 0, '#374151', 'r'); });
  y += 40; R(M, y - 20, W - 2 * M, 36, '#eff6ff'); T('TOTAL', M + 12, y + 3, 11, 1, '#1d4ed8'); T(fmt(d.total), W - M - 12, y + 5, 17, 1, '#1d4ed8', 'r');
  y += 38; if (d.pg) { T('Pagamento: ' + d.pg, M, y, 10, 0, '#374151'); y += 16; }
  if (d.obs) { let cur = ''; const ls = []; ('Obs.: ' + d.obs).split(/\s+/).forEach(w => { const t = cur ? cur + ' ' + w : w; if (tw(t, 10) > W - 2 * M && cur) { ls.push(cur); cur = w; } else cur = t; }); if (cur) ls.push(cur); ls.slice(0, 6).forEach(t => { T(t, M, y, 10, 0, '#374151'); y += 14; }); }
  Ln(H - 84, '#e5e7eb'); T('Obrigado pela preferência!', W / 2, H - 60, 12, 1, '#111827', 'c');
  if (d.ig) { T('Siga a gente no Instagram: ' + d.ig, W / 2, H - 42, 10, 0, '#374151', 'c'); T('instagram.com/' + d.ig.slice(1), W / 2, H - 28, 8.5, 0, '#6b7280', 'c'); }
  const ob = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${o.length} >>\nstream\n${o}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  let s = '%PDF-1.4\n'; const off = [];
  ob.forEach((b, i) => { off.push(s.length); s += (i + 1) + ' 0 obj\n' + b + '\nendobj\n'; });
  const xr = s.length;
  s += 'xref\n0 ' + (ob.length + 1) + '\n0000000000 65535 f \n' + off.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + (ob.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xr + '\n%%EOF';
  return new Blob([Uint8Array.from(s, c => c.charCodeAt(0))], {type: 'application/pdf'});
}

/* ---------- Eventos ---------- */
document.addEventListener('click', async e => {
  if (!e.target.closest('#bellbox')) fechaPainel();
  const b = e.target.closest('[data-go],[data-act]'); if (!b) return;
  if (b.dataset.go) { cur = b.dataset.go; setMenu(false); return render(true); }
  const {act, ent, id} = b.dataset;
  if (act === 'salvar') salvarForm();
  else if (act === 'cfmyes') { const r = cfmRes; cfmRes = null; $('#cfm').close(); if (r) r(true); }
  else if (act === 'cfmno') $('#cfm').close();
  else if (act === 'add') abrir(ent);
  else if (act === 'edit') abrir(ent, id);
  else if (act === 'repor') abrir('compras', null, {item: id});
  else if (act === 'fechar') $('#dlg').close();
  else if (act === 'del') {
    if (ent === 'clientes' && db.pedidos.some(p => p.cliente === id)) return toast('Esse cliente tem pedidos. Exclua os pedidos antes.');
    if (ent === 'estoque' && (db.estoque.find(x => x.id === id) || {}).base) return toast('Esse produto é fixo e não pode ser excluído.');
    if (ent === 'compras') {
      const c = db.compras.find(x => x.id === id), it = c && db.estoque.find(x => x.id === c.item);
      if (it && (+it.qtd || 0) - (+c.unid || 0) < 0) return toast('Parte dessa compra já foi vendida. Não dá para excluir.');
    }
    const msg = ent === 'estoque' && db.compras.some(c => c.item === id) ? 'Excluir este item e as compras registradas dele?' : 'Excluir este registro?';
    if (!(await ask(msg))) return;
    const snap = JSON.stringify(db);
    if (ent === 'pedidos') { const pp = db.pedidos.find(x => x.id === id) || {}; estornar(pp); }
    if (ent === 'compras') { const c = db.compras.find(x => x.id === id), it = c && db.estoque.find(x => x.id === c.item); if (it) it.qtd = (+it.qtd || 0) - (+c.unid || 0); }
    if (ent === 'estoque') db.compras = db.compras.filter(c => c.item !== id);
    db[ent] = db[ent].filter(x => x.id !== id); save(); if ($('#dlg').open) $('#dlg').close(); render(); toast('Excluído', () => desfazer(snap));
  }
  else if (act === 'chart') { chartMode = b.dataset.mode; try { localStorage.setItem('nfc-chart', chartMode); } catch (x) {} render(); }
  else if (act === 'menu') setMenu(!$('#nav').classList.contains('open'));
  else if (act === 'fechamenu') setMenu(false);
  else if (act === 'nav') { navMin = !navMin; try { localStorage.setItem('nfc-nav', navMin ? '1' : '0'); } catch (x) {} render(); }
  else if (act === 'export') exportar();
  else if (act === 'hmeta') abrirHistMeta();
  else if (act === 'gof') { flt = {q:'', mes:'', st: b.dataset.st || '', pg:'', esp: b.dataset.esp || ''}; pgS.pedidos = 1; cur = 'pedidos'; render(true); }
  else if (act === 'limpaab') { flt.esp = ''; pgS.pedidos = 1; render(); }
  else if (act === 'fechad') $('#' + b.dataset.d).close();
  else if (act === 'sort') { const t = b.dataset.t, c = +b.dataset.c, o = srtS[t]; srtS[t] = o && o.c === c ? {c, d: -o.d} : {c, d: 1}; pgS[t] = 1; render(); }
  else if (act === 'pg') { pgS[b.dataset.t] = +b.dataset.n; render(); }
  else if (act === 'ficha') abrirFicha(id);
  else if (act === 'fichaedit') { $('#ficha').close(); abrir('clientes', id); }
  else if (act === 'fichanovo') { $('#ficha').close(); abrir('pedidos', null, {cliente: id}); }
  else if (act === 'vinilsave') { const v = +$('#cfVin').value || 0; if (v < 0) return toast('Valor inválido'); db.config.vinil = r2(v); save(); render(); toast('Vinil salvo: ' + fmt(db.config.vinil) + ' por plaquinha'); }
  else if (act === 'cancok') cancOk(id);
  else if (act === 'mnota') enviaComNota();
  else if (act === 'csvped') csvPedidos();
  else if (act === 'csvcli') csvClientes();
  else if (act === 'fper') periodo(b.dataset.p);
  else if (act === 'msg') abrirMsg(id);
  else if (act === 'mtype') { mc.t = b.dataset.t; mc.txt = textoMsg(mc.t, mc.p, mc.cli); drawMsg(); }
  else if (act === 'fechamsg') $('#msg').close();
  else if (act === 'bell') { const pn = $('#npanel'); if (pn.hidden) { desenhaPainel(); pn.hidden = false; $('#bell').setAttribute('aria-expanded', 'true'); } else fechaPainel(); }
  else if (act === 'nopen') { const n = db.notifs.find(x => x.id === id); if (n) n.lida = true; save(); fechaPainel(); bellUpdate(); if (VIEWS[b.dataset.to]) { cur = b.dataset.to; setMenu(false); render(true); } }
  else if (act === 'ndel') { db.notifs = db.notifs.filter(x => x.id !== id); save(); bellUpdate(); }
  else if (act === 'nall') { db.notifs.forEach(x => x.lida = true); save(); bellUpdate(); }
  else if (act === 'nclear') { if (await ask('Apagar todas as notificações?')) { db.notifs = []; save(); bellUpdate(); } }
  else if (act === 'nsom') { db.config.som = b.checked; save(); }
  else if (act === 'somtest') tocar(true);
  else if (act === 'cfgsave') salvarCfg();
  else if (act === 'nota') { $('#msg').close(); abrirNota(id); }
  else if (act === 'fechanota') $('#nota').close();
  else if (act === 'notapdf') { const d = dadosNota(nc); salvarArquivo(pdfNota(d), nomePdf(d), 'application/pdf'); toast('PDF baixado'); }
  else if (act === 'notashare') compartilharNota(nc);
  else if (act === 'notaprint') imprimirNota(nc);
  else if (act === 'dup') { if ($('#dlg').open) $('#dlg').close(); duplicar(id); }
  else if (act === 'csv') exportarCsv();
  else if (act === 'print') { try { window.print(); } catch (x) { toast('Impressão indisponível aqui'); } }
  else if (act === 'snooze') { lsSet(SZ, today()); render(); }
  else if (act === 'fechahm') $('#hm').close();
  else if (act === 'pwno') { if (!pwBusy) $('#pwdlg').close(); }
  else if (act === 'import') { modo = b.dataset.modo; $('#file').click(); }
  else if (act === 'clear') { if (await ask('Apagar TODOS os dados deste navegador?')) { const snap = JSON.stringify(db), cf = db.config; db = empty(); db.config = cf; norm(db); save(); fechaPainel(); bellUpdate(); render(); toast('Dados apagados', () => desfazer(snap)); } }
  else if (act === 'sair') { try { sessionStorage.removeItem('auth'); } catch (x) {} location.reload(); }
});
function setMenu(o) {
  $('#nav').classList.toggle('open', o);
  $('#scrim').classList.toggle('open', o);
  document.body.classList.toggle('lock', o);
  $('#burger').setAttribute('aria-expanded', o);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') { setMenu(false); fechaPainel(); } });
window.addEventListener('resize', () => { if (innerWidth > 800) setMenu(false); });
if ('ResizeObserver' in window) {
  let lastW = 0;
  new ResizeObserver(() => { const w = $('#main').clientWidth; if (w !== lastW) { lastW = w; if (cur === 'dash') drawChart(); } }).observe($('#main'));
}
/* busca/filtros: redesenha só a lista, sem perder o foco */
$('#main').addEventListener('input', e => {
  const fk = e.target.dataset.fh;
  if (fk) { fh[fk] = e.target.value; pgS.hist = 1; const el = $('#lista'); if (el) el.innerHTML = tabHist(); return; }
  const f = e.target.dataset.f; if (!f) return;
  pgS[cur] = 1;
  if (f === 'cq') cq = e.target.value; else { flt[f] = e.target.value; if (f === 'st' || f === 'pg') flt.esp = ''; }
  const el = $('#lista'); if (el) el.innerHTML = cur === 'clientes' ? tabCli() : tabPed();
});
$('#msg').addEventListener('input', e => { if (e.target.id === 'mtxt' && mc) { mc.txt = e.target.value; const a = $('#mwa'); if (a) a.href = waLink(mc.cli, mc.txt); } });
$('#main').addEventListener('change', e => {
  if (e.target.id === 'fde' || e.target.id === 'fate') { finF[e.target.id === 'fde' ? 'de' : 'ate'] = e.target.value; return render(); }
  if (e.target.dataset.chgc) { const c = db.compras.find(x => x.id === e.target.dataset.id); if (c) { c.pago = e.target.value; save(); render(); toast('Compra: ' + c.pago); } return; }
  if (e.target.dataset.chg) return mudarPedido(e.target.dataset.id, e.target.dataset.chg, e.target.value);
  if (e.target.id === 'metaG') { db.metas.geral = +e.target.value || 0; save(); render(); }
  if (e.target.id === 'metaM') { db.metas.mensal[today().slice(0, 7)] = +e.target.value || 0; save(); render(); }
});

/* ---------- Login ---------- */
function entrar() { $('#login').style.display = 'none'; $('#app').style.display = 'block'; logado = true; $('#bell').innerHTML = ico(IC.bell); render(); bellUpdate(); checar(); setInterval(checar, 60000); }
function tentarLogin() {
  if ($('#u').value.trim() === USER && $('#p').value === PASS) { try { sessionStorage.setItem('auth', '1'); } catch (x) {} entrar(); }
  else $('#err').textContent = 'Usuário ou senha incorretos.';
}
$('#login').onsubmit = e => { e.preventDefault(); tentarLogin(); };
$('#entrar').onclick = tentarLogin;
['#u', '#p'].forEach(s => $(s).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); tentarLogin(); } }));

const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.1 10.1 0 0 1 12 19c-6.4 0-10-7-10-7a18.5 18.5 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.4 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
$('#eye').innerHTML = EYE;
$('#eye').onclick = () => {
  const p = $('#p'), mostrar = p.type === 'password';
  p.type = mostrar ? 'text' : 'password';
  $('#eye').innerHTML = mostrar ? EYE_OFF : EYE;
  $('#eye').title = $('#eye').ariaLabel = mostrar ? 'Ocultar senha' : 'Mostrar senha';
  p.focus();
};
$('#pweye').innerHTML = EYE;
$('#pweye').onclick = () => {
  const mostrar = $('#pw1').type === 'password';
  ['#pw1', '#pw2'].forEach(s => $(s).type = mostrar ? 'text' : 'password');
  $('#pweye').innerHTML = mostrar ? EYE_OFF : EYE;
  $('#pweye').title = $('#pweye').ariaLabel = mostrar ? 'Ocultar senha' : 'Mostrar senha';
  $('#pw1').focus();
};
try { if (sessionStorage.getItem('auth') === '1') entrar(); } catch (e) {}

/* fechar o aviso de cancelamento sem confirmar desfaz a troca na tabela */
$('#canc').addEventListener('close', () => render());
