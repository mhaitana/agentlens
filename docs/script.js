// AgentLens GitHub Pages — navigation, theme, terminal simulator, privacy comparator,
// rules explorer, screenshot lightbox, and copy-to-clipboard.

const ICONS = {
  check: `
    <svg viewBox="0 0 24 24" aria-hidden="true" class="term-icon check-icon">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
      <path d="m9 12 2 2 4-4"/>
    </svg>`,
  cross: `
    <svg viewBox="0 0 24 24" aria-hidden="true" class="term-icon cross-icon">
      <path d="M18 6 6 18M6 6l12 12"/>
    </svg>`,
  info: `
    <svg viewBox="0 0 24 24" aria-hidden="true" class="term-icon">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 16v-4M12 8h.01"/>
    </svg>`,
  warning: `
    <svg viewBox="0 0 24 24" aria-hidden="true" class="term-icon">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <path d="M12 17h.01M12 9v4"/>
    </svg>`,
};

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initNavigation();
  initTerminalSimulator();
  initPrivacyComparator();
  initRulesExplorer();
  initLightbox();
  initCopyButtons();
});

function initTheme() {
  const toggle = document.querySelector("[data-theme-toggle]");
  const html = document.documentElement;
  const stored = localStorage.getItem("agentlens-theme");
  const prefersDark =
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

  function save(theme) {
    try {
      localStorage.setItem("agentlens-theme", theme);
    } catch {
      /* ignore private-mode / disabled storage */
    }
  }

  function apply(theme) {
    html.setAttribute("data-theme", theme);
    save(theme);
  }

  const initialTheme = stored || (prefersDark ? "dark" : "light");
  html.setAttribute("data-theme", initialTheme);

  if (toggle) {
    toggle.addEventListener("click", () => {
      const next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
      apply(next);
    });
  }
}

function initNavigation() {
  const toggle = document.querySelector(".nav-toggle");
  const menu = document.getElementById("nav-menu");
  if (!toggle || !menu) return;

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    toggle.setAttribute("aria-label", expanded ? "Open navigation menu" : "Close navigation menu");
    menu.classList.toggle("is-open", !expanded);
  });

  menu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open navigation menu");
      menu.classList.remove("is-open");
    });
  });
}

function initTerminalSimulator() {
  const tabs = document.querySelectorAll(".terminal-tab-btn");
  const body = document.getElementById("terminal-content");
  if (!tabs.length || !body) return;

  const simulatedOutputs = {
    scan: `
      <p><span class="prompt-symbol">$</span> <span class="term-cmd">agentlens scan --project my-project</span></p>
      <p class="term-comment"># Initializing local session scanner...</p>
      <p>${ICONS.info} Discovered 14 session transcripts in ~/.claude/projects/my-project</p>
      <p>${ICONS.info} Parsed 142 tool invocations, 38 git operations, 12 command executions</p>
      <p>${ICONS.check} 3 new sessions persisted to local database (~/Library/Application Support/AgentLens/agentlens.db)</p>
      <p class="term-comment"># Computed 34 deterministic recommendation rules (0 external network calls)</p>
    `,
    report: `
      <p><span class="prompt-symbol">$</span> <span class="term-cmd">agentlens report --period week --format terminal</span></p>
      <p class="term-highlight">AgentLens Analytics Report (Last 7 Days)</p>
      <p class="term-comment">----------------------------------------------------------------------</p>
      <p>Sessions analyzed:       14</p>
      <p>Total active duration:   4h 12m</p>
      <p>Total tool invocations:  384</p>
      <p>Estimated token cost:    $4.82  <span class="term-warning">(Estimated — not an official billing value)</span></p>
      <br>
      <p>Top Recommendations:</p>
      <p>  • <span class="term-highlight">TOOLS-001</span>: File read 6 times with no intervening edit [Confidence: 94%]</p>
      <p>  • <span class="term-highlight">VERIFY-002</span>: Test suite executed only after 14 file mutations [Confidence: 88%]</p>
    `,
    doctor: `
      <p><span class="prompt-symbol">$</span> <span class="term-cmd">agentlens doctor --dry-run</span></p>
      <p class="term-highlight">Configuration Doctor Preview</p>
      <p class="term-comment">----------------------------------------------------------------------</p>
      <p>Checking local coding-agent config safe boundaries...</p>
      <p>${ICONS.warning} FINDING [CFG-PERM-01]: Broad filesystem permissions detected in ~/.claude/settings.json</p>
      <p>  Remediation: Restrict allowlist to specific project roots.</p>
      <p>  Proposed patch: safe-patch-20260711-01.json (requires manual review)</p>
      <br>
      <p>${ICONS.check} Safe remediation principle: automaticallyApplicable is FALSE for all findings.</p>
    `,
    rules: `
      <p><span class="prompt-symbol">$</span> <span class="term-cmd">agentlens rules explain TOOLS-001</span></p>
      <p class="term-highlight">Rule Details: TOOLS-001 (Redundant File Read)</p>
      <p class="term-comment">----------------------------------------------------------------------</p>
      <p>Category:     tools</p>
      <p>Version:      1</p>
      <p>Trigger:      File read ≥ 4 times with no intervening modification</p>
      <p>Confidence:   confidenceForCount(count; base=0.6, per=0.1, cap=0.95)</p>
      <p>Evidence:     Exact file paths, timestamps, read counts</p>
      <p>Remediation:  Cache file context or inspect lines selectively</p>
      <p>Status:       Active (Threshold overridable via config.json)</p>
    `,
  };

  const render = (cmd, activeTab) => {
    body.innerHTML = simulatedOutputs[cmd] || simulatedOutputs["scan"];
    tabs.forEach((t) => {
      const selected = t === activeTab;
      t.classList.toggle("active", selected);
      t.setAttribute("aria-selected", String(selected));
    });
    if (activeTab) {
      body.setAttribute("aria-labelledby", activeTab.id);
    }
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const cmd = tab.getAttribute("data-cmd");
      render(cmd, tab);
    });
  });

  render("scan", tabs[0]);
}

function initPrivacyComparator() {
  const tabs = document.querySelectorAll(".privacy-tab");
  const title1 = document.getElementById("privacy-title-1");
  const title2 = document.getElementById("privacy-title-2");
  const list1 = document.getElementById("privacy-list-1");
  const list2 = document.getElementById("privacy-list-2");
  if (!tabs.length || !list1 || !list2) return;

  const modes = {
    "metadata-only": {
      title1: "Persisted Locally",
      items1: [
        `${ICONS.check} Session IDs & exact timestamps`,
        `${ICONS.check} Tool invocation names & durations`,
        `${ICONS.check} Token & cost estimates`,
        `${ICONS.check} File-path cryptographic hashes`,
        `${ICONS.check} Command safety classifications`,
      ],
      title2: "Never Persisted / Stripped",
      items2: [
        `${ICONS.cross} Raw prompt text or commands`,
        `${ICONS.cross} Source code or file contents`,
        `${ICONS.cross} Environment variables & API keys`,
        `${ICONS.cross} Real home directory paths`,
      ],
    },
    "redacted-content": {
      title1: "Persisted Locally (Default)",
      items1: [
        `${ICONS.check} Redacted prompts & commands`,
        `${ICONS.check} Redacted relative paths`,
        `${ICONS.check} Sanitised tool metadata`,
        `${ICONS.check} Derived prompt quality features`,
        `${ICONS.check} Automated secret redaction pre-write`,
      ],
      title2: "Never Persisted / Stripped",
      items2: [
        `${ICONS.cross} Unredacted sensitive identifiers`,
        `${ICONS.cross} Full file source code contents`,
        `${ICONS.cross} Authentication headers or tokens`,
        `${ICONS.cross} Any network cloud transmission`,
      ],
    },
    "full-local": {
      title1: "Persisted Locally (Explicit Opt-In)",
      items1: [
        `${ICONS.check} Full local prompt & command history`,
        `${ICONS.check} Comprehensive local timeline context`,
        `${ICONS.check} Secret detection still actively enforced`,
        `${ICONS.check} Local SQLite storage only (127.0.0.1)`,
      ],
      title2: "Never Persisted / Stripped",
      items2: [
        `${ICONS.cross} Cloud synchronization or telemetry upload`,
        `${ICONS.cross} API keys or detected credentials`,
        `${ICONS.cross} Silent background scanning`,
      ],
    },
  };

  const render = (mode, activeTab) => {
    const data = modes[mode];
    if (!data) return;
    if (title1) title1.textContent = data.title1;
    if (title2) title2.textContent = data.title2;
    list1.innerHTML = data.items1.map((i) => `<li>${i}</li>`).join("");
    list2.innerHTML = data.items2.map((i) => `<li>${i}</li>`).join("");
    tabs.forEach((t) => {
      const selected = t === activeTab;
      t.classList.toggle("active", selected);
      t.setAttribute("aria-selected", String(selected));
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const mode = tab.getAttribute("data-mode");
      render(mode, tab);
    });
  });

  const active = document.querySelector(".privacy-tab.active") || tabs[0];
  if (active) render(active.getAttribute("data-mode"), active);
}

function initRulesExplorer() {
  // Generated from packages/analysis-engine/src/rules/index.ts RULE_METADATA.
  // Keep in sync with the analysis engine. section references stripped for the public site.
  const rules = [
    {
      id: "TOOLS-001",
      category: "tools",
      title: "Repeated unchanged file reads",
      desc: "The same file read repeatedly without an intervening write or edit.",
    },
    {
      id: "TOOLS-002",
      category: "tools",
      title: "Repeated equivalent command",
      desc: "A normalised command executed repeatedly within a short period.",
    },
    {
      id: "TOOLS-003",
      category: "tools",
      title: "Repeated unchanged failure",
      desc: "Materially identical commands fail repeatedly without a meaningful change in arguments or strategy.",
    },
    {
      id: "TOOLS-004",
      category: "tools",
      title: "Excessive broad test runs",
      desc: "A broad/full test suite is repeatedly run after changes limited to a narrow project area. Conservative confidence.",
    },
    {
      id: "TOOLS-005",
      category: "tools",
      title: "Oversized tool result",
      desc: "Command or tool output is unusually large and likely contributes unnecessary context.",
    },
    {
      id: "TOOLS-006",
      category: "tools",
      title: "High exploration-to-change ratio",
      desc: "A session reads/searches many files but changes very few. Moderate confidence — exploration is not always wasteful.",
    },
    {
      id: "TOOLS-007",
      category: "tools",
      title: "Repeated unchanged searches",
      desc: "The same search (tool + input) recurs without a change in query.",
    },
    {
      id: "TOOLS-008",
      category: "tools",
      title: "Repeatedly failing tool",
      desc: "A tool (often an MCP server) fails a large share of its calls.",
    },
    {
      id: "VERIFY-001",
      category: "verification",
      title: "No verification after code changes",
      desc: "Code changes occurred but no recognised verification command followed.",
    },
    {
      id: "VERIFY-002",
      category: "verification",
      title: "Changes after final successful verification",
      desc: "Files changed after the last successful test, build, lint or typecheck.",
    },
    {
      id: "VERIFY-003",
      category: "verification",
      title: "Session ended with failed verification",
      desc: "The latest relevant verification command failed and no later success occurred.",
    },
    {
      id: "VERIFY-004",
      category: "verification",
      title: "Narrow verification only",
      desc: "A substantial cross-cutting change received only an obviously narrow verification step. Conservative confidence.",
    },
    {
      id: "VERIFY-005",
      category: "verification",
      title: "No test runs despite code changes",
      desc: "No recognised test command ran while code was being changed.",
    },
    {
      id: "VERIFY-006",
      category: "verification",
      title: "No build verification despite changes",
      desc: "No recognised build command ran while substantial changes were made. Conservative.",
    },
    {
      id: "WORKFLOW-001",
      category: "workflow",
      title: "Excessive corrective turns",
      desc: "Multiple user prompts appear to correct, reverse or clarify prior work.",
    },
    {
      id: "WORKFLOW-002",
      category: "workflow",
      title: "Very long session with task switching",
      desc: "Conservative deterministic indicators only in Phase 1; semantic detection in Phase 3.",
    },
    {
      id: "WORKFLOW-003",
      category: "workflow",
      title: "Large changes without verification",
      desc: "Large per-session change sets with sessions that changed code without verification.",
    },
    {
      id: "WORKFLOW-004",
      category: "workflow",
      title: "Repeated manual validation suitable for a hook",
      desc: "Deterministic verification commands run very frequently by hand — candidates for a Claude Code hook.",
    },
    {
      id: "CONTEXT-001",
      category: "context",
      title: "Frequent compaction",
      desc: "A session experiences repeated compactions or unusually high pre-compaction context.",
    },
    {
      id: "CONTEXT-002",
      category: "context",
      title: "Large repeated outputs",
      desc: "Large command outputs repeatedly enter the session.",
    },
    {
      id: "CONTEXT-003",
      category: "context",
      title: "Excessive stale context",
      desc: "A large share of input tokens are cache reads alongside compaction — stale context is carried and re-summarised.",
    },
    {
      id: "CONTEXT-004",
      category: "context",
      title: "Verbose exploration",
      desc: "High read/search volume with very few files changed — exploration that could be delegated to a subagent.",
    },
    {
      id: "PROMPT-001",
      category: "prompt",
      title: "Prompts rarely state acceptance criteria",
      desc: "Most prompts do not reference what 'done' looks like. Heuristic, from per-prompt structural features.",
    },
    {
      id: "PROMPT-002",
      category: "prompt",
      title: "Prompts rarely request verification",
      desc: "Few prompts ask the agent to verify its work. Heuristic, from per-prompt structural features.",
    },
    {
      id: "PROMPT-003",
      category: "prompt",
      title: "Multiple independent tasks per prompt",
      desc: "Prompts bundle several independent objectives, making verification harder. Heuristic.",
    },
    {
      id: "PROMPT-004",
      category: "prompt",
      title: "Vague references in prompts",
      desc: "Prompts use open references like 'this' or 'the issue' without naming the target. Heuristic.",
    },
    {
      id: "PROMPT-005",
      category: "prompt",
      title: "Repeated user corrections",
      desc: "A meaningful share of prompts correct or reverse prior work. Heuristic + corrective-turn count.",
    },
    {
      id: "MODEL-001",
      category: "model",
      title: "High-cost model used for light work",
      desc: "A high relative cost-tier model is dominant on low-activity work. Tiers are relative + configurable.",
    },
    {
      id: "MODEL-002",
      category: "model",
      title: "Lower-capability model struggling",
      desc: "A low relative capability-tier model is dominant with a high failure rate. Tiers are relative + configurable.",
    },
    {
      id: "MODEL-003",
      category: "model",
      title: "Stale context sent to a premium model",
      desc: "A high capability-tier model receives mostly cached (stale) input. Tiers are relative + configurable.",
    },
    {
      id: "SECURITY-001",
      category: "security",
      title: "Sensitive path access",
      desc: "Access to likely-sensitive files (.env, credentials, private keys, secret directories, cloud credentials). Never exposes the value.",
    },
    {
      id: "SECURITY-002",
      category: "security",
      title: "Potential secret in persisted content",
      desc: "The redaction pipeline detected a likely secret. Only the finding category is stored, not the secret.",
    },
    {
      id: "CONFIG-001",
      category: "configuration",
      title: "Overly broad retention or exclusions",
      desc: "AgentLens config broadens what is kept (full-local/long retention) or narrows what is analysed (broad exclusions).",
    },
    {
      id: "CONFIG-002",
      category: "configuration",
      title: "Local-first boundary weakened",
      desc: "Dashboard binds beyond loopback or external analysis is enabled with a non-local provider.",
    },
  ];

  const searchInput = document.getElementById("rule-search");
  const pills = document.querySelectorAll(".category-pill");
  const grid = document.getElementById("rules-grid");
  const loadMoreBtn = document.getElementById("rules-load-more");
  const showingLabel = document.getElementById("rules-showing");

  const PAGE_SIZE = 6;
  let activeCategory = "all";
  let searchQuery = "";
  let visibleCount = PAGE_SIZE;

  function matchesSearch(r, q) {
    return (
      !q ||
      r.id.toLowerCase().includes(q) ||
      r.title.toLowerCase().includes(q) ||
      r.desc.toLowerCase().includes(q)
    );
  }

  function getFilteredRules() {
    const q = searchQuery.toLowerCase();
    return rules.filter((r) => {
      const matchesCategory = activeCategory === "all" || r.category === activeCategory;
      return matchesCategory && matchesSearch(r, q);
    });
  }

  function renderRules() {
    if (!grid) return;
    const filtered = getFilteredRules();

    if (!filtered.length) {
      grid.innerHTML = `<div class="rules-empty">No matching recommendation rules found.</div>`;
      if (loadMoreBtn) loadMoreBtn.hidden = true;
      if (showingLabel) showingLabel.textContent = "";
      return;
    }

    const page = filtered.slice(0, visibleCount);
    grid.innerHTML = page
      .map(
        (r) => `
          <div class="rule-card">
            <div class="rule-top">
              <span class="rule-id">${escapeHtml(r.id)}</span>
              <span class="rule-badge">${escapeHtml(r.category)}</span>
            </div>
            <h4>${escapeHtml(r.title)}</h4>
            <p>${escapeHtml(r.desc)}</p>
          </div>
        `,
      )
      .join("");

    if (loadMoreBtn) {
      loadMoreBtn.hidden = visibleCount >= filtered.length;
    }
    if (showingLabel) {
      showingLabel.textContent = `Showing ${page.length} of ${filtered.length}`;
    }
  }

  function resetPagination() {
    visibleCount = PAGE_SIZE;
  }

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value;
      resetPagination();
      renderRules();
    });
  }

  if (pills.length) {
    pills.forEach((pill) => {
      pill.addEventListener("click", () => {
        pills.forEach((p) => {
          p.classList.remove("active");
          p.setAttribute("aria-checked", "false");
        });
        pill.classList.add("active");
        pill.setAttribute("aria-checked", "true");
        activeCategory = pill.getAttribute("data-category");
        resetPagination();
        renderRules();
      });
    });
  }

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", () => {
      visibleCount += PAGE_SIZE;
      renderRules();
    });
  }

  renderRules();
}

function initLightbox() {
  const modal = document.getElementById("lightbox");
  const modalImg = document.getElementById("lightbox-img");
  const modalTitle = document.getElementById("lightbox-title");
  const closeBtn = document.getElementById("lightbox-close");
  const cards = document.querySelectorAll(".gallery-card");

  if (!modal || !modalImg || !cards.length) return;

  const open = (card) => {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const img = card.querySelector(dark ? ".screenshot-dark" : ".screenshot-light");
    const title = card.querySelector("h4");
    if (!img) return;
    modalImg.src = img.src;
    modalImg.alt = img.alt || "Screenshot fullscreen";
    if (modalTitle && title) modalTitle.textContent = title.textContent;
    modal.classList.add("active");
    document.body.style.overflow = "hidden";
    if (closeBtn) closeBtn.focus();
  };

  const close = () => {
    modal.classList.remove("active");
    document.body.style.overflow = "";
  };

  cards.forEach((card) => {
    card.addEventListener("click", () => open(card));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open(card);
      }
    });
    card.setAttribute("tabindex", "0");
    card.setAttribute("role", "button");
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", close);
  }

  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("active")) close();
  });
}

function initCopyButtons() {
  const copyBtns = document.querySelectorAll(".copy-btn");
  const toast = document.getElementById("toast");

  copyBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.getAttribute("data-copy");
      if (code && navigator.clipboard) {
        navigator.clipboard.writeText(code);
        showToast("Command copied to clipboard!");
      }
    });
  });

  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("show");
    window.setTimeout(() => {
      toast.classList.remove("show");
    }, 2500);
  }
}
