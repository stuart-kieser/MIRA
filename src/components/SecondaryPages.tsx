import {
  Bell,
  Check,
  CreditCard,
  HardDrive,
  KeyRound,
  Link2,
  LoaderCircle,
  Lock,
  LogOut,
  Mail,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { authClient } from "../auth-client";
import { apiJson } from "../services/api";

interface SharedPageProps {
  onCreate: () => void;
}

export function SharedPage({ onCreate }: SharedPageProps) {
  return (
    <main className="main-content secondary-page">
      <header className="page-header">
        <div>
          <span className="page-kicker">COLLABORATION</span>
          <h1>Shared with me</h1>
          <p>
            3D scans that friends, family, and teammates have invited you to
            explore.
          </p>
        </div>
      </header>
      <div className="shared-empty">
        <div className="empty-orbits">
          <span>
            <Users size={28} />
          </span>
          <i />
          <i />
        </div>
        <h2>No shared scans yet</h2>
        <p>
          When someone shares a Mira link with your email, their scan will
          appear here.
        </p>
        <button className="dark-button" onClick={onCreate}>
          Create a scan to share
        </button>
      </div>
      <div className="sharing-features">
        <div>
          <Link2 size={20} />
          <strong>One private link</strong>
          <p>Share a 3D scan without sending a large file.</p>
        </div>
        <div>
          <Lock size={20} />
          <strong>You stay in control</strong>
          <p>Disable access or make a link expire whenever you need.</p>
        </div>
        <div>
          <Mail size={20} />
          <strong>Easy guest access</strong>
          <p>
            Invite viewers while keeping ownership attached to your account.
          </p>
        </div>
      </div>
    </main>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      className={`toggle ${checked ? "on" : ""}`}
      role="switch"
      aria-checked={checked}
      onClick={onChange}>
      <i />
    </button>
  );
}

interface Preferences {
  ready_emails: boolean;
  weekly_emails: boolean;
  prefer_high_quality: boolean;
}
interface AccountSummary {
  scans_created: number;
  scans_completed: number;
  scans_processing: number;
  developmentBypass: boolean;
  credits: Array<{ quality: string; count: number }>;
}

export function SettingsPage() {
  const session = authClient.useSession();
  const user = session.data!.user;
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [readyEmails, setReadyEmails] = useState(true);
  const [weeklyEmails, setWeeklyEmails] = useState(false);
  const [highQuality, setHighQuality] = useState(true);
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void Promise.all([
      apiJson<Preferences>("/api/account/preferences"),
      apiJson<AccountSummary>("/api/account/summary"),
    ])
      .then(([preferences, account]) => {
        setReadyEmails(preferences.ready_emails);
        setWeeklyEmails(preferences.weekly_emails);
        setHighQuality(preferences.prefer_high_quality);
        setSummary(account);
      })
      .catch((error) =>
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not load account settings.",
        ),
      );
  }, []);

  const save = async () => {
    setPending(true);
    setMessage("");
    try {
      if (name.trim() !== user.name) {
        const result = await authClient.updateUser({ name: name.trim() });
        if (result.error) throw new Error(result.error.message);
      }
      if (email.trim().toLowerCase() !== user.email.toLowerCase()) {
        const result = await authClient.changeEmail({
          newEmail: email.trim(),
          callbackURL: "/app",
        });
        if (result.error) throw new Error(result.error.message);
      }
      await apiJson("/api/account/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          readyEmails,
          weeklyEmails,
          preferHighQuality: highQuality,
        }),
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save settings.",
      );
    } finally {
      setPending(false);
    }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const result = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    if (result.error)
      setMessage(result.error.message || "Could not change password.");
    else {
      setCurrentPassword("");
      setNewPassword("");
      setMessage("Password updated and other sessions were signed out.");
    }
    setPending(false);
  };

  const deleteAccount = async () => {
    const password = window.prompt(
      "Enter your password to permanently delete this account and its scan records:",
    );
    if (!password) return;
    const result = await authClient.deleteUser({ password });
    if (result.error)
      setMessage(result.error.message || "Could not delete the account.");
    else window.location.assign("/");
  };

  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const availableCredits =
    summary?.credits.reduce(
      (total, credit) => total + Number(credit.count),
      0,
    ) || 0;

  return (
    <main className="main-content secondary-page settings-page">
      <header className="page-header">
        <div>
          <span className="page-kicker">YOUR ACCOUNT</span>
          <h1>Account settings</h1>
          <p>Manage your identity, scan access, security, and notifications.</p>
        </div>
        <button
          className="primary-button"
          onClick={() => void save()}
          disabled={pending}>
          {pending ? (
            <LoaderCircle className="spin" size={17} />
          ) : saved ? (
            <>
              <Check size={17} /> Saved
            </>
          ) : (
            "Save changes"
          )}
        </button>
      </header>
      {message && (
        <div className="settings-message" role="status">
          {message}
        </div>
      )}

      <section className="settings-section">
        <div className="settings-heading">
          <div className="settings-heading-icon">
            <ShieldCheck size={21} />
          </div>
          <div>
            <h2>Profile</h2>
            <p>How you appear when sharing spaces.</p>
          </div>
        </div>
        <div className="settings-card profile-settings">
          <div className="large-avatar">{initials || "M"}</div>
          <label className="field-label">
            Display name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="field-label">
            Email address
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
            />
          </label>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-heading">
          <div className="settings-heading-icon">
            <CreditCard size={21} />
          </div>
          <div>
            <h2>Scan allowance</h2>
            <p>Free use, paid credits, and build activity.</p>
          </div>
        </div>
        <div className="settings-card account-stats">
          <div>
            <strong>{summary?.scans_created ?? "—"}</strong>
            <span>Generated scans</span>
          </div>
          <div>
            <strong>{summary?.scans_completed ?? "—"}</strong>
            <span>Completed</span>
          </div>
          <div>
            <strong>{availableCredits}</strong>
            <span>Paid credits</span>
          </div>
          {summary?.developmentBypass && (
            <p className="dev-bypass-notice">
              <Check size={15} /> Development bypass active — generated scans
              will not require payment.
            </p>
          )}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-heading">
          <div className="settings-heading-icon">
            <Bell size={21} />
          </div>
          <div>
            <h2>Notifications</h2>
            <p>Choose when Mira gets in touch.</p>
          </div>
        </div>
        <div className="settings-card settings-rows">
          <div>
            <span>
              <strong>Scene ready emails</strong>
              <p>Let me know when a capture has finished processing.</p>
            </span>
            <Toggle
              checked={readyEmails}
              onChange={() => setReadyEmails((value) => !value)}
            />
          </div>
          <div>
            <span>
              <strong>Weekly activity</strong>
              <p>A short summary of views and shared-space activity.</p>
            </span>
            <Toggle
              checked={weeklyEmails}
              onChange={() => setWeeklyEmails((value) => !value)}
            />
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-heading">
          <div className="settings-heading-icon">
            <HardDrive size={21} />
          </div>
          <div>
            <h2>Viewer quality</h2>
            <p>Balance visual detail and device performance.</p>
          </div>
        </div>
        <div className="settings-card settings-rows">
          <div>
            <span>
              <strong>Prefer high quality</strong>
              <p>
                Load more splats on capable devices. Mobile data use may
                increase.
              </p>
            </span>
            <Toggle
              checked={highQuality}
              onChange={() => setHighQuality((value) => !value)}
            />
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-heading">
          <div className="settings-heading-icon">
            <KeyRound size={21} />
          </div>
          <div>
            <h2>Password</h2>
            <p>Use a unique password of at least 10 characters.</p>
          </div>
        </div>
        <form
          className="settings-card password-settings"
          onSubmit={(event) => void changePassword(event)}>
          <label className="field-label">
            Current password
            <input
              required
              minLength={10}
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label className="field-label">
            New password
            <input
              required
              minLength={10}
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          <button className="settings-action" disabled={pending}>
            Change password
          </button>
        </form>
      </section>

      <section className="settings-section danger-settings">
        <div className="settings-heading">
          <div className="settings-heading-icon">
            <Lock size={21} />
          </div>
          <div>
            <h2>Account access</h2>
            <p>Sign out or permanently remove your account.</p>
          </div>
        </div>
        <div className="settings-card settings-rows">
          <div>
            <span>
              <strong>Sign out</strong>
              <p>End this session on the current device.</p>
            </span>
            <button
              className="settings-action"
              onClick={() =>
                void authClient.signOut({
                  fetchOptions: {
                    onSuccess: () => window.location.assign("/"),
                  },
                })
              }>
              <LogOut size={15} /> Sign out
            </button>
          </div>
          <div>
            <span>
              <strong>Delete account</strong>
              <p>Permanently removes your account and its Mira scan records.</p>
            </span>
            <button
              className="settings-action danger"
              onClick={() => void deleteAccount()}>
              <Trash2 size={15} /> Delete
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
