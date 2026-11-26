import { useEffect, useRef, useState } from 'react';
import { Background, Controls, ReactFlow, useNodesState, type Node } from '@xyflow/react';
import { gsap } from 'gsap';
import { actionRegistry, compileWorkflow, type ActionType } from '../../shared/index';
import { invoiceMockEvidence, invoicePolicy } from '../../fixtures/m0/invoice';
import {
  EXAMPLE_PROMPT, STUDIO_STORAGE_KEY, acceptProposal, advanceGeneration, cancelGeneration, createStudioDocument,
  editNode, importWorkflow, loadStudio, proposeEdit, reconnectGeneration, resumeGeneration,
  saveStudio, setNodePosition, startGeneration, type StudioDocument,
} from '../../studio/model';

type Proposal = ReturnType<typeof proposeEdit>;
const EXAMPLE = EXAMPLE_PROMPT;
const legacyKey = 'brisko.workflow.drafts';
const stateLabels: Record<string, string> = {
  idle: 'Ready to build', planning: 'Building draft', needs_clarification: 'More detail needed',
  ready: 'Draft ready to review', cancelled: 'Build cancelled · draft kept', failed: 'Build stopped',
};
const positions: Record<string, { x: number; y: number }> = {
  open_portal: { x: 55, y: 0 }, read_invoice: { x: 55, y: 115 }, check_amount: { x: 55, y: 230 },
  approve_invoice: { x: 310, y: 345 }, download_invoice: { x: 55, y: 460 }, notify_team: { x: 55, y: 575 },
};

function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'The change could not be saved. Your previous draft is unchanged.';
}

function initialState(): { document: StudioDocument | null; error: string } {
  try {
    const existing = loadStudio(localStorage);
    return { document: existing ?? saveStudio(localStorage, createStudioDocument(), null), error: '' };
  } catch (error) { return { document: null, error: message(error) }; }
}

function legacyDrafts(): { entries: Array<[string, unknown]>; error: string } {
  try {
    const raw = localStorage.getItem(legacyKey);
    if (!raw) return { entries: [], error: '' };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Existing local drafts are not in a supported object format. They have not been changed.');
    return { entries: Object.entries(value), error: '' };
  } catch (error) { return { entries: [], error: message(error) }; }
}

export function Studio() {
  const [initial] = useState(initialState);
  const [document, setDocument] = useState(initial.document);
  const documentRef = useRef(document);
  const [error, setError] = useState(initial.error);
  const [notice, setNotice] = useState('');
  const [prompt, setPrompt] = useState(initial.document?.prompt || EXAMPLE);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [nodeLabel, setNodeLabel] = useState('');
  const [nodeConfig, setNodeConfig] = useState('{}');
  const [editPrompt, setEditPrompt] = useState('Change threshold to 25000');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [showSample, setShowSample] = useState(false);
  const [replaceRequested, setReplaceRequested] = useState(false);
  const [importText, setImportText] = useState('');
  const [legacy] = useState(legacyDrafts);
  const [legacyId, setLegacyId] = useState(legacy.entries[0]?.[0] || '');
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const element = useRef<HTMLDivElement>(null);
  const previousIds = useRef(new Set(document?.snapshot.workflow.nodes.map(node => node.id) || []));
  const selected = document?.snapshot.workflow.nodes.find(node => node.id === selectedId);

  function commit(change: (current: StudioDocument) => StudioDocument): boolean {
    const current = documentRef.current;
    if (!current) return false;
    try {
      const next = saveStudio(localStorage, change(current), current.storageRevision);
      documentRef.current = next; setDocument(next); setError(''); setNotice('');
      return true;
    } catch (error) { setPlaying(false); setError(message(error)); return false; }
  }

  function reload() {
    setPlaying(false);
    try {
      const saved = loadStudio(localStorage);
      if (!saved) throw new Error('No saved studio draft was found. Reload the page to start a fresh local draft.');
      documentRef.current = saved; setDocument(saved); setPrompt(saved.prompt || EXAMPLE); setProposal(null);
      setError(''); setNotice('Loaded the saved draft. Any unfinished build remains paused.');
    } catch (error) { setError(message(error)); }
  }

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STUDIO_STORAGE_KEY || event.key === null) {
        setPlaying(false);
        setError('The saved draft changed in another tab. Reload the saved draft before making more changes.');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (!playing || !document) return;
    if (!document.pendingEvents.length || !['idle', 'planning'].includes(document.snapshot.status)) { setPlaying(false); return; }
    const delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 25 : 220;
    const timer = window.setTimeout(() => commit(advanceGeneration), delay);
    return () => window.clearTimeout(timer);
  }, [playing, document]);

  useEffect(() => {
    if (!document) { setNodes([]); return; }
    setNodes(document.snapshot.workflow.nodes.map((node, index) => {
      const manifest = actionRegistry[node.actionType as ActionType]?.manifest;
      return {
        id: node.id, position: document.positions[node.id] ?? positions[node.id] ?? { x: 55, y: index * 115 },
        selected: node.id === selectedId,
        data: { label: <span className="studio-node-label"><strong>{node.label}</strong><small>{manifest?.runtime || 'Action'} · {manifest?.sideEffect === 'unsafe_write' ? 'write · verify outcome' : 'read / control'}</small></span> },
      };
    }));
  }, [document, selectedId, setNodes]);

  useEffect(() => {
    const currentIds = new Set(nodes.map(node => node.id));
    const added = nodes.filter(node => !previousIds.current.has(node.id));
    previousIds.current = currentIds;
    if (!added.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const context = gsap.context(() => {
      for (const node of added) {
        const label = element.current?.querySelector(`.react-flow__node[data-id="${node.id}"] .studio-node-label`);
        if (label) gsap.from(label, { opacity: 0, y: 5, duration: 0.18 });
      }
    }, element);
    return () => context.revert();
  }, [nodes.length]);

  useEffect(() => {
    setNodeLabel(selected?.label || ''); setNodeConfig(JSON.stringify(selected?.config || {}, null, 2));
  }, [selected?.id, selected?.label, JSON.stringify(selected?.config)]);

  function build() {
    setProposal(null); setShowSample(false); setReplaceRequested(false);
    if (commit(current => startGeneration(current, prompt))) setPlaying(true);
  }

  function requestBuild() {
    if (documentRef.current?.snapshot.workflow.nodes.length) { setReplaceRequested(true); return; }
    build();
  }

  function resume(reconnect = false) {
    if (commit(current => reconnect ? reconnectGeneration(current) : resumeGeneration(current))) setPlaying(true);
  }

  function saveNode() {
    if (!document || !selected) return;
    try {
      const config: unknown = JSON.parse(nodeConfig);
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Configuration must be a JSON object.');
      if (commit(current => editNode(current, selected.id, { label: nodeLabel, config: config as Record<string, unknown> }, document.snapshot.revision))) {
        setPlaying(false); setNotice('Node changes saved to this draft. Nothing was executed.');
      }
    } catch (error) { setError(message(error)); }
  }

  function suggest() {
    if (!document) return;
    try { setProposal(proposeEdit(document, editPrompt)); setError(''); setNotice('Review the mock suggestion before applying it.'); }
    catch (error) { setError(message(error)); }
  }

  function validate() {
    if (!document) return;
    try {
      const result = compileWorkflow(document.snapshot.workflow, invoicePolicy);
      setError(''); setNotice(`Definition valid: ${result.workflow.nodes.length} steps; ${result.connectionRequirements.length} connection requirements remain. Nothing was executed.`);
    } catch (error) { setError(`Definition is not ready: ${message(error)}`); }
  }

  function importValue(value: unknown) {
    if (!document) return;
    setPlaying(false);
    if (commit(current => importWorkflow(current, value, document.snapshot.revision))) {
      setProposal(null); setSelectedId(''); setNotice('Workflow imported into this studio draft. The source local draft was not changed.');
    }
  }

  if (!document) return <div className="studio" ref={element}><h1>Prompt Studio</h1><div className="studio-alert" role="alert">{error}</div><p>The stored data has not been reset or overwritten.</p><button type="button" onClick={reload}>Reload saved draft</button></div>;

  const snapshot = document.snapshot;
  const edges = snapshot.workflow.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, label: edge.branch }));
  const hasPending = document.targetWorkflow !== null && snapshot.status !== 'ready';
  const incomplete = snapshot.status !== 'ready';
  const browserSteps = snapshot.workflow.nodes.filter(node => actionRegistry[node.actionType as ActionType]?.manifest.connection === 'browser').length;
  const apiSteps = snapshot.workflow.nodes.filter(node => actionRegistry[node.actionType as ActionType]?.manifest.connection === 'api').length;

  return <div className="studio" ref={element} onKeyDown={event => event.stopPropagation()}>
    <header className="studio-header">
      <div><span className="studio-eyebrow">BUILD A WORKFLOW</span><h1>Prompt Studio</h1><p>Describe the handoff. Review every step.</p></div>
      <div className="studio-badges"><span>Offline prototype</span><span>Mock planner</span><small>Saved in this browser</small></div>
    </header>
    <div className="studio-prototype-note">This prototype assembles one invoice example. Prompts and edits stay in this browser; no AI service, account, or automation runs.</div>
    {error && <div className="studio-alert" role="alert"><span>{error}</span><button type="button" className="studio-text-button" onClick={reload}>Reload saved draft</button></div>}
    {notice && <p className="studio-notice" role="status">{notice}</p>}
    <div className="studio-layout">
      <aside className="studio-prompt-panel">
        <section className="studio-panel">
          <h2>Start with the outcome</h2>
          <label htmlFor="studio-prompt">What should this workflow do?</label>
          <textarea id="studio-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={2000} rows={5} placeholder="Collect one invoice and request approval…" />
          <p className="studio-hint">Invoice prompts load the same fixed example. Your wording does not configure real actions.</p>
          <div className="studio-button-row"><button type="button" className="studio-primary" onClick={requestBuild} disabled={playing}>Build mock draft</button><button type="button" className="studio-text-button" onClick={() => setPrompt(EXAMPLE)}>Use invoice example</button></div>
          {replaceRequested && <div className="studio-callout" role="group" aria-label="Replace current draft confirmation"><h3>Replace the current draft?</h3><p>A new mock build replaces your saved graph and canvas positions. Use a suggested edit to revise the current workflow instead.</p><div className="studio-button-row"><button type="button" className="studio-primary" onClick={build}>Replace and build mock</button><button type="button" onClick={() => setReplaceRequested(false)}>Keep current draft</button></div></div>}
          <div className="studio-build-state" role="status"><strong>{stateLabels[snapshot.status] || snapshot.status}</strong><span>{snapshot.workflow.nodes.length} steps added{playing ? ' · accepting draft events' : ''}</span></div>
          <div className="studio-button-row">
            {playing && <button type="button" onClick={() => { setPlaying(false); commit(cancelGeneration); }}>Cancel build</button>}
            {!playing && hasPending && <button type="button" onClick={() => resume()}>Resume build</button>}
            {!playing && hasPending && <button type="button" className="studio-text-button" onClick={() => resume(true)}>Reconnect draft</button>}
          </div>
          {!playing && snapshot.status === 'planning' && hasPending && <p className="studio-hint">The previous build was interrupted. Accepted steps are saved; resume when ready.</p>}
          {snapshot.clarification && <div className="studio-callout"><h3>Clarification needed</h3><p>{snapshot.clarification.question}</p></div>}
          {snapshot.failure && <div className="studio-callout"><h3>Build stopped</h3><p>{snapshot.failure.message}</p></div>}
          {!!document.assumptions.length && <div className="studio-assumptions"><h3>Example assumptions</h3><ul>{document.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul></div>}
          {!!snapshot.warnings.length && <div className="studio-assumptions"><h3>Review warnings</h3><ul>{snapshot.warnings.map(warning => <li key={warning.eventId}>{warning.message}</li>)}</ul></div>}
        </section>
        <section className="studio-panel">
          <h2>Refine the draft</h2><label htmlFor="studio-edit-prompt">Ask for a mock suggestion</label>
          <input id="studio-edit-prompt" value={editPrompt} onChange={event => setEditPrompt(event.target.value)} maxLength={500} />
          <p className="studio-hint">Try “change threshold to 25000”, “rename node read_invoice to Read vendor invoice”, or “switch trigger to webhook”.</p>
          <button type="button" onClick={suggest} disabled={playing || !snapshot.workflow.nodes.length}>Suggest edit</button>
          {proposal && <div className="studio-proposal" aria-label="Proposed edit"><h3>{proposal.description}</h3><div><strong>Before</strong><pre>{proposal.before}</pre></div><div><strong>After</strong><pre>{proposal.after}</pre></div><div className="studio-button-row"><button type="button" className="studio-primary" onClick={() => { if (commit(current => acceptProposal(current, proposal))) { setProposal(null); setNotice('Reviewed change saved to the draft. Nothing was activated.'); } }}>Accept change</button><button type="button" onClick={() => { setProposal(null); setNotice('Suggestion rejected. Draft unchanged.'); }}>Reject change</button></div></div>}
        </section>
      </aside>
      <main className="studio-canvas-panel">
        <div className="studio-canvas-heading"><div><h2>{snapshot.workflow.name || 'Your workflow'}</h2><p>Draft revision {snapshot.revision} · {snapshot.workflow.triggers.map(trigger => trigger.type).join(', ')} trigger kind · unconfigured</p></div><span className="studio-draft-tag">Draft only</span></div>
        <div className="studio-flow" data-testid="studio-flow">
          {nodes.length ? <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onNodeClick={(_event, node) => setSelectedId(node.id)} onNodeDragStop={(_event, node) => commit(current => setNodePosition(current, node.id, node.position))} nodesConnectable={false} deleteKeyCode={null} fitView minZoom={0.25} maxZoom={1.5} ariaLabelConfig={{ 'controls.zoomIn.ariaLabel': 'Zoom in', 'controls.zoomOut.ariaLabel': 'Zoom out', 'controls.fitView.ariaLabel': 'Fit workflow' }}><Background gap={20} color="#d2dacb" /><Controls showInteractive={false} /></ReactFlow> : <div className="studio-empty"><span aria-hidden="true">✦</span><h3>Your next handoff starts here.</h3><p>Build the invoice example to see its steps appear on the canvas.</p></div>}
        </div>
        <div className="studio-step-strip" aria-label="Editable workflow steps">{snapshot.workflow.nodes.map((node, index) => <button type="button" key={node.id} className={node.id === selectedId ? 'selected' : ''} onClick={() => setSelectedId(node.id)}><small>{index + 1}</small>{node.label}</button>)}</div>
        <div className="studio-review-bar"><p>{incomplete ? 'This draft is unfinished. Saved steps remain editable.' : 'Review connections and permissions before any future activation.'}</p><div className="studio-button-row"><button type="button" onClick={validate} disabled={!nodes.length}>Validate draft</button><button type="button" onClick={() => setShowSample(value => !value)} disabled={incomplete}>View sample result</button><button type="button" disabled title="Activation requires the backend and execution milestones">Activate unavailable</button></div></div>
        {showSample && <div className="studio-sample" role="status"><h3>Illustrative result · not executed</h3><p>{invoiceMockEvidence.invoiceId} · sample amount {invoiceMockEvidence.amount.toLocaleString('en-IN')}</p><p>{invoiceMockEvidence.note}</p></div>}
      </main>
      <aside className="studio-inspector">
        <section className="studio-panel"><h2>Step details</h2>{selected ? <form onSubmit={event => { event.preventDefault(); saveNode(); }}><p className="studio-action-type">{selected.actionType}</p><label htmlFor="studio-node-label">Step label</label><input id="studio-node-label" value={nodeLabel} onChange={event => setNodeLabel(event.target.value)} maxLength={100} required /><label htmlFor="studio-node-config">Configuration JSON</label><textarea id="studio-node-config" value={nodeConfig} onChange={event => setNodeConfig(event.target.value)} rows={8} spellCheck={false} /><p className="studio-hint">Only the supported fields for this step are accepted. Values are never executed here.</p><button type="submit" disabled={playing}>Save step changes</button><div className="studio-permission"><strong>{actionRegistry[selected.actionType as ActionType]?.manifest.sideEffect === 'unsafe_write' ? 'External write · verify outcome' : 'Read or control step'}</strong><p>Required scopes: {actionRegistry[selected.actionType as ActionType]?.manifest.scopes.join(', ') || 'No external account'}</p></div></form> : <p>Select a step on the graph or in the list to edit its label and configuration.</p>}</section>
        <section className="studio-panel"><h2>Connections needed</h2><p>No accounts are connected in this prototype.</p><ul className="studio-connections">{!!browserSteps && <li><span>Browser portal</span><strong>Not connected</strong><small>{browserSteps} browser steps · example domain</small></li>}{!!apiSteps && <li><span>Delivery API</span><strong>Not connected</strong><small>{apiSteps} API step · example endpoint</small></li>}{!browserSteps && !apiSteps && <li>Connection requirements appear as steps are added.</li>}</ul></section>
        <details className="studio-panel studio-import"><summary>Import an existing draft</summary><p>Import explicitly into this studio draft. Existing workspace drafts remain unchanged.</p>{legacy.error && <p className="studio-import-error">{legacy.error}</p>}{legacy.entries.length > 0 && <><label htmlFor="studio-legacy">Existing browser draft</label><select id="studio-legacy" value={legacyId} onChange={event => setLegacyId(event.target.value)}>{legacy.entries.map(([id, value]) => <option key={id} value={id}>{typeof value === 'object' && value && 'name' in value ? String(value.name) : id}</option>)}</select><button type="button" onClick={() => importValue(legacy.entries.find(([id]) => id === legacyId)?.[1])}>Import selected local draft</button><p className="studio-hint">Old simulated modules may be incompatible; unsupported entries are rejected without changing the original.</p></>}<label htmlFor="studio-import-json">Canonical workflow JSON</label><textarea id="studio-import-json" value={importText} onChange={event => setImportText(event.target.value)} rows={5} spellCheck={false} /><button type="button" onClick={() => { try { importValue(JSON.parse(importText)); } catch (error) { setError(message(error)); } }}>Import workflow JSON</button></details>
      </aside>
    </div>
  </div>;
}
