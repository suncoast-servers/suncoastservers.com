(() => {
  const params = new URLSearchParams(location.search);
  const palettes = {
    sunset: ["#f25a2c", "#10202e"],
    gulf: ["#0a6f6a", "#ec5b47"],
    dusk: ["#c9325a", "#1e1836"]
  };
  const setPalette = (name) => {
    if (name === "sunset") delete document.documentElement.dataset.palette;
    else document.documentElement.dataset.palette = name;
  };
  if (palettes[params.get("palette")]) setPalette(params.get("palette"));
  if (params.has("preview") || params.has("palette")) {
    const bar = document.createElement("div");
    bar.className = "palette-switch";
    bar.innerHTML = "<span>Palette</span>";
    Object.entries(palettes).forEach(([name, [a, b]]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = `<i style="--a:${a};--b:${b}"></i>${name[0].toUpperCase() + name.slice(1)}`;
      btn.setAttribute("aria-pressed", String((document.documentElement.dataset.palette || "sunset") === name));
      btn.addEventListener("click", () => {
        setPalette(name);
        bar.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
        params.set("palette", name);
        history.replaceState(null, "", `?${params}${location.hash}`);
      });
      bar.append(btn);
    });
    document.body.append(bar);
  }

  const year = document.getElementById("y");
  if (year) year.textContent = String(new Date().getFullYear());

  const header = document.querySelector("header.site");
  const onScroll = () => header?.classList.toggle("scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const toggle = document.getElementById("nav-toggle");
  document.querySelectorAll(".nav-links a").forEach((link) => {
    link.addEventListener("click", () => {
      if (toggle) toggle.checked = false;
    });
  });

  const service = document.getElementById("service");
  const preset = params.get("service");
  if (preset && service) {
    const match = [...service.options].find((option) => option.value === preset);
    if (match) service.value = match.value;
  }
  document.querySelectorAll("[data-service]").forEach((link) => {
    link.addEventListener("click", () => {
      if (service) service.value = link.dataset.service;
    });
  });

  const revealables = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && revealables.length) {
    document.documentElement.classList.add("js");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    revealables.forEach((el) => io.observe(el));
  }

  const form = document.getElementById("quote-form");
  const formStatus = document.getElementById("form-status");
  const formStarted = Date.now();

  // The old behaviour, and still the fallback: open the visitor's email app with everything filled in.
  const sendByEmail = (data) => {
    const body = [
      `Name: ${data.get("name") || ""}`,
      `Email: ${data.get("email") || ""}`,
      `Service: ${data.get("service") || ""}`,
      "",
      data.get("message") || ""
    ].join("\n");

    window.location.href =
      "mailto:info@suncoastservers.com" +
      "?subject=" +
      encodeURIComponent(`Suncoast Servers inquiry: ${data.get("service") || "General"}`) +
      "&body=" +
      encodeURIComponent(body);
  };

  // Campaign tags from the page URL, sent along with the lead (not secret).
  const campaignTags = () => {
    const tags = {};
    try {
      const params = new URLSearchParams(window.location.search);
      ["utm_source", "utm_medium", "utm_campaign"].forEach((key) => {
        const value = params.get(key);
        if (value) tags[key] = value.slice(0, 120);
      });
    } catch (_) {}
    return tags;
  };

  // Tries the CRM first (/api/lead). Anything but a clear "got it" falls back to email, so no lead is lost.
  const sendToCrm = async (data) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(data.get("name") || ""),
          email: String(data.get("email") || ""),
          service: String(data.get("service") || ""),
          message: String(data.get("message") || ""),
          company_url: String(data.get("company_url") || ""),
          elapsedMs: Date.now() - formStarted,
          utm: campaignTags()
        }),
        signal: controller.signal
      });
      const out = await response.json().catch(() => ({}));
      return response.ok && out.ok === true;
    } catch (_) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    if (String(data.get("company_url") || "").trim()) return;

    const button = form.querySelector("button[type=submit]");
    if (button) button.disabled = true;
    const sent = await sendToCrm(data);
    if (button) button.disabled = false;

    if (sent && formStatus) {
      form.reset();
      // The note about the email app is only true for the email fallback, so hide it after a real send.
      const emailNote = document.getElementById("form-email-note");
      if (emailNote) emailNote.hidden = true;
      formStatus.textContent = "Thanks, we got it. We will email you back soon.";
      formStatus.hidden = false;
      return;
    }
    sendByEmail(data);
  });
})();
