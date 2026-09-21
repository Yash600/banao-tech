export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    serverKey: Boolean(process.env.GROQ_API_KEY),
    needsAccessCode: Boolean(process.env.ACCESS_CODE),
    model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
  });
}
