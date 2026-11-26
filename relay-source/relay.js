const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const page = document.documentElement;
const canAnimate = !reducedMotion && 'IntersectionObserver' in window;
const clamp = (value) => Math.max(0, Math.min(1, value));
const smooth = (value) => {
  const progress = clamp(value);
  return progress * progress * (3 - 2 * progress);
};

const calendar = document.querySelector('#calendar-grid');
for (let index = 0; index < 35; index++) {
  const cell = document.createElement('i');
  const day = index % 7;
  const slot = Math.floor(index / 7);
  cell.classList.toggle('highlight', index === 15 || index === 24);
  cell.dataset.fill = '';
  cell.dataset.delay = day * .078 + slot * .033;
  cell.style.setProperty('--alpha', .40 + ((index * 11) % 9) / 15);
  calendar.append(cell);
}

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const volumes = [54, 69, 89, 69, 104, 78];
const columns = document.querySelector('#columns');
weekdays.forEach((day, index) => {
  const column = document.createElement('div');
  column.className = 'column mono';
  column.style.setProperty('--height', volumes[index] / 1.22 + '%');

  const bar = document.createElement('b');
  bar.dataset.fill = '';
  bar.dataset.delay = index * .085;
  bar.setAttribute('aria-hidden', 'true');
  bar.title = volumes[index] + ' sample runs';

  const label = document.createElement('span');
  label.textContent = day;
  column.append(bar, label);
  columns.append(column);
});

if (canAnimate) {
  page.classList.add('motion');
  const revealObserver = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px 54px 0px', threshold: .09 });
  document.querySelectorAll('.reveal').forEach((element) => revealObserver.observe(element));

  // Start each chart when it can be read. Reset beyond the viewport for the next pass.
  const format = new Intl.NumberFormat('en-US');
  const charts = new Map();
  function paintChart(chart, progress) {
    for (const mark of chart.marks) {
      const fraction = clamp((progress - mark.delay) / (.94 - mark.delay));
      const amount = fraction * fraction * (3 - 2 * fraction);
      if (mark.target === null) {
        mark.element.style.setProperty('--fill', amount.toFixed(4));
        continue;
      }
      const value = Math.round(mark.target * amount);
      if (value !== mark.lastValue) {
        mark.element.textContent = format.format(value) + mark.suffix;
        mark.lastValue = value;
      }
      if (mark.gauge) mark.gauge.style.setProperty('--arc', mark.target * amount + '%');
    }
  }
  const chartObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const chart = charts.get(entry.target);
      if (!entry.isIntersecting) {
        cancelAnimationFrame(chart.frame);
        chart.played = false;
        paintChart(chart, 0);
        continue;
      }
      if (entry.intersectionRatio < .32 || chart.played) continue;
      chart.played = true;
      const started = performance.now();
      function animate(now) {
        const progress = clamp((now - started) / chart.duration);
        paintChart(chart, progress);
        if (progress < 1) chart.frame = requestAnimationFrame(animate);
      }
      chart.frame = requestAnimationFrame(animate);
    }
  }, { rootMargin: '-70px 0px -5% 0px', threshold: [0, .32] });
  for (const element of document.querySelectorAll('[data-chart]')) {
    const chart = {
      duration: Number(element.dataset.chart),
      played: false,
      frame: 0,
      marks: [...element.querySelectorAll('[data-fill], [data-count]')].map((mark) => ({
        element: mark,
        delay: Number(mark.dataset.delay || 0),
        target: mark.hasAttribute('data-count') ? Number(mark.dataset.count) : null,
        suffix: mark.dataset.suffix || '',
        gauge: mark.closest('.gauge'),
        lastValue: null,
      })),
    };
    charts.set(element, chart);
    paintChart(chart, 0);
    chartObserver.observe(element);
  }
}

const mock = document.querySelector('#workflow');
if (!reducedMotion && matchMedia('(hover: hover) and (pointer: fine)').matches) {
  const hero = document.querySelector('.hero');
  hero.addEventListener('pointermove', (event) => {
    const bounds = hero.getBoundingClientRect();
    mock.style.setProperty('--ry', ((event.clientX - bounds.left) / bounds.width - .5) * 8 + 'deg');
    mock.style.setProperty('--rx', -((event.clientY - bounds.top) / bounds.height - .5) * 6 + 'deg');
  });
  hero.addEventListener('pointerleave', () => {
    mock.style.removeProperty('--ry');
    mock.style.removeProperty('--rx');
  });
}

const nodes = [...mock.querySelectorAll('[data-step]')];
const wires = [...mock.querySelectorAll('[data-wire]')];
const runState = mock.querySelector('#run-state span');
const runLog = mock.querySelector('#run-log');
const runId = mock.querySelector('#run-id');
const runMode = mock.querySelector('#run-mode');
const amountLabel = mock.querySelector('#node-amount');
const manualStatus = mock.querySelector('#manual-status');
const autoToggle = mock.querySelector('#toggle-autoplay');
const approveRun = mock.querySelector('#approve-run');
const approveSample = document.querySelector('#approve');
const approvalState = document.querySelector('#approval-state');
const samples = [6400, 1850, 3240, 8950, 920];
const runLabel = new Intl.NumberFormat('en-IN');
let autoPlay = canAnimate;
let workflowVisible = false;
let currentRun = null;
let nextRunId = 318;
let sampleIndex = 0;
let runTimer = 0;

function setRunState(text, phase) {
  runState.textContent = text;
  mock.dataset.phase = phase;
}
function setActiveStep(step) {
  for (const node of nodes) {
    node.classList.toggle('active', node.dataset.step === step);
    if (node.dataset.step === step) node.classList.add('visited');
  }
  for (const wire of wires) {
    wire.classList.toggle('active', wire.dataset.wire === step);
    if (wire.dataset.wire === step) wire.classList.add('visited');
  }
}
function addLog(message, symbol = '✓') {
  const item = document.createElement('li');
  const time = document.createElement('time');
  const indicator = document.createElement('b');
  const description = document.createElement('span');
  const now = new Date();
  time.dateTime = now.toISOString();
  time.textContent = now.toLocaleTimeString('en-GB');
  indicator.textContent = symbol;
  indicator.setAttribute('aria-hidden', 'true');
  description.textContent = message;
  item.append(indicator, time, description);
  runLog.prepend(item);
  while (runLog.children.length > 3) runLog.lastElementChild.remove();
}
function completeRun(approved) {
  const manual = currentRun.manual;
  approveRun.hidden = true;
  setActiveStep('');
  setRunState(approved ? 'Approved' : 'Completed', 'complete');
  addLog(approved ? 'Finance approved the sample refund' : 'Refund logged in payments');
  mock.style.setProperty('--execution', '100%');
  if (manual) manualStatus.textContent = 'Sample refund approved.';
  if (!reducedMotion) document.dispatchEvent(new Event('relay-run-complete'));
  currentRun = null;
  runTimer = setTimeout(syncAutoplay, manual ? 3600 : 1100);
}
function advanceRun() {
  const { steps, position, manual, needsApproval } = currentRun;
  if (position === steps.length) {
    if (!needsApproval) {
      completeRun(false);
      return;
    }
    setRunState('Waiting for approval', manual ? 'manual-wait' : 'waiting');
    addLog('Approval request sent to finance', '◇');
    if (manual) {
      approveRun.hidden = false;
      approveSample.disabled = false;
      manualStatus.textContent = 'Sample refund is waiting for your approval.';
    } else {
      runTimer = setTimeout(() => completeRun(true), 1150);
    }
    return;
  }
  const [step, message] = steps[position];
  currentRun.position++;
  setActiveStep(step);
  addLog(message, '›');
  mock.style.setProperty('--execution', (18 + position * 31) + '%');
  runTimer = setTimeout(advanceRun, reducedMotion ? 110 : [780, 960, 950][position]);
}
function startRun(manual) {
  clearTimeout(runTimer);
  const amount = manual ? samples[0] : samples[sampleIndex++ % samples.length];
  const formattedAmount = '₹' + runLabel.format(amount);
  const needsApproval = amount > 5000;
  currentRun = {
    manual,
    needsApproval,
    position: 0,
    steps: [
      ['open', 'Opened refund request in the browser'],
      ['check', formattedAmount + ' read from the refund form'],
      needsApproval
        ? ['finance', 'Amount over ₹5,000 · routing to finance']
        : ['payments', 'Within limit · filling the payments form'],
    ],
  };
  if (manual) {
    approveSample.disabled = true;
    approvalState.textContent = '';
    manualStatus.textContent = 'Running the sample refund workflow.';
  }
  nodes.forEach((node) => node.classList.remove('visited', 'active'));
  wires.forEach((wire) => wire.classList.remove('visited', 'active'));
  approveRun.hidden = true;
  runId.textContent = 'RUN ' + String(nextRunId++).padStart(4, '0');
  runMode.textContent = manual ? 'MANUAL DEMO' : 'AUTOPLAY';
  amountLabel.textContent = formattedAmount + ' · Read page';
  setRunState('Running', 'running');
  advanceRun();
}
function syncAutoplay() {
  if (currentRun?.manual) return;
  const shouldPlay = autoPlay && workflowVisible && !document.hidden;
  if (shouldPlay && !currentRun) {
    startRun(false);
    return;
  }
  if (!shouldPlay) {
    clearTimeout(runTimer);
    currentRun = null;
    if (!autoPlay || mock.dataset.phase === 'running' || mock.dataset.phase === 'waiting') {
      setRunState('Paused', 'paused');
    }
  }
}
if (canAnimate) {
  autoToggle.hidden = false;
  autoToggle.addEventListener('click', () => {
    autoPlay = !autoPlay;
    autoToggle.setAttribute('aria-label', autoPlay ? 'Pause autoplay' : 'Resume autoplay');
    syncAutoplay();
  });
  const workflowObserver = new IntersectionObserver(([entry]) => {
    workflowVisible = entry.isIntersecting && entry.intersectionRatio >= .24;
    syncAutoplay();
  }, { threshold: [0, .24] });
  workflowObserver.observe(mock);
  document.addEventListener('visibilitychange', syncAutoplay);
}
document.querySelectorAll('[data-run]').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.closest('footer') || matchMedia('(max-width: 700px)').matches) {
      mock.scrollIntoView({ block: 'center' });
    }
    startRun(true);
  });
});
function approveCurrentRun() {
  if (mock.dataset.phase !== 'manual-wait') return;
  completeRun(true);
  approveSample.disabled = true;
  approvalState.textContent = '✓ Sample approved';
}
approveRun.addEventListener('click', () => {
  approveCurrentRun();
  mock.setAttribute('tabindex', '-1');
  mock.focus({ preventScroll: true });
});
approveSample.addEventListener('click', () => {
  approveCurrentRun();
  approveSample.disabled = true;
  approvalState.textContent = '✓ Sample approved';
});

const slider = document.querySelector('#runs');
const plans = [['Starter', '$29', '3,000'], ['Team', '$89', '30,000'], ['Scale', '$290', '300,000']];
function updatePlan() {
  const index = Number(slider.value);
  const [name, price, runs] = plans[index];
  document.querySelector('#plan').textContent = name;
  document.querySelector('#price').textContent = price;
  slider.setAttribute('aria-valuetext', runs + ' runs per month, ' + name);
  slider.style.setProperty('--usage', (index * 50) + '%');
  document.querySelectorAll('[data-plan]').forEach((card) => card.classList.toggle('selected', Number(card.dataset.plan) === index));
}
slider.addEventListener('input', updatePlan);
updatePlan();

const plate = document.querySelector('.plate-track');
const stage = document.querySelector('.plate-stage');
const words = [...document.querySelectorAll('.plate-copy h2 span')];
const nav = document.querySelector('.top');
let scrollFrame = 0;
function updateScroll() {
  scrollFrame = 0;
  if (reducedMotion) return;
  const distance = plate.offsetHeight - stage.offsetHeight;
  const offset = parseFloat(getComputedStyle(stage).top) - plate.getBoundingClientRect().top;
  const progress = clamp(offset / Math.max(distance, 1));
  const open = smooth((progress - .02) / .26) * (1 - smooth((progress - .68) / .31));
  nav.style.setProperty('--reading-progress', clamp(scrollY / Math.max(page.scrollHeight - innerHeight, 1)));
  stage.style.setProperty('--plate-x', ((1 - open) * 49.8) + '%');
  stage.style.setProperty('--plate-y', ((1 - open) * 49.8) + '%');
  stage.style.setProperty('--mark-y', ((open - 1) * stage.offsetHeight * .15) + 'px');
  stage.style.setProperty('--plate-text', open > .78 ? 'visible' : 'hidden');
  words.forEach((word, index) => {
    const amount = smooth((progress - .21 - index * .035) / .12) * (1 - smooth((progress - .68) / .11));
    word.style.opacity = amount;
    word.style.transform = 'translateY(' + ((1 - amount) * 18) + 'px)';
  });
}
function queueScrollUpdate() {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScroll);
}
updateScroll();
addEventListener('resize', queueScrollUpdate, { passive: true });
addEventListener('scroll', queueScrollUpdate, { passive: true });
