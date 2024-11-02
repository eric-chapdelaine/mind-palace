import TaskList from "./TaskList";
import NewTaskModal from "./NewTaskModal";
import { useTasks } from "../TaskProvider";
import { useState } from "react";
import { anyScheduledTimesToday, anyScheduledTimesThisWeek, anyScheduledTimesEventually } from "../utils";

export default function Homepage() {
    const { tasks, error } = useTasks();
    const [newTaskOpen, setNewTaskOpen] = useState(false);

    if (error) return (
        <>Error occured: {error.message}</>
    );

    return (
        <>
        <button onClick={() => setNewTaskOpen(true)}> New Task </button>
        <div style={{display: "flex"}}>
            <TaskList title="Today" tasks={tasks.filter(anyScheduledTimesToday)} />
            <TaskList title="This Week" tasks={tasks.filter(anyScheduledTimesThisWeek)} />
            <TaskList title="Eventually" tasks={tasks.filter(anyScheduledTimesEventually)} />
            <TaskList title="Completed" tasks={tasks.filter((t) => t.is_completed)} />
        </div>
        <NewTaskModal open={newTaskOpen} onClose={() => setNewTaskOpen(false)} />
        </>
    )
}
