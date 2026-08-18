import { useContext } from "react";
import { AuthContext, type Profile } from "@/contexts/AuthProvider";

export type { Profile };

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export { AuthProvider } from "@/contexts/AuthProvider";
