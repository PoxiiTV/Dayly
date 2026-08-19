import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/layout";
import { Spinner } from "@/components/ui";
import { AuthPage } from "@/pages/Auth";
import { ForcePasswordPage } from "@/pages/ForcePassword";
import { Dashboard } from "@/pages/Dashboard";
import { MyDay } from "@/pages/MyDay";
import { CalendarView } from "@/pages/CalendarView";
import { Tasks } from "@/pages/Tasks";
import { Inbox } from "@/pages/Inbox";
import { Projects } from "@/pages/Projects";
import { ProjectDetail } from "@/pages/ProjectDetail";
import { Notes } from "@/pages/Notes";
import { Habits } from "@/pages/Habits";
import { Goals } from "@/pages/Goals";
import { Stats } from "@/pages/Stats";
import { Reminders } from "@/pages/Reminders";
import { Trash } from "@/pages/Trash";
import { Settings } from "@/pages/Settings";
import { Profile } from "@/pages/Profile";
import { Help } from "@/pages/Help";
import { Pomodoro } from "@/pages/Pomodoro";
import { Admin } from "@/pages/Admin";
import { VerifyEmailPage } from "@/pages/VerifyEmail";

function AuthGuard() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <FullLoader />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (user.mustChangePassword && loc.pathname !== "/set-password") {
    return <Navigate to="/set-password" replace />;
  }
  if (!user.mustChangePassword && loc.pathname === "/set-password") {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

function AdminGuard() {
  const { user, loading } = useAuth();
  if (loading) return <FullLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/set-password" replace />;
  if (user.roleName !== "ADMIN") return <Navigate to="/" replace />;
  return <Outlet />;
}

export function FullLoader() {
  return <div className="h-screen grid place-items-center"><Spinner className="w-8 h-8" /></div>;
}

export function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<AuthPage key="login" mode="login" />} />
      <Route path="/register" element={<AuthPage key="register" mode="register" />} />
      <Route path="/forgot" element={<AuthPage key="forgot" mode="forgot" />} />
      <Route path="/reset" element={<AuthPage key="reset" mode="reset" />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />

      {/* Authed app shell */}
      <Route element={<AuthGuard />}>
        <Route path="/set-password" element={<ForcePasswordPage />} />
        <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/day" element={<MyDay />} />
        <Route path="/calendar" element={<CalendarView />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/notes" element={<Notes />} />
        <Route path="/notes/:id" element={<Notes />} />
        <Route path="/habits" element={<Habits />} />
        <Route path="/goals" element={<Goals />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/reminders" element={<Reminders />} />
        <Route path="/trash" element={<Trash />} />
        <Route path="/pomodoro" element={<Pomodoro />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/help" element={<Help />} />
        </Route>
      </Route>

      {/* Admin (separate surface, RBAC-guarded) */}
      <Route element={<AdminGuard />}>
        <Route element={<AppShell />}>
          <Route path="/admin" element={<Admin />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}