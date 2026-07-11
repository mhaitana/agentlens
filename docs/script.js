// AgentLens Interactive Documentation & Learning Hub Script

document.addEventListener("DOMContentLoaded", () => {
  initTerminalSimulator();
  initPrivacyComparator();
  initRulesExplorer();
  initLightbox();
  initCopyButtons();
});

/* Interactive CLI Terminal Simulator */
function initTerminalSimulator() {
  const tabs = document.querySelectorAll(".terminal-tab-btn");
  const body = document.getElementById("terminal-content");

  const simulatedOutputs = {
    scan: `
<span class="prompt-symbol">❯</span> <span class="term-cmd">agentlens scan --project my-project</span>
<span class="term-comment"># Initializing local session scanner...</span>
<span class="term-highlight">i</span> Discovered 14 session transcripts in ~/.claude/projects/my-project
<span class="term-highlight">i</span> Parsed 142 tool invocations, 38 git operations, 12 command executions
<span class="term-success">✔</span> 3 new sessions persisted to local database (~/Library/Application Support/AgentLens/agentlens.db)
<span class="term-comment"># Computed 34 deterministic recommendation rules (0 external network calls)</span>
`,
    report: `
<span class="prompt-symbol">❯</span> <span class="term-cmd">agentlens report --period week --format terminal</span>
<span class="term-highlight">AgentLens Analytics Report (Last 7 Days)</span>
----------------------------------------------------------------------
Sessions analyzed:       14
Total active duration:   4h 12m
Total tool invocations:  384
Estimated token cost:    $4.82  <span class="term-warning">(Estimated — not an official billing value)</span>

Top Recommendations:
  • <span class="term-highlight">TOOLS-001</span>: File read 6 times with no intervening edit [Confidence: 94%]
  • <span class="term-highlight">VERIFY-002</span>: Test suite executed only after 14 file mutations [Confidence: 88%]
`,
    doctor: `
<span class="prompt-symbol">❯</span> <span class="term-cmd">agentlens doctor --dry-run</span>
<span class="term-highlight">Configuration Doctor Preview</span>
----------------------------------------------------------------------
Checking local coding-agent config safe boundaries...
<span class="term-warning">! FINDING [CFG-PERM-01]</span>: Broad filesystem permissions detected in ~/.claude/settings.json
  Remediation: Restrict allowlist to specific project roots.
  Proposed patch: safe-patch-20260711-01.json (requires manual review)

<span class="term-success">✔</span> Safe remediation principle: automaticallyApplicable is FALSE for all findings.
`,
    rules: `
<span class="prompt-symbol">❯</span> <span class="term-cmd">agentlens rules explain TOOLS-001</span>
<span class="term-highlight">Rule Details: TOOLS-001 (Redundant File Read)</span>
----------------------------------------------------------------------
Category:     tools
Version:      1
Trigger:      File read ≥ 4 times with no intervening modification
Confidence:   confidenceForCount(count; base=0.6, per=0.1, cap=0.95)
Evidence:     Exact file paths, timestamps, read counts
Remediation:  Cache file context or inspect lines selectively
Status:       Active (Threshold overridable via config.json)
`,
  };

  if (!tabs.length || !body) return;

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const cmd = tab.getAttribute("data-cmd");
      body.innerHTML = simulatedOutputs[cmd] || simulatedOutputs["scan"];
    });
  });
}

/* Privacy Comparator */
function initPrivacyComparator() {
  const tabs = document.querySelectorAll(".privacy-tab");
  const metadataList = document.getElementById("privacy-list-1");
  const contentList = document.getElementById("privacy-list-2");

  const modes = {
    "metadata-only": {
      title1: "Persisted Locally",
      items1: [
        '<span class="check-icon">✔</span> Session IDs & exact timestamps',
        '<span class="check-icon">✔</span> Tool invocation names & durations',
        '<span class="check-icon">✔</span> Token & cost estimates',
        '<span class="check-icon">✔</span> File-path cryptographic hashes',
        '<span class="check-icon">✔</span> Command safety classifications',
      ],
      title2: "Never Persisted / Stripped",
      items2: [
        '<span class="cross-icon">✖</span> Raw prompt text or commands',
        '<span class="cross-icon">✖</span> Source code or file contents',
        '<span class="cross-icon">✖</span> Environment variables & API keys',
        '<span class="cross-icon">✖</span> Real home directory paths',
      ],
    },
    "redacted-content": {
      title1: "Persisted Locally (Default)",
      items1: [
        '<span class="check-icon">✔</span> Redacted prompts & commands',
        '<span class="check-icon">✔</span> Redacted relative paths',
        '<span class="check-icon">✔</span> Sanitised tool metadata',
        '<span class="check-icon">✔</span> Derived prompt quality features',
        '<span class="check-icon">✔</span> Automated secret redaction pre-write',
      ],
      title2: "Never Persisted / Stripped",
      items2: [
        '<span class="cross-icon">✖</span> Unredacted sensitive identifiers',
        '<span class="cross-icon">✖</span> Full file source code contents',
        '<span class="cross-icon">✖</span> Authentication headers or tokens',
        '<span class="cross-icon">✖</span> Any network cloud transmission',
      ],
    },
    "full-local": {
      title1: "Persisted Locally (Explicit Opt-In)",
      items1: [
        '<span class="check-icon">✔</span> Full local prompt & command history',
        '<span class="check-icon">✔</span> Comprehensive local timeline context',
        '<span class="check-icon">✔</span> Secret detection still actively enforced',
        '<span class="check-icon">✔</span> Local SQLite storage only (127.0.0.1)',
      ],
      title2: "Never Persisted / Stripped",
      items2: [
        '<span class="cross-icon">✖</span> Cloud synchronization or telemetry upload',
        '<span class="cross-icon">✖</span> API keys or detected credentials',
        '<span class="cross-icon">✖</span> Silent background scanning',
      ],
    },
  };

  if (!tabs.length || !metadataList || !contentList) return;

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const mode = tab.getAttribute("data-mode");
      const data = modes[mode];
      if (data) {
        metadataList.innerHTML = data.items1.map((i) => `<li>${i}</li>`).join("");
        contentList.innerHTML = data.items2.map((i) => `<li>${i}</li>`).join("");
      }
    });
  });
}

/* Interactive Rules Explorer */
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
      const matchesSearch =
        !searchQuery ||
        r.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.desc.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });

    if (!filtered.length) {
      grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 2rem;">No matching recommendation rules found.</div>`;
      return;
    }

    grid.innerHTML = filtered
      .map(
        (r) => `
      <div class="rule-card">
        <div class="rule-top">
          <span class="rule-id">${r.id}</span>
          <span class="rule-badge">${r.category}</span>
        </div>
        <h4>${r.title}</h4>
        <p>${r.desc}</p>
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
        pills.forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
        activeCategory = pill.getAttribute("data-category");
        renderRules();
      });
    });
  }

  renderRules();
}

/* Lightbox Modal */
function initLightbox() {
  const modal = document.getElementById("lightbox");
  const modalImg = document.getElementById("lightbox-img");
  const modalTitle = document.getElementById("lightbox-title");
  const closeBtn = document.getElementById("lightbox-close");
  const cards = document.querySelectorAll(".gallery-card");

  if (!modal || !modalImg || !cards.length) return;

  cards.forEach((card) => {
    card.addEventListener("click", () => {
      const img = card.querySelector("img");
      const title = card.querySelector("h4");
      if (img) {
        modalImg.src = img.src;
        if (modalTitle && title) modalTitle.textContent = title.textContent;
        modal.classList.add("active");
      }
    });
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", () => modal.classList.remove("active"));
  }

  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("active");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") modal.classList.remove("active");
  });
}

/* Copy buttons */
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
    setTimeout(() => {
      toast.classList.remove("show");
    }, 2500);
  }
}
