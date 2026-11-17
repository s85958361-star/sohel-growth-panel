"use strict";

const $ = selector => document.querySelector(selector);
let me = null;
let mode = "login";
let servicesCache = [];

const money = cents =>
  "₹" + (Number(cents || 0) / 100).toFixed(2);

function toast(message) {
  const box = $("#toast");
  box.textContent = message;
  box.classList.add("show");
  setTimeout(() => box.classList.remove("show"), 3000);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function show(element, visible) {
  if (element) element.classList.toggle("hidden", !visible);
}

function openAuth() {
  show($("#authModal"), true);
}

function closeAuth() {
  show($("#authModal"), false);
  $("#authError").textContent = "";
}

function setMode(next) {
  mode = next;
  const register = mode === "register";

  $("#authTitle").textContent = register ? "Create Account" : "Login";
  $("#authSubmit").textContent = register ? "Create Account" : "Login";
  $("#switchText").textContent = register ? "Already registered?" : "New here?";
  $("#switchAuth").textContent = register ? "Login" : "Create account";

  show($("#nameField"), register);
  show($("#referralField"), register);
  $("#authError").textContent = "";
}

function renderGuest() {
  me = null;
  show($("#dashboard"), false);
  show($("#wallet"), false);
  show($("#referral"), false);
  show($("#support"), false);
  show($("#admin"), false);
  show($("#menuLogout"), false);
  show($("#menuAuth"), true);
  $("#sessionState").textContent = "Please login to access your dashboard.";
  $("#authBtn") && ($("#authBtn").textContent = "Login / Register");
}

function renderUser(user) {
  me = user;
  show($("#dashboard"), true);
  show($("#wallet"), true);
  show($("#referral"), true);
  show($("#support"), true);
  show($("#menuLogout"), true);
  show($("#menuAuth"), false);
  show($("#admin"), user.role === "admin");

  $("#balance").textContent = money(user.wallet_cents);
  $("#accountRole").textContent = user.role === "admin" ? "Admin" : "User";
  $("#sessionState").textContent = "Welcome, " + user.name;
  $("#referralCode").textContent = user.referral_code || "Not available";

  refresh();
}

async function refresh() {
  if (!me) return;

  try {
    const [profile, orderData, transactionData, paymentData] = await Promise.all([
      api("/api/me"),
      api("/api/orders"),
      api("/api/transactions"),
      api("/api/payments")
    ]);

    if (!profile.user) {
      renderGuest();
      return;
    }

    me = profile.user;
    $("#balance").textContent = money(me.wallet_cents);
    $("#orderCount").textContent = orderData.orders.length;

    $("#orders").innerHTML = orderData.orders.length
      ? orderData.orders.map(order => `
        <div class="dataItem">
          <strong>#${order.id} · ${escapeHtml(order.service_name || "Service")}</strong>
          <span>${money(order.amount_cents)}</span>
          <small>Status: ${escapeHtml(order.status)}</small>
        </div>`).join("")
      : "<p>No orders yet.</p>";

    $("#transactions").innerHTML = transactionData.transactions.length
      ? transactionData.transactions.map(item => `
        <div class="dataItem">
          <strong>${escapeHtml(item.kind)}</strong>
          <span>${money(item.amount_cents)}</span>
          <small>${escapeHtml(item.status)} · ${escapeHtml(item.reference || "")}</small>
        </div>`).join("")
      : "<p>No transactions yet.</p>";

    $("#payments").innerHTML = paymentData.payments.length
      ? paymentData.payments.map(item => `
        <div class="dataItem">
          <strong>Payment #${item.id}</strong>
          <span>${money(item.amount_cents)}</span>
          <small>${escapeHtml(item.status)} · Ref: ${escapeHtml(item.reference)}</small>
        </div>`).join("")
      : "<p>No payment requests yet.</p>";

    await loadReferrals();
    if (me.role === "admin") await loadAdminSummary();
  } catch (err) {
    toast(err.message);
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#039;"
  })[char]);
}

async function loadServices() {
  try {
    const data = await api("/api/services");
    servicesCache = data.services;

    $("#serviceGrid").innerHTML = data.services.map(service => `
      <article class="serviceCard">
        <p class="eyebrow">${escapeHtml(service.category)}</p>
        <h3>${escapeHtml(service.name)}</h3>
        <p>${escapeHtml(service.description)}</p>
        <div class="serviceBottom">
          <strong>${money(service.price_cents)}</strong>
          <button class="primary orderBtn" data-id="${service.id}">Order</button>
        </div>
      </article>
    `).join("") || "<p>No services available.</p>";
  } catch (err) {
    toast(err.message);
  }
}

async function loadReferrals() {
  const data = await api("/api/referrals");

  $("#referrals").innerHTML = data.referrals.length
    ? data.referrals.map(item => `
      <div class="dataItem">
        <strong>${escapeHtml(item.referred_name)}</strong>
        <small>Joined: ${new Date(item.created_at).toLocaleDateString()}</small>
      </div>`).join("")
    : "<p>No referrals yet.</p>";
}

async function loadAdminSummary() {
  const data = await api("/api/admin/summary");
  $("#totalUsers").textContent = data.users;
  $("#totalOrders").textContent = data.orders;
  $("#pendingPayments").textContent = data.pending_payments;
}

async function loadUsers() {
  const data = await api("/api/admin/users");

  $("#usersOutput").innerHTML = data.users.map(user => `
    <div class="dataItem">
      <strong>${escapeHtml(user.name)} · ID ${user.id}</strong>
      <small>${escapeHtml(user.email)} · Wallet ${money(user.wallet_cents)}</small>
      <small>${user.blocked ? "Blocked" : "Active"} · ${escapeHtml(user.role)}</small>
      ${user.role !== "admin" ? `
        <button class="secondary blockUser" data-id="${user.id}" data-blocked="${!user.blocked}">
          ${user.blocked ? "Unblock" : "Block"}
        </button>` : ""}
    </div>
  `).join("") || "<p>No users.</p>";
}

async function loadAdminOrders() {
  const data = await api("/api/admin/orders");

  $("#adminOrdersOutput").innerHTML = data.orders.map(order => `
    <div class="dataItem">
      <strong>Order #${order.id} · ${escapeHtml(order.service_name || "Service")}</strong>
      <small>${escapeHtml(order.user_name)} (${escapeHtml(order.email)})</small>
      <small>${escapeHtml(order.details)}</small>
      <small>${money(order.amount_cents)} · ${escapeHtml(order.status)}</small>
      <select class="orderStatus" data-id="${order.id}">
        ${["pending","processing","completed","cancelled"].map(status =>
          `<option value="${status}" ${order.status === status ? "selected" : ""}>${status}</option>`
        ).join("")}
      </select>
      <button class="secondary saveOrder" data-id="${order.id}">Update</button>
    </div>
  `).join("") || "<p>No orders.</p>";
}

async function loadPayments() {
  const data = await api("/api/admin/payments");

  $("#adminPaymentsOutput").innerHTML = data.payments.map(payment => `
    <div class="dataItem">
      <strong>Payment #${payment.id} · ${money(payment.amount_cents)}</strong>
      <small>${escapeHtml(payment.user_name)} · ${escapeHtml(payment.email)}</small>
      <small>Reference: ${escapeHtml(payment.reference)}</small>
      <small>Status: ${escapeHtml(payment.status)}</small>
      ${payment.status === "pending" ? `
        <button class="primary reviewPayment" data-id="${payment.id}" data-status="approved">Approve</button>
        <button class="secondary reviewPayment" data-id="${payment.id}" data-status="rejected">Reject</button>` : ""}
    </div>
  `).join("") || "<p>No payment requests.</p>";
}

async function loadSupport() {
  const data = await api("/api/admin/support");

  $("#adminSupportOutput").innerHTML = data.messages.map(message => `
    <div class="dataItem">
      <strong>${escapeHtml(message.name)} · ${escapeHtml(message.email)}</strong>
      <p>${escapeHtml(message.message)}</p>
      <small>Status: ${escapeHtml(message.status)}</small>
      ${message.status === "open" ? `
        <button class="secondary closeSupport" data-id="${message.id}">Close Message</button>` : ""}
    </div>
  `).join("") || "<p>No messages.</p>";
}

// AUTH
$("#openAuth").addEventListener("click", openAuth);
$("#menuAuth").addEventListener("click", openAuth);
$("#closeAuth").addEventListener("click", closeAuth);

$("#switchAuth").addEventListener("click", () => {
  setMode(mode === "login" ? "register" : "login");
});

$("#authForm").addEventListener("submit", async event => {
  event.preventDefault();

  const form = new FormData(event.currentTarget);
  const body = Object.fromEntries(form.entries());

  try {
    const data = await api(
      mode === "register" ? "/api/register" : "/api/login",
      { method: "POST", body: JSON.stringify(body) }
    );

    renderUser(data.user);
    closeAuth();
    toast("Welcome!");
  } catch (err) {
    $("#authError").textContent = err.message;
  }
});

$("#menuLogout").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
    renderGuest();
    toast("Logged out.");
  } catch (err) {
    toast(err.message);
  }
});

// MENU
$("#menuToggle").addEventListener("click", () => {
  $("#mainMenu").classList.toggle("hidden");
});

$("#adminMenuToggle").addEventListener("click", () => {
  $("#adminMenu").classList.toggle("hidden");
});

// ORDER
$("#serviceGrid").addEventListener("click", async event => {
  const button = event.target.closest(".orderBtn");
  if (!button) return;

  if (!me) {
    setMode("login");
    openAuth();
    return;
  }

  const details = prompt("Enter the details needed for this service:");
  if (!details || !details.trim()) return;

  try {
    await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        service_id: Number(button.dataset.id),
        details: details.trim()
      })
    });
    toast("Order created.");
    await refresh();
  } catch (err) {
    toast(err.message);
  }
});

// PAYMENT REQUEST
$("#paymentForm").addEventListener("submit", async event => {
  event.preventDefault();

  const form = new FormData(event.currentTarget);
  const body = Object.fromEntries(form.entries());

  try {
    await api("/api/payments/request", {
      method: "POST",
      body: JSON.stringify(body)
    });
    event.currentTarget.reset();
    toast("Payment request submitted for verification.");
    await refresh();
  } catch (err) {
    toast(err.message);
  }
});

// REFERRAL COPY
$("#copyReferral").addEventListener("click", async () => {
  if (!me || !me.referral_code) return toast("Please login first.");

  try {
    await navigator.clipboard.writeText(me.referral_code);
    toast("Referral code copied.");
  } catch {
    toast("Copy not supported by this browser.");
  }
});

// SUPPORT
$("#supportForm").addEventListener("submit", async event => {
  event.preventDefault();
  const message = new FormData(event.currentTarget).get("message");

  try {
    await api("/api/support", {
      method: "POST",
      body: JSON.stringify({ message })
    });
    event.currentTarget.reset();
    toast("Message sent.");
  } catch (err) {
    toast(err.message);
  }
});

// ADMIN: ADD SERVICE
$("#serviceForm").addEventListener("submit", async event => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget).entries());

  try {
    await api("/api/admin/services", {
      method: "POST",
      body: JSON.stringify(body)
    });
    event.currentTarget.reset();
    toast("Service added.");
    await loadServices();
  } catch (err) {
    toast(err.message);
  }
});

// ADMIN: WALLET
$("#walletForm").addEventListener("submit", async event => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget).entries());

  try {
    await api("/api/admin/wallet-adjust", {
      method: "POST",
      body: JSON.stringify(body)
    });
    event.currentTarget.reset();
    toast("Wallet updated.");
    await refresh();
  } catch (err) {
    toast(err.message);
  }
});

$("#loadUsers").addEventListener("click", () => loadUsers().catch(e => toast(e.message)));
$("#loadAdminOrders").addEventListener("click", () => loadAdminOrders().catch(e => toast(e.message)));
$("#loadPayments").addEventListener("click", () => loadPayments().catch(e => toast(e.message)));
$("#loadSupport").addEventListener("click", () => loadSupport().catch(e => toast(e.message)));
$("#refresh").addEventListener("click", refresh);

$("#usersOutput").addEventListener("click", async event => {
  const button = event.target.closest(".blockUser");
  if (!button) return;

  try {
    await api(`/api/admin/users/${button.dataset.id}/block`, {
      method: "PATCH",
      body: JSON.stringify({ blocked: button.dataset.blocked === "true" })
    });
    toast("User updated.");
    await loadUsers();
  } catch (err) {
    toast(err.message);
  }
});

$("#adminOrdersOutput").addEventListener("click", async event => {
  const button = event.target.closest(".saveOrder");
  if (!button) return;

  const select = document.querySelector(`.orderStatus[data-id="${button.dataset.id}"]`);

  try {
    await api(`/api/admin/orders/${button.dataset.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: select.value })
    });
    toast("Order updated.");
    await loadAdminOrders();
    await refresh();
  } catch (err) {
    toast(err.message);
  }
});

$("#adminPaymentsOutput").addEventListener("click", async event => {
  const button = event.target.closest(".reviewPayment");
  if (!button) return;

  const decision = button.dataset.status;
  const confirmText = decision === "approved"
    ? "Approve only after independently verifying the payment?"
    : "Reject this payment request?";

  if (!confirm(confirmText)) return;

  try {
    await api(`/api/admin/payments/${button.dataset.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: decision })
    });
    toast("Payment reviewed.");
    await loadPayments();
    await refresh();
  } catch (err) {
    toast(err.message);
  }
});

$("#adminSupportOutput").addEventListener("click", async event => {
  const button = event.target.closest(".closeSupport");
  if (!button) return;

  try {
    await api(`/api/admin/support/${button.dataset.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "closed" })
    });
    toast("Message closed.");
    await loadSupport();
  } catch (err) {
    toast(err.message);
  }
});

$("#year").textContent = new Date().getFullYear();

async function start() {
  setMode("login");
  await loadServices();

  try {
    const data = await api("/api/me");
    if (data.user) renderUser(data.user);
    else renderGuest();
  } catch {
    renderGuest();
  }

  const referralFromUrl = new URLSearchParams(location.search).get("ref");
  if (referralFromUrl) {
    setMode("register");
    $("#authForm").elements.referral.value = referralFromUrl;
  }
}

start();
      
