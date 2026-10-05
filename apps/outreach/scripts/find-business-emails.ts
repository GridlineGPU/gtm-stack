// Read-only public website research. Writes a ledger, never sends or edits Studio state.
import { mkdir } from "node:fs/promises";
import { inferCompanyDomain, type TrackedCompany } from "../src/tracker-model";

const workspace = await (await fetch("http://127.0.0.1:4310/api/state")).json();
const out = new URL("../.data/email-research/", import.meta.url).pathname;
await mkdir(out, { recursive: true });
const suffix = /^(?:co|com|net|org|gov|edu|ac|ad)\.[a-z]{2}$/;
function base(host: string) {
  const parts = host.toLowerCase().split(".");
  return parts.slice(suffix.test(parts.slice(-2).join(".")) ? -3 : -2).join(".");
}
function routeUrls(value: string) {
  return [
    ...value.matchAll(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"'();,]*)?/gi),
  ].map((m) => `https://${m[0].replace(/^https?:\/\//, "").replace(/[.,]+$/, "")}`);
}
const addressPattern =
  /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}/gi;
const shared =
  /^(?:sales|partners?|partnerships?|business|commercial|.*enquir.*|.*inquir.*|info|hello|contact|connect|cloud|gpu|welcome)(?:[._-]|$)/i;
const excluded =
  /^(?:support|help|press|pr|media|ir|investor|privacy|legal|dpo|security|abuse|hr|career|job|recruit|noreply|no-reply|webmaster|admin|compliance|copyright|notification|billing|invoice|dataprotection|unsubscribe)/i;
let index = 0;
async function checkCompany(c: TrackedCompany) {
  const routes = Object.values(c.routes).join(" ");
  const roots = new Set(routeUrls(routes).map((u) => base(new URL(u).hostname)));
  const starts = [
    ...new Set([...routeUrls(c.routes.email || ""), `https://${inferCompanyDomain(c)}`]),
  ]
    .filter((u) => !/\b(?:ir|news|newsroom|docs|support)\./.test(u))
    .slice(0, 4);
  const result: NonNullable<TrackedCompany["emailResearch"]> & {
    companyId: string;
    company: string;
  } = {
    companyId: c.id,
    company: c.name,
    checkedAt: new Date().toISOString(),
    pages: [],
    candidates: [],
  };
  const visited = new Set<string>();
  const queue = [...starts];
  while (queue.length && visited.size < 7) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      let current = url;
      let response: Response | undefined;
      for (let redirect = 0; redirect < 5; redirect++) {
        const u = new URL(current);
        if (
          u.protocol !== "https:" ||
          !roots.has(base(u.hostname)) ||
          !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)
        )
          throw new Error("Redirect outside imported company domains");
        response = await fetch(u, {
          redirect: "manual",
          signal: AbortSignal.timeout(10000),
          headers: {
            "User-Agent": "Gridline-Outreach-Research/1.0 (public contact research)",
            Accept: "text/html",
          },
        });
        if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
          current = new URL(response.headers.get("location")!, current).href;
          continue;
        }
        break;
      }
      if (!response?.ok || !response.headers.get("content-type")?.includes("text/html")) {
        result.pages.push({ url: current, status: response?.status || "unavailable" });
        continue;
      }
      const html = (await response.text()).slice(0, 3_000_000);
      if (
        /Just a moment|Attention Required!|Enable JavaScript and cookies to continue/i.test(
          html.slice(0, 10000),
        )
      ) {
        result.pages.push({ url: current, status: "challenge" });
        continue;
      }
      let decoded = html.replace(
        /<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi,
        " ",
      );
      decoded = decoded
        .replace(/data-cfemail=["']([0-9a-f]+)["']/gi, (_, hex) => {
          const key = parseInt(hex.slice(0, 2), 16);
          return Array.from({ length: (hex.length - 2) / 2 }, (_, i) =>
            String.fromCharCode(parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16) ^ key),
          ).join("");
        })
        .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, hex, dec) =>
          String.fromCharCode(parseInt(hex || dec, hex ? 16 : 10)),
        )
        .replaceAll("&commat;", "@")
        .replaceAll("&period;", ".");
      const plain = decoded.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      const mailtos = [...decoded.matchAll(/href=["']mailto:([^"'?]+)(?:\?[^"']*)?["']/gi)]
        .map((m) => {
          try {
            return decodeURIComponent(m[1]);
          } catch {
            return "";
          }
        })
        .join(" ");
      const found = [...new Set(`${plain} ${mailtos}`.match(addressPattern) || [])];
      for (let email of found) {
        email = email.replace(/^[./]+/, "").toLowerCase();
        const [local, domain] = email.split("@");
        if (
          excluded.test(local) ||
          !roots.has(base(domain)) ||
          /example\.|\.png$|\.jpg$|\.webp$|^first[._]|^name@|^email@|^test@/i.test(email)
        )
          continue;
        const at = plain.toLowerCase().indexOf(email);
        const context =
          at >= 0
            ? plain.slice(Math.max(0, at - 200), at + email.length + 200)
            : "Published mailto link";
        const person = c.people.find(
          (p) => p.role !== "placeholder" && context.toLowerCase().includes(p.name.toLowerCase()),
        );
        const kind = shared.test(local) ? "team" : person ? "person" : "unclassified";
        if (!result.candidates.some((e) => e.address === email))
          result.candidates.push({
            address: email,
            kind,
            contact: person?.name || "",
            source: current,
            checkedAt: result.checkedAt,
            excerpt: context.slice(0, 450),
          });
      }
      result.pages.push({ url: current, status: 200 });
      const links = [...html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
        .filter((m) =>
          /contact|partnership|partner-program|talk.to|connect.with|enquir|お問い合わせ|聯絡|联系我们/i.test(
            `${m[1]} ${m[2].replace(/<[^>]+>/g, " ")}`,
          ),
        )
        .map((m) => {
          try {
            return new URL(m[1].replaceAll("&amp;", "&"), current).href;
          } catch {
            return "";
          }
        })
        .filter(
          (u) =>
            u.startsWith("https:") &&
            roots.has(base(new URL(u).hostname)) &&
            !/login|sign.?up|register|\.pdf|privacy|cookie/i.test(u),
        );
      queue.push(...links.filter((u) => !visited.has(u)).slice(0, 4));
    } catch (e) {
      result.pages.push({ url, status: e instanceof Error ? e.message : "unavailable" });
    }
  }
  await Bun.write(`${out}${c.id}.json`, JSON.stringify(result, null, 2));
  console.log(
    `${c.name}: ${
      result.candidates
        .filter((x) => x.kind !== "unclassified")
        .map((x) => x.address)
        .join(", ") || "no suitable published email found"
    } (${result.pages.length} pages)`,
  );
}
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (index < workspace.state.tracker.companies.length) {
      const c = workspace.state.tracker.companies[index++];
      await checkCompany(c);
    }
  }),
);
console.log(`Ledger saved in ${out}`);
