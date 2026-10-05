import nodemailer from "nodemailer";
import { chromium } from "playwright";
import { configuredMailboxes } from "./mailboxes";
import type { Capabilities, Receipt } from "./model";

interface FormAdapter {
  id: string;
  name: string;
  url: string;
  terms: string;
  expectedFormText: string;
  allowedHosts: string[];
  fields: { label: string; selector: string; type: "text" | "select" | "checkbox" }[];
  submitSelector: string;
  successSelector: string;
}
export async function loadAdapters() {
  const config = process.env.OUTREACH_FORMS_FILE;
  const forms: FormAdapter[] = config ? await Bun.file(config).json() : [];
  for (const f of forms) {
    if (
      new URL(f.url).protocol !== "https:" ||
      !f.fields?.length ||
      !f.submitSelector ||
      !f.successSelector ||
      !f.expectedFormText ||
      !f.allowedHosts.includes(new URL(f.url).hostname)
    )
      throw new Error("Invalid form adapter configuration");
    if (/linkedin\.com$/i.test(new URL(f.url).hostname))
      throw new Error("LinkedIn browser automation is not supported");
  }
  const mailboxes = configuredMailboxes();
  const smtpFrom = mailboxes[0]?.from || "";
  const smtp = mailboxes.length > 0;
  const caps: Capabilities = {
    liveEnabled: process.env.OUTREACH_ENABLE_LIVE === "true",
    smtp,
    smtpFrom,
    smtpMailboxes: mailboxes.map((a) => a.from),
    research: Boolean(process.env.OPENAI_API_KEY && process.env.OUTREACH_RESEARCH_MODEL),
    forms: forms.map((f) => ({
      id: f.id,
      name: f.name,
      url: f.url,
      fields: f.fields.map((x) => x.label),
      terms: f.terms,
    })),
  };
  return {
    caps,
    async execute(r: Receipt): Promise<{ status: Receipt["status"]; detail: string }> {
      if (r.mode === "test")
        return {
          status: "simulated",
          detail: `${r.channel === "application" ? "Application captured in test inbox" : r.channel === "linkedin" ? "LinkedIn handoff simulated" : "Email captured in test inbox"}. No external request made.`,
        };
      if (!caps.liveEnabled) throw new Error("Live mode disabled");
      const { prospect: p, campaign: c } = r.snapshot;
      if (r.channel === "linkedin")
        return {
          status: "handoff",
          detail:
            "Approved copy is ready. Open LinkedIn and send manually; no message has been sent by this app.",
        };
      if (r.channel === "email") {
        const mailbox = mailboxes.find((a) => a.from === c.senderEmail.trim().toLowerCase());
        if (!mailbox) throw new Error("Sender mailbox is not connected");
        const { port } = mailbox;
        const transport = nodemailer.createTransport({
          host: mailbox.host,
          port,
          secure: port === 465,
          requireTLS: port !== 465,
          auth: { user: mailbox.user, pass: mailbox.password },
          connectionTimeout: 15_000,
          greetingTimeout: 15_000,
          socketTimeout: 30_000,
          disableFileAccess: true,
          disableUrlAccess: true,
        });
        try {
          const result = await transport.sendMail({
            from: { name: c.sender, address: mailbox.from },
            to: [
              {
                address: p.email,
                name:
                  p.emailEvidence?.address === p.email && p.emailEvidence.kind === "team"
                    ? `${p.company} team`
                    : p.contact,
              },
            ],
            subject: p.subject,
            text: p.body,
            messageId: `<${r.id}@${mailbox.from.split("@")[1]}>`,
          });
          if (!result.accepted?.length || result.rejected?.length)
            throw new Error("Recipient not accepted");
          return {
            status: "accepted",
            detail: `Mailbox server accepted message ${result.messageId}. Delivery and replies still need checking.`,
          };
        } finally {
          transport.close();
        }
      }
      const form = forms.find((f) => f.id === p.formId && f.url === p.program);
      if (!form) throw new Error("Form adapter missing");
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext();
        await context.route("**/*", (route) => {
          const u = new URL(route.request().url());
          return u.protocol === "https:" && form.allowedHosts.includes(u.hostname)
            ? route.continue()
            : route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(12_000);
        await page.goto(form.url, { waitUntil: "domcontentloaded" });
        const submit = page.locator(form.submitSelector);
        if ((await submit.count()) !== 1) throw new Error("Submit control changed");
        const formElement = submit.locator("xpath=ancestor::form[1]");
        if ((await formElement.count()) !== 1)
          throw new Error("Submit control must belong to one inspected form");
        const normalized = (value: string) => value.replace(/\s+/g, " ").trim();
        if (normalized(await formElement.innerText()) !== normalized(form.expectedFormText))
          throw new Error("Visible form text changed. Inspect labels and terms again.");
        if (await page.locator(form.successSelector).isVisible())
          throw new Error("Success marker already present; adapter needs review");
        if (
          await page
            .locator('iframe[src*="captcha"], input[type="password"], [data-sitekey]')
            .count()
        )
          throw new Error("Login or CAPTCHA requires native handoff");
        for (const field of form.fields) {
          const control = page.locator(field.selector);
          const value = p.fields[field.label];
          if (!value || (await control.count()) !== 1)
            throw new Error("Form changed or required value missing");
          if (field.type === "checkbox") {
            if (!["yes", "no"].includes(value.toLowerCase()))
              throw new Error("Checkbox needs explicit yes/no");
            await control.setChecked(value.toLowerCase() === "yes");
          } else if (field.type === "select") await control.selectOption({ label: value });
          else await control.fill(value);
        }
        const valid = await formElement.evaluate(
          (form, selectors) => {
            const mapped = selectors.map((selector) => document.querySelector(selector));
            const controls = [...form.querySelectorAll("input, textarea, select")];
            const unreviewed = controls.some((control) => {
              const input = control as HTMLInputElement;
              if (
                input.disabled ||
                ["hidden", "submit", "button"].includes(input.type) ||
                mapped.includes(control)
              )
                return false;
              return ["checkbox", "radio"].includes(input.type)
                ? input.checked
                : Boolean(input.value);
            });
            return !unreviewed && (form as HTMLFormElement).checkValidity();
          },
          form.fields.map((f) => f.selector),
        );
        if (!valid) throw new Error("Additional required fields or invalid values");
        await page.locator(form.submitSelector).click();
        await page.locator(form.successSelector).waitFor({ state: "visible" });
        return { status: "submitted", detail: `Submission confirmation observed at ${form.url}.` };
      } finally {
        await browser.close();
      }
    },
  };
}
