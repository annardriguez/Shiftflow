import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
function removed() {
  return NextResponse.json(
    {
      error:
        "Demo identity selection has been removed. Sign in with a provisioned account.",
    },
    { status: 410 },
  );
}
export const GET = removed;
export const POST = removed;
