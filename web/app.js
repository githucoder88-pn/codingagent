/**
 * CODER dashboard — single-page app (vanilla JS, no build step).
 *
 * Talks to the CODER backend API. Views: login, overview, history, keys,
 * settings, admin. The admin view is only shown for admin roles.
 */

"use strict";

const state = {
  user: null, // { id, email, role, ... }
  token: localStorage.getItem("coder.token") || null,
};

const $ = (sel) => document.querySelector(sel);
const app = $("#app");

// ------------------------------------------------------------------ api

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`/api${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const message = body?.error?.message || `HTTP ${res.status}`;
    if (res.status === 401) {
      state.token = null;
      localStorage.removeItem("coder.token");
      render();
    }
    throw new Error(message);
  }
  return body;
}

function toast(message, kind = "") {
  const el = $("#toast");
  el.textContent = message;
  el.className = kind;
  el.hidden = false;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => (el.hidden = true), 4000);
}

function esc(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

function fmt(iso) {
  return (iso || "").slice(0, 19).replace("T", " ");
}

// ---------------------------------------------------------------- views

function viewLogin() {
  app.innerHTML = `
    <div class="auth-box panel">
      <h1 id="auth-title">Sign in to CODER</h1>
      <div class="row"><input id="email" type="email" placeholder="Email" autocomplete="email" /></div>
      <div class="row"><input id="password" type="password" placeholder="Password (min 8 chars)" autocomplete="current-password" /></div>
      <div class="error-banner" id="login-error"></div>
      <button id="login-btn">Sign in</button>
      <p class="muted"><a href="#" id="auth-toggle">No account? Create one</a></p>
    </div>`;

  let mode = "login";
  const submit = async () => {
    const error = $("#login-error");
    error.textContent = "";
    try {
      const path = mode === "login" ? "/auth/login" : "/auth/signup";
      const result = await api(path, {
        method: "POST",
        body: { email: $("#email").value, password: $("#password").value },
      });
      state.token = result.token;
      localStorage.setItem("coder.token", result.token);
      state.user = result.user;
      render();
    } catch (err) {
      error.textContent = err.message;
    }
  };
  $("#login-btn").addEventListener("click", submit);
  $("#auth-toggle").addEventListener("click", (e) => {
    e.preventDefault();
    mode = mode === "login" ? "signup" : "login";
    $("#auth-title").textContent = mode === "login" ? "Sign in to CODER" : "Create a CODER account";
    $("#login-btn").textContent = mode === "login" ? "Sign in" : "Create account";
    $("#auth-toggle").textContent = mode === "login" ? "No account? Create one" : "Already have an account? Sign in";
  });
  $("#password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#login-btn").click();
  });
}

function viewOverview(user) {
  api("/users/me/stats").then(({ stats }) => {
    const panel = $("#overview-stats");
    if (!panel) return;
    panel.innerHTML = `
      <h2>Your usage</h2>
      <div class="row">
        <div class="grow"><strong>${stats.promptCount}</strong> prompts</div>
        <div class="grow"><strong>${stats.responseCount}</strong> responses</div>
        <div class="grow"><strong>${stats.feedbackCount}</strong> feedback</div>
        <div class="grow"><strong>${stats.keyCount}</strong> provider keys</div>
      </div>
      <div class="muted">First prompt: ${stats.firstPromptAt ? fmt(stats.firstPromptAt) : "—"} · Last prompt: ${stats.lastPromptAt ? fmt(stats.lastPromptAt) : "—"}</div>`;
  }).catch((err) => toast(err.message, "err"));

  app.innerHTML = `
    <div class="panel" id="overview-stats"></div>
    <div class="panel">
      <h2>Account</h2>
      <p>Email: <strong>${esc(user.email)}</strong> · Role: <span class="tag">${esc(user.role)}</span></p>
      <p class="muted">Your prompts, responses and feedback are stored by the CODER control plane. Manage privacy in Settings.</p>
    </div>`;
}

function viewHistory() {
  app.innerHTML = `
    <div class="panel">
      <h2>History</h2>
      <div class="row">
        <input id="history-search" class="grow" placeholder="Filter by prompt text…" />
        <button id="history-refresh" class="secondary">Refresh</button>
      </div>
      <div id="history-list"><div class="loading">Loading…</div></div>
    </div>`;

  const load = async () => {
    const search = ($("#history-search") || {}).value || "";
    const data = await api("/chat/history?limit=200&offset=0");
    if (data.disabled) {
      $("#history-list").innerHTML = `<p class="muted">History recording is disabled for this account. Enable it in Settings.</p>`;
      return;
    }
    const items = data.records.filter((r) => !search || r.prompt.toLowerCase().includes(search.toLowerCase()));
    $("#history-list").innerHTML =
      items.length === 0
        ? `<p class="muted">No prompts yet — ask something with <code>coder ask "…"</code>.</p>`
        : items
            .map(
              (r) => `
        <div class="record" data-prompt-id="${esc(r.promptId)}">
          <div class="meta">${fmt(r.createdAt)} · ${esc(r.provider)}/${esc(r.model)} · session ${esc(r.sessionId)} · rating ${r.rating ? `${r.rating}/5` : "—"}</div>
          <div class="prompt">${esc(r.prompt)}</div>
          ${r.response ? `<div class="response">${esc(r.response)}</div>` : ""}
          ${r.feedbackComment ? `<div class="muted">💬 ${esc(r.feedbackComment)}</div>` : ""}
          <div class="feedback-form">
            <select data-rating>
              <option value="">Rate…</option>
              <option value="1">1 — poor</option>
              <option value="2">2 — weak</option>
              <option value="3">3 — ok</option>
              <option value="4">4 — good</option>
              <option value="5">5 — great</option>
            </select>
            <input data-comment placeholder="Comment (optional)" />
            <button data-submit class="secondary">Send feedback</button>
          </div>
        </div>`,
            )
            .join("");
    document.querySelectorAll("[data-submit]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const record = btn.closest(".record");
        const rating = Number(record.querySelector("[data-rating]").value);
        if (!rating) return toast("Pick a rating first.", "err");
        const comment = record.querySelector("[data-comment]").value || undefined;
        try {
          await api("/chat/feedback", {
            method: "POST",
            body: { promptId: record.dataset.promptId, rating, comment },
          });
          toast("Feedback saved.", "ok");
          load();
        } catch (err) {
          toast(err.message, "err");
        }
      }),
    );
  };

  $("#history-refresh").addEventListener("click", load);
  $("#history-search").addEventListener("input", load);
  load().catch((err) => toast(err.message, "err"));
}

function viewKeys() {
  app.innerHTML = `
    <div class="panel">
      <h2>Provider keys</h2>
      <p class="muted">Keys are encrypted at rest with the server master key. Only fingerprints are shown here.</p>
      <div class="row">
        <select id="key-provider" class="grow">
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="gemini">Gemini</option>
          <option value="openrouter" selected>OpenRouter</option>
        </select>
        <input id="key-value" class="grow" placeholder="API key (sk-…)" type="password" autocomplete="off" />
        <button id="key-add">Add key</button>
      </div>
      <table>
        <thead><tr><th>Provider</th><th>Fingerprint</th><th>Added</th><th></th></tr></thead>
        <tbody id="key-list"><tr><td colspan="4" class="muted">Loading…</td></tr></tbody>
      </table>
    </div>`;

  const load = async () => {
    const { keys } = await api("/auth/provider-keys");
    $("#key-list").innerHTML =
      keys.length === 0
        ? `<tr><td colspan="4" class="muted">No keys stored. Add one above or with <code>coder auth add &lt;provider&gt;</code>.</td></tr>`
        : keys
            .map(
              (k) => `<tr>
                <td><strong>${esc(k.provider)}</strong></td>
                <td class="mono">${esc(k.fingerprint)}</td>
                <td>${fmt(k.createdAt)}</td>
                <td><button data-remove="${esc(k.provider)}" class="secondary">Remove</button></td>
              </tr>`,
            )
            .join("");
    document.querySelectorAll("[data-remove]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        try {
          await api(`/auth/provider-key/${btn.dataset.remove}`, { method: "DELETE" });
          toast(`Removed ${btn.dataset.remove} key.`, "ok");
          load();
        } catch (err) {
          toast(err.message, "err");
        }
      }),
    );
  };

  $("#key-add").addEventListener("click", async () => {
    const provider = $("#key-provider").value;
    const apiKey = $("#key-value").value.trim();
    if (!apiKey) return toast("Enter a key.", "err");
    try {
      await api("/auth/provider-key", { method: "POST", body: { provider, apiKey } });
      $("#key-value").value = "";
      toast(`Key for ${provider} stored (encrypted).`, "ok");
      load();
    } catch (err) {
      toast(err.message, "err");
    }
  });
  load().catch((err) => toast(err.message, "err"));
}

function viewWorkspace(user) {
  api("/workspace").then((data) => {
    const el = $("#workspace-panel");
    if (!el) return;
    const repos = data.repositories || [];
    const searches = data.searchHistory || [];
    const checkpoints = data.checkpoints || [];
    const patches = data.patches || [];
    el.innerHTML = `
      <h2>Workspace intelligence</h2>
      <h3>Repositories (${repos.length})</h3>
      ${repos.length === 0
        ? `<p class="muted">No repositories synced yet — run <code>coder scan</code> in a repository while signed in.</p>`
        : `<table><thead><tr><th>Name</th><th>Language</th><th>Files</th><th>Symbols</th><th>Lines</th><th>Indexed</th></tr></thead>
           <tbody>${repos
             .map(
               (r) => `<tr><td><strong>${esc(r.name)}</strong></td><td>${esc(r.language || "—")}</td><td>${r.fileCount}</td><td>${r.symbolCount}</td><td>${r.lineCount}</td><td>${r.indexedAt ? fmt(r.indexedAt) : "—"}</td></tr>`,
             )
             .join("")}</tbody></table>`}
      <h3>Search history (${searches.length})</h3>
      ${searches.length === 0
        ? `<p class="muted">No searches recorded.</p>`
        : `<table><thead><tr><th>When</th><th>Kind</th><th>Query</th><th>Results</th></tr></thead>
           <tbody>${searches
             .map((s) => `<tr><td>${fmt(s.createdAt)}</td><td>${esc(s.kind)}</td><td class="mono">${esc(s.query)}</td><td>${s.resultCount ?? "—"}</td></tr>`)
             .join("")}</tbody></table>`}
      <h3>Checkpoints (${checkpoints.length})</h3>
      ${checkpoints.length === 0
        ? `<p class="muted">No checkpoints — run <code>coder checkpoints create</code>.</p>`
        : `<table><thead><tr><th>Name</th><th>Files</th><th>Created</th></tr></thead>
           <tbody>${checkpoints
             .map((c) => `<tr><td class="mono">${esc(c.name)}</td><td>${c.fileCount}</td><td>${fmt(c.createdAt)}</td></tr>`)
             .join("")}</tbody></table>`}
      <h3>Patches (${patches.length})</h3>
      ${patches.length === 0
        ? `<p class="muted">No patches recorded yet.</p>`
        : `<table><thead><tr><th>When</th><th>Summary</th><th>Diff size</th></tr></thead>
           <tbody>${patches
             .map((p) => `<tr><td>${fmt(p.createdAt)}</td><td>${esc(p.summary || "—")}</td><td>${p.diffLength} bytes</td></tr>`)
             .join("")}</tbody></table>`}`;
  }).catch((err) => toast(err.message, "err"));

  app.innerHTML = `
    <div class="panel" id="workspace-panel"><div class="loading">Loading…</div></div>
    <div class="panel">
      <h2>How it works</h2>
      <p class="muted">The CLI scans repositories (<code>coder scan</code>), indexes symbols and dependencies,
        and syncs the index, search history, checkpoints and patches here when you are signed in. Embeddings are
        computed locally and stored per file.</p>
    </div>`;
}

function viewSettings(user) {
  api("/users/me").then(({ settings }) => {
    const el = $("#privacy-panel");
    if (!el) return;
    el.innerHTML = `
      <h2>Privacy & data</h2>
      <div class="row">
        <div class="grow">
          <strong>History recording</strong><br />
          <span class="muted">Store prompts & responses (powers history, analytics, feedback).</span>
        </div>
        <button data-history="${settings.historyEnabled ? "off" : "on"}" class="secondary">Turn ${settings.historyEnabled ? "off" : "on"}</button>
      </div>
      <div class="row">
        <div class="grow">
          <strong>Training data</strong><br />
          <span class="muted">Opt in to include your prompts/responses/feedback in the training dataset. Never enabled without consent.</span>
        </div>
        <button data-training="${settings.trainingOptIn ? "off" : "on"}" class="secondary">${settings.trainingOptIn ? "Opt out" : "Opt in"}</button>
      </div>
      <div class="row">
        <div class="grow"><strong>Export your data</strong><br /><span class="muted">Download every prompt, response, feedback and setting (keys only as fingerprints).</span></div>
        <button id="export-btn" class="secondary">Export JSON</button>
      </div>
      <div class="row">
        <div class="grow"><strong>Delete account</strong><br /><span class="muted">Permanently erase your account and all backend data.</span></div>
        <button id="delete-btn" class="danger">Delete account</button>
      </div>`;

    el.querySelector("[data-history]").addEventListener("click", async (btn) => {
      const on = btn.target.dataset.history === "on";
      await api("/users/me/settings", { method: "PATCH", body: { historyEnabled: on } });
      toast(`History recording ${on ? "enabled" : "disabled"}.`, "ok");
      viewSettings(state.user);
    });
    el.querySelector("[data-training]").addEventListener("click", async (btn) => {
      const on = btn.target.dataset.training === "on";
      await api("/users/me/settings", { method: "PATCH", body: { trainingOptIn: on } });
      toast(on ? "Opted in to training data." : "Opted out of training data.", "ok");
      viewSettings(state.user);
    });
    $("#export-btn").addEventListener("click", async () => {
      try {
        const bundle = await api("/export", { method: "POST" });
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `coder-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        toast("Export downloaded.", "ok");
      } catch (err) {
        toast(err.message, "err");
      }
    });
    $("#delete-btn").addEventListener("click", async () => {
      if (!confirm("Delete your account and ALL backend data? This cannot be undone.")) return;
      if (!confirm("Really? This erases every prompt, response, key and setting.")) return;
      try {
        await api("/delete-account", { method: "POST" });
        localStorage.removeItem("coder.token");
        state.user = null;
        state.token = null;
        render();
        toast("Account deleted.", "ok");
      } catch (err) {
        toast(err.message, "err");
      }
    });
  });

  app.innerHTML = `
    <div class="panel" id="privacy-panel"><div class="loading">Loading…</div></div>
    <div class="panel">
      <h2>Session</h2>
      <p>Signed in as <strong>${esc(user.email)}</strong> (${esc(user.role)}) since ${fmt(user.createdAt)}.</p>
    </div>`;
}

function viewAdmin() {
  app.innerHTML = `
    <div class="panel">
      <h2>Admin</h2>
      <div class="row">
        <button data-tab="users" class="secondary">Users</button>
        <button data-tab="prompts" class="secondary">Prompts</button>
        <button data-tab="feedback" class="secondary">Feedback</button>
        <button data-tab="logs" class="secondary">Audit logs</button>
        <button data-tab="training" class="secondary">Training</button>
        <button data-tab="usage" class="secondary">Usage</button>
        <button data-tab="models" class="secondary">Models</button>
        <button data-tab="repositories" class="secondary">Repositories</button>
      </div>
      <div id="admin-content"><div class="loading">Loading…</div></div>
    </div>`;

  const tabs = { users: adminUsers, prompts: adminPrompts, feedback: adminFeedback, logs: adminLogs, training: adminTraining, usage: adminUsage, models: adminModels, repositories: adminRepositories };
  document.querySelectorAll("[data-tab]").forEach((btn) =>
    btn.addEventListener("click", () => tabs[btn.dataset.tab]().catch((err) => toast(err.message, "err"))),
  );
  adminUsers().catch((err) => toast(err.message, "err"));
}

async function adminUsers() {
  const { users, total } = await api("/admin/users?limit=100&offset=0");
  $("#admin-content").innerHTML = `
    <h3>Users (${total})</h3>
    <table><thead><tr><th>Email</th><th>Role</th><th>Training</th><th>History</th><th>Prompts</th><th>Last active</th><th>Created</th></tr></thead>
    <tbody>${users
      .map(
        (u) => `<tr>
          <td>${esc(u.email)}</td><td>${esc(u.role)}</td>
          <td>${u.trainingOptIn ? '<span class="tag on">opt-in</span>' : '<span class="tag off">no</span>'}</td>
          <td>${u.historyEnabled ? "on" : "off"}</td>
          <td>${u.promptCount}</td>
          <td>${u.lastActiveAt ? fmt(u.lastActiveAt) : "—"}</td>
          <td>${fmt(u.createdAt)}</td>
        </tr>`,
      )
      .join("")}</tbody></table>`;
}

async function adminPrompts() {
  const { prompts } = await api("/admin/prompts?limit=100&offset=0");
  $("#admin-content").innerHTML = `
    <h3>Prompts (latest 100)</h3>
    <table><thead><tr><th>When</th><th>User</th><th>Model</th><th>Prompt</th><th>Training</th></tr></thead>
    <tbody>${prompts
      .map(
        (p) => `<tr>
          <td>${fmt(p.createdAt)}</td><td>${esc(p.userEmail)}</td><td>${esc(p.provider)}/${esc(p.model)}</td>
          <td class="mono">${esc((p.prompt || "").slice(0, 120))}</td>
          <td>${p.forTraining ? '<span class="tag on">yes</span>' : "no"}</td>
        </tr>`,
      )
      .join("")}</tbody></table>`;
}

async function adminFeedback() {
  const { feedback } = await api("/admin/feedback?limit=100&offset=0");
  $("#admin-content").innerHTML = `
    <h3>Feedback (latest 100)</h3>
    <table><thead><tr><th>When</th><th>User</th><th>Rating</th><th>Comment</th><th>Prompt</th></tr></thead>
    <tbody>${feedback
      .map(
        (f) => `<tr>
          <td>${fmt(f.createdAt)}</td><td>${esc(f.userEmail)}</td><td>${f.rating}/5</td>
          <td>${esc(f.comment ?? "—")}</td><td class="mono">${esc((f.promptExcerpt || "").slice(0, 80))}</td>
        </tr>`,
      )
      .join("")}</tbody></table>`;
}

async function adminLogs() {
  const { logs } = await api("/admin/logs?limit=100&offset=0");
  $("#admin-content").innerHTML = `
    <h3>Audit logs (latest 100)</h3>
    <table><thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Target</th></tr></thead>
    <tbody>${logs
      .map(
        (l) => `<tr><td>${fmt(l.createdAt)}</td><td class="mono">${esc(l.action)}</td><td class="mono">${esc(l.actorId ?? "system")}</td><td>${esc(l.targetType ?? "")} ${esc(l.targetId ?? "")}</td></tr>`,
      )
      .join("")}</tbody></table>`;
}

async function adminTraining() {
  const { stats } = await api("/admin/training");
  $("#admin-content").innerHTML = `
    <h3>Training data</h3>
    <div class="row">
      <div class="grow"><strong>${stats.optInCount}</strong> / ${stats.totalUsers} users opted in</div>
      <div class="grow"><strong>${stats.datasetPromptCount}</strong> prompts in the dataset</div>
    </div>
    <p class="muted">Training data is collected only from users who explicitly opted in, and only for records created after opt-in. Users can revoke at any time.</p>`;
}

async function adminModels() {
  const { models } = await api("/admin/models?limit=200&offset=0");
  $("#admin-content").innerHTML = `
    <h3>Provider / model metadata</h3>
    ${models.length === 0
      ? `<p class="muted">No models recorded yet.</p>`
      : `<table><thead><tr><th>Provider</th><th>Model</th><th>Uses</th><th>First seen</th><th>Last seen</th></tr></thead>
         <tbody>${models
           .map(
             (m) => `<tr><td>${esc(m.provider)}</td><td class="mono">${esc(m.model)}</td><td>${m.usageCount}</td><td>${fmt(m.firstSeenAt)}</td><td>${fmt(m.lastSeenAt)}</td></tr>`,
           )
           .join("")}</tbody></table>`}`;
}

async function adminRepositories() {
  const data = await api("/admin/workspace");
  const totals = data.totals || {};
  $("#admin-content").innerHTML = `
    <h3>Repository analytics</h3>
    <div class="row">
      <div class="grow"><strong>${totals.repos}</strong> repositories</div>
      <div class="grow"><strong>${totals.files}</strong> indexed files</div>
      <div class="grow"><strong>${totals.embeddings}</strong> embeddings</div>
      <div class="grow"><strong>${totals.checkpoints}</strong> checkpoints</div>
      <div class="grow"><strong>${totals.patches}</strong> patches</div>
      <div class="grow"><strong>${totals.searches}</strong> searches</div>
    </div>
    <h3>By language</h3>
    ${data.repositories.length === 0
      ? `<p class="muted">No repositories synced.</p>`
      : `<table><thead><tr><th>Language</th><th>Repositories</th><th>Files</th></tr></thead>
         <tbody>${data.repositories
           .map((r) => `<tr><td>${esc(r.language)}</td><td>${r.count}</td><td>${r.files}</td></tr>`)
           .join("")}</tbody></table>`}`;
}

async function adminUsage() {
  const { usage } = await api("/admin/usage?days=14");
  const max = Math.max(1, ...usage.promptsPerDay.map((d) => d.count));
  $("#admin-content").innerHTML = `
    <h3>Usage — last ${usage.days} days</h3>
    <div class="bar-chart">${usage.promptsPerDay
      .map(
        (d) => `<div style="flex:1"><div class="bar" style="height:${Math.round((d.count / max) * 60)}px" title="${d.day}: ${d.count}"></div><div class="bar-label">${d.day.slice(5)}</div></div>`,
      )
      .join("")}</div>
    <div class="row">
      <div class="grow">By provider: ${usage.byProvider.map((p) => `${esc(p.provider)}=${p.count}`).join(", ") || "—"}</div>
      <div class="grow">Avg latency: ${usage.avgLatencyMs ?? "—"} ms</div>
      <div class="grow">Tokens: ${usage.totalTokens}</div>
    </div>
    <h3>Top models</h3>
    <table><thead><tr><th>Model</th><th>Count</th></tr></thead>
    <tbody>${usage.byModel.map((m) => `<tr><td>${esc(m.model)}</td><td>${m.count}</td></tr>`).join("")}</tbody></table>`;
}

// ----------------------------------------------------------------- boot

function render() {
  const nav = $("#nav");
  const chip = $("#user-chip");
  const adminLink = $("#admin-link");

  if (!state.token) {
    nav.hidden = true;
    chip.hidden = true;
    adminLink.hidden = true;
    viewLogin();
    return;
  }

  api("/auth/session")
    .then(({ user }) => {
      state.user = user;
      nav.hidden = false;
      chip.hidden = false;
      chip.textContent = `${user.email} · ${user.role}`;
      adminLink.hidden = !(user.role === "admin" || user.role === "superadmin");

      const route = (location.hash || "#/overview").slice(2) || "overview";
      document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#/${route}`));
      if (route === "admin") {
        if (user.role === "admin" || user.role === "superadmin") viewAdmin();
        else viewOverview(user);
      } else if (route === "history") viewHistory();
      else if (route === "keys") viewKeys();
      else if (route === "workspace") viewWorkspace(user);
      else if (route === "settings") viewSettings(user);
      else viewOverview(user);
    })
    .catch(() => {
      state.token = null;
      localStorage.removeItem("coder.token");
      viewLogin();
    });
}

$("#logout").addEventListener("click", async () => {
  try {
    await api("/auth/logout", { method: "POST" });
  } catch {
    /* best effort */
  }
  state.token = null;
  localStorage.removeItem("coder.token");
  render();
});

window.addEventListener("hashchange", render);
render();
