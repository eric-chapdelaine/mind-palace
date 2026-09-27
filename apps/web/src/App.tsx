import { BrowserRouter, Link, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { DashboardPage } from "./DashboardPage";
import { TaskPage } from "./TaskPage";
import { TimeBlockPage } from "./TimeBlockPage";
import { SchedulePage } from "./SchedulePage";
import { TagsPage } from "./TagsPage";
import { TagPage } from "./TagPage";
import { Breadcrumbs, CrumbTitleProvider, resetTrail } from "./components/Breadcrumbs";

const navItems = [
  { to: "/", label: "Dashboard" },
  { to: "/schedule", label: "Schedule" },
  { to: "/tags", label: "Tags" },
];

function isActive(to: string, pathname: string) {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

function Layout() {
  const location = useLocation();
  return (
    <div className="app-layout">
      <header className="app-topbar">
        <div className="app-brand">Mind Palace</div>
        <nav>
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={resetTrail}
              className={isActive(item.to, location.pathname) ? "active" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <div className="app-content">
        <CrumbTitleProvider>
          <Breadcrumbs />
          <Outlet />
        </CrumbTitleProvider>
      </div>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/tasks/:id" element={<TaskPage />} />
          <Route path="/time-blocks/:id" element={<TimeBlockPage />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/tags/:id" element={<TagPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}