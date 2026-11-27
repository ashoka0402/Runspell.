const dashboardPreferenceKey = 'runspell.dashboard.preferences';
const dashboardSystemTheme = matchMedia('(prefers-color-scheme: dark)');
const dashboardPeople = ['Noor Haddad','Priya Raman','Sofia Mendes','Lerato Ndlovu','Mateo Jensen','Maya Li','Alex Chen','Sam Brooks','Eva Moreau'];
const dashboardTeamNames = ['Operations','Growth','Customer care','Finance'];
const dashboardStores = [['Orders','2,840','13 MB','Today'],['Customers','1,260','8 MB','Today'],['Inventory','410','2 MB','Yesterday']];
const dashboardInvoices = [['INV-2026-11','Nov 1, 2026','€39.00'],['INV-2026-10','Oct 1, 2026','€39.00'],['INV-2026-09','Sep 1, 2026','€39.00']];
const dashboardDefaultPreferences = {
  name:'Tallow & Fern', timeZone:'Europe/Lisbon', weekStart:'Monday', historyRange:'30 days',
  theme:'light', compact:false, alerts:[true,true,true,true,true,false], variables:[], invites:[],
};
const dashboardPlans = {
  Free:['€0', 'Starter allowance for trying out workflows.'],
  Starter:['€19', 'Monthly plan for a small workspace.'],
  Scale:['€99', 'Higher allowances for a growing workspace.'],
};
let dashboardPreferences = structuredClone(dashboardDefaultPreferences);
let dashboardDialog = null;
try {
  const saved = JSON.parse(localStorage.getItem(dashboardPreferenceKey));
  if (saved && typeof saved === 'object') Object.assign(dashboardPreferences, saved);
} catch {}

function dashboardWorkspaceName() {
  return dashboardPreferences.name;
}

function dashboardTeamFilter() {
  const index = state.route.split('/')[2];
  return index === undefined ? '' : dashboardTeamNames[Number(index)] || '';
}

function applyDashboardPreferences() {
  state.dark = dashboardPreferences.theme === 'dark' || (dashboardPreferences.theme === 'system' && dashboardSystemTheme.matches);
  document.body.classList.toggle('darkmode', state.dark);
  document.body.classList.toggle('compact-tables', dashboardPreferences.compact);
}

dashboardSystemTheme.addEventListener('change', applyDashboardPreferences);

function saveDashboardPreferences(next) {
  try {
    localStorage.setItem(dashboardPreferenceKey, JSON.stringify(next));
    dashboardPreferences = next;
    return true;
  } catch {
    showToast('Could not save changes on this device.');
    return false;
  }
}

function dashboardSelect(label, name, choices, selected) {
  return `<label>${label}<select name="${name}">${choices.map(choice => `<option${choice===selected?' selected':''}>${escapeHTML(choice)}</option>`).join('')}</select></label>`;
}

function dashboardDownload(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openDashboardDialog(kind, title, content, form = '', submit = 'Save') {
  dashboardDialog = {kind, title, content, form, submit};
  state.menu = false;
  state.modal = 'dashboard-secondary';
  floating();
  document.querySelector('#floating .modal input, #floating .modal button')?.focus();
}

function dashboardSecondaryModal() {
  if (state.modal !== 'dashboard-secondary' || !dashboardDialog) return '';
  const {title, content, form, submit} = dashboardDialog;
  return `<div class="overlay" data-action="close-overlay"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="dashboard-dialog-title">
    <button type="button" data-action="close-modal" aria-label="Close" style="float:right;border:0;background:none">${ic('close')}</button>
    <h2 id="dashboard-dialog-title">${escapeHTML(title)}</h2>
    ${form ? `<form data-dashboard-form="${form}">${content}<p data-dashboard-error role="alert"></p><div class="modal-actions">
      <button type="button" class="whitebtn" data-action="close-modal">Cancel</button><button type="submit" class="blackbtn">${submit}</button>
    </div></form>` : `${content}<div class="modal-actions"><button type="button" class="blackbtn" data-action="close-modal">Done</button></div>`}
  </div></div>`;
}

function openDashboardVariable(row) {
  if (row && !dashboardPreferences.variables.includes(row)) {
    openDashboardDialog('sample', row[0], `<p>${escapeHTML(row[2])} variable · ${escapeHTML(row[3])}</p><p>${escapeHTML(row[1])}</p><p>This sample variable is read-only.</p>`);
    return;
  }
  openDashboardDialog('variable', row ? 'Edit variable' : 'New variable', `<p>Store a local text or number value.</p>
    <label>Name<input name="name" value="${escapeHTML(row?.[0] ?? '')}" pattern="[A-Za-z][A-Za-z0-9_]*" maxlength="80" required></label>
    <label>Value<input name="value" value="${escapeHTML(row?.[1] ?? '')}" maxlength="500" required></label>
    ${dashboardSelect('Type','type',['Text','Number'],row?.[2])}`, 'variable', 'Save variable');
  dashboardDialog.original = row?.[0];
}

function dashboardSecondaryAction(el) {
  const {action, app, store, plan, invoice, topic, team, variable, index} = el.dataset;
  switch (action) {
    case 'appdetail':
    case 'dashboard-app':
    case 'dashboard-connection': {
      const row = apps.find(entry => entry[0] === app);
      if (!row) return true;
      const managing = action === 'dashboard-connection';
      const health = apps.indexOf(row) === 3 ? 'Needs attention' : 'Healthy';
      openDashboardDialog(action, managing ? `${app} connection` : app, `<p>${escapeHTML(row[2])} · ${escapeHTML(row[3])}</p>
        ${managing ? `<p>Sample status: ${health}. Connecting an account requires the live integration.</p>` : '<p>View the workspace connection list to inspect sample connections.</p><button class="whitebtn" data-route="apps/connections">Connections</button>'}`);
      return true;
    }
    case 'dashboard-webhook':
      openDashboardDialog(action, 'New webhook', '<p>Creating webhook endpoints requires the live execution service.</p><button class="whitebtn" data-route="apps/webhooks">View sample webhooks</button>');
      return true;
    case 'dashboard-team':
      location.hash = '/team/people/' + dashboardTeamNames.indexOf(team);
      return true;
    case 'invite':
      openDashboardDialog(action, 'Draft invite', `<p>Save an invite draft on this device. No email will be sent.</p>
        <label>Email<input type="email" name="email" maxlength="254" required></label>
        ${dashboardSelect('Team','team',dashboardTeamNames)}${dashboardSelect('Role','role',['Member','Admin','Viewer'])}`, 'invite', 'Save draft');
      return true;
    case 'variable':
      openDashboardVariable();
      return true;
    case 'dashboard-variable': {
      const row = [...dashboardSampleVariables, ...dashboardPreferences.variables].find(entry => entry[0] === variable);
      if (row) openDashboardVariable(row);
      return true;
    }
    case 'dashboard-store': {
      const row = dashboardStores.find(entry => entry[0] === store);
      if (row) openDashboardDialog(action, row[0], `<p>${row[1]} sample records · ${row[2]}</p><p>Last updated ${row[3].toLowerCase()}. Record browsing requires the live data store.</p>`);
      return true;
    }
    case 'dashboard-plan': {
      const option = dashboardPlans[plan];
      if (option) openDashboardDialog(action, plan, `<p>${option[0]} per month. ${option[1]}</p><p>Plan changes require live billing.</p>`);
      return true;
    }
    case 'dashboard-billing':
      openDashboardDialog(action, topic, '<p>This workspace uses sample billing data. A live billing account is required to make changes or purchases.</p>');
      return true;
    case 'dashboard-invoice': {
      const row = dashboardInvoices.find(entry => entry[0] === invoice);
      if (row) dashboardDownload(invoice + '-sample.txt', `Runspell — sample invoice\n${row[0]}\nDate: ${row[1]}\nAmount: ${row[2]}\nStatus: paid\n`, 'text/plain;charset=utf-8');
      return true;
    }
    case 'theme':
    case 'light':
    case 'dark':
    case 'system': {
      const theme = action === 'theme' ? (state.dark ? 'light' : 'dark') : action;
      if (saveDashboardPreferences({...dashboardPreferences, theme})) {
        applyDashboardPreferences();
        if (routeBase() === 'settings') renderPage(false);
      }
      return true;
    }
    case 'dashboard-alert':
    case 'dashboard-compact': {
      const next = {...dashboardPreferences};
      if (action === 'dashboard-alert') next.alerts = next.alerts.map((on, i) => i === Number(index) ? !on : on);
      else next.compact = !next.compact;
      if (saveDashboardPreferences(next)) {
        applyDashboardPreferences();
        renderPage(false);
      }
      return true;
    }
    case 'dashboard-export': {
      const {variables, invites, ...preferences} = dashboardPreferences;
      const workspace = {preferences, variables, invites, people: dashboardPeople, scenarios, runs: runRecords};
      dashboardDownload('runspell-workspace.json', JSON.stringify(workspace, null, 2), 'application/json');
      return true;
    }
    case 'dashboard-reset':
      openDashboardDialog(action, 'Reset local dashboard data', '<p>This restores dashboard preferences and removes local variable and invite drafts.</p>', 'reset', 'Reset local data');
      return true;
    default:
      return false;
  }
}

function dashboardSecondarySubmit(form) {
  const type = form.dataset.dashboardForm;
  if (!type) return false;
  const fields = new FormData(form);
  const value = name => String(fields.get(name) ?? '').trim();
  const next = {...dashboardPreferences};
  let target = '', feedback = '';
  if (type === 'workspace') {
    if (!value('name')) { form.elements.namedItem('name').setCustomValidity('Enter a workspace name.'); form.elements.namedItem('name').reportValidity(); form.elements.name.setCustomValidity(''); return true; }
    Object.assign(next, {name:value('name'), timeZone:value('timeZone'), weekStart:value('weekStart'), historyRange:value('historyRange')});
    feedback = 'Workspace preferences saved.';
  } else if (type === 'invite') {
    const email = value('email').toLowerCase();
    if (next.invites.some(invite => invite.email === email)) {
      form.querySelector('[data-dashboard-error]').textContent = 'An invite draft already exists for that email.';
      return true;
    }
    next.invites = [...next.invites, {email, team:value('team'), role:value('role')}];
    target = 'team/people';
    feedback = 'Invite draft saved on this device.';
  } else if (type === 'variable') {
    const name = value('name').toUpperCase();
    const content = value('value'), kind = value('type');
    const original = dashboardDialog.original;
    const duplicates = dashboardSampleVariables.some(row => row[0] === name) || next.variables.some(row => row[0] === name && row[0] !== original);
    if (!name || !content || duplicates || (kind === 'Number' && !Number.isFinite(Number(content)))) {
      form.querySelector('[data-dashboard-error]').textContent = duplicates ? 'A variable already uses this name.' : 'Enter a unique name and a valid value for its type.';
      return true;
    }
    next.variables = [...next.variables.filter(row => row[0] !== original), [name, content, kind, 'Workspace', 'Today']];
    target = 'data/variables';
    feedback = 'Local variable saved.';
  } else if (type === 'reset') {
    Object.assign(next, structuredClone(dashboardDefaultPreferences));
    feedback = 'Local dashboard data reset.';
  }
  if (!saveDashboardPreferences(next)) return true;
  state.modal = '';
  applyDashboardPreferences();
  floating();
  const workspaceName = document.querySelector('.workspace strong');
  if (workspaceName) workspaceName.textContent = dashboardWorkspaceName();
  if (target && state.route !== target) location.hash = '/' + target;
  else renderPage(false);
  showToast(feedback);
  return true;
}

const dashboardSampleVariables = [['STORE_ID','tf-pune-001','Text','Workspace','Today'],['ORDER_NOTIFICATION_CHANNEL','#new-orders','Text','Workspace','Yesterday'],['COURIER_API_KEY','••••••••••••••••','Secret','Workspace','2 days ago'],['SUPPORT_EMAIL','help@tallowandfern.co','Text','Workspace','4 days ago'],['MIN_STOCK_LEVEL','12','Number','Workspace','Oct 29'],['CURRENCY','EUR','Text','Workspace','Oct 20'],['CRM_TOKEN','••••••••••••••••','Secret','Workspace','Oct 12'],['WEBHOOK_URL','https://example.com/hook','Text','Workspace','Oct 3']];

function dashboardAppsPage(){const tab=state.route.split('/')[1]||'installed',cats=['All','Commerce','Communication','Productivity','Finance','Tools','Logistics','Sales','AI','Storage','Support'];let filtered=apps.filter(a=>(state.filter==='All'||a[1]===state.filter)&&a[0].toLowerCase().includes(state.query.toLowerCase()));return `${hero('Apps',[['apps','18','installed of 23',true],['warning','2','connections to fix'],['zap','4,102','webhook calls this month']])}${tabs([['Installed apps','apps/installed',18],['Connections','apps/connections'],['Webhooks','apps/webhooks']],'apps/'+tab)}<div class="filters reveal" style="--i:2">${filterSearch('Search apps')}${chips(cats.map(c=>[c]))}</div>${tab==='connections'?table(['App','Connection','Status','Used in',''],filtered.filter(a=>apps.indexOf(a)<12).map(a=>[`${a[4]} <b>${a[0]}</b>`,`ops@tallowandfern.co`,status(apps.indexOf(a)===3?'Warnings':'Healthy'),a[3],`<button class="whitebtn" data-action="dashboard-connection" data-app="${a[0]}">Manage</button>`])):tab==='webhooks'?table(['Name','App','Status','Calls this month','Last call'],['Order created','Payment received','Customer updated','Delivery exception'].map((x,i)=>[x,apps[i][0],status('Healthy'),[1422,858,531,91][i],'just now']).filter(row=>row.slice(0,2).some(value=>value.toLowerCase().includes(state.query.toLowerCase())) && (state.filter==='All'||apps.find(app=>app[0]===row[1])?.[1]===state.filter))):`<div class="app-grid">${filtered.map((a,i)=>`<article class="card app-card reveal" style="--i:${3+i%8}"><div class="appmark">${a[4]}</div><h3>${a[0]}</h3><p>${a[2]}</p><footer><span>${a[3]}</span><button class="whitebtn" data-action="dashboard-app" data-app="${a[0]}">Open →</button></footer></article>`).join('')}</div>`}`}

function dashboardTeamPage(){
 const tab=state.route.split('/')[1]||'organization';
 const people=dashboardPeople;
 const changes=[['Noor','Weekly numbers → team chat','31 min ago','NH'],['Noor','Daily payout → ledger','31 min ago','NH'],['Mateo','New order → packing slip','Yesterday, 12:00 AM','MA'],['Priya','Low stock → reorder','Sun, 11:00 PM','PR'],['Aiyana','Review request after delivery','Oct 29, 2026','AB'],['Aiyana','Wholesale lead → CRM','Oct 26, 2026','AB']];
 const organization=`<div class="team-grid">
  <section class="card team-workspace reveal" style="--i:2"><div class="team-workspace-head"><div class="team-logo">TF</div><div><h2>${escapeHTML(dashboardWorkspaceName())}</h2><p>Candles & home fragrance · Lisbon · on Runspell since Oct 14, 2025</p></div><button class="whitebtn" data-route="settings/workspace">✎ &nbsp; Edit</button></div><div class="team-facts"><div><small>Plan</small><strong>Core</strong></div><div><small>Seats</small><strong>10 / 10</strong></div><div><small>Teams</small><strong>4</strong></div><div><small>Scenarios</small><strong>14</strong></div></div><div class="seat-track"><span></span></div><small>9 active · 1 invited · 0 free</small></section>
  <section class="card team-ops reveal" style="--i:3"><h2>Operations by team</h2><p>Who the month’s work belongs to</p><div class="team-stack" aria-label="Operations by team: Operations 2057, Growth 851, Customer care 169, Finance 264"><span style="width:61.6%"></span><span style="width:25.5%"></span><span style="width:5.1%"></span><span style="width:7.8%"></span></div><div class="team-legend"><span>Operations · 2,057</span><span>Growth · 851</span><span>Customer care · 169</span><span>Finance · 264</span></div></section>
  <section class="card team-heat-card reveal" style="--i:4"><h2>When the team builds</h2><p>Edits to scenarios, last 4 weeks</p><div class="heatmap-grid"><span></span>${['6a','8a','10a','12p','2p','4p','6p','8p','10p'].map(x=>`<span class="heat-hour">${x}</span>`).join('')}${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day,d)=>`<span class="heat-day">${day}</span>${Array.from({length:9},(_,h)=>`<span class="heat-cell" style="--shade:${d>4?.24:[.42,.68,.58,.75,.77,.9,.35,.48,.51][(h+d*3)%9]}"></span>`).join('')}`).join('')}</div></section>
  <section class="card team-changes reveal" style="--i:5"><h2>Recent changes</h2><p>The audit log</p>${changes.map(([who,what,when,initial])=>`<a href="#/scenarios" class="team-change"><span class="team-person">${initial}</span><span>${who} edited ${what}<small>${when}</small></span></a>`).join('')}</section>
 </div>`;
 return `${hero('Team',[['team',people.length,'people',true],['runs','0','online in the last hour'],['team',dashboardPreferences.invites.length,'local invite drafts']],`<button class="blackbtn" data-action="invite">${ic('plus')} Invite people</button>`)}${tabs([['Organization','team/organization'],['Teams','team/teams'],['People','team/people',people.length+dashboardPreferences.invites.length],['Roles','team/roles']],'team/'+tab)}${tab==='organization'?organization:tab==='people'?table(['Person','Role','Team','Status','Last active'],people.flatMap((p,i)=>!dashboardTeamFilter().length || dashboardTeamFilter()===dashboardTeamNames[i%4] ? [[`<b>${p}</b>`,i===0?'Owner':'Member',['Operations','Growth','Customer care','Finance'][i%4],status('Healthy'),i<3?'Online':'Yesterday']] : []).concat(dashboardPreferences.invites.filter(invite=>!dashboardTeamFilter().length||dashboardTeamFilter()===invite.team).map(invite=>['<b>'+escapeHTML(invite.email)+'</b>',escapeHTML(invite.role),escapeHTML(invite.team),'Draft','Not sent']))):tab==='teams'?`<div class="app-grid">${dashboardTeamNames.map((x,i)=>`<article class="card app-card reveal" style="--i:${i+3}"><div class="appmark">${['⚙','✦','◉','▤'][i]}</div><h3>${x}</h3><p>${i+2} people · ${i+3} scenarios</p><footer><button class="whitebtn" data-action="dashboard-team" data-team="${x}">Open team →</button></footer></article>`).join('')}</div>`:table(['Role','People','Access'],[['Owner','1','Everything in the workspace'],['Admin','2','Manage scenarios and people'],['Member','6','Build and run scenarios']])}`;
}

function dashboardDataPage(){let tab=state.route.split('/')[1]||'variables';const variables = [...dashboardSampleVariables, ...dashboardPreferences.variables];return `${hero('Data',[['data',variables.length,'variables',true],['grid','4,510','records stored'],['settings','3','API keys']],`<button class="blackbtn" data-action="variable">${ic('plus')} New variable</button>`)}${tabs([['Variables','data/variables',variables.length],['Data stores','data/stores',3],['API keys','data/keys',3]],'data/'+tab)}${tab==='variables'?`<div class="filters reveal" style="--i:2">${filterSearch('Search variables')}<span class="spacer"></span>${chips(['All','Text','Number','Secret'].map(type=>[type]))}</div>${table(['Name','Value','Type','Scope','Updated',''],variables.filter(v=>(state.filter==='All'||v[2]===state.filter)&&v[0].toLowerCase().includes(state.query.toLowerCase())).map(v=>[`<b>${escapeHTML(v[0])}</b>`,escapeHTML(v[1]),v[2],v[3],v[4],`<button class="more" data-action="dashboard-variable" data-variable="${escapeHTML(v[0])}" aria-label="Open ${escapeHTML(v[0])}">${ic('more')}</button>`]))}`:tab==='stores'?table(['Name','Records','Size','Updated',''],dashboardStores.map(row=>[...row, `<button class="whitebtn" data-action="dashboard-store" data-store="${row[0]}">Open</button>`])):table(['Name','Scope','Created','Last used'],[['Production key','Full access','Oct 15','Today'],['Support integration','Read only','Oct 9','Yesterday'],['Development key','Full access','Sep 23','3 days ago']])}`}

function dashboardBillingPage(){let tab=state.route.split('/')[1]||'plan';return `${hero('Billing',[['billing','Core','€39 / month',true],['zap','25%','operations used'],['clock','Dec 1','next invoice']])}${tabs([['Plan & usage','billing/plan'],['Payment','billing/payment'],['Invoices','billing/invoices']],'billing/'+tab)}${tab==='plan'?`<div class="billing-layout"><div><section class="card wide-card reveal" style="--i:2"><div class="sectiontitle"><span class="circle">↗</span><div><h2>Current plan</h2><p>Core · €39 / month</p></div></div>${[['Operations','2,608 / 10,000',26],['Data transfer','122 / 512 MB',24],['Seats','10 / 10',100]].map(([x,v,w])=>`<div style="margin:22px 0"><div style="display:flex;justify-content:space-between"><strong>${x}</strong><small>${v}</small></div><div class="progressline"><span style="width:${w}%"></span></div></div>`).join('')}</section><section class="card wide-card reveal" style="--i:4;margin-top:16px"><h2>Operations forecast</h2><p>Actual and projected use this month</p><svg viewBox="0 0 740 220" style="width:100%;height:220px"><path d="M0 180H740M0 130H740M0 80H740M0 30H740" stroke="#dae0d6"/><path d="M10 200 C85 180 130 164 180 145 S260 135 305 110 S375 90 420 77 S510 44 570 30 S660 18 730 6" fill="none" stroke="#111" stroke-width="3"/><path d="M420 77 C510 44 570 30 730 6" fill="none" stroke="#c8eb50" stroke-width="4" stroke-dasharray="8 5"/></svg></section></div><div><div class="card forecast reveal" style="--i:3"><small>⚡ You’ll run short</small><h2>At this pace you’ll need 14k operations</h2><p>The 10k included in Core may run out around Nov 21.</p><div class="progress"><span></span></div><button class="whitebtn" data-action="dashboard-billing" data-topic="Extra operations">Add 5,000 · €9</button></div><div class="card wide-card reveal" style="--i:5;margin-top:16px"><h2>Plan options</h2>${['Free','Starter','Core','Scale'].map((x,i)=>`<div class="settings-row"><span><strong>${x}</strong><small>${['€0','€19','€39','€99'][i]} / month</small></span><button class="whitebtn" data-action="dashboard-plan" data-plan="${x}" ${x==='Core'?'disabled':''}>${x==='Core'?'Current':'View'}</button></div>`).join('')}</div></div></div>`:tab==='payment'?`<div class="card settings-card reveal" style="--i:2"><h2>Payment method</h2><div class="settings-row"><span><strong>Visa ending in 4242</strong><small>Expires 08 / 2028</small></span><button class="whitebtn" data-action="dashboard-billing" data-topic="Update payment method">Update</button></div><div class="settings-row"><span><strong>Billing details</strong><small>Tallow & Fern · Lisbon, Portugal</small></span><button class="whitebtn" data-action="dashboard-billing" data-topic="Edit billing details">Edit</button></div></div>`:table(['Invoice','Date','Amount','Status',''],dashboardInvoices.map(row=>[...row,status('Succeeded'),`<button class="whitebtn" data-action="dashboard-invoice" data-invoice="${row[0]}">Download sample</button>`]))}`}

function dashboardSettingsPage(){let tab=state.route.split('/')[1]||'workspace';let content=tab==='workspace'?`<h2>Workspace</h2><p>Workspace preferences are saved on this device.</p><form data-dashboard-form="workspace"><div class="field-grid"><label>Name<input name="name" value="${escapeHTML(dashboardWorkspaceName())}" maxlength="80" required></label>${dashboardSelect('Time zone','timeZone',['Europe/Lisbon','Europe/London','Europe/Madrid','America/New_York','Asia/Kolkata','Asia/Tokyo'],dashboardPreferences.timeZone)}${dashboardSelect('Week starts on','weekStart',['Monday','Sunday'],dashboardPreferences.weekStart)}${dashboardSelect('Run history display','historyRange',['7 days','30 days','90 days'],dashboardPreferences.historyRange)}</div><button class="blackbtn save">Save</button></form>`:tab==='alerts'?`<h2>Alerts</h2><p>Preferences are saved on this device. The preview does not send alerts.</p>${[['Failed runs by email','To the scenario’s owner, at most once an hour'],['Failed runs in team chat','Posted to #runspell-alerts'],['At 80% of operations','To the owner and admins'],['Weekly summary','Mondays at 8:00 — runs, failures, busiest scenarios'],['Sign-ins from a new device','To the person signing in'],['Product news','A short note when something new ships']].map(([x,y],i)=>`<div class="settings-row"><span><strong>${x}</strong><small>${y}</small></span><button class="switch ${dashboardPreferences.alerts[i]?'on':''}" data-action="dashboard-alert" data-index="${i}" role="switch" aria-checked="${dashboardPreferences.alerts[i]}" aria-label="${x}"></button></div>`).join('')}`:tab==='appearance'?`<h2>Appearance</h2><p>Saved on this device</p><div class="settings-row"><span><strong>Theme</strong><small>Light, dark or the same as your system</small></span><div class="segmented"><button data-action="light" class="${dashboardPreferences.theme==='light'?'active':''}">☼ Light</button><button data-action="dark" class="${dashboardPreferences.theme==='dark'?'active':''}">☾ Dark</button><button data-action="system" class="${dashboardPreferences.theme==='system'?'active':''}">▣ System</button></div></div><div class="theme-choices"><button class="theme-choice ${dashboardPreferences.theme==='light'?'active':''}" data-action="light"><div class="theme-preview"><i></i><i></i><i></i></div>Light</button><button class="theme-choice dark ${dashboardPreferences.theme==='dark'?'active':''}" data-action="dark"><div class="theme-preview"><i></i><i></i><i></i></div>Dark</button></div><div class="settings-row"><span><strong>Compact tables</strong><small>Tighter rows in Runs, People and Variables</small></span><button class="switch ${dashboardPreferences.compact?'on':''}" data-action="dashboard-compact" role="switch" aria-label="Compact tables" aria-checked="${dashboardPreferences.compact}"></button></div>`:`<h2>Data</h2><p>This demo keeps its changes in your browser</p><div class="settings-row"><span><strong>Export the workspace</strong><small>Scenarios, runs, people and settings as JSON</small></span><button class="whitebtn" data-action="dashboard-export">⇩ &nbsp; Export</button></div><div class="settings-row"><span><strong>Reset local settings and drafts</strong><small>Restore dashboard preferences and remove local variables and invite drafts</small></span><button class="whitebtn" data-action="dashboard-reset" style="color:#b44d35">◌ &nbsp; Reset</button></div>`;return `${hero('Settings')}${tabs([['Workspace','settings/workspace'],['Alerts','settings/alerts'],['Appearance','settings/appearance'],['Data','settings/data']],'settings/'+tab)}<section class="card settings-card reveal" style="--i:2">${content}</section>`}
