require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { Telegraf, Markup, session } = require("telegraf");
const { ClinicAiService } = require("./ai");
const { clinicProfile, mainMenuRows } = require("./clinic-data");
const { JsonStore } = require("./storage");

const config = {
  token: process.env.TELEGRAM_BOT_TOKEN || "",
  adminChatIds: String(process.env.ADMIN_CHAT_IDS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  aiProvider: process.env.AI_PROVIDER || "auto",
  telegramProxyUrl: process.env.TELEGRAM_PROXY_URL || "",
  groqApiKey: process.env.GROQ_API_KEY || "",
  groqModel: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
  groqProxyUrl:
    process.env.GROQ_PROXY_URL ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.TELEGRAM_PROXY_URL ||
    "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite",
  ollamaUrl: process.env.OLLAMA_URL || "",
  ollamaModel:
    process.env.DENTAL_AI_MODEL ||
    process.env.REVENUE_AGENT_MODEL ||
    "qwen3.5:2b",
  aiRequestTimeoutMs: process.env.AI_REQUEST_TIMEOUT_MS || "15000",
  dataFile:
    process.env.BOT_DATA_FILE ||
    path.join(process.env.BOT_DATA_DIR || path.join(__dirname, "data"), "store.json"),
  pidFile:
    process.env.BOT_PID_FILE ||
    path.join(process.env.BOT_DATA_DIR || path.join(__dirname, "data"), "bot.pid"),
};

const store = new JsonStore(config.dataFile);
const ai = new ClinicAiService(config);

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toPersianDigits(value) {
  return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}

function formatDateFa(dateInput) {
  const date = new Date(dateInput);
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    dateStyle: "full",
    timeZone: "Asia/Tehran",
  }).format(date);
}

function formatTimeFa(time) {
  return toPersianDigits(time);
}

function buildMainKeyboard() {
  return Markup.keyboard(mainMenuRows).resize();
}

function buildPhoneKeyboard() {
  return Markup.keyboard([
    [Markup.button.contactRequest("ارسال شماره موبایل")],
    ["انصراف"],
  ])
    .resize()
    .oneTime();
}

function chunk(items, size) {
  const rows = [];

  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }

  return rows;
}

function createAppointmentId() {
  return `apt_${randomUUID().slice(0, 8)}`;
}

function makeInlineKeyboard(rows) {
  return Markup.inlineKeyboard(rows);
}

function getStatusLabel(status) {
  const labels = {
    pending_review: "در انتظار بررسی پذیرش",
    approved: "تایید شده",
    rejected: "رد شده",
    contacted: "تماس گرفته شد",
    cancelled: "لغو شده",
  };

  return labels[status] || status;
}

function createBot(token) {
  const telegramOptions = {};

  if (config.telegramProxyUrl) {
    telegramOptions.agent = new HttpsProxyAgent(config.telegramProxyUrl);
  }

  return new Telegraf(token, {
    telegram: telegramOptions,
  });
}

function isAdmin(ctx) {
  const fromId = String(ctx.from?.id || "");
  const chatId = String(ctx.chat?.id || "");
  return config.adminChatIds.includes(fromId) || config.adminChatIds.includes(chatId);
}

async function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function acquireProcessLock(lockFile) {
  await fs.mkdir(path.dirname(lockFile), { recursive: true });

  const writeOwnPid = async () => {
    await fs.writeFile(lockFile, `${process.pid}\n`, { flag: "wx" });
  };

  try {
    await writeOwnPid();
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }

    const existingPidRaw = await fs.readFile(lockFile, "utf8").catch(() => "");
    const existingPid = Number.parseInt(String(existingPidRaw).trim(), 10);

    if (await isProcessRunning(existingPid)) {
      throw new Error(
        `Another bot instance is already running with PID ${existingPid}. Stop it before starting a new one.`
      );
    }

    await fs.unlink(lockFile).catch(() => {});
    await writeOwnPid();
  }

  return async () => {
    const currentPid = await fs.readFile(lockFile, "utf8").catch(() => "");

    if (String(currentPid).trim() === String(process.pid)) {
      await fs.unlink(lockFile).catch(() => {});
    }
  };
}

function resetFlow(ctx) {
  ctx.session.flow = null;
  ctx.session.bookingDraft = {};
  ctx.session.aiMode = false;
}

async function rememberUser(ctx) {
  if (!ctx.from) {
    return;
  }

  await store.upsertUser({
    userId: String(ctx.from.id),
    chatId: String(ctx.chat?.id || ctx.from.id),
    username: ctx.from.username || "",
    firstName: ctx.from.first_name || "",
    lastName: ctx.from.last_name || "",
  });
}

function composeWelcomeMessage() {
  const servicesPreview = clinicProfile.services
    .slice(0, 4)
    .map((service) => `• ${service.title}`)
    .join("\n");

  return [
    `<b>${escapeHtml(clinicProfile.name)}</b>`,
    escapeHtml(clinicProfile.tagline),
    "",
    `مدیریت: ${escapeHtml(clinicProfile.manager)}`,
    `شهر: ${escapeHtml(clinicProfile.city)}`,
    `تلفن پذیرش: <code>${escapeHtml(clinicProfile.phone)}</code>`,
    "",
    "خدمات پرکاربرد:",
    escapeHtml(servicesPreview),
    "",
    "از منو می‌توانید نوبت رزرو کنید، سوال درمانی بپرسید، نوبت‌های خودتان را ببینید و اطلاعات کلینیک را دریافت کنید.",
  ].join("\n");
}

function buildBookingServiceKeyboard() {
  const buttons = clinicProfile.services.map((service) =>
    Markup.button.callback(service.title, `book:service:${service.id}`)
  );
  const rows = chunk(buttons, 2);
  rows.push([Markup.button.callback("انصراف", "book:cancel")]);
  return makeInlineKeyboard(rows);
}

function getNextBookableDays() {
  const days = [];
  const cursor = new Date();

  if (clinicProfile.booking.startFromTomorrow) {
    cursor.setDate(cursor.getDate() + 1);
  }

  while (days.length < clinicProfile.booking.daysToOffer) {
    if (!clinicProfile.booking.closedWeekdays.includes(cursor.getDay())) {
      const iso = cursor.toISOString().slice(0, 10);
      days.push({
        iso,
        label: formatDateFa(iso),
      });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

function buildDateKeyboard() {
  const buttons = getNextBookableDays().map((day) =>
    Markup.button.callback(day.label, `book:date:${day.iso}`)
  );
  const rows = chunk(buttons, 2);
  rows.push([Markup.button.callback("انصراف", "book:cancel")]);
  return makeInlineKeyboard(rows);
}

function buildTimeKeyboard(date, bookedSlots) {
  const buttons = clinicProfile.booking.slots
    .filter((slot) => !bookedSlots.includes(slot))
    .map((slot) =>
      Markup.button.callback(formatTimeFa(slot), `book:time:${slot}`)
    );

  const rows = chunk(buttons, 3);
  rows.push([Markup.button.callback("انتخاب روز دیگر", "book:back:date")]);
  rows.push([Markup.button.callback("انصراف", "book:cancel")]);

  return {
    hasSlots: buttons.length > 0,
    markup: makeInlineKeyboard(rows),
    summary: `ساعت‌های آزاد برای <b>${escapeHtml(formatDateFa(date))}</b>:`,
  };
}

function buildArticlesKeyboard() {
  const buttons = clinicProfile.articles.map((article) =>
    [Markup.button.callback(article.title, `article:${article.id}`)]
  );
  return makeInlineKeyboard(buttons);
}

function buildBookingSummary(draft) {
  return [
    "<b>خلاصه درخواست نوبت</b>",
    `خدمت: ${escapeHtml(draft.serviceTitle)}`,
    `تاریخ: ${escapeHtml(formatDateFa(draft.date))}`,
    `ساعت: ${escapeHtml(formatTimeFa(draft.time))}`,
    `نام بیمار: ${escapeHtml(draft.patientName)}`,
    `شماره تماس: <code>${escapeHtml(draft.phone)}</code>`,
    `توضیحات: ${escapeHtml(draft.notes || "ندارد")}`,
    "",
    "اگر اطلاعات درست است روی «تایید درخواست» بزنید.",
  ].join("\n");
}

function buildBookingConfirmKeyboard() {
  return makeInlineKeyboard([
    [Markup.button.callback("تایید درخواست", "book:confirm")],
    [Markup.button.callback("شروع دوباره", "book:restart")],
    [Markup.button.callback("انصراف", "book:cancel")],
  ]);
}

function buildAdminKeyboard(appointmentId) {
  return makeInlineKeyboard([
    [
      Markup.button.callback("تایید", `admin:appointment:approve:${appointmentId}`),
      Markup.button.callback("رد", `admin:appointment:reject:${appointmentId}`),
    ],
    [
      Markup.button.callback(
        "تماس گرفته شد",
        `admin:appointment:contacted:${appointmentId}`
      ),
      Markup.button.callback("لغو", `admin:appointment:cancelled:${appointmentId}`),
    ],
  ]);
}

async function showMainMenu(ctx, extraText) {
  const text =
    extraText ||
    "از منوی زیر بخش موردنظر را انتخاب کنید. اگر سوالی بنویسید، پاسخ‌گوی هوشمند به فارسی راهنمایی پزشکی عمومی و دندان‌پزشکی می‌دهد.";
  await ctx.reply(text, buildMainKeyboard());
}

async function startBooking(ctx) {
  ctx.session.aiMode = false;
  ctx.session.flow = "booking";
  ctx.session.bookingDraft = {};

  await ctx.replyWithHTML(
    [
      "<b>رزرو نوبت جدید</b>",
      clinicProfile.bookingPolicy,
      "ابتدا نوع خدمت را انتخاب کنید:",
    ].join("\n"),
    buildBookingServiceKeyboard()
  );
}

async function promptForPatientName(ctx) {
  ctx.session.flow = "booking_name";
  await ctx.reply("نام و نام خانوادگی بیمار را ارسال کنید.", buildMainKeyboard());
}

async function promptForPhone(ctx) {
  ctx.session.flow = "booking_phone";
  await ctx.reply(
    "شماره موبایل بیمار را بفرستید یا از دکمه ارسال شماره استفاده کنید.",
    buildPhoneKeyboard()
  );
}

async function promptForNotes(ctx) {
  ctx.session.flow = "booking_notes";
  await ctx.reply(
    "اگر توضیحی مثل درد، حساسیت، سابقه درمان یا ساعت ترجیحی دارید بنویسید. اگر توضیحی ندارید «ندارم» را بفرستید.",
    buildMainKeyboard()
  );
}

async function sendBookingSummary(ctx) {
  ctx.session.flow = "booking_confirm";
  await ctx.replyWithHTML(
    buildBookingSummary(ctx.session.bookingDraft),
    buildBookingConfirmKeyboard()
  );
}

async function showMyAppointments(ctx) {
  const appointments = await store.getAppointmentsByUser(String(ctx.from?.id || ""));

  if (!appointments.length) {
    await ctx.reply("هنوز نوبتی برای این حساب ثبت نشده است.", buildMainKeyboard());
    return;
  }

  const message = appointments
    .slice(0, 8)
    .map((item, index) => {
      return [
        `${toPersianDigits(index + 1)}. ${item.serviceTitle}`,
        `تاریخ: ${formatDateFa(item.date)}`,
        `ساعت: ${formatTimeFa(item.time)}`,
        `وضعیت: ${getStatusLabel(item.status)}`,
        `کد پیگیری: <code>${item.id}</code>`,
      ].join("\n");
    })
    .join("\n\n");

  await ctx.replyWithHTML(`<b>نوبت‌های شما</b>\n\n${message}`, buildMainKeyboard());
}

async function showServices(ctx) {
  const message = clinicProfile.services
    .map((service) => `• <b>${escapeHtml(service.title)}</b>\n${escapeHtml(service.summary)}`)
    .join("\n\n");

  await ctx.replyWithHTML(`<b>خدمات کلینیک</b>\n\n${message}`, buildMainKeyboard());
}

async function showArticles(ctx) {
  await ctx.replyWithHTML(
    "<b>دانستنی‌های دندان</b>\nیکی از موضوعات زیر را انتخاب کنید:",
    buildArticlesKeyboard()
  );
}

async function showPricingAndInsurance(ctx) {
  await ctx.replyWithHTML(
    [
      "<b>تعرفه و بیمه</b>",
      "تعرفه نهایی هر درمان بعد از معاینه، عکس و تشخیص پزشک مشخص می‌شود.",
      clinicProfile.insuranceNote,
      "اگر می‌خواهید برآورد دقیق‌تری بگیرید، نوع خدمت و بیمه خودتان را برای پذیرش بنویسید یا نوبت ثبت کنید.",
    ].join("\n\n"),
    buildMainKeyboard()
  );
}

async function showContact(ctx) {
  await ctx.replyWithHTML(
    [
      `<b>${escapeHtml(clinicProfile.name)}</b>`,
      `مدیریت: ${escapeHtml(clinicProfile.manager)}`,
      `تلفن پذیرش: <code>${escapeHtml(clinicProfile.phone)}</code>`,
      `اینستاگرام: ${escapeHtml(clinicProfile.instagram)}`,
      `شهر: ${escapeHtml(clinicProfile.city)}`,
      "",
      escapeHtml(clinicProfile.about),
    ].join("\n"),
    buildMainKeyboard()
  );
}

async function showLocation(ctx) {
  await ctx.replyWithHTML(
    [
      "<b>موقعیت کلینیک</b>",
      `برای مشاهده روی نقشه از این لینک استفاده کنید:\n${escapeHtml(
        clinicProfile.mapUrl
      )}`,
    ].join("\n\n"),
    buildMainKeyboard()
  );
}

async function activateAiMode(ctx) {
  ctx.session.aiMode = true;
  ctx.session.flow = "ai_chat";

  await ctx.reply(
    "پاسخ‌گوی هوشمند فعال شد. سوال پزشکی یا دندان‌پزشکی‌تان را به فارسی بنویسید. برای پاسخ بهتر، سن، مدت علائم، شدت درد، تب و بیماری زمینه‌ای را هم بنویسید. برای توقف، «بازگشت به منو» یا /cancel را بزنید.",
    buildMainKeyboard()
  );
}

async function answerWithAi(ctx, text) {
  await ctx.reply("در حال آماده‌کردن پاسخ...", buildMainKeyboard());
  const answer = await ai.answer(text, {
    userId: String(ctx.from?.id || ""),
    userName: [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" "),
  });
  await ctx.replyWithHTML(escapeHtml(answer), buildMainKeyboard());
}

async function notifyAdmins(bot, appointment) {
  if (!config.adminChatIds.length) {
    return;
  }

  const message = [
    "<b>درخواست جدید نوبت</b>",
    `کد پیگیری: <code>${escapeHtml(appointment.id)}</code>`,
    `نام بیمار: ${escapeHtml(appointment.patientName)}`,
    `خدمت: ${escapeHtml(appointment.serviceTitle)}`,
    `تاریخ: ${escapeHtml(formatDateFa(appointment.date))}`,
    `ساعت: ${escapeHtml(formatTimeFa(appointment.time))}`,
    `شماره تماس: <code>${escapeHtml(appointment.phone)}</code>`,
    `توضیحات: ${escapeHtml(appointment.notes || "ندارد")}`,
    `نام کاربری تلگرام: ${escapeHtml(appointment.username || "ندارد")}`,
  ].join("\n");

  await Promise.allSettled(
    config.adminChatIds.map((chatId) =>
      bot.telegram.sendMessage(chatId, message, {
        parse_mode: "HTML",
        reply_markup: buildAdminKeyboard(appointment.id).reply_markup,
      })
    )
  );
}

async function createAppointment(ctx, bot) {
  const draft = ctx.session.bookingDraft;
  const bookedSlots = await store.getBookedSlots(draft.date);

  if (bookedSlots.includes(draft.time)) {
    ctx.session.flow = "booking";
    ctx.session.bookingDraft = {
      ...ctx.session.bookingDraft,
      time: null,
    };

    await ctx.replyWithHTML(
      "این ساعت همین الان رزرو شده است. لطفاً یک ساعت دیگر انتخاب کنید:",
      buildTimeKeyboard(draft.date, bookedSlots).markup
    );
    return;
  }

  const appointment = {
    id: createAppointmentId(),
    userId: String(ctx.from?.id || ""),
    chatId: String(ctx.chat?.id || ""),
    username: ctx.from?.username || "",
    patientName: draft.patientName,
    phone: draft.phone,
    serviceId: draft.serviceId,
    serviceTitle: draft.serviceTitle,
    date: draft.date,
    time: draft.time,
    notes: draft.notes,
    status: "pending_review",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await store.addAppointment(appointment);
  await notifyAdmins(bot, appointment);

  resetFlow(ctx);

  await ctx.replyWithHTML(
    [
      "<b>درخواست نوبت شما ثبت شد.</b>",
      `کد پیگیری: <code>${escapeHtml(appointment.id)}</code>`,
      `خدمت: ${escapeHtml(appointment.serviceTitle)}`,
      `تاریخ: ${escapeHtml(formatDateFa(appointment.date))}`,
      `ساعت: ${escapeHtml(formatTimeFa(appointment.time))}`,
      "",
      config.adminChatIds.length
        ? "پذیرش پس از بررسی، وضعیت نوبت را برای شما ارسال می‌کند."
        : "نوبت در سیستم ثبت شد. برای فعال‌شدن تایید ادمین، `ADMIN_CHAT_IDS` را در تنظیمات قرار دهید.",
    ].join("\n"),
    buildMainKeyboard()
  );
}

async function showAdminSummary(ctx) {
  if (!isAdmin(ctx)) {
    await ctx.reply("این دستور فقط برای ادمین فعال است.");
    return;
  }

  const stats = await store.getStats();
  await ctx.replyWithHTML(
    [
      "<b>گزارش ادمین</b>",
      `کل بیماران ثبت‌شده: ${toPersianDigits(stats.totalUsers)}`,
      `کل نوبت‌ها: ${toPersianDigits(stats.totalAppointments)}`,
      `در انتظار بررسی: ${toPersianDigits(stats.pending)}`,
      `تاییدشده: ${toPersianDigits(stats.approved)}`,
      `لغوشده: ${toPersianDigits(stats.cancelled)}`,
    ].join("\n")
  );
}

async function handleAdminAction(ctx, action, appointmentId) {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("دسترسی ندارید.", { show_alert: true });
    return;
  }

  const appointment = await store.updateAppointment(appointmentId, (current) => {
    if (!current) {
      return current;
    }

    const nextStatusMap = {
      approve: "approved",
      reject: "rejected",
      contacted: "contacted",
      cancelled: "cancelled",
    };

    return {
      ...current,
      status: nextStatusMap[action] || current.status,
      adminAction: action,
    };
  });

  if (!appointment) {
    await ctx.answerCbQuery("نوبت پیدا نشد.", { show_alert: true });
    return;
  }

  await ctx.answerCbQuery("وضعیت نوبت به‌روزرسانی شد.");
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});

  const statusText = getStatusLabel(appointment.status);

  await ctx.replyWithHTML(
    `وضعیت نوبت <code>${escapeHtml(appointment.id)}</code> به «${escapeHtml(
      statusText
    )}» تغییر کرد.`
  );

  await ctx.telegram
    .sendMessage(
      appointment.chatId,
      [
        "<b>به‌روزرسانی وضعیت نوبت</b>",
        `کد پیگیری: <code>${escapeHtml(appointment.id)}</code>`,
        `وضعیت جدید: ${escapeHtml(statusText)}`,
        `تاریخ: ${escapeHtml(formatDateFa(appointment.date))}`,
        `ساعت: ${escapeHtml(formatTimeFa(appointment.time))}`,
      ].join("\n"),
      {
        parse_mode: "HTML",
      }
    )
    .catch(() => {});
}

async function registerBotCommands(bot) {
  await bot.telegram.setMyCommands([
    { command: "start", description: "شروع و نمایش منو" },
    { command: "help", description: "راهنمای استفاده" },
    { command: "myid", description: "نمایش شناسه کاربر و چت" },
    { command: "cancel", description: "لغو عملیات جاری" },
    { command: "admin", description: "گزارش ادمین" },
  ]);
}

function validatePhoneNumber(text) {
  const digits = String(text || "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) {
    return null;
  }
  return digits;
}

function describeAiProvider() {
  const configuredProvider = String(config.aiProvider || "auto").trim().toLowerCase() || "auto";

  if (configuredProvider === "groq" && config.groqApiKey) {
    return `Groq (${config.groqModel})`;
  }

  if (configuredProvider === "gemini" && config.geminiApiKey) {
    return `Gemini (${config.geminiModel})`;
  }

  if (configuredProvider === "ollama" && config.ollamaUrl) {
    return `Ollama (${config.ollamaModel})`;
  }

  if (config.groqApiKey) {
    return `Groq (${config.groqModel}) [auto]`;
  }

  if (config.geminiApiKey) {
    return `Gemini (${config.geminiModel}) [auto]`;
  }

  if (config.ollamaUrl) {
    return `Ollama (${config.ollamaModel}) [auto]`;
  }

  return "Local FAQ fallback";
}

async function runCheck() {
  await store.init();
  console.log(`Data file ready: ${config.dataFile}`);

  if (!config.token) {
    console.error("Missing TELEGRAM_BOT_TOKEN");
    process.exitCode = 1;
    return;
  }

  const bot = createBot(config.token);
  const me = await bot.telegram.getMe();
  console.log(`Telegram bot is reachable: @${me.username}`);
  console.log(
    config.telegramProxyUrl
      ? `Telegram proxy: ${config.telegramProxyUrl}`
      : "Telegram proxy is not configured."
  );
  console.log(
    `AI provider: ${describeAiProvider()}`
  );
  console.log(
    config.adminChatIds.length
      ? `Admin chats configured: ${config.adminChatIds.length}`
      : "Admin chats are not configured yet."
  );
}

async function main() {
  if (process.argv.includes("--check")) {
    await runCheck();
    return;
  }

  if (!config.token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required to start the bot");
  }

  const releaseProcessLock = await acquireProcessLock(config.pidFile);
  await store.init();

  const bot = createBot(config.token);
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    bot.stop(signal);
    await releaseProcessLock().catch(() => {});
  };

  process.once("SIGINT", () => {
    shutdown("SIGINT").finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    shutdown("SIGTERM").finally(() => process.exit(0));
  });

  bot.use(session());
  bot.use(async (ctx, next) => {
    ctx.session ??= {};
    ctx.session.flow ??= null;
    ctx.session.bookingDraft ??= {};
    ctx.session.aiMode ??= false;
    await rememberUser(ctx);
    await next();
  });

  bot.start(async (ctx) => {
    resetFlow(ctx);
    await ctx.replyWithHTML(composeWelcomeMessage(), buildMainKeyboard());
  });

  bot.command("help", async (ctx) => {
    await ctx.replyWithHTML(
      [
        "<b>راهنمای ربات</b>",
        "• برای ثبت نوبت از «رزرو نوبت جدید» استفاده کنید.",
        "• برای دیدن وضعیت درخواست‌ها «نوبت‌های من» را بزنید.",
        "• سوال پزشکی عمومی یا دندان‌پزشکی را به فارسی بنویسید تا پاسخ‌گوی هوشمند راهنمایی کند.",
        "• با /myid شناسه چت و کاربر خودتان را می‌بینید.",
        "• با /cancel هر فرایند جاری لغو می‌شود.",
      ].join("\n"),
      buildMainKeyboard()
    );
  });

  bot.command("myid", async (ctx) => {
    await ctx.replyWithHTML(
      [
        "<b>شناسه‌های این گفتگو</b>",
        `chat_id: <code>${escapeHtml(String(ctx.chat?.id || ""))}</code>`,
        `user_id: <code>${escapeHtml(String(ctx.from?.id || ""))}</code>`,
      ].join("\n"),
      buildMainKeyboard()
    );
  });

  bot.command("cancel", async (ctx) => {
    resetFlow(ctx);
    await showMainMenu(ctx, "عملیات جاری لغو شد.");
  });

  bot.command("admin", showAdminSummary);

  bot.hears("بازگشت به منو", async (ctx) => {
    resetFlow(ctx);
    await showMainMenu(ctx, "به منوی اصلی برگشتید.");
  });
  bot.hears("رزرو نوبت جدید", startBooking);
  bot.hears("نوبت‌های من", showMyAppointments);
  bot.hears("پاسخ‌گوی هوشمند", activateAiMode);
  bot.hears("خدمات کلینیک", showServices);
  bot.hears("دانستنی‌های دندان", showArticles);
  bot.hears("تعرفه و بیمه", showPricingAndInsurance);
  bot.hears("ارتباط با ما", showContact);
  bot.hears("موقعیت کلینیک", showLocation);
  bot.hears("انصراف", async (ctx) => {
    resetFlow(ctx);
    await showMainMenu(ctx, "فرایند لغو شد.");
  });

  bot.action(/^article:(.+)$/, async (ctx) => {
    const article = clinicProfile.articles.find((item) => item.id === ctx.match[1]);
    await ctx.answerCbQuery();

    if (!article) {
      await ctx.reply("مطلب پیدا نشد.", buildMainKeyboard());
      return;
    }

    await ctx.replyWithHTML(
      `<b>${escapeHtml(article.title)}</b>\n\n${escapeHtml(article.body)}`,
      buildMainKeyboard()
    );
  });

  bot.action(/^book:service:(.+)$/, async (ctx) => {
    const service = clinicProfile.services.find((item) => item.id === ctx.match[1]);
    await ctx.answerCbQuery();

    if (!service) {
      await ctx.reply("خدمت انتخاب‌شده معتبر نیست.", buildMainKeyboard());
      return;
    }

    ctx.session.flow = "booking";
    ctx.session.bookingDraft = {
      ...ctx.session.bookingDraft,
      serviceId: service.id,
      serviceTitle: service.title,
    };

    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    await ctx.replyWithHTML(
      `خدمت <b>${escapeHtml(service.title)}</b> انتخاب شد.\nحالا تاریخ مدنظرتان را انتخاب کنید:`,
      buildDateKeyboard()
    );
  });

  bot.action(/^book:date:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    const date = ctx.match[1];
    ctx.session.bookingDraft = {
      ...ctx.session.bookingDraft,
      date,
    };

    const bookedSlots = await store.getBookedSlots(date);
    const { hasSlots, markup, summary } = buildTimeKeyboard(date, bookedSlots);

    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});

    if (!hasSlots) {
      await ctx.replyWithHTML(
        `برای <b>${escapeHtml(formatDateFa(date))}</b> وقتی آزاد نیست. روز دیگری را انتخاب کنید:`,
        buildDateKeyboard()
      );
      return;
    }

    await ctx.replyWithHTML(summary, markup);
  });

  bot.action(/^book:time:(\d{2}:\d{2})$/, async (ctx) => {
    const time = ctx.match[1];
    ctx.session.bookingDraft = {
      ...ctx.session.bookingDraft,
      time,
    };

    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    await promptForPatientName(ctx);
  });

  bot.action("book:back:date", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.replyWithHTML("روز موردنظر را دوباره انتخاب کنید:", buildDateKeyboard());
  });

  bot.action("book:restart", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    await startBooking(ctx);
  });

  bot.action("book:cancel", async (ctx) => {
    await ctx.answerCbQuery("رزرو لغو شد.");
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    resetFlow(ctx);
    await showMainMenu(ctx, "درخواست رزرو لغو شد.");
  });

  bot.action("book:confirm", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
    await createAppointment(ctx, bot);
  });

  bot.action(/^admin:appointment:(approve|reject|contacted|cancelled):(.+)$/, async (ctx) => {
    const [, action, appointmentId] = ctx.match;
    await handleAdminAction(ctx, action, appointmentId);
  });

  bot.on("contact", async (ctx) => {
    if (ctx.session.flow !== "booking_phone") {
      return;
    }

    const phone = validatePhoneNumber(ctx.message.contact.phone_number);

    if (!phone) {
      await ctx.reply("شماره تماس معتبر نبود. دوباره تلاش کنید.", buildPhoneKeyboard());
      return;
    }

    ctx.session.bookingDraft = {
      ...ctx.session.bookingDraft,
      phone,
    };
    await promptForNotes(ctx);
  });

  bot.on("text", async (ctx) => {
    const text = String(ctx.message.text || "").trim();

    if (!text) {
      return;
    }

    if (ctx.session.flow === "booking_name") {
      if (text.length < 3) {
        await ctx.reply("نام بیمار خیلی کوتاه است. لطفاً نام و نام خانوادگی را کامل‌تر وارد کنید.");
        return;
      }

      ctx.session.bookingDraft = {
        ...ctx.session.bookingDraft,
        patientName: text,
      };
      await promptForPhone(ctx);
      return;
    }

    if (ctx.session.flow === "booking_phone") {
      const phone = validatePhoneNumber(text);

      if (!phone) {
        await ctx.reply("شماره موبایل معتبر نیست. دوباره ارسال کنید یا از دکمه ارسال شماره استفاده کنید.", buildPhoneKeyboard());
        return;
      }

      ctx.session.bookingDraft = {
        ...ctx.session.bookingDraft,
        phone,
      };
      await promptForNotes(ctx);
      return;
    }

    if (ctx.session.flow === "booking_notes") {
      ctx.session.bookingDraft = {
        ...ctx.session.bookingDraft,
        notes: text === "ندارم" ? "" : text,
      };
      await sendBookingSummary(ctx);
      return;
    }

    await answerWithAi(ctx, text);
  });

  bot.catch((error, ctx) => {
    console.error("Telegram bot error:", error);
    if (ctx?.reply) {
      ctx.reply("خطایی رخ داد. لطفاً دوباره تلاش کنید.").catch(() => {});
    }
  });

  await registerBotCommands(bot);
  console.log("Sobhan dental clinic bot is running.");
  const launchPromise = bot.launch();
  await launchPromise.finally(async () => {
    await releaseProcessLock().catch(() => {});
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
