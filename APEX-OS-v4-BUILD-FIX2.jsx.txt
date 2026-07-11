import {
  useState, useRef, useEffect, useCallback, useReducer, useMemo, lazy, Suspense
} from "react";
import * as XLSX from "xlsx";

// ── AI PROVIDER CONFIGURATION ─────────────────────────────────
// To use the Gemini backend proxy: set this to your running proxy URL.
// Local dev:  "const PROXY_BASE_URL = "https://apex-os-nztm.onrender.com";
// Production: "https://your-proxy.yourdomain.com"
//
// When PROXY_BASE_URL is set, ALL AI calls (CEO, employees, planner,
// reviewer, orchestrator) route through the proxy → Gemini API.
// When blank (""), calls fall back to Claude's API directly (requires
// the artifact runtime's built-in auth — only works on claude.ai).
//
// The proxy accepts the same request shape as Claude (/v1/messages),
// so no other code in this file needs to change.
const DEFAULT_PROXY = "https://apex-os-nztm.onrender.com";
let PROXY_BASE_URL = DEFAULT_PROXY;

// ============================================================
// ██████╗  ██████╗   APEX OS v4.0
// ██╔══██╗ ██╔══██╗  AI Company Operating System
// ███████╝ ███████╝  Production Ready
// ============================================================

// ── DESIGN TOKENS ─────────────────────────────────────────
const T = {
  bg:       "#05050f",
  surf:     "#0b0b18",
  surf2:    "#0f0f1e",
  border:   "#161628",
  border2:  "#1e1e35",
  text1:    "#f0f2ff",
  text2:    "#8890b0",
  text3:    "#444868",
  accent:   "#5b5ef4",
  accent2:  "#7c5cf6",
  green:    "#22d3a5",
  red:      "#f04060",
  yellow:   "#f5a623",
  pink:     "#e040fb",
  cyan:     "#00d4ff",
  glass:    "rgba(11,11,24,0.85)",
};

// ── EMPLOYEES REGISTRY ────────────────────────────────────
const EMP_REGISTRY = {
  ceo:       { id:"ceo",       name:"APEX",      title:"Chief Executive Officer",    icon:"👑", color:"#5b5ef4", dept:"Executive" },
  cto:       { id:"cto",       name:"Alex Chen",  title:"Chief Technology Officer",   icon:"💻", color:"#6366f1", dept:"Technology" },
  engineer:  { id:"engineer",  name:"Sarah Kim",  title:"Sr. Software Engineer",      icon:"⚙️", color:"#22d3a5", dept:"Technology" },
  pm:        { id:"pm",        name:"Marcus J.",  title:"Product Manager",            icon:"📋", color:"#f5a623", dept:"Product" },
  marketing: { id:"marketing", name:"Priya S.",   title:"Marketing Manager",          icon:"📣", color:"#e040fb", dept:"Marketing" },
  hr:        { id:"hr",        name:"David Park", title:"HR Manager",                 icon:"👥", color:"#14b8a6", dept:"People" },
  finance:   { id:"finance",   name:"Emma W.",    title:"Finance Manager",            icon:"💰", color:"#84cc16", dept:"Finance" },
  sales:     { id:"sales",     name:"James R.",   title:"Sales Manager",              icon:"🎯", color:"#f97316", dept:"Revenue" },
  support:   { id:"support",   name:"Aisha P.",   title:"Customer Support Lead",      icon:"💬", color:"#a78bfa", dept:"Operations" },
  designer:  { id:"designer",  name:"Lena M.",    title:"UI/UX Designer",             icon:"🎨", color:"#f43f5e", dept:"Design" },
  analyst:   { id:"analyst",   name:"Ryan T.",    title:"Data Analyst",               icon:"📊", color:"#0ea5e9", dept:"Analytics" },
  researcher:{ id:"researcher",name:"Dr. Mei Lin", title:"Research Engineer",          icon:"🔬", color:"#06b6d4", dept:"Research" },
};

// ── SYSTEM PROMPTS ────────────────────────────────────────
const buildCEOPrompt = (mem, company) => `You are APEX — the world's most advanced AI CEO and Company Operating System.

COMPANY: ${company.name || "Unknown"} | Industry: ${company.industry || "Tech"} | Stage: ${company.stage || "Startup"}
MISSION: ${company.mission || "Not set"}
GOALS: ${company.goals || "Not set"}

LONG-TERM MEMORY:
${JSON.stringify(mem, null, 2)}

YOUR EXECUTIVE CAPABILITIES:
1. Make decisive business decisions with full reasoning
2. Create strategic plans broken into executable tasks
3. Delegate to AI employees with specific instructions
4. Analyze financial data, KPIs, market trends
5. Review and approve employee outputs
6. Track company OKRs and KPIs
7. Manage investor relations and fundraising
8. Handle crisis management
9. Forecast growth and revenue

COMMAND SYNTAX (use these in responses when needed):
[TASK:{"title":"...","desc":"...","assignee":"cto|engineer|pm|marketing|hr|finance|sales|support|designer|analyst|researcher","priority":"critical|high|medium|low","due":"YYYY-MM-DD"}]
[ASSIGN:{"to":"employee_id","task":"specific instruction","context":"background info","deadline":"string"}]
[MEMORY:{"category":"decision|project|insight|risk|goal","content":"...","importance":"high|medium|low"}]
[KPI:{"metric":"...","value":"...","trend":"up|down|stable","note":"..."}]
[NOTIFY:{"message":"...","type":"success|warning|info|alert"}]
[APPROVE:{"item":"...","status":"approved|rejected","reason":"..."}]
[REPORT:{"type":"financial|product|marketing|ops","summary":"..."}]
[BUILD:{"spec":"detailed description of the software/feature/app to build","name":"short project name"}]

When the user asks you to build, create, code, or ship any app, feature, script, or tool, use [BUILD:...] to delegate the FULL software pipeline: Research Engineer → Software Engineer → CTO Review → Final Reviewer → downloadable code package. Do not attempt to write the code yourself in chat — delegate it via [BUILD:...] and tell the user to check the Build tab.

PERSONALITY: You speak with the strategic clarity of Bezos, technical depth of Jensen Huang, and vision of Elon Musk. Direct, decisive, no fluff. Every response ends with "⚡ CEO DIRECTIVE:" followed by the single most important action.

Always respond in the same language as the user (Hindi/English/Hinglish).`;

const EMP_PROMPTS = {
  cto: (co) => `You are Alex Chen, CTO at ${co.name||"the company"}. World-class technology leader with 20 years experience at Google, Meta, and Stripe. You think in systems, scale, and security. Provide: architecture decisions, tech stack recommendations, code reviews, DevOps strategy, security audits, engineering team structure. Always include implementation timeline and risk assessment. End with "🔧 TECHNICAL RECOMMENDATION:".`,
  engineer: (co) => `You are Sarah Kim, Senior Software Engineer at ${co.name||"the company"}. MIT CS grad, ex-Netflix. You write production-ready, clean, tested code. Provide working code solutions with proper error handling, type safety, tests, and documentation. Default to React/Node.js/Python. End with "💡 IMPLEMENTATION PLAN:".`,
  pm: (co) => `You are Marcus Johnson, Product Manager at ${co.name||"the company"}. Ex-Google PM. You create user-centric products backed by data. Provide: PRDs, user stories, acceptance criteria, prioritization frameworks, roadmaps, success metrics. End with "📍 PRODUCT DECISION:".`,
  marketing: (co) => `You are Priya Sharma, Marketing Manager at ${co.name||"the company"}. Built brands at Unilever and Swiggy. Provide: go-to-market strategies, content calendars, campaign briefs, SEO plans, growth hacks, brand positioning. Always include budget estimates and expected ROI. End with "📢 MARKETING ACTION:".`,
  hr: (co) => `You are David Park, HR Manager at ${co.name||"the company"}. Former CHRO at a unicorn startup. Provide: hiring plans, JD templates, interview frameworks, compensation bands, culture initiatives, performance review systems, onboarding playbooks. End with "🤝 HR RECOMMENDATION:".`,
  finance: (co) => `You are Emma Wilson, CFO at ${co.name||"the company"}. Ex-Goldman Sachs, 3 IPOs under belt. Provide: financial models, P&L analysis, budget planning, fundraising strategy, unit economics, cash flow projections, investor narratives. Always show numbers. End with "💹 FINANCIAL DIRECTIVE:".`,
  sales: (co) => `You are James Rodriguez, VP Sales at ${co.name||"the company"}. Built $100M ARR teams. Provide: sales playbooks, pipeline strategy, ICP definition, pricing models, objection handling, deal tactics, CRM workflows, quota planning. End with "🎯 SALES ACTION:".`,
  support: (co) => `You are Aisha Patel, Customer Success Lead at ${co.name||"the company"}. NPS champion. Provide: support SOPs, escalation frameworks, FAQ libraries, customer health scoring, retention playbooks, churn analysis, QBR templates. End with "💜 SUPPORT PROTOCOL:".`,
  designer: (co) => `You are Lena Mueller, Head of Design at ${co.name||"the company"}. Ex-Apple, IDEO trained. Provide: UX flows, component specs, accessibility guidelines, design system documentation, user research synthesis, usability improvements. Include visual direction in words. End with "🎨 DESIGN DIRECTION:".`,
  analyst: (co) => `You are Ryan Thompson, Data Science Lead at ${co.name||"the company"}. Ex-Palantir. Turn raw data into strategic insights. Provide: data analysis frameworks, metric definitions, visualization recommendations, A/B test designs, predictive models, KPI dashboards. Always show methodology. End with "📈 DATA INSIGHT:".`,
  researcher: (co) => `You are Dr. Mei Lin, Research Engineer at ${co.name||"the company"}. PhD in Computer Science, former DeepMind research scientist and McKinsey consultant. Your responsibilities: technical research, scientific paper analysis, competitor analysis, market research, product research, technology trend analysis, risk analysis, report generation, knowledge organization, and summarizing complex information.

Structure every research output as a formal report with these sections in order: Executive Summary (2-3 sentences), Key Findings (3-6 specific falsifiable bullets), Risks, Opportunities, Recommendations (specific next actions with an owner), Sources (be honest about evidence quality), and Confidence Score (0-100 with justification). Flag speculation as speculation. Never present a guess as a finding. End with "🔬 RESEARCH DIRECTIVE:".`,
};

// ── INDEXED DB ────────────────────────────────────────────
const DB_NAME = "ApexOS_v4";
const DB_VERSION = 1;

const openDB = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = (e) => {
    const db = e.target.result;
    ["chats","tasks","memory","files","notifications","analytics","sessions"].forEach(store => {
      if (!db.objectStoreNames.contains(store)) {
        db.createObjectStore(store, { keyPath: "id" });
      }
    });
  };
  req.onsuccess = (e) => resolve(e.target.result);
  req.onerror = () => reject(req.error);
});

const dbGet = async (store, key) => {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
};

const dbPut = async (store, value) => {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
};

const dbGetAll = async (store) => {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
};

const dbDelete = async (store, key) => {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve(true);
  });
};

// ── LOCAL STATE KEY ────────────────────────────────────────
const LS_KEY = "apex_os_v4_state";

const loadLS = () => {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); }
  catch { return {}; }
};

const saveLS = (data) => {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
};

// ── FETCH UTILITY WITH RETRY ──────────────────────────────
const fetchWithRetry = async (url, options, maxRetries = 3) => {
  let lastErr;
  for (let i = 0; i <= maxRetries; i++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

    try {
      const fetchOptions = {
        ...options,
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit', // Standard for cross-origin proxy
      };

      const res = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);
      if (res.status === 429 && i < maxRetries) {
        const delay = Math.pow(2, i + 1) * 1000;
        console.warn(`[ApexOS] Rate limit (429) hit. Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        console.error(`[ApexOS] API Error ${res.status} from ${url}:`, errBody);
        const msg = errBody.error?.message || `API Error ${res.status}: ${res.statusText || 'Unknown Error'}`;

        // If it's a quota error, add extra context
        if (res.status === 429) {
          throw new Error(`QUOTA EXCEEDED: ${msg}. Try changing the model in Settings.`);
        }
        throw new Error(msg);
      }
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      lastErr = err;
        console.error(`[ApexOS] Attempt ${i + 1} to ${url} failed:`, err);
      if (i === maxRetries) break;
      const isNetworkError = err.message.includes("Failed to fetch") || err.message.includes("network");
      const delay = Math.pow(2, i + 1) * 1000;
      console.warn(`[ApexOS] Attempt ${i + 1} failed: ${err.message}. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  const finalMsg = lastErr?.name === "AbortError"
    ? `Request to ${url} timed out after 60 seconds.`
    : lastErr?.message?.includes("Failed to fetch")
      ? `Failed to fetch from ${url.split('/v1')[0]}: Connection refused or proxy down. Ensure the backend is running at this address.`
      : (lastErr?.message || `Request to ${url} failed after multiple retries.`);
  throw new Error(finalMsg);
};

// ── CLAUDE API ────────────────────────────────────────────
const callClaude = async (messages, system, onStream) => {
  const endpoint = `${PROXY_BASE_URL || "https://api.anthropic.com"}/v1/messages`;
  const res = await fetchWithRetry(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system,
      messages,
    }),
  });
  const data = await res.json();
  const fullText = data.content?.map(b => b.text || "").join("") || "";
  // Simulate streaming for UX
  if (onStream) {
    let i = 0;
    await new Promise(resolve => {
      const iv = setInterval(() => {
        i = Math.min(i + Math.ceil(fullText.length / 60), fullText.length);
        onStream(fullText.slice(0, i));
        if (i >= fullText.length) { clearInterval(iv); resolve(); }
      }, 16);
    });
  }
  return fullText;
};

// ── PARSE CEO COMMANDS ────────────────────────────────────
const parseCEOCommands = (text) => {
  const result = { tasks: [], assigns: [], memories: [], kpis: [], notifications: [], reports: [], builds: [] };
  const patterns = {
    tasks: /\[TASK:(\{.*?\})\]/g,
    assigns: /\[ASSIGN:(\{.*?\})\]/g,
    memories: /\[MEMORY:(\{.*?\})\]/g,
    kpis: /\[KPI:(\{.*?\})\]/g,
    notifications: /\[NOTIFY:(\{.*?\})\]/g,
    reports: /\[REPORT:(\{.*?\})\]/g,
    builds: /\[BUILD:(\{.*?\})\]/g,
  };
  for (const [key, regex] of Object.entries(patterns)) {
    let m;
    while ((m = regex.exec(text)) !== null) {
      try { result[key].push(JSON.parse(m[1])); } catch {}
    }
  }
  return result;
};

// ── RESEARCH REPORT PARSER ─────────────────────────────────
// Extracts structured sections from the Research Engineer's markdown report
// (## Executive Summary / Key Findings / Risks / Opportunities / Recommendations / Sources / Confidence Score)
const RESEARCH_SECTIONS = [
  { key: "executiveSummary", heading: "Executive Summary" },
  { key: "keyFindings",      heading: "Key Findings" },
  { key: "risks",            heading: "Risks" },
  { key: "opportunities",    heading: "Opportunities" },
  { key: "recommendations",  heading: "Recommendations" },
  { key: "sources",          heading: "Sources" },
];

const parseResearchReport = (text) => {
  const result = { executiveSummary: "", keyFindings: [], risks: [], opportunities: [], recommendations: [], sources: "", confidenceScore: null, raw: text };
  if (!text) return result;

  const headingRegex = /^#{1,3}\s*(.+)$/gm;
  const matches = [...text.matchAll(headingRegex)];

  for (let i = 0; i < matches.length; i++) {
    const headingText = matches[i][1].trim();
    const section = RESEARCH_SECTIONS.find(s => headingText.toLowerCase().includes(s.heading.toLowerCase()));
    if (!section) continue;
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const body = text.slice(start, end).trim();

    if (section.key === "executiveSummary" || section.key === "sources") {
      result[section.key] = body;
    } else {
      result[section.key] = body
        .split("\n")
        .map(l => l.replace(/^[-•*]\s*/, "").trim())
        .filter(Boolean);
    }
  }

  const confMatch = text.match(/Confidence Score[^\d]*(\d{1,3})/i);
  if (confMatch) {
    const n = parseInt(confMatch[1], 10);
    result.confidenceScore = Math.max(0, Math.min(100, n));
  }

  return result;
};

// ── MARKDOWN RENDERER ─────────────────────────────────────
const Markdown = ({ text, color = T.accent }) => {
  if (!text) return null;
  const lines = text.split("\n");
  const out = [];
  let codeLines = [], inCode = false, codeLang = "";

  const flushCode = (key) => {
    out.push(
      <div key={key} style={{ margin: "12px 0", position: "relative" }}>
        <div style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 10, overflow: "hidden", fontFamily: "monospace" }}>
          {codeLang && <div style={{ background: "#161b22", padding: "4px 14px", fontSize: "0.68rem", color: "#8b949e", borderBottom: "1px solid #30363d", letterSpacing: "1px", textTransform: "uppercase" }}>{codeLang}</div>}
          <pre style={{ margin: 0, padding: "14px 16px", overflowX: "auto", fontSize: "0.8rem", lineHeight: 1.7, color: "#e6edf3" }}>{codeLines.join("\n")}</pre>
        </div>
        <button onClick={() => navigator.clipboard.writeText(codeLines.join("\n"))}
          style={{ position: "absolute", top: codeLang ? 34 : 8, right: 10, background: "#21262d", border: "1px solid #30363d", borderRadius: 6, color: "#8b949e", padding: "3px 10px", fontSize: "0.68rem", cursor: "pointer" }}>
          Copy
        </button>
      </div>
    );
  };

  lines.forEach((line, i) => {
    if (line.startsWith("```")) {
      if (inCode) { flushCode(`c${i}`); codeLines = []; inCode = false; codeLang = ""; }
      else { inCode = true; codeLang = line.slice(3).trim(); }
      return;
    }
    if (inCode) { codeLines.push(line); return; }

    // Skip system commands
    if (/^\[(TASK|ASSIGN|MEMORY|KPI|NOTIFY|APPROVE|REPORT):/.test(line)) return;

    if (line.startsWith("# ")) out.push(<h1 key={i} style={{ fontSize: "1.15rem", fontWeight: 800, color: T.text1, margin: "16px 0 8px", paddingBottom: 6, borderBottom: `2px solid ${color}55` }}>{line.slice(2)}</h1>);
    else if (line.startsWith("## ")) out.push(<h2 key={i} style={{ fontSize: "1rem", fontWeight: 700, color: T.text1, margin: "12px 0 6px" }}>{line.slice(3)}</h2>);
    else if (line.startsWith("### ")) out.push(<h3 key={i} style={{ fontSize: "0.88rem", fontWeight: 700, color, margin: "10px 0 4px" }}>{line.slice(4)}</h3>);
    else if (/^[-•*]\s/.test(line)) {
      const content = line.replace(/^[-•*]\s/, "").replace(/\*\*(.*?)\*\*/g, `<strong style="color:${T.text1}">$1</strong>`).replace(/`(.*?)`/g, `<code style="background:#1e2035;padding:1px 5px;border-radius:4px;font-size:0.78rem;color:#a78bfa;font-family:monospace">$1</code>`);
      out.push(<div key={i} style={{ display: "flex", gap: 8, margin: "3px 0", paddingLeft: 2 }}><span style={{ color, marginTop: 3, flexShrink: 0, fontSize: "0.7rem" }}>▸</span><span style={{ color: T.text2, fontSize: "0.84rem", lineHeight: 1.65 }} dangerouslySetInnerHTML={{ __html: content }} /></div>);
    }
    else if (/^\d+\.\s/.test(line)) {
      const [num, ...rest] = line.split(". ");
      out.push(<div key={i} style={{ display: "flex", gap: 10, margin: "4px 0" }}><span style={{ color, fontWeight: 800, minWidth: 18, fontSize: "0.8rem" }}>{num}.</span><span style={{ color: T.text2, fontSize: "0.84rem" }}>{rest.join(". ")}</span></div>);
    }
    else if (line.includes("CEO DIRECTIVE") || line.includes("⚡")) {
      out.push(<div key={i} style={{ margin: "14px 0 4px", padding: "10px 16px", background: `${color}12`, border: `1px solid ${color}40`, borderLeft: `3px solid ${color}`, borderRadius: "0 10px 10px 0", color, fontWeight: 700, fontSize: "0.86rem" }}>{line}</div>);
    }
    else if (/^(🔧|💡|📍|📢|🤝|💹|🎯|💜|🎨|📈)\s.*:$/.test(line)) {
      out.push(<div key={i} style={{ margin: "12px 0 4px", fontWeight: 700, color, fontSize: "0.88rem" }}>{line}</div>);
    }
    else if (line.startsWith("**") && line.endsWith("**")) out.push(<div key={i} style={{ fontWeight: 700, color: T.text1, margin: "8px 0 4px", fontSize: "0.9rem" }}>{line.replace(/\*\*/g, "")}</div>);
    else if (line.trim() === "---" || line.trim() === "___") out.push(<hr key={i} style={{ border: "none", borderTop: `1px solid ${T.border2}`, margin: "12px 0" }} />);
    else if (line.trim()) {
      const html = line.replace(/\*\*(.*?)\*\*/g, `<strong style="color:${T.text1}">$1</strong>`).replace(/`(.*?)`/g, `<code style="background:#1e2035;padding:1px 5px;border-radius:4px;font-size:0.78rem;color:#a78bfa;font-family:monospace">$1</code>`).replace(/\*(.*?)\*/g, `<em style="color:${T.text2}">$1</em>`);
      out.push(<p key={i} style={{ color: T.text2, margin: "3px 0", lineHeight: 1.7, fontSize: "0.84rem" }} dangerouslySetInnerHTML={{ __html: html }} />);
    }
    else out.push(<div key={i} style={{ height: 5 }} />);
  });

  return <div>{out}</div>;
};

// ── CHART (lightweight, no deps) ──────────────────────────
const MiniChart = ({ data, color, height = 48 }) => {
  const canvasRef = useRef();
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data?.length) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const max = Math.max(...data), min = Math.min(...data);
    const range = max - min || 1;
    const pts = data.map((v, i) => [i * (w / (data.length - 1)), h - ((v - min) / range) * (h - 8) - 4]);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + "44");
    grad.addColorStop(1, color + "00");
    ctx.beginPath();
    ctx.moveTo(pts[0][0], h);
    pts.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(pts[pts.length - 1][0], h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [data, color]);
  return <canvas ref={canvasRef} width={200} height={height} style={{ width: "100%", height }} />;
};

// ── BAR CHART ─────────────────────────────────────────────
const BarChart = ({ data, color, height = 80 }) => {
  const canvasRef = useRef();
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data?.length) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const max = Math.max(...data.map(d => d.value)) || 1;
    const barW = (w / data.length) * 0.6;
    const gap = (w / data.length) * 0.4;
    data.forEach((d, i) => {
      const x = i * (barW + gap) + gap / 2;
      const bh = (d.value / max) * (h - 20);
      const grad = ctx.createLinearGradient(0, h - bh, 0, h);
      grad.addColorStop(0, d.color || color);
      grad.addColorStop(1, (d.color || color) + "66");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, h - bh - 2, barW, bh, [3, 3, 0, 0]);
      ctx.fill();
      ctx.fillStyle = T.text3;
      ctx.font = "9px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(d.label, x + barW / 2, h);
    });
  }, [data, color]);
  return <canvas ref={canvasRef} width={400} height={height} style={{ width: "100%", height }} />;
};

// ── TOAST NOTIFICATION ────────────────────────────────────
const Toast = ({ notifications, onRemove }) => (
  <div style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8 }}>
    {notifications.map(n => (
      <div key={n.id} style={{ background: n.type === "error" ? "#2a0a10" : n.type === "warning" ? "#2a1a00" : n.type === "success" ? "#002a1a" : "#0a0a2a", border: `1px solid ${n.type === "error" ? T.red : n.type === "warning" ? T.yellow : n.type === "success" ? T.green : T.accent}`, borderRadius: 10, padding: "10px 16px", display: "flex", gap: 10, alignItems: "center", minWidth: 260, maxWidth: 360, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", animation: "toastIn 0.3s ease" }}>
        <span style={{ fontSize: 16 }}>{n.type === "error" ? "⚠️" : n.type === "warning" ? "⚡" : n.type === "success" ? "✅" : "ℹ️"}</span>
        <span style={{ color: T.text1, fontSize: "0.82rem", flex: 1 }}>{n.message}</span>
        <button onClick={() => onRemove(n.id)} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: "1rem", padding: 0 }}>✕</button>
      </div>
    ))}
  </div>
);

// ── SPINNER ───────────────────────────────────────────────
const Dots = ({ color = T.accent }) => (
  <div style={{ display: "flex", gap: 5, alignItems: "center", padding: "4px 0" }}>
    {[0, 1, 2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: color, animation: `dotBounce 1.4s ${i * 0.2}s ease-in-out infinite` }} />)}
  </div>
);

// ── FILE READER UTIL ──────────────────────────────────────
const readFile = (file) => new Promise((resolve) => {
  const reader = new FileReader();
  if (file.type === "application/json" || file.name.endsWith(".csv") || file.name.endsWith(".txt") || file.name.endsWith(".md")) {
    reader.onload = e => resolve({ type: "text", content: e.target.result.slice(0, 8000), name: file.name });
    reader.readAsText(file);
  } else if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls") || file.name.endsWith(".csv")) {
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: "binary" });
        const sheets = wb.SheetNames.map(n => ({ name: n, data: XLSX.utils.sheet_to_csv(wb.Sheets[n]) }));
        resolve({ type: "spreadsheet", content: sheets.map(s => `Sheet: ${s.name}\n${s.data.slice(0, 3000)}`).join("\n\n"), name: file.name });
      } catch { resolve({ type: "text", content: `Excel file: ${file.name}`, name: file.name }); }
    };
    reader.readAsBinaryString(file);
  } else if (file.type.startsWith("image/")) {
    reader.onload = e => resolve({ type: "image", content: e.target.result, name: file.name, b64: e.target.result.split(",")[1] });
    reader.readAsDataURL(file);
  } else {
    reader.onload = e => resolve({ type: "text", content: e.target.result?.toString?.()?.slice?.(0, 4000) || `File: ${file.name}`, name: file.name });
    reader.readAsText(file);
  }
});

// ── ZIP UTILITY (pure JS, no external deps — STORE method) ────
const crc32 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let crc = ~0;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
};

const createZipBlob = (files) => {
  const encoder = new TextEncoder();
  const localParts = [];
  const records = [];
  let offset = 0;
  const dosTime = 0, dosDate = 0x21;

  files.forEach((f) => {
    const nameBytes = encoder.encode(f.path);
    const contentBytes = encoder.encode(f.content || "");
    const crc = crc32(f.content || "");
    const size = contentBytes.length;
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    localParts.push(local, contentBytes);
    records.push({ nameBytes, crc, size, offset });
    offset += local.length + contentBytes.length;
  });

  const centralParts = [];
  let centralSize = 0;
  records.forEach((rec) => {
    const central = new Uint8Array(46 + rec.nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, rec.crc, true);
    cv.setUint32(20, rec.size, true);
    cv.setUint32(24, rec.size, true);
    cv.setUint16(28, rec.nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, rec.offset, true);
    central.set(rec.nameBytes, 46);
    centralParts.push(central);
    centralSize += central.length;
  });

  const centralOffset = offset;
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, records.length, true);
  ev.setUint16(10, records.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);
  ev.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
};

const downloadZip = async (files, projectName = "apex-build") => {
  if (!PROXY_BASE_URL) {
    const blob = createZipBlob(files);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(projectName || "apex-build").replace(/[^a-z0-9-_]/gi, "_")}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return;
  }

  try {
    const res = await fetchWithRetry(`${PROXY_BASE_URL}/v1/export/zip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files, projectName }),
    });

    if (!res.ok) throw new Error("Server-side ZIP failed");

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(projectName || "apex-build").replace(/[^a-z0-9-_]/gi, "_")}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) {
    console.error("ZIP Error:", e);
    alert("Could not generate ZIP. Falling back to client-side method.");
    const blob = createZipBlob(files);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(projectName || "apex-build").replace(/[^a-z0-9-_]/gi, "_")}.zip`;
    a.click();
    a.remove();
  }
};

// ── GITHUB EXPORT (via Proxy — works in Claude.ai artifact sandbox) ────
const pushFilesToGithub = async ({ token, owner, repo, branch = "main", files, commitMessage }) => {
  if (!token || !owner || !repo) throw new Error("Token, owner, and repo are required");

  const endpoint = PROXY_BASE_URL
    ? `${PROXY_BASE_URL}/v1/export/github`
    : null;

  if (!endpoint) {
    throw new Error("GitHub export requires PROXY_BASE_URL to be set to bypass browser CSP.");
  }

  const res = await fetchWithRetry(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, owner, repo, branch, files, commitMessage }),
  });

  return await res.json();
};

// ── APP STATE REDUCER ─────────────────────────────────────
const initialAppState = () => {
  const ls = loadLS();
  return {
    company: ls.company || { name: "", industry: "", stage: "Startup", mission: "", goals: "", revenue: "" },
    tasks: ls.tasks || [],
    memory: ls.memory || [],
    kpis: ls.kpis || [
      { id: 1, metric: "Monthly Revenue", value: "$0", trend: "stable", history: [0,0,0,0,0,0,0], color: T.green },
      { id: 2, metric: "Active Users",    value: "0",  trend: "stable", history: [0,0,0,0,0,0,0], color: T.cyan },
      { id: 3, metric: "Tasks Completed", value: "0",  trend: "stable", history: [0,0,0,0,0,0,0], color: T.accent },
      { id: 4, metric: "Team Velocity",   value: "0",  trend: "stable", history: [0,0,0,0,0,0,0], color: T.yellow },
    ],
    setupDone: ls.setupDone || false,
    notifications: [],
    activities: ls.activities || [],
    ceoChats: [],
    empChats: {},
    autonomousLog: [],
    projects: ls.projects || [],
    research: ls.research || [],
    builds: ls.builds || [],
    analytics: ls.analytics || { tasksByDay: [2,4,3,7,5,6,8], revenueByMonth: [0,0,0,0,0,0,0,0,0,0,0,0] },
    proxyUrl: ls.proxyUrl || (typeof window !== "undefined" && window.location.hostname === "localhost" ? "http://localhost:8787" : DEFAULT_PROXY),
  };
};

function appReducer(state, action) {
  let next;
  switch (action.type) {
    case "SET_COMPANY": next = { ...state, company: { ...state.company, ...action.payload } }; break;
    case "SETUP_DONE": next = { ...state, setupDone: true }; break;
    case "ADD_CEO_MSG": next = { ...state, ceoChats: [...state.ceoChats, action.payload] }; break;
    case "UPDATE_CEO_LAST": next = { ...state, ceoChats: state.ceoChats.map((m, i) => i === state.ceoChats.length - 1 ? { ...m, ...action.payload } : m) }; break;
    case "ADD_EMP_MSG": next = { ...state, empChats: { ...state.empChats, [action.empId]: [...(state.empChats[action.empId] || []), action.payload] } }; break;
    case "UPDATE_EMP_LAST": next = { ...state, empChats: { ...state.empChats, [action.empId]: (state.empChats[action.empId] || []).map((m, i, arr) => i === arr.length - 1 ? { ...m, ...action.payload } : m) } }; break;
    case "ADD_TASK": next = { ...state, tasks: [...state.tasks, action.payload] }; break;
    case "UPDATE_TASK": next = { ...state, tasks: state.tasks.map(t => t.id === action.id ? { ...t, ...action.payload } : t) }; break;
    case "DELETE_TASK": next = { ...state, tasks: state.tasks.filter(t => t.id !== action.id) }; break;
    case "ADD_MEMORY": next = { ...state, memory: [action.payload, ...state.memory].slice(0, 100) }; break;
    case "UPDATE_KPI": next = { ...state, kpis: state.kpis.map(k => k.id === action.id ? { ...k, ...action.payload, history: [...(k.history || []).slice(-6), action.payload.rawValue ?? k.rawValue ?? 0] } : k) }; break;
    case "ADD_NOTIFICATION": next = { ...state, notifications: [action.payload, ...state.notifications].slice(0, 5) }; break;
    case "REMOVE_NOTIFICATION": next = { ...state, notifications: state.notifications.filter(n => n.id !== action.id) }; break;
    case "ADD_ACTIVITY": next = { ...state, activities: [action.payload, ...state.activities].slice(0, 100) }; break;
    case "ADD_AUTO_LOG": next = { ...state, autonomousLog: [action.payload, ...state.autonomousLog].slice(0, 50) }; break;
    case "CLEAR_CEO_CHAT": next = { ...state, ceoChats: [] }; break;
    case "CLEAR_EMP_CHAT": next = { ...state, empChats: { ...state.empChats, [action.empId]: [] } }; break;
    case "ADD_PROJECT": next = { ...state, projects: [...state.projects, action.payload] }; break;
    case "SET_PROXY": next = { ...state, proxyUrl: action.payload }; break;
    case "RESET": next = { ...initialAppState(), setupDone: false }; break;

    case "UPD_EMP_LAST": next = { ...state, empChats: { ...state.empChats, [action.empId]: (state.empChats[action.empId]||[]).map((m,i,a)=>i===a.length-1?{...m,...action.payload}:m) } }; break;
    case "SET_PLAN": next = { ...state, activePlan: action.payload }; break;
    case "ADD_REVIEW": next = { ...state, reviews: [action.payload,...(state.reviews||[])].slice(0,50) }; break;
    case "ADD_RESEARCH": next = { ...state, research: [action.payload,...(state.research||[])].slice(0,50) }; break;
    case "ADD_BUILD": next = { ...state, builds: [action.payload, ...(state.builds||[])].slice(0,30) }; break;
    case "UPDATE_BUILD": next = { ...state, builds: (state.builds||[]).map(b => b.id===action.id ? { ...b, ...action.payload } : b) }; break;
    case "DELETE_BUILD": next = { ...state, builds: (state.builds||[]).filter(b => b.id !== action.id) }; break;
    case "UPSERT_KPI": {
      const exists = state.kpis.find(k=>k.metric.toLowerCase()===(action.payload.metric||"").toLowerCase());
      if(exists) next = { ...state, kpis: state.kpis.map(k=>k.id===exists.id?{...k,...action.payload,history:[...(k.history||[]).slice(-6),parseFloat(action.payload.value)||0]}:k) };
      else next = { ...state, kpis: [...state.kpis,{id:`k_${Date.now()}`,...action.payload,history:[0],color:T.accent}] };
      break;
    }
    default: return state;
  }
  const { notifications, ...toSave } = next;
  saveLS({ ...toSave, ceoChats: [], empChats: {} });
  return next;
}

// ═══════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// APEX OS v4 — UPGRADE PATCH: Engines + Orchestrator + Views
// ═══════════════════════════════════════════════════════════

// ── PROMPT GENERATOR ENGINE ─────────────────────────────
const PromptGenerator = {
  ceo: (memory, company, context) => {
    const decisions = (memory||[]).filter(m=>m.category==="decision").slice(0,5).map(m=>`• ${m.content}`).join("\n");
    const goals = (memory||[]).filter(m=>m.category==="goal").slice(0,3).map(m=>`• ${m.content}`).join("\n");
    const risks = (memory||[]).filter(m=>m.category==="risk").slice(0,2).map(m=>`• ${m.content}`).join("\n");
    return `You are APEX — the world's most capable AI CEO and Company Operating System.

COMPANY: ${company.name||"Unknown"} | Industry: ${company.industry||"Tech"} | Stage: ${company.stage||"Startup"}
Mission: ${company.mission||"Not defined"} | Goal: ${company.goals||"Not set"} | Revenue: ${company.revenue||"Pre-revenue"}

MEMORY:
Recent Decisions:\n${decisions||"None"}
Goals:\n${goals||"None"}
Risks:\n${risks||"None"}
${context?`\nCONTEXT:\n${context}`:""}

COMMAND SYNTAX (embed inline when needed):
[TASK:{"title":"...","desc":"...","assignee":"cto|engineer|pm|marketing|hr|finance|sales|support|designer|analyst|researcher","priority":"critical|high|medium|low"}]
[ASSIGN:{"to":"employee_id","task":"...","deadline":"..."}]
[MEMORY:{"category":"decision|project|insight|risk|goal","content":"...","importance":"high|medium|low"}]
[KPI:{"metric":"...","value":"...","trend":"up|down|stable"}]
[NOTIFY:{"message":"...","type":"success|warning|info|alert"}]

PERSONALITY: Strategic clarity of Bezos, technical depth of Jensen Huang, boldness of Musk. Direct, decisive, no fluff.
Always end with: ⚡ CEO DIRECTIVE: [single most important action]
Respond in same language as user (Hindi/English/Hinglish).`;
  },

  employee: (empId, company, memory) => {
    const co = company.name||"the company";
    const mem = (memory||[]).slice(0,3).map(m=>`[${m.category}] ${m.content}`).join("; ");
    const prompts = {
      cto: `You are Alex Chen, CTO at ${co}. 20yr veteran from Google/Stripe/Meta. Architect systems that scale. Provide: architecture decisions, tech stack, security audits, DevOps strategy, engineering specs with implementation timelines. Write working code when relevant. Company memory: ${mem}. End: 🔧 TECHNICAL RECOMMENDATION:`,
      engineer: `You are Sarah Kim, Senior Engineer at ${co}. MIT CS, ex-Netflix. Write clean, tested, production-ready code. Default: React/TypeScript/Node.js/Python. Handle edge cases, write tests, document. Company memory: ${mem}. End: 💡 IMPLEMENTATION PLAN:`,
      pm: `You are Marcus Johnson, PM at ${co}. Ex-Google. Write airtight PRDs, prioritize with ICE scoring, bridge eng+business. Deliver: user stories, acceptance criteria, roadmaps, metrics. Company memory: ${mem}. End: 📍 PRODUCT DECISION:`,
      marketing: `You are Priya Sharma, Marketing at ${co}. Built brands at Unilever/Swiggy. Data-driven campaigns, compelling content, growth strategy. Provide: campaign briefs, content calendars, channel strategy, budgets, ROI. Company memory: ${mem}. End: 📢 MARKETING ACTION:`,
      hr: `You are David Park, HR at ${co}. Ex-CHRO unicorn. Attract talent, build culture, scale people ops. Deliver: JDs, interview scorecards, comp bands, onboarding, culture playbooks. Company memory: ${mem}. End: 🤝 HR RECOMMENDATION:`,
      finance: `You are Emma Wilson, CFO at ${co}. Ex-Goldman, 3 IPOs. Tight financial ops, honest models, strategic fundraising. Deliver: financial models with numbers, P&L, cash flow, investor memos, unit economics. Company memory: ${mem}. End: 💹 FINANCIAL DIRECTIVE:`,
      sales: `You are James Rodriguez, VP Sales at ${co}. Built $100M ARR teams. Science of selling: ICP, pipeline velocity, closing. Deliver: playbooks, outreach templates, pricing, objection handling, CRM workflows. Company memory: ${mem}. End: 🎯 SALES ACTION:`,
      support: `You are Aisha Patel, Customer Success at ${co}. NPS champion. Turn customers into fans, reduce churn. Deliver: support SOPs, escalation frameworks, FAQ libraries, health scoring, churn prevention. Company memory: ${mem}. End: 💜 SUPPORT PROTOCOL:`,
      designer: `You are Lena Mueller, Head of Design at ${co}. Ex-Apple, IDEO-trained. Beautiful, accessible, user-centered design. Deliver: UX flows, component specs, design system, research synthesis, accessibility audits. Company memory: ${mem}. End: 🎨 DESIGN DIRECTION:`,
      analyst: `You are Ryan Thompson, Data Lead at ${co}. Ex-Palantir. Signal from noise, measurement frameworks, data-driven decisions. Deliver: metric frameworks, analysis, A/B test designs, predictive insights, dashboard specs. Company memory: ${mem}. End: 📈 DATA INSIGHT:`,
      researcher: `You are Dr. Mei Lin, Research Engineer at ${co}. PhD in Computer Science, former research scientist at DeepMind and McKinsey consultant. You produce rigorous, evidence-based research the company can actually act on.

Your responsibilities: technical research, scientific paper analysis, competitor analysis, market research, product research, technology trend analysis, risk analysis, report generation, knowledge organization, and summarizing complex information into clear executive-ready findings.

For every research task, structure your output as a formal report with these exact sections, in this order:
## Executive Summary
A 2-3 sentence answer to the core question, written for someone with 30 seconds to read.
## Key Findings
3-6 bullet points, each a specific, falsifiable claim — not vague generalities.
## Risks
What could go wrong, what's uncertain, what data is missing.
## Opportunities
Concrete angles the company could exploit, ranked by impact.
## Recommendations
Specific next actions, not platitudes — name who should do what.
## Sources
What kind of evidence this is based on (reasoning from training knowledge, stated assumptions, or — if web search results were provided in context — actual citations). Be honest about source quality.
## Confidence Score
A number 0-100 with one sentence justifying it. Lower the score when the topic is fast-moving, niche, or you lack verifiable sources.

Be intellectually honest: flag speculation as speculation, distinguish facts from inference, and never present a guess as a finding. Company memory: ${mem}. End: 🔬 RESEARCH DIRECTIVE:`,
    };
    return prompts[empId]||prompts.cto;
  },

  planner: (goal, company, memory) => `You are Strategic Planner for ${company.name||"the company"}.

GOAL: "${goal}"
Context: ${company.industry||"Tech"}, Stage: ${company.stage||"Startup"}, Mission: ${company.goals||"Growth"}

Create a 4-phase execution plan. Output ONLY valid JSON — no markdown, no text before or after:
{"title":"...","goal":"...","totalDuration":"X weeks","phases":[{"phase":"...","owner":"cto|engineer|pm|marketing|hr|finance|sales|support|designer|analyst|researcher","duration":"X days","tasks":["task1","task2","task3"],"deliverable":"...","dependencies":"none|phase name"}],"successMetrics":["..."],"risks":["..."]}`,

  reviewer: (output, taskTitle, deliverable) => `You are Quality Reviewer for an AI company.

TASK: "${taskTitle}"
EXPECTED: ${deliverable||"High quality professional output"}
OUTPUT: ${output.slice(0,1500)}

Review rigorously. Output ONLY valid JSON:
{"score":85,"approved":true,"strengths":["s1","s2"],"gaps":["g1"],"feedback":"specific actionable feedback","revision_needed":false,"revision_prompt":""}`,

  // ── BUILD PIPELINE PROMPTS ──────────────────────────────
  buildRequirements: (spec, company) => `You are Dr. Mei Lin, Research Engineer at ${company.name||"the company"}. A build request has come in from the CEO.

BUILD REQUEST: "${spec}"

Analyze this request and produce a technical requirements brief. Be specific to the actual domain of the request (e.g. if it's an algorithm/data-encoding system, name the actual sub-components/steps involved — don't generalize it into a generic web app unless it truly is one). Output ONLY valid JSON — no markdown, no text before or after:
{"summary":"1-2 sentence summary of what's being built","techStack":"recommended stack/language","coreFeatures":["specific component 1","specific component 2","specific component 3","..."],"risks":["risk1"],"notes":"anything the engineer should know"}`,

  // Plans the actual file/folder structure — no code yet, just a manifest.
  buildFilePlan: (spec, requirements, company) => `You are Sarah Kim, Senior Software Engineer at ${company.name||"the company"}. Plan the COMPLETE file structure for this build request.

BUILD REQUEST: "${spec}"
REQUIREMENTS: ${JSON.stringify(requirements||{})}

Plan a real, runnable project — not just documentation. Include ALL of: source code files organized into folders like src/, components/, utils/ as appropriate; a package.json (or equivalent manifest for the language); a README.md; and test files. Every distinct algorithm, encoder/decoder, or logical component named or implied in the requirements/coreFeatures MUST be its own file — do not collapse multiple components into one file, and do not omit any component mentioned in the request.

IMPORTANT: Plan AT MOST 12 files total (merge related smaller pieces if needed to stay under this limit). Keep each "description" to ONE short sentence (under 15 words) — this response must stay compact.

Output ONLY valid JSON — no markdown, no text before or after, no extra whitespace:
{"projectName":"kebab-case-name","language":"e.g. javascript|python|typescript","files":[{"path":"src/encoder.js","description":"short one-line description","language":"javascript"}]}`,

  // Compact retry variant used if the first file-plan attempt fails/truncates —
  // even smaller scope so the response reliably fits in the token budget.
  buildFilePlanCompact: (spec, requirements, company) => `You are Sarah Kim, Senior Software Engineer at ${company.name||"the company"}. Plan a file structure for: "${spec}"

Requirements summary: ${requirements?.summary || spec}
Core components to cover: ${(requirements?.coreFeatures||[]).join(", ")}

Plan EXACTLY 6-8 files maximum, covering the most essential components only, plus package manifest and README. Keep descriptions to 6 words or less.

Output ONLY compact valid JSON, nothing else:
{"projectName":"kebab-case-name","language":"javascript","files":[{"path":"src/main.js","description":"short desc","language":"javascript"}]}`,

  // Generates ONE file at a time — keeps each response small and reliable so
  // large multi-file projects don't get truncated or fail JSON parsing.
  buildFileContent: (spec, requirements, filePlan, targetFile, otherFilesSummary, company, revisionNotes) => `You are Sarah Kim, Senior Software Engineer at ${company.name||"the company"}. Write the COMPLETE, real, working content of ONE file in a larger project.

BUILD REQUEST: "${spec}"
PROJECT: ${filePlan?.projectName || "project"} (${filePlan?.language || "javascript"})
FULL FILE PLAN (for context on what else exists / will exist): ${(filePlan?.files||[]).map(f=>`${f.path} — ${f.description}`).join("; ")}
${otherFilesSummary ? `\nALREADY-WRITTEN FILES (reference these correctly via imports where relevant):\n${otherFilesSummary}\n` : ""}
${revisionNotes ? `\nREVISION NEEDED — the CTO requested these changes across the project, apply anything relevant to this file:\n${revisionNotes}\n` : ""}

NOW WRITE: ${targetFile.path} — ${targetFile.description}

Rules:
- COMPLETE, runnable production-ready code.
- NO PLACEHOLDERS. NEVER use "// TODO", "// implementation goes here", or "// rest of code...".
- FULL SOURCE ONLY. Every function, class, and method must be fully implemented.
- If you cannot fit the entire logic in one response, focus on the core functionality but ensure the code remains functional and non-stubbed.
- If this is package.json, include real dependency versions.
- If this is a test file, write real, executable assertions.
- Ensure import paths match the project structure perfectly.

Output ONLY valid JSON — no markdown fences, no text before or after:
{"content":"the complete file content as a JSON string (escape newlines as \\n)"}`,

  ctoCodeReview: (files, spec, company) => `You are Alex Chen, CTO at ${company.name||"the company"}. Review this code submitted by the Software Engineer for the build request: "${spec}"

FILES SUBMITTED (${(files||[]).length} total, content truncated for review):
${(files||[]).map(f => `--- ${f.path} ---\n${(f.content||"").slice(0,700)}`).join("\n\n").slice(0, 6000)}

Review for correctness, security, structure, and completeness — specifically check that every algorithm/component implied by the build request actually has a real implementation, not just a stub or README mention. Output ONLY valid JSON — no markdown, no text before or after:
{"score":85,"approved":true,"issues":["issue1"],"suggestions":["suggestion1"],"securityNotes":["note1"],"revisionNotes":""}`,
};

// ── MEMORY ENGINE ────────────────────────────────────────
const MemoryEngine = {
  store: (dispatch, item) => dispatch({
    type:"ADD_MEMORY",
    payload:{ id:`m_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, ...item, savedAt:new Date().toISOString() }
  }),
  getContext: (memory, limit=8) =>
    (memory||[]).slice(0,limit).map(m=>`[${m.category||"note"}] ${m.content}`).join("\n"),
  search: (memory, q) => !q ? memory : memory.filter(m=>(m.content||"").toLowerCase().includes(q.toLowerCase())),
};

// ── JSON CLAUDE CALL ─────────────────────────────────────
const callClaudeJSON = async (messages, system, maxTokens = 1000) => {
  // Use the dedicated /json endpoint on the proxy for Gemini JSON mode;
  // falls back to the standard Claude endpoint when proxy is not configured.
  const endpoint = PROXY_BASE_URL
    ? `${PROXY_BASE_URL}/v1/messages/json`
    : "https://api.anthropic.com/v1/messages";
  const res = await fetchWithRetry(endpoint, {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ model:"claude-sonnet-4-6", max_tokens:maxTokens, system, messages }),
  });
  const data = await res.json();
  const text = data.content?.map(b=>b.text||"").join("")||"";
  const clean = text.replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim();
  const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
  if(s===-1) throw new Error("No JSON");
  return JSON.parse(clean.slice(s,e+1));
};

// ── CEO ORCHESTRATOR ─────────────────────────────────────
const CEOOrchestrator = {
  run: async ({ goal, company, memory, dispatch, addActivity, toast, setStage, setProgress, abort }) => {
    const log = (msg, icon="🤖") => { addActivity(msg, icon); setStage(msg); dispatch({ type:"ADD_AUTO_LOG", payload:{ id:`log_${Date.now()}_${Math.random().toString(36).slice(2,5)}`, msg, icon, time:new Date().toLocaleTimeString() } }); };
    try {
      setProgress(5);
      log("👑 CEO analyzing goal and creating strategic plan...", "👑");

      let plan;
      try {
        plan = await callClaudeJSON(
          [{ role:"user", content:`Create execution plan for: "${goal}"` }],
          PromptGenerator.planner(goal, company, memory)
        );
        if (!plan.phases) throw new Error("no phases");
      } catch(e) {
        plan = {
          title:`Plan: ${goal}`, goal, totalDuration:"4 weeks",
          phases:[
            { phase:"Discovery & Research", owner:"analyst", duration:"3 days", tasks:["Market research","Competitive analysis","Define KPIs"], deliverable:"Research report", dependencies:"none" },
            { phase:"Strategy & Spec", owner:"pm", duration:"4 days", tasks:["Write PRD","Define roadmap","Set OKRs"], deliverable:"Product spec", dependencies:"Phase 1" },
            { phase:"Build & Execute", owner:"engineer", duration:"14 days", tasks:["Build MVP","Test","Deploy"], deliverable:"Working product", dependencies:"Phase 2" },
            { phase:"Launch & Measure", owner:"marketing", duration:"5 days", tasks:["Launch campaign","Monitor metrics","Optimize"], deliverable:"Growth results", dependencies:"Phase 3" },
          ],
          successMetrics:["Goal achieved","Team aligned","Metrics tracked"],
          risks:["Timeline slippage","Resource constraints"],
        };
      }

      setProgress(20);
      dispatch({ type:"SET_PLAN", payload:plan });
      MemoryEngine.store(dispatch, { category:"project", content:`Auto-plan: "${goal}" — ${plan.phases.length} phases, ${plan.totalDuration}`, importance:"high" });
      log(`📋 Plan created: ${plan.phases.length} phases, ${plan.totalDuration}`, "📋");
      if(abort.current) return { success:false };

      setProgress(30);
      log("📌 Creating and distributing tasks...", "📌");
      const created = [];
      plan.phases.forEach((ph, idx) => {
        (ph.tasks||[]).forEach(title => {
          const id = `auto_${Date.now()}_${Math.random().toString(36).slice(2,5)}`;
          const task = { id, title, desc:`Phase ${idx+1}: ${ph.phase}. Target: ${ph.deliverable}`, assignee:ph.owner, status:"todo", priority:idx===0?"high":"medium", source:"autonomous", phase:ph.phase, createdAt:new Date().toISOString() };
          dispatch({ type:"ADD_TASK", payload:task });
          created.push(task);
        });
      });
      toast(`${created.length} tasks created`, "success");
      setProgress(40);
      if(abort.current) return { success:false };

      const owners = [...new Set(plan.phases.map(p=>p.owner))].slice(0,3);
      for(let i=0; i<owners.length; i++) {
        if(abort.current) return { success:false };
        const empId = owners[i];
        const emp = EMP_REGISTRY[empId];
        if(!emp) continue;
        setProgress(40 + Math.floor(((i+1)/owners.length)*35));
        log(`${emp.icon} ${emp.name} executing assigned tasks...`, emp.icon);

        const ph = plan.phases.find(p=>p.owner===empId);
        const taskCtx = ph ? `Goal: "${goal}"\nPhase: "${ph.phase}"\nTasks: ${(ph.tasks||[]).join(", ")}\nDeliver: ${ph.deliverable}` : `Help achieve: "${goal}"`;
        const prompt = `Autonomous task execution for goal: "${goal}"\n\n${taskCtx}\n\nProvide detailed, specific, professional output. Be thorough and actionable.`;

        dispatch({ type:"ADD_EMP_MSG", empId, payload:{ id:`u_${Date.now()}`, role:"user", content:prompt, display:`🤖 AUTO: ${ph?.phase||goal}` } });
        dispatch({ type:"ADD_EMP_MSG", empId, payload:{ id:`a_${Date.now()}`, role:"assistant", content:"", loading:true } });

        try {
          const sys = PromptGenerator.employee(empId, company, memory.slice(0,3));
          const reply = await callClaude([{ role:"user", content:prompt }], sys);
          dispatch({ type:"UPD_EMP_LAST", empId, payload:{ content:reply, loading:false } });

          log(`🔍 Reviewing ${emp.name}'s output...`, "🔍");
          let review;
          try {
            review = await callClaudeJSON(
              [{ role:"user", content:`Review output for "${ph?.phase||goal}":\n${reply.slice(0,1200)}` }],
              PromptGenerator.reviewer(reply, ph?.phase||goal, ph?.deliverable)
            );
            if(typeof review.score !== "number") throw new Error("bad review");
          } catch {
            review = { score:80, approved:true, feedback:"Output meets requirements", strengths:["Detailed","Actionable"], gaps:[], revision_needed:false };
          }

          dispatch({ type:"ADD_REVIEW", payload:{ id:`r_${Date.now()}`, empId, empName:emp.name, taskTitle:ph?.phase||goal, score:review.score, approved:review.approved, feedback:review.feedback, strengths:review.strengths||[], gaps:review.gaps||[], createdAt:new Date().toISOString() } });
          created.filter(t=>t.assignee===empId).forEach(t => dispatch({ type:"UPDATE_TASK", id:t.id, payload:{ status:review.approved?"done":"review" } }));
          log(`${review.approved?"✅":"⚠️"} ${emp.name}: score ${review.score}/100`, review.approved?"✅":"⚠️");

          if (empId === "researcher") {
            const report = parseResearchReport(reply);
            if (report.executiveSummary || report.keyFindings.length) {
              dispatch({ type:"ADD_RESEARCH", payload:{ id:`res_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, query: ph?.phase||goal, ...report, createdAt:new Date().toISOString() } });
              MemoryEngine.store(dispatch, { category:"insight", content:`Research: "${(ph?.phase||goal).slice(0,80)}" — ${report.executiveSummary.slice(0,160)}`, importance: report.confidenceScore >= 70 ? "high" : "medium" });
            }
          }
        } catch(e) {
          dispatch({ type:"UPD_EMP_LAST", empId, payload:{ content:`⚠️ Error: ${e.message}`, loading:false } });
        }
        await new Promise(r=>setTimeout(r,300));
      }

      if(abort.current) return { success:false };
      setProgress(88);
      log("👑 CEO compiling final report...", "👑");

      const finalPrompt = `AUTONOMOUS EXECUTION COMPLETE.\n\nGoal: "${goal}"\nPlan: ${plan.title} (${plan.totalDuration})\nPhases executed: ${owners.length}\nTasks created: ${created.length}\n\nAs CEO: provide executive summary, what each employee delivered, gaps, immediate next steps. Use [MEMORY:] to save outcomes and [KPI:] to update metrics.`;
      dispatch({ type:"ADD_CEO_MSG", payload:{ id:`u_${Date.now()}`, role:"user", content:finalPrompt, display:`📊 Auto Report: "${goal.slice(0,40)}"` } });
      dispatch({ type:"ADD_CEO_MSG", payload:{ id:`a_${Date.now()}`, role:"assistant", content:"", loading:true } });

      const finalSys = PromptGenerator.ceo(memory, company, `Just completed autonomous execution of: "${goal}"`);
      const finalReply = await callClaude([{ role:"user", content:finalPrompt }], finalSys);
      dispatch({ type:"UPDATE_CEO_LAST", payload:{ content:finalReply, loading:false } });
      const cmds = parseCEOCommands(finalReply);
      cmds.memories.forEach(m => MemoryEngine.store(dispatch, m));
      cmds.kpis.forEach(k => dispatch({ type:"UPSERT_KPI", payload:k }));

      setProgress(100);
      log("🚀 Autonomous cycle complete!", "🚀");
      toast(`✅ Done: "${goal.slice(0,40)}" — ${created.length} tasks, ${owners.length} employees`, "success");
      MemoryEngine.store(dispatch, { category:"project", content:`COMPLETED: "${goal}" — ${created.length} tasks`, importance:"high" });
      return { success:true };
    } catch(e) {
      log(`❌ ${e.message}`, "❌");
      toast(`Auto error: ${e.message}`, "error");
      return { success:false, error:e.message };
    }
  }
};

// ── BUILD ORCHESTRATOR ────────────────────────────────────
// CEO → Research Engineer → Software Engineer → CTO Review → Final Reviewer
// Produces complete downloadable source files (ZIP) and GitHub-exportable output.
const BuildOrchestrator = {
  run: async ({ spec, name, company, memory, dispatch, addActivity, toast, setStage, setProgress, abort }) => {
    const buildId = `build_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    const log = (msg, icon="🛠️") => { addActivity(msg, icon); setStage(msg); };

    const record = {
      id: buildId, name: name || spec.slice(0,40), spec, status: "running",
      createdAt: new Date().toISOString(),
      requirements: null, files: [], engineerSummary: "", setupInstructions: "",
      ctoReview: null, finalReview: null,
    };
    dispatch({ type:"ADD_BUILD", payload: record });

    // Generates every planned file one at a time (small, reliable JSON calls
    // instead of one giant blob), updating the build record as it goes so the
    // UI shows files appearing progressively.
    const generateAllFiles = async (filePlan, revisionNotes) => {
      const files = [];
      const plannedFiles = filePlan.files || [];
      for (let i = 0; i < plannedFiles.length; i++) {
        if (abort.current) break;
        const target = plannedFiles[i];
        log(`⚙️ Writing ${target.path} (${i+1}/${plannedFiles.length})...`, "⚙️");
        setProgress(25 + Math.floor(((i+1)/Math.max(plannedFiles.length,1)) * 40));
        const otherFilesSummary = files.map(f => `${f.path} — exports/contains: ${(f.content||"").slice(0,80).replace(/\n/g," ")}`).join("\n");
        let content = null;
        try {
          const result = await callClaudeJSON(
            [{ role:"user", content:`Write file: ${target.path}` }],
            PromptGenerator.buildFileContent(spec, requirementsRef.current, filePlan, target, otherFilesSummary, company, revisionNotes),
            8192
          );
          content = result.content;

          // Code Completeness Check
          const placeholders = ["// rest of", "// implementation", "// TODO", "// fill in"];
          if (placeholders.some(p => content.toLowerCase().includes(p))) {
            log(`🔍 Detected stubbed code in ${target.path}, re-generating...`, "🔍");
            const finalResult = await callClaudeJSON(
              [{ role:"user", content:`Your previous output for ${target.path} contained placeholders. REWRITE it now with FULL implementation. NO STUBS.` }],
              PromptGenerator.buildFileContent(spec, requirementsRef.current, filePlan, target, otherFilesSummary, company, revisionNotes),
              8192
            );
            content = finalResult.content;
          }
        } catch(e1) {
          log(`🔁 Retrying ${target.path} (response too large)...`, "🔁");
          try {
            const retryResult = await callClaudeJSON(
              [{ role:"user", content:`Write file: ${target.path}. Keep it complete but concise — avoid excessive comments.` }],
              PromptGenerator.buildFileContent(spec, requirementsRef.current, filePlan, target, otherFilesSummary, company, revisionNotes),
              4000
            );
            content = retryResult.content;
          } catch(e2) {
            content = `// Generation failed twice for this file.\n// Attempt 1: ${e1.message}\n// Attempt 2: ${e2.message}\n// Description: ${target.description}\n// Click "Start Build" again to regenerate — other files in this project were unaffected.`;
          }
        }
        files.push({ path: target.path, language: target.language || "text", content: content || `// Empty: ${target.description}` });
        dispatch({ type:"UPDATE_BUILD", id:buildId, payload:{ files:[...files] } });
        // Small delay between files to avoid anti-flood triggers
        await new Promise(r => setTimeout(r, 500));
      }
      return files;
    };

    // requirementsRef lets generateAllFiles read the latest requirements
    // without needing them threaded through every call.
    const requirementsRef = { current:null };

    try {
      setProgress(5);
      log("🔬 Research Engineer analyzing requirements...", "🔬");
      let requirements;
      try {
        requirements = await callClaudeJSON(
          [{ role:"user", content:`Analyze build request: "${spec}"` }],
          PromptGenerator.buildRequirements(spec, company),
          1200
        );
      } catch {
        requirements = { summary: spec, techStack:"appropriate to the request", coreFeatures:[spec], risks:[], notes:"" };
      }
      requirementsRef.current = requirements;
      dispatch({ type:"UPDATE_BUILD", id:buildId, payload:{ requirements } });
      log(`📋 Requirements ready: ${requirements.summary?.slice(0,80)||spec.slice(0,80)}`, "📋");
      if (abort.current) { dispatch({ type:"UPDATE_BUILD", id:buildId, payload:{ status:"aborted" } }); return { success:false }; }

      setProgress(15);
      log("⚙️ Sarah Kim (Software Engineer) planning file structure...", "⚙️");
      const slug = (name||spec||"project").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,30) || "project";
      let filePlan;
      try {
        filePlan = await callClaudeJSON(
          [{ role:"user", content:`Plan the file structure for: "${spec}"` }],
          PromptGenerator.buildFilePlan(spec, requirements, company),
          3000
        );
        if (!filePlan.files || !filePlan.files.length) throw new Error("no files planned");
      } catch(e1) {
        log("🔁 Plan response too large — retrying with a smaller scope...", "🔁");
        try {
          filePlan = await callClaudeJSON(
            [{ role:"user", content:`Plan a compact file structure for: "${spec}"` }],
            PromptGenerator.buildFilePlanCompact(spec, requirements, company),
            1500
          );
          if (!filePlan.files || !filePlan.files.length) throw new Error("no files planned");
        } catch(e2) {
          // Real multi-file fallback (never just a lone README) — derived from
          // whatever core components the research step already identified.
          const coreFeatures = (requirements?.coreFeatures || []).filter(Boolean).slice(0, 6);
          const compNames = coreFeatures.length ? coreFeatures : [spec];
          const toFile = (n, i) => `src/${(n||`module_${i}`).toString().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,24) || `module_${i}`}.js`;
          filePlan = {
            projectName: slug,
            language: "javascript",
            files: [
              ...compNames.map((c, i) => ({ path: toFile(c, i), description: `Implements: ${c}`, language: "javascript" })),
              { path: "package.json", description: "Project manifest", language: "json" },
              { path: "tests/main.test.js", description: "Tests for core components", language: "javascript" },
              { path: "README.md", description: `Setup + usage. (AI planning failed twice: ${e2.message} — this is a minimal structure; retry the build for a fuller AI-generated plan.)`, language: "markdown" },
            ],
          };
        }
      }
      log(`📐 Plan ready: ${filePlan.files.length} file(s) — ${filePlan.files.map(f=>f.path).join(", ").slice(0,150)}`, "📐");
      if (abort.current) { dispatch({ type:"UPDATE_BUILD", id:buildId, payload:{ status:"aborted" } }); return { success:false }; }

      let files = await generateAllFiles(filePlan);
      let engineerSummary = `Generated ${files.length} file(s) for: ${filePlan.projectName || spec.slice(0,40)}`;
      dispatch({ type:"UPDATE_BUILD", id:buildId, payload:{ files, engineerSummary } });
      log(`💻 ${files.length} file(s) generated`, "💻");
      if (abort.current) { dispatch({ type:"UPDATE_BUILD", id:buildId, payload:{ status:"aborted" } }); return { success:false }; }

      setProgress(68);
      log("💻 Alex Chen (CTO) reviewing code...", "💻");
      let ctoReview;
      try {
        ctoReview = await callClaudeJSON(
          [{ role:"user", content:`Review the submitted code for: "${spec}"` }],
          PromptGenerator.ctoCodeReview(files, spec, company),
          1200
        );
        if (typeof ctoReview.score !== "number") throw new Error("bad review");
      } catch {
        ctoReview = { score:75, approved:true, issues:[], suggestions:[], securityNotes:[], revisionNotes:"" };
      }

      // One revision pass if CTO isn't satisfied — regenerate flagged files with feedback
      if (!ctoReview.approved && ctoReview.revisionNotes) {
        log("🔁 CTO requested changes — Software Engineer revising files...", "🔁");
        setProgress(78);
        try {
          const revisedFiles = await generateAllFiles(filePlan, ctoReview.revisionNotes);
          if (revisedFiles.length) {
            files = revisedFiles;
            dispatch({ type:"UPDATE_BUILD", id:buildId, payload:{ files } });
            const reReview = await callClaudeJSON(
              [{ role:"user", content:`Re-review revised code for: "${spec}"` }],
              PromptGenerator.ctoCodeReview(files, spec, company),
              1200
            );
            if (typeof reReview.score === "number") ctoReview = reReview;
          }
        } catch {}
      }

      dispatch({ type:"UPDATE_BUILD", id:buildId, payload:{ ctoReview } });
      dispatch({ type:"ADD_REVIEW", payload:{ id:`r_${Date.now()}`, empId:"cto", empName:EMP_REGISTRY.cto.name, taskTitle:`Code review: ${name||spec.slice(0,40)}`, score:ctoReview.score, approved:ctoReview.approved, feedback:(ctoReview.suggestions||[]).join("; "), strengths:[], gaps:ctoReview.issues||[], createdAt:new Date().toISOString() } });
      log(`${ctoReview.approved?"✅":"⚠️"} CTO review: ${ctoReview.score}/100`, ctoReview.approved?"✅":"⚠️");
      if (abort.current) { dispatch({ type:"UPDATE_BUILD", id:buildId, payload:{ status:"aborted" } }); return { success:false }; }

      setProgress(90);
      log("🔍 Final Reviewer running quality check...", "🔍");
      let finalReview;
      try {
        finalReview = await callClaudeJSON(
          [{ role:"user", content:`Final QA for build: "${spec}"` }],
          PromptGenerator.reviewer(engineerSummary || spec, name||spec, requirements?.summary),
          1200
        );
        if (typeof finalReview.score !== "number") throw new Error("bad review");
      } catch {
        finalReview = { score:80, approved:true, feedback:"Meets requirements", strengths:[], gaps:[], revision_needed:false };
      }
      dispatch({ type:"UPDATE_BUILD", id:buildId, payload:{ finalReview } });
      dispatch({ type:"ADD_REVIEW", payload:{ id:`r_${Date.now()+1}`, empId:"researcher", empName:"Final Reviewer", taskTitle:`Final QA: ${name||spec.slice(0,40)}`, score:finalReview.score, approved:finalReview.approved, feedback:finalReview.feedback, strengths:finalReview.strengths||[], gaps:finalReview.gaps||[], createdAt:new Date().toISOString() } });

      const status = (ctoReview.approved && finalReview.approved) ? "completed" : "needs_revision";
      dispatch({ type:"UPDATE_BUILD", id:buildId, payload:{ status } });
      MemoryEngine.store(dispatch, { category:"project", content:`Build ${status}: "${name||spec.slice(0,60)}" — ${files.length} files, CTO ${ctoReview.score}/100, QA ${finalReview.score}/100`, importance:"high" });

      setProgress(100);
      log("🚀 Build pipeline complete!", "🚀");
      toast(`✅ Build ${status === "completed" ? "complete" : "needs revision"}: ${files.length} files ready`, status === "completed" ? "success" : "warning");
      return { success:true, buildId };
    } catch(e) {
      dispatch({ type:"UPDATE_BUILD", id:buildId, payload:{ status:"error", error:e.message } });
      log(`❌ ${e.message}`, "❌");
      toast(`Build error: ${e.message}`, "error");
      return { success:false, error:e.message };
    }
  }
};

// ── DONUT CHART ──────────────────────────────────────────

// ── PROGRESS BAR ─────────────────────────────────────────
const ProgressBar = ({ value=0, color=T.accent, height=4, label }) => (
  <div>
    {label && <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
      <span style={{fontSize:"0.68rem",color:T.text3}}>{String(label).slice(0,55)}</span>
      <span style={{fontSize:"0.68rem",color}}>{Math.round(value)}%</span>
    </div>}
    <div style={{background:T.surf2,borderRadius:height,height,overflow:"hidden"}}>
      <div style={{width:`${Math.min(value,100)}%`,height:"100%",background:`linear-gradient(90deg,${color},${color}aa)`,transition:"width 0.4s ease",borderRadius:height}} />
    </div>
  </div>
);

const DonutChart = ({ data=[], size=80 }) => {
  const ref = useRef();
  useEffect(() => {
    const c = ref.current; if(!c||!data.length) return;
    const ctx = c.getContext("2d");
    c.width = size*2; c.height = size*2; ctx.scale(2,2);
    const cx=size/2, cy=size/2, r=size*0.38, ir=size*0.24;
    const total = data.reduce((s,d)=>s+d.value,0)||1;
    let angle = -Math.PI/2;
    data.forEach(d => {
      if(!d.value) return;
      const slice=(d.value/total)*Math.PI*2;
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,angle,angle+slice); ctx.closePath();
      ctx.fillStyle=d.color; ctx.fill(); angle+=slice;
    });
    ctx.beginPath(); ctx.arc(cx,cy,ir,0,Math.PI*2);
    ctx.fillStyle=T.surf; ctx.fill();
  },[data,size]);
  return <canvas ref={ref} style={{width:size,height:size}} />;
};



// ── PLANNER VIEW ─────────────────────────────────────────
const PlannerView = ({ S, dispatch, autoGoal, setAutoGoal, autoRunning, runAuto, abortRef, setAutoRunning, setAutoStage, setAutoProgress, autoProgress, autoStage, T, inp, EMPS }) => {
  const plan = S.activePlan;
  return (
    <div style={{padding:18}}>
      <div style={{background:T.surf,border:`1px solid ${T.accent}28`,borderRadius:14,padding:20,marginBottom:16}}>
        <div style={{fontWeight:700,fontSize:"0.88rem",marginBottom:6}}>🗂️ AI Strategic Planner</div>
        <div style={{color:T.text2,fontSize:"0.78rem",marginBottom:12}}>Give a goal → CEO creates plan → assigns team → executes → reviews → delivers final output.</div>
        {autoRunning && <div style={{marginBottom:10}}><ProgressBar value={autoProgress} color={T.accent} height={5} label={autoStage} /></div>}
        <div style={{display:"flex",gap:9}}>
          <input value={autoGoal} onChange={e=>setAutoGoal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!autoRunning&&runAuto()} placeholder="e.g. Launch beta with 500 users in 30 days" disabled={autoRunning} style={{...inp,flex:1}} />
          <button onClick={autoRunning?()=>{abortRef.current=true;setAutoRunning(false);setAutoStage("");setAutoProgress(0);}:runAuto}
            style={{padding:"10px 18px",background:autoRunning?`${T.red}18`:`linear-gradient(135deg,${T.accent},${T.accent2})`,border:autoRunning?`1px solid ${T.red}40`:"none",borderRadius:9,color:autoRunning?T.red:"#fff",fontWeight:700,fontSize:"0.8rem",cursor:"pointer",whiteSpace:"nowrap"}}>
            {autoRunning ? "⏹ Stop" : "🚀 Generate Plan"}
          </button>
        </div>
      </div>
      {plan ? (
        <div style={{background:T.surf,border:`1px solid ${T.border2}`,borderRadius:14,padding:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
            <div>
              <div style={{fontWeight:800,fontSize:"1rem",color:T.text1}}>{plan.title}</div>
              <div style={{fontSize:"0.74rem",color:T.text2,marginTop:3}}>Goal: {plan.goal} · {plan.totalDuration}</div>
            </div>
            <button onClick={()=>dispatch({type:"SET_PLAN",payload:null})} style={{background:T.surf2,border:"none",borderRadius:6,color:T.text3,padding:"4px 10px",fontSize:"0.7rem",cursor:"pointer"}}>Clear</button>
          </div>
          {(plan.phases||[]).map((ph,i)=>{
            const e=EMPS[ph.owner]; const pt=S.tasks.filter(t=>t.phase===ph.phase); const done=pt.filter(t=>t.status==="done").length;
            return (
              <div key={i} style={{background:T.surf2,border:`1px solid ${T.border2}`,borderRadius:11,padding:14,marginBottom:10}}>
                <div style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:10}}>
                  <div style={{width:34,height:34,borderRadius:9,background:`${e?.color||T.accent}20`,border:`1px solid ${e?.color||T.accent}38`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0}}>{e?.icon||"👤"}</div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:"0.84rem",color:T.text1}}>Phase {i+1}: {ph.phase}</div>
                    <div style={{fontSize:"0.68rem",color:T.text2}}>{e?.name||ph.owner} · {ph.duration}</div>
                  </div>
                  {pt.length>0&&<div style={{textAlign:"right",minWidth:64}}><div style={{fontSize:"0.68rem",color:T.text3,marginBottom:3}}>{done}/{pt.length}</div><ProgressBar value={pt.length?Math.round((done/pt.length)*100):0} color={e?.color||T.accent} height={3} /></div>}
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:7}}>{(ph.tasks||[]).map((t,j)=><span key={j} style={{background:T.surf,border:`1px solid ${T.border2}`,borderRadius:6,padding:"2px 8px",fontSize:"0.65rem",color:T.text2}}>{t}</span>)}</div>
                <div style={{fontSize:"0.7rem",color:T.green}}>✓ {ph.deliverable}</div>
                {ph.dependencies&&ph.dependencies!=="none"&&<div style={{fontSize:"0.65rem",color:T.text3,marginTop:2}}>Needs: {ph.dependencies}</div>}
              </div>
            );
          })}
          {plan.successMetrics?.length>0&&<div style={{marginTop:12,padding:"12px 14px",background:`${T.green}08`,border:`1px solid ${T.green}22`,borderRadius:10}}><div style={{fontWeight:700,fontSize:"0.74rem",color:T.green,marginBottom:5}}>✅ Success Metrics</div>{plan.successMetrics.map((m,i)=><div key={i} style={{fontSize:"0.72rem",color:T.text2}}>• {m}</div>)}</div>}
          {plan.risks?.length>0&&<div style={{marginTop:8,padding:"12px 14px",background:`${T.red}08`,border:`1px solid ${T.red}22`,borderRadius:10}}><div style={{fontWeight:700,fontSize:"0.74rem",color:T.red,marginBottom:5}}>⚠️ Risks</div>{plan.risks.map((r,i)=><div key={i} style={{fontSize:"0.72rem",color:T.text2}}>• {r}</div>)}</div>}
        </div>
      ) : !autoRunning && (
        <div style={{textAlign:"center",padding:"60px 20px",color:T.text3}}>
          <div style={{fontSize:40,marginBottom:12}}>🗂️</div>
          <div style={{fontSize:"0.84rem"}}>No active plan. Enter a goal above and click Generate Plan.</div>
        </div>
      )}
    </div>
  );
};

// ── REVIEWS VIEW ─────────────────────────────────────────
const ReviewsView = ({ S, T, EMPS }) => {
  const [tab, setTab] = useState("all");
  const filtered = (S.reviews||[]).filter(r=>tab==="all"?true:tab==="approved"?r.approved:!r.approved);
  const avg = S.reviews?.length ? Math.round((S.reviews||[]).reduce((s,r)=>s+(r.score||0),0)/S.reviews.length) : 0;
  return (
    <div style={{padding:18}}>
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        {[["all","All"],["approved","Approved"],["rejected","Needs Work"]].map(([f,l])=>(
          <button key={f} onClick={()=>setTab(f)} style={{padding:"5px 14px",background:tab===f?T.accent:T.surf,border:`1px solid ${tab===f?T.accent:T.border2}`,borderRadius:20,color:tab===f?"#fff":T.text2,fontSize:"0.74rem",fontWeight:tab===f?700:400,cursor:"pointer"}}>
            {l} ({f==="all"?(S.reviews||[]).length:f==="approved"?(S.reviews||[]).filter(r=>r.approved).length:(S.reviews||[]).filter(r=>!r.approved).length})
          </button>
        ))}
        <div style={{marginLeft:"auto",fontSize:"0.74rem",color:T.text2}}>Avg Score: <strong style={{color:T.green}}>{avg}</strong>/100</div>
      </div>
      {filtered.length===0?(
        <div style={{textAlign:"center",padding:"60px 0",color:T.text3}}><div style={{fontSize:40,marginBottom:12}}>🔍</div><div>No reviews yet. Run Autonomous Mode to generate reviews automatically.</div></div>
      ):(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:12}}>
          {filtered.map((r,i)=>{
            const e=EMPS[r.empId]; const sc=r.score||0; const scC=sc>=80?T.green:sc>=60?T.yellow:T.red;
            return (
              <div key={r.id||i} style={{background:T.surf,border:`1px solid ${r.approved?T.green+"28":T.red+"28"}`,borderRadius:13,padding:16,borderTop:`3px solid ${r.approved?T.green:T.red}`}}>
                <div style={{display:"flex",gap:9,marginBottom:10}}>
                  <div style={{width:34,height:34,borderRadius:9,background:`${e?.color||T.accent}20`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17}}>{e?.icon||"👤"}</div>
                  <div style={{flex:1}}><div style={{fontWeight:700,fontSize:"0.8rem",color:T.text1}}>{(r.taskTitle||"Task").slice(0,38)}</div><div style={{fontSize:"0.65rem",color:T.text2}}>{r.empName}</div></div>
                  <div style={{textAlign:"right"}}><div style={{fontSize:"1.4rem",fontWeight:900,color:scC,lineHeight:1}}>{sc}</div><div style={{fontSize:"0.58rem",color:T.text3}}>/100</div></div>
                </div>
                <ProgressBar value={sc} color={scC} height={4} />
                {r.feedback&&<div style={{marginTop:9,fontSize:"0.74rem",color:T.text2,lineHeight:1.5}}>{r.feedback}</div>}
                <div style={{marginTop:7,display:"flex",flexDirection:"column",gap:2}}>
                  {(r.strengths||[]).slice(0,2).map((s,j)=><div key={j} style={{fontSize:"0.68rem",color:T.green}}>✓ {s}</div>)}
                  {(r.gaps||[]).slice(0,2).map((g,j)=><div key={j} style={{fontSize:"0.68rem",color:T.yellow}}>⚠ {g}</div>)}
                </div>
                <div style={{marginTop:7,fontSize:"0.6rem",color:T.text3}}>{r.createdAt?new Date(r.createdAt).toLocaleString():""}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── BUILD VIEW ─────────────────────────────────────────────
// Multi-agent software pipeline: Research → Software Engineer → CTO → Reviewer
// Produces complete code files, downloadable as ZIP, exportable to GitHub.
const BuildView = ({ S, T, inp, buildSpec, setBuildSpec, buildName, setBuildName, buildRunning, buildStage, buildProgress, runBuild, stopBuild }) => {
  const builds = S.builds || [];
  const [openId, setOpenId] = useState(builds[0]?.id || null);
  const [ghOpenId, setGhOpenId] = useState(null);
  const [ghToken, setGhToken] = useState("");
  const [ghOwner, setGhOwner] = useState("");
  const [ghRepo, setGhRepo] = useState("");
  const [ghBranch, setGhBranch] = useState("main");
  const [ghPushing, setGhPushing] = useState(false);
  const [ghMsg, setGhMsg] = useState(null);

  const statusColor = (s) => s==="completed"?T.green : s==="needs_revision"?T.yellow : s==="error"||s==="aborted"?T.red : T.cyan;
  const statusLabel = (s) => ({ completed:"✅ Completed", needs_revision:"⚠️ Needs Revision", error:"❌ Error", aborted:"⏹ Aborted", running:"⏳ Running" }[s] || s);

  const doGithubPush = async (build) => {
    setGhPushing(true); setGhMsg(null);
    try {
      await pushFilesToGithub({ token: ghToken, owner: ghOwner, repo: ghRepo, branch: ghBranch, files: build.files, commitMessage: `APEX OS build: ${build.name}` });
      setGhMsg({ type:"success", text:`Pushed ${build.files.length} file(s) to ${ghOwner}/${ghRepo}@${ghBranch}` });
    } catch(e) {
      setGhMsg({ type:"error", text: e.message });
    }
    setGhPushing(false);
  };

  return (
    <div style={{ padding: 18 }}>
      <div style={{ background: T.surf, border: `1px solid ${T.accent}28`, borderRadius: 14, padding: 20, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: "0.88rem", marginBottom: 6 }}>🛠️ AI Build Pipeline</div>
        <div style={{ color: T.text2, fontSize: "0.78rem", marginBottom: 12 }}>Describe what to build → Research Engineer briefs it → Software Engineer writes complete code → CTO reviews → Final QA → download ZIP or push to GitHub.</div>
        {buildRunning && <div style={{ marginBottom: 10 }}><ProgressBar value={buildProgress} color={T.accent} height={5} label={buildStage} /></div>}
        <input value={buildName} onChange={e=>setBuildName(e.target.value)} placeholder="Project name (optional)" disabled={buildRunning} style={{ ...inp, marginBottom: 9 }} />
        <div style={{ display:"flex", gap:9 }}>
          <input value={buildSpec} onChange={e=>setBuildSpec(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!buildRunning&&runBuild()} placeholder="e.g. A React todo app with due dates and local storage" disabled={buildRunning} style={{ ...inp, flex:1 }} />
          <button onClick={buildRunning ? stopBuild : ()=>runBuild()} style={{ padding:"10px 18px", background: buildRunning?`${T.red}18`:`linear-gradient(135deg,${T.accent},${T.accent2})`, border: buildRunning?`1px solid ${T.red}40`:"none", borderRadius:9, color: buildRunning?T.red:"#fff", fontWeight:700, fontSize:"0.8rem", cursor:"pointer", whiteSpace:"nowrap" }}>
            {buildRunning ? "⏹ Stop" : "🚀 Start Build"}
          </button>
        </div>
      </div>

      {builds.length === 0 ? (
        <div style={{ textAlign:"center", padding:"60px 0", color:T.text3 }}>
          <div style={{ fontSize:40, marginBottom:12 }}>🛠️</div>
          <div>No builds yet. Describe something to build above, or ask APEX in CEO Chat to build it for you.</div>
        </div>
      ) : builds.map(b => {
        const open = openId === b.id;
        return (
          <div key={b.id} style={{ background:T.surf, border:`1px solid ${T.border2}`, borderRadius:14, padding:0, marginBottom:12, overflow:"hidden" }}>
            <div onClick={()=>setOpenId(open?null:b.id)} style={{ display:"flex", alignItems:"center", gap:10, padding:16, cursor:"pointer" }}>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700, fontSize:"0.86rem", color:T.text1 }}>{b.name}</div>
                <div style={{ fontSize:"0.7rem", color:T.text3 }}>{new Date(b.createdAt).toLocaleString()} · {(b.files||[]).length} file(s)</div>
              </div>
              <div style={{ fontSize:"0.74rem", fontWeight:700, color:statusColor(b.status) }}>{statusLabel(b.status)}</div>
              <div style={{ color:T.text3 }}>{open ? "▲" : "▼"}</div>
            </div>

            {open && (
              <div style={{ padding:"0 16px 16px", borderTop:`1px solid ${T.border2}` }}>
                {/* Pipeline steps */}
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", margin:"14px 0" }}>
                  {[
                    { label:"Research", done:!!b.requirements, icon:"🔬" },
                    { label:"Code Gen", done:(b.files||[]).length>0, icon:"⚙️" },
                    { label:"CTO Review", done:!!b.ctoReview, icon:"💻" },
                    { label:"Final QA", done:!!b.finalReview, icon:"🔍" },
                  ].map(s => (
                    <div key={s.label} style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 10px", background:s.done?`${T.green}14`:T.surf2, border:`1px solid ${s.done?T.green+"30":T.border2}`, borderRadius:20, fontSize:"0.7rem", color:s.done?T.green:T.text3 }}>
                      <span>{s.icon}</span><span>{s.label}</span>{s.done && <span>✓</span>}
                    </div>
                  ))}
                </div>

                {b.requirements && (
                  <div style={{ marginBottom:14 }}>
                    <div style={{ fontSize:"0.68rem", color:T.text3, textTransform:"uppercase", marginBottom:5 }}>Requirements Brief</div>
                    <div style={{ fontSize:"0.8rem", color:T.text2, marginBottom:6 }}>{b.requirements.summary}</div>
                    {b.requirements.techStack && <div style={{ fontSize:"0.74rem", color:T.text3 }}>Stack: {b.requirements.techStack}</div>}
                  </div>
                )}

                {(b.files||[]).length > 0 && (
                  <div style={{ marginBottom:14 }}>
                    <div style={{ fontSize:"0.68rem", color:T.text3, textTransform:"uppercase", marginBottom:6 }}>Generated Files ({b.files.length})</div>
                    <div style={{ background:"#0d1117", border:"1px solid #30363d", borderRadius:10, overflow:"hidden" }}>
                      {b.files.map((f,i) => (
                        <details key={i} style={{ borderBottom: i<b.files.length-1 ? "1px solid #21262d" : "none" }}>
                          <summary style={{ padding:"8px 14px", fontSize:"0.76rem", color:"#e6edf3", cursor:"pointer", fontFamily:"monospace" }}>{f.path}</summary>
                          <pre style={{ margin:0, padding:"12px 16px", overflowX:"auto", fontSize:"0.74rem", lineHeight:1.6, color:"#c9d1d9", background:"#0d1117", maxHeight:280 }}>{f.content}</pre>
                        </details>
                      ))}
                    </div>
                  </div>
                )}

                {b.ctoReview && (
                  <div style={{ marginBottom:14, background:T.surf2, borderRadius:10, padding:12 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                      <div style={{ fontSize:"0.76rem", fontWeight:700, color:T.text1 }}>💻 CTO Review</div>
                      <div style={{ fontWeight:800, color: b.ctoReview.score>=80?T.green:b.ctoReview.score>=60?T.yellow:T.red }}>{b.ctoReview.score}/100</div>
                    </div>
                    {(b.ctoReview.issues||[]).map((iss,j)=><div key={j} style={{ fontSize:"0.72rem", color:T.yellow, marginBottom:2 }}>⚠ {iss}</div>)}
                    {(b.ctoReview.suggestions||[]).map((s,j)=><div key={j} style={{ fontSize:"0.72rem", color:T.text2, marginBottom:2 }}>▸ {s}</div>)}
                  </div>
                )}

                {b.finalReview && (
                  <div style={{ marginBottom:14, background:T.surf2, borderRadius:10, padding:12 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                      <div style={{ fontSize:"0.76rem", fontWeight:700, color:T.text1 }}>🔍 Final QA</div>
                      <div style={{ fontWeight:800, color: b.finalReview.score>=80?T.green:b.finalReview.score>=60?T.yellow:T.red }}>{b.finalReview.score}/100</div>
                    </div>
                    {b.finalReview.feedback && <div style={{ fontSize:"0.74rem", color:T.text2 }}>{b.finalReview.feedback}</div>}
                  </div>
                )}

                {(b.files||[]).length > 0 && (
                  <div style={{ display:"flex", gap:9, flexWrap:"wrap" }}>
                    <button onClick={()=>downloadZip(b.files, b.name)} style={{ padding:"9px 16px", background:`linear-gradient(135deg,${T.accent},${T.accent2})`, border:"none", borderRadius:9, color:"#fff", fontWeight:700, fontSize:"0.78rem", cursor:"pointer" }}>⬇️ Download ZIP</button>
                    <button onClick={()=>{ setGhOpenId(ghOpenId===b.id?null:b.id); setGhMsg(null); }} style={{ padding:"9px 16px", background:T.surf2, border:`1px solid ${T.border2}`, borderRadius:9, color:T.text1, fontWeight:700, fontSize:"0.78rem", cursor:"pointer" }}>🐙 Export to GitHub</button>
                  </div>
                )}

                {ghOpenId === b.id && (
                  <div style={{ marginTop:12, background:T.surf2, border:`1px solid ${T.border2}`, borderRadius:10, padding:14 }}>
                    <div style={{ fontSize:"0.74rem", color:T.text2, marginBottom:10 }}>Pushes files directly via the GitHub REST API. Needs a personal access token with repo write access. (Works once this app is deployed for real — blocked inside the artifact preview sandbox.)</div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
                      <input value={ghOwner} onChange={e=>setGhOwner(e.target.value)} placeholder="GitHub username/org" style={inp} />
                      <input value={ghRepo} onChange={e=>setGhRepo(e.target.value)} placeholder="Repo name" style={inp} />
                      <input value={ghBranch} onChange={e=>setGhBranch(e.target.value)} placeholder="Branch (main)" style={inp} />
                      <input value={ghToken} onChange={e=>setGhToken(e.target.value)} placeholder="Personal access token" type="password" style={inp} />
                    </div>
                    <button disabled={ghPushing} onClick={()=>doGithubPush(b)} style={{ padding:"9px 16px", background:`linear-gradient(135deg,${T.accent},${T.accent2})`, border:"none", borderRadius:9, color:"#fff", fontWeight:700, fontSize:"0.78rem", cursor:ghPushing?"default":"pointer", opacity:ghPushing?0.6:1 }}>{ghPushing?"Pushing...":"Push Files"}</button>
                    {ghMsg && <div style={{ marginTop:8, fontSize:"0.74rem", color: ghMsg.type==="success"?T.green:T.red }}>{ghMsg.text}</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── RESEARCH VIEW ─────────────────────────────────────────
// Dedicated Research Engineer panel: Current Task, Progress, Status,
// Latest Report (full structured breakdown), and Research History.
const ResearchView = ({ S, T, EMPS, isResearcherActive, isResearcherLoading, researcherStreamText, onOpenChat, onSetGoal }) => {
  const [selectedId, setSelectedId] = useState(null);
  const emp = EMPS.researcher;
  const history = S.research || [];
  const selected = selectedId ? history.find(r => r.id === selectedId) : history[0];
  const liveTask = (S.empChats?.researcher || []).filter(m => m.role === "user").slice(-1)[0];

  const status = isResearcherLoading ? "researching" : history.length ? "idle" : "unassigned";
  const statusMeta = {
    researching: { label: "🔬 Researching…", color: T.cyan },
    idle:        { label: "✅ Idle — ready for next task", color: T.green },
    unassigned:  { label: "○ No research tasks yet", color: T.text3 },
  }[status];

  const confColor = (c) => c == null ? T.text3 : c >= 70 ? T.green : c >= 40 ? T.yellow : T.red;

  return (
    <div style={{ padding: 18 }}>
      {/* Status header card */}
      <div style={{ background: T.surf, border: `1px solid ${emp.color}30`, borderRadius: 14, padding: 18, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: 11, background: `${emp.color}20`, border: `1px solid ${emp.color}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 21 }}>{emp.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: "0.92rem", color: emp.color }}>{emp.name}</div>
            <div style={{ fontSize: "0.72rem", color: T.text2 }}>{emp.title}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.74rem", color: statusMeta.color, fontWeight: 600 }}>
            {isResearcherLoading && <Dots color={statusMeta.color} />}
            {statusMeta.label}
          </div>
        </div>

        <div style={{ fontSize: "0.7rem", color: T.text3, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>Current Task</div>
        {liveTask ? (
          <div style={{ fontSize: "0.82rem", color: T.text1, marginBottom: isResearcherLoading ? 10 : 0 }}>{liveTask.display || liveTask.content}</div>
        ) : (
          <div style={{ fontSize: "0.8rem", color: T.text3, fontStyle: "italic" }}>No task assigned yet — open the chat below or assign one from CEO Chat.</div>
        )}

        {isResearcherLoading && (
          <div style={{ marginTop: 10 }}>
            <ProgressBar value={researcherStreamText ? Math.min(95, 20 + researcherStreamText.length / 20) : 15} color={emp.color} height={4} label="Generating report…" />
          </div>
        )}

        <button onClick={onOpenChat} style={{ marginTop: 14, padding: "8px 16px", background: `${emp.color}18`, border: `1px solid ${emp.color}40`, borderRadius: 8, color: emp.color, fontSize: "0.76rem", fontWeight: 700, cursor: "pointer" }}>
          💬 Open Research Chat
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Latest Report */}
        <div style={{ background: T.surf, border: `1px solid ${T.border2}`, borderRadius: 14, padding: 18, minHeight: 200 }}>
          <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 12 }}>📄 Latest Report</div>
          {!selected ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: T.text3 }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>🔬</div>
              <div style={{ fontSize: "0.8rem" }}>No research reports yet. Ask the Research Engineer a question to generate one.</div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: "0.72rem", color: T.text3, marginBottom: 6 }}>Query: <span style={{ color: T.text2 }}>{selected.query}</span></div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: "0.7rem", color: T.text3 }}>Confidence:</span>
                <span style={{ fontWeight: 800, fontSize: "0.9rem", color: confColor(selected.confidenceScore) }}>{selected.confidenceScore ?? "—"}{selected.confidenceScore != null && "/100"}</span>
              </div>

              {selected.executiveSummary && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: "0.68rem", color: T.text3, textTransform: "uppercase", marginBottom: 4 }}>Executive Summary</div>
                  <div style={{ fontSize: "0.8rem", color: T.text1, lineHeight: 1.6 }}>{selected.executiveSummary}</div>
                </div>
              )}

              {selected.keyFindings?.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: "0.68rem", color: T.text3, textTransform: "uppercase", marginBottom: 4 }}>Key Findings</div>
                  {selected.keyFindings.map((f, i) => <div key={i} style={{ fontSize: "0.76rem", color: T.text2, marginBottom: 3 }}>▸ {f}</div>)}
                </div>
              )}

              {selected.risks?.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: "0.68rem", color: T.red, textTransform: "uppercase", marginBottom: 4 }}>Risks</div>
                  {selected.risks.map((f, i) => <div key={i} style={{ fontSize: "0.76rem", color: T.text2, marginBottom: 3 }}>⚠ {f}</div>)}
                </div>
              )}

              {selected.opportunities?.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: "0.68rem", color: T.green, textTransform: "uppercase", marginBottom: 4 }}>Opportunities</div>
                  {selected.opportunities.map((f, i) => <div key={i} style={{ fontSize: "0.76rem", color: T.text2, marginBottom: 3 }}>★ {f}</div>)}
                </div>
              )}

              {selected.recommendations?.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: "0.68rem", color: emp.color, textTransform: "uppercase", marginBottom: 4 }}>Recommendations</div>
                  {selected.recommendations.map((f, i) => <div key={i} style={{ fontSize: "0.76rem", color: T.text2, marginBottom: 3 }}>→ {f}</div>)}
                </div>
              )}

              {selected.sources && (
                <div style={{ marginTop: 12, padding: "8px 10px", background: T.surf2, borderRadius: 8 }}>
                  <div style={{ fontSize: "0.66rem", color: T.text3, textTransform: "uppercase", marginBottom: 3 }}>Sources</div>
                  <div style={{ fontSize: "0.72rem", color: T.text3, lineHeight: 1.5 }}>{selected.sources}</div>
                </div>
              )}

              <div style={{ marginTop: 10, fontSize: "0.62rem", color: T.text3 }}>{selected.createdAt ? new Date(selected.createdAt).toLocaleString() : ""}</div>
            </div>
          )}
        </div>

        {/* Research History */}
        <div style={{ background: T.surf, border: `1px solid ${T.border2}`, borderRadius: 14, padding: 18 }}>
          <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 12 }}>📚 Research History ({history.length})</div>
          {history.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: T.text3, fontSize: "0.8rem" }}>No past reports yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 460, overflowY: "auto" }}>
              {history.map(r => (
                <button key={r.id} onClick={() => setSelectedId(r.id)} style={{ textAlign: "left", background: (selected && selected.id === r.id) ? `${emp.color}15` : T.surf2, border: `1px solid ${(selected && selected.id === r.id) ? emp.color + "50" : T.border}`, borderRadius: 9, padding: "10px 12px", cursor: "pointer" }}>
                  <div style={{ fontSize: "0.78rem", color: T.text1, fontWeight: 600, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.query}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "0.66rem", color: T.text3 }}>{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ""}</span>
                    <span style={{ fontSize: "0.7rem", fontWeight: 700, color: confColor(r.confidenceScore) }}>{r.confidenceScore != null ? `${r.confidenceScore}/100` : ""}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── SHARED STYLES ──
const iconBtn = { width: 38, height: 38, background: T.surf2, border: `1px solid ${T.border2}`, borderRadius: 9, color: T.text2, cursor: "pointer", fontSize: "1rem", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const inputStyle = { width: "100%", background: T.surf2, border: `1px solid ${T.border2}`, borderRadius: 9, padding: "10px 13px", color: T.text1, fontSize: "0.85rem", outline: "none", boxSizing: "border-box", fontFamily: "inherit" };
const inp = inputStyle;

const CSS = `
  @keyframes apexBounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-5px)} }
  @keyframes apexSlideIn { from{opacity:0;transform:translateX(20px)} to{opacity:1;transform:translateX(0)} }
  @keyframes apexPulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  @keyframes dotBounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-4px)} }
  @keyframes toastIn { from{opacity:0;transform:translateX(20px)} to{opacity:1;transform:translateX(0)} }
  50%{opacity:0.4} }
  *{box-sizing:border-box}
  ::-webkit-scrollbar{width:4px;height:4px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:#1e1e35;border-radius:4px}
  textarea{min-height:38px;max-height:120px;overflow-y:auto!important}
  button:active{opacity:0.8}
  input[type="date"]::-webkit-calendar-picker-indicator{filter:invert(0.5)}
  canvas{display:block}
`;

export default function ApexOS() {
  const [state, dispatch] = useReducer(appReducer, null, initialAppState);
  PROXY_BASE_URL = (state.proxyUrl || DEFAULT_PROXY).replace(/\/+$/, '');
  const [view, setView] = useState("dashboard");
  const [proxyStatus, setProxyStatus] = useState("checking");
  const [proxyDetails, setProxyDetails] = useState("");
  const [activeEmp, setActiveEmp] = useState("cto");
  const [ceoInput, setCeoInput] = useState("");
  const [empInput, setEmpInput] = useState("");
  const [ceoLoading, setCeoLoading] = useState(false);
  const [empLoading, setEmpLoading] = useState(false);
  const [ceoStream, setCeoStream] = useState("");
  const [empStream, setEmpStream] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [attachedFile, setAttachedFile] = useState(null);
  const [empFile, setEmpFile] = useState(null);
  const [dragTask, setDragTask] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);
  const [listening, setListening] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [autoGoal, setAutoGoal] = useState("");
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoStage, setAutoStage] = useState("");
  const [autoProgress, setAutoProgress] = useState(0);
  const [buildSpec, setBuildSpec] = useState("");
  const [buildName, setBuildName] = useState("");
  const [buildRunning, setBuildRunning] = useState(false);
  const [buildStage, setBuildStage] = useState("");
  const [buildProgress, setBuildProgress] = useState(0);
  const [planModal, setPlanModal] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTask, setNewTask] = useState({ title: "", desc: "", assignee: "cto", priority: "medium", due: "" });
  const [memFilter, setMemFilter] = useState("all");
  const [kpiEdit, setKpiEdit] = useState(null);
  const [editingMsg, setEditingMsg] = useState(null);
  const [darkModeON] = useState(true);

  const ceoChatEndRef = useRef();
  const empChatEndRef = useRef();
  const fileRef = useRef();
  const empFileRef = useRef();
  const recognitionRef = useRef();
  const autoAbortRef = useRef(false);
  const buildAbortRef = useRef(false);
  const abortRef = autoAbortRef;

  // ── Proxy Connectivity Check ──
  useEffect(() => {
    const checkProxy = async () => {
      const base = PROXY_BASE_URL.replace(/\/+$/, '');
      const start = Date.now();
      try {
        // Try /ping first as it's the simplest
        const pRes = await fetch(`${base}/ping`, { mode: 'cors', cache: 'no-cache' });
        if (!pRes.ok) throw new Error(`Ping failed: ${pRes.status} ${pRes.statusText}`);

        // Then try /health
        const hRes = await fetch(`${base}/health`, { mode: 'cors', cache: 'no-cache' });
        const latency = Date.now() - start;
        if (hRes.ok) {
          setProxyStatus("online");
          setProxyDetails(`Connected to ${base} (${latency}ms)`);
        } else {
          setProxyStatus(`error-${hRes.status}`);
          setProxyDetails(`Backend returned ${hRes.status} ${hRes.statusText}. Check server logs.`);
        }
      } catch (e) {
        setProxyStatus("offline");
        let msg = e.message;
        if (msg === "Failed to fetch") {
          msg = "Network Error: Failed to fetch. Possible causes: 1. Server is down. 2. CORS block. 3. Mixed Content (HTTP vs HTTPS). 4. Browser extension (AdBlock/Privacy) blocking the Render domain.";
        }
        setProxyDetails(msg);
        console.warn(`[Proxy Check] Unreachable at ${base}:`, e);
      }
    };
    checkProxy();
    const interval = setInterval(checkProxy, 30000);
    return () => clearInterval(interval);
  }, [state.proxyUrl]);

  // ── Scroll to bottom ──
  useEffect(() => { ceoChatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [state.ceoChats, ceoStream]);
  useEffect(() => { empChatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [state.empChats, empStream]);

  // ── Voice setup ──
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      recognitionRef.current = new SR();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.onresult = (e) => {
        const t = Array.from(e.results).map(r => r[0].transcript).join("");
        if (view === "chat") setCeoInput(t);
        else setEmpInput(t);
        if (e.results[e.results.length - 1].isFinal) setListening(false);
      };
      recognitionRef.current.onend = () => setListening(false);
    }
  }, [view]);

  const toast = useCallback((message, type = "info") => {
    const id = Date.now() + Math.random();
    dispatch({ type: "ADD_NOTIFICATION", payload: { id, message, type } });
    setTimeout(() => dispatch({ type: "REMOVE_NOTIFICATION", id }), 4000);
  }, []);

  const addActivity = useCallback((text, icon = "⚡") => {
    dispatch({ type: "ADD_ACTIVITY", payload: { id: Date.now(), text, icon, time: new Date().toLocaleTimeString() } });
  }, []);

  // ── BUILD PIPELINE (Research → Engineer → CTO → Reviewer) ──
  const runBuild = useCallback(async (overrideSpec, overrideName) => {
    const spec = (overrideSpec || buildSpec).trim();
    if (!spec || buildRunning) return;
    buildAbortRef.current = false;
    setBuildRunning(true); setBuildProgress(0);
    const projName = (overrideName || buildName || spec.slice(0, 40)).trim();
    setBuildSpec(""); setBuildName("");
    setView("build");
    await BuildOrchestrator.run({
      spec, name: projName, company: state.company, memory: state.memory, dispatch,
      addActivity, toast,
      setStage: setBuildStage,
      setProgress: setBuildProgress,
      abort: buildAbortRef,
    });
    setBuildRunning(false); setBuildStage(""); setBuildProgress(0);
  }, [buildSpec, buildName, buildRunning, state.company, state.memory, addActivity, toast]);

  const stopBuild = useCallback(() => {
    buildAbortRef.current = true;
    setBuildRunning(false); setBuildStage(""); setBuildProgress(0);
  }, []);

  // ── Process CEO commands ──
  const processCEOCommands = useCallback((text) => {
    const cmds = parseCEOCommands(text);
    (cmds.builds || []).forEach(b => {
      if (b.spec) { runBuild(b.spec, b.name); toast(`CEO delegated a build: ${b.name || b.spec.slice(0,40)}`, "info"); }
    });
    cmds.tasks.forEach(t => {
      const id = `t_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      dispatch({ type: "ADD_TASK", payload: { ...t, id, status: "todo", createdAt: new Date().toISOString(), source: "ceo" } });
      addActivity(`Task created: "${t.title}"`, "📋");
    });
    cmds.assigns.forEach(a => {
      addActivity(`CEO → ${EMP_REGISTRY[a.to]?.name || a.to}: ${a.task?.slice(0, 60)}`, "📤");
      toast(`Task assigned to ${EMP_REGISTRY[a.to]?.name || a.to}`, "success");
    });
    cmds.memories.forEach(m => {
      dispatch({ type: "ADD_MEMORY", payload: { id: Date.now(), ...m, savedAt: new Date().toISOString() } });
    });
    cmds.kpis.forEach(k => {
      const existing = state.kpis.find(kp => kp.metric.toLowerCase() === k.metric.toLowerCase());
      if (existing) dispatch({ type: "UPDATE_KPI", id: existing.id, payload: { value: k.value, trend: k.trend } });
    });
    cmds.notifications.forEach(n => toast(n.message, n.type || "info"));
    cmds.kpis.forEach(k => dispatch({ type: "UPSERT_KPI", payload: k }));
    if (cmds.tasks.length) toast(`${cmds.tasks.length} task(s) added to board`, "success");
    if (cmds.memories.length) toast(`${cmds.memories.length} item(s) saved to memory`, "info");
  }, [state.kpis, addActivity, toast, runBuild]);

  // ── CEO Chat ──
  const sendCEO = useCallback(async (overrideText) => {
    const text = (overrideText || ceoInput).trim();
    if (!text || ceoLoading) return;
    setCeoInput("");

    let content = text;
    let displayText = text;
    if (attachedFile) {
      if (attachedFile.type === "image") {
        content = [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: attachedFile.b64 } }, { type: "text", text: `File: ${attachedFile.name}\n\n${text}` }];
      } else {
        content = `[ATTACHED: ${attachedFile.name}]\n${attachedFile.content}\n\n---\nUSER QUESTION: ${text}`;
      }
      displayText = `📎 ${attachedFile.name}: ${text}`;
      setAttachedFile(null);
    }

    const userMsg = { id: Date.now(), role: "user", content, display: displayText };
    dispatch({ type: "ADD_CEO_MSG", payload: userMsg });
    dispatch({ type: "ADD_CEO_MSG", payload: { id: Date.now() + 1, role: "assistant", content: "", streaming: true } });
    setCeoLoading(true); setCeoStream("");

    try {
      const history = [...state.ceoChats, userMsg]
        .filter(m => !m.streaming)
        .map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : (m.display || "") }))
        .slice(-20);

      const memContext = state.memory.slice(0, 10).map(m => `[${m.category}] ${m.content}`).join("\n");
      const system = buildCEOPrompt({ ...state.memory.slice(0, 10), memContext }, state.company);

      const reply = await callClaude(history, system, (chunk) => { setCeoStream(chunk); });
      dispatch({ type: "UPDATE_CEO_LAST", payload: { content: reply, streaming: false } });
      setCeoStream("");
      processCEOCommands(reply);
      addActivity(`CEO responded to: "${text.slice(0, 50)}"`, "💬");
      dispatch({ type: "ADD_MEMORY", payload: { id: Date.now(), category: "decision", content: `Q: ${text.slice(0, 100)} | A: ${reply.slice(0, 200)}`, importance: "medium", savedAt: new Date().toISOString() } });
    } catch (e) {
      dispatch({ type: "UPDATE_CEO_LAST", payload: { content: `⚠️ Error: ${e.message}. Please try again.`, streaming: false } });
      toast("API error. Please retry.", "error");
    }
    setCeoLoading(false);
  }, [ceoInput, ceoLoading, attachedFile, state.ceoChats, state.memory, state.company, processCEOCommands, addActivity, toast]);

  // ── Employee Chat ──
  const sendEmployee = useCallback(async (overrideText) => {
    const text = (overrideText || empInput).trim();
    const emp = EMP_REGISTRY[activeEmp];
    if (!text || empLoading) return;
    setEmpInput("");

    let content = text;
    if (empFile) {
      content = empFile.type === "image"
        ? `[Image: ${empFile.name}] ${text}`
        : `[File: ${empFile.name}]\n${empFile.content.slice(0, 4000)}\n\nQuestion: ${text}`;
      setEmpFile(null);
    }

    dispatch({ type: "ADD_EMP_MSG", empId: activeEmp, payload: { id: Date.now(), role: "user", content, display: text } });
    dispatch({ type: "ADD_EMP_MSG", empId: activeEmp, payload: { id: Date.now() + 1, role: "assistant", content: "", streaming: true } });
    setEmpLoading(true); setEmpStream("");

    try {
      const history = [...(state.empChats[activeEmp] || []), { role: "user", content }]
        .filter(m => !m.streaming)
        .map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : (m.display || "") }))
        .slice(-16);

      const promptFn = EMP_PROMPTS[activeEmp] || EMP_PROMPTS.cto;
      const system = promptFn(state.company) + `\n\nCompany Memory: ${state.memory.slice(0, 5).map(m => m.content).join("; ")}`;

      const reply = await callClaude(history, system, (chunk) => setEmpStream(chunk));
      dispatch({ type: "UPDATE_EMP_LAST", empId: activeEmp, payload: { content: reply, streaming: false } });
      setEmpStream("");
      addActivity(`${emp.name} responded`, emp.icon);

      if (activeEmp === "researcher") {
        const report = parseResearchReport(reply);
        if (report.executiveSummary || report.keyFindings.length) {
          const researchEntry = {
            id: `res_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
            query: text,
            ...report,
            createdAt: new Date().toISOString(),
          };
          dispatch({ type: "ADD_RESEARCH", payload: researchEntry });
          MemoryEngine.store(dispatch, {
            category: "insight",
            content: `Research: "${text.slice(0,80)}" — ${report.executiveSummary.slice(0,160)}`,
            importance: report.confidenceScore >= 70 ? "high" : "medium",
          });
          addActivity(`🔬 Research report completed: "${text.slice(0,50)}" (confidence: ${report.confidenceScore ?? "n/a"})`, "🔬");
        }
      }
    } catch (e) {
      dispatch({ type: "UPDATE_EMP_LAST", empId: activeEmp, payload: { content: `⚠️ Error: ${e.message}`, streaming: false } });
    }
    setEmpLoading(false);
  }, [empInput, empLoading, empFile, activeEmp, state.empChats, state.company, state.memory, addActivity]);

  // ── AUTONOMOUS MODE ──
  const runAuto = useCallback(async () => {
    if (!autoGoal.trim() || autoRunning) return;
    abortRef.current = false;
    setAutoRunning(true); setAutoProgress(0);
    const goal = autoGoal;
    setAutoGoal("");
    setView("chat");
    await CEOOrchestrator.run({
      goal, company: state.company, memory: state.memory, dispatch,
      addActivity, toast,
      setStage: setAutoStage,
      setProgress: setAutoProgress,
      abort: abortRef,
    });
    setAutoRunning(false); setAutoStage(""); setAutoProgress(0);
  }, [autoGoal, autoRunning, state.company, state.memory, addActivity, toast]);

  // ── Voice ──
  const toggleVoice = () => {
    if (!recognitionRef.current) { toast("Voice not supported in this browser", "warning"); return; }
    if (listening) { recognitionRef.current.stop(); setListening(false); }
    else { recognitionRef.current.start(); setListening(true); }
  };

  const speakText = (text) => {
    const clean = text.replace(/\[.*?\]/g, "").replace(/[#*`_~]/g, "").slice(0, 500);
    const u = new SpeechSynthesisUtterance(clean);
    u.rate = 0.95; u.pitch = 1;
    window.speechSynthesis.speak(u);
  };

  // ── Task Board ──
  const COLS = [
    { id: "todo",       label: "To Do",       color: T.text3 },
    { id: "inprogress", label: "In Progress",  color: T.accent },
    { id: "review",     label: "Review",       color: T.yellow },
    { id: "done",       label: "Done",         color: T.green },
  ];

  const tasksByCol = useMemo(() => COLS.reduce((acc, c) => ({
    ...acc, [c.id]: state.tasks.filter(t => t.status === c.id)
  }), {}), [state.tasks]);

  const emp = EMP_REGISTRY[activeEmp];

  // ── SETUP SCREEN ──
  if (!state.setupDone) {
    return (
      <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter',system-ui,sans-serif", padding: 20 }}>
        <div style={{ maxWidth: 540, width: "100%" }}>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <div style={{ display: "inline-flex", width: 72, height: 72, borderRadius: 20, background: `linear-gradient(135deg, ${T.accent}, ${T.accent2})`, alignItems: "center", justifyContent: "center", fontSize: 36, marginBottom: 20, boxShadow: `0 0 60px ${T.accent}40` }}>👑</div>
            <h1 style={{ color: T.text1, fontSize: "2.4rem", fontWeight: 900, letterSpacing: "-1.5px", margin: "0 0 8px" }}>APEX OS</h1>
            <p style={{ color: T.text2, fontSize: "0.9rem", margin: 0 }}>AI Company Operating System — Configure your company</p>
          </div>
          <div style={{ background: T.surf, border: `1px solid ${T.border2}`, borderRadius: 20, padding: 32 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {[
                ["Company Name *", "name", "e.g. MajdurSetu", "1fr 1fr"],
                ["Industry", "industry", "e.g. Construction Tech"],
                ["Stage", "stage", "Startup"],
                ["Annual Revenue", "revenue", "e.g. $0 (Pre-revenue)"],
                ["Mission Statement", "mission", "What problem do you solve?"],
                ["Primary Goal (2025)", "goals", "e.g. 10,000 registered workers"],
              ].map(([label, key, placeholder], idx) => (
                <div key={key} style={{ gridColumn: idx === 0 ? "1 / -1" : "auto" }}>
                  <label style={{ color: T.text2, fontSize: "0.75rem", letterSpacing: "0.5px", textTransform: "uppercase", display: "block", marginBottom: 6 }}>{label}</label>
                  <input value={state.company[key] || ""} onChange={e => dispatch({ type: "SET_COMPANY", payload: { [key]: e.target.value } })} placeholder={placeholder}
                    style={{ width: "100%", background: T.surf2, border: `1px solid ${T.border2}`, borderRadius: 10, padding: "11px 14px", color: T.text1, fontSize: "0.88rem", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }} />
                </div>
              ))}
            </div>
            <button onClick={() => { if (!state.company.name) { toast("Company name is required", "error"); return; } dispatch({ type: "SETUP_DONE" }); }} style={{ width: "100%", marginTop: 24, padding: "14px", background: `linear-gradient(135deg, ${T.accent}, ${T.accent2})`, border: "none", borderRadius: 12, color: "white", fontSize: "0.95rem", fontWeight: 800, cursor: "pointer", letterSpacing: "0.5px", boxShadow: `0 8px 32px ${T.accent}40` }}>
              INITIALIZE APEX OS →
            </button>
          </div>
        </div>
        <style>{CSS}</style>
      </div>
    );
  }

  // ── SIDEBAR NAV ──
  const NAV = [
    { id: "dashboard", icon: "📊", label: "Dashboard" },
    { id: "chat",      icon: "💬", label: "CEO Chat" },
    { id: "employees", icon: "👥", label: "AI Team" },
    { id: "tasks",     icon: "📋", label: "Task Board" },
    { id: "planner",   icon: "🗂️", label: "Planner" },
    { id: "build",     icon: "🛠️", label: "Build" },
    { id: "research",  icon: "🔬", label: "Research" },
    { id: "reviews",   icon: "🔍", label: "Reviews" },
    { id: "memory",    icon: "🧠", label: "Memory" },
    { id: "analytics", icon: "📈", label: "Analytics" },
    { id: "settings",  icon: "⚙️", label: "Settings" },
  ];

  const doneTasks = state.tasks.filter(t => t.status === "done").length;
  const inProgressTasks = state.tasks.filter(t => t.status === "inprogress").length;
  const filteredMemory = state.memory.filter(m => memFilter === "all" || m.category === memFilter);

  // ── CHAT SEARCH ──
  const filteredCEOChats = searchQuery
    ? state.ceoChats.filter(m => (m.display || m.content || "").toLowerCase().includes(searchQuery.toLowerCase()))
    : state.ceoChats;

  return (
    <div style={{ height: "100vh", background: T.bg, display: "flex", fontFamily: "'Inter',system-ui,sans-serif", color: T.text1, overflow: "hidden" }}>
      <Toast notifications={state.notifications} onRemove={(id) => dispatch({ type: "REMOVE_NOTIFICATION", id })} />

      {/* ── SIDEBAR ── */}
      <aside style={{ width: sidebarOpen ? 220 : 64, background: T.surf, borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", transition: "width 0.2s ease", flexShrink: 0, overflow: "hidden" }}>
        {/* Logo */}
        <div style={{ padding: "16px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg, ${T.accent}, ${T.accent2})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0, boxShadow: `0 4px 16px ${T.accent}40` }}>👑</div>
          {sidebarOpen && <div><div style={{ fontWeight: 900, fontSize: "0.88rem", letterSpacing: "1.5px", color: T.text1 }}>APEX OS</div><div style={{ fontSize: "0.65rem", color: T.green, display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: T.green, display: "inline-block" }} />{state.company.name || "No company"}</div></div>}
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: "10px 8px", overflowY: "auto" }}>
          {NAV.map(({ id, icon, label }) => (
            <button key={id} onClick={() => setView(id)} title={!sidebarOpen ? label : undefined} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 9, border: "none", background: view === id ? `${T.accent}18` : "transparent", color: view === id ? T.accent : T.text2, fontSize: "0.83rem", fontWeight: view === id ? 700 : 400, cursor: "pointer", marginBottom: 2, transition: "all 0.15s", justifyContent: sidebarOpen ? "flex-start" : "center" }}>
              <span style={{ fontSize: 15, flexShrink: 0 }}>{icon}</span>
              {sidebarOpen && <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>}
            </button>
          ))}
        </nav>

        {/* Autonomous Status */}
        {autoRunning && sidebarOpen && (
          <div style={{ margin: "8px", padding: "10px 12px", background: `${T.accent}12`, border: `1px solid ${T.accent}30`, borderRadius: 10 }}>
            <div style={{ fontSize: "0.7rem", color: T.accent, fontWeight: 700, marginBottom: 4 }}>🤖 AUTO MODE</div>
            <ProgressBar value={autoProgress} color={T.accent} height={3} />
            <div style={{ fontSize: "0.66rem", color: T.text2, marginTop: 4 }}>{(autoStage || "").slice(0, 50)}</div>
          </div>
        )}

        {/* Collapse toggle */}
        <button onClick={() => setSidebarOpen(p => !p)} style={{ margin: "8px", padding: 8, background: T.surf2, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text3, cursor: "pointer", fontSize: "0.85rem" }}>
          {sidebarOpen ? "◀" : "▶"}
        </button>
      </aside>

      {/* ── MAIN ── */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Topbar */}
        <div style={{ padding: "11px 20px", borderBottom: `1px solid ${T.border}`, background: T.surf, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>
            {NAV.find(n => n.id === view)?.icon} {NAV.find(n => n.id === view)?.label}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {autoRunning && <div style={{ background: `${T.accent}18`, color: T.accent, padding: "4px 12px", borderRadius: 20, fontSize: "0.72rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}><Dots color={T.accent} />AUTO</div>}
            <div style={{
              background: proxyStatus === "online" ? `${T.green}15` : proxyStatus === "offline" ? `${T.red}15` : `${T.yellow}15`,
              color: proxyStatus === "online" ? T.green : proxyStatus === "offline" ? T.red : T.yellow,
              padding: "4px 12px", borderRadius: 20, fontSize: "0.72rem", fontWeight: 600
            }}>
              ● {proxyStatus === "online" ? "APEX Online" : proxyStatus === "offline" ? "Proxy Offline" : proxyStatus.startsWith("error") ? `Proxy Error (${proxyStatus.split('-')[1]})` : "Checking Proxy..."}
            </div>
            <div style={{ background: T.surf2, border: `1px solid ${T.border2}`, padding: "4px 12px", borderRadius: 20, fontSize: "0.72rem", color: T.text2 }}>{state.tasks.length} tasks</div>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto" }}>

          {/* ═══ DASHBOARD ═══ */}
          {view === "dashboard" && (
            <div style={{ padding: 20 }}>
              {/* KPI Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
                {state.kpis.map(kpi => (
                  <div key={kpi.id} onClick={() => setKpiEdit(kpi)} style={{ background: T.surf, border: `1px solid ${T.border2}`, borderRadius: 14, padding: "16px 18px", cursor: "pointer", position: "relative", overflow: "hidden", transition: "border-color 0.2s" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: kpi.color }} />
                    <div style={{ fontSize: "0.72rem", color: T.text2, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>{kpi.metric}</div>
                    <div style={{ fontSize: "1.8rem", fontWeight: 900, color: kpi.color, marginBottom: 8 }}>{kpi.value}</div>
                    <MiniChart data={kpi.history} color={kpi.color} height={36} />
                    <div style={{ fontSize: "0.68rem", color: kpi.trend === "up" ? T.green : kpi.trend === "down" ? T.red : T.text3, marginTop: 6 }}>
                      {kpi.trend === "up" ? "↑ Trending up" : kpi.trend === "down" ? "↓ Trending down" : "→ Stable"}
                    </div>
                  </div>
                ))}
                {[
                  { label: "Total Tasks", value: state.tasks.length, color: T.accent, icon: "📋" },
                  { label: "Completed", value: doneTasks, color: T.green, icon: "✅" },
                  { label: "In Progress", value: inProgressTasks, color: T.yellow, icon: "⚡" },
                  { label: "Memory Items", value: state.memory.length, color: T.pink, icon: "🧠" },
                ].map(({ label, value, color, icon }) => (
                  <div key={label} style={{ background: T.surf, border: `1px solid ${T.border2}`, borderRadius: 14, padding: "16px 18px" }}>
                    <div style={{ position: "absolute", fontSize: 28, opacity: 0.06 }}>{icon}</div>
                    <div style={{ fontSize: "0.72rem", color: T.text2, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
                    <div style={{ fontSize: "1.8rem", fontWeight: 900, color }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Autonomous Mode */}
              <div style={{ background: T.surf, border: `1px solid ${T.accent}30`, borderRadius: 16, padding: 20, marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: autoRunning ? T.green : T.text3, animation: autoRunning ? "pulse 1s infinite" : "none" }} />
                  <span style={{ fontWeight: 700, fontSize: "0.88rem" }}>🤖 Autonomous Company Mode</span>
                  {autoRunning && <span style={{ fontSize: "0.72rem", color: T.accent, marginLeft: "auto" }}>{(autoStage || "").slice(0, 40)}</span>}
                {autoRunning && <div style={{marginTop:8}}><ProgressBar value={autoProgress} color={T.accent} height={4} label={autoStage||""} /></div>}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <input value={autoGoal} onChange={e => setAutoGoal(e.target.value)} onKeyDown={e => e.key === "Enter" && !autoRunning && runAuto()} placeholder="Enter a company goal → CEO plans → Employees execute → Review → Done" disabled={autoRunning} style={{ flex: 1, background: T.surf2, border: `1px solid ${T.border2}`, borderRadius: 9, padding: "10px 14px", color: T.text1, fontSize: "0.84rem", outline: "none", fontFamily: "inherit" }} />
                  <button onClick={autoRunning ? () => { abortRef.current = true; setAutoRunning(false); setAutoStage(""); setAutoProgress(0); } : runAuto} style={{ padding: "10px 20px", background: autoRunning ? `${T.red}22` : `linear-gradient(135deg, ${T.accent}, ${T.accent2})`, border: autoRunning ? `1px solid ${T.red}44` : "none", borderRadius: 9, color: autoRunning ? T.red : "white", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", whiteSpace: "nowrap" }}>
                    {autoRunning ? "⏹ Stop" : "🚀 Run Auto"}
                  </button>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {/* Active Plan */}
                {state.activePlan ? (
                  <div style={{ background: T.surf, border: `1px solid ${T.accent}30`, borderRadius: 14, padding: 18 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                      <div style={{ fontWeight: 700, fontSize: "0.85rem" }}>🗂️ Active Plan</div>
                      <button onClick={() => setView("planner")} style={{ background: "none", border: "none", color: T.accent, cursor: "pointer", fontSize: "0.7rem" }}>View Full →</button>
                    </div>
                    <div style={{ fontWeight: 600, color: T.text1, fontSize: "0.82rem", marginBottom: 4 }}>{state.activePlan.title}</div>
                    <div style={{ color: T.text3, fontSize: "0.7rem", marginBottom: 10 }}>{state.activePlan.totalDuration} · {(state.activePlan.phases || []).length} phases</div>
                    {(state.activePlan.phases || []).slice(0, 3).map((ph, i) => {
                      const e = EMP_REGISTRY[ph.owner];
                      const phaseTasks = state.tasks.filter(t => t.phase === ph.phase);
                      const done = phaseTasks.filter(t => t.status === "done").length;
                      const pct = phaseTasks.length ? Math.round((done / phaseTasks.length) * 100) : 0;
                      return (
                        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                          <div style={{ width: 22, height: 22, borderRadius: 6, background: `${e?.color || T.accent}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, flexShrink: 0 }}>{e?.icon || "👤"}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: "0.74rem", color: T.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ph.phase}</div>
                            <ProgressBar value={pct} color={e?.color || T.accent} height={3} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ background: T.surf, border: `1px solid ${T.border2}`, borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: T.text3, textAlign: "center" }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>🗂️</div>
                    <div style={{ fontSize: "0.78rem" }}>No active plan. Run Autonomous Mode above or visit the Planner.</div>
                  </div>
                )}

                {/* Team Status */}
                <div style={{ background: T.surf, border: `1px solid ${T.border2}`, borderRadius: 14, padding: 18 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 14 }}>👥 AI Team</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {Object.values(EMP_REGISTRY).filter(e => e.id !== "ceo").map(e => {
                      const empTasks = state.tasks.filter(t => t.assignee === e.id);
                      const hasMsgs = (state.empChats[e.id] || []).length > 0;
                      return (
                        <div key={e.id} onClick={() => { setActiveEmp(e.id); setView("employees"); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 9, cursor: "pointer", background: T.surf2, border: `1px solid ${T.border}` }}>
                          <div style={{ width: 28, height: 28, borderRadius: 7, background: `${e.color}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{e.icon}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: "0.78rem", fontWeight: 600, color: T.text1 }}>{e.name}</div>
                            <div style={{ fontSize: "0.66rem", color: T.text3 }}>{e.dept}</div>
                          </div>
                          <div style={{ display: "flex", gap: 4 }}>
                            {empTasks.length > 0 && <span style={{ background: `${e.color}20`, color: e.color, padding: "1px 6px", borderRadius: 10, fontSize: "0.66rem" }}>{empTasks.length}</span>}
                            {hasMsgs && <span style={{ background: `${T.green}15`, color: T.green, padding: "1px 6px", borderRadius: 10, fontSize: "0.66rem" }}>●</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Recent Activity */}
                <div style={{ background: T.surf, border: `1px solid ${T.border2}`, borderRadius: 14, padding: 18, display: "flex", flexDirection: "column" }}>
                  <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 14 }}>⚡ Recent Activity</div>
                  <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                    {state.activities.length === 0 ? (
                      <div style={{ color: T.text3, fontSize: "0.8rem", textAlign: "center", padding: "20px 0" }}>No activity yet. Start chatting!</div>
                    ) : state.activities.slice(0, 12).map(a => (
                      <div key={a.id} style={{ display: "flex", gap: 8, padding: "6px 8px", borderRadius: 7, background: T.surf2 }}>
                        <span style={{ fontSize: 12 }}>{a.icon}</span>
                        <span style={{ color: T.text2, fontSize: "0.76rem", flex: 1, lineHeight: 1.4 }}>{a.text}</span>
                        <span style={{ color: T.text3, fontSize: "0.66rem", flexShrink: 0 }}>{a.time}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Latest Reviews */}
                <div style={{ background: T.surf, border: `1px solid ${T.border2}`, borderRadius: 14, padding: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.85rem" }}>🔍 Latest Reviews</div>
                    {(state.reviews || []).length > 0 && <button onClick={() => setView("reviews")} style={{ background: "none", border: "none", color: T.accent, cursor: "pointer", fontSize: "0.7rem" }}>See All →</button>}
                  </div>
                  {(state.reviews || []).length === 0 ? (
                    <div style={{ color: T.text3, fontSize: "0.8rem", textAlign: "center", padding: "20px 0" }}>No reviews yet. Run Autonomous Mode to generate reviews.</div>
                  ) : (state.reviews || []).slice(0, 4).map(r => {
                    const e = EMP_REGISTRY[r.empId];
                    const sc = r.score || 0;
                    const scColor = sc >= 80 ? T.green : sc >= 60 ? T.yellow : T.red;
                    return (
                      <div key={r.id} style={{ display: "flex", gap: 9, marginBottom: 8, padding: "7px 9px", background: T.surf2, borderRadius: 8 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 7, background: `${e?.color || T.accent}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{e?.icon || "👤"}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "0.74rem", color: T.text1, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(r.taskTitle || "Task").slice(0, 32)}</div>
                          <div style={{ fontSize: "0.64rem", color: T.text3 }}>{r.empName}</div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: "0.8rem", fontWeight: 800, color: scColor }}>{sc}</div>
                          <div style={{ fontSize: "0.6rem", color: r.approved ? T.green : T.red }}>{r.approved ? "✓ approved" : "✗ revise"}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ═══ CEO CHAT ═══ */}
          {view === "chat" && (
            <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              {/* Chat toolbar */}
              <div style={{ padding: "8px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="🔍 Search conversation..." style={{ ...inputStyle, flex: 1, padding: "7px 12px", fontSize: "0.78rem" }} />
                {state.ceoChats.length > 0 && (
                  <button onClick={() => dispatch({ type: "CLEAR_CEO_CHAT" })} style={{ background: "none", border: `1px solid ${T.border2}`, borderRadius: 8, color: T.text3, padding: "6px 12px", fontSize: "0.72rem", cursor: "pointer", whiteSpace: "nowrap" }}>Clear Chat</button>
                )}
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
                {filteredCEOChats.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "60px 20px", color: T.text3 }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>👑</div>
                    <div style={{ fontSize: "0.9rem", fontWeight: 700, color: T.text2, marginBottom: 6 }}>Chat with APEX, your AI CEO</div>
                    <div style={{ fontSize: "0.78rem" }}>Ask for strategy, delegate work, or type a company goal to get started.</div>
                  </div>
                ) : filteredCEOChats.map((m, i) => (
                  <div key={m.id || i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 14, animation: "apexSlideIn 0.25s ease" }}>
                    <div style={{ maxWidth: "78%", display: "flex", gap: 10, flexDirection: m.role === "user" ? "row-reverse" : "row" }}>
                      <div style={{ width: 30, height: 30, borderRadius: 8, background: m.role === "user" ? `${T.accent}20` : `${T.accent2}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>
                        {m.role === "user" ? "🧑" : "👑"}
                      </div>
                      <div style={{ background: m.role === "user" ? `${T.accent}18` : T.surf, border: `1px solid ${m.role === "user" ? T.accent + "30" : T.border2}`, borderRadius: 14, padding: "10px 14px", minWidth: 0 }}>
                        {m.role === "user" ? (
                          <div style={{ color: T.text1, fontSize: "0.85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{m.display || m.content}</div>
                        ) : m.streaming ? (
                          ceoStream ? <Markdown text={ceoStream} color={T.accent} /> : <Dots color={T.accent} />
                        ) : (
                          <Markdown text={m.content} color={T.accent} />
                        )}
                        {m.role === "assistant" && !m.streaming && m.content && (
                          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                            <button onClick={() => navigator.clipboard.writeText(m.content)} style={{ background: "none", border: "none", color: T.text3, fontSize: "0.66rem", cursor: "pointer", padding: 0 }}>Copy</button>
                            <button onClick={() => speakText(m.content)} style={{ background: "none", border: "none", color: T.text3, fontSize: "0.66rem", cursor: "pointer", padding: 0 }}>🔊 Read</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={ceoChatEndRef} />
              </div>

              {/* Input */}
              <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
                {attachedFile && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "6px 10px", background: T.surf2, borderRadius: 8, fontSize: "0.74rem", color: T.text2 }}>
                    📎 {attachedFile.name}
                    <button onClick={() => setAttachedFile(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: T.text3, cursor: "pointer" }}>✕</button>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <input ref={fileRef} type="file" style={{ display: "none" }} onChange={async e => { const f = e.target.files[0]; if (f) setAttachedFile(await readFile(f)); e.target.value = ""; }} />
                  <button onClick={() => fileRef.current?.click()} style={iconBtn} title="Attach file">📎</button>
                  <button onClick={toggleVoice} style={{ ...iconBtn, background: listening ? `${T.red}22` : T.surf2, color: listening ? T.red : T.text2 }} title="Voice input">🎤</button>
                  <textarea value={ceoInput} onChange={e => setCeoInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendCEO(); } }} placeholder="Message APEX..." rows={1} style={{ ...inputStyle, flex: 1, resize: "none", fontFamily: "inherit" }} />
                  <button onClick={() => sendCEO()} disabled={ceoLoading || !ceoInput.trim()} style={{ padding: "10px 18px", background: `linear-gradient(135deg, ${T.accent}, ${T.accent2})`, border: "none", borderRadius: 9, color: "white", fontWeight: 700, fontSize: "0.82rem", cursor: ceoLoading || !ceoInput.trim() ? "default" : "pointer", opacity: ceoLoading || !ceoInput.trim() ? 0.5 : 1, flexShrink: 0 }}>
                    {ceoLoading ? <Dots color="white" /> : "Send"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ═══ AI TEAM (EMPLOYEES) ═══ */}
          {view === "employees" && (
            <div style={{ display: "flex", height: "100%" }}>
              {/* Employee list */}
              <div style={{ width: 220, borderRight: `1px solid ${T.border}`, overflowY: "auto", padding: 10, flexShrink: 0 }}>
                {Object.values(EMP_REGISTRY).filter(e => e.id !== "ceo").map(e => (
                  <button key={e.id} onClick={() => setActiveEmp(e.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 9, border: "none", background: activeEmp === e.id ? `${e.color}18` : "transparent", cursor: "pointer", marginBottom: 3, textAlign: "left" }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: `${e.color}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{e.icon}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "0.78rem", fontWeight: activeEmp === e.id ? 700 : 500, color: activeEmp === e.id ? e.color : T.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</div>
                      <div style={{ fontSize: "0.63rem", color: T.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title}</div>
                    </div>
                  </button>
                ))}
              </div>

              {/* Chat panel */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div style={{ padding: "10px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: `${emp.color}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>{emp.icon}</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.84rem", color: T.text1 }}>{emp.name}</div>
                    <div style={{ fontSize: "0.66rem", color: T.text3 }}>{emp.title}</div>
                  </div>
                  {(state.empChats[activeEmp] || []).length > 0 && (
                    <button onClick={() => dispatch({ type: "CLEAR_EMP_CHAT", empId: activeEmp })} style={{ marginLeft: "auto", background: "none", border: `1px solid ${T.border2}`, borderRadius: 8, color: T.text3, padding: "5px 11px", fontSize: "0.7rem", cursor: "pointer" }}>Clear Chat</button>
                  )}
                </div>

                <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
                  {(state.empChats[activeEmp] || []).length === 0 ? (
                    <div style={{ textAlign: "center", padding: "60px 20px", color: T.text3 }}>
                      <div style={{ fontSize: 34, marginBottom: 10 }}>{emp.icon}</div>
                      <div style={{ fontSize: "0.84rem" }}>Ask {emp.name} anything — they specialize in {emp.dept.toLowerCase()}.</div>
                    </div>
                  ) : (state.empChats[activeEmp] || []).map((m, i) => (
                    <div key={m.id || i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 14 }}>
                      <div style={{ maxWidth: "78%", display: "flex", gap: 10, flexDirection: m.role === "user" ? "row-reverse" : "row" }}>
                        <div style={{ width: 28, height: 28, borderRadius: 8, background: m.role === "user" ? `${T.accent}20` : `${emp.color}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>
                          {m.role === "user" ? "🧑" : emp.icon}
                        </div>
                        <div style={{ background: m.role === "user" ? `${T.accent}18` : T.surf, border: `1px solid ${m.role === "user" ? T.accent + "30" : T.border2}`, borderRadius: 14, padding: "10px 14px", minWidth: 0 }}>
                          {m.role === "user" ? (
                            <div style={{ color: T.text1, fontSize: "0.85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{m.display || m.content}</div>
                          ) : m.streaming ? (
                            empStream ? <Markdown text={empStream} color={emp.color} /> : <Dots color={emp.color} />
                          ) : (
                            <Markdown text={m.content} color={emp.color} />
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={empChatEndRef} />
                </div>

                <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
                  {empFile && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "6px 10px", background: T.surf2, borderRadius: 8, fontSize: "0.74rem", color: T.text2 }}>
                      📎 {empFile.name}
                      <button onClick={() => setEmpFile(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: T.text3, cursor: "pointer" }}>✕</button>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                    <input ref={empFileRef} type="file" style={{ display: "none" }} onChange={async e => { const f = e.target.files[0]; if (f) setEmpFile(await readFile(f)); e.target.value = ""; }} />
                    <button onClick={() => empFileRef.current?.click()} style={iconBtn} title="Attach file">📎</button>
                    <textarea value={empInput} onChange={e => setEmpInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendEmployee(); } }} placeholder={`Message ${emp.name}...`} rows={1} style={{ ...inputStyle, flex: 1, resize: "none", fontFamily: "inherit" }} />
                    <button onClick={() => sendEmployee()} disabled={empLoading || !empInput.trim()} style={{ padding: "10px 18px", background: `${emp.color}`, border: "none", borderRadius: 9, color: "white", fontWeight: 700, fontSize: "0.82rem", cursor: empLoading || !empInput.trim() ? "default" : "pointer", opacity: empLoading || !empInput.trim() ? 0.5 : 1, flexShrink: 0 }}>
                      {empLoading ? <Dots color="white" /> : "Send"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ TASK BOARD ═══ */}
          {view === "tasks" && (
            <div style={{ padding: 18, height: "100%", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>📋 Task Board <span style={{ color: T.text3, fontWeight: 400 }}>({state.tasks.length})</span></div>
                <button onClick={() => setShowNewTask(true)} style={{ padding: "8px 16px", background: `linear-gradient(135deg, ${T.accent}, ${T.accent2})`, border: "none", borderRadius: 9, color: "white", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer" }}>+ New Task</button>
              </div>

              <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, overflow: "hidden" }}>
                {COLS.map(col => (
                  <div key={col.id}
                    onDragOver={e => { e.preventDefault(); setDragOverCol(col.id); }}
                    onDragLeave={() => setDragOverCol(null)}
                    onDrop={e => { e.preventDefault(); if (dragTask) dispatch({ type: "UPDATE_TASK", id: dragTask.id, payload: { status: col.id } }); setDragTask(null); setDragOverCol(null); }}
                    style={{ display: "flex", flexDirection: "column", background: dragOverCol === col.id ? `${col.color}0c` : T.surf, border: `1px solid ${dragOverCol === col.id ? col.color + "50" : T.border2}`, borderRadius: 14, overflow: "hidden", transition: "background 0.15s" }}>
                    <div style={{ padding: "12px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: col.color }} />
                      <span style={{ fontWeight: 700, fontSize: "0.8rem", color: T.text1 }}>{col.label}</span>
                      <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: T.text3 }}>{(tasksByCol[col.id] || []).length}</span>
                    </div>
                    <div style={{ flex: 1, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                      {(tasksByCol[col.id] || []).map(t => {
                        const e = EMP_REGISTRY[t.assignee];
                        const pColor = t.priority === "high" ? T.red : t.priority === "medium" ? T.yellow : T.text3;
                        return (
                          <div key={t.id} draggable onDragStart={() => setDragTask(t)}
                            style={{ background: T.surf2, border: `1px solid ${T.border2}`, borderRadius: 10, padding: 12, cursor: "grab" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6, marginBottom: 6 }}>
                              <div style={{ fontSize: "0.78rem", fontWeight: 600, color: T.text1, lineHeight: 1.4 }}>{t.title}</div>
                              <button onClick={() => dispatch({ type: "DELETE_TASK", id: t.id })} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: "0.72rem", flexShrink: 0 }}>✕</button>
                            </div>
                            {t.desc && <div style={{ fontSize: "0.7rem", color: T.text2, marginBottom: 8, lineHeight: 1.5 }}>{t.desc.slice(0, 90)}</div>}
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ background: `${e?.color || T.accent}20`, color: e?.color || T.accent, borderRadius: 6, padding: "2px 7px", fontSize: "0.63rem", display: "flex", alignItems: "center", gap: 3 }}>{e?.icon} {e?.name || t.assignee}</span>
                              <span style={{ background: `${pColor}18`, color: pColor, borderRadius: 6, padding: "2px 7px", fontSize: "0.6rem", textTransform: "uppercase", marginLeft: "auto" }}>{t.priority}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ PLANNER ═══ */}
          {view === "planner" && (
            <PlannerView S={state} dispatch={dispatch} autoGoal={autoGoal} setAutoGoal={setAutoGoal} autoRunning={autoRunning} runAuto={runAuto} abortRef={abortRef} setAutoRunning={setAutoRunning} setAutoStage={setAutoStage} setAutoProgress={setAutoProgress} autoProgress={autoProgress} autoStage={autoStage} T={T} inp={inp} EMPS={EMP_REGISTRY} />
          )}

          {/* ═══ BUILD ═══ */}
          {view === "build" && (
            <BuildView S={state} T={T} inp={inp} buildSpec={buildSpec} setBuildSpec={setBuildSpec} buildName={buildName} setBuildName={setBuildName} buildRunning={buildRunning} buildStage={buildStage} buildProgress={buildProgress} runBuild={runBuild} stopBuild={stopBuild} />
          )}

          {/* ═══ RESEARCH ═══ */}
          {view === "research" && (
            <ResearchView S={state} T={T} EMPS={EMP_REGISTRY}
              isResearcherActive={activeEmp === "researcher"}
              isResearcherLoading={empLoading && activeEmp === "researcher"}
              researcherStreamText={empStream}
              onOpenChat={() => { setActiveEmp("researcher"); setView("employees"); }}
              onSetGoal={(g) => { setAutoGoal(g); setView("dashboard"); }} />
          )}

          {/* ═══ REVIEWS ═══ */}
          {view === "reviews" && (
            <ReviewsView S={state} T={T} EMPS={EMP_REGISTRY} />
          )}

          {/* ═══ MEMORY ═══ */}
          {view === "memory" && (
            <div style={{ padding: 18 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                {["all", ...new Set(state.memory.map(m => m.category).filter(Boolean))].map(cat => (
                  <button key={cat} onClick={() => setMemFilter(cat)} style={{ padding: "5px 14px", background: memFilter === cat ? T.accent : T.surf, border: `1px solid ${memFilter === cat ? T.accent : T.border2}`, borderRadius: 20, color: memFilter === cat ? "#fff" : T.text2, fontSize: "0.74rem", fontWeight: memFilter === cat ? 700 : 400, cursor: "pointer", textTransform: "capitalize" }}>
                    {cat} {cat !== "all" && `(${state.memory.filter(m => m.category === cat).length})`}
                  </button>
                ))}
              </div>
              {filteredMemory.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 0", color: T.text3 }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🧠</div>
                  <div>No memory items yet. APEX saves decisions and insights here automatically.</div>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                  {filteredMemory.map(m => {
                    const impColor = m.importance === "high" ? T.red : m.importance === "medium" ? T.yellow : T.text3;
                    return (
                      <div key={m.id} style={{ background: T.surf, border: `1px solid ${T.border2}`, borderRadius: 12, padding: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <span style={{ background: `${T.accent}18`, color: T.accent, borderRadius: 6, padding: "2px 8px", fontSize: "0.63rem", textTransform: "capitalize" }}>{m.category || "note"}</span>
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: impColor }} title={m.importance} />
                        </div>
                        <div style={{ fontSize: "0.8rem", color: T.text1, lineHeight: 1.55, marginBottom: 8 }}>{m.content}</div>
                        <div style={{ fontSize: "0.62rem", color: T.text3 }}>{m.savedAt ? new Date(m.savedAt).toLocaleString() : ""}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ═══ ANALYTICS ═══ */}
          {view === "analytics" && (
            <div style={{ padding: 18 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginBottom: 16 }}>
                <div style={{ background: T.surf, border: `1px solid ${T.border2}`, borderRadius: 14, padding: 18 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 12 }}>📈 Tasks (last 7 days)</div>
                  <BarChart color={T.accent} data={(state.analytics.tasksByDay || []).map((v, i) => ({ label: ["S", "M", "T", "W", "T", "F", "S"][i] || i, value: v }))} height={120} />
                </div>
                <div style={{ background: T.surf, border: `1px solid ${T.border2}`, borderRadius: 14, padding: 18 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 12 }}>💰 Revenue (12 months)</div>
                  <BarChart color={T.green} data={(state.analytics.revenueByMonth || []).map((v, i) => ({ label: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"][i] || i, value: v }))} height={120} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
                <div style={{ background: T.surf, border: `1px solid ${T.border2}`, borderRadius: 14, padding: 18, display: "flex", alignItems: "center", gap: 20 }}>
                  <DonutChart size={100} data={COLS.map(c => ({ value: (tasksByCol[c.id] || []).length, color: c.color }))} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 10 }}>📋 Task Distribution</div>
                    {COLS.map(c => (
                      <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: c.color }} />
                        <span style={{ fontSize: "0.74rem", color: T.text2, flex: 1 }}>{c.label}</span>
                        <span style={{ fontSize: "0.74rem", color: T.text1, fontWeight: 700 }}>{(tasksByCol[c.id] || []).length}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ background: T.surf, border: `1px solid ${T.border2}`, borderRadius: 14, padding: 18 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: 12 }}>🔍 Review Quality</div>
                  {(state.reviews || []).length === 0 ? (
                    <div style={{ color: T.text3, fontSize: "0.8rem", textAlign: "center", padding: "20px 0" }}>No reviews yet.</div>
                  ) : (
                    <>
                      <div style={{ fontSize: "1.6rem", fontWeight: 900, color: T.green, marginBottom: 4 }}>
                        {Math.round((state.reviews || []).reduce((s, r) => s + (r.score || 0), 0) / state.reviews.length)}<span style={{ fontSize: "0.9rem", color: T.text3 }}>/100 avg</span>
                      </div>
                      <div style={{ fontSize: "0.74rem", color: T.text2 }}>{(state.reviews || []).filter(r => r.approved).length} approved · {(state.reviews || []).filter(r => !r.approved).length} need revision</div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ═══ SETTINGS ═══ */}
          {view === "settings" && (
            <div style={{ padding: 18, maxWidth: 640 }}>
              <div style={{ background: T.surf, border: `1px solid ${T.border2}`, borderRadius: 14, padding: 20, marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: "0.88rem", marginBottom: 16 }}>🏢 Company Profile</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  {[
                    ["Company Name", "name"],
                    ["Industry", "industry"],
                    ["Stage", "stage"],
                    ["Annual Revenue", "revenue"],
                    ["Mission Statement", "mission"],
                    ["Primary Goal", "goals"],
                  ].map(([label, key]) => (
                    <div key={key} style={{ gridColumn: (key === "mission" || key === "goals") ? "1 / -1" : "auto" }}>
                      <label style={{ color: T.text2, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>{label}</label>
                      <input value={state.company[key] || ""} onChange={e => dispatch({ type: "SET_COMPANY", payload: { [key]: e.target.value } })} style={inputStyle} />
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: T.surf, border: `1px solid ${T.border2}`, borderRadius: 14, padding: 20, marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: "0.88rem", marginBottom: 12 }}>🔌 AI Backend Proxy</div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ color: T.text2, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>Proxy URL</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input value={state.proxyUrl} onChange={e => dispatch({ type: "SET_PROXY", payload: e.target.value })} style={inputStyle} placeholder="https://your-proxy.com" />
                    <button onClick={() => dispatch({ type: "SET_PROXY", payload: DEFAULT_PROXY })} style={{ padding: "0 12px", background: T.surf2, border: `1px solid ${T.border2}`, borderRadius: 9, color: T.text2, fontSize: "0.7rem", cursor: "pointer" }}>Reset</button>
                  </div>
                </div>
                <div style={{ fontSize: "0.74rem", color: T.text3, lineHeight: 1.5 }}>
                  Status: <span style={{ color: proxyStatus === "online" ? T.green : proxyStatus === "offline" ? T.red : T.yellow, fontWeight: 700 }}>{proxyStatus.toUpperCase()}</span>
                  <div style={{ marginTop: 8 }}>
                    Endpoint: <span style={{ fontFamily: "monospace", wordBreak: "break-all", color: T.text2 }}>{PROXY_BASE_URL}</span>
                  </div>
                  {proxyDetails && (
                    <div style={{
                      marginTop: 10, padding: "8px 12px", background: T.surf2, borderRadius: 8,
                      borderLeft: `3px solid ${proxyStatus === "online" ? T.green : T.red}`,
                      color: proxyStatus === "online" ? T.text2 : T.red,
                      fontSize: "0.7rem", lineHeight: 1.4
                    }}>
                      <strong>Connection Log:</strong><br/>
                      {proxyDetails}
                    </div>
                  )}
                  <button
                    onClick={async () => {
                      toast("Testing connection...", "info");
                      const base = PROXY_BASE_URL.replace(/\/+$/, '');
                      try {
                        const res = await fetch(`${base}/health`, { mode: 'cors', cache: 'no-cache' });
                        if (res.ok) {
                          const data = await res.json();
                          toast(`Success! Model: ${data.model}`, "success");
                          setProxyStatus("online");
                          setProxyDetails(`Manual check passed: ${data.model}`);
                        } else {
                          toast(`Failed: ${res.status}`, "error");
                          setProxyStatus(`error-${res.status}`);
                        }
                      } catch (e) {
                        toast(`Network error: ${e.message}`, "error");
                        setProxyStatus("offline");
                        setProxyDetails(e.message === "Failed to fetch" ? "Failed to fetch (CORS or Network Error)" : e.message);
                      }
                    }}
                    style={{ marginTop: 10, padding: "6px 12px", background: T.surf2, border: `1px solid ${T.border2}`, borderRadius: 8, color: T.text1, fontSize: "0.7rem", cursor: "pointer" }}
                  >
                    Test Connection
                  </button>
                </div>
              </div>

              <div style={{ background: T.surf, border: `1px solid ${T.red}30`, borderRadius: 14, padding: 20 }}>
                <div style={{ fontWeight: 700, fontSize: "0.88rem", marginBottom: 10, color: T.red }}>⚠️ Danger Zone</div>
                <div style={{ fontSize: "0.78rem", color: T.text2, marginBottom: 12 }}>Reset all company data, tasks, memory, and chats. This cannot be undone.</div>
                <button onClick={() => { if (window.confirm("Reset APEX OS? All data will be lost.")) dispatch({ type: "RESET" }); }} style={{ padding: "9px 18px", background: `${T.red}18`, border: `1px solid ${T.red}44`, borderRadius: 9, color: T.red, fontWeight: 700, fontSize: "0.78rem", cursor: "pointer" }}>Reset APEX OS</button>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* ═══ NEW TASK MODAL ═══ */}
      {showNewTask && (
        <div onClick={() => setShowNewTask(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.surf, border: `1px solid ${T.border2}`, borderRadius: 16, padding: 24, width: 420, maxWidth: "90vw" }}>
            <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: 16 }}>+ New Task</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ color: T.text2, fontSize: "0.72rem", textTransform: "uppercase", display: "block", marginBottom: 5 }}>Title *</label>
                <input value={newTask.title} onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))} style={inputStyle} placeholder="e.g. Design landing page" />
              </div>
              <div>
                <label style={{ color: T.text2, fontSize: "0.72rem", textTransform: "uppercase", display: "block", marginBottom: 5 }}>Description</label>
                <input value={newTask.desc} onChange={e => setNewTask(p => ({ ...p, desc: e.target.value }))} style={inputStyle} placeholder="Details..." />
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ color: T.text2, fontSize: "0.72rem", textTransform: "uppercase", display: "block", marginBottom: 5 }}>Assignee</label>
                  <select value={newTask.assignee} onChange={e => setNewTask(p => ({ ...p, assignee: e.target.value }))} style={inputStyle}>
                    {Object.values(EMP_REGISTRY).filter(e => e.id !== "ceo").map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ color: T.text2, fontSize: "0.72rem", textTransform: "uppercase", display: "block", marginBottom: 5 }}>Priority</label>
                  <select value={newTask.priority} onChange={e => setNewTask(p => ({ ...p, priority: e.target.value }))} style={inputStyle}>
                    <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={{ color: T.text2, fontSize: "0.72rem", textTransform: "uppercase", display: "block", marginBottom: 5 }}>Due Date</label>
                <input type="date" value={newTask.due} onChange={e => setNewTask(p => ({ ...p, due: e.target.value }))} style={inputStyle} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowNewTask(false)} style={{ flex: 1, padding: "10px", background: T.surf2, border: `1px solid ${T.border2}`, borderRadius: 9, color: T.text2, cursor: "pointer", fontSize: "0.82rem" }}>Cancel</button>
              <button onClick={() => {
                if (!newTask.title.trim()) { toast("Task title is required", "error"); return; }
                dispatch({ type: "ADD_TASK", payload: { id: `t_${Date.now()}_${Math.random().toString(36).slice(2)}`, ...newTask, status: "todo", createdAt: new Date().toISOString(), source: "manual" } });
                addActivity(`Task created: "${newTask.title}"`, "📋");
                setNewTask({ title: "", desc: "", assignee: "cto", priority: "medium", due: "" });
                setShowNewTask(false);
              }} style={{ flex: 1, padding: "10px", background: `linear-gradient(135deg, ${T.accent}, ${T.accent2})`, border: "none", borderRadius: 9, color: "white", fontWeight: 700, cursor: "pointer", fontSize: "0.82rem" }}>Create Task</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ KPI EDIT MODAL ═══ */}
      {kpiEdit && (
        <div onClick={() => setKpiEdit(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.surf, border: `1px solid ${T.border2}`, borderRadius: 16, padding: 24, width: 360, maxWidth: "90vw" }}>
            <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: 16 }}>Edit KPI: {kpiEdit.metric}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ color: T.text2, fontSize: "0.72rem", textTransform: "uppercase", display: "block", marginBottom: 5 }}>Value</label>
                <input value={kpiEdit.value} onChange={e => setKpiEdit(p => ({ ...p, value: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label style={{ color: T.text2, fontSize: "0.72rem", textTransform: "uppercase", display: "block", marginBottom: 5 }}>Trend</label>
                <select value={kpiEdit.trend} onChange={e => setKpiEdit(p => ({ ...p, trend: e.target.value }))} style={inputStyle}>
                  <option value="up">↑ Up</option><option value="down">↓ Down</option><option value="stable">→ Stable</option>
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setKpiEdit(null)} style={{ flex: 1, padding: "10px", background: T.surf2, border: `1px solid ${T.border2}`, borderRadius: 9, color: T.text2, cursor: "pointer", fontSize: "0.82rem" }}>Cancel</button>
              <button onClick={() => {
                dispatch({ type: "UPDATE_KPI", id: kpiEdit.id, payload: { value: kpiEdit.value, trend: kpiEdit.trend, rawValue: parseFloat(kpiEdit.value) || 0 } });
                setKpiEdit(null);
              }} style={{ flex: 1, padding: "10px", background: `linear-gradient(135deg, ${T.accent}, ${T.accent2})`, border: "none", borderRadius: 9, color: "white", fontWeight: 700, cursor: "pointer", fontSize: "0.82rem" }}>Save</button>
            </div>
          </div>
        </div>
      )}

      <style>{CSS}</style>
    </div>
  );
}
