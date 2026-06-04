import { createContext, useContext, useState, useCallback } from "react";

// Ported verbatim from the Day-1 prototype, plus keys the live app needs.
const I18N = {
  en: {
    tagline: "Camp management, simplified. Sign in to continue.",
    dashboard: "Dashboard", gers: "Ger Map", bookings: "Bookings", operators: "Operators",
    finance: "Finance", kitchen: "Kitchen", reports: "Reports", audit: "Activity Log", settings: "Website & Settings",
    signout: "Sign out", newBooking: "New booking", occupancy: "Occupancy", available: "Available",
    occupied: "Occupied", cleaning: "Cleaning", arrivalsToday: "Arrivals today", departuresToday: "Departures today",
    revenueMonth: "Revenue (month)", pendingInv: "Pending invoices", kitchenPnl: "Kitchen P&L today",
    queue: "Booking queue", smartAlloc: "Smart allocation", assignRec: "Assign to recommended gers",
    party: "Guests", nights: "Nights", channel: "Channel", guest: "Guest", capacity: "Capacity",
    features: "Features", status: "Status", currentGuest: "Current guest", noGuest: "Empty — available",
    stove: "Stove", ensuite: "Ensuite", view: "View", heating: "Heating", ref: "Ref", operator: "Operator",
    amount: "Amount", payStatus: "Payment", dates: "Dates", invoice: "Invoice", paid: "Paid", advance: "Advance",
    pending: "Pending", confirmed: "Confirmed", checked_in: "Checked-in", checked_out: "Checked-out", cancelled: "Cancelled",
    income: "Income", expense: "Expense", profit: "Net", category: "Category", note: "Note", add: "Add",
    revExpense: "Revenue vs Expense", invStatus: "Invoice status", byChannel: "Bookings by channel",
    seasonReport: "End-of-season summary", export: "Export", date: "Date", user: "User", action: "Action",
    detail: "Detail", time: "Time", recommend: "Recommended", reason: "Why", movedGer: "Moved ger",
    statusChanged: "Changed status", assigned: "Assigned booking", addedTxn: "Added transaction",
    created: "Created", updated: "Updated", deleted: "Deleted",
    noAccess: "You don't have access to this section.", contractOk: "Contract signed", contractNone: "No contract",
    contractPending: "Contract pending",
    totalRev: "Total revenue", bookingsCount: "Bookings", restaurant: "Restaurant", groceries: "Groceries",
    wages: "Staff wages", utilities: "Utilities", other: "Other",
    websiteNote: "Bilingual booking site + content manager land here in Phase 2 (Day 3). The admin edits photos, prices and promos from this dashboard; the public MN/EN site reads from the same database.",
    todayArr: "Today's arrivals", gerCol: "Ger", roomsFor: "Best fit for", waste: "spare beds",
    occ: "occupied", needGers: "needs", manage: "Manage", quickAdd: "Quick add",
    email: "Email", password: "Password", signIn: "Sign in", loginFailed: "Wrong email or password.",
    loading: "Loading…", save: "Save", cancel: "Cancel", close: "Close",
    guides: "Guides", services: "Services", servicesHint: "Comma-separated, e.g. Full board, Horse trek",
    checkIn: "Check-in", checkOut: "Check-out", country: "Country", contact: "Contact", phone: "Phone",
    addOperator: "Add operator", editOperator: "Edit operator", notes: "Notes",
    addGer: "Add ger", code: "Code", bedType: "Bed type",
    markCheckedIn: "Check in", markCheckedOut: "Check out & free gers", markCancelled: "Cancel booking",
    freedGers: "Gers set to cleaning", entries: "entries", noFit: "No fit available.",
    connErr: "Can't reach the server.", required: "Fill the required fields.",
    usersRoles: "Users & roles", publicSite: "Public booking site (MN / EN)",
    name: "Name", role: "Role", actions: "Actions", allTime: "all time", thisMonth: "this month",
    avgBooking: "Avg booking value", topOperator: "Top operator", kitchenNet: "Kitchen net",
    occupancyNow: "Occupancy now", totalBookings: "Total bookings", margin: "margin",
    newInvoice: "New invoice", number: "Number", issued: "Issued",
    printReport: "Print report", season: "Season",
  },
  mn: {
    tagline: "Кэмп удирдлага, хялбархан. Нэвтэрч орно уу.",
    dashboard: "Хяналт", gers: "Гэрийн зураг", bookings: "Захиалга", operators: "Туроператор",
    finance: "Санхүү", kitchen: "Гал тогоо", reports: "Тайлан", audit: "Үйлдлийн бүртгэл", settings: "Вэб ба тохиргоо",
    signout: "Гарах", newBooking: "Шинэ захиалга", occupancy: "Дүүргэлт", available: "Сул",
    occupied: "Дүүрэн", cleaning: "Цэвэрлэж буй", arrivalsToday: "Өнөөдрийн ирэлт", departuresToday: "Өнөөдрийн явалт",
    revenueMonth: "Орлого (сар)", pendingInv: "Төлбөр хүлээгдэж буй", kitchenPnl: "Гал тогооны ашиг (өнөөдөр)",
    queue: "Захиалгын дараалал", smartAlloc: "Ухаалаг хуваарилалт", assignRec: "Санал болгосон гэрт хуваарилах",
    party: "Зочид", nights: "Хоног", channel: "Суваг", guest: "Зочин", capacity: "Багтаамж",
    features: "Онцлог", status: "Төлөв", currentGuest: "Одоогийн зочин", noGuest: "Хоосон — сул",
    stove: "Зуух", ensuite: "Угаалгын өрөө", view: "Үзэмж", heating: "Халаалт", ref: "Дугаар", operator: "Оператор",
    amount: "Дүн", payStatus: "Төлбөр", dates: "Огноо", invoice: "Нэхэмжлэх", paid: "Төлсөн", advance: "Урьдчилгаа",
    pending: "Хүлээгдэж буй", confirmed: "Баталгаажсан", checked_in: "Бүртгэгдсэн", checked_out: "Гарсан", cancelled: "Цуцалсан",
    income: "Орлого", expense: "Зарлага", profit: "Цэвэр", category: "Ангилал", note: "Тэмдэглэл", add: "Нэмэх",
    revExpense: "Орлого ба зарлага", invStatus: "Нэхэмжлэхийн төлөв", byChannel: "Сувгаар захиалга",
    seasonReport: "Улирлын эцсийн тайлан", export: "Татах", date: "Огноо", user: "Хэрэглэгч", action: "Үйлдэл",
    detail: "Дэлгэрэнгүй", time: "Цаг", recommend: "Санал болгосон", reason: "Шалтгаан", movedGer: "Гэр зөөсөн",
    statusChanged: "Төлөв өөрчилсөн", assigned: "Захиалга хуваарилсан", addedTxn: "Гүйлгээ нэмсэн",
    created: "Үүсгэсэн", updated: "Зассан", deleted: "Устгасан",
    noAccess: "Танд энэ хэсэгт хандах эрх алга.", contractOk: "Гэрээ байгуулсан", contractNone: "Гэрээгүй",
    contractPending: "Гэрээ хүлээгдэж буй",
    totalRev: "Нийт орлого", bookingsCount: "Захиалга", restaurant: "Ресторан", groceries: "Хүнсний бараа",
    wages: "Ажиллах хүч", utilities: "Шугам сүлжээ", other: "Бусад",
    websiteNote: "MN/EN хос хэлний захиалгын сайт ба контент удирдлага 2-р шатанд энд орно. Админ зураг, үнэ, урамшууллыг энэ самбараас засна; нийтийн сайт ижил өгөгдлийн сангаас уншина.",
    todayArr: "Өнөөдрийн ирэлт", gerCol: "Гэр", roomsFor: "Тохирох", waste: "илүү ор",
    occ: "дүүрэн", needGers: "шаардлагатай", manage: "Удирдах", quickAdd: "Хурдан нэмэх",
    email: "Имэйл", password: "Нууц үг", signIn: "Нэвтрэх", loginFailed: "Имэйл эсвэл нууц үг буруу.",
    loading: "Ачаалж байна…", save: "Хадгалах", cancel: "Болих", close: "Хаах",
    guides: "Хөтөч", services: "Үйлчилгээ", servicesHint: "Таслалаар тусгаарлана, ж: Бүтэн хоол, Морин аялал",
    checkIn: "Ирэх", checkOut: "Гарах", country: "Улс", contact: "Холбоо барих", phone: "Утас",
    addOperator: "Оператор нэмэх", editOperator: "Оператор засах", notes: "Тэмдэглэл",
    addGer: "Гэр нэмэх", code: "Код", bedType: "Орны төрөл",
    markCheckedIn: "Бүртгэх", markCheckedOut: "Гаргах, гэр чөлөөлөх", markCancelled: "Захиалга цуцлах",
    freedGers: "Гэрүүд цэвэрлэгээнд орлоо", entries: "бичлэг", noFit: "Тохирох гэр алга.",
    connErr: "Сервертэй холбогдож чадсангүй.", required: "Шаардлагатай талбаруудыг бөглөнө үү.",
    usersRoles: "Хэрэглэгч ба эрх", publicSite: "Нийтийн захиалгын сайт (MN / EN)",
    name: "Нэр", role: "Эрх", actions: "Үйлдэл", allTime: "нийт", thisMonth: "энэ сар",
    avgBooking: "Дундаж захиалгын дүн", topOperator: "Шилдэг оператор", kitchenNet: "Гал тогооны цэвэр",
    occupancyNow: "Одоогийн дүүргэлт", totalBookings: "Нийт захиалга", margin: "ашиг",
    newInvoice: "Шинэ нэхэмжлэх", number: "Дугаар", issued: "Олгосон",
    printReport: "Тайлан хэвлэх", season: "Улирал",
  },
};

const LangCtx = createContext(null);

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => localStorage.getItem("geros_lang") || "en");
  const setLang = useCallback((l) => {
    localStorage.setItem("geros_lang", l);
    setLangState(l);
  }, []);
  const t = useCallback((k) => I18N[lang][k] ?? I18N.en[k] ?? k, [lang]);
  return <LangCtx.Provider value={{ lang, setLang, t }}>{children}</LangCtx.Provider>;
}

export function useLang() {
  return useContext(LangCtx);
}
