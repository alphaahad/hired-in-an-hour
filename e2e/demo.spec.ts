import { expect, test, type Page } from "@playwright/test";

// The two paths the demo recording depends on. If either breaks, don't record.
// Every test starts with no cookies (its own workspace) and ?internal=1 (a rehearsal, kept out of the metrics).

const SETUP_DECISIONS: [string, string][] = [
  ["purchaseOrder.custbody_dept_code", "cost_center"],
  ["vendorBill.custbody_ref1", "bill_po"],
  ["vendorBill.custbody_svc_date", "__ignore"],
];

/** Hires and onboards an employee through the same API calls the Desk makes. */
async function hireAndOnboardViaApi(page: Page, name: string) {
  await page.goto("/?internal=1");
  const r = page.request;
  expect((await r.post("/api/setup/start", { data: { name } })).ok()).toBeTruthy();
  expect((await r.post("/api/erp/connect", { data: { accountId: "TSTDRV2026417", token: "nsk_sandbox_demo" } })).ok()).toBeTruthy();
  expect((await r.get("/api/mapping")).ok()).toBeTruthy();
  for (const [sourceKey, target] of SETUP_DECISIONS) expect((await r.post("/api/mapping", { data: { sourceKey, target } })).ok()).toBeTruthy();
  expect(await (await r.post("/api/sync")).text()).toContain('"done":true');
}

/** Lets the employee work through the inbox, skipping the step-by-step narration to save time. */
async function letItWork(page: Page) {
  const skip = page.getByRole("button", { name: /Skip ahead/ });
  await expect(skip).toBeVisible({ timeout: 60_000 });
  await skip.click();
  await expect(page.getByText("Waiting on you")).toBeVisible({ timeout: 120_000 });
}

test("happy path: hire, onboard by answering its questions, first posted bill, reverse it", async ({ page }) => {
  await page.goto("/?internal=1");
  await expect(page.getByText("MOCK DATA").first()).toBeVisible();

  // 1. Hire (a plain form: works before the page's JavaScript loads)
  await page.getByLabel(/What should we call your new AP employee/).fill("Meera");
  await page.getByRole("button", { name: /Hire/ }).click();
  await expect(page).toHaveURL(/\/desk/);
  await expect(page.getByRole("heading", { name: "Meera" })).toBeVisible();
  await expect(page.getByText(/Hi, I'm Meera/)).toBeVisible();

  // 2. It asks for access
  await page.getByRole("button", { name: "Grant read-only access" }).click();

  // 3. It asks about exactly three fields it can't be sure of
  await expect(page.getByText("3 questions before I can start")).toBeVisible({ timeout: 60_000 });
  const yes = page.getByRole("button", { name: /^(Yes, that's right|Yes, skip it)$/ });
  for (let left = 3; left > 0; left--) {
    await expect(yes).toHaveCount(left);
    await yes.first().click();
  }

  // 4. It runs the test sync on its own and explains what it set aside
  await expect(page.getByText(/Test sync done: 76 of 78 records in/)).toBeVisible({ timeout: 60_000 });

  // 5. It works the inbox and brings back 16 bills and 4 exceptions
  await letItWork(page);
  await expect(page.getByRole("button", { name: /Approve & post all 16/ })).toBeVisible();

  // 6. First bill: the clock stops
  await page.locator("aside li", { hasText: "KC/26-27/0412" }).getByRole("button", { name: "Post" }).click();
  await expect(page.getByText("Meera is productive.")).toBeVisible();
  await expect(page.getByText("Hired to productive", { exact: true })).toBeVisible();
  await expect(page.getByText(/That's my first bill/)).toBeVisible();

  // 7. Trust: the posted bill can be reversed from the audit trail
  await page.goto("/audit");
  const posted = page.locator("li", { hasText: "bill_posted" });
  await posted.getByRole("button", { name: "Reverse" }).click();
  await expect(page.locator("li", { hasText: "bill_voided" })).toBeVisible();
  await expect(posted.getByText("reversed", { exact: true })).toBeVisible();
});

test("exception path: it stops on the price mismatch, cites it, drafts the query; override needs a reason", async ({ page }) => {
  await hireAndOnboardViaApi(page, "Meera");
  await page.goto("/desk");
  await letItWork(page);

  const card = page.locator("aside > div", { hasText: "HSS-INV-3392" }).first();
  await expect(card.getByText("Price above PO")).toBeVisible();
  await expect(card.getByText("₹1,060.00").first()).toBeVisible();
  await expect(card.getByText("₹1,000.00").first()).toBeVisible();
  await expect(card.getByText(/Rule:.*2%/)).toBeVisible();

  // Its draft to the vendor, in its own name
  await card.getByRole("button", { name: /My draft to Haldenwerk/ }).click();
  await expect(card.getByText(/credit note/)).toBeVisible();

  // The document shows where it read the overbilled price
  await card.getByRole("button", { name: "View" }).click();
  await expect(page.locator('span[title="Read: Rs. 1,060.00"]')).toBeVisible();

  // Override needs a written reason
  await card.getByRole("button", { name: /Override & post/ }).click();
  await expect(card.getByRole("button", { name: "Post anyway" })).toBeDisabled();
  await card.getByRole("button", { name: "Cancel" }).click();

  // Hold: the card leaves, and the employee says what it did
  await card.getByRole("button", { name: /Hold & queue my query/ }).click();
  await expect(page.locator("aside", { hasText: "HSS-INV-3392" })).toHaveCount(0);
  await expect(page.getByText(/HSS-INV-3392 is on hold/)).toBeVisible();

  await page.goto("/audit");
  await expect(page.getByText(/Put HSS-INV-3392 on hold/)).toBeVisible();
});
