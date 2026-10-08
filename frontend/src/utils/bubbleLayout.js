// Places bubbles inside the starfield without overlaps.
// The old layout pinned bubbles to five fixed CSS slots, so from the sixth bubble on
// they were stacked on top of each other. Here every bubble starts on a sunflower
// spiral, then a small collision simulation pushes them apart while a gentle pull
// keeps the group centred. A binary search finds the largest bubble scale that fits.

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function seedFor(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000) / 1000;
}

function clampInside(bubble, width, height, padding) {
  bubble.x = Math.min(width - padding - bubble.r, Math.max(padding + bubble.r, bubble.x));
  bubble.y = Math.min(height - padding - bubble.r, Math.max(padding + bubble.r, bubble.y));
}

function simulate(items, width, height, scale, options) {
  const { gap, padding, minSize, maxSize } = options;
  const centerX = width / 2;
  const centerY = height / 2;
  const bubbles = items.map((item, index) => {
    const size = Math.max(minSize, Math.min(maxSize, item.size * scale));
    const t = Math.sqrt((index + 0.5) / items.length);
    const angle = index * GOLDEN_ANGLE + seedFor(item.id) * 0.6;
    return {
      id: item.id,
      r: size / 2,
      x: centerX + Math.cos(angle) * t * (width / 2 - padding - size / 2) * 0.9,
      y: centerY + Math.sin(angle) * t * (height / 2 - padding - size / 2) * 0.9,
    };
  });
  bubbles.forEach((bubble) => clampInside(bubble, width, height, padding));

  const iterations = 260;
  for (let step = 0; step < iterations; step += 1) {
    const pull = 0.012 * (1 - step / iterations);
    for (const bubble of bubbles) {
      bubble.x += (centerX - bubble.x) * pull;
      bubble.y += (centerY - bubble.y) * pull;
    }
    for (let i = 0; i < bubbles.length; i += 1) {
      for (let j = i + 1; j < bubbles.length; j += 1) {
        const a = bubbles[i];
        const b = bubbles[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        const minimum = a.r + b.r + gap;
        if (distance >= minimum) continue;
        if (distance < 0.01) {
          const angle = (i + 1) * GOLDEN_ANGLE;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const push = (minimum - distance) / distance;
        const total = a.r + b.r;
        a.x -= dx * push * (b.r / total);
        a.y -= dy * push * (b.r / total);
        b.x += dx * push * (a.r / total);
        b.y += dy * push * (a.r / total);
      }
    }
    bubbles.forEach((bubble) => clampInside(bubble, width, height, padding));
  }

  let worst = 0;
  for (let i = 0; i < bubbles.length; i += 1) {
    for (let j = i + 1; j < bubbles.length; j += 1) {
      const a = bubbles[i];
      const b = bubbles[j];
      worst = Math.max(worst, a.r + b.r + gap * 0.6 - Math.hypot(b.x - a.x, b.y - a.y));
    }
  }
  return { bubbles, ok: worst <= 0 };
}

function gridFallback(items, width, height, gap) {
  const columns = Math.max(1, Math.ceil(Math.sqrt((items.length * width) / Math.max(height, 1))));
  const rows = Math.max(1, Math.ceil(items.length / columns));
  const cell = Math.min(width / columns, height / rows);
  const size = Math.max(40, cell - gap);
  const offsetX = (width - cell * columns) / 2;
  const offsetY = (height - cell * rows) / 2;
  return items.map((item, index) => ({
    id: item.id,
    size,
    x: offsetX + (index % columns) * cell + cell / 2,
    y: offsetY + Math.floor(index / columns) * cell + cell / 2,
  }));
}

export function layoutBubbles(items, width, height, options = {}) {
  if (!width || !height || items.length === 0) return [];
  const settings = { gap: 10, padding: 10, minSize: 96, ...options };
  settings.maxSize = Math.min(options.maxSize || 236, Math.min(width, height) * 0.62);
  settings.minSize = Math.min(settings.minSize, settings.maxSize);
  const sorted = [...items].sort((a, b) => b.size - a.size);

  // Largest scale where the simulation settles without overlaps.
  let low = 0.2;
  let high = 1.25;
  let best = null;
  for (let round = 0; round < 11; round += 1) {
    const scale = (low + high) / 2;
    const result = simulate(sorted, width, height, scale, settings);
    if (result.ok) {
      best = result;
      low = scale;
    } else {
      high = scale;
    }
  }
  if (!best) {
    const relaxed = { ...settings, minSize: Math.max(56, settings.minSize * 0.75) };
    const result = simulate(sorted, width, height, 0.2, relaxed);
    if (!result.ok) return gridFallback(sorted, width, height, settings.gap);
    best = result;
  }
  return best.bubbles.map((bubble) => ({ id: bubble.id, x: bubble.x, y: bubble.y, size: bubble.r * 2 }));
}

// How many bubbles comfortably fit before we show "還有 N 顆".
export function bubbleCapacity(width, height, minSize = 104) {
  if (!width || !height) return 0;
  const usable = width * height * 0.42;
  return Math.max(3, Math.floor(usable / (Math.PI * (minSize / 2) ** 2)));
}
