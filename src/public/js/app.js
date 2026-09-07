// State client-side
const state = {
  currentTab: "overview",
  groups: [],
  services: [],
  members: [],
  transactions: [],
  history: [],
  currentServiceForMembers: null,
  currentBatchId: null,
  serviceBatches: [],
  currentBatch: null,
  currentTxFilter: "all",
  searchQuery: "",
  searchDebounceTimer: null,
  adminUsers: [],
};


let currentBatchMembers = [];

// Khởi chạy khi DOM sẵn sàng
document.addEventListener("DOMContentLoaded", async () => {
  checkAuth();
  lucide.createIcons();
});

// ==========================================
// 1. AUTHENTICATION & SESSION (MULTI-USER)
// ==========================================
let currentUser = null;

async function checkAuth() {
  try {
    const res = await fetch("/api/auth/check");
    const data = await res.json();
    if (data.authenticated && data.user) {
      currentUser = data.user;
      showApp();
    } else {
      currentUser = null;
      showLogin();
    }
  } catch (err) {
    console.error("Lỗi kiểm tra session:", err);
    showLogin();
  }
}

function switchAuthTab(tab) {
  const loginForm = document.getElementById("loginForm");
  const regForm = document.getElementById("registerForm");
  const tabBtnLogin = document.getElementById("tabBtnLogin");
  const tabBtnReg = document.getElementById("tabBtnRegister");

  if (tab === "login") {
    if (loginForm) loginForm.style.display = "block";
    if (regForm) regForm.style.display = "none";
    if (tabBtnLogin) {
      tabBtnLogin.style.background = "#6366f1";
      tabBtnLogin.style.color = "#fff";
    }
    if (tabBtnReg) {
      tabBtnReg.style.background = "transparent";
      tabBtnReg.style.color = "#94a3b8";
    }
  } else {
    if (loginForm) loginForm.style.display = "none";
    if (regForm) regForm.style.display = "block";
    if (tabBtnReg) {
      tabBtnReg.style.background = "#10b981";
      tabBtnReg.style.color = "#fff";
    }
    if (tabBtnLogin) {
      tabBtnLogin.style.background = "transparent";
      tabBtnLogin.style.color = "#94a3b8";
    }
  }
  lucide.createIcons();
}

function showLogin() {
  document.getElementById("loginScreen").style.display = "flex";
  document.getElementById("appScreen").style.display = "none";
  switchAuthTab("login");
  lucide.createIcons();
}

function showApp() {
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("appScreen").style.display = "flex";
  renderUserProfile();
  loadDashboardData();
  lucide.createIcons();
}

function renderUserProfile() {
  if (!currentUser) return;
  const name = currentUser.fullName || currentUser.username || "User";
  const avatarChar = name.charAt(0).toUpperCase();

  const userDisplayName = document.getElementById("userDisplayName");
  const userAvatarText = document.getElementById("userAvatarText");
  const currentLoggedUserName = document.getElementById("currentLoggedUserName");
  const navItemAdminUsers = document.getElementById("navItemAdminUsers");

  if (userDisplayName) userDisplayName.innerText = name;
  if (userAvatarText) userAvatarText.innerText = avatarChar;
  if (currentLoggedUserName) currentLoggedUserName.innerText = name;

  if (navItemAdminUsers) {
    const isAdmin = currentUser.role === "admin" || currentUser.username === "admin";
    navItemAdminUsers.style.display = isAdmin ? "flex" : "none";
  }
}


async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById("loginUsername") ? document.getElementById("loginUsername").value.trim() : "";
  const password = document.getElementById("loginPassword").value;
  const btn = document.getElementById("loginBtn");
  btn.disabled = true;
  btn.innerHTML = "<span>Đang xác thực...</span>";

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (data.success) {
      currentUser = data.user;
      showToast(`Chào mừng ${data.user?.fullName || data.user?.username}!`, "success");
      showApp();
    } else {
      showToast(data.error || "Sai thông tin đăng nhập", "error");
    }
  } catch (err) {
    showToast("Không thể kết nối tới máy chủ", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Đăng nhập Dashboard</span><i data-lucide="arrow-right"></i>';
    lucide.createIcons();
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById("regUsername").value.trim();
  const fullName = document.getElementById("regFullName").value.trim();
  const password = document.getElementById("regPassword").value;
  const confirmPassword = document.getElementById("regConfirmPassword").value;
  const btn = document.getElementById("regBtn");

  if (password !== confirmPassword) {
    showToast("Xác nhận mật khẩu không khớp. Vui lòng nhập lại!", "error");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = "<span>Đang khởi tạo tài khoản...</span>";

  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, fullName, password }),
    });
    const data = await res.json();

    if (data.success) {
      currentUser = data.user;
      showToast("Tạo tài khoản thành công! Chào mừng bạn!", "success");
      showApp();
    } else {
      showToast(data.error || "Lỗi khi đăng ký tài khoản", "error");
    }
  } catch (err) {
    showToast("Không thể kết nối tới máy chủ", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Tạo Tài Khoản Mới</span><i data-lucide="user-plus"></i>';
    lucide.createIcons();
  }
}

async function handleLogout() {
  showConfirmModal(
    "Đăng Xuất",
    "Bạn có chắc chắn muốn đăng xuất khỏi tài khoản này?",
    async () => {
      try {
        await fetch("/api/auth/logout", { method: "POST" });
        currentUser = null;
        showToast("Đã đăng xuất", "info");
        showLogin();
      } catch (err) {
        showToast("Lỗi khi đăng xuất", "error");
      }
    },
    {
      type: "logout",
      confirmText: "Đăng xuất",
      confirmIcon: "log-out",
      headerIcon: "log-out",
      headerColor: "#6366f1",
      btnClass: "btn btn-primary",
      btnStyle: "background: #6366f1; color: #fff;",
    }
  );
}


function togglePasswordVisibility(inputId) {
  const input = document.getElementById(inputId);
  input.type = input.type === "password" ? "text" : "password";
}

// ==========================================
// 2. NAVIGATION & TABS
// ==========================================
function switchTab(tabId) {
  state.currentTab = tabId;

  // Cập nhật nav active
  document.querySelectorAll(".sidebar-nav .nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });

  // Cập nhật tab pane
  document.querySelectorAll(".tab-pane").forEach((pane) => {
    pane.classList.remove("active");
  });

  const targetPane = document.getElementById(`tab-${tabId}`);
  if (targetPane) {
    targetPane.classList.add("active");
  }

  // Tiêu đề header
  const titleMap = {
    overview: "Tổng quan hệ thống",
    "groups-services": "Nhóm & Dịch vụ",
    members: "Quản lý thành viên",
    banking: "Tài khoản Ngân hàng & SePay Hub",
    transactions: "Đối soát & Giao dịch",
    history: "Lịch sử gửi thông báo",
    simulator: "Bộ giả lập & Cài đặt",
    adminUsers: "Quản trị Người dùng & Dữ liệu",
  };
  document.getElementById("pageTitle").innerText =
    titleMap[tabId] || "Dashboard";

  // Nạp dữ liệu tương ứng
  if (tabId === "overview") loadOverviewSummary();
  if (tabId === "groups-services") loadGroupsAndServices();
  if (tabId === "members") loadMembersTab();
  if (tabId === "banking") loadSepayDetailedStatus();
  if (tabId === "transactions") loadTransactions();
  if (tabId === "history") loadHistory();
  if (tabId === "simulator") loadSettingsTab();
  if (tabId === "adminUsers") loadAdminUsers();

  // Đóng sidebar trên mobile
  const sidebar = document.querySelector(".sidebar");
  if (sidebar) sidebar.classList.remove("open");
  lucide.createIcons();
}

function toggleSidebar() {
  document.querySelector(".sidebar").classList.toggle("open");
}

// ==========================================
// 3. TAB 1: OVERVIEW SUMMARY
// ==========================================
async function loadDashboardData() {
  await loadOverviewSummary();
  await loadGroupsAndServices();
}

async function loadOverviewSummary() {
  try {
    const res = await fetch("/api/summary");
    const data = await res.json();
    if (!data.success) return;

    // Header badge
    document.getElementById("currentMonthBadge").innerText =
      `Tháng ${data.currentMonth}`;

    // KPI Cards
    document.getElementById("kpiTotalExpected").innerText =
      `${data.stats.totalExpected.toLocaleString("vi-VN")} đ`;
    document.getElementById("kpiTotalCollected").innerText =
      `${data.stats.totalCollected.toLocaleString("vi-VN")} đ`;
    document.getElementById("kpiProgressBar").style.width =
      `${data.stats.progressPercentage}%`;
    document.getElementById("kpiProgressText").innerText =
      `${data.stats.progressPercentage}% hoàn thành`;

    document.getElementById("kpiMembersPaidRatio").innerText =
      `${data.stats.totalPaidCount} / ${data.stats.totalActiveMembers}`;
    document.getElementById("kpiPaidCount").innerText =
      `${data.stats.totalPaidCount} Đã nộp`;
    document.getElementById("kpiUnpaidCount").innerText =
      `${data.stats.totalUnpaidCount} Chưa nộp`;

    document.getElementById("kpiActiveServices").innerText =
      `${data.stats.activeServicesCount} dịch vụ`;
    document.getElementById("kpiTotalGroups").innerText =
      `${data.stats.totalGroups} nhóm Telegram`;

    // Bot status badge
    const botBadge = document.getElementById("botStatusBadge");
    const botText = document.getElementById("botStatusText");
    if (data.system.botConfigured) {
      botBadge.className = "bot-badge";
      botText.innerText = "Telegram Bot: Online";
    } else {
      botBadge.className = "bot-badge badge-warning";
      botText.innerText = "Telegram Bot: Mock Mode";
    }

    // Unmatched badge in sidebar
    const unmatchedCount = data.unmatchedTransactions.length;
    const badgeUnmatched = document.getElementById("badgeUnmatched");
    if (unmatchedCount > 0) {
      badgeUnmatched.style.display = "inline-block";
      badgeUnmatched.innerText = unmatchedCount;
    } else {
      badgeUnmatched.style.display = "none";
    }

    // Render Upcoming Reminders
    renderUpcomingReminders(data.upcomingReminders);

    // Render Latest Transactions Feed
    renderLatestTransactions(data.unmatchedTransactions);

    lucide.createIcons();
  } catch (err) {
    console.error("Lỗi tải tóm tắt:", err);
  }
}

function renderUpcomingReminders(list) {
  const container = document.getElementById("overviewRemindersList");
  if (!list || list.length === 0) {
    container.innerHTML =
      '<div class="empty-state-mini">Không có dịch vụ nào trong tháng.</div>';
    return;
  }

  container.innerHTML = list
    .map(
      (item) => `
    <div class="reminder-item">
      <div class="reminder-item-left">
        <div class="day-badge">
          <span class="day-num">${item.reminderDay}</span>
          <span class="day-label">Ngày</span>
        </div>
        <div>
          <strong>${escapeHtml(item.serviceName)}</strong>
          <div class="text-secondary" style="font-size: 0.8rem;">
            ${escapeHtml(item.groupTitle)} • ${item.reminderTime}
          </div>
        </div>
      </div>
      <div class="reminder-item-right text-right">
        <div class="font-semibold">${item.totalAmount.toLocaleString("vi-VN")} đ</div>
        ${
          item.isSent
            ? '<span class="badge badge-success mt-1"><i data-lucide="check"></i> Đã gửi nhắc</span>'
            : '<span class="badge badge-accent mt-1"><i data-lucide="clock"></i> Sắp gửi</span>'
        }
      </div>
    </div>
  `,
    )
    .join("");
}

function renderLatestTransactions(list) {
  const container = document.getElementById("overviewTransactionsList");
  if (!list || list.length === 0) {
    container.innerHTML =
      '<div class="empty-state-mini">Không có giao dịch chưa khớp nào cần xử lý.</div>';
    return;
  }

  container.innerHTML = list
    .map(
      (tx) => `
    <div class="reminder-item">
      <div class="reminder-item-left">
        <div class="kpi-icon-wrap" style="background: rgba(244, 63, 94, 0.15); color: #f43f5e;">
          <i data-lucide="alert-circle"></i>
        </div>
        <div>
          <strong style="color: #f43f5e;">+${tx.amount.toLocaleString("vi-VN")} đ</strong>
          <div class="text-secondary" style="font-size: 0.8rem; word-break: break-all;">
            "${escapeHtml(tx.content)}"
          </div>
        </div>
      </div>
      <button class="btn btn-outline-primary btn-sm" onclick="openManualMatchModal('${tx.id}', '${escapeHtml(tx.content)}', ${tx.amount})">
        Gán ngay
      </button>
    </div>
  `,
    )
    .join("");
}

async function triggerManualScheduler() {
  try {
    const res = await fetch("/api/trigger-scheduler", { method: "POST" });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, "success");
      loadOverviewSummary();
    } else {
      showToast(data.error || "Lỗi quét lịch nhắc", "error");
    }
  } catch (err) {
    showToast("Lỗi khi gọi API quét lịch", "error");
  }
}

// ==========================================
// 4. TAB 2: GROUPS & SERVICES
// ==========================================
async function loadGroupsAndServices() {
  try {
    const [groupsRes, servicesRes] = await Promise.all([
      fetch("/api/groups"),
      fetch("/api/services"),
    ]);

    const groupsData = await groupsRes.json();
    const servicesData = await servicesRes.json();

    state.groups = groupsData.groups || [];
    state.services = servicesData.services || [];

    // Cập nhật số đếm
    const groupsCountElem = document.getElementById("groupsCount");
    if (groupsCountElem) groupsCountElem.innerText = state.groups.length;

    const servicesCountElem = document.getElementById("servicesCount");
    if (servicesCountElem) servicesCountElem.innerText = state.services.length;

    renderGroupsGrid();
    renderServicesGrid();
    populateGroupSelects();
    lucide.createIcons();
  } catch (err) {
    console.error("Lỗi tải nhóm & dịch vụ:", err);
  }
}

// Render Danh sách Nhóm Telegram
function renderGroupsGrid() {
  const container = document.getElementById("groupsGrid");
  if (!container) return;

  if (state.groups.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 30px;">
        <i data-lucide="message-square-off" class="empty-icon"></i>
        <h4>Chưa có nhóm Telegram nào được kết nối</h4>
        <p style="font-size: 0.85rem; color: #94a3b8;">Thêm bot vào nhóm và gõ lệnh <code>/chatid</code> để lấy mã Chat ID thêm vào đây.</p>
        <button class="btn btn-outline-primary btn-sm mt-3" onclick="openAddGroupModal()">
          <i data-lucide="plus"></i>
          <span>Thêm Nhóm Đầu Tiên</span>
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = state.groups
    .map((g) => {
      const svcCount = state.services.filter((s) => s.groupId === g.id).length;

      return `
      <div class="group-card">
        <div class="group-card-header">
          <div class="group-card-title">
            <div class="group-avatar">
              <i data-lucide="message-square"></i>
            </div>
            <div>
              <h4>${escapeHtml(g.title)}</h4>
              <span class="badge badge-success mt-1">Active</span>
            </div>
          </div>
        </div>

        <div class="chat-id-wrap">
          <span class="text-muted" style="font-size: 0.75rem;">Chat ID Nhóm:</span>
          <code>${escapeHtml(g.chatId)}</code>
          <button class="btn-link" onclick="copyText('${escapeHtml(g.chatId)}', 'Đã sao chép Chat ID!')" title="Sao chép Chat ID">
            <i data-lucide="copy" style="width: 14px; height: 14px;"></i>
          </button>
        </div>

        <div class="chat-id-wrap mt-1">
          <span class="text-muted" style="font-size: 0.75rem;">Chủ Thu (Duyệt Tiền):</span>
          ${g.alertUsername ? `<span class="badge badge-accent" style="font-size: 0.72rem; padding: 2px 6px;">@${escapeHtml(g.alertUsername)}</span>` : (g.alertChatId ? `<code>${escapeHtml(g.alertChatId)}</code> <span class="badge badge-success" style="font-size: 0.65rem; padding: 2px 6px;">Đã kết nối</span>` : `<span class="badge badge-warning" style="font-size: 0.68rem; padding: 2px 6px;">Chưa gán</span>`)}
        </div>

        <div class="group-stats-row mt-2">
          <span>Dịch vụ liên kết: <strong>${svcCount} dịch vụ</strong></span>
          ${g.threadId ? `<span>Topic: <code>#${g.threadId}</code></span>` : ""}
        </div>

        <div class="group-card-actions">
          <button class="btn btn-outline-light btn-sm btn-block" onclick="editGroup('${g.id}')">
            <i data-lucide="edit-3"></i>
            <span>Chỉnh sửa</span>
          </button>
          <button class="btn btn-outline-light btn-sm" onclick="deleteGroup('${g.id}', '${escapeHtml(g.title)}')" title="Xóa nhóm" style="color: #f43f5e;">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>
    `;
    })
    .join("");
}

// Render Danh sách Dịch vụ
function renderServicesGrid() {
  const container = document.getElementById("servicesGrid");
  if (!container) return;

  if (state.services.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 30px;">
        <i data-lucide="boxes" class="empty-icon"></i>
        <h4>Chưa có dịch vụ nào</h4>
        <p style="font-size: 0.85rem; color: #94a3b8;">Tạo dịch vụ để lên lịch nhắc nợ tự động hoặc tạo đợt thu phát sinh.</p>
        <button class="btn btn-primary btn-sm mt-3" onclick="openAddServiceModal()">
          <i data-lucide="plus"></i>
          <span>Tạo Dịch Vụ Mới</span>
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = state.services
    .map((svc) => {
      const group = state.groups.find((g) => g.id === svc.groupId);
      const groupTitle = group ? group.title : "Chưa gán nhóm";
      const isMonthly = svc.scheduleType !== "on_demand";

      return `
      <div class="service-card glass-panel">
        <div class="service-card-header">
          <div class="service-info">
            <h3>${escapeHtml(svc.name)}</h3>
            <div class="service-group-tag">
              <i data-lucide="send"></i>
              <span>${escapeHtml(groupTitle)}</span>
            </div>
          </div>
          <div style="display: flex; gap: 6px; flex-direction: column; align-items: flex-end;">
            <span class="badge ${svc.active ? "badge-success" : "badge-danger"}">
              ${svc.active ? "Active" : "Paused"}
            </span>
            <span class="badge ${isMonthly ? "badge-accent" : "badge-warning"}" style="font-size: 0.72rem;">
              ${isMonthly ? "🔄 Định kỳ" : "⚡ Theo đợt"}
            </span>
          </div>
        </div>

        <div class="service-amount-box">
          <div>
            <div class="text-muted" style="font-size: 0.75rem; text-transform: uppercase;">Mức thu</div>
            <strong style="font-size: ${isMonthly ? "1.25rem" : "1.05rem"}; color: ${isMonthly ? "#a5b4fc" : "#38bdf8"};">
              ${isMonthly ? `${(svc.totalAmount || 0).toLocaleString("vi-VN")} đ` : "Linh hoạt theo từng đợt"}
            </strong>
          </div>
          <div class="text-right">
            <span class="badge ${isMonthly ? "badge-accent" : "badge-warning"}">
              ${isMonthly ? (svc.mode === "per_member" ? "Từng người" : "Chia đều") : "⚡ Theo đợt"}
            </span>
          </div>
        </div>

        <div class="service-meta-list">
          <div class="service-meta-row">
            <span>Tần suất nhắc:</span>
            <strong>${isMonthly ? `Ngày ${svc.reminderDay} hàng tháng (${svc.reminderTime || "08:00"})` : "Thỉnh thoảng / Theo đợt phát sinh"}</strong>
          </div>
          <div class="service-meta-row">
            <span>Cơ chế duyệt tiền:</span>
            <span>${svc.verificationMode === 'sepay' ? '<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.72rem;">🤖 Tự động SePay</span>' : '<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.72rem;">📩 Duyệt 2 bước (Telegram)</span>'}</span>
          </div>
          <div class="service-meta-row">
            <span>Người thu tiền:</span>
            <span>${svc.collectorUsername ? `<span class="badge badge-accent" style="font-size: 0.72rem; padding: 2px 6px;">@${escapeHtml(svc.collectorUsername)}</span>` : (svc.collectorChatId ? `<code>${escapeHtml(svc.collectorChatId)}</code> <span class="badge badge-accent" style="font-size: 0.65rem; padding: 2px 6px;">Riêng</span>` : `<span class="text-muted" style="font-size: 0.75rem;">Theo nhóm / Admin</span>`)}</span>
          </div>
          <div class="service-meta-row">
            <span>Tiền tố chuyển khoản:</span>
            <code>${escapeHtml(svc.transferPrefix || '(Không có)')}</code>
          </div>
          <div class="service-meta-row">
            <span>Ngân hàng nhận:</span>
            <span><strong>${escapeHtml(svc.bankInfo.bankCode)}</strong> - ${escapeHtml(svc.bankInfo.accountNumber)}</span>
          </div>
          <div class="service-meta-row">
            <span>Chủ tài khoản:</span>
            <span>${escapeHtml(svc.bankInfo.accountName)}</span>
          </div>
        </div>


        <div class="service-card-actions" style="display: flex; flex-direction: column; gap: 8px;">
          <button class="btn btn-primary btn-sm btn-block" onclick="openBatchModal('${svc.id}')" title="Tạo đợt thu tiền phát sinh, chia đều hoặc nhập tiền riêng từng người">
            <i data-lucide="megaphone"></i>
            <span>📢 Tạo Đợt Thu & Bắn Nhóm Ngay</span>
          </button>
          <div style="display: flex; gap: 8px; width: 100%;">
            ${
              isMonthly
                ? `
              <button class="btn btn-outline-primary btn-sm btn-block" onclick="sendTestRemindMessage('${svc.id}')" title="Gửi thử tin nhắn mẫu">
                <i data-lucide="bell"></i>
                <span>Gửi thử mẫu</span>
              </button>
            `
                : ""
            }
            <button class="btn btn-outline-light btn-sm" onclick="editService('${svc.id}')" title="Chỉnh sửa">
              <i data-lucide="edit-3"></i>
            </button>
            <button class="btn btn-outline-light btn-sm" onclick="deleteService('${svc.id}', '${escapeHtml(svc.name)}')" title="Xóa" style="color: #f43f5e;">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>
      </div>
    `;
    })
    .join("");
}

function populateGroupSelects() {
  const svcSelect = document.getElementById("svcGroupSelect");
  if (svcSelect) {
    svcSelect.innerHTML = state.groups
      .map(
        (g) => `
      <option value="${g.id}">${escapeHtml(g.title)} (${g.chatId})</option>
    `,
      )
      .join("");
  }

  const manualGroupSelect = document.getElementById("manualMatchServiceSelect");
  if (manualGroupSelect) {
    manualGroupSelect.innerHTML =
      '<option value="">-- Chọn dịch vụ --</option>' +
      state.services
        .map(
          (s) => `
      <option value="${s.id}">${escapeHtml(s.name)}</option>
    `,
        )
        .join("");
  }
}

// Modal Nhóm
function openAddGroupModal() {
  document.getElementById("groupIdInput").value = "";
  document.getElementById("groupForm").reset();
  const alertInput = document.getElementById("groupAlertChatIdInput");
  if (alertInput) alertInput.value = "";
  document.getElementById("groupModalTitle").innerText =
    "Thêm Nhóm Telegram Mới";
  openModal("groupModal");
}

function editGroup(id) {
  const g = state.groups.find((group) => group.id === id);
  if (!g) return;

  document.getElementById("groupIdInput").value = g.id;
  document.getElementById("groupTitleInput").value = g.title;
  document.getElementById("groupChatIdInput").value = g.chatId;
  document.getElementById("groupThreadIdInput").value = g.threadId || "";
  const alertInput = document.getElementById("groupAlertChatIdInput");
  if (alertInput) alertInput.value = g.alertUsername ? ('@' + g.alertUsername) : (g.alertChatId || "");
  document.getElementById("groupModalTitle").innerText =
    "Chỉnh Sửa Nhóm Telegram";
  openModal("groupModal");
}

async function handleSaveGroup(e) {
  e.preventDefault();
  const id = document.getElementById("groupIdInput").value;
  const title = document.getElementById("groupTitleInput").value.trim();
  const chatId = document.getElementById("groupChatIdInput").value.trim();
  const threadIdVal = document.getElementById("groupThreadIdInput").value;
  const threadId = threadIdVal ? parseInt(threadIdVal, 10) : undefined;
  const alertInput = document.getElementById("groupAlertChatIdInput");
  const alertChatId = alertInput ? alertInput.value.trim() || undefined : undefined;

  const payload = { title, chatId, threadId, alertChatId, active: true };

  try {
    const url = id ? `/api/groups/${id}` : "/api/groups";
    const method = id ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (data.success) {
      showToast(
        id ? "Đã cập nhật nhóm!" : "Đã thêm nhóm Telegram thành công!",
        "success",
      );
      closeModal("groupModal");
      loadGroupsAndServices();
      loadOverviewSummary();
    } else {
      showToast(data.error || "Lỗi khi lưu nhóm", "error");
    }
  } catch (err) {
    showToast("Lỗi kết nối máy chủ", "error");
  }
}

async function deleteGroup(id, title) {
  showConfirmModal(
    "Xóa Nhóm Telegram",
    `Bạn có chắc chắn muốn xóa nhóm "${title}"? Hành động này cũng sẽ xóa toàn bộ các dịch vụ và thành viên thuộc nhóm này!`,
    async () => {
      try {
        const res = await fetch(`/api/groups/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (data.success) {
          showToast("Đã xóa nhóm thành công", "success");
          loadGroupsAndServices();
          loadOverviewSummary();
        } else {
          showToast(data.error || "Không thể xóa nhóm", "error");
        }
      } catch (err) {
        showToast("Lỗi kết nối máy chủ", "error");
      }
    },
  );
}

// Modal Dịch vụ
let currentServiceModalMembers = [];

function toggleScheduleTypeInputs() {
  toggleServiceModeInputs();
}

async function toggleServiceModeInputs() {
  const scheduleType = document.getElementById("svcScheduleTypeSelect").value;
  const isMonthly = scheduleType === "monthly";
  const mode = document.getElementById("svcModeSelect").value;
  const monthlyRow = document.getElementById("svcScheduleMonthlyRow");
  const amountModeRow = document.getElementById("svcAmountModeRow");
  const perMemberSec = document.getElementById("svcPerMemberSection");
  const totalAmountInput = document.getElementById("svcTotalAmountInput");
  const totalAmountLabel = document.getElementById("svcTotalAmountLabel");

  if (monthlyRow) monthlyRow.style.display = isMonthly ? "flex" : "none";
  if (amountModeRow) amountModeRow.style.display = isMonthly ? "flex" : "none";

  if (!isMonthly) {
    if (perMemberSec) perMemberSec.style.display = "none";
    if (totalAmountInput) totalAmountInput.required = false;
    return;
  }

  if (mode === "per_member") {
    if (perMemberSec) perMemberSec.style.display = "block";
    if (totalAmountLabel)
      totalAmountLabel.innerText = "Tổng số tiền (Tự động cộng dồn)";
    if (totalAmountInput) {
      totalAmountInput.readOnly = true;
      totalAmountInput.style.opacity = "0.85";
    }
    await loadMembersForServiceModal();
  } else {
    if (perMemberSec) perMemberSec.style.display = "none";
    if (totalAmountLabel)
      totalAmountLabel.innerText = "Tổng số tiền (VNĐ - Sẽ chia đều)";
    if (totalAmountInput) {
      totalAmountInput.readOnly = false;
      totalAmountInput.style.opacity = "1";
      totalAmountInput.required = true;
    }
  }
}

async function loadMembersForServiceModal() {
  const serviceId = document.getElementById("serviceIdInput").value;
  const listContainer = document.getElementById("svcPerMemberList");
  if (!listContainer) return;

  if (!serviceId) {
    listContainer.innerHTML = `
      <div style="font-size: 0.8rem; color: #94a3b8; padding: 6px 0;">
        💡 <em>Sau khi lưu Dịch vụ này, bạn hãy vào tab <strong>"Thành viên"</strong> để thêm các thành viên và điền số tiền hàng tháng nhé!</em>
      </div>
    `;
    return;
  }

  try {
    const res = await fetch(`/api/services/${serviceId}/members`);
    const data = await res.json();
    currentServiceModalMembers = data.members || [];

    if (currentServiceModalMembers.length === 0) {
      listContainer.innerHTML = `
        <div style="font-size: 0.8rem; color: #94a3b8; padding: 6px 0;">
          Chưa có thành viên nào trong dịch vụ này. Hãy thêm thành viên trong tab <strong>"Thành viên"</strong>!
        </div>
      `;
      calculateSvcMemberTotal();
      return;
    }

    listContainer.innerHTML = currentServiceModalMembers
      .map(
        (m) => `
      <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.03); padding: 6px 10px; border-radius: 6px;">
        <div>
          <strong style="font-size: 0.85rem;">${escapeHtml(m.name)}</strong>
          ${m.telegramUsername ? `<span style="font-size: 0.75rem; color: #94a3b8;"> (@${escapeHtml(m.telegramUsername)})</span>` : ""}
          <div style="font-size: 0.75rem; color: #64748b;">Mã CK: <code>${escapeHtml(m.transferCode)}</code></div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <input type="number" class="svc-member-amount-input" data-member-id="${m.id}" value="${m.customAmount || 0}" min="0" step="any" oninput="calculateSvcMemberTotal()" style="width: 120px; padding: 4px 8px; font-size: 0.85rem; font-weight: 600; text-align: right;" />
          <span style="font-size: 0.8rem; color: #94a3b8;">đ/tháng</span>
        </div>
      </div>
    `,
      )
      .join("");

    calculateSvcMemberTotal();
    lucide.createIcons();
  } catch (err) {
    console.error("Lỗi tải danh sách thành viên modal dịch vụ:", err);
  }
}

function calculateSvcMemberTotal() {
  let sum = 0;
  document.querySelectorAll(".svc-member-amount-input").forEach((inp) => {
    const val = parseFloat(inp.value) || 0;
    sum += val;
  });

  const totalInput = document.getElementById("svcTotalAmountInput");
  if (totalInput) totalInput.value = sum;

  const totalTag = document.getElementById("svcPerMemberTotalTag");
  if (totalTag) totalTag.innerText = `Tổng: ${sum.toLocaleString("vi-VN")} đ`;

  updateLivePreview();
}

function openAddServiceModal() {
  if (state.groups.length === 0) {
    showToast(
      "Vui lòng thêm ít nhất một Nhóm Telegram trước khi tạo Dịch vụ!",
      "info",
    );
    openAddGroupModal();
    return;
  }

  document.getElementById("serviceIdInput").value = "";
  document.getElementById("serviceForm").reset();
  if (document.getElementById("svcCollectorChatIdInput")) {
    document.getElementById("svcCollectorChatIdInput").value = "";
  }
  document.getElementById("serviceModalTitle").innerText = "Tạo Dịch Vụ Mới";
  document.getElementById("svcScheduleTypeSelect").value = "monthly";
  if (document.getElementById("svcVerificationModeSelect")) {
    document.getElementById("svcVerificationModeSelect").value = "manual";
  }


  // Khi tạo mới: chỉ có chế độ Chia đều
  document.getElementById("svcModeSelect").innerHTML = `
    <option value="shared" selected>Chia đều (Tự chia từ tổng số tiền)</option>
  `;
  document.getElementById("svcModeSelect").value = "shared";
  toggleServiceModeInputs();

  // Thiết lập template mặc định siêu gọn đẹp
  document.getElementById("svcTemplateInput").value =
    `🔔 *THÔNG BÁO ĐÓNG TIỀN {serviceName} - THÁNG {month}*

💰 Tổng tiền: *{totalAmount}đ*

📋 *Danh sách đóng tiền:*
{memberList}

💳 *Tài khoản nhận tiền:*
• Ngân hàng: *{bankName}*
• STK: \`{accountNumber}\`
• Chủ TK: *{accountName}*

⚡ *Quét mã QR đính kèm hoặc gõ /guitien để lấy mã QR riêng của bạn!*`;

  openModal("serviceModal");
  updateLivePreview();
}

function editService(id) {
  const svc = state.services.find((s) => s.id === id);
  if (!svc) return;

  document.getElementById("serviceIdInput").value = svc.id;
  document.getElementById("svcGroupSelect").value = svc.groupId;
  document.getElementById("svcNameInput").value = svc.name;
  document.getElementById("svcPrefixInput").value = svc.transferPrefix || "";
  if (document.getElementById("svcCollectorChatIdInput")) {
    document.getElementById("svcCollectorChatIdInput").value = svc.collectorUsername ? ('@' + svc.collectorUsername) : (svc.collectorChatId || "");
  }
  document.getElementById("svcScheduleTypeSelect").value =
    svc.scheduleType || "monthly";
  if (document.getElementById("svcVerificationModeSelect")) {
    document.getElementById("svcVerificationModeSelect").value = svc.verificationMode || "manual";
  }
  document.getElementById("svcReminderDayInput").value = svc.reminderDay || 5;

  document.getElementById("svcReminderTimeInput").value =
    svc.reminderTime || "08:00";

  // Khi chỉnh sửa: hỗ trợ cả Chia đều và Từng thành viên
  document.getElementById("svcModeSelect").innerHTML = `
    <option value="shared">Chia đều (Tự chia từ tổng số tiền)</option>
    <option value="per_member">Từng thành viên (Cấu hình tiền riêng từng người)</option>
  `;
  document.getElementById("svcModeSelect").value = svc.mode || "shared";
  document.getElementById("svcTotalAmountInput").value = svc.totalAmount || "";
  document.getElementById("svcBankCodeSelect").value = svc.bankInfo.bankCode;
  document.getElementById("svcAccountNumberInput").value =
    svc.bankInfo.accountNumber;
  document.getElementById("svcAccountNameInput").value =
    svc.bankInfo.accountName;
  document.getElementById("svcTemplateInput").value = svc.messageTemplate;

  document.getElementById("serviceModalTitle").innerText = "Chỉnh Sửa Dịch Vụ";
  toggleServiceModeInputs();
  openModal("serviceModal");
  updateLivePreview();
}

async function handleSaveService(e) {
  e.preventDefault();
  const id = document.getElementById("serviceIdInput").value;
  const scheduleType = document.getElementById("svcScheduleTypeSelect").value;
  const isMonthly = scheduleType === "monthly";
  const totalAmountVal = parseFloat(
    document.getElementById("svcTotalAmountInput").value,
  );
  const totalAmount = isMonthly
    ? isNaN(totalAmountVal)
      ? 0
      : totalAmountVal
    : 0;
  const mode = isMonthly
    ? document.getElementById("svcModeSelect").value
    : "shared";

  const collectorChatId = document.getElementById("svcCollectorChatIdInput")
    ? document.getElementById("svcCollectorChatIdInput").value.trim() || undefined
    : undefined;

  const payload = {
    groupId: document.getElementById("svcGroupSelect").value,
    name: document.getElementById("svcNameInput").value.trim(),
    transferPrefix: document
      .getElementById("svcPrefixInput")
      .value.trim()
      .toUpperCase(),
    collectorChatId,
    scheduleType,
    verificationMode: document.getElementById("svcVerificationModeSelect") ? document.getElementById("svcVerificationModeSelect").value : "manual",
    reminderDay: isMonthly
      ? parseInt(document.getElementById("svcReminderDayInput").value, 10)
      : 5,

    reminderTime: isMonthly
      ? document.getElementById("svcReminderTimeInput").value.trim()
      : "08:00",
    mode,
    totalAmount,
    bankInfo: {
      bankCode: document.getElementById("svcBankCodeSelect").value,
      accountNumber: document
        .getElementById("svcAccountNumberInput")
        .value.trim(),
      accountName: document
        .getElementById("svcAccountNameInput")
        .value.trim()
        .toUpperCase(),
    },
    messageTemplate: document.getElementById("svcTemplateInput").value,
    active: true,
  };

  try {
    const url = id ? `/api/services/${id}` : "/api/services";
    const method = id ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (data.success) {
      const savedServiceId = id || data.service?.id;

      // Nếu là mode per_member, lưu luôn số tiền riêng của các thành viên
      if (savedServiceId && mode === "per_member") {
        const memberAmounts = [];
        document.querySelectorAll(".svc-member-amount-input").forEach((inp) => {
          memberAmounts.push({
            memberId: inp.dataset.memberId,
            customAmount: parseFloat(inp.value) || 0,
          });
        });

        if (memberAmounts.length > 0) {
          await fetch(`/api/services/${savedServiceId}/member-amounts`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ memberAmounts }),
          });
        }
      }

      showToast(
        id ? "Đã cập nhật dịch vụ!" : "Đã tạo dịch vụ thành công!",
        "success",
      );
      closeModal("serviceModal");
      loadGroupsAndServices();
      loadOverviewSummary();
    } else {
      showToast(data.error || "Lỗi khi lưu dịch vụ", "error");
    }
  } catch (err) {
    showToast("Lỗi kết nối máy chủ", "error");
  }
}

async function deleteService(id, name) {
  showConfirmModal(
    "Xóa Dịch Vụ",
    `Bạn có chắc chắn muốn xóa dịch vụ "${name || ""}" và toàn bộ danh sách thành viên thuộc dịch vụ này không?`,
    async () => {
      try {
        const res = await fetch(`/api/services/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (data.success) {
          showToast("Đã xóa dịch vụ thành công", "success");
          loadGroupsAndServices();
          loadOverviewSummary();
        } else {
          showToast(data.error || "Không thể xóa dịch vụ", "error");
        }
      } catch (err) {
        showToast("Lỗi kết nối máy chủ", "error");
      }
    },
  );
}

// Live preview QR & Tin nhắn trong Modal
function updateLivePreview() {
  const bankCode = document.getElementById("svcBankCodeSelect").value || "MB";
  const accountNumber =
    document.getElementById("svcAccountNumberInput").value || "0388888888";
  const accountName =
    document.getElementById("svcAccountNameInput").value || "NGUYEN VAN A";
  const prefix = document.getElementById("svcPrefixInput").value || "NET";
  const totalAmount =
    parseFloat(document.getElementById("svcTotalAmountInput").value) || 260000;
  const template = document.getElementById("svcTemplateInput").value;
  const serviceName =
    document.getElementById("svcNameInput").value || "Dịch Vụ Mẫu";

  const now = new Date();
  const monthStr = `${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;

  // VietQR URL (cú pháp ngắn gọn)
  const qrUrl = `https://img.vietqr.io/image/${bankCode}-${accountNumber}-compact2.png?amount=${totalAmount}&addInfo=${encodeURIComponent(prefix)}&accountName=${encodeURIComponent(accountName)}`;
  document.getElementById("previewQrImage").src = qrUrl;

  // Render text
  let text = template
    .replace(/{groupName}/g, "Nhóm Mẫu")
    .replace(/{serviceName}/g, serviceName)
    .replace(/{totalAmount}/g, totalAmount.toLocaleString("vi-VN"))
    .replace(/{month}/g, monthStr)
    .replace(
      /{memberList}/g,
      `• @hoangan99: *65.000đ* ➔ ND: \`${prefix}-AN\`\n• @binhtran: *65.000đ* ➔ ND: \`${prefix}-BINH\``,
    )
    .replace(/{bankName}/g, bankCode)
    .replace(/{bankCode}/g, bankCode)
    .replace(/{accountNumber}/g, accountNumber)
    .replace(/{accountName}/g, accountName);

  document.getElementById("previewMessageText").innerText = text;
}

// Gửi thử tin nhắn trực tiếp vào nhóm Telegram (Live Test)
async function sendTestRemindMessage(serviceId) {
  showConfirmModal(
    "Gửi Thử Tin Nhắn Mẫu",
    "Hệ thống sẽ gửi một tin nhắn mẫu kèm mã VietQR vào nhóm Telegram liên kết. Bạn có muốn tiếp tục không?",
    async () => {
      try {
        showToast("Đang gửi tin nhắn thử nghiệm tới Telegram...", "info");
        const res = await fetch(`/api/services/${serviceId}/test-remind`, {
          method: "POST",
        });
        const data = await res.json();

        if (data.success) {
          showToast("🚀 Đã gửi thử thành công vào nhóm Telegram!", "success");
        } else {
          showToast(`Không thể gửi: ${data.error}`, "error");
        }
      } catch (err) {
        showToast("Lỗi khi gửi tin nhắn thử", "error");
      }
    },
    {
      type: "send",
      confirmText: "Gửi tin nhắn ngay",
      confirmIcon: "send",
      headerIcon: "bell",
      headerColor: "#6366f1",
      btnClass: "btn btn-primary",
      btnStyle: "background: #6366f1; color: #fff;",
    }
  );
}


// ==========================================
// 4.1. MODAL TẠO ĐỢT THU TIỀN PHÁT SINH (BATCH DISPATCHER)
// ==========================================
async function openBatchModal(serviceId) {
  const svc = state.services.find((s) => s.id === serviceId);
  if (!svc) return;

  document.getElementById("batchServiceIdInput").value = serviceId;
  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  document.getElementById("batchTitleInput").value = `${svc.name} (${dateStr})`;
  document.getElementById("batchNoteInput").value = "";
  document.getElementById("batchQuickTotalInput").value = svc.totalAmount || "";

  try {
    const res = await fetch(`/api/services/${serviceId}/members`);
    const data = await res.json();
    currentBatchMembers = data.members || [];
    renderBatchMembersTable(svc);
    openModal("batchModal");
  } catch (err) {
    showToast("Lỗi tải danh sách thành viên", "error");
  }
}

function renderBatchMembersTable(svc) {
  const tbody = document.getElementById("batchMembersTableBody");
  if (currentBatchMembers.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="3" class="text-center py-4 text-muted">Dịch vụ này chưa có thành viên nào. Hãy thêm thành viên trong tab "Thành viên"!</td></tr>';
    document.getElementById("batchTotalDisplay").innerText = "0 đ";
    document.getElementById("batchCountDisplay").innerText = "0 thành viên";
    return;
  }

  // Pre-fill amount based on service configuration:
  // If member has customAmount: use it
  // If shared mode and totalAmount exists: split equally
  const splitAmount =
    svc && svc.totalAmount && currentBatchMembers.length > 0
      ? Math.round(svc.totalAmount / currentBatchMembers.length)
      : 0;

  tbody.innerHTML = currentBatchMembers
    .map((m) => {
      let initAmount = 0;
      if (m.customAmount && m.customAmount > 0) {
        initAmount = m.customAmount;
      } else if (splitAmount > 0) {
        initAmount = splitAmount;
      }

      return `
      <tr>
        <td>
          <strong>${escapeHtml(m.name)}</strong>
          ${m.telegramUsername ? `<small class="text-muted d-block">@${escapeHtml(m.telegramUsername)}</small>` : ""}
        </td>
        <td><code>${escapeHtml(m.transferCode)}</code></td>
        <td>
          <input type="number" class="batch-member-amount-input" data-member-id="${m.id}" value="${initAmount}" min="0" step="any" oninput="calculateBatchTotal()" style="padding: 6px 10px; font-weight: 600;" />
        </td>
      </tr>
    `;
    })
    .join("");

  calculateBatchTotal();
  lucide.createIcons();
}

function calculateBatchTotal() {
  let sum = 0;
  let count = 0;
  document.querySelectorAll(".batch-member-amount-input").forEach((input) => {
    const val = parseFloat(input.value) || 0;
    if (val > 0) count++;
    sum += val;
  });

  document.getElementById("batchTotalDisplay").innerText =
    `${sum.toLocaleString("vi-VN")} đ`;
  document.getElementById("batchCountDisplay").innerText =
    `${count} / ${currentBatchMembers.length} thành viên đóng tiền`;
}

function applyQuickSplit() {
  const total =
    parseFloat(document.getElementById("batchQuickTotalInput").value) || 0;
  if (total <= 0 || currentBatchMembers.length === 0) return;

  const splitAmount = Math.round(total / currentBatchMembers.length);
  document.querySelectorAll(".batch-member-amount-input").forEach((input) => {
    input.value = splitAmount;
  });
  calculateBatchTotal();
}

async function handleDispatchBatch(e) {
  e.preventDefault();
  const serviceId = document.getElementById("batchServiceIdInput").value;
  const title = document.getElementById("batchTitleInput").value.trim();
  const note = document.getElementById("batchNoteInput").value.trim();

  const memberAmounts = [];
  document.querySelectorAll(".batch-member-amount-input").forEach((input) => {
    const memberId = input.dataset.memberId;
    const amount = parseFloat(input.value) || 0;
    if (amount > 0) {
      memberAmounts.push({ memberId, amount });
    }
  });

  if (memberAmounts.length === 0) {
    showToast("Vui lòng nhập số tiền cho ít nhất 1 thành viên", "error");
    return;
  }

  const btn = document.getElementById("btnDispatchBatch");
  btn.disabled = true;
  btn.innerHTML = "<span>Đang gửi thông báo vào nhóm...</span>";

  try {
    const res = await fetch(`/api/services/${serviceId}/dispatch-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, note, memberAmounts }),
    });
    const data = await res.json();

    if (data.success) {
      showToast(
        "🚀 Đã bắn thông báo thu tiền kèm mã VietQR vào nhóm Telegram thành công!",
        "success",
      );
      closeModal("batchModal");
      state.currentServiceForMembers = serviceId;
      if (data.batch && data.batch.id) {
        state.currentBatchId = data.batch.id;
      }
      loadOverviewSummary();
      if (state.currentTab === "members") {
        loadMembersForSelectedService();
      }
    } else {
      showToast(data.error || "Lỗi gửi thông báo", "error");
    }
  } catch (err) {
    showToast("Lỗi kết nối máy chủ", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML =
      '<i data-lucide="send"></i><span>🚀 Bắn Thông Báo Kèm VietQR Vào Nhóm Telegram</span>';
    lucide.createIcons();
  }
}

// ==========================================
// 5. TAB 3: MEMBERS & BATCHES
// ==========================================
function openBatchModalFromMembersTab() {
  if (state.currentServiceForMembers) {
    openBatchModal(state.currentServiceForMembers);
  }
}

async function loadMembersTab() {
  const filterSelect = document.getElementById("memberServiceFilter");
  filterSelect.innerHTML =
    '<option value="">-- Chọn dịch vụ --</option>' +
    state.services
      .map(
        (s) => `
    <option value="${s.id}" ${state.currentServiceForMembers === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>
  `,
      )
      .join("");

  if (state.services.length > 0 && !state.currentServiceForMembers) {
    state.currentServiceForMembers = state.services[0].id;
    filterSelect.value = state.currentServiceForMembers;
  }

  if (state.currentServiceForMembers) {
    await loadMembersForSelectedService();
  }
}

function onMemberServiceFilterChange() {
  state.currentServiceForMembers = document.getElementById("memberServiceFilter").value;
  state.currentBatchId = null;
  loadMembersForSelectedService();
}

function onMemberBatchFilterChange() {
  state.currentBatchId = document.getElementById("memberBatchFilter").value;
  loadMembersForSelectedService(true);
}

async function loadMembersForSelectedService(isBatchOnlyChange = false) {
  const serviceId = state.currentServiceForMembers;
  const btnAdd = document.getElementById("btnAddMemberBtn");
  const btnCopy = document.getElementById("btnCopyMembersFromOtherSvc");
  const btnDispatch = document.getElementById("btnDispatchBatchInMembers");
  const batchFilterSelect = document.getElementById("memberBatchFilter");
  const banner = document.getElementById("batchInfoBanner");

  if (!serviceId) {
    if (btnAdd) btnAdd.disabled = true;
    if (btnCopy) btnCopy.disabled = true;
    if (btnDispatch) btnDispatch.disabled = true;
    if (batchFilterSelect) {
      batchFilterSelect.disabled = true;
      batchFilterSelect.innerHTML = '<option value="base">📋 Danh sách thành viên gốc</option>';
    }
    if (banner) banner.style.display = "none";
    document.getElementById("membersTableBody").innerHTML =
      '<tr><td colspan="7" class="text-center py-5">Vui lòng chọn dịch vụ ở trên để quản lý thành viên.</td></tr>';
    return;
  }

  if (btnAdd) btnAdd.disabled = false;
  if (btnCopy) btnCopy.disabled = false;
  if (btnDispatch) btnDispatch.disabled = false;
  if (batchFilterSelect) batchFilterSelect.disabled = false;

  try {
    let url = `/api/services/${serviceId}/members`;
    if (state.currentBatchId && state.currentBatchId !== 'base') {
      url += `?batchId=${encodeURIComponent(state.currentBatchId)}`;
    } else if (state.currentBatchId === 'base') {
      url += `?batchId=base`;
    }

    const res = await fetch(url);
    const data = await res.json();
    state.members = data.members || [];
    state.serviceBatches = data.batches || [];
    state.currentBatch = data.batch || null;

    // Cập nhật danh sách các đợt thu trong dropdown nếu chưa chọn hoặc thay đổi dịch vụ
    if (!isBatchOnlyChange) {
      let optionsHtml = '';
      if (state.serviceBatches.length > 0) {
        optionsHtml += state.serviceBatches.map(b => {
          const isDone = b.status === 'completed' || b.paidMembersCount >= b.totalMembers;
          const statusText = isDone ? 'Hoàn tất 🎉' : `${b.paidMembersCount}/${b.totalMembers} đã đóng`;
          const typeBadge = b.batchType === 'monthly' ? '🗓️' : '📦';
          return `<option value="${b.id}">${typeBadge} ${escapeHtml(b.title)} (${statusText})</option>`;
        }).join('');
        optionsHtml += `<option value="base">📋 Danh sách thành viên gốc (Cấu hình chung)</option>`;
      } else {
        optionsHtml = `<option value="base">📋 Danh sách thành viên gốc (Chưa có đợt thu nào)</option>`;
      }

      batchFilterSelect.innerHTML = optionsHtml;

      // Nếu chưa chọn batch, mặc định chọn batch mới nhất nếu có
      if (!state.currentBatchId && state.serviceBatches.length > 0) {
        state.currentBatchId = state.serviceBatches[0].id;
        batchFilterSelect.value = state.currentBatchId;
        // Tải lại dữ liệu cho batch đầu tiên
        return loadMembersForSelectedService(true);
      } else if (state.currentBatchId) {
        batchFilterSelect.value = state.currentBatchId;
      }
    }

    // Render Banner thông tin tiến độ đợt thu
    renderBatchBanner();

    // Render bảng thành viên
    renderMembersTable();
    lucide.createIcons();
  } catch (err) {
    console.error("Lỗi tải thành viên và đợt thu:", err);
  }
}

function renderBatchBanner() {
  const banner = document.getElementById("batchInfoBanner");
  if (!banner) return;

  if (state.currentBatch && state.currentBatchId !== 'base') {
    banner.style.display = "block";
    const b = state.currentBatch;
    const isCompleted = b.status === 'completed' || b.paidMembersCount >= b.totalMembers;

    const typeBadge = document.getElementById("batchTypeBadge");
    if (typeBadge) {
      typeBadge.innerText = b.batchType === 'monthly' ? 'Định kỳ hàng tháng' : 'Đợt phát sinh / Sự kiện';
      typeBadge.className = b.batchType === 'monthly' ? 'badge badge-primary' : 'badge badge-warning';
    }

    const titleEl = document.getElementById("batchBannerTitle");
    if (titleEl) titleEl.innerText = `Đợt thu: ${b.title}`;

    const statusBadge = document.getElementById("batchStatusBadge");
    if (statusBadge) {
      statusBadge.innerText = isCompleted ? 'Hoàn tất 100% 🎉' : 'Đang thu ⏳';
      statusBadge.className = isCompleted ? 'badge badge-success' : 'badge badge-warning';
    }

    const subtitleEl = document.getElementById("batchBannerSubtitle");
    if (subtitleEl) {
      const sentTimeStr = b.sentAt ? new Date(b.sentAt).toLocaleString('vi-VN') : 'Mới tạo';
      subtitleEl.innerHTML = `
        Gửi lúc: <strong>${sentTimeStr}</strong> • 
        Tổng tiền: <strong>${(b.totalAmount || 0).toLocaleString('vi-VN')}đ</strong> • 
        Đã thu: <strong class="text-emerald">${(b.collectedAmount || 0).toLocaleString('vi-VN')}đ</strong> 
        (${b.paidMembersCount}/${b.totalMembers} thành viên)
      `;
    }

    const progressLabel = document.getElementById("batchProgressLabel");
    if (progressLabel) {
      progressLabel.innerText = isCompleted ? "Đã thu đủ 100%:" : "Tiến độ đóng tiền:";
    }

    const progressPercent = document.getElementById("batchProgressPercent");
    if (progressPercent) {
      progressPercent.innerText = `${b.progress}% (${b.paidMembersCount}/${b.totalMembers})`;
      progressPercent.className = isCompleted ? 'text-emerald' : 'text-primary';
    }

    const progressBar = document.getElementById("batchProgressBar");
    if (progressBar) {
      progressBar.style.width = `${b.progress}%`;
      progressBar.style.background = isCompleted
        ? 'linear-gradient(90deg, #10b981, #059669)'
        : 'linear-gradient(90deg, #6366f1, #8b5cf6)';
    }
  } else {
    banner.style.display = "none";
  }
}

function renderMembersTable() {
  const tbody = document.getElementById("membersTableBody");
  const thead = document.getElementById("membersTableHead");
  const service = state.services.find(s => s.id === state.currentServiceForMembers);
  const isViewingBatch = state.currentBatch && state.currentBatchId !== 'base';

  if (isViewingBatch) {
    if (thead) {
      thead.innerHTML = `
        <tr>
          <th>Thành viên</th>
          <th>Mã chuyển khoản</th>
          <th>Telegram Tag</th>
          <th>Số tiền đợt này</th>
          <th>Trạng thái đợt này</th>
          <th>Thời gian nộp / Mã GD</th>
          <th>Hành động</th>
        </tr>
      `;
    }
  } else {
    if (thead) {
      thead.innerHTML = `
        <tr>
          <th>Thành viên</th>
          <th>Mã chuyển khoản</th>
          <th>Telegram Tag</th>
          <th>Số tiền quy định</th>
          <th>Trạng thái tháng này</th>
          <th>Thời gian nộp</th>
          <th>Hành động</th>
        </tr>
      `;
    }
  }

  if (state.members.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-5">
          ${isViewingBatch ? 'Không có dữ liệu thành viên trong đợt thu này.' : 'Chưa có thành viên nào trong dịch vụ này. Bấm "Thêm Thành Viên" để thêm!'}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = state.members
    .map((m) => {
      const isPaid = m.paymentStatus === "paid";
      const isPending = m.paymentStatus === "pending_verify";
      let displayAmount = 0;

      if (isViewingBatch) {
        displayAmount = m.customAmount || m.paidAmount || 0;
      } else {
        displayAmount = service && service.mode === "per_member" && m.customAmount
          ? m.customAmount
          : service?.defaultAmountPerMember || Math.round((service?.totalAmount || 0) / (state.members.length || 1));
      }

      let paidInfo = `<span class="text-muted" style="font-size: 0.8rem;">⏳ Chưa ghi nhận</span>`;
      if (isPaid) {
        paidInfo = `<span class="text-emerald" style="font-size: 0.8rem; font-weight: 600;">✅ ${m.paidAt ? new Date(m.paidAt).toLocaleDateString('vi-VN') : 'Đã nộp'}</span>${m.transactionId ? `<div style="font-size: 0.72rem; color: #64748b;">Mã GD: <code>${m.transactionId.substring(0, 10)}...</code></div>` : ''}`;
      } else if (isPending) {
        paidInfo = `<span class="text-amber" style="font-size: 0.8rem; font-weight: 600;">🔔 Đã báo nộp (Chờ duyệt)</span>`;
      }

      const toggleFunction = isViewingBatch
        ? `toggleMemberPaidStatusInBatch('${m.id}', '${state.currentBatch.id}')`
        : `toggleMemberPaidStatus('${m.id}')`;

      const prefix = (service?.transferPrefix || "").trim();
      let fullCode = m.transferCode || "";
      if (prefix && !fullCode.toUpperCase().startsWith(prefix.toUpperCase())) {
        fullCode = `${prefix} ${fullCode}`;
      }

      let statusBtnClass = "btn-outline-danger";
      let statusText = "Chưa đóng";
      let statusIcon = "x-circle";

      if (isPaid) {
        statusBtnClass = "btn-outline-primary";
        statusText = "Đã đóng";
        statusIcon = "check-circle-2";
      } else if (isPending) {
        statusBtnClass = "btn-outline-warning";
        statusText = "⏳ Duyệt ngay";
        statusIcon = "clock";
      }

      return `
      <tr>
        <td>
          <strong>${escapeHtml(m.name)}</strong>
          ${m.active ? "" : '<span class="badge badge-danger ml-2">Paused</span>'}
        </td>
        <td>
          <code style="font-weight: 700; color: #a5b4fc; background: rgba(99, 102, 241, 0.15); padding: 2px 6px; border-radius: 4px;">${escapeHtml(fullCode)}</code>
          ${prefix && m.transferCode !== fullCode ? `<small class="text-muted d-block" style="font-size: 0.72rem;">Mã gốc: ${escapeHtml(m.transferCode)}</small>` : ""}
        </td>
        <td>${m.telegramUsername ? `<a href="https://t.me/${m.telegramUsername}" target="_blank" style="color: #60a5fa;">@${escapeHtml(m.telegramUsername)}</a>` : '<span class="text-muted">Chưa gắn</span>'}</td>
        <td><strong>${displayAmount.toLocaleString("vi-VN")} đ</strong></td>
        <td>
          <button class="btn btn-sm ${statusBtnClass}" onclick="${toggleFunction}" title="Bấm để duyệt hoặc đổi trạng thái">
            <i data-lucide="${statusIcon}"></i>
            <span>${statusText}</span>
          </button>
        </td>
        <td>${paidInfo}</td>
        <td>
          <button class="btn btn-outline-light btn-sm" onclick="editMember('${m.id}')" title="Sửa"><i data-lucide="edit-3"></i></button>
          ${!isViewingBatch ? `<button class="btn btn-outline-light btn-sm" onclick="deleteMember('${m.id}', '${escapeHtml(m.name)}')" title="Xóa" style="color: #f43f5e;"><i data-lucide="trash-2"></i></button>` : ''}
        </td>
      </tr>
    `;
    })
    .join("");
}

async function toggleMemberPaidStatusInBatch(memberId, batchId) {
  const serviceId = state.currentServiceForMembers;
  try {
    const res = await fetch(
      `/api/services/${serviceId}/batches/${batchId}/members/${memberId}/toggle-paid`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const data = await res.json();
    if (data.success) {
      showToast(
        data.status === "paid"
          ? "✅ Đã ghi nhận: Đã đóng tiền!"
          : "⏳ Đã chuyển sang: Chưa đóng",
        data.status === "paid" ? "success" : "info",
      );
      loadMembersForSelectedService(true);
      loadOverviewSummary();
    } else {
      showToast(data.error || "Lỗi chuyển trạng thái", "error");
    }
  } catch (err) {
    showToast("Lỗi chuyển trạng thái", "error");
  }
}

async function deleteCurrentSelectedBatch() {
  if (!state.currentBatch || !state.currentServiceForMembers) return;
  const batchId = state.currentBatch.id;
  const batchTitle = state.currentBatch.title;

  showConfirmModal(
    "Xóa Đợt Thu Tiền",
    `Bạn có chắc chắn muốn xóa đợt thu "${batchTitle}" không? Hành động này sẽ xóa lịch sử đợt thu này.`,
    async () => {
      try {
        const res = await fetch(
          `/api/services/${state.currentServiceForMembers}/batches/${batchId}`,
          { method: "DELETE" }
        );
        const data = await res.json();
        if (data.success) {
          showToast("Đã xóa đợt thu thành công", "info");
          state.currentBatchId = null;
          loadMembersForSelectedService();
          loadOverviewSummary();
        } else {
          showToast(data.error || "Không thể xóa đợt thu", "error");
        }
      } catch (err) {
        showToast("Lỗi kết nối máy chủ", "error");
      }
    }
  );
}

async function openAddMemberModal() {
  document.getElementById("memberIdInput").value = "";
  const tgUserIdInput = document.getElementById("memberTelegramUserIdInput");
  if (tgUserIdInput) tgUserIdInput.value = "";
  document.getElementById("memberForm").reset();
  document.getElementById("memberModalTitle").innerText = "Thêm Thành Viên Mới";

  // Hiển thị khung chọn thành viên có sẵn
  const selectWrap = document.getElementById("existingMemberSelectWrap");
  const existingSelect = document.getElementById("existingMemberSelect");
  if (selectWrap) selectWrap.style.display = "block";

  // Tải danh bạ thành viên đã có trong hệ thống để chọn nhanh
  if (existingSelect) {
    existingSelect.innerHTML = '<option value="">-- Đang tải danh bạ thành viên... --</option>';
    try {
      const res = await fetch("/api/members/directory");
      const data = await res.json();
      state.memberDirectory = data.directory || [];

      if (state.memberDirectory.length > 0) {
        existingSelect.innerHTML = `
          <option value="">-- ✨ Chọn thành viên có sẵn để dùng chung mã CK --</option>
          ${state.memberDirectory.map(m => `
            <option value="${m.id}">${escapeHtml(m.name)} (Mã CK: ${escapeHtml(m.transferCode)})${m.telegramUsername ? ` - @${escapeHtml(m.telegramUsername)}` : ''}</option>
          `).join('')}
        `;
      } else {
        existingSelect.innerHTML = '<option value="">-- Chưa có thành viên nào trong danh bạ (Nhập mới bên dưới) --</option>';
      }
    } catch (err) {
      existingSelect.innerHTML = '<option value="">-- Nhập thông tin thành viên mới bên dưới --</option>';
    }
  }

  // Gợi ý mã chuyển khoản theo service prefix
  const service = state.services.find(
    (s) => s.id === state.currentServiceForMembers,
  );
  if (service && service.transferPrefix) {
    document.getElementById("memberCodeInput").value = `${service.transferPrefix}-`;
  }

  openModal("memberModal");
}

function onSelectExistingMember(memberId) {
  if (!memberId) {
    const service = state.services.find((s) => s.id === state.currentServiceForMembers);
    document.getElementById("memberNameInput").value = "";
    document.getElementById("memberCodeInput").value = service && service.transferPrefix ? `${service.transferPrefix}-` : "";
    document.getElementById("memberTelegramInput").value = "";
    const tgUserId = document.getElementById("memberTelegramUserIdInput");
    if (tgUserId) tgUserId.value = "";
    document.getElementById("memberCustomAmountInput").value = "";
    return;
  }

  const m = (state.memberDirectory || []).find((mem) => mem.id === memberId);
  if (m) {
    document.getElementById("memberNameInput").value = m.name || "";
    // Dùng mã chuyển khoản chung của thành viên đó
    document.getElementById("memberCodeInput").value = m.transferCode || "";
    document.getElementById("memberTelegramInput").value = m.telegramUsername || "";
    const tgUserId = document.getElementById("memberTelegramUserIdInput");
    if (tgUserId) tgUserId.value = m.telegramUserId || "";
    if (m.customAmount) {
      document.getElementById("memberCustomAmountInput").value = m.customAmount;
    }
    showToast(`✨ Đã điền thông tin và mã CK chung: ${m.name} (${m.transferCode})`, "info");
  }
}

function editMember(id) {
  const m = state.members.find((mem) => mem.id === id);
  if (!m) return;

  // Ẩn khung chọn danh bạ khi đang chỉnh sửa
  const selectWrap = document.getElementById("existingMemberSelectWrap");
  if (selectWrap) selectWrap.style.display = "none";

  document.getElementById("memberIdInput").value = m.id;
  const tgUserId = document.getElementById("memberTelegramUserIdInput");
  if (tgUserId) tgUserId.value = m.telegramUserId || "";
  document.getElementById("memberNameInput").value = m.name;
  document.getElementById("memberCodeInput").value = m.transferCode;
  document.getElementById("memberTelegramInput").value =
    m.telegramUsername || "";
  document.getElementById("memberCustomAmountInput").value =
    m.customAmount || "";

  document.getElementById("memberModalTitle").innerText =
    "Chỉnh Sửa Thành Viên";
  openModal("memberModal");
}

async function handleSaveMember(e) {
  e.preventDefault();
  const serviceId = state.currentServiceForMembers;
  const memberId = document.getElementById("memberIdInput").value;

  const customAmountVal = document.getElementById(
    "memberCustomAmountInput",
  ).value;
  const payload = {
    name: document.getElementById("memberNameInput").value.trim(),
    transferCode: document
      .getElementById("memberCodeInput")
      .value.trim()
      .toUpperCase(),
    telegramUsername: document
      .getElementById("memberTelegramInput")
      .value.trim()
      .replace(/^@/, ""),
    telegramUserId: document.getElementById("memberTelegramUserIdInput")?.value.trim() || undefined,
    customAmount: customAmountVal ? parseFloat(customAmountVal) : undefined,
    active: true,
  };

  try {
    const url = memberId
      ? `/api/services/${serviceId}/members/${memberId}`
      : `/api/services/${serviceId}/members`;
    const method = memberId ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (data.success) {
      showToast(
        memberId ? "Đã cập nhật thành viên!" : "Đã thêm thành viên mới!",
        "success",
      );
      closeModal("memberModal");
      loadMembersForSelectedService();
      loadOverviewSummary();
    } else {
      showToast(data.error || "Lỗi khi lưu thành viên", "error");
    }
  } catch (err) {
    showToast("Lỗi kết nối máy chủ", "error");
  }
}

// Modal Sao chép thành viên từ dịch vụ khác
async function openCopyMembersModal() {
  const currentServiceId = state.currentServiceForMembers;
  if (!currentServiceId) {
    showToast("Vui lòng chọn dịch vụ hiện tại trước", "warning");
    return;
  }

  const sourceSelect = document.getElementById("copySourceServiceSelect");
  if (!sourceSelect) return;

  const otherServices = (state.services || []).filter(s => s.id !== currentServiceId);
  if (otherServices.length === 0) {
    showToast("Bạn chưa có dịch vụ nào khác để sao chép thành viên", "info");
    return;
  }

  sourceSelect.innerHTML = `
    <option value="">-- Chọn dịch vụ có sẵn --</option>
    ${otherServices.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}
  `;

  document.getElementById("copyMembersChecklist").innerHTML = '<span class="text-muted p-2" style="font-size: 0.85rem;">Vui lòng chọn dịch vụ nguồn ở trên...</span>';
  openModal("copyMembersModal");
}

async function renderCopyMembersList() {
  const sourceServiceId = document.getElementById("copySourceServiceSelect").value;
  const container = document.getElementById("copyMembersChecklist");
  if (!container) return;

  if (!sourceServiceId) {
    container.innerHTML = '<span class="text-muted p-2" style="font-size: 0.85rem;">Vui lòng chọn dịch vụ nguồn ở trên...</span>';
    return;
  }

  container.innerHTML = '<span class="text-muted p-2" style="font-size: 0.85rem;">Đang tải thành viên...</span>';

  try {
    const res = await fetch(`/api/services/${sourceServiceId}/members`);
    const data = await res.json();
    state.sourceMembersToCopy = data.members || [];

    if (state.sourceMembersToCopy.length === 0) {
      container.innerHTML = '<span class="text-warning p-2" style="font-size: 0.85rem;">Dịch vụ này chưa có thành viên nào.</span>';
      return;
    }

    container.innerHTML = state.sourceMembersToCopy.map(m => `
      <label style="display: flex; align-items: center; gap: 10px; font-size: 0.88rem; cursor: pointer; padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06);">
        <input type="checkbox" class="copy-member-checkbox" value="${m.id}" checked style="width: 16px; height: 16px; cursor: pointer;" />
        <span style="flex: 1;">
          <strong>${escapeHtml(m.name)}</strong> 
          <code style="margin-left: 4px; color: #a5b4fc; background: rgba(99, 102, 241, 0.15); padding: 1px 5px; border-radius: 4px;">${escapeHtml(m.transferCode)}</code>
          ${m.telegramUsername ? `<span style="color: #60a5fa; font-size: 0.8rem; margin-left: 6px;">@${escapeHtml(m.telegramUsername)}</span>` : ''}
        </span>
      </label>
    `).join('');
  } catch (err) {
    container.innerHTML = '<span class="text-danger p-2" style="font-size: 0.85rem;">Lỗi khi tải danh sách thành viên.</span>';
  }
}

function toggleSelectAllCopyMembers() {
  const checkboxes = document.querySelectorAll(".copy-member-checkbox");
  if (checkboxes.length === 0) return;
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);
  checkboxes.forEach(cb => { cb.checked = !allChecked; });
}

async function handleExecuteCopyMembers(e) {
  e.preventDefault();
  const targetServiceId = state.currentServiceForMembers;
  const sourceServiceId = document.getElementById("copySourceServiceSelect").value;
  const checkedBoxes = document.querySelectorAll(".copy-member-checkbox:checked");

  if (!sourceServiceId) {
    showToast("Vui lòng chọn dịch vụ nguồn", "warning");
    return;
  }

  const memberIds = Array.from(checkedBoxes).map(cb => cb.value);
  if (memberIds.length === 0) {
    showToast("Vui lòng chọn ít nhất 1 thành viên để sao chép", "warning");
    return;
  }

  const btn = document.getElementById("btnSubmitCopyMembers");
  btn.disabled = true;
  btn.innerHTML = "<span>Đang sao chép...</span>";

  try {
    const res = await fetch(`/api/services/${targetServiceId}/members/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceServiceId, memberIds })
    });
    const data = await res.json();

    if (data.success) {
      showToast(data.message || "Đã sao chép thành viên thành công!", "success");
      closeModal("copyMembersModal");
      loadMembersForSelectedService();
      loadOverviewSummary();
    } else {
      showToast(data.error || "Lỗi khi sao chép thành viên", "error");
    }
  } catch (err) {
    showToast("Lỗi kết nối máy chủ", "error");
  } finally {
    btn.disabled = false;
    btn.innerText = "Sao Chép Vào Dịch Vụ Này";
  }
}

async function deleteMember(memberId, name) {
  showConfirmModal(
    "Xóa Thành Viên",
    `Bạn có chắc chắn muốn xóa thành viên "${name || ""}" khỏi dịch vụ này không?`,
    async () => {
      const serviceId = state.currentServiceForMembers;
      try {
        const res = await fetch(
          `/api/services/${serviceId}/members/${memberId}`,
          { method: "DELETE" },
        );
        const data = await res.json();
        if (data.success) {
          showToast("Đã xóa thành viên", "success");
          loadMembersForSelectedService();
          loadOverviewSummary();
        } else {
          showToast(data.error || "Không thể xóa thành viên", "error");
        }
      } catch (err) {
        showToast("Lỗi kết nối máy chủ", "error");
      }
    },
  );
}

async function toggleMemberPaidStatus(memberId) {
  const serviceId = state.currentServiceForMembers;
  try {
    const res = await fetch(
      `/api/services/${serviceId}/members/${memberId}/toggle-paid`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const data = await res.json();
    if (data.success) {
      showToast(
        data.status === "paid"
          ? "Đã chuyển sang: Đã đóng"
          : "Đã chuyển sang: Chưa đóng",
        "info",
      );
      loadMembersForSelectedService();
      loadOverviewSummary();
    }
  } catch (err) {
    showToast("Lỗi chuyển trạng thái", "error");
  }
}

// ==========================================
// 6. TAB 4: TRANSACTIONS & RECONCILIATION
// ==========================================
async function loadTransactions() {
  try {
    const url = `/api/transactions?filter=${state.currentTxFilter}&search=${encodeURIComponent(state.searchQuery)}`;
    const res = await fetch(url);
    const data = await res.json();

    state.transactions = data.transactions || [];
    renderTransactionsTable();
    lucide.createIcons();
  } catch (err) {
    console.error("Lỗi tải giao dịch:", err);
  }
}

function filterTransactions(filter) {
  state.currentTxFilter = filter;
  document.querySelectorAll(".filter-btn-group .filter-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === filter);
  });
  loadTransactions();
}

function debounceSearchTransactions() {
  clearTimeout(state.searchDebounceTimer);
  state.searchDebounceTimer = setTimeout(() => {
    state.searchQuery = document.getElementById("txSearchInput").value.trim();
    loadTransactions();
  }, 300);
}

function renderTransactionsTable() {
  const tbody = document.getElementById("transactionsTableBody");
  if (state.transactions.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="text-center py-5">Không tìm thấy giao dịch nào.</td></tr>';
    return;
  }

  tbody.innerHTML = state.transactions
    .map((tx) => {
      let matchBadge = "";
      if (tx.manualMatched) {
        matchBadge =
          '<span class="badge badge-accent"><i data-lucide="user-check"></i> Gán thủ công</span>';
      } else if (tx.matched) {
        matchBadge =
          '<span class="badge badge-success"><i data-lucide="check-check"></i> Khớp tự động</span>';
      } else {
        matchBadge =
          '<span class="badge badge-danger"><i data-lucide="alert-triangle"></i> Chưa khớp</span>';
      }

      return `
      <tr>
        <td style="font-size: 0.8rem;">${escapeHtml(tx.transactionDate || tx.createdAt?.substring(0, 19))}</td>
        <td><strong style="color: #34d399; font-size: 1rem;">+${tx.amount.toLocaleString("vi-VN")} đ</strong></td>
        <td><code style="word-break: break-all;">${escapeHtml(tx.content)}</code></td>
        <td style="font-size: 0.85rem;">${escapeHtml(tx.accountNumber)} <small class="text-muted">(${escapeHtml(tx.gateway)})</small></td>
        <td>${matchBadge}</td>
        <td>
          ${
            !tx.matched
              ? `
            <button class="btn btn-primary btn-sm" onclick="openManualMatchModal('${tx.id}', '${escapeHtml(tx.content)}', ${tx.amount})">
              <i data-lucide="link"></i>
              <span>Gán</span>
            </button>
            <button class="btn btn-outline-light btn-sm ml-1" onclick="deleteTransaction('${tx.id}')" title="Xóa log" style="color: #f43f5e;">
              <i data-lucide="trash-2"></i>
            </button>
          `
              : `
            <button class="btn btn-outline-light btn-sm" onclick="deleteTransaction('${tx.id}')" title="Xóa log">
              <i data-lucide="trash-2"></i>
            </button>
          `
          }
        </td>
      </tr>
    `;
    })
    .join("");
}

// Modal Gán thủ công
function openManualMatchModal(txId, content, amount) {
  document.getElementById("manualTxId").value = txId;
  document.getElementById("manualTxInfo").innerHTML = `
    <strong>Giao dịch:</strong> +${amount.toLocaleString("vi-VN")}đ | <strong>Nội dung:</strong> "${escapeHtml(content)}"
  `;

  // Mặc định tháng hiện tại
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  document.getElementById("manualMatchMonthInput").value = currentMonth;

  openModal("manualMatchModal");
  loadMembersForManualMatch();
}

async function loadMembersForManualMatch() {
  const serviceId = document.getElementById("manualMatchServiceSelect").value;
  const memberSelect = document.getElementById("manualMatchMemberSelect");

  if (!serviceId) {
    memberSelect.innerHTML =
      '<option value="">-- Vui lòng chọn dịch vụ trước --</option>';
    return;
  }

  try {
    const res = await fetch(`/api/services/${serviceId}/members`);
    const data = await res.json();
    const members = data.members || [];

    memberSelect.innerHTML = members
      .map(
        (m) => `
      <option value="${m.id}">${escapeHtml(m.name)} (${escapeHtml(m.transferCode)})</option>
    `,
      )
      .join("");
  } catch (err) {
    console.error("Lỗi tải thành viên cho modal match:", err);
  }
}

async function handleExecuteManualMatch(e) {
  e.preventDefault();
  const txId = document.getElementById("manualTxId").value;
  const serviceId = document.getElementById("manualMatchServiceSelect").value;
  const memberId = document.getElementById("manualMatchMemberSelect").value;
  const month = document.getElementById("manualMatchMonthInput").value;

  try {
    const res = await fetch(`/api/transactions/${txId}/manual-match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceId, memberId, month }),
    });
    const data = await res.json();

    if (data.success) {
      showToast(
        "Đã gán giao dịch và cập nhật trạng thái đóng tiền thành công!",
        "success",
      );
      closeModal("manualMatchModal");
      loadTransactions();
      loadOverviewSummary();
    } else {
      showToast(data.error || "Lỗi khi gán giao dịch", "error");
    }
  } catch (err) {
    showToast("Lỗi kết nối máy chủ", "error");
  }
}

async function deleteTransaction(id) {
  showConfirmModal(
    "Xóa Giao Dịch",
    "Bạn có chắc chắn muốn xóa bản ghi giao dịch này khỏi hệ thống không?",
    async () => {
      try {
        const res = await fetch(`/api/transactions/${id}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (data.success) {
          showToast("Đã xóa giao dịch", "success");
          loadTransactions();
          loadOverviewSummary();
        } else {
          showToast(data.error || "Lỗi xóa giao dịch", "error");
        }
      } catch (err) {
        showToast("Lỗi kết nối máy chủ", "error");
      }
    },
  );
}

// ==========================================
// 7. TAB 5: HISTORY
// ==========================================
async function loadHistory() {
  try {
    const res = await fetch("/api/history");
    const data = await res.json();
    state.history = data.receipts || [];
    renderHistoryTable();
    lucide.createIcons();
  } catch (err) {
    console.error("Lỗi tải lịch sử:", err);
  }
}

function renderHistoryTable() {
  const tbody = document.getElementById("historyTableBody");
  if (state.history.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="text-center py-5">Chưa có lịch sử gửi thông báo nào.</td></tr>';
    return;
  }

  tbody.innerHTML = state.history
    .map(
      (r) => {
        const timeStr = r.sentAt ? new Date(r.sentAt).toLocaleString("vi-VN") : "N/A";
        const errorInfo = r.error ? `<div style="font-size: 0.72rem; color: #f87171; margin-top: 2px;">Lý do: ${escapeHtml(r.error)}</div>` : "";
        return `
    <tr>
      <td>${escapeHtml(timeStr)}</td>
      <td><strong>${escapeHtml(r.month)}</strong></td>
      <td><code>${escapeHtml(r.key)}</code></td>
      <td>
        <span class="badge ${r.status === "success" ? "badge-success" : "badge-danger"}">
          ${r.status === "success" ? "Thành công" : "Thất bại"}
        </span>
        ${errorInfo}
      </td>
      <td>${r.messageId ? `#${r.messageId}` : '<span class="text-muted">N/A</span>'}</td>
    </tr>
  `;
      }
    )
    .join("");
}

// ==========================================
// 8. TAB 6: SIMULATOR & SETTINGS
// ==========================================
async function loadSettingsTab() {
  const origin = window.location.origin;
  const webhookEl = document.getElementById("webhookEndpointText");
  if (webhookEl) {
    webhookEl.innerText = `${origin}/webhooks/sepay`;
  }
  loadSepayConfig();
}

async function loadSepayConfig() {
  try {
    const res = await fetch("/api/sepay/config");
    const data = await res.json();
    if (data.success) {
      const tokenInput = document.getElementById("sepayApiTokenInput");
      const autoSyncCb = document.getElementById("sepayAutoSyncCheckbox");
      if (tokenInput && data.hasToken) {
        tokenInput.placeholder = `Đã cấu hình (${data.tokenMasked || 'Bảo mật'})`;
      }
      if (autoSyncCb) {
        autoSyncCb.checked = data.autoSync ?? true;
      }
    }
  } catch (err) {
    console.error("Lỗi tải cấu hình SePay:", err);
  }
}

async function handleSaveSepayConfig(e) {
  e.preventDefault();
  const token = document.getElementById("sepayApiTokenInput").value.trim();
  const autoSync = document.getElementById("sepayAutoSyncCheckbox").checked;

  try {
    const payload = { autoSync };
    if (token) payload.token = token;

    const res = await fetch("/api/sepay/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success) {
      showToast("✅ Đã lưu cấu hình SePay thành công!", "success");
      loadSepayConfig();
    } else {
      showToast(data.error || "Không thể lưu cấu hình SePay", "error");
    }
  } catch (err) {
    showToast("Lỗi kết nối máy chủ", "error");
  }
}

async function syncSepayTransactions() {
  showToast("⏳ Đang đồng bộ giao dịch từ SePay API...", "info");
  try {
    const res = await fetch("/api/sepay/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const data = await res.json();

    if (data.success) {
      if (data.newProcessed > 0) {
        showToast(
          `🎉 Đồng bộ thành công: ${data.newProcessed} giao dịch mới (${data.matchedCount} khớp tự động)!`,
          "success"
        );
      } else {
        showToast(
          `✅ SePay đã đồng bộ: Không có giao dịch mới (Tổng tra cứu: ${data.totalFetched})`,
          "info"
        );
      }
      loadOverviewSummary();
      if (state.currentTab === "transactions") {
        loadTransactions();
      }
      if (state.currentTab === "members") {
        loadMembersForSelectedService();
      }
    } else {
      showToast(data.error || "Không thể đồng bộ từ SePay", "error");
    }
  } catch (err) {
    showToast("Lỗi kết nối khi đồng bộ SePay", "error");
  }
}

function quickFillSimulator() {
  const currentSvc = state.services.find(s => s.id === state.currentServiceForMembers) || state.services[0];
  if (!currentSvc) {
    showToast("Chưa có dịch vụ nào để điền", "warning");
    return;
  }

  const prefix = (currentSvc.transferPrefix || "TEST").trim();
  const members = state.members[currentSvc.id] || [];
  const firstMember = members[0];
  const memberCode = firstMember?.transferCode || "AHUY";

  let fullCode = memberCode;
  if (prefix && !fullCode.toUpperCase().startsWith(prefix.toUpperCase())) {
    fullCode = `${prefix} ${fullCode}`;
  }

  const simAmount = firstMember?.customAmount || currentSvc.defaultAmountPerMember || 5000;

  document.getElementById("simAmount").value = simAmount;
  document.getElementById("simContent").value = fullCode;
  document.getElementById("simAccount").value = currentSvc.bankInfo.accountNumber || "1017409054";

  const gatewaySelect = document.getElementById("simGateway");
  if (gatewaySelect) {
    gatewaySelect.value = currentSvc.bankInfo.bankCode === "VCB" ? "Vietcombank" : (currentSvc.bankInfo.bankCode === "MB" ? "MBBank" : "Vietcombank");
  }

  showToast(`💡 Đã điền nhanh: Dịch vụ "${currentSvc.name}" - ${fullCode} (${simAmount.toLocaleString('vi-VN')}đ)`, "success");
}

function copyWebhookUrl() {
  const text = document.getElementById("webhookEndpointText").innerText;
  copyText(text, "Đã sao chép URL Webhook vào Clipboard!");
}

async function runSimulator(e) {
  e.preventDefault();
  const btn = document.getElementById("btnRunSim");
  btn.disabled = true;
  btn.innerHTML = "<span>Đang gửi và xử lý...</span>";

  const amount = parseFloat(document.getElementById("simAmount").value);
  const gateway = document.getElementById("simGateway").value;
  const content = document.getElementById("simContent").value;
  const accountNumber = document.getElementById("simAccount").value;

  try {
    const res = await fetch("/api/simulator/sepay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, gateway, content, accountNumber }),
    });
    const data = await res.json();

    const box = document.getElementById("simResultBox");
    const text = document.getElementById("simResultText");
    box.style.display = "block";
    text.innerText = JSON.stringify(data, null, 2);

    if (data.success) {
      showToast(data.message, data.matched ? "success" : "info");
      loadOverviewSummary();
    } else {
      showToast(data.error || "Lỗi giả lập", "error");
    }
  } catch (err) {
    showToast("Lỗi khi gửi webhook giả lập", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML =
      '<i data-lucide="send"></i><span>🚀 Bắn Webhook Giả Lập & Kiểm Tra Đối Soát</span>';
    lucide.createIcons();
  }
}

async function handleRestoreFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  showConfirmModal(
    "Khôi Phục Dữ Liệu",
    "Khôi phục dữ liệu từ file JSON sẽ ghi đè toàn bộ trạng thái hiện tại. Bạn có chắc chắn không?",
    async () => {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          const res = await fetch("/api/restore", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: parsed }),
          });
          const data = await res.json();

          if (data.success) {
            showToast("Khôi phục dữ liệu thành công!", "success");
            loadDashboardData();
          } else {
            showToast(data.error || "Lỗi khôi phục dữ liệu", "error");
          }
        } catch (err) {
          showToast("File JSON không hợp lệ", "error");
        }
      };
      reader.readAsText(file);
    },
  );

  e.target.value = "";
}

async function loadSettingsTab() {
  await loadOwnerTelegramProfile();
  try {
    const res = await fetch("/api/sepay/config");
    const data = await res.json();
    if (data.success) {
      const autoSyncCheckbox = document.getElementById("sepayAutoSyncCheckbox");
      if (autoSyncCheckbox) autoSyncCheckbox.checked = data.autoSync ?? true;
    }
  } catch (err) {}
}

async function loadOwnerTelegramProfile() {
  try {
    const res = await fetch("/api/user/profile");
    const data = await res.json();
    if (data.success && data.user) {
      const input = document.getElementById("ownerTelegramChatIdInput");
      if (input) {
        input.value = data.user.telegramUsername ? ('@' + data.user.telegramUsername) : (data.user.telegramChatId || "");
      }
    }
  } catch (err) {
    console.error("Lỗi khi tải thông tin Chủ Thu:", err);
  }
}

async function handleSaveOwnerTelegramConfig(e) {
  e.preventDefault();
  const input = document.getElementById("ownerTelegramChatIdInput");
  const syncCheckbox = document.getElementById("ownerSyncAllGroupsCheckbox");
  const btn = document.getElementById("btnSaveOwnerTelegram");

  const rawInput = input ? input.value.trim() : "";
  const syncToGroups = syncCheckbox ? syncCheckbox.checked : true;

  btn.disabled = true;
  btn.innerHTML = "<span>Đang lưu cấu hình...</span>";

  try {
    const res = await fetch("/api/user/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegramChatId: rawInput, syncToGroups }),
    });
    const data = await res.json();
    if (data.success) {
      showToast("Đã lưu cấu hình thông tin Chủ Thu thành công!", "success");
      loadGroupsAndServices();
    } else {
      showToast(data.error || "Lỗi khi lưu cấu hình Chủ Thu", "error");
    }
  } catch (err) {
    showToast("Lỗi kết nối máy chủ", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML =
      '<i data-lucide="save"></i><span>Lưu Cấu Hình Chủ Thu</span>';
    lucide.createIcons();
  }
}

async function handleSaveSepayConfig(e) {
  e.preventDefault();
  const tokenInput = document.getElementById("sepayApiTokenInput");
  const autoSyncCheckbox = document.getElementById("sepayAutoSyncCheckbox");
  const token = tokenInput ? tokenInput.value.trim() : "";
  const autoSync = autoSyncCheckbox ? autoSyncCheckbox.checked : true;

  try {
    const res = await fetch("/api/sepay/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, autoSync }),
    });
    const data = await res.json();
    if (data.success) {
      showToast("Đã lưu cấu hình SePay thành công!", "success");
    } else {
      showToast(data.error || "Lỗi khi lưu cấu hình SePay", "error");
    }
  } catch (err) {
    showToast("Lỗi kết nối máy chủ", "error");
  }
}

async function handleChangePassword(e) {
  e.preventDefault();
  const currentPassword = document.getElementById("currPass").value;
  const newPassword = document.getElementById("newPass").value;

  try {
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();

    if (data.success) {
      showToast("Đổi mật khẩu thành công!", "success");
      document.getElementById("changePasswordForm").reset();
    } else {
      showToast(data.error || "Không thể đổi mật khẩu", "error");
    }
  } catch (err) {
    showToast("Lỗi kết nối máy chủ", "error");
  }
}

// ==========================================
// 8. TÀI KHOẢN NGÂN HÀNG & SEPAY HUB
// ==========================================
async function loadSepayDetailedStatus(showToastFeedback = false) {
  try {
    const res = await fetch('/api/sepay/status');
    const data = await res.json();

    if (!data.success) {
      if (showToastFeedback) showToast(data.error || 'Lỗi khi tải thông tin SePay', 'error');
      return;
    }

    // 1. Trạng thái kết nối
    const connDot = document.getElementById('sepayConnDot');
    const connText = document.getElementById('sepayConnText');
    const tokenDisplay = document.getElementById('sepayTokenMaskedDisplay');
    const autoSyncBadge = document.getElementById('sepayAutoSyncBadge');

    if (data.configured) {
      if (connDot) connDot.style.background = '#10b981';
      if (connText) {
        connText.innerText = 'Đang hoạt động';
        connText.style.color = '#34d399';
      }
      if (tokenDisplay) tokenDisplay.innerText = `Token: ${data.maskedToken}`;
    } else {
      if (connDot) connDot.style.background = '#ef4444';
      if (connText) {
        connText.innerText = 'Chưa cấu hình';
        connText.style.color = '#ef4444';
      }
      if (tokenDisplay) tokenDisplay.innerText = 'API Token: Chưa nhập';
    }

    if (autoSyncBadge) {
      autoSyncBadge.innerText = data.autoSync ? 'Auto-Sync: Bật (20s)' : 'Auto-Sync: Tắt';
      autoSyncBadge.className = data.autoSync ? 'badge badge-success' : 'badge badge-neutral';
    }

    // 2. Hạn mức & Số lượt giao dịch
    const quota = data.quota || { planName: 'Gói Miễn Phí (Free 0đ)', monthlyLimit: 50, usedThisMonth: 0, remaining: 50, usagePercent: 0, month: '09/2026' };
    const planTitle = document.getElementById('sepayPlanTitle');
    const remainingCount = document.getElementById('sepayRemainingCount');
    const usedCount = document.getElementById('sepayUsedCount');
    const progressBar = document.getElementById('sepayQuotaProgressBar');

    if (planTitle) planTitle.innerText = `${quota.planName} (Tháng ${quota.month})`;
    if (remainingCount) {
      remainingCount.innerText = quota.remaining;
      if (quota.remaining <= 5) {
        remainingCount.style.color = '#f43f5e';
      } else if (quota.remaining <= 15) {
        remainingCount.style.color = '#fbbf24';
      } else {
        remainingCount.style.color = '#34d399';
      }
    }

    if (usedCount) usedCount.innerText = `Đã dùng: ${quota.usedThisMonth} / ${quota.monthlyLimit} giao dịch`;
    if (progressBar) {
      progressBar.style.width = `${quota.usagePercent}%`;
      if (quota.usagePercent >= 90) {
        progressBar.style.background = 'linear-gradient(90deg, #f43f5e, #fb7185)';
      } else if (quota.usagePercent >= 70) {
        progressBar.style.background = 'linear-gradient(90deg, #fbbf24, #f59e0b)';
      } else {
        progressBar.style.background = 'linear-gradient(90deg, #10b981, #06b6d4)';
      }
    }

    // 3. Form input
    const autoSyncCheckbox = document.getElementById('sepayAutoSyncCheckboxTab');
    if (autoSyncCheckbox) autoSyncCheckbox.checked = data.autoSync ?? true;

    // 4. Danh sách tài khoản ngân hàng
    const bankCardsContainer = document.getElementById('sepayBankCardsContainer');
    const bankCountBadge = document.getElementById('sepayBankCountBadge');
    const primaryAccNum = document.getElementById('sepayPrimaryAccNum');
    const primaryAccName = document.getElementById('sepayPrimaryAccName');
    const primaryBankName = document.getElementById('sepayPrimaryBankName');

    const bankAccounts = data.bankAccounts || [];
    if (bankCountBadge) bankCountBadge.innerText = `${bankAccounts.length} Tài khoản`;

    if (bankAccounts.length > 0) {
      const primary = bankAccounts[0];
      if (primaryAccNum) primaryAccNum.innerText = primary.accountNumber;
      if (primaryAccName) primaryAccName.innerText = `Chủ TK: ${primary.accountName}`;
      if (primaryBankName) primaryBankName.innerText = `Ngân hàng: ${primary.bankCode} (${primary.bankName})`;

      if (bankCardsContainer) {
        bankCardsContainer.innerHTML = bankAccounts.map((acc) => `
          <div class="glass-panel p-3 bank-card-item" style="background: linear-gradient(135deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.8)); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="badge badge-accent" style="font-weight: 800; font-size: 0.8rem; background: #6366f1;">${escapeHtml(acc.bankCode)}</span>
                <strong style="color: #f8fafc; font-size: 0.95rem;">${escapeHtml(acc.bankName)}</strong>
              </div>
              <span class="badge ${acc.active ? 'badge-success' : 'badge-neutral'}" style="font-size: 0.72rem;">${acc.active ? '● Hoạt động' : 'Tạm dừng'}</span>
            </div>
            
            <div style="display: flex; align-items: center; justify-content: space-between; margin: 10px 0;">
              <div>
                <div style="font-size: 0.75rem; color: #94a3b8;">SỐ TÀI KHOẢN:</div>
                <div style="font-family: monospace; font-size: 1.2rem; font-weight: 800; letter-spacing: 1px; color: #38bdf8;">
                  ${escapeHtml(acc.accountNumber)}
                </div>
              </div>
              <button class="btn btn-outline-light btn-sm" onclick="copyText('${escapeHtml(acc.accountNumber)}', 'Đã copy STK ${escapeHtml(acc.accountNumber)}')" title="Sao chép STK">
                <i data-lucide="copy"></i>
              </button>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.06); padding-top: 10px;">
              <div>
                <div style="font-size: 0.72rem; color: #94a3b8;">CHỦ TÀI KHOẢN:</div>
                <div style="font-weight: 700; color: #e2e8f0; font-size: 0.88rem;">${escapeHtml(acc.accountName)}</div>
              </div>
              <button class="btn btn-outline-primary btn-sm" onclick="applyBankAccountToServices('${escapeHtml(acc.bankCode)}', '${escapeHtml(acc.accountNumber)}', '${escapeHtml(acc.accountName)}')" title="Cập nhật STK này cho toàn bộ Dịch vụ và VietQR">
                <i data-lucide="check-check"></i>
                <span>Áp dụng vào hệ thống</span>
              </button>
            </div>
          </div>
        `).join('');
      }
    } else {
      if (primaryAccNum) primaryAccNum.innerText = data.configured ? 'Chưa tìm thấy STK' : 'Chưa cấu hình';
      if (primaryAccName) primaryAccName.innerText = 'Vui lòng liên kết STK trên my.sepay.vn';
      if (primaryBankName) primaryBankName.innerText = 'Ngân hàng: --';

      if (bankCardsContainer) {
        bankCardsContainer.innerHTML = `
          <div class="text-center p-4 glass-panel" style="border: 1px dashed rgba(255, 255, 255, 0.1); border-radius: 12px;">
            <i data-lucide="landmark" class="text-muted" style="width: 36px; height: 36px; margin: 0 auto 10px;"></i>
            <div style="color: #cbd5e1; font-weight: 600; margin-bottom: 4px;">Chưa có tài khoản ngân hàng nào</div>
            <div class="text-muted" style="font-size: 0.82rem; margin-bottom: 12px;">
              ${data.configured ? 'Hãy đăng nhập my.sepay.vn và liên kết tài khoản ngân hàng của bạn.' : 'Vui lòng nhập API Token ở cột bên phải để kết nối.'}
            </div>
            <a href="https://my.sepay.vn" target="_blank" class="btn btn-outline-primary btn-sm">
              <i data-lucide="external-link"></i>
              <span>Mở SePay để liên kết STK</span>
            </a>
          </div>
        `;
      }
    }

    lucide.createIcons();

    if (showToastFeedback) {
      showToast(data.configured ? 'Đã kiểm tra & đồng bộ trạng thái SePay thành công!' : 'Đã tải trạng thái SePay', 'success');
    }
  } catch (err) {
    if (showToastFeedback) showToast('Lỗi khi tải thông tin SePay', 'error');
  }
}

async function handleSaveSepayConfigTab(e) {
  e.preventDefault();
  const tokenInput = document.getElementById('sepayApiTokenInputTab');
  const autoSyncCheckbox = document.getElementById('sepayAutoSyncCheckboxTab');
  const btn = document.getElementById('btnSaveSepayTab');

  const token = tokenInput ? tokenInput.value.trim() : '';
  const autoSync = autoSyncCheckbox ? autoSyncCheckbox.checked : true;

  if (!token) {
    showToast('Vui lòng nhập SePay API Token', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span>Đang kết nối & xác thực...</span>';

  try {
    const res = await fetch('/api/sepay/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, autoSync }),
    });
    const data = await res.json();

    if (data.success) {
      showToast('Đã lưu cấu hình SePay và kết nối thành công!', 'success');
      if (tokenInput) tokenInput.value = '';
      await loadSepayDetailedStatus(false);
    } else {
      showToast(data.error || 'Lỗi khi lưu cấu hình SePay', 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối máy chủ', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="save"></i><span>Lưu & Kết Nối Ngay</span>';
    lucide.createIcons();
  }
}

async function applyBankAccountToServices(bankCode, accountNumber, accountName) {
  showConfirmModal(
    'Áp Dụng Tài Khoản Ngân Hàng',
    `Bạn có chắc muốn áp dụng tài khoản ${bankCode} - ${accountNumber} (${accountName}) cho TẤT CẢ các Dịch vụ và mã VietQR hiện có không?`,
    async () => {
      try {
        const res = await fetch('/api/sepay/apply-to-services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bankCode, accountNumber, accountName }),
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message, 'success');
          loadOverviewSummary();
        } else {
          showToast(data.error || 'Không thể áp dụng tài khoản', 'error');
        }
      } catch (err) {
        showToast('Lỗi khi gửi yêu cầu áp dụng', 'error');
      }
    }
  );
}

function toggleTokenVisibilityTab() {
  const input = document.getElementById('sepayApiTokenInputTab');
  const eyeIcon = document.getElementById('eyeIconToken');
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (eyeIcon) eyeIcon.setAttribute('data-lucide', 'eye-off');
  } else {
    input.type = 'password';
    if (eyeIcon) eyeIcon.setAttribute('data-lucide', 'eye');
  }
  lucide.createIcons();
}

async function pasteTokenFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    const input = document.getElementById('sepayApiTokenInputTab');
    if (input && text) {
      input.value = text.trim();
      showToast('Đã dán token từ Clipboard!', 'success');
    }
  } catch (err) {
    showToast('Không thể đọc Clipboard tự động, hãy nhấn Ctrl+V', 'info');
  }
}

// ==========================================
// 9. MODAL & TOAST & CONFIRM UTILITIES
// ==========================================
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "flex";
  lucide.createIcons();
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "none";
}

function showConfirmModal(title, message, onConfirmCallback, options = {}) {
  const titleEl = document.getElementById("confirmModalTitle");
  const msgEl = document.getElementById("confirmModalMessage");
  const btnEl = document.getElementById("confirmModalBtn");

  const type = options.type || "danger";
  const isDanger = type === "danger";

  const confirmText = options.confirmText || (isDanger ? "Xác nhận xóa" : "Xác nhận");
  const confirmIcon = options.confirmIcon || (isDanger ? "trash-2" : (type === "send" ? "send" : (type === "logout" ? "log-out" : "check")));
  const headerIcon = options.headerIcon || (isDanger ? "alert-triangle" : (type === "send" ? "bell" : (type === "logout" ? "log-out" : "help-circle")));
  const headerColor = options.headerColor || (isDanger ? "#f43f5e" : "#6366f1");
  const btnClass = options.btnClass || (isDanger ? "btn btn-danger" : "btn btn-primary");
  const btnStyle = options.btnStyle || (isDanger ? "background: #e11d48; color: #fff;" : "background: #6366f1; color: #fff;");

  if (titleEl) {
    titleEl.style.color = headerColor;
    titleEl.innerHTML = `<i data-lucide="${headerIcon}"></i><span>${escapeHtml(title)}</span>`;
  }
  if (msgEl) {
    msgEl.innerText = message;
  }

  // Clone button to clear old listeners
  const newBtn = btnEl.cloneNode(true);
  newBtn.className = btnClass;
  if (btnStyle) newBtn.setAttribute("style", btnStyle);
  else newBtn.removeAttribute("style");
  newBtn.innerHTML = `<i data-lucide="${confirmIcon}"></i><span>${escapeHtml(confirmText)}</span>`;
  btnEl.parentNode.replaceChild(newBtn, btnEl);

  newBtn.onclick = async () => {
    closeModal("confirmModal");
    if (typeof onConfirmCallback === "function") {
      await onConfirmCallback();
    }
  };

  openModal("confirmModal");
  lucide.createIcons();
}


function copyText(text, successMsg = "Đã sao chép vào bộ nhớ tạm!") {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        showToast(successMsg, "success");
      })
      .catch(() => fallbackCopy(text, successMsg));
  } else {
    fallbackCopy(text, successMsg);
  }
}

function fallbackCopy(text, successMsg) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand("copy");
    showToast(successMsg, "success");
  } catch (err) {
    showToast("Không thể sao chép tự động", "error");
  }
  document.body.removeChild(textArea);
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const iconMap = {
    success: "check-circle",
    error: "alert-circle",
    info: "info",
  };

  toast.innerHTML = `<i data-lucide="${iconMap[type] || "info"}"></i><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  lucide.createIcons();

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(50px)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ==========================================
// 12. ADMIN USER MANAGEMENT & AUTO CLEANUP
// ==========================================
async function loadAdminUsers() {
  const tbody = document.getElementById("adminUsersTableBody");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">Đang tải danh sách người dùng...</td></tr>`;

  try {
    const res = await fetch("/api/admin/users");
    const data = await res.json();

    if (!data.success) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger">${escapeHtml(data.error || "Không thể tải danh sách")}</td></tr>`;
      return;
    }

    const users = data.users || [];
    const regularCount = users.filter((u) => u.role !== "admin").length;

    const totalEl = document.getElementById("adminKpiTotalUsers");
    const regularEl = document.getElementById("adminKpiRegularUsers");
    if (totalEl) totalEl.innerText = users.length;
    if (regularEl) regularEl.innerText = regularCount;

    if (users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">Chưa có người dùng nào.</td></tr>`;
      return;
    }

    tbody.innerHTML = users
      .map((u) => {
        const isCurrent = u.isCurrent;
        const isAdmin = u.role === "admin";
        const initial = (u.fullName || u.username).charAt(0).toUpperCase();

        const roleBadge = isAdmin
          ? `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3);">Quản trị viên</span>`
          : `<span class="badge" style="background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3);">Thành viên</span>`;

        const sepayBadge = u.hasSepayToken
          ? `<span class="badge badge-emerald"><i data-lucide="check-circle-2" style="width: 12px; height: 12px; margin-right: 4px;"></i>Đã kết nối</span>`
          : `<span class="badge badge-gray">Chưa có token</span>`;

        const dateStr = u.createdAt
          ? new Date(u.createdAt).toLocaleDateString("vi-VN", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "--";

        const deleteButton = u.canDelete
          ? `<button class="btn btn-outline-danger btn-sm" onclick="confirmDeleteUser('${u.id}', '${escapeHtml(u.username)}', '${escapeHtml(u.fullName)}')" title="Xóa tài khoản vĩnh viễn">
              <i data-lucide="trash-2"></i>
              <span>Xóa</span>
             </button>`
          : `<button class="btn btn-outline-light btn-sm" disabled style="opacity: 0.4; cursor: not-allowed;" title="${isCurrent ? "Đang đăng nhập" : "Tài khoản gốc"}">
              <i data-lucide="lock"></i>
              <span>Cố định</span>
             </button>`;

        return `
          <tr>
            <td>
              <div style="display: flex; align-items: center; gap: 10px;">
                <div style="width: 32px; height: 32px; border-radius: 50%; background: ${isAdmin ? "linear-gradient(135deg, #ef4444, #f97316)" : "linear-gradient(135deg, #6366f1, #a855f7)"}; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.85rem; color: #fff;">
                  ${initial}
                </div>
                <div>
                  <strong style="color: #f1f5f9; font-size: 0.95rem;">${escapeHtml(u.fullName)}</strong>
                  ${isCurrent ? `<span class="badge badge-primary" style="font-size: 0.68rem; margin-left: 6px;">Bạn</span>` : ""}
                  <div class="text-muted" style="font-size: 0.8rem;">@${escapeHtml(u.username)}</div>
                </div>
              </div>
            </td>
            <td>${roleBadge}</td>
            <td>
              <div style="font-size: 0.88rem; color: #cbd5e1;">
                <span><strong>${u.groupCount}</strong> nhóm</span> • 
                <span><strong>${u.serviceCount}</strong> dịch vụ</span> • 
                <span><strong>${u.batchCount}</strong> đợt thu</span>
              </div>
            </td>
            <td>${sepayBadge}</td>
            <td style="font-size: 0.85rem; color: #94a3b8;">${dateStr}</td>
            <td>
              <div style="display: flex; gap: 8px; justify-content: flex-end; align-items: center;">
                <button class="btn btn-outline-warning btn-sm" onclick="openAdminResetPasswordModal('${u.id}', '${escapeHtml(u.username)}')" title="Đổi mật khẩu cho người dùng này">
                  <i data-lucide="key"></i>
                  <span>Đổi MK</span>
                </button>
                ${deleteButton}
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    lucide.createIcons();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger">Lỗi kết nối máy chủ</td></tr>`;
  }
}

function openAdminResetPasswordModal(userId, username) {
  const inputId = document.getElementById("adminResetUserIdInput");
  const label = document.getElementById("adminResetUsernameLabel");
  const inputPass = document.getElementById("adminNewPasswordInput");

  if (inputId) inputId.value = userId;
  if (label) label.innerText = `@${username}`;
  if (inputPass) inputPass.value = "";

  openModal("adminResetPasswordModal");
}

async function handleAdminSubmitPassword(e) {
  e.preventDefault();
  const userId = document.getElementById("adminResetUserIdInput").value;
  const newPassword = document.getElementById("adminNewPasswordInput").value;

  if (!newPassword || newPassword.length < 6) {
    showToast("Mật khẩu mới phải có tối thiểu 6 ký tự!", "error");
    return;
  }

  try {
    const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword }),
    });
    const data = await res.json();

    if (data.success) {
      showToast(data.message || "Đã đổi mật khẩu thành công!", "success");
      closeModal("adminResetPasswordModal");
    } else {
      showToast(data.error || "Lỗi khi đổi mật khẩu", "error");
    }
  } catch (err) {
    showToast("Lỗi kết nối máy chủ", "error");
  }
}

function confirmDeleteUser(userId, username, fullName) {
  showConfirmModal(
    "Xác Nhận Xóa Tài Khoản",
    `Bạn có chắc chắn muốn xóa tài khoản "${fullName || username}" (@${username}) không?\n\n⚠️ CẢNH BÁO: Toàn bộ Nhóm Telegram, Dịch vụ, Thành viên, Đợt chi tiêu và Giao dịch của tài khoản này sẽ bị XÓA VĨNH VIỄN!`,
    async () => {
      try {
        const res = await fetch(`/api/admin/users/${userId}`, {
          method: "DELETE",
        });
        const data = await res.json();

        if (data.success) {
          showToast(data.message || "Đã xóa tài khoản thành công!", "success");
          loadAdminUsers();
        } else {
          showToast(data.error || "Không thể xóa tài khoản", "error");
        }
      } catch (err) {
        showToast("Lỗi kết nối máy chủ", "error");
      }
    }
  );
}

async function handleTriggerCleanupBatches() {
  const btn = document.getElementById("btnAdminCleanupBatches");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin"></i><span>Đang dọn dẹp...</span>`;
  }

  try {
    const res = await fetch("/api/admin/cleanup-batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retentionDays: 7 }),
    });
    const data = await res.json();

    if (data.success) {
      showToast(data.message, "success");
      loadAdminUsers();
    } else {
      showToast(data.error || "Lỗi dọn dẹp đợt thu", "error");
    }
  } catch (err) {
    showToast("Lỗi kết nối máy chủ", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="sparkles"></i><span>🧹 Dọn dẹp đợt thu cũ (> 7 ngày)</span>`;
      lucide.createIcons();
    }
  }
}

