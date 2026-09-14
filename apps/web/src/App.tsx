import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DashboardPage } from "./DashboardPage";
import { TaskPage } from "./TaskPage";
import { SchedulePage } from "./SchedulePage";
import { TagPage } from "./TagPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/tasks/:id" element={<TaskPage />} />
        <Route path="/tags/:id" element={<TagPage />} />
        <Route path="/schedule" element={<SchedulePage />} />
      </Routes>
    </BrowserRouter>
  );
}