// Generates the animated terminal-style profile cards (dark.svg / light.svg).
// Run with `npm run generate`. Re-run automatically by
// .github/workflows/profile-readme.yml on a schedule and on push.

import { Jimp, intToRGBA } from "jimp";
import { writeFile } from "node:fs/promises";

const USERNAME = "jeslor";
const WIDTH = 1180;
const ASCII_COLS = 54;
const ASCII_ROWS = 42;
const RAMP = " .:-=+*#%@"; // sparse (dark) -> dense (bright)

const PANEL_X = 40;
const PANEL_Y = 92;
const LEFT_W = 470;
const RIGHT_X = PANEL_X + LEFT_W + 40;
const RIGHT_W = WIDTH - RIGHT_X - 40;
const LINE_H = 25;
const SECTION_TITLE_GAP = 26;
const SECTION_GAP = 34;

const THEMES = {
  dark: {
    name: "dark",
    bg0: "#050816",
    bg1: "#0B1120",
    panel: "#0A0F1E",
    panelAlt: "#0E1729",
    border0: "#22C55E",
    border1: "#10B981",
    border2: "#34D399",
    accent: "#38BDF8",
    text: "#E2E8F0",
    textDim: "#64748B",
    leader: "#1E293B",
    scan: "#7DD3FC",
    heat: ["#101826", "#0C4A6E", "#0369A1", "#22D3EE", "#34D399"],
  },
  light: {
    name: "light",
    bg0: "#F0F9FF",
    bg1: "#E0F2FE",
    panel: "#FFFFFF",
    panelAlt: "#F8FAFC",
    border0: "#16A34A",
    border1: "#059669",
    border2: "#10B981",
    accent: "#0284C7",
    text: "#0F172A",
    textDim: "#64748B",
    leader: "#E2E8F0",
    scan: "#0EA5E9",
    heat: ["#E7ECF3", "#BAE6FD", "#38BDF8", "#0284C7", "#059669"],
  },
};

async function buildAscii(path) {
  const img = await Jimp.read(path);
  img.resize({ w: ASCII_COLS, h: ASCII_ROWS });

  const lum = (x, y) => {
    const { r, g, b } = intToRGBA(img.getPixelColor(x, y));
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  };

  // Estimate background tone from the corners, then render density from
  // *contrast against that background* rather than raw brightness — this
  // keeps busy backgrounds quiet and the subject legible regardless of
  // whether the photo is on a light studio backdrop or a busy outdoor one.
  const corners = [
    lum(1, 1),
    lum(ASCII_COLS - 2, 1),
    lum(1, ASCII_ROWS - 2),
    lum(ASCII_COLS - 2, ASCII_ROWS - 2),
  ];
  const bgLum = corners.reduce((a, b) => a + b, 0) / corners.length;

  const focusX = ASCII_COLS / 2;
  const focusY = ASCII_ROWS * 0.46;
  const maxDist = Math.hypot(ASCII_COLS * 0.6, ASCII_ROWS * 0.62);

  const rows = [];
  for (let y = 0; y < ASCII_ROWS; y++) {
    let row = "";
    for (let x = 0; x < ASCII_COLS; x++) {
      const luminance = lum(x, y);
      const contrast = smoothstep(0.06, 0.5, Math.abs(luminance - bgLum));
      const dist = Math.hypot(x - focusX, y - focusY) / maxDist;
      const vignette = 1 - smoothstep(0.55, 1.05, dist);
      const density = Math.max(0, Math.min(1, contrast * (0.55 + 0.45 * vignette)));
      const idx = Math.min(RAMP.length - 1, Math.floor(density * RAMP.length));
      row += RAMP[idx];
    }
    rows.push(escapeXml(row));
  }
  return rows;
}

function smoothstep(edge0, edge1, v) {
  const t = Math.max(0, Math.min(1, (v - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function escapeXml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function kv(label, value, col = 17) {
  const dots = ".".repeat(Math.max(2, col - label.length));
  return { label: escapeXml(`${label}:`), dots, value: escapeXml(String(value)) };
}

async function fetchGitHubStats() {
  const headers = { "User-Agent": USERNAME };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const res = await fetch(`https://api.github.com/users/${USERNAME}`, { headers });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    return { repos: data.public_repos ?? "—", followers: data.followers ?? "—" };
  } catch {
    return { repos: "—", followers: "—" };
  }
}

async function fetchContributionCalendar() {
  const token = process.env.GITHUB_TOKEN;
  const query = `query($login:String!){ user(login:$login){ contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount weekday } } } } } }`;
  if (token) {
    try {
      const res = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": USERNAME,
        },
        body: JSON.stringify({ query, variables: { login: USERNAME } }),
      });
      const json = await res.json();
      const calendar = json?.data?.user?.contributionsCollection?.contributionCalendar;
      if (calendar) return calendar;
      console.warn("GraphQL contribution query failed, using placeholder data", json.errors ?? json);
    } catch (err) {
      console.warn("Contribution fetch failed, using placeholder data", err.message);
    }
  }
  return synthesizeCalendar();
}

function synthesizeCalendar() {
  const weeks = [];
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 371);
  start.setDate(start.getDate() - start.getDay());
  let cursor = new Date(start);
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  let total = 0;
  while (cursor <= today) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const count = cursor > today ? 0 : Math.max(0, Math.floor(rand() * rand() * 12));
      total += count;
      days.push({ date: cursor.toISOString().slice(0, 10), contributionCount: count, weekday: d });
      cursor = new Date(cursor.getTime() + 86400000);
    }
    weeks.push({ contributionDays: days });
  }
  return { totalContributions: total, weeks };
}

function computeStreaks(days) {
  let current = 0;
  let longest = 0;
  let running = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const day of days) {
    if (day.contributionCount > 0) {
      running += 1;
      longest = Math.max(longest, running);
    } else {
      running = 0;
    }
  }
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].date > today) continue;
    if (days[i].contributionCount > 0) current += 1;
    else break;
  }
  return { current, longest };
}

function levelFor(count, max) {
  if (count <= 0) return 0;
  const ratio = count / Math.max(1, max);
  if (ratio >= 0.65) return 4;
  if (ratio >= 0.4) return 3;
  if (ratio >= 0.15) return 2;
  return 1;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A single probe beam rides with the jet at all times: x tracks the jet
// (it's a child of the jet's translate group), and its length is keyed per
// column — reaching the topmost row by default, or shrinking to meet a
// green ("More" tier) cell when that column has real contributions to show.
function buildProbeBeam(t, gridX, gridY, cell, step, weeks, max, laneY, dur) {
  const gridW = weeks.length * step;
  const xStart = gridX + 10;
  const xEnd = gridX + gridW - 10;
  const greenColor = t.heat[t.heat.length - 1];
  const topY = gridY + cell / 2;

  const columnTargets = weeks.map((week) => {
    let best = null;
    week.contributionDays.forEach((day) => {
      if (!best || day.contributionCount > best.contributionCount) best = day;
    });
    const isGreen = Boolean(best && levelFor(best.contributionCount, max) === 4);
    return { y: isGreen ? gridY + best.weekday * step + cell / 2 : topY, green: isGreen };
  });

  const events = [];
  columnTargets.forEach((target, wi) => {
    const x = gridX + wi * step + cell / 2;
    const xFraction = Math.min(1, Math.max(0, (x - xStart) / (xEnd - xStart)));
    events.push({ t: xFraction * 0.5, target });
    events.push({ t: 0.5 + (1 - xFraction) * 0.5, target });
  });
  events.sort((a, b) => a.t - b.t);

  const keyTimes = [];
  const y2Values = [];
  const colorValues = [];
  const widthValues = [];
  const dotValues = [];
  let last = -1;
  events.forEach(({ t: eventTime, target }) => {
    let ct = Math.min(1, Math.max(0, eventTime));
    if (ct <= last) ct = Math.min(1, last + 0.0006);
    keyTimes.push(ct.toFixed(4));
    y2Values.push((-(laneY - target.y)).toFixed(1));
    colorValues.push(target.green ? greenColor : t.accent);
    widthValues.push(target.green ? "2.6" : "1.1");
    dotValues.push(target.green ? "3.4" : "1.6");
    last = ct;
  });
  const kt = keyTimes.join(";");

  return `
    <line x1="0" y1="0" x2="0" y2="${y2Values[0]}" stroke="${colorValues[0]}" stroke-width="${widthValues[0]}" stroke-linecap="round" opacity="0.85">
      <animate attributeName="y2" dur="${dur}s" repeatCount="indefinite" keyTimes="${kt}" values="${y2Values.join(";")}"/>
      <animate attributeName="stroke" dur="${dur}s" repeatCount="indefinite" keyTimes="${kt}" values="${colorValues.join(";")}"/>
      <animate attributeName="stroke-width" dur="${dur}s" repeatCount="indefinite" keyTimes="${kt}" values="${widthValues.join(";")}"/>
    </line>
    <circle cx="0" cy="${y2Values[0]}" r="${dotValues[0]}" fill="${colorValues[0]}">
      <animate attributeName="cy" dur="${dur}s" repeatCount="indefinite" keyTimes="${kt}" values="${y2Values.join(";")}"/>
      <animate attributeName="fill" dur="${dur}s" repeatCount="indefinite" keyTimes="${kt}" values="${colorValues.join(";")}"/>
      <animate attributeName="r" dur="${dur}s" repeatCount="indefinite" keyTimes="${kt}" values="${dotValues.join(";")}"/>
    </circle>`;
}

function buildJetLane(t, gridX, gridY, cell, gap, weeks, max, laneY, dur = 13) {
  const step = cell + gap;
  const gridW = weeks.length * step;
  const xStart = gridX + 10;
  const xEnd = gridX + gridW - 10;
  const beam = buildProbeBeam(t, gridX, gridY, cell, step, weeks, max, laneY, dur);

  return `
  <line x1="${gridX}" y1="${laneY}" x2="${gridX + gridW}" y2="${laneY}" stroke="${t.leader}" stroke-width="1" stroke-dasharray="2 4" opacity="0.5"/>
  <g filter="url(#hSoftGlow)">
    <animateTransform attributeName="transform" type="translate" dur="${dur}s" repeatCount="indefinite"
      keyTimes="0;0.5;1" values="${xStart},${laneY}; ${xEnd},${laneY}; ${xStart},${laneY}"/>
    ${beam}
    <g transform="scale(1.4)">
      <ellipse cx="0" cy="0" rx="14" ry="6" fill="url(#jetGlow)"/>
      <circle cx="-7.5" cy="0" r="2" fill="${t.border2}"><animate attributeName="opacity" values="0.35;1;0.35" dur="0.9s" repeatCount="indefinite"/></circle>
      <circle cx="7.5" cy="0" r="2" fill="${t.border2}"><animate attributeName="opacity" values="1;0.35;1" dur="0.9s" repeatCount="indefinite"/></circle>
      <path d="M-9,0 L-3,-5 L3,-5 L9,0 L3,5 L-3,5 Z" fill="${t.accent}" stroke="${t.border1}" stroke-width="1"/>
      <circle cx="0" cy="0" r="2.2" fill="#FFFFFF"/>
    </g>
  </g>`;
}

function buildHeatmapSvg(theme, calendar) {
  const t = theme;
  const weeks = calendar.weeks;
  const allDays = weeks.flatMap((w) => w.contributionDays);
  const max = Math.max(1, ...allDays.map((d) => d.contributionCount));
  const { current, longest } = computeStreaks(allDays);

  const cell = 11;
  const gap = 3;
  const gridX = 46;
  const gridY = 74;
  const gridW = weeks.length * (cell + gap);
  const jetLaneH = 52;
  const WIDTH = gridX + gridW + 30;
  const HEIGHT = gridY + 7 * (cell + gap) + jetLaneH + 46;
  const jetLaneY = gridY + 7 * (cell + gap) + jetLaneH / 2 + 10;

  let cellsSvg = "";
  let monthsSvg = "";
  let lastMonth = -1;
  weeks.forEach((week, wi) => {
    const x = gridX + wi * (cell + gap);
    const firstDay = week.contributionDays.find((d) => d.date);
    if (firstDay) {
      const m = new Date(firstDay.date).getUTCMonth();
      if (m !== lastMonth) {
        monthsSvg += `<text x="${x}" y="${gridY - 12}" class="heat-month">${MONTHS[m]}</text>`;
        lastMonth = m;
      }
    }
    week.contributionDays.forEach((day) => {
      const y = gridY + day.weekday * (cell + gap);
      const level = levelFor(day.contributionCount, max);
      const delay = (0.15 + wi * 0.012).toFixed(3);
      cellsSvg += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2.5" fill="${t.heat[level]}" opacity="0"><animate attributeName="opacity" from="0" to="1" dur="0.35s" begin="${delay}s" fill="freeze"/></rect>`;
    });
  });

  const dayLabels = [
    { d: 1, label: "Mon" },
    { d: 3, label: "Wed" },
    { d: 5, label: "Fri" },
  ]
    .map(({ d, label }) => `<text x="${gridX - 10}" y="${gridY + d * (cell + gap) + 9}" text-anchor="end" class="heat-daylabel">${label}</text>`)
    .join("");

  const legendX = WIDTH - 30 - t.heat.length * 14 - 46;
  const legend = t.heat
    .map((c, i) => `<rect x="${legendX + 34 + i * 14}" y="${HEIGHT - 22}" width="10" height="10" rx="2" fill="${c}"/>`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">
<defs>
  <radialGradient id="hbgGlow" cx="18%" cy="12%" r="90%">
    <stop offset="0%" stop-color="${t.bg1}"/>
    <stop offset="100%" stop-color="${t.bg0}"/>
  </radialGradient>
  <linearGradient id="hBorderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="${t.border0}"><animate attributeName="stop-color" values="${t.border0};${t.border1};${t.border2};${t.border0}" dur="9s" repeatCount="indefinite"/></stop>
    <stop offset="100%" stop-color="${t.border2}"><animate attributeName="stop-color" values="${t.border2};${t.border0};${t.border1};${t.border2}" dur="9s" repeatCount="indefinite"/></stop>
  </linearGradient>
  <filter id="hSoftGlow" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="3" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <radialGradient id="jetGlow" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="${t.accent}" stop-opacity="0.55"/>
    <stop offset="100%" stop-color="${t.accent}" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="hFrameClip"><rect x="1" y="1" width="${WIDTH - 2}" height="${HEIGHT - 2}" rx="14"/></clipPath>
  <style>
    .heat-term { fill: ${t.textDim}; font-size: 13px; }
    .heat-stats { fill: ${t.text}; font-size: 12.5px; }
    .heat-accent { fill: ${t.accent}; font-weight: 700; }
    .heat-month { fill: ${t.textDim}; font-size: 10px; }
    .heat-daylabel { fill: ${t.textDim}; font-size: 9.5px; }
    .heat-legend { fill: ${t.textDim}; font-size: 10px; }
  </style>
</defs>

<g clip-path="url(#hFrameClip)">
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="url(#hbgGlow)"/>

  <rect x="0" y="0" width="${WIDTH}" height="46" fill="${t.panel}"/>
  <line x1="0" y1="46" x2="${WIDTH}" y2="46" stroke="${t.leader}" stroke-width="1"/>
  <text x="24" y="28" class="heat-term">${USERNAME}@github ~ % ./contributions.sh --year</text>
  <text x="${WIDTH - 24}" y="28" text-anchor="end" class="heat-stats"><tspan class="heat-accent">${calendar.totalContributions.toLocaleString()}</tspan> contributions · streak <tspan class="heat-accent">${current}d</tspan> · best <tspan class="heat-accent">${longest}d</tspan></text>

  ${monthsSvg}
  ${dayLabels}
  ${cellsSvg}
  ${buildJetLane(t, gridX, gridY, cell, gap, weeks, max, jetLaneY)}

  <text x="${legendX}" y="${HEIGHT - 14}" class="heat-legend">Less</text>
  ${legend}
  <text x="${legendX + 34 + t.heat.length * 14 + 8}" y="${HEIGHT - 14}" class="heat-legend">More</text>
</g>

<rect x="1" y="1" width="${WIDTH - 2}" height="${HEIGHT - 2}" rx="14" fill="none" stroke="url(#hBorderGrad)" stroke-width="2" filter="url(#hSoftGlow)"/>
</svg>`;
}

function reveal(id, x, y, w, h, delay) {
  return `<clipPath id="${id}"><rect x="${x}" y="${y}" width="0" height="${h}"><animate attributeName="width" from="0" to="${w}" dur="0.4s" begin="${delay}s" fill="freeze" calcMode="spline" keySplines="0.3 0 0.2 1"/></rect></clipPath>`;
}

function buildSections(stats) {
  return [
    {
      title: "SYSTEM.INFO",
      lines: [
        kv("Subject", "Jeslor Ssozi"),
        kv("Role", "Senior Backend Engineer"),
        kv("Focus", "Cloud-native & AI-powered systems"),
        kv("Impact", "200,000+ users served"),
        kv("Efficiency", "38% workflow optimization"),
        kv("Specialty", "Offline-first sync · Air-gapped RAG"),
        kv("Status", "Open to collaboration"),
      ],
    },
    {
      title: "TECH.STACK",
      lines: [
        kv("Frontend", "React · Next.js · Tailwind · TypeScript"),
        kv("Backend", "Node.js · NestJS · Python · Django"),
        kv("Mobile", "React Native · Flutter · Expo"),
        kv("DevOps", "Docker · Kubernetes · AWS · Azure"),
      ],
    },
    {
      title: "CONTACT",
      lines: [
        kv("Portfolio", "jeslor.com"),
        kv("LinkedIn", "jeslor-ssozi"),
        kv("GitHub", `${USERNAME} · ${stats.repos} repos · ${stats.followers} followers`),
      ],
    },
  ];
}

function layoutRight(sections) {
  let clipDefs = "";
  let svg = "";
  let y = PANEL_Y + 28;
  let delay = 0.9;
  let lineIndex = 0;

  sections.forEach((section, si) => {
    if (si > 0) {
      svg += `<line x1="${RIGHT_X}" y1="${y - SECTION_TITLE_GAP + 12}" x2="${RIGHT_X + RIGHT_W}" y2="${y - SECTION_TITLE_GAP + 12}" class="divider"/>`;
    }
    svg += `<text x="${RIGHT_X}" y="${y}" class="panel-title">${section.title}</text>`;
    y += SECTION_TITLE_GAP;
    section.lines.forEach((line) => {
      const id = `r${lineIndex}`;
      clipDefs += reveal(id, RIGHT_X, y - 14, RIGHT_W, 20, delay);
      svg += `<g clip-path="url(#${id})">` +
        `<text x="${RIGHT_X}" y="${y}" class="kv-label">${line.label}</text>` +
        `<text x="${RIGHT_X + line.label.length * 7.1}" y="${y}" class="kv-dots">${line.dots}</text>` +
        `<text x="${RIGHT_X + RIGHT_W}" y="${y}" text-anchor="end" class="kv-value">${line.value}</text>` +
        `</g>`;
      y += LINE_H;
      delay += 0.08;
      lineIndex += 1;
    });
    if (si < sections.length - 1) y += SECTION_GAP - LINE_H;
  });

  const contentHeight = y - PANEL_Y;
  return { svg, clipDefs, contentHeight };
}

function buildSvg(theme, asciiRows, stats, updatedAt) {
  const t = theme;
  const sections = buildSections(stats);
  const { svg: infoSvg, clipDefs, contentHeight } = layoutRight(sections);

  const panelHeight = contentHeight + 24;
  const HEIGHT = PANEL_Y + panelHeight + 62;

  const asciiLineHeight = (panelHeight - 44) / asciiRows.length;
  const asciiSvg = asciiRows
    .map((row, i) => `<text x="${PANEL_X + 14}" y="${PANEL_Y + 26 + i * asciiLineHeight}" textLength="${LEFT_W - 28}" lengthAdjust="spacingAndGlyphs" class="ascii-row">${row}</text>`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">
<defs>
  <radialGradient id="bgGlow" cx="24%" cy="14%" r="85%">
    <stop offset="0%" stop-color="${t.bg1}"/>
    <stop offset="100%" stop-color="${t.bg0}"/>
  </radialGradient>
  <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="${t.border0}"><animate attributeName="stop-color" values="${t.border0};${t.border1};${t.border2};${t.border0}" dur="9s" repeatCount="indefinite"/></stop>
    <stop offset="100%" stop-color="${t.border2}"><animate attributeName="stop-color" values="${t.border2};${t.border0};${t.border1};${t.border2}" dur="9s" repeatCount="indefinite"/></stop>
  </linearGradient>
  <linearGradient id="asciiGrad" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="${t.accent}"/>
    <stop offset="100%" stop-color="${t.border1}"/>
  </linearGradient>
  <pattern id="scanlines" width="3" height="3" patternUnits="userSpaceOnUse">
    <rect width="3" height="1" fill="${t.scan}" opacity="0.045"/>
  </pattern>
  <linearGradient id="scanBeam" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="${t.scan}" stop-opacity="0"/>
    <stop offset="50%" stop-color="${t.scan}" stop-opacity="0.22"/>
    <stop offset="100%" stop-color="${t.scan}" stop-opacity="0"/>
  </linearGradient>
  <filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="3" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <clipPath id="frameClip"><rect x="1" y="1" width="${WIDTH - 2}" height="${HEIGHT - 2}" rx="14"/></clipPath>
  ${clipDefs}
  <style>
    .term-label { fill: ${t.textDim}; font-size: 13px; }
    .panel-title { fill: ${t.accent}; font-size: 12px; font-weight: 700; letter-spacing: 2px; }
    .kv-label { fill: ${t.accent}; font-size: 13px; font-weight: 600; }
    .kv-dots { fill: ${t.leader}; font-size: 13px; }
    .kv-value { fill: ${t.text}; font-size: 13px; }
    .ascii-row { fill: url(#asciiGrad); font-size: 8.6px; white-space: pre; }
    .divider { stroke: ${t.leader}; stroke-width: 1; }
    .foot { fill: ${t.textDim}; font-size: 11.5px; }
  </style>
</defs>

<g clip-path="url(#frameClip)">
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="url(#bgGlow)"/>
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="url(#scanlines)"/>

  <!-- title bar -->
  <rect x="0" y="0" width="${WIDTH}" height="46" fill="${t.panel}"/>
  <line x1="0" y1="46" x2="${WIDTH}" y2="46" stroke="${t.leader}" stroke-width="1"/>
  <circle cx="26" cy="23" r="6.5" fill="#FF5F56"/>
  <circle cx="47" cy="23" r="6.5" fill="#FFBD2E"/>
  <circle cx="68" cy="23" r="6.5" fill="#27C93F"/>
  <text x="${WIDTH / 2}" y="28" text-anchor="middle" class="term-label">${USERNAME}@github ~ % ./profile.sh --live</text>
  <circle cx="${WIDTH - 96}" cy="23" r="4" fill="${t.accent}"><animate attributeName="opacity" values="1;0.25;1" dur="1.6s" repeatCount="indefinite"/></circle>
  <text x="${WIDTH - 86}" y="28" class="term-label">LIVE</text>

  <!-- panels -->
  <rect x="${PANEL_X}" y="${PANEL_Y}" width="${LEFT_W}" height="${panelHeight}" rx="10" fill="${t.panelAlt}" stroke="${t.leader}" stroke-width="1"/>
  <text x="${PANEL_X + 14}" y="${PANEL_Y + 14}" class="panel-title">VISUAL.MAP</text>
  <g transform="translate(0,10)">${asciiSvg}</g>

  <rect x="${RIGHT_X - 20}" y="${PANEL_Y}" width="${RIGHT_W + 40}" height="${panelHeight}" rx="10" fill="${t.panelAlt}" stroke="${t.leader}" stroke-width="1"/>
  ${infoSvg}

  <!-- footer -->
  <line x1="${PANEL_X}" y1="${HEIGHT - 36}" x2="${WIDTH - PANEL_X}" y2="${HEIGHT - 36}" stroke="${t.leader}" stroke-width="1"/>
  <text x="${PANEL_X}" y="${HEIGHT - 15}" class="foot">Live GitHub stats + tech stack badges below ↓</text>
  <text x="${WIDTH - PANEL_X}" y="${HEIGHT - 15}" text-anchor="end" class="foot">synced ${updatedAt}</text>

  <!-- scanning sweep -->
  <g>
    <animateTransform attributeName="transform" type="translate" values="0,-30; 0,${HEIGHT + 30}" dur="7s" repeatCount="indefinite"/>
    <rect x="0" y="-18" width="${WIDTH}" height="36" fill="url(#scanBeam)"/>
    <line x1="0" y1="0" x2="${WIDTH}" y2="0" stroke="${t.scan}" stroke-width="1.5" opacity="0.95"/>
    <circle cx="10" cy="0" r="2.5" fill="${t.scan}" filter="url(#softGlow)"/>
    <circle cx="${WIDTH - 10}" cy="0" r="2.5" fill="${t.scan}" filter="url(#softGlow)"/>
  </g>
</g>

<rect x="1" y="1" width="${WIDTH - 2}" height="${HEIGHT - 2}" rx="14" fill="none" stroke="url(#borderGrad)" stroke-width="2" filter="url(#softGlow)"/>
</svg>`;
}

async function main() {
  const asciiRows = await buildAscii("avatar.jpg");
  const stats = await fetchGitHubStats();
  const calendar = await fetchContributionCalendar();
  const updatedAt = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

  for (const theme of Object.values(THEMES)) {
    const svg = buildSvg(theme, asciiRows, stats, updatedAt);
    await writeFile(`${theme.name}.svg`, svg, "utf8");
    console.log(`wrote ${theme.name}.svg`);

    const heatmap = buildHeatmapSvg(theme, calendar);
    await writeFile(`heatmap-${theme.name}.svg`, heatmap, "utf8");
    console.log(`wrote heatmap-${theme.name}.svg`);
  }
}

main();
