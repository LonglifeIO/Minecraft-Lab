import { getIronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  username: string;
  role: "admin" | "moderator" | "viewer";
  isLoggedIn: boolean;
}

const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET || "this-is-a-secret-that-must-be-at-least-32-chars-long",
  cookieName: "mc-session",
  cookieOptions: {
    secure: false,
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 7,
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

export function getUsers(): Array<{ username: string; password: string; role: SessionData["role"] }> {
  const raw = process.env.USERS || "admin:admin:admin";
  return raw.split(",").map((entry) => {
    const [username, password, role] = entry.split(":");
    return { username, password, role: (role as SessionData["role"]) || "viewer" };
  });
}
