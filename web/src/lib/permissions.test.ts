import { describe, it, expect } from "vitest";
import { canWriteList } from "./permissions";
import type { List, User } from "../types";

const USER: User = {
  email: "owner@example.com",
  display_name: "Owner",
  role: "member",
  active: true,
  created_at: 0,
  maps_provider: null,
};

function makeList(overrides: Partial<List> = {}): List {
  return {
    id: "list-1",
    name: "List",
    color: null,
    owner_email: "owner@example.com",
    visibility: "private",
    created_at: 0,
    ...overrides,
  };
}

describe("canWriteList", () => {
  it("shared list + non-owner -> true", () => {
    const list = makeList({ visibility: "shared", owner_email: "someone-else@example.com" });
    expect(canWriteList(list, USER)).toBe(true);
  });

  it("private list + owner -> true", () => {
    const list = makeList({ visibility: "private", owner_email: USER.email });
    expect(canWriteList(list, USER)).toBe(true);
  });

  it("private list + non-owner -> false", () => {
    const list = makeList({ visibility: "private", owner_email: "someone-else@example.com" });
    expect(canWriteList(list, USER)).toBe(false);
  });

  it("undefined list -> false", () => {
    expect(canWriteList(undefined, USER)).toBe(false);
  });

  it("mixed-case owner_email vs. user.email -> true (faithful mirror of the server's lowercase compare)", () => {
    const list = makeList({ visibility: "private", owner_email: "Owner@Example.com" });
    const user: User = { ...USER, email: "owner@example.com" };
    expect(canWriteList(list, user)).toBe(true);
  });
});
