import { expect, test, type Page } from '@playwright/test';

async function openBlankScenario(page: Page) {
  await page.goto('/app/#/overview');
  await page.getByRole('button', { name: 'New scenario', exact: true }).click();
  await page.getByRole('button', { name: 'Blank scenario', exact: true }).click();
  return page.locator('#builder');
}

async function reopenSavedScenario(page: Page) {
  await page.reload();
  await page.getByRole('button', { name: 'New scenario', exact: true }).click();
  await page.getByRole('button', { name: 'Resume saved draft' }).click();
}

test('the three persistent trigger options can independently start the same workflow', async ({ page }) => {
  const builder = await openBlankScenario(page);
  const options = builder.locator('.workflow-panel');
  const choices = options.locator('[data-kind="trigger"]');
  const nodes = builder.locator('[data-workflow-move]');
  const preview = builder.getByRole('button', { name: 'Preview run' });
  await expect(preview).toBeDisabled();
  await builder.getByRole('button', { name: /Add trigger/ }).click();
  await expect(choices).toHaveCount(3);
  await expect(choices).toContainText(['Storefront', 'Schedule', 'Webhook']);

  const webhook = choices.filter({ hasText: 'Webhook' });
  const schedule = choices.filter({ hasText: 'Schedule' });
  await webhook.click();
  await schedule.click();
  await expect(webhook).toHaveAttribute('aria-pressed', 'true');
  await expect(schedule).toHaveAttribute('aria-pressed', 'true');
  await expect(nodes).toHaveCount(2);
  await expect(builder.locator('.workflow-edge')).toHaveCount(0);
  await schedule.click();
  await expect(schedule).toHaveAttribute('aria-pressed', 'false');
  await expect(nodes).toHaveCount(1);
  await schedule.click();

  await options.locator('[data-app="Helpdesk"]').click();
  await expect(nodes).toHaveCount(3);
  const links = builder.locator('.workflow-edge');
  await expect(links).toHaveCount(2);
  await expect(links.nth(0)).toHaveAttribute('data-from', '0');
  await expect(links.nth(1)).toHaveAttribute('data-from', '1');
  for (const index of [0, 1]) await expect(links.nth(index)).toHaveAttribute('data-to', '2');

  await builder.getByRole('button', { name: 'Save draft' }).click();
  await reopenSavedScenario(page);
  await expect(webhook).toHaveAttribute('aria-pressed', 'true');
  await expect(schedule).toHaveAttribute('aria-pressed', 'true');
  await preview.click();
  await expect(builder.getByText('Choose a trigger to preview', { exact: true })).toBeVisible();
  await builder.getByRole('button', { name: 'Schedule', exact: true }).click();
  const runSteps = builder.locator('.workflow-run-list li');
  await expect(runSteps).toHaveCount(2);
  await expect(runSteps).toContainText(['Schedule', 'Helpdesk']);
  await expect(choices).toHaveCount(3);
});

test('blank workflows show modules and support moving, saving and deleting nodes', async ({ page }) => {
  const builder = await openBlankScenario(page);
  const modules = builder.locator('.workflow-choices');
  const nodes = builder.locator('.workflow-node[data-workflow-move]');
  await expect(builder.getByRole('heading', { name: 'Available modules' })).toBeVisible();
  await expect(modules.locator('[data-app="Webhook"]')).toBeVisible();
  await expect(modules.locator('[data-app="Helpdesk"]')).toBeVisible();
  await expect(nodes).toHaveCount(0);

  await modules.locator('[data-app="Webhook"]').click();
  await modules.locator('[data-app="Helpdesk"]').click();
  await expect(nodes).toHaveCount(2);
  await builder.getByRole('button', { name: 'Zoom in' }).click();
  await builder.getByRole('button', { name: 'Preview run' }).click();
  await expect(builder.getByText(/Simulation complete/)).toBeVisible();
  const action = nodes.filter({ hasText: 'Helpdesk' });
  await action.scrollIntoViewIfNeeded();
  const before = (await action.boundingBox())!;
  const x = before.x + before.width / 2;
  const y = before.y + before.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 42, y + 82, { steps: 8 });
  await page.mouse.up();
  const after = (await action.boundingBox())!;
  expect(after.x).toBeLessThan(before.x - 30);
  expect(after.y).toBeGreaterThan(before.y + 50);
  const layoutY = await action.evaluate(node => node.style.getPropertyValue('--node-y'));
  expect(parseFloat(layoutY)).toBeGreaterThan(50);

  await builder.getByRole('button', { name: 'Save draft' }).click();
  await expect(builder.getByText('Draft saved in this browser')).toBeVisible();
  await reopenSavedScenario(page);
  await expect(nodes).toHaveCount(2);
  await expect.poll(() => action.evaluate(node => node.style.getPropertyValue('--node-y'))).toBe(layoutY);

  await action.click();
  await builder.getByRole('button', { name: 'Delete node' }).click();
  await expect(nodes).toHaveCount(1);
  await expect(nodes.first()).toContainText('Webhook');
  await builder.getByRole('button', { name: 'Undo step change' }).click();
  await expect(nodes).toHaveCount(2);
  await expect(action).toBeVisible();

  await nodes.first().click();
  await builder.getByRole('button', { name: 'Delete node' }).click();
  await expect(nodes).toHaveCount(1);
  await expect(action).toBeVisible();
  await expect(builder.getByRole('button', { name: 'Preview run' })).toBeDisabled();
});

test('directional connections follow moved nodes and reconnect when a configured node is deleted', async ({ page }) => {
  const builder = await openBlankScenario(page);
  const modules = builder.locator('.workflow-choices');
  const nodes = builder.locator('[data-workflow-move]');
  const links = builder.locator('.workflow-edge');
  await modules.locator('[data-app="Webhook"]').click();
  await modules.locator('[data-app="Helpdesk"]').click();
  await modules.locator('[data-app="Mail"]').click();

  const incoming = builder.locator('.workflow-edge[data-from="0"][data-to="1"]');
  const outgoing = builder.locator('.workflow-edge[data-from="1"][data-to="2"]');
  await expect(links).toHaveCount(2);
  await expect(incoming).toHaveAttribute('marker-end', 'url(#workflow-arrow)');
  await expect(outgoing).toHaveAttribute('marker-end', 'url(#workflow-arrow)');
  await expect(incoming).toHaveAttribute('d', /^M.+C/);
  expect(await incoming.evaluate(element => {
    const path = element as SVGPathElement;
    return path.getPointAtLength(0).x < path.getPointAtLength(path.getTotalLength()).x;
  })).toBe(true);
  const pulse = builder.locator('.workflow-edge-pulse').first();
  await expect(pulse).toHaveAttribute('pathLength', '100');
  await expect(pulse).toHaveAttribute('d', (await links.first().getAttribute('d'))!);
  await expect(pulse).not.toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(pulse).toHaveCSS('animation-name', 'none');

  const initialIncoming = await incoming.getAttribute('d');
  const initialOutgoing = await outgoing.getAttribute('d');
  const helpdesk = nodes.filter({ hasText: 'Helpdesk' });
  await helpdesk.scrollIntoViewIfNeeded();
  const bounds = (await helpdesk.boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 24, y + 96, { steps: 8 });
  await page.mouse.up();
  await expect(incoming).not.toHaveAttribute('d', initialIncoming!);
  await expect(outgoing).not.toHaveAttribute('d', initialOutgoing!);

  await helpdesk.click();
  const settings = builder.getByRole('region', { name: 'Module settings' });
  await settings.getByLabel('Ticket title').fill('Review the new request');
  await settings.getByLabel('Priority').selectOption({ label: 'High' });
  await settings.getByRole('button', { name: 'Done' }).click();
  await builder.getByRole('button', { name: 'Save draft' }).click();
  await reopenSavedScenario(page);
  await helpdesk.click();
  await expect(settings.getByLabel('Ticket title')).toHaveValue('Review the new request');
  await expect(settings.getByLabel('Priority').locator('option:checked')).toHaveText('High');
  await settings.getByRole('button', { name: 'Delete node' }).click();
  await expect(nodes).toContainText(['Webhook', 'Mail']);
  await expect(links).toHaveCount(1);
  await expect(incoming).toHaveAttribute('marker-end', 'url(#workflow-arrow)');
  await expect(outgoing).toHaveCount(0);
});

test('left-side chat builds in the canvas, retains history and confirms replacement', async ({ page }) => {
  const builder = await openBlankScenario(page);
  const nodes = builder.locator('.workflow-node[data-workflow-move]');
  const prompt = builder.locator('#workflow-prompt');
  const chat = builder.locator('.workflow-chat-history');
  const generate = builder.getByRole('button', { name: 'Generate draft' });
  await expect(chat).toBeVisible();
  const threadBounds = (await chat.boundingBox())!;
  const composerBounds = (await builder.locator('.workflow-chat-composer').boundingBox())!;
  const boardBounds = (await builder.locator('.workflow-board').boundingBox())!;
  const promptBounds = (await builder.locator('.workflow-prompt').boundingBox())!;
  const optionsBounds = (await builder.locator('.workflow-panel').boundingBox())!;
  expect(promptBounds.width).toBe(optionsBounds.width);
  expect(boardBounds.width).toBeGreaterThan((promptBounds.width + boardBounds.width + optionsBounds.width) * 0.65);
  expect(promptBounds.x + promptBounds.width).toBeLessThanOrEqual(boardBounds.x + 1);
  expect(boardBounds.x + boardBounds.width).toBeLessThanOrEqual(optionsBounds.x + 1);
  expect(composerBounds.y).toBeGreaterThanOrEqual(threadBounds.y + threadBounds.height - 1);
  const firstRequest = 'When a webhook arrives or a new order is placed, create a Helpdesk ticket.';
  await prompt.fill(firstRequest);
  await generate.click();
  await expect(nodes).toHaveCount(3);
  await expect(nodes).toContainText(['Webhook', 'Storefront', 'Helpdesk']);
  await expect(chat).toContainText(firstRequest);
  await expect(chat.locator('[data-speaker="assistant"]')).toHaveCount(1);

  const secondRequest = 'Every morning, add a row in Sheets, then send an email.';
  await prompt.fill(secondRequest);
  await generate.click();
  await expect(nodes.nth(2)).toContainText('Helpdesk');
  await builder.getByRole('button', { name: 'Keep current workflow' }).click();
  await expect(nodes.nth(2)).toContainText('Helpdesk');
  await prompt.fill(secondRequest);
  await generate.click();
  await builder.getByRole('button', { name: 'Replace workflow' }).click();
  await expect(nodes).toHaveCount(3);
  await expect(nodes.nth(0)).toContainText('Schedule');
  await expect(nodes.nth(1)).toContainText('Sheets');
  await expect(nodes.nth(2)).toContainText('Mail');
  await builder.getByRole('button', { name: 'Save draft' }).click();
  await expect(builder.getByText('Draft saved in this browser')).toBeVisible();
  await reopenSavedScenario(page);
  await expect(chat).toContainText(firstRequest);
  await expect(chat).toContainText(secondRequest);
  await expect(nodes).toContainText(['Schedule', 'Sheets', 'Mail']);
  await builder.getByRole('button', { name: 'New chat' }).click();
  await expect(chat.locator('[data-speaker="user"]')).toHaveCount(0);
  await expect(nodes).toContainText(['Schedule', 'Sheets', 'Mail']);
});

test('templates open different populated workflows in the editor', async ({ page }) => {
  await page.goto('/app/#/scenarios/templates');
  const builder = page.locator('#builder');
  const nodes = builder.locator('.workflow-node[data-workflow-move]');
  for (const [name, expectedSteps, openControl] of [
    ['New order → packing slip', ['Storefront', 'Cloud files'], 'New order → packing slip'],
    ['Low stock → reorder', ['Schedule', 'Sheets', 'Filter', 'Mail'], 'Use template'],
  ] as const) {
    const card = page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await card.getByRole('button', { name: openControl, exact: true }).click();
    await expect(builder.getByRole('textbox', { name: 'Scenario name' })).toHaveValue(name);
    await expect(nodes).toHaveCount(expectedSteps.length);
    for (const [index, step] of expectedSteps.entries()) await expect(nodes.nth(index)).toContainText(step);
    await builder.getByRole('button', { name: 'Back', exact: false }).click();
    await expect(builder).toBeHidden();
  }
});
