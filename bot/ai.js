const https = require("node:https");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { buildClinicSummary, clinicProfile } = require("./clinic-data");

const GENERAL_EMERGENCY_NOTICE =
  "اگر درد قفسه سینه، تنگی نفس، کبودی، ضعف یا بی‌حسی یک‌طرفه، گیجی شدید، تشنج، خونریزی کنترل‌نشده، افت سطح هوشیاری، استفراغ مداوم، تب خیلی بالا، کم‌آبی شدید یا بدترشدن سریع علائم دارید، فقط به پیام ربات اکتفا نکنید و سریع با اورژانس یا نزدیک‌ترین مرکز درمانی تماس بگیرید.";

function buildSystemPrompt() {
  return [
    "تو دستیار هوشمند سلامت برای یک ربات فارسی هستی و باید فقط به زبان فارسی پاسخ بدهی.",
    "پاسخ‌ها باید کاربردی، حرفه‌ای، روشن و قابل‌فهم باشند.",
    "می‌توانی درباره سوالات پزشکی عمومی و دندان‌پزشکی توضیح آموزشی بدهی، اما نباید خودت را جای پزشک متخصص جا بزنی.",
    "تشخیص قطعی، نسخه دارویی، دوز دارو، قطع یا شروع دارو و وعده درمان قطعی نده.",
    "برای هر سوال پزشکی، در حد امکان این 4 بخش را پوشش بده: برداشت کلی، علائم هشدار، اقدام امن اولیه، و مراجعه پیشنهادی.",
    "اگر اطلاعات کافی نیست، به‌جای جواب مبهم، خیلی کوتاه بگو چه اطلاعاتی لازم است؛ مثل سن، مدت علائم، تب، بیماری زمینه‌ای، بارداری، داروها یا شدت درد.",
    "اگر سوال خارج از دندان‌پزشکی باشد، پاسخ آموزشی عمومی بده و در صورت نیاز مراجعه به پزشک مرتبط را پیشنهاد کن.",
    "در سوالات دندانی بین پوسیدگی و حساسیت، التهاب عصب، آبسه و عفونت، بیماری لثه، دندان عقل، ترک یا شکستگی دندان، درد بعد از عصب‌کشی یا کشیدن، و درد مفصل فک یا دندان‌قروچه فرق بگذار و توضیح بده کدام الگو به شرح‌حال نزدیک‌تر است.",
    "در سوالات دندانی، اگر درد خودبه‌خود، درد شبانه، ورم، تب، طعم بد دهان، درد هنگام جویدن، لق‌شدن دندان یا سختی در بازکردن دهان مطرح بود، سطح فوریت را شفاف بگو.",
    "اگر سوال دندان‌پزشکی بود، در صورت مناسب بودن بیمار را به رزرو نوبت در همین ربات راهنمایی کن.",
    "اگر علائم خطر وجود داشت، کاربر را به مراجعه فوری یا اورژانس راهنمایی کن.",
    "اطلاعات کلینیک:",
    buildClinicSummary(),
  ].join("\n");
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ك/g, "ک")
    .replace(/ي/g, "ی");
}

function detectUrgency(question) {
  const text = normalizeText(question);
  const urgentKeywords = [
    "تورم شدید",
    "تب",
    "خونریزی",
    "چرک",
    "عفونت شدید",
    "ضربه",
    "شکستگی",
    "نفس",
    "بلع",
    "تنگی نفس",
    "درد قفسه سینه",
    "بیهوش",
    "افت هوشیاری",
    "تشنج",
    "فلج",
    "بی حسی",
    "بی‌حسی",
    "ضعف یک طرفه",
    "خونریزی شدید",
    "استفراغ مداوم",
  ];

  return urgentKeywords.some((keyword) => text.includes(normalizeText(keyword)));
}

function detectDentalTopic(question) {
  const text = normalizeText(question);
  const dentalKeywords = [
    "دندان",
    "لثه",
    "دهان",
    "فک",
    "جرم گیری",
    "جرم‌گیری",
    "کامپوزیت",
    "لمینت",
    "بلیچینگ",
    "ایمپلنت",
    "عصب کشی",
    "عصب‌کشی",
    "پوسیدگی",
    "ارتودنسی",
    "دندان عقل",
  ];

  return dentalKeywords.some((keyword) => text.includes(normalizeText(keyword)));
}

function findLocalAnswer(question) {
  if (!detectDentalTopic(question)) {
    return null;
  }

  const text = normalizeText(question);
  let bestMatch = null;
  let bestScore = 0;

  for (const item of clinicProfile.faq) {
    const score = item.keywords.reduce((total, keyword) => {
      return total + (text.includes(normalizeText(keyword)) ? 1 : 0);
    }, 0);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = item;
    }
  }

  if (!bestMatch || bestScore === 0) {
    return null;
  }

  return bestMatch.answer;
}

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(normalizeText(keyword)));
}

function extractDentalSignals(question) {
  const text = normalizeText(question);

  return {
    pain: includesAny(text, ["درد", "تیر", "ضربان", "حساسیت", "ناراحتی"]),
    swelling: includesAny(text, ["ورم", "تورم", "باد کرده", "متورم", "پف"]),
    fever: includesAny(text, ["تب", "لرز", "بی حالی", "بی‌حالی"]),
    pusOrBadTaste: includesAny(text, ["چرک", "عفونت", "ترشح", "طعم بد", "مزه بد", "بوی بد"]),
    throbbingNight: includesAny(text, ["ضربان", "نبض", "شب", "از خواب", "خودبه خود", "خودبخود", "تیر می‌کشد", "تیر میکشد"]),
    thermalSensitivity: includesAny(text, ["سرد", "گرم", "شیرین", "یخ", "چای", "حساسیت"]),
    bitePain: includesAny(text, ["جویدن", "گاز", "فشار", "روی دندان", "بستن فک"]),
    bleedingGums: includesAny(text, ["خونریزی لثه", "خون میاد", "خون می‌آید", "هنگام مسواک", "نخ دندان", "لثه"]),
    brokenTooth: includesAny(text, ["شکسته", "شکست", "لب پر", "لب‌پر", "ترک", "پریدگی", "پرکردگی افتاده", "روکش افتاده"]),
    wisdomTooth: includesAny(text, ["دندان عقل", "عقل"]),
    postExtraction: includesAny(text, ["بعد از کشیدن", "بعد کشیدن", "کشیدم", "پس از کشیدن", "جای دندان", "سوکت"]),
    postRootCanal: includesAny(text, ["بعد از عصب کشی", "بعد عصب کشی", "بعد از عصب‌کشی", "بعد عصب‌کشی"]),
    orthodontic: includesAny(text, ["ارتودنسی", "براکت", "سیم", "الاینر"]),
    jawOrGrinding: includesAny(text, ["فک", "تق تق", "تق‌تق", "قفل", "باز کردن دهان", "دندان قروچه", "دندان‌قروچه", "فشار فک"]),
    ulcer: includesAny(text, ["آفت", "زخم دهان", "زخم داخل دهان", "زخم زبان"]),
    looseTooth: includesAny(text, ["لق", "لقی", "تکان میخورد", "تکان می‌خورد"]),
  };
}

function buildDentalFallback(question, localAnswer) {
  const signals = extractDentalSignals(question);
  const parts = [];
  const detailsNeeded = [
    "سن",
    "مدت علائم",
    "این‌که درد خودبه‌خود است یا فقط با سرد و گرم/جویدن بدتر می‌شود",
    "وجود ورم یا تب",
    "وجود طعم بد دهان یا ترشح",
    "این‌که درد به گوش یا فک می‌زند یا نه",
  ].join("، ");

  if (signals.swelling && (signals.fever || signals.pusOrBadTaste)) {
    parts.push(
      "ترکیب درد دندان با ورم، تب، طعم بد دهان یا ترشح بیشتر به نفع عفونت یا آبسه دندانی است. این حالت معمولاً فقط با معاینه و گاهی عکس مشخص می‌شود و بهتر است مراجعه را به تعویق نیندازید."
    );
  } else if (signals.throbbingNight || (signals.bitePain && signals.thermalSensitivity)) {
    parts.push(
      "درد ضربانی، درد شبانه، یا دردی که با سرد و گرم و بعد با جویدن تشدید می‌شود بیشتر با التهاب عصب دندان، پوسیدگی عمیق، ترک دندان یا شروع عفونت سازگار است. بدون معاینه نمی‌شود بین این‌ها قطعی نظر داد، اما این الگو معمولاً نیاز به بررسی زودتر دارد."
    );
  } else if (signals.thermalSensitivity) {
    parts.push(
      "اگر درد بیشتر با سرد، گرم یا شیرینی تحریک می‌شود و دائمی نیست، بیشتر به حساسیت دندانی، پوسیدگی سطحی‌تر، ترک مینایی یا مشکل ترمیم قبلی می‌خورد. اگر این حساسیت ماندگار شده یا شدت آن رو به افزایش است، باید بررسی شود."
    );
  } else if (signals.bleedingGums || signals.looseTooth) {
    parts.push(
      "خونریزی لثه، بوی بد دهان، درد موقع جویدن یا لق‌شدن دندان بیشتر به نفع التهاب لثه یا بیماری لثه است. در این موارد فقط مسواک‌زدن شدیدتر کافی نیست و گاهی نیاز به جرم‌گیری و ارزیابی لثه وجود دارد."
    );
  } else if (signals.wisdomTooth) {
    parts.push(
      "درد دندان عقل، مخصوصاً اگر با ورم لثه پشت دهان، سختی در باز کردن دهان، بوی بد یا گیر غذایی همراه باشد، می‌تواند از التهاب بافت اطراف دندان عقل نیمه‌نهفته باشد. این مورد بسته به وضعیت رویش دندان ممکن است فقط با مراقبت خانگی حل نشود و نیاز به معاینه داشته باشد."
    );
  } else if (signals.brokenTooth) {
    parts.push(
      "شکستگی، ترک، لب‌پریدگی یا افتادن پرکردگی می‌تواند باعث حساسیت، درد جویدن و حتی التهاب عصب شود. هرچه سطح شکستگی عمیق‌تر باشد، احتمال نیاز به ترمیم وسیع‌تر، روکش یا درمان ریشه بیشتر می‌شود."
    );
  } else if (signals.postExtraction) {
    parts.push(
      "بعد از کشیدن دندان، درد خفیف تا متوسط در یکی دو روز اول می‌تواند طبیعی باشد؛ اما اگر درد بعد از 2 تا 3 روز شدیدتر و ضربانی شود، بوی بد یا طعم بد ایجاد شود، یا ورم رو به افزایش باشد، باید به عارضه‌هایی مثل dry socket یا عفونت فکر کرد و معاینه لازم است."
    );
  } else if (signals.postRootCanal) {
    parts.push(
      "بعد از عصب‌کشی مقداری حساسیت یا درد خفیف هنگام فشار تا چند روز ممکن است طبیعی باشد، اما درد شدیدِ رو به افزایش، ورم، تب یا درد ضربانی معمولاً طبیعی محسوب نمی‌شود و باید دوباره بررسی شوید."
    );
  } else if (signals.jawOrGrinding) {
    parts.push(
      "اگر درد بیشتر در ناحیه فک، جلوی گوش، با صدای تق‌تق، قفل‌شدن یا فشار صبحگاهی همراه است، مشکل می‌تواند از مفصل فک یا دندان‌قروچه باشد نه فقط خود دندان. در این حالت شرح‌حال و معاینه برای افتراق از درد دندانی مهم است."
    );
  } else if (signals.orthodontic) {
    parts.push(
      "در ارتودنسی، فشار خفیف و حساسیت چند روزه بعد از تنظیم سیم یا الاینر می‌تواند طبیعی باشد؛ ولی زخم شدید، لق‌شدن غیرعادی، تورم، درد متمرکز روی یک دندان یا گیرکردن سیم باید بررسی شود."
    );
  } else if (signals.ulcer) {
    parts.push(
      "زخم‌های دهانی کوچک و دردناک اغلب آفت یا تحریک موضعی هستند، اما اگر زخم بزرگ، مکرر، خیلی دردناک، یا بیشتر از حدود 2 هفته ماندگار باشد، معاینه لازم است."
    );
  } else if (localAnswer) {
    parts.push(localAnswer);
  } else {
    parts.push(
      "برای مشکل دندان و لثه بدون معاینه و گاهی عکس، نمی‌شود تشخیص قطعی داد؛ اما نوع درد، مدت علائم، وجود ورم، تب، حساسیت به سرد و گرم، درد جویدن، و محل دقیق درد کمک می‌کند حدس بالینی خیلی بهتر شود."
    );
  }

  if (signals.swelling || signals.pain || signals.brokenTooth || signals.postExtraction) {
    parts.push(
      "تا زمان ویزیت، روی سمت دردناک کمتر غذا بجوید، از خوراکی خیلی سرد، خیلی داغ و خیلی شیرین پرهیز کنید، و اگر دهان تحریک نشده است می‌توانید با آب ولرم و کمی نمک به‌آرامی شست‌وشو بدهید. روی محل درد چیزی مثل آسپرین، الکل یا مواد خانگی نگذارید."
    );
  } else if (signals.bleedingGums) {
    parts.push(
      "برای لثه، بهداشت را قطع نکنید؛ مسواک نرم و تمیزکردن ملایم بین دندان‌ها مهم است، چون باقی‌ماندن پلاک معمولاً خونریزی را بدتر می‌کند."
    );
  }

  if (detectUrgency(question) || (signals.swelling && (signals.fever || signals.pusOrBadTaste))) {
    parts.push(
      "اگر ورم صورت یا فک رو به افزایش است، تب دارید، طعم بد یا ترشح چرکی دارید، یا در بلع، صحبت‌کردن یا نفس‌کشیدن مشکل پیدا کرده‌اید، این وضعیت فوریت بیشتری دارد و باید سریع بررسی شوید."
    );
  } else {
    parts.push(`اگر بخواهی دقیق‌تر راهنمایی‌ات کنم، همین سؤال را با ${detailsNeeded} بفرست.`);
  }

  return parts.join("\n\n");
}

function createTimeoutSignal(timeoutMs) {
  if (typeof AbortSignal === "undefined" || typeof AbortSignal.timeout !== "function") {
    return undefined;
  }

  return AbortSignal.timeout(timeoutMs);
}

function postJson(url, payload, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 15000;
  const body = JSON.stringify(payload);
  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    ...(options.headers || {}),
  };

  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "POST",
        headers,
        agent: options.proxyUrl ? new HttpsProxyAgent(options.proxyUrl) : undefined,
      },
      (response) => {
        let responseText = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseText += chunk;
        });
        response.on("end", () => {
          resolve({
            ok: Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 300),
            status: response.statusCode || 500,
            text: responseText,
          });
        });
      }
    );

    request.on("error", reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    request.write(body);
    request.end();
  });
}

class ClinicAiService {
  constructor(config) {
    this.aiProvider = String(config.aiProvider || "auto").trim().toLowerCase() || "auto";
    this.groqApiKey = config.groqApiKey;
    this.groqModel = config.groqModel;
    this.groqProxyUrl = config.groqProxyUrl || config.telegramProxyUrl || "";
    this.geminiApiKey = config.geminiApiKey;
    this.geminiModel = config.geminiModel;
    this.geminiProxyUrl = config.geminiProxyUrl || config.telegramProxyUrl || "";
    this.ollamaUrl = config.ollamaUrl;
    this.ollamaModel = config.ollamaModel;
    this.requestTimeoutMs = Number(config.aiRequestTimeoutMs) > 0
      ? Number(config.aiRequestTimeoutMs)
      : 15000;
  }

  async answer(question, context = {}) {
    const localAnswer = findLocalAnswer(question);

    for (const provider of this.#getProviderOrder()) {
      try {
        if (provider === "groq") {
          return await this.#askGroq(question, context);
        }

        if (provider === "gemini") {
          return await this.#askGemini(question, context);
        }

        if (provider === "ollama") {
          return await this.#askOllama(question, context);
        }
      } catch (error) {
        console.error(`${provider[0].toUpperCase()}${provider.slice(1)} request failed:`, error.message);
      }
    }

    return this.#buildFallback(question, localAnswer);
  }

  #getProviderOrder() {
    const available = [];

    if (this.groqApiKey) {
      available.push("groq");
    }

    if (this.geminiApiKey) {
      available.push("gemini");
    }

    if (this.ollamaUrl) {
      available.push("ollama");
    }

    if (this.aiProvider !== "auto") {
      return [this.aiProvider, ...available.filter((provider) => provider !== this.aiProvider)];
    }

    return available;
  }

  async #askGroq(question, context) {
    const response = await postJson(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: this.groqModel,
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(),
          },
          {
            role: "user",
            content: [
              context.userName ? `نام بیمار: ${context.userName}` : null,
              `سوال بیمار: ${question}`,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
        temperature: 0.3,
        max_completion_tokens: 500,
        user: context.userId || undefined,
      },
      {
        proxyUrl: this.groqProxyUrl,
        timeoutMs: this.requestTimeoutMs,
        headers: {
          Authorization: `Bearer ${this.groqApiKey}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`${response.status} ${response.text}`);
    }

    const payload = JSON.parse(response.text);
    const content = payload.choices?.[0]?.message?.content;
    const text = Array.isArray(content)
      ? content.map((part) => part?.text || "").join("").trim()
      : String(content || "").trim();

    if (!text) {
      throw new Error("Groq returned an empty response");
    }

    return this.#postProcess(text, question);
  }

  async #askGemini(question, context) {
    const response = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${this.geminiApiKey}`,
      {
        systemInstruction: {
          parts: [{ text: buildSystemPrompt() }],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: [
                  context.userName ? `نام بیمار: ${context.userName}` : null,
                  `سوال بیمار: ${question}`,
                ]
                  .filter(Boolean)
                  .join("\n"),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 500,
        },
      },
      {
        proxyUrl: this.geminiProxyUrl,
        timeoutMs: this.requestTimeoutMs,
      }
    );

    if (!response.ok) {
      throw new Error(`${response.status} ${response.text}`);
    }

    const payload = JSON.parse(response.text);
    const text =
      payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("")
        .trim() || "";

    if (!text) {
      throw new Error("Gemini returned an empty response");
    }

    return this.#postProcess(text, question);
  }

  async #askOllama(question, context) {
    const response = await fetch(`${this.ollamaUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: createTimeoutSignal(this.requestTimeoutMs),
      body: JSON.stringify({
        model: this.ollamaModel,
        stream: false,
        prompt: [
          buildSystemPrompt(),
          context.userName ? `نام بیمار: ${context.userName}` : null,
          `سوال بیمار: ${question}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${response.status} ${errorText}`);
    }

    const payload = await response.json();
    const text = String(payload.response || "").trim();

    if (!text) {
      throw new Error("Ollama returned an empty response");
    }

    return this.#postProcess(text, question);
  }

  #buildFallback(question, localAnswer) {
    const isDental = detectDentalTopic(question);
    const urgentNotice = isDental ? clinicProfile.emergencyNotice : GENERAL_EMERGENCY_NOTICE;

    if (isDental) {
      const answer = buildDentalFallback(question, localAnswer);

      if (!detectUrgency(question)) {
        return answer;
      }

      return `${answer}\n\n${urgentNotice}`;
    }

    const parts = [];

    parts.push(
      "برای این سوال پزشکی بدون شرح‌حال کامل و معاینه نمی‌شود نظر قطعی داد، اما می‌توانم راهنمایی آموزشی بدهم. اگر خواستی سوالت را با سن، مدت علائم، شدت درد، تب، بیماری زمینه‌ای، داروهای مصرفی و این‌که علائم از کی شروع شده دقیق‌تر بفرست."
    );
    parts.push(
      "اگر علائم ادامه‌دار، شدید یا غیرعادی هستند، بهتر است توسط پزشک عمومی یا متخصص مرتبط بررسی شوی."
    );

    if (detectUrgency(question)) {
      parts.push(urgentNotice);
    } else {
      parts.push(
        "اگر درد شدید، تب، بی‌حالی، تنگی نفس، کم‌آبی، خونریزی، یا بدترشدن سریع علائم دارید، ارزیابی حضوری را عقب نیندازید."
      );
    }

    return parts.join("\n\n");
  }

  #postProcess(text, question) {
    const compact = text.replace(/\n{3,}/g, "\n\n").trim();
    const urgentNotice = detectDentalTopic(question)
      ? clinicProfile.emergencyNotice
      : GENERAL_EMERGENCY_NOTICE;

    if (!detectUrgency(question)) {
      return compact;
    }

    return `${compact}\n\n${urgentNotice}`;
  }
}

module.exports = {
  ClinicAiService,
};
