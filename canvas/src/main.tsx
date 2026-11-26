import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlow, Background, Controls, useNodesState, type Node } from '@xyflow/react';
import { gsap } from 'gsap';
import flowStyles from '@xyflow/react/dist/style.css?inline';
import styles from './style.css?inline';
import studioStyles from './studio.css?inline';
import { Studio } from './Studio';
import { compileWorkflow } from '../../shared/index';
import { invoiceWorkflow, invoicePolicy } from '../../fixtures/m0/invoice';

const mounted = new Map<HTMLElement, Root>();
const fixture = compileWorkflow(invoiceWorkflow, invoicePolicy).workflow;
const initialNodes: Node[] = fixture.nodes.map((node, index) => ({
  id: node.id,
  position: { x: index * 230, y: index % 2 ? 110 : 30 },
  data: { label: node.label },
}));
const edges = fixture.edges.map(edge => ({
  id: edge.id, source: edge.source, target: edge.target, label: edge.branch,
}));

function FixtureCanvas() {
  const element = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState('');
  const [nodes, , onNodesChange] = useNodesState(initialNodes);

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const context = gsap.context(() => {
      gsap.from('.spike-header', { opacity: 0, y: 8, duration: 0.3 });
    }, element);
    return () => context.revert();
  }, []);

  return <div className="spike" ref={element} onKeyDown={event => event.stopPropagation()}>
    <div className="spike-header">
      <div><h2>Invoice workflow fixture</h2><p>Contract-validated graph for renderer compatibility. Drag a node or use the graph keyboard controls. No account is connected and no automation executes.</p></div>
      <span className="badge">Offline fixture</span>
    </div>
    <div className="flow" data-testid="fixture-flow">
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange}
        nodesConnectable={false} deleteKeyCode={null} fitView minZoom={0.2} maxZoom={1.5}
        ariaLabelConfig={{ 'controls.zoomIn.ariaLabel': 'Zoom in', 'controls.zoomOut.ariaLabel': 'Zoom out', 'controls.fitView.ariaLabel': 'Fit workflow' }}>
        <Background gap={20} color="#c7d0bf" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
    <div className="fixture-controls">
      <label>Fixture note (not saved)<input value={note} onChange={event => setNote(event.target.value)} placeholder="Check typing and workspace shortcut isolation" /></label>
      <small>Drag positions and this note reset on remount.</small>
    </div>
    <p className="status" role="status">Schema checked. {nodes.length} fixture nodes. Not executed.</p>
    <ol className="node-list" aria-label="Workflow steps">{fixture.nodes.map(node => <li key={node.id}>{node.label} <code>{node.actionType}</code></li>)}</ol>
  </div>;
}

function mountRoot(host: HTMLElement, studio = false) {
  unmount(host);
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  const sheet = document.createElement('style');
  sheet.textContent = `${flowStyles}\n${studio ? studioStyles : styles}`;
  const container = document.createElement('div');
  shadow.replaceChildren(sheet, container);
  const root = createRoot(container);
  mounted.set(host, root);
  root.render(studio ? <Studio /> : <FixtureCanvas />);
  host.dataset.mounted = 'true';
}

export function mount(host: HTMLElement) { mountRoot(host); }
export function mountStudio(host: HTMLElement) { mountRoot(host, true); }

export function unmount(host: HTMLElement) {
  mounted.get(host)?.unmount();
  mounted.delete(host);
  host.shadowRoot?.replaceChildren();
  host.dataset.mounted = 'false';
}
