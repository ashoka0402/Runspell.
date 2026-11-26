// All strands follow one document-space route. Only the visible stretch is drawn.
const canvas = document.querySelector('#stream');
const context = canvas.getContext('2d', { alpha: true });
const bloom = document.createElement('canvas');
const bloomContext = bloom.getContext('2d', { alpha: true });
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const mix = (a, b, t) => a + (b - a) * t;

const colors = ['182,240,59', '220,251,125', '133,195,51', '114,211,231', '240,255,192'];
const families = [
  { lane: -.71, wave: .23, phase: .5 },
  { lane: -.32, wave: .58, phase: 1.9 },
  { lane: 0, wave: .12, phase: 0 },
  { lane: .34, wave: .66, phase: 4.6 },
  { lane: .72, wave: .33, phase: 2.8 },
];
let seed = 314159;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
const strands = Array.from({ length: 84 }, (_, index) => {
  const family = families[index % families.length];
  const color = index % 7 === 0 ? 3 : index % 11 === 0 ? 4 : index % 3;
  const strength = random();
  return {
    family,
    lane: (random() - .5) * .44,
    phase: random() * Math.PI * 2,
    color,
    weight: .38 + random() * .80,
    bright: strength > .57,
    opacity: .21 + strength * .35,
  };
});
const particles = Array.from({ length: 410 }, (_, index) => ({
  strand: index % strands.length,
  offset: random(),
  speed: .13 + random() * .23,
  radius: .33 + random() ** 3 * 1.48,
  opacity: .19 + random() * .51,
  streak: index % 11 === 0,
}));
const dust = Array.from({ length: 107 }, () => ({
  x: random(),
  y: random(),
  radius: .35 + random() ** 3 * 2.35,
  alpha: .04 + random() * .14,
}));
let width = 0;
let height = 0;
let ratio = 1;
let stride = 8;
let visibleSteps = 0;
let strandCount = 0;
let xSamples;
let ySamples;
let route = [];
let routeLength = 0;
let lastFrame = 0;
let frameId = 0;
let pointerX = .5;
let pointerY = -.5;
let ripple = 0;
let targetRipple = 0;
let lastRunPulse = -Infinity;

function layout() {
  width = canvas.clientWidth;
  height = canvas.clientHeight;
  if (!width || !height) return;
  ratio = Math.min(devicePixelRatio || 1, width < 650 ? 1.2 : 1.4);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  bloom.width = Math.ceil(width / 4);
  bloom.height = Math.ceil(height / 4);

  stride = width < 650 ? 8 : 7;
  visibleSteps = Math.ceil((height + 112) / stride) + 1;
  strandCount = width < 650 ? 54 : strands.length;
  xSamples = strands.map(() => new Float32Array(visibleSteps));
  ySamples = strands.map(() => new Float32Array(visibleSteps));

  route = [-.075, .62];
  const legLengths = [1.12, 1.05, 1.16, .98, 1.14, 1.04];
  const pageScreens = document.documentElement.scrollHeight / height;
  while (route.at(-1) < pageScreens + .45) {
    route.push(route.at(-1) + legLengths[(route.length - 2) % legLengths.length]);
  }
  routeLength = route.at(-1) + .5;
  if (reducedMotion.matches) draw(performance.now());
}

function roundTurn(t, knee) {
  if (t < knee) return t * t / (2 * knee * (1 - knee));
  if (t > 1 - knee) return 1 - roundTurn(1 - t, knee);
  return (t - knee / 2) / (1 - knee);
}

function trace(scroll, seconds) {
  const edge = width < 650 ? .072 : .047;
  const knee = clamp(width / height * .12, .065, .24);
  const margin = 56;
  let leg = 0;
  for (let point = 0; point < visibleSteps; point++) {
    const viewY = point * stride - margin;
    const worldY = (scroll + viewY) / height;
    while (leg < route.length - 2 && worldY > route[leg + 1]) leg++;
    const t = clamp((worldY - route[leg]) / (route[leg + 1] - route[leg]));
    const cross = roundTurn(t, knee);
    const fan = Math.pow(Math.sin(Math.PI * t), .91);
    const flutter = Math.sin(worldY * 10.4 - seconds * 1.34);
    const twist = (.19 + .81 * Math.sin(t * Math.PI * 1.7 + leg * .83) ** 2) * fan;
    const bend = Math.sin(t * 7.3 + leg * .63) * .037 + flutter * .011;
    const center = (leg % 2 === 0 ? mix(1 - edge, edge, cross) : mix(edge, 1 - edge, cross)) + fan * bend;
    const spread = .006 + fan * (width < 650 ? .173 : .157);
    const nearPointer = (viewY / height - pointerY) * 5.5;
    const pointerFlow = .030 * ripple * fan * Math.exp(-nearPointer * nearPointer) * (pointerX - center);

    for (let index = 0; index < strandCount; index++) {
      const strand = strands[index];
      const family = strand.family;
      const familyWave = Math.sin(worldY * 7.2 - seconds * .91 + family.phase);
      const smallWave = Math.sin(worldY * 18.6 - seconds * 1.73 + strand.phase);
      const lane = family.lane + strand.lane + family.wave * familyWave * twist + .12 * smallWave * fan;
      xSamples[index][point] = (center + lane * spread + pointerFlow) * width;
      ySamples[index][point] = viewY + family.lane * 12 + strand.lane * 18 + smallWave * 8 * fan;
    }
  }
}
function drawStrand(target, index) {
  const xs = xSamples[index];
  const ys = ySamples[index];
  target.beginPath();
  target.moveTo(xs[0], ys[0]);
  for (let i = 1; i < visibleSteps; i++) target.lineTo(xs[i], ys[i]);
  target.stroke();
}

function draw(secondsAtFrame) {
  if (!width || !height) return;
  const staticMotion = reducedMotion.matches;
  const seconds = staticMotion ? 6 : secondsAtFrame / 1000;
  const scroll = scrollY;
  const viewportStart = scroll / height;
  ripple = staticMotion ? 0 : mix(ripple, targetRipple, .14);
  trace(scroll, seconds);

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  // Wide bloom is rendered once at low resolution to keep the filaments sharp and the animation light.
  bloomContext.setTransform(bloom.width / width, 0, 0, bloom.height / height, 0, 0);
  bloomContext.clearRect(0, 0, width, height);
  bloomContext.lineCap = 'round';
  bloomContext.globalCompositeOperation = 'lighter';
  for (let index = 0; index < strandCount; index += 9) {
    bloomContext.strokeStyle = 'rgba(' + colors[strands[index].color] + ',.024)';
    bloomContext.lineWidth = 70;
    drawStrand(bloomContext, index);
    bloomContext.strokeStyle = 'rgba(' + colors[strands[index].color] + ',.033)';
    bloomContext.lineWidth = 29;
    drawStrand(bloomContext, index);
  }
  context.drawImage(bloom, 0, 0, width, height);

  const edge = width < 650 ? .072 : .047;
  for (let index = 1; index < route.length; index++) {
    const y = route[index] * height - scroll;
    if (y < -height * .25 || y > height * 1.25) continue;
    const x = width * (index % 2 ? edge : 1 - edge);
    const halo = context.createRadialGradient(x, y, 0, x, y, Math.min(width * .25, height * .39));
    halo.addColorStop(0, 'rgba(210,249,104,.23)');
    halo.addColorStop(.29, 'rgba(162,209,64,.13)');
    halo.addColorStop(1, 'rgba(99,146,39,0)');
    context.fillStyle = halo;
    context.fillRect(0, 0, width, height);
  }

  context.globalCompositeOperation = 'lighter';
  for (let index = 0; index < strandCount; index++) {
    const strand = strands[index];
    const color = colors[strand.color];
    if (strand.bright) {
      context.strokeStyle = 'rgba(' + color + ',.035)';
      context.lineWidth = strand.weight + 3.3;
      drawStrand(context, index);
    }
    const opacity = strand.opacity * (.82 + .18 * Math.cos(seconds * 1.6 + strand.phase));
    context.strokeStyle = 'rgba(' + color + ',' + opacity + ')';
    context.lineWidth = strand.weight;
    drawStrand(context, index);
  }

  const count = width < 650 ? 300 : particles.length;
  for (let index = 0; index < count; index++) {
    const particle = particles[index];
    const travel = (particle.offset * routeLength + seconds * particle.speed) % routeLength;
    const pos = ((travel - viewportStart + .1) * height + 56) / stride;
    if (pos < 1 || pos >= visibleSteps - 1) continue;
    const strand = particle.strand % strandCount;
    const point = Math.floor(pos);
    const part = pos - point;
    const xs = xSamples[strand];
    const ys = ySamples[strand];
    const x = mix(xs[point], xs[point + 1], part);
    const y = mix(ys[point], ys[point + 1], part);
    const color = colors[particle.streak ? 4 : strands[strand].color];
    if (particle.streak) {
      const tailX = xs[Math.max(0, point - 2)];
      const tailY = ys[Math.max(0, point - 2)];
      const trail = context.createLinearGradient(tailX, tailY, x, y);
      trail.addColorStop(0, 'rgba(' + color + ',0)');
      trail.addColorStop(1, 'rgba(' + color + ',.62)');
      context.strokeStyle = trail;
      context.lineWidth = 1.25;
      context.beginPath();
      context.moveTo(tailX, tailY);
      context.quadraticCurveTo(xs[point - 1], ys[point - 1], x, y);
      context.stroke();
    }
    context.fillStyle = 'rgba(' + color + ',' + particle.opacity + ')';
    context.beginPath();
    context.arc(x, y, particle.radius, 0, Math.PI * 2);
    context.fill();
  }
  const pulseAge = seconds - lastRunPulse;
  if (!staticMotion && pulseAge >= 0 && pulseAge < 3.8) {
    const pulseDepth = .20 + pulseAge * .52;
    const point = Math.round(((pulseDepth - viewportStart) * height + 56) / stride);
    const strength = Math.sin(Math.PI * clamp(pulseAge / 3.8)) ** .7;
    for (let index = 0; index < 7; index++) {
      const strand = (2 + index * 9) % strandCount;
      const head = point - index % 4;
      if (head < 1 || head >= visibleSteps) continue;
      const tail = Math.max(0, head - 9 - index % 4);
      const xs = xSamples[strand];
      const ys = ySamples[strand];
      const light = context.createLinearGradient(xs[tail], ys[tail], xs[head], ys[head]);
      light.addColorStop(0, 'rgba(190,247,78,0)');
      light.addColorStop(.7, 'rgba(200,251,103,' + strength * .35 + ')');
      light.addColorStop(1, 'rgba(242,255,199,' + strength * .86 + ')');
      context.strokeStyle = light;
      context.lineWidth = 1.75;
      context.beginPath();
      context.moveTo(xs[tail], ys[tail]);
      for (let sample = tail + 1; sample <= head; sample++) context.lineTo(xs[sample], ys[sample]);
      context.stroke();
    }
  }
  context.globalCompositeOperation = 'source-over';

  for (const particle of dust) {
    const y = ((particle.y - viewportStart * .12) % 1 + 1) % 1 * height;
    const flicker = .73 + .27 * Math.sin(seconds * .95 + particle.x * 52);
    context.fillStyle = 'rgba(204,234,125,' + particle.alpha * flicker + ')';
    context.beginPath();
    context.arc(particle.x * width, y, particle.radius, 0, Math.PI * 2);
    context.fill();
  }
}

function frame(now) {
  frameId = 0;
  if (document.hidden) return;
  if (now - lastFrame >= (width < 650 ? 24 : 15)) {
    draw(now);
    lastFrame = now;
  }
  if (!reducedMotion.matches) frameId = requestAnimationFrame(frame);
}
function updateMotion() {
  cancelAnimationFrame(frameId);
  frameId = 0;
  if (document.hidden) return;
  if (reducedMotion.matches) draw(performance.now());
  else frameId = requestAnimationFrame(frame);
}
if (context && bloomContext) {
  layout();
  updateMotion();
  const sizeObserver = new ResizeObserver(layout);
  sizeObserver.observe(document.body);
  addEventListener('resize', layout, { passive: true });
  addEventListener('scroll', () => {
    if (reducedMotion.matches && !frameId) frameId = requestAnimationFrame(frame);
  }, { passive: true });
  addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    pointerX = event.clientX / width;
    pointerY = event.clientY / height;
    targetRipple = 1;
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { targetRipple = 0; });
  document.addEventListener('relay-run-complete', () => { lastRunPulse = performance.now() / 1000; });
  document.addEventListener('visibilitychange', updateMotion);
  reducedMotion.addEventListener('change', updateMotion);
}
