// Mock NetSuite REST record API (shape loosely follows /services/rest/record/v1/{record}).
import { itemReceipts, purchaseOrders, vendorBills, vendors } from "@/data/seed";
import { getWorkspace } from "@/lib/workspace";
import { q } from "@/lib/db";
import type { NextRequest } from "next/server";

const DATA: Record<string, () => object[]> = {
  vendor: () => vendors,
  purchaseOrder: () => purchaseOrders,
  itemReceipt: () => itemReceipts,
  vendorBill: () => vendorBills,
};

export async function GET(req: NextRequest, ctx: RouteContext<"/api/erp/[record]">) {
  const { record } = await ctx.params;
  if (!DATA[record]) {
    return Response.json({ "o:errorDetails": [{ detail: `Record type '${record}' is not supported by this mock.` }] }, { status: 404 });
  }
  const w = await getWorkspace();
  let items = DATA[record]();
  if (record === "vendorBill") {
    const posted = await q<{ data: object; status: string }>("select data, status from erp_writes where workspace_id = $1 and record_type = 'vendorBill'", [w.id]);
    items = [...items, ...posted.map((p) => ({ ...p.data, _mockStatus: p.status }))];
  }
  const limit = Math.min(1000, Number(req.nextUrl.searchParams.get("limit") ?? 1000));
  const offset = Number(req.nextUrl.searchParams.get("offset") ?? 0);
  const page = items.slice(offset, offset + limit);
  return Response.json({
    _mock: "Synthetic MOCK DATA. Not a real NetSuite account.",
    count: page.length,
    totalResults: items.length,
    offset,
    hasMore: offset + limit < items.length,
    items: page,
  });
}
