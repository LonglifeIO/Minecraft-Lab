import { NextResponse } from "next/server";
import { getSession, getUsers } from "@/lib/session";

export async function POST(req: Request) {
  const { username, password } = await req.json();
  const users = getUsers();
  const user = users.find((u) => u.username === username && u.password === password);

  if (!user) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  const session = await getSession();
  session.username = user.username;
  session.role = user.role;
  session.isLoggedIn = true;
  await session.save();

  return NextResponse.json({ ok: true, role: user.role });
}
