document.addEventListener("DOMContentLoaded", () => {
    const KEY = "baantheung_account_data";
    const OLD_KEY = "transactions";
    const SUPABASE_URL = "https://hqvwggayhilyraghfyxq.supabase.co";
    const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ZlVaEVAn0U7rLPnsxztqzQ_NfO5OeHM";
    const HOUSEHOLD_ID = "63cdcbd4-46ad-4524-aa0c-997f0c1f148b";
    const $ = id => document.getElementById(id);

    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    let session = null;
    let currentMemberName = "";

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
            .eq("household_id", HOUSEHOLD_ID)
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
            household_id: HOUSEHOLD_ID,
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
            household_id: HOUSEHOLD_ID,
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
        let income = 0, expense = 0, ken = 0, mint = 0;

        list.forEach(t => {
            if (t.type === "income") {
                income += t.amount;
                if (t.member === "เก้น") ken += t.amount;
                if (t.member === "มิ้น") mint += t.amount;
            } else {
                expense += t.amount;
                if (t.member === "เก้น") ken -= t.amount;
                if (t.member === "มิ้น") mint -= t.amount;
            }
        });

        return { income, expense, balance: income - expense, ken, mint };
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
        if ($("kenMoney")) $("kenMoney").textContent = money(t.ken);
        if ($("mintMoney")) $("mintMoney").textContent = money(t.mint);

        if ($("homeMonth")) {
            $("homeMonth").textContent = new Date().toLocaleDateString("th-TH", {
                month:"long", year:"numeric"
            });
        }
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
        const container = $("salaryRoundSummary");
        if (!container) return;

        const key = monthKey(salaryMonth);
        const label = salaryMonth.toLocaleDateString("th-TH", {
            month:"long", year:"numeric"
        });

        if ($("salaryMonthInput")) $("salaryMonthInput").value = key;

        const salary = transactions.filter(t =>
            t.type === "income" &&
            t.category === "เงินเดือน" &&
            t.date.startsWith(key)
        );

        let ken1 = 0, ken2 = 0, kenOther = 0, mint = 0;

        salary.forEach(t => {
            if (t.member === "เก้น") {
                if (t.salaryRound === "round1") ken1 += t.amount;
                else if (t.salaryRound === "round2") ken2 += t.amount;
                else kenOther += t.amount;
            } else if (t.member === "มิ้น") {
                mint += t.amount;
            }
        });

        const kenTotal = ken1 + ken2 + kenOther;
        const grandTotal = kenTotal + mint;
        const kenRound1Status = ken1 > 0 ? "รอบ 1 บันทึกแล้ว" : "รอบ 1 ยังไม่มี";
        const kenRound2Status = ken2 > 0 ? "รอบ 2 บันทึกแล้ว" : "รอบ 2 ยังไม่มี";
        const mintStatus = mint > 0 ? "เงินเดือนมิ้นบันทึกแล้ว" : "เงินเดือนมิ้นยังไม่มี";

        container.innerHTML = `
            <div class="salary-month-grid">
                <div class="salary-summary-card">
                    <div class="salary-summary-top">
                        <div class="avatar">ก</div>
                        <div><b>เก้น</b><small>เงินเดือนเดือนนี้</small></div>
                    </div>
                    <div class="salary-detail"><span>รอบที่ 1</span><strong>${money(ken1)}</strong></div>
                    <div class="salary-detail"><span>รอบที่ 2</span><strong>${money(ken2)}</strong></div>
                    ${kenOther ? `<div class="salary-detail"><span>ไม่ระบุรอบ</span><strong>${money(kenOther)}</strong></div>` : ""}
                    <div class="salary-total"><span>รวมเก้น</span><strong>${money(kenTotal)}</strong></div>
                    <div class="salary-check">
                        <span class="${ken1 > 0 ? "has-value" : "missing"}">${kenRound1Status}</span>
                        <span class="${ken2 > 0 ? "has-value" : "missing"}">${kenRound2Status}</span>
                    </div>
                </div>

                <div class="salary-summary-card">
                    <div class="salary-summary-top">
                        <div class="avatar">ม</div>
                        <div><b>มิ้น</b><small>เงินเดือนเดือนนี้</small></div>
                    </div>
                    <div class="salary-detail"><span>เงินเดือน</span><strong>${money(mint)}</strong></div>
                    <div class="salary-total"><span>รวมมิ้น</span><strong>${money(mint)}</strong></div>
                    <div class="salary-check">
                        <span class="${mint > 0 ? "has-value" : "missing"}">${mintStatus}</span>
                    </div>
                </div>
            </div>

            <div class="salary-grand-total">
                <span>เงินเดือนรวม ${esc(label)}</span>
                <strong>${money(grandTotal)}</strong>
            </div>

            <div class="salary-report-note">
                ${salary.length ? `พบรายการเงินเดือน ${salary.length} รายการในเดือนนี้` : "เดือนนี้ยังไม่มีรายการเงินเดือน"}
                ${kenOther ? " · มีเงินเดือนเก้นที่ยังไม่ได้ระบุรอบ" : ""}
            </div>
        `;
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
       Authentication / Online Sync
    ========================= */

    function showAuthError(message) {
        const el = $("authError");
        if (el) el.textContent = message || "";
    }

    function setAppVisible(visible) {
        $("loadingScreen")?.classList.add("hidden");
        $("authScreen")?.classList.toggle("hidden", visible);
        $("appShell")?.classList.toggle("auth-hidden", !visible);
    }

    async function setupAuthenticatedUser() {
        const { data: member, error: memberError } = await sb
            .from("household_members")
            .select("member_name")
            .eq("household_id", HOUSEHOLD_ID)
            .eq("user_id", session.user.id)
            .maybeSingle();
        if (memberError) throw memberError;
        if (!member) throw new Error("บัญชีนี้ยังไม่ได้ถูกผูกกับสมาชิก เก้น/มิ้น");

        currentMemberName = member.member_name;
        updateAutoMemberDisplay(currentMemberName);
        if ($("currentMemberBadge")) $("currentMemberBadge").textContent = currentMemberName + " · ออนไลน์";
        if ($("authMemberHint")) $("authMemberHint").textContent = "เข้าสู่ระบบในชื่อ " + currentMemberName;

        const { data: cloudBefore, error: cloudError } = await sb
            .from("transactions")
            .select("id")
            .eq("household_id", HOUSEHOLD_ID)
            .limit(1);
        if (cloudError) throw cloudError;
        const hadCloudData = Boolean(cloudBefore?.length);

        await loadFromSupabase();
        if (!hadCloudData) await importLocalDataIfCloudEmpty();
        render();
        setAppVisible(true);
    }

    async function initAuth() {
        $("appShell")?.classList.add("auth-hidden");
        $("loadingScreen")?.classList.remove("hidden");
        $("authScreen")?.classList.add("hidden");

        const { data, error } = await sb.auth.getSession();
        if (error) throw error;

        if (data.session) {
            session = data.session;
            try { await setupAuthenticatedUser(); }
            catch (err) {
                console.error(err);
                await sb.auth.signOut();
                setAppVisible(false);
                showAuthError(err.message || "เชื่อมต่อบัญชีไม่สำเร็จ");
            }
        } else {
            setAppVisible(false);
        }

        sb.auth.onAuthStateChange(async (_event, newSession) => {
            session = newSession;
            if (!newSession) {
                transactions = [];
                currentMemberName = "";
                setAppVisible(false);
                return;
            }
            try { await setupAuthenticatedUser(); }
            catch (err) {
                console.error(err);
                showAuthError(err.message || "เชื่อมต่อบัญชีไม่สำเร็จ");
                await sb.auth.signOut();
            }
        });
    }

    $("authForm")?.addEventListener("submit", async e => {
        e.preventDefault();
        const email = $("authEmail")?.value.trim();
        const password = $("authPassword")?.value;
        const button = $("authForm")?.querySelector('button[type="submit"]');
        showAuthError("");
        if (button) { button.disabled = true; button.textContent = "กำลังเข้าสู่ระบบ…"; }

        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) {
            showAuthError(error.message || "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
            if (button) { button.disabled = false; button.textContent = "เข้าสู่ระบบ"; }
            return;
        }
        session = data.session;
        try {
            await setupAuthenticatedUser();
        } catch (err) {
            showAuthError(err.message || "ไม่สามารถเปิดบัญชีได้");
            await sb.auth.signOut();
        }
        if (button) { button.disabled = false; button.textContent = "เข้าสู่ระบบ"; }
    });

    $("logoutButton")?.addEventListener("click", async () => {
        if (!confirm("ต้องการออกจากระบบหรือไม่?")) return;
        await sb.auth.signOut();
    });

    /* =========================
       Render
    ========================= */

    function render() {
        categoryFilter();
        dashboard();
        renderRecent();
        renderAll();
        report();

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
