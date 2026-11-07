import { expect, test, type Page } from "@playwright/test";

// The two paths the demo recording depends on. If either breaks, don't record.

const SETUP_DECISIONS: [string, string][] = [
  ["purchaseOrder.custbody_dept_code", "cost_center"],
  ["vendorBill.custbody_ref1", "bill_po"],
  ["vendorBill.custbody_svc_date", "__ignore"],
];

/** Gets a fresh, rehearsal-flagged workspace through setup via the API (same calls the UI makes). */
async function setUpViaApi(page: Page) {
  await page.goto("/?internal=1");
  const r = page.request;
  expect((await r.post("/api/setup/start")).ok()).toBeTruthy();
  expect((await r.post("/api/erp/connect", { data: { accountId: "TSTDRV2026417", token: "nsk_sandbox_demo" } })).ok()).toBeTruthy();
  expect((await r.get("/api/mapping")).ok()).toBeTruthy();
  for (const [sourceKey, target] of SETUP_DECISIONS) expect((await r.post("/api/mapping", { data: { sourceKey, target } })).ok()).toBeTruthy();
  const sync = await (await r.post("/api/sync")).text();
  expect(sync).toContain('"done":true');
}

test("happy path: zero to first posted bill, then reverse it", async ({ page }) => {
  await page.goto("/?internal=1");
  await expect(page.getByText("MOCK DATA").first()).toBeVisible();
  await page.getByRole("link", { name: /Start setup/ }).click();

  // 1. Connect
  await expect(page).toHaveURL(/\/setup\/connect/);
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Continue to field mapping/ }).click();

  // 2. Mapping: exactly three fields need a human
  await expect(page).toHaveURL(/\/setup\/mapping/);
  await expect(page.getByText("3 need your decision")).toBeVisible();
  const continueBtn = page.getByRole("button", { name: /Continue to test sync/ });
  await expect(continueBtn).toBeDisabled();
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: /^(Accept suggestion|Agree: not needed)$/ }).first().click();
    await expect(page.getByRole("button", { name: /^(Accept suggestion|Agree: not needed)$/ })).toHaveCount(2 - i);
  }
  await expect(continueBtn).toBeEnabled();
  await continueBtn.click();

  // 3. Test sync: partial success with two quarantined bills
  await expect(page).toHaveURL(/\/setup\/sync/);
  await page.getByRole("button", { name: "Run test sync" }).click();
  await expect(page.getByText("Partial success")).toBeVisible();
  await expect(page.getByText("Quarantined records")).toBeVisible();
  await expect(page.getByText(/SE2026-118/).first()).toBeVisible();
  await page.getByRole("button", { name: /Start the AP employee/ }).click();

  // 4. AP employee: 16 matched, 4 exceptions
  await expect(page).toHaveURL(/\/employee$/);
  await page.getByRole("button", { name: /Process 20 invoices/ }).click();
  await expect(page.getByRole("button", { name: /Approve all matched \(16\)/ })).toBeVisible({ timeout: 90_000 });

  // 5. First bill: the timer stops
  await page.getByRole("link", { name: "inv-01.pdf" }).click();
  await expect(page).toHaveURL(/\/employee\/inv-01/);
  await page.getByRole("button", { name: /Approve & post bill/ }).click();
  await expect(page.getByText("Your AP employee is working.")).toBeVisible();
  await expect(page.getByText("Done. Timer stopped")).toBeVisible();

  // 6. Trust: the posted bill can be reversed from the audit trail
  await page.goto("/audit");
  const posted = page.locator("li", { hasText: "bill_posted" });
  await posted.getByRole("button", { name: "Reverse" }).click();
  await expect(page.locator("li", { hasText: "bill_voided" })).toBeVisible();
  await expect(posted.getByText("reversed", { exact: true })).toBeVisible();
});

test("exception path: price mismatch is cited, override needs a reason, hold is audited", async ({ page }) => {
  await setUpViaApi(page);
  expect((await page.request.post("/api/agent/process", { data: { invoiceId: "inv-06" } })).ok()).toBeTruthy();

  await page.goto("/employee/inv-06");
  await expect(page.getByText("HSS-INV-3392").first()).toBeVisible();
  await expect(page.getByText("The employee stopped: price above po.")).toBeVisible();

  // The citation: invoice value vs PO value, plus the rule
  const priceCheck = page.locator("li", { hasText: "Prices match PO" });
  await expect(priceCheck.getByText("Price above PO")).toBeVisible();
  await expect(priceCheck.getByText("₹1,060.00").first()).toBeVisible();
  await expect(priceCheck.getByText("₹1,000.00").first()).toBeVisible();
  await expect(priceCheck.getByText(/Rule:.*2%/)).toBeVisible();

  // Override without a reason is refused
  await page.getByRole("button", { name: /Override & post/ }).click();
  await expect(page.getByText(/needs a written reason/)).toBeVisible();

  // Hold with a reason
  await page.getByPlaceholder(/Reason/).fill("Price is 6% above PO-2306. Asking vendor for a credit note.");
  await page.getByRole("button", { name: /Hold & query vendor/ }).click();
  await expect(page.getByText("On hold").first()).toBeVisible();

  await page.goto("/audit");
  await expect(page.getByText(/Put HSS-INV-3392 on hold/)).toBeVisible();
});
