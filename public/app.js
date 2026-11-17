
"use strict";

let mode = "login";
let me = null;

const $ = (s) => document.querySelector(s);
const money = (n) => "₹" + (Number(n || 0) / 100).toFixed(2);

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[c]);
}

function toast(message) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.style.display = "none", 2800);
}

async function api(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || "Request failed");
  return d;
}

function openAuth() {
  $("#authModal")?.classList.remove("hidden");
}

function closeAuth() {
  $("#authModal")?.classList.add("hidden");
}

function setMode(m) {
  mode = m;
  $("#authTitle").textContent = m === "login" ? "Sign in" : "Create account";
  $("#authSubmit").textContent = m === "login" ? "Sign in" : "Create account";
  $("#nameField").classList.toggle("hidden", m === "login");
  $("#switchAuth").textContent = m === "login"
    ? "Create an account"
    : "Already registered? Sign in";
  $("#authError").textContent = "";
}

function renderGuest() {
  me = null;
  $("#sessionState").textContent = "Guest view";
  $("#accountRole").textContent = "Guest";
  $("#balance").textContent = "Sign in";
  $("#orderCount").textContent = "—";
  $("#admin").classList.add("hidden");
  $("#orders").textContent = "Log in to view your orders and transactions.";
}

async function refresh() {
  const d = await api("/api/me");
  me = d.user || null;

  if (!me) {
    renderGuest();
    return;
  }

  $("#sessionState").textContent = me.email || "User";
  $("#accountRole").textContent = me.role || "customer";
  $("#balance").textContent = money(me.wallet_cents);
  $("#admin").classList.toggle("hidden", me.role !== "admin");

  const [orders, tx] = await Promise.all([
    api("/api/orders"),
    api("/api/transactions")
  ]);

  $("#orderCount").textContent = orders.length;

  $("#orders").innerHTML = `
    <h3>Recent Orders</h3>
    ${orders.slice(0, 5).map(o => `
      <p>#${o.id} · ${esc(o.service_name)} · ${esc(o.status)} · ${money(o.amount_cents)}</p>
    `).join("") || "<p>No orders yet.</p>"}
    <h3>Payment & Transaction History</h3>
    ${tx.slice(0, 5).map(t => `
      <p>${esc(t.kind)} · ${money(t.amount_cents)} · ${esc(t.status)}</p>
    `).join("") || "<p>No transactions yet.</p>"}
  `;
}

async function loadServices() {
  const services = await api("/api/services");

  $("#serviceGrid").innerHTML = services.map(s => `
    <article class="service">
      <div class="symbol">✦</div>
      <span class="pill">${esc(s.category)}</span>
      <h3>${esc(s.name)}</h3>
      <p>${esc(s.description)}</p>
      <div class="price">${money(s.price_cents)}</div>
      <button class="btn gold order" data-id="${Number(s.id)}">
        Place request ↗
      </button>
    </article>
  `).join("");

  document.querySelectorAll(".order").forEach(button => {
    button.onclick = async () => {
      if (!me) {
        openAuth();
        return;
      }

      const details = prompt("Describe your request (only for accounts or content you own or manage):");
      if (!details || details.trim().length < 3) return;

      try {
        await api("/api/orders", {
          method: "POST",
          body: JSON.stringify({
            service_id: Number(button.dataset.id),
            details: details.trim()
          })
        });
        toast("Request placed successfully.");
        await refresh();
      } catch (e) {
        toast(e.message);
      }
    };
  });
}

// AUTH BUTTONS

$("#authBtn").onclick = openAuth;
$("#openAuth").onclick = openAuth;
$("#closeAuth").onclick = closeAuth;

$("#switchAuth").onclick = () => {
  setMode(mode === "login" ? "register" : "login");
};

// LOGIN / REGISTER

$("#authForm").onsubmit = async (event) => {
  event.preventDefault();

  const button = $("#authSubmit");
  const error = $("#authError");
  const form = new FormData(event.target);

  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "").trim();
  const password = String(form.get("password") || "");

  error.textContent = "";

  if (mode === "register" && !name) {
    error.textContent = "Please enter your name.";
    return;
  }

  if (!email || !password) {
    error.textContent = "Email and password are required.";
    return;
  }

  if (mode === "register" && password.length < 10) {
    error.textContent = "Password must be at least 10 characters.";
    return;
  }

  button.disabled = true;

  try {
    const d = await api("/api/" + mode, {
      method: "POST",
      body: JSON.stringify({ name, email, password })
    });

    if (!d.user || !d.user.id) {
      throw Error("Account information not received.");
    }

    const loggedInUser = d.user;
    closeAuth();
    event.target.reset();

    await refresh();

    if (!me) {
      throw Error("Login session was not saved. Check server session settings.");
    }

    toast("Welcome, " + (me.name || loggedInUser.name || "User"));
  } catch (e) {
    error.textContent = e.message;
    openAuth();
  } finally {
    button.disabled = false;
  }
};

// LOGOUT

$("#logout").onclick = async () => {
  try {
    await api("/api/logout", { method: "POST" });
    renderGuest();
    toast("Logged out successfully.");
  } catch (e) {
    toast(e.message);
  }
};

// REFRESH

$("#refresh").onclick = async () => {
  try {
    await refresh();
    await loadServices();
    toast("Dashboard refreshed.");
  } catch (e) {
    toast(e.message);
  }
};

// ADMIN: CREATE SERVICE

$("#serviceForm").onsubmit = async (event) => {
  event.preventDefault();
  const f = new FormData(event.target);

  try {
    await api("/api/admin/services", {
      method: "POST",
      body: JSON.stringify({
        name: f.get("name"),
        category: f.get("category"),
        description: f.get("description"),
        price_cents: Math.round(Number(f.get("price")) * 100)
      })
    });

    event.target.reset();
    await loadServices();
    toast("Service created successfully.");
  } catch (e) {
    toast(e.message);
  }
};

// ADMIN: WALLET

$("#walletForm").onsubmit = async (event) => {
  event.preventDefault();
  const f = new FormData(event.target);

  try {
    await api("/api/admin/wallet-adjust", {
      method: "POST",
      body: JSON.stringify({
        user_id: Number(f.get("user_id")),
        amount_cents: Number(f.get("amount_cents"))
      })
    });

    event.target.reset();
    await refresh();
    toast("Wallet updated successfully.");
  } catch (e) {
    toast(e.message);
  }
};

// ADMIN: USERS

$("#loadUsers").onclick = async () => {
  try {
    const users = await api("/api/admin/users");

    $("#adminOutput").innerHTML = `
      <h3>Registered Users</h3>
      ${users.map(u => `
        <p>#${u.id} · ${esc(u.name)} · ${esc(u.email)} · ${money(u.wallet_cents)} · ${esc(u.role)}</p>
      `).join("") || "<p>No users found.</p>"}
    `;
  } catch (e) {
    toast(e.message);
  }
};

// ADMIN: ORDERS

$("#loadAdminOrders").onclick = async () => {
  try {
    const orders = await api("/api/orders");

    $("#adminOutput").innerHTML = `
      <h3>All Orders</h3>
      ${orders.map(o => `
        <div class="admin-order">
          <p>#${o.id} · ${esc(o.email || "")} · ${esc(o.service_name)} · ${money(o.amount_cents)}</p>
          <select data-order="${o.id}">
            <option value="pending" ${o.status === "pending" ? "selected" : ""}>Pending</option>
            <option value="processing" ${o.status === "processing" ? "selected" : ""}>Processing</option>
            <option value="completed" ${o.status === "completed" ? "selected" : ""}>Completed</option>
            <option value="cancelled" ${o.status === "cancelled" ? "selected" : ""}>Cancelled</option>
          </select>
          <button class="btn outline tiny" data-save="${o.id}">Update</button>
        </div>
      `).join("") || "<p>No orders found.</p>"}
    `;

    document.querySelectorAll("[data-save]").forEach(button => {
      button.onclick = async () => {
        const id = button.dataset.save;
        const select = document.querySelector(`[data-order="${id}"]`);

        try {
          await api("/api/admin/orders/" + id, {
            method: "PATCH",
            body: JSON.stringify({ status: select.value })
          });
          toast("Order updated.");
        } catch (e) {
          toast(e.message);
        }
      };
    });
  } catch (e) {
    toast(e.message);
  }
};

// FOOTER YEAR

$("#year").textContent = new Date().getFullYear();

// START APP

(async () => {
  setMode("login");

  try {
    await refresh();
    await loadServices();
  } catch (e) {
    toast("Dashboard connection error: " + e.message);
  }
})();
  
