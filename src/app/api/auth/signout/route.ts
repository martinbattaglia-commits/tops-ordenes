import { NextResponse, type NextRequest } from "next/server";
import { signOut } from "@/app/login/actions";

export async function POST(request: NextRequest) {
  await signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
