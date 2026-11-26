import { compileWorkflow } from '../../shared/index.js';
import { geminiFromEnv } from '../src/gemini.js';
import { plannerInput, plannerOutput } from '../src/planner.js';

try {
  const planner = geminiFromEnv();
  if (!planner) throw new Error();
  const workspaceId = 'gemini_smoke';
  const allowedOrigins = ['https://portal.example'];
  const { output, usage } = await planner(plannerInput(
    'Design a manual workflow named Portal preview. It should only open https://portal.example/invoices and take no other action. The browser connection is not configured yet.',
    allowedOrigins,
  ));
  const result = plannerOutput.parse(output);
  if (result.status !== 'candidate') throw new Error();
  const { workflow } = compileWorkflow(
    { ...result.definition, id: 'portal_preview', workspaceId }, { workspaceId, allowedOrigins, connections: [] },
  );
  if (workflow.nodes.length !== 1 || workflow.nodes[0]?.actionType !== 'browser.navigate') throw new Error();
  console.log('Gemini returned a valid synthetic navigation draft.', usage ?? '');
} catch {
  console.error('Gemini smoke check failed. Check the enable flag, key, and model access.');
  process.exitCode = 1;
}
