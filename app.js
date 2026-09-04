document.addEventListener("DOMContentLoaded", () => {
    const KEY = "baantheung_account_data";
    const OLD_KEY = "transactions";
    const SUPABASE_URL = "https://hqvwggayhilyraghfyxq.supabase.co";
    const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ZlVaEVAn0U7rLPnsxztqzQ_NfO5OeHM";
    let currentHouseholdId = localStorage.getItem("baantheung_household_id") || "";
    const $ = id => document.getElementById(id);

    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    let session = null;
    let currentMemberName = "";
    let currentProfile = { name: "", avatar: "🙂" };
    let currentHousehold = { id: "", name: "", mode: "personal", inviteCode: "" };
    let householdMembers = [];

    const EXPENSE_CATEGORIES = [
        "อาหาร","ที่พัก","เดินทาง","ของใช้","ช้อปปิ้ง",
        "บิลและสาธารณูปโภค","ความบันเทิง","สุขภาพ","อื่น ๆ"
    ];

    const INCOME_CATEGORIES = [
        "เงินเดือน","รายได้เสริม","โบนัส","เงินคืน","อื่น ๆ"
    ];

    let transactions = [];
    let editingId = null;
    let cal = new Date();
    let salaryMonth = new Date();

    /* =========================
       Utility
    ========================= */

    function today() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    }

    function esc(value) {
        const div = document.createElement("div");
        div.textContent = value ?? "";
        return div.innerHTML;
    }

    function money(value) {
        return "฿" + Number(value || 0).toLocaleString("th-TH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function dateFmt(value) {
        if (!value) return "";
        const d = new Date(value + "T00:00:00");
        return d.toLocaleDateString("th-TH", {
            day:"numeric", month:"short", year:"numeric"
        });
    }

    function normalizeTransaction(t) {
        return {
            id: String(t.id ?? Date.now() + Math.random()),
            userId: t.userId || t.user_id || "",
            type: t.type === "income" || t.type === "รายรับ" ? "income" : "expense",
            description: t.description || t.name || "",
            amount: Number(t.amount) || 0,
            member: t.member || t.person || "เก้น",
            category: t.category || "",
            date: t.date || today(),
            salaryRound: t.salaryRound || ""
        };
    }

    function localTransactions() {
        const raw = localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY) || "[]";
        try { return JSON.parse(raw).map(normalizeTransaction); }
        catch { return []; }
    }

    async function loadFromSupabase() {
        const { data, error } = await sb
            .from("transactions")
            .select("id,user_id,type,description,amount,member,category,date,salary_round,created_at,updated_at")
            .eq("household_id", currentHouseholdId)
            .order("date", { ascending: false })
            .order("created_at", { ascending: false });

        if (error) throw error;

        transactions = (data || []).map(t => normalizeTransaction({
            ...t,
            userId: t.user_id || "",
            salaryRound: t.salary_round || ""
        }));

        localStorage.setItem(KEY, JSON.stringify(transactions));
    }

    async function importLocalDataIfCloudEmpty() {
        if (transactions.length) return;

        const local = localTransactions();
        if (!local.length) return;

        const payload = local.map(t => ({
            household_id: currentHouseholdId,
            user_id: session.user.id,
            type: t.type,
            description: t.description,
            amount: t.amount,
            member: t.member,
            category: t.category || null,
            date: t.date,
            salary_round: t.salaryRound || null
        }));

        const { error } = await sb.from("transactions").insert(payload);
        if (error) throw error;
        await loadFromSupabase();
    }

    async function saveTransactionToSupabase(transaction) {
        const existing = transactions.find(t => t.id === transaction.id);
        const isEdit = Boolean(transaction.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(transaction.id));

        if (isEdit && existing && existing.userId !== session.user.id) {
            throw new Error("คุณแก้ไขได้เฉพาะรายการที่คุณเป็นผู้บันทึก");
        }

        const payload = {
            household_id: currentHouseholdId,
            user_id: isEdit && existing?.userId ? existing.userId : session.user.id,
            type: transaction.type,
            description: transaction.description,
            amount: transaction.amount,
            member: transaction.member,
            category: transaction.category || null,
            date: transaction.date,
            salary_round: transaction.salaryRound || null
        };

        if (isEdit) {
            const { data, error } = await sb
                .from("transactions")
                .update({ ...payload, updated_at: new Date().toISOString() })
                .eq("id", transaction.id)
                .select("id,user_id,type,description,amount,member,category,date,salary_round")
                .single();
            if (error) throw error;
            return normalizeTransaction({ ...data, userId: data.user_id || "", salaryRound: data.salary_round || "" });
        }

        const { data, error } = await sb
            .from("transactions")
            .insert(payload)
            .select("id,user_id,type,description,amount,member,category,date,salary_round")
            .single();
        if (error) throw error;
        return normalizeTransaction({ ...data, userId: data.user_id || "", salaryRound: data.salary_round || "" });
    }

    async function deleteTransactionFromSupabase(id) {
        const { error } = await sb.from("transactions").delete().eq("id", id);
        if (error) throw error;
    }

    function currentTransactions() {
        const now = today();
        return transactions.filter(t => !t.date || t.date <= now);
    }

    function totals(list = transactions) {
        let income = 0, expense = 0;
        list.forEach(t => {
            if (t.type === "income") income += t.amount;
            else expense += t.amount;
        });
        return { income, expense, balance: income - expense };
    }

    /* =========================
       Salary Round
    ========================= */

    function salaryRoundOptions(member, selected = "") {
        if (member === "เก้น") {
            return [
                ["round1", "รอบที่ 1"],
                ["round2", "รอบที่ 2"]
            ].map(([value,label]) =>
                `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`
            ).join("");
        }

        return `<option value="monthly" ${selected === "monthly" ? "selected" : ""}>เงินเดือนประจำเดือน</option>`;
    }

    function updateSalaryRoundUI(selected = "") {
        const group = $("salaryRoundGroup");
        const select = $("salaryRound");
        const hint = $("salaryRoundHint");

        if (!group || !select) return;

        const isSalary =
            $("transactionType")?.value === "income" &&
            $("category")?.value === "เงินเดือน";

        if (!isSalary) {
            group.classList.remove("show");
            select.innerHTML = "";
            return;
        }

        group.classList.add("show");

        const member = currentMemberName || "เก้น";
        select.innerHTML = salaryRoundOptions(member, selected);

        hint.textContent =
            member === "เก้น"
                ? "เก้นรับเงินเดือนเดือนละ 2 รอบ"
                : "มิ้นรับเงินเดือนเดือนละ 1 รอบ";
    }

    /* =========================
       Category
    ========================= */

    function categoryOptions(selected = "") {
        const select = $("category");
        if (!select) return;

        const type = $("transactionType")?.value || "expense";
        const list = type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

        select.innerHTML =
            `<option value="">ไม่ระบุหมวดหมู่</option>` +
            list.map(item =>
                `<option value="${esc(item)}" ${item === selected ? "selected" : ""}>${esc(item)}</option>`
            ).join("");

        updateSalaryRoundUI();
    }

    function categoryFilter() {
        const select = $("filterCategory");
        if (!select) return;

        const current = select.value;
        const categories = [...new Set(
            transactions.map(t => t.category).filter(Boolean)
        )].sort((a,b) => a.localeCompare(b, "th"));

        select.innerHTML =
            `<option value="all">หมวดหมู่ทั้งหมด</option>` +
            categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");

        if (categories.includes(current)) select.value = current;

        const memberSelect = $("filterMember");
        if (memberSelect) {
            const memberCurrent = memberSelect.value;
            memberSelect.innerHTML = `<option value="all">ผู้บันทึกทั้งหมด</option>` +
                householdMembers.map(m => `<option value="${esc(m.member_name)}">${esc(m.member_name)}</option>`).join("");
            if (householdMembers.some(m => m.member_name === memberCurrent)) memberSelect.value = memberCurrent;
        }
    }

    /* =========================
       Icons
    ========================= */

    function icon(income) {
        return income
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M6 13l6 6 6-6"/></svg>`;
    }

    function editIcon() {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>`;
    }

    /* =========================
       Transaction Item
    ========================= */

    function transactionMeta(t) {
        const parts = [t.member, dateFmt(t.date)];
        if (t.category) parts.push(t.category);
        if (t.salaryRound && t.type === "income" && t.category === "เงินเดือน") {
            parts.push(
                t.salaryRound === "round1" ? "รอบที่ 1" :
                t.salaryRound === "round2" ? "รอบที่ 2" :
                "เงินเดือนประจำเดือน"
            );
        }
        return parts.map(esc).join(" · ");
    }

    function item(t, full = false, futureLabel = "") {
        const income = t.type === "income";
        const bg = income ? "#eaf6ef" : "#faedf3";
        const color = income ? "#5ca47f" : "#c9799d";
        const base = full ? "transaction-page" : "transaction";

        return `
            <div class="${base}${full ? "-item" : ""}">
                <div class="${full ? "transaction-page-icon" : "transaction-icon"}"
                     style="background:${bg};color:${color}">
                    ${icon(income)}
                </div>

                <div class="${full ? "transaction-page-info" : "transaction-info"}">
                    <div class="${full ? "transaction-page-name" : "transaction-name"}">
                        ${esc(t.description)}
                    </div>
                    <div class="${full ? "transaction-page-meta" : "transaction-meta"}">
                        ${transactionMeta(t)}${futureLabel ? ` <span class="future-badge">${esc(futureLabel)}</span>` : ""}
                    </div>
                </div>

                <div class="${full ? "transaction-page-amount" : "transaction-amount"}"
                     style="color:${color}">
                    ${income ? "+" : "-"}${money(t.amount)}
                </div>

                ${t.userId === session?.user?.id ? `
                <div class="transaction-actions">
                    <button class="${full ? "transaction-edit" : "edit-btn"}"
                            type="button"
                            data-edit-id="${esc(t.id)}"
                            title="แก้ไขรายการของฉัน"
                            aria-label="แก้ไขรายการของฉัน">
                        ${editIcon()}
                    </button>
                    <button class="${full ? "transaction-delete" : "delete-btn"}"
                            type="button"
                            data-delete-id="${esc(t.id)}"
                            title="ลบรายการของฉัน"
                            aria-label="ลบรายการของฉัน">×</button>
                </div>` : ""}
            </div>
        `;
    }

    function attach(container) {
        if (!container) return;

        container.querySelectorAll("[data-delete-id]").forEach(button => {
            button.onclick = async () => {
                const id = button.dataset.deleteId;
                const t = transactions.find(x => x.id === id);

                if (!t) return;
                if (t.userId !== session?.user?.id) {
                    alert("คุณลบได้เฉพาะรายการที่คุณเป็นผู้บันทึก");
                    return;
                }

                if (confirm(`ต้องการลบรายการ "${t.description}" หรือไม่?`)) {
                    try {
                        await deleteTransactionFromSupabase(id);
                        transactions = transactions.filter(x => x.id !== id);
                        localStorage.setItem(KEY, JSON.stringify(transactions));
                        render();
                    } catch (error) {
                        console.error(error);
                        alert("ลบรายการไม่สำเร็จ: " + (error.message || "เกิดข้อผิดพลาด"));
                    }
                }
            };
        });

        container.querySelectorAll("[data-edit-id]").forEach(button => {
            button.onclick = () => {
                const t = transactions.find(x => x.id === button.dataset.editId);
                if (t?.userId !== session?.user?.id) {
                    alert("คุณแก้ไขได้เฉพาะรายการที่คุณเป็นผู้บันทึก");
                    return;
                }
                openEdit(button.dataset.editId);
            };
        });
    }

    /* =========================
       Add / Edit Modal
    ========================= */

    function modal(open) {
        const overlay = $("modalOverlay");
        if (!overlay) return;

        overlay.classList.toggle("show", open);
        document.body.style.overflow = open ? "hidden" : "";

        if (open) {
            setTimeout(() => $("description")?.focus(), 50);
        }
    }

    function updateAutoMemberDisplay(name = currentMemberName) {
        const el = $("autoMemberDisplay");
        if (el) {
            el.textContent = name
                ? `ระบบบันทึกให้อัตโนมัติ: ${name}`
                : "ระบบจะบันทึกตามผู้ที่เข้าสู่ระบบ";
        }
    }

    function prepareNew() {
        editingId = null;

        $("transactionForm")?.reset();
        $("date").value = today();
        $("transactionType").value = "expense";
        updateAutoMemberDisplay(currentMemberName);

        document.querySelectorAll(".type-btn").forEach(btn => {
            btn.classList.toggle("selected", btn.dataset.type === "expense");
        });

        categoryOptions();

        const submit = $("transactionForm")?.querySelector('button[type="submit"]');
        if (submit) submit.textContent = "บันทึกรายการ";

        $("modalTitle").textContent = "เพิ่มรายการ";
        updateSalaryRoundUI();
    }

    function openEdit(id) {
        const t = transactions.find(x => x.id === id);
        if (!t) return;
        if (t.userId !== session?.user?.id) {
            alert("คุณแก้ไขได้เฉพาะรายการที่คุณเป็นผู้บันทึก");
            return;
        }

        editingId = t.id;

        $("description").value = t.description;
        $("amount").value = t.amount;
        updateAutoMemberDisplay(t.member || currentMemberName);
        $("date").value = t.date;
        $("transactionType").value = t.type;

        document.querySelectorAll(".type-btn").forEach(btn => {
            btn.classList.toggle("selected", btn.dataset.type === t.type);
        });

        categoryOptions(t.category);
        updateSalaryRoundUI(t.salaryRound);

        if ($("salaryRound")) $("salaryRound").value = t.salaryRound || "";

        const submit = $("transactionForm")?.querySelector('button[type="submit"]');
        if (submit) submit.textContent = "บันทึกการแก้ไข";

        $("modalTitle").textContent = "แก้ไขรายการ";
        modal(true);
    }

    /* =========================
       Form Events
    ========================= */

    $("addButton")?.addEventListener("click", () => {
        prepareNew();
        modal(true);
    });

    $("addNavButton")?.addEventListener("click", () => {
        prepareNew();
        modal(true);
    });

    $("closeModal")?.addEventListener("click", () => {
        editingId = null;
        modal(false);
    });

    $("modalOverlay")?.addEventListener("click", e => {
        if (e.target === $("modalOverlay")) {
            editingId = null;
            modal(false);
        }
    });

    document.addEventListener("keydown", e => {
        if (e.key === "Escape" && $("modalOverlay")?.classList.contains("show")) {
            editingId = null;
            modal(false);
        }
    });

    document.querySelectorAll(".type-btn").forEach(button => {
        button.addEventListener("click", () => {
            const type = button.dataset.type;

            $("transactionType").value = type;

            document.querySelectorAll(".type-btn").forEach(btn => {
                btn.classList.toggle("selected", btn === button);
            });

            categoryOptions();
            updateSalaryRoundUI();
        });
    });

    $("category")?.addEventListener("change", () => {
        updateSalaryRoundUI($("salaryRound")?.value || "");
    });

    $("transactionForm")?.addEventListener("submit", async e => {
        e.preventDefault();

        const description = $("description").value.trim();
        const amount = Number($("amount").value);
        const category = $("category").value;
        const type = $("transactionType").value;
        const date = $("date").value || today();

        if (!description) {
            alert("กรุณาใส่รายละเอียดรายการ");
            $("description").focus();
            return;
        }

        if (!amount || amount <= 0) {
            alert("กรุณาใส่จำนวนเงิน");
            $("amount").focus();
            return;
        }

        let salaryRound = "";

        if (type === "income" && category === "เงินเดือน") {
            salaryRound = $("salaryRound")?.value || "";

            if (!salaryRound) {
                alert("กรุณาเลือกรอบเงินเดือน");
                $("salaryRound")?.focus();
                return;
            }
        }

        const updated = {
            type,
            description,
            amount,
            // ผู้บันทึกถูกกำหนดจากบัญชีที่ Login อยู่โดยอัตโนมัติ
            member: editingId
                ? (transactions.find(t => t.id === editingId)?.member || currentMemberName)
                : currentMemberName,
            category,
            date,
            salaryRound
        };

        const submit = $("transactionForm").querySelector('button[type="submit"]');
        if (submit) { submit.disabled = true; submit.textContent = "กำลังบันทึก…"; }

        try {
            if (editingId) {
                const saved = await saveTransactionToSupabase({ id: editingId, ...updated });
                const index = transactions.findIndex(t => t.id === editingId);
                if (index !== -1) transactions[index] = saved;
            } else {
                const saved = await saveTransactionToSupabase(updated);
                transactions.unshift(saved);
            }
            localStorage.setItem(KEY, JSON.stringify(transactions));
        } catch (error) {
            console.error(error);
            alert("บันทึกรายการไม่สำเร็จ: " + (error.message || "เกิดข้อผิดพลาด"));
            if (submit) { submit.disabled = false; submit.textContent = editingId ? "บันทึกการแก้ไข" : "บันทึกรายการ"; }
            return;
        }

        editingId = null;

        $("transactionForm").reset();
        $("date").value = today();
        $("transactionType").value = "expense";

        document.querySelectorAll(".type-btn").forEach(btn => {
            btn.classList.toggle("selected", btn.dataset.type === "expense");
        });

        categoryOptions();

        if (submit) { submit.disabled = false; submit.textContent = "บันทึกรายการ"; }

        $("modalTitle").textContent = "เพิ่มรายการ";
        modal(false);
        render();
    });

    /* =========================
       Recent / All
    ========================= */

    function renderRecent() {
        const container = $("recentTransactions");
        if (!container) return;

        const list = transactions.slice(0, 5);

        container.innerHTML = list.length
            ? list.map(t => item(t)).join("")
            : `<div class="empty">ยังไม่มีรายการบันทึก</div>`;

        attach(container);
    }

    function daysUntil(dateString) {
        const a = new Date(today() + "T00:00:00");
        const b = new Date(dateString + "T00:00:00");
        return Math.ceil((b - a) / 86400000);
    }

    function renderAll() {
        const search = ($("searchInput")?.value || "").trim().toLowerCase();
        const type = $("filterType")?.value || "all";
        const member = $("filterMember")?.value || "all";
        const category = $("filterCategory")?.value || "all";
        const list = transactions.filter(t => {
            const text = [t.description, t.category, t.member, t.salaryRound].join(" ").toLowerCase();
            return (!search || text.includes(search)) && (type === "all" || t.type === type) && (member === "all" || t.member === member) && (category === "all" || t.category === category);
        });
        const occurred = list.filter(t => t.date <= today());
        const future = list.filter(t => t.date > today());
        const current = totals(occurred);
        const futureIncome = future.filter(t => t.type === "income").reduce((sum,t) => sum + t.amount, 0);
        $("transactionCount").textContent = `${list.length} รายการ`;
        $("transactionTotal").textContent = money(current.balance);
        $("listCurrentBalance").textContent = money(current.balance);
        $("listCurrentIncome").textContent = money(current.income);
        $("listCurrentExpense").textContent = money(current.expense);
        $("listFutureIncome").textContent = money(futureIncome);
        $("listFutureCount").textContent = `${future.length} รายการ`;
        $("listCurrentDate").textContent = `ณ วันที่ ${new Date().toLocaleDateString("th-TH",{day:"numeric",month:"short",year:"numeric"})}`;
        $("occurredTitle").textContent = `รายการที่เกิดขึ้นแล้ว (${occurred.length})`;
        $("futureTitle").textContent = `รายการที่จะเกิดขึ้น (${future.length})`;
        $("occurredTransactions").innerHTML = occurred.length ? occurred.map(t=>item(t,true)).join("") : `<div class="no-results">ไม่มีรายการที่เกิดขึ้นแล้ว</div>`;
        $("futureTransactions").innerHTML = future.length ? future.map(t=>{const days=daysUntil(t.date);const label=days===1?"พรุ่งนี้":`อีก ${days} วัน`;return item(t,true,label)}).join("") : `<div class="no-results">ไม่มีรายการในอนาคต</div>`;
        attach($("occurredTransactions"));
        attach($("futureTransactions"));
    }

    /* =========================
       Dashboard / Report
    ========================= */

    function dashboard() {
        // ยอดปัจจุบันต้องไม่นับรายการที่ลงวันที่ในอนาคต
        const t = totals(currentTransactions());

        if ($("balance")) $("balance").textContent = money(t.balance);
        if ($("income")) $("income").textContent = money(t.income);
        if ($("expense")) $("expense").textContent = money(t.expense);
        if ($("walletTotal")) $("walletTotal").textContent = money(t.balance);
        if ($("memberCount")) $("memberCount").textContent = `${Math.max(householdMembers.length,1)} คน`;
        if ($("walletMembers")) $("walletMembers").textContent = `${Math.max(householdMembers.length,1)} คนในบัญชี`;
        if ($("homeGreeting")) $("homeGreeting").textContent = `สวัสดี ${currentProfile.name || currentMemberName || ""}`.trim();
        if ($("balanceSub")) $("balanceSub").textContent = currentHousehold.mode === "shared" ? "กระเป๋าเงินร่วมของสมาชิก" : "กระเป๋าเงินส่วนตัว";
        if ($("walletTitle")) $("walletTitle").textContent = currentHousehold.mode === "shared" ? "กระเป๋าเงินกลาง" : "กระเป๋าเงินของฉัน";
        if ($("headerSubtitle")) $("headerSubtitle").textContent = currentHousehold.name || (currentHousehold.mode === "shared" ? "บัญชีร่วม" : "บัญชีส่วนตัว");
        if ($("currentMemberBadge")) $("currentMemberBadge").innerHTML = `<span class="profile-avatar-small">${esc(currentProfile.avatar || "🙂")}</span>${esc(currentProfile.name || currentMemberName || "ออนไลน์")}`;

        if ($("homeMonth")) {
            $("homeMonth").textContent = new Date().toLocaleDateString("th-TH", {
                month:"long", year:"numeric"
            });
        }
    }

    function renderReportPersons() {
        const container = $("reportPersons");
        if (!container) return;
        container.innerHTML = householdMembers.length
            ? householdMembers.map(m => `<div><span>${esc(m.avatar || "🙂")} ${esc(m.member_name)}</span><strong>${m.user_id === session?.user?.id ? "คุณ" : "สมาชิก"}</strong></div>`).join("")
            : `<div><span>สมาชิก</span><strong>-</strong></div>`;
    }

    function report() {
        const all = totals();
        const occurred = currentTransactions();
        const current = totals(occurred);
        const future = transactions.filter(t => t.date > today());
        const futureIncomeList = future.filter(t => t.type === "income");
        const futureExpenseList = future.filter(t => t.type === "expense");
        const futureIncome = futureIncomeList.reduce((sum,t) => sum + t.amount, 0);
        const futureExpense = futureExpenseList.reduce((sum,t) => sum + t.amount, 0);

        // สรุปด้านบนให้สะท้อน "เงินที่เกิดขึ้นแล้วถึงวันนี้"
        // รายการในอนาคตจะไม่ถูกรวมใน 4 ช่องนี้
        if ($("reportIncome")) $("reportIncome").textContent = money(current.income);
        if ($("reportExpense")) $("reportExpense").textContent = money(current.expense);
        if ($("reportBalance")) $("reportBalance").textContent = money(current.balance);
        if ($("reportCount")) $("reportCount").textContent = occurred.length;

        if ($("reportCurrentBalance")) $("reportCurrentBalance").textContent = money(current.balance);
        if ($("reportFutureIncome")) $("reportFutureIncome").textContent = money(futureIncome);
        if ($("reportFutureExpense")) $("reportFutureExpense").textContent = money(futureExpense);
        if ($("reportFutureIncomeCount")) $("reportFutureIncomeCount").textContent = `${futureIncomeList.length} รายการ`;
        if ($("reportFutureExpenseCount")) $("reportFutureExpenseCount").textContent = `${futureExpenseList.length} รายการ`;
        if ($("reportStatusNote")) {
            $("reportStatusNote").textContent =
                `ยอดปัจจุบัน ณ วันที่ ${new Date().toLocaleDateString("th-TH",{day:"numeric",month:"short",year:"numeric"})}`;
        }

        const categories = {};
        // หมวดหมู่รายจ่ายหลักก็ใช้เฉพาะรายการที่เกิดขึ้นแล้วถึงวันนี้
        occurred
            .filter(t => t.type === "expense" && t.category)
            .forEach(t => {
                categories[t.category] = (categories[t.category] || 0) + t.amount;
            });

        const entries = Object.entries(categories).sort((a,b) => b[1] - a[1]);
        const max = entries[0]?.[1] || 1;

        if ($("expenseByCategory")) {
            $("expenseByCategory").innerHTML = entries.length
                ? entries.map(([name, value]) => `
                    <div class="category-line">
                        <span>${esc(name)}</span>
                        <div class="category-bar"><span style="width:${value / max * 100}%"></span></div>
                        <strong>${money(value)}</strong>
                    </div>
                `).join("")
                : `<div class="empty">ยังไม่มีรายจ่ายที่ระบุหมวดหมู่</div>`;
        }

        renderSixMonthChart();
        renderMonthlyExpense();
        renderSalaryReport();
    }

    function monthKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
    }

    let expenseMonth = new Date();

    function expenseMonthKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
    }

    function expenseMonthText(date) {
        return date.toLocaleDateString("th-TH",{month:"long",year:"numeric"});
    }

    function monthExpenseAmount(date) {
        const key = expenseMonthKey(date);
        return transactions
            .filter(t => t.type === "expense" && t.date.startsWith(key))
            .reduce((sum,t) => sum + t.amount, 0);
    }

    function shortMonthText(date) {
        return date.toLocaleDateString("th-TH",{month:"short"}).replace(".","");
    }

    function sixMonthData() {
        const end = new Date();
        end.setDate(1);
        const data = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(end);
            d.setMonth(end.getMonth() - i);
            const key = expenseMonthKey(d);
            const list = transactions.filter(t => t.date.startsWith(key));
            data.push({
                date: d,
                key,
                income: list.filter(t => t.type === "income").reduce((sum,t) => sum + t.amount, 0),
                expense: list.filter(t => t.type === "expense").reduce((sum,t) => sum + t.amount, 0)
            });
        }
        return data;
    }

    function renderSixMonthDetail(data, index) {
        const x = data[index];
        if (!x) return;

        const list = transactions
            .filter(t => t.date.startsWith(x.key))
            .sort((a,b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id));

        $("sixMonthDetailTitle").textContent = expenseMonthText(x.date);
        $("sixMonthDetailIncome").textContent = money(x.income);
        $("sixMonthDetailExpense").textContent = money(x.expense);
        $("sixMonthDetailBalance").textContent = money(x.income - x.expense);

        $("sixMonthDetailList").innerHTML = list.length
            ? list.map(t => {
                const inc = t.type === "income";
                const bg = inc ? "#eaf6ef" : "#faedf3";
                const color = inc ? "#5ca47f" : "#c9799d";
                return `
                    <div class="month-detail-item">
                        <div class="month-detail-icon" style="background:${bg};color:${color}">
                            ${icon(inc)}
                        </div>
                        <div class="month-detail-info">
                            <div class="month-detail-name">${esc(t.description)}</div>
                            <div class="month-detail-meta">${esc(t.member)} · ${dateFmt(t.date)}${t.category ? " · " + esc(t.category) : ""}</div>
                        </div>
                        <div class="month-detail-amount" style="color:${color}">
                            ${inc ? "+" : "-"}${money(t.amount)}
                        </div>
                    </div>
                `;
            }).join("")
            : `<div class="month-detail-empty">เดือนนี้ยังไม่มีรายการ</div>`;

        $("sixMonthViewAll").onclick = () => {
            showPage("transactionsPage");
            $("searchInput").value = "";
            $("filterType").value = "all";
            $("filterMember").value = "all";
            $("filterCategory").value = "all";
            renderAll();
            const items = transactions.filter(t => t.date.startsWith(x.key));
            $("transactionCount").textContent = `${items.length} รายการ`;
        };
    }

    function renderSixMonthChart() {
        const box = $("sixMonthChart");
        if (!box) return;

        const data = sixMonthData();
        const max = Math.max(1, ...data.flatMap(x => [x.income, x.expense]));
        const scaleValues = [max, max * 0.75, max * 0.5, max * 0.25, 0];

        $("sixMonthScale").innerHTML = scaleValues.map(v => `<span>${v >= 1000 ? "฿" + Math.round(v/1000) + "k" : money(v)}</span>`).join("");

        box.innerHTML = data.map((x, index) => {
            const incomeHeight = x.income ? Math.max(5, x.income / max * 165) : 3;
            const expenseHeight = x.expense ? Math.max(5, x.expense / max * 165) : 3;
            return `
                <div class="month-column" data-month-index="${index}" title="ดูรายละเอียด ${expenseMonthText(x.date)}">
                    <div class="month-bars">
                        <div class="month-bar income" style="height:${incomeHeight}px"></div>
                        <div class="month-bar expense" style="height:${expenseHeight}px"></div>
                    </div>
                    <div class="month-label">${shortMonthText(x.date)}</div>
                </div>
            `;
        }).join("");

        const bestIncome = data.reduce((a,b) => b.income > a.income ? b : a, data[0]);
        const bestExpense = data.reduce((a,b) => b.expense > a.expense ? b : a, data[0]);
        const avgExpense = data.reduce((sum,x) => sum + x.expense, 0) / data.length;

        $("sixMonthBestIncome").textContent =
            `${shortMonthText(bestIncome.date)} · ${money(bestIncome.income)}`;
        $("sixMonthBestExpense").textContent =
            `${shortMonthText(bestExpense.date)} · ${money(bestExpense.expense)}`;
        $("sixMonthAvgExpense").textContent = money(avgExpense);

        const selectedIndex = data.length - 1;
        const selectMonth = (index) => {
            const x = data[index];
            box.querySelectorAll(".month-column").forEach((el,i) =>
                el.classList.toggle("active", i === index)
            );
            $("sixMonthSelectedName").textContent = expenseMonthText(x.date);
            $("sixMonthSelectedIncome").textContent = money(x.income);
            $("sixMonthSelectedExpense").textContent = money(x.expense);
            $("sixMonthSelectedBalance").textContent = money(x.income - x.expense);
            renderSixMonthDetail(data, index);
        };

        box.querySelectorAll(".month-column").forEach((el) => {
            el.addEventListener("click", () => selectMonth(Number(el.dataset.monthIndex)));
        });
        selectMonth(selectedIndex);
    }

    function renderMonthlyExpense() {
        if (!$("monthlyExpenseTotal")) return;

        const key = expenseMonthKey(expenseMonth);
        const list = transactions.filter(t =>
            t.type === "expense" && t.date.startsWith(key)
        );
        const total = list.reduce((sum,t) => sum + t.amount, 0);

        const previous = new Date(expenseMonth);
        previous.setMonth(previous.getMonth() - 1);
        const previousTotal = monthExpenseAmount(previous);
        const change = total - previousTotal;

        $("expenseMonthTitle").textContent = expenseMonthText(expenseMonth);
        $("expenseMonthLabel").textContent = expenseMonthText(expenseMonth);
        $("monthlyExpenseTotal").textContent = money(total);
        $("monthlyExpenseCount").textContent = `${list.length} รายการ`;
        $("previousMonthExpense").textContent = money(previousTotal);
        $("expenseChange").textContent = `${change > 0 ? "+" : ""}${money(change)}`;
        $("expenseChange").style.color =
            change > 0 ? "var(--rose)" :
            change < 0 ? "var(--green)" : "var(--dark)";

        const categories = {};
        list.forEach(t => {
            const name = t.category || "ไม่ระบุหมวดหมู่";
            categories[name] = (categories[name] || 0) + t.amount;
        });

        const entries = Object.entries(categories).sort((a,b) => b[1] - a[1]);
        const max = entries[0]?.[1] || 1;

        $("monthlyExpenseByCategory").innerHTML = entries.length
            ? entries.map(([name,value]) => `
                <div class="monthly-category-line">
                    <span class="monthly-category-name">${esc(name)}</span>
                    <div class="monthly-category-bar"><span style="width:${value/max*100}%"></span></div>
                    <strong class="monthly-category-value">${money(value)}</strong>
                </div>
            `).join("")
            : `<div class="monthly-empty">เดือนนี้ยังไม่มีรายจ่าย</div>`;
    }

    function renderSalaryReport() {
        const key = monthKey(salaryMonth);
        const salary = transactions.filter(t => t.date.startsWith(key) && t.type === "income" && t.category === "เงินเดือน");
        const grouped = householdMembers.map(m => {
            const rows = salary.filter(t => t.userId === m.user_id || t.member === m.member_name);
            return { member:m.member_name, avatar:m.avatar||"🙂", rows, total:rows.reduce((s,t)=>s+t.amount,0) };
        });
        const grandTotal = grouped.reduce((s,x)=>s+x.total,0);
        const label = salaryMonth.toLocaleDateString("th-TH",{month:"long",year:"numeric"});
        if ($("salaryMonthInput")) $("salaryMonthInput").value = `${salaryMonth.getFullYear()}-${String(salaryMonth.getMonth()+1).padStart(2,"0")}`;
        if (!$("salaryRoundSummary")) return;
        $("salaryRoundSummary").innerHTML = grouped.length
            ? grouped.map(x => {
                let details = "";
                if (x.member === "เก้น") {
                    const r1=x.rows.filter(t=>t.salaryRound==="round1").reduce((s,t)=>s+t.amount,0);
                    const r2=x.rows.filter(t=>t.salaryRound==="round2").reduce((s,t)=>s+t.amount,0);
                    details=`<div class="salary-detail"><span>รอบที่ 1</span><strong>${money(r1)}</strong></div><div class="salary-detail"><span>รอบที่ 2</span><strong>${money(r2)}</strong></div>`;
                } else {
                    details=`<div class="salary-detail"><span>เงินเดือน</span><strong>${money(x.total)}</strong></div>`;
                }
                return `<div class="salary-summary-card"><div class="salary-summary-head"><span class="salary-summary-person">${esc(x.avatar)} ${esc(x.member)}</span><strong>${money(x.total)}</strong></div>${details}</div>`;
            }).join("") + `<div class="salary-grand-total"><span>เงินเดือนรวม ${esc(label)}</span><strong>${money(grandTotal)}</strong></div><div class="salary-report-note">${salary.length ? `พบรายการเงินเดือน ${salary.length} รายการในเดือนนี้` : "เดือนนี้ยังไม่มีรายการเงินเดือน"}</div>`
            : `<div class="empty">ยังไม่มีสมาชิกในบัญชี</div>`;
    }

    /* =========================
       Calendar
    ========================= */

    function calendar() {
        if (!$("calendarMonth") || !$("calendarDays")) return;

        const year = cal.getFullYear();
        const month = cal.getMonth();

        $("calendarMonth").textContent = cal.toLocaleDateString("th-TH", {
            month:"long", year:"numeric"
        });

        let start = new Date(year, month, 1).getDay();
        start = start === 0 ? 6 : start - 1;

        const days = new Date(year, month + 1, 0).getDate();
        let html = "";

        for (let i = 0; i < start; i++) {
            html += `<button class="calendar-day other-month" disabled>${new Date(year, month, 0).getDate() - start + i + 1}</button>`;
        }

        for (let day = 1; day <= days; day++) {
            const date = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
            const list = transactions.filter(t => t.date === date);
            const hasIncome = list.some(t => t.type === "income");
            const hasExpense = list.some(t => t.type === "expense");

            html += `
                <button type="button"
                    class="calendar-day ${date === today() ? "today" : ""} ${hasIncome ? "has-income" : ""} ${!hasIncome && hasExpense ? "has-expense" : ""}"
                    data-date="${date}">
                    ${day}
                </button>
            `;
        }

        $("calendarDays").innerHTML = html;

        $("calendarDays").querySelectorAll("[data-date]").forEach(button => {
            button.onclick = () => dayView(button.dataset.date);
        });

        dayView(today());
    }

    function dayView(date) {
        const title = $("selectedDateTitle");
        const container = $("selectedDateTransactions");

        if (!title || !container) return;

        const d = new Date(date + "T00:00:00");

        title.textContent = d.toLocaleDateString("th-TH", {
            weekday:"long", day:"numeric", month:"long", year:"numeric"
        });

        const list = transactions.filter(t => t.date === date);

        container.innerHTML = list.length
            ? list.map(t => item(t)).join("")
            : `<div class="empty">วันนี้ยังไม่มีรายการ</div>`;

        attach(container);
    }

    /* =========================
       Navigation
    ========================= */

    function showPage(id) {
        document.querySelectorAll(".page").forEach(page => {
            page.classList.toggle("active", page.id === id);
        });

        document.querySelectorAll(".nav-btn[data-page]").forEach(button => {
            button.classList.toggle("active", button.dataset.page === id);
        });

        window.scrollTo({ top:0, behavior:"smooth" });

        if (id === "transactionsPage") renderAll();
        if (id === "calendarPage") calendar();
        if (id === "reportPage") report();
    }

    document.querySelectorAll(".nav-btn[data-page]").forEach(button => {
        button.onclick = () => showPage(button.dataset.page);
    });

    $("viewAllButton")?.addEventListener("click", () => showPage("transactionsPage"));

    [$("searchInput"), $("filterType"), $("filterMember"), $("filterCategory")]
        .forEach(element => {
            if (!element) return;
            element.oninput = renderAll;
            element.onchange = renderAll;
        });

    $("previousMonth")?.addEventListener("click", () => {
        cal.setMonth(cal.getMonth() - 1);
        calendar();
    });

    $("nextMonth")?.addEventListener("click", () => {
        cal.setMonth(cal.getMonth() + 1);
        calendar();
    });

    $("expensePrevMonth")?.addEventListener("click", () => {
        expenseMonth.setMonth(expenseMonth.getMonth() - 1);
        renderMonthlyExpense();
    });

    $("expenseNextMonth")?.addEventListener("click", () => {
        expenseMonth.setMonth(expenseMonth.getMonth() + 1);
        renderMonthlyExpense();
    });

    $("expenseMonthLabel")?.addEventListener("click", () => {
        expenseMonth = new Date();
        renderMonthlyExpense();
    });

    $("salaryPrev")?.addEventListener("click", () => {
        salaryMonth.setMonth(salaryMonth.getMonth() - 1);
        renderSalaryReport();
    });

    $("salaryNext")?.addEventListener("click", () => {
        salaryMonth.setMonth(salaryMonth.getMonth() + 1);
        renderSalaryReport();
    });

    $("salaryMonthInput")?.addEventListener("change", e => {
        if (!e.target.value) return;
        const [year, month] = e.target.value.split("-").map(Number);
        salaryMonth = new Date(year, month - 1, 1);
        renderSalaryReport();
    });

    /* =========================
       Authentication / Accounts
    ========================= */

    let authMode = "login";
    let signupMode = "personal";
    let signupAvatar = "🙂";

    function showAuthError(message) {
        const el = $("authError");
        if (el) el.textContent = message || "";
    }

    function setAppVisible(visible) {
        $("loadingScreen")?.classList.add("hidden");
        $("authScreen")?.classList.toggle("hidden", visible);
        $("appShell")?.classList.toggle("auth-hidden", !visible);
    }

    function setAuthMode(mode) {
        authMode = mode;
        $("loginTab")?.classList.toggle("active", mode === "login");
        $("signupTab")?.classList.toggle("active", mode === "signup");
        $("signupFields")?.classList.toggle("hidden", mode !== "signup");
        $("loginHeading")?.classList.toggle("hidden", mode === "signup");
        $("authSubmit").textContent = mode === "signup" ? "สร้างบัญชีและเริ่มใช้งาน" : "เข้าสู่ระบบ";
        $("authNote").textContent = mode === "signup" ? "หลังสมัคร ระบบจะสร้างกระเป๋าเงินตามรูปแบบที่คุณเลือก" : "ใช้บัญชี Supabase เดิมได้เลย";
        showAuthError("");
    }

    function setOnboardingMode(mode) {
        document.querySelectorAll("#onboardingOverlay .mode-choice").forEach(x => x.classList.toggle("selected", x.dataset.mode === mode));
        $("onboardingInviteField")?.classList.toggle("hidden", mode !== "join");
        $("onboardingOverlay").dataset.mode = mode;
    }

    function setOnboardingAvatar(avatar) {
        $("onboardingOverlay").dataset.avatar = avatar;
        document.querySelectorAll("#onboardingAvatarPicker .avatar-choice").forEach(x => x.classList.toggle("selected", x.dataset.avatar === avatar));
    }

    async function getMyHouseholds() {
        const { data, error } = await sb.rpc("get_my_households");
        if (error) throw error;
        return data || [];
    }

    async function loadHouseholdContext() {
        const rows = await getMyHouseholds();
        if (!rows.length) return false;
        const row = rows.find(x => x.id === currentHouseholdId) || rows[0];
        currentHouseholdId = row.id;
        localStorage.setItem("baantheung_household_id", currentHouseholdId);
        currentHousehold = { id:row.id, name:row.name || "", mode:row.mode || "personal", inviteCode:row.invite_code || "" };
        currentMemberName = row.member_name || "";
        currentProfile = { name:row.member_name || "", avatar:row.avatar || "🙂" };

        const { data: members, error } = await sb.from("household_members").select("user_id,member_name,avatar,role").eq("household_id",currentHouseholdId).order("created_at",{ascending:true});
        if (error) throw error;
        householdMembers = members || [];
        updateAutoMemberDisplay(currentMemberName);
        return true;
    }

    function onboardingModal(open) {
        const el = $("onboardingOverlay");
        if (!el) return;
        el.classList.toggle("show", open);
        document.body.style.overflow = open ? "hidden" : "";
    }

    async function completeOnboarding() {
        const name = $("profileName")?.value.trim();
        const mode = $("onboardingOverlay")?.dataset.mode || "personal";
        const avatar = $("onboardingOverlay")?.dataset.avatar || "🙂";
        const invite = $("onboardingInvite")?.value.trim().toUpperCase();
        if (!name) { $("onboardingError").textContent="กรุณาใส่ชื่อของคุณ"; return; }
        if (mode === "join" && !invite) { $("onboardingError").textContent="กรุณาใส่รหัสเชิญ"; return; }
        const button=$("onboardingSubmit"); button.disabled=true; button.textContent="กำลังตั้งค่าบัญชี…"; $("onboardingError").textContent="";
        try {
            let result;
            if (mode === "join") {
                const {data,error}=await sb.rpc("join_household_by_code",{p_invite_code:invite,p_member_name:name,p_avatar:avatar});
                if(error) throw error; result=data;
            } else {
                const {data,error}=await sb.rpc("create_household_for_user",{p_member_name:name,p_avatar:avatar,p_mode:mode});
                if(error) throw error; result=data;
            }
            currentHouseholdId=result;
            localStorage.setItem("baantheung_household_id",result);
            await loadHouseholdContext();
            onboardingModal(false);
            await loadFromSupabase();
            render();
            if (currentHousehold.mode === "shared" && currentHousehold.inviteCode) {
                alert(`สร้างบัญชีร่วมสำเร็จ\nรหัสเชิญ: ${currentHousehold.inviteCode}\nส่งรหัสนี้ให้อีกคนเพื่อเข้าบัญชีร่วม`);
            }
        } catch(err) {
            console.error(err); $("onboardingError").textContent=err.message || "ตั้งค่าบัญชีไม่สำเร็จ";
        } finally { button.disabled=false; button.textContent="เริ่มใช้งาน"; }
    }

    async function setupAuthenticatedUser() {
        const hasHousehold=await loadHouseholdContext();
        if (!hasHousehold) {
            setAppVisible(true);
            $("appShell")?.classList.add("auth-hidden");
            const pending=JSON.parse(localStorage.getItem("baantheung_pending_onboarding")||"null");
            $("profileName").value=pending?.name || session.user.user_metadata?.name || "";
            setOnboardingAvatar(pending?.avatar || session.user.user_metadata?.avatar || "🙂");
            setOnboardingMode(pending?.mode || "personal");
            if(pending?.invite) $("onboardingInvite").value=pending.invite;
            onboardingModal(true);
            return;
        }
        await loadFromSupabase();
        render();
        setAppVisible(true);
    }

    async function initAuth() {
        $("appShell")?.classList.add("auth-hidden");
        $("loadingScreen")?.classList.remove("hidden");
        $("authScreen")?.classList.add("hidden");
        const {data,error}=await sb.auth.getSession();
        if(error) throw error;
        if(data.session){ session=data.session; await setupAuthenticatedUser(); }
        else setAppVisible(false);

        sb.auth.onAuthStateChange(async (_event,newSession)=>{
            session=newSession;
            if(!newSession){transactions=[];householdMembers=[];currentMemberName="";currentHouseholdId="";setAppVisible(false);return;}
            try{await setupAuthenticatedUser();}catch(err){console.error(err);showAuthError(err.message||"เชื่อมต่อบัญชีไม่สำเร็จ");}
        });
    }

    $("loginTab")?.addEventListener("click",()=>setAuthMode("login"));
    $("signupTab")?.addEventListener("click",()=>setAuthMode("signup"));

    document.querySelectorAll("#signupAvatarPicker .avatar-choice").forEach(btn=>btn.onclick=()=>{
        signupAvatar=btn.dataset.avatar;
        document.querySelectorAll("#signupAvatarPicker .avatar-choice").forEach(x=>x.classList.toggle("selected",x===btn));
    });
    document.querySelectorAll("#signupFields .mode-choice").forEach(btn=>btn.onclick=()=>{
        signupMode=btn.dataset.mode;
        document.querySelectorAll("#signupFields .mode-choice").forEach(x=>x.classList.toggle("selected",x===btn));
        $("inviteField")?.classList.toggle("hidden",signupMode!=="join");
    });
    document.querySelectorAll("#onboardingOverlay .mode-choice").forEach(btn=>btn.onclick=()=>setOnboardingMode(btn.dataset.mode));
    document.querySelectorAll("#onboardingAvatarPicker .avatar-choice").forEach(btn=>btn.onclick=()=>setOnboardingAvatar(btn.dataset.avatar));

    $("authForm")?.addEventListener("submit",async e=>{
        e.preventDefault();
        const email=$("authEmail")?.value.trim(), password=$("authPassword")?.value, button=$("authSubmit");
        showAuthError(""); button.disabled=true; button.textContent=authMode==="signup"?"กำลังสมัคร…":"กำลังเข้าสู่ระบบ…";
        try{
            if(authMode==="signup"){
                const name=$("signupName")?.value.trim();
                if(!name) throw new Error("กรุณาใส่ชื่อที่ใช้ในบัญชี");
                const {data,error}=await sb.auth.signUp({email,password,options:{data:{name,avatar:signupAvatar}}});
                if(error) throw error;
                localStorage.setItem("baantheung_pending_onboarding",JSON.stringify({name,avatar:signupAvatar,mode:signupMode,invite:$("signupInvite")?.value.trim().toUpperCase()||""}));
                if(!data.session){showAuthError("สมัครสำเร็จ กรุณายืนยันอีเมลก่อน แล้วกลับมาเข้าสู่ระบบ");setAuthMode("login");$("authEmail").value=email;return;}
                session=data.session; await setupAuthenticatedUser();
            }else{
                const {data,error}=await sb.auth.signInWithPassword({email,password});
                if(error) throw error; session=data.session; await setupAuthenticatedUser();
            }
        }catch(err){console.error(err);showAuthError(err.message||"ไม่สามารถดำเนินการได้");}
        finally{button.disabled=false;button.textContent=authMode==="signup"?"สร้างบัญชีและเริ่มใช้งาน":"เข้าสู่ระบบ";}
    });

    $("logoutButton")?.addEventListener("click",async()=>{if(confirm("ต้องการออกจากระบบหรือไม่?")) await sb.auth.signOut();});
    $("onboardingSubmit")?.addEventListener("click",completeOnboarding);

    /* =========================
       Render
    ========================= */

    function render() {
        categoryFilter();
        dashboard();
        renderRecent();
        renderAll();
        report();
        renderReportPersons();

        if ($("calendarPage")?.classList.contains("active")) {
            calendar();
        }
    }

    if ($("date")) $("date").value = today();
    categoryOptions();
    initAuth().catch(error => {
        console.error(error);
        $("loadingScreen")?.classList.add("hidden");
        setAppVisible(false);
        showAuthError(error.message || "เชื่อมต่อ Supabase ไม่สำเร็จ");
    });
});
