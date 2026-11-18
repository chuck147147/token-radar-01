(() => {
'use strict';
const D=window.RADAR, root=document.getElementById('app');
if(!D){root.textContent='Snapshot data is missing. Run main.ts and open the generated dashboard.';return;}
const M=D.methodology, P=new URLSearchParams(location.search);
const state={view:P.get('view')||'board',slug:P.get('slug'),category:P.get('category')??'all',chain:'all',verdict:'all',watch:P.get('watchlist')==='1',q:'',sort:'rank',dir:1};
const money=n=>n==null||!Number.isFinite(n)?'—':Math.abs(n)>=1e9?'$'+(n/1e9).toFixed(2)+'B':Math.abs(n)>=1e6?'$'+(n/1e6).toFixed(1)+'M':Math.abs(n)>=1e3?'$'+(n/1e3).toFixed(1)+'K':'$'+n.toFixed(0);
const exactMoney=n=>n.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:20,useGrouping:true});
const pct=n=>n==null?'—':(n>0?'+':'')+n.toFixed(2)+'%';
const times=n=>n==null||!Number.isFinite(n)?'—':n.toFixed(2)+'×';
const age=n=>n==null?'Unknown':n>=365?(n/365).toFixed(1)+'y':Math.round(n)+'d';
function el(tag,cls,text,...children){const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;children.flat().filter(Boolean).forEach(c=>n.append(c));return n;}
function button(text,fn,cls=''){const b=el('button',cls,text);b.type='button';b.onclick=fn;return b;}
function pill(v){return el('span','pill '+v,v);}
function go(view,slug){state.view=view;state.slug=slug;url();render();window.scrollTo(0,0);}
function url(){const p=new URLSearchParams();p.set('view',state.view);if(state.view==='detail'&&state.slug)p.set('slug',state.slug);if(state.category!=='all')p.set('category',state.category);if(state.watch)p.set('watchlist','1');history.replaceState(null,'','?'+p);}
function stat(label,value,unit,foot){return el('div','stat',null,el('div','stat-label',label),el('div','stat-value mono',null,document.createTextNode(value+' '),el('em','',unit)),el('div','stat-foot',foot));}
function shell(){const s=el('div','shell');s.append(el('header','top',null,el('div','brand',null,el('div','radar'),el('div','',null,el('strong','','UNMINTED'),el('small','','TOKEN LAUNCH RADAR'))),el('div','meta mono',null,el('span','tag',D.model_version),el('span','','SNAPSHOT / '+D.as_of),el('span','',null,el('i','dot'),document.createTextNode('OFFLINE RESEARCH')))));
if(state.view==='board'){
s.append(el('section','hero',null,el('div','',null,el('div','eyebrow','Discover before the ticker'),el('h1','','The next token starts here.'),el('p','',`A comparable-token lens on ${D.board_size} pre-token protocols. Find the signal, inspect the assumptions, and build a measured farm plan.`)),el('div','hero-note',null,el('b','','A research signal. A starting point.'),document.createTextNode('Implied values are estimates from traded peers. Rewards and token launches are unconfirmed.'))));
s.append(el('section','stats',null,stat('Protocols on radar',String(D.board_size),'scored',D.early_size+' early-stage additions'),stat('Watchlist coverage',D.rows.filter(r=>r.watchlist).length+' / '+D.watchlist_size,'','Floor, not ceiling'),stat('Calibration universe',String(M.calibration_n),'traded comps','Positive market cap & TVL'),stat('Cross-fit within 2×',(M.oos.within_2x_share*100).toFixed(1)+'%','','Pooled two-way cross-fit · n='+M.oos.n_validation),stat('Median |log₁₀ error|',M.oos.median_abs_log10_error.toFixed(3),'','Cross-fit pooled · wide dispersion')));
}
const nav=el('nav','nav');nav.setAttribute('aria-label','Dashboard views');[['board','Board',D.board_size],['live','Live tokens',D.live_size],['method','Methodology',null]].forEach(([v,label,n])=>{const b=button(label,()=>go(v),(state.view===v||(v==='board'&&state.view==='detail'))?'active':'');b.setAttribute('aria-current',b.className?'page':'false');if(n!=null)b.append(el('span','mono',n));nav.append(b);});s.append(nav);const main=el('main');main.id='content';s.append(main);s.append(el('footer','footer',null,el('span','','UNMINTED / Independent snapshot research'),el('span','mono',D.model_version+' · '+D.as_of+' · No live feeds')));root.replaceChildren(s);return main;}
function head(title,caption){return el('div','section-head',null,el('h2','',title),el('span','caption mono',caption));}
function selectField(label,values,value,change){const sel=el('select');values.forEach(([v,t])=>{const o=el('option','',t);o.value=v;sel.append(o);});sel.value=value;sel.setAttribute('aria-label',label);sel.onchange=()=>change(sel.value);return el('div','field',null,el('label','',label),sel);}
const categories=[...new Set(D.rows.map(r=>r.category))].sort((a,b)=>String(a).localeCompare(String(b)));
const chains=[...new Set(D.rows.flatMap(r=>r.chains))].sort();
function ratioCell(r){
  const ratio=r.implied_value_usd/r.tvl_usd;
  const median=r.category_median_ratio;
  const bar=el('span','ratio-track');
  if(median>0){
    bar.style.setProperty('--ratio',Math.min(100,50*ratio/median)+'%');
    bar.title=`${times(ratio)} implied / TVL · ${times(median)} peer median`;
    bar.setAttribute('aria-label',bar.title);
    bar.setAttribute('role','img');
  }
  return el('td','num',null,el('span','ratio-value',times(ratio)),median>0?bar:null);
}
function board(main){main.append(head('Pre-token board','DEFAULT RANK / IMPLIED VALUE'));const controls=el('div','filters');const search=el('input');search.type='search';search.placeholder='Search protocol or slug…';search.value=state.q;search.setAttribute('aria-label','Search protocol or slug');controls.append(el('div','field',null,el('label','','SEARCH'),search));
const refresh=()=>{url();update();};controls.append(selectField('CATEGORY',[['all','All categories'],...categories.map(c=>[c??'',c??'Uncategorized'])],state.category,v=>{state.category=v;refresh();}),selectField('CHAIN',[['all','All chains'],...chains.map(c=>[c,c])],state.chain,v=>{state.chain=v;refresh();}),selectField('VERDICT',[['all','All verdicts'],['farm','Farm'],['thin','Thin'],['skip','Skip']],state.verdict,v=>{state.verdict=v;refresh();}));const check=el('input');check.type='checkbox';check.checked=state.watch;check.onchange=()=>{state.watch=check.checked;refresh();};controls.append(el('label','check',null,check,document.createTextNode('Watchlist only')));main.append(controls);const target=el('div');main.append(target);search.oninput=()=>{state.q=search.value;update();};
function update(){const q=state.q.trim().toLowerCase();let rows=D.rows.filter(r=>(!q||r.name.toLowerCase().includes(q)||r.slug.toLowerCase().includes(q))&&(state.category==='all'||(r.category??'')===state.category)&&(state.chain==='all'||r.chains.includes(state.chain))&&(state.verdict==='all'||r.verdict===state.verdict)&&(!state.watch||r.watchlist));
const val=r=>state.sort==='ratio'?r.implied_value_usd/r.tvl_usd:state.sort==='chains'?r.chains.join(', '):r[state.sort];rows.sort((a,b)=>{let x=val(a),y=val(b);if(x==null)return y==null?a.rank-b.rank:1;if(y==null)return -1;return (typeof x==='string'?x.localeCompare(y):x-y)*state.dir||a.rank-b.rank;});
const cols=[['rank','Rank'],['name','Protocol'],['category','Category'],['chains','Chains'],['tvl_usd','TVL'],['change_7d','7d %'],['age_days','Age'],['implied_value_usd','Implied value'],['ratio','Implied / TVL'],['verdict','Verdict']];const table=el('table');const tr=el('tr');cols.forEach(([k,title],i)=>{const th=el('th',i>=4&&i<=8?'numeric':'');th.scope='col';th.setAttribute('aria-sort',state.sort===k?(state.dir===1?'ascending':'descending'):'none');th.append(button(title+(state.sort===k?(state.dir===1?' ↑':' ↓'):' ↕'),()=>{state.dir=state.sort===k?-state.dir:1;state.sort=k;update();}));tr.append(th);});table.append(el('thead','',null,tr));const body=el('tbody');rows.forEach(r=>{const row=el('tr');row.onclick=e=>{if(!e.target.closest('button'))go('detail',r.slug);};const name=button(r.name,()=>go('detail',r.slug));if(r.watchlist)name.append(el('span','wl','WATCHLIST'));name.append(el('span','slug',r.slug));row.append(el('td','rank mono',String(r.rank).padStart(2,'0')),el('td','',null,el('div','protocol',null,el('span','avatar',r.name.slice(0,2).toUpperCase()),name)),el('td','category',r.category||'Uncategorized'),el('td','chains',r.chains.join(' · ')||'—'),el('td','num',money(r.tvl_usd)),el('td','num '+(r.change_7d>=0?'pos':'neg'),pct(r.change_7d)),el('td','num',age(r.age_days)),el('td','num value',money(r.implied_value_usd)),ratioCell(r),el('td','',null,pill(r.verdict)));body.append(row);});table.append(body);const wrap=el('div','table-wrap board-table',null,table);if(!rows.length)wrap.append(el('div','empty','No protocols match these filters. Adjust your search to widen the radar.'));const note=el('div','table-note',null,el('span','mono',`${rows.length} of ${D.board_size} protocols · ${rows.filter(r=>r.watchlist).length} watchlist`),el('span','','Tick on each bar marks the peer median · select a protocol for valuation evidence'));note.setAttribute('aria-live','polite');target.replaceChildren(wrap,note);}
update();}
function live(main){main.append(head('The traded universe','MARKET VALUES / '+D.live_size+' DISPLAYED'),el('p','',`These protocols already trade, so we show the market’s own values. They belong to the calibration universe of ${M.calibration_n} comparable tokens; this table is its top-market-cap subset.`));const table=el('table');table.append(el('thead','',null,el('tr','',null,...['Protocol','Category','TVL','Market cap','mcap / TVL','7d %'].map(t=>el('th','',t)))));const body=el('tbody');D.live.forEach(r=>body.append(el('tr','',null,el('td','',r.name),el('td','category',r.category||'Uncategorized'),el('td','num',money(r.tvl_usd)),el('td','num value',money(r.mcap_usd)),el('td','num',times(r.mcap_usd==null?null:r.mcap_usd/r.tvl_usd)),el('td','num '+(r.change_7d>=0?'pos':'neg'),pct(r.change_7d)))));table.append(body);main.append(el('div','table-wrap',null,table));}
const thresholds='Farm requires ≥ $25M and percentile ≥ 0.75. Otherwise, thin requires ≥ $25M, or ≥ $8M and percentile ≥ 0.40. All other rows skip.';

function valuation(r){
  const fit=r.valuation_fit;
  const category=r.category||'Uncategorized';
  const ratio=r.implied_value_usd/r.tvl_usd;
  const categoryPeers=D.rows.filter(p=>p.category===r.category).length;
  const reference=categoryPeers>=5?category+' board rows':'whole-board rows (category has fewer than 5 rows)';
  const clause=r.verdict==='farm'?'Cleared $25M and the 0.75 percentile threshold.'
    :r.verdict==='thin'?(r.implied_value_usd>=25e6?'Cleared $25M. The percentile was below 0.75.':'Cleared $8M and the 0.40 percentile threshold.')
    :r.implied_value_usd<8e6?'Implied value fell below $8M.':'Implied value fell below $25M and the percentile was below 0.40.';
  const fitLabel=fit.global?`Global fit · ${M.calibration_n} comps`:`${category} fit`;
  const fitCount=`${fit.category_n} calibration comps in ${category}`;
  const fallback=fit.global&&fit.category_n<5?' · global fallback for categories with fewer than 5 calibration comps':'';
  const parameters=fit.a===null?'Median multiple':`a = ${fit.a.toFixed(4)} · b = ${fit.b.toFixed(4)}${fit.d===undefined?'':' · d = '+fit.d.toFixed(4)}`;
  const equation=fit.a===null?'TVL × base multiple':fit.d===undefined?'10ᵃ × TVLᵇ':'10^(a + d × log₁₀(1 + age in years)) × TVLᵇ';
  const factors=el('div','factors');
  for(const [label,value,note] of [
    ['Snapshot TVL',exactMoney(r.tvl_usd),'USD input'],
    ['Effective base multiple',r.base_multiple.toFixed(4)+'×',fitLabel],
    ['Implied token value',exactMoney(r.implied_value_usd),'Rounded to whole dollars'],
    ['Implied / TVL',ratio.toFixed(4)+'×',r.category_median_ratio.toFixed(4)+'× peer median'],
  ]){
    factors.append(el('div','factor',null,el('div','stat-label',label),el('b','mono',value),el('small','',note)));
  }
  const comps=el('table','comp-table',null,
    el('thead','',null,el('tr','',null,...['Traded protocol','TVL','Market cap','Mcap / TVL'].map(t=>el('th','',t)))),
    el('tbody','',null,...r.nearest_comps.map(c=>el('tr','',null,el('td','',c.name),el('td','num',exactMoney(c.tvl_usd)),
      el('td','num',exactMoney(c.mcap_usd)),el('td','num',c.mcap_tvl_ratio.toFixed(4)+'×')))));
  return el('section','panel valuation',null,el('h2','','Why this rank'),factors,
    el('p','fit',`${fitLabel} · ${fitCount}${fallback} · ${parameters}`),
    el('div','formula mono',`Implied = ${equation} × ${r.growth_multiplier} (growth) × ${r.maturity_multiplier} (maturity), rounded with a $1 minimum.`),
    el('div','banner '+r.verdict,null,el('strong','',`${r.verdict.toUpperCase()} · ${clause}`),
      el('p','basis',`Ratio percentile ${r.ratio_percentile.toFixed(4)} among ${r.reference_n} ${reference}. ${thresholds}`)),
    el('h3','','Valued against'),
    el('p','',`Nearest in log₁₀ TVL from ${fit.category_n>=5?'the '+category+' calibration pool':'the global calibration pool'}.`),
    el('div','table-wrap',null,comps));
}

function detail(main){
const r=D.rows.find(r=>r.slug===state.slug);
main.append(button('← Back to board',()=>go('board'),'back'));
if(!r){main.append(el('p','','Protocol not found in this snapshot.'));return;}
main.append(el('div','eyebrow','Board rank #'+r.rank),el('div','detail-title',null,el('h1','',r.name),
  r.watchlist?el('span','wl','WATCHLIST'):null,pill(r.verdict)),
  el('p','detail-meta',`${r.category||'Uncategorized'} · ${r.chains.join(' · ')} · ${r.slug}`),valuation(r));
const grid=el('div','grid');grid.style.marginTop='20px';const plan=el('section','panel',null,el('div','index','EXECUTION / 01'),el('h2','','The farm plan'),el('p','','Model-generated steps from this snapshot. Eligibility and rewards remain unconfirmed.'));const steps=el('ol','steps');(r.farm_steps||[]).forEach(s=>{const i=s.indexOf(' Cost:');steps.append(el('li','',null,document.createTextNode(i<0?s:s.slice(0,i)),i<0?null:el('span','step-cost',s.slice(i+1))));});plan.append(steps);const peers=el('section','panel',null,el('div','index','CONTEXT / 02'),el('h2','','Same category'),el('p','',r.category||'Uncategorized'));const list=D.rows.filter(p=>p.slug!==r.slug&&p.category===r.category).sort((a,b)=>a.rank-b.rank).slice(0,6);list.forEach(p=>{const b=button('',()=>go('detail',p.slug),'peer');b.append(el('span','',null,document.createTextNode(p.name),el('small','','#'+p.rank+' · '+money(p.tvl_usd)+' TVL')),el('span','mono value',money(p.implied_value_usd)+' →'));peers.append(b);});if(!list.length)peers.append(el('p','','No other board protocols in this category.'));grid.append(plan,peers);main.append(grid);}
function scatter(){const points=M.scatter.points,l=M.scatter.line,xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);const xmin=Math.min(...xs,l.x1),xmax=Math.max(...xs,l.x2),ymin=Math.min(...ys,l.y1,l.y2),ymax=Math.max(...ys,l.y1,l.y2);const x=v=>55+365*(v-xmin)/(xmax-xmin||1),y=v=>225-200*(v-ymin)/(ymax-ymin||1);const box=el('figure','scatter');box.innerHTML=`<svg viewBox="0 0 450 280" role="img" aria-label="Traded comps and global fit"><path d="M55 25V225H420" fill="none" stroke="currentColor"/><g fill="currentColor" font-size="10"><text x="55" y="243">${xmin.toFixed(2)}</text><text x="420" y="243" text-anchor="end">${xmax.toFixed(2)}</text><text x="48" y="225" text-anchor="end">${ymin.toFixed(2)}</text><text x="48" y="30" text-anchor="end">${ymax.toFixed(2)}</text><text x="235" y="270" text-anchor="middle">log10 TVL</text><text transform="translate(12 125) rotate(-90)" text-anchor="middle">log10 market cap</text></g><g fill="var(--mint)" opacity=".55">${points.map(p=>`<circle cx="${x(p[0])}" cy="${y(p[1])}" r="2.4"/>`).join('')}</g><path d="M${x(l.x1)} ${y(l.y1)}L${x(l.x2)} ${y(l.y2)}" stroke="var(--amber)" stroke-width="2"/></svg>`;box.append(el('figcaption','caption','Each dot is one traded comp; the line is the global fit.'));return box;}
function method(main){
main.append(head('Inside the model',M.model_version));
const grid=el('div','method');
function panel(title,...content){
  const p=el('section','panel',null,el('h2','',title),...content);
  grid.append(p);
  return p;
}
const sc=M.screened;
const reasons={category:'Category',versioned:'Versioned protocol',wrapped_or_staked_name:'Wrapped or staked name',exchange_prefix:'Exchange prefix'};
const funnel=el('ol','funnel',null,
  ...[[sc.tokenless_total,'Tokenless protocols'],[sc.excluded_total,'Excluded'],[sc.board_size,'Board rows']].map(([n,label])=>
    el('li','',null,el('strong','mono',n),el('span','',label))));
const excluded=el('dl','exclusions',null,...Object.entries(sc.by_reason).flatMap(([key,n])=>[
  el('dt','',reasons[key]),el('dd','mono',n),
]));
panel('Screening funnel',funnel,excluded,
  el('p','',`The sealed snapshot supplies the ${D.watchlist_size}-protocol watchlist. The board covers all ${D.watchlist_size}, plus ${D.early_size} early protocols. The watchlist TVL floor is ${money(D.floor_usd)}.`));
const winner=M.candidates.find(c=>c.id===M.winner_id);
const validation=panel('Two-way cross-fit selection',
  el('p','',`${M.candidates.length} candidates evaluated · Production: ${M.selected_id}`),
  el('div','selection-metrics',null,
    stat('OOS median |log₁₀ error|',M.oos.median_abs_log10_error.toFixed(4),'',''),
    stat('OOS within 2×',(M.oos.within_2x_share*100).toFixed(1)+'%','','')),
  el('p','',`Grid winner: ${winner.id} · ${winner.median_abs_log10_error.toFixed(4)} median error · ${(winner.within_2x_share*100).toFixed(1)}% within 2×.`),
  el('p','',M.selection_note));
const candidates=el('table','candidates',null,el('thead','',null,el('tr','',null,...['Candidate','Median |log₁₀ error|','Within 2×'].map(t=>el('th','',t)))),el('tbody','',null,...M.candidates.map(c=>el('tr',c.id===M.selected_id?'selected':'',null,el('td','',c.id+(c.id===M.selected_id?' · selected':'')),el('td','num',c.median_abs_log10_error.toFixed(4)),el('td','num',(c.within_2x_share*100).toFixed(2)+'%')))));
validation.append(el('details','',null,el('summary','',`All ${M.candidates.length} candidates`),
  el('p','',`Comps are sorted by slug into alternating halves. Each candidate fits one half and predicts the other, then swaps. All ${M.oos.n_validation} errors are pooled. Candidates within 0.005 of the lowest median error are compared by within-2× share.`),
  el('div','table-wrap',null,candidates)));
panel('Traded calibration comps',el('p','',`${M.calibration_n} positive-cap, positive-TVL comps. ${M.calibration_excluded_nonpositive} nonpositive recorded market caps excluded.`),scatter());
const cal=panel('From TVL to implied value',el('p','',M.form_label),el('div','formula mono',M.formula_text),
  el('p','',M.global_fallback),el('p','',`Rounded to whole dollars with a $1 minimum. Unknown growth is 0%; unknown age uses the median calibration age (${M.default_age_days} days). The table shows effective multiples at ${money(M.ref_tvl_usd)} TVL.`));
const table=el('table',null,null,el('thead','',null,el('tr','',null,...['Category','n','Slope b','Effective multiple'].map(t=>el('th','',t)))),
  el('tbody','',null,...M.categories.map(c=>el('tr','',null,el('td','',c.category),el('td','num',c.n),el('td','num',c.b===null?'—':c.b.toFixed(4)),el('td','num value',times(c.multiple))))));
cal.append(el('details','',null,el('summary','','Category fits'),el('div','table-wrap',null,table)));
panel('A verdict with explicit thresholds',el('p','',thresholds),el('p','','Positions come from this board’s own distribution, using the whole board when a category has fewer than five rows. There are no quotas. The verdict prioritizes research and small trials. It does not establish a token launch, rewards eligibility, or a positive return.'));
panel('What the snapshot cannot tell us',el('p','','Snapshot-only data. There are no revenue or user fields, no forward cash flows, and no direct evidence of token plans. TVL can be temporary, recursive, or exposed to asset-price moves.'),el('p','','Implied value is a comps estimate, not a prediction. Farm costs are illustrative, capital is at risk, and rewards remain unconfirmed.'),el('p','','Snapshot source: '+D.source));main.append(grid);}
function render(){const main=shell();if(state.view==='detail')detail(main);else if(state.view==='live')live(main);else if(state.view==='method')method(main);else{state.view='board';board(main);}}
render();
})();
