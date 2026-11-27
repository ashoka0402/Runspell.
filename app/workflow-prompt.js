const workflowPromptTriggers = [
  ['Webhook', /^(?:when\s+(?:a\s+)?webhook\s+(?:arrives|fires|is received)|on\s+(?:a\s+)?webhook|from\s+(?:a\s+)?webhook)\b/i],
  ['Storefront', /^(?:when\s+(?:a\s+)?new\s+order\s+(?:arrives|comes in|is placed|is created)|on\s+(?:a\s+)?new\s+order|watch\s+(?:for\s+)?new\s+orders)\b/i],
  ['Schedule', /^(?:every\s+(?:\d+\s+(?:minutes?|hours?|days?|weeks?)|(?:weekday|day|hour|week|month|morning|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?)|daily|weekly|monthly|hourly|each\s+(?:morning|evening|day|week|month)|on\s+(?:a\s+)?schedule)(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?\b/i],
  ['Manual', /^(?:when\s+(?:i|we)\s+(?:run|start)\s+(?:it|this)|on\s+demand|manually|start\s+manually)\b/i],
];

const workflowPromptActions = [
  ['Storefront', /^update\s+(?:an?\s+|the\s+)?(?:storefront\s+)?orders?\b/i],
  ['Mail', /^(?:send\s+(?:an?\s+|the\s+)?(?:[\w-]+\s+){0,3}emails?\b|email\s+(?:an?\s+|the\s+)?\w)/i],
  ['Sheets', /^(?:add|append|write|log)\b.*\b(?:rows?\b.*\b(?:sheets|spreadsheets?)|(?:sheets|spreadsheets?)\b.*\brows?)\b/i],
  ['Payments', /^(?:look\s+up|check|find)\s+(?:an?\s+|the\s+)?payments?\b/i],
  ['Filter', /^(?:filter\b|check\s+(?:a\s+|the\s+)?condition\b)/i],
  ['Team chat', /^post\s+(?:an?\s+|the\s+)?(?:[\w-]+\s+){0,3}(?:message|update|summary)\b|^notify\s+(?:the\s+)?team\s+(?:in|via|through)\s+(?:the\s+)?(?:team\s+)?chat\b/i],
  ['Courier', /^(?:check|track)\s+(?:an?\s+|the\s+)?(?:delivery|shipment|courier)\b/i],
  ['CRM', /^update\s+(?:an?\s+|the\s+)?(?:crm\s+)?contacts?\b/i],
  ['SMS', /^(?:send\s+(?:an?\s+|the\s+)?(?:sms|text(?:\s+message)?)|text\s+(?:the\s+)?customer)\b/i],
  ['AI writer', /^(?:draft|write)\s+(?:an?\s+|the\s+)?(?:email|message|summary)\b/i],
  ['Cloud files', /^(?:upload|save|archive)\s+(?:an?\s+|the\s+)?(?:[\w-]+\s+){0,3}files?\b|^(?:upload|save|archive)\b.*\bcloud\s+files\b/i],
  ['Helpdesk', /^(?:open|create|file)\s+(?:an?\s+|the\s+)?(?:helpdesk\s+|support\s+)?tickets?\b/i],
  ['Ledger', /^(?:add|write|record|log)\b.*\bledger\b/i],
];

const workflowPromptVerbs = {
  adds: 'add', appends: 'append', archives: 'archive', checks: 'check', creates: 'create',
  drafts: 'draft', emails: 'email', files: 'file', filters: 'filter', finds: 'find', logs: 'log',
  looks: 'look', notifies: 'notify', opens: 'open', posts: 'post', records: 'record',
  saves: 'save', sends: 'send', texts: 'text', tracks: 'track', updates: 'update',
  uploads: 'upload', writes: 'write',
};

function readWorkflowPromptTriggers(request) {
  const starts = [];
  const read = (input, inheritWhen) => {
    const phrase = inheritWhen ? `when ${input}` : input;
    for (const [app, pattern] of workflowPromptTriggers) {
      const match = pattern.exec(phrase);
      if (match) return {app, length: match[0].length - (inheritWhen ? 5 : 0)};
    }
  };
  let start = read(request, false);
  let description = request;
  while (start) {
    starts.push(start.app);
    description = description.slice(start.length);
    const separator = /^\s*(?:(?:,\s*)?(?:and|or)\s+|,\s*)/i.exec(description);
    if (!separator) break;
    const continuation = description.slice(separator[0].length);
    start = read(continuation, false) || read(continuation, true);
    if (start) description = continuation;
  }
  return {starts, description};
}

function planWorkflowPrompt(prompt) {
  const text = typeof prompt === 'string' ? prompt.trim() : '';
  if (!text) return {error: 'Describe the steps you want to add.'};
  if (text.length > 1000) return {error: 'Keep the workflow description to 1,000 characters.'};

  const request = text.replace(/^(?:please\s+)?(?:(?:create|build|make|draft)\s+(?:me\s+)?(?:a\s+)?(?:workflow|scenario)\s+(?:that|to)\s+)?/i, '')
    .replace(/\bwhenever\b/i, 'when');
  let {starts, description} = readWorkflowPromptTriggers(request);
  if (!starts.length) {
    const suffix = /\b(?:when|every|daily|weekly|monthly|hourly|each|on demand)\b[^.!?]*[.!?]?$/i.exec(request);
    if (suffix) {
      const trailing = readWorkflowPromptTriggers(suffix[0].replace(/[.!?]$/, '').trim());
      if (trailing.starts.length && !trailing.description.trim()) {
        starts = trailing.starts;
        description = request.slice(0, suffix.index);
      }
    }
  }
  if (!starts.length) starts = ['Manual'];
  if (new Set(starts).size !== starts.length) return {error: 'Use each trigger type once in a workflow.'};
  const triggers = starts.map(start => workflowTriggers.find(([app]) => app === start));
  if (triggers.includes(undefined)) return {error: 'Specify when to start: on a schedule, on a webhook, or on a new order.'};

  if (/\b(?:if|unless|otherwise|when|until)\b/i.test(description)) {
    return {error: 'Describe a supported trigger followed by a sequence of actions. Conditional branches are unavailable in this builder.'};
  }
  const verbs = [...Object.keys(workflowPromptVerbs), ...Object.values(workflowPromptVerbs)].join('|');
  const unsupportedVerbs = 'delete|remove|refund|charge|read|fetch|retrieve|publish|scrape|approve|download|schedule';
  const separator = new RegExp(`[,;\\n]+|[.!?]+(?=\\s|$)|\\b(?:and\\s+)?then\\b|\\band\\s+(?=(?:${verbs}|${unsupportedVerbs})\\b)`, 'i');
  const actions = description.split(separator)
    .map(action => action.trim().replace(/^and\s+/i, '')
      .replace(/^\w+/, verb => {
        const key = verb.toLowerCase();
        return Object.hasOwn(workflowPromptVerbs, key) ? workflowPromptVerbs[key] : verb;
      }))
    .filter(Boolean);
  if (!actions.length) return {error: 'Add an action, such as “send an email” or “create a Helpdesk ticket”.'};
  if (actions.length > 12) return {error: 'Describe up to twelve actions at a time.'};

  const steps = triggers.map(([app, label, symbol]) => ({app, label, symbol, kind:'trigger'}));
  for (const action of actions) {
    if (/\b(?:read|fetch|retrieve)\b.*\b(?:sheets|spreadsheets?)\b/i.test(action)) {
      return {error: 'Sheets can add a row in this builder. Try “add a row in Sheets”.'};
    }
    const match = workflowPromptActions.find(([, pattern]) => pattern.test(action));
    const entry = match && apps.find(([name]) => name === match[0]);
    if (!entry || !Object.hasOwn(workflowActions, entry[0])) {
      return {error: `No available module matches “${action.slice(0, 90)}”. Try wording the step like an action in the module list.`};
    }
    const [actionApp, , , , actionSymbol] = entry;
    steps.push({app: actionApp, label: workflowActions[actionApp], symbol: actionSymbol, kind:'action'});
  }
  const actionNames = steps.slice(triggers.length).map(step => step.app).join(' → ');
  const triggerNames = starts.filter(app => app !== 'Manual').join(' + ');
  return {name: `${triggerNames ? `${triggerNames} → ` : ''}${actionNames}`.slice(0, 100), steps};
}
