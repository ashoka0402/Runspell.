const receiptLimit = 128 * 1024;
const receiptStatuses = { accepted: 'Accepted', succeeded: 'Succeeded', failed: 'Failed' };

function flightRecorderPage() {
  return `<section id="flight-recorder" class="card wide-card">
    <div class="recorder-import">
      <div><h2>Execution receipt</h2><p>Open a Runspell mock receipt to inspect its pinned version and timeline. Files stay in this tab.</p></div>
      <label for="flight-receipt">Open receipt<input type="file" id="flight-receipt" accept=".json,application/json"></label>
    </div>
    <p role="status" class="recorder-status"></p>
    <div class="recorder-result" hidden></div>
  </section>`;
}

function isFlightReceipt(receipt) {
  const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  const integer = (value, minimum) => Number.isSafeInteger(value) && value >= minimum;
  const instant = (value) => typeof value === 'string' && value.length <= 35 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
  const identifier = (value) => typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value);
  const field = (value) => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value);

  if (receipt?.schemaVersion !== 1 || receipt.mode !== 'mock' || receipt.externalOutcome !== 'not_attempted' ||
      !Object.hasOwn(receiptStatuses, receipt.status) || !uuid(receipt.runId) || !uuid(receipt.workflowId) ||
      !uuid(receipt.workflowVersion?.id) || !integer(receipt.workflowVersion.number, 1) ||
      !integer(receipt.workflowVersion.draftRevision, 0) || !instant(receipt.acceptedAt) ||
      !Array.isArray(receipt.timeline) || !receipt.timeline.length || receipt.timeline.length > 52) return false;

  const [first] = receipt.timeline;
  if (first?.kind !== 'accepted' || first.at !== receipt.acceptedAt) return false;
  if (receipt.status === 'accepted') {
    return receipt.evidence === 'pending' && receipt.finishedAt === null && receipt.timeline.length === 1 && receipt.failureCode === undefined;
  }

  const last = receipt.timeline.at(-1);
  if (receipt.evidence !== 'simulated' || !instant(receipt.finishedAt) || Date.parse(receipt.finishedAt) < Date.parse(receipt.acceptedAt) ||
      last?.kind !== 'finished' || last.at !== receipt.finishedAt || last.status !== receipt.status) return false;
  if (receipt.failureCode !== undefined && (receipt.status !== 'failed' ||
      !['INVALID_MOCK_WORKFLOW', 'MOCK_RUN_FAILED'].includes(receipt.failureCode))) return false;

  return receipt.timeline.slice(1, -1).every((entry) => entry?.kind === 'step' && identifier(entry.nodeId) &&
    typeof entry.actionType === 'string' && /^[a-z]+\.[a-z_]+$/.test(entry.actionType) && entry.actionType.length <= 64 &&
    ['simulated', 'skipped'].includes(entry.outcome) && Array.isArray(entry.outputFields) &&
    entry.outputFields.length <= 20 && entry.outputFields.every(field) &&
    (entry.outcome !== 'skipped' || entry.outputFields.length === 0));
}

function showFlightReceipt(container, receipt) {
  function element(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const subtitle = element('p');
  subtitle.className = 'recorder-id';
  subtitle.append('Run ID ', element('code', receipt.runId));
  const summary = element('dl');
  summary.className = 'recorder-summary';
  const pairs = [
    ['Status', receiptStatuses[receipt.status]],
    ['Pinned version', `Version ${receipt.workflowVersion.number} · Draft revision ${receipt.workflowVersion.draftRevision}`],
    ['Evidence', receipt.evidence === 'simulated' ? 'Simulated' : 'Pending'],
    ['External outcome', 'No external action attempted'],
  ];
  if (receipt.failureCode) pairs.push(['Failure', receipt.failureCode]);
  for (const [label, value] of pairs) {
    const field = element('div');
    field.append(element('dt', label), element('dd', value));
    summary.append(field);
  }

  const heading = element('h3', 'Run timeline');
  heading.id = 'flight-timeline-heading';
  const timeline = element('ol');
  timeline.setAttribute('aria-labelledby', heading.id);
  for (const entry of receipt.timeline) {
    const item = element('li');
    if (entry.kind === 'step') {
      item.append(element('strong', entry.actionType), element('span', entry.nodeId),
        element('span', entry.outcome === 'skipped' ? 'Skipped' : 'Simulated'));
      if (entry.outputFields.length) item.append(element('small', `Output fields: ${entry.outputFields.join(', ')}`));
    } else {
      const time = element('time', new Date(entry.at).toLocaleString());
      time.dateTime = entry.at;
      item.append(element('strong', entry.kind === 'accepted' ? 'Run accepted' : 'Run finished'), time);
    }
    timeline.append(item);
  }

  container.replaceChildren(subtitle, summary, heading, timeline);
  container.hidden = false;
}

function mountFlightRecorder() {
  const root = document.querySelector('#flight-recorder');
  const input = root.querySelector('#flight-receipt');
  const feedback = root.querySelector('[role="status"]');
  const result = root.querySelector('.recorder-result');
  let request = 0;

  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const selected = ++request;
    input.value = '';
    result.hidden = true;
    result.replaceChildren();
    feedback.textContent = '';
    if (file.size > receiptLimit) {
      feedback.textContent = 'Choose a receipt smaller than 128 KB.';
      return;
    }

    try {
      const receipt = JSON.parse(await file.text());
      if (selected !== request || !root.isConnected) return;
      if (!isFlightReceipt(receipt)) throw new Error('Invalid receipt');
      showFlightReceipt(result, receipt);
      feedback.textContent = 'Receipt opened.';
    } catch {
      if (selected === request && root.isConnected) feedback.textContent = 'Choose a valid Runspell mock receipt.';
    }
  });
}
