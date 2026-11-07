import "server-only";

export const ok = (data: unknown, init?: ResponseInit) => Response.json(data, init);
export const bad = (error: string, status = 400) => Response.json({ error }, { status });

export async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
