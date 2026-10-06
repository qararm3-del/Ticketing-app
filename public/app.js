const API = "/api";
let token = localStorage.getItem("flynext_token");
let currentLead = null;

const categories = [
  "Fresh Ticket",
  "Reissue",
  "Date Change",
  "Sector Change",
  "Fare",
  "Availability",
  "Refund"
];

const statuses = [
  "New",
  "Contacted",
  "Quote",
  "Won",
  "Lost"
];

const channels = [
  "WhatsApp",
  "Facebook",
  "Instagram",
  "TikTok",
  "YouTube",
  "Manual"
];

async function api(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  const res = await fetch(API + url, {
    ...options,
    headers
  });

  if (res.status === 401) {
    logout();
    throw new Error("Session expired");
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function login() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const error = document.getElementById("loginError");
  error.textContent = "";

  if (!email || !password) {
    error.textContent = "Email aur password enter karein.";
    return;
  }

  try {
    const data = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });

    token = data.token;
    localStorage.setItem("flynext_token", token);

    showApp(data.user);
    await load();
  } catch (e) {
    error.textContent = e.message;
  }
}

function logout() {
  token = null;
  currentLead = null;
  localStorage.removeItem("flynext_token");

  document.getElementById("app").classList.add("hidden");
  document.getElementById("login").classList.remove("hidden");
}

function showApp(user) {
  document.getElementById("login").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");

  document.getElementById("userName").textContent =
    user?.name || "Admin";
}

async function load() {
  try {
    setupFilters();
    await loadDashboard();
    await loadLeads();
  } catch (e) {
    console.error(e);
  }
}

function setupFilters() {
  fillSelect("status", statuses);
  fillSelect("category", categories);
  fillSelect("channel", channels);

  const quick = document.getElementById("quick");

  if (quick && !quick.dataset.ready) {
    quick.innerHTML = categories.map(c =>
      `<button onclick="quickCategory('${esc(c)}')">${esc(c)}</button>`
    ).join("");

    quick.dataset.ready = "1";
  }

  const newChannel = document.getElementById("newChannel");
  const newCategory = document.getElementById("newCategory");

  if (newChannel && !newChannel.dataset.ready) {
    newChannel.innerHTML =
      channels.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    newChannel.dataset.ready = "1";
  }

  if (newCategory && !newCategory.dataset.ready) {
    newCategory.innerHTML =
      categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    newCategory.dataset.ready = "1";
  }
}

function fillSelect(id, values) {
  const el = document.getElementById(id);
  if (!el || el.dataset.ready) return;

  el.innerHTML =
    `<option value="">All</option>` +
    values.map(v =>
      `<option value="${esc(v)}">${esc(v)}</option>`
    ).join("");

  el.dataset.ready = "1";
}

async function loadDashboard() {
  const data = await api("/dashboard");
  const stats = document.getElementById("stats");

  const cards = [
    ["Total Leads", data.total],
    ["New", data.stats?.New || 0],
    ["Contacted", data.stats?.Contacted || 0],
    ["Quote", data.stats?.Quote || 0],
    ["Won", data.stats?.Won || 0],
    ["Lost", data.stats?.Lost || 0]
  ];

  stats.innerHTML = cards.map(([name, value]) => `
    <div class="stat">
      <b>${esc(value)}</b>
      <span>${esc(name)}</span>
    </div>
  `).join("");
}

async function loadLeads() {
  if (!token) return;

  const search = document.getElementById("search")?.value || "";
  const status = document.getElementById("status")?.value || "";
  const category = document.getElementById("category")?.value || "";
  const channel = document.getElementById("channel")?.value || "";

  const params = new URLSearchParams();

  if (search) params.set("q", search);
  if (status) params.set("status", status);
  if (category) params.set("category", category);
  if (channel) params.set("channel", channel);

  try {
    const leads = await api("/leads?" + params.toString());

    document.getElementById("count").textContent =
      `${leads.length} leads`;

    const box = document.getElementById("leads");

    if (!leads.length) {
      box.innerHTML =
        `<div class="empty">No ticket leads found.</div>`;
      return;
    }

    box.innerHTML = leads.map(lead => `
      <div class="lead ${currentLead?.id === lead.id ? "active" : ""}"
           onclick="selectLead(${lead.id})">

        <div class="lead-head">
          <span class="lead-name">${esc(lead.customer_name)}</span>
          <span class="badge">${esc(lead.status)}</span>
        </div>

        <div class="meta">
          ${esc(lead.channel)} • ${esc(lead.category)}
        </div>

        <div class="meta">
          ${esc(lead.route || "Route not specified")}
        </div>

        <div class="meta">
          ${esc(lead.message || "")}
        </div>

      </div>
    `).join("");

  } catch (e) {
    console.error(e);
  }
}

async function selectLead(id) {
  try {
    const leads = await api("/leads");
    currentLead = leads.find(x => x.id === id);

    if (!currentLead) return;

    renderDetail();

    const messages = await api(`/leads/${id}/messages`);
    renderMessages(messages);

    await loadLeads();
  } catch (e) {
    console.error(e);
  }
}

function renderDetail() {
  const d = document.getElementById("detail");

  d.innerHTML = `
    <div class="detail-top">

      <h2>${esc(currentLead.customer_name)}</h2>

      <div class="meta">
        ${esc(currentLead.channel)}
        •
        ${esc(currentLead.category)}
        •
        ${esc(currentLead.route || "No route")}
      </div>

      <div style="margin-top:10px">
        <select onchange="changeStatus(this.value)">
          ${statuses.map(s =>
            `<option value="${esc(s)}"
              ${s === currentLead.status ? "selected" : ""}>
              ${esc(s)}
            </option>`
          ).join("")}
        </select>
      </div>

    </div>

    <div class="detail-body" id="messages">
      Loading conversation...
    </div>

    <div class="composer">
      <textarea
        id="replyText"
        placeholder="Type your reply..."
      ></textarea>

      <button onclick="sendReply()">Send</button>
    </div>
  `;
}

function renderMessages(messages) {
  const box = document.getElementById("messages");
  if (!box) return;

  if (!messages.length) {
    box.innerHTML = `
      <div class="empty" style="min-height:180px">
        No messages yet.
      </div>
    `;
    return;
  }

  box.innerHTML = messages.map(m => `
    <div class="msg">
      <b>${m.direction === "outbound" ? "You" : "Customer"}</b>
      <div>${esc(m.body)}</div>
      <div class="meta">${esc(m.channel)}</div>
    </div>
  `).join("");
}

async function changeStatus(status) {
  if (!currentLead) return;

  try {
    currentLead = await api(`/leads/${currentLead.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });

    await loadDashboard();
    await loadLeads();
  } catch (e) {
    alert(e.message);
  }
}

async function sendReply() {
  if (!currentLead) return;

  const box = document.getElementById("replyText");
  const body = box.value.trim();

  if (!body) return;

  try {
    await api(`/leads/${currentLead.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ body })
    });

    box.value = "";

    const messages =
      await api(`/leads/${currentLead.id}/messages`);

    renderMessages(messages);
    await loadDashboard();
    await loadLeads();

  } catch (e) {
    alert(e.message);
  }
}

function quickCategory(category) {
  const select = document.getElementById("category");

  if (select) {
    select.value = category;
    loadLeads();
  }
}

function openLead() {
  document.getElementById("modal").classList.remove("hidden");
}

function closeLead() {
  document.getElementById("modal").classList.add("hidden");
}

async function createLead() {
  const customer_name =
    document.getElementById("newName").value.trim();

  const channel =
    document.getElementById("newChannel").value;

  const category =
    document.getElementById("newCategory").value;

  const route =
    document.getElementById("newRoute").value.trim();

  const message =
    document.getElementById("newMessage").value.trim();

  if (!customer_name) {
    alert("Customer / Agent name required.");
    return;
  }

  try {
    const lead = await api("/leads", {
      method: "POST",
      body: JSON.stringify({
        customer_name,
        channel,
        category,
        route,
        message
      })
    });

    document.getElementById("newName").value = "";
    document.getElementById("newRoute").value = "";
    document.getElementById("newMessage").value = "";

    closeLead();

    await loadDashboard();
    await loadLeads();
    await selectLead(lead.id);

  } catch (e) {
    alert(e.message);
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  if (token) {
    try {
      const data = await api("/dashboard");
      showApp({ name: "Admin" });
      setupFilters();
      renderDashboardFromData(data);
      await loadLeads();
    } catch {
      logout();
    }
  }
});

function renderDashboardFromData(data) {
  const stats = document.getElementById("stats");

  const cards = [
    ["Total Leads", data.total],
    ["New", data.stats?.New || 0],
    ["Contacted", data.stats?.Contacted || 0],
    ["Quote", data.stats?.Quote || 0],
    ["Won", data.stats?.Won || 0],
    ["Lost", data.stats?.Lost || 0]
  ];

  stats.innerHTML = cards.map(([name, value]) => `
    <div class="stat">
      <b>${esc(value)}</b>
      <span>${esc(name)}</span>
    </div>
  `).join("");
};
