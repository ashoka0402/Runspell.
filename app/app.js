const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const icons={home:'<path d="m3 10 9-7 9 7v10H4V10m5 10v-7h6v7"/>',scenario:'<circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="m7 11 10-5M7 13l10 5"/>',runs:'<path d="M2 12h5l3-7 4 14 3-7h5"/>',apps:'<path d="M9 3H4v6h5V3Zm11 0h-6v6h6V3ZM9 14H4v6h5v-6Zm11 0h-6v6h6v-6Z"/>',team:'<circle cx="9" cy="8" r="3"/><path d="M2 20c0-4 3-6 7-6s7 2 7 6M16 5a3 3 0 0 1 0 6m2 4c2 .5 4 2 4 5"/>',data:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',billing:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h5"/>',learn:'<path d="m2 8 10-5 10 5-10 5L2 8Zm4 3v6c4 3 8 3 12 0v-6M22 8v9"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 2-1.5 3M12 17h.01"/>',settings:'<path d="M10 2h4l.5 2.3 2 .8 2-1.2 2.8 2.8-1.2 2 .8 2L23 11v4l-2.3.5-.8 2 1.2 2-2.8 2.8-2-1.2-2 .8L14 23h-4l-.5-2.3-2-.8-2 1.2-2.8-2.8 1.2-2-.8-2L1 15v-4l2.3-.5.8-2-1.2-2 2.8-2.8 2 1.2 2-.8L10 2Z"/><circle cx="12" cy="13" r="3"/>',search:'<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',moon:'<path d="M20 15A8 8 0 0 1 9 4a8 8 0 1 0 11 11Z"/>',bell:'<path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3Zm5 3a2 2 0 0 0 4 0"/>',plus:'<path d="M12 5v14M5 12h14"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',zap:'<path d="m13 2-9 11h7l-1 9 10-12h-7V2Z"/>',warning:'<path d="m12 3 10 18H2L12 3Zm0 7v5m0 3h.01"/>',spark:'<path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Zm7 14 .5 2 2 1-.5 1-2 1-.5 2-.5-2-2-1 2-1 .5-2Z"/>',arrow:'<path d="M4 12h16m-7-7 7 7-7 7"/>',menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',grid:'<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',close:'<path d="M5 5 19 19M19 5 5 19"/>',chevron:'<path d="m6 9 6 6 6-6"/>',check:'<path d="m4 12 5 5L20 6"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'};
function ic(name,size=18){return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.spark}</svg>`}
const sections=['overview','scenarios','runs','apps','team','data','billing','learn','help','settings'];
const state={route:'overview',filter:'All',status:'All',start:'All',query:'',view:'Cards',range:'30 days',expanded:false,menu:'',menuIndex:null,modal:'',zoom:1,faq:0,dark:false,notes:{},timer:0,runDetail:null,learnProgress:[6,5,2,0,0,1],academyExtra:0,toast:''};
const scenarios=[
 ['Weekly numbers → team chat','Orders','Paused','Mon 08:30',0,'—','☷ ◉ ✣ ▤'],['Daily payout → ledger','Finance','Paused','07:00 daily',0,'—','◷ ▰ □'],['New order → packing slip','Orders','Healthy','Instant',970,'just now','▣ ⤳ ▤ ▰'],['Low stock → reorder','Inventory','Healthy','1h',572,'1 min','▣ ☷ ✉ ▦'],['Review request after delivery','Customers','Warnings','Instant',458,'just now','▣ ✉ ◉'],['Wholesale lead → CRM','Customers','Healthy','Instant',56,'3 min','▤ ✣ ◉ ▣'],['Morning sales digest','Orders','Healthy','08:00 daily',24,'3 h','◷ ▣ ✣ ▤'],['Refund → credit note','Finance','Healthy','Instant',36,'2 min','▤ ▣ ✉'],['Abandoned cart nudge','Customers','Healthy','30m',128,'8 min','▣ ☷ ☎'],['Support form → ticket','Customers','Healthy','Instant',62,'12 min','▤ ◉ ▤'],['Paid invoice → thank-you','Finance','Healthy','Instant',231,'just now','▤ ✉ ▦'],['Weekly stock count sync','Inventory','Healthy','Mon 06:30',31,'2 d','◷ ▦ ▣'],['Courier exceptions → helpdesk','Orders','Failing','15m',31,'8 min','▰ ◉ ☎'],['Month-end invoice archive','Finance','Healthy','Monthly',34,'4 d','◷ ▤ ▦']];
const apps=[['Storefront','Commerce','Orders and customers','14 scenarios','▣'],['Mail','Communication','Send emails and updates','8 scenarios','✉'],['Sheets','Productivity','Read and write spreadsheet rows','5 scenarios','▦'],['Payments','Finance','Track payments and invoices','4 scenarios','▤'],['Schedule','Tools','Start scenarios on a schedule','4 scenarios','◷'],['Filter','Tools','Only pass matching data','3 scenarios','☷'],['Router','Tools','Split a scenario into paths','2 scenarios','⤳'],['Team chat','Communication','Post updates to your team','2 scenarios','▤'],['Courier','Logistics','Delivery and tracking events','2 scenarios','▰'],['CRM','Sales','Keep customer details in sync','2 scenarios','◉'],['SMS','Communication','Text your customers','2 scenarios','☎'],['AI writer','AI','Draft helpful messages','1 scenario','✣'],['Cloud files','Storage','Save and organize files','1 scenario','▤'],['Helpdesk','Support','Manage customer requests','1 scenario','◉'],['Ledger','Finance','Account for every payment','1 scenario','▤'],['Webhook','Tools','Receive events instantly','1 scenario','⤳']];
const scenarioTemplates = [
  ['New order → packing slip','Storefront','Cloud files'], ['Welcome a new customer','Webhook','Mail'],
  ['Low stock → reorder','Schedule','Sheets','Filter','Mail'], ['Send a weekly digest','Schedule','Team chat'],
  ['Abandoned cart nudge','Schedule','Storefront','SMS'], ['Archive paid invoices','Webhook','Payments','Cloud files'],
  ['A new support ticket','Webhook','Helpdesk'], ['Track a delivery','Schedule','Courier'],
];
const scenarioFolders = ['Orders','Customers','Inventory','Finance'];
function readDashboardRoute() {
  const [route, query] = location.hash.replace(/^#\//, '').split('?');
  const folder = new URLSearchParams(query).get('folder');
  return [route || 'overview', route === 'scenarios/all' && scenarioFolders.includes(folder) ? folder : 'All'];
}
function routeBase(){return state.route.split('/')[0]||'overview'}
function init(){[state.route,state.filter]=readDashboardRoute();applyDashboardPreferences();$('#app').innerHTML=`<div class="shell"><aside class="rail"><a class="logo" href="../" aria-label="Runspell - Back to home" title="Back to home">&#10095;&#10095;</a><div class="navitems"><div class="rail-pill" id="rail-pill"></div>${sections.slice(0,7).map(s=>navItem(s)).join('')}</div><div class="rail-bottom">${sections.slice(7).map(s=>navItem(s)).join('')}<button class="rail-mini" data-action="expand" title="Expand sidebar" aria-label="Expand sidebar" aria-expanded="false">◧</button><div class="avatar">NH</div></div></aside><header class="topbar"><button class="workspace" data-action="workspace" aria-expanded="false"><span class="initial">TF</span><span><strong>${escapeHTML(dashboardWorkspaceName())}</strong><small><i class="dot"></i> 11 scenarios live</small></span>${ic('chevron',14)}</button><button class="search-global" data-action="global-search">${ic('search')}<span>Search scenarios, runs, people...</span><kbd>⌘K</kbd></button><div class="top-actions"><a class="whitebtn m0-link" href="#/m0">M0 lab</a><button class="roundbtn" data-action="theme" aria-label="Switch theme">${ic('moon')}</button><button class="roundbtn" data-action="notifications" aria-label="Notifications" aria-expanded="false">${ic('bell')}<b class="badge">3</b></button><button class="roundbtn" data-route="settings" aria-label="Settings">${ic('settings')}</button><button class="blackbtn" data-action="newmenu" aria-expanded="false">${ic('plus')} New scenario</button></div></header><main class="main" id="main"><div class="page enter" id="page"></div></main><div id="floating"></div></div>`;renderPage(false);positionPill(false);openLinkedRun()}
function navItem(s){return `<a class="navitem ${routeBase()===s?'active':''}" data-nav="${s}" data-label="${title(s)}" href="#/${s}" aria-label="${title(s)}">${ic(s==='scenarios'?'scenario':s)}${s==='runs'?'<b class="badge">5</b>':s==='apps'?'<b class="badge">2</b>':''}</a>`}
function title(s){return s[0].toUpperCase()+s.slice(1)}
function positionPill(animate=true){const active=$(`.navitem[data-nav="${routeBase()}"]`),pill=$('#rail-pill');if(!active||!pill)return;const rail=$('.navitems'), top=active.getBoundingClientRect().top-rail.getBoundingClientRect().top;const old=parseFloat(pill.dataset.top||top);pill.dataset.top=top;if(animate){pill.style.setProperty('--travel-height',Math.abs(top-old)+50+'px');pill.classList.add('stretch');pill.style.transform=`translateY(${Math.min(old,top)}px)`;setTimeout(()=>{pill.classList.remove('stretch');pill.style.transform=`translateY(${top}px)`},120)}else pill.style.transform=`translateY(${top}px)`;$$('.navitem').forEach(el=>el.classList.toggle('active',el.dataset.nav===routeBase()))}
let pageTransition;
function navigate(route, filter) {
  if (state.route === route && state.filter === filter) return;
  clearTimeout(pageTransition);
  $('#page').classList.add('leave');
  Object.assign(state, {route, filter, status:'All', start:'All', query:'', view:'Cards', menu:'', modal:'', runDetail:null});
  floating();
  positionPill();
  pageTransition = setTimeout(() => {
    renderPage(true);
    openLinkedRun();
    window.scrollTo({top:0, behavior:'instant'});
  }, 230);
}

function openLinkedRun() {
  const run = /^runs\/history\/(\d+)$/.exec(state.route);
  if (run && runRecords[Number(run[1])]) {
    state.runDetail = runRecords[Number(run[1])];
    floating();
  }
}
function renderPage(enter=true){unmountM0Canvas();const page=$('#page');page.className='page'+(enter?' enter':'');const b=routeBase();document.title=`${state.route==='runs/recorder'?'Flight Recorder':title(b)} — Runspell`;page.innerHTML=({overview,scenarios:scenariosPage,runs:runsPage,apps:dashboardAppsPage,team:dashboardTeamPage,data:dashboardDataPage,billing:dashboardBillingPage,learn:learnPage,help:helpPage,settings:dashboardSettingsPage,m0:m0Page,studio:studioPage})[b]?.()||overview();if(b==='m0')mountM0Canvas();if(b==='studio')mountStudioCanvas();if(state.route==='runs/recorder')mountFlightRecorder();if(enter)setTimeout(()=>page.classList.remove('enter'),1400)}
function hero(label,metrics=[],actions=''){return `<div class="headerline reveal" style="--i:0"><h1>${label}</h1>${metrics.map(([icon,value,sub,lime])=>`<div class="hero-metric"><span class="bubble ${lime?'lime':''}">${ic(icon)}</span><span><b>${value}</b><small>${sub}</small></span></div>`).join('')}<div class="header-actions">${actions}</div></div>`}
function tabs(items,active){return `<div class="tabs reveal" style="--i:1">${items.map(([label,route,count])=>`<a class="tab ${state.route===route||active===route?'active':''}" href="#/${route}">${label}${count?` <b class="count">${count}</b>`:''}</a>`).join('')}</div>`}
function chips(items,key='filter'){return `<div class="chips">${items.map(([label,count])=>`<button class="chip ${state[key]===label?'active':''}" data-${key}="${label}">${label}${count!==undefined?` <b class="count">${count}</b>`:''}</button>`).join('')}</div>`}
function filterSearch(placeholder){return `<label class="filter-search">${ic('search',17)}<input data-search placeholder="${placeholder}" value="${escapeHTML(state.query)}"></label>`}
function escapeHTML(x){return String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function appDots(text='▣ ☷ ✉'){return `<span class="appdots">${text.split(' ').slice(0,4).map(x=>`<i>${x}</i>`).join('')}</span>`}
function spark(index,flat){const paths=['M0 18 C24 48 35 43 55 20 S85 28 105 25 S135 13 155 28 S185 35 205 20 S235 34 260 15','M0 14 C20 23 33 42 52 21 S78 11 96 25 S122 37 145 16 S175 40 195 26 S224 9 260 18','M0 27 C18 22 35 37 48 25 S73 6 90 22 S117 38 135 17 S162 11 180 32 S207 39 222 17 S242 18 260 17'];return `<svg class="spark" viewBox="0 0 260 50" preserveAspectRatio="none"><path d="${flat?'M0 44 H260':paths[index%3]}"/></svg>`}
function scenarioCard(s,i){const [name,folder,status,time,ops,last,dots]=s,paused=status==='Paused';return `<article class="card scenario-card ${paused?'paused':''} reveal" style="--i:${2+i%8}"><div class="cardtop">${appDots(dots)}<button class="more" data-action="cardmore" data-index="${i}" aria-expanded="false" aria-label="More for ${name}">${ic('more')}</button></div><h3><a href="#/scenarios/all/${i}">${i===2||i===3?'★ ':''}${name}</a></h3><div class="sub"><span class="status ${paused?'paused':status==='Warnings'?'warn':''}">${status}</span> &nbsp;${folder} · ${time}</div>${spark(i,paused||i===6)}<footer><div>${ops}<small>ops this month</small></div><div>${last}<small>last run</small></div><button class="switch ${paused?'':'on'}" aria-label="${name} live" role="switch" aria-checked="${!paused}" data-action="scenario-toggle" data-index="${i}"></button></footer></article>`}
function scenariosPage(){if(state.route.match(/^scenarios\/all\/\d+/))return scenarioDetail();const tab=state.route.split('/')[1]||'all';let filtered=scenarios.filter(s=>(state.filter==='All'||s[1]===state.filter)&&(state.status==='All'||s[2]===state.status||state.status==='Live'&&s[2]!=='Paused')&&s[0].toLowerCase().includes(state.query.toLowerCase()));let content=tab==='folders'?`<div class="scenario-grid">${scenarioFolders.map((f,i)=>`<a class="card app-card reveal" style="--i:${i+3}" href="#/scenarios/all?folder=${encodeURIComponent(f)}"><div class="appmark">${['▣','◉','☷','▤'][i]}</div><h3>${f}</h3><p>${scenarios.filter(s=>s[1]===f).length} scenarios</p><footer>View folder ${ic('arrow')}</footer></a>`).join('')}</div>`:tab==='templates'?`<div class="scenario-grid">${scenarioTemplates.map(([t,...modules],i)=>`<article class="card app-card reveal" style="--i:${i+3}"><div class="appmark">${['▣','✉','☷','✣'][i%4]}</div><h3><button class="template-title" data-action="use-template" data-index="${i}">${t}</button></h3><p>${modules.join(' → ')}</p><footer><span>Template</span><button class="whitebtn" data-action="use-template" data-index="${i}">Use template</button></footer></article>`).join('')}</div>`:state.view==='List'?table(['Scenario','Folder','Status','Operations','Last run',''],filtered.map((s,i)=>[`${appDots(s[6])} <a href="#/scenarios/all/${scenarios.indexOf(s)}"><b>${s[0]}</b></a>`,s[1],status(s[2]),s[4],s[5],`<button class="switch ${s[2]==='Paused'?'':'on'}" data-action="scenario-toggle" data-index="${scenarios.indexOf(s)}" role="switch" aria-checked="${s[2]!=='Paused'}" aria-label="${s[0]} live"></button>`])):`<div class="scenario-grid">${filtered.map(s=>scenarioCard(s,scenarios.indexOf(s))).join('')||'<div class="empty">No scenarios found.</div>'}</div>`;return `${hero('Scenarios',[['scenario','11','live of 14',true],['zap','2,603','operations this month'],['warning','1','Look scenario failing']],`<button class="whitebtn" data-route="scenarios/templates">${ic('spark')} From a template</button><button class="blackbtn" data-action="newscenario">${ic('plus')} New scenario</button>`)}${tabs([['All scenarios','scenarios/all',14],['Folders','scenarios/folders'],['Templates','scenarios/templates',8]],'scenarios/'+tab)}${tab==='all'?`<div class="filters reveal" style="--i:2">${filterSearch('Search scenarios')}${chips([['All',14],['Orders',4],['Customers',4],['Inventory',2],['Finance',4]])}<span class="spacer"></span><div class="segmented">${['All','Live','Paused','Failing'].map(x=>`<button data-status="${x}" class="${state.status===x?'active':''}">${x}</button>`).join('')}</div><div class="segmented"><button data-view="Cards" class="${state.view==='Cards'?'active':''}" aria-label="Cards">${ic('grid',15)}</button><button data-view="List" class="${state.view==='List'?'active':''}" aria-label="List">${ic('menu',15)}</button></div></div>`:''}${content}`}
function status(s){return `<span class="status ${s==='Paused'?'paused':s==='Warnings'||s==='Failed'||s==='Failing'?'warn':''}">${s}</span>`}
function table(head,rows,rowAttrs=[]){return `<div class="table-wrap reveal" style="--i:3"><table class="data-table"><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((row,i)=>`<tr ${rowAttrs[i]||''}>${row.map(cell=>`<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`}
const dailyOps=[374,340,257,249,388,366,390,346,347,253,237,359,347,388,404,408,234,263,444,400,430,400,421,230,258,404,413,383,445,697],dailyEvents=[260,235,177,168,272,247,282,215,236,173,172,239,232,277,282,288,154,177,313,276,284,258,276,162,178,268,295,257,298,668],dailyRuns=[100,91,67,66,102,100,102,92,92,66,62,95,92,103,105,107,62,70,118,104,113,108,112,62,68,109,110,102,115,182];function overview(){
 const start = state.range==='7 days' ? 23 : 0;
 const operations = dailyOps.slice(start);
 const sum = values => values.reduce((total, value) => total + value, 0);
 const total = sum(operations);
 const events = sum(dailyEvents.slice(start));
 const dateLabel = index => index < 24 ? `Oct ${8+index}` : `Nov ${index-23}`;
 return `<div class="overview-hero reveal" style="--i:0"><div><p class="eyebrow">Good morning, Noor</p><h1>11 <span class="bubble lime" style="display:inline-grid;vertical-align:middle;width:42px;height:42px;border-radius:50%;place-items:center">${ic('scenario')}</span> scenarios are running the shop<br>while you <span class="people"><i>NH</i><i>MJ</i><i>PR</i></span> plan the day</h1></div><div class="header-actions"><button class="whitebtn" data-route="runs/schedule">${ic('clock')} Up next</button><button class="limebtn" data-route="scenarios/templates">${ic('spark')} &nbsp;Templates</button></div></div><div class="overview-grid"><div><section class="card ops-card reveal" style="--i:1"><div class="ops-top"><div class="sectiontitle"><span class="circle">♧</span><div><h2>Operations</h2><p>Every module that runs spends one</p></div></div><div class="legend"><span><i></i> On a schedule</span><span><i></i> From events</span></div><div class="segmented">${['7 days','30 days'].map(r=>`<button data-range="${r}" class="${state.range===r?'active':''}">${r}</button>`).join('')}</div></div><div class="mini-stats"><div class="mini-stat dark"><small>Operations</small><b>${total.toLocaleString('en-US')}</b></div><div class="mini-stat"><small>Runs</small><b>${sum(dailyRuns.slice(start)).toLocaleString('en-US')}</b></div><div class="mini-stat"><small>From events</small><b>${Math.round(events / total * 100)}%</b></div><div class="mini-stat"><small>Scheduled ops</small><b>${(total-events).toLocaleString('en-US')}</b></div><div class="mini-stat"><small>Days over allowance</small><b style="color:#926f25">${operations.filter(count=>count>333).length}</b></div></div><div class="bars"><div class="daily-limit"><span>Daily allowance · 333</span></div><div class="bar-tooltip" id="bar-tooltip" role="status" aria-live="polite"></div>${operations.map((count,i)=>{const idx=start+i;const h=count/10;return `<div class="bar bar-fill" data-bar-index="${idx}" tabindex="0" aria-label="${dailyOps[idx]} operations on ${dateLabel(idx)}" style="--height:${h}%;--i:${i}"></div>`}).join('')}</div><div class="axis">${operations.map((_,i)=>i%(start?1:3)===0||i===operations.length-1?`<span>${dateLabel(start+i).split(' ')[1]}</span>`:'').join('')}</div></section><div class="below-grid"><section class="card list-card reveal" style="--i:4"><div class="sectiontitle"><span class="circle">⌁</span><div><h2>Live runs</h2><p><i class="dot"></i> Updating as they finish</p></div><a href="#/runs">History</a></div>${['New order → packing slip','Review request after delivery','Paid invoice → thank-you','Low stock → reorder'].map((x,i)=>`<div class="listrow"><span class="iconbox">✓</span><span><b>${x}</b><small>${i+3} ops · ${[435,121,45,75][i]} KB · event</small></span><time>${i?'1 min ago':'just now'}</time></div>`).join('')}</section><section class="card list-card reveal" style="--i:5"><div class="sectiontitle"><span class="circle">◷</span><div><h2>Up next</h2><p>Scheduled runs, soonest first</p></div><a href="#/runs/schedule">Timeline</a></div>${['Low stock → reorder','Abandoned cart nudge','Courier exceptions → helpdesk','Morning sales digest'].map((x,i)=>`<div class="listrow">${appDots('▣ ☷')}<span><b>${x}</b><small>${['1h · Priya','30m · Sofia','15m · Lerato','08:00 · Noor'][i]}</small></span><time>6:43</time></div>`).join('')}</section></div></div><div class="overview-side"><div class="usage-row reveal" style="--i:2"><div class="card usage"><div class="top">${ic('zap')} Operations <span>↗</span></div><strong>2,608 <small>/ 10k &nbsp; 26%</small></strong><div class="ticks">${Array.from({length:9},(_,i)=>`<i class="${i<2?'filled':''}"></i>`).join('')}</div></div><div class="card usage lime"><div class="top">${ic('data')} Data <span>↗</span></div><strong>122 <small>/ 512 MB &nbsp; 24%</small></strong><div class="ticks">${Array.from({length:9},(_,i)=>`<i class="${i<2?'filled':''}"></i>`).join('')}</div></div></div><div class="card forecast reveal" style="--i:3"><small><i class="dot"></i> Month-end forecast</small><h2>At this pace you’ll need <span style="color:var(--lime)">14k</span> operations</h2><p>The 10k run out around Nov 21. Paused scenarios don’t spend any.</p><div class="progress"><span></span></div><button class="whitebtn" data-route="billing">${ic('plus')} Add 5,000 · €9</button> <button class="whitebtn" data-route="billing">Plans →</button></div><div class="card list-card reveal" style="--i:6"><div class="sectiontitle"><span class="circle">⚠</span><div><h2>Needs you</h2><p>4 things to look at</p></div><a href="#/runs/incomplete">All</a></div>${['Courier tracking disconnected','Sheets expires Tue, Nov 10','Courier exceptions → helpdesk','Review request after delivery'].map((x,i)=>`<div class="listrow"><span class="iconbox">${i<2?'♧':'⚠'}</span><span><b>${x}</b><small>${['Tracking API · TF-PT-20418','ops@tallowandfern.co','4 failed · token expired','1 failed · mailbox full'][i]}</small></span><button class="blackbtn" style="padding:8px 12px;min-height:30px" ${i<2?`data-action="dashboard-connection" data-app="${i===0?'Courier':'Sheets'}"`:`data-action="retry-overview" data-name="${x}"`}>${i<2?'Reconnect':'Retry'}</button></div>`).join('')}</div></div></div>`}
const runRecords=Array.from({length:40},(_,i)=>{
 const names=['New order → packing slip','Review request after delivery','Paid invoice → thank-you','Low stock → reorder','Abandoned cart nudge','Wholesale lead → CRM'];
 return {index:i,id:`R-${89051-i}`,name:i===15?'Courier exceptions → helpdesk':i===20?'Review request after delivery':names[(i*7+1)%6],status:i===15?'Failed':i===20?'Warnings':'Succeeded',source:i%10===9?'Manual':i%8?'Event':'Schedule',ops:i%3+3,data:[95,32,435,121,45,334][i%6]+' KB',duration:(1.2+(i%5)*.7).toFixed(1)+'s',when:i<4?'just now':Math.floor(i/3)+' min ago'};
});
function runsPage(){
 const tab=state.route.split('/')[1]||'history';
 const needsAttention = runRecords.filter(run => run.status !== 'Succeeded' && !run.retried);
 const runTabs=tabs([['History','runs/history'],['Needs attention','runs/incomplete',needsAttention.length],['Up next','runs/schedule'],['Flight Recorder','runs/recorder']],'runs/'+tab);
 if(tab==='recorder')return hero('Flight Recorder')+runTabs+flightRecorderPage();
 let records=runRecords.filter(r=>(tab!=='incomplete'||needsAttention.includes(r))&&(state.start==='All'||r.source===state.start)&&(state.status==='All'||r.status===state.status)&&(!state.query||`${r.id} ${r.name}`.toLowerCase().includes(state.query.toLowerCase()))).sort((a,b)=>Number(Boolean(b.retryOf))-Number(Boolean(a.retryOf)) || (a.retryOf ? b.index-a.index : a.index-b.index));
 const rows=records.map(r=>[`<span class="subtle">${r.id}</span>`,`<span class="table-apps"><i>▣</i><i>✉</i></span> <span class="name">${r.name}</span>`,`<span class="subtle">${r.source} · ${r.ops} ops</span>`,status(r.status),r.ops,r.data,r.duration,`<span class="subtle">${r.when}</span>`]);
 const content=tab==='schedule'?`<div class="card wide-card reveal" style="--i:3"><h2>Up next</h2><p>Scheduled runs, soonest first</p>${scenarios.filter(s=>s[2]!=='Paused'&&s[3]!=='Instant').map((s,i)=>`<div class="listrow">${appDots(s[6])}<span><b>${s[0]}</b><small>${s[3]} · ${['Priya','Sofia','Noor'][i%3]}</small></span><time>${i<3?'6:43':'8:00 AM'}</time></div>`).join('')}</div>`:table(['Run','Scenario','Started by','Status','Ops','Data','Took','When'],rows,records.map(r=>`data-action="run-detail" data-index="${r.index}" tabindex="0" class="run-clickable" aria-label="Open details for ${r.id}, ${r.name}"`));
 return `${hero('Runs',[['runs','186','runs today',true],['warning','5','Retry waiting for you'],['clock','2.9s','average run']],`<button class="whitebtn" data-route="settings/alerts">${ic('bell')} Alert settings</button>`)}${runTabs}<p class="recorder-sample">Sample run data</p>${tab==='schedule'?'':`<div class="filters reveal" style="--i:2">${filterSearch('Search by run number or scenario')}${chips([['All',tab==='incomplete'?needsAttention.length:runRecords.length],...['Succeeded','Warnings','Failed'].map(value=>[value,(tab==='incomplete'?needsAttention:runRecords).filter(run=>run.status===value).length])],'status')}<span class="spacer"></span><select class="whitebtn" data-start aria-label="Started by">${[['All','Any start'],['Event','Events'],['Schedule','Schedules'],['Manual','By hand']].map(([value,label])=>`<option value="${value}" ${state.start===value?'selected':''}>${label}</option>`).join('')}</select></div>`}${tab!=='schedule'&&!records.length?'<p class="empty">No matching runs.</p>':content}`;
}
function runDrawer(){
 const r=state.runDetail,steps=r.name==='New order → packing slip'?[['Storefront','Watch new orders','▣'],['Router','Split by rule','⌁'],['Cloud files','Create a PDF','▤'],['Courier','Create a label','▰'],['Team chat','Post a message','▣']]:[['Storefront','Watch new event','▣'],['Filter','Check the details','☷'],['Mail','Send an update','✉'],['Sheets','Add a row','▦']].slice(0,r.ops);
 return `<div class="run-backdrop" data-action="close-run-backdrop"><aside class="run-panel" role="dialog" aria-modal="true" aria-label="${r.id} details"><header><div><h2>${r.id}</h2><p>${r.name} · ${r.retryOf?`Sample retry of ${r.retryOf}`:'Sample run'}</p></div><button data-action="close-run" aria-label="Close run details">${ic('close')}</button></header><div class="run-panel-body"><div class="run-summary"><div><small>Status</small><strong class="${r.status==='Succeeded'?'success':'warn-text'}">${r.status}</strong></div><div><small>Operations</small><strong>${r.ops}</strong></div><div><small>Took</small><strong>${r.duration}</strong></div></div><small class="run-label">STEP BY STEP</small><div class="run-steps">${steps.map(([app,action,mark])=>`<div class="run-step"><span class="run-step-icon">${mark}</span><span><strong>${app} · ${action}</strong><small>11:28 AM · 1 operation</small></span><span class="run-check">${ic('check',15)}</span></div>`).join('')}</div><dl class="run-metadata"><div><dt>Started by</dt><dd>${({Event:'An event (webhook)',Schedule:'A schedule',Manual:'By hand'})[r.source]}</dd></div><div><dt>Data moved</dt><dd>${r.data}</dd></div><div><dt>Started</dt><dd>${r.when}</dd></div></dl><div class="run-footer"><button class="whitebtn" data-action="open-run-scenario">${ic('scenario')} Open scenario</button>${r.status!=='Succeeded'&&!r.retried?'<button class="blackbtn" data-action="retry-run">Preview retry</button>':''}</div></div></aside></div>`;
}
const courses=[
 ['Basics','Your first scenario','Triggers, modules and a first run',6,24],
 ['Builder','Routers and filters','Send one bundle down the right path',8,41],
 ['Builder','Errors that fix themselves','Retries, fallbacks and incomplete runs',7,36],
 ['Advanced','Data stores as memory','Remember what a scenario has already done',9,52],
 ['Advanced','Webhooks without fear','Start a run from anything that can call a URL',5,28],
 ['Builder','AI steps that stay on script','Summaries and field extraction you can trust',6,33]
];
function learnPage(){
 const tab=state.route.split('/')[1]||'academy';
 const progress=state.learnProgress[1],percent=Math.round(progress/8*100);
 const academy=`<section class="academy-hero reveal" style="--i:2"><div class="progress-ring hero-ring" style="--p:${percent}"><span>${percent}%</span></div><div><small>Pick up where you left off</small><h2>Routers and filters</h2><p>Lesson ${Math.min(progress+1,8)} of 8 · Send one bundle down the right path</p></div><button class="limebtn" data-action="advance-course" data-index="1">▷ &nbsp; ${progress>=8?'Review':'Continue'}</button></section><div class="course-grid">${courses.map(([kind,name,desc,total,duration],i)=>{let done=state.learnProgress[i],pct=Math.round(done/total*100);return `<article class="card course-card reveal" style="--i:${i+3}"><div class="course-head"><span class="course-kind kind-${kind.toLowerCase()}">${kind}</span><span class="progress-ring" style="--p:${pct}"><span>${done}/${total}</span></span></div><h2>${name}</h2><p>${desc}</p><footer><span>${total} lessons · ${duration} min</span><button class="whitebtn" data-action="advance-course" data-index="${i}">${done>=total?'Review':done?'Continue':'Start'}</button></footer></article>`}).join('')}</div>`;
 return `${hero('Learn',[['learn',(34+state.academyExtra)+'%','of the Academy done',true],['help','5','community threads'],['team','6','partners near you']])}${tabs([['Academy','learn/academy'],['Community','learn/community'],['Partners','learn/partners'],['Blog','learn/blog'],['Use cases','learn/usecases']],'learn/'+tab)}${tab==='academy'?academy:`<div class="card wide-card reveal" style="--i:2"><h2>${title(tab.replace('-',' '))}</h2><p>Explore what’s new and learn from others building with Runspell.</p>${['Get inspired','See what the community is making','Find your next starting point'].map(x=>`<div class="settings-row"><strong>${x}</strong><a class="whitebtn" href="#/${x==='Find your next starting point'?'scenarios/templates':x==='Get inspired'?'learn/academy':'help'}">Explore →</a></div>`).join('')}</div>`}`;
}
const faqs=[['Operations','What counts as an operation?','Every module that runs spends one operation. Filters and routers count when they execute.'],['Operations','What happens when I run out?','Scenarios pause until the month renews or you add operations. Nothing is lost: events that arrive while paused wait for up to 30 days.'],['Runs','Why did a run stop halfway?','Open the run to see which module stopped and what it returned.'],['Runs','Can a scenario retry by itself?','Yes. Open the scenario and configure its error handling and retries.'],['Connections','Why do connections expire?','Some apps require a fresh authorization after a period of time.'],['Building','How do I send one order down two paths?','Add a router to split the flow, then set a filter on each path.'],['Team','Who can change the plan?','Workspace owners and admins can manage billing.'],['Data','Where do variables and secrets live?','They are stored with the workspace and can be used in scenarios.']];
function helpPage(){return `${hero('Help',[['check','All systems normal','checked a minute ago',true],['help','4 h','typical first reply']])}<div class="help-layout"><div class="card wide-card reveal" style="--i:1"><h2>How can we help?</h2><label class="filter-search" style="width:100%;margin:16px 0">${ic('search')}<input data-search placeholder="Search answers — try ‘expire’ or ‘operation’" value="${escapeHTML(state.query)}"></label>${faqs.filter(f=>f.join(' ').toLowerCase().includes(state.query.toLowerCase())).map(f=>{let i=faqs.indexOf(f);return `<div class="faq-item ${state.faq===i?'open':''}"><button data-faq="${i}"><span><small>${f[0]}</small>${f[1]}</span><span>${state.faq===i?'×':'+'}</span></button>${state.faq===i?`<p>${f[2]}</p>`:''}</div>`}).join('')}</div><div><div class="card wide-card reveal" style="--i:2"><h2>Status <span class="status" style="float:right">Operational</span></h2><p>The last 30 days</p>${['Scenario runner','Webhooks','Scheduler','App connections','Dashboard'].map((x,i)=>`<div class="settings-row"><span><strong>${x}</strong><small>99.${[93,92,95,99,96][i]}%</small></span><span style="display:flex;gap:2px">${Array.from({length:28},(_,j)=>`<i style="display:block;width:6px;height:28px;background:${i===0&&j===17?'#be6e4a':'#c9ef56'};border-radius:3px"></i>`).join('')}</span></div>`).join('')}</div><div class="card wide-card reveal" style="--i:3;margin-top:16px"><h2>Your tickets</h2><p>2 in total</p><div class="settings-row"><span><strong>Courier connection keeps expiring</strong><small>T-2093 · Connections · Yesterday, 8:42 AM</small></span>${status('Healthy')}</div><div class="settings-row"><span><strong>Invoice for September with VAT number</strong><small>T-1977 · Billing · Oct 3, 2026</small></span>Closed</div></div></div></div>`}
function scenarioDetail(){let idx=Number(state.route.split('/')[2]||2),s=scenarios[idx]||scenarios[2];return `${hero(s[0],[['scenario',s[2],s[1],true]],`<button class="whitebtn" data-route="scenarios">Back to scenarios</button><button class="blackbtn" data-action="openbuilder">Open builder →</button>`)}<div class="card wide-card reveal" style="--i:2"><h2>Scenario</h2><p>${s[1]} · ${s[3]}</p><div class="settings-row"><strong>Status</strong>${status(s[2])}</div><div class="settings-row"><strong>Operations this month</strong>${s[4]}</div><div class="settings-row"><strong>Last run</strong>${s[5]}</div></div>`}
function showDashboardSearch() {
  if (state.runDetail) return;
  state.menu = '';
  state.modal = 'search';
  floating();
  $('#dashboard-search').focus();
  renderDashboardSearch('');
}

function renderDashboardSearch(query) {
  const target = $('#dashboard-search-results');
  const term = query.trim().toLowerCase();
  if (!term) {
    target.innerHTML = '<p>Search by scenario name, run number, app, or person.</p>';
    return;
  }
  const groups = [
    ['Scenarios', scenarios.map(([name], i) => [name, `scenarios/all/${i}`])],
    ['Runs', runRecords.map(({id,name,index}) => [`${id} · ${name}`, `runs/history/${index}`])],
    ['Apps', apps.map(([name]) => [name])],
    ['People', dashboardPeople.map(name => [name, 'team/people'])],
  ];
  target.innerHTML = groups.map(([label, items]) => {
    const results = items.filter(([name]) => name.toLowerCase().includes(term)).slice(0, 5);
    if (!results.length) return '';
    return `<section><h3>${label}</h3>${results.map(([name, route]) => route
      ? `<a class="whitebtn" href="#/${route}" data-route="${route}">${escapeHTML(name)}</a>`
      : `<button class="whitebtn" data-action="appdetail" data-app="${escapeHTML(name)}">${escapeHTML(name)}</button>`).join('')}</section>`;
  }).join('') || '<p>No matching results.</p>';
}

let dashboardMenuAnchor;
let dashboardNotificationsUnread = true;
function toggleDashboardMenu(menu, anchor) {
  const close = state.menu === menu && dashboardMenuAnchor === anchor;
  state.menu = close ? '' : menu;
  dashboardMenuAnchor = close ? null : anchor;
  state.menuIndex = Number(anchor.dataset.index);
  state.modal = '';
  floating();
}

function floating() {
  document.querySelectorAll('[data-action="newmenu"],[data-action="workspace"],[data-action="notifications"],[data-action="cardmore"]').forEach(button => {
    button.setAttribute('aria-expanded', String(Boolean(state.menu) && button === dashboardMenuAnchor));
  });
  if (state.runDetail) { $('#floating').innerHTML = runDrawer(); return; }
  const scenario = scenarios[state.menuIndex];
  const menu = {
    newmenu: () => `<small>CREATE</small><button data-action="newscenario" data-focus="prompt">Build from a prompt</button><button data-action="newscenario">Blank scenario</button>${workflowDrafts.blank ? '<button data-action="resume-workflow">Resume saved draft</button>' : ''}<button data-route="scenarios/templates">From a template</button><hr><button data-action="invite">Invite people</button><button data-action="variable">New variable</button><button data-action="dashboard-webhook">New webhook</button>`,
    workspace: () => `<small>CURRENT WORKSPACE</small><strong class="dashboard-menu-title">${escapeHTML(dashboardWorkspaceName())}</strong><button data-route="overview">Workspace overview</button><button data-route="settings/workspace">Workspace settings</button><button data-route="team/people">Team members</button>`,
    notifications: () => `<small>NOTIFICATIONS</small><button data-route="runs/incomplete">Runs needing attention</button><button data-route="apps/connections">App connections</button><button data-route="settings/alerts">Alert settings</button>${dashboardNotificationsUnread?'<button data-action="mark-notifications-read">Mark all read</button>':'<span class="dashboard-menu-title">All caught up</span>'}`,
    cardmore: () => `<strong class="dashboard-menu-title">${scenario[0]}</strong><button data-route="scenarios/all/${state.menuIndex}">Scenario details</button><button data-action="edit-scenario" data-index="${state.menuIndex}">Open builder</button><button data-action="scenario-toggle" data-index="${state.menuIndex}">${scenario[2]==='Paused'?'Resume scenario':'Pause scenario'}</button>`,
  };
  let html = state.menu ? `<div class="menu dashboard-menu">${menu[state.menu]()}</div>` : '';
  if (state.modal === 'search') {
    html = `<div class="overlay" data-action="close-overlay"><div class="modal dashboard-search" role="dialog" aria-modal="true" aria-label="Search Runspell"><button data-action="close-modal" aria-label="Close" style="float:right;border:0;background:none">${ic('close')}</button><h2>Search Runspell</h2><label for="dashboard-search">Search</label><input id="dashboard-search" type="search" placeholder="Search scenarios, runs, people, and apps"><div id="dashboard-search-results" aria-live="polite"></div></div></div>`;
  } else if (state.modal) {
    html = dashboardSecondaryModal();
  }
  const floatingRoot = $('#floating');
  floatingRoot.innerHTML = html;
  const anchor = dashboardMenuAnchor;
  const popup = floatingRoot.querySelector('.dashboard-menu');
  if (popup && anchor?.isConnected) {
    const rect = anchor.getBoundingClientRect();
    popup.style.left = `${Math.max(8, Math.min(rect.right - popup.offsetWidth, innerWidth - popup.offsetWidth - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(rect.bottom + 7, innerHeight - popup.offsetHeight - 8))}px`;
  }
}

const pausedScenarioStatus = new Map();
function toggleDashboardScenario(index) {
  const scenario = scenarios[index];
  if (!scenario) return;
  if (scenario[2] === 'Paused') {
    scenario[2] = pausedScenarioStatus.get(index) || 'Healthy';
    pausedScenarioStatus.delete(index);
  } else {
    pausedScenarioStatus.set(index, scenario[2]);
    scenario[2] = 'Paused';
  }
  state.menu = '';
  floating();
  renderPage(false);
  showToast(`Sample scenario ${scenario[2]==='Paused'?'paused':'resumed'}.`);
}

function retryDashboardRun(run) {
  if (!run || run.status === 'Succeeded' || run.retried) return;
  run.retried = true;
  const retry = {...run, index: runRecords.length, id:`Preview-${runRecords.filter(record => record.retryOf).length + 1}`, retryOf:run.id, status:'Succeeded', source:'Manual', when:'just now'};
  runRecords.push(retry);
  state.runDetail = retry;
  renderPage(false);
  floating();
}

function closeDashboardRun() {
  state.runDetail = null;
  floating();
  if (/^runs\/history\/\d+$/.test(state.route)) location.replace('#/runs/history');
}

function act(el) {
  const action = el.dataset.action;
  const index = Number(el.dataset.index);
  if (dashboardSecondaryAction(el)) return;
  if (action.startsWith('workflow-')) { workflowAction(action,el); return; }
  switch (action) {
    case 'newmenu': case 'workspace': case 'notifications': case 'cardmore':
      toggleDashboardMenu(action, el); break;
    case 'global-search': showDashboardSearch(); break;
    case 'mark-notifications-read':
      dashboardNotificationsUnread = false;
      $('[data-action="notifications"] .badge').hidden = true;
      floating(); break;
    case 'close-modal': case 'close-overlay':
      state.modal = ''; floating(); break;
    case 'm0-mount': mountM0Canvas(); break;
    case 'm0-unmount': unmountM0Canvas(); break;
    case 'run-detail': state.runDetail = runRecords[index]; floating(); break;
    case 'close-run': case 'close-run-backdrop': closeDashboardRun(); break;
    case 'open-run-scenario': {
      const target = scenarios.findIndex(([name]) => name === state.runDetail?.name);
      state.runDetail = null; floating();
      location.hash = target < 0 ? '/scenarios/all' : `/scenarios/all/${target}`;
      break;
    }
    case 'retry-run': retryDashboardRun(state.runDetail); break;
    case 'retry-overview':
      state.runDetail = runRecords.find(run => run.name === el.dataset.name && run.retryOf) || runRecords.find(run => run.name === el.dataset.name && run.status !== 'Succeeded');
      floating(); break;
    case 'advance-course': {
      const done = state.learnProgress[index], total = courses[index][3];
      if (done < total) {
        state.learnProgress[index]++; state.academyExtra++; renderPage(false);
        showToast(`Lesson ${done+1} of ${total} done`);
      } else showToast('Course complete');
      break;
    }
    case 'newscenario':
      openWorkflow();
      if (el.dataset.focus === 'prompt') $('#workflow-prompt').focus();
      break;
    case 'use-template': openWorkflow(undefined, false, index); break;
    case 'resume-workflow': openWorkflow(undefined,true); break;
    case 'openbuilder': openWorkflow(Number(state.route.split('/')[2])); break;
    case 'edit-scenario': openWorkflow(index); break;
    case 'closebuilder': closeWorkflow(); break;
    case 'zoomin': case 'zoomout': case 'zoomreset':
      state.zoom = action === 'zoomreset' ? 1 : Math.max(.6, Math.min(1.5,state.zoom+(action==='zoomin'?.1:-.1)));
      $('#canvas-stage').style.setProperty('--zoom',state.zoom);
      $('.workflow-controls button:nth-child(2)').textContent = Math.round(state.zoom*100)+'%'; drawWorkflowLinks(); break;
    case 'scenario-toggle': toggleDashboardScenario(index); break;
    case 'expand':
      state.expanded = !state.expanded;
      $('.rail').classList.toggle('expanded',state.expanded);
      el.setAttribute('aria-expanded',String(state.expanded));
      el.title = state.expanded ? 'Collapse sidebar' : 'Expand sidebar';
      el.setAttribute('aria-label',el.title);
      el.textContent = state.expanded ? '×' : '◧'; break;
  }
}

document.addEventListener('click',e=>{
  const el=e.target.closest('[data-action],[data-route],[data-filter],[data-status],[data-view],[data-range],[data-faq]');
  if (state.menu && !e.target.closest('.dashboard-menu') && el !== dashboardMenuAnchor && !['workspace','notifications','newmenu','cardmore'].includes(el?.dataset.action)) {
    state.menu = ''; floating();
  }
  if (!el) return;
  if (['close-overlay','close-run-backdrop'].includes(el.dataset.action) && e.target!==el) return;
  if (el.dataset.action) { e.preventDefault(); act(el); return; }
  if (el.dataset.route) {
    e.preventDefault(); state.menu=''; state.modal=''; floating(); location.hash='/'+el.dataset.route; return;
  }
  if (el.dataset.filter) {
    state.filter=el.dataset.filter;
    if (routeBase()==='scenarios') {
      const query = state.filter === 'All' ? '' : `?folder=${encodeURIComponent(state.filter)}`;
      history.replaceState(null,'',`#/scenarios/all${query}`);
      state.route = 'scenarios/all';
    }
    renderPage(false); return;
  }
  if (el.dataset.status) { state.status=el.dataset.status; renderPage(false); return; }
  if (el.dataset.view) { state.view=el.dataset.view; renderPage(false); return; }
  if (el.dataset.range) {
    state.range=el.dataset.range; renderPage(false); $('#page').classList.add('range-update');
    setTimeout(()=>$('#page')?.classList.remove('range-update'),1800); return;
  }
  if (el.dataset.faq) { state.faq=state.faq===Number(el.dataset.faq)?-1:Number(el.dataset.faq); renderPage(false); }
});
document.addEventListener('input',e=>{
  if (e.target.id==='workflow-name') { workflow.name=e.target.value; return; }
  if (e.target.id==='dashboard-search') { renderDashboardSearch(e.target.value); return; }
  if (e.target.matches('[data-search]')) {
    state.query=e.target.value;
    const pos=e.target.selectionStart;
    renderPage(false);
    const input=$('[data-search]');
    input?.focus(); input?.setSelectionRange(pos,pos);
  }
});
document.addEventListener('change',e=>{
  if (e.target.matches('[data-start]')) { state.start=e.target.value; renderPage(false); $('[data-start]')?.focus(); }
});
document.addEventListener('submit',e=>{ if (dashboardSecondarySubmit(e.target)) e.preventDefault(); });
window.addEventListener('hashchange',()=>{ if($('#builder')) closeWorkflow(); navigate(...readDashboardRoute()); });
function showToast(message){document.querySelector('.learning-toast')?.remove();document.body.insertAdjacentHTML('beforeend',`<div class="learning-toast">${ic('check')} ${escapeHTML(message)}</div>`);setTimeout(()=>document.querySelector('.learning-toast')?.remove(),2600)}
window.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)&&e.target.matches('.run-clickable')){e.preventDefault();act(e.target)}if(e.key==='Escape'){state.modal='';state.menu='';closeDashboardRun();if(previewIndex!==null)workflowAction('workflow-run-close');else if(workflowPanel)workflowAction('workflow-panel-close')}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(!$('#builder'))showDashboardSearch()}});
function placeBarTooltip(bar){const box=$('.bars'),tip=$('#bar-tooltip');if(!box||!tip)return;const i=Number(bar.dataset.barIndex),ops=dailyOps[i],events=dailyEvents[i],runs=dailyRuns[i],scheduled=ops-events,day=i<24?`Oct ${8+i}`:`Nov ${i-23}`;tip.innerHTML=`<strong>${ops} ops</strong><b>${day}</b><span><i></i>${events} events · ${scheduled} scheduled</span><span>${runs} runs${ops>333?' · over the allowance':''}</span>`;tip.dataset.visible='true';const br=bar.getBoundingClientRect(),cr=box.getBoundingClientRect();const w=tip.offsetWidth,h=tip.offsetHeight;tip.style.left=`${Math.max(8,Math.min(br.left+br.width/2-cr.left-w/2,cr.width-w-8))}px`;tip.style.top=`${Math.max(8,br.top-cr.top-h-10)}px`;$$('.bar.is-hovered').forEach(x=>x.classList.remove('is-hovered'));bar.classList.add('is-hovered')}
document.addEventListener('pointerover',e=>{const bar=e.target.closest('.bar[data-bar-index]');if(bar)placeBarTooltip(bar)});
document.addEventListener('focusin',e=>{const bar=e.target.closest('.bar[data-bar-index]');if(bar)placeBarTooltip(bar)});
document.addEventListener('pointerout',e=>{const bar=e.target.closest('.bar[data-bar-index]');if(bar&&!bar.contains(e.relatedTarget)){bar.classList.remove('is-hovered');const tip=$('#bar-tooltip');if(tip)tip.dataset.visible='false'}});
document.addEventListener('focusout',e=>{if(e.target.matches('.bar[data-bar-index]')){e.target.classList.remove('is-hovered');const tip=$('#bar-tooltip');if(tip)tip.dataset.visible='false'}});
let m0CanvasLoading;
let canvasMountRequest=0;
function m0Page(){return `${hero('M0 compatibility lab')}<section class="card wide-card m0-intro"><p>This opt-in lab checks an isolated React Flow and GSAP renderer inside the existing workspace. It uses a validated fixture, does not save your changes, and cannot execute automation.</p><div class="m0-buttons"><button class="blackbtn" data-action="m0-mount">Mount canvas</button><button class="whitebtn" data-action="m0-unmount">Unmount canvas</button><a class="whitebtn" href="#/overview">Back to overview</a></div><p id="m0-mount-status" role="status">Loading renderer...</p></section><div id="m0-canvas-host"></div>`}
function studioPage(){return '<div id="studio-mount-status" role="status">Loading Prompt Studio...</div><div id="studio-host"></div>'}
function mountM0Canvas(){return mountWorkspaceCanvas('m0')}
function mountStudioCanvas(){return mountWorkspaceCanvas('studio')}
async function mountWorkspaceCanvas(kind){
  const host=$(kind==='m0'?'#m0-canvas-host':'#studio-host');
  const status=$(kind==='m0'?'#m0-mount-status':'#studio-mount-status');
  if(!host)return;
  const request=++canvasMountRequest;
  host.dataset.mountRequested='true';
  status.textContent='Loading renderer...';
  try{
    if(!window.RelayM0Canvas){
      m0CanvasLoading??=new Promise((resolve,reject)=>{
        const script=document.createElement('script');
        script.src='./m0-canvas/canvas.js';
        script.onload=resolve;
        script.onerror=()=>{script.remove();m0CanvasLoading=undefined;reject(new Error('Renderer bundle is missing. Run npm run build:canvas, then try again.'))};
        document.head.append(script);
      });
      await m0CanvasLoading;
    }
    if(request!==canvasMountRequest||!host.isConnected||routeBase()!==kind||host.dataset.mountRequested!=='true')return;
    if(!window.RelayM0Canvas)throw new Error('Renderer did not initialize. Rebuild the canvas and check the validation tests.');
    if(kind==='studio'){
      if(!window.RelayM0Canvas.mountStudio)throw new Error('Prompt Studio is missing from this build. Run npm run build and refresh.');
      window.RelayM0Canvas.mountStudio(host);
      status.textContent='';
    }else{
      window.RelayM0Canvas.mount(host);
      status.textContent='Canvas mounted. Offline fixture only; not executed.';
    }
  }catch(error){if(request===canvasMountRequest&&status.isConnected)status.textContent=error.message||'Renderer could not mount.'}
}
function unmountM0Canvas(){
  canvasMountRequest++;
  for(const selector of ['#m0-canvas-host','#studio-host']){
    const host=$(selector);
    if(host){host.dataset.mountRequested='false';window.RelayM0Canvas?.unmount(host)}
  }
  const status=$('#m0-mount-status');
  if(status)status.textContent='Canvas unmounted. Existing workspace drafts are unchanged.';
}

init();
