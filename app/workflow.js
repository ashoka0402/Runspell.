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
  return `<button class="workflow-node" data-workflow-move data-action="workflow-edit" data-index="${index}" style="--node-x:${Number(step.x) || 0}px;--node-y:${Number(step.y) || 0}px">
    <span class="workflow-symbol ${trigger ? 'workflow-trigger' : ''}">${escapeHTML(step.symbol)}</span>
    <span class="workflow-step-text"><small>${trigger ? 'Trigger' : 'Action'}</small>
    <strong>${escapeHTML(step.app)}</strong><span>${escapeHTML(step.label)}</span></span>
    <span class="workflow-step-number">${index + 1}</span>
  </button>`;
}

const selectableWorkflowTriggers = workflowTriggers.filter(([app]) => app !== 'Manual');

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
    <label class="workflow-field">Step name<input id="workflow-step-name" value="${escapeHTML(step.label)}"></label>
    <button class="blackbtn" data-action="workflow-step-save">Done</button>
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
      const label = $('#workflow-step-name').value.trim();
      if (label && label !== workflow.steps[index].label) {
        recordStepChange();
        workflow.steps[index].label = label;
      }
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

function drawWorkflowLinks() {
  const links = document.querySelector('.workflow-links');
  if (!links) return;
  const origin = links.getBoundingClientRect();
  const nodes = $$('.workflow-node[data-workflow-move]').map(node => node.getBoundingClientRect());
  const triggerCount = workflowTriggerCount();
  const edges = nodes.slice(triggerCount + 1).map((_,index)=>[triggerCount + index,triggerCount + index + 1]);
  if (nodes[triggerCount]) {
    for (let index = 0; index < triggerCount; index++) edges.push([index,triggerCount]);
  }
  links.querySelector('g').innerHTML = edges.map(([from,to]) => {
    const previous = nodes[from], next = nodes[to];
    const x1 = previous.left + previous.width / 2;
    const y1 = previous.top + previous.height / 2;
    const x2 = next.left + next.width / 2;
    const y2 = next.top + next.height / 2;
    const dx = x2 - x1, dy = y2 - y1;
    const start = Math.min(previous.width / 2 / Math.abs(dx), previous.height / 2 / Math.abs(dy));
    const end = Math.min(next.width / 2 / Math.abs(dx), next.height / 2 / Math.abs(dy));
    if (start + end >= 1) return '';
    return `<line data-from="${from}" data-to="${to}" x1="${x1 + dx * start - origin.left}" y1="${y1 + dy * start - origin.top}" x2="${x2 - dx * end - origin.left}" y2="${y2 - dy * end - origin.top}" marker-end="url(#workflow-arrow)"/>`;
  }).join('');
}

let workflowDrag;
let draggedNodeClick;
function clearWorkflowDrag() {
  workflowDrag?.node.classList.remove('workflow-node-moving');
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
  workflowDrag = {node, canvas, pointer:event.pointerId, left:event.clientX-bounds.left, top:event.clientY-bounds.top, x:Number(step.x)||0, y:Number(step.y)||0, moved:false};
  node.setPointerCapture(event.pointerId);
});

document.addEventListener('pointermove', event => {
  const drag = workflowDrag;
  if (!drag || drag.pointer !== event.pointerId) return;
  const bounds = drag.canvas.getBoundingClientRect();
  const dx = event.clientX - bounds.left - drag.left, dy = event.clientY - bounds.top - drag.top;
  if (!drag.moved) {
    if (Math.hypot(dx,dy) < 5) return;
    recordStepChange();
    drag.moved = true;
    drag.node.classList.add('workflow-node-moving');
  }
  setWorkflowNodeOffset(drag.node, drag.x + dx / state.zoom, drag.y + dy / state.zoom);
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
  const input = {
    Manual: { event: 'manual.start' },
    Storefront: { event: 'order.created', orderId: 'DEMO-1042' },
    Schedule: { event: 'schedule.tick', interval: 'daily' },
    Webhook: { event: 'webhook.received', requestId: 'demo-001' },
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
    if (!workflowDrag) nodes[previewIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    rows[previewIndex]?.scrollIntoView({ block: 'nearest' });
    if (!finished) workflowPreview = setTimeout(() => { previewIndex++; paint(); }, 620);
  }
  paint();
}
