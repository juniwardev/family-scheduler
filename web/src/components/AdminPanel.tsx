// AdminPanel — roster + active toggle + name edit; shown only to admin users
import React, { useState, useEffect } from "react";
import type { User } from "../types";
import { adminGetUsers, adminUpdateUser } from "../apiClient";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";

export function AdminPanel() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const data = await adminGetUsers();
      setUsers(data.users);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleToggleActive = async (user: User) => {
    if (user.role === "admin" && user.active) {
      alert("Cannot deactivate the admin account.");
      return;
    }
    try {
      await adminUpdateUser(user.email, { active: !user.active });
      await load();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleSaveName = async (email: string) => {
    try {
      await adminUpdateUser(email, { display_name: editName });
      setEditingEmail(null);
      await load();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div className="max-w-2xl">
      <h2 className="mt-0 text-xl font-semibold">Admin — User Roster</h2>

      {error && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {loading ? (
        <div className="loading">Loading…</div>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-border admin-table-scroll-fade">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="bg-muted">
                {["Email", "Name", "Role", "Active", "Actions"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.email} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{u.email}</td>
                  <td className="px-3 py-2">
                    {editingEmail === u.email ? (
                      <div className="flex gap-1.5">
                        <Input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-8 w-36 text-sm"
                        />
                        <Button type="button" size="sm" onClick={() => void handleSaveName(u.email)}>
                          Save
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingEmail(null)}
                        >
                          ×
                        </Button>
                      </div>
                    ) : (
                      <span
                        role="button"
                        tabIndex={0}
                        className="cursor-pointer underline decoration-dotted"
                        onClick={() => { setEditingEmail(u.email); setEditName(u.display_name ?? ""); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setEditingEmail(u.email);
                            setEditName(u.display_name ?? "");
                          }
                        }}
                        title="Click to edit name"
                      >
                        {u.display_name ?? <em className="text-muted-foreground">—</em>}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{u.role}</td>
                  <td className="px-3 py-2">
                    <Badge variant={u.active ? "default" : "destructive"}>
                      {u.active ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={u.active ? "outline" : "default"}
                      onClick={() => void handleToggleActive(u)}
                      disabled={u.role === "admin"}
                      title={u.role === "admin" ? "Cannot deactivate admin" : undefined}
                    >
                      {u.active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
