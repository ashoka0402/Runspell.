const workflowTriggers = [
  ['Manual', 'Start on demand', '▷'],
  ['Storefront', 'Watch new orders', '▣'],
  ['Schedule', 'At a scheduled time', '◷'],
  ['Webhook', 'Receive an event', '⤳'],
];
const workflowActions = {
  Storefront: 'Update an order', Mail: 'Send an email', Sheets: 'Add a row',
  Payments: 'Look up a payment', Filter: 'Check a condition',
  'Team chat': 'Post a message', Courier: 'Check a delivery', CRM: 'Update a contact',
  SMS: 'Send a text', 'AI writer': 'Draft a message', 'Cloud files': 'Save a file',
  Helpdesk: 'Create a ticket', Ledger: 'Add an entry',
};
const workflowSettings = {
  'trigger:Storefront': [['status','Order status',['Any','Paid','Pending']]],
  'trigger:Schedule': [['frequency','Frequency',['Daily','Weekly','Monthly']],['time','Run time','time']],
  'trigger:Webhook': [['event','Event name','text','customer.created']],
  Storefront: [['order','Order ID','text','DEMO-1042']],
  Mail: [['recipient','Recipient','email','demo@example.com'],['subject','Subject','text']],
  Sheets: [['sheet','Sheet name','text','Orders'],['row','Row values','textarea']],
  Payments: [['payment','Payment reference','text']],
  Filter: [['field','Field to check','text'],['expected','Expected value','text']],
  'Team chat': [['channel','Channel','text'],['message','Message','textarea']],
  Courier: [['tracking','Tracking number','text']],
  CRM: [['contact','Contact ID','text']],
  SMS: [['recipient','Phone number','tel'],['message','Message','textarea']],
  'AI writer': [['prompt','Writing prompt','textarea']],
  'Cloud files': [['filename','File name','text'],['folder','Destination folder','text']],
  Helpdesk: [['title','Ticket title','text'],['priority','Priority',['Normal','Low','High']]],
  Ledger: [['reference','Entry reference','text'],['amount','Amount','number']],
};
let workflow;
let workflowKey;
let workflowPanel;
let workflowPreview;
let workflowPrompt = '';
let workflowChat = [];
let workflowPromptDraft;
const draftStorageKey = 'brisko.workflow.drafts';
const workflowDrafts = loadDrafts();
const undoSteps = [];
const redoSteps = [];
let previewIndex = null;
let previewTrigger = 0;

function loadDrafts() {
  try {
    const drafts = JSON.parse(localStorage.getItem(draftStorageKey));
    return drafts && typeof drafts === 'object' && !Array.isArray(drafts) ? drafts : {};
  } catch {
    return {};
  }
}

function recordStepChange() {
  undoSteps.push(structuredClone(workflow));
  redoSteps.length = 0;
}

function workflowHasTrigger() {
  return workflowTriggerCount() > 0;
}

function workflowTriggerCount() {
  const action = workflow.steps.findIndex(step => step.kind === 'action');
  return action < 0 ? workflow.steps.length : action;
}

function openWorkflow(scenarioIndex, resume = false, templateIndex) {
  const scenario = scenarios[scenarioIndex];
  const template = scenarioTemplates[templateIndex];
  workflowKey = template ? `template-${templateIndex}` : scenario ? String(scenarioIndex) : 'blank';
  const saved = (scenario || template || resume) && workflowDrafts[workflowKey];
  workflow = saved ? structuredClone(saved) : {
    name: template?.[0] || scenario?.[0] || 'Untitled scenario',
    steps: template ? template.slice(1).map((app, index) => {
      const trigger = index === 0 ? workflowTriggers.find(([name]) => name === app) : null;
      return {app, label: trigger?.[1] || workflowActions[app], symbol: trigger?.[2] || apps.find(([name]) => name === app)[4]};
    }) : scenario ? [
      { app: 'Storefront', label: 'Watch new orders', symbol: '▣' },
      { app: 'Mail', label: 'Send an email', symbol: '✉' },
    ] : [],
  };
  workflow.steps.forEach((step, index) => { step.kind ??= index === 0 ? 'trigger' : 'action'; });
  workflowPanel = null;
  workflowPrompt = '';
  workflowChat = Array.isArray(saved?.chat) ? saved.chat.filter(message =>
    ['user','assistant'].includes(message?.speaker) && typeof message?.text === 'string').slice(-40) : [];
  delete workflow.chat;
  workflowPromptDraft = undefined;
  undoSteps.length = 0;
  redoSteps.length = 0;
  previewIndex = null;
  state.zoom = 1;
  state.menu = '';
  state.modal = '';
  floating();
  document.activeElement?.blur();
  $('#app').inert = true;
  document.body.classList.add('workflow-open');
  builder();
  $('#workflow-name').focus({ preventScroll: true });
}

function closeWorkflow() {
  clearTimeout(workflowPreview);
  $('#builder')?.remove();
  $('#app').inert = false;
  document.body.classList.remove('workflow-open');
  workflowPanel = null;
  previewIndex = null;
  clearWorkflowDrag();
  $('[data-action="newmenu"]')?.focus({ preventScroll: true });
}

function workflowStep(step, index) {
  const trigger = step.kind === 'trigger';
  const selected = workflowPanel?.mode === 'edit' && workflowPanel.index === index;
  return `<button class="workflow-node" data-workflow-move data-action="workflow-edit" data-index="${index}" aria-pressed="${selected}" aria-keyshortcuts="Delete" style="--node-x:${Number(step.x) || 0}px;--node-y:${Number(step.y) || 0}px">
    <span class="workflow-symbol ${trigger ? 'workflow-trigger' : ''}">${escapeHTML(step.symbol)}</span>
    <span class="workflow-step-text"><small>${trigger ? 'Trigger' : 'Action'}</small>
    <strong>${escapeHTML(step.app)}</strong><span>${escapeHTML(step.label)}</span></span>
    <span class="workflow-step-number">${index + 1}</span>
  </button>`;
}

const selectableWorkflowTriggers = workflowTriggers.filter(([app]) => app !== 'Manual');

function workflowStepFields(step) {
  const key = step.kind === 'trigger' ? `trigger:${step.app}` : step.app;
  return Object.hasOwn(workflowSettings,key) ? workflowSettings[key] : [];
}

function workflowSettingFields(step) {
  return workflowStepFields(step).map(([key,label,type,placeholder='']) => {
    const value = step.settings?.[key] || '';
    const name = `name="${key}"`;
    const field = Array.isArray(type) ? `<select ${name}>${type.map(option=>`<option${option === value ? ' selected' : ''}>${option}</option>`).join('')}</select>`
      : type === 'textarea' ? `<textarea ${name} rows="3" maxlength="500">${escapeHTML(value)}</textarea>`
      : `<input ${name} type="${type}" value="${escapeHTML(value)}" placeholder="${placeholder}" maxlength="160"${type==='number'?' step="any"':''}>`;
    return `<label class="workflow-field">${label}${field}</label>`;
  }).join('');
}

function workflowSidePanel() {
  const actions = apps.filter(([name]) => Object.hasOwn(workflowActions, name))
    .map(([name, , , , symbol]) => [name, workflowActions[name], symbol]);
  const choices = (entries, kind) => `<div class="workflow-choices">${entries.map(([app, label, symbol]) => {
    const selected = workflow.steps.some(step => step.kind === 'trigger' && step.app === app);
    return `<button class="workflow-choice" data-action="workflow-pick" data-kind="${kind}" data-app="${app}" ${kind==='trigger' ? `aria-pressed="${selected}"` : ''}>
      <span class="workflow-symbol">${symbol}</span><span><strong>${app}</strong><small>${label}</small></span>${ic(selected&&kind==='trigger'?'check':'plus',15)}
    </button>`;
  }).join('')}</div>`;
  const step = workflow.steps[workflowPanel?.index];
  const editing = step && workflowPanel.mode === 'edit';
  let inspector = '';
  if (previewIndex !== null) inspector = workflowRunPanel();
  else if (workflowPanel?.mode === 'run') inspector = `<section class="workflow-inspector" aria-label="Choose a trigger to preview">
    <div class="workflow-panel-title"><h3>Choose a trigger to preview</h3><button class="workflow-icon-button" data-action="workflow-panel-close" aria-label="Cancel preview">${ic('close')}</button></div>
    ${workflow.steps.slice(0,workflowTriggerCount()).map((trigger,index) => `<button class="whitebtn" data-action="workflow-preview-trigger" data-index="${index}">${escapeHTML(trigger.app)}</button>`).join('')}
  </section>`;
  else if (editing) inspector = `<section class="workflow-inspector" aria-label="Module settings">
    <div class="workflow-panel-title"><h3>${escapeHTML(step.app)}</h3><button class="workflow-icon-button" data-action="workflow-panel-close" aria-label="Close module settings">${ic('close')}</button></div>
    <form id="workflow-step-form">
      <label class="workflow-field">Step name<input name="label" required maxlength="100" value="${escapeHTML(step.label)}"></label>
      ${workflowSettingFields(step)}
      <p class="workflow-node-config">Settings are saved with this draft. Preview uses sample data.</p>
      <button class="blackbtn" type="submit">Done</button>
    </form>
    ${step.kind === 'action' ? `<button class="whitebtn" data-action="workflow-replace">Change module</button>
      <div class="workflow-edit-actions">
        <button class="whitebtn" data-action="workflow-earlier" ${workflowPanel.index === workflowTriggerCount() ? 'disabled' : ''}>← Move earlier</button>
        <button class="whitebtn" data-action="workflow-later" ${workflowPanel.index === workflow.steps.length - 1 ? 'disabled' : ''}>Move later →</button>
        <button class="whitebtn" data-action="workflow-duplicate">Duplicate</button>
      </div>`:''}
    <button class="workflow-remove" data-action="workflow-remove">Delete node</button>
  </section>`;
  return `<aside class="workflow-panel workflow-library" aria-label="Available modules">
    <div class="workflow-panel-title"><h2>Available modules</h2></div>
    <section id="workflow-trigger-options" aria-labelledby="workflow-trigger-options-title">
      <h3 id="workflow-trigger-options-title">Triggers</h3><p>Choose any that can start this workflow.</p>
      ${choices(selectableWorkflowTriggers,'trigger')}
    </section>
    ${inspector}
    <section id="workflow-action-options" aria-labelledby="workflow-action-options-title">
      <h3 id="workflow-action-options-title">${workflowPanel?.mode==='pick'?(workflowPanel.insert?'Insert an action':'Choose a replacement action'):'Actions'}</h3>
      ${choices(actions,'action')}
    </section>
  </aside>`;
}

const workflowPromptExample = 'When a webhook arrives, create a Helpdesk ticket.';

function workflowPromptPanel() {
  return `<aside class="workflow-prompt" aria-label="Workflow chat">
    <div class="workflow-chat-tools">
      <h2>Workflow chat</h2>
      <button class="workflow-example" type="button" data-action="workflow-prompt-example">Use example</button>
      <button class="workflow-example" type="button" data-action="workflow-prompt-reset" ${workflowChat.length?'':'disabled'}>New chat</button>
    </div>
    <div class="workflow-chat-history" role="log" aria-label="Chat history" aria-live="polite">
      ${workflowChat.length ? workflowChat.map(({speaker,text})=>`<div class="workflow-message" data-speaker="${speaker}"><small>${speaker==='user'?'You':'Runspell'}</small><p>${escapeHTML(text)}</p></div>`).join('') : '<p>Describe what should start your workflow and what should happen next. Drafts appear on this canvas.</p>'}
      ${workflowPromptDraft ? `<section class="workflow-prompt-review" aria-label="Review replacement">
        <h3>Replace the current workflow?</h3>
        <ol>${workflowPromptDraft.steps.map(step => `<li>${escapeHTML(step.label)}</li>`).join('')}</ol>
        <button class="blackbtn" data-action="workflow-prompt-apply">Replace workflow</button>
        <button class="whitebtn" data-action="workflow-prompt-cancel">Keep current workflow</button>
      </section>` : ''}
    </div>
    <form class="workflow-chat-composer" id="workflow-prompt-form">
      <label for="workflow-prompt">Message Runspell</label>
      <textarea id="workflow-prompt" rows="3" maxlength="1000" required placeholder="What should this workflow do?">${escapeHTML(workflowPrompt)}</textarea>
      <button class="blackbtn" type="submit">Generate draft</button>
    </form>
  </aside>`;
}

function addWorkflowMessage(speaker,text) {
  workflowChat = [...workflowChat,{speaker,text}].slice(-40);
}

function applyWorkflowPrompt(plan) {
  clearTimeout(workflowPreview);
  previewIndex = null;
  recordStepChange();
  workflow = {name: plan.name, steps: plan.steps};
  workflowPanel = null;
  workflowPromptDraft = undefined;
  addWorkflowMessage('assistant', `I added ${workflow.steps.length} nodes to the canvas. You can edit them before saving.`);
  builder();
  $('#workflow-prompt').focus({preventScroll:true});
}

document.addEventListener('input', event => {
  if (event.target.id === 'workflow-prompt') workflowPrompt = event.target.value;
});

document.addEventListener('submit', event => {
  if (event.target.id === 'workflow-step-form') {
    event.preventDefault();
    workflowAction('workflow-step-save');
    return;
  }
  if (event.target.id !== 'workflow-prompt-form') return;
  event.preventDefault();
  const text = workflowPrompt.trim();
  if (!text) return;
  const plan = planWorkflowPrompt(text);
  workflowPrompt = '';
  addWorkflowMessage('user',text);
  if (!plan.error && !workflow.steps.length) { applyWorkflowPrompt(plan); return; }
  clearTimeout(workflowPreview);
  previewIndex = null;
  workflowPromptDraft = plan.error ? undefined : plan;
  addWorkflowMessage('assistant',plan.error || 'I prepared a new draft. Review its steps before replacing the workflow.');
  builder();
  ($('[data-action="workflow-prompt-apply"]') || $('#workflow-prompt')).focus({preventScroll:true});
});

function saveWorkflowStep() {
  const form = $('#workflow-step-form');
  if (!form) return true;
  const name = form.elements.namedItem('label');
  name.value = name.value.trim();
  if (!form.reportValidity()) return false;
  const step = workflow.steps[workflowPanel.index];
  const values = new FormData(form);
  const settings = Object.fromEntries(workflowStepFields(step).map(([key])=>[key,String(values.get(key) || '').trim()]));
  if (name.value !== step.label || JSON.stringify(settings) !== JSON.stringify(step.settings || {})) {
    recordStepChange();
    step.label = name.value;
    step.settings = settings;
    $('[data-action="workflow-undo"]').disabled = false;
    $('[data-action="workflow-redo"]').disabled = true;
  }
  return true;
}

function builder(scrollToEnd = false) {
  const entering = !$('#builder');
  const viewport = $('.workflow-viewport');
  const left = viewport?.scrollLeft || 0;
  const top = viewport?.scrollTop || 0;
  const bodyScroll = $('.workflow-body')?.scrollTop || 0;
  const libraryScroll = $('.workflow-library')?.scrollTop || 0;
  const promptScroll = $('.workflow-prompt')?.scrollTop || 0;
  $('#builder')?.remove();
  const triggerCount = workflowTriggerCount();
  const hasTrigger = triggerCount > 0;
  const connector = index => `<span class="workflow-connector">${index < workflow.steps.length ? `<button data-action="workflow-insert" data-index="${index}" aria-label="Insert action before step ${index + 1}">+</button>` : ''}</span>`;
  document.body.insertAdjacentHTML('beforeend', `<section class="builder workflow-builder${entering ? ' workflow-entering' : ''}" id="builder" aria-label="Scenario editor">
    <header class="workflow-header">
      <button class="whitebtn workflow-back" data-action="closebuilder">← <span>Back</span></button>
      <div class="workflow-title"><small>Scenarios / Editor</small>
      <input id="workflow-name" aria-label="Scenario name" maxlength="100" value="${escapeHTML(workflow.name)}"></div>
      <span class="status paused">Draft</span>
      <div class="workflow-header-actions">
        <button class="whitebtn workflow-history" data-action="workflow-undo" aria-label="Undo step change" title="Undo step change" ${undoSteps.length ? '' : 'disabled'}>↶</button>
        <button class="whitebtn workflow-history" data-action="workflow-redo" aria-label="Redo step change" title="Redo step change" ${redoSteps.length ? '' : 'disabled'}>↷</button>
        <button class="whitebtn" data-action="workflow-preview" ${hasTrigger ? '' : 'disabled'}>${ic('zap', 15)} <span>Preview run</span></button>
        <button class="blackbtn" data-action="workflow-save">Save draft</button>
      </div>
    </header>
    <div class="workflow-body">
      ${workflowPromptPanel()}
      <div class="workflow-board">
        <div class="workflow-viewport" tabindex="0" aria-label="Workflow canvas">
          <div class="workflow-center"><svg class="workflow-links" aria-hidden="true"><defs><marker id="workflow-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M1 1l6 3.5L1 8" fill="none" stroke="currentColor"/></marker></defs><g></g></svg><div class="workflow-track" id="canvas-stage" style="--zoom:${state.zoom}">
            <div class="workflow-trigger-lane">
              ${workflow.steps.slice(0,triggerCount).map(workflowStep).join('')}
              <button class="workflow-node workflow-add workflow-add-trigger" data-action="workflow-add-trigger">
                <span class="workflow-symbol">${ic('plus',22)}</span>
                <span class="workflow-step-text"><strong>Add trigger</strong><span>Choose what starts this workflow</span></span>
              </button>
            </div>
            ${workflow.steps.slice(triggerCount).map((step,index) => connector(index + triggerCount) + workflowStep(step,index + triggerCount)).join('')}
            ${workflow.steps.length ? `${connector(workflow.steps.length)}<button class="workflow-node workflow-add" data-action="workflow-add-action">
              <span class="workflow-symbol">${ic('plus', 22)}</span>
              <span class="workflow-step-text"><strong>Add action</strong><span>Choose the next step</span></span>
            </button>`:''}
          </div></div>
        </div>
        <div class="workflow-controls" aria-label="Canvas zoom">
          <button data-action="zoomout" aria-label="Zoom out">−</button>
          <button data-action="zoomreset" aria-label="Reset zoom">${Math.round(state.zoom * 100)}%</button>
          <button data-action="zoomin" aria-label="Zoom in">+</button>
        </div>
        <p class="workflow-feedback" role="status"></p>
      </div>
      ${workflowSidePanel()}
    </div>
  </section>`);
  const nextViewport = $('.workflow-viewport');
  nextViewport.scrollLeft = scrollToEnd ? nextViewport.scrollWidth : left;
  nextViewport.scrollTop = top;
  $('.workflow-body').scrollTop = bodyScroll;
  $('.workflow-prompt').scrollTop = promptScroll;
  const chatHistory = $('.workflow-chat-history');
  chatHistory.scrollTop = chatHistory.scrollHeight;
  if ($('.workflow-library')) $('.workflow-library').scrollTop = libraryScroll;
  drawWorkflowLinks();
}

function workflowAction(action, el) {
  let index = workflowPanel?.index;
  if (previewIndex !== null && !['workflow-preview', 'workflow-save'].includes(action)) {
    clearTimeout(workflowPreview);
    previewIndex = null;
  }
  switch (action) {
    case 'workflow-prompt-example':
      workflowPrompt = workflowPromptExample;
      $('#workflow-prompt').value = workflowPrompt;
      $('#workflow-prompt').focus();
      return;
    case 'workflow-prompt-reset':
      workflowChat = [];
      workflowPromptDraft = undefined;
      workflowPrompt = '';
      builder();
      $('#workflow-prompt').focus();
      return;
    case 'workflow-prompt-apply':
      if (workflowPromptDraft) applyWorkflowPrompt(workflowPromptDraft);
      return;
    case 'workflow-prompt-cancel':
      workflowPromptDraft = undefined;
      addWorkflowMessage('assistant','I kept the current workflow.');
      builder();
      $('#workflow-prompt').focus();
      return;
    case 'workflow-run-close':
      break;
    case 'workflow-insert':
      workflowPanel = { mode: 'pick', kind: 'action', index: Number(el.dataset.index), insert: true };
      builder();
      focusWorkflowOptions('action');
      return;
    case 'workflow-add-trigger':
    case 'workflow-add-action':
      workflowPanel = null;
      builder();
      focusWorkflowOptions(action === 'workflow-add-trigger' ? 'trigger' : 'action');
      return;
    case 'workflow-edit':
      workflowPanel = { mode: 'edit', index: Number(el.dataset.index) };
      break;
    case 'workflow-replace':
      workflowPanel.mode = 'pick';
      workflowPanel.kind = workflow.steps[index].kind;
      builder();
      focusWorkflowOptions('action');
      return;
    case 'workflow-pick': {
      const app = el.dataset.app;
      const kind = el.dataset.kind;
      const trigger = kind === 'trigger';
      const choice = trigger ? workflowTriggers.find(item => item[0] === app) : apps.find(item => item[0] === app);
      if (!choice || (!trigger && !Object.hasOwn(workflowActions, app))) return;
      if (trigger) {
        const selected = workflow.steps.findIndex(step => step.kind === kind && step.app === app);
        recordStepChange();
        if (selected >= 0) workflow.steps.splice(selected,1);
        else workflow.steps.splice(workflowTriggerCount(),0,{app,kind,label:choice[1],symbol:choice[2]});
        workflowPanel = null;
        builder();
        $(`[data-kind="trigger"][data-app="${app}"]`).focus({preventScroll:true});
        return;
      }
      index = workflowPanel?.mode === 'pick' ? index : undefined;
      index ??= workflow.steps.length;
      const replacing = !workflowPanel?.insert && index < workflow.steps.length;
      const position = replacing ? workflow.steps[index] : {};
      recordStepChange();
      workflow.steps.splice(index, Number(replacing), {
        app, kind, label: trigger ? choice[1] : workflowActions[app], symbol: trigger ? choice[2] : choice[4],
        x: position.x, y: position.y,
      });
      workflowPanel = null;
      builder(index === workflow.steps.length - 1);
      const node = $(`.workflow-node[data-index="${index}"]`);
      node?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      node?.focus({ preventScroll: true });
      return;
    }
    case 'workflow-step-save': {
      if (!saveWorkflowStep()) return;
      workflowPanel = null;
      break;
    }
    case 'workflow-earlier':
    case 'workflow-later': {
      const target = index + (action === 'workflow-earlier' ? -1 : 1);
      if (moveWorkflowAction(index, target)) workflowPanel.index = target;
      break;
    }
    case 'workflow-duplicate':
      recordStepChange();
      workflow.steps.splice(index + 1, 0, { ...workflow.steps[index], x: 0, y: 0 });
      workflowPanel.index = index + 1;
      break;
    case 'workflow-remove':
      index = el?.matches('[data-workflow-move]') ? Number(el.dataset.index) : index;
      if (!workflow.steps[index]) return;
      recordStepChange();
      workflow.steps.splice(index, 1);
      workflowPanel = null;
      break;
    case 'workflow-panel-close':
      workflowPanel = null;
      break;
    case 'workflow-undo':
    case 'workflow-redo': {
      const undo = action === 'workflow-undo';
      const from = undo ? undoSteps : redoSteps;
      const to = undo ? redoSteps : undoSteps;
      if (!from.length) return;
      to.push(workflow);
      workflow = from.pop();
      workflowPanel = null;
      break;
    }
    case 'workflow-save':
      if (!saveWorkflowStep()) return;
      workflow.name = workflow.name.trim() || 'Untitled scenario';
      $('#workflow-name').value = workflow.name;
      workflowDrafts[workflowKey] = structuredClone({...workflow,chat:workflowChat});
      try {
        localStorage.setItem(draftStorageKey, JSON.stringify(workflowDrafts));
        $('.workflow-feedback').textContent = 'Draft saved in this browser';
      } catch {
        $('.workflow-feedback').textContent = 'Draft saved for this page session';
      }
      return;
    case 'workflow-preview':
      if (workflowTriggerCount() === 1) startWorkflowPreview(0);
      else if (workflowHasTrigger()) {
        clearTimeout(workflowPreview);
        previewIndex = null;
        workflowPanel = {mode:'run'};
        builder();
        $('[data-action="workflow-preview-trigger"]')?.focus();
      }
      return;
    case 'workflow-preview-trigger':
      startWorkflowPreview(Number(el.dataset.index));
      return;
  }
  builder();
  if (workflowPanel) {
    $('.workflow-inspector button')?.focus();
    if (workflowPanel.mode === 'edit') {
      $(`.workflow-node[data-index="${workflowPanel.index}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  } else ($$('.workflow-node')[index] || $('.workflow-add'))?.focus({ preventScroll: true });
}

function focusWorkflowOptions(kind) {
  $(`#workflow-${kind}-options .workflow-choice`)?.focus();
}

function moveWorkflowAction(from, to) {
  const first = workflowTriggerCount();
  const last = workflow.steps.length - 1;
  if (from < first || from > last || to < first || to > last || from === to) return false;
  recordStepChange();
  const [step] = workflow.steps.splice(from, 1);
  workflow.steps.splice(to, 0, step);
  return true;
}

function workflowEdgePath(source, target, origin) {
  const dx = target.left + target.width / 2 - source.left - source.width / 2;
  const dy = target.top + target.height / 2 - source.top - source.height / 2;
  const horizontalGap = Math.abs(dx) - (source.width + target.width) / 2;
  const verticalGap = Math.abs(dy) - (source.height + target.height) / 2;
  const overlap = horizontalGap < 0 && verticalGap < 0;
  const horizontal = overlap || (horizontalGap >= 0 && (verticalGap < 0 || Math.abs(dx) >= Math.abs(dy)));
  const toward = (horizontal ? dx : dy) < 0 ? -1 : 1;
  const arrival = overlap ? toward : -toward;
  const x1 = source.left + source.width / 2 - origin.left + (horizontal ? toward * source.width / 2 : 0);
  const y1 = source.top + source.height / 2 - origin.top + (horizontal ? (overlap ? -14 : 0) : toward * source.height / 2);
  const x2 = target.left + target.width / 2 - origin.left + (horizontal ? arrival * target.width / 2 : 0);
  const y2 = target.top + target.height / 2 - origin.top + (horizontal ? (overlap ? 14 : 0) : arrival * target.height / 2);
  const bend = Math.max(24, Math.min(118, (horizontal ? Math.abs(x2-x1) : Math.abs(y2-y1)) * 0.56));
  const c1x = x1 + (horizontal ? toward * bend : 0), c1y = y1 + (horizontal ? 0 : toward * bend);
  const c2x = x2 + (horizontal ? arrival * bend : 0), c2y = y2 + (horizontal ? 0 : arrival * bend);
  return `M ${x1} ${y1} C ${c1x} ${c1y} ${c2x} ${c2y} ${x2} ${y2}`;
}

function drawWorkflowLinks() {
  const links = document.querySelector('.workflow-links');
  if (!links) return;
  const layer = links.querySelector('g');
  const origin = links.getBoundingClientRect();
  const nodes = $$('.workflow-node[data-workflow-move]').map(node => node.getBoundingClientRect());
  const triggerCount = workflowTriggerCount();
  const edges = [];
  if (nodes[triggerCount]) {
    for (let index = 0; index < triggerCount; index++) edges.push([index,triggerCount]);
    for (let index = triggerCount + 1; index < nodes.length; index++) edges.push([index-1,index]);
  }
  const signature = edges.join(';');
  if (layer.dataset.edges !== signature) {
    layer.dataset.edges = signature;
    layer.innerHTML = edges.map(([from,to])=>`<g class="workflow-edge-group">
      <path class="workflow-edge" data-from="${from}" data-to="${to}" marker-end="url(#workflow-arrow)"/>
      <path class="workflow-edge-pulse" pathLength="100"/>
    </g>`).join('');
  }
  edges.forEach(([from,to],index)=>{
    const group = layer.children[index];
    const receivingStep = to - triggerCount + 1;
    const inactive = (from < triggerCount && from !== previewTrigger) || previewIndex < receivingStep;
    group.dataset.flow = previewIndex === null ? 'idle' : inactive ? 'inactive' : previewIndex === receivingStep ? 'active' : 'complete';
    const path = workflowEdgePath(nodes[from],nodes[to],origin);
    for (const stroke of group.children) stroke.setAttribute('d',path);
  });
}

let workflowDrag;
let draggedNodeClick;
function clearWorkflowDrag() {
  if (workflowDrag) {
    cancelAnimationFrame(workflowDrag.frame);
    workflowDrag.node.classList.remove('workflow-node-moving');
  }
  workflowDrag = undefined;
}

function setWorkflowNodeOffset(node, x, y) {
  const step = workflow.steps[Number(node.dataset.index)];
  const rect = node.getBoundingClientRect();
  const canvas = $('.workflow-center').getBoundingClientRect();
  const scale = state.zoom;
  const oldX = Number(step.x) || 0, oldY = Number(step.y) || 0;
  const clamp = (value, min, max) => Math.round(Math.min(Math.max(value,min),max));
  step.x = clamp(x, oldX + (canvas.left + 8 - rect.left) / scale, oldX + (canvas.right - 8 - rect.right) / scale);
  step.y = clamp(y, oldY + (canvas.top + 8 - rect.top) / scale, oldY + (canvas.bottom - 8 - rect.bottom) / scale);
  node.style.setProperty('--node-x', `${step.x}px`);
  node.style.setProperty('--node-y', `${step.y}px`);
  drawWorkflowLinks();
}

document.addEventListener('pointerdown', event => {
  draggedNodeClick = undefined;
  const node = event.target.closest('[data-workflow-move]');
  if (!node || event.button !== 0 || !event.isPrimary) return;
  const step = workflow.steps[Number(node.dataset.index)];
  const canvas = node.closest('.workflow-center');
  const bounds = canvas.getBoundingClientRect();
  workflowDrag = {
    node, canvas, viewport:canvas.parentElement, pointer:event.pointerId,
    startX:event.clientX-bounds.left, startY:event.clientY-bounds.top,
    x:Number(step.x)||0, y:Number(step.y)||0, moved:false,
  };
  node.setPointerCapture(event.pointerId);
});

function panWorkflowDuringDrag() {
  const drag = workflowDrag;
  if (!drag?.moved) return;
  const viewport = drag.viewport;
  const rect = viewport.getBoundingClientRect();
  const edgeSpeed = (pointer,start,end) => pointer < start + 30 ? -8 : pointer > end - 30 ? 8 : 0;
  const left = viewport.scrollLeft, top = viewport.scrollTop;
  viewport.scrollBy(edgeSpeed(drag.clientX,rect.left,rect.right),edgeSpeed(drag.clientY,rect.top,rect.bottom));
  if (viewport.scrollLeft !== left || viewport.scrollTop !== top) updateWorkflowDragPosition(drag);
  drag.frame = requestAnimationFrame(panWorkflowDuringDrag);
}

function updateWorkflowDragPosition(drag) {
  const bounds = drag.canvas.getBoundingClientRect();
  const dx = drag.clientX - bounds.left - drag.startX, dy = drag.clientY - bounds.top - drag.startY;
  if (!drag.moved) {
    if (Math.hypot(dx,dy) < 5) return;
    recordStepChange();
    drag.moved = true;
    drag.node.classList.add('workflow-node-moving');
    drag.frame = requestAnimationFrame(panWorkflowDuringDrag);
  }
  setWorkflowNodeOffset(drag.node, drag.x + dx / state.zoom, drag.y + dy / state.zoom);
}

document.addEventListener('pointermove', event => {
  const drag = workflowDrag;
  if (!drag || drag.pointer !== event.pointerId) return;
  drag.clientX = event.clientX;
  drag.clientY = event.clientY;
  updateWorkflowDragPosition(drag);
});

function finishWorkflowDrag(event) {
  const drag = workflowDrag;
  if (!drag || drag.pointer !== event.pointerId) return;
  if (drag.moved) {
    draggedNodeClick = drag.node;
    $('[data-action="workflow-undo"]').disabled = false;
    $('[data-action="workflow-redo"]').disabled = true;
  }
  clearWorkflowDrag();
}
document.addEventListener('pointerup', finishWorkflowDrag);
document.addEventListener('pointercancel', finishWorkflowDrag);
document.addEventListener('lostpointercapture', finishWorkflowDrag);
document.addEventListener('click', event => {
  if (!draggedNodeClick?.contains(event.target)) return;
  draggedNodeClick = undefined;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

document.addEventListener('keydown', event => {
  if (event.target.id === 'workflow-prompt' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    event.target.form.requestSubmit();
    return;
  }
  const node = event.target.closest('[data-workflow-move]');
  if (!node) return;
  if (event.key === 'Delete') {
    event.preventDefault();
    workflowAction('workflow-remove', node);
    return;
  }
  const offsets = {ArrowLeft:[-16,0], ArrowRight:[16,0], ArrowUp:[0,-16], ArrowDown:[0,16]};
  const offset = offsets[event.key];
  if (!event.altKey || !offset) return;
  event.preventDefault();
  const step = workflow.steps[Number(node.dataset.index)];
  recordStepChange();
  node.classList.add('workflow-node-moving');
  setWorkflowNodeOffset(node, (Number(step.x)||0) + offset[0], (Number(step.y)||0) + offset[1]);
  node.classList.remove('workflow-node-moving');
  $('[data-action="workflow-undo"]').disabled = false;
  $('[data-action="workflow-redo"]').disabled = true;
});
window.addEventListener('resize', drawWorkflowLinks);

function workflowRunPanel() {
  const [trigger, ...actions] = workflowPreviewSteps();
  const settings = trigger.settings || {};
  const input = {
    Manual: { event: 'manual.start' },
    Storefront: { event: 'order.created', orderId: 'DEMO-1042', status: settings.status || 'Any' },
    Schedule: { event: 'schedule.tick', interval: (settings.frequency || 'Daily').toLowerCase(), time: settings.time || '09:00' },
    Webhook: { event: settings.event || 'webhook.received', requestId: 'demo-001' },
  }[trigger.app];
  return `<section class="workflow-inspector workflow-run" aria-label="Run inspector">
    <div class="workflow-panel-title"><h3>Run inspector</h3>
    <button class="workflow-icon-button" data-action="workflow-run-close" aria-label="Close run inspector">${ic('close')}</button></div>
    <p class="workflow-run-summary" role="status"></p>
    <ol class="workflow-run-list">${[trigger,...actions].map(step => `
      <li><i></i><div><strong>${escapeHTML(step.app)}</strong><small>${escapeHTML(step.label)}</small></div>
      <span class="workflow-run-state"></span></li>`).join('')}</ol>
    <details><summary>Sample trigger input</summary><pre>${escapeHTML(JSON.stringify(input, null, 2) || '{}')}</pre></details>
  </section>`;
}

function workflowPreviewSteps() {
  return [workflow.steps[previewTrigger],...workflow.steps.slice(workflowTriggerCount())];
}

function startWorkflowPreview(trigger) {
  if (trigger < 0 || trigger >= workflowTriggerCount()) return;
  clearTimeout(workflowPreview);
  workflowPanel = null;
  previewTrigger = trigger;
  previewIndex = 0;
  builder();
  $('[data-action="workflow-run-close"]').focus();
  const rows = $$('.workflow-run-list li');
  const allNodes = $$('.workflow-node[data-index]');
  const nodes = [allNodes[previewTrigger],...allNodes.slice(workflowTriggerCount())];

  function paint() {
    const finished = previewIndex === rows.length;
    $('.workflow-run-summary').textContent = `${finished ? 'Simulation complete' : 'Simulating'} · ${previewIndex}/${rows.length} steps`;
    rows.forEach((row, index) => {
      const status = index < previewIndex ? 'done' : index === previewIndex ? 'running' : 'queued';
      row.dataset.state = status;
      row.querySelector('.workflow-run-state').textContent = { done: 'Done', running: 'Running', queued: 'Queued' }[status];
      nodes[index].classList.toggle('workflow-running', status === 'running');
      nodes[index].classList.toggle('workflow-completed', status === 'done');
    });
    drawWorkflowLinks();
    if (!workflowDrag) nodes[previewIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    rows[previewIndex]?.scrollIntoView({ block: 'nearest' });
    if (!finished) workflowPreview = setTimeout(() => { previewIndex++; paint(); }, 620);
  }
  paint();
}
