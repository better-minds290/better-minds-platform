import { useState } from "react";
import { Link } from "react-router-dom";

export default function BootstrapSetup() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleBootstrap = async () => {
    setStatus("loading");
    setMessage("");

    try {
      const res = await fetch(
        "https://npzxkdolpjoyqsccfiim.supabase.co/functions/v1/bootstrap-admin",
        { method: "POST" }
      );
      const data = await res.json();

      if (data.success) {
        setStatus("success");
        setMessage(data.message || "Admin account created!");
      } else {
        setStatus("error");
        setMessage(data.error || "Something went wrong.");
      }
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  };

  return (
    <div className="min-h-screen bg-background-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 mx-auto flex items-center justify-center rounded-2xl bg-primary-100 text-primary-600 mb-6">
          <i className="ri-shield-check-line text-3xl"></i>
        </div>
        <h1 className="font-heading text-2xl font-bold text-foreground-950 mb-2">
          Initial Setup
        </h1>
        <p className="text-sm text-foreground-500 mb-8">
          Click the button below to create the first admin account. This only needs to be done once.
        </p>

        {status === "success" ? (
          <div className="p-4 rounded-xl bg-accent-100 border border-accent-300/60 mb-6">
            <p className="text-sm font-medium text-accent-800 mb-3">{message}</p>
            <p className="text-xs text-accent-600 mb-3">
              Admin: dinhxuanloc123456@gmail.com
              <br />
              Password: Admin@123456
            </p>
            <Link
              to="/login"
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
            >
              <i className="ri-login-box-line mr-2"></i>
              Go to Login
            </Link>
          </div>
        ) : (
          <>
            {status === "error" && (
              <div className="p-4 rounded-xl bg-accent-100/80 border border-accent-300/60 mb-6">
                <p className="text-sm text-accent-800">{message}</p>
              </div>
            )}
            <button
              onClick={handleBootstrap}
              disabled={status === "loading"}
              className="inline-flex items-center justify-center px-6 py-3 rounded-lg text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-200 whitespace-nowrap cursor-pointer"
            >
              {status === "loading" ? (
                <>
                  <div className="w-4 h-4 border-2 border-background-50/30 border-t-background-50 rounded-full animate-spin mr-2"></div>
                  Creating...
                </>
              ) : (
                <>
                  <i className="ri-play-circle-line mr-2"></i>
                  Create Admin Account
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}