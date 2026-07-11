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
  const rules = [
    {
      id: "TOOLS-001",
      category: "tools",
      title: "Redundant File Read",
      desc: "File read ≥ 4 times with no intervening modification. Recommends inspecting lines selectively or caching.",
    },
    {
      id: "TOOLS-003",
      category: "tools",
      title: "High-Frequency Tool Polling",
      desc: "Repeated invocation of identical tool call within a tight loop.",
    },
    {
      id: "VERIFY-001",
      category: "verification",
      title: "Unverified Code Mutation",
      desc: "File modified without subsequent test execution, compiler check, or linter verification.",
    },
    {
      id: "VERIFY-004",
      category: "verification",
      title: "Test Failure Ignore",
      desc: "Agent proceeded with further edits despite failing automated verification checks.",
    },
    {
      id: "WORKFLOW-002",
      category: "workflow",
      title: "Context Window Exhaustion Risk",
      desc: "Session exceeds high token threshold without compacting or starting fresh session.",
    },
    {
      id: "CONTEXT-001",
      category: "context",
      title: "Excessive Directory Listing",
      desc: "Repeated broad recursive directory scans instead of targeted file lookups.",
    },
    {
      id: "PROMPT-002",
      category: "prompt",
      title: "Underspecified Task Objective",
      desc: "Initial prompt lacks verifiable constraints or success criteria.",
    },
    {
      id: "MODEL-001",
      category: "model",
      title: "Suboptimal Model Capability Match",
      desc: "High-cost tier model used for routine mechanical formatting tasks.",
    },
    {
      id: "SECURITY-001",
      category: "security",
      title: "Sensitive File Access Attempt",
      desc: "Agent read or attempted access to credential stores (.env, ssh keys).",
    },
    {
      id: "CONFIG-001",
      category: "configuration",
      title: "Overly Permissive Tool Scope",
      desc: "Configuration allows unrestricted shell execution or unconstrained path access.",
    },
  ];

  const searchInput = document.getElementById("rule-search");
  const pills = document.querySelectorAll(".category-pill");
  const grid = document.getElementById("rules-grid");

  let activeCategory = "all";
  let searchQuery = "";

  function renderRules() {
    if (!grid) return;
    const filtered = rules.filter((r) => {
      const matchesCategory = activeCategory === "all" || r.category === activeCategory;
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        r.id.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.desc.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });

    if (!filtered.length) {
      grid.innerHTML = `<div class="rules-empty">No matching recommendation rules found.</div>`;
      return;
    }

    grid.innerHTML = filtered
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
  }

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value;
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
        renderRules();
      });
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
    const img = card.querySelector("img");
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
