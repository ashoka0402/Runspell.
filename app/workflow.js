const workflowTriggers = [
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
const draftStorageKey = 'brisko.workflow.drafts';
const workflowDrafts = loadDrafts();
const undoSteps = [];
const redoSteps = [];
let previewIndex = null;

function loadDrafts() {
  try {
    const drafts = JSON.parse(localStorage.getItem(draftStorageKey));
    return drafts && typeof drafts === 'object' && !Array.isArray(drafts) ? drafts : {};
  } catch {
    return {};
  }
}

function recordStepChange() {
  undoSteps.push(structuredClone(workflow.steps));
  redoSteps.length = 0;
}

function openWorkflow(scenarioIndex, resume = false) {
  const scenario = scenarios[scenarioIndex];
  workflowKey = scenario ? String(scenarioIndex) : 'blank';
  const saved = (scenario || resume) && workflowDrafts[workflowKey];
  workflow = saved ? structuredClone(saved) : {
    name: scenario?.[0] || 'Untitled scenario',
    steps: scenario ? [
      { app: 'Storefront', label: 'Watch new orders', symbol: '▣' },
      { app: 'Mail', label: 'Send an email', symbol: '✉' },
    ] : [],
  };
  workflowPanel = null;
  undoSteps.length = 0;
  redoSteps.length = 0;
  previewIndex = null;
  state.zoom = 1;
  state.menu = false;
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
  return `<button class="workflow-node" data-action="workflow-edit" data-index="${index}" ${index > 0 ? 'draggable="true"' : ''}>
    <span class="workflow-symbol ${index === 0 ? 'workflow-trigger' : ''}">${escapeHTML(step.symbol)}</span>
    <span class="workflow-step-text"><small>${index === 0 ? 'Trigger' : 'Action'}</small>
    <strong>${escapeHTML(step.app)}</strong><span>${escapeHTML(step.label)}</span></span>
    <span class="workflow-step-number">${index + 1}</span>
  </button>`;
}

function workflowSidePanel() {
  if (previewIndex !== null) return workflowRunPanel();
  if (!workflowPanel) return '';
  const step = workflow.steps[workflowPanel.index];
  const choosing = workflowPanel.mode === 'pick';
  const choosingTrigger = choosing && (workflowPanel.index === 0 || !workflow.steps.length);
  const choices = choosingTrigger ? workflowTriggers : apps
    .filter(([name]) => name in workflowActions)
    .map(([name, , , , symbol]) => [name, workflowActions[name], symbol]);
  return `<aside class="workflow-panel" aria-label="Module settings">
    <div class="workflow-panel-title"><h2>${choosing ? (choosingTrigger ? 'Choose a trigger' : workflowPanel.insert ? 'Insert an action' : 'Choose an action') : escapeHTML(step.app)}</h2>
    <button class="workflow-icon-button" data-action="workflow-panel-close" aria-label="Close module panel">${ic('close')}</button></div>
    ${choosing ? `<div class="workflow-choices">${choices.map(([app, label, symbol]) => `
      <button class="workflow-choice" data-action="workflow-pick" data-app="${app}">
        <span class="workflow-symbol">${symbol}</span><span><strong>${app}</strong><small>${label}</small></span>${ic('arrow', 15)}
      </button>`).join('')}</div>` : `
      <label class="workflow-field">Step name<input id="workflow-step-name" value="${escapeHTML(step.label)}"></label>
      <button class="blackbtn" data-action="workflow-step-save">Done</button>
      <button class="whitebtn" data-action="workflow-replace">Change module</button>
      ${workflowPanel.index > 0 ? `<div class="workflow-edit-actions">
        <button class="whitebtn" data-action="workflow-earlier" ${workflowPanel.index === 1 ? 'disabled' : ''}>← Move earlier</button>
        <button class="whitebtn" data-action="workflow-later" ${workflowPanel.index === workflow.steps.length - 1 ? 'disabled' : ''}>Move later →</button>
        <button class="whitebtn" data-action="workflow-duplicate">Duplicate</button>
        <button class="workflow-remove" data-action="workflow-remove">Remove action</button>
      </div>` : ''}`}
  </aside>`;
}

function builder(scrollToEnd = false) {
  const entering = !$('#builder');
  const viewport = $('.workflow-viewport');
  const left = viewport?.scrollLeft || 0;
  $('#builder')?.remove();
  const hasTrigger = workflow.steps.length > 0;
  const connector = index => `<span class="workflow-connector"><svg width="62" height="16" viewBox="0 0 62 16" fill="none" stroke="currentColor"><path d="M0 8H61M54 2l7 6-7 6"/></svg>${index < workflow.steps.length ? `<button data-action="workflow-insert" data-index="${index}" aria-label="Insert action before step ${index + 1}">+</button>` : ''}</span>`;
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
      <div class="workflow-board">
        <div class="workflow-viewport" tabindex="0" aria-label="Workflow canvas">
          <div class="workflow-center"><div class="workflow-track" id="canvas-stage" style="--zoom:${state.zoom}">
            ${workflow.steps.map((step, index) => (index ? connector(index) : '') + workflowStep(step, index)).join('')}${hasTrigger ? connector(workflow.steps.length) : ''}
            <button class="workflow-node workflow-add" data-action="workflow-add">
              <span class="workflow-symbol">${ic('plus', 22)}</span>
              <span class="workflow-step-text"><strong>${hasTrigger ? 'Add action' : 'Add trigger'}</strong>
              <span>${hasTrigger ? 'Choose the next step' : 'Choose what starts this workflow'}</span></span>
            </button>
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
}

function workflowAction(action, el) {
  let index = workflowPanel?.index;
  if (previewIndex !== null && !['workflow-preview', 'workflow-save'].includes(action)) {
    clearTimeout(workflowPreview);
    previewIndex = null;
  }
  switch (action) {
    case 'workflow-run-close':
      break;
    case 'workflow-insert':
      workflowPanel = { mode: 'pick', index: Number(el.dataset.index), insert: true };
      break;
    case 'workflow-add':
      workflowPanel = { mode: 'pick' };
      break;
    case 'workflow-edit':
      workflowPanel = { mode: 'edit', index: Number(el.dataset.index) };
      break;
    case 'workflow-replace':
      workflowPanel.mode = 'pick';
      break;
    case 'workflow-pick': {
      const app = el.dataset.app;
      const choice = workflowTriggers.find(item => item[0] === app);
      const trigger = index === 0 || !workflow.steps.length;
      const step = {
        app,
        label: trigger ? choice[1] : workflowActions[app],
        symbol: trigger ? choice[2] : apps.find(item => item[0] === app)[4],
      };
      const insert = workflowPanel.insert;
      recordStepChange();
      index ??= workflow.steps.length;
      workflow.steps.splice(index, insert || index === workflow.steps.length ? 0 : 1, step);
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
      workflow.steps.splice(index + 1, 0, { ...workflow.steps[index] });
      workflowPanel.index = index + 1;
      break;
    case 'workflow-remove':
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
      to.push(workflow.steps);
      workflow.steps = from.pop();
      workflowPanel = null;
      break;
    }
    case 'workflow-save':
      workflow.name = workflow.name.trim() || 'Untitled scenario';
      $('#workflow-name').value = workflow.name;
      workflowDrafts[workflowKey] = structuredClone(workflow);
      try {
        localStorage.setItem(draftStorageKey, JSON.stringify(workflowDrafts));
        $('.workflow-feedback').textContent = 'Draft saved in this browser';
      } catch {
        $('.workflow-feedback').textContent = 'Draft saved for this page session';
      }
      return;
    case 'workflow-preview':
      startWorkflowPreview();
      return;
  }
  builder();
  if (workflowPanel) {
    $('.workflow-panel button')?.focus();
    if (workflowPanel.mode === 'edit') {
      $(`.workflow-node[data-index="${workflowPanel.index}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  } else ($$('.workflow-node')[index] || $('.workflow-add'))?.focus({ preventScroll: true });
}

function moveWorkflowAction(from, to) {
  const last = workflow.steps.length - 1;
  if (from < 1 || from > last || to < 1 || to > last || from === to) return false;
  recordStepChange();
  const [step] = workflow.steps.splice(from, 1);
  workflow.steps.splice(to, 0, step);
  return true;
}

let draggedAction = null;
function clearWorkflowDrag() {
  draggedAction = null;
  $('.workflow-dragging')?.classList.remove('workflow-dragging');
  $('.workflow-drop')?.classList.remove('workflow-drop');
}

document.addEventListener('dragstart', event => {
  const node = event.target.closest('.workflow-node[draggable="true"]');
  if (!node) return;
  draggedAction = Number(node.dataset.index);
  event.dataTransfer.setData('text/plain', String(draggedAction));
  event.dataTransfer.effectAllowed = 'move';
  node.classList.add('workflow-dragging');
});

document.addEventListener('dragover', event => {
  if (draggedAction === null) return;
  $('.workflow-drop')?.classList.remove('workflow-drop');
  const node = event.target.closest('.workflow-node[draggable="true"]');
  if (!node || Number(node.dataset.index) === draggedAction) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  node.classList.add('workflow-drop');
});

document.addEventListener('dragend', clearWorkflowDrag);
document.addEventListener('drop', event => {
  const node = event.target.closest('.workflow-node[draggable="true"]');
  if (!node || draggedAction === null) return;
  event.preventDefault();
  const from = draggedAction;
  const to = Number(node.dataset.index);
  clearWorkflowDrag();
  if (!moveWorkflowAction(from, to)) return;
  clearTimeout(workflowPreview);
  previewIndex = null;
  workflowPanel = null;
  builder();
  $(`.workflow-node[data-index="${to}"]`)?.focus();
});

function workflowRunPanel() {
  const input = {
    Storefront: { event: 'order.created', orderId: 'DEMO-1042' },
    Schedule: { event: 'schedule.tick', interval: 'daily' },
    Webhook: { event: 'webhook.received', requestId: 'demo-001' },
  }[workflow.steps[0].app];
  return `<aside class="workflow-panel workflow-run" aria-label="Run inspector">
    <div class="workflow-panel-title"><h2>Run inspector</h2>
    <button class="workflow-icon-button" data-action="workflow-run-close" aria-label="Close run inspector">${ic('close')}</button></div>
    <p class="workflow-run-summary" role="status"></p>
    <ol class="workflow-run-list">${workflow.steps.map(step => `
      <li><i></i><div><strong>${escapeHTML(step.app)}</strong><small>${escapeHTML(step.label)}</small></div>
      <span class="workflow-run-state"></span></li>`).join('')}</ol>
    <details><summary>Sample trigger input</summary><pre>${escapeHTML(JSON.stringify(input, null, 2) || '{}')}</pre></details>
  </aside>`;
}

function startWorkflowPreview() {
  clearTimeout(workflowPreview);
  workflowPanel = null;
  previewIndex = 0;
  builder();
  $('[data-action="workflow-run-close"]').focus();
  const rows = $$('.workflow-run-list li');
  const nodes = $$('.workflow-node[data-index]');

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
    nodes[previewIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    rows[previewIndex]?.scrollIntoView({ block: 'nearest' });
    if (!finished) workflowPreview = setTimeout(() => { previewIndex++; paint(); }, 620);
  }
  paint();
}
